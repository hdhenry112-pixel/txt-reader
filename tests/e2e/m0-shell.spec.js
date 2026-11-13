// M0：App 外壳、离线、更新提示。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shot, watchPage, waitForServiceWorker, setServerVersion } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_VERSION = readFileSync(join(HERE, '..', '..', 'sw.js'), 'utf8').match(/^const VERSION = '([^']+)';$/m)[1];

test.afterEach(async ({ request }) => {
  await setServerVersion(request, null);
});

test('打开后显示空书架，console 无报错', async ({ page }) => {
  const log = watchPage(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '书架' })).toBeVisible();
  await expect(page.getByText('还没有书')).toBeVisible();
  await waitForServiceWorker(page);
  await expect(page.locator('#app-version')).toHaveText(REAL_VERSION);
  await shot(page, 'M0', '01-空书架');
  expect(log.errors).toEqual([]);
  expect(log.failed).toEqual([]);
});

test('页面只请求本站的文件', async ({ page, baseURL }) => {
  const log = watchPage(page);
  await page.goto('./');
  await waitForServiceWorker(page);
  expect(log.requests.length).toBeGreaterThan(0);
  const outside = log.requests.filter((url) => !url.startsWith(baseURL));
  expect(outside).toEqual([]);
});

test('断网后重新加载，仍能打开书架，且没有任何资源加载失败', async ({ page, context }) => {
  await page.goto('./');
  await waitForServiceWorker(page);

  await context.setOffline(true);
  const log = watchPage(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: '书架' })).toBeVisible();
  await expect(page.getByText('还没有书')).toBeVisible();
  // 样式也确实从缓存加载到了：背景色是白天主题的 #F2F1EC。
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  expect(bg).toBe('rgb(242, 241, 236)');
  // 脚本也从缓存跑起来了：版本号由 app.js 向 Service Worker 询问后填入。
  await expect(page.locator('#app-version')).toHaveText(REAL_VERSION);
  await shot(page, 'M0', '02-断网后重新加载');
  expect(log.errors).toEqual([]);
  expect(log.failed).toEqual([]);
  await context.setOffline(false);
});

test('发布新版本后出现提示，点击后切到新版本', async ({ page, request }) => {
  await page.goto('./');
  await waitForServiceWorker(page);
  await expect(page.locator('#app-version')).toHaveText(REAL_VERSION);
  // 首次安装不应该出现更新提示。
  await expect(page.getByText('有新版本，点击刷新')).toHaveCount(0);

  await setServerVersion(request, '9.9.9');
  await page.reload();
  const toast = page.getByRole('button', { name: '有新版本，点击刷新' });
  await expect(toast).toBeVisible();
  // 用户还没点之前，页面仍在用旧版本。
  await expect(page.locator('#app-version')).toHaveText(REAL_VERSION);
  await shot(page, 'M0', '03-有新版本提示');

  await toast.click();
  await expect(page.locator('#app-version')).toHaveText('9.9.9');
  await expect(page.getByText('有新版本，点击刷新')).toHaveCount(0);
  // 旧版本的缓存已删除，只剩新版本的。
  const cacheNames = await page.evaluate(() => caches.keys());
  expect(cacheNames).toEqual(['txt-reader-v9.9.9']);
  await shot(page, 'M0', '04-刷新后是新版本');
});
