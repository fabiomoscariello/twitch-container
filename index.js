const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Read secrets from environment
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_SECRET = process.env.TWITCH_SECRET || '';

if (!TWITCH_CLIENT_ID || !TWITCH_SECRET) {
  console.warn('⚠️ TWITCH_CLIENT_ID or TWITCH_SECRET is not set. Twitch API calls may fail.');
  return res.status(500).json({ error: 'No TWITCH_CLIENT_ID or TWITCH_SECRET' });
}

app.use(cors());

app.get('/get-stream', async (req, res) => {
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

app.get('/', (req, res) => {
  res.send('Twitch Live M3U8 Extractor API is running ✅');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
