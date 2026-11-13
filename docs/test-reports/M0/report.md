# M0 测试报告：骨架和部署链路

**日期**：2026-11-13　**版本**：0.1.0　**环境**：Windows 11，Node 24.14.1，Playwright 1.65.0，WebKit，iPhone 15 视口

## 结论

- 单元测试 8 项通过（测试数据自检）
- 端到端测试 4 项通过：空书架无报错、只请求本站文件、断网后重新加载、新版本提示与切换
- **未验证**：真机上的表现（添加到主屏幕、状态栏、刘海留白、禁止缩放、真机离线）。见 `docs/device-checklist.md` 的 M0 部分，等 Henry 确认
- **未验证**：GitHub Pages 上的线上地址（写这份报告时仓库还没推送）

## spec ⑦ 里两个「没把握」的结论

| 项 | 结论 |
|---|---|
| Windows 上的 Playwright WebKit 是否支持 Service Worker 和离线模拟 | 支持。Service Worker 能注册、缓存、接管页面；`context.setOffline(true)` 确实切断网络 |
| 离线模拟是否真的生效（而不是测试空转） | 生效。做了反向验证：禁用 Service Worker 后断网，`page.reload()` 报 `WebKit encountered an internal error` |

## 过程中的失败和我的误判

1. **首次安装时误弹「有新版本，点击刷新」**（产品 bug，已修）
   - 现象：第 4 个测试在「首次安装不应出现更新提示」这一步失败。
   - 我的第一次判断是错的：以为是 `installed` 事件到达时页面已被接管，于是把「页面是否已被控制」的检查提前到发现新 worker 的时刻。重跑仍然失败。
   - 打日志后看到的实际顺序：`register()` 返回时页面未被控制；之后 WebKit 把 `updatefound`、`installed`、`activating`、`activated` 攒在同一时刻送达，而那时页面已经被接管。所以任何「事件发生时看 controller」的写法在 WebKit 上都分不清首次安装和更新。
   - 修法：改为「有一个 worker 在 waiting，同时有一个 worker 在 active」才提示。`js/app.js` 的 `setupServiceWorker`。
   - 已写入 `CLAUDE.md` 第 ⑧ 节。
2. **`npm test` 第一次跑失败**（测试脚本问题，不是产品问题）
   - `node --test unit/` 在 Node 24 下把 `unit/` 当成模块路径，报找不到模块。改成 `node --test "unit/*.test.mjs"`。
3. **离线测试的断言强度**
   - 反向验证时发现：断网后 `page.reload()` 失败，旧页面内容仍留在屏幕上，「还没有书」依然可见。所以离线测试不能只靠文字可见。现有测试靠三点保证：`reload()` 本身不抛错、背景色来自缓存的 CSS、版本号由缓存的脚本重新填入。

## 对 spec 的一处改动

版本号来源从 `version.js` 改为 `sw.js` 第一行，已登记在 spec 第 ⑧ 节 C1。

## 截图

| 文件 | 内容 |
|---|---|
| `01-空书架.png` | 首次打开 |
| `02-断网后重新加载.png` | 断网后 reload |
| `03-有新版本提示.png` | 服务器换成 9.9.9 后，页面仍是 0.1.0，底部出现提示 |
| `04-刷新后是新版本.png` | 点击提示后，版本号变为 9.9.9 |

已知的小问题：`03` 里提示条压住了底部的版本号文字。提示条是临时出现的，暂不处理。

## 原始输出（`cd tests && npm test`）

```
> test
> node gen-fixtures.mjs && node --test "unit/*.test.mjs" && playwright test
F1-utf8-bom.txt              152824 字节
F2-gbk.txt                     4940 字节
F3-nochapter.txt              71466 字节
F3b-nochapter-51.txt          14553 字节
F4-big.txt                 22625453 字节
F5-traps.txt                   2833 字节
F6-oversize.txt              185702 字节
F7-utf16le.txt                  838 字节
F8-utf16be.txt                  826 字节
F9-big5.txt                     800 字节
B2-empty.txt                      0 字节
B3-one-para.txt                 289 字节
✔ 每段正好 100 个字，且不同段的原文互不相同 (0.808ms)
✔ F1 的段落总数是 552（全书 55200 字） (0.1274ms)
✔ F1 以 UTF-8 BOM 开头 (1.6285ms)
✔ F2 不是合法的 UTF-8，按 GBK 解码后含「镕」 (2.146ms)
✔ F7 / F8 带 UTF-16 的 BOM (1.5807ms)
✔ F9 按 Big5 解码能得到原文 (0.7016ms)
✔ F4 大于 20MB (0.2478ms)
✔ B2 是 0 字节 (0.2692ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 100.3066
Running 4 tests using 1 worker
  ok 1 [webkit-iphone] › e2e\m0-shell.spec.js:15:1 › 打开后显示空书架，console 无报错 (577ms)
  ok 2 [webkit-iphone] › e2e\m0-shell.spec.js:27:1 › 页面只请求本站的文件 (438ms)
  ok 3 [webkit-iphone] › e2e\m0-shell.spec.js:36:1 › 断网后重新加载，仍能打开书架，且没有任何资源加载失败 (630ms)
  ok 4 [webkit-iphone] › e2e\m0-shell.spec.js:56:1 › 发布新版本后出现提示，点击后切到新版本 (2.3s)
  4 passed (5.2s)
```
