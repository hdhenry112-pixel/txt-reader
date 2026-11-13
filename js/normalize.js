// 段落整理（纯函数）。
// 每行去掉首尾空白（含全角空格），丢弃空行；剩下的每一行算一个段落。
// 首行缩进不在这里处理，由 CSS 统一加。

/**
 * @param {string} text 解码后的全文
 * @returns {string[]} 段落数组
 */
export function toParagraphs(text) {
  const paras = [];
  for (const line of text.split(/\r\n?|\n/)) {
    // String.prototype.trim 去掉的空白包含全角空格 U+3000 和 BOM U+FEFF。
    const trimmed = line.trim();
    if (trimmed) paras.push(trimmed);
  }
  return paras;
}
