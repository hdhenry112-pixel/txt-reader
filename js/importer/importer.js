// 导入流程：逐本读取文件 → 判断重复 → 解析 → 入库。
import { parseBook, titleFromFileName, ImportError } from './parse.js';
import { findBookByFile, saveBook } from '../storage/books.js';

/**
 * @param {File[]} files
 * @param {(index: number, total: number, title: string) => void} [onProgress] 每开始处理一本时调用，index 从 1 起
 * @returns {Promise<{ imported: string[], skipped: string[], failed: { name: string, reason: string }[] }>}
 *   imported / skipped 里是书名
 */
export async function importFiles(files, onProgress = () => {}) {
  const result = { imported: [], skipped: [], failed: [] };
  let index = 0;
  for (const file of files) {
    index += 1;
    const title = titleFromFileName(file.name);
    onProgress(index, files.length, title);
    try {
      // 一本失败不影响其他本，所以每本单独 try。
      if (await findBookByFile(file.name, file.size)) {
        result.skipped.push(title);
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const book = parseBook(bytes);
      await saveBook({
        id: crypto.randomUUID(),
        title,
        fileName: file.name,
        fileSize: file.size,
        encoding: book.encoding,
        encodingSuspect: book.encodingSuspect,
        totalLen: book.totalLen,
        chapterCount: book.chapters.length,
        addedAt: Date.now(),
        lastReadAt: null,
      }, book.chapters);
      result.imported.push(title);
    } catch (err) {
      const reason = err instanceof ImportError ? err.message : `读取或保存出错：${err?.message || err}`;
      result.failed.push({ name: file.name, reason });
    }
  }
  return result;
}
