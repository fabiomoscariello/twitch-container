
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const { URL } = require('url');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_SECRET = process.env.TWITCH_SECRET || '';

if (!TWITCH_CLIENT_ID || !TWITCH_SECRET) {
  console.warn('⚠️ TWITCH_CLIENT_ID or TWITCH_SECRET is not set. Twitch API calls may fail.');
}

app.use(cors());

const streamCache = new Map();

const CACHE_TTL_MS = 4 * 60 * 1000; // Twitch CDN URLs expire after a few minutes

function updateStreamUrl(channel, callback) {
  console.log(`🔍 Attempting to update stream URL for channel: ${channel}`);
  exec(`yt-dlp -g https://www.twitch.tv/${channel}`, (err, stdout, stderr) => {
    if (!err && stdout.trim()) {
      const streamUrl = stdout.trim();
      const parsed = new URL(streamUrl);
      streamCache.set(channel, { streamUrl, parsed, cachedAt: Date.now() });
      console.log(`✅ Stream URL updated for ${channel}. URL: ${streamUrl.substring(0, 50)}...`);
      callback(null, { streamUrl, parsed });
    } else {
      console.warn(`⚠️ Failed to update stream for ${channel}`);
      if (stderr) console.error(stderr);
      callback(err || new Error("No stream"), null);
    }
  });
}

app.get('/get-stream', (req, res) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).json({ error: 'Missing channel' });

  console.log(`➡️ /get-stream: Request for channel ${channel}. Calling updateStreamUrl.`);
  updateStreamUrl(channel, (err, data) => {
    if (err) return res.status(503).json({ error: 'Stream not available' });
    console.log(`⬅️ /get-stream: Responding for channel ${channel}.`);
    return res.json({ stream_url: data.streamUrl });
  });
});

app.get('/stream.m3u8', (req, res) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).send("Missing channel");

  const cached = streamCache.get(channel);

  const redirect = ({ streamUrl }) => {
    console.log(`⬅️ /stream.m3u8: Redirecting ${channel} to CDN URL.`);
    res.redirect(302, streamUrl);
  };

  const isExpired = cached && (Date.now() - cached.cachedAt) > CACHE_TTL_MS;

  if (cached && !isExpired) {
    console.log(`➡️ /stream.m3u8: Request for channel ${channel}. Using cached stream URL.`);
    redirect(cached);
  } else {
    console.log(`➡️ /stream.m3u8: Request for channel ${channel}. Cache miss, calling updateStreamUrl.`);
    updateStreamUrl(channel, (err, data) => {
      if (err) return res.status(503).send("Stream unavailable");
      redirect(data);
    });
  }
});


app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/', (_req, res) => {
  res.send('Twitch Proxy is live');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Keep-alive: prevents Render free tier spin-down after 15 min of inactivity
if (process.env.RENDER_EXTERNAL_HOSTNAME) {
  const selfUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/health`;
  setInterval(async () => {
    try {
      await fetch(selfUrl, { signal: AbortSignal.timeout(5000) });
    } catch (err) {
      console.warn('Keep-alive ping failed:', err.message);
    }
  }, 13 * 60 * 1000);
}
