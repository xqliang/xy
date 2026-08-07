# 武将字号 / 攻击升阶 / 字牌保底 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tray 字牌字号与地图一致；攻击攒满进度使双字品质阶各 +1（去掉战斗 Lv 加攻与 UI）；连续 10 次征兵无字则强制 1 个兵槽转字（不碰铲子等其它保底牌）；法宝符改为初始品质阶 +1。

**Architecture:** 在 `Battle` 内把原 `gainGeneralExp` 的满条回调从 `level++` 改为对激活双字 `tier++`；征兵流程在概率转字之后按 `summonsSinceWord` 做字牌保底替换；`render.ts` 统一字牌 `s` 并删经验条/Lv 行。法宝符用 `generalTierDelta` + 首次激活时突变字牌阶。

**Tech Stack:** TypeScript、Vitest、现有 `Battle` / `render.ts` / `passives.ts`

## Global Constraints

- Tray 字牌与地图字牌同用 `CELL * 0.78`；兵/铲 tray 尺寸不变
- 攻击升的是品质阶（徽标 / 字牌 `tier`），不是战斗 Lv；攻力不再吃 `+8%/level`
- 满阶字不涨；另一字未满仍可涨；徽标 = `min(左,右)`
- 字牌保底：`wordPityAfter = 10`；只替换一个 `kind === 'unit'` 槽；绝不替换铲子
- 首次征兵不转字、不触发字牌保底
- Spec: `docs/superpowers/specs/2026-08-06-general-tier-pity-tray-design.md`

## File map

| File | Responsibility |
|------|----------------|
| `web/src/battle.ts` | 升阶逻辑、字牌保底、法宝符 delta、去掉 ATK 的 level 系数 |
| `web/src/render.ts` | Tray 字号、去掉经验条与选中面板 Lv |
| `web/src/passives.ts` | 法宝符文案 |
| `web/tests/general-combat-tier.test.ts` | 新建：攻击升阶 / 满阶边界 / ATK 无 level |
| `web/tests/word-pity.test.ts` | 新建：字牌保底与不碰铲 |
| `web/tests/passive-inject.test.ts` | 法宝符断言改 `generalTierDelta` |

---

### Task 1: 字牌征兵保底（不碰其它保底牌）

**Files:**
- Modify: `web/src/battle.ts`（`TUNING`、`summonsSinceWord`、`summon()`）
- Test: `web/tests/word-pity.test.ts`（新建）

**Interfaces:**
- Produces: `TUNING.wordPityAfter: 10`
- Produces: `Battle` 私有字段 `summonsSinceWord`（与 `summonsSinceShovel` 同级）
- Consumes: 现有 `drawSummonTray`、`WORD_POOL`、`forceShovel` 流程

- [ ] **Step 1: 写失败测试**

创建 `web/tests/word-pity.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { Battle, TUNING } from '../src/battle';

describe('字牌征兵保底', () => {
  const origWord = TUNING.wordDrawChance;
  const origPity = TUNING.wordPityAfter;
  afterEach(() => {
    TUNING.wordDrawChance = origWord;
    TUNING.wordPityAfter = origPity;
  });

  it('连续 wordPityAfter 次无字后，下一次强制至少 1 字', () => {
    TUNING.wordDrawChance = 0;
    TUNING.wordPityAfter = 10;
    const b = new Battle(99);
    b.grantPeach(10_000);
    expect(b.summon()).toBe(true); // 首次：无字、不触发保底
    expect(b.tray.some((t) => t.kind === 'word')).toBe(false);
    for (let i = 0; i < 10; i++) {
      expect(b.summon()).toBe(true);
      expect(b.tray.some((t) => t.kind === 'word')).toBe(false);
    }
    expect(b.summon()).toBe(true);
    expect(b.tray.some((t) => t.kind === 'word')).toBe(true);
  });

  it('强制转字只改 unit 槽，不把 shovel 换成字', () => {
    TUNING.wordDrawChance = 0;
    TUNING.wordPityAfter = 1; // 第二次非首次即可强制（先召唤一次垫高计数）
    const b = new Battle(3);
    b.grantPeach(10_000);
    // 耗尽首次
    b.summon();
    // 人为：已连续无字达到保底阈值
    (b as unknown as { summonsSinceWord: number }).summonsSinceWord = 1;
    // 同时逼出铲子保底
    (b as unknown as { summonsSinceShovel: number }).summonsSinceShovel = TUNING.shovelPityAfter;
    expect(b.summon()).toBe(true);
    const words = b.tray.filter((t) => t.kind === 'word');
    const shovels = b.tray.filter((t) => t.kind === 'shovel');
    expect(words.length).toBeGreaterThanOrEqual(1);
    expect(shovels.length).toBeGreaterThanOrEqual(1);
    expect(b.tray).toHaveLength(TUNING.summonDraws);
  });
});
```

