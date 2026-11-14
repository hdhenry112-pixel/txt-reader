// 0.5.3 修复：断网启动时 navigator.serviceWorker.register() 一直不完成，版本号和更新检查都不执行（spec-m5 C4）。
// 0.5.2 线上检查时发现；排查见 docs/test-reports/M5/report.md。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { watchPage, waitForServiceWorker, waitAppReady } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_VERSION = readFileSync(join(HERE, '..', '..', 'sw.js'), 'utf8').match(/^const VERSION = '([^']+)';$/m)[1];

let log;
test.beforeEach(async ({ page }) => {
  log = watchPage(page);
  await page.goto('./');
  await waitAppReady(page);
  await waitForServiceWorker(page);
});
test.afterEach(async ({ context }) => {
  await context.setOffline(false);
  expect(log.errors).toEqual([]);
});

test('C4-1：register() 永远不完成时，断网启动版本号照样出现', async ({ page, context }) => {
  // 直接制造根因：让 register() 返回一个永远不完成的 Promise。不靠时机，每次都一样。
  await page.addInitScript(() => {
    ServiceWorkerContainer.prototype.register = () => new Promise(() => {});
  });
  await context.setOffline(true);
  await page.reload();
  await waitAppReady(page);
  await expect(page.locator('#app-version')).toHaveText(REAL_VERSION);
});

/** 在页面里画图案（同 m5-lock.spec.js）。 */
async function draw(page, hostId, seq) {
  const centers = [];
  for (const i of seq) {
    const box = await page.locator(`#${hostId} [data-dot="${i}"]`).boundingBox();
    centers.push([box.x + box.width / 2, box.y + box.height / 2]);
  }
  await page.mouse.move(...centers[0]);
  await page.mouse.down();
  for (const [x, y] of centers.slice(1)) await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
}

const setVisibility = (page, state) => page.evaluate((value) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}, state);

test('C4-2：0.5.2 线上检查里复现过的那一串操作之后，断网启动版本号出现', async ({ page, context }) => {
  // 开启密码 → 刷新 → 解锁 → 切到后台再回来 → 断网 → 刷新。和线上检查脚本的顺序一样。
  const RIGHT = [0, 1, 2, 5];
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('dialog', { name: '更多' }).getByRole('button', { name: '开启', exact: true }).click();
  await draw(page, 'sheet-pad', RIGHT);
  await expect(page.locator('#sheet-title')).toHaveText('再画一次确认');
  await draw(page, 'sheet-pad', RIGHT);
  await expect(page.locator('#pattern-sheet')).toBeHidden();
  await page.getByRole('dialog', { name: '更多' }).getByRole('button', { name: '关闭', exact: true }).click();

  await page.reload();
  await waitAppReady(page);
  await draw(page, 'lock-pad', RIGHT);
  await expect(page.locator('#lock-screen')).toBeHidden();

  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await page.waitForTimeout(2000);

  await context.setOffline(true);
  await page.reload();
  await waitAppReady(page);
  await expect(page.locator('#app-version')).toHaveText(REAL_VERSION, { timeout: 15_000 });
  await draw(page, 'lock-pad', RIGHT);
  await expect(page.locator('#lock-screen')).toBeHidden();
});
