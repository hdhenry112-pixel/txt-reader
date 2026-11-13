// 屏幕常亮：阅读时不让屏幕自动熄灭。
// 系统在页面切到后台时会自动收回常亮，所以回到前台时要重新申请。

let wanted = false;
let lock = null;

async function acquire() {
  if (!wanted || lock || !('wakeLock' in navigator)) return;
  if (document.visibilityState !== 'visible') return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
    // 申请是异步的；如果这期间用户已经离开了阅读页，就立刻释放。
    if (!wanted) allowSleep();
  } catch {
    // 省电模式等情况下系统会拒绝。不影响阅读，忽略。
    lock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquire();
});

/** 进入阅读页时调用。 */
export function keepAwake() {
  wanted = true;
  acquire();
}

/** 离开阅读页时调用。 */
export function allowSleep() {
  wanted = false;
  const current = lock;
  lock = null;
  current?.release().catch(() => {});
}

/** 当前是否希望保持常亮（测试用）。 */
export function isKeepAwakeWanted() {
  return wanted;
}
