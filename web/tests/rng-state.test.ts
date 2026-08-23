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
