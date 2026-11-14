// 把一个 txt 文件的字节变成可以入库的书（纯函数，不碰数据库和页面）。PDF 抽出段落之后也走这里的 bookFromParagraphs。
import { decodeBytes } from './decode.js';
import { toParagraphs } from '../normalize.js';
import { chapterize } from '../chapterizer.js';

/** 导入失败时抛出的错误，message 直接显示给用户。 */
export class ImportError extends Error {}

/**
 * @param {Uint8Array} bytes
 * @param {string} [forcedEncoding]
 * @returns {{ encoding: string, encodingSuspect: boolean, totalLen: number,
 *             chapters: { title: string, paras: string[], len: number }[] }}
 */
export function parseBook(bytes, forcedEncoding) {
  if (bytes.length === 0) throw new ImportError('文件是空的');
  const { text, encoding, suspect } = decodeBytes(bytes, forcedEncoding);
  const paras = toParagraphs(text);
  if (paras.length === 0) throw new ImportError('文件里没有文字');
  return { encoding, encodingSuspect: suspect, ...bookFromParagraphs(paras) };
}

/**
 * 段落 → 分章后的书（txt 和 PDF 共用）。
 * @param {string[]} paras 非空
 * @returns {{ totalLen: number, chapters: { title: string, paras: string[], len: number }[] }}
 */
export function bookFromParagraphs(paras) {
  const chapters = chapterize(paras);
  const totalLen = chapters.reduce((sum, c) => sum + c.len, 0);
  return { totalLen, chapters };
}

/** 书名：文件名去掉 .txt 或 .pdf 后缀。 */
export function titleFromFileName(fileName) {
  return fileName.replace(/\.(txt|pdf)$/i, '');
}