若 `summonsSinceWord` 为 private、测试无法写入：在 `Battle` 上增加仅测试用的包内可见写法——本仓库测试可访问 private 若编译配置允许；否则改为：

```ts
// battle.ts 增加（测试友好，无 UI）
forceWordPityForTest(): void { this.summonsSinceWord = TUNING.wordPityAfter; }
forceShovelPityForTest(): void { this.summonsSinceShovel = TUNING.shovelPityAfter; }
```

测试改用这两个方法，勿用 `as unknown` 强转（优先公开测试钩子）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npm test -- word-pity`

Expected: FAIL（`wordPityAfter` / 强制字不存在）

- [ ] **Step 3: 实现保底**

在 `TUNING` 增加：

```ts
wordPityAfter: 10, // 字牌保底：连续 N 次征兵没出字，则下次征兵强制把 1 个兵槽换成字
```

在 `Battle` 增加字段（与铲子保底并列）：

```ts
private summonsSinceWord = 0;
```

以及测试钩子（若 Step 1 采用）：

```ts
forceWordPityForTest(): void { this.summonsSinceWord = TUNING.wordPityAfter; }
forceShovelPityForTest(): void { this.summonsSinceShovel = TUNING.shovelPityAfter; }
```

改写 `summon()` 中转字与计数段（保留现有 `base` / `firstSummon` / `forceShovel`）：

```ts
const forceWord = !firstSummon && this.summonsSinceWord >= TUNING.wordPityAfter;
const draws: TrayToken[] = base.map((tok) => {
  if (tok.kind === 'unit' && !firstSummon && this.rng.next() < TUNING.wordDrawChance + this.mods.wordRateBonus) {
    const w = this.rng.pick(WORD_POOL);
    return { kind: 'word', char: w.char, general: w.general, tier: 1 };
  }
  return tok;
});
if (forceWord && !draws.some((t) => t.kind === 'word')) {
  const idx = draws.findIndex((t) => t.kind === 'unit');
  if (idx >= 0) {
    const w = this.rng.pick(WORD_POOL);
    draws[idx] = { kind: 'word', char: w.char, general: w.general, tier: 1 };
  }
}
this.tray = draws;
if (draws.some((t) => t.kind === 'word')) this.summonsSinceWord = 0;
else this.summonsSinceWord += 1;
```

铲子计数逻辑保持原样（仍基于 `base` 或最终 tray 中是否有铲——**保持现有对 `base` 的计数**，勿因字牌替换改铲子计数）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npm test -- word-pity`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/battle.ts web/tests/word-pity.test.ts
git commit -m "$(cat <<'EOF'
feat(web): 征兵字牌保底（连续10次无字强制转1兵槽）

EOF
)"
```

---

### Task 2: 攻击满条升品质阶 + 去掉战斗 Lv 加攻

**Files:**
- Modify: `web/src/battle.ts`（`GeneralState` 注释、`gainGeneralExp`、`generalAtk`、`stateOf` 初始 level）
- Test: `web/tests/general-combat-tier.test.ts`（新建）

**Interfaces:**
- Consumes: `activeGenerals()`、`MAX_TIER`、`wordAt` / `words` Map
- Produces: `Battle.addGeneralCombatExp(g: ActiveGeneral, amount: number): void`（原 private `gainGeneralExp` 公开或改名，供战斗与测试）
- Produces: 满条时双字 `tier++`（封顶）；`generalAtk` 无 level 系数

- [ ] **Step 1: 写失败测试**

创建 `web/tests/general-combat-tier.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { generalStat } from '../src/generals';

