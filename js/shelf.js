// 书架页：书的列表、导入、删除。
import { listBooks, deleteBook } from './storage/books.js';
import { getAllProgress } from './storage/progress.js';
import { importFiles } from './importer/importer.js';
import { confirmDialog, infoDialog } from './ui/dialog.js';
import { showToast } from './ui/toast.js';

const $ = (id) => document.getElementById(id);

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

  const info = document.createElement('div');
  info.className = 'book-info';

  const title = document.createElement('h2');
  title.className = 'book-title';
  title.textContent = book.title;
  info.append(title);

  const meta = document.createElement('div');
  meta.className = 'book-meta';
  const pct = document.createElement('span');
  pct.className = 'book-percent';
  pct.textContent = `${percent}%`;
  meta.append(pct);
  if (book.encodingSuspect) {
    const warn = document.createElement('span');
    warn.className = 'book-warn';
    warn.textContent = '编码可能有误';
    meta.append(warn);
  }
  info.append(meta);

  const bar = document.createElement('div');
  bar.className = 'book-bar';
  const fill = document.createElement('div');
  fill.className = 'book-bar-fill';
  fill.style.width = `${percent}%`;
  bar.append(fill);
  info.append(bar);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'book-delete';
  del.textContent = '删除';
  del.setAttribute('aria-label', `删除《${book.title}》`);
  del.addEventListener('click', () => onDelete(book));

  row.append(info, del);
  return row;
}

export async function renderShelf() {
  const [books, progress] = await Promise.all([listBooks(), getAllProgress()]);
  const rows = sortBooks(books).map((book) => bookRow(book, progress.get(book.id)?.percent ?? 0));
  $('shelf-list').replaceChildren(...rows);
  $('shelf-empty').hidden = books.length > 0;
}

async function onDelete(book) {
  const ok = await confirmDialog({
    title: `删除《${book.title}》？`,
    lines: ['这本书的正文和阅读进度会从手机里删除，不能恢复。'],
    okText: '删除',
    danger: true,
  });
  if (!ok) return;
  await deleteBook(book.id);
  await renderShelf();
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
  const result = await importFiles(files, (index, total, title) => {
    status.textContent = `正在导入 ${index}/${total}：${title}`;
  });
  status.hidden = true;
  await renderShelf();

  if (result.skipped.length || result.failed.length) {
    await infoDialog({ title: '导入结果', lines: summarize(result) });
  } else {
    showToast(`已导入 ${result.imported.length} 本`);
  }
}

export function setupShelf() {
  const input = $('import-input');
  input.addEventListener('change', () => onFilesChosen(input));
  return renderShelf();
}
