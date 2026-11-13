// M4：备份与恢复、换编码重新导入、大文件、数据库迁移。
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILES, para } from '../gen-fixtures.mjs';
import {
  shot, watchPage, waitForServiceWorker, waitAppReady, wipeAllData, openBookMenu,
  storedBook, storedParas, chooseFiles, waitImportDone,
} from './helpers.js';
import {
  path, titleOf, F1_TITLES, importBooks, openBook, tapAt, showMenu, gotoChapter,
  backToShelf, expectPercent, storedProgress,
} from './reader-helpers.js';

// ---------- 操作 ----------

const content = (page) => page.locator('#reader-content');
const tapNext = (page) => tapAt(page, 5 / 6, 0.5);
const tapAbovePanel = (page) => tapAt(page, 0.5, 0.2);

/** 导出一份备份，返回存到磁盘上的文件路径。 */
async function exportBackup(page, testInfo, { includeText }) {
  await page.getByRole('button', { name: '备份', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '备份与恢复' });
  await expect(panel).toBeVisible();
  if (includeText) await panel.getByLabel('包含书的正文').check();
  await panel.getByRole('button', { name: '生成备份' }).click();
  await expect(page.locator('#backup-ready')).toBeVisible({ timeout: 120_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: '保存到文件' }).click(),
  ]);
  const file = join(testInfo.outputDir, download.suggestedFilename());
  await download.saveAs(file);
  const readyText = await page.locator('#backup-ready-text').textContent();
  await panel.getByRole('button', { name: '关闭' }).click();
  await expect(panel).toBeHidden();
  return { file, name: download.suggestedFilename(), readyText };
}

/** 选一个备份文件来恢复，返回结果弹层里的文字。 */
async function restoreFrom(page, file) {
  // 恢复失败后面板会留着（方便换一个文件再试），这时不用再点「备份」。
  if (await page.locator('#backup-panel').isHidden()) {
    await page.getByRole('button', { name: '备份', exact: true }).click();
  }
  await expect(page.getByRole('dialog', { name: '备份与恢复' })).toBeVisible();
  await page.locator('#restore-input').setInputFiles(file);
  const result = page.getByRole('dialog', { name: /恢复完成|恢复失败/ });
  await expect(result).toBeVisible({ timeout: 120_000 });
  const text = await result.textContent();
  await result.getByRole('button', { name: '知道了' }).click();
  await expect(result).toBeHidden();
  return text;
}

/** 把 App 弄成 R1 / R2 要求的状态：F1 读到第 7 项第 3 页，F2 没读过；字号 24，夜间主题。 */
async function prepareState(page) {
  await importBooks(page, ['F1', 'F2']);
  await openBook(page, 'F1');
  await gotoChapter(page, 7);
  await tapNext(page);
  await expect(content(page)).toHaveAttribute('data-page', '1');
  await tapNext(page);
  await expect(content(page)).toHaveAttribute('data-page', '2');
  await showMenu(page);
  await page.getByRole('button', { name: '设置' }).click();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '增大字号' }).click();
  await expect(page.locator('#setting-fontSize')).toHaveText('24');
  await page.getByRole('button', { name: '夜间' }).click();
  await tapAbovePanel(page);
  await expect(page.locator('#settings-panel')).toBeHidden();
  const progress = await storedProgress(page, 'F1');
  await backToShelf(page);
  const percent = await page.locator('.book', { hasText: titleOf('F1') }).locator('.book-percent').textContent();
  return { progress, percent };
}

const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme);
const pendingNotice = (page) => page.locator('#pending-notice');

// ---------- 测试 ----------

