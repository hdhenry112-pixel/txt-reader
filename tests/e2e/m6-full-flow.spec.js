// M6：全流程。编号对应 docs/spec-m6.md：② 的第 1–10 步、③ 的 E1–E4、④ 的 M1–M7。
// 一个测试从头走到尾，中间不清数据、不换浏览器，前一步的结果就是后一步的起点。
// 各里程碑测试里的小工具（翻页、画图案、导出备份）照抄过来，不去改旧测试文件（spec-m6「明确不做」）。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES } from '../gen-fixtures.mjs';
import { PDF_FILES, pdfPath, expectedParas } from '../gen-pdf-fixtures.mjs';
import {
  shot, watchPage, waitForServiceWorker, waitAppReady, chooseFiles, waitImportDone,
  storedBook, wipeAllData, setServerVersion,
} from './helpers.js';
import {
  path, titleOf, F1_TITLES, tapAt, showMenu, gotoChapter, backToShelf, storedProgress, isCharOnScreen,
} from './reader-helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_VERSION = readFileSync(join(HERE, '..', '..', 'sw.js'), 'utf8').match(/^const VERSION = '([^']+)';$/m)[1];
const P1_TITLE = PDF_FILES.P1.name.replace(/\.pdf$/, '');
const RIGHT = [0, 1, 2, 5];
const M = 'M6';

// ---------- 操作 ----------

const content = (page) => page.locator('#reader-content');
const chapterTitle = (page) => page.locator('#reader-content .chapter-title');
const tapNext = (page) => tapAt(page, 5 / 6, 0.5);
const tapAbovePanel = (page) => tapAt(page, 0.5, 0.2);
const morePanel = (page) => page.getByRole('dialog', { name: '更多' });

async function expectPage(page, n) {
  await expect(content(page)).toHaveAttribute('data-page', String(n));
  await page.waitForTimeout(280); // 翻页过渡 200 毫秒
}

async function swipe(page, dx) {
  const box = await page.locator('#reader-scroll').boundingBox();
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width / 2 - dx / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move(x0 + dx / 2, y + 3, { steps: 4 });
  await page.mouse.move(x0 + dx, y + 5, { steps: 4 });
  await page.mouse.up();
}

async function openBookByTitle(page, title) {
  await page.getByRole('button', { name: `打开《${title}》` }).click();
  await expect(page.locator('#view-reader')).toBeVisible();
  await expect(chapterTitle(page)).toHaveCount(1);
}

async function openSettings(page) {
  await showMenu(page);
  if (await page.locator('#settings-panel').isHidden()) {
    await page.getByRole('button', { name: '设置' }).click();
  }
  await expect(page.locator('#settings-panel')).toBeVisible();
}

async function closeSettings(page) {
  await tapAbovePanel(page);
  await expect(page.locator('#settings-panel')).toBeHidden();
  await page.waitForTimeout(100);
}

const readerStyle = (page) => page.evaluate(() => {
  const style = getComputedStyle(document.getElementById('reader-content'));
  return {
    theme: document.documentElement.dataset.theme,
    fontSize: parseFloat(style.fontSize),
    lineHeight: Math.round(parseFloat(style.lineHeight) * 100) / 100,
    paddingLeft: parseFloat(style.paddingLeft),
  };
});

/** 每本书的书名、字数、章数、进度 %（M4 / M5 比对用的口径）。按书名排序。 */
const snapshot = (page) => page.evaluate(async () => {
  const base = document.baseURI;
  const books = await import(new URL('js/storage/books.js', base).href);
  const progress = await import(new URL('js/storage/progress.js', base).href);
  const rows = [];
  for (const b of await books.listBooks()) {
    const p = await progress.getProgress(b.id);
    rows.push({ title: b.title, totalLen: b.totalLen, chapterCount: b.chapterCount, percent: p?.percent ?? null });
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title));
});

