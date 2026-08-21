// web/tests/pvp-determinism.test.ts
// Plan C Task 12：双 Battle 确定性核心保真（「逐帧全保真」地基的最强锁）。
//
// 在线 PvP = 两个确定性 Battle（同 seed）+ 同序动作命令 → 逐 tick 一致。这是全保真的地基：
// 只要引擎对「同 seed + 同命令流」能逐 tick 复现，对手延迟重放（T7b）与分帧批量（本文件测试 B）
// 都不会破坏保真。本文件补三把更强的锁：
//   A. 多检查点核心保真：长而丰富的对局（多波 + summon/autoplace/place/startWave），在多个 tick 检查点断言
//      两同 seed 实例的 snapshot() 逐字段全等（含累积浮点 tangsengHP——对 rng/顺序发散极敏感）。
//   B. 分帧/帧率无关性：同命令流下，「每帧 1 固定子步」与「每帧追 3 步（drainFixedSteps 批量）」必须
//      产出相同结果——证明固定子步(1/30)与分帧批量解耦，一帧追几步不改确定性。
//   C. 空局基线（可选）：两实例同 seed、仅靠 startWave 开波后纯 step → snapshot 全等，隔离纯 step 的 rng 流。
//
// 只加测试，不改任何 src。若任何断言 FAIL，说明有非确定源潜入（如 Map/Set 迭代序、未 seed 随机、
// 墙钟依赖）——报告给上层定位，绝不改 src 迁就。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META } from '../src/battle';
import { MAPS } from '../src/board';
import { toPvpAction } from '../src/pvp-record';
import { PVP_SIM_DT, drainFixedSteps } from '../src/pvp-fixedstep';

const SEED = 7;
const N = 360; // ≥300 tick（≥12s @30Hz），跨多波、多轮征兵布阵，让 rng 流充分发散再比对

// 与 battle.pvp-input / pvp-bridge 的 mkPvp 同构：同 seed、difficulty=1、pvpInit.enabled=true。
// meta 传 NO_META（全 0）而非 {}：{} 会让 bonusHp/bonusSlots 变 undefined → tangsengHP/初始阵位变 NaN，
// 既不真实也会污染 snapshot 的逐字段比对。NO_META 正是真实 pvp 路径（main.ts 传 metaBonuses(merit)）
// 对一个新玩家的取值。
const mkPvp = (seed: number) =>
  new Battle(seed, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: true });

// 命令日程：每条 [tick, cmd] 表示「在 step_tick 之前施加该命令」。
// startWave 开波让 step 持续消费 rng（波次 roll、出怪抖动、暴击、掉落等）；summon/autoplace 也是
// rng 消费型输入（征兵整盘重抽、自动布阵射程感知铺格）。顺序稍有不同就会让 rng 流分叉。
type Schedule = Array<[tick: number, cmd: ReturnType<typeof toPvpAction>]>;
const RICH_SCHEDULE: Schedule = [
  [2, toPvpAction('startWave', {})],   // 开第 1 波（pvp 下波次由服务端驱动，手动开波即权威）
  [5, toPvpAction('summon', {})],
  [8, toPvpAction('autoplace', {})],
  [20, toPvpAction('summon', {})],
  [22, toPvpAction('autoplace', {})],
  [40, toPvpAction('summon', {})],
  [42, toPvpAction('autoplace', {})],
  [60, toPvpAction('summon', {})],
  [62, toPvpAction('autoplace', {})],
  [80, toPvpAction('summon', {})],
  [82, toPvpAction('autoplace', {})],
  [100, toPvpAction('summon', {})],
  [102, toPvpAction('autoplace', {})],
  [130, toPvpAction('startWave', {})], // 第 1 波若已清则开第 2 波；未清则为 no-op（两者同样 no-op）
  [140, toPvpAction('summon', {})],
  [142, toPvpAction('autoplace', {})],
  [160, toPvpAction('summon', {})],
  [162, toPvpAction('autoplace', {})],
  [180, toPvpAction('summon', {})],
  [182, toPvpAction('autoplace', {})],
  [200, toPvpAction('summon', {})],
  [202, toPvpAction('autoplace', {})],
  [230, toPvpAction('summon', {})],
  [232, toPvpAction('autoplace', {})],
  [260, toPvpAction('startWave', {})], // 若前波已清则开下一波
  [270, toPvpAction('summon', {})],
  [272, toPvpAction('autoplace', {})],
  [290, toPvpAction('summon', {})],
  [292, toPvpAction('autoplace', {})],
  [310, toPvpAction('summon', {})],
  [312, toPvpAction('autoplace', {})],
  [330, toPvpAction('summon', {})],
  [332, toPvpAction('autoplace', {})],
];
// 在这些 tick 额外尝试一次 place：把候选区首个 unit 令牌放到首个空闲已解锁格。
// 格/index 由实例当前状态推出——两同 seed 实例在该 tick 状态逐字段全等，故推出完全相同的位置，
// 因而仍是「同命令流」。这额外覆盖 applyPvpInput('place') / parsePvpCell('r{r}c{c}') 这条窄路径。
const RICH_PLACE_TICKS = new Set([15, 50, 95, 145, 185, 225, 265, 305, 345]);
// 中检检查点（均 < N，落在循环内可采集）；末态（tick=N）在循环结束后单独采集。
const CHECKPOINTS = [30, 60, 90, 150, 210, 300];

