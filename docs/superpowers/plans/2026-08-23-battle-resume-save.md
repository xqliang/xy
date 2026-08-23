# 本地续玩存档（AI对战/无尽·波次检查点）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让本地 AI 对战 / 无尽对局在刷新或关闭页面后，下次打开自动从"上次那一波的开头"继续（波次检查点存档），在线 PvP 不受影响。

**Architecture:** 只在 `status==='ready'`（两波之间、场上无怪无飞行物）把 `Battle` 全量核心可变状态序列化进 localStorage；启动时若有有效存档则重建 `Battle`（构造重建地图几何 → `applyCoreState` 覆盖全部可变字段 + 回填 4 条 RNG 内部状态）直接进战斗界面。序列化/恢复放在 `battle.ts`（可访问私有字段），存储编排放新模块 `battle-save.ts`，`main.ts` 三处接线（存/清/取）。

**Tech Stack:** TypeScript + Vite + Canvas；vitest（node 环境，需内存 localStorage shim）；跨平台 KV 层 `storage.ts`（Web=localStorage / 微信=wx）。

**关键约束（务必遵守）：**
- 所有存/取/清入口都以 `!battle.isPvp` 为前提；在线 PvP 局永不落档。
- 恢复走"构造传中性参数（`NO_META`/空阵容/默认 aiSkill）→ `applyCoreState` 覆盖"，避免 meta/被动/aiSkill 二次叠加。
- 不改任何战斗数值/AI 决策/波次生成逻辑；仅新增只读序列化 + RNG 访问器 + 接线。
- 测试放 `web/tests/`（vitest include 只收 `tests/**`），命令在 `web/` 下跑。
- 触碰 `battle.ts`，收尾必过 `ai-balance` 门禁；typecheck 看"不新增报错"（基线本就有 ~28 处既有报错）。

**关键源码坐标（基线 `e41f032`，行号可能漂移，另给符号锚点）：**
- `web/src/rng.ts`：`RNG` 类，私有 `s`（rng.ts:3），无访问器。
- `web/src/battle.ts`：`Battle` 构造 `:2274`（12 参，末位 `pvpInit?`）；4 条 RNG 播种 `:2301-2307`（`rng/aiRng/aiSpawnRng/bossScheduleRng`）；`get isPvp()` `:2248`（真实字段 private `pvp` `:2246`）；`NO_META` 导出 `:902`；`snapshot()` `:7820`（仅诊断，勿复用）；readonly 字段 `map/difficultyMul/endless/pathLen/aiPath/aiTangseng/aiCells/aiUnlocked`。
- `web/src/board.ts`：`mapById(id)` `:314`，`GameMap.id` `:23`。
- `web/src/ai-skill.ts`：`DEFAULT_AI_SKILL` `:32`，`VersusRubberBand` 类型 `:13`。
- `web/src/version.ts`：`APP_VERSION`。
- `web/src/main.ts`：本地步进 `else { battle.step(dt); }` `:2391-2393`；胜负结算块 `:2409-2410`（已带 `&& !pvpSock`）；`abortBattleToMenu()`（含 `endPvpSession()`）；`newGame()` `:1157`（`endHandled=false` `:1162`）；启动 IIFE `screen='menu'` `:489`（其后 `if (versusCode) enterPvpMatching('join', versusCode)`）；`bindBattleWeaponPickup()` `:1542`；`currentMap`（可变 let）`:596`；`__game` hook `:2648`（`get battle()`、`restart()`、`wave()`、`summon()`、`autoPlace()`）。

---

## File Structure

- **Create** `web/src/battle-save.ts` — 存档结构 `BattleSaveV1` + 版本常量 + `writeBattleSave/readBattleSave/clearBattleSave/saveResumeCheckpoint/loadResumeBattle`；唯一 localStorage 编排点；含 `isPvp`/版本/终局 守卫与写入去重。
- **Modify** `web/src/rng.ts` — 给 `RNG` 加 `getState()/setState()`（唯一引擎源码能力扩展）。
- **Modify** `web/src/battle.ts` — 导出 `BattleSaveConfig`/`BattleCoreState` 接口 + `Battle.serialize()` + `Battle.applyCoreState()`。
- **Modify** `web/src/main.ts` — 三处接线（主循环存、终局/退出/开新局清、启动取）+ 一个 `__game.resumeProbe()` 冒烟钩子。
- **Create tests** `web/tests/rng-state.test.ts`、`web/tests/battle-resume-serialize.test.ts`、`web/tests/battle-save.test.ts`。
- **Create** `web/scripts/smoke-resume.mjs` — puppeteer-core 浏览器冒烟。

---

## Task 0: 工作区准备（vitest 依赖）

worktree 的 `web/node_modules` 是 gitignore、初始不存在；软链主 checkout 的即可（幂等）。

- [ ] **Step 1: 软链 node_modules（若缺）**

Run:
```bash
MAIN=/Users/jyxc-dz-0100360/work/fun/xy
WT=/Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/battle-resume-save
[ -e "$WT/web/node_modules" ] || ln -s "$MAIN/web/node_modules" "$WT/web/node_modules"
cd "$WT/web" && npx vitest run tests/endless.test.ts 2>&1 | tail -5
```
Expected: `Test Files 1 passed`（证明 worktree 内 vitest 可发现并运行）。

---

## Task 1: RNG 内部状态存取（rng.ts）

**Files:**
- Modify: `web/src/rng.ts`
- Test: `web/tests/rng-state.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/tests/rng-state.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { RNG } from '../src/rng';

describe('RNG 内部状态存取', () => {
  it('setState(getState()) 后 next() 序列完全一致', () => {
    const a = new RNG(12345);
    for (let i = 0; i < 10; i++) a.next(); // 推进若干步
    const s = a.getState();
    const b = new RNG(1);
    b.setState(s);
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 20; i++) { seqA.push(a.next()); seqB.push(b.next()); }
    expect(seqB).toEqual(seqA);
  });

  it('getState 返回 uint32（可 JSON）', () => {
    const r = new RNG(7);
    r.next();
    const s = r.getState();
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/rng-state.test.ts`
Expected: FAIL —「getState is not a function」。

