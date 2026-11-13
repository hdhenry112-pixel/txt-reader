// 生成测试数据（docs/spec-mvp.md 第 ④ 节的 F1–F9）。
// 全部是确定值，不用随机数，不含任何真实小说内容。
// 用法：node tests/gen-fixtures.mjs    产物写到 tests/fixtures/（不进仓库）
//
// 测试代码可以直接 import 这里的 para() 和 FILES，拿到每一段的期望原文。
import { mkdirSync, writeFileSync, statSync, openSync, writeSync, closeSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const PARA_LEN = 100;

// 补足段落用的固定文本。含全角标点。
const FILLER = {
  // 简体，全部字符在 GBK 内
  hans: '清晨的雾气还没有散去，石板路上留着昨夜的雨水；远处传来钟声，一下，又一下。他停住脚步，回头望了望来时的方向：“走吧，”她说，“天黑以前要赶到渡口。”',
  // 简体 + GBK 有而 GB2312 没有的字「镕」
  gbk: '镕字只在扩展区里才有，清晨的雾气还没有散去，石板路上留着昨夜的雨水；远处传来钟声，一下，又一下。他停住脚步，回头望了望来时的方向。',
  // 简体 + 带重音的拉丁字母 é + 带圈数字 ①
  utf8: 'café 的招牌下写着①号桌，清晨的雾气还没有散去，石板路上留着昨夜的雨水；远处传来钟声，一下，又一下。他停住脚步，回头望了望来时的方向。',
  // 繁体，全部字符在 Big5 内
  hant: '清晨的霧氣還沒有散去，石板路上留著昨夜的雨水；遠處傳來鐘聲，一下，又一下。他停住腳步，回頭望了望來時的方向。',
};

/**
 * 第 ch 章第 idx 段的原文，正好 PARA_LEN 个字。
 * ch 从 0 起（0 = 第一个标题之前的部分），idx 从 1 起。
 */
export function para(file, ch, idx, filler = FILES[file].filler) {
  const head = `【${file}-${ch}-${idx}】`;
  const text = FILLER[filler];
  let out = head;
  while (out.length < PARA_LEN) out += text;
  return out.slice(0, PARA_LEN);
}

const F1_TITLES = [
  '序章 风起', '第一章 起点', '第二章　远行', '第3章 归来', '第十回 夜谈',
  '第一百零一节 转折', '第二卷 新的旅程', 'Chapter 8 Dawn', '楔子', '番外 多年以后',
];

const F5_TRAPS = [
  '第一章的时候他还不知道后面会发生什么事情，更不知道这句话的长度已经超过三十个字。',
  '第二章写完了。',
  '他翻到第三章 往下读',
];

/**
 * 每个测试文件的结构。chapters 里每项是 { title, paras }；title 为 null 表示第一个标题之前的正文。
 * extraLines：插在指定章末尾的额外行（F5 的假标题）。
 */
export const FILES = {
  F1: {
    name: 'F1-utf8-bom.txt', encoding: 'utf8-bom', filler: 'utf8', eol: '\n', messy: true,
    chapters: [{ title: null, paras: 2 }, ...F1_TITLES.map((title, i) => ({ title, paras: (i + 1) * 10 }))],
  },
  F2: {
    name: 'F2-gbk.txt', encoding: 'gbk', filler: 'gbk', eol: '\r\n',
    chapters: ['第一章', '第二章', '第三章', '第四章', '第五章'].map((title) => ({ title, paras: 5 })),
  },
  F3: { name: 'F3-nochapter.txt', encoding: 'utf8', filler: 'hans', eol: '\n', chapters: [{ title: null, paras: 250 }] },
  F3b: { name: 'F3b-nochapter-51.txt', encoding: 'utf8', filler: 'hans', eol: '\n', chapters: [{ title: null, paras: 51 }] },
  F4: {
    name: 'F4-big.txt', encoding: 'utf8', filler: 'hans', eol: '\n',
    chapters: Array.from({ length: 2000 }, (_, i) => ({ title: `第${i + 1}章`, paras: 40 })),
  },
  F5: {
    name: 'F5-traps.txt', encoding: 'utf8', filler: 'hans', eol: '\n',
    chapters: [
      { title: '第一章 真标题', paras: 3, extraLines: [F5_TRAPS[0]] },
      { title: '第二章 真标题', paras: 3, extraLines: [F5_TRAPS[1]] },
      { title: '第三章 真标题', paras: 3, extraLines: [F5_TRAPS[2]] },
    ],
  },
  F6: {
    name: 'F6-oversize.txt', encoding: 'utf8', filler: 'hans', eol: '\n',
    chapters: [{ title: '第一章', paras: 350 }, { title: '第二章', paras: 300 }],
  },
  F7: {
    name: 'F7-utf16le.txt', encoding: 'utf16le-bom', filler: 'utf8', eol: '\r\n',
    chapters: [{ title: '第一章', paras: 2 }, { title: '第二章', paras: 2 }],
  },
  F8: {
    name: 'F8-utf16be.txt', encoding: 'utf16be-bom', filler: 'utf8', eol: '\n',
    chapters: [{ title: '第一章', paras: 2 }, { title: '第二章', paras: 2 }],
  },
  F9: {
    name: 'F9-big5.txt', encoding: 'big5', filler: 'hant', eol: '\r\n',
    chapters: [{ title: '第一章', paras: 2 }, { title: '第二章', paras: 2 }],
  },
  B2: { name: 'B2-empty.txt', encoding: 'utf8', filler: 'hans', eol: '\n', chapters: [] },
  B3: { name: 'B3-one-para.txt', encoding: 'utf8', filler: 'hans', eol: '\n', chapters: [{ title: null, paras: 1 }] },
};

/** 一章的全部文本行。messy 为真时夹杂空行、行首全角空格、行尾空格，用来测段落整理。 */
function* chapterLines(file, spec, ch, chapter) {
  if (chapter.title !== null) yield spec.messy ? `  ${chapter.title}  ` : chapter.title;
  for (let i = 1; i <= chapter.paras; i++) {
    const text = para(file, ch, i);
    if (spec.messy) {
      yield `　　${text}${i % 2 ? ' ' : ''}`;
      if (i % 3 === 0) yield '';
      if (i % 7 === 0) yield '　 ';
    } else {
      yield text;
    }
  }
  yield* chapter.extraLines ?? [];
}

function* fileLines(file) {
  const spec = FILES[file];
  // 文件里的章序号：有「标题前正文」时它是 0，否则第一个标题是 1。
  let ch = spec.chapters[0]?.title === null ? 0 : 1;
  for (const chapter of spec.chapters) yield* chapterLines(file, spec, ch++, chapter);
}

// ---------- 编码 ----------

/** 借助 TextDecoder 反推一张「字符 → 双字节」的表，用来把字符串编码成 GBK 或 Big5。 */
function buildDoubleByteTable(label) {
  const decoder = new TextDecoder(label, { fatal: true });
  const table = new Map();
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail === 0x7f) continue;
      let char;
      try { char = decoder.decode(Uint8Array.of(lead, trail)); } catch { continue; }
      if (char.length === 1 && !table.has(char)) table.set(char, [lead, trail]);
    }
  }
  return table;
}

