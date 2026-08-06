# 击杀蟠桃飘字 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 击杀怪物时在其头上弹出 `🍑+N`（N=实际获得量），带上抛半格 + 重力、过顶后再下落 1/5 格后消失。

**Architecture:** 独立 `peachFloats` 数组 + 简易弹道；在 `updateMonsters` 击杀分支 spawn，在 `updateFx` 积分，在 `render.ts` 于 `drawBursts` 后绘制。不改 `Burst`、不改 `game-core`。

**Tech Stack:** TypeScript、Canvas 2D、现有 `Battle` / `render.ts`

## Global Constraints

- 显示实际获得量（含精英/BOSS/`killBonus`）
- 图标用 emoji `🍑`（与 HUD 一致）
- 仅击杀奖励飘字；其它蟠桃来源不飘
- 上抛约 0.5 格，过顶后下落约 0.2 格消失，带重力

---

### Task 1: PeachFloat 模型与击杀 spawn / 更新

**Files:**
- Modify: `web/src/battle.ts`
- Test: `web/tests/peach-float.test.ts`（新建；测弹道峰值与移除条件的纯函数，若抽得出；否则测 kill 后 `peachFloats.length`）

**Interfaces:**
- Produces: `export interface PeachFloat { c: number; r: number; amount: number; y: number; vy: number; peakY: number }`
- Produces: `Battle.peachFloats: PeachFloat[]`
- Produces: constants `PEACH_FLOAT_HEAD_Y`, `PEACH_FLOAT_RISE`, `PEACH_FLOAT_FALL`, `PEACH_FLOAT_GRAVITY`

- [ ] **Step 1: 在 battle.ts 增加类型与常量**

在 `Burst` 接口附近增加：

```ts
export const PEACH_FLOAT_HEAD_Y = -0.55;
export const PEACH_FLOAT_RISE = 0.5;
export const PEACH_FLOAT_FALL = 0.2;
export const PEACH_FLOAT_GRAVITY = 6; // 格/秒²

export interface PeachFloat {
  c: number;
  r: number;
  amount: number;
  y: number;
  vy: number;
  peakY: number;
}

export function peachFloatInitialVy(gravity = PEACH_FLOAT_GRAVITY, rise = PEACH_FLOAT_RISE): number {
  return -Math.sqrt(2 * gravity * rise);
}
```

- [ ] **Step 2: Battle 增加 `peachFloats` 字段**

```ts
peachFloats: PeachFloat[] = [];
```

- [ ] **Step 3: 击杀分支 spawn**

在 `updateMonsters` 的 `m.hp <= 0` 分支，把加成拆成 `amount` 再赋值：

```ts
const amount =
  (m.isBoss ? PEACH_PER_BOSS : PEACH_PER_KILL) +
  (isElite ? PEACH_PER_ELITE : 0) +
  this.mods.killBonus;
this.peach += amount;
const dp = posAtDistance(this.map, m.dist);
this.bursts.push({ kind: 'death', c: dp.c, r: dp.r, ttl: 0.4, maxTtl: 0.4, big: m.isBoss, color: m.isBoss ? '#ff5a8a' : '#c25a5a' });
const vy0 = peachFloatInitialVy();
this.peachFloats.push({
  c: dp.c, r: dp.r, amount,
  y: PEACH_FLOAT_HEAD_Y,
  vy: vy0,
  peakY: PEACH_FLOAT_HEAD_Y,
});
this.emit(m.isBoss ? 'bosskill' : 'kill');
```

- [ ] **Step 4: updateFx 积分与移除**

```ts
for (const p of this.peachFloats) {
  p.vy += PEACH_FLOAT_GRAVITY * dt;
  p.y += p.vy * dt;
  if (p.y < p.peakY) p.peakY = p.y;
}
this.peachFloats = this.peachFloats.filter((p) => p.y < p.peakY + PEACH_FLOAT_FALL);
```

- [ ] **Step 5: 单测初速与移除条件**

`web/tests/peach-float.test.ts`：断言 `peachFloatInitialVy()` 满足 `vy^2 ≈ 2*g*rise`；模拟几步积分后 `peak` 升幅接近 0.5、过顶下落超 0.2 被滤掉。

- [ ] **Step 6: Commit**

```bash
git add web/src/battle.ts web/tests/peach-float.test.ts
git commit -m "$(cat <<'EOF'
feat(web): 击杀时弹出蟠桃+N 飘字弹道

EOF
)"
```

（若本 task 只改 battle，绘制可放 Task 2 同一 commit——按「一个可玩交付」合并为一次 commit 亦可；本计划允许 Task 1+2 合成一次 `feat` commit。）

---

### Task 2: Canvas 绘制飘字

**Files:**
- Modify: `web/src/render.ts`

**Interfaces:**
- Consumes: `Battle.peachFloats`, `PeachFloat` 字段

- [ ] **Step 1: 增加 `drawPeachFloats`**

```ts
function drawPeachFloats(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const p of b.peachFloats) {
    const { x, y: cy } = cellCenterPx(p.c, p.r);
    const y = cy + p.y * CELL;
    const fallProgress = p.y >= p.peakY ? (p.y - p.peakY) / PEACH_FLOAT_FALL : 0;
    const alpha = 1 - Math.min(1, Math.max(0, fallProgress));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${Math.round(CELL * 0.42)}px "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = `🍑+${p.amount}`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20,16,12,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#fffef6';
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}
```

从 `@/battle` 或相对路径导入所需常量。

- [ ] **Step 2: 在 `draw` 中于 `drawBursts` 之后调用 `drawPeachFloats`**

- [ ] **Step 3: typecheck / 相关测试**

Run: `cd web && npx tsc --noEmit`（或项目既有脚本）与 `npx vitest run tests/peach-float.test.ts`

- [ ] **Step 4: Commit（若未与 Task 1 合并）**

```bash
git add web/src/render.ts web/src/battle.ts web/tests/peach-float.test.ts
git commit -m "$(cat <<'EOF'
feat(web): 击杀时弹出蟠桃+N 飘字弹道

EOF
)"
```
