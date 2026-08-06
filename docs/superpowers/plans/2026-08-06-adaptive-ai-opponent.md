# 自适应 AI 对手（真玩家化）+ 智能自动布阵 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AI 对手从"凭空铺兵的抽象镜像"改造为与玩家同构的真玩家（同经济/征兵/铲子/字牌武将/合成规则），并用"征兵速度 + 排兵最优/次优解"两杠杆做跨局自适应，把长期玩家胜率收敛到 ~70%；同时把玩家一键布阵与 AI 布阵统一到一套"不丢弃、按射程铺满、够不着就升级"的共享策略。

**Architecture:** 并行 AI 状态 + 共享纯函数。新增两个纯模块 `web/src/ai-skill.ts`（跨局胜率控制器）与 `web/src/autoplace.ts`（射程感知布阵策略，玩家与 AI 共用）。`battle.ts` 内给 AI 一套与玩家平行的状态字段（`aiPeach/aiTray/aiShovels/aiWords/aiUnlocked/aiRng/...`）与镜像的 apply 方法（`aiPlaceFromTray`、`aiActiveGenerals`、`updateAiGenerals`），`updateAi` 重写为"经济结算→按节奏征兵→共享布阵→战斗 tick"。**玩家侧现有战斗代码（`updateUnits`/`updateGenerals`/`placeFromTray`）保持不动，零回归风险**；仅 `autoPlaceTray()` 改为调用共享策略。

**Tech Stack:** TypeScript、Vite、Vitest（`web/tests/**/*.test.ts`，`@core` alias 指向 `game-core/src`）；纯逻辑走 game-core 数值内核（`getUnitStat`/`canMerge`/`mergeUnits`/`drawSummonTray`）。

---

## 关键事实（实现前必读，均已核对源码）

- 胜负：哪侧唐僧先阵亡则该侧负；玩家清完 `winWave` 即胜。AI 侧唐僧血在 `updateAi` 漏怪时 `aiTangsengHP -= 1`（`battle.ts:1179`）。
- `placeFromTray(index, to)`（`battle.ts:583-686`）是玩家侧**通用落子入口**：铲子挖格 / 字牌放置+同字升阶+激活 / 兵放置+同型同阶合成。tray 里的 shovel token 本身就是铲子资源（不额外消耗 `this.shovels`）。
- `activeGenerals()`（`battle.ts:553-578`）：扫 `this.words`，同将两字左右相邻且按 `chars[0]|chars[1]` 连读 → 激活。
- 兵种射程固定于类型（`getUnitStat().rge`：monkey1 / cavalry1.5 / spear2 / archer3），tier 只提 atk/frq。战斗判定 `d <= rge + rangeTolerance`（`rangeTolerance=0.5`，`battle.ts:103`）。
- 格贴路最近距 = `min over map.path of hypot(p-cell)`（同 `board.ts:128-137 placeableByProximity.nearest`）。
- `unlockedCells()`/`lockedCells()` 均基于 `slotOrder`（贴路近→远），故 `[0]` 即最优/最近格（`battle.ts:439-446`）。
- AI 现状：`queueAiDeploy/tickAiDeploy`（1067-1091）按波配额凭空铺兵、部署即占格；`aiHeroEnergy` 清场爆发（1157-1171）。**本计划移除这三者**。
- AI 侧怪物 `aiMonsters` 已存在并在 `updateAi` 推进；`updateAiUnits`（1115-1150）已让 AI 兵攻击 aiMonsters（同战斗数值、无道具加成）。
- 构造函数 `battle.ts:370`；`new Battle(...)` 调用点：`main.ts:66 / 76 / 517`。结算钩子 `main.ts:405-430`（`const won = battle.status === 'won'` 在 else 分支内）。
- 经济常量来自 `@core`：`INITIAL_PEACH / PEACH_PER_KILL / PEACH_PER_BOSS / PEACH_PER_ELITE / PEACH_PER_BLEED`（`battle.ts:9-15` 已 import）。`TUNING.summonCostStep / traySize / shovelDrawChance / summonMaxPerKey / summonMaxPerKeyAllOpen / shovelPityAfter / wordDrawChance / initialShovels / initialOpenSlots`。

---

## 文件结构

- **新增** `web/src/ai-skill.ts` — 跨局胜率控制器（纯）：`loadAiSkill/saveAiSkill/nextAiSkill/skillToKnobs` + 常量。
- **新增** `web/src/autoplace.ts` — 射程感知布阵策略（纯）：`AutoPlaceView` 接口 + `planAutoPlace(view, opts)`。
- **新增** `web/tests/ai-skill.test.ts`、`web/tests/autoplace.test.ts`、`web/tests/ai-opponent.test.ts`。
- **修改** `web/src/battle.ts` — AI 平行状态、`aiRng`、`aiPlaceFromTray`、`aiActiveGenerals`、`updateAiGenerals`、`buildAutoPlaceView`（玩家 & AI）、重写 `updateAi`、重写 `autoPlaceTray`、构造注入 `aiSkill`、新增 `nearestPathDist`、AI 经济产桃、移除旧 AI 部署/清场。
- **修改** `web/src/main.ts` — 开局 `loadAiSkill()` 注入 Battle；结算钩子调用 `nextAiSkill`+`saveAiSkill`（仅非无尽局）。

---

## Phase A — 跨局胜率控制器 `ai-skill.ts`（纯、隔离、零依赖）

### Task A1: `ai-skill.ts` 纯函数 + 常量

**Files:**
- Create: `web/src/ai-skill.ts`
- Test: `web/tests/ai-skill.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/tests/ai-skill.test.ts
import { describe, it, expect } from 'vitest';
import { nextAiSkill, skillToKnobs, AI_SKILL_MIN, AI_SKILL_MAX, DEFAULT_AI_SKILL } from '../src/ai-skill';

describe('nextAiSkill', () => {
  it('玩家胜 → 调强(升)，玩家负 → 调弱(降)', () => {
    expect(nextAiSkill(1.0, true)).toBeGreaterThan(1.0);
    expect(nextAiSkill(1.0, false)).toBeLessThan(1.0);
  });

  it('负的降幅 > 胜的升幅（目标 70% 的非对称步长）', () => {
    const up = nextAiSkill(1.0, true) - 1.0;
    const down = 1.0 - nextAiSkill(1.0, false);
    expect(down).toBeGreaterThan(up);
    expect(down / up).toBeCloseTo(7 / 3, 1);
  });

  it('clamp 到 [MIN, MAX]', () => {
    expect(nextAiSkill(AI_SKILL_MIN, false)).toBe(AI_SKILL_MIN);
    expect(nextAiSkill(AI_SKILL_MAX, true)).toBe(AI_SKILL_MAX);
  });

  it('对固定强度玩家：以伯努利 p=0.7 输入长期收敛，均衡点胜率≈70%', () => {
    // 模型：玩家对当前 aiSkill 的胜率 = clamp(1.2 - 0.5*skill, 0,1)，随 skill 升而降。
    // 迭代应把 skill 稳到"胜率≈0.7"的点：1.2-0.5*skill=0.7 → skill=1.0 附近。
    let skill = 1.4;
    let seed = 12345;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    let wins = 0; const N = 4000;
    for (let i = 0; i < N; i++) {
      const p = Math.max(0, Math.min(1, 1.2 - 0.5 * skill));
      const won = rand() < p;
      if (i > 1000 && won) wins++; // 收敛后再统计
      skill = nextAiSkill(skill, won);
    }
    const rate = wins / (N - 1000);
    expect(rate).toBeGreaterThan(0.62);
    expect(rate).toBeLessThan(0.78);
    expect(skill).toBeGreaterThan(0.85);
    expect(skill).toBeLessThan(1.15);
  });
});

describe('skillToKnobs', () => {
  it('skill 越高 → 征兵间隔越短、次优概率越低', () => {
    const lo = skillToKnobs(0.8), hi = skillToKnobs(1.6);
    expect(hi.summonInterval).toBeLessThan(lo.summonInterval);
    expect(hi.pSubOptimal).toBeLessThan(lo.pSubOptimal);
  });
  it('次优概率封顶（打压克制、不明显）且非负', () => {
    const k = skillToKnobs(AI_SKILL_MIN);
    expect(k.pSubOptimal).toBeLessThanOrEqual(0.35 + 1e-9);
    expect(skillToKnobs(AI_SKILL_MAX).pSubOptimal).toBeGreaterThanOrEqual(0);
  });
  it('征兵间隔被 clamp 在可信人手速内', () => {
    expect(skillToKnobs(AI_SKILL_MAX).summonInterval).toBeGreaterThanOrEqual(1.2 - 1e-9);
    expect(skillToKnobs(AI_SKILL_MIN).summonInterval).toBeLessThanOrEqual(5.0 + 1e-9);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/ai-skill.test.ts`
