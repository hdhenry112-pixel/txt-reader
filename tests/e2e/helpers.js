// 端到端测试的公共工具。
import { expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 截图存到 docs/test-reports/<milestone>/<name>.png */
export async function shot(page, milestone, name) {
  const dir = join(HERE, '..', '..', 'docs', 'test-reports', milestone);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.png`);
  // 已有的截图不覆盖：旧里程碑的报告是历史记录，每次全量回归都重拍会让 git 里全是无意义的图片改动。
  // 要重拍某个里程碑的截图，先删掉那个目录里的 png 再跑。
  if (existsSync(file)) return;
  await page.screenshot({ path: file });
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

/**
 * 等 App 启动完成（设置读好、按钮绑好、书架画出来）。
 * 页面上的静态文字比 App 启动完成出现得早，看到文字就操作会扑空。
 */
export async function waitAppReady(page) {
  await expect(page.locator('html[data-ready="1"]')).toHaveCount(1);
}

// ---------- M1 起：导入和读库 ----------

const FIXTURES = join(HERE, '..', 'fixtures');

/** 测试文件的完整路径。name 是 gen-fixtures.mjs 里 FILES[x].name。 */
export const fixturePath = (name) => join(FIXTURES, name);

/** 通过页面上的「导入」文件选择框选文件，和用户在手机上选文件走的是同一条路。 */
export async function chooseFiles(page, files) {
  await waitAppReady(page);
  await page.locator('#import-input').setInputFiles(files);
}

/** 等导入流程结束（进度提示消失）。 */
export async function waitImportDone(page) {
  await expect(page.locator('#import-status')).toBeHidden({ timeout: 120_000 });
}

/** 从 IndexedDB 读一本书实际存下来的数据。按书名找，找不到返回 null。 */
export async function storedBook(page, title) {
  return page.evaluate(async (wanted) => {
    const books = await import(new URL('js/storage/books.js', document.baseURI).href);
    const book = (await books.listBooks()).find((b) => b.title === wanted);
    if (!book) return null;
    return {
      book,
      toc: await books.getToc(book.id),
      chapterRecords: await books.countChapters(book.id),
    };
  }, title);
}

/** 从 IndexedDB 读某本书某一章的段落数组。 */
export async function storedParas(page, title, chapterIdx) {
  return page.evaluate(async ([wanted, idx]) => {
    const books = await import(new URL('js/storage/books.js', document.baseURI).href);
    const book = (await books.listBooks()).find((b) => b.title === wanted);
    return books.getChapterParas(book.id, idx);
  }, [title, chapterIdx]);
}

/** 书架上从上到下的书名。 */
export async function shelfTitles(page) {
  return page.locator('.book-title').allTextContents();
}

/** 让测试服务器假装发布了某个版本；不传参数则恢复真实版本。 */
export async function setServerVersion(request, version) {
  const query = version ? `?v=${version}` : '';
  const res = await request.get(`http://localhost:4173/__test/sw-version${query}`);
  expect(res.ok()).toBe(true);
}
