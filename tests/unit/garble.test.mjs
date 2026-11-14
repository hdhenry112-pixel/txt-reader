// C9：乱码判断（js/importer/garble.js）。锚点 X2、X3 见 docs/spec-m5.md。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGarbled, commonCharCount, MIN_HAN, MIN_COMMON_RATIO } from '../../js/importer/garble.js';

const COMMON = '的'; // GB2312 一级字
const RARE = '丗'; // 不在 GB2312 里（乱码 PDF 里出现过的字）

test('常量：至少 200 个汉字才判断，阈值 80%；GB2312 一级字正好 3755 个', () => {
  assert.equal(MIN_HAN, 200);
  assert.equal(MIN_COMMON_RATIO, 0.8);
  assert.equal(commonCharCount(), 3755);
});

test('X2：1000 个汉字里一级字 800 个（正好 80%）算正常，799 个判定乱码', () => {
  const ok = checkGarbled([COMMON.repeat(800) + RARE.repeat(200)]);
  assert.deepEqual(ok, { han: 1000, common: 800, garbled: false });
  const bad = checkGarbled([COMMON.repeat(799) + RARE.repeat(201)]);
  assert.deepEqual(bad, { han: 1000, common: 799, garbled: true });
});

test('X3：全是生僻字时，199 个汉字不判断（算正常），200 个判定乱码', () => {
  assert.equal(checkGarbled([RARE.repeat(199)]).garbled, false);
  assert.equal(checkGarbled([RARE.repeat(200)]).garbled, true);
});

test('只数汉字：标点、数字、英文不计入', () => {
  const r = checkGarbled(['“中国，1967 年。”Hello world！'.repeat(10)]);
  assert.equal(r.han, 30);
  assert.equal(r.common, 30);
});

test('截图里的真实乱码片段判定为乱码，对应的正确文字判定为正常', () => {
  // 来自《三体》三部完整精校版.pdf 第 1 页：同一句话的乱码版本和正确版本，各重复到超过 200 个汉字
  const garbled = '丛国，1967 年。“糠膕罬厯”对“喑．乔傋傒喔”徛逤堕楼畈攻傴屠持紁乐丗堖';
  const correct = '中国，1967 年。“红色联合”对“四．二八兵团”总部大楼的攻击已持续了两天';
  assert.equal(checkGarbled([garbled.repeat(10)]).garbled, true);
  assert.equal(checkGarbled([correct.repeat(10)]).garbled, false);
});
