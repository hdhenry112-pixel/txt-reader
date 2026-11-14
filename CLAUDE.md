# TXT 阅读器（iOS PWA）

## 这是什么
只给 Henry 自己 iPhone 用的 TXT 小说阅读器。形式是 PWA：Safari 打开 GitHub Pages 地址后「添加到主屏幕」。
书的内容只存在手机本地，仓库里只有代码。

**档位**：A 全套　**定档理由**：会长期迭代；数据结构改错会丢掉手机里的书和阅读进度。

**需求和验收标准**：[docs/spec-mvp.md](docs/spec-mvp.md)（2026-11-13 确认）。改需求要在 spec 末尾的「变更记录」里登记，不许悄悄改。

**当前进度**：M0–M4 完成，M4 已经 Henry 真机验证通过（2026-11-14）。M5a 手势密码完成：0.5.1 手势密码，0.5.2 加「切到后台时遮挡画面」（spec-m5 C3），0.5.3 修「断网启动时版本号不显示」（C4）。2026-11-14 发布，等 Henry 真机验证。PDF 是 0.5.4。
下一步 M5b：文字型 PDF 导入。需求在 [docs/spec-m5.md](docs/spec-m5.md)（2026-11-14 确认）。开工第一件事是查 pdf.js 的版本、文件和总大小，告诉 Henry 再往下做。
接手这个项目先读 [docs/HANDOFF.md](docs/HANDOFF.md)。

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
  reader.css            阅读页、菜单栏、目录面板；排版参数是 .reader 上的 CSS 变量
js/
  app.js                入口：注册 Service Worker（不等 register 完成，见 ⑧）、新版本提示、禁止缩放、申请持久存储
  shelf.js              书架页：列表、排序、导入入口、点书打开、「等待重新导入」的提示
  book-actions.js       每本书的「更多操作」：换编码重新导入、删除
  backup.js             备份的生成和恢复（数据层），备份文件格式写在文件开头
  backup-panel.js       书架右上角「更多」打开的面板：备份、恢复（手势密码那一节在 lock/lock-setup.js）
  wakelock.js           屏幕常亮
  theme-boot.js         普通脚本（非模块），在 <head> 里同步执行：启动时先套上次的主题，避免闪白底
  lock-boot.js          普通脚本（非模块），在 <head> 里同步执行：开启了手势密码就先标记 data-locked，避免闪一下书架
  settings.js           设置的默认值、范围、读取、保存、套用主题
  settings-panel.js     设置面板的界面
  reader/
    reader.js           阅读页控制：打开书、加载章节、切换模式、套用设置、保存和恢复进度
    position.js         进度百分比计算；在段落里找「第一个可见的字」和「第 N 个字在哪」
    scroll-mode.js      滚动模式
    page-mode.js        翻页模式：CSS columns 分页、点击区域、滑动
    menu.js             顶部栏和底部栏
    toc.js              目录面板
  lock/
    rules.js            手势密码的规则（纯函数）：中间点自动连上、至少 4 个点、连错 5 次等 30 秒、离开 5 分钟要重画
    lock-store.js       手势密码的存储（localStorage）：PBKDF2 加盐摘要、错误次数、解禁时间
    pad.js              九宫格画板（按下拖过各点、松手提交）
    lock-screen.js      锁屏页：启动时和离开前台 ≥ 5 分钟后上锁；切到后台时遮挡画面（data-covered）；忘记图案 = 清空全部数据
    lock-setup.js       「更多」面板里的手势密码一节：开启、修改、关闭
  normalize.js          段落整理（纯函数）
  chapterizer.js        分章（纯函数），含切分字数等常量
  importer/
    decode.js           编码判断与解码（纯函数）
    parse.js            字节 → 可入库的书（纯函数，串起 decode / normalize / chapterizer）
    importer.js         导入流程：逐本处理、重复判断、入库、认领等待中的进度；换编码重新导入
  storage/
    db.js               打开数据库、迁移函数数组、删除整个数据库（忘记图案用）
    books.js            books / tocs / chapterGroups 的读写；章节分组只在这个文件里可见
    progress.js         progress 和 pending 的读写；位置日志（localStorage）
  ui/
    dialog.js           页面内的确认框和信息框；overLock 为真时盖在锁屏页上面
    toast.js            提示条
