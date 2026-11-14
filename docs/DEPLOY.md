# 部署说明

## 一、GitHub Pages（只需设置一次）

1. 打开仓库页面 → **Settings** → 左侧 **Pages**
2. **Source** 选 `Deploy from a branch`
3. **Branch** 选 `main`，文件夹选 `/ (root)`，点 **Save**
4. 等约 1 分钟，页面顶部会显示地址：`https://<GitHub 用户名>.github.io/txt-reader/`

之后每次 push 到 `main`，GitHub 会自动重新发布，约 1 分钟生效。
可以在仓库的 **Actions** 页看到名为 `pages build and deployment` 的记录，绿色对勾表示发布完成。

## 二、发布新版本的步骤

1. 改代码
2. 改 `sw.js` 开头注释之后那一行 `const VERSION = 'x.y.z';`（规则见 `CLAUDE.md` 第 ⑤ 节）
3. 新增或删除了文件的话，同步改 `sw.js` 里的 `ASSETS`
4. `cd tests && npm test` 全部通过
5. commit 并 push 到 `main`
6. 约 1 分钟后，在 iPhone 上打开 App（或切到后台再切回来），底部出现「有新版本，点击刷新」，点一下
7. 书架页底部的版本号变成新的，说明更新成功

## 三、iPhone 上添加到主屏幕（只需做一次）

1. 用 **Safari** 打开 `https://<GitHub 用户名>.github.io/txt-reader/`（必须是 Safari，其他浏览器装出来的行为不同）
2. 点底部工具栏的 **Share** 按钮（方框里一个向上的箭头）
3. 在弹出的菜单里往下滑，点 **Add to Home Screen**
4. 名称默认是「阅读」，点右上角 **Add**
5. 回到主屏幕，点「阅读」图标打开

注意：
- 主屏幕上的 App 和 Safari 里打开的网页**数据不互通**。书要在主屏幕 App 里导入
- 删除主屏幕图标会**同时删掉里面所有的书和进度**。删之前先在 App 里导出备份
- 第一次打开需要联网（下载 App 外壳），之后可以完全离线使用

## 四、本地运行和测试

需要 Node.js（只用于测试，App 本身不需要）。

```bash
cd tests
npm install
npx playwright install webkit
npm test
```

只想在电脑浏览器里看一眼：

```bash
cd tests
node serve.mjs
```

然后打开 `http://localhost:4173/txt-reader/`。
