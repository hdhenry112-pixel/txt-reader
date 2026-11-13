// 阅读页控制：打开书、加载章节、切换阅读模式、套用设置、保存和恢复进度。
// 任何时候 DOM 里只有当前一章的内容。
import { getBook, getToc, getChapterParas } from '../storage/books.js';
import { getProgress, saveProgress } from '../storage/progress.js';
import { getSettings } from '../settings.js';
import { setupSettingsPanel, openSettingsPanel, closeSettingsPanel, isSettingsPanelOpen } from '../settings-panel.js';
import { computePercent } from './position.js';
import { createScrollMode } from './scroll-mode.js';
import { createPageMode } from './page-mode.js';
import { setupMenu, setMenuVisible, isMenuVisible, updateMenu } from './menu.js';
import { setupToc, openToc, closeToc } from './toc.js';
import { keepAwake, allowSleep } from '../wakelock.js';
import { showToast } from '../ui/toast.js';

const $ = (id) => document.getElementById(id);

/** 滚动停下多久后保存进度（毫秒）。 */
const SAVE_DELAY = 500;

let state = null;    // 当前打开的书：{ book, toc, lens, chapterIdx, chapter }；没打开时为 null
let mode = null;     // 当前的阅读模式对象（滚动或翻页）
let modeName = null; // 'scroll' | 'page'
let saveTimer = null;
let onClosed = () => {};
let anchor = null;        // 连续调整设置期间用来定位的字的序号；见 onSettingChanged
let anchorScrollTop = 0;  // 上一次按锚点定位之后的滚动位置（只在滚动模式下有意义）

// ---------- 进度 ----------

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

// ---------- 排版和模式 ----------

/** 把字号、行距、页边距套到阅读页上（CSS 变量）。 */
function applyTypography() {
  const { fontSize, lineHeight, margin } = getSettings();
  const style = $('view-reader').style;
  style.setProperty('--reader-font-size', `${fontSize}px`);
  style.setProperty('--reader-line-height', String(lineHeight));
  style.setProperty('--reader-margin', `${margin}px`);
}

function hideMenu() {
  setMenuVisible(false);
  closeSettingsPanel();
  anchor = null; // 设置面板关了，这一轮调整结束
}

function onTap(zone) {
  // 菜单开着的时候，点哪里都只是收起菜单，不翻页。
  if (isMenuVisible()) {
    hideMenu();
  } else if (zone === 'menu') {
    setMenuVisible(true);
  } else {
    mode.turn(zone === 'next' ? 1 : -1);
  }
}

function startMode(name) {
  const deps = {
    scroller: $('reader-scroll'),
    content: $('reader-content'),
    getMargin: () => getSettings().margin,
    onNavigate: navigate,
    onTap,
    onMove: onUserMoved,
  };
  modeName = name;
  mode = name === 'page' ? createPageMode(deps) : createScrollMode(deps);
  $('view-reader').dataset.mode = name;
  mode.activate();
}

function renderCurrent() {
  mode.render({
    title: state.chapter.title,
    paragraphs: state.chapter.paragraphs,
    hasPrev: state.chapterIdx > 0,
    hasNext: state.chapterIdx < state.toc.length - 1,
  });
}

/**
 * 某项设置变了。保持「屏幕上第一个可见的字」不变。
 *
 * 连续调整时（比如连点 7 次「增大字号」）始终以第一次调整前的位置为锚点。
 * 如果每次都拿「当前这一页的第一个字」重新定位，字号每大一档，页首就往前挪一点，
 * 几次累积下来原来在读的那个字会被挤到后面的页去，读者看到的是越调越往回退。
 */
async function onSettingChanged(key) {
  if (!state || key === 'theme') return;
  if (anchor === null) anchor = mode.getOffset();
  const offset = anchor;
  if (key === 'mode') {
    mode.deactivate();
    startMode(getSettings().mode);
    renderCurrent();
  } else {
    applyTypography();
    mode.relayout();
  }
  mode.restore(offset);
  anchorScrollTop = $('reader-scroll').scrollTop;
  await saveNow();
}

