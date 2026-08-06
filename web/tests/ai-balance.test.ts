// web/tests/ai-balance.test.ts
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { nextAiSkill } from '../src/ai-skill';

// 脚本玩家：够桃就征兵+一键布阵，按帧推进，直到分出胜负或到时间上限。
function playOneMatch(seed: number, aiSkill: number): boolean {
  const b = new Battle(seed, 1, undefined, undefined, undefined, undefined, undefined, false, aiSkill);
  let t = 0;
  const CAP = 60 * 30 * 3; // 约 3 分钟游戏时（30fps）
  while (b.status !== 'won' && b.status !== 'lost' && t < CAP) {
    if (b.peach >= b.snapshot().summonCost) { b.summon(); b.autoPlaceTray(); }
    b.step(1 / 30);
    t++;
  }
  return b.status === 'won';
}

describe('AI 平衡 sim（宏观、非精确）', () => {
  it('固定脚本玩家下，nextAiSkill 不发散、AI 不崩盘', () => {
    let skill = 1.0; let wins = 0; const N = 30;
    for (let i = 0; i < N; i++) {
      const won = playOneMatch(1000 + i, skill);
      if (i >= 8) wins += won ? 1 : 0; // 预热后统计
      skill = nextAiSkill(skill, won);
    }
    expect(skill).toBeGreaterThanOrEqual(0.72);
    expect(skill).toBeLessThanOrEqual(1.8);
    const rate = wins / (N - 8);
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.98);
  }, 120000);
});
