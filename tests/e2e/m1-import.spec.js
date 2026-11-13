// M1：导入、分章、存储、书架、删除。
// 期望值来自 spec ④ 的手算结果和 gen-fixtures.mjs 的原文。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { FILES, para } from '../gen-fixtures.mjs';
import {
  shot, watchPage, waitForServiceWorker, fixturePath,
  chooseFiles, waitImportDone, storedBook, storedParas, shelfTitles,
} from './helpers.js';

const path = (file) => fixturePath(FILES[file].name);
const titleOf = (file) => FILES[file].name.replace(/\.txt$/, '');

let log;
test.beforeEach(async ({ page }) => {
  log = watchPage(page);
  await page.goto('./');
  await expect(page.getByText('还没有书')).toBeVisible();
});
test.afterEach(() => {
  expect(log.errors).toEqual([]);
});

test('一次选 F1（UTF-8）和 F2（GBK）：书架出现 2 本，进度 0%，入库的目录和正文正确', async ({ page }) => {
  await chooseFiles(page, [path('F1'), path('F2')]);
  await waitImportDone(page);
  await expect(page.getByText('已导入 2 本')).toBeVisible();
  await expect(page.locator('.book')).toHaveCount(2);
  expect((await shelfTitles(page)).sort()).toEqual([titleOf('F1'), titleOf('F2')]);
  // P1：刚导入没打开过，进度 0%。
  await expect(page.locator('.book-percent')).toHaveText(['已读 0%', '已读 0%']);
  await expect(page.getByText('还没有书')).toBeHidden();
  await expect(page.getByText('编码可能有误')).toHaveCount(0);
  await shot(page, 'M1', '01-导入两本后的书架');

  // A1 / A2：F1 目录 11 项，各章字数 200, 1000, …, 10000，全书 55200。
  const f1 = await storedBook(page, titleOf('F1'));
  expect(f1.toc.map((e) => e.title)).toEqual([
    '前言', '序章 风起', '第一章 起点', '第二章　远行', '第3章 归来', '第十回 夜谈',
    '第一百零一节 转折', '第二卷 新的旅程', 'Chapter 8 Dawn', '楔子', '番外 多年以后',
  ]);
  expect(f1.toc.map((e) => e.len)).toEqual([200, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]);
  expect(f1.book.totalLen).toBe(55200);
  expect(f1.book.chapterCount).toBe(11);
  expect(f1.chapterRecords).toBe(11);
  expect(f1.book.encoding).toBe('utf-8');
  // A3：目录第 3 项的段落与原文逐字相等，没有空段落。
  const f1ch3 = await storedParas(page, titleOf('F1'), 3);
  expect(f1ch3).toHaveLength(30);
  expect(f1ch3[0]).toBe(para('F1', 3, 1));
  expect(f1ch3[29]).toBe(para('F1', 3, 30));
  expect(f1ch3.every((p) => p.length === 100)).toBe(true);

  // A4：F2 目录 5 项、2500 字、含「镕」的段落逐字相等。
  const f2 = await storedBook(page, titleOf('F2'));
  expect(f2.toc).toEqual(['第一章', '第二章', '第三章', '第四章', '第五章'].map((title) => ({ title, len: 500 })));
  expect(f2.book.totalLen).toBe(2500);
  expect(f2.book.encoding).toBe('gbk');
  expect(f2.book.encodingSuspect).toBe(false);
  const f2ch0 = await storedParas(page, titleOf('F2'), 0);
  expect(f2ch0[0]).toBe(para('F2', 1, 1));
  expect(f2ch0[0]).toContain('镕');

  // 刷新页面后书还在。
  await page.reload();
  await expect(page.locator('.book')).toHaveCount(2);
  expect((await storedBook(page, titleOf('F1'))).chapterRecords).toBe(11);
});

