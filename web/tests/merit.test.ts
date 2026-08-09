import { describe, it, expect } from 'vitest';
import { meritReward } from '../src/merit';

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
