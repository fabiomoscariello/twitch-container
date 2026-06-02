
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

app.get('/stream.m3u8', async (req, res) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).send('Missing channel');
  if (!/^[a-zA-Z0-9_]{1,25}$/.test(channel)) return res.status(400).send('Invalid channel');

  try {
    const url = await resolveStreamUrl(channel);
    console.log(`/stream.m3u8: redirect for ${channel}`);
    res.redirect(302, url);
  } catch (err) {
    console.error(`/stream.m3u8 error for ${channel}:`, err.message);
    res.status(503).send('Stream unavailable');
  }
});

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
