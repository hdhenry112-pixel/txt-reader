# TXT 阅读器（iOS PWA）

## 这是什么
只给 Henry 自己 iPhone 用的 TXT 小说阅读器。形式是 PWA：Safari 打开 GitHub Pages 地址后「添加到主屏幕」。
书的内容只存在手机本地，仓库里只有代码。

**档位**：A 全套　**定档理由**：会长期迭代；数据结构改错会丢掉手机里的书和阅读进度。

**需求和验收标准**：[docs/spec-mvp.md](docs/spec-mvp.md)（2026-11-13 确认）。改需求要在 spec 末尾的「变更记录」里登记，不许悄悄改。

**当前进度**：M0、M1 完成（导入、分章、存储、书架、删除），线上版本 0.1.2。下一步 M2（滚动模式、目录、进度）。
书架上的书目前还点不开，阅读页在 M2 加入。

---

## ① 交付门槛（不达标不算完成）

**最终用户动作**：iPhone 主屏幕打开 App → 从「文件」导入 txt → 点书进入阅读 → 目录跳章、翻页 → 划掉 App、开飞行模式、重新打开 → 回到原位置。

每次改动后：

- [ ] `cd tests && npm test` 全部通过（生成测试数据 → 单元测试 → Playwright WebKit iPhone 视口端到端测试）。是全量跑，不是只跑新加的
- [ ] 端到端测试覆盖：console 无报错、断网后能打开并阅读、没有本站以外的请求、版本更新提示
- [ ] spec 第 ④ 节的锚点（分章数、字数、进度 %、备份往返）全部对上
- [ ] 截图存到 `docs/test-reports/M<n>/`，并且人眼看过
- [ ] 发布前改了 `sw.js` 的 `VERSION`；新增或删除文件时同步改了 `sw.js` 的 `ASSETS`
- [ ] Playwright 测不了的项目（见 `docs/device-checklist.md`）交给 Henry 真机确认
- [ ] 本文件和 `docs/DEPLOY.md` 与代码一致

**禁止为通过检查而修改源码。** 门槛或锚点写错了就改 spec 并登记。

---

## ② 技术约束

- 原生 HTML / CSS / JS（ES modules）。不用框架、不用构建、不用 CDN，所有资源在仓库里
- 托管：GitHub Pages，public 仓库 `txt-reader`，地址是 `/txt-reader/` 子路径 → **所有资源路径用相对路径**，不许以 `/` 开头
- 目标环境：最新版 iOS Safari 的主屏幕 PWA 模式。不兼容其他浏览器
- 完全离线：Service Worker 缓存 App 外壳；正文和进度存 IndexedDB；App 运行期间不发网络请求（Service Worker 检查更新除外）
- UI 文案中文
- 不用浏览器原生的 `alert()` / `confirm()` / `prompt()`，用页面内弹层（`js/ui/`）
- `tests/` 下的 npm 依赖只用于测试，App 不依赖它
- 单个 JS 文件超过 300 行就拆分

---

## ③ 文件结构

```
index.html              唯一的页面
manifest.webmanifest
sw.js                   Service Worker：版本号、预缓存清单
.nojekyll               让 GitHub Pages 原样发布，不经过 Jekyll
css/
  themes.css            三个主题的颜色变量
  base.css              布局、safe-area、提示条
  shelf.css             书架页
js/
  app.js                入口：注册 Service Worker、新版本提示、禁止缩放、申请持久存储
  shelf.js              书架页：列表、排序、导入入口、删除
  normalize.js          段落整理（纯函数）
  chapterizer.js        分章（纯函数），含切分字数等常量
  importer/
    decode.js           编码判断与解码（纯函数）
    parse.js            字节 → 可入库的书（纯函数，串起 decode / normalize / chapterizer）
    importer.js         导入流程：逐本处理、重复判断、入库
  storage/
    db.js               打开数据库、迁移函数数组
    books.js            books / tocs / chapters 的读写
    progress.js         progress 的读取（保存在 M2 加入）
  ui/
    dialog.js           页面内的确认框和信息框
    toast.js            提示条
icons/                  由 tests/gen-icons.mjs 生成
tests/
  serve.mjs             本地测试服务器，挂在 /txt-reader/ 子路径，可模拟「发布了新版本」
  gen-fixtures.mjs      生成 spec ④ 的测试文件 F1–F9 到 tests/fixtures/（不进仓库）
  gen-icons.mjs         生成图标
  playwright.config.js  WebKit + iPhone 15 视口
  unit/                 纯函数的单元测试（node:test），直接 import js/ 下的模块
  e2e/                  端到端测试；helpers.js 里有导入文件、读 IndexedDB 的公共函数
docs/
  spec-mvp.md           需求和验收标准
  DEPLOY.md             部署步骤、iPhone 添加到主屏幕步骤
  device-checklist.md   真机检查清单
  test-reports/         每个里程碑的测试输出和截图
```

后续里程碑会加入的模块见 spec 3.4 节。加了就更新这里。

| 目录 | AI 权限 |
|---|---|
| App 代码、`tests/`、`docs/` | 可写 |
| `tests/fixtures/` | 只能由 `gen-fixtures.mjs` 生成，不手改 |
| `docs/test-reports/` 里已提交的旧里程碑报告 | 只读（历史记录，不回头改） |

---

## ④ 数据模型（IndexedDB）

库名 `txt-reader`，**schema 版本 1**（= `js/storage/db.js` 里 `MIGRATIONS` 数组的长度）。

