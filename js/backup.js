// 备份：把书架、进度、设置（可选：正文）导出成 JSON；从 JSON 恢复。
//
// 备份文件的格式（backupVersion 1）：
// {
//   app: "txt-reader", backupVersion: 1, schemaVersion, exportedAt,
//   settings: { mode, fontSize, lineHeight, margin, theme },
//   books: [ { meta, toc: [{ title, len }], progress | null, chapters?: [每章的文本] } ]
// }
import { SCHEMA_VERSION } from './storage/db.js';
import { listBooks, getToc, getAllChapterTexts, findBookByFile, saveBookRaw } from './storage/books.js';
import { getAllProgress, putProgressRecord, putPending, fileKeyOf } from './storage/progress.js';
import { getSettings, updateSetting } from './settings.js';

export const APP_ID = 'txt-reader';
export const BACKUP_VERSION = 1;
/** 包含正文的备份超过这个大小就先警告（字节）。 */
export const SIZE_WARN_BYTES = 100 * 1024 * 1024;

/** 恢复失败时抛出的错误，message 直接显示给用户。 */
export class BackupError extends Error {}

/**
 * 估算备份文件的大小（字节）。正文按每个字 3 字节算（中文在 UTF-8 里是 3 字节）。
 * @param {{ totalLen: number, chapterCount: number }[]} books
 */
export function estimateBytes(books, includeText) {
  let bytes = 500;
  for (const book of books) {
    bytes += 600 + book.chapterCount * 60;
    if (includeText) bytes += book.totalLen * 3;
  }
  return bytes;
}

/** 把字节数写成给人看的大小。 */
export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 生成备份文件的内容。
 * 分段拼成 Blob，不在内存里拼一个完整的大字符串：含正文时可能有上百 MB。
 * @returns {Promise<{ blob: Blob, bookCount: number }>}
 */
export async function buildBackup({ includeText }) {
  const [books, progress] = await Promise.all([listBooks(), getAllProgress()]);
  const head = JSON.stringify({
    app: APP_ID,
    backupVersion: BACKUP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
  });
  // head 是 {...}，去掉结尾的 }，后面接 "books" 字段。
  const parts = [head.slice(0, -1), ',"books":['];
  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const entry = JSON.stringify({
      meta: book,
      toc: await getToc(book.id),
      progress: progress.get(book.id) ?? null,
    });
    parts.push(i ? ',' : '', entry.slice(0, -1));
    if (includeText) {
      const texts = await getAllChapterTexts(book.id);
      parts.push(',"chapters":[');
      texts.forEach((text, n) => parts.push(n ? ',' : '', JSON.stringify(text)));
      parts.push(']');
    }
    parts.push('}');
  }
  parts.push(']}');
  return { blob: new Blob(parts, { type: 'application/json' }), bookCount: books.length };
}

function validate(data) {
  if (!data || typeof data !== 'object' || data.app !== APP_ID || !Array.isArray(data.books)) {
    throw new BackupError('这不是本 App 的备份文件');
  }
  if (!(data.backupVersion <= BACKUP_VERSION)) {
    throw new BackupError('这个备份是更新版本的 App 导出的，请先更新 App');
  }
  for (const book of data.books) {
    const meta = book?.meta;
    const ok = meta && typeof meta.id === 'string' && typeof meta.fileName === 'string'
      && Number.isFinite(meta.fileSize) && Array.isArray(book.toc)
      && (book.chapters === undefined || (Array.isArray(book.chapters) && book.chapters.length === book.toc.length));
    if (!ok) throw new BackupError('备份文件的内容不完整');
  }
}

const usable = (progress, chapterCount) =>
  progress && Number.isInteger(progress.chapterIdx) && progress.chapterIdx >= 0 && progress.chapterIdx < chapterCount;

/**
 * 从备份文件的文本恢复。书架上已有的书不会被删除。
 * @param {string} text 备份文件的内容
 * @returns {Promise<{ restored: string[], progressOnly: string[], waiting: string[] }>}
 *   restored      连同正文一起恢复的书
 *   progressOnly  书架上已有、只更新了进度的书
 *   waiting       备份里没有正文、书架上也没有，等待重新导入的书
 * @throws {BackupError}
 */
export async function restoreBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('文件不是合法的 JSON，可能不是备份文件或已损坏');
  }
  validate(data);

  // 先全部检查完再动数据库：格式有问题时一点都不写。
  for (const [key, value] of Object.entries(data.settings ?? {})) {
    await updateSetting(key, value); // 不合法的项会被忽略
  }

  const result = { restored: [], progressOnly: [], waiting: [] };
  for (const { meta, toc, progress, chapters } of data.books) {
    const existing = await findBookByFile(meta.fileName, meta.fileSize);
    if (existing) {
      // 书架上已有同一本书：正文不动，进度以备份为准。
      if (usable(progress, existing.chapterCount)) {
        await putProgressRecord({ ...progress, bookId: existing.id });
      }
      result.progressOnly.push(existing.title);
    } else if (chapters) {
      await saveBookRaw(meta, toc, chapters);
      if (usable(progress, toc.length)) await putProgressRecord({ ...progress, bookId: meta.id });
      result.restored.push(meta.title);
    } else {
      await putPending({
        fileKey: fileKeyOf(meta.fileName, meta.fileSize),
        title: meta.title,
        progress: usable(progress, toc.length) ? progress : null,
        lastReadAt: meta.lastReadAt ?? null,
      });
      result.waiting.push(meta.title);
    }
  }
  return result;
}
