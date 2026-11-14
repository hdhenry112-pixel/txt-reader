// 手势密码的存储。
//
// 存在 localStorage 的 txt-reader:lock，不进 IndexedDB：启动第一帧之前（js/lock-boot.js）就要知道有没有上锁，
// 而读 IndexedDB 是异步的。内容：
//   { v: 1, salt, hash, iterations, fails, until }
//   salt / hash：base64。hash = PBKDF2-SHA256(图案文字 "0-1-2-5", salt, iterations)。不存图案本身。
//   fails：连续画错的次数；until：在这个时间（毫秒时间戳）之前不能再画，0 表示不用等。
// 没开启时这个键不存在。备份不读也不写它。
import { patternText, afterFailure, waitSeconds } from './rules.js';

export const LOCK_KEY = 'txt-reader:lock';
const ITERATIONS = 100_000;

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function digest(seq, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(patternText(seq)), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256,
  );
  return toBase64(bits);
}

/** 读出存着的记录；没有或内容不对时返回 null。 */
export function readLock() {
  try {
    const record = JSON.parse(localStorage.getItem(LOCK_KEY));
    if (record && typeof record.salt === 'string' && typeof record.hash === 'string'
      && Number.isInteger(record.iterations)) {
      return { fails: 0, until: 0, ...record };
    }
  } catch { /* 当作没有 */ }
  return null;
}

function writeLock(record) {
  localStorage.setItem(LOCK_KEY, JSON.stringify(record));
}

export const isLockEnabled = () => readLock() !== null;

/** 设成新图案（每次都换新的盐）。错误次数清零。 */
export async function setPattern(seq) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await digest(seq, salt, ITERATIONS);
  writeLock({ v: 1, salt: toBase64(salt), hash, iterations: ITERATIONS, fails: 0, until: 0 });
}

export function clearLock() {
  localStorage.removeItem(LOCK_KEY);
}

/** 现在还要等几秒才能画；不用等返回 0。 */
export function secondsToWait(now = Date.now()) {
  const record = readLock();
  return record ? waitSeconds(record, now) : 0;
}

/**
 * 核对图案。返回 'ok' | 'wrong' | 'wait'（还在等待期，这次不算）。
 * 画对清零错误次数；画错把次数和解禁时间存下来，划掉 App 重开也有效。
 * 没开启密码时返回 'ok'。
 */
export async function verifyPattern(seq) {
  const record = readLock();
  if (!record) return 'ok';
  if (waitSeconds(record, Date.now()) > 0) return 'wait';
  const hash = await digest(seq, fromBase64(record.salt), record.iterations);
  // 算摘要是异步的；这期间记录可能被别处改过（比如关闭了密码），以最新的为准。
  const latest = readLock();
  if (!latest) return 'ok';
  if (hash === latest.hash) {
    writeLock({ ...latest, fails: 0, until: 0 });
    return 'ok';
  }
  writeLock({ ...latest, ...afterFailure(latest, Date.now()) });
  return 'wrong';
}