let log;
test.beforeEach(async ({ page }) => {
  // 电脑上的 WebKit 如果带系统分享面板，会弹出一个测试点不到的原生窗口。
  // 这里去掉它，让「保存到文件」走直接下载那条路。真机上的分享面板列在真机清单里。
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

test('R1：含正文的备份 → 清空全部数据 → 恢复，书、目录、正文、进度、设置都回来', async ({ page }, testInfo) => {
  const before = await prepareState(page);
  expect(before.progress.chapterIdx).toBe(7);
  expect(before.progress.offset).toBeGreaterThan(0);
  await page.getByRole('button', { name: '备份', exact: true }).click();
  await shot(page, 'M4', '01-备份面板');
  await page.getByRole('button', { name: '关闭' }).click();

  const { file, name, readyText } = await exportBackup(page, testInfo, { includeText: true });
  expect(name).toMatch(/^txt-reader-备份-\d{8}-\d{4}-含正文\.json$/);
  expect(readyText).toContain('2 本书');
  expect(readyText).toContain('包含正文');

  // 直接读导出的文件，确认里面的内容。
  const data = JSON.parse(readFileSync(file, 'utf8'));
  expect(data.app).toBe('txt-reader');
  expect(data.backupVersion).toBe(1);
  expect(data.settings).toEqual({ mode: 'page', fontSize: 24, lineHeight: 1.8, margin: 20, theme: 'night' });
  expect(data.books).toHaveLength(2);
  const f1 = data.books.find((b) => b.meta.title === titleOf('F1'));
  const f2 = data.books.find((b) => b.meta.title === titleOf('F2'));
  expect(f1.toc.map((e) => e.title)).toEqual(F1_TITLES);
  expect(f1.chapters).toHaveLength(11);
  expect(f1.chapters[3].split('\n')[0]).toBe(para('F1', 3, 1));
  expect(f1.progress).toMatchObject({ chapterIdx: 7, offset: before.progress.offset });
  expect(f2.progress).toBeNull();
  expect(f2.chapters[0].split('\n')[0]).toBe(para('F2', 1, 1));

  // 清空，相当于换了一台新手机。
  await wipeAllData(page);
  await expect(page.getByText('还没有书')).toBeVisible();
  expect(await theme(page)).toBe('day');

  const result = await restoreFrom(page, file);
  expect(result).toContain('恢复了 2 本书');
  await expect(page.locator('.book')).toHaveCount(2);
  expect(await theme(page)).toBe('night');
  await expectPercent(page, 'F1', before.percent);
  await expectPercent(page, 'F2', '已读 0%');
  await shot(page, 'M4', '02-R1-恢复后的书架');

  // 入库的数据。
  const stored = await storedBook(page, titleOf('F1'));
  expect(stored.toc.map((e) => e.len)).toEqual([200, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]);
  expect(stored.chapterRecords).toBe(11);
  expect((await storedParas(page, titleOf('F2'), 0))[0]).toBe(para('F2', 1, 1));
  expect((await storedParas(page, titleOf('F2'), 0))[0]).toContain('镕');

  // 打开 F1：回到第 7 项第 3 页，字号是 24。
  await openBook(page, 'F1');
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第二卷 新的旅程');
  await expect(content(page)).toHaveAttribute('data-page', '2');
  expect(await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('reader-content')).fontSize))).toBe(24);
  expect(await storedProgress(page, 'F1')).toMatchObject({ chapterIdx: 7, offset: before.progress.offset });
});

test('R2：不含正文的备份 → 清空 → 恢复后书架为空并提示等待重新导入 → 导入 txt 后进度自动接回', async ({ page, context }, testInfo) => {
  const before = await prepareState(page);

  // 导出不需要网络：断网状态下做。
  await waitForServiceWorker(page);
  await context.setOffline(true);
  const { file, name, readyText } = await exportBackup(page, testInfo, { includeText: false });
  await context.setOffline(false);
  expect(name).toMatch(/^txt-reader-备份-\d{8}-\d{4}\.json$/);
  expect(readyText).toContain('不含正文');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  expect(data.books).toHaveLength(2);
  expect(data.books.every((b) => b.chapters === undefined)).toBe(true);
  // 没有正文，文件很小：远小于 F1 的正文（55200 字，约 150KB）。
  expect(statSync(file).size).toBeLessThan(10_000);

  await wipeAllData(page);
  const result = await restoreFrom(page, file);
  expect(result).toContain('2 本书的备份里没有正文，等待重新导入');
  await expect(page.locator('.book')).toHaveCount(0);
  expect(await theme(page)).toBe('night');
  await expect(pendingNotice(page)).toBeVisible();
  await expect(pendingNotice(page)).toContainText('有 2 本书等待重新导入');
  await expect(pendingNotice(page)).toContainText(`《${titleOf('F1')}》`);
  await expect(pendingNotice(page)).toContainText(`《${titleOf('F2')}》`);
  await shot(page, 'M4', '03-R2-等待重新导入');

  // 刷新后提示还在（存在数据库里，不是只在内存里）。
  await page.reload();
  await waitAppReady(page);
  await expect(pendingNotice(page)).toContainText('有 2 本书等待重新导入');

  // 导入 F1：进度接回，等待列表只剩 F2。
  await importBooks(page, ['F1']);
  await expectPercent(page, 'F1', before.percent);
  await expect(pendingNotice(page)).toContainText('有 1 本书等待重新导入');
  await expect(pendingNotice(page)).not.toContainText(titleOf('F1'));
  await openBook(page, 'F1');
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第二卷 新的旅程');
  await expect(content(page)).toHaveAttribute('data-page', '2');
  await backToShelf(page);

  // 导入一本不相干的书：不会误认领 F2 的记录。
  await chooseFiles(page, [path('F3')]);
  await waitImportDone(page);
  await expect(pendingNotice(page)).toContainText('有 1 本书等待重新导入');

  // 导入 F2：提示消失。
  await chooseFiles(page, [path('F2')]);
  await waitImportDone(page);
  await expect(page.locator('.book')).toHaveCount(3);
  await expect(pendingNotice(page)).toBeHidden();
  await expectPercent(page, 'F2', '已读 0%');
});

