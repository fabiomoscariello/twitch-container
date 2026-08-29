
const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true); // legge X-Forwarded-Proto da Cloudflare/Render
app.use(cors());

const streamCache = new Map();
const CACHE_TTL_MS = 3 * 60 * 1000;

// Whitelist CDN Twitch: twitch.tv e ttvnw.net (playlist + segmenti)
const ALLOWED_CDN = /^https:\/\/[a-zA-Z0-9.-]+\.(twitch\.tv|twitchsvc\.net|ttvnw\.net)\//;

// yt-dlp: Python TCP supera il fingerprint check di Usher; Node.js fetch no.
// Restituisce la URL della variant playlist CDN (video-weaver.*.hls.twitchsvc.net)
// che il device può raggiungere direttamente.
function resolveViaYtDlp(channel) {
  return new Promise((resolve, reject) => {
    execFile(
      'yt-dlp',
      ['--no-warnings', '--no-playlist', '-f', 'best', '-g', `https://www.twitch.tv/${channel}`],
      { timeout: 30_000, env: { PATH: process.env.PATH, HOME: process.env.HOME } },
      (err, stdout) => {
        if (err) return reject(new Error(`yt-dlp: ${err.message}`));
        const url = stdout.trim().split('\n')[0];
        if (!url || !url.startsWith('http')) return reject(new Error('yt-dlp: no URL in output'));
        resolve(url);
      },
    );
  });
}

const TWITCH_GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

async function resolveViaGql(channel) {
  const gqlRes = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_GQL_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify([{
      operationName: 'PlaybackAccessToken',
      variables: { isLive: true, login: channel, isVod: false, vodID: '', playerType: 'site' },
      extensions: { persistedQuery: { version: 1, sha256Hash: '0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712' } },
    }]),
  });
  if (!gqlRes.ok) throw new Error(`GQL ${gqlRes.status}`);
  const gqlData = await gqlRes.json();
  const sat = gqlData[0]?.data?.streamPlaybackAccessToken;
  if (!sat) throw new Error('No streamPlaybackAccessToken');
  const params = new URLSearchParams({
    channel, sig: sat.signature, token: sat.value,
    allow_source: 'true', allow_spectre: 'true', fast_bread: 'true',
    p: String(Math.floor(Math.random() * 999999)),
  });
  return `https://usher.twitch.tv/api/channel/live_playlist.m3u8?${params}`;
}

async function resolveStreamUrl(channel) {
  const cached = streamCache.get(channel);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.url;

  let url;
  try {
    url = await resolveViaYtDlp(channel);
    console.log(`[stream] yt-dlp ok for ${channel}`);
  } catch (ytErr) {
    console.warn(`[stream] yt-dlp failed (${ytErr.message}), fallback to GQL`);
    url = await resolveViaGql(channel);
  }
  streamCache.set(channel, { url, cachedAt: Date.now() });
  return url;
}

// Fetch server-side con headers che imitano il player web Twitch
async function fetchCdn(url) {
  const isUsher = url.includes('usher.twitch.tv') || url.includes('usher.twitchsvc.net');
  const headers = isUsher
    ? {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'application/x-mpegURL, application/vnd.apple.mpegurl, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.twitch.tv/',
        'Origin': 'https://www.twitch.tv',
      }
    : { 'User-Agent': 'okhttp/4.12.0' };
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`CDN ${response.status} for ${url}`);
  return response;
}

// Riscrive URI nel m3u8 (relativi e assoluti) puntando al nostro /cdn-proxy
function rewriteM3u8(text, originalUrl, proxyBase) {
  const baseDir = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);
  const resolve = (uri) => (uri.startsWith('http') ? uri : baseDir + uri);

  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();

      // EXT-X-MAP:URI="<init-segment>"
      if (trimmed.startsWith('#EXT-X-MAP')) {
        return line.replace(/URI="([^"]+)"/, (_m, uri) => {
          const abs = resolve(uri);
          return `URI="${proxyBase}/cdn-proxy?url=${encodeURIComponent(abs)}"`;
        });
      }

      // Righe non-commento, non-vuote → URI segmento .ts o sub-playlist
      if (trimmed && !trimmed.startsWith('#')) {
        const abs = resolve(trimmed);
        return `${proxyBase}/cdn-proxy?url=${encodeURIComponent(abs)}`;
      }

      return line;
    })
    .join('\n');
}

// yt-dlp ritorna URL CDN (video-weaver.*.hls.twitchsvc.net) raggiungibile dal device
app.get('/stream.m3u8', async (req, res) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).send('Missing channel');
  if (!/^[a-zA-Z0-9_]{1,25}$/.test(channel)) return res.status(400).send('Invalid channel');

  try {
    const cdnUrl = await resolveStreamUrl(channel);
    return res.redirect(302, cdnUrl);
  } catch (err) {
    console.error(`/stream.m3u8 error for ${channel}:`, err.message);
    res.status(503).send('Stream unavailable');
  }
});

// Proxy per segmenti .ts, init segment e sub-playlist m3u8
// Se il contenuto è m3u8 (master o quality playlist), riscrive gli URI ricorsivamente
app.get('/cdn-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing url');
  if (!ALLOWED_CDN.test(url)) return res.status(404).send('Not found');

  try {
    const upstream = await fetchCdn(url);
    const contentType = upstream.headers.get('content-type') || '';
    const isPlaylist = contentType.includes('mpegurl') || url.includes('.m3u8');

    if (isPlaylist) {
      const text = await upstream.text();
      const proxyBase = `${req.protocol}://${req.get('host')}`;
      const rewritten = rewriteM3u8(text, url, proxyBase);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.send(rewritten);
    } else {
      res.setHeader('Content-Type', contentType || 'video/MP2T');
      res.setHeader('Cache-Control', 'public, max-age=30');
      const buffer = await upstream.arrayBuffer();
      res.send(Buffer.from(buffer));
    }
  } catch (err) {
    console.error('/cdn-proxy error:', err.message);
    res.status(502).send('Segment unavailable');
  }
});

// Restituisce la CDN URL grezza — per l'app Android (ExoPlayer, no CORS)
app.get('/get-stream', async (req, res) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).json({ error: 'Missing channel' });
  if (!/^[a-zA-Z0-9_]{1,25}$/.test(channel)) return res.status(400).json({ error: 'Invalid channel' });

  try {
    const url = await resolveStreamUrl(channel);
    res.json({ stream_url: url });
  } catch (err) {
    console.error(`/get-stream error for ${channel}:`, err.message);
    res.status(503).json({ error: 'Stream not available', detail: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/', (_req, res) => res.send('Twitch Proxy is live'));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
