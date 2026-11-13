// 打开 IndexedDB、执行迁移。
//
// 迁移规则（详见 CLAUDE.md）：
//   - MIGRATIONS[i] 把数据库从版本 i 升到版本 i+1。只能在数组末尾追加，不能改已发布的迁移。
//   - 迁移只允许新增或转换，不允许清空已有仓库。
//   - 每加一个迁移，SCHEMA_VERSION 自动加 1（它就是数组长度）。
//   - 一次升级跨多个版本时，各个迁移函数是在同一个升级事务里依次「启动」的。
//     迁移里如果用了游标之类的异步操作（如下面的 1 → 2），后一个迁移启动时它可能还没跑完。
//     所以后面的迁移不能假设前面迁移的异步部分已经完成；真有这种依赖时，要把它接在前一个的回调里。

export const DB_NAME = 'txt-reader';

export const MIGRATIONS = [
  // 版本 0 → 1：建立全部仓库。
  (db) => {
    db.createObjectStore('books', { keyPath: 'id' });
    db.createObjectStore('tocs', { keyPath: 'bookId' });
    db.createObjectStore('chapters', { keyPath: ['bookId', 'idx'] });
    db.createObjectStore('progress', { keyPath: 'bookId' });
    db.createObjectStore('settings', { keyPath: 'key' });
    db.createObjectStore('pending', { keyPath: 'fileKey' });
  },

  // 版本 1 → 2：章节从「一章一条记录」（chapters 仓库）改成「每 50 章一条记录」（chapterGroups 仓库）。
  // 原因：写数据库的耗时主要取决于记录条数，和内容多少几乎无关。实测 WebKit 里每写一条约 15 毫秒，
  // 2000 章的书导入要 30 秒；合并成 40 条后不到 1 秒。
  // 做法：按 [bookId, idx] 的顺序读旧记录，攒满一组写一条新记录，全部搬完后删掉旧仓库。
  // 整个过程在同一个升级事务里：中途失败会整体回滚，数据库停在版本 1，不会丢书。
  (db, tx) => {
    const groups = db.createObjectStore('chapterGroups', { keyPath: ['bookId', 'group'] });
    let current = null;
    const flush = () => {
      if (current) groups.put(current);
      current = null;
    };
    tx.objectStore('chapters').openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        flush();
        db.deleteObjectStore('chapters');
        return;
      }
      const { bookId, idx, text } = cursor.value;
      const group = Math.floor(idx / CHAPTERS_PER_GROUP);
      if (!current || current.bookId !== bookId || current.group !== group) {
        flush();
        current = { bookId, group, texts: [] };
      }
      current.texts[idx % CHAPTERS_PER_GROUP] = text;
      cursor.continue();
    };
  },
];

/**
 * 每条 chapterGroups 记录里放多少章。
 * 第 idx 章在第 floor(idx / 50) 组的第 idx % 50 个位置。
 * 已经写进用户手机里的数据是按这个数分组的：**这个数不能改**。要改分组方式只能再写一个迁移。
 */
export const CHAPTERS_PER_GROUP = 50;

export const SCHEMA_VERSION = MIGRATIONS.length;

/** 把 IDBRequest 包成 Promise。 */
export function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 等事务提交完成。 */
export function committed(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('数据库事务被中止'));
  });
}

/**
 * 打开数据库并按需迁移。
 * 参数只给测试用（迁移测试要用临时库名和额外的迁移）；App 代码用 getDb()。
 */
export function openDb({ name = DB_NAME, migrations = MIGRATIONS } = {}) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, migrations.length);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      for (let v = event.oldVersion; v < migrations.length; v++) migrations[v](db, tx);
    };
    request.onsuccess = () => {
      const db = request.result;
      // 另一个页面要升级数据库时让路，避免把对方卡住。
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('数据库被另一个页面占用，请关掉其他窗口后重试'));
  });
}

let dbPromise = null;

/** App 共用的数据库连接。 */
export function getDb() {
  dbPromise ??= openDb();
  return dbPromise;
}