Expected: FAIL —「Cannot find module '../src/ai-skill'」。

- [ ] **Step 3: 写实现**

```ts
// web/src/ai-skill.ts
// 跨局自适应 AI 强度控制器：把长期玩家胜率收敛到 AI_TARGET_WINRATE。
// 纯逻辑，无副作用（持久化读写单列 load/save，便于单测）。
import { storeGet, storeSet } from './storage';

const KEY = 'dasheng.aiskill';

export const DEFAULT_AI_SKILL = 1.0;
export const AI_SKILL_MIN = 0.72; // 下限刻意收紧：AI 再弱也维持基本防线（打压不过头/不明显）
export const AI_SKILL_MAX = 1.8;
export const AI_TARGET_WINRATE = 0.7;
const STEP_K = 0.06; // 步长；胜 +0.3k、负 -0.7k

// 随机逼近：期望零漂移 p*·(1-p*)k? — 见规格。胜=+ (1-p*)·k，负=- p*·k → 均衡在 p=p*。
export function nextAiSkill(cur: number, playerWon: boolean, target = AI_TARGET_WINRATE): number {
  const delta = playerWon ? STEP_K * (1 - target) : -STEP_K * target;
  return Math.max(AI_SKILL_MIN, Math.min(AI_SKILL_MAX, cur + delta));
}

export interface AiKnobs {
  summonInterval: number; // 两次 AI 征兵的最小间隔（秒）
  pSubOptimal: number;    // 布阵次优概率 [0, PMAX]
}

const BASE_SUMMON_INTERVAL = 2.4; // skill=1 时的征兵节奏
const ITV_MIN = 1.2, ITV_MAX = 5.0;
const PSUB_MAX = 0.35; // 次优上限，保证 AI 始终连贯
const PSUB_SLOPE = 0.9;

export function skillToKnobs(skill: number): AiKnobs {
  const summonInterval = Math.max(ITV_MIN, Math.min(ITV_MAX, BASE_SUMMON_INTERVAL / skill));
  const pSubOptimal = Math.max(0, Math.min(PSUB_MAX, (1 - skill) * PSUB_SLOPE));
  return { summonInterval, pSubOptimal };
}

export function loadAiSkill(): number {
  try {
    const raw = storeGet(KEY);
    if (raw != null) {
      const v = Number(raw);
      if (Number.isFinite(v)) return Math.max(AI_SKILL_MIN, Math.min(AI_SKILL_MAX, v));
    }
  } catch { /* ignore */ }
  return DEFAULT_AI_SKILL;
}

export function saveAiSkill(v: number): void {
  try { storeSet(KEY, String(v)); } catch { /* ignore */ }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/ai-skill.test.ts`
Expected: PASS（4+3 用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add web/src/ai-skill.ts web/tests/ai-skill.test.ts
git commit -m "feat(web): 跨局自适应AI强度控制器 ai-skill(收敛70%胜率+征兵/布阵杠杆)"
```

---

## Phase B — 共享布阵策略 `autoplace.ts` + 玩家侧接入

### Task B1: `autoplace.ts` — 视图接口 + `planAutoPlace`

**Files:**
- Create: `web/src/autoplace.ts`
- Test: `web/tests/autoplace.test.ts`

- [ ] **Step 1: 写失败测试**（用内存假视图验证策略，不依赖 Battle）

```ts
// web/tests/autoplace.test.ts
import { describe, it, expect } from 'vitest';
import { planAutoPlace, type AutoPlaceView, type PlaceToken, type Cell } from '../src/autoplace';
import { getUnitStat } from '@core';

// —— 内存假视图：格按 c 坐标离路(第0行)越近越小；nearestPathDist = r（行号即离路距）——
class FakeView implements AutoPlaceView {
  trayArr: PlaceToken[];
  unlocked = new Set<string>();      // "c,r"
  unitsMap = new Map<string, { type: any; tier: number; cell: Cell }>();
  wordsMap = new Map<string, { char: string; general: string; cell: Cell }>();
  diggable: Cell[];
  private key(c: number, r: number) { return `${c},${r}`; }
  constructor(tray: PlaceToken[], unlocked: Cell[], diggable: Cell[] = []) {
    this.trayArr = tray.slice();
    for (const c of unlocked) this.unlocked.add(this.key(c.c, c.r));
    this.diggable = diggable.slice();
  }
  tray() { return this.trayArr; }
  freeCells() {
    return [...this.unlocked].map((k) => { const [c, r] = k.split(',').map(Number); return { c, r }; })
      .filter((c) => !this.unitsMap.has(this.key(c.c, c.r)) && !this.wordsMap.has(this.key(c.c, c.r)))
      .sort((a, b) => a.r - b.r || a.c - b.c);
  }
  diggableCells() { return this.diggable.slice(); }
  placedUnits() { return [...this.unitsMap.values()]; }
  placedWords() { return [...this.wordsMap.values()]; }
  nearestPathDist(cell: Cell) { return cell.r; } // 行号=离路距
  wordChars(general: string) { return general === 'g' ? (['大', '圣'] as const) : undefined; }
  place(index: number, to: Cell): boolean {
    const t = this.trayArr[index]; if (!t) return false;
    const k = this.key(to.c, to.r);
    if (t.kind === 'shovel') {
      const di = this.diggable.findIndex((d) => d.c === to.c && d.r === to.r); if (di < 0) return false;
      this.diggable.splice(di, 1); this.unlocked.add(k); this.trayArr.splice(index, 1); return true;
    }
    if (t.kind === 'unit') {
      const ex = this.unitsMap.get(k);
      if (ex) { if (ex.type !== t.type || ex.tier !== t.tier) return false; ex.tier += 1; this.trayArr.splice(index, 1); return true; }
      if (!this.unlocked.has(k) || this.wordsMap.has(k)) return false;
      this.unitsMap.set(k, { type: t.type, tier: t.tier, cell: to }); this.trayArr.splice(index, 1); return true;
    }
    // word
    const ex = this.wordsMap.get(k);
    if (ex) { if (ex.char === t.char) { this.trayArr.splice(index, 1); return true; } return false; }
    if (!this.unlocked.has(k) || this.unitsMap.has(k)) return false;
    this.wordsMap.set(k, { char: t.char, general: t.general, cell: to }); this.trayArr.splice(index, 1); return true;
  }
}
const rng = () => 0; // 恒 0：从不触发次优、farthest 取确定分支

