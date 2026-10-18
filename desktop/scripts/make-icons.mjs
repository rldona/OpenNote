// Generates the app icons without any image library: a green rounded square with three white bars.
//   build/icon.png      full-bleed square, for Windows and Linux (electron-builder makes the .ico from it)
//   build/icon-mac.png  the artwork at 80% of the canvas with a soft shadow, as macOS expects, so it does not look
//                       oversized next to other icons in the Dock (electron-builder makes the .icns from it)
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 1024;
const bg = [0, 168, 45];
const fg = [255, 255, 255];

const rrDist = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const cover = (d) => Math.min(1, Math.max(0, 0.5 - d)); // 1px anti-aliased edge

const bars = [
  [512, 328, 205, 41], // cx, cy, half-width, half-height
  [512, 512, 205, 41],
  [410, 696, 103, 41],
];

/** scale: size of the artwork relative to the canvas; shadow: draw the macOS-style drop shadow. */
function render(scale, shadow) {
  const half = (N / 2) * scale;
  const radius = 224 * scale;
  const raw = Buffer.alloc(N * (N * 4 + 1));
  for (let y = 0; y < N; y++) {
    raw[y * (N * 4 + 1)] = 0;
    for (let x = 0; x < N; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const a = cover(rrDist(px, py, N / 2, N / 2, half, half, radius));
      let t = 0;
      for (const [cx, cy, hw, hh] of bars) {
        t = Math.max(t, cover(rrDist(px, py, N / 2 + (cx - 512) * scale, N / 2 + (cy - 512) * scale, hw * scale, hh * scale, 24 * scale)));
      }
      const o = y * (N * 4 + 1) + 1 + x * 4;
      let r = bg[0] * (1 - t) + fg[0] * t;
      let g = bg[1] * (1 - t) + fg[1] * t;
      let b = bg[2] * (1 - t) + fg[2] * t;
      let alpha = a;
      if (shadow && a < 1) {
        // soft shadow: a blurred copy of the shape, nudged down, painted underneath
        const d = rrDist(px, py, N / 2, N / 2 + 14, half, half, radius);
        const s = 0.38 * Math.pow(Math.min(1, Math.max(0, 1 - d / 34)), 2);
        const outA = a + s * (1 - a);
        r = outA ? (r * a) / outA : 0;
        g = outA ? (g * a) / outA : 0;
        b = outA ? (b * a) / outA : 0;
        alpha = outA;
      }
      raw[o] = Math.round(r);
      raw[o + 1] = Math.round(g);
      raw[o + 2] = Math.round(b);
      raw[o + 3] = Math.round(alpha * 255);
    }
  }
  return raw;
}

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
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA

const png = (raw) =>
  Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);

mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
writeFileSync(new URL('../build/icon.png', import.meta.url), png(render(1, false)));
writeFileSync(new URL('../build/icon-mac.png', import.meta.url), png(render(824 / 1024, true)));
console.log('wrote build/icon.png and build/icon-mac.png');