test('恢复到已有书的书架上：已有的书正文不动、进度以备份为准；备份里多出来的书被加进来；原有的其他书不受影响', async ({ page }, testInfo) => {
  await prepareState(page);
  const { file } = await exportBackup(page, testInfo, { includeText: true });
  await wipeAllData(page);

  // 新手机上已经有 F1（没读过）和 F3。
  await importBooks(page, ['F1', 'F3']);
  await expectPercent(page, 'F1', '已读 0%');
  const f1IdBefore = (await storedBook(page, titleOf('F1'))).book.id;

  const result = await restoreFrom(page, file);
  expect(result).toContain(`恢复了 1 本书（含正文）：《${titleOf('F2')}》`);
  expect(result).toContain(`1 本书已在书架上，只更新了进度：《${titleOf('F1')}》`);
  await expect(page.locator('.book')).toHaveCount(3);

  const f1 = await storedBook(page, titleOf('F1'));
  expect(f1.book.id).toBe(f1IdBefore);  // 还是原来那本，没有多出一本
  expect(f1.chapterRecords).toBe(11);
  expect(await storedProgress(page, 'F1')).toMatchObject({ chapterIdx: 7 });
  expect((await storedBook(page, titleOf('F3'))).chapterRecords).toBe(5);
});

test('选了不是备份的文件：提示原因，书架不变', async ({ page }, testInfo) => {
  await importBooks(page, ['F2']);

  expect(await restoreFrom(page, path('F2'))).toContain('文件不是合法的 JSON');
  mkdirSync(testInfo.outputDir, { recursive: true });

  const other = join(testInfo.outputDir, '别的程序.json');
  writeFileSync(other, JSON.stringify({ app: 'something-else', books: [] }));
  expect(await restoreFrom(page, other)).toContain('这不是本 App 的备份文件');

  const newer = join(testInfo.outputDir, '更新的版本.json');
  writeFileSync(newer, JSON.stringify({ app: 'txt-reader', backupVersion: 2, books: [] }));
  expect(await restoreFrom(page, newer)).toContain('更新版本的 App 导出的');

  // 目录 2 项但正文只有 1 章：内容不完整，整份都不恢复。
  const broken = join(testInfo.outputDir, '残缺.json');
  writeFileSync(broken, JSON.stringify({
    app: 'txt-reader', backupVersion: 1, settings: { theme: 'night' },
    books: [{ meta: { id: 'x', title: '残缺', fileName: 'x.txt', fileSize: 1 }, toc: [{ title: 'a', len: 1 }, { title: 'b', len: 1 }], chapters: ['甲'] }],
  }));
  expect(await restoreFrom(page, broken)).toContain('备份文件的内容不完整');
  // 内容不完整时一点都不写：连设置也没有被改。
  expect(await theme(page)).toBe('day');

  await page.getByRole('button', { name: '关闭' }).click();
  await expect(page.locator('.book')).toHaveCount(1);
  await shot(page, 'M4', '04-恢复失败后书架不变');
});

