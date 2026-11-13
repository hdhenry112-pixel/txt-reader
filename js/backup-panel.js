// 备份与恢复的面板。
//
// 导出分两步：先「生成备份」，生成好了再点「保存到文件」。
// 原因：iOS 只允许在用户点击之后立刻调起系统分享面板；生成备份要读数据库，是异步的，
// 读完再调分享面板会被系统拒绝。所以把「保存」单独做成一次点击。
import { listBooks } from './storage/books.js';
import { buildBackup, restoreBackup, estimateBytes, formatSize, BackupError, SIZE_WARN_BYTES } from './backup.js';
import { confirmDialog, infoDialog } from './ui/dialog.js';

const $ = (id) => document.getElementById(id);

let afterRestore = () => {};
let ready = null; // 已生成、等待保存的备份：{ file: File }

function clearReady() {
  ready = null;
  $('backup-ready').hidden = true;
}

async function refreshEstimate() {
  const books = await listBooks();
  const includeText = $('backup-include-text').checked;
  $('backup-size').textContent = `约 ${formatSize(estimateBytes(books, includeText))}`;
  return { books, includeText };
}

function timestamp() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}

async function onBuild() {
  clearReady();
  const { books, includeText } = await refreshEstimate();
  const estimate = estimateBytes(books, includeText);
  if (includeText && estimate > SIZE_WARN_BYTES) {
    const ok = await confirmDialog({
      title: '备份文件会很大',
      lines: [
        `包含正文的备份预计有 ${formatSize(estimate)}。`,
        '文件太大时，手机可能因为内存不够而导出失败。可以改为不包含正文：恢复后重新导入 txt，进度会自动接回。',
      ],
      okText: '仍然生成',
    });
    if (!ok) return;
  }

  const button = $('backup-build');
  button.disabled = true;
  button.textContent = '正在生成…';
  try {
    const { blob, bookCount } = await buildBackup({ includeText });
    const name = `txt-reader-备份-${timestamp()}${includeText ? '-含正文' : ''}.json`;
    ready = { file: new File([blob], name, { type: 'application/json' }) };
    $('backup-ready-text').textContent =
      `备份已生成：${bookCount} 本书，${formatSize(blob.size)}，${includeText ? '包含正文' : '不含正文'}。`;
    $('backup-ready').hidden = false;
  } catch (err) {
    await infoDialog({ title: '生成备份失败', lines: [String(err?.message || err)] });
  } finally {
    button.disabled = false;
    button.textContent = '生成备份';
  }
}

async function onSave() {
  if (!ready) return;
  const { file } = ready;
  // iPhone 上走系统分享面板，可以选「存储到文件」。
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (err) {
      // 用户自己关掉分享面板不算出错。
      if (err?.name !== 'AbortError') {
        await infoDialog({ title: '保存失败', lines: [String(err?.message || err)] });
      }
    }
    return;
  }
  // 没有分享面板的环境（电脑浏览器）：直接下载。
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function summarize({ restored, progressOnly, waiting }) {
  const list = (titles) => titles.map((t) => `《${t}》`).join('');
  const lines = ['设置已恢复。'];
  if (restored.length) lines.push(`恢复了 ${restored.length} 本书（含正文）：${list(restored)}`);
  if (progressOnly.length) lines.push(`${progressOnly.length} 本书已在书架上，只更新了进度：${list(progressOnly)}`);
  if (waiting.length) lines.push(`${waiting.length} 本书的备份里没有正文，等待重新导入：${list(waiting)}`);
  if (!restored.length && !progressOnly.length && !waiting.length) lines.push('备份里没有书。');
  return lines;
}

async function onRestoreFileChosen(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const result = await restoreBackup(await file.text());
    await afterRestore();
    closeBackupPanel();
    await infoDialog({ title: '恢复完成', lines: summarize(result) });
  } catch (err) {
    const reason = err instanceof BackupError ? err.message : `读取或写入出错：${err?.message || err}`;
    await infoDialog({ title: '恢复失败', lines: [`${file.name}：${reason}`, '书架没有被改动。'] });
  }
}

export async function openBackupPanel() {
  clearReady();
  $('backup-include-text').checked = false;
  $('backup-panel').hidden = false;
  await refreshEstimate();
}

export function closeBackupPanel() {
  clearReady();
  $('backup-panel').hidden = true;
}

/** 只需调用一次。onRestored 在恢复成功之后调用（用来刷新书架）。 */
export function setupBackupPanel({ onRestored }) {
  afterRestore = onRestored;
  $('backup-button').addEventListener('click', openBackupPanel);
  $('backup-close').addEventListener('click', closeBackupPanel);
  $('backup-build').addEventListener('click', onBuild);
  $('backup-save').addEventListener('click', onSave);
  $('backup-include-text').addEventListener('change', () => {
    clearReady();
    refreshEstimate();
  });
  const input = $('restore-input');
  input.addEventListener('change', () => onRestoreFileChosen(input));
}
