// 设置：默认值、取值范围、读取、保存、套用主题。全局一份，所有书通用。
import { getDb, done, committed } from './storage/db.js';

export const DEFAULTS = Object.freeze({
  mode: 'page',     // 'page' 翻页 | 'scroll' 滚动
  fontSize: 19,     // 像素
  lineHeight: 1.8,
  margin: 20,       // 页边距，像素
  theme: 'day',     // 'day' 白天 | 'sepia' 护眼 | 'night' 夜间
});

/** 数值类设置的范围和步长。 */
export const LIMITS = Object.freeze({
  fontSize: { min: 14, max: 30, step: 1 },
  lineHeight: { min: 1.4, max: 2.2, step: 0.1 },
  margin: { min: 8, max: 40, step: 4 },
});

const CHOICES = Object.freeze({
  mode: ['page', 'scroll'],
  theme: ['day', 'sepia', 'night'],
});

const THEME_MIRROR_KEY = 'txt-reader:theme';

// 设置日志：和阅读位置的日志是同一个道理（见 js/storage/progress.js）。
// 改完设置立刻关掉 App 时，写 IndexedDB 的操作会被中途掐断，这次改动就丢了。
// 所以每次改设置先把整份设置同步写进 localStorage，数据库写成功后擦掉；
// 启动时如果它还在，说明上次数据库没写成，以它为准并补进数据库。
const JOURNAL_KEY = 'txt-reader:settings-journal';

function readJournal() {
  try {
    return JSON.parse(localStorage.getItem(JOURNAL_KEY));
  } catch {
    return null;
  }
}

async function persist() {
  const snapshot = JSON.stringify(current);
  try { localStorage.setItem(JOURNAL_KEY, snapshot); } catch { /* 放弃日志，数据库那一路照常 */ }
  const db = await getDb();
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ key: 'global', ...JSON.parse(snapshot) });
  await committed(tx);
  // 数据库写成功了。日志如果还是这一份就擦掉；已经被更新的改动覆盖了就留着。
  try {
    if (localStorage.getItem(JOURNAL_KEY) === snapshot) localStorage.removeItem(JOURNAL_KEY);
  } catch { /* 同上 */ }
}

let current = { ...DEFAULTS };

/** 把一个值修正成合法值：数值夹到范围内并对齐步长；枚举值不合法时返回 null。 */
export function sanitize(key, value) {
  if (key in LIMITS) {
    const { min, max, step } = LIMITS[key];
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const stepped = min + Math.round((Math.min(Math.max(n, min), max) - min) / step) * step;
    // 消掉 1.4 + 3 × 0.1 = 1.7000000000000002 这类浮点尾巴。
    return Math.round(stepped * 100) / 100;
  }
  if (key in CHOICES) return CHOICES[key].includes(value) ? value : null;
  return null;
}

export function getSettings() {
  return { ...current };
}

/** 把主题套到页面上，并在 localStorage 留一份副本给 theme-boot.js 启动时用。 */
function applyTheme() {
  document.documentElement.dataset.theme = current.theme;
  try { localStorage.setItem(THEME_MIRROR_KEY, current.theme); } catch { /* 不影响使用 */ }
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

/** App 启动时调用一次。数据库里没有或某项不合法时用默认值。 */
export async function loadSettings() {
  const db = await getDb();
  const saved = (await done(db.transaction('settings').objectStore('settings').get('global'))) ?? {};
  const journal = readJournal();
  // 每一项依次取：日志里的值（它比数据库新）→ 数据库里的值 → 默认值。前一个不合法才用后一个。
  const sources = [journal && typeof journal === 'object' ? journal : {}, saved];
  current = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    for (const source of sources) {
      const value = sanitize(key, source[key]);
      if (value !== null) {
        current[key] = value;
        break;
      }
    }
  }
  applyTheme();
  if (journal) await persist();
  return getSettings();
}

/**
 * 改一项设置并保存。值会先被修正成合法值；不合法或没变化时不保存。
 * @returns {Promise<boolean>} 是否真的变了
 */
export async function updateSetting(key, value) {
  const clean = sanitize(key, value);
  if (clean === null || clean === current[key]) return false;
  current = { ...current, [key]: clean };
  if (key === 'theme') applyTheme();
  await persist();
  return true;
}

/** 数值类设置加一档（dir = 1）或减一档（dir = -1）。 */
export function stepSetting(key, dir) {
  return updateSetting(key, current[key] + dir * LIMITS[key].step);
}
