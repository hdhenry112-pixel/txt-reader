// 锁屏页：启动时、以及离开前台 ≥ 5 分钟后回来时，要先画对图案。
//
// 锁屏页是盖在整个页面上的一层，底下的书架或阅读页原样不动，所以画对之后就回到原来那一页。
// 上锁期间 <html> 上有 data-locked="1"，CSS 据此把锁屏页以外的内容全部隐藏（看不见也点不到）。
// 冷启动时这个属性由 js/lock-boot.js 在第一帧之前就设好，避免先闪一下书架。
import { isLockEnabled, verifyPattern, secondsToWait } from './lock-store.js';
import { MIN_POINTS, RELOCK_MS } from './rules.js';
import { createPad } from './pad.js';
import { deleteDatabase } from '../storage/db.js';
import { confirmDialog, infoDialog } from '../ui/dialog.js';

const $ = (id) => document.getElementById(id);

let pad = null;
let beforeWipe = async () => {};
let hiddenAt = null;
let waitTimer = null;
let busy = false;

const hint = (text) => { $('lock-hint').textContent = text; };

export const isLocked = () => !$('lock-screen').hidden;

function unlock() {
  clearInterval(waitTimer);
  waitTimer = null;
  $('lock-screen').hidden = true;
  delete document.documentElement.dataset.locked;
}

/** 根据还要等几秒，更新提示和画板是否可用；等待期间每秒刷新一次。 */
function refreshWait() {
  const seconds = secondsToWait();
  pad.setDisabled(seconds > 0);
  if (seconds > 0) {
    hint(`画错次数太多，请 ${seconds} 秒后再试`);
    waitTimer ??= setInterval(refreshWait, 1000);
  } else if (waitTimer) {
    clearInterval(waitTimer);
    waitTimer = null;
    hint('');
  }
}

/** 立刻上锁（没开启密码时什么都不做）。 */
export function lockNow() {
  if (!isLockEnabled()) {
    unlock();
    return;
  }
  document.documentElement.dataset.locked = '1';
  $('lock-screen').hidden = false;
  pad.reset();
  hint('');
  refreshWait();
}

async function onDrawn(seq) {
  if (busy) return;
  if (seq.length < MIN_POINTS) {
    pad.markError();
    hint(`至少连 ${MIN_POINTS} 个点`);
    return;
  }
  busy = true;
  try {
    const result = await verifyPattern(seq);
    if (result === 'ok') {
      unlock();
      return;
    }
    if (result === 'wrong') {
      pad.markError();
      hint('图案不对');
    }
    refreshWait();
  } finally {
    busy = false;
  }
}

async function onForget() {
  const ok = await confirmDialog({
    title: '忘记图案',
    lines: [
      '会删除手机里所有的书、阅读进度和设置，不能恢复。',
      '删除后回到空书架，没有手势密码。',
    ],
    okText: '全部删除',
    danger: true,
    overLock: true,
  });
  if (!ok) return;
  try {
    await beforeWipe();
    // 先删书，删成功了再清 localStorage（里面有手势密码）。
    // 顺序反过来的话，删书失败时密码已经没了，等于不用画图案就能看到书。
    await deleteDatabase();
    localStorage.clear();
  } catch (err) {
    await infoDialog({
      title: '删除失败',
      lines: [String(err?.message || err), '手势密码没有被清除。'],
      overLock: true,
    });
    return;
  }
  location.reload();
}

// 切到后台时的遮挡（spec-m5 C3）：开启了密码时，一离开前台就给 <html> 加 data-covered，
// CSS 把整个页面盖成纯背景色，iOS 多任务界面的缩略图里就看不到书架和正文。
// 回来时：不到 5 分钟直接拿掉；≥ 5 分钟先上锁再拿掉（同一个任务里完成，不会露出一帧正文）。
// 没开启密码时不遮挡。
function onVisibilityChange() {
  const root = document.documentElement;
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    if (isLockEnabled()) root.dataset.covered = '1';
    return;
  }
  const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
  hiddenAt = null;
  if (away >= RELOCK_MS && !isLocked()) lockNow();
  delete root.dataset.covered;
}

/**
 * 只需调用一次，越早越好。开启了密码就立刻上锁。
 * beforeWipe：「忘记图案」删数据之前调用，用来关掉正在读的书，让阅读页在删除期间不再碰数据库。
 * （就算之后又存了一次进度也不会留下数据：书不存在时 saveProgress 不写库，启动时位置日志也会被丢掉。）
 */
export function setupLock({ beforeWipe: fn }) {
  beforeWipe = fn;
  pad = createPad($('lock-pad'), { onComplete: onDrawn });
  $('lock-forget').addEventListener('click', onForget);
  document.addEventListener('visibilitychange', onVisibilityChange);
  lockNow();
}
