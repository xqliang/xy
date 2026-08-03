import { describe, it, expect } from 'vitest';
import { damage, monsterPOW, canIntercept } from '../src/domain/combat';

describe('战斗公式（照搬原作·单一乘区）', () => {
  it('伤害 = ATK（无防御时）', () => {
    expect(damage(6.55)).toBeCloseTo(6.55, 2);
  });

  it('伤害 = ATK − DEF（有防御时，且不为负）', () => {
    expect(damage(6.55, 2)).toBeCloseTo(4.55, 2);
    expect(damage(2, 5)).toBe(0);
  });

  it('POW怪 = HP × SPD', () => {
    expect(monsterPOW(100, 0.5)).toBe(50);
  });

  it('POW塔 ≥ POW怪 时可拦截', () => {
    expect(canIntercept(80.4, 50)).toBe(true);
    expect(canIntercept(40.2, 50)).toBe(false);
    expect(canIntercept(50, 50)).toBe(true);
  });
});