- [ ] **Step 3: 加访问器**

在 `web/src/rng.ts` 的 `pick<T>(...)` 方法后、类结束 `}` 前插入：
```ts
  /** 读取内部推进状态（对局存档用）。返回 uint32。 */
  getState(): number { return this.s >>> 0; }
  /** 写回内部推进状态（存档恢复用）。 */
  setState(v: number): void { this.s = v >>> 0; }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/rng-state.test.ts`
Expected: PASS（2 tests）。

- [ ] **Step 5: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/battle-resume-save
git add web/src/rng.ts web/tests/rng-state.test.ts
git commit -m "feat(rng): RNG 加 getState/setState，供对局存档恢复随机流"
```

---

## Task 2: Battle 序列化 / 恢复（battle.ts）

**Files:**
- Modify: `web/src/battle.ts`（导出两个接口 + 在 `Battle` 类体内加 `serialize()`/`applyCoreState()`，建议紧挨现有 `snapshot()` 方法）
- Test: `web/tests/battle-resume-serialize.test.ts`

> 字段权威来源：见下 `BattleCoreState`。`serialize()` 采集的字段集合必须与 `applyCoreState()` 恢复的集合**完全一致**（Step 4 的 `toEqual(save.core)` 测试会强制这一点）。

- [ ] **Step 1: 写失败测试（往返一致 + 恢复后确定性等价）**

Create `web/tests/battle-resume-serialize.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';
import { userAgentTick } from '../src/versus-user-agent';

// 构造一个本地 AI 对战局（endless=false）。map 用固定图，seed 固定以复现。
function newVersus(seed: number): Battle {
  return new Battle(seed, 1, mapById('huoyanshan'), undefined, undefined, undefined, undefined, false, 1.0, 1);
}

// 驱动到"清完第 1 波后的 ready 检查点"并冻结（不再 step）。
function driveToReadyAfterWave1(b: Battle): void {
  const dt = 1 / 30;
  for (let f = 0; f < 30 * 300; f++) { // 上限 ~300s sim，防挂
    if (b.status === 'ready') {
      if (b.wave >= 1) return;   // 已清 ≥1 波、停在 ready → 波次检查点
      b.startNextWave();         // 从 intro/波间 ready 起手开波
    } else {
      userAgentTick(b);          // playing：征兵/布阵/放技能（确定性，用 battle 内 RNG）
    }
    b.step(dt);
    if (b.status === 'won' || b.status === 'lost') throw new Error('对局在检查点前已终局');
  }
  throw new Error('未能在上限内到达 wave≥1 的 ready');
}

