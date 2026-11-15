// 分章（纯函数）。规则见 spec 3.2「分章」。

/** 没有标题时每段的目标字数；也是超大章再切分时每块的目标字数。 */
export const CHUNK_LEN = 5000;
/** 单章超过这个字数就再切分。正好等于不切。 */
export const MAX_CHAPTER_LEN = 30000;
/** 标题行最多多少个字。 */
export const MAX_TITLE_LEN = 30;

const NUM = '[0-9０-９零〇一二两三四五六七八九十百千万]+';
const TITLE_START = new RegExp(
  `^(第${NUM}[章回节卷]|chapter\\s*\\d+|序章|序言|楔子|引子|番外|后记|尾声)`,
  'i',
);
const NOT_TITLE_END = /[。，；、：]$/;
/** 「第X章」部分，R3 用它判断两个标题是不是同一章。 */
const LABEL = new RegExp(`^第${NUM}[章回节卷]`);
/** R1：「第X章完」是结束语，不是标题。 */
const END_MARK = new RegExp(`^第${NUM}[章回节卷]\\s*完$`);
/** R2：行尾的日期或日期范围，数字数时不算。例：9／6／2003、10／12／2004－10／16／2004。 */
const DATE = '[0-9０-９]{1,4}[/／][0-9０-９]{1,2}[/／][0-9０-９]{1,4}';
const DATE_TAIL = new RegExp(`\\s*${DATE}(\\s*[-－—~～至]\\s*${DATE})?\\s*$`);
/** R3：前一章正文不到这么多字时，同一章的第二个标题行并进来。 */
export const DUP_TITLE_MAX_GAP = 200;

/** 判断一个段落（已去掉首尾空白）是不是章节标题。规则见 spec-mvp ③「分章」和 spec-1.0.1 ③。 */
export function isTitle(line) {
  if (END_MARK.test(line)) return false;
  const core = line.replace(DATE_TAIL, '');
  return core.length <= MAX_TITLE_LEN && !NOT_TITLE_END.test(line) && TITLE_START.test(line);
}

/** 当前章已经有标题、和这一行是同一个「第X章」、且当前章正文不到 DUP_TITLE_MAX_GAP 字。 */
function isRepeatedTitle(current, line) {
  if (!current?.title) return false;
  const a = current.title.match(LABEL);
  const b = line.match(LABEL);
  return !!a && !!b && a[0] === b[0] && lengthOf(current.paras) < DUP_TITLE_MAX_GAP;
}

const lengthOf = (paras) => paras.reduce((sum, p) => sum + p.length, 0);

/** 按段落累加字数，累计达到 CHUNK_LEN 就在该段落结束处切一块。 */
function chunk(paras) {
  const chunks = [];
  let current = [];
  let acc = 0;
  for (const p of paras) {
    current.push(p);
    acc += p.length;
    if (acc >= CHUNK_LEN) {
      chunks.push(current);
      current = [];
      acc = 0;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * @param {string[]} paras 段落数组（toParagraphs 的输出）
 * @returns {{ title: string, paras: string[], len: number }[]}
 *   len 是该章字数，不含标题行和换行
 */
export function chapterize(paras) {
  // 第一步：按标题行切开。
  const raw = [];
  let current = null;
  for (const p of paras) {
    if (isTitle(p) && !isRepeatedTitle(current, p)) {
      current = { title: p, paras: [] };
      raw.push(current);
    } else {
      if (!current) {
        // 第一个标题之前的正文。title 为 null 表示「还不知道该叫什么」。
        current = { title: null, paras: [] };
        raw.push(current);
      }
      current.paras.push(p);
    }
  }

  const hasTitles = raw.some((c) => c.title !== null);

  // 全书没有任何标题：按固定字数切。
  if (!hasTitles) {
    return chunk(paras).map((ps, i) => ({ title: `第 ${i + 1} 段`, paras: ps, len: lengthOf(ps) }));
  }

  // 第二步：给标题前的正文起名，并把超大的章再切分。
  const out = [];
  for (const c of raw) {
    const title = c.title ?? '前言';
    const len = lengthOf(c.paras);
    if (len > MAX_CHAPTER_LEN) {
      const parts = chunk(c.paras);
      parts.forEach((ps, i) => {
        out.push({ title: `${title} (${i + 1}/${parts.length})`, paras: ps, len: lengthOf(ps) });
      });
    } else {
      out.push({ title, paras: c.paras, len });
    }
  }
  return out;
}
