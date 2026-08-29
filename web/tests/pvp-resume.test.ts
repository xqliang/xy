// PvP「刷新恢复」的纯逻辑锁：无输入快进的 tick 基准与循环边界。
//
// 恢复流程（main.ts resumePvpSession）：连 WS → 收 welcome(serverMs) → 用 restoreBattle 重建本方半场 →
// 「无输入快进」把本方 sim 从落档 tick 推进到服务端当前 tick（catch up）。其中唯一的纯逻辑是
//   targetTick = pvpWaveStartTick(serverMs, matchStartMs)          // 服务端当前纪元 → 本地绝对 tick（30Hz）
//   循环 while (tick < targetTick && battle.status==='playing') { …; tick++ }
// 本文件锁定这段 tick 换算与循环边界（步数、终点、终局早停）。WS 握手 / battle.step 的整链路由 Task 6
// 的 pvp-refresh-smoke.mjs（需真服务端）覆盖，此处不触网络、不建 Battle。
import { describe, it, expect } from 'vitest';
import { pvpWaveStartTick, PVP_SIM_DT } from '../src/pvp-fixedstep';

describe('PvP 刷新恢复：快进 tick 基准', () => {
  it('pvpWaveStartTick 把服务端当前纪元换算为本地目标 tick（30Hz，相对开局纪元）', () => {
    const startAt = 1_000_000;
    // 与 onNextWave 的换算同源（同一函数）：10s → 300 tick（10_000ms × 30 / 1000）。
    expect(pvpWaveStartTick(startAt + 10_000, startAt)).toBe(300);
    expect(pvpWaveStartTick(startAt, startAt)).toBe(0);          // 开局纪元 → tick 0
    expect(pvpWaveStartTick(startAt + 100, startAt)).toBe(3);    // 100ms → round(3.0)=3
  });

  it('PVP_SIM_DT 与 30Hz 一致（快进步长 = 主循环固定子步）', () => {
    // 快进循环用 battle.step(PVP_SIM_DT)，与主循环同步长，才能保证 rng 消费序、tick 语义一致。
    expect(PVP_SIM_DT).toBeCloseTo(1 / 30, 12);
    // pvpWaveStartTick 的隐含前提：每 1000ms = 30 tick，即每 tick = PVP_SIM_DT 秒。
    expect(Math.round(1000 * PVP_SIM_DT * 30) / 1000).toBeCloseTo(1, 6);
  });

  it('无输入快进步数 = 目标 tick − 落档 tick（catch up 到服务端当前 tick）', () => {
    const startAt = 1_000_000;
    const savedTick = 100;
    // 服务端当前纪元 = 落档 tick 对应纪元 + 5s 缺口：targetTick = 100 + 5000ms×30/1000 = 100 + 150 = 250。
    const serverMs = startAt + Math.round((savedTick / 30) * 1000) + 5000;
    const targetTick = pvpWaveStartTick(serverMs, startAt);
    expect(targetTick).toBe(250);
    // 复刻 resumePvpSession 的快进循环边界（此处不建 Battle，status 恒 playing）：步数=150，终点=250。
    let tick = savedTick;
    let steps = 0;
    while (tick < targetTick) { steps++; tick++; }
    expect(steps).toBe(150);
    expect(tick).toBe(250); // 循环后 localSimTick = tick，与服务端当前 tick 对齐
  });

  it('服务端 tick ≤ 落档 tick（无缺口 / 时钟回拨）时不快进', () => {
    const startAt = 1_000_000;
    const savedTick = 300;
    const serverMs = startAt + Math.round((savedTick / 30) * 1000); // 恰好落档时刻，无缺口
    const targetTick = pvpWaveStartTick(serverMs, startAt);
    expect(targetTick).toBe(300);
    let tick = savedTick;
    let steps = 0;
    while (tick < targetTick) { steps++; tick++; }
    expect(steps).toBe(0);  // while(tick<target) 不执行 → 不快进（也天然 clamp 掉服务端时钟回拨）
    expect(tick).toBe(300);
  });

  it('快进遇本方终局（lost）即停，不越过终局继续步进', () => {
    const startAt = 1_000_000;
    const savedTick = 0;
    const serverMs = startAt + 10_000;             // targetTick = 300
    const targetTick = pvpWaveStartTick(serverMs, startAt);
    expect(targetTick).toBe(300);
    // 模拟：快进到第 50 步本方唐僧被吃穿（status→lost），循环的 `&& status==='playing'` 应就此停。
    // 对应 resumePvpSession：快进后 status==='lost' → 置 pvpResult={outcome:'lose',reason:'selfTangsengDead'}。
    let status: 'playing' | 'lost' = 'playing';
    let tick = savedTick;
    let steps = 0;
    while (tick < targetTick && status === 'playing') {
      steps++; tick++;
      if (steps === 50) status = 'lost';
    }
    expect(steps).toBe(50);       // 终局即停，不跑满 300
    expect(tick).toBe(50);
    expect(status).toBe('lost');  // 恢复后据此本地判负（服务端 result 到达时因 pvpResult 已非空不再重复结算）
  });
});
