// 在页面画出第一帧之前套上上次用的主题，避免夜间主题下启动时先闪一下白底。
// 这是普通脚本（不是模块），放在 <head> 里同步执行。
// 主题的正式存储在 IndexedDB 的 settings 仓库；这里读的是 js/settings.js 顺手写的一份副本。
(function () {
  try {
    var theme = localStorage.getItem('txt-reader:theme');
    if (theme === 'day' || theme === 'sepia' || theme === 'night') {
      document.documentElement.dataset.theme = theme;
    }
  } catch (e) { /* localStorage 不可用时用默认的白天主题 */ }
})();
