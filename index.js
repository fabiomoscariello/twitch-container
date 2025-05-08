const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { URL } = require('url');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_SECRET = process.env.TWITCH_SECRET || '';

if (!TWITCH_CLIENT_ID || !TWITCH_SECRET) {
  console.warn('⚠️ TWITCH_CLIENT_ID or TWITCH_SECRET is not set. Twitch API calls may fail.');
}

// CORS
app.use(cors());

// Store cache per canale
const streamCache = new Map();

function updateStreamUrl(channel, callback) {
  exec(`yt-dlp -g https://www.twitch.tv/${channel}`, (err, stdout, stderr) => {
    if (!err && stdout.trim()) {
      const streamUrl = stdout.trim();
      const parsed = new URL(streamUrl);
      streamCache.set(channel, { streamUrl, parsed });
      console.log(`✅ Stream URL updated for ${channel}`);
      callback(null, { streamUrl, parsed });
    } else {
      console.warn(`⚠️ Failed to update stream for ${channel}`);
      if (stderr) console.error(stderr);
      callback(err || new Error("No stream"), null);
    }
  });
}

// Optional debug endpoint
app.get('/get-stream', (req, res) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).json({ error: 'Missing channel' });

  updateStreamUrl(channel, (err, data) => {
    if (err) return res.status(503).json({ error: 'Stream not available' });
    return res.json({ stream_url: data.streamUrl });
  });
});

// Proxy endpoint
app.use('/stream.m3u8', (req, res, next) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).send("Missing channel");

  const cached = streamCache.get(channel);

  const useProxy = (streamUrl, parsed) => {
    const proxy = createProxyMiddleware({
      target: `${parsed.protocol}//${parsed.hostname}`,
      changeOrigin: true,
      pathRewrite: () => parsed.pathname + parsed.search,
      onProxyReq: (proxyReq) => {
        proxyReq.setHeader("Referer", "https://www.twitch.tv/");
        proxyReq.setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
        proxyReq.setHeader("Origin", "https://www.twitch.tv");
      },
      onError: (err, req, res) => {
        console.error("❌ Proxy error:", err.message);
        res.status(502).send("Proxy failure");
      }
    });

    proxy(req, res, next);
  };

  if (cached && cached.streamUrl && cached.parsed) {
    useProxy(cached.streamUrl, cached.parsed);
  } else {
    updateStreamUrl(channel, (err, data) => {
      if (err) return res.status(503).send("Stream unavailable");
      useProxy(data.streamUrl, data.parsed);
    });
  }
});

// Root
app.get('/', (req, res) => {
  res.send('✅ Twitch Stream Proxy is running (dynamic channel)');
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
