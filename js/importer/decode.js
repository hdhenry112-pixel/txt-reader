// 编码判断与解码（纯函数）。
//
// 判断顺序（spec 3.2「编码」）：
//   UTF-8 BOM → UTF-16LE BOM → UTF-16BE BOM
//   → 无 BOM：UTF-8 严格解码 → 失败则 GBK 严格解码 → 仍失败则 GBK 宽松解码并标记可疑
// 不自动识别 Big5；Big5 只能通过 forced 参数手动指定。

/** 手动指定编码时可选的值。 */
export const ENCODINGS = ['utf-8', 'gbk', 'big5', 'utf-16le', 'utf-16be'];

function startsWith(bytes, ...head) {
  return head.every((b, i) => bytes[i] === b);
}

/**
 * @param {Uint8Array} bytes 文件的原始字节
 * @param {string} [forced] 手动指定的编码；不传则自动判断
 * @returns {{ text: string, encoding: string, suspect: boolean }}
 *   suspect 为真表示解码时遇到了无法识别的字节，结果可能是乱码
 */
export function decodeBytes(bytes, forced) {
  if (forced) {
    if (!ENCODINGS.includes(forced)) throw new Error(`不支持的编码：${forced}`);
    // TextDecoder 默认会去掉与自身编码匹配的 BOM。
    return { text: new TextDecoder(forced).decode(bytes), encoding: forced, suspect: false };
  }

  if (startsWith(bytes, 0xef, 0xbb, 0xbf)) {
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8', suspect: false };
  }
  if (startsWith(bytes, 0xff, 0xfe)) {
    return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le', suspect: false };
  }
  if (startsWith(bytes, 0xfe, 0xff)) {
    return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be', suspect: false };
  }

  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8', suspect: false };
  } catch { /* 不是合法的 UTF-8，往下试 GBK */ }

  // 浏览器的 gbk 解码器实际是 GB18030，是 GBK 的超集。
  try {
    return { text: new TextDecoder('gbk', { fatal: true }).decode(bytes), encoding: 'gbk', suspect: false };
  } catch { /* 也不是合法的 GBK */ }

  return { text: new TextDecoder('gbk').decode(bytes), encoding: 'gbk', suspect: true };
}
