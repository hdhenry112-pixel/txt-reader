// 入口：启动页面、注册 Service Worker、提示新版本。
import { setupShelf, renderShelf } from './shelf.js';
import { setupReader, openReader } from './reader/reader.js';
import { recoverJournal } from './storage/progress.js';
import { showActionToast } from './ui/toast.js';

const UPDATE_TOAST_ID = 'update-toast';

function blockZoom() {
  // iOS Safari 会忽略 viewport 里的 user-scalable=no，所以要拦手势事件。
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
}

/** 向正在控制页面的 Service Worker 询问版本号。 */
function askVersion(worker) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 3000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data.version);
    };
    worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
  });
}

async function showVersion() {
  const reg = await navigator.serviceWorker.ready;
  const version = await askVersion(navigator.serviceWorker.controller || reg.active);
  if (version) document.getElementById('app-version').textContent = version;
}

function offerUpdate(reg) {
  showActionToast(UPDATE_TOAST_ID, '有新版本，点击刷新', () => {
    // 新版本接管页面后（controllerchange）再刷新。
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
  });
}

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });

  // 「有新版本」的判定：有一个 worker 装好了在等待（waiting），同时还有一个旧的在运行（active）。
  // 首次安装时 worker 装好后直接激活，不会停在 waiting，所以不会误提示。
  // 不能用「事件发生时页面是否已被控制」来判断：WebKit 会把 updatefound 和 statechange
  // 攒到 worker 接管页面之后才一起送达，那时首次安装看起来和更新一模一样。
  const check = () => {
    if (reg.waiting && reg.active) offerUpdate(reg);
  };
  const watch = (worker) => worker?.addEventListener('statechange', check);
  check();
  watch(reg.installing);
  reg.addEventListener('updatefound', () => {
    watch(reg.installing);
    check();
  });

  // 每次回到前台检查一次有没有新版本。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });

  showVersion();
}

/** 申请持久存储，降低系统在空间紧张时清掉书和进度的可能。被拒绝也不影响使用。 */
function requestPersistentStorage() {
  navigator.storage?.persist?.().catch(() => {});
}

blockZoom();
requestPersistentStorage();
setupReader({ onClose: renderShelf });
// 先把上次没来得及写进数据库的阅读位置补上，再显示书架，这样书架上的进度是最新的。
await recoverJournal().catch(() => {});
setupShelf({ onOpen: openReader });
setupServiceWorker();
