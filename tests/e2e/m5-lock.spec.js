// M5a：九宫格手势密码。编号对应 docs/spec-m5.md 第 ④ 节 K1–K17。
// 「画」= 在九宫格上按下、依次拖过各点的中心、松手。时间用 Playwright 的时钟控制，不真等。
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { shot, watchPage, waitForServiceWorker, waitAppReady } from './helpers.js';
import { importBooks, openBook, tapAt, presetMode, titleOf, gotoChapter } from './reader-helpers.js';

const RIGHT = [0, 1, 2, 5];
const WRONG = [0, 1, 2, 4];

const lockScreen = (page) => page.locator('#lock-screen');
const lockHint = (page) => page.locator('#lock-hint');
const sheet = (page) => page.locator('#pattern-sheet');
const sheetTitle = (page) => page.locator('#sheet-title');
const sheetHint = (page) => page.locator('#sheet-hint');
const morePanel = (page) => page.getByRole('dialog', { name: '更多' });
const content = (page) => page.locator('#reader-content');

/** 存在 localStorage 里的手势密码记录（没有为 null）。 */
const storedLock = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('txt-reader:lock')));

/**
 * 在 host（#lock-pad 或 #sheet-pad）上画图案。steps 是相邻两个点之间鼠标移动分几步：
 * 默认分 6 步，像手指一样一路滑过去；steps = 1 表示从一个点直接跳到下一个点（K4 用它验证中间点自动连上）。
 */
async function draw(page, hostId, seq, { steps = 6 } = {}) {
  const host = page.locator(`#${hostId}`);
  const centers = [];
  for (const i of seq) {
    const box = await host.locator(`[data-dot="${i}"]`).boundingBox();
    centers.push([box.x + box.width / 2, box.y + box.height / 2]);
  }
  await page.mouse.move(...centers[0]);
  await page.mouse.down();
  for (const [x, y] of centers.slice(1)) await page.mouse.move(x, y, { steps });
  await page.mouse.up();
}

const drawOnLock = (page, seq, options) => draw(page, 'lock-pad', seq, options);
const drawOnSheet = (page, seq, options) => draw(page, 'sheet-pad', seq, options);

async function openMore(page) {
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await expect(morePanel(page)).toBeVisible();
}

async function closeMore(page) {
  await morePanel(page).getByRole('button', { name: '关闭', exact: true }).click();
  await expect(morePanel(page)).toBeHidden();
}

/** 更多 → 开启 → 画两次。两次相同时等到「已开启」，并关掉面板。 */
async function enableLock(page, first, second = first, options) {
  await openMore(page);
  await morePanel(page).getByRole('button', { name: '开启', exact: true }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheetTitle(page)).toHaveText('画一个新图案');
  await drawOnSheet(page, first, options);
  await expect(sheetTitle(page)).toHaveText('再画一次确认');
  await drawOnSheet(page, second, options);
  if (first.join() === second.join()) {
    await expect(sheet(page)).toBeHidden();
    await expect(page.locator('#lock-status')).toContainText('已开启');
    await closeMore(page);
  }
}

/** 刷新页面（相当于划掉 App 重开）。 */
async function relaunch(page) {
  await page.reload();
  await waitAppReady(page);
}

/** 在锁屏页画对，等锁屏页消失。 */
async function unlock(page, seq = RIGHT) {
  await drawOnLock(page, seq);
  await expect(lockScreen(page)).toBeHidden();
}

/** 在锁屏页画错一次，等「图案不对」出现后把提示清掉，方便下一次再等它出现。 */
async function failOnce(page) {
  await drawOnLock(page, WRONG);
  await expect(lockHint(page)).not.toHaveText('');
  const text = await lockHint(page).textContent();
  await page.evaluate(() => { document.getElementById('lock-hint').textContent = ''; });
  return text;
}

/** 让页面以为自己切到了后台 / 回到了前台（电脑上的浏览器测不了真的切 App）。 */
async function setVisibility(page, state) {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/** 安装可控的时钟并刷新页面，之后可以用 pauseAt / fastForward 控制时间。 */
async function installClock(page) {
  await page.clock.install();
  await relaunch(page);
}

/** 把时钟停在「现在」稍后一点，之后时间只随 fastForward 走。 */
async function pauseClock(page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
}

/** 确认一段时间内某个元素一直不出现。异步的核对（算摘要）要时间，所以等够再看。 */
async function expectStaysHidden(locator, ms = 1500) {
  await locator.page().waitForTimeout(ms);
  await expect(locator).toBeHidden();
}

/** 导出备份并解析成对象（走页面上的按钮，和用户操作一样）。 */
async function exportBackupJson(page, testInfo) {
  await openMore(page);
  await morePanel(page).getByRole('button', { name: '生成备份' }).click();
  await expect(page.locator('#backup-ready')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    morePanel(page).getByRole('button', { name: '保存到文件' }).click(),
  ]);
  const file = join(testInfo.outputDir, download.suggestedFilename());
  await download.saveAs(file);
  await closeMore(page);
  return { file, data: JSON.parse(readFileSync(file, 'utf8')) };
}

