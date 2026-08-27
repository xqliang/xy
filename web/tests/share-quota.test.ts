import { describe, it, expect } from 'vitest';
import { normalizeQuota, remainingOf, MAX_DAILY_SHARES } from '../src/share-quota';

describe('share-quota 纯逻辑', () => {
  it('上限为 4', () => {
    expect(MAX_DAILY_SHARES).toBe(4);
  });

  it('无存档 → 当日清零', () => {
    expect(normalizeQuota(null, 100)).toEqual({ day: 100, count: 0 });
  });

  it('跨天 → 次数清零并更新到当日', () => {
    expect(normalizeQuota({ day: 99, count: 3 }, 100)).toEqual({ day: 100, count: 0 });
  });

  it('同一天 → 保留次数', () => {
    expect(normalizeQuota({ day: 100, count: 2 }, 100)).toEqual({ day: 100, count: 2 });
  });

  it('异常次数被夹到 [0, MAX]', () => {
    expect(normalizeQuota({ day: 100, count: 9 }, 100)).toEqual({ day: 100, count: 4 });
    expect(normalizeQuota({ day: 100, count: -3 }, 100)).toEqual({ day: 100, count: 0 });
  });

  it('remainingOf = MAX - count（不小于 0）', () => {
    expect(remainingOf({ day: 100, count: 0 })).toBe(4);
    expect(remainingOf({ day: 100, count: 4 })).toBe(0);
    expect(remainingOf({ day: 100, count: 7 })).toBe(0);
  });
});
