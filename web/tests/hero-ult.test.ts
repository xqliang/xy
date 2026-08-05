import { describe, it, expect } from 'vitest';
import { GENERALS, ultTypeOf, CRIT_MULT } from '../src/generals';

describe('大招类型派生 ultTypeOf', () => {
  it('远程单点(ranged)英雄 = 暴击 crit', () => {
    for (const id of ['nezha', 'erlang']) {
      const def = GENERALS.find((g) => g.id === id)!;
      expect(ultTypeOf(def)).toBe('crit');
    }
  });

  it('其余技能类型 = 群攻 aoe', () => {
    for (const id of ['wukong', 'honghaier', 'bajie', 'tieshan', 'shaseng', 'niumowang', 'guanyin', 'baigujing', 'tangseng']) {
      const def = GENERALS.find((g) => g.id === id)!;
      expect(ultTypeOf(def)).toBe('aoe');
    }
  });

  it('恰好两个暴击英雄(哪吒/二郎)', () => {
    expect(GENERALS.filter((g) => ultTypeOf(g) === 'crit').map((g) => g.id).sort())
      .toEqual(['erlang', 'nezha']);
  });

  it('暴击倍率 > 1', () => {
    expect(CRIT_MULT).toBeGreaterThan(1);
  });
});