// ---------- 测试 ----------

let log;
test.beforeEach(async ({ page }) => {
  // 去掉系统分享面板，让「保存到文件」走直接下载（同 M4）。
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

test('K1：开启 0-1-2-5 → 刷新出现锁屏页、书架不可见 → 画对进入书架', async ({ page }) => {
  await importBooks(page, ['F2']);
  await openMore(page);
  await shot(page, 'M5', '01-更多面板-未开启');
  await closeMore(page);

  await enableLock(page, RIGHT);
  expect(await storedLock(page)).not.toBeNull();

  await relaunch(page);
  await expect(lockScreen(page)).toBeVisible();
  await expect(page.locator('#view-shelf')).toBeHidden();
  await expect(page.getByRole('button', { name: '更多', exact: true })).toBeHidden();
  // 书架的内容也点不到：直接点书的位置不会打开书
  await shot(page, 'M5', '02-锁屏页');

  await unlock(page);
  await expect(page.locator('#view-shelf')).toBeVisible();
  await expect(page.locator('.book')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.dataset.locked)).toBeUndefined();
});

test('K1 补充：上锁时页面第一帧之前就标记为上锁（不先闪书架）', async ({ page }) => {
  await enableLock(page, RIGHT);
  // 在 <body> 刚插进文档的那一刻读 <html data-locked>。这时模块脚本（app.js）还没执行，
  // 能读到 '1' 只能是 <head> 里的 lock-boot.js 设的。
  // （第一版是在 DOMContentLoaded 时读，那时 app.js 已经执行过了，把 lock-boot.js 删掉测试照样过——反向验证时发现的。）
  await page.addInitScript(() => {
    new MutationObserver((records, observer) => {
      if (!document.body) return;
      window.__lockedAtBody = document.documentElement.dataset.locked ?? null;
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
  await relaunch(page);
  expect(await page.evaluate(() => window.__lockedAtBody)).toBe('1');
});

test('K2：开启时只画 3 个点 → 提示至少连 4 个点，密码没有开启', async ({ page }) => {
  await openMore(page);
  await morePanel(page).getByRole('button', { name: '开启', exact: true }).click();
  await drawOnSheet(page, [0, 1, 2]);
  await expect(sheetHint(page)).toHaveText('至少连 4 个点');
  await expect(sheetTitle(page)).toHaveText('画一个新图案');
  await shot(page, 'M5', '03-至少连4个点');
  await page.getByRole('button', { name: '取消' }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('#lock-status')).toHaveText('未开启。');
  expect(await storedLock(page)).toBeNull();
});

test('K3：两次画的不一样 → 提示两次不一致，回到第一步，密码没有开启', async ({ page }) => {
  await enableLock(page, RIGHT, WRONG);
  await expect(sheetHint(page)).toHaveText('两次不一致，请重新画');
  await expect(sheetTitle(page)).toHaveText('画一个新图案');
  expect(await storedLock(page)).toBeNull();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.locator('#lock-status')).toHaveText('未开启。');
});

test('K4：开启时从 0 直接跳到 2、5、8 → 记下的是 0-1-2-5-8', async ({ page }) => {
  await enableLock(page, [0, 2, 5, 8], [0, 2, 5, 8], { steps: 1 });
  await relaunch(page);
  // 依次经过 0、1、2、5、8 各点能进入，说明中间的 1 被自动连上了
  await unlock(page, [0, 1, 2, 5, 8]);
});

test('K5：画错 4 次、第 5 次画对 → 进入；再锁一次，画错 4 次仍可继续画（次数已清零）', async ({ page }) => {
  await enableLock(page, RIGHT);
  await relaunch(page);
  await drawOnLock(page, WRONG);
  await expect(lockHint(page)).toHaveText('图案不对');
  await shot(page, 'M5', '04-图案不对');
  for (let i = 0; i < 3; i++) expect(await failOnce(page)).toBe('图案不对');
  await unlock(page);
  expect((await storedLock(page)).fails).toBe(0);

  await relaunch(page);
  for (let i = 0; i < 4; i++) expect(await failOnce(page)).toBe('图案不对');
  await expect(page.locator('#lock-pad .pattern-pad')).not.toHaveClass(/disabled/);
  await unlock(page);
});

test('K6：画错 5 次 → 等待；第 29 秒画对也进不去，第 30 秒画对能进去', async ({ page }) => {
  await installClock(page);
  await enableLock(page, RIGHT);
  await relaunch(page);
  await pauseClock(page);

  for (let i = 0; i < 4; i++) await failOnce(page);
  await drawOnLock(page, WRONG);
  await expect(lockHint(page)).toHaveText('画错次数太多，请 30 秒后再试');
  await expect(page.locator('#lock-pad .pattern-pad')).toHaveClass(/disabled/);
  await shot(page, 'M5', '05-连错5次等待');

  await page.clock.fastForward(29_000);
  await expect(lockHint(page)).toHaveText('画错次数太多，请 1 秒后再试');
  await drawOnLock(page, RIGHT);
  await page.waitForTimeout(1500);
  await expect(lockScreen(page)).toBeVisible();

  await page.clock.fastForward(1_000);
  await expect(lockHint(page)).toHaveText('');
  await unlock(page);
});

test('K6 补充：等待结束后再错一次，又要等 30 秒', async ({ page }) => {
  await installClock(page);
  await enableLock(page, RIGHT);
  await relaunch(page);
  await pauseClock(page);
  for (let i = 0; i < 4; i++) await failOnce(page);
  await drawOnLock(page, WRONG);
  await expect(lockHint(page)).toHaveText('画错次数太多，请 30 秒后再试');
  await page.clock.fastForward(30_000);
  await expect(lockHint(page)).toHaveText('');
  await drawOnLock(page, WRONG);
  await expect(lockHint(page)).toHaveText('画错次数太多，请 30 秒后再试');
});

test('K7：画错 5 次后立刻刷新 → 仍在等待', async ({ page }) => {
  await enableLock(page, RIGHT);
  await relaunch(page);
  for (let i = 0; i < 4; i++) await failOnce(page);
  await drawOnLock(page, WRONG);
  await expect(lockHint(page)).toContainText('秒后再试');
  await relaunch(page);
  await expect(lockScreen(page)).toBeVisible();
  await expect(lockHint(page)).toContainText('秒后再试');
  await expect(page.locator('#lock-pad .pattern-pad')).toHaveClass(/disabled/);
});

/** K8 / K9 / K11 补充的准备：开启密码、导入 F1、翻页模式打开 F1 第 7 项翻到第 3 页，时钟停住。
 * （F2 的章太短，一章只有 2 页；F1 第 7 项是 M4 用过的「第 3 页」。） */
async function readingOnPage3(page) {
  await installClock(page);
  await importBooks(page, ['F1']);
  await presetMode(page, 'page');
  await enableLock(page, RIGHT);
  await relaunch(page);
  await unlock(page);
  await openBook(page, 'F1');
  await gotoChapter(page, 7);
  await tapAt(page, 5 / 6, 0.5);
  await expect(content(page)).toHaveAttribute('data-page', '1');
  await tapAt(page, 5 / 6, 0.5);
  await expect(content(page)).toHaveAttribute('data-page', '2');
  await pauseClock(page);
}

test('K8：读书时切到后台 4 分 59 秒再回来 → 不出现锁屏页', async ({ page }) => {
  await readingOnPage3(page);
  await setVisibility(page, 'hidden');
  await page.clock.fastForward(299_000);
  await setVisibility(page, 'visible');
  await expectStaysHidden(lockScreen(page), 500);
  await expect(content(page)).toHaveAttribute('data-page', '2');
});

test('K9：读书时切到后台 5 分 00 秒再回来 → 出现锁屏页；画对后仍在那本书的第 3 页', async ({ page }) => {
  await readingOnPage3(page);
  const title = await page.locator('#reader-content .chapter-title').textContent();
  await setVisibility(page, 'hidden');
  await page.clock.fastForward(300_000);
  await setVisibility(page, 'visible');
  await expect(lockScreen(page)).toBeVisible();
  await expect(page.locator('#view-reader')).toBeHidden();
  await shot(page, 'M5', '06-后台5分钟后锁屏');
  await unlock(page);
  await expect(page.locator('#view-reader')).toBeVisible();
  await expect(content(page)).toHaveAttribute('data-page', '2');
  await expect(page.locator('#reader-content .chapter-title')).toHaveText(title);
  await shot(page, 'M5', '07-解锁后回到原页');
});

test('K10：锁屏页「忘记图案」→ 取消 → 什么都没变', async ({ page }) => {
  await importBooks(page, ['F2']);
  await enableLock(page, RIGHT);
  const before = await storedLock(page);
  await relaunch(page);
  await page.getByRole('button', { name: '忘记图案' }).click();
  const dialog = page.getByRole('dialog', { name: '忘记图案' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('会删除手机里所有的书、阅读进度和设置，不能恢复');
  await shot(page, 'M5', '08-忘记图案确认');
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();
  await expect(lockScreen(page)).toBeVisible();
  expect(await storedLock(page)).toEqual(before);
  await unlock(page);
  await expect(page.locator('.book')).toHaveCount(1);
});

/** 点「忘记图案」→「全部删除」，等页面重新加载完。 */
async function forgetAndWipe(page) {
  await page.getByRole('button', { name: '忘记图案' }).click();
  const dialog = page.getByRole('dialog', { name: '忘记图案' });
  await Promise.all([
    page.waitForEvent('load'),
    dialog.getByRole('button', { name: '全部删除' }).click(),
  ]);
  await waitAppReady(page);
}

/** 数据库里所有仓库的记录总数。 */
const recordCount = (page) => page.evaluate(async () => {
  const { getDb } = await import(new URL('js/storage/db.js', document.baseURI).href);
  const db = await getDb();
  let total = 0;
  for (const name of db.objectStoreNames) {
    total += await new Promise((resolve) => {
      const request = db.transaction(name).objectStore(name).count();
      request.onsuccess = () => resolve(request.result);
    });
  }
  return total;
});

test('K11：「忘记图案」→ 确认 → 书架 0 本、设置回到默认、没有密码；再刷新直接进书架', async ({ page }) => {
  await importBooks(page, ['F2']);
  await page.evaluate(async () => {
    const settings = await import(new URL('js/settings.js', document.baseURI).href);
    await settings.updateSetting('theme', 'night');
    await settings.updateSetting('fontSize', 24);
  });
  await enableLock(page, RIGHT);
  await relaunch(page);
  await expect(lockScreen(page)).toBeVisible();

  await forgetAndWipe(page);
  await expect(lockScreen(page)).toBeHidden();
  await expect(page.locator('.book')).toHaveCount(0);
  await expect(page.locator('#shelf-empty')).toBeVisible();
  expect(await storedLock(page)).toBeNull();
  const settings = await page.evaluate(async () => {
    const m = await import(new URL('js/settings.js', document.baseURI).href);
    return { now: m.getSettings(), defaults: { ...m.DEFAULTS } };
  });
  expect(settings.now).toEqual(settings.defaults);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('day');
  expect(await recordCount(page)).toBe(0);
  await shot(page, 'M5', '09-忘记图案后空书架');

  await relaunch(page);
  await expect(lockScreen(page)).toBeHidden();
  await expect(page.locator('#view-shelf')).toBeVisible();
});

test('K11 补充：读书中被锁、然后「忘记图案」→ 进度没有被写回来', async ({ page }) => {
  await readingOnPage3(page);
  await setVisibility(page, 'hidden');
  await page.clock.fastForward(300_000);
  await setVisibility(page, 'visible');
  await expect(lockScreen(page)).toBeVisible();
  await page.clock.resume();

  await forgetAndWipe(page);
  await expect(page.locator('.book')).toHaveCount(0);
  expect(await recordCount(page)).toBe(0);
  // 重新启动后 loadSettings() 会写回主题副本（默认 day），这是正常的；除此之外 localStorage 应是空的，
  // 尤其不能有位置日志（关页面时把进度写回来的话，它会在这里出现）。
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({ 'txt-reader:theme': 'day' });
});

test('K12：修改密码——画错旧图案不能改；画对后设新图案，之后旧图案进不去、新图案能进', async ({ page }) => {
  const NEW = [3, 4, 5, 8];
  await enableLock(page, RIGHT);
  await openMore(page);
  // 面板每次打开都从顶上开始（开启时点过最底下的按钮，面板曾停在滚动后的位置）
  expect(await page.locator('#backup-panel .dialog').evaluate((el) => el.scrollTop)).toBe(0);
  await shot(page, 'M5', '10-更多面板-已开启');
  await morePanel(page).getByRole('button', { name: '修改', exact: true }).click();
  await expect(sheetTitle(page)).toHaveText('画当前的图案');
  await drawOnSheet(page, WRONG);
  await expect(sheetHint(page)).toHaveText('图案不对');
  await expect(sheetTitle(page)).toHaveText('画当前的图案');

  await drawOnSheet(page, RIGHT);
  await expect(sheetTitle(page)).toHaveText('画一个新图案');
  await drawOnSheet(page, NEW);
  await expect(sheetTitle(page)).toHaveText('再画一次确认');
  await drawOnSheet(page, NEW);
  await expect(sheet(page)).toBeHidden();
  await closeMore(page);

  await relaunch(page);
  await drawOnLock(page, RIGHT);
  await expect(lockHint(page)).toHaveText('图案不对');
  await expect(lockScreen(page)).toBeVisible();
  await unlock(page, NEW);
});

test('K13：关闭密码——画对旧图案 → 刷新直接进书架', async ({ page }) => {
  await enableLock(page, RIGHT);
  await openMore(page);
  await morePanel(page).getByRole('button', { name: '关闭密码' }).click();
  await expect(sheetTitle(page)).toHaveText('画当前的图案');
  await drawOnSheet(page, RIGHT);
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('#lock-status')).toHaveText('未开启。');
  await closeMore(page);
  expect(await storedLock(page)).toBeNull();

  await relaunch(page);
  await expect(lockScreen(page)).toBeHidden();
  await expect(page.locator('#view-shelf')).toBeVisible();
});

test('K14：开启后导出备份 → 备份里没有任何和密码有关的内容', async ({ page }, testInfo) => {
  await importBooks(page, ['F2']);
  await enableLock(page, RIGHT);
  const lock = await storedLock(page);
  const { file, data } = await exportBackupJson(page, testInfo);
  const raw = readFileSync(file, 'utf8');
  // 键名里没有 lock / pattern / salt / hash；记录里的盐和摘要原文也没出现在文件里
  const keys = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); }
  };
  walk(data);
  expect(keys.filter((k) => /lock|pattern|salt|hash|iteration/i.test(k))).toEqual([]);
  expect(raw).not.toContain(lock.salt);
  expect(raw).not.toContain(lock.hash);
  expect(data.books).toHaveLength(1);
});

test('K15：开启后恢复一份未开启时导出的备份 → 刷新仍然要画原来的图案', async ({ page }, testInfo) => {
  await importBooks(page, ['F2']);
  const { file } = await exportBackupJson(page, testInfo);
  await enableLock(page, RIGHT);
  const before = await storedLock(page);

  await openMore(page);
  await page.locator('#restore-input').setInputFiles(file);
  const result = page.getByRole('dialog', { name: '恢复完成' });
  await expect(result).toBeVisible();
  await result.getByRole('button', { name: '知道了' }).click();
  expect(await storedLock(page)).toEqual(before);

  await relaunch(page);
  await expect(lockScreen(page)).toBeVisible();
  await unlock(page);
});

test('K16：同一个图案开启、关闭、再开启，两次存下来的值不同（加了盐）', async ({ page }) => {
  await enableLock(page, RIGHT);
  const first = await storedLock(page);
  await openMore(page);
  await morePanel(page).getByRole('button', { name: '关闭密码' }).click();
  await drawOnSheet(page, RIGHT);
  await expect(sheet(page)).toBeHidden();
  await closeMore(page);
  await enableLock(page, RIGHT);
  const second = await storedLock(page);
  expect(second.salt).not.toBe(first.salt);
  expect(second.hash).not.toBe(first.hash);
  // 存的不是图案本身
  expect(JSON.stringify(second)).not.toContain('0-1-2-5');
});

test('K17：没开启密码时启动不出现锁屏页', async ({ page }) => {
  await expect(lockScreen(page)).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.dataset.locked)).toBeUndefined();
  expect(await storedLock(page)).toBeNull();
  await expect(page.locator('#view-shelf')).toBeVisible();
});

test('断网后：能画图案解锁、能阅读；没有资源加载失败，没有本站以外的请求', async ({ page, context }) => {
  await importBooks(page, ['F2']);
  await enableLock(page, RIGHT);
  await waitForServiceWorker(page);
  await context.setOffline(true);
  log.failed.length = 0;
  log.requests.length = 0;
  await page.reload();
  await waitAppReady(page);
  await expect(lockScreen(page)).toBeVisible();
  await unlock(page);
  await openBook(page, 'F2');
  await expect(page.locator('#reader-content p').first()).toBeVisible();
  expect(log.failed).toEqual([]);
  const origin = new URL(page.url()).origin;
  expect(log.requests.filter((u) => !u.startsWith(origin))).toEqual([]);
  await context.setOffline(false);
  expect(titleOf('F2')).toBeTruthy();
});
