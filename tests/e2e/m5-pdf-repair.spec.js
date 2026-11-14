// C8 / C9：字符对照表错误的 PDF。编号对应 docs/spec-m5.md 第 ④ 节 W1–W3、X1。
// P8 / P9 由 tests/gen-broken-pdf.mjs 用独立的实现从 P1 弄坏（不用 App 的代码）；P10 正文全是生僻字。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { shot, watchPage, waitAppReady, chooseFiles, waitImportDone, storedBook, storedParas } from './helpers.js';
import { OTHER_FILES, PDF_FILES, pdfPath, expectedParas } from '../gen-pdf-fixtures.mjs';

const titleOf = (key) => (PDF_FILES[key]?.name ?? OTHER_FILES[key]).replace(/\.pdf$/, '');

/** 不经修复、直接用 pdf.js 抽 → 段落（用来证明测试文件真的坏了）。 */
const extractWithoutRepair = (page, key) => page.evaluate(async (b64) => {
  const base = document.baseURI;
  const ex = await import(new URL('js/importer/pdf-extract.js', base).href);
  const lay = await import(new URL('js/importer/pdf-layout.js', base).href);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return lay.pagesToParagraphs(await ex.extractPages(bytes));
}, readFileSync(pdfPath(key)).toString('base64'));

let log;
test.beforeEach(async ({ page }) => {
  log = watchPage(page);
  await page.goto('./');
  await waitAppReady(page);
});
test.afterEach(() => {
  expect(log.errors).toEqual([]);
});

for (const [id, key] of [['W1', 'P8'], ['W2', 'P9']]) {
  test(`${id}：${OTHER_FILES[key]} → 先确认不修复时是乱码；导入后目录 5 × 500、25 段和 P1 的原文逐字相等`, async ({ page }) => {
    // 测试文件真的坏了：不修复直接抽，25 段里至少 1 段和原文不同
    const raw = await extractWithoutRepair(page, key);
    const want = [1, 2, 3, 4, 5].flatMap((c) => expectedParas('P1', c));
    const body = raw.filter((p) => !/^第.章$/.test(p));
    expect(body.filter((p, i) => p !== want[i]).length).toBeGreaterThan(0);

    await chooseFiles(page, [pdfPath(key)]);
    await waitImportDone(page);
    await expect(page.locator('.book')).toHaveCount(1);
    const stored = await storedBook(page, titleOf(key));
    expect(stored.toc.map((e) => e.title)).toEqual(['第一章', '第二章', '第三章', '第四章', '第五章']);
    expect(stored.toc.map((e) => e.len)).toEqual([500, 500, 500, 500, 500]);
    for (let c = 1; c <= 5; c++) {
      expect(await storedParas(page, titleOf(key), c - 1)).toEqual(expectedParas('P1', c));
    }
    if (key === 'P9') {
      await page.getByRole('button', { name: `打开《${titleOf(key)}》` }).click();
      await expect(page.locator('#reader-content .chapter-title')).toHaveText('第一章');
      await shot(page, 'M5', '30-对照表错乱的PDF修复后');
    }
  });
}

test('X1：P10（正文全是生僻字）→ 不进书架，提示文字编码有错', async ({ page }) => {
  await chooseFiles(page, [pdfPath('P10')]);
  await waitImportDone(page);
  const dialog = page.getByRole('dialog', { name: '导入结果' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`${PDF_FILES.P10.name}：这个 PDF 的文字编码有错（常见于 Word 导出的 PDF），抽出来是乱码，请换一个版本`);
  await shot(page, 'M5', '31-乱码PDF被拦住');
  await dialog.getByRole('button', { name: '知道了' }).click();
  await expect(page.locator('.book')).toHaveCount(0);
});
