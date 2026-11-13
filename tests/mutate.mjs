// 反向验证用的小工具：把源码里的一处改坏，或者还原。
// 改之前逐条确认目标文本存在且只出现一次；找不到就报错退出，绝不静默跳过。
//
// 用法：
//   node mutate.mjs apply <相对仓库根目录的文件> <原文> <改成>
//   node mutate.mjs restore <文件>
import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [action, file, from, to] = process.argv.slice(2);
const path = join(ROOT, file);
const backup = `${path}.orig`;

if (action === 'apply') {
  if (existsSync(backup)) throw new Error(`${file} 上一次改坏后还没有还原`);
  const text = readFileSync(path, 'utf8');
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${file} 里「${from}」出现了 ${count} 次，需要正好 1 次`);
  copyFileSync(path, backup);
  writeFileSync(path, text.replace(from, to), 'utf8');
  console.log(`已改坏 ${file}：${from}  →  ${to}`);
} else if (action === 'restore') {
  if (!existsSync(backup)) throw new Error(`${file} 没有备份可还原`);
  copyFileSync(backup, path);
  unlinkSync(backup);
  console.log(`已还原 ${file}`);
} else {
  throw new Error('用法：node mutate.mjs apply|restore <文件> [原文] [改成]');
}
