import { describe, it, expect } from 'vitest';
import { meritReward, setMerit } from '../src/merit';
import { menuVersionHitAt, VERSION_HIT } from '../src/menu';

describe('meritReward', () => {
  it('无尽模式超过10波按实际波数累加功德', () => {
    expect(meritReward(false, 10, { endless: true })).toBe(25);
    expect(meritReward(false, 11, { endless: true })).toBe(27);
    expect(meritReward(false, 15, { endless: true })).toBe(35);
    expect(meritReward(false, 15, { endless: true })).toBeGreaterThan(
      meritReward(false, 10, { endless: true }),
    );
  });

  it('对战通关仍用胜利基础分', () => {
    expect(meritReward(true, 8)).toBe(36);
    expect(meritReward(false, 8)).toBe(21);
  });
});

describe('setMerit', () => {
  it('将功德设为指定值且不为负', () => {
    const next = setMerit({ merit: 12, levels: { foo: 1 } }, 500);
    expect(next.merit).toBe(500);
    expect(next.levels).toEqual({ foo: 1 });
    expect(setMerit(next, -3).merit).toBe(0);
  });
});

describe('menuVersionHitAt', () => {
  it('右下角版本号区域可命中', () => {
    const cx = VERSION_HIT.x + VERSION_HIT.w - 8;
    const cy = VERSION_HIT.y + VERSION_HIT.h - 8;
    expect(menuVersionHitAt(cx, cy)).toBe(true);
    expect(menuVersionHitAt(VERSION_HIT.x - 1, cy)).toBe(false);
  });
});
