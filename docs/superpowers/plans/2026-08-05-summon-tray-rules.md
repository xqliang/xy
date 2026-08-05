# 征兵候选区规则与交换修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 征兵时强制清空残留候选、每轮产出 5 槽（首次兵种 ≥4、同键 ≤3），并修好候选区拖到棋盘单位格的交换。

**Architecture:** 把「本轮候选抽取」抽成纯函数 `drawSummonTray`（便于单测），由 `Battle.summon` 在扣费后先 `tray = []` 再赋值；交换逻辑保持在 `placeFromTray`，拖拽落点改为「托盘拖拽时优先棋盘命中」。Web 包接入 Vitest，锁定行为。

**Tech Stack:** TypeScript、Vitest（`web/`）、现有 `Battle` / `RNG` / Canvas 指针逻辑。

**Spec:** `docs/superpowers/specs/2026-08-05-summon-tray-rules-design.md`

## Global Constraints

- 每轮候选数固定 **5**（`summonDraws` / `traySize`）
- 再征兵：扣费成功后、写入前 **强制清空** `tray`
- 首次成功征兵：兵种数 **≥ 4**（至多 1 铲子）
- 同键（`unit:<type>` / `shovel`）每轮 **≤ 3**
- 候选兵 → 异型已占格：**交换**（原单位回该槽）；同型同级：合并
- 不改征兵成本曲线；不引入武将信物池

---

## File Structure

```
web/
  package.json              # 增加 vitest + test script
  vitest.config.ts          # 新建：别名 @core → game-core
  src/
    summon-draw.ts          # 新建：纯函数 drawSummonTray
    battle.ts               # summon() 接入；summonCount；必要时微调 placeFromTray
    main.ts                 # pointerup 落点优先棋盘；__game.placeFromTray
    render.ts               # 核对 traySize=5；征兵按钮不因 tray 非空禁用
  tests/
    summon-draw.test.ts     # 抽取规则
    summon-place.test.ts    # 清空 + placeFromTray 交换/合并
```

---

### Task 1: `drawSummonTray` 纯函数 + 单测

**Files:**
- Create: `web/src/summon-draw.ts`
- Create: `web/tests/summon-draw.test.ts`
- Create: `web/vitest.config.ts`
- Modify: `web/package.json`

**Interfaces:**
- Consumes: `RNG`（`next()` / `pick()`）, `UnitType[]`, `TUNING` 中的 draws / shovelChance / maxPerKey
- Produces:
  - `export type SummonToken = { kind: 'unit'; type: UnitType; tier: 1 } | { kind: 'shovel' }`
  - `export function drawSummonTray(opts: { rng: RNG; unitTypes: readonly UnitType[]; draws: number; shovelChance: number; maxPerKey: number; firstSummon: boolean; }): SummonToken[]`

- [ ] **Step 1: 给 `web` 接入 Vitest**

`web/package.json` scripts 增加 `"test": "vitest run"`，devDependencies 增加 `"vitest": "^2.0.0"`。

创建 `web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, '../game-core/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

Run: `cd web && npm install`

- [ ] **Step 2: 写失败单测**

创建 `web/tests/summon-draw.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RNG } from '../src/rng';
import { drawSummonTray } from '../src/summon-draw';
import { UNITS } from '@core';
import type { UnitType } from '@core';

const types = Object.keys(UNITS) as UnitType[];

function keyOf(t: { kind: string; type?: string }) {
  return t.kind === 'shovel' ? 'shovel' : `unit:${t.type}`;
}

function counts(tokens: ReturnType<typeof drawSummonTray>) {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(keyOf(t), (m.get(keyOf(t)) ?? 0) + 1);
  return m;
}