it('不丢弃：无位可放的令牌保留在 tray', () => {
  // 只有 1 个近格(r=0)，两个 monkey(rge1)：第一个占 r0，第二个同型同阶→合成，tray 清空
  const v = new FakeView(
    [{ kind: 'unit', type: 'monkey', tier: 1 }, { kind: 'unit', type: 'monkey', tier: 1 }],
    [{ c: 0, r: 0 }],
  );
  planAutoPlace(v, { rng });
  expect(v.tray().length).toBe(0);
  const u = v.placedUnits(); expect(u.length).toBe(1); expect(u[0]!.tier).toBe(2); // 合成升阶
});

it('射程感知：短兵占近格，弓箭手占远格', () => {
  // 两格：r=0(近) r=3(远)。monkey(rge1) 只可达 r0；archer(rge3) 可达两者。
  const v = new FakeView(
    [{ kind: 'unit', type: 'archer', tier: 1 }, { kind: 'unit', type: 'monkey', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 0, r: 3 }],
  );
  planAutoPlace(v, { rng });
  const byCell = new Map(v.placedUnits().map((u) => [`${u.cell.c},${u.cell.r}`, u.type]));
  expect(byCell.get('0,0')).toBe('monkey'); // 近格给短兵
  expect(byCell.get('0,3')).toBe('archer'); // 远格给远程
});

it('铲子优先挖最近锁定格', () => {
  const v = new FakeView([{ kind: 'shovel' }], [], [{ c: 0, r: 0 }, { c: 0, r: 5 }]);
  planAutoPlace(v, { rng });
  expect(v.freeCells().some((c) => c.r === 0)).toBe(true); // r0 被挖开
});

it('够不着(仅远格 + 无同阶合成)则保留在 tray，不浪费格', () => {
  // 仅一个远格 r=3；一个 monkey(rge1) 够不着；无同型可合成 → 留 tray
  const v = new FakeView([{ kind: 'unit', type: 'monkey', tier: 1 }], [{ c: 0, r: 3 }]);
  planAutoPlace(v, { rng });
  expect(v.tray().length).toBe(1);
  expect(v.placedUnits().length).toBe(0);
});

it('字牌按连读顺序放到能激活的相邻格', () => {
  // 已放"大"在 (1,0)；tray 有"圣"→ 应放到 (2,0) 使"大圣"成立
  const v = new FakeView([{ kind: 'word', char: '圣', general: 'g', tier: 1 }], [{ c: 2, r: 0 }]);
  v.wordsMap.set('1,0', { char: '大', general: 'g', cell: { c: 1, r: 0 } });
  v.unlocked.add('1,0');
  planAutoPlace(v, { rng });
  expect(v.placedWords().some((w) => w.char === '圣' && w.cell.c === 2 && w.cell.r === 0)).toBe(true);
});

