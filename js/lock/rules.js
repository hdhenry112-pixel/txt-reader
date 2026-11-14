// 手势密码的规则（纯函数）：图案怎么记、画错了怎么罚。
// 九个点编号 0–8，从左到右、从上到下：
//   0 1 2
//   3 4 5
//   6 7 8

/** 至少连几个点。 */
export const MIN_POINTS = 4;
/** 连续画错几次开始要等。 */
export const MAX_FAILS = 5;
/** 每次要等多久（毫秒）。 */
export const WAIT_MS = 30_000;
/** 离开前台多久以后回来要重新画（毫秒）。 */
export const RELOCK_MS = 5 * 60_000;

/**
 * 从点 from 直线划到点 to 时，正好经过的中间点；没有就返回 null。
 * 九宫格里只有「两点的行号之和、列号之和都是偶数」时中点才落在一个格点上（如 0→2 经过 1，0→8 经过 4）。
 */
export function middlePoint(from, to) {
  const r1 = Math.floor(from / 3), c1 = from % 3;
  const r2 = Math.floor(to / 3), c2 = to % 3;
  if ((r1 + r2) % 2 !== 0 || (c1 + c2) % 2 !== 0) return null;
  const mid = ((r1 + r2) / 2) * 3 + (c1 + c2) / 2;
  return mid === from || mid === to ? null : mid;
}

/**
 * 手指碰到点 point 之后的新序列。已经连过的点不再连；
 * 从上一个点直线过来、中间正好经过一个还没连过的点时，先把那个点连上。
 * 不改动传入的数组。
 */
export function addPoint(seq, point) {
  if (seq.includes(point)) return seq;
  const next = [...seq];
  if (next.length) {
    const mid = middlePoint(next[next.length - 1], point);
    if (mid !== null && !next.includes(mid)) next.push(mid);
  }
  next.push(point);
  return next;
}

/** 图案存进摘要之前的文字形式，如 [0,1,2,5] → "0-1-2-5"。 */
export const patternText = (seq) => seq.join('-');

/** 画错一次以后的计数状态。fails 达到 MAX_FAILS 及以上时，每错一次都要再等 WAIT_MS。 */
export function afterFailure({ fails = 0 }, now) {
  const next = fails + 1;
  return { fails: next, until: next >= MAX_FAILS ? now + WAIT_MS : 0 };
}

/** 现在还要等几秒（向上取整）；不用等返回 0。 */
export function waitSeconds({ until = 0 }, now) {
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}
