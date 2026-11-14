// M5b：PDF 文字整理规则（js/importer/pdf-layout.js），用手工构造的文字片段逐条验证 spec-m5 3.2「文字整理规则」。
// 坐标约定：字号 10（一个汉字宽 10），左边界 x=50，右边界 x=350（一行 30 个字）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupLines, stripHeadersFooters, toParagraphsFromLines, pagesToParagraphs, fixRadicals, MIN_PAGES_FOR_REPEAT,
} from '../../js/importer/pdf-layout.js';
import { reasonFor } from '../../js/importer/pdf-extract.js';

const S = 10;
/** 一个片段：从 x 开始、文字 str、每个字宽 S。 */
const it = (str, x, y, size = S) => ({ str, x, y, w: str.length * size, size });
/** 一行（已合并好的）：groupLines 的输出格式。 */
const line = (text, x0, y, size = S) => ({ text, x0, x1: x0 + text.length * size, y, size });
const full = (ch) => ch.repeat(30); // 正好排满一行

test('同一行的片段按横坐标拼起来；纵坐标差不到半个字高算同一行；空片段丢掉', () => {
  const lines = groupLines([
    it('第二行', 50, 480),
    it('后半', 80, 500.3),
    it('', 110, 500),
    it('前半', 50, 500),
  ]);
  assert.deepEqual(lines.map((l) => l.text), ['前半后半', '第二行']);
  assert.equal(lines[0].x0, 50);
  assert.equal(lines[0].x1, 100);
});

test('英文单词被拆成两个片段、中间有空隙时补空格；中文片段之间不补', () => {
  const [en] = groupLines([it('Hello', 50, 500), it('world', 110, 500)]);
  assert.equal(en.text, 'Hello world');
  const [zh] = groupLines([it('你好', 50, 500), it('世界', 75, 500)]);
  assert.equal(zh.text, '你好世界');
});

test('部首字符换成常用汉字（康熙部首区和部首补充区），全角标点不动', () => {
  assert.equal(fixRadicals('⼀⽓⽯⾬⽔⼜'), '一气石雨水又');
  // 部首补充区：NFKC 不认识这两个，要靠对照表
  assert.equal(fixRadicals('\u2EC5\u2ED3'), '见长');
  assert.equal(fixRadicals('普通的字一二三'), '普通的字一二三');
  assert.equal(fixRadicals('，。“”：；！？（）'), '，。“”：；！？（）');
  // 在合成行的时候就修正，所以「第⼀章」能被认成标题
  const [title] = groupLines([it('第⼀章', 50, 500)]);
  assert.equal(title.text, '第一章');
});

/** n 页，每页：页眉 header（可选）、一行正文、页脚 footer(i)（可选）。
 * 正文用中文数字（正文第一页…）：各页正文去掉数字后也互不相同，不会被当成重复的页眉页脚。 */
const CN = '一二三四五六七八九十';
function pagesWith(n, { header, footer, headerPages = n }) {
  return Array.from({ length: n }, (_, i) => [
    ...(header && i < headerPages ? [line(header, 150, 560)] : []),
    line(`正文第${CN[i]}页`, 50, 500),
    ...(footer ? [line(footer(i + 1), 190, 30)] : []),
  ]);
}

test(`不少于 ${MIN_PAGES_FOR_REPEAT} 页：每页相同位置的页眉、页码（数字换成 # 后相同）被去掉`, () => {
  const pages = stripHeadersFooters(pagesWith(5, { header: '测试书名', footer: (p) => `- ${p} -` }));
  assert.deepEqual(pages.map((ls) => ls.map((l) => l.text)), [...CN.slice(0, 5)].map((c) => [`正文第${c}页`]));
});

test('只有 4 页：页眉留着（不做重复行判断），页码照样去掉', () => {
  const pages = stripHeadersFooters(pagesWith(4, { header: '测试书名', footer: (p) => String(p) }));
  assert.deepEqual(pages[0].map((l) => l.text), ['测试书名', '正文第一页']);
});

test('页眉只出现在一半的页里（5 页里 2 页）：不算重复，不去掉', () => {
  const pages = stripHeadersFooters(pagesWith(5, { header: '测试书名', headerPages: 2 }));
  assert.equal(pages[0][0].text, '测试书名');
  // 3 页 > 5 / 2，算重复
  const more = stripHeadersFooters(pagesWith(5, { header: '测试书名', headerPages: 3 }));
  assert.equal(more[0][0].text, '正文第一页');
});

