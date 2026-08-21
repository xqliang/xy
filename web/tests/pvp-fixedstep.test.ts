import { describe, it, expect } from 'vitest';
import { drainFixedSteps, pvpWaveStartTick } from '../src/pvp-fixedstep';
describe('drainFixedSteps', () => {
  const F = 1 / 30;
  it('累计足够整步才切片，余量留下', () => {
    let r = drainFixedSteps(0, 0.05, F, 8); expect(r.steps).toBe(1);        // 0.05/0.0333≈1 步
    r = drainFixedSteps(r.rest, 0.05, F, 8); expect(r.steps).toBe(2);       // 累计 0.0667→2 步
  });
  it('不同 dt 切法累计步数一致（帧率无关）', () => {
    const total = 1.0;
    const cnt = (chunk: number) => { let a = 0, n = 0; for (let t = 0; t < total - 1e-9; t += chunk) { const r = drainFixedSteps(a, chunk, F, 999); n += r.steps; a = r.rest; } return n; };
    expect(cnt(1 / 60)).toBe(cnt(1 / 20)); // 都应=30
  });
  it('maxSteps 兜底防卡顿雪崩', () => { expect(drainFixedSteps(0, 10, F, 8).steps).toBe(8); });
});

// Plan C Task 9：波起始纪元 → 本地 simTick 的纯函数（先清者定波次的确定性开波基准）。
//
// 服务端「先清者定波次」给每波一个绝对纪元 startAtServerMs（match 级共享，两端同值）。本机按 30Hz 固定步长
// 推进，故把「波起始纪元 - 开局纪元」换算成 tick 数即为该波应在哪一步开波。两端同 server 纪元 → 同 tick，
// 与本地墙钟无关，从而保证两端在同一 tick 索引开波（rng 消费序一致）。
describe('pvpWaveStartTick', () => {
  it('把波起始纪元换算为本地 simTick（30Hz，相对开局纪元）', () => {
    const ms0 = 1_000_000; // 任意开局纪元（绝对 epoch ms）
    expect(pvpWaveStartTick(ms0 + 1500, ms0)).toBe(45);  // START_DELAY=1500ms → 45 tick
    expect(pvpWaveStartTick(ms0 + 3000, ms0)).toBe(90);  // INTER_WAVE_DELAY=3000ms → 90 tick
    expect(pvpWaveStartTick(ms0, ms0)).toBe(0);          // 开局即开波（第 0 tick）
  });

  it('同输入两次调用相等（确定性；不受浮点抖动影响）', () => {
    const ms0 = 1_734_000_000;
    const a = pvpWaveStartTick(ms0 + 1500, ms0);
    const b = pvpWaveStartTick(ms0 + 1500, ms0);
    expect(a).toBe(b);
    expect(a).toBe(45);
  });

  it('matchStart 为零纪元时直接按 ms 换算', () => {
    expect(pvpWaveStartTick(1500, 0)).toBe(45);
    expect(pvpWaveStartTick(3000, 0)).toBe(90);
  });
});
