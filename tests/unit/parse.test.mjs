// spec ④「分章和解码」的锚点，在纯函数层面验证。
// 期望值全部来自 spec 里的手算结果和 gen-fixtures.mjs 里的原文，不来自被测代码的输出。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILES, FIXTURE_DIR, para } from '../gen-fixtures.mjs';
import { parseBook, ImportError, titleFromFileName } from '../../js/importer/parse.js';
import { isTitle } from '../../js/chapterizer.js';
import { toParagraphs } from '../../js/normalize.js';
import { decodeBytes } from '../../js/importer/decode.js';

const parse = (file, forced) => parseBook(new Uint8Array(readFileSync(join(FIXTURE_DIR, FILES[file].name))), forced);
const titles = (book) => book.chapters.map((c) => c.title);
const lens = (book) => book.chapters.map((c) => c.len);

test('A1 F1：目录 11 项，第 1 项是「前言」', () => {
  const book = parse('F1');
  assert.equal(book.chapters.length, 11);
  assert.deepEqual(titles(book), [
    '前言', '序章 风起', '第一章 起点', '第二章　远行', '第3章 归来', '第十回 夜谈',
    '第一百零一节 转折', '第二卷 新的旅程', 'Chapter 8 Dawn', '楔子', '番外 多年以后',
  ]);
});

test('A2 F1：各章字数 200, 1000, …, 10000，全书 55200', () => {
  const book = parse('F1');
  assert.deepEqual(lens(book), [200, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]);
  assert.equal(book.totalLen, 55200);
});

test('A3 F1：去掉 BOM、空行、缩进空格后，段落与原文逐字相等', () => {
  const book = parse('F1');
  assert.equal(book.encoding, 'utf-8');
  // 目录第 3 项是「第二章　远行」，在文件里是第 3 个标题。
  assert.equal(book.chapters[3].paras[0], para('F1', 3, 1));
  assert.equal(book.chapters[3].paras[29], para('F1', 3, 30));
  // 文件开头（BOM 之后）的第一段。
  assert.equal(book.chapters[0].paras[0], para('F1', 0, 1));
  for (const c of book.chapters) {
    for (const p of c.paras) {
      assert.equal(p.length, 100);
      assert.equal(p, p.trim());
    }
  }
});

test('A4 F2（GBK）：目录 5 项，2500 字，含「镕」的段落逐字相等，不标记可疑', () => {
  const book = parse('F2');
  assert.equal(book.encoding, 'gbk');
  assert.equal(book.encodingSuspect, false);
  assert.deepEqual(titles(book), ['第一章', '第二章', '第三章', '第四章', '第五章']);
  assert.equal(book.totalLen, 2500);
  assert.equal(book.chapters[0].paras[0], para('F2', 1, 1));
  assert.ok(book.chapters[0].paras[0].includes('镕'));
});

test('A5 F3（无标题）：5 项，每项 5000 字', () => {
  const book = parse('F3');
  assert.deepEqual(titles(book), ['第 1 段', '第 2 段', '第 3 段', '第 4 段', '第 5 段']);
  assert.deepEqual(lens(book), [5000, 5000, 5000, 5000, 5000]);
  // 切分没有丢段或重复：第 2 段的第一段是全文第 51 段。
  assert.equal(book.chapters[1].paras[0], para('F3', 0, 51));
});

test('A6 F5：3 个假标题都不算，目录正好 3 项', () => {
  const book = parse('F5');
  assert.deepEqual(titles(book), ['第一章 真标题', '第二章 真标题', '第三章 真标题']);
  // 假标题行留在正文里，没有被吞掉：每章 3 段 + 1 行假标题。
  assert.deepEqual(book.chapters.map((c) => c.paras.length), [4, 4, 4]);
});

test('A7 F6：35000 字的章切成 7 块，30000 字的章不切', () => {
  const book = parse('F6');
  assert.deepEqual(titles(book), [
    '第一章 (1/7)', '第一章 (2/7)', '第一章 (3/7)', '第一章 (4/7)',
    '第一章 (5/7)', '第一章 (6/7)', '第一章 (7/7)', '第二章',
  ]);
  assert.deepEqual(lens(book), [5000, 5000, 5000, 5000, 5000, 5000, 5000, 30000]);
  assert.equal(book.chapters[1].paras[0], para('F6', 1, 51));
});