test('各种页码写法都认得：12、- 12 -、第 12 页、12 / 300；带字的最后一行不当页码', () => {
  for (const f of ['12', '- 12 -', '第 12 页', '12 / 300', '—12—']) {
    const [ls] = stripHeadersFooters([[line('正文', 50, 500), line(f, 190, 30)]]);
    assert.deepEqual(ls.map((l) => l.text), ['正文'], f);
  }
  const [ls] = stripHeadersFooters([[line('正文', 50, 500), line('第12章完', 190, 30)]]);
  assert.equal(ls.length, 2);
});

test('分段：首行缩进 2 字的行开始新段；排满的行接到下一行；换页不断段', () => {
  const lines = [
    line(`　　${'甲'.repeat(28)}`.replace(/　/g, ''), 70, 500), // 缩进 2 字，排满到右边界
    line(full('乙'), 50, 480),
    line('丙'.repeat(10), 50, 460), // 段末，短
    line('丁'.repeat(28), 70, 440), // 新段（缩进）
    // 换页：下一页第一行顶格，上一行排满 → 接上
    line(full('戊'), 50, 560),
    line('己'.repeat(5), 50, 540),
  ];
  // 把丁那一行改成排满，换页那行才应接上
  lines[3] = line('丁'.repeat(28), 70, 440);
  const paras = toParagraphsFromLines(lines);
  assert.deepEqual(paras, [
    '甲'.repeat(28) + full('乙') + '丙'.repeat(10),
    '丁'.repeat(28) + full('戊') + '己'.repeat(5),
  ]);
});

test('分段：上一段最后一行正好排满时，只靠下一行的缩进分段', () => {
  const paras = toParagraphsFromLines([
    line(full('甲'), 50, 500),
    line(full('乙'), 50, 480), // 段末，正好排满：「上一行短」这条用不上
    line('丙'.repeat(28), 70, 460), // 缩进 2 字 → 新段
    line('丁'.repeat(5), 50, 440),
  ]);
  assert.deepEqual(paras, [full('甲') + full('乙'), '丙'.repeat(28) + '丁'.repeat(5)]);
});

test('分段：上一行比右边界短 2 个字以上，下一行即使顶格也是新段；只短 1 个字则接上', () => {
  const twoShort = toParagraphsFromLines([
    line(full('甲'), 50, 500),
    line('乙'.repeat(28), 50, 480), // 短 2 字
    line('丙'.repeat(30), 50, 460),
  ]);
  assert.deepEqual(twoShort, [full('甲') + '乙'.repeat(28), '丙'.repeat(30)]);
  const oneShort = toParagraphsFromLines([
    line(full('甲'), 50, 500),
    line('乙'.repeat(29), 50, 480), // 短 1 字
    line('丙'.repeat(30), 50, 460),
  ]);
  assert.deepEqual(oneShort, [full('甲') + '乙'.repeat(29) + '丙'.repeat(30)]);
});

test('分段：章节标题自成一段，标题后的第一行也是新段（即使顶格、标题排满）', () => {
  const paras = toParagraphsFromLines([
    line(full('甲'), 50, 520),
    line('第二章', 50, 500),
    line(full('乙'), 50, 480),
    line(full('丙'), 50, 460),
  ]);
  assert.deepEqual(paras, [full('甲'), '第二章', full('乙') + full('丙')]);
});

test('两行相接：两边都是英文字母或数字时加空格，否则直接连', () => {
  const at = (a, b) => toParagraphsFromLines([line(a + 'x'.repeat(30 - a.length), 50, 500), line(b, 50, 480)])[0];
  assert.equal(at('', 'word'), `${'x'.repeat(30)} word`);
  assert.equal(at('中文', '文字'), `中文${'x'.repeat(28)}文字`);
  const zh = toParagraphsFromLines([line(full('中'), 50, 500), line('文字', 50, 480)]);
  assert.deepEqual(zh, [full('中') + '文字']);
  const mixed = toParagraphsFromLines([line(full('中').slice(0, 29) + 'a', 50, 500), line('文字', 50, 480)]);
  assert.deepEqual(mixed, [full('中').slice(0, 29) + 'a文字']);
});

test('全流程：没有任何文字的 PDF 得到 0 个段落', () => {
  assert.deepEqual(pagesToParagraphs([{ items: [] }, { items: [it('', 50, 500)] }]), []);
});

test('pdf.js 的异常对应的失败原因（spec ④：有密码的 PDF 降级为单元测试）', () => {
  assert.equal(reasonFor({ name: 'PasswordException' }), '这个 PDF 有密码保护');
  assert.equal(reasonFor({ name: 'InvalidPDFException' }), '不是有效的 PDF 文件');
  assert.equal(reasonFor(new Error('其他')), null);
});
