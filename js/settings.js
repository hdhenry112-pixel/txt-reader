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
  current = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const value = sanitize(key, saved[key]);
    if (value !== null) current[key] = value;
  }
  applyTheme();
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
  const db = await getDb();
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ key: 'global', ...current });
  await committed(tx);
  return true;
}

/** 数值类设置加一档（dir = 1）或减一档（dir = -1）。 */
export function stepSetting(key, dir) {
  return updateSetting(key, current[key] + dir * LIMITS[key].step);
}
