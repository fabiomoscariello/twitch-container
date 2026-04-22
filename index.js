
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
  console.log(`🔍 Attempting to update stream URL for channel: ${channel}`);
  exec(`yt-dlp -g https://www.twitch.tv/${channel}`, (err, stdout, stderr) => {
    if (!err && stdout.trim()) {
      const streamUrl = stdout.trim();
      const parsed = new URL(streamUrl);
      streamCache.set(channel, { streamUrl, parsed });
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

  const handleProxy = ({ streamUrl }) => {
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
        const rewritten = body.replace(/(https?:\/\/[^\n]+\.ts[^\n]*)/g, match => {
          return `/stream-segment/${channel}?url=${encodeURIComponent(match)}`;
        });
        res.send(rewritten);
      });
    }).on('error', (e) => {
      console.error("Fetch error:", e.message);
      res.status(502).send("Error fetching m3u8");
    });
  };

  if (cached) {
    console.log(`➡️ /stream.m3u8: Request for channel ${channel}. Using cached stream URL.`);
    handleProxy(cached);
  } else {
    console.log(`➡️ /stream.m3u8: Request for channel ${channel}. Cache miss, calling updateStreamUrl.`);
    updateStreamUrl(channel, (err, data) => {
      if (err) return res.status(503).send("Stream unavailable");
      console.log(`⬅️ /stream.m3u8: Responding for channel ${channel} after cache miss.`);
      handleProxy(data);
    });
  }
});

app.get('/stream-segment/:channel', (req, res, next) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).send("Missing segment URL");

  const targetUrl = new URL(rawUrl);
  const proxy = createProxyMiddleware({
    target: `${targetUrl.protocol}//${targetUrl.hostname}`,
    changeOrigin: true,
    pathRewrite: () => targetUrl.pathname + targetUrl.search,
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader("Referer", "https://www.twitch.tv/");
      proxyReq.setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
      proxyReq.setHeader("Origin", "https://www.twitch.tv");
    },
    onError: (err, req, res) => {
      console.error("❌ Segment proxy error:", err.message);
      res.status(502).send("Segment proxy failure");
    }
  });

  proxy(req, res, next);
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
