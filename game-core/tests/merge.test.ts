import { describe, it, expect } from 'vitest';
import { canMerge, merge } from '../src/domain/merge';
import type { Unit } from '../src/domain/types';

const u = (type: Unit['type'], tier: number): Unit => ({ type, tier });

describe('合成系统（照搬原作·同型同级二合一，最高5级）', () => {
  it('同型同级且未满级可合成', () => {
    expect(canMerge(u('dao', 2), u('dao', 2))).toBe(true);
  });

  it('不同型不可合成', () => {
    expect(canMerge(u('dao', 2), u('spear', 2))).toBe(false);
  });

  it('不同级不可合成', () => {
    expect(canMerge(u('dao', 2), u('dao', 3))).toBe(false);
  });

  it('已满级（5级）不可合成', () => {
    expect(canMerge(u('dao', 5), u('dao', 5))).toBe(false);
  });

  it('合成结果为同型高一阶', () => {
    expect(merge(u('archer', 2), u('archer', 2))).toEqual({ type: 'archer', tier: 3 });
  });

  it('非法合成抛错', () => {
    expect(() => merge(u('dao', 5), u('dao', 5))).toThrow();
    expect(() => merge(u('dao', 2), u('spear', 2))).toThrow();
  });
});