test('包含正文的备份预计超过 100MB 时先警告，点取消就不生成', async ({ page }) => {
  // 往书架里放一本「4000 万字」的书的元数据（只为让估算超过警告线，不需要真的有正文）。
  await page.evaluate(async () => {
    const books = await import(new URL('js/storage/books.js', document.baseURI).href);
    await books.saveBookRaw({
      id: 'huge', title: '很大的书', fileName: 'huge.txt', fileSize: 120_000_000, encoding: 'utf-8',
      encodingSuspect: false, totalLen: 40_000_000, chapterCount: 1, addedAt: Date.now(), lastReadAt: null,
    }, [{ title: '第 1 段', len: 40_000_000 }], ['占位']);
  });
  await page.reload();
  await waitAppReady(page);

  await page.getByRole('button', { name: '备份', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '备份与恢复' });
  // 不含正文：很小，直接生成，不警告。
  await expect(page.locator('#backup-size')).toHaveText('约 1 KB');
  // 勾上正文：4000 万字 × 3 字节 = 1.2 亿字节 ≈ 114.4MB。
  await panel.getByLabel('包含书的正文').check();
  await expect(page.locator('#backup-size')).toHaveText('约 114.4 MB');
  await panel.getByRole('button', { name: '生成备份' }).click();
  const warning = page.getByRole('dialog', { name: '备份文件会很大' });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('114.4 MB');
  await shot(page, 'M4', '05-超过100MB的警告');
  await warning.getByRole('button', { name: '取消' }).click();
  await expect(warning).toBeHidden();
  await expect(page.locator('#backup-ready')).toBeHidden();
});

test('A10：Big5 文件直接导入是乱码 → 更多操作 → 换编码重新导入选 Big5 → 目录 2 项，正文与原文逐字相等，进度回到开头', async ({ page }) => {
  await importBooks(page, ['F9']);
  const garbled = (await storedParas(page, titleOf('F9'), 0))[0];
  expect(garbled).not.toBe(para('F9', 1, 1));
  const idBefore = (await storedBook(page, titleOf('F9'))).book.id;
  // 先读一下，留下进度。
  await openBook(page, 'F9');
  await backToShelf(page);
  expect(await storedProgress(page, 'F9')).not.toBeNull();

  await openBookMenu(page, titleOf('F9'));
  await shot(page, 'M4', '06-书的更多操作');
  await page.getByRole('dialog').getByRole('button', { name: '换编码重新导入' }).click();
  const chooser = page.getByRole('dialog', { name: '用哪种编码重新导入？' });
  await expect(chooser).toContainText('现在是按 GBK 解码的');
  await shot(page, 'M4', '07-选择编码');
  // 选好编码后 App 会自己打开文件选择界面。
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    chooser.getByRole('button', { name: 'Big5（繁体中文）' }).click(),
  ]);
  await fileChooser.setFiles(path('F9'));
  await expect(page.getByText(`《${titleOf('F9')}》已按 BIG5 重新导入，共 2 章`)).toBeVisible();

  const after = await storedBook(page, titleOf('F9'));
  expect(after.book.id).toBe(idBefore);
  expect(after.book.encoding).toBe('big5');
  expect(after.toc).toEqual([{ title: '第一章', len: 200 }, { title: '第二章', len: 200 }]);
  expect(after.chapterRecords).toBe(2);
  expect((await storedParas(page, titleOf('F9'), 0))[0]).toBe(para('F9', 1, 1));
  expect(await storedProgress(page, 'F9')).toBeNull();
  await expect(page.locator('.book')).toHaveCount(1);

  await openBook(page, 'F9');
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第一章');
  expect(await page.locator('#reader-content p').first().textContent()).toBe(para('F9', 1, 1));
  await shot(page, 'M4', '08-A10-换编码后正文正常');
});

test('换编码重新导入时选了不是 txt 的文件：提示失败，原来的书不变', async ({ page }) => {
  await importBooks(page, ['F2']);
  await openBookMenu(page, titleOf('F2'));
  await page.getByRole('dialog').getByRole('button', { name: '换编码重新导入' }).click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('dialog').getByRole('button', { name: 'UTF-8' }).click(),
  ]);
  await fileChooser.setFiles({ name: '照片.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8]) });
  const failed = page.getByRole('dialog', { name: '重新导入失败' });
  await expect(failed).toContainText('照片.jpg：不是 txt 文件');
  await expect(failed).toContainText('原来的书没有被改动');
  await failed.getByRole('button', { name: '知道了' }).click();
  expect((await storedParas(page, titleOf('F2'), 0))[0]).toBe(para('F2', 1, 1));
  expect((await storedBook(page, titleOf('F2'))).book.encoding).toBe('gbk');
});

