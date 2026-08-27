# 广告功能 → 分享好友 改造 + tray 铲子分享按钮

- 日期：2026-08-27
- 分支/worktree：`feature/share-friend`
- 状态：设计已确认，待写实现计划

## 1. 背景与目标

微信小游戏侧的 IAA 激励视频（"看广告加体力"）需要账号有 500 UV 才能开通广告位，第 1 期先不上。
本次把"广告加体力"入口在微信端**隐藏**（代码保留，留给第 2 期），改以**分享好友**作为主要的体力/资源获取途径，并新增一个战斗内的"分享得铲子"入口（参考竞品：tray 右侧一格金框铲子 ×1）。

核心目标：
1. 微信端：隐藏"看广告+10"，保留并**做实**"分享好友+5 体力"（当前是点击即 +5 的假分享）。
2. 全局每天最多分享 **4 次**；分享须**判定成功**后才发奖。
3. 微信端体力上限 **30**（代码已满足，无需改）。
4. Web 端：体力弹窗**去掉**"分享好友"入口，只留"看广告+10"（保持现状）。
5. 新增微信端 tray 右侧"铲子 ×1"分享按钮：**第 6 波起**出现，点击走微信分享，**成功→自动挖最优阵位**；与体力弹窗分享**共用**每天 4 次额度，用满则不显示。

## 2. 范围矩阵

| 平台 | 体力弹窗按钮 | tray 铲子分享按钮 | 体力上限 |
|---|---|---|---|
| **微信小游戏** | 隐藏"看广告+10"，只留"分享好友+5"（真分享） | ✅ `wave≥6` 且今日额度未满时显示 | 30（现状） |
| **Web** | 去掉"分享好友+5"，只留"看广告+10"（不变） | ❌ 永不显示 | 50（不变） |

平台判定沿用 `platform.ts` 的 `isWeChat`。

## 3. 关键决策（已与用户确认）

- **分享成功判定**：`onHide 真触发` 且 `onHide→onShow 停留 ≥ 2000ms` 判成功。
  - 依据：微信小游戏 `wx.shareAppMessage` 转发给单个好友**无可靠成功回调**；`shareTicket` 仅群分享产生。故采用 onShow 停留时长启发式；"是否真的切到后台（onHide）"作为"面板真的打开了"的等价证据（选人页是原生页、在小游戏沙箱外，读不到其滚动/点击）。
- **Web 端铲子按钮**：不显示（与"web 去掉分享入口"一致）。
- **铲子按钮立绘**：**复用现有 `item-shovel` 素材** + canvas 合成金框与"×1"角标；不新生成素材、不需要 tos-upload。（如后续要竞品同款烤图，另起任务。）
- **波次门槛**：`b.wave >= 6`（"第 6 波起"）。
- **发奖与扣次数顺序**：仅在**判定成功后**才 `consumeShare()`（扣次数）并发奖；失败/取消不扣次数。铲子分享若当下**无可挖格**，toast 提示且**不扣次数**（宽松，不惩罚用户）。

## 4. 详细设计

### 4.1 分享成功判定 —— `web/src/platform.ts` 新增 `shareToFriend()`

签名（草案）：

```ts
export interface ShareToFriendOpts { title: string; query?: string; imageUrl?: string; }
/** 微信：拉起好友转发并按 onHide+停留启发式判定；Web/无 wx → resolve(false)。 */
export function shareToFriend(opts: ShareToFriendOpts): Promise<boolean>;
```

实现要点：
- 仅 `isWeChat && typeof wx.shareAppMessage === 'function'` 时真跑；否则 `Promise.resolve(false)`。
- 挂**临时** `wx.onHide` / `wx.onShow` 监听（用 `wx.offHide` / `wx.offShow` 收尾），**不改动** `main.ts` 已注册的全局暂停/重连 handler（wx 支持多监听并存）。
- 时序：记 `startTs` → `wx.shareAppMessage({title, query})` → onHide 置 `sawHide=true, hideTs` → onShow 时 `resolve(judgeShareSuccess(sawHide, hideTs, showTs))` 并清理监听。
- 兜底：`startTs` 后约 **5s** 内无 onHide → `resolve(false)` 并清理（面板没起/被频控），避免永久 pending。
- 判定核心抽成**纯函数**，便于单测：

