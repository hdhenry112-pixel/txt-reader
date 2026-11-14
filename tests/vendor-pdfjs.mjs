// 生成 vendor/pdfjs/ 的两个登记文件。换 pdf.js 版本时：把新文件拷进 vendor/pdfjs/，改下面的 VERSION 和 SOURCE，再运行一次。
//   vendor/pdfjs/assets.js   离线缓存清单，sw.js 用 importScripts 读进来，和 ASSETS 合并
//   vendor/pdfjs/VERSION.md  版本、来源、每个文件的字节数和 sha256
// 用法：node vendor-pdfjs.mjs
// tests/unit/vendor-pdfjs.test.mjs 会核对：目录里的文件和这两个登记文件一一对应、sha256 一致。
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

export const VERSION = '6.5.438';
const SOURCE = 'https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.5.438.tgz';
const TARBALL_SHA512 = 'sha512-vg8Pw1x+AFKy4AMDvhuWl5cOYV8d698UoEANoFFhc79hqXDnZQqnOXoxw3HG907WHOg1JYOvLhP756boddFxpA==';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = join(ROOT, 'vendor', 'pdfjs');
/** 登记文件本身不算 pdf.js 的文件。 */
export const OWN_FILES = new Set(['assets.js', 'VERSION.md']);

/** vendor/pdfjs 下所有 pdf.js 的文件，相对于仓库根目录，用 / 分隔，排好序。 */
export function listVendorFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (!(dir === DIR && OWN_FILES.has(name))) out.push(relative(ROOT, full).split('\\').join('/'));
    }
  };
  walk(DIR);
  return out.sort();
}

export const sha256 = (file) => createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex');

function main() {
  const files = listVendorFiles();
  writeFileSync(join(DIR, 'assets.js'),
    '// 由 tests/vendor-pdfjs.mjs 生成，不要手改。pdf.js 的全部文件，sw.js 把它们加进离线缓存。\n'
    + `self.PDFJS_ASSETS = ${JSON.stringify(files, null, 2)};\n`);

  let total = 0;
  const rows = files.map((f) => {
    const size = statSync(join(ROOT, f)).size;
    total += size;
    return `| \`${f.replace('vendor/pdfjs/', '')}\` | ${size} | \`${sha256(f)}\` |`;
  });
  writeFileSync(join(DIR, 'VERSION.md'), `# pdf.js（第三方代码）

由 \`tests/vendor-pdfjs.mjs\` 生成，不要手改。

| 项 | 值 |
|---|---|
| 名称 | pdfjs-dist（Mozilla PDF.js 的发布包） |
| 版本 | ${VERSION} |
| 许可证 | Apache-2.0，见同目录 \`LICENSE\` |
| 来源 | ${SOURCE} |
| 压缩包校验 | \`${TARBALL_SHA512}\`（和 npm 公布的 integrity 一致） |
| 文件数 | ${files.length} |
| 总字节数 | ${total} |

**不许改这些文件。** 每个文件的 sha256 由 \`tests/unit/vendor-pdfjs.test.mjs\` 核对。

只拷了抽文字用得到的：\`build/pdf.min.mjs\`、\`build/pdf.worker.min.mjs\`、\`cmaps/\`（含其 LICENSE）、包根目录的 \`LICENSE\`。
没拷：\`wasm/\`（图片解码）、\`standard_fonts/\`、\`pdf.renderer\`、\`pdf.sandbox\`、\`.map\`、\`legacy/\`。理由见 \`docs/test-reports/M5/report.md\` 的 M5b 部分。

| 文件 | 字节数 | sha256 |
|---|---|---|
${rows.join('\n')}
`);
  console.log(`已登记 ${files.length} 个文件，共 ${total} 字节`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
