// 测试数据本身的自检：锚点是按「每段 100 字」手算的，测试数据不对，后面的锚点都没有意义。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FILES, FIXTURE_DIR, PARA_LEN, para } from '../gen-fixtures.mjs';

const read = (file) => readFileSync(join(FIXTURE_DIR, FILES[file].name));

test('每段正好 100 个字，且不同段的原文互不相同', () => {
  assert.equal(para('F1', 3, 12).length, PARA_LEN);
  assert.equal(para('F4', 2000, 40).length, PARA_LEN);
  assert.notEqual(para('F1', 3, 12), para('F1', 3, 13));
  assert.notEqual(para('F1', 3, 12), para('F1', 4, 12));
});

test('F1 的段落总数是 552（全书 55200 字）', () => {
  const paras = FILES.F1.chapters.reduce((sum, c) => sum + c.paras, 0);
  assert.equal(paras, 2 + 10 * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10));
  assert.equal(paras * PARA_LEN, 55200);
});

test('F1 以 UTF-8 BOM 开头', () => {
  assert.deepEqual([...read('F1').subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('F2 不是合法的 UTF-8，按 GBK 解码后含「镕」', () => {
  const bytes = read('F2');
  assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const text = new TextDecoder('gbk', { fatal: true }).decode(bytes);
  assert.ok(text.includes(para('F2', 1, 1)));
  assert.ok(text.includes('镕'));
});

test('F7 / F8 带 UTF-16 的 BOM', () => {
  assert.deepEqual([...read('F7').subarray(0, 2)], [0xff, 0xfe]);
  assert.deepEqual([...read('F8').subarray(0, 2)], [0xfe, 0xff]);
});

test('F9 按 Big5 解码能得到原文', () => {
  const text = new TextDecoder('big5', { fatal: true }).decode(read('F9'));
  assert.ok(text.includes(para('F9', 1, 1)));
});

test('F4 大于 20MB', () => {
  assert.ok(statSync(join(FIXTURE_DIR, FILES.F4.name)).size > 20 * 1024 * 1024);
});

test('B2 是 0 字节', () => {
  assert.equal(read('B2').length, 0);
});
