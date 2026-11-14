// PDF 的文字片段 → 段落（纯函数，不碰 pdf.js 和页面）。规则见 docs/spec-m5.md 3.2「文字整理规则」。
//
// 输入是每一页的文字片段（pdf.js getTextContent 的结果，已转成简单对象）：
//   pages: [{ items: [{ str, x, y, w, size }] }]
//   x / y：片段左下角的坐标（PDF 坐标，y 向上增大）；w：片段宽度；size：字号（≈ 一个汉字的宽度）
// 输出是段落数组，交给现有的分章流程。

import { isTitle } from '../chapterizer.js';
import { RADICALS } from './radicals.js';

/** 不少于这么多页才做「重复出现的页眉页脚」判断。 */
export const MIN_PAGES_FOR_REPEAT = 5;

const LATIN_OR_DIGIT = /[A-Za-z0-9]/;

/** 只有页码的行：12、- 12 -、第 12 页、12 / 300。 */
const PAGE_NUMBER = /^(?:[-—–]\s*)?\d+(?:\s*[-—–])?$|^第\s*\d+\s*页$|^\d+\s*\/\s*\d+$/;

/** 两个部首区：中日韩部首补充 U+2E80 到康熙部首 U+2FDF。用码位拼出来，避免源码里出现难以辨认的部首字符。 */
const RADICAL_RANGE = new RegExp(`[${String.fromCharCode(0x2E80)}-${String.fromCharCode(0x2FDF)}]`, 'g');

/**
 * 部首字符换成对应的常用汉字（对照表来自 Unicode 官方数据，见 radicals.js）。
 * 不少中文字体把「一」「见」「长」这类字的字形同时登记成部首字符，PDF 里抽出来就是长得一样、编码不同的字。
 * 不用 NFKC：它不认识部首补充区的大多数字（如 U+2EC5「见」的部首形），而且对全文做会把全角标点变成半角。
 */
export function fixRadicals(text) {
  return text.replace(RADICAL_RANGE, (c) => RADICALS.get(c) ?? c);
}

/** 把一页的片段按纵坐标合成行，行内按横坐标从左到右。返回从上到下的行。 */
export function groupLines(items) {
  const usable = items.filter((it) => it.str !== '' && it.size > 0);
  // 从上到下、从左到右
  usable.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of usable) {
    // 纵坐标相差不到半个字高算同一行
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.min(l.size, it.size) / 2);
    if (line) {
      line.items.push(it);
      line.size = Math.max(line.size, it.size);
    } else {
      lines.push({ y: it.y, size: it.size, items: [it] });
    }
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map(({ y, size, items: parts }) => {
    parts.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    for (const p of parts) {
      // 两个片段之间有明显空隙、且两边都是英文字母或数字时补一个空格（英文单词被拆成两个片段的情况）
      if (end !== null && p.x - end > size * 0.2 && LATIN_OR_DIGIT.test(text.slice(-1)) && LATIN_OR_DIGIT.test(p.str[0])) {
        text += ' ';
      }
      text += p.str;
      end = p.x + p.w;
    }
    const x0 = parts[0].x;
    const x1 = Math.max(...parts.map((p) => p.x + p.w));
    // 部首字符要在判断章节标题之前修正：「第⼀章」里的「⼀」是部首字符时，标题规则认不出来。
    return { text: fixRadicals(text).trim(), x0, x1, y, size };
  }).filter((l) => l.text !== '');
}

const repeatKey = (line) => `${line.text.replace(/\d+/g, '#')}@${Math.round(line.y)}`;

/**
 * 去掉页眉页脚。pagesLines：每页从上到下的行。返回新的数组，不改传入的。
 * ① 不少于 MIN_PAGES_FOR_REPEAT 页时：每页的第一行（或最后一行），数字都换成 # 之后，
 *    如果在一半以上的页里出现在同样的位置，就丢弃
 * ② 每页最后一行如果只有页码，丢弃（不管多少页）
 */
export function stripHeadersFooters(pagesLines) {
  const pages = pagesLines.map((lines) => [...lines]);
  if (pages.length >= MIN_PAGES_FOR_REPEAT) {
    for (const pick of [(ls) => 0, (ls) => ls.length - 1]) {
      const counts = new Map();
      for (const ls of pages) {
        if (!ls.length) continue;
        const key = repeatKey(ls[pick(ls)]);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const repeated = new Set([...counts].filter(([, n]) => n > pages.length / 2).map(([k]) => k));
      for (const ls of pages) {
        if (ls.length && repeated.has(repeatKey(ls[pick(ls)]))) ls.splice(pick(ls), 1);
      }
    }
  }
  for (const ls of pages) {
    if (ls.length && PAGE_NUMBER.test(ls[ls.length - 1].text)) ls.pop();
  }
  return pages;
}

/** 出现次数最多的值（四舍五入到整数后统计）。 */
function mostCommon(values) {
  const counts = new Map();
  for (const v of values) {
    const k = Math.round(v);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [k, n] of counts) {
    if (n > bestCount) { best = k; bestCount = n; }
  }
  return { value: best, count: bestCount };
}

/**
 * 正文的左右边界。左边界：行首横坐标里出现最多的（大多数行是段落中间的行，顶格）。
 * 右边界：行尾横坐标里出现最多的（两端对齐时整行都对齐到这里）；如果它占不到两成的行（不对齐的排版），用最大值。
 */
export function bodyBounds(lines) {
  const left = mostCommon(lines.map((l) => l.x0)).value;
  const right = mostCommon(lines.map((l) => l.x1));
  const max = Math.max(...lines.map((l) => l.x1));
  return { left, right: right.count >= lines.length * 0.2 ? right.value : max };
}

/** 两行相接：前一行末尾和后一行开头都是英文字母或数字时加一个空格，否则直接相连。 */
function join(a, b) {
  return LATIN_OR_DIGIT.test(a.slice(-1)) && LATIN_OR_DIGIT.test(b[0]) ? `${a} ${b}` : a + b;
}

/**
 * 去掉页眉页脚之后的行 → 段落。换页不强制分段。
 * 一行算新段落的开头，当它满足任意一条：
 *   ① 行首比左边界缩进至少 1 个字宽
 *   ② 上一行的右端比右边界短至少 2 个字宽
 *   ③ 这一行是章节标题，或上一行是章节标题
 */
export function toParagraphsFromLines(lines) {
  if (!lines.length) return [];
  const { left, right } = bodyBounds(lines);
  const tolerance = 0.1; // 坐标的舍入误差，按字宽算
  const paras = [];
  let prev = null;
  for (const line of lines) {
    const indented = line.x0 - left >= line.size * (1 - tolerance);
    const prevShort = prev && right - prev.x1 >= prev.size * (2 - tolerance);
    const title = isTitle(line.text) || (prev && isTitle(prev.text));
    if (!prev || indented || prevShort || title) paras.push(line.text);
    else paras[paras.length - 1] = join(paras[paras.length - 1], line.text);
    prev = line;
  }
  return paras;
}

/** 全流程：每页的片段 → 段落（部首字符已修正、去掉首尾空白、丢掉空段）。 */
export function pagesToParagraphs(pages) {
  const pagesLines = stripHeadersFooters(pages.map((p) => groupLines(p.items)));
  return toParagraphsFromLines(pagesLines.flat())
    .map((p) => p.trim())
    .filter((p) => p !== '');
}
