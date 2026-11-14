// PDF 标准安全处理器的 RC4 加密（V1 / V2，R2 / R3），只支持用户密码为空的情况。
// 用途：修复字符对照表错误的 PDF 时要读加密的字体数据、写回加密的新对照表（spec-m5 C8）。
// 浏览器自带的 crypto.subtle 没有 MD5 和 RC4，所以这里自己实现。算法见 PDF 1.7 规范 7.6.3（算法 1、2、4、5）。

// ---------- MD5（RFC 1321） ----------

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** @param {Uint8Array} input @returns {Uint8Array} 16 字节 */
export function md5(input) {
  const len = input.length;
  const padded = new Uint8Array(((len + 8) >> 6 << 6) + 64);
  padded.set(input);
  padded[len] = 0x80;
  const bits = len * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bits / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((w, i) => ov.setUint32(i * 4, w, true));
  return out;
}

// ---------- RC4 ----------

/** RC4 加密和解密是同一个运算。 */
export function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

// ---------- 标准安全处理器 ----------

/** 密码补齐用的 32 字节（规范规定的固定值）。 */
export const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/**
 * 空用户密码对应的文件密钥（算法 2），并用 /U 核对（算法 4 / 5）。核对不上返回 null。
 * @param {{ R: number, length: number, O: Uint8Array, U: Uint8Array, P: number, id0: Uint8Array }} enc
 *   length：密钥字节数（/Length ÷ 8，V1 固定 5）
 */
export function fileKey({ R, length, O, U, P, id0 }) {
  const p = new Uint8Array(4);
  new DataView(p.buffer).setInt32(0, P, true);
  let key = md5(concat(PAD, O, p, id0)).slice(0, length);
  if (R >= 3) for (let i = 0; i < 50; i++) key = md5(key).slice(0, length);
  let check;
  if (R === 2) {
    check = rc4(key, PAD);
    return check.every((b, i) => b === U[i]) ? key : null;
  }
  check = rc4(key, md5(concat(PAD, id0)));
  for (let i = 1; i <= 19; i++) check = rc4(key.map((b) => b ^ i), check);
  // R3 只比前 16 字节
  return check.every((b, i) => b === U[i]) ? key : null;
}

/** 某个对象的密钥（算法 1）：文件密钥 + 对象号低 3 字节 + 代号低 2 字节，取 MD5，截到 文件密钥长度 + 5（最多 16）。 */
export function objectKey(key, num, gen) {
  const extra = new Uint8Array([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255]);
  return md5(concat(key, extra)).slice(0, Math.min(key.length + 5, 16));
}

/** 解密或加密某个对象里的字符串 / 流（RC4 对称）。 */
export const cryptObject = (key, num, gen, data) => rc4(objectKey(key, num, gen), data);
