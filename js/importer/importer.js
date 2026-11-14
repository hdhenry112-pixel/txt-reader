// 导入流程：逐本读取文件 → 判断重复 → 解析 → 入库。txt 和 PDF 都走这里，按扩展名分流。
import { parseBook, bookFromParagraphs, titleFromFileName, ImportError } from './parse.js';
import { extractPages } from './pdf-extract.js';
import { pagesToParagraphs } from './pdf-layout.js';
import { findBookByFile, saveBook, saveBookRaw, getBook } from '../storage/books.js';
import { takePending, putProgressRecord, fileKeyOf } from '../storage/progress.js';

const isTxt = (fileName) => /\.txt$/i.test(fileName);
const isPdf = (fileName) => /\.pdf$/i.test(fileName);

/** PDF 的字节 → 可入库的书。PDF 来的书没有编码一说，encoding 记 null。 */
async function parsePdf(bytes, onPage) {
  const paras = pagesToParagraphs(await extractPages(bytes, onPage));
  if (paras.length === 0) throw new ImportError('这个 PDF 里没有可提取的文字（可能是扫描版）');
  return { encoding: null, encodingSuspect: false, ...bookFromParagraphs(paras) };
}

/**
 * @param {File[]} files
 * @param {(index: number, total: number, title: string, pdfPage?: { page: number, pages: number }) => void} [onProgress]
 *   每开始处理一本时调用，index 从 1 起；PDF 每开始处理一页时再调用一次，带上页码
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
      // 文件选择框不限制类型（见 index.html 里的说明），所以在这里按扩展名检查。
      const source = isTxt(file.name) ? 'txt' : isPdf(file.name) ? 'pdf' : null;
      if (!source) throw new ImportError('不是 txt 或 pdf 文件');
      if (await findBookByFile(file.name, file.size)) {
        result.skipped.push(title);
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const book = source === 'txt'
        ? parseBook(bytes)
        : await parsePdf(bytes, (page, pages) => onProgress(index, files.length, title, { page, pages }));
      // 这本书如果是从「不含正文」的备份里恢复过进度的，把进度接回来。
      const waiting = await takePending(fileKeyOf(file.name, file.size));
      const id = crypto.randomUUID();
      await saveBook({
        id,
        title,
        fileName: file.name,
        fileSize: file.size,
        source,
        encoding: book.encoding,
        encodingSuspect: book.encodingSuspect,
        totalLen: book.totalLen,
        chapterCount: book.chapters.length,
        addedAt: Date.now(),
        lastReadAt: waiting?.lastReadAt ?? null,
      }, book.chapters);
      if (waiting?.progress && waiting.progress.chapterIdx < book.chapters.length) {
        await putProgressRecord({ ...waiting.progress, bookId: id });
      }
      result.imported.push(title);
    } catch (err) {
      const reason = err instanceof ImportError ? err.message : `读取或保存出错：${err?.message || err}`;
      result.failed.push({ name: file.name, reason });
    }
  }
  return result;
}

/**
 * 换编码重新导入：用指定的编码重新解码用户重新选的文件，替换这本书的正文和目录，进度重置到开头。
 * 书的 id 和导入时间不变。
 * @param {string} bookId
 * @param {File} file 用户重新选的原文件
 * @param {string} encoding 指定的编码
 * @returns {Promise<{ title: string, chapterCount: number }>}
 * @throws {ImportError} 文件不是 txt、是空的、或解码后没有文字
 */
export async function reimportWithEncoding(bookId, file, encoding) {
  const old = await getBook(bookId);
  if (!old) throw new ImportError('这本书已经不在书架上了');
  if (!isTxt(file.name)) throw new ImportError('不是 txt 文件');
  const book = parseBook(new Uint8Array(await file.arrayBuffer()), encoding);
  const title = titleFromFileName(file.name);
  await saveBookRaw(
    {
      ...old,
      title,
      fileName: file.name,
      fileSize: file.size,
      encoding: book.encoding,
      encodingSuspect: book.encodingSuspect,
      totalLen: book.totalLen,
      chapterCount: book.chapters.length,
    },
    book.chapters.map((c) => ({ title: c.title, len: c.len })),
    book.chapters.map((c) => c.paras.join('\n')),
    { resetProgress: true },
  );
  return { title, chapterCount: book.chapters.length };
}
