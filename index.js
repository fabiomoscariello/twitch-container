
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const { promisify } = require('util');
require('dotenv').config();

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

const streamCache = new Map();
const CACHE_TTL_MS = 3 * 60 * 1000;

// Whitelist CDN Twitch: unico dominio autorizzato nel proxy
const ALLOWED_CDN = /^https:\/\/[a-zA-Z0-9.-]+\.twitch\.tv\//;

async function resolveStreamUrl(channel) {
  const cached = streamCache.get(channel);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.url;

  const { stdout } = await execAsync(
    `yt-dlp -g --no-playlist "https://www.twitch.tv/${channel}"`,
    { timeout: 30000 }
  );
  const url = stdout.trim().split('\n')[0];
  if (!url) throw new Error('yt-dlp returned no URL');
  streamCache.set(channel, { url, cachedAt: Date.now() });
  return url;
}

// Fetch server-side senza Origin header → il CDN non vede una richiesta browser
async function fetchCdn(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'okhttp/4.12.0' },
  });
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

// Proxy m3u8 con URI riscritti — il browser non raggiunge mai il CDN direttamente
app.get('/stream.m3u8', async (req, res) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).send('Missing channel');
  if (!/^[a-zA-Z0-9_]{1,25}$/.test(channel)) return res.status(400).send('Invalid channel');

  try {
    const cdnUrl = await resolveStreamUrl(channel);
    const upstream = await fetchCdn(cdnUrl);
    const text = await upstream.text();

    const proxyBase = `${req.protocol}://${req.get('host')}`;
    const rewritten = rewriteM3u8(text, cdnUrl, proxyBase);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.send(rewritten);
  } catch (err) {
    console.error(`/stream.m3u8 error for ${channel}:`, err.message);
    res.status(503).send('Stream unavailable');
  }
});

// Proxy segmenti .ts e init segment — valida che l'URL sia Twitch CDN
app.get('/cdn-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing url');
  if (!ALLOWED_CDN.test(url)) return res.status(403).send('Forbidden');

  try {
    const upstream = await fetchCdn(url);
    const contentType = upstream.headers.get('content-type') || 'video/MP2T';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=30');
    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
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
