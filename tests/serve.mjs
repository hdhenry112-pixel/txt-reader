// 测试用的本地静态服务器。
// 把仓库根目录挂在 /txt-reader/ 子路径下，模拟 GitHub Pages 的地址结构。
//
// 测试专用的控制接口（只存在于这个测试服务器，App 不知道它）：
//   GET /__test/sw-version?v=9.9.9   之后返回的 sw.js 里 VERSION 被换成 9.9.9，模拟「发布了新版本」
//   GET /__test/sw-version           恢复为仓库里的真实版本
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/txt-reader/';
const PORT = Number(process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain',
};

const VERSION_LINE = /^const VERSION = '([^']+)';$/m;
let swVersionOverride = null;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/__test/sw-version') {
    swVersionOverride = url.searchParams.get('v');
    res.writeHead(200, { 'content-type': 'text/plain' }).end(String(swVersionOverride));
    return;
  }

  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(404).end('not found');
    return;
  }

  let rel = decodeURIComponent(url.pathname.slice(BASE.length));
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    let body = await readFile(file);
    if (rel === 'sw.js' && swVersionOverride) {
      const text = body.toString('utf8');
      if (!VERSION_LINE.test(text)) throw new Error('sw.js 里找不到 VERSION 那一行，无法模拟新版本');
      body = Buffer.from(text.replace(VERSION_LINE, `const VERSION = '${swVersionOverride}';`));
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      // GitHub Pages 给所有文件 10 分钟的浏览器缓存，这里照做，
      // 这样「更新检测不受 HTTP 缓存影响」这一点也在测试范围内。
      'cache-control': 'max-age=600',
    }).end(body);
  } catch (err) {
    const missing = err.code === 'ENOENT' || err.code === 'EISDIR';
    res.writeHead(missing ? 404 : 500).end(missing ? 'not found' : String(err.message));
  }
});

server.listen(PORT, () => console.log(`http://localhost:${PORT}${BASE}`));
