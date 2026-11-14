// M5b：文字型 PDF 导入。编号对应 docs/spec-m5.md 第 ④ 节 G1–G11、B1–B4。
// 测试文件由 tests/gen-pdf-fixtures.mjs 用 Chromium 打印生成；每段原文来自 para()，期望值按 spec 的算式手算。
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import {
  shot, watchPage, waitForServiceWorker, waitAppReady, chooseFiles, waitImportDone, storedBook, storedParas,
  wipeAllData, openBookMenu,
} from './helpers.js';
import { path as txtPath, titleOf as txtTitle, tapAt, gotoChapter, backToShelf, showMenu } from './reader-helpers.js';
import { PDF_FILES, OTHER_FILES, pdfPath, expectedParas, P7_LINES } from '../gen-pdf-fixtures.mjs';

const pdfTitle = (key) => (PDF_FILES[key]?.name ?? OTHER_FILES[key]).replace(/\.pdf$/, '');
const percentOf = (page, title) => page.locator('.book', { hasText: title }).locator('.book-percent');
const failedDialog = (page) => page.getByRole('dialog', { name: '导入结果' });

async function importPdf(page, keys) {
  await chooseFiles(page, keys.map((k) => (k.startsWith('F') ? txtPath(k) : pdfPath(k))));
  await waitImportDone(page);
}

async function openPdfBook(page, key) {
  await page.getByRole('button', { name: `打开《${pdfTitle(key)}》` }).click();
  await expect(page.locator('#view-reader')).toBeVisible();
  await expect(page.locator('#reader-content .chapter-title')).toHaveCount(1);
}

/** 关掉「导入结果」框，返回框里的文字。 */
async function dismissResult(page) {
  const dialog = failedDialog(page);
  await expect(dialog).toBeVisible();
  const text = await dialog.textContent();
  await dialog.getByRole('button', { name: '知道了' }).click();
  return text;
}

let log;
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete Navigator.prototype.share;
    delete Navigator.prototype.canShare;
  });
  log = watchPage(page);
  await page.goto('./');
  await waitAppReady(page);
});
test.afterEach(() => {
  expect(log.errors).toEqual([]);
});

test('G1 + G2：P1 → 目录 5 项、每项 500 字、全书 2500 字；25 段逐字相等；来源记为 pdf', async ({ page }) => {
  await importPdf(page, ['P1']);
  await expect(page.locator('.book')).toHaveCount(1);
  await shot(page, 'M5', '20-PDF导入后书架');
  const stored = await storedBook(page, pdfTitle('P1'));
  expect(stored.toc.map((e) => e.title)).toEqual(['第一章', '第二章', '第三章', '第四章', '第五章']);
  expect(stored.toc.map((e) => e.len)).toEqual([500, 500, 500, 500, 500]);
  expect(stored.book.totalLen).toBe(5 * 5 * 100);
  expect(stored.book.source).toBe('pdf');
  expect(stored.book.encoding).toBeNull();
  expect(stored.book.fileSize).toBe(statSync(pdfPath('P1')).size);
  for (let c = 1; c <= 5; c++) {
    expect(await storedParas(page, pdfTitle('P1'), c - 1)).toEqual(expectedParas('P1', c));
  }
  // 页眉「测试书名」和页码没有混进正文
  const all = (await Promise.all([0, 1, 2, 3, 4].map((i) => storedParas(page, pdfTitle('P1'), i)))).flat().join('');
  expect(all).not.toContain('测试书名');
});

test('G3：P2 → 各章 300、600、900、1200 字，全书 3000', async ({ page }) => {
  await importPdf(page, ['P2']);
  const stored = await storedBook(page, pdfTitle('P2'));
  expect(stored.toc.map((e) => e.len)).toEqual([300, 600, 900, 1200]);
  expect(stored.book.totalLen).toBe(3000);
  for (let c = 1; c <= 4; c++) expect(await storedParas(page, pdfTitle('P2'), c - 1)).toEqual(expectedParas('P2', c));
});

test('G4 / G5：P2 目录点第 2 项 → 已读 30%；点第 3 项 → 已读 60%', async ({ page }) => {
  await importPdf(page, ['P2']);
  await openPdfBook(page, 'P2');
  await shot(page, 'M5', '21-PDF的书在阅读页');
  await gotoChapter(page, 2);
  await backToShelf(page);
  await expect(percentOf(page, pdfTitle('P2'))).toHaveText('已读 30%');
  await openPdfBook(page, 'P2');
  await gotoChapter(page, 3);
  await backToShelf(page);
  await expect(percentOf(page, pdfTitle('P2'))).toHaveText('已读 60%');
});

test('G6：P3（没有标题，60 段）→ 目录 2 项：5000 字 + 1000 字', async ({ page }) => {
  await importPdf(page, ['P3']);
  const stored = await storedBook(page, pdfTitle('P3'));
  expect(stored.toc.map((e) => e.len)).toEqual([5000, 1000]);
  const paras = [...await storedParas(page, pdfTitle('P3'), 0), ...await storedParas(page, pdfTitle('P3'), 1)];
  expect(paras).toEqual(expectedParas('P3', 1));
});