describe('Battle 序列化/恢复', () => {
  it('serialize → JSON 往返 → applyCoreState 后再 serialize 完全相等', () => {
    const a = newVersus(20260823);
    driveToReadyAfterWave1(a);
    const dumped = JSON.parse(JSON.stringify(a.serialize())); // 模拟落 localStorage
    const b = new Battle(1, dumped.config.difficultyMul, mapById(dumped.config.mapId),
      undefined, undefined, undefined, undefined, dumped.config.endless, undefined, dumped.config.aiAdjustIntervalScale);
    b.applyCoreState(dumped.core);
    expect(b.serialize().core).toEqual(dumped.core); // 全字段保真：serialize∘apply 在 JSON 后是恒等
  });

  it('恢复后与原局同输入步进 → 观测量一致（证明无遗漏 sim 字段 + RNG 正确）', () => {
    const a = newVersus(11111);
    driveToReadyAfterWave1(a);
    const dumped = JSON.parse(JSON.stringify(a.serialize()));
    const b = new Battle(1, dumped.config.difficultyMul, mapById(dumped.config.mapId),
      undefined, undefined, undefined, undefined, dumped.config.endless, undefined, dumped.config.aiAdjustIntervalScale);
    b.applyCoreState(dumped.core);

    const dt = 1 / 30;
    for (let f = 0; f < 30 * 40; f++) { // 继续打 ~40s：会开第 2 波并交火
      if (a.status === 'ready') a.startNextWave(); else userAgentTick(a);
      if (b.status === 'ready') b.startNextWave(); else userAgentTick(b);
      a.step(dt); b.step(dt);
      if (a.status === 'won' || a.status === 'lost') break;
    }
    const sa = a.snapshot();
    const sb = b.snapshot();
    expect(sb.wave).toBe(sa.wave);
    expect(sb.status).toBe(sa.status);
    expect(sb.tangsengHP).toBeCloseTo(sa.tangsengHP, 5);
    expect(sb.aiHp).toBeCloseTo(sa.aiHp, 5);
    expect(sb.units).toBe(sa.units);       // snapshot.units = 数量
    expect(sb.monsters).toBe(sa.monsters); // snapshot.monsters = 数量
  });

  it('无尽局同样可往返（endless=true）', () => {
    const a = new Battle(999, 1, mapById('huoyanshan'), undefined, undefined, undefined, undefined, true, 1.0, 1);
    driveToReadyAfterWave1(a);
    const dumped = JSON.parse(JSON.stringify(a.serialize()));
    const b = new Battle(1, dumped.config.difficultyMul, mapById(dumped.config.mapId),
      undefined, undefined, undefined, undefined, dumped.config.endless, undefined, dumped.config.aiAdjustIntervalScale);
    b.applyCoreState(dumped.core);
    expect(b.serialize().core).toEqual(dumped.core);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/battle-resume-serialize.test.ts`
Expected: FAIL —「serialize is not a function」。

- [ ] **Step 3: 加接口定义（battle.ts，`Battle` 类外，与其它导出类型并列）**

```ts
/** 重建对局几何/骨架所需的构造参数（其余状态由 core 覆盖）。 */
export interface BattleSaveConfig {
  mapId: string;
  difficultyMul: number;
  endless: boolean;
  aiAdjustIntervalScale: number;
}

/** 波次检查点的全量核心可变状态。Map→[k,v][]、Set→值数组、RNG→uint32。 */
export interface BattleCoreState {
  // A1 血量/波数/状态
  tangsengHP: number; tangsengMaxHP: number; aiTangsengHP: number; aiDefeated: boolean;
  tangsengHurtImmuneT: number; aiTangsengHurtImmuneT: number;
  healUsedThisWave: boolean; aiHealUsedThisWave: boolean;
  wave: number; status: Status; waveActive: boolean;
  introT: number; introDone: boolean; nextWaveTimer: number;
  // A2 经济
  peach: number; aiPeach: number; shovels: number; aiShovels: number;
  summonCost: number; aiSummonCost: number; summonCount: number; aiSummonCount: number;
  summonsSinceShovel: number; summonsSinceWord: number; summonsSincePair: number;
  earlySummonWordsCap: number; earlySummonWordsGuarantee: number; earlySummonShovels: number;
  aiSummonsSinceShovel: number; aiSummonsSinceWord: number; aiSummonsSincePair: number;
  aiEarlySummonWordsCap: number; aiEarlySummonWordsGuarantee: number; aiEarlySummonShovels: number;
  wordCharCounts: [string, number][]; aiWordCharCounts: [string, number][];
  aiSummonTimer: number; shovelTimer: number; aiShovelTimer: number;
  plantTimer: number; plantBank: number; gardenOn: boolean;
  // A3 棋盘/怪物
  units: [string, PlacedUnit][]; words: [string, PlacedWord][]; trees: [string, PeachTree][];
  unlocked: string[]; generalStates: [string, GeneralState][];
  aiUnits: PlacedUnit[]; aiWords: [string, PlacedWord][]; aiUnlocked: string[];
  aiGeneralStates: [string, GeneralState][];
  lastActivePairKeys: string[]; lastAiActivePairKeys: string[];
  tray: TrayToken[]; aiTray: TrayToken[];
  monsters: Monster[]; aiMonsters: Monster[]; nextMonsterId: number;
  bombs: { c: number; r: number; t: number }[]; aiBombs: { c: number; r: number; t: number }[];
  // A4 波次调度（sinceLastElite: Infinity→null，恢复时还原）
  spawnRemaining: number; spawnTimer: number; waveMonsterCount: number;
  sinceLastElite: number | null; cavalryWave: boolean; cavalryWaveRatio: number;
  waveMiniBoss: MiniBossKind | null; miniBossSpawnIdx: number;
  wavePressure: PressurePlan | null; heroBossTimer: number; heroBossSpawnsThisWave: number;
  bossWaves: number[]; bossScheduleThrough: number;
  // A5 buff/技能/道具
  mods: Modifiers; aiMods: Modifiers; aiFrqMul: number;
  activeSlots: { id: string; cd: number; cdMax: number; ready: boolean; flash: number }[];
  aiActiveSlots: { id: string; cd: number; cdMax: number; ready: boolean; flash: number }[];
  aiOffensiveDelay: Partial<Record<'meteor' | 'jinggu' | 'bomb', number>>;
  meteorPending: boolean; aiMeteorPending: boolean;
  pickedItems: string[]; aiPickedItems: string[]; passivesFlashedAtStart: boolean;
  // A6 掉落/配对/AI 簿记
  pendingWeaponPickups: string[]; battleFragmentDropId: string | null; battleFragmentDropped: boolean;
  matchedHeroIdsThisGame: string[]; aiMatchedHeroIdsThisGame: string[];
  heroMatchWaves: number[]; aiHeroMatchWaves: number[];
  forceMatchThisGame: boolean; aiForceMatchThisGame: boolean;
  recentMatchedHeroIds: string[];
  aiRepositionTimer: number; aiLastRepositionPair: { a: Cell; b: Cell } | null; wasDangerNear: boolean;
  // A7 强度
  aiSkill: number; versusBand: VersusRubberBand;
  weaponBonuses: WeaponBonuses; aiWeaponBonuses: WeaponBonuses;
  // A8 RNG（4 条内部状态）
  rngS: number; aiRngS: number; aiSpawnRngS: number; bossScheduleRngS: number;
}
```
> 上述类型 `Status/PlacedUnit/PlacedWord/PeachTree/GeneralState/Monster/TrayToken/Modifiers/MiniBossKind/PressurePlan/Cell/VersusRubberBand/WeaponBonuses` 在 `battle.ts` 内均已在作用域（本文件定义或已 import），无需新增 import。

- [ ] **Step 4: 实现 `serialize()` 与 `applyCoreState()`（在 `Battle` 类体内，紧邻 `snapshot()`）**

```ts
  /** 采集波次检查点全量核心状态（Map/Set→数组、RNG→uint32）。产物须经 JSON 落盘后再交给 applyCoreState。 */
  serialize(): { config: BattleSaveConfig; core: BattleCoreState } {
    return {
      config: {
        mapId: this.map.id,
        difficultyMul: this.difficultyMul,
        endless: this.endless,
        aiAdjustIntervalScale: this.aiAdjustIntervalScale,
      },
      core: {
        tangsengHP: this.tangsengHP, tangsengMaxHP: this.tangsengMaxHP, aiTangsengHP: this.aiTangsengHP,
        aiDefeated: this.aiDefeated, tangsengHurtImmuneT: this.tangsengHurtImmuneT,
        aiTangsengHurtImmuneT: this.aiTangsengHurtImmuneT, healUsedThisWave: this.healUsedThisWave,
        aiHealUsedThisWave: this.aiHealUsedThisWave, wave: this.wave, status: this.status,
        waveActive: this.waveActive, introT: this.introT, introDone: this.introDone, nextWaveTimer: this.nextWaveTimer,
        peach: this.peach, aiPeach: this.aiPeach, shovels: this.shovels, aiShovels: this.aiShovels,
        summonCost: this.summonCost, aiSummonCost: this.aiSummonCost, summonCount: this.summonCount, aiSummonCount: this.aiSummonCount,
        summonsSinceShovel: this.summonsSinceShovel, summonsSinceWord: this.summonsSinceWord, summonsSincePair: this.summonsSincePair,
        earlySummonWordsCap: this.earlySummonWordsCap, earlySummonWordsGuarantee: this.earlySummonWordsGuarantee, earlySummonShovels: this.earlySummonShovels,
        aiSummonsSinceShovel: this.aiSummonsSinceShovel, aiSummonsSinceWord: this.aiSummonsSinceWord, aiSummonsSincePair: this.aiSummonsSincePair,
        aiEarlySummonWordsCap: this.aiEarlySummonWordsCap, aiEarlySummonWordsGuarantee: this.aiEarlySummonWordsGuarantee, aiEarlySummonShovels: this.aiEarlySummonShovels,
        wordCharCounts: [...this.wordCharCounts], aiWordCharCounts: [...this.aiWordCharCounts],
        aiSummonTimer: this.aiSummonTimer, shovelTimer: this.shovelTimer, aiShovelTimer: this.aiShovelTimer,
        plantTimer: this.plantTimer, plantBank: this.plantBank, gardenOn: this.gardenOn,
        units: [...this.units], words: [...this.words], trees: [...this.trees],
        unlocked: [...this.unlocked], generalStates: [...this.generalStates],
        aiUnits: this.aiUnits, aiWords: [...this.aiWords], aiUnlocked: [...this.aiUnlocked],
        aiGeneralStates: [...this.aiGeneralStates],
        lastActivePairKeys: [...this.lastActivePairKeys], lastAiActivePairKeys: [...this.lastAiActivePairKeys],
        tray: this.tray, aiTray: this.aiTray, monsters: this.monsters, aiMonsters: this.aiMonsters,
        nextMonsterId: this.nextMonsterId, bombs: this.bombs, aiBombs: this.aiBombs,
        spawnRemaining: this.spawnRemaining, spawnTimer: this.spawnTimer, waveMonsterCount: this.waveMonsterCount,
        sinceLastElite: Number.isFinite(this.sinceLastElite) ? this.sinceLastElite : null,
        cavalryWave: this.cavalryWave, cavalryWaveRatio: this.cavalryWaveRatio,
        waveMiniBoss: this.waveMiniBoss, miniBossSpawnIdx: this.miniBossSpawnIdx,
        wavePressure: this.wavePressure, heroBossTimer: this.heroBossTimer, heroBossSpawnsThisWave: this.heroBossSpawnsThisWave,
        bossWaves: [...this.bossWaves], bossScheduleThrough: this.bossScheduleThrough,
        mods: this.mods, aiMods: this.aiMods, aiFrqMul: this.aiFrqMul,
        activeSlots: this.activeSlots, aiActiveSlots: this.aiActiveSlots, aiOffensiveDelay: this.aiOffensiveDelay,
        meteorPending: this.meteorPending, aiMeteorPending: this.aiMeteorPending,
        pickedItems: this.pickedItems, aiPickedItems: this.aiPickedItems, passivesFlashedAtStart: this.passivesFlashedAtStart,
        pendingWeaponPickups: this.pendingWeaponPickups, battleFragmentDropId: this.battleFragmentDropId, battleFragmentDropped: this.battleFragmentDropped,
        matchedHeroIdsThisGame: [...this.matchedHeroIdsThisGame], aiMatchedHeroIdsThisGame: [...this.aiMatchedHeroIdsThisGame],
        heroMatchWaves: this.heroMatchWaves, aiHeroMatchWaves: this.aiHeroMatchWaves,
        forceMatchThisGame: this.forceMatchThisGame, aiForceMatchThisGame: this.aiForceMatchThisGame,
        recentMatchedHeroIds: [...this.recentMatchedHeroIds],
        aiRepositionTimer: this.aiRepositionTimer, aiLastRepositionPair: this.aiLastRepositionPair, wasDangerNear: this.wasDangerNear,
        aiSkill: this.aiSkill, versusBand: this.versusBand, weaponBonuses: this.weaponBonuses, aiWeaponBonuses: this.aiWeaponBonuses,
        rngS: this.rng.getState(), aiRngS: this.aiRng.getState(), aiSpawnRngS: this.aiSpawnRng.getState(), bossScheduleRngS: this.bossScheduleRng.getState(),
      },
    };
  }

  /** 用存档核心状态覆盖当前实例（入参须为 JSON 往返后的纯数据）。特效字段留空由 step() 重建。 */
  applyCoreState(c: BattleCoreState): void {
    // 标量/布尔/枚举/纯数组/纯对象：直接赋值（parse 后已是新对象）
    this.tangsengHP = c.tangsengHP; this.tangsengMaxHP = c.tangsengMaxHP; this.aiTangsengHP = c.aiTangsengHP;
    this.aiDefeated = c.aiDefeated; this.tangsengHurtImmuneT = c.tangsengHurtImmuneT;
    this.aiTangsengHurtImmuneT = c.aiTangsengHurtImmuneT; this.healUsedThisWave = c.healUsedThisWave;
    this.aiHealUsedThisWave = c.aiHealUsedThisWave; this.wave = c.wave; this.status = c.status;
    this.waveActive = c.waveActive; this.introT = c.introT; this.introDone = c.introDone; this.nextWaveTimer = c.nextWaveTimer;
    this.peach = c.peach; this.aiPeach = c.aiPeach; this.shovels = c.shovels; this.aiShovels = c.aiShovels;
    this.summonCost = c.summonCost; this.aiSummonCost = c.aiSummonCost; this.summonCount = c.summonCount; this.aiSummonCount = c.aiSummonCount;
    this.summonsSinceShovel = c.summonsSinceShovel; this.summonsSinceWord = c.summonsSinceWord; this.summonsSincePair = c.summonsSincePair;
    this.earlySummonWordsCap = c.earlySummonWordsCap; this.earlySummonWordsGuarantee = c.earlySummonWordsGuarantee; this.earlySummonShovels = c.earlySummonShovels;
    this.aiSummonsSinceShovel = c.aiSummonsSinceShovel; this.aiSummonsSinceWord = c.aiSummonsSinceWord; this.aiSummonsSincePair = c.aiSummonsSincePair;
    this.aiEarlySummonWordsCap = c.aiEarlySummonWordsCap; this.aiEarlySummonWordsGuarantee = c.aiEarlySummonWordsGuarantee; this.aiEarlySummonShovels = c.aiEarlySummonShovels;
    this.aiSummonTimer = c.aiSummonTimer; this.shovelTimer = c.shovelTimer; this.aiShovelTimer = c.aiShovelTimer;
    this.plantTimer = c.plantTimer; this.plantBank = c.plantBank; this.gardenOn = c.gardenOn;
    this.aiUnits = c.aiUnits; this.tray = c.tray; this.aiTray = c.aiTray; this.monsters = c.monsters; this.aiMonsters = c.aiMonsters;
    this.nextMonsterId = c.nextMonsterId; this.bombs = c.bombs; this.aiBombs = c.aiBombs;
    this.spawnRemaining = c.spawnRemaining; this.spawnTimer = c.spawnTimer; this.waveMonsterCount = c.waveMonsterCount;
    this.sinceLastElite = c.sinceLastElite == null || !Number.isFinite(c.sinceLastElite) ? Number.POSITIVE_INFINITY : c.sinceLastElite;
    this.cavalryWave = c.cavalryWave; this.cavalryWaveRatio = c.cavalryWaveRatio;
    this.waveMiniBoss = c.waveMiniBoss; this.miniBossSpawnIdx = c.miniBossSpawnIdx;
    this.wavePressure = c.wavePressure; this.heroBossTimer = c.heroBossTimer; this.heroBossSpawnsThisWave = c.heroBossSpawnsThisWave;
    this.bossScheduleThrough = c.bossScheduleThrough;
    this.mods = c.mods; this.aiMods = c.aiMods; this.aiFrqMul = c.aiFrqMul;
    this.activeSlots = c.activeSlots; this.aiActiveSlots = c.aiActiveSlots; this.aiOffensiveDelay = c.aiOffensiveDelay;
    this.meteorPending = c.meteorPending; this.aiMeteorPending = c.aiMeteorPending;
    this.pickedItems = c.pickedItems; this.aiPickedItems = c.aiPickedItems; this.passivesFlashedAtStart = c.passivesFlashedAtStart;
    this.pendingWeaponPickups = c.pendingWeaponPickups; this.battleFragmentDropId = c.battleFragmentDropId; this.battleFragmentDropped = c.battleFragmentDropped;
    this.heroMatchWaves = c.heroMatchWaves; this.aiHeroMatchWaves = c.aiHeroMatchWaves;
    this.forceMatchThisGame = c.forceMatchThisGame; this.aiForceMatchThisGame = c.aiForceMatchThisGame;
    this.recentMatchedHeroIds = c.recentMatchedHeroIds;
    this.aiRepositionTimer = c.aiRepositionTimer; this.aiLastRepositionPair = c.aiLastRepositionPair; this.wasDangerNear = c.wasDangerNear;
    this.aiSkill = c.aiSkill; this.versusBand = c.versusBand; this.weaponBonuses = c.weaponBonuses; this.aiWeaponBonuses = c.aiWeaponBonuses;
    // Map：数组重建（parse 后的值对象已独立，无需再深拷贝）
    this.units = new Map(c.units); this.words = new Map(c.words); this.trees = new Map(c.trees);
    this.generalStates = new Map(c.generalStates); this.aiWords = new Map(c.aiWords); this.aiGeneralStates = new Map(c.aiGeneralStates);
    this.wordCharCounts = new Map(c.wordCharCounts); this.aiWordCharCounts = new Map(c.aiWordCharCounts);
    // Set（可重新赋值的）
    this.unlocked = new Set(c.unlocked);
    this.lastActivePairKeys = new Set(c.lastActivePairKeys); this.lastAiActivePairKeys = new Set(c.lastAiActivePairKeys);
    this.matchedHeroIdsThisGame = new Set(c.matchedHeroIdsThisGame); this.aiMatchedHeroIdsThisGame = new Set(c.aiMatchedHeroIdsThisGame);
    this.bossWaves = new Set(c.bossWaves);
    // aiUnlocked 是 readonly 绑定：只能清空后逐个 add，不能整体赋值
    this.aiUnlocked.clear(); for (const k of c.aiUnlocked) this.aiUnlocked.add(k);
    // 4 条 RNG 内部状态回填
    this.rng.setState(c.rngS); this.aiRng.setState(c.aiRngS); this.aiSpawnRng.setState(c.aiSpawnRngS); this.bossScheduleRng.setState(c.bossScheduleRngS);
  }
```
> 若某字段 TS 报「找不到属性 / 类型不符」，按 `battle.ts` 字段区实际声明校正名字与类型（本清单据基线 `e41f032` 提取；`map/difficultyMul/endless` 等 readonly 字段**不在**覆盖列表内，勿动）。

- [ ] **Step 5: 跑测试，迭代到通过**

Run: `cd web && npx vitest run tests/battle-resume-serialize.test.ts`
Expected: 最终 PASS（3 tests）。若「恢复后确定性等价」失败 → 说明有 sim 相关字段未纳入 serialize/apply，按报错定位补齐；若 `toEqual(save.core)` 失败 → serialize 与 apply 的字段集合不一致，对齐两处。

- [ ] **Step 6: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/battle-resume-save
git add web/src/battle.ts web/tests/battle-resume-serialize.test.ts
git commit -m "feat(battle): Battle.serialize/applyCoreState 全量核心状态往返（波次检查点）"
```

---

## Task 3: 存档存储模块（battle-save.ts）

**Files:**
- Create: `web/src/battle-save.ts`
- Test: `web/tests/battle-save.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/tests/battle-save.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';
import { userAgentTick } from '../src/versus-user-agent';
import { writeBattleSave, readBattleSave, clearBattleSave, saveResumeCheckpoint, loadResumeBattle, SAVE_KEY } from '../src/battle-save';
import { storeGet, storeSet } from '../src/storage';

// 仿 play-history.test.ts：node 环境无 localStorage，装内存版。
function installMemStorage(): void {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  } as Storage;
}

function readyVersus(seed: number, endless = false): Battle {
  const b = new Battle(seed, 1, mapById('huoyanshan'), undefined, undefined, undefined, undefined, endless, 1.0, 1);
  const dt = 1 / 30;
  for (let f = 0; f < 30 * 300; f++) {
    if (b.status === 'ready') { if (b.wave >= 1) return b; b.startNextWave(); }
    else userAgentTick(b);
    b.step(dt);
    if (b.status === 'won' || b.status === 'lost') throw new Error('检查点前终局');
  }
  throw new Error('未到 ready');
}

describe('battle-save 存档编排', () => {
  beforeEach(() => { installMemStorage(); clearBattleSave(); });

  it('write → read 往返：mode/config/core 一致', () => {
    const b = readyVersus(20260823);
    writeBattleSave(b);
    const save = readBattleSave();
    expect(save).not.toBeNull();
    expect(save!.mode).toBe('versus');
    expect(save!.config.endless).toBe(false);
    expect(save!.core.wave).toBe(b.wave);
  });

  it('loadResumeBattle 重建的对局与存档一致', () => {
    const b = readyVersus(4242);
    writeBattleSave(b);
    const r = loadResumeBattle();
    expect(r).not.toBeNull();
    expect(r!.battle.wave).toBe(b.wave);
    expect(r!.battle.status).toBe('ready');
    expect(r!.mapId).toBe('huoyanshan');
  });

  it('版本不匹配 → 丢弃返回 null', () => {
    const b = readyVersus(1);
    writeBattleSave(b);
    const raw = JSON.parse(storeGet(SAVE_KEY)!);
    raw.v = 999;
    storeSet(SAVE_KEY, JSON.stringify(raw));
    expect(readBattleSave()).toBeNull();
  });

  it('gameVersion 不匹配 → 丢弃', () => {
    const b = readyVersus(1);
    writeBattleSave(b);
    const raw = JSON.parse(storeGet(SAVE_KEY)!);
    raw.gameVersion = '0.0.0-old';
    storeSet(SAVE_KEY, JSON.stringify(raw));
    expect(readBattleSave()).toBeNull();
  });

  it('损坏 JSON → 返回 null 不抛', () => {
    storeSet(SAVE_KEY, '{不是合法json');
    expect(readBattleSave()).toBeNull();
  });

  it('终局(status=won/lost)存档不可续 → loadResumeBattle 返回 null', () => {
    const b = readyVersus(7);
    writeBattleSave(b);
    const raw = JSON.parse(storeGet(SAVE_KEY)!);
    raw.core.status = 'lost';
    storeSet(SAVE_KEY, JSON.stringify(raw));
    expect(loadResumeBattle()).toBeNull();
  });

  it('saveResumeCheckpoint 只在 ready 落档、PvP 不落档', () => {
    // 本地 ready → 落档
    const b = readyVersus(2);
    saveResumeCheckpoint(b);
    expect(readBattleSave()).not.toBeNull();
    clearBattleSave();
    // PvP 局 → 不落档
    const pvp = new Battle(3, 1, mapById('huoyanshan'), undefined, undefined, undefined, undefined, false, 1.0, 1, undefined, { enabled: true });
    // 直接把 status 设成 ready 不便；用一个刚构造的 pvp（intro ready）即可
    saveResumeCheckpoint(pvp);
    expect(readBattleSave()).toBeNull();
  });

  it('clearBattleSave 后 read 为 null', () => {
    writeBattleSave(readyVersus(9));
    clearBattleSave();
    expect(readBattleSave()).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/battle-save.test.ts`
Expected: FAIL —「Cannot find module '../src/battle-save'」。

- [ ] **Step 3: 实现 battle-save.ts**

Create `web/src/battle-save.ts`:
```ts
// 本地对局续玩存档（AI 对战 / 无尽 · 波次检查点）。
// 仅在 status==='ready'（两波之间）落档；在线 PvP（isPvp）永不落档。
// 跨平台 KV 走 storage.ts（Web=localStorage / 微信=wx），本存档不进云同步。
import { Battle, type BattleCoreState, type BattleSaveConfig } from './battle';
import { mapById } from './board';
import { storeGet, storeSet, storeRemove } from './storage';
import { APP_VERSION } from './version';

export const SAVE_KEY = 'dasheng.battleSave';
const SAVE_VERSION = 1;

export interface BattleSaveV1 {
  v: 1;
  gameVersion: string;
  savedAt: number;
  mode: 'versus' | 'endless';
  config: BattleSaveConfig;
  core: BattleCoreState;
}

// 写入去重：同一 (mode, wave) 的 ready 窗只写一次。clear 时重置。
let lastKey = '';

/** 无条件写入（调用方保证 !isPvp）。 */
export function writeBattleSave(b: Battle): void {
  if (b.isPvp) return; // 双保险：PvP 绝不落档
  const { config, core } = b.serialize();
  const save: BattleSaveV1 = {
    v: SAVE_VERSION,
    gameVersion: APP_VERSION,
    savedAt: Date.now(),
    mode: config.endless ? 'endless' : 'versus',
    config,
    core,
  };
  storeSet(SAVE_KEY, JSON.stringify(save));
  lastKey = `${save.mode}:${core.wave}`;
}

/** 主循环每帧调用：仅本地局、仅 ready、去重后落档。 */
export function saveResumeCheckpoint(b: Battle): void {
  if (b.isPvp) return;
  if (b.status !== 'ready') return; // 波次检查点：只在两波之间
  const key = `${b.endless ? 'endless' : 'versus'}:${b.wave}`;
  if (key === lastKey) return;
  writeBattleSave(b);
}

/** 读取并校验；无效（缺失/损坏/版本不符/已终局）返回 null。 */
export function readBattleSave(): BattleSaveV1 | null {
  const raw = storeGet(SAVE_KEY);
  if (!raw) return null;
  let save: BattleSaveV1;
  try {
    save = JSON.parse(raw) as BattleSaveV1;
  } catch {
    return null;
  }
  if (!save || save.v !== SAVE_VERSION || save.gameVersion !== APP_VERSION) return null;
  if (!save.core || save.core.status === 'won' || save.core.status === 'lost') return null;
  return save;
}

/** 清除存档并重置去重键。 */
export function clearBattleSave(): void {
  storeRemove(SAVE_KEY);
  lastKey = '';
}

/** 读有效存档并重建本地 Battle。构造传中性参数避免二次叠加，再 applyCoreState 覆盖。 */
export function loadResumeBattle(): { battle: Battle; mapId: string } | null {
  const save = readBattleSave();
  if (!save) return null;
  const battle = new Battle(
    1,                              // seed：RNG 会被 core 覆盖，此处仅供构造
    save.config.difficultyMul,
    mapById(save.config.mapId),
    undefined, undefined, undefined, undefined, // meta/weapons/actives/passives 用默认（NO_META/空）
    save.config.endless,
    undefined,                      // aiSkill 用默认，随后被 core.aiSkill 覆盖
    save.config.aiAdjustIntervalScale,
    // heroMatch、pvpInit 省略 → isPvp=false
  );
  battle.applyCoreState(save.core);
  lastKey = `${save.mode}:${save.core.wave}`; // 避免恢复后首帧重复写同一存档
  return { battle, mapId: save.config.mapId };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/battle-save.test.ts`
Expected: PASS（8 tests）。

- [ ] **Step 5: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/battle-resume-save
git add web/src/battle-save.ts web/tests/battle-save.test.ts
git commit -m "feat(save): battle-save 存档编排（写/读/清/续玩重建 + 版本/PvP/终局守卫）"
```

---

## Task 4: main.ts 接线（存 / 清 / 取 + 冒烟钩子）

**Files:**
- Modify: `web/src/main.ts`

> 无独立单测（集成入口），由 Task 5 浏览器冒烟验证。改完先跑 `npx tsc --noEmit` 确认不新增类型报错。

- [ ] **Step 1: 加 import（main.ts 顶部 import 区，与其它 `./xxx` import 并列）**

```ts
import { saveResumeCheckpoint, clearBattleSave, loadResumeBattle, readBattleSave } from './battle-save';
```

- [ ] **Step 2: 主循环落档钩子（本地步进分支）**

在 `web/src/main.ts` 本地步进处（`:2391-2393`）：
```ts
        } else {
          battle.step(dt);
        }
```
改为：
```ts
        } else {
          battle.step(dt);
          saveResumeCheckpoint(battle); // 本地局波次检查点落档（内部守卫 isPvp / status==='ready' / 去重）
        }
```

- [ ] **Step 3: 终局清档（胜负结算块）**

在 `:2409-2410` 的：
```ts
    if (!endHandled && (battle.status === 'won' || battle.status === 'lost') && !pvpSock) {
      endHandled = true;
```
紧随 `endHandled = true;` 后加一行：
```ts
      endHandled = true;
      clearBattleSave(); // 本局终局：作废续玩存档
```

- [ ] **Step 4: 开新局清档（newGame）**

在 `newGame()` 内 `endHandled = false;`（`:1162`）后加：
```ts
  endHandled = false;
  clearBattleSave(); // 开新局：作废旧续玩存档（首个 ready 会写新档）
```

- [ ] **Step 5: 主动退出清档（abortBattleToMenu）**

在 `abortBattleToMenu()` 内 `endPvpSession();` 之后加：
```ts
  endPvpSession();
  clearBattleSave(); // 主动退出对局：作废续玩存档
```

- [ ] **Step 6: 启动自动续玩（boot IIFE）**

先在 `newGame()` 附近新增续玩函数：
```ts
// 本地对局续玩：读有效存档→重建 battle→直接进战斗界面（不扣体力、跳过首页）。
function tryResumeLocalBattle(): boolean {
  const r = loadResumeBattle();
  if (!r) return false;
  battle = r.battle;
  bindBattleWeaponPickup();          // 重挂注入型函数字段 weaponPickupVisible
  currentMap = mapById(r.mapId);     // 氛围音/HUD 对齐存档地图
  endHandled = false;
  pendingMerchant = false;
  endlessResult = null;
  settleChange = null;
  ui.paused = false;
  pvpExitPopup = false;
  pausePhase = 'main';
  screen = 'battle';
  scheduleFrame();
  return true;
}
```
再改启动 IIFE（`:489` 一带）：
```ts
    ensureUserId();
    screen = 'menu';
    if (versusCode) enterPvpMatching('join', versusCode);
```
改为：
```ts
    ensureUserId();
    // 本地对局续玩：无 PvP 深链且存在有效未终局存档时，直接恢复进战斗、跳过首页。
    if (!(versusCode == null && tryResumeLocalBattle())) {
      screen = 'menu';
    }
    if (versusCode) enterPvpMatching('join', versusCode);
```
> 说明：`versusCode` 为 PvP 邀请深链，存在时优先走 PvP，不续玩本地局。

- [ ] **Step 7: 加冒烟钩子（`__game` hook 对象 `:2648` 内，任意成员后加一项）**

```ts
  // 续玩冒烟：读当前 screen / 是否有存档 / 存档波数，供 smoke-resume.mjs 断言。
  resumeProbe: () => ({ screen, hasSave: !!readBattleSave(), wave: battle?.wave ?? -1, status: battle?.status ?? null }),
```
并在 `interface GameHook`（`:2579`）内加对应声明：
```ts
  resumeProbe: () => { screen: string; hasSave: boolean; wave: number; status: string | null };
```

- [ ] **Step 8: 类型检查（不新增报错）**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -E "battle-save|main\.ts|rng\.ts|battle\.ts" || echo "无本改动相关新报错"`
Expected: 无本次改动文件的新报错（基线既有 ~28 处无关报错可忽略）。

- [ ] **Step 9: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/battle-resume-save
git add web/src/main.ts
git commit -m "feat(main): 续玩接线——ready 落档/终局退出清档/启动自动续玩 + 冒烟钩子"
```

---

## Task 5: 验证门禁（单测全绿 + ai-balance + 浏览器冒烟）

**Files:**
- Create: `web/scripts/smoke-resume.mjs`

- [ ] **Step 1: 跑全量单测 + ai-balance 门禁**

Run:
```bash
cd web && npx vitest run tests/rng-state.test.ts tests/battle-resume-serialize.test.ts tests/battle-save.test.ts
npx vitest run tests/ai-balance.test.ts
```
Expected: 全 PASS。ai-balance 通过证明未扰动战斗/AI 行为（本改动仅新增只读能力，理应不变）。

- [ ] **Step 2: 写浏览器冒烟脚本**

Create `web/scripts/smoke-resume.mjs`:
```js
// 续玩冒烟：启动局→推进到 wave≥1 的 ready→确认已落档→reload→确认自动续玩到同波、体力未变。
// 用法：先另开一个终端 `cd web && npm run dev`（记下地址，默认 http://localhost:5173），
// 然后 `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" URL=http://localhost:5173 node scripts/smoke-resume.mjs`
import puppeteer from 'puppeteer-core';

const URL = process.env.URL || 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => !!window.__game, { timeout: 15000 });

  // 起一局本地 AI 对战（确定性 seed）
  await page.evaluate(() => window.__game.restart(20260823, 1, 'huoyanshan', false));

  // 推进到 wave≥1 的 ready：ready 就开波，playing 就征兵+布阵
  await page.evaluate(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 600; i++) {
      const b = g.battle;
      if (b.status === 'ready' && b.wave >= 1) break;
      if (b.status === 'ready') g.wave();
      else { g.summon(); g.autoPlace(); }
      await sleep(50);
      if (b.status === 'won' || b.status === 'lost') break;
    }
  });

  const before = await page.evaluate(() => window.__game.resumeProbe());
  console.log('reload 前:', before);
  if (!before.hasSave || before.wave < 1 || before.status !== 'ready') {
    throw new Error('未在 ready 检查点落档：' + JSON.stringify(before));
  }

  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => !!window.__game && !!window.__game.battle, { timeout: 15000 });
  await sleep(500);
  const after = await page.evaluate(() => window.__game.resumeProbe());
  console.log('reload 后:', after);
  if (after.screen !== 'battle') throw new Error('刷新后未自动进入战斗界面：' + JSON.stringify(after));
  if (after.wave !== before.wave) throw new Error(`续玩波数不一致 ${before.wave}→${after.wave}`);

  console.log('✅ 续玩冒烟通过：刷新后自动回到 wave', after.wave, 'ready，无崩溃');
} finally {
  await browser.close();
}
```

- [ ] **Step 3: 跑浏览器冒烟**

Run（两个终端）：
```bash
# 终端 A
cd web && npm run dev
# 终端 B（确认 dev 地址后）
cd web && CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" URL=http://localhost:5173 node scripts/smoke-resume.mjs
```
Expected: 打印「✅ 续玩冒烟通过」。若 `CHROME_PATH`/`URL` 与本机不符，按实际调整。

- [ ] **Step 4: 手动回归（在线 PvP 不受影响）**

在浏览器手动：进一局 PvP（若可用）→ 中途刷新 → 确认**不会**误自动续玩到本地局（回到匹配/首页，行为同现状）。localStorage 里不应因 PvP 出现 `dasheng.battleSave`。

- [ ] **Step 5: 提交冒烟脚本**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/battle-resume-save
git add web/scripts/smoke-resume.mjs
git commit -m "test(save): 续玩浏览器冒烟脚本（puppeteer-core，reload 后自动续玩）"
```

---

## 收尾

- 收尾前按 `parallel-worktrees-rebase-before-finish`：看分支是否与 main 分叉，必要时在 worktree 内 rebase 解冲突再合并。
- 合并前复核：`git log --oneline` 应含 Task 1–5 的提交；`spec` 文档已在 `docs/superpowers/specs/2026-08-23-battle-resume-save-design.md`。