test('A8 F7 / F8（UTF-16 带 BOM）：各 2 项，第 1 段逐字相等', () => {
  for (const [file, encoding] of [['F7', 'utf-16le'], ['F8', 'utf-16be']]) {
    const book = parse(file);
    assert.equal(book.encoding, encoding);
    assert.deepEqual(titles(book), ['第一章', '第二章']);
    assert.equal(book.chapters[0].paras[0], para(file, 1, 1));
  }
});

test('A10（纯函数部分）F9：自动判断得不到原文，手动指定 Big5 后逐字相等', () => {
  const auto = parse('F9');
  const autoFirst = auto.chapters[0]?.paras[0];
  assert.ok(autoFirst !== para('F9', 1, 1) || auto.encodingSuspect);
  const forced = parse('F9', 'big5');
  assert.deepEqual(titles(forced), ['第一章', '第二章']);
  assert.equal(forced.chapters[0].paras[0], para('F9', 1, 1));
});

test('B1 F3b：51 段 → 5000 字 + 100 字', () => {
  const book = parse('F3b');
  assert.deepEqual(lens(book), [5000, 100]);
});

test('B2 空文件：报「文件是空的」', () => {
  assert.throws(() => parse('B2'), (err) => err instanceof ImportError && err.message === '文件是空的');
});

test('B3 只有 1 段：目录 1 项「第 1 段」，100 字', () => {
  const book = parse('B3');
  assert.deepEqual(titles(book), ['第 1 段']);
  assert.deepEqual(lens(book), [100]);
});

test('只有空白的文件：报「文件里没有文字」', () => {
  const bytes = new TextEncoder().encode(' \n　　\r\n\n');
  assert.throws(() => parseBook(bytes), (err) => err instanceof ImportError && err.message === '文件里没有文字');
});

test('标题判定的三个条件各自生效', () => {
  assert.equal(isTitle('第一章 起点'), true);
  assert.equal(isTitle('第１２章'), true);
  assert.equal(isTitle('CHAPTER 12'), true);
  assert.equal(isTitle('后记'), true);
  // 正好 30 个字算标题，31 个字不算。
  assert.equal(isTitle('第一章' + '字'.repeat(27)), true);
  assert.equal(isTitle('第一章' + '字'.repeat(28)), false);
  // 以句读结尾的不算。
  assert.equal(isTitle('第二章写完了。'), false);
  assert.equal(isTitle('第二章写完了，'), false);
  // 以问号、叹号结尾的仍然算（标题里常见）。
  assert.equal(isTitle('第五章 你是谁？'), true);
  // 不在行首的不算；「第」后面不是数字的不算。
  assert.equal(isTitle('他翻到第三章 往下读'), false);
  assert.equal(isTitle('第一次见面'), false);
});

test('标题后面紧跟另一个标题：前一个成为 0 字的章，不丢失', () => {
  const book = parseBook(new TextEncoder().encode('第一卷\n第一章\n正文一段\n'));
  assert.deepEqual(titles(book), ['第一卷', '第一章']);
  assert.deepEqual(lens(book), [0, 4]);
});

test('无法识别的字节：按 GBK 宽松解码并标记可疑', () => {
  // 0xFF 在 UTF-8 和 GBK 里都不合法。
  const result = decodeBytes(Uint8Array.of(0x61, 0xff, 0x62));
  assert.equal(result.encoding, 'gbk');
  assert.equal(result.suspect, true);
});

test('段落整理：处理 \\r\\n、单独的 \\r、全角空格', () => {
  assert.deepEqual(toParagraphs('　　甲 \r\n\r\n乙\r丙\n 　 \n'), ['甲', '乙', '丙']);
});

test('书名去掉 .txt 后缀（不分大小写）', () => {
  assert.equal(titleFromFileName('三体.txt'), '三体');
  assert.equal(titleFromFileName('Book.TXT'), 'Book');
  assert.equal(titleFromFileName('没有后缀'), '没有后缀');
});
