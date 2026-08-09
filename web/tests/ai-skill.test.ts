// web/tests/ai-skill.test.ts
import { describe, it, expect } from 'vitest';
import {
  nextAiSkill, skillToKnobs, AI_SKILL_MIN, AI_SKILL_MAX, DEFAULT_AI_SKILL,
  aiItemTargetCount, rollAiLoadout, EMPTY_PLAYER_ITEM_CAP,
  AI_EXCLUDED_PASSIVES, aiWeaponScale, scaleWeaponBonuses,
} from '../src/ai-skill';

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

describe('rollAiLoadout', () => {
  it('玩家无道具时 AI 随机带 0..2 个', () => {
    expect(aiItemTargetCount(0, DEFAULT_AI_SKILL, () => 0)).toBe(0);
    expect(aiItemTargetCount(0, DEFAULT_AI_SKILL, () => 1)).toBe(1);
    expect(aiItemTargetCount(0, DEFAULT_AI_SKILL, () => 2)).toBe(2);
    expect(EMPTY_PLAYER_ITEM_CAP).toBe(2);

    const none = rollAiLoadout([], [], DEFAULT_AI_SKILL, () => 0);
    expect(none.actives).toEqual([]);
    expect(none.passives).toEqual([]);

    const two = rollAiLoadout([], [], DEFAULT_AI_SKILL, (n) => n - 1);
    expect(two.actives.length + two.passives.length).toBe(2);
  });

  it('玩家有配置时 AI 数量接近且随 skill 调节', () => {
    const playerA = ['act_palm'];
    const playerP = ['xiandan', 'fenghuolun'];
    const hi = rollAiLoadout(playerA, playerP, AI_SKILL_MAX, (n) => n - 1);
    const lo = rollAiLoadout(playerA, playerP, AI_SKILL_MIN, () => 0);
    expect(hi.actives.length + hi.passives.length).toBeGreaterThanOrEqual(
      lo.actives.length + lo.passives.length,
    );
    expect(aiItemTargetCount(3, DEFAULT_AI_SKILL)).toBe(3);
  });

  it('弱 AI 面对满装玩家仍至少带 60% 道具', () => {
    expect(aiItemTargetCount(8, AI_SKILL_MIN)).toBeGreaterThanOrEqual(5);
    expect(aiItemTargetCount(8, 0.8)).toBeGreaterThanOrEqual(5);
    const lo = rollAiLoadout(['act_palm'], ['xiandan', 'jubaopen', 'fenghuolun'], AI_SKILL_MIN, () => 0);
    expect(lo.actives.length + lo.passives.length).toBeGreaterThanOrEqual(2);
  });

  it('排除 AI 不适用的被动（蟠桃园 / 洛阳铲）', () => {
    expect(AI_EXCLUDED_PASSIVES.has('pas_pantao')).toBe(true);
    expect(AI_EXCLUDED_PASSIVES.has('luoyangchan')).toBe(true);
    for (let seed = 0; seed < 20; seed++) {
      const roll = rollAiLoadout(['act_palm'], ['xiandan', 'jubaopen'], DEFAULT_AI_SKILL, (n) => (seed * 17 + n) % n);
      for (const id of roll.passives) {
        expect(AI_EXCLUDED_PASSIVES.has(id)).toBe(false);
      }
    }
  });

  it('高 skill 比低 skill 更常选 debuff 被动', () => {
    const debuffRate = (skill: number) => {
      let hits = 0;
      for (let seed = 0; seed < 30; seed++) {
        const roll = rollAiLoadout([], ['xiandan', 'jubaopen', 'fenghuolun', 'yuni', 'zhuwang'], skill, (n) => (seed * 17 + n) % n);
        if (roll.passives.some((id) => id === 'yuni' || id === 'zhuwang')) hits++;
      }
      return hits;
    };
    expect(debuffRate(AI_SKILL_MAX)).toBeGreaterThan(debuffRate(AI_SKILL_MIN));
  });
});

describe('aiWeaponScale', () => {
  it('弱 AI 神兵约 65%，强 AI 约 100%', () => {
    expect(aiWeaponScale(AI_SKILL_MIN)).toBeCloseTo(0.65, 2);
    expect(aiWeaponScale(AI_SKILL_MAX)).toBeCloseTo(1.0, 2);
  });

  it('scaleWeaponBonuses 按比例缩放', () => {
    const src = { dasheng: { atk: 0.2, frq: 0.1, rge: 1 } };
    const scaled = scaleWeaponBonuses(src, 0.5);
    expect(scaled.dasheng!.atk).toBeCloseTo(0.1);
    expect(scaled.dasheng!.frq).toBeCloseTo(0.05);
    expect(scaled.dasheng!.rge).toBeCloseTo(0.5);
  });
});
