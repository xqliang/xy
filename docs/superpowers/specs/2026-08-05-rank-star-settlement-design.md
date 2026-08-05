# 段位星级结算页设计

## 背景
当前 `rank.ts` 只有整数 `level`（映射 8 档称号 凡人→齐天大圣），胜负后只调 `level`/`difficulty` 并在对战画面弹一个横幅。缺少竞品那种「每局加/减一颗星」的可感知段位反馈。

## 目标
每局胜利或失败后，进入独立结算页，用动画点亮新增星（胜）或熄灭一颗星（败），让玩家清晰感知段位变化；满星晋级、零星降档时给额外提示。

## 数据模型（rank.ts）
```ts
interface RankState { level: number; stars: number; difficulty: number; }
```
- `level`：大段位下标 0..7（0=凡人 … 7=齐天大圣），每档 5 星（`STARS_PER_TIER = 5`）。
- `difficulty`：与星星解耦，每局照旧胜 ×1.06 / 败 ×0.88（`recordWin`/`recordLose` 内维持）。
- 兼容旧存档：`loadRank` 缺 `stars` 时默认 0。

### 升降规则
- 胜：`stars+1`；若达 `STARS_PER_TIER` → `level+1`、`stars=0`（晋级）。已是最高档则星封顶在 `STARS_PER_TIER`。
- 败：`stars-1`；若 `<0`：`level>0` 时 `level-1`、`stars=STARS_PER_TIER-1`（降档回退到 4 星）；否则 `level=0,stars=0`（凡人地板）。

### 变化描述
`recordWin`/`recordLose` 返回：
```ts
interface RankChange {
  state: RankState;           // 结算后
  before: { level; stars };   // 结算前
  won: boolean;
  promoted: boolean;          // 是否晋级
  demoted: boolean;           // 是否降档
  starDelta: -1 | 0 | 1;      // 本次星星净变化（地板/封顶时可能为 0）
}
```
供结算页决定动画方向；`starDelta===0` 时（封顶继续赢 / 地板继续输）只播放"结果标题"，不做加减星动画。

## 结算页（settle.ts）
- 新增 `screen = 'settle'`。
- `drawSettle(ctx, change, tMs)`：半透明遮罩 + 结果标题（取得真经 / 取经失败）+ 段位名 + 一排 `STARS_PER_TIER` 颗星（金星/暗星，沿用现有绘制风格）。
- 动画时间线（`tMs` 为进入结算页后的毫秒）：
  1. 先按 `before` 星态渲染。
  2. 短暂停顿（~500ms）。
  3. 胜：点亮新增第 `before.stars` 颗星（缩放弹入 + 闪光）；败：熄灭第 `after.stars` 颗星（变暗，按推荐不做碎裂）。
  4. 晋级/降档：动画收尾时段位名切换 + 飘一行"晋级！/降段"。
- 掉落神兵 / 功德不在结算页显示（沿用现有提示），保持结算页只讲段位。
- 交互：动画放完后点击任意处 → 回主菜单；动画进行中点击可跳过直接到终态。

## 接入（main.ts）
- `endHandled` 块：调 `recordWin/recordLose` 拿到 `RankChange`，存入模块级 `settleChange` + 记录进入结算的时间戳，`screen='settle'`。神兵/功德结算逻辑保持不变。
- `frame()`：加 `screen==='settle'` 分支，`drawSettle(ctx, settleChange, now - settleStart)`。
- `pointerdown`：加 `settle` 分支——动画未完则跳到终态，已完则 `screen='menu'`。

## 不做（YAGNI）
- 菜单页 / HUD 旁的小星展示。
- 失败碎裂特效。
- 结算页展示掉落 / 功德。

## 测试
- `tests/rank.test.ts`（vitest，纯逻辑）：
  - 连胜到满星→晋级、星归 0。
  - 最高档满星继续赢→星封顶、`starDelta=0`、`promoted=false`。
  - 零星失败→降档、回退到 4 星。
  - 凡人 0 星失败→停在 level0/stars0、`starDelta=0`、`demoted=false`。
  - `loadRank` 缺 stars 字段兼容默认 0。
- 结算页为 canvas 动画，靠 typecheck + 手动/headless 冒烟验证。