icons/                  由 tests/gen-icons.mjs 生成
tests/
  serve.mjs             本地测试服务器，挂在 /txt-reader/ 子路径，可模拟「发布了新版本」
  gen-fixtures.mjs      生成 spec ④ 的测试文件 F1–F9 到 tests/fixtures/（不进仓库）
  gen-icons.mjs         生成图标
  mutate.mjs            反向验证工具：把源码改坏一处 / 还原（见 ⑧）
  playwright.config.js  WebKit + iPhone 15 视口
  unit/                 纯函数的单元测试（node:test），直接 import js/ 下的模块
  e2e/                  端到端测试；helpers.js 是通用工具，reader-helpers.js 是阅读页的操作（打开书、点屏幕、跳章）
docs/
  HANDOFF.md            交接文档：现状、下一步、环境、协作要点
  spec-mvp.md           M0–M4 的需求和验收标准
  spec-m5.md            M5（手势密码、PDF）的需求和验收标准
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

库名 `txt-reader`，**schema 版本 2**（= `js/storage/db.js` 里 `MIGRATIONS` 数组的长度）。
版本 1（0.3.2 及之前）到版本 2（0.4.1 起）的变化：正文从 `chapters` 仓库（一章一条）搬到 `chapterGroups` 仓库（每 50 章一条），旧仓库删除。

| 仓库 | 主键 | 字段 | 状态 |
|---|---|---|---|
| `books` | `id`（`crypto.randomUUID()`） | `title`（文件名去掉 .txt）、`fileName`、`fileSize`（字节）、`encoding`（`utf-8` / `gbk` / `big5` / `utf-16le` / `utf-16be`）、`encodingSuspect`（布尔）、`totalLen`（全书字数）、`chapterCount`、`addedAt`（毫秒时间戳）、`lastReadAt`（没读过为 `null`） | 在用 |
| `tocs` | `bookId` | `entries`：`[{ title, len }]`，`len` 是该章字数 | 在用 |
| `chapterGroups` | `[bookId, group]` | `texts`：这一组里每章的文本组成的数组（最多 50 个）；每章的文本是该章所有段落用换行符连接，不含标题行 | 在用 |
| `progress` | `bookId` | `chapterIdx`、`offset`（屏幕上第一个可见的字在本章的序号）、`percent`（整数）、`updatedAt` | 在用 |
| `settings` | `key`（固定 `global`） | `mode`（`page` / `scroll`）、`fontSize`（14–30）、`lineHeight`（1.4–2.2）、`margin`（8–40）、`theme`（`day` / `sepia` / `night`）。读出来的值不合法时该项用默认值 | 在用 |
| `pending` | `fileKey`（`文件名|字节数`） | `title`、`progress`（可为 `null`）、`lastReadAt`。从不含正文的备份恢复时写入；导入对上的 txt 时取出并删除 | 在用 |

约定：
- 「字数」一律指 JS 字符串的 `length`，不含标题行、换行和缩进
- 一本书的写入（元数据 + 目录 + 全部章节）在同一个事务里，要么全成要么全不写
- 第 `idx` 章在第 `floor(idx / 50)` 组的第 `idx % 50` 个位置。**50 这个数（`CHAPTERS_PER_GROUP`）不能改**，手机里的数据是按它分组的；要改只能再写迁移
- 备份文件里正文仍然是「每章一个字符串」的平铺数组，和数据库里怎么分组无关
- 重复导入的判断：`fileName` 和 `fileSize` 都相同
- 0 字的章是合法的（标题后面紧跟另一个标题，比如「第一卷」后面直接是「第一章」）
- 保存进度时同一个事务里把 `books.lastReadAt` 更新为当前时间
- 进度 % = 向下取整（(当前章之前各章字数之和 + `offset`) ÷ 全书字数 × 100）；到达最后一章的末尾记 100

**IndexedDB 之外的一处存储：位置日志。** `localStorage` 的 `txt-reader:position-journal`，最多一条，内容是
`{ bookId, chapterIdx, offset, percent }`。每次保存进度先同步写它，数据库写成功后擦掉；
App 启动时如果它还在，说明上次数据库没写成，由 `recoverJournal()` 补进数据库。原因见 ⑧。

