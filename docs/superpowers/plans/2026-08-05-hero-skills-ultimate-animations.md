# 武将技能特色化：每英雄专属大招动画 + 合成等级/单字面板修正 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每个有技能的武将拥有专属大招动画（复用现有 skillCd 定期触发），按定位分群攻/暴击；合成后只显示整体等级；单字介绍面板标明技能未生效并修排版重叠。

**Architecture:** 表现层新增独立的 `HeroUltFx` 特效数组（不动现有 `Burst`/`HitFx`/`ultFlash`），由 `castGeneralSkill` 施放时推入，`render.ts` 新增 `drawHeroUlt()` 以 `switch(heroId)` 分派 11 套手绘 canvas 动画，风格对齐现有 `drawFx`。群攻/暴击由纯函数 `ultTypeOf(def)` 派生（`ranged→crit`，其余 `aoe`）。合成等级与面板修正为 `render.ts` 局部改动。

**Tech Stack:** TypeScript + Canvas 2D，Vite；vitest（纯逻辑单测）；puppeteer-core 截图脚本（渲染/集成验证）。

---

## 命名约定（避免与旧系统冲突）

- 旧的 `ultFlash`/`ultCenter`（battle.ts:298-299）是**主动技能** AOE（紧箍咒/陨石）的爆闪，**不要动**。
- 本次新系统一律用 `heroUlt` 前缀：类型 `HeroUltFx`、字段 `heroUltFx`、渲染 `drawHeroUlt`。

## File Structure

- `web/src/generals.ts` — 纯数据/逻辑：新增 `UltType`、`ultTypeOf(def)`、`CRIT_MULT`。
- `web/src/battle.ts` — `HeroUltFx` 接口、`Battle.heroUltFx` 字段、`updateFx` 清理、`castGeneralSkill` 改造（暴击倍率 + 推 heroUltFx，移除通用 bursts.push）。
- `web/src/render.ts` — `drawWordTile` 加 `showTier`；`drawGenerals` 抹掉激活格单字上标；新增 `drawHeroUlt` + 调用 + 暴击飘字；单字面板置灰/标注/修 ph 与排版。
- `web/tests/hero-ult.test.ts` — 新建：`ultTypeOf` 全量映射 + `CRIT_MULT` 单测。
- `web/tools/heroult.mjs` — 新建：注入并冻结 11 套大招动画峰值帧，逐英雄截图。

---

## Task 1: generals.ts — 群攻/暴击派生 + 暴击倍率（纯逻辑，TDD）

**Files:**
- Modify: `web/src/generals.ts`（末尾追加）
- Test: `web/tests/hero-ult.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `web/tests/hero-ult.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { GENERALS, ultTypeOf, CRIT_MULT } from '../src/generals';

