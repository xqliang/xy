# 黄狮精小 Boss「卷走」技能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增第 6 种小 Boss「黄狮精」，出场后在随机 1–20s 内**只触发一次**「卷走」，把身边 3 格范围内随机一件兵器 / 英雄字块 / 桃树永久卷走（变空格、消失特效、底部提示），并配上立绘。

**Architecture:** 在现有小 Boss 框架（`castMiniBossSkill` 循环调度）上加一个一次性开关 `miniBossCasted`，新增 `lion` 种类； lion 分支在半径内收集三类目标随机取 1 个永久 `delete`，复用 `Burst`(kind:`death`) 做金色消失粒子、复用 `this.message` 做底部提示。立绘走现成 `monster-miniboss-{kind}` 管线（绿幕 → 软抠 → resize → 注册 → 上传）。

**Tech Stack:** TypeScript、Vite、vitest（`web/` 下 `tests/**`）、Canvas 2D（render.ts）、Seedream（`web/tools/seeddream/`）、TOS CDN。

**Spec:** `docs/superpowers/specs/2026-08-22-huangshijing-steal-design.md`

---

## 前置：进入 worktree

实现必须在隔离 worktree 里做（用户明确要求，且 main 前进快）。

- [ ] **Step 0: 从当前 main 新建 worktree 并切入**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy
git worktree add .claude/worktrees/huangshijing-steal -b feat/huangshijing-steal
cd .claude/worktrees/huangshijing-steal
```

后续所有命令默认在此 worktree 内执行。注意：若 main 在你开工期间前进，收尾前要 `git rebase origin/main` 解冲突再 ff 合并（见 memory `parallel-worktrees-rebase-before-finish`）。

---

## 文件结构

**修改：**
- `web/src/battle.ts` — `MiniBossKind`/`MINI_BOSS_KINDS`/`MINI_BOSS_META` 加 lion；`Monster` 加 `miniBossCasted`；`TUNING` 加 3 个 steal 调参；`spawnMonster` 给 lion 随机 `skillCd`；`updateMonsterSkills` 加一次性守卫；`castMiniBossSkill` 加 `case 'lion'`。
- `web/src/devtools/bags.ts` — `TUNING_MONSTER_ELITE_KEYS` 加 3 个 steal 键。
- `web/src/devtools/labels.ts` — `PARAM_ZH` 加 3 个 steal 键中文标签。
- `web/src/asset-manifest.names.ts` — `ASSET_FILENAMES` + `AssetKey` 加 `monster-miniboss-lion`。
- `web/tools/seeddream/resize-portraits.mjs` — `TARGET` 加 `monster-miniboss-lion`。

**新建：**
- `web/tools/seeddream/gen-lion.mjs` — 生成黄狮精绿幕立绘。
- `web/src/game-assets/monster-miniboss-lion.png` — 成品透明立绘（生成产出）。
- `web/tests/lion-steal.test.ts` — 单测。

---

## Task 1: 登记 lion 种类与 meta（含单测守卫）

**Files:**
- Modify: `web/src/battle.ts:368-380`（`MiniBossKind` / `MINI_BOSS_KINDS` / `MINI_BOSS_META`）
- Test: `web/tests/lion-steal.test.ts`（新建）

- [ ] **Step 1: 写失败测试——lion 已是合法小 Boss 种类**

新建 `web/tests/lion-steal.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { MINI_BOSS_KINDS, MINI_BOSS_META, TUNING } from '../src/battle';

