// 由 Unicode 官方的 EquivalentUnifiedIdeograph.txt 生成 js/importer/radicals.js（部首字符 → 对应的常用汉字）。
// 只取两个部首区：中日韩部首补充 U+2E80–U+2EFF、康熙部首 U+2F00–U+2FDF。不取笔画区 U+31C0–U+31EF（笔画本身是正常用字）。
// 用法：node gen-radicals.mjs <EquivalentUnifiedIdeograph.txt 的路径>
// 文件来源：https://www.unicode.org/Public/UCD/latest/ucd/EquivalentUnifiedIdeograph.txt
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(process.argv[2], 'utf8');
const version = src.match(/^# (EquivalentUnifiedIdeograph-[\d.]+\.txt)/m)[1];
const pairs = [];
for (const line of src.split('\n')) {
  const m = line.match(/^([0-9A-F]{4,5})(?:\.\.([0-9A-F]{4,5}))?\s*;\s*([0-9A-F]{4,5})/);
  if (!m) continue;
  const from = parseInt(m[1], 16);
  const to = m[2] ? parseInt(m[2], 16) : from;
  if (from < 0x2E80 || to > 0x2FDF) continue;
  for (let c = from; c <= to; c++) pairs.push(String.fromCodePoint(c) + String.fromCodePoint(parseInt(m[3], 16)));
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'importer', 'radicals.js');
writeFileSync(out, `// 部首字符 → 对应的常用汉字。由 tests/gen-radicals.mjs 生成，不要手改。
// 数据来源：Unicode ${version}（https://www.unicode.org/Public/UCD/latest/ucd/EquivalentUnifiedIdeograph.txt）
// 只含中日韩部首补充（U+2E80–U+2EFF）和康熙部首（U+2F00–U+2FDF），共 ${pairs.length} 个。
// 为什么需要：不少中文字体（如「等线」）把「一」「见」「长」这类字的字形同时登记成部首字符，
// PDF 里抽出来就是长得一样、编码不同的字。每两个字一组：前一个是部首字符，后一个是常用汉字。
const PAIRS = '${pairs.join('')}';

// 按码位逐字取（有的常用汉字在扩展 B 区，占两个 UTF-16 单元，不能按下标两个两个地取）
const CHARS = [...PAIRS];
export const RADICALS = new Map();
for (let i = 0; i < CHARS.length; i += 2) RADICALS.set(CHARS[i], CHARS[i + 1]);
`);
console.log(`${version}：${pairs.length} 个部首字符`);
