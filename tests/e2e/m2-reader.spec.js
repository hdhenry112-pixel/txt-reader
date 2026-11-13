// M2：阅读页（滚动模式）、目录、进度保存与恢复。
import { test, expect } from '@playwright/test';
import { para } from '../gen-fixtures.mjs';
import { shot, watchPage, waitForServiceWorker, openDeleteConfirm } from './helpers.js';
import {
  titleOf, F1_TITLES, importBooks, presetMode, openBook, tapAt, showMenu, gotoChapter,
  backToShelf, expectPercent, domParas, storedProgress,
} from './reader-helpers.js';

// 这个文件测的是滚动模式。M3 起默认是翻页模式，所以每条测试开始前先切到滚动模式。

/** 屏幕上第一个可见段落的全文（段落的任何一部分露在可见区域里就算）。 */
const firstVisiblePara = (page) => page.evaluate(() => {
  const top = document.getElementById('reader-scroll').getBoundingClientRect().top;
  for (const p of document.querySelectorAll('#reader-content p')) {
    if (p.getBoundingClientRect().bottom > top + 1) return p.textContent;
  }
  return null;
});

const scrollBy = (page, px) => page.evaluate((delta) => {
  document.getElementById('reader-scroll').scrollTop += delta;
}, px);

const scrollToBottom = (page) => page.evaluate(() => {
  const el = document.getElementById('reader-scroll');
  el.scrollTop = el.scrollHeight;
});

/** 等滚动停下后的自动保存完成（App 里是停 500 毫秒后保存）。 */
const waitAutoSave = (page) => page.waitForTimeout(900);

// ---------- 测试 ----------

let log;
test.beforeEach(async ({ page }) => {
  log = watchPage(page);
  await page.goto('./');
  await expect(page.getByText('还没有书')).toBeVisible();
  await presetMode(page, 'scroll');
});
test.afterEach(() => {
  expect(log.errors).toEqual([]);
});

test('点书进入阅读：只渲染当前章；点正文显示菜单；目录 11 项并高亮当前章', async ({ page }) => {
  await importBooks(page, ['F1']);
  await openBook(page, 'F1');
  await expect(page.locator('#view-shelf')).toBeHidden();

  // 第 0 章「前言」有 2 段，DOM 里正好这 2 段，与原文逐字相等。
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('前言');
  expect(await domParas(page)).toEqual([para('F1', 0, 1), para('F1', 0, 2)]);
  // 第一章没有「上一章」按钮。
  await expect(page.getByRole('button', { name: '上一章' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '下一章' })).toBeVisible();

  // 菜单默认隐藏，点正文后出现。
  await expect(page.locator('#reader-top')).toBeHidden();
  await expect(page.locator('#reader-bottom')).toBeHidden();
  await shot(page, 'M2', '01-阅读页');
  await showMenu(page);
  await expect(page.locator('#reader-book-title')).toHaveText(titleOf('F1'));
  await expect(page.locator('#reader-chapter-title')).toHaveText('前言');
  await expect(page.locator('#reader-percent')).toHaveText('0%');
  await shot(page, 'M2', '02-菜单');
  // 再点一次正文，菜单收起。
  await tapAt(page);
  await expect(page.locator('#reader-top')).toBeHidden();

  // 目录。
  await showMenu(page);
  await page.getByRole('button', { name: '目录' }).click();
  await expect(page.locator('#toc-list button')).toHaveText(F1_TITLES);
  await expect(page.locator('#toc-list button.current')).toHaveText(['前言']);
  await shot(page, 'M2', '03-目录');
  await page.getByRole('button', { name: '关闭' }).click();
  await expect(page.locator('#toc-panel')).toBeHidden();
});

