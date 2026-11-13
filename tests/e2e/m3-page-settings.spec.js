// M3：翻页模式、设置面板、三个主题。
import { test, expect } from '@playwright/test';
import { para } from '../gen-fixtures.mjs';
import { shot, watchPage, waitForServiceWorker, waitAppReady } from './helpers.js';
import {
  titleOf, importBooks, openBook, tapAt, showMenu, gotoChapter,
  backToShelf, expectPercent, storedProgress, isCharOnScreen,
} from './reader-helpers.js';

// ---------- 翻页模式的操作和观察 ----------

const content = (page) => page.locator('#reader-content');
const pageNo = async (page) => Number(await content(page).getAttribute('data-page'));
const pageCount = async (page) => Number(await content(page).getAttribute('data-pages'));

/** 翻页过渡是 200 毫秒。等页码变成期望值，再等过渡结束，之后量到的屏幕位置才是稳定的。 */
async function expectPage(page, n) {
  await expect(content(page)).toHaveAttribute('data-page', String(n));
  await page.waitForTimeout(280);
}

const tapNext = (page) => tapAt(page, 5 / 6, 0.5);
const tapPrev = (page) => tapAt(page, 1 / 6, 0.5);
const tapMiddle = (page) => tapAt(page, 0.5, 0.5);
/** 设置面板打开时会盖住屏幕下半部分，要收起它得点面板上方露出来的正文。 */
const tapAbovePanel = (page) => tapAt(page, 0.5, 0.2);

/** 手指在屏幕上横向滑动。dx 为负是向左滑。 */
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

/**
 * 当前屏幕上的排版情况：
 *   visible  有任何一行落在阅读区域里的段落的序号（从 0 起）
 *   clipped  有没有哪一行文字被阅读区域的边缘切掉一部分
 */
const screenLayout = (page) => page.evaluate(() => {
  const box = document.getElementById('reader-scroll').getBoundingClientRect();
  const visible = [];
  let clipped = false;
  document.querySelectorAll('#reader-content p').forEach((p, i) => {
    for (const r of p.getClientRects()) {
      const inX = r.right > box.left + 1 && r.left < box.right - 1;
      if (!inX) continue;
      if (!visible.includes(i)) visible.push(i);
      if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1) {
        clipped = true;
      }
    }
  });
  return { visible, clipped };
});

async function openSettings(page) {
  await showMenu(page);
  if (await page.locator('#settings-panel').isHidden()) {
    await page.getByRole('button', { name: '设置' }).click();
  }
  await expect(page.locator('#settings-panel')).toBeVisible();
}

const fontSizeOf = (page) => page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('reader-content')).fontSize));
const themeColors = (page) => page.evaluate(() => {
  const style = getComputedStyle(document.documentElement);
  return { theme: document.documentElement.dataset.theme, bg: style.backgroundColor, text: style.color };
});

// ---------- 测试 ----------

let log;
test.beforeEach(async ({ page }) => {
  log = watchPage(page);
  await page.goto('./');
  await waitAppReady(page);
});
test.afterEach(() => {
  expect(log.errors).toEqual([]);
});

test('默认是翻页模式：一章排成多页，翻完所有页正好看完全章，没有被切掉的行', async ({ page }) => {
  await importBooks(page, ['F1']);
  await openBook(page, 'F1');
  await expect(page.locator('#view-reader')).toHaveAttribute('data-mode', 'page');
  // 翻页模式下没有「上一章」「下一章」按钮。
  await expect(page.getByRole('button', { name: '下一章' })).toHaveCount(0);

  // 「前言」只有 200 字，一页放得下。
  expect(await pageCount(page)).toBe(1);
  await shot(page, 'M3', '01-翻页模式-前言');

  // 第 7 项有 7000 字（70 段），要很多页。
  await gotoChapter(page, 7);
  const pages = await pageCount(page);
  expect(pages).toBeGreaterThan(5);
  expect(await pageNo(page)).toBe(0);

  // 一页一页翻到底：每页都没有被切掉的行；看到的段落序号连续不跳号；最后正好看到第 70 段。
  const seen = new Set();
  let lastMax = -1;
  for (let n = 0; n < pages; n++) {
    await expectPage(page, n);
    const { visible, clipped } = await screenLayout(page);
    expect(clipped, `第 ${n} 页有被切掉的行`).toBe(false);
    expect(visible.length, `第 ${n} 页是空白页`).toBeGreaterThan(0);
    // 这一页最靠前的段落，要么接着上一页最后那一段（一段跨两页），要么是它的下一段。
    expect(Math.min(...visible)).toBeGreaterThanOrEqual(lastMax);
    expect(Math.min(...visible)).toBeLessThanOrEqual(lastMax + 1);
    lastMax = Math.max(...visible);
    visible.forEach((i) => seen.add(i));
    if (n === 2) await shot(page, 'M3', '02-翻页模式-第7项第3页');
    if (n < pages - 1) await tapNext(page);
  }
  expect(seen.size).toBe(70);
  expect(lastMax).toBe(69);
});