async function exportBackup(page, testInfo) {
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await expect(morePanel(page)).toBeVisible();
  await morePanel(page).getByLabel('包含书的正文').check();
  await morePanel(page).getByRole('button', { name: '生成备份' }).click();
  await expect(page.locator('#backup-ready')).toBeVisible({ timeout: 120_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    morePanel(page).getByRole('button', { name: '保存到文件' }).click(),
  ]);
  const file = join(testInfo.outputDir, download.suggestedFilename());
  await download.saveAs(file);
  await morePanel(page).getByRole('button', { name: '关闭', exact: true }).click();
  await expect(morePanel(page)).toBeHidden();
  return file;
}

async function restoreFrom(page, file) {
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await expect(morePanel(page)).toBeVisible();
  await page.locator('#restore-input').setInputFiles(file);
  const result = page.getByRole('dialog', { name: /恢复完成|恢复失败/ });
  await expect(result).toBeVisible({ timeout: 120_000 });
  const text = await result.textContent();
  await result.getByRole('button', { name: '知道了' }).click();
  await expect(result).toBeHidden();
  if (await morePanel(page).isVisible()) {
    await morePanel(page).getByRole('button', { name: '关闭', exact: true }).click();
  }
  return text;
}

async function draw(page, hostId, seq) {
  const host = page.locator(`#${hostId}`);
  const centers = [];
  for (const i of seq) {
    const box = await host.locator(`[data-dot="${i}"]`).boundingBox();
    centers.push([box.x + box.width / 2, box.y + box.height / 2]);
  }
  await page.mouse.move(...centers[0]);
  await page.mouse.down();
  for (const [x, y] of centers.slice(1)) await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
}

async function setVisibility(page, state) {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/** 新开一个页面（相当于划掉 App 后从主屏幕重新打开）。 */
async function newAppPage(context) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    // 电脑上的 WebKit 带系统分享面板时会弹出测试点不到的原生窗口；去掉它，「保存到文件」走直接下载（同 M4）。
    delete Navigator.prototype.share;
    delete Navigator.prototype.canShare;
  });
  return page;
}

// ---------- 测试 ----------

test.afterEach(async ({ request }) => {
  await setServerVersion(request, null);
});

