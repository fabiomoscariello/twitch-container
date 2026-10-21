// Controllo minimo della riscrittura della playlist: e' il cuore del proxy, perche'
// i device in Italia non raggiungono i server HLS di Twitch e ogni URI deve passare
// da noi. Si lancia con: node test-rewrite.js
const assert = require('assert');
const { rewriteM3u8 } = require('./index.js');

const source = [
  '#EXTM3U',
  '#EXT-X-MAP:URI="init.mp4"',
  '#EXTINF:2.0,',
  'segment-1.ts',
  '#EXTINF:2.0,',
  'https://video-weaver.mil01.hls.ttvnw.net/v1/segment-2.ts',
].join('\n');

const out = rewriteM3u8(
  source,
  'https://video-weaver.mil01.hls.ttvnw.net/v1/playlist/abc.m3u8',
  'https://proxy.example.com',
).split('\n');

// I commenti restano, gli URI (relativi e assoluti) passano tutti dal proxy
assert.strictEqual(out[0], '#EXTM3U');
assert.ok(out[1].startsWith('#EXT-X-MAP:URI="https://proxy.example.com/cdn-proxy?url='));
assert.ok(out[1].includes(encodeURIComponent('https://video-weaver.mil01.hls.ttvnw.net/v1/playlist/init.mp4')));
assert.ok(out[3].startsWith('https://proxy.example.com/cdn-proxy?url='));
assert.ok(out[3].includes(encodeURIComponent('https://video-weaver.mil01.hls.ttvnw.net/v1/playlist/segment-1.ts')));
assert.ok(out[5].includes(encodeURIComponent('https://video-weaver.mil01.hls.ttvnw.net/v1/segment-2.ts')));

console.log('rewriteM3u8 ok');