describe('黄狮精 lion 小 Boss 登记', () => {
  it('lion 在合法种类列表与 meta 中', () => {
    expect(MINI_BOSS_KINDS).toContain('lion');
    const meta = MINI_BOSS_META.lion;
    expect(meta.name).toBe('黄狮精');
    expect(meta.skillName).toBe('卷走');
    expect(meta.color).toBeTruthy();
    expect(meta.icon).toBeTruthy();
    expect(meta.desc).toContain('卷走');
  });

  it('steal 调参存在且范围合法', () => {
    expect(TUNING.miniBossStealRadius).toBe(3);
    expect(TUNING.miniBossStealDelayMin).toBeGreaterThanOrEqual(1);
    expect(TUNING.miniBossStealDelayMax).toBeGreaterThan(TUNING.miniBossStealDelayMin);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/lion-steal.test.ts`
Expected: FAIL —— `MINI_BOSS_META.lion` 为 undefined / `TUNING.miniBossStealRadius` 为 undefined。

- [ ] **Step 3: 实现——加 lion 种类与调参**

在 `web/src/battle.ts`：

(a) `MiniBossKind` 联合类型（约 369 行）改为：
```ts
export type MiniBossKind = 'frost' | 'blight' | 'quake' | 'gale' | 'blood' | 'lion';
```

(b) `MINI_BOSS_KINDS`（约 370 行）改为：
```ts
export const MINI_BOSS_KINDS: MiniBossKind[] = ['frost', 'blight', 'quake', 'gale', 'blood', 'lion'];
```

(c) `MINI_BOSS_META`（约 371 行对象内）追加 lion：
```ts
  lion: { name: '黄狮精', skillName: '卷走', color: '#e8c24a', icon: '偷', desc: '随机卷走3格内一件兵器/英雄/桃树' },
```

(d) `TUNING` 小 Boss 区块（约 202-204 行 `miniBossRadius`/`miniBossInterval`/`miniBossFirstDelay` 之后）追加：
```ts
  miniBossStealRadius: 3, // 黄狮精「卷走」作用半径（格）
  miniBossStealDelayMin: 1, // 出场后首次触发最短延时（秒）
  miniBossStealDelayMax: 20, // 出场后首次触发最长延时（秒）
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/lion-steal.test.ts`
Expected: PASS（两个 it 都过）。

- [ ] **Step 5: 提交**

```bash
git add web/src/battle.ts web/tests/lion-steal.test.ts
git commit -m "feat(miniboss): 登记黄狮精 lion 种类、meta 与 steal 调参"
```

---

## Task 2: DevTools 接入（调参可改）

**Files:**
- Modify: `web/src/devtools/bags.ts:118-128`（`TUNING_MONSTER_ELITE_KEYS`）
- Modify: `web/src/devtools/labels.ts:148-150`（`PARAM_ZH`）

- [ ] **Step 1: 在 key 集合里登记 3 个 steal 键**

`web/src/devtools/bags.ts` 的 `TUNING_MONSTER_ELITE_KEYS`（约 126 行 `'miniBossRadius', 'miniBossInterval', 'miniBossFirstDelay',` 之后）追加：
```ts
  'miniBossStealRadius', 'miniBossStealDelayMin', 'miniBossStealDelayMax',
```

- [ ] **Step 2: 在中文标签里登记**

`web/src/devtools/labels.ts` 的 `PARAM_ZH`（约 150 行 `miniBossFirstDelay: '小 Boss 首次施法延迟',` 之后）追加：
```ts
  miniBossStealRadius: '黄狮精卷走半径',
  miniBossStealDelayMin: '黄狮精首次触发最短延时',
  miniBossStealDelayMax: '黄狮精首次触发最长延时',
```

- [ ] **Step 3: 验证 devtools 单测不回归**

Run: `cd web && npx vitest run tests/devtools.test.ts`
Expected: PASS（resetBag 仍能还原新键；若该测试遍历 TUNING_MONSTER_KEYS 也覆盖新键）。

- [ ] **Step 4: 提交**

```bash
git add web/src/devtools/bags.ts web/src/devtools/labels.ts
git commit -m "feat(devtools): 登记黄狮精 steal 半径/延时调参"
```

---

## Task 3: Monster 一次性开关 + 出场随机延时 + 施法守卫

**Files:**
- Modify: `web/src/battle.ts` —— `Monster` 接口（约 653-674）、`spawnMonster` 的 `makeOne` 与 `skillCd`（约 5145-5176）、`updateMonsterSkills`（约 6054-6067）
- Test: `web/tests/lion-steal.test.ts`

- [ ] **Step 1: 写失败测试——lion 出场延时在 1–20s，且只触发一次**

在 `web/tests/lion-steal.test.ts` 追加 import 与两个测试（文件顶部 import 行补 `Battle, makePlacedUnit, type Monster` 与 `MAPS, type GameMap`）：

```ts
import { describe, it, expect } from 'vitest';
import { Battle, TUNING, MINI_BOSS_KINDS, MINI_BOSS_META, makePlacedUnit, type Monster } from '../src/battle';
import { MAPS, type GameMap } from '../src/board';

// 造一只静止在路径某格的黄狮精（skillCd 可控，便于确定性推进）
function lionOnPath(map: GameMap, pathCell: { c: number; r: number }, skillCd: number): { b: Battle; lion: Monster } {
  const b = new Battle(1, 1, map);
  // 路径 progress：累加到 pathCell 所在段
  let dist = 0;
  for (let i = 1; i < map.path.length; i++) {
    const a = map.path[i - 1]!, c = map.path[i]!;
    if (a.c === pathCell.c && a.r === pathCell.r) break;
    dist += Math.hypot(c.c - a.c, c.r - a.r);
    if (c.c === pathCell.c && c.r === pathCell.r) break;
  }
  const lion: Monster = {
    id: 999, dist, hp: 500, maxHp: 500, spd: 0,
    isBoss: false, isMiniBoss: true, miniBossKind: 'lion', isCavalry: false,
    hitFlash: 0, skill: null, skillCd, castFlash: 0, spawnT: 1,
    stunT: 0, slowT: 0, hasteT: 0, healFlash: 0, burnT: 0, burnDps: 0,
    miniBossCasted: false,
  };
  b.monsters.push(lion);
  (b as unknown as { tangsengHP: number }).tangsengHP = 99; // 防漏怪判负
  return { b, lion };
}
```

追加测试：
```ts
describe('黄狮精 一次性触发', () => {
  it('只触发一次：偷到后 miniBossCasted=true，后续再不偷', () => {
    const map = MAPS[0]!;
    // 半径内唯一候选：1 把兵器（在 3,5，距路径格 4,6 的 hypot=√2≈1.41 ≤3）
    const target = { c: 3, r: 5 };
    const { b, lion } = lionOnPath(map, { c: 4, r: 6 }, 0);
    b.units.set(`${target.c},${target.r}`, makePlacedUnit('dao', 1, target));
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05); // 触发第一次卷走
    expect(lion.miniBossCasted).toBe(true);
    expect(b.units.has(`${target.c},${target.r}`)).toBe(false); // 已被卷走
    const castsAfter = lion.miniBossCasted;
    b.step(30); // 再推进很久
    expect(lion.miniBossCasted).toBe(castsAfter); // 不再施法
  });

  it('半径内无目标时不消耗机会、会重试', () => {
    const map = MAPS[0]!;
    const { b, lion } = lionOnPath(map, { c: 4, r: 6 }, 0);
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    expect(lion.miniBossCasted).toBe(false); // 没偷到、未置位
    expect(lion.skillCd).toBeGreaterThan(0); // 被重置为 miniBossInterval 等下轮
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/lion-steal.test.ts`
Expected: FAIL —— `miniBossCasted` 属性不存在 / lion 无施法逻辑。

- [ ] **Step 3: 实现——加字段、出场延时、守卫**

(a) `Monster` 接口（约 673 行 `burnDps: number;` 之后）加：
```ts
  miniBossCasted: boolean; // 黄狮精「卷走」一次性开关：偷到一次后置 true，本局不再施法
```

(b) `spawnMonster` 的 `makeOne`（约 5176 行 `burnDps: 0,` 之后）加：
```ts
      miniBossCasted: false,
```

(c) `spawnMonster` 的 `skillCd` 计算（约 5137 行）改为给 lion 随机延时：
```ts
    const skillCd = isMiniBoss
      ? (miniKind === 'lion'
        ? TUNING.miniBossStealDelayMin + this.rng.next() * (TUNING.miniBossStealDelayMax - TUNING.miniBossStealDelayMin)
        : TUNING.miniBossFirstDelay)
      : TUNING.skillFirstDelay;
```

(d) `updateMonsterSkills` 小 Boss 分支（约 6058 行）加一次性守卫：
```ts
      if (m.isMiniBoss && m.miniBossKind) {
        if (m.miniBossCasted) continue; // 黄狮精：卷走只触发一次，偷到后本局跳过
        m.skillCd -= dt;
        if (m.skillCd > 0) continue;
        m.skillCd = TUNING.miniBossInterval;
        this.castMiniBossSkill(m);
        continue;
      }
```

- [ ] **Step 4: 跑测试确认「守卫/重试」部分过、「偷到」部分仍待 Task 4**

Run: `cd web && npx vitest run tests/lion-steal.test.ts`
Expected：「无目标重试」测试 PASS；「只触发一次」里 `miniBossCasted` 断言**仍 FAIL**（因为 Task 4 才实现 lion 施法效果）。这是预期的，下一步接上。

- [ ] **Step 5: 提交**

```bash
git add web/src/battle.ts web/tests/lion-steal.test.ts
git commit -m "feat(miniboss): 黄狮精一次性开关 + 出场随机延时 + 施法守卫"
```

---

## Task 4: 「卷走」核心——半径内随机永久移除一件

**Files:**
- Modify: `web/src/battle.ts` —— `castMiniBossSkill`（约 6112 行 `switch (kind)` 内，`case 'blood':` 之后、`default:` 之前）
- Test: `web/tests/lion-steal.test.ts`

> `battle.ts` 已 import `UNITS`（`recallToTray` 等处用过），无需新增 import。

- [ ] **Step 1: 写失败测试——三类目标各能被卷走、且永删不入 tray、配对只拆一字**

在 `web/tests/lion-steal.test.ts` 追加：

```ts
describe('黄狮精 卷走目标', () => {
  it('卷走兵器：永久删除、不入 tray、不给蟠桃', () => {
    const map = MAPS[0]!;
    const target = { c: 3, r: 5 };
    const { b } = lionOnPath(map, { c: 4, r: 6 }, 0);
    b.units.set(`${target.c},${target.r}`, makePlacedUnit('dao', 1, target));
    const peachBefore = b.peach;
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    expect(b.units.has(`${target.c},${target.r}`)).toBe(false);
    // tray 无任何令牌（兵器没有退回候选区）
    expect(b.tray.every((s) => s === null)).toBe(true);
    expect(b.peach).toBe(peachBefore); // 无蟠桃奖励
  });

  it('卷走英雄字块：孤儿字直接删除', () => {
    const map = MAPS[0]!;
    const wcell = { c: 2, r: 5 }; // 距路径格 3,6 的 hypot=√2≤3，且右侧 3,5 无字 → 孤儿
    const { b } = lionOnPath(map, { c: 3, r: 6 }, 0);
    b.words.set(`${wcell.c},${wcell.r}`, { char: '大', general: 'dasheng', tier: 1, cell: wcell });
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    expect(b.words.has(`${wcell.c},${wcell.r}`)).toBe(false);
  });

  it('配对英雄只拆一字：成对时随机拆一字，另一字保留、配对解散', () => {
    const map = MAPS[0]!;
    // '大'=2,5 与 '圣'=3,5 左右紧邻成「大圣」对，两点距狮子(4,6)分别为 √5≈2.24、√2≈1.41，都在半径 3 内
    const aChar = { c: 2, r: 5 }; // '大'
    const bChar = { c: 3, r: 5 }; // '圣'（aChar 右侧，构成「大圣」对）
    const { b } = lionOnPath(map, { c: 4, r: 6 }, 0);
    b.words.set(`${aChar.c},${aChar.r}`, { char: '大', general: 'dasheng', tier: 1, cell: aChar });
    b.words.set(`${bChar.c},${bChar.r}`, { char: '圣', general: 'dasheng', tier: 1, cell: bChar });
    expect(b.activeGenerals().length).toBe(1); // 开局成对
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    // 2 字都在半径内 → 随机取 1 字删除；结果与随机到哪个字无关：恰剩 1 字、配对必解散
    expect(b.words.size).toBe(1);
    expect(b.activeGenerals().length).toBe(0);
  });

  it('卷走桃树：永久删除', () => {
    const map = MAPS[0]!;
    const tcell = { c: 3, r: 5 };
    const { b } = lionOnPath(map, { c: 4, r: 6 }, 0);
    b.trees.set(`${tcell.c},${tcell.r}`, { level: 3, cell: tcell, growT: 0 });
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    expect(b.trees.has(`${tcell.c},${tcell.r}`)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/lion-steal.test.ts`
Expected: FAIL —— lion 无施法效果，目标仍在、`activeGenerals` 未解散。

- [ ] **Step 3: 实现——lion 分支：收集三类候选、随机取 1、永久删除**

在 `web/src/battle.ts` 的 `castMiniBossSkill` 的 `switch (kind)` 内，`case 'blood': { ... break; }` 之后、`default:` 之前插入：

```ts
      case 'lion': {
        // 黄狮精「卷走」：半径内随机取 1 件（兵器/英雄字块/桃树），永久删除。
        // 配对英雄只拆一格——words.delete 只删这一格，activeGenerals 下帧自动解散该对、
        // pruneHeroStates 清掉对应武将状态。无目标时不置位，由调用方按 miniBossInterval 重试。
        const R = TUNING.miniBossStealRadius;
        type Cand = { kind: 'unit' | 'word' | 'tree'; key: string; c: number; r: number; name: string };
        const cands: Cand[] = [];
        for (const u of this.units.values()) {
          if (Math.hypot(mp.c - u.cell.c, mp.r - u.cell.r) <= R) {
            cands.push({ kind: 'unit', key: cellKey(u.cell.c, u.cell.r), c: u.cell.c, r: u.cell.r, name: UNITS[u.type].name });
          }
        }
        for (const w of this.words.values()) {
          if (Math.hypot(mp.c - w.cell.c, mp.r - w.cell.r) <= R) {
            cands.push({ kind: 'word', key: cellKey(w.cell.c, w.cell.r), c: w.cell.c, r: w.cell.r, name: w.char });
          }
        }
        for (const t of this.trees.values()) {
          if (Math.hypot(mp.c - t.cell.c, mp.r - t.cell.r) <= R) {
            cands.push({ kind: 'tree', key: cellKey(t.cell.c, t.cell.r), c: t.cell.c, r: t.cell.r, name: '蟠桃树' });
          }
        }
        if (cands.length === 0) break; // 半径内无目标：不消耗机会，skillCd 已被上层置为 miniBossInterval，下轮重试
        const pick = cands[this.rng.int(cands.length)]!;
        if (pick.kind === 'unit') this.units.delete(pick.key);
        else if (pick.kind === 'word') this.words.delete(pick.key);
        else this.trees.delete(pick.key);
        this.clearAutoPlaceLayoutMemory(); // 与 recallToTray 一致：移除后清自动布阵记忆，避免 AI 引用失效格
        affected = 1;
        m.miniBossCasted = true; // 偷到一次，本局不再触发
        break;
      }
```

> Task 5 会在这个 lion 分支内补上金色 death 粒子与底部提示（用 `pick.name`），所以这里**不要**加任何 `stolenName` 字段。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/lion-steal.test.ts`
Expected: PASS —— 兵器/字/桃树都被删；配对只拆一字且解散；无 tray、无蟠桃。

- [ ] **Step 5: 提交**

```bash
git add web/src/battle.ts web/tests/lion-steal.test.ts
git commit -m "feat(miniboss): 黄狮精「卷走」半径内随机永久移除一件"
```

---

## Task 5: 消失特效 + 底部提示信息

**Files:**
- Modify: `web/src/battle.ts` —— `castMiniBossSkill` 的 lion 分支与尾部 `if (affected > 0)` 块
- Test: `web/tests/lion-steal.test.ts`

- [ ] **Step 1: 写失败测试——金色消失粒子 + 具体提示信息**

在 `web/tests/lion-steal.test.ts` 追加：

```ts
describe('黄狮精 特效与提示', () => {
  it('偷到后弹出金色 death 粒子 + 底部提示带目标名', () => {
    const map = MAPS[0]!;
    const target = { c: 3, r: 5 };
    const { b, lion } = lionOnPath(map, { c: 4, r: 6 }, 0);
    b.units.set(`${target.c},${target.r}`, makePlacedUnit('dao', 1, target));
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    // 被偷格有金色 death 粒子
    const burst = b.bursts.find((x) => x.c === target.c && x.r === target.r && x.kind === 'death');
    expect(burst).toBeTruthy();
    expect(burst!.color).toBe(MINI_BOSS_META.lion.color);
    // 底部提示包含怪物名 + 技能名/目标名
    expect(b.message).toContain('黄狮精');
    expect(b.message).toContain('刀兵');
    expect(lion.castFlash).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/lion-steal.test.ts`
Expected: FAIL —— 没有金色 death burst / message 是通用「施展」文案或不含目标名。

- [ ] **Step 3: 实现——lion 分支内联金色 death 粒子 + 具体 message**

把 Task 4 Step 3 里 lion 分支的 `m.miniBossCasted = true;` 之后、`break;` 之前，**补入**特效与提示：

```ts
        m.miniBossCasted = true; // 偷到一次，本局不再触发
        m.castFlash = 1; // 施法闪光（与其它小 Boss 一致，供渲染）
        // 消失特效：在被偷格子爆开金色 death 粒子环（复用 drawBursts，无需新增 SkillFxKind）
        this.bursts.push({ kind: 'death', c: pick.c, r: pick.r, ttl: 0.45, maxTtl: 0.45, big: true, color: meta.color });
        // 底部提示：点明被卷走的具体目标
        this.message = `⚠ ${meta.name}卷走了「${pick.name}」！`;
        break;
```

然后改尾部通用块（约 6165 行 `if (affected > 0) { ... }`），让 lion 不再走通用文案（lion 已在上方自己设了 message 与粒子）：

```ts
    if (affected > 0) {
      m.castFlash = 1;
      // lion 已在分支内自设 message 与金色 death 粒子，这里只处理其它小 Boss 的通用光环提示
      if (kind !== 'lion') {
        this.bursts.push({ kind: 'hit', c: mp.c, r: mp.r, ttl: 0.45, maxTtl: 0.45, big: true, color: meta.color });
        this.message = `${meta.name}施展「${meta.skillName}」`;
      }
    }
```

> 注意：lion 分支里已 `m.castFlash = 1`，尾部 `if (affected > 0)` 的 `m.castFlash = 1` 对 lion 是重复但无害；保留以不动其它种类行为。`pick.name` 在 lion 分支内已内联用完，`Monster` 接口**不要**加任何 `stolenName` 字段。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/lion-steal.test.ts`
Expected: PASS —— 金色 death burst 在被偷格、message 含「黄狮精」与「刀兵」、castFlash>0。

- [ ] **Step 5: 提交**

```bash
git add web/src/battle.ts web/tests/lion-steal.test.ts
git commit -m "feat(miniboss): 黄狮精卷走金色消失特效 + 底部目标提示"
```

---

## Task 6: 立绘生成（gen-lion.mjs → 透明 PNG → resize → 上传）

**Files:**
- Create: `web/tools/seeddream/gen-lion.mjs`
- Create: `web/src/game-assets/monster-miniboss-lion.png`（生成产出）
- Modify: `web/tools/seeddream/resize-portraits.mjs`（`TARGET` 加一项）
- Modify: `web/src/asset-manifest.names.ts`（`ASSET_FILENAMES` + `AssetKey`）

> 需要 `ARK_API_KEY` 环境变量。若 CI/本机无 key，可先用占位透明图推进代码接线，key 到位后再补生成。

- [ ] **Step 1: 写立绘生成脚本**

新建 `web/tools/seeddream/gen-lion.mjs`（仿 `gen-cavalry-miniboss.mjs`，黄狮精=黄毛狮子精、绿幕）：

```js
// 生成黄狮精小 Boss 立绘。黄毛狮精，绿幕背景便于软抠（避免洪泛滥扣黄色）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

const STYLE = '，Q版扁平游戏图标，造型简洁、粗黑描边、强剪影、高饱和对比色、细节精简、单一主色调、正面全身居中，'
  + '纯高饱和荧光绿 RGB(0,255,0) 绿幕背景满幅平涂，无水墨/渐变/花纹/云纹/光晕/地面，'
  + '脚下方一直到画面底边全是纯绿幕、无任何阴影/投影/接触阴影，无文字，高辨识度';

const JOBS = [
  { id: 'monster-miniboss-lion', prompt: '黄狮精小首领，西游记玉华州偷兵器的黄毛狮子精妖王、壮硕黄鬃狮头妖怪、獠牙利爪、身披简陋黄褐盗甲、眼神狡黠、体型比小妖大比妖王小，威猛，主色金黄色' + STYLE },
];

for (const job of JOBS) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) { console.error(`${job.id} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); continue; }
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  writeFileSync(path.join(OUT, `${job.id}.jpg`), Buffer.from(await img.arrayBuffer()));
  console.log(`OK ${job.id}`);
}
console.log('下一步: bg-remove-chroma → resize → 接线 → 上传');
```

- [ ] **Step 2: 生成 + 软抠透明 PNG**

Run（需 `ARK_API_KEY`）：
```bash
cd web && node tools/seeddream/gen-lion.mjs
node tools/seeddream/bg-remove-chroma.mjs monster-miniboss-lion
```
Expected：`src/game-assets/monster-miniboss-lion.png` 为透明背景的黄狮精（绿幕被抠掉、黄色毛发保留、无绿色溢边）。

> 若图片偏暗/溢绿，用 `polish-png.mjs` 清边。

- [ ] **Step 3: resize 到显示尺寸×3**

在 `web/tools/seeddream/resize-portraits.mjs` 的 `TARGET` 里加 lion（小 Boss 用 max-side 128，与其它 miniboss 一致）：
```js
{ name: 'monster-miniboss-lion', maxSide: 128 },
```
Run：
```bash
cd web && node tools/seeddream/resize-portraits.mjs
```
Expected：`monster-miniboss-lion.png` 透明边被裁切、最长边缩到 128。可选压缩：
```bash
npx pngquant --quality=70-95 --ext .png --force src/game-assets/monster-miniboss-lion.png
```

- [ ] **Step 4: 接线——注册 asset key**

在 `web/src/asset-manifest.names.ts`：

(a) `AssetKey` 联合类型（约 35 行 `'monster-miniboss-blood'` 之后）加：
```ts
  | 'monster-miniboss-lion'
```

(b) `ASSET_FILENAMES`（约 35 行 `'monster-miniboss-blood': 'monster-miniboss-blood.png',` 之后）加：
```ts
  'monster-miniboss-lion': 'monster-miniboss-lion.png',
```

> `miniBossSprite('lion', mapId)`（`assets.ts:191`）会自动命中 `cache['monster-miniboss-lion']`，缺图回退该图妖王立绘，**无需改 assets.ts**。

- [ ] **Step 5: 上传 CDN 刷新 manifest**

```bash
cd web && node tools/tos-upload.mjs monster-miniboss-lion.png
```
Expected：上传成功、`src/game-assets/manifest-generated.ts` 新增 `monster-miniboss-lion.png` 的哈希 CDN URL。onboard 渲染（render.ts ~2211）与码 card（codex.ts `drawBossCard`）自动吃到新图。

- [ ] **Step 6: typecheck 不新增报错**

Run: `cd web && npx tsc --noEmit`
Expected：不新增报错（main 基线已有 ~28 处既有报错，验收看「不新增」）。

- [ ] **Step 7: 提交**

```bash
git add web/tools/seeddream/gen-lion.mjs web/tools/seeddream/resize-portraits.mjs \
        web/src/game-assets/monster-miniboss-lion.png web/src/asset-manifest.names.ts \
        web/src/game-assets/manifest-generated.ts
git commit -m "feat(art): 黄狮精立绘生成、抠图、接线、上传 CDN"
```

---

## Task 7: 浏览器冒烟 + ai-balance 门禁 + 全量验证

**Files:** 无新增（验证任务）

- [ ] **Step 1: 浏览器冒烟——force 黄狮精，确认特效/提示/空格**

用 puppeteer smoke harness（memory `web-smoke-test-harness`）或 DevTools force：
- force 出一只黄狮精、半径内放一件兵器；
- 断言：1–20s 内该兵器消失、格子变空、出现金色 death 粒子、底部出现「⚠ 黄狮精卷走了「X」！」、lion 立绘正确显示。

（若 harness 尚无 force-miniboss 钩子，可在 DevTools 把 `miniBossChance` 设 1、`miniBossFromWave` 设 1 反复开波直到刷出黄狮精，再观效。）

- [ ] **Step 2: ai-balance 门禁（提交前必过）**

Run: `cd web && npx vitest run tests/ai-balance.test.ts`
Expected: PASS —— 加入「随机丢格子」后 AI 胜率未崩。若胜率异常，回调 `miniBossStealDelayMin/Max`、`miniBossStealRadius` 或 `miniBossChance`。

- [ ] **Step 3: support-heroes 不回归**

Run: `cd web && npx vitest run tests/support-heroes.test.ts`
Expected: PASS。

- [ ] **Step 4: 单测全量**

Run: `cd web && npx vitest run`
Expected: 全绿（含新增 `lion-steal.test.ts`）。

- [ ] **Step 5: 收尾 rebase + ff 合并（若 main 已前进）**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy
git fetch origin
git -C .claude/worktrees/huangshijing-steal rebase origin/main   # 解冲突
git merge --ff-only feat/huangshijing-steal
git worktree remove .claude/worktrees/huangshijing-steal
```

---

## 自审清单（plan 写完后已核对）

- **Spec 覆盖**：§3 身份→Task1；§4 一次性+随机延时→Task3；§5 目标选择与移除→Task4；§6 特效→Task5；§7 提示→Task5；§8 立绘→Task6；§9 DevTools→Task2；§10 测试→Task1/3/4/5/7；§11 验收→Task7。无遗漏。
- **占位符**：无 TBD/TODO；每步含真实代码与命令。
- **类型一致**：`miniBossCasted`（Monster 字段）、`miniBossStealRadius/DelayMin/DelayMax`（TUNING）、`MINI_BOSS_META.lion`、`monster-miniboss-lion`（asset key）在各 Task 间命名一致；无临时字段（lion 分支内联用完 `pick.name`，`Monster` 不加 `stolenName`）。