test('点击三个区域：右 1/3 下一页，左 1/3 上一页，中间显示菜单；菜单开着时点哪里都只是收起菜单', async ({ page }) => {
  await importBooks(page, ['F1']);
  await openBook(page, 'F1');
  await gotoChapter(page, 7);

  await tapNext(page);
  await expectPage(page, 1);
  await tapNext(page);
  await expectPage(page, 2);
  await tapPrev(page);
  await expectPage(page, 1);

  await tapMiddle(page);
  await expect(page.locator('#reader-top')).toBeVisible();
  expect(await pageNo(page)).toBe(1);

  // 菜单开着：点右侧不翻页，只收起菜单。
  await tapNext(page);
  await expect(page.locator('#reader-top')).toBeHidden();
  await page.waitForTimeout(300);
  expect(await pageNo(page)).toBe(1);

  // 菜单收起后，右侧恢复为翻页。
  await tapNext(page);
  await expectPage(page, 2);
});

test('左右滑动翻页：向左滑下一页，向右滑上一页；滑动之后不会被当成又点了一下', async ({ page }) => {
  await importBooks(page, ['F1']);
  await openBook(page, 'F1');
  await gotoChapter(page, 7);

  await swipe(page, -120);
  await expectPage(page, 1);
  await swipe(page, -120);
  await expectPage(page, 2);
  await swipe(page, 120);
  await expectPage(page, 1);
  // 滑动是在屏幕中间做的。如果滑完又被算成一次点击，菜单会弹出来。
  await expect(page.locator('#reader-top')).toBeHidden();
  // 也没有多翻一页。
  await page.waitForTimeout(400);
  expect(await pageNo(page)).toBe(1);
});

test('P8：章末再翻进入下一章第一页；章首往回翻进入上一章最后一页；全书首尾有提示', async ({ page }) => {
  await importBooks(page, ['F1']);
  await openBook(page, 'F1');

  // 全书第一页再往前翻。
  await tapPrev(page);
  await expect(page.getByText('已是第一页')).toBeVisible();
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('前言');

  // 第 2 项翻到最后一页，再翻一页 → 第 3 项第一页。
  await gotoChapter(page, 2);
  const pages2 = await pageCount(page);
  expect(pages2).toBeGreaterThan(1);
  for (let n = 1; n < pages2; n++) {
    await tapNext(page);
    await expectPage(page, n);
  }
  const lastPageOfCh2 = await screenLayout(page);
  await tapNext(page);
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第二章　远行');
  await expectPage(page, 0);
  expect(await storedProgress(page, 'F1')).toMatchObject({ chapterIdx: 3, offset: 0 });

  // 往回翻一页 → 第 2 项最后一页，看到的段落和刚才离开时一样。
  await tapPrev(page);
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第一章 起点');
  await expectPage(page, pages2 - 1);
  expect(await screenLayout(page)).toEqual(lastPageOfCh2);

  // 全书最后一页再往后翻。
  await gotoChapter(page, 10);
  const pages10 = await pageCount(page);
  for (let n = 1; n < pages10; n++) {
    await tapNext(page);
    await expectPage(page, n);
  }
  await tapNext(page);
  await expect(page.getByText('已是最后一页')).toBeVisible();
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('番外 多年以后');
  expect(await pageNo(page)).toBe(pages10 - 1);
  // P4：到了全书最后一页，书架显示 100%。
  await backToShelf(page);
  await expectPercent(page, 'F1', '已读 100%');
});

test('P2 / P3（翻页模式下）：目录跳到第 4 项 11%，第 10 项 81%', async ({ page }) => {
  await importBooks(page, ['F1']);
  await openBook(page, 'F1');
  await gotoChapter(page, 4);
  await backToShelf(page);
  await expectPercent(page, 'F1', '已读 11%');
  await openBook(page, 'F1');
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第3章 归来');
  await gotoChapter(page, 10);
  await backToShelf(page);
  await expectPercent(page, 'F1', '已读 81%');
});

