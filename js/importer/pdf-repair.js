// 修复字符对照表错误的 PDF（spec-m5 C8）。
//
// 有的 PDF（实测：Word 用微软雅黑导出的）里，PDF 自带的 ToUnicode 大面积写错，但嵌入字体自己的 cmap 表是对的。
// 这里逐个检查「Type0 + CIDFontType2 + 嵌入 TrueType + ToUnicode」的字体，ToUnicode 坏了就按字体自己的表生成一份新的，
// 用 PDF 标准的「增量更新」追加在文件末尾（新的对照表对象 + 改了引用的字体对象 + 新的交叉引用表），再交给 pdf.js。
// 原文件的字节一个不改；没有坏字体时原样返回同一个数组。任何一步读不懂就放弃修复，原样返回。
import { openPdf, dictGet, bytesToLatin1, latin1ToBytes } from './pdf-objects.js';
import { parseToUnicode, fontCmap, compareMaps, writeToUnicode } from './pdf-fonts.js';
import { cryptObject } from './pdf-crypto.js';

const ref = (r) => (r && typeof r === 'object' ? r : null);

/**
 * 检查并修复。
 * @param {Uint8Array} bytes
 * @returns {Promise<{ bytes: Uint8Array, fonts: { name: string, compared: number, mismatches: number }[] }>}
 *   fonts：修复了的字体；没修复时为空，bytes 就是传入的那个数组
 */
export async function repairPdf(bytes) {
  const untouched = { bytes, fonts: [] };
  // 便宜的预检：文件里根本没有 ToUnicode 的不用往下看
  if (!bytesToLatin1(bytes.subarray(0, Math.min(bytes.length, 64))).startsWith('%PDF')) return untouched;
  let pdf;
  try {
    pdf = openPdf(bytes);
    await pdf.expandObjectStreams();
  } catch {
    return untouched;
  }
  const fixes = [];
  for (const [num, obj] of pdf.objects) {
    try {
      const fix = await checkFont(pdf, num, obj);
      if (fix) fixes.push(fix);
    } catch {
      // 这个字体读不懂，跳过
    }
  }
  if (!fixes.length) return untouched;
  return { bytes: appendUpdate(bytes, pdf, fixes), fonts: fixes.map(({ name, compared, mismatches }) => ({ name, compared, mismatches })) };
}

/** 检查一个对象：是 Type0 字体且 ToUnicode 坏了，返回修复所需的信息；否则返回 null。 */
async function checkFont(pdf, num, obj) {
  const dict = obj.dict;
  if (!dict || dictGet(dict, 'Subtype') !== '/Type0') return null;
  const tu = ref(dictGet(dict, 'ToUnicode'));
  const encoding = dictGet(dict, 'Encoding');
  if (!tu || (encoding !== '/Identity-H' && encoding !== '/Identity-V')) return null;
  // 加密的文件里，要原样重写的字体字典不能带字符串（字符串也是加密的，这里不处理）
  if (pdf.encrypted && /\((?![^)]*\))|<(?!<)[0-9A-Fa-f]/.test(dict.replace(/<<|>>/g, ''))) return null;
  // DescendantFonts 可能直接写数组 [ 12 0 R ]，也可能是指向一个数组对象的引用（Word 导出的就是后者）
  let descArray = dictGet(dict, 'DescendantFonts');
  if (ref(descArray)) descArray = pdf.objects.get(descArray.num)?.array;
  const descRef = typeof descArray === 'string' ? descArray.match(/(\d+)\s+(\d+)\s+R/) : null;
  const desc = descRef ? pdf.objects.get(+descRef[1])?.dict : null;
  if (!desc || dictGet(desc, 'Subtype') !== '/CIDFontType2') return null;
  const fd = pdf.objects.get(ref(dictGet(desc, 'FontDescriptor'))?.num)?.dict;
  const ff = fd && ref(dictGet(fd, 'FontFile2'));
  if (!ff) return null;

  const cidToGid = dictGet(desc, 'CIDToGIDMap');
  let gidOf = (c) => c;
  if (ref(cidToGid)) {
    const map = await pdf.streamOf(cidToGid.num);
    if (!map) return null;
    gidOf = (c) => (2 * c + 1 < map.length ? (map[2 * c] << 8) | map[2 * c + 1] : 0);
  } else if (cidToGid !== undefined && cidToGid !== '/Identity') {
    return null;
  }

  const tuData = await pdf.streamOf(tu.num);
  const fontData = await pdf.streamOf(ff.num);
  if (!tuData || !fontData) return null;
  const rev = fontCmap(fontData);
  if (!rev) return null;
  const result = compareMaps(parseToUnicode(bytesToLatin1(tuData)), rev, gidOf);
  if (!result.broken) return null;
  return {
    num, gen: obj.gen, dict,
    name: String(dictGet(dict, 'BaseFont') ?? ''),
    compared: result.compared, mismatches: result.mismatches,
    cmap: writeToUnicode(result.fixed),
  };
}

/** 增量更新：每个坏字体追加一个新的 ToUnicode 流对象，并重写字体字典让它指向新对象；最后是交叉引用表和尾部。 */
function appendUpdate(bytes, pdf, fixes) {
  let out = bytesToLatin1(bytes);
  if (!out.endsWith('\n')) out += '\n';
  const offsets = [];
  let next = pdf.trailer.size;
  for (const fix of fixes) {
    const newNum = next++;
    let data = latin1ToBytes(unescape(encodeURIComponent(fix.cmap))); // CMap 文字只含 ASCII，这里只是转字节
    if (pdf.key) data = cryptObject(pdf.key, newNum, 0, data);
    offsets.push([newNum, 0, out.length]);
    out += `${newNum} 0 obj\n<< /Length ${data.length} >>\nstream\n${bytesToLatin1(data)}\nendstream\nendobj\n`;
    const dict = fix.dict.replace(/\/ToUnicode\s+\d+\s+\d+\s+R/, `/ToUnicode ${newNum} 0 R`);
    offsets.push([fix.num, fix.gen, out.length]);
    out += `${fix.num} ${fix.gen} obj\n${dict}\nendobj\n`;
  }
  offsets.sort((a, b) => a[0] - b[0]);
  const xrefAt = out.length;
  out += 'xref\n';
  for (const [num, gen, at] of offsets) {
    out += `${num} 1\n${String(at).padStart(10, '0')} ${String(gen).padStart(5, '0')} n \n`;
  }
  const t = pdf.trailer;
  out += `trailer\n<< /Size ${next} /Root ${t.root} /Prev ${t.startxref}`
    + (t.encrypt ? ` /Encrypt ${t.encrypt}` : '') + (t.id ? ` /ID ${t.id}` : '')
    + ` >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return latin1ToBytes(out);
}