test('L1 / L2 / L3：22MB 的 F4 能导入，目录 2000 项，打开第 1000 项只渲染这一章，各步耗时在门槛内', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  expect(statSync(path('F4')).size).toBeGreaterThan(20 * 1024 * 1024);
  const timings = {};

  // L1：导入。
  let t = Date.now();
  await chooseFiles(page, [path('F4')]);
  await waitImportDone(page);
  await expect(page.locator('.book')).toHaveCount(1);
  timings['导入 22MB 文件'] = Date.now() - t;
  const stored = await storedBook(page, titleOf('F4'));
  expect(stored.toc).toHaveLength(2000);
  expect(stored.book.totalLen).toBe(8_000_000); // 2000 章 × 40 段 × 100 字
  expect(stored.chapterRecords).toBe(2000);
  expect(stored.toc[0]).toEqual({ title: '第1章', len: 4000 });
  expect(stored.toc[1999]).toEqual({ title: '第2000章', len: 4000 });

  // 刷新后书架还能很快出来（书架页不读正文）。
  t = Date.now();
  await page.reload();
  await waitAppReady(page);
  await expect(page.locator('.book')).toHaveCount(1);
  timings['有大书时启动到书架可用'] = Date.now() - t;

  // 打开书。
  t = Date.now();
  await openBook(page, 'F4');
  timings['打开书'] = Date.now() - t;

  // 目录 2000 项。
  await showMenu(page);
  t = Date.now();
  await page.getByRole('button', { name: '目录' }).click();
  await expect(page.locator('#toc-list button')).toHaveCount(2000);
  timings['打开 2000 项的目录'] = Date.now() - t;
  await shot(page, 'M4', '09-L1-2000项目录');

  // L2：跳到第 1000 项，DOM 里只有这一章的 40 段。
  t = Date.now();
  await page.locator('#toc-list button').nth(999).click();
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第1000章');
  timings['从目录打开一章'] = Date.now() - t;
  const paras = await page.locator('#reader-content p').allTextContents();
  expect(paras).toHaveLength(40);
  expect(paras[0]).toBe(para('F4', 1000, 1));
  expect(paras[39]).toBe(para('F4', 1000, 40));
  expect(paras.every((p) => p.startsWith('【F4-1000-'))).toBe(true);
  expect(await page.locator('#reader-content *').count()).toBe(41); // 标题 + 40 段，没有别的

  // 翻一页。
  t = Date.now();
  await tapNext(page);
  await expect(content(page)).toHaveAttribute('data-page', '1');
  timings['翻一页（到页码变化）'] = Date.now() - t;

  // 跨章翻页：翻到章末再翻一页进入第 1001 章。
  const pages = Number(await content(page).getAttribute('data-pages'));
  for (let n = 2; n < pages; n++) {
    await tapNext(page);
    await expect(content(page)).toHaveAttribute('data-page', String(n));
  }
  t = Date.now();
  await tapNext(page);
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第1001章');
  timings['翻页进入下一章'] = Date.now() - t;

  // 进度：前 1000 章 × 4000 字 ÷ 800 万字 = 50%。
  await backToShelf(page);
  await expectPercent(page, 'F4', '已读 50%');

  console.log('TIMINGS ' + JSON.stringify(timings));
  await testInfo.attach('timings', { body: JSON.stringify(timings, null, 2), contentType: 'application/json' });

  // L3 的门槛。
  expect(timings['导入 22MB 文件']).toBeLessThanOrEqual(60_000);
  expect(timings['从目录打开一章']).toBeLessThanOrEqual(1000);
  expect(timings['翻一页（到页码变化）']).toBeLessThanOrEqual(300);
});

