// 读 PDF 文件里的对象（够修复字体用就行，不是完整的 PDF 解析器）。spec-m5 C8。
// 支持：普通对象（N G obj … endobj）、对象流（/Type /ObjStm）、FlateDecode 压缩的流、RC4 加密（pdf-crypto.js）。
// 读不懂的地方一律放弃（返回 null），由调用方原样交给 pdf.js。
import { fileKey, cryptObject } from './pdf-crypto.js';

/** 字节 → 每个字节一个字符的字符串（不能用 TextDecoder('latin1')，它其实是 windows-1252，0x80–0x9F 会变）。 */
export function bytesToLatin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}
export const latin1ToBytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** 从 pos 处的 << 开始，找到配对的 >> 之后的位置。跳过括号字符串。 */
function dictEnd(text, pos) {
  let depth = 0;
  for (let i = pos; i < text.length; i++) {
    const c = text[i];
    if (c === '(') {
      for (let d = 1, j = i + 1; j < text.length; j++) {
        if (text[j] === '\\') { j++; continue; }
        if (text[j] === '(') d++;
        else if (text[j] === ')' && --d === 0) { i = j; break; }
      }
    } else if (c === '<' && text[i + 1] === '<') { depth++; i++; }
    else if (c === '>' && text[i + 1] === '>') { depth--; i++; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** 字典文字里某个键的值：引用（{ num, gen }）、名字（'/Name'）、数字，或 [ … ] 原文。 */
export function dictGet(dict, key) {
  const m = dict.match(new RegExp(`/${key}(?![A-Za-z0-9])\\s*`));
  if (!m) return undefined;
  const rest = dict.slice(m.index + m[0].length);
  let r = rest.match(/^(\d+)\s+(\d+)\s+R/);
  if (r) return { num: +r[1], gen: +r[2] };
  if ((r = rest.match(/^\/[^\s/<>[\]()]+/))) return r[0];
  if ((r = rest.match(/^-?\d+(\.\d+)?/))) return +r[0];
  if (rest[0] === '[') return rest.slice(0, rest.indexOf(']') + 1);
  if (rest.startsWith('<<')) return rest.slice(0, dictEnd(rest, 0));
  return undefined;
}

/**
 * 流数据在哪里结束。/Length 是直接写的数字、且后面紧跟 endstream 时照它切；
 * 否则（间接引用、或长度不对）找 endstream，并去掉它前面的一个换行。
 */
function streamEndOf(text, start, length) {
  if (typeof length === 'number' && /^\s*endstream/.test(text.slice(start + length, start + length + 12))) {
    return start + length;
  }
  let end = text.indexOf('endstream', start);
  if (end < 0) return -1;
  if (text[end - 1] === '\n') end--;
  if (text[end - 1] === '\r') end--;
  return end;
}

/** FlateDecode 解压（zlib 格式）。 */
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const hexBytes = (hex) => Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));

/**
 * 打开一个 PDF。返回对象表和读取工具；结构读不懂时抛错。
 * @param {Uint8Array} bytes
 */
export function openPdf(bytes) {
  const text = bytesToLatin1(bytes);
  const objects = new Map(); // num → { gen, dict, streamStart, streamEnd }（文件里后出现的覆盖先出现的）
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(text))) {
    const num = +m[1];
    const gen = +m[2];
    let pos = m.index + m[0].length;
    while (/\s/.test(text[pos])) pos++;
    const obj = { gen, dict: null, array: null, streamStart: -1, streamEnd: -1 };
    if (text.startsWith('[', pos)) {
      // 数组对象（比如 /DescendantFonts 指向的 [ 12 0 R ]）：只记原文
      const end = text.indexOf(']', pos);
      if (end > 0) obj.array = text.slice(pos, end + 1);
    } else if (text.startsWith('<<', pos)) {
      const end = dictEnd(text, pos);
      if (end < 0) break;
      obj.dict = text.slice(pos, end);
      const after = text.slice(end, end + 30).match(/^\s*stream\r?\n/);
      if (after) {
        obj.streamStart = end + after[0].length;
        obj.streamEnd = streamEndOf(text, obj.streamStart, dictGet(obj.dict, 'Length'));
        if (obj.streamEnd < 0) break;
        re.lastIndex = obj.streamEnd;
      } else {
        re.lastIndex = end;
      }
    }
    objects.set(num, obj);
  }

  // 尾部信息：最后一个 /Root、/Encrypt、/ID、startxref、/Size
  const last = (regex) => { let r = null; let x; while ((x = regex.exec(text))) r = x; return r; };
  const root = last(/\/Root\s+(\d+)\s+(\d+)\s+R/g);
  const encryptRef = last(/\/Encrypt\s+(\d+)\s+(\d+)\s+R/g);
  const idMatch = last(/\/ID\s*\[\s*<([0-9A-Fa-f]*)>\s*<([0-9A-Fa-f]*)>\s*\]/g);
  const startxref = last(/startxref\s+(\d+)/g);
  const sizes = [...text.matchAll(/\/Size\s+(\d+)/g)].map((x) => +x[1]);
  if (!root || !startxref) throw new Error('找不到 /Root 或 startxref');

  let key = null;
  if (encryptRef) {
    const enc = objects.get(+encryptRef[1]);
    if (!enc?.dict || dictGet(enc.dict, 'Filter') !== '/Standard') throw new Error('不是标准安全处理器');
    const V = dictGet(enc.dict, 'V') ?? 0;
    const R = dictGet(enc.dict, 'R');
    if (!(V === 1 || V === 2) || !(R === 2 || R === 3) || !idMatch) throw new Error(`不支持的加密 V${V} R${R}`);
    const str = (k) => {
      const lit = enc.dict.match(new RegExp(`/${k}\\s*\\(`));
      if (lit) {
        // 括号字符串：处理转义
        let out = []; let i = lit.index + lit[0].length;
        for (let depth = 1; i < enc.dict.length; i++) {
          let c = enc.dict[i];
          if (c === '\\') {
            const n = enc.dict[++i];
            const esc = { n: 10, r: 13, t: 9, b: 8, f: 12 }[n];
            if (esc !== undefined) out.push(esc);
            else if (/[0-7]/.test(n)) { const o = enc.dict.slice(i).match(/^[0-7]{1,3}/)[0]; out.push(parseInt(o, 8) & 255); i += o.length - 1; }
            else if (n === '\r' || n === '\n') { if (n === '\r' && enc.dict[i + 1] === '\n') i++; }
            else out.push(n.charCodeAt(0));
            continue;
          }
          if (c === '(') depth++;
          if (c === ')' && --depth === 0) break;
          out.push(c.charCodeAt(0));
        }
        return Uint8Array.from(out);
      }
      const hex = enc.dict.match(new RegExp(`/${k}\\s*<([0-9A-Fa-f\\s]*)>`));
      return hex ? hexBytes(hex[1].replace(/\s/g, '')) : null;
    };
    const length = V === 1 ? 5 : (dictGet(enc.dict, 'Length') ?? 40) / 8;
    key = fileKey({ R, length, O: str('O'), U: str('U'), P: dictGet(enc.dict, 'P'), id0: hexBytes(idMatch[1]) });
    if (!key) throw new Error('用户密码不是空的');
  }

  /** 读一个流的内容：先解密，再按 /Filter 解压。只支持不压缩和 FlateDecode。 */
  async function streamOf(num) {
    const obj = objects.get(num);
    if (!obj || obj.streamStart < 0) return null;
    let data = latin1ToBytes(text.slice(obj.streamStart, obj.streamEnd));
    if (key && !obj.inObjStm) data = cryptObject(key, num, obj.gen, data);
    const filter = dictGet(obj.dict, 'Filter');
    if (filter === undefined) return data;
    if (filter === '/FlateDecode' || filter === '[/FlateDecode]' || /^\[\s*\/FlateDecode\s*\]$/.test(filter)) {
      if (dictGet(obj.dict, 'DecodeParms') !== undefined) return null;
      return inflate(data);
    }
    return null;
  }

  /** 把对象流里的对象展开进对象表（只补表里还没有的，或比对象流更早出现的）。 */
  async function expandObjectStreams() {
    for (const [num, obj] of [...objects]) {
      if (!obj.dict || dictGet(obj.dict, 'Type') !== '/ObjStm') continue;
      const data = await streamOf(num);
      if (!data) continue;
      const body = bytesToLatin1(data);
      const n = dictGet(obj.dict, 'N');
      const first = dictGet(obj.dict, 'First');
      const header = body.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i < n; i++) {
        const inner = header[2 * i];
        const start = first + header[2 * i + 1];
        const end = i + 1 < n ? first + header[2 * i + 3] : body.length;
        const src = body.slice(start, end).trim();
        const isDict = src.startsWith('<<');
        const isArray = src.startsWith('[');
        if (!isDict && !isArray) continue;
        const existing = objects.get(inner);
        if (existing && (existing.dict || existing.array) && !existing.inObjStm) continue;
        objects.set(inner, {
          gen: 0,
          dict: isDict ? src.slice(0, dictEnd(src, 0)) : null,
          array: isArray ? src.slice(0, src.indexOf(']') + 1) : null,
          streamStart: -1, streamEnd: -1, inObjStm: true,
        });
      }
    }
  }

  return {
    objects,
    key,
    encrypted: Boolean(encryptRef),
    trailer: {
      root: `${root[1]} ${root[2]} R`,
      encrypt: encryptRef ? `${encryptRef[1]} ${encryptRef[2]} R` : null,
      id: idMatch ? `[<${idMatch[1]}><${idMatch[2]}>]` : null,
      startxref: +startxref[1],
      size: Math.max(0, ...sizes, ...[...objects.keys()].map((k) => k + 1)),
    },
    streamOf,
    expandObjectStreams,
  };
}
