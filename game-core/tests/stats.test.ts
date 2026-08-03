import { describe, it, expect } from 'vitest';
import { TIER_COEFFICIENTS, TIER_GROWTH_INCREMENTS, MAX_TIER, UNITS } from '../src/config/units';

describe('成长系数链（照搬原作）', () => {
  it('逐阶增幅为 +50%/+40%/+30%/+20%', () => {
    expect(TIER_GROWTH_INCREMENTS).toEqual([0.5, 0.4, 0.3, 0.2]);
  });

  it('系数链为 [1.0, 1.5, 2.1, 2.73, 3.276]', () => {
    expect(TIER_COEFFICIENTS).toHaveLength(5);
    expect(TIER_COEFFICIENTS[0]).toBeCloseTo(1.0, 3);
    expect(TIER_COEFFICIENTS[1]).toBeCloseTo(1.5, 3);
    expect(TIER_COEFFICIENTS[2]).toBeCloseTo(2.1, 3);
    expect(TIER_COEFFICIENTS[3]).toBeCloseTo(2.73, 3);
    expect(TIER_COEFFICIENTS[4]).toBeCloseTo(3.276, 3);
  });

  it('最高 5 级', () => {
    expect(MAX_TIER).toBe(5);
  });

  it('四兵种 1 阶 ATK：棍猴=3，其余=2；RGE 与目标数符合原作定位', () => {
    expect(UNITS.monkey.baseAtk).toBe(3);
    expect(UNITS.spear.baseAtk).toBe(2);
    expect(UNITS.cavalry.baseAtk).toBe(2);
    expect(UNITS.archer.baseAtk).toBe(2);

    expect(UNITS.monkey.rge).toBe(1);
    expect(UNITS.spear.rge).toBe(2);
    expect(UNITS.cavalry.rge).toBe(1.5);
    expect(UNITS.archer.rge).toBe(3);

    expect(UNITS.monkey.targets).toBe(1);
    expect(UNITS.spear.targets).toBe(1.5);
    expect(UNITS.cavalry.targets).toBe(2);
    expect(UNITS.archer.targets).toBe(1);
  });
});
