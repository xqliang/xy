import { describe, it, expect } from 'vitest';
import { bagDisplayOrder, bagMaxScroll } from '../src/bag';
import { WEAPONS, addWeaponFragment, weaponFragmentsRequired, isWeaponFragmentsComplete } from '../src/weapons';

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

  it('神兵碎片：低级1片激活，高级4片', () => {
    expect(weaponFragmentsRequired('xiaodingpa')).toBe(1);
    expect(weaponFragmentsRequired('jingping')).toBe(2);
    expect(weaponFragmentsRequired('sanjianliangrendao')).toBe(3);
    expect(weaponFragmentsRequired('jingubang')).toBe(4);
  });

  it('addWeaponFragment 集齐后激活', () => {
    let s = { owned: {}, fragments: {}, equipped: [] };
    let r = addWeaponFragment(s, 'sanjianliangrendao');
    expect(r.activated).toBe(false);
    s = r.state;
    r = addWeaponFragment(s, 'sanjianliangrendao');
    expect(r.activated).toBe(false);
    s = r.state;
    r = addWeaponFragment(s, 'sanjianliangrendao');
    expect(r.activated).toBe(true);
    expect(r.state.owned['sanjianliangrendao']).toBe(1);
    expect(isWeaponFragmentsComplete(r.state, 'sanjianliangrendao')).toBe(true);
  });
});