test('P2 / P3：目录跳到第 4 项后书架显示 11%，跳到第 10 项后显示 81%', async ({ page }) => {
  await importBooks(page, ['F1']);
  await expectPercent(page, 'F1', '已读 0%'); // P1

  await openBook(page, 'F1');
  await gotoChapter(page, 4);
  // 第 4 项是「第3章 归来」，在文件里是第 4 个标题，有 40 段。DOM 里只有这一章。
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第3章 归来');
  const paras = await domParas(page);
  expect(paras).toHaveLength(40);
  expect(paras[0]).toBe(para('F1', 4, 1));
  expect(paras[39]).toBe(para('F1', 4, 40));
  // 跳章后菜单自动收起。
  await expect(page.locator('#reader-top')).toBeHidden();
  await backToShelf(page);
  await expectPercent(page, 'F1', '已读 11%');
  await shot(page, 'M2', '04-书架显示11%');

  // 再打开，回到第 4 项；目录里高亮的也是它。
  await openBook(page, 'F1');
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第3章 归来');
  await showMenu(page);
  await page.getByRole('button', { name: '目录' }).click();
  await expect(page.locator('#toc-list button.current')).toHaveText(['第3章 归来']);
  await page.locator('#toc-list button').nth(10).click();
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('番外 多年以后');
  await backToShelf(page);
  await expectPercent(page, 'F1', '已读 81%');
});

test('P4：第 10 项滚到最底，书架显示 100%', async ({ page }) => {
  await importBooks(page, ['F1']);
  await openBook(page, 'F1');
  await gotoChapter(page, 10);
  // 最后一章没有「下一章」，章末显示「全书完」。
  await expect(page.getByRole('button', { name: '下一章' })).toHaveCount(0);
  await scrollToBottom(page);
  await expect(page.getByText('全书完')).toBeInViewport();
  await backToShelf(page);
  await expectPercent(page, 'F1', '已读 100%');
});

test('「下一章」「上一章」按钮：切换章节并回到章首', async ({ page }) => {
  await importBooks(page, ['F1']);
  await openBook(page, 'F1');
  await gotoChapter(page, 2);
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第一章 起点');

  await page.getByRole('button', { name: '下一章' }).click();
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第二章　远行');
  expect((await domParas(page))[0]).toBe(para('F1', 3, 1));
  expect(await page.evaluate(() => document.getElementById('reader-scroll').scrollTop)).toBe(0);

  await page.getByRole('button', { name: '上一章' }).click();
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第一章 起点');
  expect(await domParas(page)).toHaveLength(20);
  expect(await storedProgress(page, 'F1')).toMatchObject({ chapterIdx: 2, offset: 0 });
});

test('位置恢复：章内滚动一段后刷新页面，重新打开回到同一段', async ({ page }) => {
  await importBooks(page, ['F1']);
  await openBook(page, 'F1');
  await gotoChapter(page, 7);
  await scrollBy(page, 4000);
  await waitAutoSave(page);

  const before = await firstVisiblePara(page);
  // 确实滚到了章内深处，而不是还在第一段。
  expect(before).not.toBe(para('F1', 7, 1));
  expect(before.startsWith('【F1-7-')).toBe(true);
  const saved = await storedProgress(page, 'F1');
  expect(saved.chapterIdx).toBe(7);
  expect(saved.offset).toBeGreaterThan(100);
  await shot(page, 'M2', '05-章内位置-刷新前');

  await page.reload();
  await expect(page.locator('#view-shelf')).toBeVisible();
  await openBook(page, 'F1');
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第二卷 新的旅程');
  expect(await firstVisiblePara(page)).toBe(before);
  await shot(page, 'M2', '06-章内位置-刷新后');

  // 恢复后再保存，位置不会越存越靠前：再刷新一次仍是同一段。
  await waitAutoSave(page);
  await page.reload();
  await openBook(page, 'F1');
  expect(await firstVisiblePara(page)).toBe(before);
});

test('位置恢复：滚动后立刻点「书架」（不等自动保存），再打开仍回到同一段', async ({ page }) => {
  await importBooks(page, ['F6']);
  await openBook(page, 'F6');
  // 第 7 项是 30000 字的「第二章」，是最长的一章。
  await gotoChapter(page, 7);
  await scrollBy(page, 20000);
  const before = await firstVisiblePara(page);
  expect(before.startsWith('【F6-2-')).toBe(true);
  expect(before).not.toBe(para('F6', 2, 1));
  await backToShelf(page);
  await openBook(page, 'F6');
  expect(await firstVisiblePara(page)).toBe(before);
});