test('大文件的备份往返：F4 含正文导出（约 23MB）→ 清空 → 恢复，2000 章都在，正文逐字相等', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await chooseFiles(page, [path('F4')]);
  await waitImportDone(page);
  const timings = {};

  let t = Date.now();
  const { file, readyText } = await exportBackup(page, testInfo, { includeText: true });
  timings['导出含正文的备份'] = Date.now() - t;
  const size = statSync(file).size;
  timings['备份文件字节数'] = size;
  expect(size).toBeGreaterThan(20 * 1024 * 1024);
  expect(readyText).toContain('1 本书');

  await wipeAllData(page);
  t = Date.now();
  expect(await restoreFrom(page, file)).toContain('恢复了 1 本书');
  timings['恢复'] = Date.now() - t;

  const stored = await storedBook(page, titleOf('F4'));
  expect(stored.toc).toHaveLength(2000);
  expect(stored.chapterRecords).toBe(2000);
  expect(stored.book.totalLen).toBe(8_000_000);
  const ch1000 = await storedParas(page, titleOf('F4'), 999);
  expect(ch1000).toHaveLength(40);
  expect(ch1000[0]).toBe(para('F4', 1000, 1));
  expect((await storedParas(page, titleOf('F4'), 1999))[39]).toBe(para('F4', 2000, 40));
  console.log('TIMINGS ' + JSON.stringify(timings));
});

test('D1：手机上版本 1 的数据库（一章一条记录）升级到版本 2，书、目录、每一章的正文、进度都不丢', async ({ page }) => {
  // 把 F1 交给页面，用来造一份「版本 1 形状」的数据。
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'd1-source';
    document.body.append(input);
  });
  await page.locator('#d1-source').setInputFiles(path('F1'));

  const made = await page.evaluate(async () => {
    const base = document.baseURI;
    const db = await import(new URL('js/storage/db.js', base).href);
    const parse = await import(new URL('js/importer/parse.js', base).href);

    // 关掉 App 自己的连接，删掉现有的库。
    (await db.getDb()).close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(db.DB_NAME);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });

    // 只用第一个迁移建库：这就是 0.3.2 及之前手机上的数据库。
    const v1 = await db.openDb({ migrations: db.MIGRATIONS.slice(0, 1) });
    const file = document.getElementById('d1-source').files[0];
    const f1 = parse.parseBook(new Uint8Array(await file.arrayBuffer()));
    // 第二本书有 120 章，升级后会跨 3 组（50 + 50 + 20），用来验证组的边界。
    const long = Array.from({ length: 120 }, (_, i) => ({ title: `第${i + 1}章`, text: `长书第${i + 1}章的正文\n第二段` }));

    const tx = v1.transaction(['books', 'tocs', 'chapters', 'progress'], 'readwrite');
    tx.objectStore('books').put({
      id: 'f1', title: 'F1-utf8-bom', fileName: file.name, fileSize: file.size, encoding: 'utf-8', encodingSuspect: false,
      totalLen: f1.totalLen, chapterCount: f1.chapters.length, addedAt: 1000, lastReadAt: 5000,
    });
    tx.objectStore('tocs').put({ bookId: 'f1', entries: f1.chapters.map((c) => ({ title: c.title, len: c.len })) });
    f1.chapters.forEach((c, idx) => tx.objectStore('chapters').put({ bookId: 'f1', idx, text: c.paras.join('\n') }));
    tx.objectStore('progress').put({ bookId: 'f1', chapterIdx: 7, offset: 0, percent: 38, updatedAt: 5000 });

    tx.objectStore('books').put({
      id: 'long', title: '长书', fileName: '长书.txt', fileSize: 123, encoding: 'utf-8', encodingSuspect: false,
      totalLen: 120 * 13, chapterCount: 120, addedAt: 2000, lastReadAt: null,
    });
    tx.objectStore('tocs').put({ bookId: 'long', entries: long.map((c) => ({ title: c.title, len: 13 })) });
    long.forEach((c, idx) => tx.objectStore('chapters').put({ bookId: 'long', idx, text: c.text }));
    await db.committed(tx);
    const out = { version: v1.version, stores: [...v1.objectStoreNames].sort() };
    v1.close();
    return out;
  });
  expect(made.version).toBe(1);
  expect(made.stores).toEqual(['books', 'chapters', 'pending', 'progress', 'settings', 'tocs']);

  // 重新加载：App 用完整的迁移打开数据库，自动升级。这就是手机上更新到 0.4.1 时发生的事。
  await page.reload();
  await waitAppReady(page);

  const after = await page.evaluate(async () => {
    const base = document.baseURI;
    const db = await import(new URL('js/storage/db.js', base).href);
    const books = await import(new URL('js/storage/books.js', base).href);
    const d = await db.getDb();
    const pick = [0, 1, 49, 50, 51, 99, 100, 119];
    const longTexts = {};
    for (const idx of pick) longTexts[idx] = (await books.getChapterParas('long', idx)).join('\n');
    return {
      version: d.version,
      stores: [...d.objectStoreNames].sort(),
      longGroups: await db.done(d.transaction('chapterGroups').objectStore('chapterGroups').count(IDBKeyRange.bound(['long', 0], ['long', 9999]))),
      longCount: await books.countChapters('long'),
      longTexts,
      beyond: await books.getChapterParas('long', 120),
    };
  });
  expect(after.version).toBe(2);
  // 旧的 chapters 仓库没有了，换成了 chapterGroups。
  expect(after.stores).toEqual(['books', 'chapterGroups', 'pending', 'progress', 'settings', 'tocs']);
  expect(after.longGroups).toBe(3); // 120 章 ÷ 50 = 3 组
  expect(after.longCount).toBe(120);
  for (const idx of [0, 1, 49, 50, 51, 99, 100, 119]) {
    expect(after.longTexts[idx], `长书第 ${idx} 章`).toBe(`长书第${idx + 1}章的正文\n第二段`);
  }
  expect(after.beyond).toBeNull();

  // 书架和进度。
  await expect(page.locator('.book')).toHaveCount(2);
  await expectPercent(page, 'F1', '已读 38%');
  const f1 = await storedBook(page, titleOf('F1'));
  expect(f1.toc.map((e) => e.title)).toEqual(F1_TITLES);
  expect(f1.toc.map((e) => e.len)).toEqual([200, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]);
  expect(f1.chapterRecords).toBe(11);
  // 每一章的正文都和原文逐字相等。
  for (let ch = 0; ch <= 10; ch++) {
    const paras = await storedParas(page, titleOf('F1'), ch);
    expect(paras, `F1 第 ${ch} 章段数`).toHaveLength(ch === 0 ? 2 : ch * 10);
    expect(paras[0]).toBe(para('F1', ch, 1));
    expect(paras[paras.length - 1]).toBe(para('F1', ch, paras.length));
  }

  // 从界面上打开：回到升级前读到的第 7 项。
  await openBook(page, 'F1');
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第二卷 新的旅程');
  expect(await page.locator('#reader-content p').first().textContent()).toBe(para('F1', 7, 1));
  await shot(page, 'M4', '10-D1-升级后打开旧书');
});

