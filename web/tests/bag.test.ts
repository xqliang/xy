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

  it('列表高度超出视口时可滚动', () => {
    expect(bagMaxScroll()).toBeGreaterThan(0);
  });
});
