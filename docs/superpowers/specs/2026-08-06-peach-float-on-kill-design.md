# 击杀蟠桃飘字设计

## 背景
击杀怪物时已在 `Battle.updateMonsters` 加算蟠桃（`PEACH_PER_KILL` / 精英 / BOSS / `killBonus`），并有 death burst 与击杀音效；HUD 只显示总蟠桃数。缺少竞品那种「怪物头上 桃子+N」的世界坐标反馈。

## 目标
怪物死亡瞬间，在其头上弹出 `🍑+N`（N = 本次实际获得量），带上抛半格 + 重力、过顶后再下落约 1/5 格后消失，让击杀收益可感知。

## 方案选择
独立 `peachFloats` 数组 + 简易弹道（`y` / `vy` / `ay`），不塞进现有几何 `Burst`（后者只有线性 TTL 淡出）。不做通用飘字框架（YAGNI）。

## 数据模型（battle.ts）
```ts
interface PeachFloat {
  c: number;       // 死亡格
  r: number;
  amount: number;  // 本次实际获得蟠桃
  y: number;       // 相对格子中心的竖直偏移（格；负=向上）
  vy: number;      // 竖直速度（格/秒；负=向上）
  peakY: number;   // 到达过的最高 y（最负）
}
```

常量（可放 `battle.ts` 旁或 `TUNING` 附近）：
- `PEACH_FLOAT_HEAD_Y ≈ -0.55`：出生点（约血条高度，头上）
- `PEACH_FLOAT_RISE = 0.5`：上抛峰值相对出生点约 0.5 格
- `PEACH_FLOAT_FALL = 0.2`：过顶后再下落 1/5 格后移除
- `PEACH_FLOAT_GRAVITY`：正重力（格/秒²）；初速 `vy0 = -sqrt(2 * gravity * RISE)`，使理论升空高度为 `RISE`

## 触发与更新
- **触发**：`updateMonsters` 中 `m.hp <= 0` 分支——先算 `amount`（与现有 `this.peach += …` 同一表达式），再 `peach += amount`，push death burst，并：
  ```ts
  this.peachFloats.push({
    c: dp.c, r: dp.r, amount,
    y: PEACH_FLOAT_HEAD_Y,
    vy: -Math.sqrt(2 * PEACH_FLOAT_GRAVITY * PEACH_FLOAT_RISE),
    peakY: PEACH_FLOAT_HEAD_Y,
  });
  ```
- **更新**：`updateFx(dt)`：
  - `vy += gravity * dt`
  - `y += vy * dt`
  - `peakY = min(peakY, y)`
  - 若 `y >= peakY + PEACH_FLOAT_FALL` → 移除
- **范围**：仅击杀奖励；征兵、蟠桃园、漏怪补偿等其它来源不飘。

## 绘制（render.ts）
- 新增 `drawPeachFloats(ctx, b)`，在 `drawBursts` 之后调用。
- 位置：`cellCenterPx(c, r)` + `y * CELL` 偏移。
- 文案：`🍑+${amount}`（emoji，与 HUD 一致）。
- 样式：白字 + 黑描边（`strokeText`/`fillText`），居中对齐。
- Alpha：升空段保持不透明；过顶后按下落进度 ` (y - peakY) / FALL ` 淡出到 0。

## 不做（YAGNI）
- 新桃子 PNG / DOM 叠加层。
- 改 `game-core` 经济逻辑。
- 伤害数字或其它飘字。
- 非击杀蟠桃来源的飘字。
- HUD 蟠桃脉冲动画。

## 测试
- 逻辑轻量、强依赖 canvas 观感：以 typecheck + 手动/headless 冒烟为主。
- 可选：抽纯函数测「给定 gravity/rise，峰值偏移 ≈ 0.5」与「过顶后下落 0.2 移除」——非必须，优先保证击杀路径接线正确。
