// web/tests/pvp-determinism-timing.test.ts
// Plan C Task 7b：跨机施加时序 parity（锁死 I1 确定性核心）。
//
// 双 Battle 输入重放模型：本方 battle（实时权威）+ 对手 oppBattle（同 seed、落后重放）。
// 全保真靠「同引擎 + 同 seed + 同序命令」。命令 t=k 在两端都必须「在 step_k 之前」施加：
//   · 本方：即时施加 + record 盖 t = localSimTick（本方已完成的固定步数 = 下一步 tick 索引）
//   · 对手：takeReady(k) 在 step_k 之前施加 t<=k 的命令
// 若 record 仍用墙钟 simTick()，命令时刻会越过本方实际步进到的 tick，导致对手侧 rng 消费相对
// step 的顺序与对手真实半场相反 → 逐 tick 发散。本测试用同 seed 两实例跑同一条「带时间戳」命令流，
// 断言两端 snapshot 逐字段全等（tangsengHP 为累积浮点，对 rng 发散极敏感）来锁死这一 parity。
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { PvpSync } from '../src/pvp-battle';
import { toPvpAction } from '../src/pvp-record';
import { MAPS } from '../src/board';
import { PVP_SIM_DT } from '../src/pvp-fixedstep';

const SEED = 7;
const N = 130; // 跑足够多 tick，确保这段时间在打怪、step 持续消费 rng

// 与 battle.pvp-input.test.ts 的 mkPvp 同构：同 seed/difficulty=1、pvpInit.enabled=true。
const mkPvp = (seed: number) =>
  new Battle(seed, 1, MAPS[0]!, {}, {}, [], [], false, undefined, 1, undefined, { enabled: true });
// PvpSync 时钟在 parity 测试里无关（record 的 t 由调用方显式传入），now/startAt 取 0 即可。
const mkSync = (seed: number) =>
  new PvpSync({ matchId: 'm', seed, startAtServerMs: 0, serverOffsetMs: 0, delayTicks: 15, now: () => 0 });

/**
 * 输入日程：不同 tick 施加不同命令，覆盖 rng 消费型输入（征兵/自动布阵/开波）。
 * summon / autoPlaceTray / startNextWave 都会消费 this.rng；step 每步也消费 rng（波次 roll、
 * 出怪抖动、暴击、掉落等）——顺序稍有不同就会让 rng 流分叉。
 */
const schedule: Array<[tick: number, cmd: ReturnType<typeof toPvpAction>]> = [
  [2, toPvpAction('startWave', {})],
  [10, toPvpAction('summon', {})],
  [11, toPvpAction('autoplace', {})],
  [25, toPvpAction('summon', {})],
  [45, toPvpAction('autoplace', {})],
  [60, toPvpAction('summon', {})],
  [61, toPvpAction('autoplace', {})],
  [85, toPvpAction('summon', {})],
  [100, toPvpAction('autoplace', {})],
];

describe('PvP 跨机施加时序 parity（I1：record 时间戳须用 localSimTick 固定步数）', () => {
  it('本方即时施加+盖 localSimTick 的命令流，喂给对手 oppBattle 重放 → snapshot 逐字段全等', () => {
    // —— 本方 bP：命令在 step_k 之前施加、盖 t=localSimTick(=k)，然后 step_k —— //
    const bP = mkPvp(SEED);
    const syncP = mkSync(SEED);
    let localSimTick = 0; // 本方已完成的固定步数 = 下一步 tick 索引
    for (let k = 0; k < N; k++) {
      for (const [tick, cmd] of schedule) {
        if (tick === k) {
          bP.applyPvpInput(cmd);                       // 即时施加（事件处理器在两帧之间，= step_k 之前）
          syncP.record(cmd, localSimTick);             // 盖 t = 本方已完成步数 = 下一步 tick 索引
        }
      }
      bP.step(PVP_SIM_DT);
      localSimTick++;                                  // 完成一步，步数 +1 = 下一步 tick 索引
    }
    const stream = syncP.drainOutbound();              // 出站命令流（每条带 t）

    // —— 对手 bO：同 seed 重放，takeReady(k) 在 step_k 之前施加 t<=k 的命令 —— //
    const bO = mkPvp(SEED);
    const syncO = mkSync(SEED);
    syncO.ingestOpponent(stream);
    for (let k = 0; k < N; k++) {
      for (const a of syncO.takeReady(k)) bO.applyPvpInput(a); // 命令在 step_k 之前施加
      bO.step(PVP_SIM_DT);
    }

    // 两端 snapshot 逐字段全等：wave/towerPow/kills/tangsengHP/peach/units 等。
    // tangsengHP 是累积浮点，对 rng 消费顺序的差异极敏感——若顺序相反必在此发散。
    expect(bO.snapshot()).toEqual(bP.snapshot());
  });
});
