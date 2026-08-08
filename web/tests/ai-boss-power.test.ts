// web/tests/ai-boss-power.test.ts
// AI 对手 Boss 血量应按 AI 自己场上的战力(estimateAiOptimalPower)独立核算，
// 既要随 AI 自身场上兵力/技能增强而上调，也不应被玩家一侧的战力变化牵动。
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { AI_SKILL_MIN, AI_SKILL_MAX } from '../src/ai-skill';

describe('estimateAiOptimalPower', () => {
  it('AI 无兵无将时最优 DPS 为 0', () => {
    const b = new Battle(1, 1, undefined, undefined, undefined, undefined, undefined, false, AI_SKILL_MIN);
    expect((b as any).estimateAiOptimalPower().optimalDps).toBe(0);
  });

  it('AI 场上有兵时最优 DPS > 0', () => {
    const b = new Battle(1, 1, undefined, undefined, undefined, undefined, undefined, false, AI_SKILL_MIN);
    const cell = b.aiUnlockedCells()[0]!;
    b.aiTray = [{ kind: 'unit', type: 'spear', tier: 3 }];
    b.aiPlaceFromTray(0, cell);
    expect((b as any).estimateAiOptimalPower().optimalDps).toBeGreaterThan(0);
  });

  it('相同布局下，强 AI（aiMods 增益更多）的最优 DPS 不低于弱 AI', () => {
    const makeWithUnit = (aiSkill: number): number => {
      const b = new Battle(5, 1, undefined, undefined, undefined, undefined, undefined, false, aiSkill);
      const cell = b.aiUnlockedCells()[0]!;
      b.aiTray = [{ kind: 'unit', type: 'spear', tier: 3 }];
      b.aiPlaceFromTray(0, cell);
      return (b as any).estimateAiOptimalPower().optimalDps as number;
    };
    const weak = makeWithUnit(AI_SKILL_MIN);
    const strong = makeWithUnit(AI_SKILL_MAX);
    expect(strong).toBeGreaterThanOrEqual(weak);
  });
});

describe('AI 侧 Boss 血量方案（computeAiWavePressure）独立于玩家战力', () => {
  it('玩家一侧堆再多兵，AI 的 Boss 血量方案不变', () => {
    const seed = 11;
    const wave = 6;
    const bBase = new Battle(seed, 1, undefined, undefined, undefined, undefined, undefined, false, AI_SKILL_MIN);
    const baseHp = ((bBase as any).computeAiWavePressure(wave) as { bossHp: number }).bossHp;

    const bBuffed = new Battle(seed, 1, undefined, undefined, undefined, undefined, undefined, false, AI_SKILL_MIN);
    // 给玩家一侧堆一堆高阶兵，只应影响玩家自己的 Boss 压力账本，不应牵动 AI 侧方案
    for (const cell of bBuffed.unlockedCells().slice(0, 5)) {
      bBuffed.tray = [{ kind: 'unit', type: 'archer', tier: 5 }];
      bBuffed.placeFromTray(0, cell);
    }
    const buffedHp = ((bBuffed as any).computeAiWavePressure(wave) as { bossHp: number }).bossHp;

    expect(buffedHp).toBe(baseHp);
  });

  it('AI 自己场上战力越强，Boss 血量方案不应低于战力更弱时', () => {
    const seed = 11;
    const wave = 6;
    const makePlan = (aiSkill: number): number => {
      const b = new Battle(seed, 1, undefined, undefined, undefined, undefined, undefined, false, aiSkill);
      for (const cell of b.aiUnlockedCells().slice(0, 5)) {
        b.aiTray = [{ kind: 'unit', type: 'archer', tier: 5 }];
        b.aiPlaceFromTray(0, cell);
      }
      return ((b as any).computeAiWavePressure(wave) as { bossHp: number }).bossHp;
    };
    const weakHp = makePlan(AI_SKILL_MIN);
    const strongHp = makePlan(AI_SKILL_MAX);
    expect(strongHp).toBeGreaterThanOrEqual(weakHp);
  });
});
