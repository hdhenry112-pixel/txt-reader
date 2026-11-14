// 开启了手势密码时，在页面画出第一帧之前就标记为「上锁」，CSS 据此隐藏书架和阅读页，
// 免得启动时先闪一下书架再出现锁屏页。真正的锁屏页由 js/lock/lock-screen.js 负责。
// 这是普通脚本（不是模块），放在 <head> 里同步执行。键名和 js/lock/lock-store.js 的 LOCK_KEY 一致。
(function () {
  try {
    if (localStorage.getItem('txt-reader:lock')) document.documentElement.dataset.locked = '1';
  } catch (e) { /* localStorage 不可用时没有密码可读 */ }
})();