test('P5 / P6 / P7：翻 5 页后刷新回到同一页；改字号、切到滚动模式、再切回翻页，原来的第一个字都还在屏幕上', async ({ page }) => {
  await importBooks(page, ['F1']);
  await openBook(page, 'F1');
  await gotoChapter(page, 7);
  for (let n = 1; n <= 5; n++) {
    await tapNext(page);
    await expectPage(page, n);
  }
  const before = await screenLayout(page);
  const saved = await storedProgress(page, 'F1');
  expect(saved.chapterIdx).toBe(7);
  expect(saved.offset).toBeGreaterThan(500);
  expect(await isCharOnScreen(page, saved.offset)).toBe(true);
  // 保存的确实是这一页的「第一个」字：它的前一个字不在这一页上。
  expect(await isCharOnScreen(page, saved.offset - 1)).toBe(false);
  await shot(page, 'M3', '03-P5-刷新前第6页');

  // P5：刷新后重新打开。
  await page.reload();
  await waitAppReady(page);
  await openBook(page, 'F1');
  await expect(page.locator('#reader-content .chapter-title')).toHaveText('第二卷 新的旅程');
  await expectPage(page, 5);
  expect(await screenLayout(page)).toEqual(before);
  const O = saved.offset;

  // P6：字号 19 → 26。
  const pagesAt19 = await pageCount(page);
  await openSettings(page);
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: '增大字号' }).click();
  await expect(page.locator('#setting-fontSize')).toHaveText('26');
  expect(await fontSizeOf(page)).toBe(26);
  await tapAbovePanel(page); // 收起菜单和设置面板
  await expect(page.locator('#settings-panel')).toBeHidden();
  await page.waitForTimeout(100);
  expect(await pageCount(page)).toBeGreaterThan(pagesAt19);
  expect(await isCharOnScreen(page, O)).toBe(true);
  expect((await screenLayout(page)).clipped).toBe(false);
  await shot(page, 'M3', '04-P6-字号26');

  // P7：切到滚动模式。
  await openSettings(page);
  await page.getByRole('button', { name: '滚动', exact: true }).click();
  await expect(page.locator('#view-reader')).toHaveAttribute('data-mode', 'scroll');
  await tapAbovePanel(page);
  await expect(page.locator('#settings-panel')).toBeHidden();
  expect(await isCharOnScreen(page, O)).toBe(true);
  await expect(page.getByRole('button', { name: '上一章' })).toHaveCount(1);
  await shot(page, 'M3', '05-P7-切到滚动模式');

  // 再切回翻页模式。
  await openSettings(page);
  await page.getByRole('button', { name: '翻页', exact: true }).click();
  await expect(page.locator('#view-reader')).toHaveAttribute('data-mode', 'page');
  await tapAbovePanel(page);
  await page.waitForTimeout(100);
  expect(await isCharOnScreen(page, O)).toBe(true);
  expect((await screenLayout(page)).clipped).toBe(false);
});