test('迁移框架：在现有版本之后再加一个迁移，已有的数据原样保留，新迁移的改动生效', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const db = await import(new URL('js/storage/db.js', document.baseURI).href);
    const name = 'txt-reader-migration-test';
    await new Promise((resolve) => { indexedDB.deleteDatabase(name).onsuccess = resolve; });

    const current = await db.openDb({ name, migrations: db.MIGRATIONS });
    const versionBefore = current.version;
    const tx = current.transaction(['books', 'chapterGroups', 'progress'], 'readwrite');
    tx.objectStore('books').put({ id: 'b1', title: '旧书', fileName: '旧书.txt', fileSize: 600 });
    tx.objectStore('chapterGroups').put({ bookId: 'b1', group: 0, texts: ['甲乙丙', '丁戊己'] });
    tx.objectStore('progress').put({ bookId: 'b1', chapterIdx: 1, offset: 2, percent: 83, updatedAt: 1 });
    await db.committed(tx);
    current.close();

    // 测试专用的下一个迁移：给每本书加一个字段。
    const addField = (database, upgradeTx) => {
      upgradeTx.objectStore('books').openCursor().onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        cursor.update({ ...cursor.value, addedByMigration: true });
        cursor.continue();
      };
    };
    const next = await db.openDb({ name, migrations: [...db.MIGRATIONS, addField] });
    const read = (store, key) => db.done(next.transaction(store).objectStore(store).get(key));
    const out = {
      versionBefore,
      versionAfter: next.version,
      book: await read('books', 'b1'),
      group: await read('chapterGroups', ['b1', 0]),
      progress: await read('progress', 'b1'),
    };
    next.close();
    await new Promise((resolve) => { indexedDB.deleteDatabase(name).onsuccess = resolve; });
    return out;
  });
  expect(result.versionAfter).toBe(result.versionBefore + 1);
  expect(result.book).toEqual({ id: 'b1', title: '旧书', fileName: '旧书.txt', fileSize: 600, addedByMigration: true });
  expect(result.group.texts).toEqual(['甲乙丙', '丁戊己']);
  expect(result.progress).toEqual({ bookId: 'b1', chapterIdx: 1, offset: 2, percent: 83, updatedAt: 1 });
});
