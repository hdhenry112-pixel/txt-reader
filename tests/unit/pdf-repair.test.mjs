// C8：修复字符对照表错误的 PDF。pdf-crypto.js、pdf-fonts.js、pdf-repair.js。
// 测试文件 P8 / P9 由 tests/gen-broken-pdf.mjs 用独立的实现弄坏（不用 App 的代码），见 docs/spec-m5.md。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { md5, rc4 } from '../../js/importer/pdf-crypto.js';
import { parseToUnicode, compareMaps, writeToUnicode, MAX_MISMATCH_RATIO, MIN_MISMATCHES } from '../../js/importer/pdf-fonts.js';
import { repairPdf } from '../../js/importer/pdf-repair.js';
import { PDF_FILES, OTHER_FILES, pdfPath } from '../gen-pdf-fixtures.mjs';

const hex = (b) => Buffer.from(b).toString('hex');
const enc = (s) => new TextEncoder().encode(s);

test('MD5：RFC 1321 的测试向量；长输入和 Node 自带的一致', () => {
  const vectors = {
    '': 'd41d8cd98f00b204e9800998ecf8427e',
    abc: '900150983cd24fb0d6963f7d28e17f72',
    'message digest': 'f96b697d7cb7938d525a2f31aaf161d0',
    '12345678901234567890123456789012345678901234567890123456789012345678901234567890': '57edf4a22be3c955ac49da2e2107b67a',
  };
  for (const [input, want] of Object.entries(vectors)) assert.equal(hex(md5(enc(input))), want, input);
  // 跨过 55 / 56 / 64 字节这几个补齐边界
  for (const len of [55, 56, 63, 64, 65, 1000]) {
    const data = new Uint8Array(len).map((_, i) => i * 7);
    assert.equal(hex(md5(data)), createHash('md5').update(data).digest('hex'), `${len} 字节`);
  }
});

test('RC4：公开测试向量；加密两次还原', () => {
  assert.equal(hex(rc4(enc('Key'), enc('Plaintext'))), 'bbf316e8d940af0ad3');
  assert.equal(hex(rc4(enc('Wiki'), enc('pedia'))), '1021bf0420');
  const data = enc('任意内容 123');
  assert.deepEqual(rc4(enc('k'), rc4(enc('k'), data)), data);
});

test('ToUnicode 解析：bfchar、单目标 bfrange、数组目标 bfrange', () => {
  const map = parseToUnicode(`
    2 beginbfchar
    <0003> <4E2D>
    <0004> <56FD>
    endbfchar
    2 beginbfrange
    <0010> <0012> <0041>
    <0020> <0021> [<7EA2> <8272>]
    endbfrange`);
  assert.deepEqual([...map], [[3, '中'], [4, '国'], [0x10, 'A'], [0x11, 'B'], [0x12, 'C'], [0x20, '红'], [0x21, '色']]);
});

/** n 个字形，前 bad 个的 ToUnicode 写错（字形 g 对应「一」+ g，写错的写成「乙」+ g）。 */
function maps(n, bad) {
  const tu = new Map();
  const rev = new Map();
  for (let g = 1; g <= n; g++) {
    rev.set(g, [0x4E00 + g]);
    tu.set(g, String.fromCodePoint((g <= bad ? 0x4E59 : 0x4E00) + g));
  }
  return { tu, rev };
}

test(`判定坏表：不一致不少于 ${MIN_MISMATCHES} 条且超过 ${MAX_MISMATCH_RATIO * 100}% 才算坏`, () => {
  assert.equal(MIN_MISMATCHES, 20);
  assert.equal(MAX_MISMATCH_RATIO, 0.1);
  const id = (c) => c;
  // 100 条里错 19 条：比例够了但条数不够
  assert.equal(compareMaps(...Object.values(maps(100, 19)), id).broken, false);
  assert.equal(compareMaps(...Object.values(maps(100, 20)), id).broken, true);
  // 1000 条里错 100 条（正好 10%）不算；错 101 条算
  assert.equal(compareMaps(...Object.values(maps(1000, 100)), id).broken, false);
  assert.equal(compareMaps(...Object.values(maps(1000, 101)), id).broken, true);
});

test('修正：错的条目换成字体自己的表；一个字形对应多个字符时选常用汉字区的', () => {
  const { tu, rev } = maps(30, 30);
  rev.set(5, [0x2F00, 0x4E00 + 5]); // 字形 5 同时登记成部首字符和常用汉字
  const { fixed } = compareMaps(tu, rev, (c) => c);
  for (let g = 1; g <= 30; g++) assert.equal(fixed.get(g), String.fromCodePoint(0x4E00 + g), `字形 ${g}`);
});

test('写出来的 ToUnicode 能被读回去（含扩展区的字）', () => {
  const map = new Map([[1, '中'], [2, '𠀀'], [300, 'fi']]);
  assert.deepEqual([...parseToUnicode(writeToUnicode(map))], [...map]);
});

test('W3：正常的 PDF（P1–P7、P10、G11）原样返回，一个字节都不改', async () => {
  for (const key of [...Object.keys(PDF_FILES), 'P7']) {
    const bytes = new Uint8Array(readFileSync(pdfPath(key)));
    const result = await repairPdf(bytes);
    assert.equal(result.bytes, bytes, `${key} 不是原样返回`);
    assert.deepEqual(result.fonts, [], key);
  }
});

test('P8、P9：找到正文字体，76 条全错并修复；修复结果是在原文件后面追加，原来的字节不变', async () => {
  for (const key of ['P8', 'P9']) {
    const bytes = new Uint8Array(readFileSync(pdfPath(key)));
    const { bytes: fixed, fonts } = await repairPdf(bytes);
    assert.deepEqual(fonts.map((f) => [f.name, f.compared, f.mismatches]), [['/BAAAAA+MicrosoftYaHei', 76, 76]], key);
    assert.ok(fixed.length > bytes.length);
    assert.deepEqual(fixed.subarray(0, bytes.length), bytes, `${key} 原来的部分被改了`);
  }
  assert.ok(OTHER_FILES.P9.includes('加密'));
});

test('不是 PDF、空文件：原样返回，不报错', async () => {
  for (const bytes of [new Uint8Array(0), enc('这是一个文本文件'), enc('%PDF-1.4\n乱写的内容')]) {
    const result = await repairPdf(bytes);
    assert.equal(result.bytes, bytes);
  }
});
