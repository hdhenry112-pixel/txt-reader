// 备份大小估算（spec 3.2「备份与恢复」：超过 100MB 先警告）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateBytes, formatSize, SIZE_WARN_BYTES } from '../../js/backup.js';

test('警告线是 100MB', () => {
  assert.equal(SIZE_WARN_BYTES, 100 * 1024 * 1024);
});

test('不含正文：大小和正文字数无关，只和书的本数、章数有关', () => {
  const small = estimateBytes([{ totalLen: 1000, chapterCount: 10 }], false);
  const huge = estimateBytes([{ totalLen: 50_000_000, chapterCount: 10 }], false);
  assert.equal(small, huge);
  assert.equal(small, 500 + 600 + 10 * 60); // 1700
});

test('含正文：每个字按 3 字节算', () => {
  const without = estimateBytes([{ totalLen: 8_000_000, chapterCount: 2000 }], false);
  const withText = estimateBytes([{ totalLen: 8_000_000, chapterCount: 2000 }], true);
  assert.equal(withText - without, 24_000_000);
});

test('F4（800 万字）含正文约 23MB，不到警告线；5 本这样的书超过警告线', () => {
  const f4 = { totalLen: 8_000_000, chapterCount: 2000 };
  assert.ok(estimateBytes([f4], true) < SIZE_WARN_BYTES);
  assert.ok(estimateBytes([f4, f4, f4, f4, f4], true) > SIZE_WARN_BYTES);
});

test('大小的写法：不到 1MB 写 KB，否则写一位小数的 MB', () => {
  assert.equal(formatSize(1700), '2 KB');
  assert.equal(formatSize(100), '1 KB');
  assert.equal(formatSize(1024 * 1024), '1.0 MB');
  assert.equal(formatSize(24_121_100), '23.0 MB');
});
