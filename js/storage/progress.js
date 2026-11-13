// progress 仓库的读写。M1 只有读取（书架显示进度 %）；保存在 M2 加入。
import { getDb, done } from './db.js';

/** 所有书的进度，返回 Map<bookId, progress>。 */
export async function getAllProgress() {
  const db = await getDb();
  const all = await done(db.transaction('progress').objectStore('progress').getAll());
  return new Map(all.map((p) => [p.bookId, p]));
}