function placeErlang(b: Battle, leftTier: number, rightTier: number) {
  const cells = b.unlockedCells();
  const a = cells[0]!;
  const right = cells.find((c) => c.r === a.r && c.c === a.c + 1) ?? { c: a.c + 1, r: a.r };
  // 确保右格解锁
  b.unlocked.add(`${right.c},${right.r}`);
  b.words.set(`${a.c},${a.r}`, { char: '二', general: 'erlang', tier: leftTier, cell: { c: a.c, r: a.r } });
  b.words.set(`${right.c},${right.r}`, { char: '郎', general: 'erlang', tier: rightTier, cell: { c: right.c, r: right.r } });
  return { a, right };
}

describe('攻击升品质阶', () => {
  it('满经验后双字各 +1，徽标 min 上升；拆开保留', () => {
    const b = new Battle(1);
    const { a, right } = placeErlang(b, 2, 3);
    const g = b.activeGenerals()[0]!;
    expect(g.tier).toBe(2);
    const need = Battle.expToNext(g.state.level);
    b.addGeneralCombatExp(g, need);
    expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(3);
    expect(b.words.get(`${right.c},${right.r}`)?.tier).toBe(4);
    expect(b.activeGenerals()[0]!.tier).toBe(3);
  });

  it('一字已满阶时只升另一字', () => {
    const b = new Battle(1);
    const { a, right } = placeErlang(b, 5, 4);
    const g = b.activeGenerals()[0]!;
    b.addGeneralCombatExp(g, Battle.expToNext(g.state.level));
    expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(5);
    expect(b.words.get(`${right.c},${right.r}`)?.tier).toBe(5);
  });

  it('generalAtk 不再吃 level 系数', () => {
    const b = new Battle(1);
    placeErlang(b, 2, 2);
    const g = b.activeGenerals()[0]!;
    g.state.level = 10; // 即使残留 level 字段被抬高
    const expected = generalStat(g.def, g.tier).atk * b.mods.atkMul * b.bondAtkMul();
    // bondAtkMul 若为 private，改为只比「高 level 与 level=1 时 atk 相等」：
    g.state.level = 1;
    const atk1 = b.generalAtk(g);
    g.state.level = 10;
    const atk10 = b.generalAtk(g);
    expect(atk10).toBeCloseTo(atk1, 5);
    void expected;
  });
});
```

若右格未在初始解锁块：用 `b.unlocked.add` 或取两个相邻 `unlockedCells`。实现时以实测解锁布局为准，保证「二」「郎」左右相邻。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npm test -- general-combat-tier`

Expected: FAIL（`addGeneralCombatExp` 不存在或仍只升 level）

- [ ] **Step 3: 实现升阶并改 ATK**

1. 将 `private gainGeneralExp` 改为：

```ts
addGeneralCombatExp(g: ActiveGeneral, amount: number): void {
  const s = g.state;
  s.exp += amount;
  while (s.exp >= Battle.expToNext(s.level)) {
    const wa = this.wordAt(g.cells[0].c, g.cells[0].r);
    const wb = this.wordAt(g.cells[1].c, g.cells[1].r);
    if (!wa || !wb) break;
    const can = (wa.tier < MAX_TIER) || (wb.tier < MAX_TIER);
    if (!can) break;
    s.exp -= Battle.expToNext(s.level);
    if (wa.tier < MAX_TIER) wa.tier += 1;
    if (wb.tier < MAX_TIER) wb.tier += 1;
    s.level += 1; // 仅作下次阈值曲线，不参与攻力
    this.bursts.push({ kind: 'merge', c: g.cells[0].c, r: g.cells[0].r, ttl: 0.4, maxTtl: 0.4, big: false, color: '#ffe27a' });
    this.bursts.push({ kind: 'merge', c: g.cells[1].c, r: g.cells[1].r, ttl: 0.4, maxTtl: 0.4, big: false, color: '#ffe27a' });
    this.message = `${g.def.name} 升为 ${Math.min(wa.tier, wb.tier)} 阶`;
  }
}
```