describe('drawSummonTray', () => {
  it('always returns exactly draws tokens', () => {
    const tray = drawSummonTray({
      rng: new RNG(1),
      unitTypes: types,
      draws: 5,
      shovelChance: 0.16,
      maxPerKey: 3,
      firstSummon: false,
    });
    expect(tray).toHaveLength(5);
  });

  it('first summon has at least 4 units', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const tray = drawSummonTray({
        rng: new RNG(seed),
        unitTypes: types,
        draws: 5,
        shovelChance: 0.9, // 高压铲子
        maxPerKey: 3,
        firstSummon: true,
      });
      const units = tray.filter((t) => t.kind === 'unit').length;
      expect(units).toBeGreaterThanOrEqual(4);
      expect(tray.filter((t) => t.kind === 'shovel').length).toBeLessThanOrEqual(1);
    }
  });

  it('never exceeds maxPerKey for any key', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const tray = drawSummonTray({
        rng: new RNG(seed),
        unitTypes: types,
        draws: 5,
        shovelChance: 0.5,
        maxPerKey: 3,
        firstSummon: false,
      });
      for (const n of counts(tray).values()) expect(n).toBeLessThanOrEqual(3);
    }
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `cd web && npm test -- tests/summon-draw.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 `drawSummonTray`**

Create `web/src/summon-draw.ts`:

```ts
import type { UnitType } from '@core';
import type { RNG } from './rng';

export type SummonToken =
  | { kind: 'unit'; type: UnitType; tier: 1 }
  | { kind: 'shovel' };

export function drawSummonTray(opts: {
  rng: RNG;
  unitTypes: readonly UnitType[];
  draws: number;
  shovelChance: number;
  maxPerKey: number;
  firstSummon: boolean;
}): SummonToken[] {
  const { rng, unitTypes, draws, shovelChance, maxPerKey, firstSummon } = opts;
  const counts = new Map<string, number>();
  const out: SummonToken[] = [];
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  const under = (k: string) => (counts.get(k) ?? 0) < maxPerKey;

  for (let i = 0; i < draws; i++) {
    const slotsLeft = draws - i;
    const unitsSoFar = out.filter((t) => t.kind === 'unit').length;
    const shovelsSoFar = out.filter((t) => t.kind === 'shovel').length;
    // 首次：已有 1 铲，或再出铲会导致兵种 < 4 → 禁铲
    const needUnits = firstSummon ? Math.max(0, 4 - unitsSoFar) : 0;
    const allowShovel =
      under('shovel') &&
      (!firstSummon || (shovelsSoFar < 1 && slotsLeft - 1 >= needUnits && unitsSoFar + (slotsLeft - 1) >= 4));

    let pickShovel = allowShovel && rng.next() < shovelChance;
    if (firstSummon && slotsLeft <= needUnits) pickShovel = false;

    if (pickShovel) {
      out.push({ kind: 'shovel' });
      bump('shovel');
      continue;
    }

    const eligible = unitTypes.filter((t) => under(`unit:${t}`));
    const pool = eligible.length > 0 ? eligible : [...unitTypes]; // 理论上 4 种×3≥5，eligible 不应空
    const type = rng.pick(pool);
    out.push({ kind: 'unit', type, tier: 1 });
    bump(`unit:${type}`);
  }
  return out;
}
```

- [ ] **Step 5: Run test — expect PASS**

Run: `cd web && npm test -- tests/summon-draw.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.ts web/src/summon-draw.ts web/tests/summon-draw.test.ts
git commit -m "feat(web): add constrained summon tray draw helper"
```

---

### Task 2: `Battle.summon` 清空 + 接入抽取

**Files:**
- Modify: `web/src/battle.ts`
- Create: `web/tests/summon-place.test.ts`
- Modify: `web/src/render.ts`（仅核对征兵按钮 enable 条件）

**Interfaces:**
- Consumes: `drawSummonTray` from `./summon-draw`
- Produces: `Battle.summonCount: number`；`summon()` 成功后 `tray` 仅为本轮 5 个

- [ ] **Step 1: 写失败单测（清空 + 首次保底）**

Create `web/tests/summon-place.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Battle, TUNING } from '../src/battle';

