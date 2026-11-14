// 生成 M5b 的 PDF 测试文件（docs/spec-m5.md 第 ④ 节的 P1–P5、G11 用的大文件，以及几个边界文件）。
// 用 Playwright 的 Chromium 把 HTML 打印成 PDF：带真实字体和文字层，排版（折行、跨页、页眉页码）由浏览器决定。
// 每一段的原文来自 gen-fixtures.mjs 的 para()，所以测试能逐字比对。确定值，不用随机数。
// 用法：node gen-pdf-fixtures.mjs    产物写到 tests/fixtures/（不进仓库）
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FIXTURE_DIR, para } from './gen-fixtures.mjs';

const CN = '一二三四五六七八九十';

/**
 * chapters：[{ title, paras }]，title 为 null 表示没有标题。第 c 章（从 1 起）第 i 段（从 1 起）的原文是 para(代号, c, i, 'hans')。
 * header：页眉文字（null 表示没有）；pageNumbers：页脚是否有页码；breakEachPara：每段另起一页。
 * pages：对页数的要求，生成后检查。
 */
export const PDF_FILES = {
  P1: {
    name: 'P1-五章.pdf', header: '测试书名', pageNumbers: true, pages: { min: 5 },
    chapters: Array.from({ length: 5 }, (_, i) => ({ title: `第${CN[i]}章`, paras: 5 })),
  },
  // P2 用「等线」字体：它打印出来的「一」「气」「石」「雨」「水」会被抽成康熙部首字符（见报告），用来验证部首修正
  P2: {
    name: 'P2-四章.pdf', header: '测试书名', pageNumbers: true, pages: { min: 1 }, font: 'DengXian',
    chapters: Array.from({ length: 4 }, (_, i) => ({ title: `第${CN[i]}章`, paras: (i + 1) * 3 })),
  },
  P3: {
    name: 'P3-无标题.pdf', header: '测试书名', pageNumbers: true, pages: { min: 5 },
    chapters: [{ title: null, paras: 60 }],
  },
  P4: { name: 'P4-空白页.pdf', blankPages: 3, pages: { exact: 3 }, chapters: [] },
  P5: {
    name: 'P5-三页.pdf', header: null, pageNumbers: true, breakEachPara: true, pages: { exact: 3 },
    chapters: [{ title: '第一章', paras: 3 }],
  },
  G11: {
    name: 'G11-五百页.pdf', header: '测试书名', pageNumbers: true, pages: { min: 500 },
    chapters: Array.from({ length: 100 }, (_, i) => ({ title: `第${i + 1}章`, paras: 18 })),
  },
};

/** 不用浏览器生成的边界文件。 */
export const OTHER_FILES = {
  B2: 'B2-其实是文本.pdf',
  B3: 'B3-图片.jpg',
  P7: 'P7-标准字体.pdf',
};
/** P7 里的两行：标题和正文（正文用 PDF 标准字体 Helvetica，不嵌入字体）。 */
export const P7_LINES = ['Chapter 1 Dawn', 'The quick brown fox jumps over the lazy dog.'];

export const pdfPath = (key) => join(FIXTURE_DIR, (PDF_FILES[key]?.name) ?? OTHER_FILES[key]);

/** 某个文件第 c 章的全部段落原文（c 从 1 起）。 */
export const expectedParas = (key, c) =>
  Array.from({ length: PDF_FILES[key].chapters[c - 1].paras }, (_, i) => para(key, c, i + 1, 'hans'));

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function htmlOf(spec, key) {
  const font = spec.font ? `"${spec.font}", ` : '';
  if (spec.blankPages) {
    return Array.from({ length: spec.blankPages }, (_, i) =>
      `<div style="height:10px;${i ? 'break-before:page' : ''}"></div>`).join('');
  }
  const body = spec.chapters.map((ch, c) => {
    const title = ch.title ? `<h2>${escape(ch.title)}</h2>` : '';
    const paras = Array.from({ length: ch.paras }, (_, i) => {
      const brk = spec.breakEachPara && i > 0 ? ' style="break-before:page"' : '';
      return `<p${brk}>${escape(para(key, c + 1, i + 1, 'hans'))}</p>`;
    }).join('');
    return title + paras;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; font-family: ${font}"Microsoft YaHei", "PingFang SC", sans-serif; font-size: 18px; line-height: 1.9; }
    p { margin: 0; text-indent: 2em; text-align: justify; }
    h2 { font-size: 22px; margin: 0.8em 0; }
  </style>${body}`;
}

const small = 'font-size:9px;width:100%;text-align:center;font-family:\'Microsoft YaHei\',sans-serif';

async function printPdf(page, spec, key) {
  await page.setContent(htmlOf(spec, key));
  const withHF = Boolean(spec.header || spec.pageNumbers);
  return page.pdf({
    format: 'A5',
    margin: { top: '22mm', bottom: '22mm', left: '16mm', right: '16mm' },
    displayHeaderFooter: withHF,
    // 不给模板时 Chromium 会印上日期和标题，所以没有页眉时也要给一个空模板
    headerTemplate: spec.header ? `<div style="${small}">${spec.header}</div>` : '<span></span>',
    footerTemplate: spec.pageNumbers ? `<div style="${small}"><span class="pageNumber"></span></div>` : '<span></span>',
  });
}

/** PDF 的页数：数 /Type /Page 对象（不含 /Pages）。 */
const countPages = (bytes) => (bytes.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;

/** 手写一个最小的 PDF：一页，字体是不嵌入的 Helvetica。用来确认不带 standard_fonts 也能抽出字。 */
function standardFontPdf() {
  const content = `BT /F1 16 Tf 42 520 Td (${P7_LINES[0]}) Tj ET\nBT /F1 12 Tf 42 480 Td (${P7_LINES[1]}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export async function generatePdfFixtures() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const report = [];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const [key, spec] of Object.entries(PDF_FILES)) {
      const bytes = await printPdf(page, spec, key);
      const pages = countPages(bytes);
      if (spec.pages.exact !== undefined && pages !== spec.pages.exact) throw new Error(`${spec.name} 有 ${pages} 页，要求正好 ${spec.pages.exact} 页`);
      if (spec.pages.min !== undefined && pages < spec.pages.min) throw new Error(`${spec.name} 只有 ${pages} 页，要求至少 ${spec.pages.min} 页`);
      writeFileSync(pdfPath(key), bytes);
      report.push({ name: spec.name, bytes: bytes.length, pages });
    }
  } finally {
    await browser.close();
  }
  writeFileSync(pdfPath('B2'), '这是一个文本文件，只是扩展名写成了 pdf。\n第二行。\n', 'utf8');
  writeFileSync(pdfPath('B3'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]));
  writeFileSync(pdfPath('P7'), standardFontPdf());
  for (const key of Object.keys(OTHER_FILES)) report.push({ name: OTHER_FILES[key], bytes: statSync(pdfPath(key)).size, pages: null });
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const { name, bytes, pages } of await generatePdfFixtures()) {
    console.log(`${name.padEnd(20)} ${String(bytes).padStart(10)} 字节${pages === null ? '' : `  ${pages} 页`}`);
  }
}
