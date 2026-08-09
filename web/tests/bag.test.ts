import { describe, it, expect } from 'vitest';
import { bagDisplayOrder, bagMaxScroll } from '../src/bag';
import { WEAPONS } from '../src/weapons';

describe('bag display order', () => {
  it('已装备按最近在前，未装备保持 WEAPONS 自然顺序', () => {
    const order = bagDisplayOrder({
      owned: { jingubang: 3, jiuchidingba: 2, kanyaodao: 1 },
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
});