/**
 * 共享输入驱动：对 tick k 施加该 tick 的命令（静态日程 + 指定 tick 的运行时安全 place）。
 * 命令始终在 step_k 之前施加——这是全保真的核心不变量（命令先于本 tick 的物理步进）。
 * 两同 seed 实例走完全相同的驱动 → 同命令流；本测锁死「同 seed + 同命令流 → 逐 tick 复现」的引擎确定性。
 */
function driveTick(b: Battle, k: number, schedule: Schedule, placeTicks: ReadonlySet<number>): void {
  // ① 静态日程：tick==k 的命令在 step_k 之前施加。
  for (const [tick, cmd] of schedule) {
    if (tick === k) b.applyPvpInput(cmd);
  }
  // ② 运行时安全 place：仅当候选区有 unit 令牌、且存在空闲已解锁格时才落子（与 pvp-bridge 的同款构造）。
  if (placeTicks.has(k)) {
    const idx = b.tray.findIndex((t) => t?.kind === 'unit');
    if (idx >= 0) {
      const cell = b.unlockedCells().find(
        (c) => !b.units.has(`${c.c},${c.r}`) && !b.words.has(`${c.c},${c.r}`),
      );
      if (cell) b.applyPvpInput({ op: 'place', index: idx, cell: `r${cell.r}c${cell.c}` });
    }
  }
}

