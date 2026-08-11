// web/tests/ai-balance.test.ts
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { nextAiSkill } from '../src/ai-skill';

// 脚本玩家：够桃就征兵+一键布阵，按帧推进，直到分出胜负、波数过高或时间上限。
// 对战已无「清波通关」，胜负只看唐僧；波数封顶避免无限波把 sim 拖成数分钟。
function playOneMatch(seed: number, aiSkill: number): boolean {
  const b = new Battle(seed, 1, undefined, undefined, undefined, undefined, undefined, false, aiSkill);
  let t = 0;
  // 陨石半径 1.4→2、冰封定身 2.5s→3s 后 AI 自身防守更强、清波更久；给够游戏时长再判超时，
  // 避免把「AI 也扛住了」误判成「未分胜负」拉低玩家胜率统计。
  const CAP = 150 * 30; // 约 2.5 分钟游戏时（30fps）
  const WAVE_CAP = 12; // 超时波：视为未分胜负（不计玩家胜）
  while (b.status !== 'won' && b.status !== 'lost' && t < CAP && b.wave < WAVE_CAP) {
    if (b.status === 'ready') b.startNextWave(); // 跳过清波后 5s 等待，加快 sim
    if (b.peach >= b.snapshot().summonCost) { b.summon(); b.autoPlaceTray(); }
    b.step(1 / 30);
    t++;
  }
  return b.status === 'won';
}

describe('AI 平衡 sim（宏观、非精确）', () => {
  it('固定脚本玩家下，nextAiSkill 不发散、AI 不崩盘', () => {
    let skill = 1.0; let wins = 0; const N = 16;
    let minSkill = skill, maxSkill = skill;
    for (let i = 0; i < N; i++) {
      const won = playOneMatch(1000 + i, skill);
      if (i >= 4) wins += won ? 1 : 0; // 预热后统计
      skill = nextAiSkill(skill, won);
      minSkill = Math.min(minSkill, skill); maxSkill = Math.max(maxSkill, skill);
    }
    expect(minSkill).toBeGreaterThanOrEqual(0.72);
    expect(maxSkill).toBeLessThanOrEqual(1.8);
    const rate = wins / (N - 4);
    // 反馈方向正确性：不预设本局脚本玩家的绝对胜率（随数值调整会变），只要求
    // 明显偏胜/偏负时，控制器把 AI skill 调向对应方向（偏胜→调高，偏负→调低）。
    if (rate > 0.55) expect(skill).toBeGreaterThanOrEqual(1.0);
    else if (rate < 0.45) expect(skill).toBeLessThanOrEqual(1.0);
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.98);
  }, 180000);
});