2. `updateGenerals` / `castGeneralSkill` 内调用改为 `this.addGeneralCombatExp(...)`。

3. `generalAtk`：

```ts
generalAtk(g: ActiveGeneral): number {
  const base = generalStat(g.def, g.tier).atk;
  const wb = this.weaponBonuses[g.def.id];
  return base * (1 + (wb?.atk ?? 0)) * this.mods.atkMul * (this.atkBuffT > 0 ? this.atkBuffMul : 1) * this.bondAtkMul();
}
```

4. 更新 `GeneralState` 注释：`level`/`exp` 为升阶进度内部计数，不对玩家展示为战斗 Lv。

5. `stateOf` 初始：`level: 1, exp: 0`（不再读 `generalLevelDelta`；法宝符改在 Task 3）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npm test -- general-combat-tier`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/battle.ts web/tests/general-combat-tier.test.ts
git commit -m "$(cat <<'EOF'
feat(web): 攻击攒满进度升武将字牌品质阶，去掉 Lv 加攻

EOF
)"
```

---

### Task 3: 法宝符改为初始品质阶 +1

**Files:**
- Modify: `web/src/battle.ts`（`Modifiers`、`applyItem`、首次激活升阶）
- Modify: `web/src/passives.ts`（文案）
- Modify: `web/tests/passive-inject.test.ts`

**Interfaces:**
- Produces: `mods.generalTierDelta: number`（替换 `generalLevelDelta`）
- Produces: 首次激活某武将时两字各 +`generalTierDelta`（受 `MAX_TIER`），每武将 id 只应用一次

- [ ] **Step 1: 更新失败/改写测试**

`passive-inject.test.ts`：

```ts
it('法宝符：记录武将初始品质阶 +1（首次激活时应用）', () => {
  expect(make(['fabaofu']).mods.generalTierDelta).toBe(1);
  expect(make([]).mods.generalTierDelta).toBe(0);
});
```

在 `general-combat-tier.test.ts` 追加：

```ts
it('法宝符：首次激活两字各 +1 阶', () => {
  const b = new Battle(1, 1, undefined, undefined, undefined, [], ['fabaofu']);
  expect(b.mods.generalTierDelta).toBe(1);
  const { a, right } = placeErlang(b, 1, 1);
  b.activeGenerals(); // 触发首次激活升阶
  expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(2);
  expect(b.words.get(`${right.c},${right.r}`)?.tier).toBe(2);
  b.activeGenerals(); // 再次扫描不叠乘
  expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(2);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npm test -- passive-inject general-combat-tier`

Expected: FAIL on `generalTierDelta` / 首次激活未升阶

- [ ] **Step 3: 实现**

1. `Modifiers.generalLevelDelta` → `generalTierDelta`；默认 `0`；所有引用同步改名。

2. `applyItem`：`case 'fabaofu': this.mods.generalTierDelta += 1; break;`

3. `passives.ts`：`desc: '武将初始品质阶 +1'`

4. `Battle` 增加 `private tierBoosted = new Set<string>();`

5. 在 `activeGenerals()` 推出 `out.push(...)` **之前**：

```ts
if (this.mods.generalTierDelta > 0 && !this.tierBoosted.has(def.id)) {
  this.tierBoosted.add(def.id);
  for (let i = 0; i < this.mods.generalTierDelta; i++) {
    if (w.tier < MAX_TIER) w.tier += 1;
    if (right.tier < MAX_TIER) right.tier += 1;
  }
}
```

然后 `tier: Math.min(w.tier, right.tier)` 自然含加成。

- [ ] **Step 4: 跑相关测试**