test('全流程：② 的 10 步依次走完，每步截图；更新后数据还在；全程无多余请求；断网可读', async ({ context, request, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const logs = [];
  const watch = (p) => { const log = watchPage(p); logs.push(log); return log; };
  const allErrors = () => logs.flatMap((l) => l.errors);
  const allRequests = () => logs.flatMap((l) => l.requests);
  // E3 的范围：第 1 步页面加载完成到第 7 步导出结束。
  let e3Start = 0;

  // ---- 第 1 步：打开 App ----
  let page = await newAppPage(context);
  watch(page);
  await page.goto('./');
  await waitAppReady(page);
  await waitForServiceWorker(page);
  await expect(page.locator('#app-version')).toHaveText(REAL_VERSION);
  await expect(page.getByText('还没有书')).toBeVisible();
  await shot(page, M, '01-打开App');
  e3Start = allRequests().length;

  // ---- 第 2 步：一次导入两本 txt 和一个 PDF（M1）----
  await chooseFiles(page, [path('F1'), path('F2'), pdfPath('P1')]);
  await waitImportDone(page);
  await expect(page.locator('.book')).toHaveCount(3);
  const f1 = await storedBook(page, titleOf('F1'));
  expect(f1.toc.map((e) => e.title)).toEqual(F1_TITLES); // A1
  expect(f1.toc.map((e) => e.len)).toEqual([200, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]); // A2
  expect(f1.book.totalLen).toBe(55200);
  const f2 = await storedBook(page, titleOf('F2'));
  expect([f2.toc.length, f2.book.totalLen]).toEqual([5, 2500]); // A4
  const p1 = await storedBook(page, P1_TITLE);
  expect(p1.book.source).toBe('pdf');
  expect(p1.toc.map((e) => e.len)).toEqual([500, 500, 500, 500, 500]); // G1
  await shot(page, M, '02-导入两本txt和一个PDF');

  // ---- 第 3 步：点书 → 目录 → 跳到第 7 项（M2）----
  await openBookByTitle(page, titleOf('F1'));
  await gotoChapter(page, 7);
  await expect(chapterTitle(page)).toHaveText(F1_TITLES[7]);
  await shot(page, M, '03-目录跳到第7项');

  // ---- 第 4 步：翻页模式：点右侧、向左滑；翻到章末进下一章 ----
  await expect(page.locator('#view-reader')).toHaveAttribute('data-mode', 'page'); // 默认翻页模式
  await tapNext(page);
  await expectPage(page, 1);
  await swipe(page, -150);
  await expectPage(page, 2);
  const pages7 = Number(await content(page).getAttribute('data-pages'));
  for (let n = 3; n < pages7; n++) {
    await tapNext(page);
    await expectPage(page, n);
  }
  await tapNext(page);
  await expect(chapterTitle(page)).toHaveText(F1_TITLES[8]);
  await expectPage(page, 0);
  await tapNext(page);
  await expectPage(page, 1);
  await shot(page, M, '04-翻到下一章第2页');

  // ---- 第 5 步：改字号、行距、页边距、主题、阅读模式，立即生效 ----
  const offsetBefore = (await storedProgress(page, 'F1')).offset;
  await openSettings(page);
  await page.getByRole('button', { name: '增大字号' }).click();
  await page.getByRole('button', { name: '增大行距' }).click();
  await page.getByRole('button', { name: '增大页边距' }).click();
  await page.getByRole('button', { name: '护眼' }).click();
  // 19 → 20；1.8 → 1.9，行高 20 × 1.9 = 38；页边距 20 → 24。
  // 点按钮后 App 先写数据库、写完才改排版（settings-panel.js 的 onClick），所以反复量直到对上，不能点完立刻量一次。
  await expect.poll(() => readerStyle(page)).toEqual({ theme: 'sepia', fontSize: 20, lineHeight: 38, paddingLeft: 24 });
  await page.getByRole('button', { name: '滚动', exact: true }).click();
  await expect(page.locator('#view-reader')).toHaveAttribute('data-mode', 'scroll');
  await closeSettings(page);
  expect(await isCharOnScreen(page, offsetBefore)).toBe(true);
  await openSettings(page);
  await page.getByRole('button', { name: '翻页', exact: true }).click();
  await expect(page.locator('#view-reader')).toHaveAttribute('data-mode', 'page');
  await closeSettings(page);
  expect(await isCharOnScreen(page, offsetBefore)).toBe(true);
  await shot(page, M, '05-改完设置');

  // ---- 第 6 步：划掉 App → 断网 → 重新打开 → 回到原位置（M3；E4 断网可读，M7）----
  const before6 = await storedProgress(page, 'F1');
  expect(before6.chapterIdx).toBe(8);
  await page.close();
  await context.setOffline(true);
  page = await newAppPage(context);
  const offlineLog = watch(page);
  await page.goto('./'); // 断网时这一步要是失败会直接抛错（CLAUDE.md ⑧：不能只看旧页面上的文字）
  await waitAppReady(page);
  await expect(page.locator('#app-version')).toHaveText(REAL_VERSION);
  await expect(page.locator('.book')).toHaveCount(3);
  await openBookByTitle(page, titleOf('F1'));
  await expect(chapterTitle(page)).toHaveText(F1_TITLES[8]);
  const after6 = await storedProgress(page, 'F1');
  expect([after6.chapterIdx, after6.offset, after6.percent]).toEqual([before6.chapterIdx, before6.offset, before6.percent]);
  expect(await isCharOnScreen(page, before6.offset)).toBe(true);
  expect(await readerStyle(page)).toEqual({ theme: 'sepia', fontSize: 20, lineHeight: 38, paddingLeft: 24 });
  await shot(page, M, '06-断网重新打开回到原位置');
  // 断网状态下继续：翻页、改一项设置、回书架
  const pageNow = Number(await content(page).getAttribute('data-page'));
  await tapNext(page);
  await expectPage(page, pageNow + 1);
  await openSettings(page);
  await page.getByRole('button', { name: '减小字号' }).click();
  await expect(page.locator('#setting-fontSize')).toHaveText('19');
  await closeSettings(page);
  await backToShelf(page);
  expect(offlineLog.failed).toEqual([]);
  await context.setOffline(false);

  // ---- 第 7 步：导出备份 → 清空 → 恢复（M4）----
  const before7 = await snapshot(page);
  expect(before7.find((b) => b.title === titleOf('F1')).percent).toBeGreaterThan(0);
  const backupFile = await exportBackup(page, testInfo);
  // E3 / M6：从第 1 步加载完成到导出结束，所有请求都在本站地址下
  const e3 = allRequests().slice(e3Start);
  expect(e3.length).toBeGreaterThan(0);
  expect(e3.filter((url) => !url.startsWith(baseURL))).toEqual([]);
  await wipeAllData(page);
  await expect(page.locator('.book')).toHaveCount(0);
  const restoreText = await restoreFrom(page, backupFile);
  expect(restoreText).toContain('恢复完成');
  await expect(page.locator('.book')).toHaveCount(3);
  expect(await snapshot(page)).toEqual(before7);
  await shot(page, M, '07-恢复备份后');

  // ---- 第 8 步：发布新版本 → 提示 → 点击 → 书和进度都在（E2，M5）----
  await setServerVersion(request, '9.9.9');
  await page.reload();
  await waitAppReady(page);
  const toast = page.getByRole('button', { name: '有新版本，点击刷新' });
  await expect(toast).toBeVisible();
  await shot(page, M, '08a-有新版本提示');
  await toast.click();
  await expect(page.locator('#app-version')).toHaveText('9.9.9');
  await waitAppReady(page);
  await expect(page.locator('.book')).toHaveCount(3);
  expect(await snapshot(page)).toEqual(before7);
  await shot(page, M, '08b-更新后书和进度都在');

  // ---- 第 9 步：开启手势密码 → 重新打开要画图案 → 切到后台画面被遮住 ----
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await morePanel(page).getByRole('button', { name: '开启', exact: true }).click();
  await expect(page.locator('#sheet-title')).toHaveText('画一个新图案');
  await draw(page, 'sheet-pad', RIGHT);
  await expect(page.locator('#sheet-title')).toHaveText('再画一次确认');
  await draw(page, 'sheet-pad', RIGHT);
  await expect(page.locator('#lock-status')).toContainText('已开启');
  await morePanel(page).getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await waitAppReady(page);
  await expect(page.locator('#lock-screen')).toBeVisible();
  await expect(page.locator('#view-shelf')).toBeHidden();
  await shot(page, M, '09a-重新打开要画图案');
  await draw(page, 'lock-pad', RIGHT);
  await expect(page.locator('#lock-screen')).toBeHidden();
  await setVisibility(page, 'hidden');
  expect(await page.evaluate(() => document.documentElement.dataset.covered ?? null)).toBe('1');
  await expect(page.locator('#view-shelf')).toBeHidden();
  await shot(page, M, '09b-切到后台被遮住');
  await setVisibility(page, 'visible');
  expect(await page.evaluate(() => document.documentElement.dataset.covered ?? null)).toBeNull();
  await expect(page.locator('#view-shelf')).toBeVisible();

  // ---- 第 10 步：阅读 PDF 来的书 ----
  await openBookByTitle(page, P1_TITLE);
  await expect(chapterTitle(page)).toHaveText('第一章');
  const firstPara = await page.locator('#reader-content p').first().textContent();
  expect(firstPara).toBe(expectedParas('P1', 1)[0]);
  // 这一章排得下一页就翻进第二章，排不下就翻到第 2 页
  const pdfPages = Number(await content(page).getAttribute('data-pages'));
  await tapNext(page);
  if (pdfPages > 1) await expectPage(page, 1);
  else await expect(chapterTitle(page)).toHaveText('第二章');
  await shot(page, M, '10-阅读PDF的书');

  expect(allErrors()).toEqual([]);
});