describe('PvP 双 Battle 确定性核心保真（Plan C Task 12）', () => {
  // —— 测试 A：多检查点核心保真（同 seed + 同序命令 → 逐检查点 snapshot 逐字段全等） —— //
  it('A. 长丰富对局：两同 seed 实例同命令流 → 多检查点 snapshot 逐字段全等', () => {
    const bA = mkPvp(SEED);
    const bB = mkPvp(SEED);
    const snapsA = new Map<number, ReturnType<Battle['snapshot']>>();
    const snapsB = new Map<number, ReturnType<Battle['snapshot']>>();
    const cpSet = new Set(CHECKPOINTS);

    // 两实例走完全相同的循环：每个 tick 先施加该 tick 命令、再 step（命令先于 step_k）。
    for (let k = 0; k < N; k++) {
      driveTick(bA, k, RICH_SCHEDULE, RICH_PLACE_TICKS);
      driveTick(bB, k, RICH_SCHEDULE, RICH_PLACE_TICKS);
      bA.step(PVP_SIM_DT);
      bB.step(PVP_SIM_DT);
      if (cpSet.has(k)) {
        snapsA.set(k, bA.snapshot());
        snapsB.set(k, bB.snapshot());
      }
    }

    // 每个中检检查点逐字段全等（toEqual 深比，含累积浮点 tangsengHP/peach 与 rounded towerPow 等）。
    for (const cp of CHECKPOINTS) {
      const sA = snapsA.get(cp);
      const sB = snapsB.get(cp);
      expect(sA, `检查点 tick=${cp} 两端都应采集到 snapshot`).toBeTruthy();
      expect(sB).toBeTruthy();
      expect(sA).toEqual(sB); // 逐字段全等：wave/towerPow/kills/tangsengHP/peach/units/words/...
    }
    // 末态（tick=N）逐字段全等。
    expect(bA.snapshot()).toEqual(bB.snapshot());

    // 保 meaningful：对局确实推进了（至少开过 1 波、且有怪/兵/击杀），不是空转 trivial pass。
    const last = bA.snapshot();
    expect(last.wave).toBeGreaterThanOrEqual(1);
    expect(last.monsters + last.units + last.kills).toBeGreaterThan(0);
  });

  // —— 测试 B：分帧/帧率无关性（batching invariance） —— //
  it('B. 同命令流：每帧 1 子步 vs 每帧追 3 步（drainFixedSteps 批量）→ 末态+中检全等', () => {
    const bSlow = mkPvp(SEED); // 每帧只推进 1 个固定子步（逐 tick step）
    const bFast = mkPvp(SEED); // 每帧 dt=0.1s → 一次追 3 个固定子步（分帧批量）
    const MID = 150;
    const cpSetB = new Set([MID]); // 中检（< N，循环内可采集）；末态在循环后单独比对
    const slowSnaps = new Map<number, ReturnType<Battle['snapshot']>>();
    const fastSnaps = new Map<number, ReturnType<Battle['snapshot']>>();

    // bSlow：每帧 1 tick——先施加该 tick 命令，再 step 一个固定子步。
    for (let k = 0; k < N; k++) {
      driveTick(bSlow, k, RICH_SCHEDULE, RICH_PLACE_TICKS);
      bSlow.step(PVP_SIM_DT);
      if (cpSetB.has(k)) slowSnaps.set(k, bSlow.snapshot());
    }

    // bFast：每帧用 drainFixedSteps 以较大可变 dt 累计切出整数个固定子步。
    // 关键不变量：每个 tick 的 step 之前仍先施加该 tick 的命令——分帧批量绝不打乱「命令 vs step」的相对次序。
    const FRAME_DT = 0.1; // 3 × (1/30) = 0.1，整除无余量 → 每帧 3 步
    let acc = 0;
    let tick = 0;
    while (tick < N) {
      const { steps, rest } = drainFixedSteps(acc, FRAME_DT, PVP_SIM_DT, 999);
      acc = rest;
      for (let s = 0; s < steps && tick < N; s++) {
        driveTick(bFast, tick, RICH_SCHEDULE, RICH_PLACE_TICKS); // 命令在 step_tick 之前
        bFast.step(PVP_SIM_DT);
        if (cpSetB.has(tick)) fastSnaps.set(tick, bFast.snapshot());
        tick++;
      }
    }
    expect(tick).toBe(N); // 确认 bFast 也跑到相同总步数

    // 中检逐字段全等。
    for (const cp of cpSetB) {
      expect(fastSnaps.get(cp), `tick=${cp} bFast 应有 snapshot`).toBeTruthy();
      expect(slowSnaps.get(cp)).toBeTruthy();
      expect(fastSnaps.get(cp)).toEqual(slowSnaps.get(cp));
    }
    // 末态（tick=N）逐字段全等：证明「一帧追几步」不影响确定性（固定子步与分帧批量解耦）。
    expect(bFast.snapshot()).toEqual(bSlow.snapshot());
  });

  // —— 测试 C（可选）：空局基线——两实例同 seed、仅 startWave 开波后纯 step → snapshot 全等 —— //
  it('C. 空局基线：同 seed、仅开波后纯 step N tick → snapshot 全等（隔离纯 step 的 rng 流）', () => {
    const cA = mkPvp(SEED);
    const cB = mkPvp(SEED);
    const emptySchedule: Schedule = [[2, toPvpAction('startWave', {})]]; // 唯一输入：开第 1 波
    const noPlace = new Set<number>();

    for (let k = 0; k < N; k++) {
      driveTick(cA, k, emptySchedule, noPlace);
      driveTick(cB, k, emptySchedule, noPlace);
      cA.step(PVP_SIM_DT);
      cB.step(PVP_SIM_DT);
    }

    // 纯 step（无征兵布阵）下，两实例 rng 流逐 tick 一致 → snapshot 逐字段全等。
    expect(cA.snapshot()).toEqual(cB.snapshot());
    // 保 meaningful：开波后纯 step 确实在出怪/消费 rng（至少进过第 1 波）。
    expect(cA.snapshot().wave).toBeGreaterThanOrEqual(1);
  });
});
