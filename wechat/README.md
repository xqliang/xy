# 《大圣与唐僧》微信小游戏

本目录是微信小游戏（IAA 纯广告变现）的运行容器。游戏逻辑复用 `../web/src`（同一套源码），
通过平台适配层（`web/src/platform.ts`、`ads.ts`、`storage.ts`）屏蔽 Web / 微信差异。

## 目录内容

- `game.json` — 小游戏窗口配置（竖屏）
- `project.config.json` — 项目配置（**appid 需替换为你在 mp.weixin.qq.com 注册的小游戏 AppID**）
- `game.js` — 入口：先加载 `weapp-adapter.js`，再加载构建产物 `game.bundle.js`
- `game.bundle.js` — 由 `./start.sh wx` 从 `web/src/main.ts` 打包生成（**勿手改**）
- `assets/` — 由 `./start.sh wx` 从 `web/public/assets` 同步而来
- `weapp-adapter.js` — **需自行放置**（见下）

## 安装微信开发者工具（macOS）

```bash
brew install --cask wechatwebdevtools     # 安装
open -a wechatwebdevtools                  # 启动，微信扫码登录
```

> 官网下载：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html

## 构建

```bash
./start.sh wx      # 构建 game.bundle.js 并同步 assets/ 到本目录
```

## 放置 weapp-adapter（一次性）

小游戏运行时没有 DOM，需要适配器提供 `document/window/canvas/Image/AudioContext` 等垫片。
从微信官方 minigame demo 或社区包获取 `weapp-adapter.js` 放到本目录：

- 官方 demo：微信开发者工具「新建小游戏项目」会生成含 `weapp-adapter.js` 的模板，拷过来即可
- 或社区包 `@wechat-minigame/weapp-adapter`

## 联调（需人工，在本机已装的「微信开发者工具」中进行）

1. 打开微信开发者工具 → 新建/导入「小游戏」项目，目录选择本 `wechat/`。
2. 填入 AppID（或选择「测试号」）。
3. 编译运行，在模拟器/真机预览。

## 待联调验证的适配点（当前为「盲写」，需在 devtools 迭代）

- **输入**：`web/src/main.ts` 用 `canvas.addEventListener('pointerdown/move/up')`。weapp-adapter 通常把
  触摸事件转成 canvas 事件；若未触发，需要在 main.ts 增加 `wx.onTouchStart/Move/End` → 逻辑坐标的桥接。
- **音频**：`sfx.ts` 用 `platform.createAudioContext()`（微信=`wx.createWebAudioContext()`）。若合成音异常，
  退化为预渲染短 buffer。
- **资源**：`asset-manifest.wx.ts` 指向包内 `assets/…`；启动走与 Web 相同的**加载页**（`loading-screen.ts`），预载图片后再进首页。确认 `./start.sh wx` 后 `wechat/assets/` 与清单一致。
- **广告位**：在 `web/src/ads.ts` 的 `AD_UNITS` 填入正式激励视频/插屏广告位 id。
- **包体**：素材较大，若主包超 4MB 需改用分包加载（`game.json` subpackages），加载页可挂 `wx.loadSubpackage` 进度。
