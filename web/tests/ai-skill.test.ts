// web/tests/ai-skill.test.ts
import { describe, it, expect } from 'vitest';
import { nextAiSkill, skillToKnobs, AI_SKILL_MIN, AI_SKILL_MAX, DEFAULT_AI_SKILL } from '../src/ai-skill';

describe('nextAiSkill', () => {
  it('玩家胜 → 调强(升)，玩家负 → 调弱(降)', () => {
    expect(nextAiSkill(1.0, true)).toBeGreaterThan(1.0);
    expect(nextAiSkill(1.0, false)).toBeLessThan(1.0);
  });

  it('负的降幅 > 胜的升幅（目标 70% 的非对称步长）', () => {
    const up = nextAiSkill(1.0, true) - 1.0;
    const down = 1.0 - nextAiSkill(1.0, false);
    expect(down).toBeGreaterThan(up);
    expect(down / up).toBeCloseTo(7 / 3, 1);
  });

  it('clamp 到 [MIN, MAX]', () => {
    expect(nextAiSkill(AI_SKILL_MIN, false)).toBe(AI_SKILL_MIN);
    expect(nextAiSkill(AI_SKILL_MAX, true)).toBe(AI_SKILL_MAX);
  });

  it('对固定强度玩家：以伯努利 p=0.7 输入长期收敛，均衡点胜率≈70%', () => {
    let skill = 1.4;
    let seed = 12345;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    let wins = 0; const N = 4000;
    for (let i = 0; i < N; i++) {
      const p = Math.max(0, Math.min(1, 1.2 - 0.5 * skill));
      const won = rand() < p;
      if (i > 1000 && won) wins++;
      skill = nextAiSkill(skill, won);
    }
    const rate = wins / (N - 1000);
    expect(rate).toBeGreaterThan(0.62);
    expect(rate).toBeLessThan(0.78);
    expect(skill).toBeGreaterThan(0.85);
    expect(skill).toBeLessThan(1.15);
  });
});

describe('skillToKnobs', () => {
  it('skill 越高 → 征兵间隔越短、次优概率越低', () => {
    const lo = skillToKnobs(0.8), hi = skillToKnobs(1.6);
    expect(hi.summonInterval).toBeLessThan(lo.summonInterval);
    expect(hi.pSubOptimal).toBeLessThan(lo.pSubOptimal);
  });
  it('次优概率封顶（打压克制、不明显）且非负', () => {
    const k = skillToKnobs(AI_SKILL_MIN);
    expect(k.pSubOptimal).toBeLessThanOrEqual(0.35 + 1e-9);
    expect(skillToKnobs(AI_SKILL_MAX).pSubOptimal).toBeGreaterThanOrEqual(0);
  });
  it('征兵间隔被 clamp 在可信人手速内', () => {
    expect(skillToKnobs(AI_SKILL_MAX).summonInterval).toBeGreaterThanOrEqual(1.2 - 1e-9);
    expect(skillToKnobs(AI_SKILL_MIN).summonInterval).toBeLessThanOrEqual(5.0 + 1e-9);
  });
});
