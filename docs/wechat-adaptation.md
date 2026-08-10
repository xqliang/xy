# 微信小游戏适配 + IAA 广告位 方案

> 原则（硬约束）：**不影响本地调试（vite@5180）与服务器部署（ecs:8082）**。
> Web 构建始终是「真源」，微信适配全部以**新增、可开关**的方式叠加，Web 运行路径零改动。

## 〇、环境安装（macOS）

**微信开发者工具**（小游戏联调/上传的唯一官方工具）：

```bash
brew install --cask wechatwebdevtools     # 安装（本机已装：/Applications/wechatwebdevtools.app）
open -a wechatwebdevtools                  # 启动；首次需用微信扫码登录
```

> 也可从官网下载：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html

**账号 / AppID**：在 https://mp.weixin.qq.com 注册「小游戏」账号，拿到 **AppID**，填入
`wechat/project.config.json` 的 `appid`。IAA 广告位在 mp 后台「流量主」申请（激励视频/插屏），
拿到 `adUnitId` 填入 `web/src/ads.ts` 的 `AD_UNITS`。

## 一、总体策略

保持一套 `game-core`（纯 TS 数值）+ `web`（Vite+Canvas）代码，微信小游戏通过「**运行时适配层 + 独立构建产物**」复用同一套源码：

- **平台差异**用薄抽象隔离：广告（`ads.ts`）、存储、音频、输入、生命周期。Web 端为默认实现，微信端在 `typeof wx` 守卫后启用。
- **微信构建**是独立入口/产物（`wechat/`），不进入 `web` 的 vite dev/build，因此 `./start.sh dev|build|deploy` 完全不受影响。

## 二、运行时差异映射

| 能力 | Web（现状，保持不变） | 微信小游戏 | 适配做法 |
|---|---|---|---|
| 画布 | `document.getElementById('game')` | `wx.createCanvas()` | weapp-adapter 提供 `document`/`window`/`canvas` 垫片；入口处注入全局画布 |
| 帧循环 | `requestAnimationFrame` | `canvas.requestAnimationFrame`（adapter 已 polyfill 到全局） | 保持现有 `requestAnimationFrame` 调用 |
| 输入 | pointerdown/move/up | `wx.onTouchStart/Move/End` | adapter 把 touch 事件转成 canvas 上的 pointer 事件；现有指针逻辑可复用 |
| 存储 | `localStorage`（rank/stamina/merit/weapons/mute…） | `wx.getStorageSync/setStorageSync` | 新增 `storage.ts` 抽象；Web=localStorage，微信=wx storage。**分步替换**各模块直接 localStorage 调用 |
| 音频 | Web Audio API（`sfx.ts` 实时合成） | 微信支持 WebAudio（`wx.createWebAudioContext()`） | `sfx.ts` 里 `new AudioContext()` 改为工厂：Web=AudioContext，微信=wx.createWebAudioContext() |
| 图片 | `new Image()` + `assets/*.png` | `wx.createImage()` + 本地包内路径 | adapter 提供 `Image`；资源随包体或分包加载 |
| 字体 | 系统字体 | 需 `wx.loadFont()` 或用系统字体 | 优先系统字体，避免额外字体文件 |
| 生命周期 | 页面可见即运行 | `wx.onShow/onHide` | 新增：onHide 暂停循环/静音，onShow 恢复（对齐"看广告暂停战斗"） |

## 三、IAA 广告位（已落地抽象层）

`web/src/ads.ts`（本分支已加）：

- `showRewardedAd(scene)` → `Promise<boolean>`：微信下拉激励视频，`onClose.isEnded` 为 true 才发奖；**Web / 未配置广告位时立即 resolve(true) 模拟发奖**，本地体验不变。
- `showInterstitialAd()`：插屏，Web/未配置为 no-op。
- `AD_UNITS`：广告位 id 占位，上线前在微信公众平台申请后填入。

**接入点（渐进）**：
- 已接：主菜单「📺 体力+10」→ `showRewardedAd('stamina')`（看完才 +10）。
- 待接：对局失败「看广告复活」、结算「看广告双倍功德/双倍神兵」、道具三选一「看广告刷新」、体力耗尽复满。均走同一 `showRewardedAd`，Web 下自动模拟。
- 插屏：可在对局结算/返回主菜单时机 `showInterstitialAd()`（频控由微信侧规则约束）。

## 四、构建管线（不碰 web 的 dev/build）

目标：产出可在「微信开发者工具」打开的小游戏包，放到 `wechat/dist`，**与 `web/dist` 完全分离**。

建议：
1. `wechat/` 目录：`game.json`（窗口/分包配置）、`project.config.json`（appid/项目设置）、`game.js`（入口：先 `import './weapp-adapter'` 注入垫片，再 `import` 打包后的游戏 bundle）。
2. 用 vite **library 模式**（或 esbuild）把 `web/src/main.ts` 打成单文件 IIFE bundle → 输出到 `wechat/dist/game.bundle.js`；`game.js` 引它。
3. 新增脚本 `./start.sh wx`（独立命令）：只做微信构建，不影响 `dev/build/deploy`。
4. 用微信开发者工具打开 `wechat/` 真机/模拟器验证（本环境无法自动化验证，需人工）。

