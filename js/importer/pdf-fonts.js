// 字体的两份「字形 → 汉字」对照表：PDF 里的 ToUnicode，和嵌入的 TrueType 字体自己的 cmap 表（纯函数）。spec-m5 C8。

/** 不一致的条目超过这个比例、且不少于 MIN_MISMATCHES 条时，认定 ToUnicode 是坏的。 */
export const MAX_MISMATCH_RATIO = 0.1;
export const MIN_MISMATCHES = 20;

/** 十六进制（UTF-16BE）→ 字符串。 */
const utf16 = (hex) => {
  const units = hex.match(/.{1,4}/g) || [];
  return String.fromCharCode(...units.map((u) => parseInt(u.padEnd(4, '0'), 16)));
};

/**
 * 解析 ToUnicode CMap 的文字（bfchar 和 bfrange 两种写法，bfrange 支持单个目标和数组目标）。
 * @returns {Map<number, string>} 编码 → 字符串
 */
export function parseToUnicode(text) {
  const map = new Map();
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) map.set(parseInt(m[1], 16), utf16(m[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (hi < lo || hi - lo > 0xFFFF) continue;
      if (m[3][0] === '[') {
        const dsts = [...m[3].matchAll(/<([0-9A-Fa-f]*)>/g)].map((d) => utf16(d[1]));
        dsts.forEach((d, i) => { if (lo + i <= hi) map.set(lo + i, d); });
      } else {
        const base = utf16(m[3].slice(1, -1));
        for (let c = lo; c <= hi; c++) {
          // 目标的最后一个 UTF-16 单元逐个加 1
          map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo)));
        }
      }
    }
  }
  return map;
}

/**
 * TrueType 字体文件里的 cmap 表 → 字形号到字符的反查表。只读 Unicode 子表（格式 4 和 12）。
 * @param {Uint8Array} font
 * @returns {Map<number, number[]> | null} 字形号 → 码位（可能有多个）；没有 cmap 表返回 null
 */
export function fontCmap(font) {
  const v = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const numTables = v.getUint16(4);
  let base = -1;
  for (let i = 0; i < numTables; i++) {
    const tag = String.fromCharCode(...font.subarray(12 + 16 * i, 16 + 16 * i));
    if (tag === 'cmap') base = v.getUint32(12 + 16 * i + 8);
  }
  if (base < 0) return null;
  const rev = new Map();
  const add = (gid, cp) => {
    if (!gid) return;
    const list = rev.get(gid);
    if (!list) rev.set(gid, [cp]);
    else if (!list.includes(cp)) list.push(cp);
  };
  const n = v.getUint16(base + 2);
  for (let i = 0; i < n; i++) {
    const pid = v.getUint16(base + 4 + 8 * i);
    const eid = v.getUint16(base + 6 + 8 * i);
    const o = base + v.getUint32(base + 8 + 8 * i);
    const unicode = pid === 0 || (pid === 3 && (eid === 1 || eid === 10));
    if (!unicode) continue;
    const fmt = v.getUint16(o);
    if (fmt === 4) {
      const seg = v.getUint16(o + 6) / 2;
      const ends = o + 14;
      const starts = ends + 2 * seg + 2;
      const deltas = starts + 2 * seg;
      const offsets = deltas + 2 * seg;
      for (let s = 0; s < seg; s++) {
        const end = v.getUint16(ends + 2 * s);
        const start = v.getUint16(starts + 2 * s);
        const delta = v.getInt16(deltas + 2 * s);
        const ro = v.getUint16(offsets + 2 * s);
        for (let c = start; c <= end && c !== 0xFFFF; c++) {
          let g;
          if (ro === 0) g = (c + delta) & 0xFFFF;
          else {
            const at = offsets + 2 * s + ro + 2 * (c - start);
            if (at + 2 > font.length) continue;
            g = v.getUint16(at);
            if (g) g = (g + delta) & 0xFFFF;
          }
          add(g, c);
        }
      }
    } else if (fmt === 12) {
      const groups = v.getUint32(o + 12);
      for (let k = 0; k < groups; k++) {
        const sc = v.getUint32(o + 16 + 12 * k);
        const ec = v.getUint32(o + 20 + 12 * k);
        const sg = v.getUint32(o + 24 + 12 * k);
        if (ec - sc > 0x10FFFF) continue;
        for (let c = sc; c <= ec; c++) add(sg + c - sc, c);
      }
    }
  }
  return rev;
}

const isHan = (cp) => cp >= 0x4E00 && cp <= 0x9FFF;
const isOdd = (cp) => (cp >= 0xE000 && cp <= 0xF8FF) || (cp >= 0x2E80 && cp <= 0x2FDF);

/** 一个字形对应多个字符时选哪个：常用汉字区优先，私用区和部首区靠后，同类取码位小的。 */
function pick(cps) {
  return [...cps].sort((a, b) => (isHan(b) - isHan(a)) || (isOdd(a) - isOdd(b)) || a - b)[0];
}

/**
 * 比对两份对照表，坏了就给出修正后的 ToUnicode。
 * @param {Map<number, string>} toUnicode 编码 → 字符串
 * @param {Map<number, number[]>} rev 字形号 → 码位
 * @param {(code: number) => number} gidOf 编码 → 字形号（Identity 时就是它自己）
 * @returns {{ compared: number, mismatches: number, broken: boolean, fixed: Map<number, string> | null }}
 */
export function compareMaps(toUnicode, rev, gidOf) {
  let compared = 0;
  let mismatches = 0;
  const fixed = new Map();
  for (const [code, str] of toUnicode) {
    const cps = rev.get(gidOf(code));
    if (!cps || !str) { fixed.set(code, str); continue; }
    compared++;
    if (cps.includes(str.codePointAt(0))) { fixed.set(code, str); continue; }
    mismatches++;
    fixed.set(code, String.fromCodePoint(pick(cps)));
  }
  const broken = mismatches >= MIN_MISMATCHES && mismatches > compared * MAX_MISMATCH_RATIO;
  return { compared, mismatches, broken, fixed: broken ? fixed : null };
}

/** 写一份 ToUnicode CMap 的文字（双字节编码、bfchar 写法，每段最多 100 条）。 */
export function writeToUnicode(map) {
  const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
  const dst = (s) => [...s].map((ch) => {
    const cp = ch.codePointAt(0);
    if (cp < 0x10000) return hex4(cp);
    const v = cp - 0x10000;
    return hex4(0xD800 + (v >> 10)) + hex4(0xDC00 + (v & 0x3FF));
  }).join('');
  const entries = [...map].sort((a, b) => a[0] - b[0]);
  const blocks = [];
  for (let i = 0; i < entries.length; i += 100) {
    const part = entries.slice(i, i + 100);
    blocks.push(`${part.length} beginbfchar\n${part.map(([c, s]) => `<${hex4(c)}> <${dst(s)}>`).join('\n')}\nendbfchar`);
  }
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${blocks.join('\n')}
endcmap
CMapName currentdict /CMap defineresource pop
end
end
`;
}
