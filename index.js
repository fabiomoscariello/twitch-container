
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

app.use(cors());

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

app.get('/get-stream', (req, res) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).json({ error: 'Missing channel' });

  updateStreamUrl(channel, (err, data) => {
    if (err) return res.status(503).json({ error: 'Stream not available' });
    return res.json({ stream_url: data.streamUrl });
  });
});

app.get('/stream.m3u8', (req, res) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).send("Missing channel");

  const cached = streamCache.get(channel);

  const handleProxy = ({ streamUrl, parsed }) => {
    const https = require('https');
    https.get(streamUrl, {
      headers: {
        "Referer": "https://www.twitch.tv/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Origin": "https://www.twitch.tv"
      }
    }, (response) => {
      if (response.statusCode !== 200) {
        return res.status(502).send("Failed to fetch m3u8");
      }

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");

      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        const rewritten = body.replace(/(https?:\/\/[^\n]+\.ts)/g, match => {
          const path = new URL(match).pathname;
          return `/stream-proxy/${channel}${path}`;
        });
        res.send(rewritten);
      });
    }).on('error', (e) => {
      console.error("Fetch error:", e.message);
      res.status(502).send("Error fetching m3u8");
    });
  };

  if (cached) {
    handleProxy(cached);
  } else {
    updateStreamUrl(channel, (err, data) => {
      if (err) return res.status(503).send("Stream unavailable");
      handleProxy(data);
    });
  }
});

app.use('/stream-proxy/:channel/*', (req, res, next) => {
  const channel = req.params.channel;
  const cached = streamCache.get(channel);

  if (!cached) return res.status(503).send("Stream not cached");

  const { parsed } = cached;
  const originalPath = req.originalUrl.replace(`/stream-proxy/${channel}`, '');

  const proxy = createProxyMiddleware({
    target: `${parsed.protocol}//${parsed.hostname}`,
    changeOrigin: true,
    pathRewrite: () => originalPath,
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader("Referer", "https://www.twitch.tv/");
      proxyReq.setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
      proxyReq.setHeader("Origin", "https://www.twitch.tv");
    },
    onError: (err, req, res) => {
      console.error("❌ TS segment proxy error:", err.message);
      res.status(502).send("Segment proxy failure");
    }
  });

  proxy(req, res, next);
});

app.get('/', (req, res) => {
  res.send('✅ Twitch Stream Proxy is running with .ts segment support');
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
