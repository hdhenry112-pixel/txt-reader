// books / tocs / chapterGroups 三个仓库的读写。
// 书的元数据、目录、正文分开存：书架页只读 books；打开书只读一条目录和一组章节。
//
// 正文每 CHAPTERS_PER_GROUP 章存成一条记录（原因见 db.js 里版本 1 → 2 的迁移）。
// 这个文件以外的代码不需要知道分组这回事：对外仍然是「按章号读一章」「给出每章的文本存一本书」。
import { getDb, done, committed, CHAPTERS_PER_GROUP } from './db.js';

/** 一本书所有章节组的主键范围。 */
const groupsOf = (bookId) => IDBKeyRange.bound([bookId, 0], [bookId, Number.MAX_SAFE_INTEGER]);

// 最近读过的一组章节留在内存里：顺着往下读时，一组里的 50 章只读一次数据库。
let cached = null; // { bookId, group, texts }

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
export function saveBook(meta, chapters) {
  return saveBookRaw(
    meta,
    chapters.map((c) => ({ title: c.title, len: c.len })),
    chapters.map((c) => c.paras.join('\n')),
  );
}

/**
 * 同 saveBook，但直接给目录和每章的文本（从备份恢复、换编码重新导入时用）。
 * @param {object} meta
 * @param {{ title: string, len: number }[]} entries 目录
 * @param {string[]} texts 每章的文本，段落之间用换行连接；和 entries 一一对应
 * @param {{ resetProgress?: boolean }} [options] resetProgress 为真时在同一个事务里删掉这本书的进度
 */
export async function saveBookRaw(meta, entries, texts, { resetProgress = false } = {}) {
  const db = await getDb();
  const tx = db.transaction(['books', 'tocs', 'chapterGroups', 'progress'], 'readwrite');
  const groups = tx.objectStore('chapterGroups');
  // 先清掉这本书可能已有的章节（「换编码重新导入」时章节数会变）。
  groups.delete(groupsOf(meta.id));
  tx.objectStore('books').put(meta);
  tx.objectStore('tocs').put({ bookId: meta.id, entries });
  for (let start = 0; start < texts.length; start += CHAPTERS_PER_GROUP) {
    groups.put({
      bookId: meta.id,
      group: start / CHAPTERS_PER_GROUP,
      texts: texts.slice(start, start + CHAPTERS_PER_GROUP),
    });
  }
  if (resetProgress) tx.objectStore('progress').delete(meta.id);
  await committed(tx);
  if (cached?.bookId === meta.id) cached = null;
}

/** 一本书全部章节的文本，按章序排列（导出备份时用）。 */
export async function getAllChapterTexts(bookId) {
  const db = await getDb();
  const records = await done(db.transaction('chapterGroups').objectStore('chapterGroups').getAll(groupsOf(bookId)));
  return records.flatMap((r) => r.texts);
}

/** 删除一本书的元数据、目录、全部章节和进度。 */
export async function deleteBook(id) {
  const db = await getDb();
  const tx = db.transaction(['books', 'tocs', 'chapterGroups', 'progress'], 'readwrite');
  tx.objectStore('books').delete(id);
  tx.objectStore('tocs').delete(id);
  tx.objectStore('chapterGroups').delete(groupsOf(id));
  tx.objectStore('progress').delete(id);
  await committed(tx);
  if (cached?.bookId === id) cached = null;
}

/** 目录：[{ title, len }]。 */
export async function getToc(bookId) {
  const db = await getDb();
  const record = await done(db.transaction('tocs').objectStore('tocs').get(bookId));
  return record ? record.entries : [];
}

/** 一章的段落数组；这一章不存在时返回 null。 */
export async function getChapterParas(bookId, idx) {
  const group = Math.floor(idx / CHAPTERS_PER_GROUP);
  if (!cached || cached.bookId !== bookId || cached.group !== group) {
    const db = await getDb();
    const record = await done(db.transaction('chapterGroups').objectStore('chapterGroups').get([bookId, group]));
    if (!record) return null;
    cached = { bookId, group, texts: record.texts };
  }
  const text = cached.texts[idx % CHAPTERS_PER_GROUP];
  if (text === undefined || text === null) return null;
  return text === '' ? [] : text.split('\n');
}

/** 一本书实际存了多少章的正文（测试和自检用）。 */
export async function countChapters(bookId) {
  return (await getAllChapterTexts(bookId)).length;
}
