// 端到端测试的公共工具。
import { expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 截图存到 docs/test-reports/<milestone>/<name>.png */
export async function shot(page, milestone, name) {
  const dir = join(HERE, '..', '..', 'docs', 'test-reports', milestone);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

/**
 * 记录页面的 console 报错、未捕获异常、失败的请求、以及所有发出的请求。
 * 在 page.goto 之前调用。
 */
export function watchPage(page) {
  const log = { errors: [], failed: [], requests: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') log.errors.push(msg.text());
  });
  page.on('pageerror', (err) => log.errors.push(String(err)));
  page.on('requestfailed', (req) => log.failed.push(`${req.url()} ${req.failure()?.errorText}`));
  page.on('request', (req) => log.requests.push(req.url()));
  return log;
}

/** 等到 Service Worker 已激活并且正在控制当前页面。 */
export async function waitForServiceWorker(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      });
    }
  });
  // 页面底部显示出版本号，说明页面和 Service Worker 之间的通信也通了。
  await expect(page.locator('#app-version')).not.toHaveText('…');
}

/** 让测试服务器假装发布了某个版本；不传参数则恢复真实版本。 */
export async function setServerVersion(request, version) {
  const query = version ? `?v=${version}` : '';
  const res = await request.get(`http://localhost:4173/__test/sw-version${query}`);
  expect(res.ok()).toBe(true);
}
