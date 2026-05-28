
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_SECRET = process.env.TWITCH_SECRET || '';

if (!TWITCH_CLIENT_ID || !TWITCH_SECRET) {
  console.warn('⚠️  TWITCH_CLIENT_ID or TWITCH_SECRET is not set.');
}

app.use(cors());

// OAuth app token (cached in-process)
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAppToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) throw new Error(`OAuth error: ${res.status}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// GQL richiede il client ID ufficiale del web player Twitch
const TWITCH_WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

async function getPlaybackToken(channel, appToken) {
  const res = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: {
      'Client-ID': TWITCH_WEB_CLIENT_ID,
      'Authorization': `Bearer ${appToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{
      operationName: 'PlaybackAccessToken_Template',
      query: 'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }',
      variables: {
        isLive: true,
        login: channel,
        isVod: false,
        vodID: '',
        playerType: 'site',
      },
    }]),
  });

  if (!res.ok) throw new Error(`GQL error: ${res.status}`);
  const data = await res.json();
  const token = data[0]?.data?.streamPlaybackAccessToken;
  if (!token) throw new Error('No playback token in GQL response');
  return token;
}

function buildUsherUrl(channel, signature, value) {
  const params = new URLSearchParams({
    sig: signature,
    token: value,
    allow_source: 'true',
    fast_bread: 'true',
    p: String(Math.floor(Math.random() * 9_999_999)),
    player_backend: 'mediaplayer',
    playlist_include_framerate: 'true',
    reassignments_supported: 'true',
    supported_codecs: 'avc1',
    transcode_mode: 'cbr_v1',
  });
  return `https://usher.twitch.tv/hls/${channel}.m3u8?${params}`;
}

// In-process stream cache (best-effort; cold starts on Vercel reset it)
const streamCache = new Map();
const CACHE_TTL_MS = 3 * 60 * 1000;

async function resolveStreamUrl(channel) {
  const cached = streamCache.get(channel);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.url;

  const appToken = await getAppToken();
  const { value, signature } = await getPlaybackToken(channel, appToken);
  const url = buildUsherUrl(channel, signature, value);
  streamCache.set(channel, { url, cachedAt: Date.now() });
  return url;
}

app.get('/stream.m3u8', async (req, res) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).send('Missing channel');

  try {
    const usherUrl = await resolveStreamUrl(channel);
    const upstream = await fetch(usherUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.twitch.tv/',
        'Origin': 'https://www.twitch.tv',
        'Accept': 'application/x-mpegURL, application/vnd.apple.mpegurl, */*',
      },
    });
    if (!upstream.ok) {
      console.error(`/stream.m3u8 usher error for ${channel}: ${upstream.status}`);
      return res.status(503).send('Stream unavailable');
    }
    const body = await upstream.text();
    console.log(`/stream.m3u8: proxied playlist for ${channel}`);
    res.setHeader('Content-Type', 'application/x-mpegURL');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(body);
  } catch (err) {
    console.error(`/stream.m3u8 error for ${channel}:`, err.message);
    res.status(503).send('Stream unavailable');
  }
});

app.get('/get-stream', async (req, res) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).json({ error: 'Missing channel' });

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