describe('大招类型派生 ultTypeOf', () => {
  it('远程单点(ranged)英雄 = 暴击 crit', () => {
    for (const id of ['nezha', 'erlang']) {
      const def = GENERALS.find((g) => g.id === id)!;
      expect(ultTypeOf(def)).toBe('crit');
    }
  });

  it('其余技能类型 = 群攻 aoe', () => {
    for (const id of ['wukong', 'honghaier', 'bajie', 'tieshan', 'shaseng', 'niumowang', 'guanyin', 'baigujing', 'tangseng']) {
      const def = GENERALS.find((g) => g.id === id)!;
      expect(ultTypeOf(def)).toBe('aoe');
    }
  });

  it('恰好两个暴击英雄(哪吒/二郎)', () => {
    expect(GENERALS.filter((g) => ultTypeOf(g) === 'crit').map((g) => g.id).sort())
      .toEqual(['erlang', 'nezha']);
  });

  it('暴击倍率 > 1', () => {
    expect(CRIT_MULT).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd web && npx vitest run tests/hero-ult.test.ts`
Expected: FAIL —「ultTypeOf is not exported / not a function」。

- [ ] **Step 3: 实现**

在 `web/src/generals.ts` 末尾追加：

```typescript
// —— 大招（复用 skillCd 定期触发）——
// 类型按 skill 派生：远程单点(ranged) = 暴击(单体高倍 + 飘「暴击!」)，其余 = 群攻(范围结算)。
export type UltType = 'aoe' | 'crit';

export function ultTypeOf(def: GeneralDef): UltType {
  return def.skill === 'ranged' ? 'crit' : 'aoe';
}

// 暴击英雄大招在其单体基础倍数上再乘的倍率（初版，后续用 tools/sweep*.mjs 复核平衡）
export const CRIT_MULT = 1.5;
```

- [ ] **Step 4: 运行确认通过**

Run: `cd web && npx vitest run tests/hero-ult.test.ts`
Expected: PASS（4 项全绿）。

- [ ] **Step 5: 提交**

```bash
git add web/src/generals.ts web/tests/hero-ult.test.ts
git commit -m "feat(web): 武将大招类型派生 ultTypeOf(ranged→暴击/其余群攻) + 暴击倍率常量"
```

---

## Task 2: battle.ts — HeroUltFx 类型、字段与清理

**Files:**
- Modify: `web/src/battle.ts`（`Burst` 接口后 ~204 行插入类型；字段区 ~284；`updateFx` ~1588）

- [ ] **Step 1: 新增 HeroUltFx 接口**

在 `web/src/battle.ts` 的 `Burst` 接口（约 196-204 行）之后插入：

```typescript
// 武将大招专属特效（每英雄一套动画，渲染于格坐标；与主动技能的 ultFlash 无关）
export interface HeroUltFx {
  heroId: string;        // 分派动画用（对应 GeneralDef.id）
  c: number;             // 爆心列（通常取最前目标 inRange[0]）
  r: number;             // 爆心行
  ttl: number;
  maxTtl: number;
  tier: number;          // 品质阶(1..5)，用于特效规模
  rge: number;           // 英雄当前射程(格)，范围类动画铺开半径
  crit: boolean;         // true=暴击(单体) false=群攻(范围)
  critDmg?: number;      // 暴击伤害数字(crit 时飘字)
}
```

- [ ] **Step 2: 新增 Battle 字段**

在 `web/src/battle.ts` `bursts: Burst[] = [];`（约 284 行）之后插入：

```typescript
  heroUltFx: HeroUltFx[] = []; // 武将大招专属特效
```

- [ ] **Step 3: updateFx 中推进并清理**

在 `web/src/battle.ts` `updateFx` 内，`this.bursts = this.bursts.filter((bt) => bt.ttl > 0);`（约 1588 行）之后插入：

```typescript
    for (const uf of this.heroUltFx) uf.ttl -= dt;
    this.heroUltFx = this.heroUltFx.filter((uf) => uf.ttl > 0);
```

- [ ] **Step 4: 编译校验**

Run: `cd web && npm run typecheck`
Expected: 通过（新字段/类型无报错；此步尚未有人 push heroUltFx，属正常）。

- [ ] **Step 5: 提交**

```bash
git add web/src/battle.ts
git commit -m "feat(web): 新增 HeroUltFx 类型与 Battle.heroUltFx 字段及帧清理"
```

---

## Task 3: battle.ts — castGeneralSkill 改造（暴击倍率 + 推 heroUltFx）

**Files:**
- Modify: `web/src/battle.ts:1368-1411`（`castGeneralSkill`）
- 需在文件顶部 import 处补 `ultTypeOf, CRIT_MULT`

- [ ] **Step 1: 补充 import**

找到 `web/src/battle.ts` 顶部从 `./generals` 的 import（含 `generalById`、`GeneralDef` 等），加入 `ultTypeOf, CRIT_MULT`。例如：

```typescript
import { generalById, ultTypeOf, CRIT_MULT /* …其余已有导入保持 … */ } from './generals';
```

（若 generals 的符号是从别处再导出，按现有实际来源补齐；确保 `ultTypeOf`、`CRIT_MULT` 在本文件可用。）

- [ ] **Step 2: 用新实现替换 castGeneralSkill 整个函数体**

将 `web/src/battle.ts:1368-1411` 的 `castGeneralSkill` 整体替换为（保留各效果结算，移除每 case 的 `this.bursts.push`，末尾统一推 `heroUltFx`；ranged/暴击加 `CRIT_MULT`）：

```typescript
  private castGeneralSkill(g: ActiveGeneral, inRange: { m: Monster; d: number; p: { c: number; r: number } }[]): void {
    const atk = this.generalAtk(g);
    g.state.skillFlash = 1;
    const center = inRange[0]!.p;
    const crit = ultTypeOf(g.def) === 'crit';
    let critDmg: number | undefined;
    switch (g.def.skill) {
      case 'burst': {
        for (const t of inRange) { t.m.hp -= damage(atk * 3); t.m.hitFlash = 0.15; }
        break;
      }
      case 'ranged': {
        // 暴击：单体高倍 ×(5×CRIT_MULT)
        const t = inRange[0]!;
        const dmg = damage(atk * 5 * CRIT_MULT);
        t.m.hp -= dmg;
        t.m.hitFlash = 0.2;
        critDmg = dmg;
        break;
      }
      case 'stun': {
        for (const t of inRange) t.m.stunT = Math.max(t.m.stunT, 1.8);
        break;
      }
      case 'knock': {
        for (const t of inRange) t.m.dist = Math.max(this.entranceDist, t.m.dist - 2);
        break;
      }
      case 'slow': {
        for (const t of inRange) t.m.slowT = Math.max(t.m.slowT, 3);
        break;
      }
      case 'heal': {
        for (const t of inRange) t.m.slowT = Math.max(t.m.slowT, 2.5);
        if (!this.healUsedThisWave && this.tangsengHP < this.tangsengMaxHP) {
          this.tangsengHP += 1;
          this.healUsedThisWave = true;
          this.message = '观音甘露：唐僧回复 1 血';
        }
        break;
      }
    }
    // 专属大招特效（替代原通用 bursts.push）
    this.heroUltFx.push({
      heroId: g.def.id,
      c: center.c, r: center.r,
      ttl: 0.6, maxTtl: 0.6,
      tier: g.tier,
      rge: this.generalRge(g),
      crit,
      critDmg,
    });
    this.gainGeneralExp(g, 4);
  }
```

- [ ] **Step 3: 编译校验**

Run: `cd web && npm run typecheck`
Expected: 通过。

- [ ] **Step 4: 回归单测（确保未破坏既有战斗/桃树/放置测试）**

Run: `cd web && npm test`
Expected: 既有测试全绿（peachtree/placement/rank/summon* 等），新增 hero-ult 也绿。

- [ ] **Step 5: 提交**

```bash
git add web/src/battle.ts
git commit -m "feat(web): 大招施放改推 HeroUltFx，暴击英雄单体加 CRIT_MULT 倍率"
```

---

## Task 4: render.ts — 合成后只显示整体等级（第1点）

**Files:**
- Modify: `web/src/render.ts:371-389`（`drawWordTile`）、`web/src/render.ts:1164-1170`（`drawGenerals` 字牌循环）

- [ ] **Step 1: drawWordTile 加 showTier 参数**

把 `web/src/render.ts:371` 的签名与阶数上标改为：

```typescript
function drawWordTile(ctx: CanvasRenderingContext2D, char: string, tier: number, x: number, y: number, s: number, showTier = true) {
  roundRect(ctx, x - s / 2, y - s / 2, s, s, 7);
  ctx.fillStyle = '#f8f4e6';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = qualityColor(tier);
  ctx.stroke();
  ctx.fillStyle = '#241d14';
  ctx.font = `bold ${Math.round(s * 0.58)}px "PingFang SC", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, x, y + s * 0.02);
  // 阶数上标（合成为激活武将时由 showTier=false 隐藏，避免与金框整体 Lv 重复）
  if (showTier) {
    ctx.fillStyle = qualityColor(tier);
    ctx.font = `bold ${Math.round(s * 0.24)}px "PingFang SC", sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(String(tier), x + s / 2 - 3, y - s / 2 + 2);
  }
}
```

- [ ] **Step 2: drawGenerals 中激活格传 showTier:false**

把 `web/src/render.ts:1164-1170` 字牌循环改为先算激活格集合：

```typescript
function drawGenerals(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  // 已激活武将占用的格 → 抹掉单字阶数上标（只保留金框上方整体 Lv）
  const activeCells = new Set<string>();
  for (const g of b.activeGenerals()) for (const c of g.cells) activeCells.add(`${c.c},${c.r}`);
  // 先画所有字牌（拖拽中的源格隐藏）
  for (const w of b.words.values()) {
    if (ui.dragFrom && ui.dragFrom.c === w.cell.c && ui.dragFrom.r === w.cell.r) continue;
    const { x, y } = cellCenterPx(w.cell.c, w.cell.r);
    drawWordTile(ctx, w.char, w.tier, x, y, CELL * 0.78, !activeCells.has(`${w.cell.c},${w.cell.r}`));
  }
```

（其后「金框 + 名号·Lv + 经验条」循环保持不变。）

- [ ] **Step 3: 编译校验**

Run: `cd web && npm run typecheck`
Expected: 通过。

- [ ] **Step 4: 截图验证（合成英雄无单字上标，散字仍有）**

前置：dev server 已在 5180（`npm run dev`）。
Run: `cd web && node tools/wordpanel.mjs`
Expected: 无 `[pageerror]`；输出截图到 `web/shots/`。人工/后续 acceptance 看图：激活的「悟/空」两格右上角**无**阶数数字；未激活「八」仍有阶数上标。

- [ ] **Step 5: 提交**

```bash
git add web/src/render.ts
git commit -m "feat(web): 合成激活武将的单字隐藏阶数上标，仅保留金框整体等级"
```

---

## Task 5: render.ts — 单字介绍面板：标明未生效 + 修排版重叠（第4点）

**Files:**
- Modify: `web/src/render.ts:900-976`（`drawWordSelection` 信息面板）

背景：非激活面板 `ph=118`，第 3 条属性行在 `py+110`、底部状态行在 `py+106` → 重叠；且技能名/描述在单字态仍亮色，看不出不生效。

- [ ] **Step 1: 非激活时抬高面板并置灰技能**

把 `web/src/render.ts:913` 的面板高度改为：

```typescript
  const ph = active ? 150 : 134;
```

把技能名/描述绘制（`web/src/render.ts:934-939`）改为按激活态区分颜色，并在未激活时于技能名行尾加标注：

```typescript
  // 技能（未激活时置灰并标注不生效）
  ctx.textAlign = 'left';
  ctx.fillStyle = active ? '#9ad8ff' : 'rgba(154,216,255,0.4)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(`技能「${def.skillName}」`, px + 12, py + 40);
  if (!active) {
    ctx.fillStyle = 'rgba(255,154,106,0.85)';
    ctx.font = '10px "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('未激活·不生效', px + pw - 12, py + 40);
    ctx.textAlign = 'left';
    ctx.font = '12px "PingFang SC", sans-serif';
  }
  ctx.fillStyle = active ? 'rgba(255,240,210,0.7)' : 'rgba(255,240,210,0.32)';
  ctx.fillText(def.skillDesc, px + 12, py + 56);
```

- [ ] **Step 2: 底部状态行下移，消除与属性行重叠**

属性行区从 `ry = py + 78` 起、每行 +16。非激活 3 行末行在 `py+110`。把底部状态行（`web/src/render.ts:964-975`）的 y 由 `py + ph - 12` 显式改为面板底部留白，非激活时 `ph=134` → `py+122`，与末行 `py+110` 间距 12px：

```typescript
  // 底部状态提示（与属性行拉开 ≥12px：非激活 py+122 vs 末行 py+110）
  ctx.textAlign = 'left';
  if (active) {
    ctx.fillStyle = '#7ec46a';
    ctx.font = 'bold 12px "PingFang SC", sans-serif';
    ctx.fillText('✓ 已激活（金框生效）', px + 12, py + ph - 12);
  } else {
    const other = def.chars.find((c) => c !== w.char) ?? '';
    ctx.fillStyle = '#ff9a6a';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText(`未激活：需「${other}」左右紧邻`, px + 12, py + ph - 12);
  }
```

（`py + ph - 12`：激活 `ph=150→py+138`（末行 py+126，间距 12），非激活 `ph=134→py+122`（末行 py+110，间距 12）。均无重叠。）

- [ ] **Step 3: 编译校验**

Run: `cd web && npm run typecheck`
Expected: 通过。

- [ ] **Step 4: 截图验证（面板不重叠、单字标注不生效）**

Run: `cd web && node tools/wordpanel.mjs`
Expected: 无 `[pageerror]`；截图中未激活「八」面板：技能行灰、行尾「未激活·不生效」、底部「未激活：需「戒」左右紧邻」与属性行不重叠。

- [ ] **Step 5: 提交**

```bash
git add web/src/render.ts
git commit -m "fix(web): 单字介绍面板标注技能未生效并修底部与属性行重叠"
```

---

## Task 6: render.ts — drawHeroUlt 脚手架 + 调用 + 暴击飘字 + 共享工具

**Files:**
- Modify: `web/src/render.ts`（`drawBursts` 调用点 ~318 后加调用；`drawBursts` 函数 ~844 后加新函数）
- 需 import `HeroUltFx` 类型（若 render 已从 battle import 类型集合则并入）

- [ ] **Step 1: 在主渲染流程调用 drawHeroUlt**

在 `web/src/render.ts:318` `drawBursts(ctx, b);` 之后插入：

```typescript
  drawHeroUlt(ctx, b);
```

- [ ] **Step 2: 新增 drawHeroUlt 脚手架 + 暴击飘字 + 缓动工具**

在 `web/src/render.ts` `drawBursts` 函数结束（约 844 行 `}`）之后插入：

```typescript
// 缓动：ease-out（两端→中段），大招动画统一手感
function easeOut(p: number): number { return 1 - Math.pow(1 - p, 3); }

// 武将大招专属动画：switch(heroId) 分派，风格对齐 drawFx
function drawHeroUlt(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const f of b.heroUltFx) {
    const { x, y } = cellCenterPx(f.c, f.r);
    const prog = 1 - f.ttl / f.maxTtl; // 0→1
    const fade = 1 - prog;             // 1→0
    const R = f.rge * CELL;            // 群攻范围半径(px)
    ctx.save();
    switch (f.heroId) {
      // —— 暴击（哪吒/二郎）——
      case 'nezha': drawUltNezha(ctx, x, y, prog, fade, f.tier); break;
      case 'erlang': drawUltErlang(ctx, x, y, prog, fade, f.tier); break;
      // —— 群攻 ——
      case 'wukong': drawUltWukong(ctx, x, y, prog, fade, f.tier, R); break;
      case 'honghaier': drawUltHonghaier(ctx, x, y, prog, fade, f.tier, R); break;
      case 'bajie': drawUltBajie(ctx, x, y, prog, fade, f.tier, R); break;
      case 'tieshan': drawUltTieshan(ctx, x, y, prog, fade, f.tier, R); break;
      case 'shaseng': drawUltShaseng(ctx, x, y, prog, fade, f.tier, R); break;
      case 'niumowang': drawUltNiumowang(ctx, x, y, prog, fade, f.tier, R); break;
      case 'guanyin': drawUltGuanyin(ctx, x, y, prog, fade, f.tier, R); break;
      case 'baigujing': drawUltBaigujing(ctx, x, y, prog, fade, f.tier, R); break;
      case 'tangseng': drawUltTangseng(ctx, x, y, prog, fade, f.tier, R); break;
    }
    ctx.restore();
    // 暴击飘字：红字上飘 + 放大
    if (f.crit && f.critDmg != null) {
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#ff5a3c';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3;
      ctx.font = `bold ${Math.round(18 + prog * 10)}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ty = y - 18 - prog * 26;
      ctx.strokeText(`暴击! ${Math.round(f.critDmg)}`, x, ty);
      ctx.fillText(`暴击! ${Math.round(f.critDmg)}`, x, ty);
      ctx.restore();
    }
  }
}
```

- [ ] **Step 3: 先放 11 个动画函数的最小占位实现（编译先过，Task 7-11 逐个填充真实动画）**

为使本任务可独立编译，先在 `drawHeroUlt` 之后加入 11 个函数的**通用回退实现**（后续任务用真实动画替换各函数体，而非新增）：

```typescript
// 通用回退：扩散光环（Task 7-11 将逐个替换为专属动画）
function ultFallback(ctx: CanvasRenderingContext2D, x: number, y: number, prog: number, fade: number, color: string, maxR: number) {
  ctx.globalAlpha = fade;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, 8 + easeOut(prog) * maxR, 0, Math.PI * 2);
  ctx.stroke();
}
function drawUltNezha(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number) { ultFallback(ctx, x, y, p, fade, '#ff7a2c', CELL * (0.6 + tier * 0.1)); }
function drawUltErlang(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number) { ultFallback(ctx, x, y, p, fade, '#8ad8ff', CELL * (0.6 + tier * 0.1)); }
function drawUltWukong(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) { ultFallback(ctx, x, y, p, fade, '#f0b93c', R); }
function drawUltHonghaier(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) { ultFallback(ctx, x, y, p, fade, '#ff6a3c', R); }
function drawUltBajie(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) { ultFallback(ctx, x, y, p, fade, '#ffd34d', R); }
function drawUltTieshan(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) { ultFallback(ctx, x, y, p, fade, '#8ee6c0', R); }
function drawUltShaseng(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) { ultFallback(ctx, x, y, p, fade, '#9ad0ff', R); }
function drawUltNiumowang(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) { ultFallback(ctx, x, y, p, fade, '#c9a26a', R); }
function drawUltGuanyin(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) { ultFallback(ctx, x, y, p, fade, '#bfe6ff', R); }
function drawUltBaigujing(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) { ultFallback(ctx, x, y, p, fade, '#d8d2c4', R); }
function drawUltTangseng(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) { ultFallback(ctx, x, y, p, fade, '#ffe08a', R); }
```

- [ ] **Step 4: 编译校验**

Run: `cd web && npm run typecheck`
Expected: 通过（若 `HeroUltFx` 未导入报错，则在 render.ts 顶部 `import type { … } from './battle'` 集合里补 `HeroUltFx`）。

- [ ] **Step 5: 提交**

```bash
git add web/src/render.ts
git commit -m "feat(web): drawHeroUlt 脚手架 + 暴击飘字 + 11 英雄动画回退占位"
```

---

## Task 7: 大招动画 — 暴击英雄 哪吒 / 二郎

**Files:**
- Modify: `web/src/render.ts`（替换 `drawUltNezha`、`drawUltErlang` 函数体）

- [ ] **Step 1: 哪吒 火尖枪·万火齐发（多枪从上方倾泻聚点 + 烈焰爆点）**

替换 `drawUltNezha` 为：

```typescript
function drawUltNezha(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number) {
  const n = 5 + tier;                    // 火枪数量随阶
  const drop = easeOut(Math.min(1, p / 0.6)); // 前 60% 完成俯冲
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i - (n - 1) / 2) * 0.22; // 顶部扇形
    const startD = CELL * 2.4;
    const d = startD * (1 - drop);       // 从高空落到爆心
    const sx = x + Math.cos(ang) * d, sy = y + Math.sin(ang) * d - CELL * 0.4;
    ctx.globalAlpha = fade;
    ctx.strokeStyle = '#ffcf5a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - Math.cos(ang) * CELL * 0.5, sy - Math.sin(ang) * CELL * 0.5); ctx.stroke();
    ctx.fillStyle = '#ff7a2c';
    ctx.beginPath(); ctx.arc(sx, sy, 3 + tier * 0.5, 0, Math.PI * 2); ctx.fill();
  }
  // 落地烈焰爆点
  if (p > 0.5) {
    const bp = (p - 0.5) / 0.5;
    ctx.globalAlpha = (1 - bp) * fade * 1.2;
    const grad = ctx.createRadialGradient(x, y, 2, x, y, CELL * (0.4 + tier * 0.12) * (0.5 + bp));
    grad.addColorStop(0, 'rgba(255,240,180,0.9)');
    grad.addColorStop(0.6, 'rgba(255,120,44,0.5)');
    grad.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, CELL * (0.4 + tier * 0.12) * (0.5 + bp), 0, Math.PI * 2); ctx.fill();
  }
}
```

- [ ] **Step 2: 二郎 天眼诛邪（竖向贯穿光束 + 天眼环）**

替换 `drawUltErlang` 为：

```typescript
function drawUltErlang(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number) {
  const beamW = (6 + tier * 2) * (0.4 + easeOut(Math.min(1, p / 0.5)) * 0.6);
  const h = CELL * 2.6;
  // 竖向诛邪光束（自上而下贯穿爆心）
  ctx.globalAlpha = fade;
  const grad = ctx.createLinearGradient(x, y - h, x, y + CELL * 0.6);
  grad.addColorStop(0, 'rgba(180,235,255,0)');
  grad.addColorStop(0.7, 'rgba(150,216,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = grad;
  ctx.fillRect(x - beamW / 2, y - h, beamW, h + CELL * 0.6);
  // 天眼：睁开的竖椭圆 + 瞳
  const open = easeOut(Math.min(1, p / 0.4));
  ctx.globalAlpha = fade;
  ctx.strokeStyle = '#bfe9ff';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(x, y - CELL * 1.4, CELL * 0.32, CELL * 0.5 * open, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#3a6ea5';
  ctx.beginPath(); ctx.arc(x, y - CELL * 1.4, CELL * 0.12 * open, 0, Math.PI * 2); ctx.fill();
}
```

- [ ] **Step 3: 编译 + 截图验证**

Run: `cd web && npm run typecheck && node tools/heroult.mjs`
Expected: 通过、无 `[pageerror]`；`web/shots/heroult-nezha.png`、`heroult-erlang.png` 呈现火枪倾泻 / 竖向光束（heroult.mjs 见 Task 12）。

- [ ] **Step 4: 提交**

```bash
git add web/src/render.ts
git commit -m "feat(web): 大招动画——哪吒火尖枪倾泻、二郎天眼诛邪光束"
```

---

## Task 8: 大招动画 — 输出群攻 悟空 / 红孩

**Files:**
- Modify: `web/src/render.ts`（替换 `drawUltWukong`、`drawUltHonghaier`）

- [ ] **Step 1: 悟空 金箍棒大范围横扫金弧**

替换 `drawUltWukong` 为：

```typescript
function drawUltWukong(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const sweep = easeOut(p);
  const a0 = -Math.PI * 0.9, a1 = a0 + Math.PI * 1.8 * sweep; // 横扫近一圈
  const rad = R * 0.9;
  ctx.globalAlpha = fade;
  // 扫过的金色扇面
  const grad = ctx.createRadialGradient(x, y, rad * 0.2, x, y, rad);
  grad.addColorStop(0, 'rgba(255,243,196,0.05)');
  grad.addColorStop(1, 'rgba(240,185,60,0.35)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, rad, a0, a1); ctx.closePath(); ctx.fill();
  // 棒身（当前扫到的角度）
  ctx.strokeStyle = '#e8a11c'; ctx.lineWidth = 5 + tier;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a1) * rad, y + Math.sin(a1) * rad); ctx.stroke();
  ctx.strokeStyle = '#fff3c4'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a1) * rad, y + Math.sin(a1) * rad); ctx.stroke();
}
```

- [ ] **Step 2: 红孩 三昧真火扩散火花花瓣**

替换 `drawUltHonghaier` 为：

```typescript
function drawUltHonghaier(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const rad = easeOut(p) * R * 0.85;
  const petals = 8 + tier * 2;
  ctx.globalAlpha = fade;
  // 中心火球
  const grad = ctx.createRadialGradient(x, y, 2, x, y, rad);
  grad.addColorStop(0, 'rgba(255,240,180,0.9)');
  grad.addColorStop(0.5, 'rgba(255,120,44,0.45)');
  grad.addColorStop(1, 'rgba(255,60,20,0)');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  // 火花花瓣
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 + p * 0.8;
    const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
    ctx.fillStyle = '#ff8a3c';
    ctx.beginPath(); ctx.arc(px, py, 3 + tier * 0.6, 0, Math.PI * 2); ctx.fill();
  }
}
```

- [ ] **Step 3: 编译 + 截图验证**

Run: `cd web && npm run typecheck && node tools/heroult.mjs`
Expected: 通过、无 `[pageerror]`；`heroult-wukong.png`（金弧横扫）、`heroult-honghaier.png`（火花扩散）。

- [ ] **Step 4: 提交**

```bash
git add web/src/render.ts
git commit -m "feat(web): 大招动画——悟空金箍棒横扫、红孩三昧真火扩散"
```

---

## Task 9: 大招动画 — 控制群攻 八戒 / 铁扇

**Files:**
- Modify: `web/src/render.ts`（替换 `drawUltBajie`、`drawUltTieshan`）

- [ ] **Step 1: 八戒 钉耙震地·同心裂纹冲击波**

替换 `drawUltBajie` 为：

```typescript
function drawUltBajie(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  ctx.globalAlpha = fade;
  // 三道错相位冲击波环
  for (let k = 0; k < 3; k++) {
    const pk = Math.max(0, Math.min(1, p - k * 0.15));
    const rad = easeOut(pk) * R * 0.9;
    ctx.strokeStyle = k === 0 ? '#ffd34d' : 'rgba(255,211,77,0.55)';
    ctx.lineWidth = 5 - k * 1.2;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
  }
  // 放射裂纹
  const cracks = 6 + tier;
  ctx.strokeStyle = 'rgba(120,80,30,0.6)'; ctx.lineWidth = 2;
  for (let i = 0; i < cracks; i++) {
    const a = (i / cracks) * Math.PI * 2;
    const rr = easeOut(p) * R * 0.7;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); ctx.stroke();
  }
}
```

- [ ] **Step 2: 铁扇 芭蕉扇狂风·叶片旋涡**

替换 `drawUltTieshan` 为：

```typescript
function drawUltTieshan(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  ctx.globalAlpha = fade;
  const arms = 3;
  const leaves = 5 + tier;
  for (let arm = 0; arm < arms; arm++) {
    for (let i = 1; i <= leaves; i++) {
      const t = i / leaves;
      const rad = easeOut(p) * R * 0.9 * t;
      const a = arm * (Math.PI * 2 / arms) + p * 5 + t * 2.2; // 螺旋
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      ctx.save();
      ctx.translate(px, py); ctx.rotate(a);
      ctx.fillStyle = 'rgba(142,230,192,0.75)';
      ctx.beginPath(); ctx.ellipse(0, 0, 6 + tier, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
}
```

- [ ] **Step 3: 编译 + 截图验证**

Run: `cd web && npm run typecheck && node tools/heroult.mjs`
Expected: 通过、无 `[pageerror]`；`heroult-bajie.png`（冲击波+裂纹）、`heroult-tieshan.png`（叶片螺旋）。

- [ ] **Step 4: 提交**

```bash
git add web/src/render.ts
git commit -m "feat(web): 大招动画——八戒震地冲击波、铁扇芭蕉狂风旋涡"
```

---

## Task 10: 大招动画 — 击退群攻 沙僧 / 牛魔

**Files:**
- Modify: `web/src/render.ts`（替换 `drawUltShaseng`、`drawUltNiumowang`）

- [ ] **Step 1: 沙僧 宝杖横扫 + 击退拖影**

替换 `drawUltShaseng` 为：

```typescript
function drawUltShaseng(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  ctx.globalAlpha = fade;
  const rad = R * 0.9;
  const sweepA = -Math.PI * 0.5 + easeOut(p) * Math.PI; // 半圆横扫
  // 横扫弧
  ctx.strokeStyle = 'rgba(154,208,255,0.5)'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(x, y, rad, -Math.PI * 0.5, sweepA); ctx.stroke();
  // 宝杖
  ctx.strokeStyle = '#cfe6ff'; ctx.lineWidth = 4 + tier * 0.6;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(sweepA) * rad, y + Math.sin(sweepA) * rad); ctx.stroke();
  // 击退拖影线（沿扫向外推）
  for (let i = 0; i < 4 + tier; i++) {
    const a = -Math.PI * 0.5 + (i / (4 + tier)) * Math.PI;
    if (a > sweepA) continue;
    ctx.strokeStyle = 'rgba(200,230,255,0.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * rad * 0.7, y + Math.sin(a) * rad * 0.7);
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); ctx.stroke();
  }
}
```

- [ ] **Step 2: 牛魔 蛮牛冲撞·直线尘土拖尾**

替换 `drawUltNiumowang` 为：

```typescript
function drawUltNiumowang(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  ctx.globalAlpha = fade;
  const len = R * 1.1;
  const headD = easeOut(p) * len;        // 冲撞前锋推进
  const dirX = 0, dirY = -1;             // 向前(上半场方向)
  const hx = x + dirX * headD, hy = y + dirY * headD;
  // 冲撞主轴
  ctx.strokeStyle = 'rgba(201,162,106,0.8)'; ctx.lineWidth = 8 + tier;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx, hy); ctx.stroke();
  // 尘土团（沿轴散布）
  for (let i = 0; i < 8 + tier; i++) {
    const t = i / (8 + tier);
    const px = x + dirX * headD * t + (Math.random() - 0.5) * 6;
    const py = y + dirY * headD * t + (Math.random() - 0.5) * 6;
    ctx.fillStyle = `rgba(180,150,110,${0.5 * (1 - t)})`;
    ctx.beginPath(); ctx.arc(px, py, 4 + tier * 0.5, 0, Math.PI * 2); ctx.fill();
  }
  // 牛角前锋
  ctx.fillStyle = '#8a6a3a';
  ctx.beginPath(); ctx.arc(hx, hy, 5 + tier, 0, Math.PI * 2); ctx.fill();
}
```

- [ ] **Step 3: 编译 + 截图验证**

Run: `cd web && npm run typecheck && node tools/heroult.mjs`
Expected: 通过、无 `[pageerror]`；`heroult-shaseng.png`（半圆横扫）、`heroult-niumowang.png`（直线冲撞尘土）。

- [ ] **Step 4: 提交**

```bash
git add web/src/render.ts
git commit -m "feat(web): 大招动画——沙僧宝杖横扫击退、牛魔蛮牛冲撞尘土"
```

---

## Task 11: 大招动画 — 辅助/过渡 观音 / 白骨 / 御弟

**Files:**
- Modify: `web/src/render.ts`（替换 `drawUltGuanyin`、`drawUltBaigujing`、`drawUltTangseng`）

- [ ] **Step 1: 观音 净瓶甘露下落 + 回血金光**

替换 `drawUltGuanyin` 为：

```typescript
function drawUltGuanyin(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  ctx.globalAlpha = fade;
  // 甘露水滴自上而下
  const drops = 8 + tier * 2;
  for (let i = 0; i < drops; i++) {
    const a = (i / drops) * Math.PI * 2;
    const spread = R * 0.7 * (0.4 + (i % 3) * 0.2);
    const dx = x + Math.cos(a) * spread;
    const fall = ((p * 1.6 + i * 0.13) % 1);
    const dy = y - CELL * 1.2 + fall * CELL * 1.6;
    ctx.fillStyle = 'rgba(191,230,255,0.85)';
    ctx.beginPath(); ctx.ellipse(dx, dy, 2.5, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  // 净瓶光环
  ctx.strokeStyle = 'rgba(255,246,210,0.6)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(x, y, easeOut(p) * R * 0.6, 0, Math.PI * 2); ctx.stroke();
}
```

- [ ] **Step 2: 白骨 骨雾灰白扩散云**

替换 `drawUltBaigujing` 为：

```typescript
function drawUltBaigujing(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  ctx.globalAlpha = fade * 0.9;
  const rad = easeOut(p) * R * 0.8;
  // 灰白雾团（多团叠加）
  for (let i = 0; i < 6 + tier; i++) {
    const a = (i / (6 + tier)) * Math.PI * 2 + p;
    const rr = rad * (0.4 + (i % 3) * 0.25);
    const cx = x + Math.cos(a) * rr * 0.6, cy = y + Math.sin(a) * rr * 0.6;
    const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, rr * 0.6);
    grad.addColorStop(0, 'rgba(230,226,216,0.5)');
    grad.addColorStop(1, 'rgba(210,205,195,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, rr * 0.6, 0, Math.PI * 2); ctx.fill();
  }
}
```

- [ ] **Step 3: 御弟 诵经·金色经文字环逐层扩散**

替换 `drawUltTangseng` 为：

```typescript
function drawUltTangseng(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  ctx.globalAlpha = fade;
  const chars = '唵嘛呢叭咪吽';
  // 两层字环逐层扩散、缓慢旋转
  for (let ring = 0; ring < 2; ring++) {
    const pk = Math.max(0, Math.min(1, p - ring * 0.2));
    const rad = easeOut(pk) * R * (0.5 + ring * 0.35);
    const n = 6 + tier;
    ctx.fillStyle = ring === 0 ? '#ffe08a' : 'rgba(255,224,138,0.6)';
    ctx.font = `${Math.round(CELL * 0.28)}px "PingFang SC", serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + p * (ring ? -1.2 : 1.2);
      ctx.fillText(chars[i % chars.length]!, x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
  }
}
```

- [ ] **Step 4: 编译 + 截图验证**

Run: `cd web && npm run typecheck && node tools/heroult.mjs`
Expected: 通过、无 `[pageerror]`；`heroult-guanyin.png`（水滴+光环）、`heroult-baigujing.png`（灰雾）、`heroult-tangseng.png`（金色字环）。

- [ ] **Step 5: 提交**

```bash
git add web/src/render.ts
git commit -m "feat(web): 大招动画——观音甘露、白骨骨雾、御弟诵经字环"
```

---

## Task 12: 验证脚本 heroult.mjs + 全量自测

**Files:**
- Create: `web/tools/heroult.mjs`

- [ ] **Step 1: 新建 heroult.mjs（注入并冻结每英雄大招峰值帧，逐个截图）**

创建 `web/tools/heroult.mjs`（镜像 fxcheck.mjs 的「注入 FX + 冻结峰值 + 截图」模式，直接注入 heroUltFx）：

```javascript
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = []; page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.setCacheEnabled(false);
await page.goto('http://127.0.0.1:5180/?seed=7&t=' + Date.now(), { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

const heroes = ['nezha','erlang','wukong','honghaier','bajie','tieshan','shaseng','niumowang','guanyin','baigujing','tangseng'];
for (const id of heroes) {
  await page.evaluate((heroId) => {
    const g = window.__game; g.enterBattle();
    const b = g.battle;
    b.heroUltFx = [];
    const cx = 4, cy = 3; // 上半场爆心
    b.heroUltFx.push({ heroId, c: cx, r: cy, ttl: 0.36, maxTtl: 0.6, tier: 5, rge: 2.5, crit: heroId==='nezha'||heroId==='erlang', critDmg: 999 });
    g.step(0); // 触发一次渲染（peak≈prog 0.4）
  }, id);
  await new Promise((r) => setTimeout(r, 60));
  await page.screenshot({ path: path.join(OUT, `heroult-${id}.png`) });
}
console.log(logs.length ? logs.join('\n') : 'heroult OK: ' + heroes.length + ' shots');
await browser.close();
if (logs.length) process.exit(1);
```

（注：若 `g.step(0)` 不重绘，用 `g.render?.()` 或推进极小 dt `g.step(0.001)`；本仓库渲染由 rAF 驱动，`setTimeout(60ms)` 后截图即可捕获当前 heroUltFx 帧。）

- [ ] **Step 2: 运行 heroult.mjs**

前置：`cd web && npm run dev`（5180）。
Run: `cd web && node tools/heroult.mjs`
Expected: 输出 `heroult OK: 11 shots`，无 `[pageerror]`；`web/shots/heroult-*.png` 共 11 张，各具专属形态（非统一光环）。

- [ ] **Step 3: 全量类型 + 单测 + 关键回归脚本**

Run:
```bash
cd web && npm run typecheck && npm test && node tools/wordpanel.mjs && node tools/genshot.mjs && node tools/weaponcheck.mjs
```
Expected：typecheck 通过；vitest 全绿（含 hero-ult）；wordpanel（#1/#4）、genshot（武将实机）、weaponcheck（兵器出招/波间不卡槽）均无 `[pageerror]`。

- [ ] **Step 4: 数值复核（暴击倍率对后期曲线影响）**

Run: `cd web && node tools/sweep.mjs`（或仓库现用的 sweep*.mjs）
Expected：通关率/难度曲线无异常跳变；若哪吒/二郎因 CRIT_MULT 显著拉高通关，调 `CRIT_MULT`（generals.ts）后复跑。

- [ ] **Step 5: 提交**

```bash
git add web/tools/heroult.mjs
git commit -m "test(web): heroult.mjs——逐英雄大招动画峰值截图 + 全量自测脚本"
```

---

## Self-Review（写完计划后自查）

**Spec 覆盖：**
- 第1点 合成只显示整体等级 → Task 4 ✓
- 第2点 每英雄独立动画 → Task 6 脚手架 + Task 7-11 共 11 套 ✓
- 第3点 定期大招复用 skillCd + 群攻/暴击 → Task 1(派生) + Task 3(施放/暴击倍率) ✓
- 第4点 单字面板标注未生效 + 修重叠 → Task 5 ✓

**占位符扫描：** 无 TBD/TODO；每个改动步骤均含完整代码。CRIT_MULT 为已定值(1.5)并在 Task 12 有 sweep 复核，非占位。

**类型/命名一致：** `HeroUltFx`/`heroUltFx`/`drawHeroUlt` 三处一致；11 个 `drawUlt*` 函数名在 Task 6 声明、Task 7-11 原地替换函数体（不改名）；`ultTypeOf`/`CRIT_MULT` 在 Task 1 定义、Task 3 import 使用；与旧 `ultFlash`/`ultCenter` 命名隔离无冲突。

**范围：** 单一表现层+小幅数值特性，适合单计划顺序执行。