test('位置恢复：滚动后不到半秒就刷新页面（来不及自动保存），靠页面关闭时的保存回到同一段', async ({ page }) => {
  await importBooks(page, ['F1']);
  await openBook(page, 'F1');
  await gotoChapter(page, 9);
  await scrollBy(page, 6000);
  const before = await firstVisiblePara(page);
  expect(before).not.toBe(para('F1', 9, 1));
  await page.reload();
  await openBook(page, 'F1');
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('楔子');
  expect(await firstVisiblePara(page)).toBe(before);
});

test('书架排序：最近读过的排在最上面', async ({ page }) => {
  await importBooks(page, ['F1', 'F2', 'F3']);
  await openBook(page, 'F3');
  await backToShelf(page);
  await openBook(page, 'F1');
  await backToShelf(page);
  // F1 最后读，F3 其次，F2 没读过排最后。
  await expect(page.locator('.book-title')).toHaveText([titleOf('F1'), titleOf('F3'), titleOf('F2')]);
});

test('位置日志：数据库没写成时，下次启动把 localStorage 里记的位置补进数据库并清掉日志', async ({ page }) => {
  await importBooks(page, ['F1']);
  const bookId = await page.evaluate(async () => {
    const books = await import(new URL('js/storage/books.js', document.baseURI).href);
    return (await books.listBooks())[0].id;
  });
  // 模拟「上次关闭时只来得及写日志」：直接往 localStorage 放一条第 4 项开头的位置。
  await page.evaluate((id) => {
    localStorage.setItem('txt-reader:position-journal', JSON.stringify({ bookId: id, chapterIdx: 4, offset: 0, percent: 11 }));
  }, bookId);
  await page.reload();
  await expectPercent(page, 'F1', '已读 11%');
  expect(await storedProgress(page, 'F1')).toMatchObject({ chapterIdx: 4, offset: 0, percent: 11 });
  expect(await page.evaluate(() => localStorage.getItem('txt-reader:position-journal'))).toBeNull();

  // 日志指向一本已经不存在的书：不报错，日志被清掉。
  await page.evaluate(() => {
    localStorage.setItem('txt-reader:position-journal', JSON.stringify({ bookId: 'no-such-book', chapterIdx: 1, offset: 0, percent: 5 }));
  });
  await page.reload();
  await expectPercent(page, 'F1', '已读 11%');
  expect(await page.evaluate(() => localStorage.getItem('txt-reader:position-journal'))).toBeNull();
});

test('删除读过的书后重新导入，进度从 0% 开始', async ({ page }) => {
  await importBooks(page, ['F2']);
  await openBook(page, 'F2');
  await gotoChapter(page, 3);
  await backToShelf(page);
  await expectPercent(page, 'F2', '已读 60%'); // 前 3 章 1500 ÷ 2500

  await openDeleteConfirm(page, titleOf('F2'));
  await page.getByRole('dialog').getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.book')).toHaveCount(0);
  await importBooks(page, ['F2']);
  await expectPercent(page, 'F2', '已读 0%');
});

test('屏幕常亮：进入阅读页时申请，回到书架时释放', async ({ page }) => {
  const wanted = () => page.evaluate(async () => {
    const m = await import(new URL('js/wakelock.js', document.baseURI).href);
    return m.isKeepAwakeWanted();
  });
  await importBooks(page, ['F2']);
  expect(await wanted()).toBe(false);
  await openBook(page, 'F2');
  expect(await wanted()).toBe(true);
  await backToShelf(page);
  expect(await wanted()).toBe(false);
});

test('断网后：能打开书、跳章、阅读，没有资源加载失败', async ({ page, context }) => {
  await importBooks(page, ['F1']);
  await waitForServiceWorker(page);
  await context.setOffline(true);
  const offlineLog = watchPage(page);
  await page.reload();
  await expect(page.locator('.book')).toHaveCount(1);
  await openBook(page, 'F1');
  await gotoChapter(page, 5);
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第十回 夜谈');
  expect((await domParas(page))[0]).toBe(para('F1', 5, 1));
  await backToShelf(page);
  await expectPercent(page, 'F1', '已读 18%'); // (200 + 10000) ÷ 55200 = 18.47%
  await shot(page, 'M2', '07-断网后阅读并返回书架');
  expect(offlineLog.failed).toEqual([]);
  expect(offlineLog.errors).toEqual([]);
  await context.setOffline(false);
});