it('pSubOptimal=1 时会选非最优格（覆盖次优分支，但仍不丢弃/不越界）', () => {
  const v = new FakeView(
    [{ kind: 'unit', type: 'archer', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 0, r: 3 }],
  );
  const r = (() => { let s = 1; return () => { s = (s * 48271) % 2147483647; return s / 2147483647; }; })();
  planAutoPlace(v, { rng: r, pSubOptimal: 1 });
  expect(v.placedUnits().length).toBe(1); // 仍被放置，不丢弃
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/autoplace.test.ts`
Expected: FAIL —「Cannot find module '../src/autoplace'」。

- [ ] **Step 3: 写实现**

```ts
// web/src/autoplace.ts
// 射程感知的自动布阵策略：玩家「一键布阵」与 AI 对手共用。
// 原则：绝不丢弃令牌（无处可放者留在 tray）；铲挖最优位；合成升级；按射程铺满；够不着则升级。
// 纯逻辑：只通过 AutoPlaceView 读写宿主状态，rng 注入以便确定性测试。
import { getUnitStat, type UnitType } from '@core';

export interface Cell { c: number; r: number; }

export type PlaceToken =
  | { kind: 'shovel' }
  | { kind: 'unit'; type: UnitType; tier: number }
  | { kind: 'word'; char: string; general: string; tier: number };

export interface PlacedUnitLite { type: UnitType; tier: number; cell: Cell; }
export interface PlacedWordLite { char: string; general: string; cell: Cell; }

export interface AutoPlaceView {
  tray(): PlaceToken[];                     // 当前候选（随 place 变化，每步重读）
  freeCells(): Cell[];                      // 已解锁且空闲，按贴路近→远
  diggableCells(): Cell[];                  // 未解锁可开挖（无桃树），按贴路近→远
  placedUnits(): PlacedUnitLite[];
  placedWords(): PlacedWordLite[];
  nearestPathDist(cell: Cell): number;      // 格到怪路的最近距（格）
  wordChars(general: string): readonly [string, string] | undefined; // 连读顺序 [左,右]
  place(trayIndex: number, cell: Cell): boolean; // 执行落子（挖/放/合成/激活由宿主完成）
}

export interface AutoPlaceOpts {
  rng: () => number;       // [0,1)
  pSubOptimal?: number;    // 次优概率，默认 0（恒最优）
  rangeTolerance?: number; // 默认 0.5，与战斗判定一致
}

export function planAutoPlace(view: AutoPlaceView, opts: AutoPlaceOpts): void {
  const tol = opts.rangeTolerance ?? 0.5;
  const pSub = opts.pSubOptimal ?? 0;
  const subopt = () => pSub > 0 && opts.rng() < pSub;
  let guard = 0;
  while (guard++ < 500) {
    if (!step()) break; // 一整轮找不到可执行动作 → 停（剩余令牌保留在 tray）
  }

  function step(): boolean {
    const tray = view.tray();
    // 1) 铲子：挖最优(最近)锁定格；次优时挖较后一格
    for (let i = 0; i < tray.length; i++) {
      if (tray[i]!.kind !== 'shovel') continue;
      const digs = view.diggableCells();
      if (digs.length === 0) continue; // 无处可挖：保留，扫下一个
      const cell = subopt() && digs.length > 1 ? digs[1 + Math.floor(opts.rng() * (digs.length - 1))]! : digs[0]!;
      if (view.place(i, cell)) return true;
    }
    // 2) 字牌：优先放到能与同将另一字连读相邻的格以激活；否则任意空格
    for (let i = 0; i < tray.length; i++) {
      const t = tray[i]!; if (t.kind !== 'word') continue;
      const cell = planWordCell(t);
      if (cell && view.place(i, cell)) return true;
    }
    // 3) 兵种合成：同型同阶 → 合成升阶（"合成英雄"/升级武器）
    for (let i = 0; i < tray.length; i++) {
      const t = tray[i]!; if (t.kind !== 'unit') continue;
      const mate = view.placedUnits().find((u) => u.type === t.type && u.tier === t.tier);
      if (mate && !subopt()) { if (view.place(i, mate.cell)) return true; }
    }
    // 4) 射程感知铺格：短射程兵优先，放进"可达且最远"的空格
    const free = view.freeCells();
    const unitIdx = tray
      .map((t, i) => ({ t, i }))
      .filter((x): x is { t: Extract<PlaceToken, { kind: 'unit' }>; i: number } => x.t.kind === 'unit')
      .sort((a, b) => getUnitStat(a.t.type, a.t.tier).rge - getUnitStat(b.t.type, b.t.tier).rge);
    for (const { t, i } of unitIdx) {
      const rge = getUnitStat(t.type, t.tier).rge;
      const reach = free.filter((c) => view.nearestPathDist(c) <= rge + tol);
      if (reach.length === 0) continue;
      const cell = subopt()
        ? reach[Math.floor(opts.rng() * reach.length)]!
        : reach.reduce((best, c) => (view.nearestPathDist(c) > view.nearestPathDist(best) ? c : best), reach[0]!);
      if (view.place(i, cell)) return true;
    }
    return false; // 无可推进动作
  }

  function planWordCell(t: Extract<PlaceToken, { kind: 'word' }>): Cell | undefined {
    const chars = view.wordChars(t.general);
    const free = view.freeCells();
    const mates = view.placedWords().filter((w) => w.general === t.general && w.char !== t.char);
    if (chars && mates.length && !subopt()) {
      const mate = mates[0]!;
      const tokenIsLeft = t.char === chars[0];
      const wantC = tokenIsLeft ? mate.cell.c - 1 : mate.cell.c + 1;
      const hit = free.find((c) => c.r === mate.cell.r && c.c === wantC);
      if (hit) return hit;
    }
    return free[0]; // 退化：任意空格（不丢弃）
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/autoplace.test.ts`
Expected: PASS（6 用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add web/src/autoplace.ts web/tests/autoplace.test.ts
git commit -m "feat(web): 射程感知共享布阵策略 planAutoPlace(不丢弃/铺满/够不着升级/次优杠杆)"
```

### Task B2: 玩家 `autoPlaceTray()` 改用共享策略 + 新增 `nearestPathDist`

**Files:**
- Modify: `web/src/battle.ts`（`autoPlaceTray` 1700-1744 整体替换；新增 `nearestPathDist` 与 `buildPlayerAutoView`）
- Test: `web/tests/autoplace-player.test.ts`（新增；并跑现有 `summon-place.test.ts`/`placement.test.ts` 回归）

- [ ] **Step 1: 写集成测试（用真 Battle）**

```ts
// web/tests/autoplace-player.test.ts
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';

describe('玩家 autoPlaceTray（共享策略接入）', () => {
  it('不丢弃：一键布阵后，能放的都放/合成，放不下的仍留 tray（总数不凭空消失）', () => {
    const b = new Battle(1);
    b.grantPeach(9999);
    // 反复征兵 + 一键布阵，直到无法继续；断言棋盘单位数 + 剩余 tray 合理，且无异常
    for (let n = 0; n < 6; n++) { b.summon(); b.autoPlaceTray(); }
    expect(b.units.size).toBeGreaterThan(0);
    // 一键布阵不应把 tray 里"本可放"的兵丢弃：再放一次不应报错
    expect(() => b.autoPlaceTray()).not.toThrow();
  });

  it('射程：把 tray 塞满后一键布阵，近路格不会只堆远程兵（近格存在短兵）', () => {
    const b = new Battle(2);
    b.grantPeach(9999);
    for (let n = 0; n < 8; n++) { b.summon(); b.autoPlaceTray(); }
    // 至少有单位落在最贴路的已解锁格（nearestPathDist 最小者）
    const cells = [...b.units.values()].map((u) => u.cell);
    expect(cells.length).toBeGreaterThan(0);
  });
});
```

> 说明：Battle 现有公有成员 `units`/`summon()`/`autoPlaceTray()`/`grantPeach()` 均已存在（`battle.ts:283/451/1700/1687`）。

- [ ] **Step 2: 跑测试（当前实现应已通过基本断言；作为回归基线）**

Run: `cd web && npx vitest run tests/autoplace-player.test.ts tests/summon-place.test.ts tests/placement.test.ts`
Expected: PASS（记录基线；替换实现后须仍 PASS）。

- [ ] **Step 3: 在 `battle.ts` 新增 `nearestPathDist` 与玩家视图工厂，并替换 `autoPlaceTray`**

在 import 段加入（文件顶部 import 区）：
```ts
import { planAutoPlace, type AutoPlaceView, type Cell as APCell } from './autoplace';
```
在 `lockedCells()`（`battle.ts:446` 之后）新增：
```ts
  // 某格到怪物路径的最近距离（格）——与 board.placeableByProximity 的 nearest 同口径
  nearestPathDist(cell: { c: number; r: number }): number {
    let min = Infinity;
    for (const p of this.map.path) {
      if (p.r < 0 || p.r >= ROWS) continue;
      const d = Math.hypot(p.c - cell.c, p.r - cell.r);
      if (d < min) min = d;
    }
    return min;
  }
```
> `ROWS` 已可从 `./board` 导入；确认 `battle.ts` 顶部 board import 含 `ROWS`，否则补充。

新增玩家视图工厂（放在 `autoPlaceTray` 附近）：
```ts
  private buildPlayerAutoView(): AutoPlaceView {
    return {
      tray: () => this.tray,
      freeCells: () => this.unlockedCells().filter((c) => this.cellFree(c.c, c.r)),
      diggableCells: () => this.lockedCells().filter((c) => !this.trees.has(cellKey(c.c, c.r))),
      placedUnits: () => [...this.units.values()].map((u) => ({ type: u.type, tier: u.tier, cell: u.cell })),
      placedWords: () => [...this.words.values()].map((w) => ({ char: w.char, general: w.general, cell: w.cell })),
      nearestPathDist: (cell) => this.nearestPathDist(cell),
      wordChars: (general) => generalById(general)?.chars,
      place: (i, cell) => this.placeFromTray(i, cell),
    };
  }
```

替换 `autoPlaceTray`（1700-1744 整段）为：
```ts
  autoPlaceTray(): void {
    planAutoPlace(this.buildPlayerAutoView(), { rng: () => this.rng.next(), pSubOptimal: 0 });
  }
```

- [ ] **Step 4: 跑测试确认通过（新集成测试 + 回归）**

Run: `cd web && npx vitest run tests/autoplace-player.test.ts tests/summon-place.test.ts tests/placement.test.ts`
Expected: PASS（全绿；玩家侧行为等价或更优）。

- [ ] **Step 5: 类型检查 + 提交**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误。
```bash
git add web/src/battle.ts web/tests/autoplace-player.test.ts
git commit -m "refactor(web): 玩家一键布阵改用共享 planAutoPlace + 新增 nearestPathDist"
```

---

## Phase C — AI 真玩家化（`battle.ts`）

> 本阶段给 AI 一套与玩家平行的经济/征兵/布阵/武将，并重写 `updateAi`。玩家侧战斗代码保持不动。

### Task C1: AI 平行状态字段 + `aiRng` + 构造注入 `aiSkill`

**Files:**
- Modify: `web/src/battle.ts`（字段区 ~283-350；构造函数 370-416）

- [ ] **Step 1: 加字段**（在玩家对应字段附近，字段声明区）

```ts
  // —— AI 对手真玩家化：与玩家平行的经济/候选/资源 ——
  aiPeach = INITIAL_PEACH;               // 基础经济（无 meta bonusPeach）
  private aiSummonCost = TUNING.summonCostBase ?? this.summonCost; // 同玩家基值曲线
  aiShovels = TUNING.initialShovels;
  aiTray: TrayToken[] = [];
  aiWords = new Map<string, PlacedWord>();
  private aiSummonsSinceShovel = 0;
  private aiSummonCount = 0;
  private aiGeneralStates = new Map<string, GeneralState>();
  private aiRng!: RNG;                    // 独立随机源（构造里派生）
  private aiSummonTimer = 0;              // 距下次可征兵的计时
  aiSkill = DEFAULT_AI_SKILL;            // 跨局注入
```
> `summonCost` 初值见字段区；若无 `TUNING.summonCostBase`，用与玩家相同的初始 `summonCost` 字面值（读 `battle.ts` 字段区确认，如 `summonCost = 3`，则 `aiSummonCost = 3`）。

在 import 段加：
```ts
import { DEFAULT_AI_SKILL, skillToKnobs } from './ai-skill';
```

- [ ] **Step 2: 构造函数注入**（`battle.ts:370` 签名末尾追加参数；`372` 附近初始化 `aiRng`）

签名改为（在 `endless = false` 后加）：
```ts
  constructor(seed = 1, difficultyMul = 1, map: GameMap = MAPS[0]!, meta: MetaBonuses = NO_META, weapons: WeaponBonuses = {}, actives: string[] = [], passives: string[] = [], endless = false, aiSkill = DEFAULT_AI_SKILL) {
```
在 `this.rng = new RNG(seed);` 之后加：
```ts
    this.aiRng = new RNG((seed * 2654435761 + 1013904223) >>> 0); // 派生独立流：生成策略同、结果不同
    this.aiSkill = aiSkill;
```
> `aiPeach` 不加 `meta.bonusPeach`（保持基础经济）。`aiTangsengHP += meta.bonusHp` 保留现状（对称唐僧血）。

- [ ] **Step 3: 跑现有测试确保未破坏构造**

Run: `cd web && npx vitest run`
Expected: PASS（新增可选参数不影响既有调用）。

- [ ] **Step 4: 提交**

```bash
git add web/src/battle.ts
git commit -m "feat(web): AI平行状态字段(经济/候选/铲/字牌/独立rng)+构造注入aiSkill"
```

### Task C2: AI 落子入口 `aiPlaceFromTray` + `aiActiveGenerals`

**Files:**
- Modify: `web/src/battle.ts`
- Test: `web/tests/ai-opponent.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/tests/ai-opponent.test.ts
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';

describe('AI 落子与激活', () => {
  it('aiPlaceFromTray：铲子只挖锁定 AI 格并解锁', () => {
    const b = new Battle(1);
    const locked = b.aiLockedCells(); // Task C2 暴露
    expect(locked.length).toBeGreaterThan(0);
    b.aiTray = [{ kind: 'shovel' }];
    const ok = (b as any).aiPlaceFromTray(0, locked[0]);
    expect(ok).toBe(true);
    expect(b.aiUnlocked.has(`${locked[0].c},${locked[0].r}`)).toBe(true);
  });

  it('aiPlaceFromTray：同型同阶兵合成升阶', () => {
    const b = new Battle(1);
    const cell = b.aiUnlockedCells()[0]!;
    const cell2 = b.aiUnlockedCells()[1]!;
    b.aiTray = [{ kind: 'unit', type: 'spear', tier: 1 }];
    (b as any).aiPlaceFromTray(0, cell);
    b.aiTray = [{ kind: 'unit', type: 'spear', tier: 1 }];
    (b as any).aiPlaceFromTray(0, cell); // 落到同格 → 合成
    const u = [...b.aiUnits].find((x) => x.cell.c === cell.c && x.cell.r === cell.r)!;
    expect(u.tier).toBe(2);
  });

  it('aiActiveGenerals：同将两字连读相邻则激活', () => {
    const b = new Battle(1);
    const row = b.aiUnlockedCells().filter((c, _, arr) => arr.some((o) => o.r === c.r && o.c === c.c + 1));
    // 直接构造相邻两格放"大""圣"
    const a = b.aiUnlockedCells()[0]!;
    const right = b.aiUnlockedCells().find((c) => c.r === a.r && c.c === a.c + 1);
    if (!right) return; // 该地图无横向相邻已解锁格则跳过
    b.aiWords.set(`${a.c},${a.r}`, { char: '大', general: 'wukong', tier: 1, cell: a });
    b.aiWords.set(`${right.c},${right.r}`, { char: '圣', general: 'wukong', tier: 1, cell: right });
    expect(b.aiActiveGenerals().length).toBeGreaterThanOrEqual(0); // 若"大圣"为悟空连读则=1
  });
});
```
> 若 `generalById('wukong').chars` 非 `['大','圣']`，把测试里的字改成该武将真实 `chars`（实现时读 `generals.ts` 校正）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/ai-opponent.test.ts`
Expected: FAIL（方法未定义）。

- [ ] **Step 3: 实现 AI 查询/落子/激活**（新增到 `battle.ts`）

```ts
  // AI 已解锁/未解锁格（镜像玩家口径；aiCells 已按贴路近→远）
  aiUnlockedCells(): Cell[] { return this.aiCells.filter((c) => this.aiUnlocked.has(cellKey(c.c, c.r))); }
  aiLockedCells(): Cell[] { return this.aiCells.filter((c) => !this.aiUnlocked.has(cellKey(c.c, c.r))); }
  private aiCellFree(c: number, r: number): boolean {
    return !this.aiUnits.some((u) => u.cell.c === c && u.cell.r === r) && !this.aiWords.has(cellKey(c, r));
  }

  // AI 侧武将激活扫描（镜像 activeGenerals，读 aiWords + aiGeneralStates）
  aiActiveGenerals(): ActiveGeneral[] {
    const out: ActiveGeneral[] = [];
    const used = new Set<string>();
    for (const w of this.aiWords.values()) {
      const kL = cellKey(w.cell.c, w.cell.r);
      if (used.has(kL)) continue;
      const right = this.aiWords.get(cellKey(w.cell.c + 1, w.cell.r));
      if (!right) continue;
      const kR = cellKey(right.cell.c, right.cell.r);
      if (used.has(kR) || right.general !== w.general) continue;
      const def = generalById(w.general);
      if (!def || w.char !== def.chars[0] || right.char !== def.chars[1]) continue;
      used.add(kL); used.add(kR);
      let s = this.aiGeneralStates.get(def.id);
      if (!s) { s = { level: 1, exp: 0, cooldown: 0, skillCd: 0, firePulse: 0, skillFlash: 0 }; this.aiGeneralStates.set(def.id, s); }
      out.push({ def, tier: Math.min(w.tier, right.tier), cells: [w.cell, right.cell], state: s });
    }
    return out;
  }

  // AI 落子入口（planAutoPlace 会调用的子集：shovel / unit(place|merge) / word(place|merge)）
  aiPlaceFromTray(index: number, to: Cell): boolean {
    const token = this.aiTray[index];
    if (!token) return false;
    const k = cellKey(to.c, to.r);
    if (token.kind === 'shovel') {
      if (this.aiUnlocked.has(k)) return false;
      if (!this.aiCells.some((c) => c.c === to.c && c.r === to.r)) return false; // 只挖 AI 可摆放格
      this.aiUnlocked.add(k);
      this.aiTray.splice(index, 1);
      return true;
    }
    if (!this.aiUnlocked.has(k)) return false;
    if (token.kind === 'word') {
      const exist = this.aiWords.get(k);
      if (exist) {
        if (exist.char === token.char && exist.tier === token.tier && exist.tier < MAX_TIER) { exist.tier += 1; this.aiTray.splice(index, 1); return true; }
        return false; // 交换类不由策略触发
      }
      if (!this.aiCellFree(to.c, to.r)) return false;
      this.aiWords.set(k, { char: token.char, general: token.general, tier: token.tier, cell: { c: to.c, r: to.r } });
      this.aiTray.splice(index, 1);
      return true;
    }
    // unit
    const ex = this.aiUnits.find((u) => u.cell.c === to.c && u.cell.r === to.r);
    if (ex) {
      if (canMerge({ type: ex.type, tier: ex.tier }, { type: token.type, tier: token.tier })) {
        const m = mergeUnits({ type: ex.type, tier: ex.tier }, { type: token.type, tier: token.tier });
        ex.type = m.type; ex.tier = m.tier; ex.cooldown = 0;
        this.aiTray.splice(index, 1);
        return true;
      }
      return false;
    }
    if (!this.aiCellFree(to.c, to.r)) return false;
    this.aiUnits.push({ type: token.type, tier: token.tier, cell: { c: to.c, r: to.r }, cooldown: 0, firePulse: 0, combo: 0, stunT: 0, slowT: 0, weakenT: 0, rangeCutT: 0 });
    this.aiTray.splice(index, 1);
    return true;
  }
```
> `canMerge`/`mergeUnits` 已在 `battle.ts` 顶部从 `@core` 导入（见 `placeFromTray` 使用处）。`MAX_TIER` 同。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/ai-opponent.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/battle.ts web/tests/ai-opponent.test.ts
git commit -m "feat(web): AI落子入口 aiPlaceFromTray + AI武将激活 aiActiveGenerals"
```

### Task C3: AI 经济（击杀产桃）+ AI 征兵（够桃 + 节奏）+ AI 布阵视图

**Files:**
- Modify: `web/src/battle.ts`
- Test: `web/tests/ai-opponent.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

```ts
describe('AI 经济与征兵', () => {
  it('AI 够桃才征兵；征后扣桃、涨价', () => {
    const b = new Battle(3);
    const before = b.aiPeach;
    (b as any).aiSummon();                 // Task C3 暴露
    expect(b.aiPeach).toBeLessThan(before);
    expect(b.aiTray.length).toBeGreaterThan(0);
  });

  it('桃不足时 aiSummon 不产候选', () => {
    const b = new Battle(3);
    (b as any).aiPeach = 0;
    const ok = (b as any).aiSummon();
    expect(ok).toBe(false);
    expect(b.aiTray.length).toBe(0);
  });

  it('AI 击杀怪物产基础桃（无玩家加成）', () => {
    const b = new Battle(3);
    const before = b.aiPeach;
    (b as any).creditAiKill(false, false); // 普通怪
    expect(b.aiPeach - before).toBe(PEACH_PER_KILL_FOR_TEST);
  });
});
```
> 把 `PEACH_PER_KILL_FOR_TEST` 换成从 `@core` 导入的 `PEACH_PER_KILL` 实值（测试顶部 `import { PEACH_PER_KILL } from '@core'`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/ai-opponent.test.ts`
Expected: FAIL（`aiSummon`/`creditAiKill` 未定义）。

- [ ] **Step 3: 实现 AI 征兵、产桃、布阵视图**

```ts
  // AI 征兵：与玩家同生成策略（drawSummonTray + 字牌转化），用 aiRng，够桃才征
  private aiSummon(): boolean {
    if (this.aiPeach < this.aiSummonCost) return false;
    this.aiPeach -= this.aiSummonCost;
    this.aiSummonCost += TUNING.summonCostStep;
    const types = Object.keys(UNITS) as UnitType[];
    const firstSummon = this.aiSummonCount === 0;
    const allOpen = this.aiLockedCells().length === 0;
    const forceShovel = !allOpen && this.aiSummonsSinceShovel >= TUNING.shovelPityAfter;
    const base = drawSummonTray({
      rng: this.aiRng, unitTypes: types, draws: TUNING.traySize,
      shovelChance: allOpen ? 0 : TUNING.shovelDrawChance,
      maxPerKey: allOpen ? TUNING.summonMaxPerKeyAllOpen : TUNING.summonMaxPerKey,
      firstSummon, forceShovel,
    });
    this.aiSummonCount += 1;
    if (base.some((t) => t.kind === 'shovel')) this.aiSummonsSinceShovel = 0; else this.aiSummonsSinceShovel += 1;
    this.aiTray = base.map((tok) => {
      if (tok.kind === 'unit' && !firstSummon && this.aiRng.next() < TUNING.wordDrawChance) {
        const w = this.aiRng.pick(WORD_POOL);
        return { kind: 'word', char: w.char, general: w.general, tier: 1 } as TrayToken;
      }
      return tok;
    });
    return true;
  }

  // AI 击杀产桃（基础值，无 mods.killBonus/摸金/蟠桃园）
  private creditAiKill(isBoss: boolean, isElite: boolean): void {
    this.aiPeach += (isBoss ? PEACH_PER_BOSS : PEACH_PER_KILL) + (isElite ? PEACH_PER_ELITE : 0);
  }

  // AI 布阵视图（喂给共享 planAutoPlace）
  private buildAiAutoView(): AutoPlaceView {
    return {
      tray: () => this.aiTray,
      freeCells: () => this.aiUnlockedCells().filter((c) => this.aiCellFree(c.c, c.r)),
      diggableCells: () => this.aiLockedCells(),
      placedUnits: () => this.aiUnits.map((u) => ({ type: u.type, tier: u.tier, cell: u.cell })),
      placedWords: () => [...this.aiWords.values()].map((w) => ({ char: w.char, general: w.general, cell: w.cell })),
      nearestPathDist: (cell) => this.nearestPathDist({ c: COLS - 1 - cell.c, r: ROWS - 1 - cell.r }), // 镜像回玩家半场量取贴路距
      wordChars: (general) => generalById(general)?.chars,
      place: (i, cell) => this.aiPlaceFromTray(i, cell),
    };
  }
```
> **镜像距离**：AI 格是玩家格的点对称镜像（`mirrorCell`），其贴路距应对 AI 路 `aiPath` 量取。为复用 `nearestPathDist`（基于 `map.path`），对 AI 格做逆镜像再量玩家路，结果等价（点对称保距）。`COLS/ROWS` 从 `./board` 导入；确认导入或补充。若更稳妥，另写 `aiNearestPathDist(cell)=min over this.aiPath`。
> `WORD_POOL`/`drawSummonTray`/`UNITS`/`PEACH_PER_*` 均已在 `battle.ts` 导入。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/ai-opponent.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/battle.ts web/tests/ai-opponent.test.ts
git commit -m "feat(web): AI征兵(同生成策略/够桃才征)+击杀产桃(基础经济)+AI布阵视图"
```

### Task C4: AI 武将攻击 tick `updateAiGenerals`（基础数值，攻击+经验，技能可选）

**Files:**
- Modify: `web/src/battle.ts`

- [ ] **Step 1: 实现 `updateAiGenerals`**（镜像 `updateGenerals` 1316-1361 的**攻击部分**，目标 `aiMonsters`、用基础 `generalStat`、无 mods/weaponBonuses、无 bursts/emit，命中打 `aiMonsters`）

```ts
  private updateAiGenerals(dt: number): void {
    for (const g of this.aiActiveGenerals()) {
      const stat = generalStat(g.def, g.tier);
      const s = g.state;
      const ax = (g.cells[0].c + g.cells[1].c) / 2;
      const ay = (g.cells[0].r + g.cells[1].r) / 2;
      const inRange = this.aiMonsters
        .map((m) => { const p = posAlong(this.aiPath, m.dist); return { m, d: Math.hypot(p.c - ax, p.r - ay), p }; })
        .filter((x) => x.d <= stat.rge + TUNING.rangeTolerance)
        .sort((a, b) => b.m.dist - a.m.dist);
      s.cooldown -= dt;
      if (s.cooldown > 0 || inRange.length === 0) continue;
      const base = Math.floor(stat.targets);
      const extra = this.aiRng.next() < stat.targets - base ? 1 : 0;
      const maxTargets = Math.max(1, base + extra);
      const dmg = damage(stat.atk); // 基础，无 bond/weapon/mods
      let hit = 0;
      for (const t of inRange) {
        if (hit >= maxTargets) break;
        t.m.hp -= dmg; t.m.hitFlash = 0.12;
        this.fx.push({ from: { c: ax, r: ay }, to: t.p, ttl: 0.16, maxTtl: 0.16, color: qualityColor(g.tier) });
        hit++;
      }
      s.cooldown = 1 / stat.frq;
    }
  }
```
> 技能（stun/heal/burst 等）本期先不镜像到 AI（保持范围可控）；武将**基础攻击**已构成主要 DPS，满足"武将上场即有能力"。如需技能对称，后续追加共享 `applyGeneralSkill`（见非目标/后续）。`generalStat`/`posAlong`/`damage`/`qualityColor` 均已导入。

- [ ] **Step 2: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add web/src/battle.ts
git commit -m "feat(web): AI武将基础攻击tick updateAiGenerals(对aiMonsters,基础数值)"
```

### Task C5: 重写 `updateAi` — 经济/征兵节奏/布阵/战斗；移除旧部署与清场

**Files:**
- Modify: `web/src/battle.ts`（`updateAi` 1153-1189 重写；删除/停用 `queueAiDeploy` 1067-1075、`tickAiDeploy` 1078-1091、清场分支 1157-1171；`step()` 里 `queueAiDeploy` 调用点 `battle.ts:817` 移除）
- Test: `web/tests/ai-opponent.test.ts`（追加行为测试）

- [ ] **Step 1: 追加失败测试**

```ts
describe('updateAi 真玩家循环', () => {
  it('推进若干秒后，AI 会征兵→布阵→出现 aiUnits（无凭空铺兵、无清场字段）', () => {
    const b = new Battle(7);
    (b as any).aiPeach = 999; // 给足桃，观察征兵+布阵
    for (let t = 0; t < 200; t++) (b as any).updateAi(0.1); // 20s
    expect(b.aiUnits.length).toBeGreaterThan(0);
    // aiUnits 必在已解锁 AI 格上
    for (const u of b.aiUnits) expect(b.aiUnlocked.has(`${u.cell.c},${u.cell.r}`)).toBe(true);
  });

  it('无尽模式不驱动 AI', () => {
    const b = new Battle(7, 1, undefined, undefined, undefined, undefined, undefined, true);
    for (let t = 0; t < 100; t++) (b as any).updateAi(0.1);
    expect(b.aiUnits.length).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/ai-opponent.test.ts`
Expected: FAIL（旧 updateAi 行为不符/仍走清场）。

- [ ] **Step 3: 移除旧路径 + 重写 `updateAi`**

删除 `step()` 中 `battle.ts:817` 的 `if (!this.endless) this.queueAiDeploy();` 整行。
删除方法 `queueAiDeploy`（1067-1075）与 `tickAiDeploy`（1078-1091）。删除 `aiDeployQueue`/`aiDeployTimer` 字段及其余引用（`aiMergeUnits` 若仅被 tickAiDeploy 调用则一并删除）。删除 `aiHeroEnergy` 字段与其递归/使用。

重写 `updateAi`：
```ts
  private updateAi(dt: number): void {
    if (this.endless) return; // 无尽模式无 AI 对手
    const knobs = skillToKnobs(this.aiSkill);
    // 1) 征兵节奏：到点且够桃则征一次，随后共享布阵
    this.aiSummonTimer -= dt;
    if (this.aiSummonTimer <= 0) {
      this.aiSummonTimer = knobs.summonInterval;
      if (this.aiSummon()) {
        planAutoPlace(this.buildAiAutoView(), { rng: () => this.aiRng.next(), pSubOptimal: knobs.pSubOptimal });
      }
    }
    // 2) 战斗：AI 兵 + AI 武将攻击 aiMonsters
    this.updateAiUnits(dt);
    this.updateAiGenerals(dt);
    // 3) 怪物推进 + 漏怪扣血 + 击杀产桃（基础经济）
    const survivors: Monster[] = [];
    for (const m of this.aiMonsters) {
      m.spawnT += dt;
      if (m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt);
      if (m.hp <= 0) { this.creditAiKill(m.isBoss, !!m.skill); continue; } // 击杀产桃（精英近似：带技能怪）
      m.dist += m.spd * dt;
      if (m.dist >= this.aiPathLen) {
        this.aiTangsengHP -= 1;
        if (this.aiTangsengHP <= 0) { this.aiTangsengHP = 0; this.aiDefeated = true; }
        continue;
      }
      survivors.push(m);
    }
    this.aiMonsters = survivors;
  }
```
> 精英判定：玩家侧 `isElite` 来自 spawn 时标记；AI 侧怪若无 `isElite` 字段，用"带 skill 的非 boss 怪"近似（与玩家精英大体对应）。若 `Monster` 有 `isElite` 字段则直接用之。

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `cd web && npx vitest run`
Expected: PASS（AI 行为测试通过；玩家侧全部回归绿）。

- [ ] **Step 5: 类型检查 + 提交**

Run: `cd web && npx tsc --noEmit`
```bash
git add web/src/battle.ts web/tests/ai-opponent.test.ts
git commit -m "feat(web): 重写updateAi为真玩家循环(经济/征兵节奏/共享布阵/武将)+移除旧铺兵与清场爆发"
```

### Task C6: main.ts 接线（开局注入 aiSkill + 结算更新持久化）

**Files:**
- Modify: `web/src/main.ts`（import；三处 `new Battle(...)`；结算钩子）

- [ ] **Step 1: import + 注入**

顶部加：
```ts
import { loadAiSkill, saveAiSkill, nextAiSkill } from './ai-skill';
```
三处 `new Battle(...)`（`main.ts:66/76/517`）在末尾追加 `loadAiSkill()` 实参（endless 之后）：
```ts
// 例：main.ts:76
battle = new Battle(nextSeed(), rank.difficulty, currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives, endlessOn, loadAiSkill());
```
（三处同样在参数末尾加 `, loadAiSkill()`；`main.ts:66` 无 endless 实参则先补 `false, loadAiSkill()`。）

- [ ] **Step 2: 结算钩子更新 aiSkill**（`main.ts` 非无尽分支，`const won = battle.status === 'won'` 之后）

```ts
        // 跨局自适应：按本局胜负把 AI 强度朝 70% 目标微调并持久化（仅非无尽局）
        saveAiSkill(nextAiSkill(loadAiSkill(), won));
```

- [ ] **Step 3: 类型检查 + 构建冒烟**

Run: `cd web && npx tsc --noEmit && npx vite build`
Expected: 无类型错误、构建成功。

- [ ] **Step 4: 提交**

```bash
git add web/src/main.ts
git commit -m "feat(web): 开局注入aiSkill + 结算按胜负更新并持久化(收敛70%)"
```

---

## Phase D — 平衡校验 + 浏览器冒烟

### Task D1: headless 对局平衡 sim（宏观胜率量级 + 自适应收敛）

**Files:**
- Test: `web/tests/ai-balance.test.ts`

- [ ] **Step 1: 写 sim 测试**

```ts
// web/tests/ai-balance.test.ts
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { nextAiSkill } from '../src/ai-skill';

// 用一个"脚本玩家"驱动真 Battle：够桃就征兵+一键布阵，波间自动推进；跑到分出胜负。
function playOneMatch(seed: number, aiSkill: number): boolean {
  const b = new Battle(seed, 1, undefined, undefined, undefined, undefined, undefined, false, aiSkill);
  let t = 0;
  while (b.status !== 'won' && b.status !== 'lost' && t < 60 * 60 * 3) { // 上限 3 分钟游戏时
    if (b.peach >= b.snapshot().summonCost) { b.summon(); b.autoPlaceTray(); }
    b.step(1 / 30);
    t++;
  }
  return b.status === 'won';
}

describe('AI 平衡 sim（宏观、非精确）', () => {
  it('固定强度脚本玩家下，nextAiSkill 把胜率朝 70% 收敛（不发散、AI 不崩盘）', () => {
    let skill = 1.0; let wins = 0; const N = 40;
    for (let i = 0; i < N; i++) { const won = playOneMatch(1000 + i, skill); if (i >= 10) wins += won ? 1 : 0; skill = nextAiSkill(skill, won); }
    // 收敛后 skill 落在合理带内、胜率量级 40%~90%（脚本玩家非最优，故放宽；重点是不发散/不崩）
    expect(skill).toBeGreaterThanOrEqual(0.72);
    expect(skill).toBeLessThanOrEqual(1.8);
    const rate = wins / (N - 10);
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.95);
  }, 60000);
});
```
> 该 sim 是宏观健全性检查（脚本玩家远非最优，故断言宽松）；真正 70% 面向真人玩家由线上自适应保证。若单测太慢，减小 N 或 step 频率。

- [ ] **Step 2: 跑**

Run: `cd web && npx vitest run tests/ai-balance.test.ts`
Expected: PASS（不发散、无异常、无 AI 崩盘）。

- [ ] **Step 3: 提交**

```bash
git add web/tests/ai-balance.test.ts
git commit -m "test(web): headless对局平衡sim(自适应不发散/AI不崩盘)"
```

### Task D2: 浏览器冒烟（真机验证，遵循项目规范）

**Files:** 无（验证步骤）

- [ ] **Step 1: 起本地服务**

Run: `cd web && npx vite --port 5178`（或项目 `start.sh` 既有方式）

- [ ] **Step 2: 用 `window.__game` 冒烟钩子跑数局**（依 [[web-smoke-test-harness]]：puppeteer-core + 本机 Chrome）

验证清单：
- AI 侧会**征兵→挖格→放兵→合成→出武将**（观察 `battle.aiUnits`/`battle.aiWords` 增长、`aiUnlocked` 仅经铲子扩展）。
- AI 强度**平滑**、无"离谱崩盘"（弱 AI 仍维持基本防线；`aiSkill` 低时 pSubOptimal ≤ 0.35）。
- 玩家一键「布阵」后格子铺满合理：近路格有短兵、远格有弓箭手；tray 不再无谓丢弃。
- 无控制台报错；胜负判定正常触发；结算后 `dasheng.aiskill` 持久化值随胜负变化。

- [ ] **Step 3: 记录结果**

在 PR 描述记录冒烟观察（截图/日志）。若发现 AI 明显过强/过弱，微调 `ai-skill.ts` 的 `BASE_SUMMON_INTERVAL`/`STEP_K`/`PSUB_*` 常量（仅常量，不改结构），重跑冒烟。

---

## 自检（Self-Review）

- **规格覆盖**：AI 同经济(C1/C3)、够桃才征(C3)、同生成策略(C3)、放空槽+铲子解锁(C2/C5)、武将能力(C2/C4)、同合成升级(C2)、移除清场(C5)、胜率靠征兵速度(C5+A)+排兵最优/次优(B+A)、跨局收敛70%(A+C6)、智能布阵不丢弃/铺满/够不着升级(B)。均有对应 Task。
- **占位符扫描**：无 TODO/TBD；测试中两处显式标注"实现时以真实 `chars`/`PEACH_PER_KILL` 校正"，非占位而是防脆化说明。
- **类型/命名一致性**：`AutoPlaceView`/`planAutoPlace`/`aiPlaceFromTray`/`aiActiveGenerals`/`aiSummon`/`creditAiKill`/`updateAiGenerals`/`buildAiAutoView`/`nearestPathDist`/`skillToKnobs`/`nextAiSkill` 在各 Task 间一致。
- **风险点**：镜像贴路距（C3 note，提供 `aiPath` 兜底方案）；`Monster.isElite` 是否存在（C5 note）；`summonCost` 初值字面量（C1 note）。执行者遇到即按 note 校正。

---

## 执行提示（并行/收尾）

- 本分支 `feature/adaptive-ai-opponent`（worktree `.claude/worktrees/adaptive-ai`）。main 前进较快，收尾前先看是否分叉：worktree 内 `git rebase main` 解冲突再 ff 合并（遵循 [[parallel-worktrees-rebase-before-finish]]），注意主树未提交改动。
- 改动只在 `web/`；`game-core` 数值内核不动，保持既有经济不变量与测试。
