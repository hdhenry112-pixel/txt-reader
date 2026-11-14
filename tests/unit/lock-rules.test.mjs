// M5a：手势密码的规则（js/lock/rules.js）。期望值按 spec-m5 3.1 手算。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  middlePoint, addPoint, patternText, afterFailure, waitSeconds, MIN_POINTS, MAX_FAILS, WAIT_MS, RELOCK_MS,
} from '../../js/lock/rules.js';

test('常量和 spec 一致：至少 4 个点、连错 5 次、等 30 秒、离开 5 分钟', () => {
  assert.equal(MIN_POINTS, 4);
  assert.equal(MAX_FAILS, 5);
  assert.equal(WAIT_MS, 30_000);
  assert.equal(RELOCK_MS, 300_000);
});

test('中间点：横、竖、斜各一例，以及不经过格点的情况', () => {
  assert.equal(middlePoint(0, 2), 1);
  assert.equal(middlePoint(2, 0), 1);
  assert.equal(middlePoint(1, 7), 4);
  assert.equal(middlePoint(0, 8), 4);
  assert.equal(middlePoint(6, 2), 4);
  assert.equal(middlePoint(3, 5), 4);
  // 0 → 5（日字形）、0 → 1（相邻）、0 → 7 都不正好经过格点
  assert.equal(middlePoint(0, 5), null);
  assert.equal(middlePoint(0, 1), null);
  assert.equal(middlePoint(0, 7), null);
});

test('从 0 直接划到 2、再到 5、再到 8，记为 0-1-2-5-8（spec K4）', () => {
  let seq = [];
  for (const p of [0, 2, 5, 8]) seq = addPoint(seq, p);
  assert.deepEqual(seq, [0, 1, 2, 5, 8]);
  assert.equal(patternText(seq), '0-1-2-5-8');
});

test('中间点已经连过时不再连；一个点只能连一次', () => {
  // 1 → 0 → 2：经过的 1 已连过，所以是 1-0-2
  let seq = [];
  for (const p of [1, 0, 2]) seq = addPoint(seq, p);
  assert.deepEqual(seq, [1, 0, 2]);
  // 再碰到 0 不变
  assert.deepEqual(addPoint(seq, 0), [1, 0, 2]);
});

test('addPoint 不改动传入的数组', () => {
  const seq = [0];
  addPoint(seq, 2);
  assert.deepEqual(seq, [0]);
});

test('画错计数：前 4 次不用等，第 5 次起每错一次等 30 秒', () => {
  const now = 1_000_000;
  let state = { fails: 0, until: 0 };
  for (let i = 1; i <= 4; i++) {
    state = afterFailure(state, now);
    assert.deepEqual(state, { fails: i, until: 0 });
  }
  state = afterFailure(state, now);
  assert.deepEqual(state, { fails: 5, until: now + 30_000 });
  // 30 秒后再错一次：又是 30 秒
  state = afterFailure(state, now + 30_000);
  assert.deepEqual(state, { fails: 6, until: now + 60_000 });
});

test('剩余秒数：第 29 秒还剩 1 秒，第 30 秒为 0（spec K6 的边界）', () => {
  const t0 = 5_000_000;
  const state = { fails: 5, until: t0 + 30_000 };
  assert.equal(waitSeconds(state, t0), 30);
  assert.equal(waitSeconds(state, t0 + 29_000), 1);
  assert.equal(waitSeconds(state, t0 + 29_999), 1);
  assert.equal(waitSeconds(state, t0 + 30_000), 0);
  assert.equal(waitSeconds({ fails: 0, until: 0 }, t0), 0);
});
