// 把一个正常的 PDF 弄坏，做 spec-m5 C8 的测试文件 P8、P9。
// **刻意不用 App 的代码**（js/importer/pdf-*.js）：PDF 对象的读写、RC4 都在这里另写一遍，MD5 用 Node 自带的 crypto。
// 否则 App 的代码等于自己检查自己。
//   breakToUnicode(bytes)：正文字体（非粗体的 Type0 字体）的 ToUnicode 相邻两条互换，模拟 Word 导出的错误对照表
//   encryptRc4(bytes)：加上 RC4 128 位加密（标准安全处理器 V2 / R3，用户密码为空），和实测文件同一种
// 输入只支持 Chromium 打印出来的那种结构：经典交叉引用表、没有对象流、流长度直接写数字。
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

const latin1 = (b) => Buffer.from(b).toString('latin1');
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();

function rc4(key, data) {
  const s = [...Array(256).keys()];
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

/** 拆成对象：{ num, head（字典文字）, stream（Buffer 或 null） }，以及尾部字典。 */
function split(bytes) {
  const text = latin1(bytes);
  const objs = [];
  const re = /(\d+) 0 obj\s*/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endobj', start);
    let body = text.slice(start, end);
    let stream = null;
    const s = body.match(/stream\r?\n/);
    if (s && /\/Length (\d+)/.test(body.slice(0, s.index))) {
      const len = +body.slice(0, s.index).match(/\/Length (\d+)/)[1];
      const from = start + s.index + s[0].length;
      stream = Buffer.from(bytes.subarray(from, from + len));
      body = body.slice(0, s.index);
    }
    objs.push({ num: +m[1], head: body.trim(), stream });
    re.lastIndex = end;
  }
  const trailer = text.slice(text.lastIndexOf('trailer')).match(/<<([\s\S]*?)>>/)[1];
  return { objs, trailer };
}

/** 重新拼成完整的 PDF（新的交叉引用表）。 */
function join({ objs, trailer }, extraTrailer = '') {
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let size = parts[0].length;
  const offsets = new Map();
  for (const o of [...objs].sort((a, b) => a.num - b.num)) {
    offsets.set(o.num, size);
    let head = o.head;
    if (o.stream) head = head.replace(/\/Length \d+/, `/Length ${o.stream.length}`);
    const chunks = [Buffer.from(`${o.num} 0 obj\n${head}\n`, 'latin1')];
    if (o.stream) chunks.push(Buffer.from('stream\n'), o.stream, Buffer.from('\nendstream\n'));
    chunks.push(Buffer.from('endobj\n'));
    for (const c of chunks) { parts.push(c); size += c.length; }
  }
  const max = Math.max(...offsets.keys());
  let xref = `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= max; n++) {
    xref += offsets.has(n) ? `${String(offsets.get(n)).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n';
  }
  const t = trailer.replace(/\/Size \d+/, `/Size ${max + 1}`);
  parts.push(Buffer.from(`${xref}trailer\n<<${t}${extraTrailer}>>\nstartxref\n${size}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

/** ToUnicode CMap 文字 → [[编码, 目标十六进制]...]（bfchar 和单目标的 bfrange） */
function readCmap(text) {
  const out = [];
  for (const b of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const x of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) out.push([parseInt(x[1], 16), x[2]]);
  }
  for (const b of b2(text)) out.push(...b);
  return out.sort((a, c) => a[0] - c[0]);
}
function b2(text) {
  const blocks = [];
  for (const b of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const list = [];
    for (const x of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(x[1], 16); const hi = parseInt(x[2], 16); const d = parseInt(x[3], 16);
      for (let c = lo; c <= hi; c++) list.push([c, (d + c - lo).toString(16).padStart(4, '0')]);
    }
    blocks.push(list);
  }
  return blocks;
}

/** 正文字体的 ToUnicode 相邻两条互换。返回 { bytes, swapped }。 */
export function breakToUnicode(bytes) {
  const doc = split(bytes);
  const font = doc.objs.find((o) => /\/Subtype \/Type0/.test(o.head) && !/Bold/.test(o.head));
  const tuNum = +font.head.match(/\/ToUnicode (\d+) 0 R/)[1];
  const tu = doc.objs.find((o) => o.num === tuNum);
  const entries = readCmap(latin1(/FlateDecode/.test(tu.head) ? inflateSync(tu.stream) : tu.stream));
  for (let i = 0; i + 1 < entries.length; i += 2) [entries[i][1], entries[i + 1][1]] = [entries[i + 1][1], entries[i][1]];
  const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0');
  const body = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CMapName /Broken def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${entries.length} beginbfchar\n${entries.map(([c, d]) => `<${hex(c)}> <${d.toUpperCase()}>`).join('\n')}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
  tu.head = '<< /Length 0 >>';
  tu.stream = Buffer.from(body, 'latin1');
  return { bytes: join(doc), swapped: entries.length - (entries.length % 2) };
}

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');

/** 加上 RC4 128 位加密（V2 / R3），用户密码为空，所有者密码 owner。所有流和字符串都加密。 */
export function encryptRc4(bytes) {
  const doc = split(bytes);
  const n = 16;
  const P = -3904;
  const id0 = md5('txt-reader 测试文件 P9');
  // 算法 3：/O
  let ok = md5(Buffer.concat([Buffer.from('owner'), PAD]).subarray(0, 32));
  for (let i = 0; i < 50; i++) ok = md5(ok);
  ok = ok.subarray(0, n);
  let O = rc4(ok, PAD);
  for (let i = 1; i <= 19; i++) O = rc4(Buffer.from(ok.map((b) => b ^ i)), O);
  // 算法 2：文件密钥
  const p = Buffer.alloc(4); p.writeInt32LE(P);
  let key = md5(PAD, O, p, id0).subarray(0, n);
  for (let i = 0; i < 50; i++) key = md5(key).subarray(0, n);
  // 算法 5：/U
  let U = rc4(key, md5(PAD, id0));
  for (let i = 1; i <= 19; i++) U = rc4(Buffer.from(key.map((b) => b ^ i)), U);
  U = Buffer.concat([U, Buffer.alloc(16)]);

  const objKey = (num) => md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(0, Math.min(n + 5, 16));
  for (const o of doc.objs) {
    const k = objKey(o.num);
    if (o.stream) o.stream = rc4(k, o.stream);
    // 字典里的括号字符串 → 加密后写成十六进制字符串
    o.head = o.head.replace(/\((?:[^()\\]|\\.)*\)/g, (lit) => {
      const raw = lit.slice(1, -1).replace(/\\([()\\])/g, '$1');
      return `<${rc4(k, Buffer.from(raw, 'latin1')).toString('hex')}>`;
    });
  }
  const encNum = Math.max(...doc.objs.map((o) => o.num)) + 1;
  doc.objs.push({ num: encNum, head: `<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${P} /O <${O.toString('hex')}> /U <${U.toString('hex')}> >>`, stream: null });
  return join(doc, ` /Encrypt ${encNum} 0 R /ID [<${id0.toString('hex')}><${id0.toString('hex')}>]`);
}
