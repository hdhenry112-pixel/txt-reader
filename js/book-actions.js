// 书架上每本书的「更多」操作：换编码重新导入、删除。
import { deleteBook } from './storage/books.js';
import { reimportWithEncoding } from './importer/importer.js';
import { ImportError } from './importer/parse.js';
import { confirmDialog, choiceDialog, infoDialog } from './ui/dialog.js';
import { showToast } from './ui/toast.js';

const $ = (id) => document.getElementById(id);

const ENCODING_CHOICES = [
  { label: 'UTF-8', value: 'utf-8' },
  { label: 'GBK（简体中文）', value: 'gbk' },
  { label: 'Big5（繁体中文）', value: 'big5' },
  { label: 'UTF-16 LE', value: 'utf-16le' },
  { label: 'UTF-16 BE', value: 'utf-16be' },
];

let afterChange = () => {};
let reimportTarget = null; // 正在换编码的那本书和选好的编码：{ book, encoding }

async function removeBook(book) {
  const ok = await confirmDialog({
    title: `删除《${book.title}》？`,
    lines: ['这本书的正文和阅读进度会从手机里删除，不能恢复。'],
    okText: '删除',
    danger: true,
  });
  if (!ok) return;
  await deleteBook(book.id);
  await afterChange();
}

async function chooseEncoding(book) {
  const encoding = await choiceDialog({
    title: '用哪种编码重新导入？',
    lines: [
      `《${book.title}》现在是按 ${book.encoding.toUpperCase()} 解码的。`,
      '选好编码后，需要再选一次原来的 txt 文件。阅读进度会回到开头。',
    ],
    choices: ENCODING_CHOICES,
  });
  if (!encoding) return;
  reimportTarget = { book, encoding };
  // 这一步必须紧跟在用户的点击之后同步执行，否则 iOS 不允许打开文件选择界面。
  $('reimport-input').click();
}

async function onReimportFileChosen(input) {
  const file = input.files[0];
  input.value = '';
  const target = reimportTarget;
  reimportTarget = null;
  if (!file || !target) return;
  try {
    const { title, chapterCount } = await reimportWithEncoding(target.book.id, file, target.encoding);
    await afterChange();
    showToast(`《${title}》已按 ${target.encoding.toUpperCase()} 重新导入，共 ${chapterCount} 章`, 3500);
  } catch (err) {
    const reason = err instanceof ImportError ? err.message : `读取或保存出错：${err?.message || err}`;
    await infoDialog({ title: '重新导入失败', lines: [`${file.name}：${reason}`, '原来的书没有被改动。'] });
  }
}

/** 打开某本书的操作菜单。 */
export async function openBookActions(book) {
  // PDF 来的书没有编码一说，不显示「换编码重新导入」。旧书没有 source 字段，按 txt 处理。
  const isPdf = book.source === 'pdf';
  const action = await choiceDialog({
    title: `《${book.title}》`,
    choices: [
      ...(isPdf ? [] : [{ label: '换编码重新导入', value: 'reimport' }]),
      { label: '删除', value: 'delete', kind: 'danger' },
    ],
  });
  if (action === 'reimport') await chooseEncoding(book);
  else if (action === 'delete') await removeBook(book);
}

/** 只需调用一次。onChanged 在书被删除或重新导入之后调用（用来刷新书架）。 */
export function setupBookActions({ onChanged }) {
  afterChange = onChanged;
  const input = $('reimport-input');
  input.addEventListener('change', () => onReimportFileChosen(input));
}