| 仓库 | 主键 | 字段 | 状态 |
|---|---|---|---|
| `books` | `id`（`crypto.randomUUID()`） | `title`（文件名去掉 .txt）、`fileName`、`fileSize`（字节）、`encoding`（`utf-8` / `gbk` / `big5` / `utf-16le` / `utf-16be`）、`encodingSuspect`（布尔）、`totalLen`（全书字数）、`chapterCount`、`addedAt`（毫秒时间戳）、`lastReadAt`（没读过为 `null`） | 在用 |
| `tocs` | `bookId` | `entries`：`[{ title, len }]`，`len` 是该章字数 | 在用 |
| `chapters` | `[bookId, idx]` | `text`：该章所有段落用 `
` 连接，不含标题行 | 在用 |
| `progress` | `bookId` | `chapterIdx`、`offset`、`percent`、`updatedAt` | 已建仓库，M2 开始写入 |
| `settings` | `key`（固定 `global`） | `mode`、`fontSize`、`lineHeight`、`margin`、`theme` | 已建仓库，M3 开始写入 |
| `pending` | `fileKey`（`文件名|字节数`） | 等待认领的进度 | 已建仓库，M4 开始写入 |

约定：
- 「字数」一律指 JS 字符串的 `length`，不含标题行、换行和缩进
- 一本书的写入（元数据 + 目录 + 全部章节）在同一个事务里，要么全成要么全不写
- 重复导入的判断：`fileName` 和 `fileSize` 都相同
- 0 字的章是合法的（标题后面紧跟另一个标题，比如「第一卷」后面直接是「第一章」）

迁移规则：
- `js/storage/db.js` 里维护一个按版本号排列的迁移函数数组，升级时从旧版本逐级执行
- 迁移只允许新增或转换，不允许清空已有仓库
- 每次改 schema：版本号加 1、加一个迁移函数、加一条迁移测试（旧版本数据升级后书和进度不丢）

---

## ⑤ Service Worker 版本号规则

- 版本号只有一处：`sw.js` 第一行的 `const VERSION = 'x.y.z';`。这一行的格式不要改，测试服务器靠它模拟新版本
- **每次发布（push 到 main）只要 App 文件有变化，就必须改 `VERSION`**，否则已安装的手机拿不到新文件
- 版本号写法：`0.<里程碑>.<该里程碑内第几次发布>`，例如 M1 的第 1 次发布是 `0.1.1`、M2 的第 1 次是 `0.2.1`；MVP 完成时为 `1.0.0`。（M0 用的是 `0.1.0`，是这条规则定下来之前发的，属于例外）
- 缓存名是 `txt-reader-v<VERSION>`；新版本激活时删除所有其他 `txt-reader-v*` 缓存
- **新增、删除、改名任何 App 文件，都要同步改 `sw.js` 里的 `ASSETS` 清单。** 漏了的后果是离线时那个文件加载失败。「断网后重新加载且没有资源加载失败」这条端到端测试会抓到
- 更新流程：新 worker 装好后停在 waiting → App 显示「有新版本，点击刷新」→ 用户点击 → 新 worker 接管 → 页面刷新。不自动 `skipWaiting`

---

## ⑥ 部署

见 [docs/DEPLOY.md](docs/DEPLOY.md)。简述：push 到 `main` 分支，GitHub Pages 从 `main` 的根目录发布，约 1 分钟后生效。

---

## ⑦ 敏感数据

- 真实的书（任何 `.txt`）不得进 git，`.gitignore` 已全局忽略 `*.txt`
- 测试数据只用 `gen-fixtures.mjs` 生成的假文字
- 仓库是 public 的：commit 用 GitHub 的 noreply 邮箱，文档里不写个人信息

---

## ⑧ 本项目特有的坑

- **WebKit 把 Service Worker 的 `updatefound` 和 `statechange` 事件攒到 worker 接管页面之后才送达。**
  所以不能用「事件发生时 `navigator.serviceWorker.controller` 是否存在」区分首次安装和更新，
  要用「`reg.waiting` 和 `reg.active` 同时存在」。
  实录：2026-11-13 M0，首次安装误弹「有新版本」。我第一次的判断（把 controller 的检查提前到 updatefound 时）是错的，
  打日志后才看到事件送达顺序。详见 `docs/test-reports/M0/report.md`。
- **文件选择框不能写 `accept`。** 写了 `accept=".txt,text/plain"` 以后，iOS 文件选择界面里 Google Drive 位置显示 Content Unavailable。
  现在不限制类型，选完后在 `js/importer/importer.js` 里按扩展名检查。不要为了「更规范」把 accept 加回来。
  实录：2026-11-14 Henry 真机反馈，0.1.2 修。去掉后是否解决，以 Henry 的真机确认为准（见 `docs/device-checklist.md`）。
- **单元测试和端到端测试第一次就全绿时，要做反向验证。**
  做法：故意把被测代码改坏一处（比如 `>=` 改成 `>`、从 `sw.js` 清单里删一个文件），确认对应的测试变红，再还原。
  实录：2026-11-14 M1，38 项测试一次全过，做了 6 个改坏的版本，全部被抓到。记录在 `docs/test-reports/M1/report.md`。
- **不要用 shell 的 heredoc 写含中文引号和反引号的长测试文件**，会在引号解析上出错且什么都不写入。用文件写入工具。
- **Playwright 里断网后 `page.reload()` 失败时，旧页面内容还留在屏幕上。**
  所以离线测试不能只断言「书架文字可见」，还要断言 reload 本身没抛错、且页面里由脚本新填的内容（版本号）出现了。