Run: `cd web && npm test -- passive-inject general-combat-tier`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/battle.ts web/src/passives.ts web/tests/passive-inject.test.ts web/tests/general-combat-tier.test.ts
git commit -m "$(cat <<'EOF'
feat(web): 法宝符改为武将首次激活时品质阶 +1

EOF
)"
```

---

### Task 4: 渲染——Tray 字号对齐 + 去掉 Lv/经验条 UI

**Files:**
- Modify: `web/src/render.ts`（`drawTray` 字牌尺寸、`drawGenerals` 经验条、`drawWordSelection` Lv 行）

**Interfaces:**
- Consumes: `CELL`（已有）
- Produces: 字牌 tray 绘制 `s = CELL * 0.78`；无经验条；选中面板无「等级」行

- [ ] **Step 1: Tray 字牌改用地图尺寸**

在 `drawTray` 静止绘制处（约 `drawTrayToken(ctx, token, c.x, c.y, TRAY_H - 16)`）改为按 kind 分支：

```ts
const tokenSize = token.kind === 'word' ? CELL * 0.78 : TRAY_H - 16;
drawTrayToken(ctx, token, c.x, c.y, tokenSize);
```

检查拖拽 ghost / 丝带落点等其它 `drawTrayToken` / `drawWordTile` 调用：tray 上的字牌一律 `CELL * 0.78`；兵铲保持原尺寸。

- [ ] **Step 2: 去掉地图经验条**

`drawGenerals` 中删除：

```ts
const need = 10 * g.state.level;
const pct = ...
ctx.fillRect(...); // 经验条背景与填充
```

保留金框、名号、阶数徽标。

- [ ] **Step 3: 去掉选中面板等级行**

`drawWordSelection` 的 `rows` 激活分支删除 `['等级', \`Lv.${active.state.level}\`]`。可将「品质阶」展示为 `['品质阶', String(active.tier)]`（可选，推荐加上与徽标一致）。

- [ ] **Step 4: typecheck**

Run: `cd web && npm run typecheck`

Expected: 无错误（无残留 `generalLevelDelta`）

- [ ] **Step 5: 全量测试**

Run: `cd web && npm test`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/render.ts
git commit -m "$(cat <<'EOF'
fix(web): tray 字牌字号对齐地图，去掉武将 Lv/经验条 UI

EOF
)"
```

---

### Task 5: 回归与验收扫尾

**Files:**
- 可能小改：`web/tests/summon-place.test.ts`（若受保底影响）
- 文档：无强制改 spec（已定稿）

- [ ] **Step 1: 全量 web 测试 + typecheck**

```bash
cd web && npm test && npm run typecheck
```

Expected: 全绿

- [ ] **Step 2: 手工核对清单（对照 spec 验收）**

- Tray 与地图字牌单字同 `CELL * 0.78`
- 二 2 + 郎 3 攻击满条 → 3 + 4，徽标 3；拆开保留
- 无经验条 / 无 Lv 面板行；高 `state.level` 不抬 ATK
- 连续 10 次无字后强制 1 字，且可与铲子保底同盘共存
- 法宝符文案与首次激活 +1 阶

- [ ] **Step 3: 若有测试修修补补则再 commit**

```bash
git add -A && git status
# 仅在有改动时：
git commit -m "$(cat <<'EOF'
test(web): 字牌保底与攻击升阶回归扫尾

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec 项 | Task |
|---------|------|
| Tray `CELL * 0.78` | Task 4 |
| 攻击满条双字 +1 阶 / 满阶边界 / 拆开保留 | Task 2 |
| 去掉 Lv 加攻、经验条、面板 Lv | Task 2 + 4 |
| 字牌保底 10、只换 unit、不碰铲 | Task 1 |
| 法宝符初始品质阶 +1 | Task 3 |
| 首次征兵不转字 | Task 1（保留现逻辑） |

无 TBD/TODO 占位；`addGeneralCombatExp` / `generalTierDelta` / `wordPityAfter` 命名前后一致。
