# 交接文档

**写于**：2026-11-14，M4 发布并经 Henry 真机验证通过之后。
**给谁看**：接手这个项目的下一个对话（可能换了模型）。Henry 也可以用它回顾现状。

读的顺序：本文件 → `CLAUDE.md`（项目约定和踩过的坑，必读）→ `docs/spec-m5.md`（下一步要做的）→ 需要时再看 `docs/spec-mvp.md` 和各里程碑的测试报告。

---

## 1. 现状

| 项 | 状态 |
|---|---|
| 线上版本 | **0.4.1**，`https://hdhenry112-pixel.github.io/txt-reader/` |
| 仓库 | GitHub `hdhenry112-pixel/txt-reader`，public，分支 `main`，GitHub Pages 从 `main` 根目录发布 |
| 本地目录 | `D:\Claude Code\4-APP\PWA-reader` |
| 工作区 | 干净，全部已提交并推送 |
| 测试 | 44 项单元测试 + 49 项端到端测试，全部通过 |
| 数据库 | IndexedDB schema 版本 2 |

**已完成的里程碑**

| 里程碑 | 版本 | 内容 | 真机验证 |
|---|---|---|---|
| M0 | 0.1.0 | 外壳、离线、更新提示 | Henry 用过，没有报问题；清单没有逐项回填 |
| M1 | 0.1.1 / 0.1.2 | 导入、编码、分章、书架 | Google Drive 导入已确认可用；其余没有逐项回填 |
| M2 | 0.2.1 | 滚动模式、目录、进度 | 没有逐项回填 |
| M3 | 0.3.1 / 0.3.2 | 翻页模式、设置、主题 | 没有逐项回填 |
| M4 | 0.4.1 | 备份恢复、换编码、大文件、数据库迁移 | **Henry 2026-11-14 说「M4 验证通过」** |

「没有逐项回填」的意思是：Henry 一直在用，后续的版本他都更新了，没有反馈问题，但 `docs/device-checklist.md` 里的「结果」列是空的。不要把它当成逐项确认过。

**还没做**

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M5a | 九宫格手势密码 | spec 写好了（`docs/spec-m5.md`），**待 Henry 确认** |
| M5b | 文字型 PDF 导入 | 同上 |
| M6 | 收尾：全量回归、文档补全、最终真机清单，版本 1.0.0 | 没开始 |

## 2. 下一步怎么做

1. **先让 Henry 确认 `docs/spec-m5.md`。** 里面第 ⑦ 节有 5 条待确认，每条都有建议。他回复确认之前不许写代码（这是他的硬规则）。
2. 确认后把 spec 的状态改成「已确认（日期）」，按 spec 第 ③ 节的顺序做：
   - **M5a 手势密码 → 发布 0.5.1**
   - **M5b PDF → 发布 0.5.2**。开工第一件事：查 pdf.js 官方文档，确定版本、需要哪些文件、总大小，把实际大小告诉 Henry，再往下做。
3. 每次发布的固定流程（前四个里程碑都是这么走的）：
   1. 写代码；新增文件同步加进 `sw.js` 的 `ASSETS`
   2. 写测试，期望值来自 spec 的手算锚点，不来自被测代码的输出
   3. `cd tests && npm test` 全量通过
   4. 反向验证：用 `node tests/mutate.mjs apply <文件> <原文> <改成>` 改坏一处，确认测试变红，再 `restore`
   5. 截图存到 `docs/test-reports/M<n>/`，**用 Read 工具看过**
   6. 改 `sw.js` 第一行的 `VERSION`
   7. 更新 `CLAUDE.md`（进度、文件结构、数据模型、新踩的坑）、`docs/device-checklist.md`（新一节）、写 `docs/test-reports/M<n>/report.md`
   8. commit、push
   9. 等线上版本号变成新的，逐个请求 `ASSETS` 里的文件，再用 Playwright 对线上地址跑一遍真实操作。**读到结果之后**再把结论写进报告
   10. 告诉 Henry 怎么更新、真机要看哪几项
4. M5 做完后做 M6。M6 的范围见 `docs/spec-mvp.md` 3.5 节原来的 M5 一行。

## 3. 这台电脑的环境

- Windows 11；主 shell 是 PowerShell，也有 Git Bash。Node 24.14.1，Playwright 1.65.0（WebKit 和 Chromium 都装了）
- **没有 `gh` 命令。** 推送用 `git push`，靠 Windows 的凭据管理器，已经能用
- Claude 桌面应用的内置浏览器打不开 github.com（被站点权限挡住）。需要在 GitHub 网页上操作的事交给 Henry
- commit 的作者信息是仓库级配置好的：`Henry` + GitHub 的 noreply 邮箱。不要改成真实邮箱（仓库是 public）
- 工作区的文本文件是 **CRLF** 换行（仓库里是 LF）。用脚本做多行查找替换前先把 `\r\n` 换成 `\n`
- 不要用 shell 的 heredoc 写含中文引号、反引号的长文件，会解析出错。用文件写入工具
- `node --test` 在 Node 24 下不接受目录参数，要写成 `node --test "unit/*.test.mjs"`（`tests/package.json` 里已经是对的）

