import { describe, it, expect } from 'vitest';
import { recordWin, recordLose, STARS_PER_TIER, LADDER_LEN, type RankState } from '../src/rank';

const fresh = (): RankState => ({ level: 0, stars: 0, difficulty: 1 });

describe('rank star progression', () => {
  it('每胜一局加一颗星', () => {
    const c = recordWin(fresh());
    expect(c.state.stars).toBe(1);
    expect(c.state.level).toBe(0);
    expect(c.starDelta).toBe(1);
    expect(c.won).toBe(true);
    expect(c.promoted).toBe(false);
    expect(c.before).toEqual({ level: 0, stars: 0 });
  });

  it('满星再胜→晋级下一档、星归 0', () => {
    let s: RankState = { level: 0, stars: STARS_PER_TIER - 1, difficulty: 1 };
    const c = recordWin(s);
    expect(c.promoted).toBe(true);
    expect(c.state.level).toBe(1);
    expect(c.state.stars).toBe(0);
    expect(c.starDelta).toBe(1);
  });

  it('最高档满星继续赢→星封顶、starDelta=0、不晋级', () => {
    const s: RankState = { level: LADDER_LEN - 1, stars: STARS_PER_TIER, difficulty: 2 };
    const c = recordWin(s);
    expect(c.state.level).toBe(LADDER_LEN - 1);
    expect(c.state.stars).toBe(STARS_PER_TIER);
    expect(c.starDelta).toBe(0);
    expect(c.promoted).toBe(false);
    // 难度仍上调
    expect(c.state.difficulty).toBeGreaterThan(2);
  });

  it('零星失败→降档、回退到 4 星', () => {
    const s: RankState = { level: 2, stars: 0, difficulty: 1.5 };
    const c = recordLose(s);
    expect(c.demoted).toBe(true);
    expect(c.state.level).toBe(1);
    expect(c.state.stars).toBe(STARS_PER_TIER - 1);
    expect(c.starDelta).toBe(-1);
    expect(c.won).toBe(false);
  });

  it('失败扣一颗星（未到降档）', () => {
    const s: RankState = { level: 3, stars: 3, difficulty: 1 };
    const c = recordLose(s);
    expect(c.state.level).toBe(3);
    expect(c.state.stars).toBe(2);
    expect(c.starDelta).toBe(-1);
    expect(c.demoted).toBe(false);
  });

  it('凡人 0 星失败→停在地板、starDelta=0、不降档', () => {
    const s: RankState = { level: 0, stars: 0, difficulty: 0.6 };
    const c = recordLose(s);
    expect(c.state.level).toBe(0);
    expect(c.state.stars).toBe(0);
    expect(c.starDelta).toBe(0);
    expect(c.demoted).toBe(false);
    // 难度不低于地板
    expect(c.state.difficulty).toBeGreaterThanOrEqual(0.6);
  });
});
