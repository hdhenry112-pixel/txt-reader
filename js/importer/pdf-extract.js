// 用 pdf.js 把 PDF 每一页的文字片段抽出来（只在导入 PDF 时才加载 pdf.js，不影响启动）。
// pdf.js 的文件在 vendor/pdfjs/，版本和校验见那里的 VERSION.md。不改它的源码。
import { ImportError } from './parse.js';

const VENDOR = new URL('../../vendor/pdfjs/', import.meta.url).href;

let pdfjsPromise = null;
function loadPdfjs() {
  pdfjsPromise ??= import(`${VENDOR}pdf.min.mjs`).then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${VENDOR}pdf.worker.min.mjs`;
    return pdfjs;
  });
  return pdfjsPromise;
}

/** pdf.js 的异常 → 给用户看的失败原因。认不出的原样抛出。 */
export function reasonFor(err) {
  if (err?.name === 'PasswordException') return '这个 PDF 有密码保护';
  if (err?.name === 'InvalidPDFException') return '不是有效的 PDF 文件';
  return null;
}

/**
 * @param {Uint8Array} bytes
 * @param {(page: number, pages: number) => void} [onPage] 每开始处理一页时调用，page 从 1 起
 * @returns {Promise<{ items: { str: string, x: number, y: number, w: number, size: number }[] }[]>}
 * @throws {ImportError} 有密码、不是有效的 PDF
 */
export async function extractPages(bytes, onPage = () => {}) {
  const pdfjs = await loadPdfjs();
  // 释放用 loadingTask.destroy()（这个版本的文档对象上没有 destroy）
  const task = pdfjs.getDocument({
    data: bytes,
    cMapUrl: `${VENDOR}cmaps/`,
    cMapPacked: true,
    // 只抽文字：不执行 PDF 里的脚本、不用 eval、不加载图片解码用的 wasm
    isEvalSupported: false,
    enableXfa: false,
    useWasm: false,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy();
    const reason = reasonFor(err);
    if (reason) throw new ImportError(reason);
    throw err;
  }
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      onPage(n, doc.numPages);
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push({
        items: content.items
          .filter((it) => typeof it.str === 'string')
          .map((it) => ({
            str: it.str,
            x: it.transform[4],
            y: it.transform[5],
            w: it.width,
            // 字号：变换矩阵纵向的缩放（横排文字就是 transform[3]，带旋转时用长度）
            size: Math.hypot(it.transform[2], it.transform[3]),
          })),
      });
      // 处理完一页就释放，不把整本书的页面对象留在内存里（spec ⑧ 第 2 条）
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