test('A5–A8、B1、B3：其余测试文件的目录项数和字数', async ({ page }) => {
  await chooseFiles(page, ['F3', 'F3b', 'F5', 'F6', 'F7', 'F8', 'B3'].map(path));
  await waitImportDone(page);
  await expect(page.locator('.book')).toHaveCount(7);

  const lens = async (file) => (await storedBook(page, titleOf(file))).toc.map((e) => e.len);
  const titles = async (file) => (await storedBook(page, titleOf(file))).toc.map((e) => e.title);

  expect(await titles('F3')).toEqual(['第 1 段', '第 2 段', '第 3 段', '第 4 段', '第 5 段']);
  expect(await lens('F3')).toEqual([5000, 5000, 5000, 5000, 5000]);
  expect(await lens('F3b')).toEqual([5000, 100]);
  expect(await titles('F5')).toEqual(['第一章 真标题', '第二章 真标题', '第三章 真标题']);
  expect(await titles('F6')).toEqual([
    '第一章 (1/7)', '第一章 (2/7)', '第一章 (3/7)', '第一章 (4/7)',
    '第一章 (5/7)', '第一章 (6/7)', '第一章 (7/7)', '第二章',
  ]);
  expect(await lens('F6')).toEqual([5000, 5000, 5000, 5000, 5000, 5000, 5000, 30000]);
  for (const file of ['F7', 'F8']) {
    expect(await titles(file)).toEqual(['第一章', '第二章']);
    expect((await storedParas(page, titleOf(file), 0))[0]).toBe(para(file, 1, 1));
  }
  expect(await titles('B3')).toEqual(['第 1 段']);
  expect(await lens('B3')).toEqual([100]);
  await shot(page, 'M1', '02-七本书的书架');
});

