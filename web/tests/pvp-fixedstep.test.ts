import { describe, it, expect } from 'vitest';
import { drainFixedSteps } from '../src/pvp-fixedstep';
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
