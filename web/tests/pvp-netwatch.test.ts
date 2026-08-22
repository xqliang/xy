// web/tests/pvp-netwatch.test.ts
// Task 7.6：PvP 断线看门狗纯判定 netDead() 的边界单测（无需画布）。
import { describe, it, expect } from 'vitest';
import { netDead, NET_DEAD_THRESHOLD_MS } from '../src/pvp-netwatch';

describe('netDead 断线看门狗判定', () => {
  it('尚未 open（lastInboundAt===0）永远不判死，避免刚建连误判', () => {
    expect(netDead(1_000_000, 0)).toBe(false);
    expect(netDead(Date.now(), 0, 1000)).toBe(false);
  });

  it('恰好在阈值边界不判死（严格大于才判死）', () => {
    const base = 10_000;
    expect(netDead(base + NET_DEAD_THRESHOLD_MS, base)).toBe(false); // =10000 → 未超
    expect(netDead(base + NET_DEAD_THRESHOLD_MS + 1, base)).toBe(true); // 10001 → 判死
  });

  it('超过阈值判死', () => {
    expect(netDead(25_000, 10_000)).toBe(true); // 15000 > 10000
  });

  it('未超阈值不判死', () => {
    expect(netDead(15_000, 10_000)).toBe(false); // 5000 < 10000
  });

  it('自定义阈值生效', () => {
    expect(netDead(5_000, 4_000, 500)).toBe(true); // 1000 > 500
    expect(netDead(4_500, 4_000, 500)).toBe(false); // 500 = 阈值
  });
});
