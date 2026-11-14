// M5b：pdf.js 的文件没被改过，且全部登记进了离线缓存清单（spec-m5 3.2「不许改 pdf.js 的源码，校验用 sha256」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIR, listVendorFiles, sha256 } from '../vendor-pdfjs.mjs';

const files = listVendorFiles();

/** VERSION.md 表格里登记的 { 文件: sha256 }。 */
function registered() {
  const map = new Map();
  for (const m of readFileSync(join(DIR, 'VERSION.md'), 'utf8').matchAll(/^\| `([^`]+)` \| \d+ \| `([0-9a-f]{64})` \|$/gm)) {
    map.set(`vendor/pdfjs/${m[1]}`, m[2]);
  }
  return map;
}

test('vendor/pdfjs 里有主库、worker、LICENSE 和 169 个 cmaps 文件', () => {
  assert.ok(files.includes('vendor/pdfjs/pdf.min.mjs'));
  assert.ok(files.includes('vendor/pdfjs/pdf.worker.min.mjs'));
  assert.ok(files.includes('vendor/pdfjs/LICENSE'));
  assert.equal(files.filter((f) => f.startsWith('vendor/pdfjs/cmaps/')).length, 169);
});

test('每个文件的 sha256 和 VERSION.md 登记的一致，没有多也没有少', () => {
  const map = registered();
  assert.deepEqual([...map.keys()].sort(), files);
  for (const f of files) assert.equal(sha256(f), map.get(f), `${f} 被改过`);
});

test('离线缓存清单 assets.js 和目录里的文件一一对应', () => {
  const sandbox = {};
  new Function('self', readFileSync(join(DIR, 'assets.js'), 'utf8'))(sandbox);
  assert.deepEqual(sandbox.PDFJS_ASSETS, files);
});