**另一处：设置日志。** `localStorage` 的 `txt-reader:settings-journal`，内容是整份设置。和位置日志同理：改设置时先同步写它，
数据库写成功后擦掉；启动时如果还在，每一项按「日志 → 数据库 → 默认值」的顺序取第一个合法的值，再补进数据库。

**另一处：手势密码。** `localStorage` 的 `txt-reader:lock`，没开启时不存在。内容 `{ v, salt, hash, iterations, fails, until }`：
PBKDF2-SHA256 加盐摘要（不存图案本身）、连续画错次数、解禁时间（毫秒时间戳）。不进 IndexedDB、不进备份；恢复备份不改它。
放在 localStorage 的原因：`js/lock-boot.js` 要在第一帧之前同步读到它。键名写在 `lock-boot.js` 和 `lock/lock-store.js` 两处，要改两处一起改。

**另一处：主题副本。** `localStorage` 的 `txt-reader:theme`，是 `settings.theme` 的副本，只给 `js/theme-boot.js` 在启动第一帧之前读。
正式的值在 IndexedDB；两者不一致时以 IndexedDB 为准（`loadSettings()` 会覆盖副本）。

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
  实录：2026-11-14 Henry 真机反馈，0.1.2 修。同日 Henry 真机确认：更新到 0.1.2 后 Google Drive 里的 txt 能选了。
- **页面关闭时写 IndexedDB 会被中途掐断，最后一次阅读位置会丢。** 所以有上面的「位置日志」：先同步写 `localStorage`，下次启动补进数据库。
  不要因为「spec 说进度存 IndexedDB」就把日志删掉。实录：2026-11-14 M2，「滚动后不到半秒就刷新」的测试失败，连刚跳到的章都没存上。
- **两种阅读模式是同一套接口**（`render / getOffset / isAtEnd / restore / scrollToEnd / relayout / activate / deactivate`），`reader.js` 不关心当前是哪种。加第三种模式照这个接口写。
- **翻页模式里判断「某个字在不在当前页」，用字相对于内容左边缘的位置，不用屏幕坐标。** 翻页有 200 毫秒的过渡，过渡期间屏幕坐标是变的。
- **连续调设置时要用锚点定位**（`reader.js` 的 `anchor`）。每次都拿「当前页第一个字」重新定位，连点 7 次增大字号后原来在读的字会被挤出屏幕。实录：2026-11-14 M3，P6 失败。
- **App 启动是异步的**（先读设置、恢复位置日志，再绑按钮）。启动完成后 `<html>` 上会有 `data-ready="1"`，测试用 `waitAppReady()` 等它。页面上的静态文字比它出现得早，看到文字就操作会扑空。
- **测试里点正文收起设置面板时，要点面板上方**（`tapAbovePanel`）。面板盖住屏幕下半部分，点屏幕正中间会点在面板上。
- **凡是「改完立刻关 App 也不能丢」的数据，都不能只靠 IndexedDB。** 阅读位置和设置都是先同步写 `localStorage` 日志。以后加这类数据照此办理。
  实录：2026-11-14，0.3.1 线上检查发现换主题后立刻刷新，主题变回白天；本地复现 4 次里丢 2 次。0.3.2 修。
- **靠时机的测试抓不住「来不及写完」这类 bug。** 0.3.2 第一版测试是「改设置后立刻刷新」，把修复删掉它照样 6 次全过，因为数据库有时来得及写完。
  要写成不靠时机的：直接断言「调用的那一刻日志已经在 localStorage 里」，以及「只有日志时启动能恢复」。
- **后台任务的结果必须先读、再写结论。** 实录：2026-11-14 我在 M3 线上检查还没读结果时就把「通过」写进报告并推送了，实际是失败的。已撤回重写。
- **写 IndexedDB 的耗时取决于记录条数，不取决于内容多少。** 实测 WebKit 每写一条约 15 毫秒：2000 条只有 1 个字的记录要 30 秒，40 条 20 万字的记录只要 0.6 秒。分批提交、`durability: relaxed` 都没有用。
  所以正文每 50 章存一条。以后往库里存「很多条小记录」的设计都要先想到这一点。实录：2026-11-14 M4，F4 导入 31 秒 → 0.9 秒。
