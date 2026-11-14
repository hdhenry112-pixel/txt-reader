// 判断抽出来的文字是不是乱码（纯函数）。规则见 docs/spec-m5.md 3.2「字符对照表错误的 PDF」C9。
//
// 做法：统计汉字里 GB2312 一级字（最常用的 3755 个字）所占的比例。正常的中文书几乎全是一级字，
// 字符对照表错乱的 PDF 抽出来的字里满是生僻字。
// 实测（2026-11-14）：3 个正常的《三体》PDF 99.37%–99.78%；对照表错乱的那个 41.34%。

/** 汉字不少于这么多个才判断。 */
export const MIN_HAN = 200;
/** 一级字比例低于这个值判定为乱码。正好等于算正常。 */
export const MIN_COMMON_RATIO = 0.8;

let level1 = null;
/** GB2312 一级字：区 16–55（字节 0xB0–0xD7），每区 94 字，第 55 区只有 89 字。用 GBK 解码器现生成，不用存字表。 */
function commonChars() {
  if (level1) return level1;
  const bytes = [];
  for (let hi = 0xB0; hi <= 0xD7; hi++) {
    for (let lo = 0xA1; lo <= (hi === 0xD7 ? 0xF9 : 0xFE); lo++) bytes.push(hi, lo);
  }
  level1 = new Set(new TextDecoder('gbk').decode(new Uint8Array(bytes)));
  return level1;
}

/** 常用汉字（U+4E00–U+9FFF）。 */
const isHan = (c) => c >= '一' && c <= '鿿';

/**
 * @param {string[]} paras 段落
 * @returns {{ han: number, common: number, garbled: boolean }}
 */
export function checkGarbled(paras) {
  const set = commonChars();
  let han = 0;
  let common = 0;
  for (const p of paras) {
    for (const c of p) {
      if (!isHan(c)) continue;
      han++;
      if (set.has(c)) common++;
    }
  }
  return { han, common, garbled: han >= MIN_HAN && common < han * MIN_COMMON_RATIO };
}

/** 一级字一共多少个（给测试核对用）。 */
export const commonCharCount = () => commonChars().size;
