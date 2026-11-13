// 生成 App 图标（PNG）。不依赖任何图像库：逐像素画，再用 zlib 压成 PNG。
// 用法：node tests/gen-icons.mjs    产物写到 icons/
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MAIN = [0x5e, 0x8f, 0x8a];   // 主色，背景
const PAPER = [0xf2, 0xf1, 0xec];  // 书页
const SUB = [0x73, 0x80, 0x90];    // 辅色，文字行
const STRONG = [0xd9, 0x77, 0x57]; // 强调色，书签

/** 返回 (x, y) 处的颜色。x、y 是 0–1 的比例坐标。 */
function colorAt(x, y) {
  const inRect = (x0, y0, x1, y1) => x >= x0 && x < x1 && y >= y0 && y < y1;
  // 书签：右上角垂下的一条，底部有三角缺口
  if (inRect(0.58, 0.2, 0.68, 0.5)) {
    const notch = 0.5 - (0.05 - Math.abs(x - 0.63)) * 0.8;
    if (y < notch) return STRONG;
  }
  // 文字行
  for (const top of [0.56, 0.64, 0.72]) {
    if (inRect(0.34, top, top === 0.72 ? 0.56 : 0.66, top + 0.03)) return SUB;
  }
  // 书页
  if (inRect(0.26, 0.2, 0.74, 0.82)) return PAPER;
  return MAIN;
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const raw = Buffer.alloc(size * (1 + size * 3));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // 每行的滤波类型：无
    for (let x = 0; x < size; x++) {
      const [r, g, b] = colorAt((x + 0.5) / size, (y + 0.5) / size);
      raw[p++] = r; raw[p++] = g; raw[p++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // 位深
  ihdr[9] = 2;  // 颜色类型：RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(join(ROOT, 'icons'), { recursive: true });
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync(join(ROOT, 'icons', name), png(size));
  console.log(`icons/${name}  ${size}x${size}`);
}