- **调起文件选择界面和系统分享面板，必须紧跟在用户的点击之后。** 所以导出备份分「生成备份」「保存到文件」两次点击（生成要读数据库，是异步的）；
  换编码时选完编码立刻 `input.click()`。真机上是否都能调起，见真机清单 M4。
- **不要等 `navigator.serviceWorker.register()` 完成再做别的事。** 断网时它在某些情况下一直不完成（既不成功也不报错）。版本号和更新检查用 `navigator.serviceWorker.ready` 拿注册信息。
  实录：2026-11-14 0.5.2 线上检查，「开启密码 → 刷新 → 解锁 → 切到后台再回来 → 断网 → 刷新」后版本号一直是「…」。M0 起就有，0.5.3 修。测试 `m5-offline-start.spec.js`。
- **IndexedDB 删除数据库时的 `blocked` 事件不是失败。** 它只表示还有连接没关完（刚 `close()` 的连接上还有事务在跑时，close 会等它跑完），连接关完后删除会自己继续。
  `deleteDatabase()` 里只在 10 秒仍没删掉时才报错。实录：2026-11-14 M5a，第一版把 `blocked` 当失败，「读书中被锁 → 忘记图案」报「数据库被另一个页面占用」，是端到端测试抓到的。
- **测「在第一帧之前就生效」的东西，不能在 `DOMContentLoaded` 时检查。** 那时模块脚本（`app.js`）已经执行完了。要在 `<body>` 刚插进文档时检查（`MutationObserver`，见 `m5-lock.spec.js` 的 K1 补充）。
  实录：M5a 反向验证时把 `lock-boot.js` 清空，第一版测试照样过。
- **电脑上的浏览器测不了真的切 App。** 「切到后台 / 回到前台」在测试里是改写 `document.visibilityState` 再发 `visibilitychange` 事件（`m5-lock.spec.js` 的 `setVisibility`），时间用 `page.clock` 控制。真机上的切换要看真机清单。
- **shell 命令里不要用双引号包含反引号的文字**（比如 `node -e "..."` 里写 Markdown）。bash 会把反引号里的内容当命令执行。改文档用脚本文件或文件写入工具。实录：M5a 改文档时出过一次，好在命令都失败了、没有写入。
- **用脚本批量改文件前先把 CRLF 换行统一成 LF。** 这个仓库在 Windows 上签出后工作区是 CRLF，多行的查找文本对不上。实录：M4 一次批量修改因此整体失败（好在是报错而不是静默跳过）。
- **端到端测试里不要「点某个元素」来模拟点正文。** Playwright 点元素前会先把它滚到可见位置，等于替用户滚了屏，位置相关的断言全错。
  用 `page.mouse.click` 点屏幕固定坐标（`m2-reader.spec.js` 的 `tapText`）。
- **界面切换后要等内容更新完再断言。** 跳章后等新章标题出现；回书架后用会重试的 `expect(locator).toHaveText()`，不要立刻读一次文字。
  实录：M2 首轮 5 项失败全是这两类测试脚本问题，其中「书架排序」之前能过是碰巧。
- **反向验证用 `tests/mutate.mjs`**，它在改之前确认目标文本正好出现 1 次，找不到就报错。不要用 sed：M1 时 sed 没匹配上、代码没变，我差点把「测试是绿的」当成了验证通过。
- **单元测试和端到端测试第一次就全绿时，要做反向验证。**
  做法：故意把被测代码改坏一处（比如 `>=` 改成 `>`、从 `sw.js` 清单里删一个文件），确认对应的测试变红，再还原。
  实录：2026-11-14 M1，38 项测试一次全过，做了 6 个改坏的版本，全部被抓到。记录在 `docs/test-reports/M1/report.md`。
- **不要用 shell 的 heredoc 写含中文引号和反引号的长测试文件**，会在引号解析上出错且什么都不写入。用文件写入工具。
- **Playwright 里断网后 `page.reload()` 失败时，旧页面内容还留在屏幕上。**
  所以离线测试不能只断言「书架文字可见」，还要断言 reload 本身没抛错、且页面里由脚本新填的内容（版本号）出现了。