test('设置：字号、行距、页边距立即生效，到头后按钮变灰，刷新后仍然保留', async ({ page }) => {
  await importBooks(page, ['F1']);
  await openBook(page, 'F1');
  await gotoChapter(page, 3);
  await openSettings(page);
  await shot(page, 'M3', '06-设置面板');

  // 默认值。
  await expect(page.locator('#setting-fontSize')).toHaveText('19');
  await expect(page.locator('#setting-lineHeight')).toHaveText('1.8');
  await expect(page.locator('#setting-margin')).toHaveText('20');
  await expect(page.getByRole('button', { name: '翻页', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '白天' })).toHaveAttribute('aria-pressed', 'true');

  const measure = () => page.evaluate(() => {
    const style = getComputedStyle(document.getElementById('reader-content'));
    return {
      fontSize: parseFloat(style.fontSize),
      lineHeight: Math.round(parseFloat(style.lineHeight) * 100) / 100,
      paddingLeft: parseFloat(style.paddingLeft),
    };
  });
  expect(await measure()).toEqual({ fontSize: 19, lineHeight: 34.2, paddingLeft: 20 }); // 19 × 1.8

  // 字号减到最小 14：19 → 14 要点 5 次，之后「减小」变灰。
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '减小字号' }).click();
  await expect(page.locator('#setting-fontSize')).toHaveText('14');
  await expect(page.getByRole('button', { name: '减小字号' })).toBeDisabled();
  // 行距加到最大 2.2：1.8 → 2.2 要点 4 次。
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '增大行距' }).click();
  await expect(page.locator('#setting-lineHeight')).toHaveText('2.2');
  await expect(page.getByRole('button', { name: '增大行距' })).toBeDisabled();
  // 页边距 20 → 32：步长 4，点 3 次。
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '增大页边距' }).click();
  await expect(page.locator('#setting-margin')).toHaveText('32');
  expect(await measure()).toEqual({ fontSize: 14, lineHeight: 30.8, paddingLeft: 32 }); // 14 × 2.2

  // 改完之后排版仍然正常。
  await tapAbovePanel(page);
  await page.waitForTimeout(100);
  expect((await screenLayout(page)).clipped).toBe(false);

  // 刷新后设置还在。
  await page.reload();
  await waitAppReady(page);
  await openBook(page, 'F1');
  expect(await measure()).toEqual({ fontSize: 14, lineHeight: 30.8, paddingLeft: 32 });
  await openSettings(page);
  await expect(page.locator('#setting-fontSize')).toHaveText('14');
  await expect(page.locator('#setting-lineHeight')).toHaveText('2.2');
  await expect(page.locator('#setting-margin')).toHaveText('32');
});

test('主题：白天、护眼、夜间的颜色正确，书架也跟着变，刷新后保留', async ({ page }) => {
  await importBooks(page, ['F1']);
  await openBook(page, 'F1');
  await gotoChapter(page, 3);
  expect(await themeColors(page)).toEqual({ theme: 'day', bg: 'rgb(242, 241, 236)', text: 'rgb(58, 58, 56)' });

  await openSettings(page);
  await page.getByRole('button', { name: '护眼' }).click();
  expect(await themeColors(page)).toEqual({ theme: 'sepia', bg: 'rgb(244, 236, 216)', text: 'rgb(74, 64, 51)' });
  await tapAbovePanel(page);
  await expect(page.locator('#settings-panel')).toBeHidden();
  await shot(page, 'M3', '07-护眼主题');

  await openSettings(page);
  await page.getByRole('button', { name: '夜间' }).click();
  expect(await themeColors(page)).toEqual({ theme: 'night', bg: 'rgb(26, 26, 26)', text: 'rgb(140, 140, 140)' });
  // 换主题不应该改变阅读位置。
  expect(await storedProgress(page, 'F1')).toMatchObject({ chapterIdx: 3, offset: 0 });
  await shot(page, 'M3', '08-夜间主题-设置面板');
  await tapAbovePanel(page);
  await expect(page.locator('#settings-panel')).toBeHidden();
  await shot(page, 'M3', '09-夜间主题');

  await backToShelf(page);
  expect(await themeColors(page)).toMatchObject({ theme: 'night', bg: 'rgb(26, 26, 26)' });
  await shot(page, 'M3', '10-夜间主题-书架');

  await page.reload();
  await waitAppReady(page);
  expect(await themeColors(page)).toEqual({ theme: 'night', bg: 'rgb(26, 26, 26)', text: 'rgb(140, 140, 140)' });
});

test('改完设置立刻刷新页面（来不及写数据库）：设置不丢', async ({ page }) => {
  await importBooks(page, ['F1']);
  await openBook(page, 'F1');
  await openSettings(page);
  await page.getByRole('button', { name: '夜间' }).click();
  await page.getByRole('button', { name: '增大字号' }).click();
  // 不等任何东西，马上刷新。
  await page.reload();
  await waitAppReady(page);
  expect(await themeColors(page)).toMatchObject({ theme: 'night', bg: 'rgb(26, 26, 26)' });
  const saved = await page.evaluate(async () => {
    const db = await import(new URL('js/storage/db.js', document.baseURI).href);
    const d = await db.getDb();
    const record = await db.done(d.transaction('settings').objectStore('settings').get('global'));
    return { record, journal: localStorage.getItem('txt-reader:settings-journal') };
  });
  // 启动时已经把日志补进了数据库，并擦掉了日志。
  expect(saved.record).toMatchObject({ theme: 'night', fontSize: 20 });
  expect(saved.journal).toBeNull();
  await openBook(page, 'F1');
  expect(await fontSizeOf(page)).toBe(20);
});