```ts
export function judgeShareSuccess(sawHide: boolean, hideTs: number, showTs: number, minDwellMs = 2000): boolean {
  return sawHide && showTs - hideTs >= minDwellMs;
}
```

### 4.2 每日分享额度 —— 新增 `web/src/share-quota.ts`

仿 `web/src/loadout.ts` 的自然日重置模式（`today() = Math.floor(Date.now()/86400000)`，跨天清零）。

```ts
export const MAX_DAILY_SHARES = 4;
interface ShareQuota { day: number; count: number; }
export function loadShareQuota(): ShareQuota;      // 跨天重置
export function remainingShares(): number;          // MAX - count（≥0）
export function canShare(): boolean;                // remainingShares() > 0
export function consumeShare(): ShareQuota;         // count+1 并持久化（调用方保证成功后才调）
```

- KEY：`dasheng.shareQuota`，localStorage（`storage.ts`）。
- **两个入口共用同一池**：体力弹窗分享 + tray 铲子分享，合计 ≤ 4/天。

### 4.3 体力弹窗改造 —— `web/src/menu-popups.ts` + `web/src/main.ts`

- `drawStaminaPopup`：按平台只画**一个**按钮（居中）：
  - 微信：`分享好友 +5`；今日额度用尽 → 置灰 + "今日分享已达上限"；体力已满 → 置灰 + "体力已满"。
  - Web：`看广告 +10`（逻辑不变）。
- 点击"分享好友"（微信，`main.ts` 的 `staminaPopupHitAt` → `kind:'share'` 分支重写）：
  1. `canShare()` 否 → toast"今日分享已达上限"，return。
  2. 体力已满 → toast"体力已满"，return。
  3. `staminaPopupToast='正在拉起分享…'` → `shareToFriend({title, query})`。
  4. 成功：`consumeShare()` + `stamina = addStamina(stamina, 5)` + toast"分享成功，体力 +5" + `scheduleCloudSync` + telemetry。
  5. 失败：toast"未完成分享，未发放体力"。
- 帮助/引导文案分叉：`main.ts:1215`、`menu-help.ts:204`（现"看广告或分享好友"）→ 微信只提分享、web 只提看广告。

### 4.4 tray 铲子分享按钮 —— `web/src/render.ts` + `web/src/main.ts` + `web/src/battle.ts`

- **范式**：仿暂停按钮（独立于 `getButtons`）——新增 `shareShovelBtnRect()` + `hitShareShovelBtn(x,y)` + `drawShareShovelBtn(ctx,b)`；`draw()` 中 `drawTray` 之后调用一次；`onPointerDown` 中命中一次。
- **位置**：tray 右侧一格 `x ≈ 454, y = 777(TRAY_Y+5), w = 68(TRAY_SLOT-6), h = 68(TRAY_H-10)`。与 dev-only"布阵"按钮同区；生产 `showAutoplaceBtn()=false` 不冲突，代码加注释说明"仅 DevTools 开 autoplace 时视觉重叠"。
- **显示 gate**：`isWeChat && b.wave >= 6 && (b.status==='ready' || b.status==='playing') && remainingShares() > 0`。gate 不满足时 draw/hit 一起消失。
- **视觉**：金色圆角框 + `item-shovel` 立绘居中 + 右下"×1"角标（canvas 合成）。
- **点击**（**先挖后扣**，避免"扣了次数却没挖到"）：
  1. `canShare()` 否 → return（正常情况下按钮已隐藏，双保险）。
  2. `shareToFriend({title, query})`。
  3. 成功：先调 `battle.shareDigBest()`：
     - 返回 `true`（挖到）→ `consumeShare()` + toast"好友助力，铲开新阵位！"。
     - 返回 `false`（无可挖格）→ toast"暂无可开垦阵位" 且**不扣次数**。
  4. 分享失败/取消：toast"未完成分享"，不扣次数。

### 4.5 `battle.ts` 改动

- 新增 public 包装（复用现有私有 `tryAutoDigShovel(false)` / `playerAutoDigCell` 路径）：

```ts
/** 分享奖励：自动挖最优阵位（同洛阳铲路径）。挖成功返回 true，无可挖格返回 false。 */
shareDigBest(): boolean;
```

