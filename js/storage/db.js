// 打开 IndexedDB、执行迁移。
//
// 迁移规则（详见 CLAUDE.md）：
//   - MIGRATIONS[i] 把数据库从版本 i 升到版本 i+1。只能在数组末尾追加，不能改已发布的迁移。
//   - 迁移只允许新增或转换，不允许清空已有仓库。
//   - 每加一个迁移，SCHEMA_VERSION 自动加 1（它就是数组长度）。

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
];

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
