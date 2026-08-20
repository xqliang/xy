import { describe, it, expect } from 'vitest';
import { bagDisplayOrder, bagMaxScroll } from '../src/bag';
import { WEAPONS, addWeaponFragment, weaponFragmentsRequired, isWeaponFragmentsComplete, addWeapon, MAX_WEAPON_TIER } from '../src/weapons';

describe('bag display order', () => {
  it('已装备按最近在前，未装备保持 WEAPONS 自然顺序', () => {
    const order = bagDisplayOrder({
      owned: { jingubang: 3, jiuchidingba: 2, kanyaodao: 1 },
      fragments: { jingubang: 4, jiuchidingba: 4, kanyaodao: 1 },
      equipped: ['jingubang', 'jiuchidingba', 'kanyaodao'],
    });
    expect(order.slice(0, 3)).toEqual(['kanyaodao', 'jiuchidingba', 'jingubang']);
    const tail = order.slice(3);
    const natural = WEAPONS.map((w) => w.id).filter((id) => !['jingubang', 'jiuchidingba', 'kanyaodao'].includes(id));
    expect(tail).toEqual(natural);
  });

  it('已获得未装备排在已装备之后、未获得之前', () => {
    const order = bagDisplayOrder({
      owned: { jingubang: 2, huojianqiang: 1, jiuchidingba: 1 },
      fragments: { jingubang: 4, huojianqiang: 3, jiuchidingba: 4 },
      equipped: ['jingubang'],
    });
    expect(order[0]).toBe('jingubang');
    expect(order.slice(1, 3)).toEqual(['huojianqiang', 'jiuchidingba']);
    expect(order.slice(3).every((id) => (order.includes(id)))).toBe(true);
    for (const id of order.slice(3)) {
      expect(['huojianqiang', 'jiuchidingba', 'jingubang']).not.toContain(id);
    }
  });
  it('列表高度超出视口时可滚动', () => {
    expect(bagMaxScroll()).toBeGreaterThan(0);
  });

  it('神兵碎片：低级1片、普通2片、中级3片、高级4片', () => {
    expect(weaponFragmentsRequired('xiaodingpa')).toBe(1);   // 大蟒 过渡 → low
    expect(weaponFragmentsRequired('jingping')).toBe(2);     // 观音 辅助 → normal
    expect(weaponFragmentsRequired('huntianling')).toBe(3);  // 红孩 T1 输出 → mid
    expect(weaponFragmentsRequired('sanjianliangrendao')).toBe(4); // 二郎 T0 输出 → high
    expect(weaponFragmentsRequired('jingubang')).toBe(4);    // 大圣 T0 输出 → high
  });

  it('addWeaponFragment 集齐后激活', () => {
    let s = { owned: {}, fragments: {}, equipped: [] };
    let r = addWeaponFragment(s, 'sanjianliangrendao');
    expect(r.activated).toBe(false); // 1/4
    s = r.state;
    r = addWeaponFragment(s, 'sanjianliangrendao');
    expect(r.activated).toBe(false); // 2/4
    s = r.state;
    r = addWeaponFragment(s, 'sanjianliangrendao');
    expect(r.activated).toBe(false); // 3/4
    s = r.state;
    r = addWeaponFragment(s, 'sanjianliangrendao');
    expect(r.activated).toBe(true); // 4/4 集齐激活（二郎 T0 → 三尖两刃刀 high 级 4 片）
    expect(r.state.owned['sanjianliangrendao']).toBe(1);
    expect(isWeaponFragmentsComplete(r.state, 'sanjianliangrendao')).toBe(false);
  });

  it('已激活未满阶可继续升阶；满阶后不再掉落', () => {
    let s = { owned: { xiaodingpa: 1 }, fragments: { xiaodingpa: 1 }, equipped: ['xiaodingpa'] };
    expect(isWeaponFragmentsComplete(s, 'xiaodingpa')).toBe(false);
    const up = addWeaponFragment(s, 'xiaodingpa');
    expect(up.upgraded).toBe(true);
    expect(up.state.owned['xiaodingpa']).toBe(2);
    s = up.state;
    let tier = 2;
    while (tier < MAX_WEAPON_TIER) {
      const r = addWeapon(s, 'xiaodingpa');
      s = r.state;
      tier++;
    }
    expect(s.owned['xiaodingpa']).toBe(MAX_WEAPON_TIER);
    expect(isWeaponFragmentsComplete(s, 'xiaodingpa')).toBe(true);
    const noop = addWeaponFragment(s, 'xiaodingpa');
    expect(noop.upgraded).toBe(false);
    expect(noop.state.owned['xiaodingpa']).toBe(MAX_WEAPON_TIER);
  });
});