- 内部：`buildPlayerAutoView()` → `scoreDiggableCells(view, DIG_EXIT_WEIGHT)` → 空则 return false；否则 `scored[0].cell` → `playerAutoDigCell(target)`（`unlocked.add` + `digFx` + `emit('shovel')` + shovelPeach），设自定义消息，可不触发 `luoyangchan` flash。
- **不改**数值常量、不改 `serialize/applyCoreState` 结构（挖开的格进 `unlocked`，已被现有存档覆盖）。

## 5. 复用锚点（探路结果）

- 体力：`web/src/stamina.ts`（`STAMINA_MAX` 微信=30、`addStamina`）。
- 广告抽象：`web/src/ads.ts`（`showRewardedAd`，保留）。
- 现有假分享入口：`web/src/main.ts:1670-1674`（`kind:'share'` 即 +5，需重写）；广告 +10 分支 `:1653-1668`。
- 弹窗按钮绘制：`web/src/menu-popups.ts:330-331`（`STA_AD`/`STA_SHARE`）。
- tray 布局/坐标：`web/src/render.ts` `drawTray`（`TRAY_LEFT=80, TRAY_SLOT=74, traySize=5, TRAY_Y=772, TRAY_H=78`；右侧空档 x∈[450,560]）；`trayIndexAt` 对越界 x 返回 null（不会误命中新按钮）。
- 暂停按钮范式：`web/src/render.ts` `PAUSE_BTN`/`pauseBtnRect`/`hitPauseBtn`/`drawPauseBtn`（`:167-175, :10639`）；`onPointerDown` 命中 `main.ts:2123`。
- 波次字段：`Battle.wave`（`battle.ts:1004`），render/main 可直接读 `b.wave`。
- 挖掘复用：`battle.tryAutoDigShovel(false)`（`battle.ts:5226`，private）、`playerAutoDigCell`（`:5248`）、`scoreDiggableCells`/`pickBestDigCell`（`autoplace.ts:317/344`）、`AUTO_SHOVEL_INTERVAL_S`（`battle.ts:59`）。
- onShow/onHide 钩子：`platform.ts` `onAppHide/onAppShow`；`main.ts:209-210` 已用于全局暂停/重连（新分享监听须并存、勿覆盖）。
- 素材：`item-shovel.png`（`asset-manifest.names.ts:40`，已上线 CDN）。
- 每日重置范式：`web/src/loadout.ts:11 today()`。

## 6. 测试计划

- 单测（`web/tests/`，vitest include 只收 `tests/**`）：
  - `share-quota`：跨天重置、上限 4、`consume/remaining/canShare`。
  - `judgeShareSuccess`：sawHide=false→false；停留 <2s→false；sawHide 且 ≥2s→true；边界 2000ms。
- `tsc` + `vitest` 在 `web/` 跑；验收标准"**不新增**报错"（main 基线本就有 ~28 处既有报错）。
- 新 worktree 需先软链 `web/node_modules`（`ln -s` 主树）并 `mkdir web/shots` 才能跑 vitest/dev。

## 7. 真机 / 浏览器验证清单

- 微信真机：分享面板拉起；停留 <2s 取消→不发奖不扣次数；停留 ≥2s→发奖扣次数；4 次用满后体力弹窗分享置灰、tray 铲子按钮消失；`wave≥6` 才出现铲子按钮；点击成功后挖格动画+音效与普通铲一致。
- Web 浏览器冒烟：体力弹窗只有"看广告+10"、无"分享好友"；战斗内无铲子按钮；`shareToFriend` 返回 false 路径不发奖。

## 8. 不做（YAGNI）

- 不改体力上限（微信已 30）。
- 不做群分享 `shareTicket` 严格校验。
- 不新生成铲子/竞品立绘素材。
- 不改 `ads.ts` 真实广告逻辑（仅隐藏微信入口）。

## 9. 风险 / 遗留

- **判定可被规避**：停留启发式理论上可被"故意切后台 2s 再回来"刷；配合 4 次/天上限，风险可控。第 2 期若上真广告或需强校验，可加群分享 shareTicket。
- **dev autoplace 按钮重叠**：仅 DevTools 开 `showAutoplaceBtn()` 时与铲子按钮视觉重叠，生产不触发，代码注释标注。
- **`shareToFriend` 兜底超时**：5s 无 onHide 判失败——若用户机型 onHide 触发很慢，可能漏判；阈值实现时可调。
