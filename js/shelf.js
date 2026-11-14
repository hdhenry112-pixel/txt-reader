// 书架页：书的列表、导入、等待重新导入的提示。
import { listBooks } from './storage/books.js';
import { getAllProgress, listPending } from './storage/progress.js';
import { importFiles } from './importer/importer.js';
import { setupBookActions, openBookActions } from './book-actions.js';
import { infoDialog } from './ui/dialog.js';
import { showToast } from './ui/toast.js';

const $ = (id) => document.getElementById(id);

let onOpen = () => {};

/** 排序：读过的按最近阅读时间倒序在前；没读过的按导入时间倒序在后。 */
export function sortBooks(books) {
  return [...books].sort((a, b) => {
    if (a.lastReadAt && b.lastReadAt) return b.lastReadAt - a.lastReadAt;
    if (a.lastReadAt) return -1;
    if (b.lastReadAt) return 1;
    return b.addedAt - a.addedAt;
  });
}

function bookRow(book, percent) {
  const row = document.createElement('article');
  row.className = 'book';
  row.dataset.bookId = book.id;

  // 书名和进度这一块整体是一个按钮，点了打开这本书。
  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'book-info';
  info.setAttribute('aria-label', `打开《${book.title}》`);
  info.addEventListener('click', () => onOpen(book.id));

  const title = document.createElement('span');
  title.className = 'book-title';
  title.textContent = book.title;
  info.append(title);

  const meta = document.createElement('span');
  meta.className = 'book-meta';
  const pct = document.createElement('span');
  pct.className = 'book-percent';
  // 写明「已读」：只写一个百分比，刚导入完时会被当成导入进度。
  pct.textContent = `已读 ${percent}%`;
  meta.append(pct);
  if (book.encodingSuspect) {
    const warn = document.createElement('span');
    warn.className = 'book-warn';
    warn.textContent = '编码可能有误';
    meta.append(warn);
  }
  info.append(meta);

  const bar = document.createElement('span');
  bar.className = 'book-bar';
  const fill = document.createElement('span');
  fill.className = 'book-bar-fill';
  fill.style.width = `${percent}%`;
  bar.append(fill);
  info.append(bar);

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'book-more';
  more.textContent = '⋯';
  more.setAttribute('aria-label', `《${book.title}》的更多操作`);
  more.addEventListener('click', () => openBookActions(book));

  row.append(info, more);
  return row;
}

/** 从「不含正文」的备份恢复后，还没重新导入的书。 */
function renderPending(pending) {
  const notice = $('pending-notice');
  notice.hidden = pending.length === 0;
  notice.textContent = pending.length
    ? `有 ${pending.length} 本书等待重新导入：${pending.map((p) => `《${p.title}》`).join('')}。导入对应的文件后会自动接回阅读进度。`
    : '';
}

export async function renderShelf() {
  const [books, progress, pending] = await Promise.all([listBooks(), getAllProgress(), listPending()]);
  const rows = sortBooks(books).map((book) => bookRow(book, progress.get(book.id)?.percent ?? 0));
  $('shelf-list').replaceChildren(...rows);
  $('shelf-empty').hidden = books.length > 0;
  renderPending(pending);
}

/** 把导入结果整理成给用户看的文字。 */
export function summarize({ imported, skipped, failed }) {
  const lines = [];
  if (imported.length) lines.push(`成功 ${imported.length} 本`);
  if (skipped.length) {
    lines.push(`跳过 ${skipped.length} 本`);
    for (const title of skipped) lines.push(`《${title}》已在书架`);
  }
  if (failed.length) {
    lines.push(`失败 ${failed.length} 本`);
    for (const { name, reason } of failed) lines.push(`${name}：${reason}`);
  }
  return lines;
}

async function onFilesChosen(input) {
  const files = [...input.files];
  // 清空选择，这样下次选同一个文件也会触发 change。
  input.value = '';
  if (!files.length) return;

  const status = $('import-status');
  status.hidden = false;
  const result = await importFiles(files, (index, total, title, pdfPage) => {
    status.textContent = `正在导入 ${index}/${total}：${title}`
      + (pdfPage ? `（第 ${pdfPage.page} / ${pdfPage.pages} 页）` : '');
  });
  status.hidden = true;
  await renderShelf();

  if (result.skipped.length || result.failed.length) {
    await infoDialog({ title: '导入结果', lines: summarize(result) });
  } else {
    showToast(`已导入 ${result.imported.length} 本`);
  }
}

/** @param {{ onOpen: (bookId: string) => void }} handlers onOpen 在用户点了一本书时调用 */
export function setupShelf(handlers) {
  onOpen = handlers.onOpen;
  const input = $('import-input');
  input.addEventListener('change', () => onFilesChosen(input));
  setupBookActions({ onChanged: renderShelf });
  return renderShelf();
}