test('G7：P5（3 页，不足 5 页）→ 目录 1 项 300 字，3 段逐字相等，页码被去掉', async ({ page }) => {
  await importPdf(page, ['P5']);
  const stored = await storedBook(page, pdfTitle('P5'));
  expect(stored.toc.map((e) => [e.title, e.len])).toEqual([['第一章', 300]]);
  expect(await storedParas(page, pdfTitle('P5'), 0)).toEqual(expectedParas('P5', 1));
});

test('B1：P4（只有空白页）→ 不进书架，失败原因「没有可提取的文字」', async ({ page }) => {
  await importPdf(page, ['P4']);
  const text = await dismissResult(page);
  expect(text).toContain('这个 PDF 里没有可提取的文字（可能是扫描版）');
  await expect(page.locator('.book')).toHaveCount(0);
});

test('B2：内容是文字、扩展名是 .pdf → 失败原因「不是有效的 PDF 文件」', async ({ page }) => {
  await importPdf(page, ['B2']);
  const text = await dismissResult(page);
  expect(text).toContain('不是有效的 PDF 文件');
  await expect(page.locator('.book')).toHaveCount(0);
});

test('B3：一次选 F2（txt）+ P1（pdf）+ 一个 .jpg → 书架 2 本，成功 2、失败 1', async ({ page }) => {
  await importPdf(page, ['F2', 'P1', 'B3']);
  const text = await dismissResult(page);
  expect(text).toContain('成功 2 本');
  expect(text).toContain('失败 1 本');
  expect(text).toContain(`${OTHER_FILES.B3}：不是 txt 或 pdf 文件`);
  await expect(page.locator('.book')).toHaveCount(2);
  const titles = await page.locator('.book-title').allTextContents();
  expect(titles.sort()).toEqual([txtTitle('F2'), pdfTitle('P1')].sort());
});

test('B4：同一个 P1 导入两次 → 书架 1 本，提示已在书架', async ({ page }) => {
  await importPdf(page, ['P1']);
  await importPdf(page, ['P1']);
  const text = await dismissResult(page);
  expect(text).toContain(pdfTitle('P1'));
  expect(text).toMatch(/已在书架/);
  await expect(page.locator('.book')).toHaveCount(1);
});