常用命令：

```bash
cd tests
npm test                          # 生成测试数据 → 单元测试 → 端到端测试
npx playwright test m4-backup     # 只跑某个文件
npx playwright test -g "关键字"    # 只跑名字匹配的
node serve.mjs                    # 本地看页面：http://localhost:4173/txt-reader/
```

## 4. 和 Henry 协作的要点

他的全局约定在 `~/.claude/CLAUDE.md`，每个对话会自动加载，这里只列这个项目里实际起作用的：

- **沟通用中文。** 说事实，不用比喻；先说清楚在说哪里，再说结论；涉及数字、文件名、按钮名直接写出来
- **要他决定的事单独一段放最前面**，写清楚选项、建议、不回复会怎么做
- **spec 未确认不开工。** 新需求先问清楚，再写 spec，等他确认
- **报告必须诚实。** 跑不通说跑不通，没验证说没验证，自己判断错了也写进去。每份测试报告里都有「过程中的问题」一节，照这个写
- 他在真机上用，会直接反馈现象（比如「导入里没有 Google Drive」「进度一直是 0%」）。先判断是 App 的问题还是 iOS 的问题，再回答
- 他的手机是**英文界面**，写 iOS 操作步骤时按钮名用英文（Files、Browse、Save to Files）
- 他关心 token 消耗。少做无关的事，不要反复重读已经知道的文件

## 5. 必须知道的技术事实

细节都在 `CLAUDE.md` 第 ④、⑤、⑧ 节，这里只列最容易出事的：

1. **改数据库结构必须写迁移。** `js/storage/db.js` 的 `MIGRATIONS` 数组只能在末尾追加。Henry 手机里有真实的书，迁移写错会丢数据。每个迁移都要有「旧版本数据升级后逐项核对」的测试（参考 `m4-backup-big.spec.js` 里的 D1）
2. **`CHAPTERS_PER_GROUP = 50` 不能改。** 手机里的数据是按它分组的
3. **「改完立刻关 App 也不能丢」的数据不能只写 IndexedDB**，要先同步写 localStorage 日志。阅读位置和设置已经这样做了；M5 的手势密码直接存在 localStorage，就是这个原因
4. **文件选择框不能写 `accept`**，写了 Google Drive 位置会显示 Content Unavailable
5. **调文件选择界面和系统分享面板，必须紧跟用户的点击**，中间不能有异步等待
6. **每次发布只要 App 文件变了就必须改 `sw.js` 的 `VERSION`**；新增文件必须加进 `ASSETS`
7. **写 IndexedDB 的耗时取决于记录条数**（每条约 15 毫秒），不取决于内容多少
8. **两种阅读模式是同一套接口**，`reader.js` 不区分。PDF 来的书存成和 txt 一样的结构，所以阅读页不用改
9. App 启动完成后 `<html>` 上有 `data-ready="1"`，测试用 `waitAppReady()` 等它

## 6. 已知的小问题（都没处理，Henry 没提）

- 刚导入完马上打开书，「已导入 N 本」的提示会压在页面底部 2.5 秒
- 英文单词在两端对齐时间距被拉宽（纯中文不受影响）
- 翻页模式没有页码显示（如「3 / 12」）
- 滑动翻页是「滑完才翻」，页面不跟手
- Big5 的书直接导入是乱码且不会标「编码可能有误」（设计如此，要手动换编码）
- 整本书没有换行的 txt 会成为单独一章，可能很慢
- 100MB 以上的备份能不能真的导出成功没有测过
- 恢复备份时整个文件读进内存，很大的备份在 iPhone 上可能失败

## 7. 以后可能做的功能（Henry 没有要求，只是当初列过）

书签、书内搜索、进度拖动条、字体选择、翻页动画样式、读 PDF 书签当目录、两级目录、手动修正目录。
要做任何一项都先问 Henry，再写 spec。

## 8. 文档索引

| 文件 | 内容 |
|---|---|
| `CLAUDE.md` | 项目约定：交付门槛、技术约束、文件结构、数据模型、版本号规则、踩过的坑 |
| `docs/spec-mvp.md` | M0–M4 的需求和验收锚点；第 ⑧ 节是变更记录 C1–C12 |
| `docs/spec-m5.md` | M5 的需求和验收锚点（待确认） |
| `docs/DEPLOY.md` | GitHub Pages 设置、发布步骤、iPhone 添加到主屏幕 |
| `docs/device-checklist.md` | 每个里程碑的真机检查清单 |
| `docs/test-reports/M0`…`M4/report.md` | 每个里程碑的测试结果、发现的问题、反向验证、原始输出、截图 |

## 9. 新对话的开场白（Henry 可以直接贴）

> 这是 TXT 阅读器项目（iOS PWA），目录 `D:\Claude Code\4-APP\PWA-reader`。
> 请先读 `docs/HANDOFF.md`、`CLAUDE.md`、`docs/spec-m5.md`，然后把 `docs/spec-m5.md` 第 ⑦ 节的 5 条待确认事项列给我，我确认后再开始做 M5a（手势密码）。
