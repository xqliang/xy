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

  it('getState 归一化负 int32 状态为 uint32', () => {
    // 情形一：直接写入「高位=1」的 uint32 状态，读回仍是 uint32（而非 -1）。
    const r = new RNG(1);
    r.setState(0xffffffff);                 // 0xffffffff 本身是正的 4294967295
    expect(r.getState()).toBe(0xffffffff);  // 归一化为 uint32
    const ref = new RNG(1); ref.setState(0xffffffff);
    for (let i = 0; i < 5; i++) expect(r.next()).toBe(ref.next()); // 同状态→同序列

    // 情形二（真正锁住不变量）：next() 内部的 `this.s |= 0` 会把状态变成
    // 有符号 int32，推进若干步后位型高位必然置1。若 getState 不做 `>>> 0`，
    // 就会返回负数、存进 JSON 后无法还原。这里断言它始终是非负 uint32。
    const g = new RNG(1);
    let sawHighBit = false;
    for (let i = 0; i < 200; i++) {
      g.next();
      const s = g.getState();
      expect(s).toBeGreaterThanOrEqual(0);      // 绝不能是负数
      expect(s).toBeLessThanOrEqual(0xffffffff);
      if (s > 0x7fffffff) sawHighBit = true;    // 确认确实覆盖了高位=1 的状态
    }
    expect(sawHighBit).toBe(true);              // 否则本测试没触达归一化路径
  });
});
