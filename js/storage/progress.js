// progress 仓库的读写。
import { getDb, done, committed } from './db.js';

/** 所有书的进度，返回 Map<bookId, progress>。 */
export async function getAllProgress() {
  const db = await getDb();
  const all = await done(db.transaction('progress').objectStore('progress').getAll());
  return new Map(all.map((p) => [p.bookId, p]));
}

/** 一本书的进度；没读过返回 undefined。 */
export async function getProgress(bookId) {
  const db = await getDb();
  return done(db.transaction('progress').objectStore('progress').get(bookId));
}

/**
 * 保存进度，同时把这本书的「最近阅读时间」更新为现在（书架按它排序）。
 * 两处在同一个事务里写。书已被删除时什么都不写。
 * @param {string} bookId
 * @param {{ chapterIdx: number, offset: number, percent: number }} position
 */
export async function saveProgress(bookId, { chapterIdx, offset, percent }) {
  // 先同步记一笔到 localStorage，再写数据库。原因见下面「位置日志」的说明。
  writeJournal({ bookId, chapterIdx, offset, percent });
  const db = await getDb();
  const tx = db.transaction(['books', 'progress'], 'readwrite');
  const books = tx.objectStore('books');
  const now = Date.now();
  const request = books.get(bookId);
  request.onsuccess = () => {
    const book = request.result;
    if (!book) return;
    books.put({ ...book, lastReadAt: now });
    tx.objectStore('progress').put({ bookId, chapterIdx, offset, percent, updatedAt: now });
  };
  await committed(tx);
  clearJournalIfSame({ bookId, chapterIdx, offset });
}

/**
 * 原样写入一条进度记录，不改「最近阅读时间」（从备份恢复、认领等待中的进度时用）。
 * @param {{ bookId: string, chapterIdx: number, offset: number, percent: number, updatedAt?: number }} record
 */
export async function putProgressRecord(record) {
  const db = await getDb();
  const tx = db.transaction('progress', 'readwrite');
  tx.objectStore('progress').put({ updatedAt: Date.now(), ...record });
  await committed(tx);
}

// ---------- 等待认领的进度（pending 仓库）----------
// 从「不含正文」的备份恢复时，书的正文不在手机里，进度先放在这里。
// 之后导入的 txt 如果「文件名 + 字节数」对得上，就把进度接回去。

export const fileKeyOf = (fileName, fileSize) => `${fileName}|${fileSize}`;

/** 所有等待重新导入的书：[{ fileKey, title, progress, lastReadAt }]。 */
export async function listPending() {
  const db = await getDb();
  return done(db.transaction('pending').objectStore('pending').getAll());
}

export async function putPending(entry) {
  const db = await getDb();
  const tx = db.transaction('pending', 'readwrite');
  tx.objectStore('pending').put(entry);
  await committed(tx);
}

/** 取出并删除一条等待中的记录；没有则返回 undefined。 */
export async function takePending(fileKey) {
  const db = await getDb();
  const tx = db.transaction('pending', 'readwrite');
  const store = tx.objectStore('pending');
  const entry = await done(store.get(fileKey));
  if (entry) store.delete(fileKey);
  await committed(tx);
  return entry;
}

// ---------- 位置日志 ----------
// 页面关闭或 App 被系统结束时，IndexedDB 的写入是异步的，会被中途掐断，最后一次位置就丢了。
// localStorage 的写入是同步的，调用返回时已经落盘。所以每次保存进度都先在 localStorage 记一笔，
// 数据库写成功后再擦掉；如果数据库没来得及写，下次启动时 recoverJournal() 把这一笔补进数据库。
// 日志里最多只有一条（最近一次的位置），不存正文。

const JOURNAL_KEY = 'txt-reader:position-journal';

function writeJournal(entry) {
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(entry));
  } catch { /* 存储已满或被禁用时放弃日志，数据库那一路照常进行 */ }
}

function readJournal() {
  try {
    return JSON.parse(localStorage.getItem(JOURNAL_KEY));
  } catch {
    return null;
  }
}

/** 数据库写成功后擦掉日志；但如果这期间日志已被更新的位置覆盖，就留着。 */
function clearJournalIfSame({ bookId, chapterIdx, offset }) {
  const entry = readJournal();
  if (entry && entry.bookId === bookId && entry.chapterIdx === chapterIdx && entry.offset === offset) {
    try { localStorage.removeItem(JOURNAL_KEY); } catch { /* 同上 */ }
  }
}

/** App 启动时调用：把上次没来得及写进数据库的位置补进去。 */
export async function recoverJournal() {
  const entry = readJournal();
  if (!entry || typeof entry.bookId !== 'string') return false;
  await saveProgress(entry.bookId, entry);
  // 书已被删除时 saveProgress 不写库，但日志也没有保留的意义了。
  try { localStorage.removeItem(JOURNAL_KEY); } catch { /* 同上 */ }
  return true;
}