> 说明：weapp-adapter（DOM/canvas 垫片）是关键。可用社区版 `@wechat-minigame/weapp-adapter` 或官方 `weapp-adapter.js`。接入后 `document.getElementById('game')` 等调用需改由 adapter 注入的全局画布提供——这一步建议在 `main.ts` 顶部做一个「获取画布」的小封装，Web 用 `document.getElementById`，微信用全局 `canvas`。

## 五、落地顺序（每步都保持 web 可跑）

1. ✅ `ads.ts` IAA 抽象 + 主菜单激励视频接入（本分支）。
2. `storage.ts` 抽象 + 逐个模块替换 localStorage（web 行为不变）。
3. `platform.ts`：画布获取、音频上下文工厂、生命周期钩子的平台分支。
4. `wechat/` 脚手架（game.json/project.config.json/game.js + adapter）+ `./start.sh wx` 构建。
5. 微信开发者工具联调（人工）：输入/音频/存储/广告位真机验证。
6. 申请正式广告位 id 填入 `AD_UNITS`，灰度。

## 六、风险与边界

- 本仓库/CI 无法自动跑微信真机，第 5 步需人工在微信开发者工具验证。
- 音频：微信对 WebAudio 支持随版本差异，若合成音频异常，退化为「预渲染短音效 buffer」。
- 包体：立绘/地图 PNG 较大，超 4MB 主包需用**分包加载**。

## 六½、资源加载页（Web / 微信共用）

启动时 `screen='loading'`，`loadAssets(onProgress)` 预载全部图片（不含 `bgm-*`），再 `prefetchMenuBgm`（**微信端跳过文件 BGM**），完成后进首页。

| | Web | 微信小游戏 |
|---|---|---|
| 清单 | `asset-manifest.web.ts`（Vite 哈希 URL） | `asset-manifest.wx.ts`（包内 `assets/…`） |
| 图片对象 | `new Image()` | `wx.createImage()`（`platform.createImage`） |
| 预载 | 同一套 `assets.ts` + 加载页 `loading-screen.ts` | 同左；本地包解码仍可能卡顿，加载页同样有用 |
| SFX | WebAudio 程序合成 | `wx.createWebAudioContext()` |
| 文件 BGM | fetch + decode | 当前禁用；以后可用 `InnerAudioContext` / 读包 |
| 包体策略 | CDN/HTTP 缓存 | 主包 4MB 限制 → `game.json` subpackages + `wx.loadSubpackage`，加载页可挂分包进度 |

**是否需要加载页？** 需要。微信与 Web 共用同一套入口；微信本地资源虽不必「下载」，但解码大图仍异步，没有加载页会先闪程序化回退 UI。若日后分包，加载页更应展示分包进度。

相关：`web/src/assets.ts`、`loading-screen.ts`、`main.ts`（`screen='loading'`）、`./start.sh wx` 同步 `wechat/assets/`。

## 七、部署与发布（IAA 上线）

微信小游戏**不走服务器部署**（与 ecs:8082 的 Web 部署无关），而是「构建产物 → 微信开发者工具上传 →
mp 后台提交审核 → 发布」。

**步骤：**

1. **构建**：
   ```bash
   ./start.sh wx          # 生成 wechat/game.bundle.js 并同步 wechat/assets/
   ```
2. **放置 adapter（一次性）**：把 `weapp-adapter.js` 放到 `wechat/`（见 `wechat/README.md`）。
3. **填 AppID / 广告位**：`wechat/project.config.json` 的 `appid`；`web/src/ads.ts` 的 `AD_UNITS`。
4. **打开工具联调**：微信开发者工具 → 导入「小游戏」项目，目录选 `wechat/` → 编译运行（模拟器/真机预览）。
5. **上传**：工具栏右上「上传」→ 填版本号 + 项目备注 → 上传为「开发版」。
6. **提交审核 / 发布**：https://mp.weixin.qq.com →「版本管理」把开发版设为体验版自测，无误后**提交审核**；
   审核通过点**发布**上线。IAA 需先在 mp 后台「流量主」开通并绑定广告位。

**版本管理建议**：`project.config.json` 的 `projectname` 固定；每次上传用递增版本号（如 `1.0.0`、`1.0.1`），
备注写清改动，便于在 mp 后台回滚到历史版本（微信侧有版本回退）。

> 提示：Web 版（ecs:8082）与微信版是**两条独立发布线**，共享同一套 `web/src` 源码。改逻辑后
> 分别 `./start.sh deploy`（Web）与 `./start.sh wx`+工具上传（微信）即可，互不影响。
