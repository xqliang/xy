import { describe, it, expect } from 'vitest';
import { GENERALS, ultTypeOf, CRIT_MULT } from '../src/generals';

/** 与 render.ts drawHeroUlt switch 对齐：有技能的武将均应有专属大招动画 */
const HERO_ULT_IDS = new Set([
  'nezha', 'erlang', 'niulang',
  'dasheng', 'honghaier', 'bajie', 'tieshan', 'shaseng', 'niumowang', 'guanyin', 'laojun', 'wenshu',
  'baigujing', 'tangseng',
  'damang', 'jinzha', 'hongpao', 'baxian', 'qingniu', 'tiebei', 'liusha', 'fanyin', 'danjun', 'huishu',
  'bailong',
]);

describe('大招类型派生 ultTypeOf', () => {
  it('远程单点(ranged)英雄 = 暴击 crit', () => {
    for (const id of ['erlang', 'niulang']) {
      const def = GENERALS.find((g) => g.id === id)!;
      expect(ultTypeOf(def)).toBe('crit');
    }
  });

  it('其余技能类型 = 群攻 aoe', () => {
    for (const id of ['dasheng', 'nezha', 'honghaier', 'bajie', 'tieshan', 'shaseng', 'niumowang', 'guanyin', 'laojun', 'wenshu', 'baigujing', 'bailong']) {
      const def = GENERALS.find((g) => g.id === id)!;
      expect(ultTypeOf(def)).toBe('aoe');
    }
  });

  it('暴击英雄为二郎/牛郎', () => {
    expect(GENERALS.filter((g) => ultTypeOf(g) === 'crit').map((g) => g.id).sort())
      .toEqual(['erlang', 'niulang']);
  });

  it('暴击倍率 > 1', () => {
    expect(CRIT_MULT).toBeGreaterThan(1);
  });

  it('所有在册武将均有大招动画分派', () => {
    for (const g of GENERALS) {
      expect(HERO_ULT_IDS.has(g.id), `${g.id}(${g.name}) 缺少大招动画`).toBe(true);
    }
  });
});
