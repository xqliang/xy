// PvP 终局结算纯逻辑：结局(win/lose/draw) → 段位变化(冻结单人 AI 难度) + 功德增量。
// 决策集中在 pvp-settle.ts 的纯函数，便于覆盖 draw / 难度冻结等边界（main.ts 只负责应用与持久化）。
import { describe, it, expect } from 'vitest';
import { pvpSettle } from '../src/pvp-settle';
import type { RankState } from '../src/rank';

const rank = (over: Partial<RankState> = {}): RankState => ({ level: 1, stars: 2, difficulty: 1.4, ...over });

describe('pvpSettle', () => {
  it('胜：加一颗星（冻结难度）+ 胜利档功德 20+波×2', () => {
    const out = pvpSettle('win', rank(), 6);
    expect(out.rankChange).not.toBeNull();
    expect(out.rankChange!.won).toBe(true);
    expect(out.rankChange!.starDelta).toBe(1);
    expect(out.rankChange!.state.stars).toBe(3);
    expect(out.rankChange!.state.difficulty).toBe(1.4); // 冻结：不动单人难度
    expect(out.meritGain).toBe(20 + 6 * 2);             // 32
  });

  it('负：减一颗星（冻结难度）+ 参与档功德 5+波×2', () => {
    const out = pvpSettle('lose', rank({ stars: 2 }), 6);
    expect(out.rankChange).not.toBeNull();
    expect(out.rankChange!.won).toBe(false);
    expect(out.rankChange!.starDelta).toBe(-1);
    expect(out.rankChange!.state.stars).toBe(1);
    expect(out.rankChange!.state.difficulty).toBe(1.4); // 冻结
    expect(out.meritGain).toBe(5 + 6 * 2);              // 17
  });

  it('平局：不动段位（rankChange=null）+ 参与档功德 5+波×2', () => {
    const out = pvpSettle('draw', rank(), 6);
    expect(out.rankChange).toBeNull();
    expect(out.meritGain).toBe(5 + 6 * 2);              // 17
  });

  it('功德随波数增长；波数按下限 1 计（wave<=0 也至少给 1 波）', () => {
    expect(pvpSettle('win', rank(), 1).meritGain).toBe(20 + 1 * 2); // 22
    expect(pvpSettle('draw', rank(), 0).meritGain).toBe(5 + 1 * 2); // 7（meritReward 内 wave 下限 1）
  });
});