describe('Battle.summon tray rules', () => {
  it('clears leftover tray tokens before writing the new hand', () => {
    const b = new Battle(42);
    b.grantPeach(1000);
    expect(b.summon()).toBe(true);
    const first = b.tray.map((t) => JSON.stringify(t));
    expect(b.tray).toHaveLength(TUNING.summonDraws);
    // 人为塞入「历史」token（模拟未清空时的叠留）
    b.tray.push({ kind: 'shovel' }, { kind: 'shovel' });
    expect(b.summon()).toBe(true);
    expect(b.tray).toHaveLength(TUNING.summonDraws);
    // 新手数不得大于 draws（证明没有 append 历史）
    expect(b.tray.length).toBe(5);
    // 内容应来自新抽取（允许与 first 相同种子巧合，但长度与无额外铲叠留即可）
    const shovels = b.tray.filter((t) => t.kind === 'shovel').length;
    expect(shovels).toBeLessThanOrEqual(3);
    void first;
  });

  it('first summon has >= 4 units', () => {
    const b = new Battle(7);
    b.grantPeach(100);
    b.summon();
    expect(b.tray.filter((t) => t.kind === 'unit').length).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL or weak pass**

Run: `cd web && npm test -- tests/summon-place.test.ts`
若当前 `tray = []` 已存在，清空用例可能已 PASS；首次保底在未改抽取前，对高铲子种子可能 FAIL。以 FAIL 驱动实现为准。

- [ ] **Step 3: 改 `Battle.summon`**

在 `web/src/battle.ts`：

1. `import { drawSummonTray } from './summon-draw';`
2. 类字段：`summonCount = 0;`
3. 替换 `summon()` 填充循环为：

```ts
summon(): boolean {
  if (this.status === 'won' || this.status === 'lost') return false;
  const cost = this.effectiveSummonCost();
  if (this.peach < cost) {
    this.message = '蟠桃不足，无法征兵';
    return false;
  }
  this.peach -= cost;
  this.summonCost += TUNING.summonCostStep;
  this.summonFlash = 1;
  this.tray = []; // 必须清空残留
  const types = Object.keys(UNITS) as UnitType[];
  this.tray = drawSummonTray({
    rng: this.rng,
    unitTypes: types,
    draws: TUNING.summonDraws,
    shovelChance: TUNING.shovelDrawChance,
    maxPerKey: 3,
    firstSummon: this.summonCount === 0,
  });
  this.summonCount += 1;
  this.message = '把候选区的兵拖到绿格，铲子拖到锁定格开挖';
  return true;
}
```

4. 删除过时注释「须先布阵…覆盖」中与行为不符的「须先布阵」表述，改为「每次征兵清空候选区后写入本轮 5 个」。

5. `TUNING` 可增加 `summonMaxPerKey: 3` 供召唤使用（可选；若不加则 summon 内写字面量 3，与 spec 一致）。

- [ ] **Step 4: 核对 `render.ts` 征兵按钮**

确认：

```ts
const canSummon = b.peach >= b.effectiveSummonCost();
```

（顺手修正现用 `summonCost`、未用 `effectiveSummonCost` 的不一致，避免桃够点不动。）**不要**加 `tray.length === 0` 条件。

- [ ] **Step 5: Run tests — expect PASS**

Run: `cd web && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/battle.ts web/src/render.ts web/tests/summon-place.test.ts
git commit -m "feat(web): clear tray and constrain summon draws"
```

---

### Task 3: `placeFromTray` 交换回归 + 拖拽落点优先棋盘

**Files:**
- Modify: `web/tests/summon-place.test.ts`
- Modify: `web/src/main.ts`
- Modify: `web/src/battle.ts`（仅当单测证明逻辑有 bug 时）

**Interfaces:**
- Consumes: `Battle.placeFromTray(index, to)`, `Battle.unlocked` / 初始解锁格
- Produces: `__game.placeFromTray(index, cell)` 供自动化；pointerup 托盘拖拽时棋盘优先于候选区命中

- [ ] **Step 1: 写 `placeFromTray` 交换/合并单测**

追加到 `web/tests/summon-place.test.ts`:

```ts
describe('Battle.placeFromTray', () => {
  it('swaps with a different unit on an unlocked cell', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.units.set(`${cell.c},${cell.r}`, {
      type: 'monkey', tier: 1, cell: { c: cell.c, r: cell.r },
      cooldown: 0, firePulse: 0, stunT: 0, slowT: 0, weakenT: 0,
    });
    b.tray = [{ kind: 'unit', type: 'spear', tier: 1 }];
    expect(b.placeFromTray(0, cell)).toBe(true);
    expect(b.units.get(`${cell.c},${cell.r}`)?.type).toBe('spear');
    expect(b.tray[0]).toEqual({ kind: 'unit', type: 'monkey', tier: 1 });
  });

  it('merges same type and tier', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.units.set(`${cell.c},${cell.r}`, {
      type: 'monkey', tier: 1, cell: { c: cell.c, r: cell.r },
      cooldown: 0, firePulse: 0, stunT: 0, slowT: 0, weakenT: 0,
    });
    b.tray = [{ kind: 'unit', type: 'monkey', tier: 1 }];
    expect(b.placeFromTray(0, cell)).toBe(true);
    expect(b.units.get(`${cell.c},${cell.r}`)?.tier).toBe(2);
    expect(b.tray).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect PASS（逻辑已存在）或 FAIL（则修 `placeFromTray`）**

Run: `cd web && npm test -- tests/summon-place.test.ts`

若 FAIL：按 spec 修复 `placeFromTray` 交换分支（异型写入棋盘、原单位写回 `tray[index]`，禁止 delete）。

- [ ] **Step 3: 修 `main.ts` pointerup 落点优先级**

托盘拖拽时**先**解析棋盘格；仅当未点在棋盘（或点在棋盘但 `placeFromTray` 因未解锁/铲子规则失败且目标在候选区）再处理候选合并。最小改动：

```ts
canvas.addEventListener('pointerup', () => {
  if (ui.dragPos) {
    const target = pxToCell(ui.dragPos.x, ui.dragPos.y);
    const trayTarget = trayIndexAt(ui.dragPos.x, ui.dragPos.y);
    if (ui.dragTrayIndex !== null) {
      // 托盘→棋盘优先，避免落点被候选区命中抢先导致「拖到武将格不交换」
      if (target) {
        battle.placeFromTray(ui.dragTrayIndex, target);
      } else if (trayTarget !== null && trayTarget !== ui.dragTrayIndex) {
        battle.mergeTrayTokens(ui.dragTrayIndex, trayTarget);
      }
    } else if (ui.dragFrom && target) {
      // ... 保持原选中 / dragUnit 逻辑
    }
  }
  ui.dragFrom = null;
  ui.dragTrayIndex = null;
  ui.dragPos = null;
});
```

注意：原先「拖到另一候选槽合并」在指针仍位于候选行时 `target` 为 null，仍走 `mergeTrayTokens`。拖到棋盘任意格（含单位格）走 `placeFromTray`。

- [ ] **Step 4: 暴露测试钩子**

在 `web/src/main.ts` 的 `GameHook` / `hook` 增加：

```ts
placeFromTray: (index: number, to: Cell) => boolean;
// ...
placeFromTray: (index, to) => battle.placeFromTray(index, to),
```

- [ ] **Step 5: Run all web tests + typecheck**

Run:
```bash
cd web && npm test && npm run typecheck
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/main.ts web/src/battle.ts web/tests/summon-place.test.ts
git commit -m "fix(web): prefer board drop for tray deploy swap"
```

---

### Task 4: 手工验收对照清单

**Files:** 无代码（或仅改 message 文案，可选）

- [ ] **Step 1: 本地启动**

Run: `cd web && npm run dev`  
浏览器打开提示的本地 URL。

- [ ] **Step 2: 按 spec 验收清单勾选**

1. 征兵留下部分候选 → 再征兵 → 候选区只有新的 5 个，无历史叠留  
2. 新开局首次征兵 → 兵种 ≥ 4  
3. 多抽几轮 → 肉眼/devtools `battle.tray` 无同键 >3  
4. 先放一个棍猴，候选拖枪兵到该格 → 交换，棍猴回候选槽  
5. 同型同级拖上去 → 合并升阶  

- [ ] **Step 3: Commit 仅在有文案/小修时**

若验收中有小修，单独 commit；否则本任务无 commit。

---

## Self-Review (plan vs spec)

| Spec 要求 | Task |
|-----------|------|
| 再征兵强制清空 | Task 2 |
| 每轮 5 槽 | Task 1–2（draws=5） |
| 首次兵种 ≥4 | Task 1–2 |
| 同键 ≤3 | Task 1 |
| 候选→棋盘交换 | Task 3 |
| 征兵不因 tray 非空禁用 | Task 2 render 核对 |
| 回归测试 | Task 1–3 |

无 TBD/占位步骤；命名统一为 `drawSummonTray` / `summonCount` / `placeFromTray`。
