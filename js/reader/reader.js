// 阅读页控制：打开书、加载章节、保存和恢复进度。
// 任何时候 DOM 里只有当前一章的内容。
import { getBook, getToc, getChapterParas } from '../storage/books.js';
import { getProgress, saveProgress } from '../storage/progress.js';
import { computePercent } from './position.js';
import { createScrollMode } from './scroll-mode.js';
import { setupMenu, setMenuVisible, toggleMenu, updateMenu } from './menu.js';
import { setupToc, openToc, closeToc } from './toc.js';
import { keepAwake, allowSleep } from '../wakelock.js';

const $ = (id) => document.getElementById(id);

/** 滚动停下多久后保存进度（毫秒）。 */
const SAVE_DELAY = 500;

let state = null;   // 当前打开的书：{ book, toc, lens, chapterIdx }；没打开时为 null
let mode = null;    // 当前的阅读模式对象
let saveTimer = null;
let onClosed = () => {};

function position() {
  const offset = mode.getOffset();
  const isLastChapter = state.chapterIdx === state.toc.length - 1;
  const percent = computePercent(state.lens, state.chapterIdx, offset, isLastChapter && mode.isAtEnd());
  return { chapterIdx: state.chapterIdx, offset, percent };
}

/** 立刻保存当前位置。 */
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!state) return Promise.resolve();
  const pos = position();
  updateMenu({ percent: pos.percent });
  return saveProgress(state.book.id, pos);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY);
}

/**
 * 显示某一章。
 * @param {number} idx 第几章
 * @param {{ offset?: number, atEnd?: boolean }} [where] 章内位置；atEnd 为真表示定位到章末
 */
async function showChapter(idx, { offset = 0, atEnd = false } = {}) {
  const paragraphs = (await getChapterParas(state.book.id, idx)) ?? [];
  state.chapterIdx = idx;
  mode.render({
    title: state.toc[idx].title,
    paragraphs,
    hasPrev: idx > 0,
    hasNext: idx < state.toc.length - 1,
  });
  if (atEnd) mode.scrollToEnd();
  else mode.restore(offset);
  updateMenu({ chapterTitle: state.toc[idx].title });
  await saveNow();
}

async function navigate(delta) {
  const target = state.chapterIdx + delta;
  if (target < 0 || target >= state.toc.length) return;
  await showChapter(target);
}

async function showToc() {
  openToc(state.toc, state.chapterIdx, async (idx) => {
    setMenuVisible(false);
    await showChapter(idx);
  });
}

export async function openReader(bookId) {
  const [book, toc, progress] = await Promise.all([getBook(bookId), getToc(bookId), getProgress(bookId)]);
  if (!book || !toc.length) return false;

  state = { book, toc, lens: toc.map((e) => e.len), chapterIdx: 0 };
  mode = createScrollMode({
    scroller: $('reader-scroll'),
    content: $('reader-content'),
    onNavigate: navigate,
    onTap: toggleMenu,
    onMove: scheduleSave,
  });
  mode.activate();

  $('view-shelf').hidden = true;
  $('view-reader').hidden = false;
  setMenuVisible(false);
  updateMenu({ bookTitle: book.title });
  keepAwake();

  // 进度里的章号可能超出范围（比如换编码重新导入后章数变少了），这时回到开头。
  const saved = progress && progress.chapterIdx < toc.length ? progress : { chapterIdx: 0, offset: 0 };
  await showChapter(saved.chapterIdx, { offset: saved.offset });
  return true;
}

export async function closeReader() {
  if (!state) return;
  await saveNow();
  allowSleep();
  closeToc();
  mode.deactivate();
  mode = null;
  state = null;
  // 先让书架按最新的进度和排序刷新完，再切换显示，避免先闪一下旧数据。
  await onClosed();
  $('view-reader').hidden = true;
  $('view-shelf').hidden = false;
}

/** 只需调用一次。onClose 在回到书架后调用。 */
export function setupReader({ onClose }) {
  onClosed = onClose;
  setupMenu({ onBack: closeReader, onToc: showToc });
  setupToc();
  // 切到后台或关闭时立刻保存：iOS 会直接结束后台的 App，等不到定时器。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  window.addEventListener('pagehide', () => { saveNow(); });
}
