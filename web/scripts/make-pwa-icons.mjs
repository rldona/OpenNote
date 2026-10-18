// Generates the PWA icons (public/icons) without any image library, same artwork as the desktop icon.
// Maskable icons are full-bleed squares: the OS applies its own mask.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';


const bg = [0, 168, 45];
const fg = [255, 255, 255];

const rrDist = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const cover = (d) => Math.min(1, Math.max(0, 0.5 - d));

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function icon(N, maskable) {
  const k = N / 1024;
  // Maskable: bars sit inside the central 80% "safe zone".
  const s = maskable ? 0.8 : 1;
  const bars = [[512, 328, 205, 41], [512, 512, 205, 41], [410, 696, 103, 41]].map(([cx, cy, hw, hh]) => [
    (512 + (cx - 512) * s) * k, (512 + (cy - 512) * s) * k, hw * s * k, hh * s * k,
  ]);
  const raw = Buffer.alloc(N * (N * 4 + 1));
  for (let y = 0; y < N; y++) {
    raw[y * (N * 4 + 1)] = 0;
    for (let x = 0; x < N; x++) {
      const a = maskable ? 1 : cover(rrDist(x + 0.5, y + 0.5, N / 2, N / 2, N / 2, N / 2, 224 * k));
      let t = 0;
      for (const [cx, cy, hw, hh] of bars) t = Math.max(t, cover(rrDist(x + 0.5, y + 0.5, cx, cy, hw, hh, 24 * s * k)));
      const o = y * (N * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(bg[c] * (1 - t) + fg[c] * t);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
  writeFileSync(new URL(name, out), icon(size, maskable));
  console.log('wrote public/icons/' + name);
}
