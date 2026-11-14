// 「更多」面板里的「手势密码」一节：开启、修改、关闭。
//
// 画图案在一个盖满屏幕的画板页（#pattern-sheet）上进行：
//   开启：画一个图案 → 再画一次确认
//   修改：画当前的图案 → 画一个新图案 → 再画一次确认
//   关闭：画当前的图案
// 画当前的图案时画错和锁屏页一样计数（连错 5 次要等 30 秒）。
import { isLockEnabled, setPattern, clearLock, verifyPattern, secondsToWait } from './lock-store.js';
import { MIN_POINTS, patternText } from './rules.js';
import { createPad } from './pad.js';
import { showToast } from '../ui/toast.js';

const $ = (id) => document.getElementById(id);

const TITLES = {
  verify: '画当前的图案',
  first: '画一个新图案',
  second: '再画一次确认',
};
const DONE_TEXT = {
  enable: '手势密码已开启',
  change: '手势密码已修改',
  disable: '手势密码已关闭',
};

let pad = null;
let flow = null; // { kind: 'enable'|'change'|'disable', stage: 'verify'|'first'|'second', first: number[]|null }
let busy = false;

const hint = (text) => { $('sheet-hint').textContent = text; };

function setStage(stage) {
  flow.stage = stage;
  $('sheet-title').textContent = TITLES[stage];
  pad.reset();
}

function openSheet(kind) {
  flow = { kind, stage: null, first: null };
  $('pattern-sheet').hidden = false;
  hint('');
  setStage(kind === 'enable' ? 'first' : 'verify');
}

function closeSheet() {
  flow = null;
  $('pattern-sheet').hidden = true;
}

function finish() {
  const { kind } = flow;
  closeSheet();
  refreshLockSection();
  showToast(DONE_TEXT[kind]);
}

async function onVerify(seq) {
  const result = await verifyPattern(seq);
  if (result === 'ok') {
    if (flow.kind === 'disable') {
      clearLock();
      finish();
    } else {
      hint('');
      setStage('first');
    }
    return;
  }
  const seconds = secondsToWait();
  if (result === 'wrong') pad.markError();
  hint(seconds > 0 ? `画错次数太多，请 ${seconds} 秒后再试` : '图案不对');
}

async function onDrawn(seq) {
  if (busy || !flow) return;
  if (seq.length < MIN_POINTS) {
    pad.markError();
    hint(`至少连 ${MIN_POINTS} 个点`);
    return;
  }
  busy = true;
  try {
    if (flow.stage === 'verify') {
      await onVerify(seq);
    } else if (flow.stage === 'first') {
      flow.first = seq;
      hint('');
      setStage('second');
    } else if (patternText(seq) === patternText(flow.first)) {
      await setPattern(seq);
      finish();
    } else {
      flow.first = null;
      setStage('first');
      hint('两次不一致，请重新画');
    }
  } finally {
    busy = false;
  }
}

/** 按当前是否开启，更新面板里的状态文字和按钮。 */
export function refreshLockSection() {
  const on = isLockEnabled();
  $('lock-status').textContent = on ? '已开启。启动 App、或离开 5 分钟以上再回来时，要先画图案。' : '未开启。';
  $('lock-enable').hidden = on;
  $('lock-change').hidden = !on;
  $('lock-disable').hidden = !on;
}

/** 只需调用一次。 */
export function setupLockSection() {
  pad = createPad($('sheet-pad'), { onComplete: onDrawn });
  $('lock-enable').addEventListener('click', () => openSheet('enable'));
  $('lock-change').addEventListener('click', () => openSheet('change'));
  $('lock-disable').addEventListener('click', () => openSheet('disable'));
  $('sheet-cancel').addEventListener('click', closeSheet);
  refreshLockSection();
}
