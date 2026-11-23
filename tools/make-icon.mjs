// Draws the app icon (2×2 grid of session dots on a dark rounded square) and writes it as PNG.
// Usage: node tools/make-icon.mjs resources/icon.png
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const SIZE = 256;
const out = process.argv[2];
if (!out) throw new Error('usage: make-icon.mjs <out.png>');

const BG = [27, 30, 36];
const DOTS = [
  { cx: 92, cy: 92, rgb: [232, 140, 92] },
  { cx: 164, cy: 92, rgb: [111, 168, 245] },
  { cx: 92, cy: 164, rgb: [122, 207, 140] },
  { cx: 164, cy: 164, rgb: [196, 140, 240] },
];

/** Signed distance to a rounded square centred in the canvas. */
function roundedSquare(x, y, half, radius) {
  const dx = Math.abs(x - SIZE / 2) - (half - radius);
  const dy = Math.abs(y - SIZE / 2) - (half - radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}

const coverage = (distance) => Math.min(1, Math.max(0, 0.5 - distance));

const pixels = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1);
  pixels[row] = 0; // PNG filter: none
  for (let x = 0; x < SIZE; x++) {
    const px = x + 0.5;
    const py = y + 0.5;
    let rgb = BG;
    let alpha = coverage(roundedSquare(px, py, 120, 48));
    for (const dot of DOTS) {
      const a = coverage(Math.hypot(px - dot.cx, py - dot.cy) - 28);
      if (a > 0) rgb = rgb.map((c, i) => Math.round(c * (1 - a) + dot.rgb[i] * a));
    }
    const o = row + 1 + x * 4;
    pixels[o] = rgb[0];
    pixels[o + 1] = rgb[1];
    pixels[o + 2] = rgb[2];
    pixels[o + 3] = Math.round(alpha * 255);
  }
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA
writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
console.log(`wrote ${out}`);
