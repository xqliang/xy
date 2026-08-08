import { describe, it, expect } from 'vitest';
import { pickAiLoadout } from '../src/ai-loadout';
import { AI_SKILL_MIN, AI_SKILL_MAX } from '../src/ai-skill';
import { MAX_EQUIPPED_ACTIVES, enabledActives } from '../src/actives';
import { MAX_EQUIPPED_PASSIVES, enabledPassives } from '../src/passives';

// 确定性伪随机（与仓库其它测试同款 LCG 手写实现，避免依赖 RNG 类）
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('pickAiLoadout', () => {
  it('AI 强度下限：预算为 0，买不起任何主动/被动（与旧版无技能行为对齐）', () => {
    const { actives, passives } = pickAiLoadout(AI_SKILL_MIN, makeRng(1));
    expect(actives.length).toBe(0);
    expect(passives.length).toBe(0);
  });

  it('AI 强度上限：预算充裕，至少买到 1 个主动、被动买到不少于上限的一半', () => {
    // 贪心按洗牌顺序先到先买（非最优装箱），预算刚好覆盖上限时，
    // 若先抽到较贵的主动可能只塞得下 1 个，因此只断言下限而非精确等于上限。
    const { actives, passives } = pickAiLoadout(AI_SKILL_MAX, makeRng(1));
    expect(actives.length).toBeGreaterThanOrEqual(1);
    expect(actives.length).toBeLessThanOrEqual(MAX_EQUIPPED_ACTIVES);
    expect(passives.length).toBeGreaterThanOrEqual(Math.floor(MAX_EQUIPPED_PASSIVES / 2));
  });

  it('购买结果始终是启用技能池的子集，且不超过各自装备上限', () => {
    const activeIds = new Set(enabledActives().map((a) => a.id));
    const passiveIds = new Set(enabledPassives().map((p) => p.id));
    for (let seed = 1; seed <= 20; seed++) {
      const skill = AI_SKILL_MIN + ((AI_SKILL_MAX - AI_SKILL_MIN) * seed) / 20;
      const { actives, passives } = pickAiLoadout(skill, makeRng(seed * 7919));
      expect(actives.length).toBeLessThanOrEqual(MAX_EQUIPPED_ACTIVES);
      expect(passives.length).toBeLessThanOrEqual(MAX_EQUIPPED_PASSIVES);
      expect(new Set(actives).size).toBe(actives.length); // 无重复
      expect(new Set(passives).size).toBe(passives.length);
      for (const id of actives) expect(activeIds.has(id)).toBe(true);
      for (const id of passives) expect(passiveIds.has(id)).toBe(true);
    }
  });

  it('同一 rng 序列下结果确定（可重复），不同 seed 通常给出不同装备组合', () => {
    const a = pickAiLoadout(1.2, makeRng(42));
    const b = pickAiLoadout(1.2, makeRng(42));
    expect(a).toEqual(b);
    const c = pickAiLoadout(1.2, makeRng(43));
    expect(a.actives.join(',') !== c.actives.join(',') || a.passives.join(',') !== c.passives.join(',')).toBe(true);
  });

  it('AI 强度越高，平均购得的技能数量不低于强度低时（宏观单调，允许个别抽样波动）', () => {
    const sample = (skill: number): number => {
      let total = 0;
      const N = 30;
      for (let seed = 1; seed <= N; seed++) {
        const { actives, passives } = pickAiLoadout(skill, makeRng(seed * 104729));
        total += actives.length + passives.length;
      }
      return total / N;
    };
    const low = sample(AI_SKILL_MIN + 0.02);
    const high = sample(AI_SKILL_MAX - 0.02);
    expect(high).toBeGreaterThan(low);
  });
});
