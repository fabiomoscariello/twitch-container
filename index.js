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

app.get('/get-stream', (req, res) => {
  const { channel } = req.query;

  if (!channel) {
    return res.status(400).json({ error: 'Missing channel parameter' });
  }

  console.log(`Fetching m3u8 stream for Twitch channel: ${channel}`);

  exec(`yt-dlp -g https://www.twitch.tv/${channel}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`yt-dlp error: ${stderr}`);
      return res.status(500).json({ error: 'Failed to extract stream URL' });
    }

    const streamUrl = stdout.trim();
    if (streamUrl.startsWith('http')) {
      return res.json({ stream_url: streamUrl });
    } else {
      return res.status(404).json({ error: 'No stream found or channel offline' });
    }
  });
});

app.get('/proxy-stream', (req, res, next) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).json({ error: 'Missing channel parameter' });

  exec(`yt-dlp -g https://www.twitch.tv/${channel}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`yt-dlp error: ${stderr}`);
      return res.status(500).json({ error: 'Failed to extract stream URL' });
    }

    const streamUrl = stdout.trim();
    if (!streamUrl.startsWith('http')) {
      return res.status(404).json({ error: 'Stream not found or offline' });
    }

    const parsed = new URL(streamUrl);
    const proxy = createProxyMiddleware({
      target: `${parsed.protocol}//${parsed.hostname}`,
      changeOrigin: true,
      pathRewrite: () => parsed.pathname + parsed.search,
      onProxyReq: (proxyReq) => {
        proxyReq.setHeader("Referer", "https://www.twitch.tv/");
        proxyReq.setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
        proxyReq.setHeader("Origin", "https://www.twitch.tv");
      }
    });

    proxy(req, res, next);
  });
});

app.get('/', (req, res) => {
  res.send('Twitch Live M3U8 Extractor API is running ✅');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