// 上面那条靠时机，数据库有时来得及写完，抓不住「没写日志」这种错。下面两条不靠时机。

test('设置日志（写）：调用改设置的那一刻，还没等数据库写完，localStorage 里已经有新的设置', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const settings = await import(new URL('js/settings.js', document.baseURI).href);
    const pending = settings.updateSetting('theme', 'sepia'); // 故意不等它完成
    const journalRightAway = JSON.parse(localStorage.getItem('txt-reader:settings-journal'));
    await pending;
    return { journalRightAway, journalAfterCommit: localStorage.getItem('txt-reader:settings-journal') };
  });
  expect(result.journalRightAway).toMatchObject({ theme: 'sepia', fontSize: 19, mode: 'page' });
  // 数据库写成功后日志被擦掉。
  expect(result.journalAfterCommit).toBeNull();
});

test('设置日志（读）：数据库里没有、只有日志时，启动后按日志套用设置，补进数据库并擦掉日志', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('txt-reader:settings-journal', JSON.stringify({
      mode: 'scroll', fontSize: 24, lineHeight: 2, margin: 28, theme: 'night',
    }));
  });
  await page.reload();
  await waitAppReady(page);
  expect(await themeColors(page)).toMatchObject({ theme: 'night', bg: 'rgb(26, 26, 26)' });
  const saved = await page.evaluate(async () => {
    const db = await import(new URL('js/storage/db.js', document.baseURI).href);
    const d = await db.getDb();
    const record = await db.done(d.transaction('settings').objectStore('settings').get('global'));
    return { record, journal: localStorage.getItem('txt-reader:settings-journal') };
  });
  expect(saved.record).toEqual({ key: 'global', mode: 'scroll', fontSize: 24, lineHeight: 2, margin: 28, theme: 'night' });
  expect(saved.journal).toBeNull();

  // 日志里有不合法的值：那一项不采用，其余照常。
  await page.evaluate(() => {
    localStorage.setItem('txt-reader:settings-journal', JSON.stringify({ theme: 'blue', fontSize: 16 }));
  });
  await page.reload();
  await waitAppReady(page);
  expect((await themeColors(page)).theme).toBe('night');
  const again = await page.evaluate(async () => {
    const settings = await import(new URL('js/settings.js', document.baseURI).href);
    return settings.getSettings();
  });
  expect(again).toEqual({ mode: 'scroll', fontSize: 16, lineHeight: 2, margin: 28, theme: 'night' });
});

test('断网后：翻页模式能读、能翻页、能改设置，没有资源加载失败', async ({ page, context }) => {
  await importBooks(page, ['F1']);
  await waitForServiceWorker(page);
  await context.setOffline(true);
  const offlineLog = watchPage(page);
  await page.reload();
  await waitAppReady(page);
  await openBook(page, 'F1');
  await gotoChapter(page, 5);
  await tapNext(page);
  await expectPage(page, 1);
  await openSettings(page);
  await page.getByRole('button', { name: '增大字号' }).click();
  await expect(page.locator('#setting-fontSize')).toHaveText('20');
  await page.getByRole('button', { name: '夜间' }).click();
  expect((await themeColors(page)).theme).toBe('night');
  expect((await page.locator('#reader-content p').first().textContent())).toBe(para('F1', 5, 1));
  expect(offlineLog.failed).toEqual([]);
  expect(offlineLog.errors).toEqual([]);
  await context.setOffline(false);
});

test.describe('启动时的主题', () => {
  // 这一条要拦截脚本请求，Service Worker 接管后拦截不到，所以单独关掉它。
  test.use({ serviceWorkers: 'block' });

  test('App 的主脚本还没运行时，页面已经是上次用的夜间主题（不会先闪白底）', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('txt-reader:theme', 'night'));
    // 不让 app.js 加载：这样页面上的主题只可能来自 <head> 里的启动脚本。
    await page.route('**/js/app.js', (route) => route.abort());
    log.errors.length = 0;
    await page.reload();
    await expect(page.getByRole('heading', { name: '书架' })).toBeVisible();
    expect(await themeColors(page)).toMatchObject({ theme: 'night', bg: 'rgb(26, 26, 26)' });
    // 故意拦掉了 app.js，由此产生的加载失败报错不算数。
    log.errors.length = 0;
  });
});
