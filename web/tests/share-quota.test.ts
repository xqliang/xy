import { describe, it, expect } from 'vitest';
import {
  normalizeQuota,
  remainingOf,
  MAX_DAILY_STAMINA_SHARES,
  MAX_DAILY_SHOVEL_SHARES,
} from '../src/share-quota';

describe('share-quota 纯逻辑（体力/铲子两独立池）', () => {
  it('两类上限各为 3', () => {
    expect(MAX_DAILY_STAMINA_SHARES).toBe(3);
    expect(MAX_DAILY_SHOVEL_SHARES).toBe(3);
  });

  it('无存档 → 当日清零', () => {
    expect(normalizeQuota(null, 100)).toEqual({ day: 100, stamina: 0, shovel: 0 });
  });

  it('跨天 → 两类次数清零并更新到当日', () => {
    expect(normalizeQuota({ day: 99, stamina: 2, shovel: 3 }, 100)).toEqual({ day: 100, stamina: 0, shovel: 0 });
  });

  it('同一天 → 两类次数各自保留', () => {
    expect(normalizeQuota({ day: 100, stamina: 1, shovel: 2 }, 100)).toEqual({ day: 100, stamina: 1, shovel: 2 });
  });

  it('异常次数被各自夹到 [0, MAX]', () => {
    expect(normalizeQuota({ day: 100, stamina: 9, shovel: -3 }, 100)).toEqual({ day: 100, stamina: 3, shovel: 0 });
  });

  it('remainingOf 按类计算 = MAX - used（不小于 0）', () => {
    const q = { day: 100, stamina: 1, shovel: 3 };
    expect(remainingOf(q, 'stamina')).toBe(2);
    expect(remainingOf(q, 'shovel')).toBe(0);
    expect(remainingOf({ day: 100, stamina: 7, shovel: 0 }, 'stamina')).toBe(0);
  });

  it('两池互不占用：体力用满不影响铲子', () => {
    const q = normalizeQuota({ day: 100, stamina: 3, shovel: 0 }, 100);
    expect(remainingOf(q, 'stamina')).toBe(0);
    expect(remainingOf(q, 'shovel')).toBe(3);
  });
});