test('A9：同一本书导入两次，书架仍只有 1 本，并提示已在书架', async ({ page }) => {
  await chooseFiles(page, [path('F1')]);
  await waitImportDone(page);
  await expect(page.locator('.book')).toHaveCount(1);

  await chooseFiles(page, [path('F1')]);
  await waitImportDone(page);
  const dialog = page.getByRole('dialog', { name: '导入结果' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('跳过 1 本');
  await expect(dialog).toContainText(`《${titleOf('F1')}》已在书架`);
  await shot(page, 'M1', '03-重复导入的提示');
  await dialog.getByRole('button', { name: '知道了' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.book')).toHaveCount(1);
  // 没有多存一份章节。
  expect((await storedBook(page, titleOf('F1'))).chapterRecords).toBe(11);
});

test('B2 / B4：一次选 F1 + 空文件 + F2，书架 2 本，汇总显示成功 2、失败 1 及原因', async ({ page }) => {
  await chooseFiles(page, [path('F1'), path('B2'), path('F2')]);
  await waitImportDone(page);
  const dialog = page.getByRole('dialog', { name: '导入结果' });
  await expect(dialog).toContainText('成功 2 本');
  await expect(dialog).toContainText('失败 1 本');
  await expect(dialog).toContainText(`${FILES.B2.name}：文件是空的`);
  await shot(page, 'M1', '04-有失败时的汇总');
  await dialog.getByRole('button', { name: '知道了' }).click();
  await expect(page.locator('.book')).toHaveCount(2);
  expect((await shelfTitles(page)).sort()).toEqual([titleOf('F1'), titleOf('F2')]);
});

test('A10 前半：Big5 文件直接导入，得不到原文', async ({ page }) => {
  await chooseFiles(page, [path('F9')]);
  await waitImportDone(page);
  await expect(page.locator('.book')).toHaveCount(1);
  const stored = await storedBook(page, titleOf('F9'));
  const first = (await storedParas(page, titleOf('F9'), 0))[0];
  expect(first !== para('F9', 1, 1) || stored.book.encodingSuspect).toBe(true);
});

test('含无法识别字节的文件：导入成功，书架上标「编码可能有误」', async ({ page }) => {
  // 0xFF 在 UTF-8 和 GBK 里都不合法。
  const bytes = Buffer.concat([Buffer.from('第一章\n'), Buffer.from([0xff, 0xff]), Buffer.from('正文\n')]);
  await chooseFiles(page, [{ name: '坏编码.txt', mimeType: 'text/plain', buffer: bytes }]);
  await waitImportDone(page);
  await expect(page.locator('.book')).toHaveCount(1);
  await expect(page.locator('.book').getByText('编码可能有误')).toBeVisible();
  await shot(page, 'M1', '05-编码可能有误');
});

test('文件选择框不限制类型；选了非 txt 文件时不导入，并说明原因', async ({ page }) => {
  // 不限制类型是为了让 iOS 的 Google Drive 位置能显示文件（spec ⑧ C2）。
  expect(await page.locator('#import-input').getAttribute('accept')).toBeNull();
  // Playwright 不允许把文件路径和内存里的文件混着选，所以 F2 也读成内存文件。
  await chooseFiles(page, [
    { name: '照片.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) },
    // 名字以 txt 结尾但没有点号，不算 txt 文件。
    { name: '笔记txt', mimeType: 'application/octet-stream', buffer: Buffer.from('abc') },
    { name: FILES.F2.name, mimeType: 'text/plain', buffer: readFileSync(path('F2')) },
  ]);
  await waitImportDone(page);
  const dialog = page.getByRole('dialog', { name: '导入结果' });
  await expect(dialog).toContainText('成功 1 本');
  await expect(dialog).toContainText('照片.jpg：不是 txt 文件');
  await expect(dialog).toContainText('失败 2 本');
  await expect(dialog).toContainText('笔记txt：不是 txt 文件');
  await dialog.getByRole('button', { name: '知道了' }).click();
  expect(await shelfTitles(page)).toEqual([titleOf('F2')]);
});

test('删除：取消则不删；确认后书、目录、章节都删除，刷新后仍然没有', async ({ page }) => {
  await chooseFiles(page, [path('F1'), path('F2')]);
  await waitImportDone(page);
  await expect(page.locator('.book')).toHaveCount(2);
  const f2Id = (await storedBook(page, titleOf('F2'))).book.id;

  await page.getByRole('button', { name: `删除《${titleOf('F2')}》` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`删除《${titleOf('F2')}》？`);
  await shot(page, 'M1', '06-删除确认框');
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(page.locator('.book')).toHaveCount(2);

  await page.getByRole('button', { name: `删除《${titleOf('F2')}》` }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.book')).toHaveCount(1);
  expect(await shelfTitles(page)).toEqual([titleOf('F1')]);

  // 数据库里 F2 的三类记录都没了；F1 不受影响。
  const leftover = await page.evaluate(async (id) => {
    const books = await import(new URL('js/storage/books.js', document.baseURI).href);
    return {
      book: (await books.getBook(id)) ?? null,
      toc: await books.getToc(id),
      chapters: await books.countChapters(id),
    };
  }, f2Id);
  expect(leftover).toEqual({ book: null, toc: [], chapters: 0 });
  expect((await storedBook(page, titleOf('F1'))).chapterRecords).toBe(11);

  await page.reload();
  await expect(page.locator('.book')).toHaveCount(1);
});

test('断网后：重新加载没有资源加载失败，仍能导入并显示', async ({ page, context }) => {
  await waitForServiceWorker(page);
  await context.setOffline(true);
  const offlineLog = watchPage(page);
  await page.reload();
  await expect(page.getByText('还没有书')).toBeVisible();
  await chooseFiles(page, [path('F2')]);
  await waitImportDone(page);
  await expect(page.locator('.book')).toHaveCount(1);
  expect((await storedParas(page, titleOf('F2'), 0))[0]).toBe(para('F2', 1, 1));
  expect(offlineLog.failed).toEqual([]);
  expect(offlineLog.errors).toEqual([]);
  await context.setOffline(false);
});
