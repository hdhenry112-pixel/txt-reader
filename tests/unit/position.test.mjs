// 进度百分比的锚点（spec ④「进度」P1–P4 的算式部分）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePercent } from '../../js/reader/position.js';

// F1 各章字数：前言 200，第 k 个标题 k × 1000。全书 55200。
const F1 = [200, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];

test('P1 开头：0%', () => {
  assert.equal(computePercent(F1, 0, 0, false), 0);
});

test('P2 第 4 项开头：6200 ÷ 55200 = 11.23% → 11%', () => {
  assert.equal(computePercent(F1, 4, 0, false), 11);
});

test('P3 第 10 项开头：45200 ÷ 55200 = 81.88% → 向下取整 81%', () => {
  assert.equal(computePercent(F1, 10, 0, false), 81);
});

test('去相关：章号错位一位会得到别的数（第 3 项 5%，第 5 项 18%）', () => {
  assert.equal(computePercent(F1, 3, 0, false), 5);
  assert.equal(computePercent(F1, 5, 0, false), 18);
});

test('章内位置计入：第 7 项第 3500 字，(200 + 21000 + 3500) ÷ 55200 = 44.75% → 44%', () => {
  assert.equal(computePercent(F1, 7, 3500, false), 44);
});

test('P4 到达全书末尾：100%；没到末尾时最后一个字也不是 100%', () => {
  assert.equal(computePercent(F1, 10, 9999, true), 100);
  assert.equal(computePercent(F1, 10, 9999, false), 99);
});

test('边界：全书 0 字时是 0%，不出现除以零', () => {
  assert.equal(computePercent([0, 0], 1, 0, false), 0);
});
