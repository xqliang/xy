// 五行相克：数据层校验（武将 element 字段 / MAP_ELEMENT / 注入）。
// 各段由对应任务追加；本文件随功能分阶段成长。
import { describe, it, expect } from 'vitest';
import { GENERALS } from '../src/generals';
import { ELEMENTS } from '@core';
import { Battle } from '../src/battle';
import { MAP_ELEMENT } from '../src/battle';
import { mapById } from '../src/board';

describe('GENERALS.element（武将五行）', () => {
  const VALID = new Set(ELEMENTS.map((e) => e.id));

  it('24 将 element 全部合法', () => {
    expect(GENERALS).toHaveLength(24);
    for (const g of GENERALS) expect(VALID.has(g.element)).toBe(true);
  });

  it('分布均衡：金5 木5 水5 火5 土4', () => {
    const count: Record<string, number> = {};
    for (const g of GENERALS) count[g.element] = (count[g.element] ?? 0) + 1;
    expect(count).toEqual({ metal: 5, wood: 5, water: 5, fire: 5, earth: 4 });
  });

  it('每行至少 1 个非「过渡」武将（克图阵容可用）', () => {
    for (const el of ELEMENTS.map((e) => e.id)) {
      const main = GENERALS.filter((g) => g.element === el && g.role !== '过渡');
      expect(main.length, `${el} 行缺少主力`).toBeGreaterThanOrEqual(1);
    }
  });

  it('火克金（白骨岭对策）与水克火（火焰山对策）的核心将在对应行', () => {
    // 火焰山=火，需水系：八戒/白龙应在水行
    expect(GENERALS.find((g) => g.id === 'bajie')!.element).toBe('water');
    // 白骨岭=金，需火系：哪吒应在火行
    expect(GENERALS.find((g) => g.id === 'nezha')!.element).toBe('fire');
    // 盘丝洞=木，需金系：大圣应在金行
    expect(GENERALS.find((g) => g.id === 'dasheng')!.element).toBe('metal');
  });
});

describe('MAP_ELEMENT（地图五行）', () => {
  it('现有四图各配一行，与 MAP_SKILL 同范式', () => {
    expect(MAP_ELEMENT.huoyanshan).toBe('fire');
    expect(MAP_ELEMENT.liushahe).toBe('water');
    expect(MAP_ELEMENT.baiguling).toBe('metal');
    expect(MAP_ELEMENT.pansidong).toBe('wood');
    // 黄风岭在 Task 7 补齐后此断言放开为 earth
  });
});

describe('怪物 element（按地图统一继承）', () => {
  it('火焰山开波后小怪 element 为 fire（boss/护卫走同一 makeOne，由对称性覆盖）', () => {
    const b = new Battle(1, 1, mapById('huoyanshan'));
    b.startNextWave();
    const monsters = () => (b as unknown as { monsters: { element: string | null }[] }).monsters;
    for (let i = 0; i < 300 && monsters().length === 0; i++) b.step(1 / 30);
    expect(monsters().length).toBeGreaterThan(0);
    for (const m of monsters()) expect(m.element).toBe('fire');
  });
});

describe('hurtMonster 五行注入（统一落点）', () => {
  function firstMonster(mapId: string) {
    const b = new Battle(1, 1, mapById(mapId));
    b.startNextWave();
    const get = () => (b as unknown as { monsters: { hp: number; element: string | null }[] }).monsters;
    for (let i = 0; i < 300 && get().length === 0; i++) b.step(1 / 30);
    const m = get()[0]!;
    m.hp = 100000; // 防止被打死干扰扣血断言
    const hurt = (el: string | null) => {
      const before = m.hp;
      (b as unknown as { hurtMonster: (m2: unknown, dmg: number, p: { c: number; r: number }, f: number, c2: boolean, el2: string | null) => void })
        .hurtMonster(m, 100, { c: 0, r: 5 }, 0.12, false, el);
      return before - m.hp;
    };
    return { hurt };
  }

  it('火焰山（火）：水克火 ×1.25、金被火克 ×0.75、同行 ×1.0、无属性 ×1.0，均取整', () => {
    const { hurt } = firstMonster('huoyanshan');
    expect(hurt('water')).toBe(125); // 水克火
    expect(hurt('metal')).toBe(75); // 火克金 → 攻击方金被克
    expect(hurt('fire')).toBe(100); // 同行
    expect(hurt(null)).toBe(100); // 兵种/环境伤害不吃克制
  });

  it('白骨岭（金）：火克金 ×1.25', () => {
    const { hurt } = firstMonster('baiguling');
    expect(hurt('fire')).toBe(125);
  });
});
