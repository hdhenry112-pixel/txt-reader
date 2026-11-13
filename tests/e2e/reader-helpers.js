// 阅读页相关测试（M2 起）共用的操作。
import { expect } from '@playwright/test';
import { FILES } from '../gen-fixtures.mjs';
import { fixturePath, chooseFiles, waitImportDone, waitAppReady } from './helpers.js';

export const path = (file) => fixturePath(FILES[file].name);
export const titleOf = (file) => FILES[file].name.replace(/\.txt$/, '');

export const F1_TITLES = [
  '前言', '序章 风起', '第一章 起点', '第二章　远行', '第3章 归来', '第十回 夜谈',
  '第一百零一节 转折', '第二卷 新的旅程', 'Chapter 8 Dawn', '楔子', '番外 多年以后',
];

export async function importBooks(page, files) {
  await chooseFiles(page, files.map(path));
  await waitImportDone(page);
  await expect(page.locator('.book')).toHaveCount(files.length);
}

/** 在打开任何书之前，把阅读模式设成指定的模式（测试的准备步骤，走的是 App 自己的设置模块）。 */
export async function presetMode(page, mode) {
  await waitAppReady(page);
  await page.evaluate(async (value) => {
    const settings = await import(new URL('js/settings.js', document.baseURI).href);
    await settings.updateSetting('mode', value);
  }, mode);
}

export async function openBook(page, file) {
  await page.getByRole('button', { name: `打开《${titleOf(file)}》` }).click();
  await expect(page.locator('#view-reader')).toBeVisible();
  await expect(page.locator('#reader-content .chapter-title')).toHaveCount(1);
}

/**
 * 像手指一样点一下阅读区域。xRatio / yRatio 是点击位置占阅读区域宽高的比例。
 * 不能用「点某个元素」：Playwright 点元素前会先把它滚动到可见位置，等于替用户滚了屏。
 * 默认点屏幕中间偏上：滚动模式下整屏都是菜单区，翻页模式下中间 1/3 是菜单区。
 */
export async function tapAt(page, xRatio = 0.5, yRatio = 0.4) {
  const box = await page.locator('#reader-scroll').boundingBox();
  await page.mouse.click(box.x + box.width * xRatio, box.y + box.height * yRatio);
}

export async function showMenu(page) {
  if (await page.locator('#reader-top').isHidden()) await tapAt(page);
  await expect(page.locator('#reader-top')).toBeVisible();
}

export async function gotoChapter(page, idx) {
  await showMenu(page);
  await page.getByRole('button', { name: '目录' }).click();
  await expect(page.locator('#toc-panel')).toBeVisible();
  const item = page.locator('#toc-list button').nth(idx);
  const title = await item.textContent();
  await item.click();
  await expect(page.locator('#toc-panel')).toBeHidden();
  // 等新的一章真的渲染出来，再让测试继续操作。
  await expect(page.locator('#reader-content .chapter-title')).toHaveText(title);
}

export async function backToShelf(page) {
  await showMenu(page);
  await page.getByRole('button', { name: '‹ 书架' }).click();
  await expect(page.locator('#view-shelf')).toBeVisible();
}

/** 书架上某本书显示的进度文字。回到书架后列表是异步刷新的，所以用会重试的断言。 */
export const expectPercent = (page, file, text) =>
  expect(page.locator('.book', { hasText: titleOf(file) }).locator('.book-percent')).toHaveText(text);

export const domParas = (page) => page.locator('#reader-content p').allTextContents();

export const storedProgress = (page, file) => page.evaluate(async (title) => {
  const base = document.baseURI;
  const books = await import(new URL('js/storage/books.js', base).href);
  const progress = await import(new URL('js/storage/progress.js', base).href);
  const book = (await books.listBooks()).find((b) => b.title === title);
  return (await progress.getProgress(book.id)) ?? null;
}, titleOf(file));

/**
 * 本章第 offset 个字现在是否完整地落在阅读区域里（横向和纵向都在）。
 * 用来验证「改了字号 / 换了模式之后，原来屏幕上第一个可见的字仍在屏幕内」。
 */
export const isCharOnScreen = (page, offset) => page.evaluate((target) => {
  const box = document.getElementById('reader-scroll').getBoundingClientRect();
  for (const p of document.querySelectorAll('#reader-content p')) {
    const start = Number(p.dataset.start);
    const len = p.firstChild.length;
    if (target < start || target >= start + len) continue;
    const range = document.createRange();
    range.setStart(p.firstChild, target - start);
    range.setEnd(p.firstChild, target - start + 1);
    const r = range.getBoundingClientRect();
    return r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
  }
  return false;
}, offset);
