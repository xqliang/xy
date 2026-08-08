import { describe, it, expect } from 'vitest';
import { Battle, TUNING } from '../src/battle';
import { GENERALS, CRIT_MULT } from '../src/generals';

/** 找一对左右相邻的已解锁格 */
function findAdjacentPair(b: Battle): [{ c: number; r: number }, { c: number; r: number }] {
  const cells = b.unlockedCells();
  const set = new Set(cells.map((c) => `${c.c},${c.r}`));
  for (const c of cells) {
    const r = { c: c.c + 1, r: c.r };
    if (set.has(`${r.c},${r.r}`)) return [c, r];
  }
  throw new Error('no adjacent pair found');
}

describe('武将大招专注秒伤并入 Boss 压力估算（二郎暴击「游离账本外」问题）', () => {
  it('放置二郎后，pathDamage 应比纯普攻高出其暴击大招折算的秒伤', () => {
    const b = new Battle(1);
    const [L, R] = findAdjacentPair(b);
    const def = GENERALS.find((g) => g.id === 'erlang')!;
    b.tray = [{ kind: 'word', char: def.chars[0]!, general: def.id, tier: 1 }];
    expect(b.placeFromTray(0, L)).toBe(true);
    b.tray = [{ kind: 'word', char: def.chars[1]!, general: def.id, tier: 1 }];
    expect(b.placeFromTray(0, R)).toBe(true);
    expect(b.activeGenerals().length).toBe(1);

    const power = b.estimateOptimalPower();
    expect(power.coverageTotal).toBeGreaterThan(0);

    const g = b.activeGenerals()[0]!;
    const atk = b.generalAtk(g); // 白阶 tier=1，无武器/羁绊加成时与估算口径一致
    const frq = b.generalFrq(g);
    const spd = 0.5;
    const focusTargets = Math.min(1, def.targets);
    const baselinePathDmg = atk * frq * focusTargets * (power.coverageTotal / spd);
    const skillFocusDps = (atk * 5 * CRIT_MULT) / def.skillCd;
    const expected = baselinePathDmg + skillFocusDps * (power.coverageTotal / spd);

    expect(power.pathDamage(spd)).toBeCloseTo(expected, 4);
    expect(power.pathDamage(spd)).toBeGreaterThan(baselinePathDmg);
  });

  it('治疗系（观音）无大招伤害，pathDamage 与纯普攻一致', () => {
    const b = new Battle(1);
    const [L, R] = findAdjacentPair(b);
    const def = GENERALS.find((g) => g.id === 'guanyin')!;
    b.tray = [{ kind: 'word', char: def.chars[0]!, general: def.id, tier: 1 }];
    expect(b.placeFromTray(0, L)).toBe(true);
    b.tray = [{ kind: 'word', char: def.chars[1]!, general: def.id, tier: 1 }];
    expect(b.placeFromTray(0, R)).toBe(true);

    const power = b.estimateOptimalPower();
    const g = b.activeGenerals()[0]!;
    const atk = b.generalAtk(g);
    const frq = b.generalFrq(g);
    const spd = 0.5;
    const focusTargets = Math.min(1, def.targets);
    const baselinePathDmg = atk * frq * focusTargets * (power.coverageTotal / spd);
    expect(power.pathDamage(spd)).toBeCloseTo(baselinePathDmg, 4);
  });

  it('TUNING 常量存在，供 heroSkillFocusDps 换算各技能类型', () => {
    expect(TUNING.heroChargeStunDmgMul).toBeGreaterThan(0);
    expect(TUNING.heroKnockDmgMul).toBeGreaterThan(0);
    expect(TUNING.heroSlowDmgMulMain).toBeGreaterThan(0);
    expect(TUNING.heroBurnHitMul).toBeGreaterThan(0);
  });
});