/** 读者自己翻了页或滚动了：之前的锚点作废。 */
function onUserMoved() {
  if (anchor !== null) {
    // 滚动模式下，重新定位本身也会触发滚动事件；滚动位置和定位后的一致，说明不是读者滚的。
    const programmatic = modeName === 'scroll' && Math.abs($('reader-scroll').scrollTop - anchorScrollTop) <= 2;
    if (!programmatic) anchor = null;
  }
  // 翻页是一个明确的动作，翻完立刻保存；滚动是连续的，停下之后再保存。
  if (modeName === 'page') saveNow();
  else scheduleSave();
}

/** 屏幕尺寸变了（比如横竖屏切换）：翻页模式要重新分页。 */
function onResize() {
  if (!state) return;
  const offset = mode.getOffset();
  mode.relayout();
  mode.restore(offset);
}

// ---------- 章节 ----------

/**
 * 显示某一章。
 * @param {number} idx 第几章
 * @param {{ offset?: number, atEnd?: boolean }} [where] 章内位置；atEnd 为真表示定位到章末
 */
async function showChapter(idx, { offset = 0, atEnd = false } = {}) {
  const paragraphs = (await getChapterParas(state.book.id, idx)) ?? [];
  state.chapterIdx = idx;
  state.chapter = { title: state.toc[idx].title, paragraphs };
  anchor = null; // 换章了，锚点是上一章里的位置，作废
  renderCurrent();
  if (atEnd) mode.scrollToEnd();
  else mode.restore(offset);
  updateMenu({ chapterTitle: state.chapter.title });
  await saveNow();
}

/**
 * 换到上一章（-1）或下一章（+1）。
 * @param {boolean} fromEnd 进入上一章时是否落在章末（翻页模式往回翻时为真）
 */
async function navigate(delta, fromEnd = false) {
  const target = state.chapterIdx + delta;
  if (target < 0) {
    showToast('已是第一页');
  } else if (target >= state.toc.length) {
    showToast('已是最后一页');
  } else {
    await showChapter(target, { atEnd: fromEnd });
  }
}

function showToc() {
  closeSettingsPanel();
  openToc(state.toc, state.chapterIdx, async (idx) => {
    hideMenu();
    await showChapter(idx);
  });
}

function toggleSettings() {
  if (isSettingsPanelOpen()) closeSettingsPanel();
  else openSettingsPanel();
}

// ---------- 打开和关闭 ----------

export async function openReader(bookId) {
  const [book, toc, progress] = await Promise.all([getBook(bookId), getToc(bookId), getProgress(bookId)]);
  if (!book || !toc.length) return false;

  state = { book, toc, lens: toc.map((e) => e.len), chapterIdx: 0, chapter: null };

  // 先把阅读页显示出来再排版：翻页模式要量屏幕宽度，隐藏状态下量不到。
  $('view-shelf').hidden = true;
  $('view-reader').hidden = false;
  hideMenu();
  applyTypography();
  startMode(getSettings().mode);
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
  closeSettingsPanel();
  mode.deactivate();
  mode = null;
  modeName = null;
  state = null;
  // 先让书架按最新的进度和排序刷新完，再切换显示，避免先闪一下旧数据。
  await onClosed();
  $('view-reader').hidden = true;
  $('view-shelf').hidden = false;
}

/** 只需调用一次。onClose 在回到书架后调用。 */
export function setupReader({ onClose }) {
  onClosed = onClose;
  setupMenu({ onBack: closeReader, onToc: showToc, onSettings: toggleSettings });
  setupToc();
  setupSettingsPanel({ onChange: onSettingChanged });
  // 切到后台或关闭时立刻保存：iOS 会直接结束后台的 App，等不到定时器。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  window.addEventListener('pagehide', () => { saveNow(); });
  window.addEventListener('resize', onResize);
}
