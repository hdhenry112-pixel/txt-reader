// 设置的取值规则（spec 3.2「设置」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, DEFAULTS, LIMITS } from '../../js/settings.js';

test('默认值：翻页模式、字号 19、行距 1.8、页边距 20、白天主题', () => {
  assert.deepEqual({ ...DEFAULTS }, { mode: 'page', fontSize: 19, lineHeight: 1.8, margin: 20, theme: 'day' });
});

test('范围：字号 14–30 步长 1，行距 1.4–2.2 步长 0.1，页边距 8–40 步长 4', () => {
  assert.deepEqual({ ...LIMITS.fontSize }, { min: 14, max: 30, step: 1 });
  assert.deepEqual({ ...LIMITS.lineHeight }, { min: 1.4, max: 2.2, step: 0.1 });
  assert.deepEqual({ ...LIMITS.margin }, { min: 8, max: 40, step: 4 });
});

test('超出范围的数值被夹到边界', () => {
  assert.equal(sanitize('fontSize', 13), 14);
  assert.equal(sanitize('fontSize', 31), 30);
  assert.equal(sanitize('lineHeight', 1.3), 1.4);
  assert.equal(sanitize('lineHeight', 2.3), 2.2);
  assert.equal(sanitize('margin', 4), 8);
  assert.equal(sanitize('margin', 44), 40);
});

test('行距逐档相加没有浮点尾巴：1.4 起每次加 0.1，正好得到 1.5 … 2.2', () => {
  let v = 1.4;
  const seen = [v];
  for (let i = 0; i < 8; i++) {
    v = sanitize('lineHeight', v + 0.1);
    seen.push(v);
  }
  assert.deepEqual(seen, [1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2]);
});

test('不在步长上的值对齐到最近的一档', () => {
  assert.equal(sanitize('margin', 21), 20);
  assert.equal(sanitize('margin', 23), 24);
  assert.equal(sanitize('fontSize', 19.4), 19);
});

test('枚举值不合法、数值不是数字、未知的设置项：返回 null（调用方保留原值）', () => {
  assert.equal(sanitize('mode', 'flip'), null);
  assert.equal(sanitize('theme', 'blue'), null);
  assert.equal(sanitize('fontSize', 'abc'), null);
  assert.equal(sanitize('fontSize', undefined), null);
  assert.equal(sanitize('nope', 1), null);
  assert.equal(sanitize('mode', 'scroll'), 'scroll');
  assert.equal(sanitize('theme', 'night'), 'night');
});
