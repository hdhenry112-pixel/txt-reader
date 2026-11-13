// 阅读位置相关的计算。
// 「位置」= 第几章 + 章内第几个字（offset）。字数不含标题行和换行。

/**
 * 全书进度百分比（整数，向下取整）。
 * @param {number[]} lens 各章字数
 * @param {number} chapterIdx 当前章
 * @param {number} offset 章内第几个字
 * @param {boolean} atBookEnd 是否已到全书末尾（最后一章的最后一屏）
 */
export function computePercent(lens, chapterIdx, offset, atBookEnd) {
  if (atBookEnd) return 100;
  const total = lens.reduce((sum, n) => sum + n, 0);
  if (total === 0) return 0;
  let before = 0;
  for (let i = 0; i < chapterIdx; i++) before += lens[i];
  return Math.floor(((before + offset) / total) * 100);
}

/** 段落里第 i 个字在屏幕上的矩形。 */
export function charRect(p, i) {
  const node = p.firstChild;
  const range = document.createRange();
  range.setStart(node, i);
  range.setEnd(node, i + 1);
  return range.getBoundingClientRect();
}

/**
 * 在一组按文档顺序排列的段落里，找第一个满足 isVisible 的字，返回它在本章的序号。
 * isVisible(rect) 对字的矩形做判断，要求沿文档顺序单调（前面一段为假，之后全为真），这样才能二分。
 * 每个段落元素要有 data-start（该段第一个字在本章的序号）。
 * 找不到（所有字都在可见区域之前）时返回 null。
 */
export function firstVisibleOffset(paras, isVisible) {
  // 先二分找到段落：第一个「最后一个字可见」的段落。
  let lo = 0;
  let hi = paras.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const p = paras[mid];
    if (isVisible(charRect(p, p.firstChild.length - 1))) hi = mid;
    else lo = mid + 1;
  }
  if (lo === paras.length) return null;

  // 再在这个段落里二分找到字。
  const p = paras[lo];
  let a = 0;
  let b = p.firstChild.length - 1;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (isVisible(charRect(p, mid))) b = mid;
    else a = mid + 1;
  }
  return Number(p.dataset.start) + a;
}

/** 找到包含本章第 offset 个字的段落和段内序号。offset 超出范围时落到最后一个字。 */
export function locate(paras, offset) {
  if (!paras.length) return null;
  let lo = 0;
  let hi = paras.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (Number(paras[mid].dataset.start) <= offset) lo = mid;
    else hi = mid - 1;
  }
  const p = paras[lo];
  const index = Math.min(Math.max(offset - Number(p.dataset.start), 0), p.firstChild.length - 1);
  return { p, index };
}
