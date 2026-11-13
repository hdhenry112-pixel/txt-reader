// books / tocs / chapters 三个仓库的读写。
// 书的元数据、目录、正文分开存：书架页只读 books；打开书只读一条目录和一条章节。
import { getDb, done, committed } from './db.js';

/** 一本书所有章节的主键范围。 */
const chaptersOf = (bookId) => IDBKeyRange.bound([bookId, 0], [bookId, Number.MAX_SAFE_INTEGER]);

export async function listBooks() {
  const db = await getDb();
  return done(db.transaction('books').objectStore('books').getAll());
}

export async function getBook(id) {
  const db = await getDb();
  return done(db.transaction('books').objectStore('books').get(id));
}

/** 按「文件名 + 字节数」找书，用来判断重复导入。找不到返回 undefined。 */
export async function findBookByFile(fileName, fileSize) {
  const books = await listBooks();
  return books.find((b) => b.fileName === fileName && b.fileSize === fileSize);
}

/**
 * 存一本书。元数据、目录、全部章节在同一个事务里写入：要么全部成功，要么全部不写。
 * @param {object} meta books 仓库的一条记录
 * @param {{ title: string, paras: string[], len: number }[]} chapters
 */
export async function saveBook(meta, chapters) {
  const db = await getDb();
  const tx = db.transaction(['books', 'tocs', 'chapters'], 'readwrite');
  // 先清掉这本书可能已有的章节（「换编码重新导入」时章节数会变）。
  tx.objectStore('chapters').delete(chaptersOf(meta.id));
  tx.objectStore('books').put(meta);
  tx.objectStore('tocs').put({
    bookId: meta.id,
    entries: chapters.map((c) => ({ title: c.title, len: c.len })),
  });
  const store = tx.objectStore('chapters');
  chapters.forEach((c, idx) => {
    store.put({ bookId: meta.id, idx, text: c.paras.join('\n') });
  });
  await committed(tx);
}

/** 删除一本书的元数据、目录、全部章节和进度。 */
export async function deleteBook(id) {
  const db = await getDb();
  const tx = db.transaction(['books', 'tocs', 'chapters', 'progress'], 'readwrite');
  tx.objectStore('books').delete(id);
  tx.objectStore('tocs').delete(id);
  tx.objectStore('chapters').delete(chaptersOf(id));
  tx.objectStore('progress').delete(id);
  await committed(tx);
}

/** 目录：[{ title, len }]。 */
export async function getToc(bookId) {
  const db = await getDb();
  const record = await done(db.transaction('tocs').objectStore('tocs').get(bookId));
  return record ? record.entries : [];
}

/** 一章的段落数组。 */
export async function getChapterParas(bookId, idx) {
  const db = await getDb();
  const record = await done(db.transaction('chapters').objectStore('chapters').get([bookId, idx]));
  if (!record) return null;
  return record.text === '' ? [] : record.text.split('\n');
}

/** 一本书在 chapters 仓库里有多少条记录（测试和自检用）。 */
export async function countChapters(bookId) {
  const db = await getDb();
  return done(db.transaction('chapters').objectStore('chapters').count(chaptersOf(bookId)));
}
