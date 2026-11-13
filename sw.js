// Service Worker：缓存 App 外壳，让 App 离线可用。
//
// 版本号规则（详见 CLAUDE.md）：
//   1. 下面这一行是版本号的唯一来源。每次发布都必须改它。
//   2. 新增、删除、改名任何 App 文件时，同步修改 ASSETS 清单。
const VERSION = '0.3.2';

const CACHE_PREFIX = 'txt-reader-v';
const CACHE = CACHE_PREFIX + VERSION;

// App 外壳的全部文件，路径相对于 sw.js 所在目录。
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/themes.css',
  'css/base.css',
  'css/shelf.css',
  'js/app.js',
  'css/reader.css',
  'js/shelf.js',
  'js/theme-boot.js',
  'js/settings.js',
  'js/settings-panel.js',
  'js/reader/page-mode.js',
  'js/wakelock.js',
  'js/reader/reader.js',
  'js/reader/position.js',
  'js/reader/scroll-mode.js',
  'js/reader/menu.js',
  'js/reader/toc.js',
  'js/chapterizer.js',
  'js/normalize.js',
  'js/importer/decode.js',
  'js/importer/parse.js',
  'js/importer/importer.js',
  'js/storage/db.js',
  'js/storage/books.js',
  'js/storage/progress.js',
  'js/ui/dialog.js',
  'js/ui/toast.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' 跳过浏览器的 HTTP 缓存，保证拿到的是服务器上的最新文件。
    await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
  })());
  // 这里不调用 skipWaiting：新版本要等用户点「刷新」才接管。
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE)
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (type === 'GET_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // 页面导航一律回到 App 外壳。
    if (request.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    return fetch(request);
  })());
});