function encodeDoubleByte(text, label) {
  const table = buildDoubleByteTable(label);
  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code < 0x80) { bytes.push(code); continue; }
    const pair = table.get(char);
    if (!pair) throw new Error(`「${char}」无法用 ${label} 编码，测试数据有误`);
    bytes.push(...pair);
  }
  return Buffer.from(bytes);
}

function encodeUtf16(text, bigEndian) {
  const buf = Buffer.alloc(2 + text.length * 2);
  const write = bigEndian ? buf.writeUInt16BE.bind(buf) : buf.writeUInt16LE.bind(buf);
  write(0xfeff, 0);
  for (let i = 0; i < text.length; i++) write(text.charCodeAt(i), 2 + i * 2);
  return buf;
}

function encode(text, encoding) {
  switch (encoding) {
    case 'utf8': return Buffer.from(text, 'utf8');
    case 'utf8-bom': return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
    case 'gbk': return encodeDoubleByte(text, 'gbk');
    case 'big5': return encodeDoubleByte(text, 'big5');
    case 'utf16le-bom': return encodeUtf16(text, false);
    case 'utf16be-bom': return encodeUtf16(text, true);
    default: throw new Error(`未知编码 ${encoding}`);
  }
}

// ---------- 生成 ----------

export function generateAll() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const report = [];
  for (const [file, spec] of Object.entries(FILES)) {
    const path = join(FIXTURE_DIR, spec.name);
    if (file === 'F4') {
      // 大文件分批写，避免在内存里拼一个 20MB 以上的字符串。
      const fd = openSync(path, 'w');
      let batch = [];
      for (const line of fileLines(file)) {
        batch.push(line);
        if (batch.length >= 5000) { writeSync(fd, batch.join(spec.eol) + spec.eol); batch = []; }
      }
      if (batch.length) writeSync(fd, batch.join(spec.eol) + spec.eol);
      closeSync(fd);
    } else {
      const lines = [...fileLines(file)];
      writeFileSync(path, encode(lines.length ? lines.join(spec.eol) + spec.eol : '', spec.encoding));
    }
    report.push({ file, name: spec.name, bytes: statSync(path).size });
  }
  const big = report.find((r) => r.file === 'F4');
  if (big.bytes <= 20 * 1024 * 1024) throw new Error(`F4 只有 ${big.bytes} 字节，没有超过 20MB`);
  return report;
}

// 自检：每段正好 100 个字。段落长度不对，后面所有手算锚点都会错。
for (const file of Object.keys(FILES)) {
  if (!FILES[file].chapters.length) continue;
  for (const [ch, idx] of [[0, 1], [10, 100], [2000, 40]]) {
    const len = para(file, ch, idx).length;
    if (len !== PARA_LEN) throw new Error(`${file} 的段落长度是 ${len}，不是 ${PARA_LEN}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const { name, bytes } of generateAll()) {
    console.log(`${name.padEnd(24)} ${String(bytes).padStart(10)} 字节`);
  }
}