test('导入时进度提示带页码：「正在导入 1/1：书名（第 x / y 页）」', async ({ page }) => {
  const seen = [];
  await page.exposeFunction('__status', (t) => seen.push(t));
  await page.evaluate(() => {
    const el = document.getElementById('import-status');
    new MutationObserver(() => window.__status(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await importPdf(page, ['P1']);
  expect(seen.some((t) => /^正在导入 1\/1：P1-五章（第 \d+ \/ 8 页）$/.test(t))).toBe(true);
});

test('PDF 来的书，「更多操作」里没有「换编码重新导入」；txt 的书有', async ({ page }) => {
  await importPdf(page, ['F2', 'P1']);
  await openBookMenu(page, pdfTitle('P1'));
  const pdfMenu = page.getByRole('dialog', { name: `《${pdfTitle('P1')}》` });
  await expect(pdfMenu.getByRole('button', { name: '删除' })).toBeVisible();
  await expect(pdfMenu.getByRole('button', { name: '换编码重新导入' })).toHaveCount(0);
  await shot(page, 'M5', '22-PDF书的更多操作');
  await pdfMenu.getByRole('button', { name: '取消' }).click();
  await openBookMenu(page, txtTitle('F2'));
  await expect(page.getByRole('dialog', { name: `《${txtTitle('F2')}》` }).getByRole('button', { name: '换编码重新导入' })).toBeVisible();
});

test('标准字体不嵌入的 PDF（P7）：不带 standard_fonts 也能抽出文字', async ({ page }) => {
  await importPdf(page, ['P7']);
  const stored = await storedBook(page, pdfTitle('P7'));
  expect(stored.toc.map((e) => e.title)).toEqual([P7_LINES[0]]);
  expect(await storedParas(page, pdfTitle('P7'), 0)).toEqual([P7_LINES[1]]);
});

test('有密码的 PDF（降级）：pdf.js 自己的 PasswordException → 提示「这个 PDF 有密码保护」', async ({ page }) => {
  // 带密码的测试文件生成不了（spec ④ 允许降级）。这里用 pdf.js 真正的异常类构造异常，走 App 的转换函数。
  const reason = await page.evaluate(async () => {
    const pdfjs = await import(new URL('vendor/pdfjs/pdf.min.mjs', document.baseURI).href);
    const { reasonFor } = await import(new URL('js/importer/pdf-extract.js', document.baseURI).href);
    return reasonFor(new pdfjs.PasswordException('need password', pdfjs.PasswordResponses.NEED_PASSWORD));
  });
  expect(reason).toBe('这个 PDF 有密码保护');
});

test('G8：断网后导入 P1 → 成功；没有资源加载失败，没有本站以外的请求', async ({ page, context, baseURL }) => {
  await waitForServiceWorker(page);
  await context.setOffline(true);
  log.failed.length = 0;
  log.requests.length = 0;
  await page.reload();
  await waitAppReady(page);
  await importPdf(page, ['P1']);
  const stored = await storedBook(page, pdfTitle('P1'));
  expect(stored.book.totalLen).toBe(2500);
  expect(log.failed).toEqual([]);
  expect(log.requests.filter((u) => !u.startsWith(new URL(baseURL).origin))).toEqual([]);
  // pdf.js 确实是从离线缓存加载的
  expect(log.requests.some((u) => u.endsWith('vendor/pdfjs/pdf.worker.min.mjs'))).toBe(true);
  await context.setOffline(false);
});

/** 导出备份，返回文件路径（同 M4）。 */
async function exportBackup(page, testInfo, { includeText }) {
  await page.getByRole('button', { name: '更多', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '更多' });
  if (includeText) await panel.getByLabel('包含书的正文').check();
  await panel.getByRole('button', { name: '生成备份' }).click();
  await expect(page.locator('#backup-ready')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: '保存到文件' }).click(),
  ]);
  const file = join(testInfo.outputDir, download.suggestedFilename());
  await download.saveAs(file);
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  return file;
}

async function restoreFrom(page, file) {
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.locator('#restore-input').setInputFiles(file);
  const result = page.getByRole('dialog', { name: '恢复完成' });
  await expect(result).toBeVisible();
  await result.getByRole('button', { name: '知道了' }).click();
}

/** P1 读到第 3 项（下标 2）后回书架。 */
async function readP1ToChapter3(page) {
  await importPdf(page, ['P1']);
  await openPdfBook(page, 'P1');
  await gotoChapter(page, 2);
  await backToShelf(page);
  await expect(percentOf(page, pdfTitle('P1'))).toHaveText('已读 40%');
}

test('G9：P1 读到第 3 项 → 导出含正文的备份 → 清空 → 恢复 → 书在、进度在第 3 项、第 1 段逐字相等', async ({ page }, testInfo) => {
  await readP1ToChapter3(page);
  const file = await exportBackup(page, testInfo, { includeText: true });
  expect(JSON.parse(readFileSync(file, 'utf8')).books[0].meta.source).toBe('pdf');
  await wipeAllData(page);
  await expect(page.locator('.book')).toHaveCount(0);
  await restoreFrom(page, file);
  await expect(percentOf(page, pdfTitle('P1'))).toHaveText('已读 40%');
  expect((await storedBook(page, pdfTitle('P1'))).book.source).toBe('pdf');
  expect((await storedParas(page, pdfTitle('P1'), 2))[0]).toBe(expectedParas('P1', 3)[0]);
  await openPdfBook(page, 'P1');
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第三章');
});

test('G10：P1 读到第 3 项 → 导出不含正文的备份 → 清空 → 恢复 → 提示等待重新导入 → 再导入 P1 → 进度接回第 3 项', async ({ page }, testInfo) => {
  await readP1ToChapter3(page);
  const file = await exportBackup(page, testInfo, { includeText: false });
  await wipeAllData(page);
  await restoreFrom(page, file);
  await expect(page.locator('#pending-notice')).toContainText('有 1 本书等待重新导入');
  await expect(page.locator('#pending-notice')).toContainText(`《${pdfTitle('P1')}》`);
  await importPdf(page, ['P1']);
  await expect(page.locator('#pending-notice')).toBeHidden();
  await expect(percentOf(page, pdfTitle('P1'))).toHaveText('已读 40%');
  await openPdfBook(page, 'P1');
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第三章');
});

test('G11：500 页以上的 PDF 能导入，电脑上 ≤ 60 秒（耗时记进报告）', async ({ page }) => {
  test.setTimeout(180_000);
  const started = Date.now();
  await importPdf(page, ['G11']);
  const ms = Date.now() - started;
  const stored = await storedBook(page, pdfTitle('G11'));
  expect(stored.toc).toHaveLength(100);
  expect(stored.book.totalLen).toBe(100 * 18 * 100);
  expect((await storedParas(page, pdfTitle('G11'), 99)).at(-1)).toBe(expectedParas('G11', 100).at(-1));
  console.log(`G11 导入耗时 ${ms} 毫秒（529 页）`);
  expect(ms).toBeLessThanOrEqual(60_000);
});

test('PDF 的书能翻页、能调字号（和 txt 一样走阅读页）', async ({ page }) => {
  await importPdf(page, ['P3']);
  await page.evaluate(async () => {
    const settings = await import(new URL('js/settings.js', document.baseURI).href);
    await settings.updateSetting('mode', 'page');
  });
  await openPdfBook(page, 'P3');
  await tapAt(page, 5 / 6, 0.5);
  await expect(page.locator('#reader-content')).toHaveAttribute('data-page', '1');
  await showMenu(page);
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('button', { name: '增大字号' }).click();
  await expect(page.locator('#setting-fontSize')).not.toHaveText('');
});
