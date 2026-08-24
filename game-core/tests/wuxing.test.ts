// 五行相克纯函数：克制环 5×5 全表 + 空属性回退。
import { describe, it, expect } from 'vitest';
import { elementMul, ELEMENTS, ELEMENT_ZH, ELEMENT_COLOR, type Element } from '../src/config/wuxing';

describe('elementMul（五行相克倍率）', () => {
  // 期望的克制环：金→木→土→水→火→金
  const ADV: [Element, Element][] = [
    ['metal', 'wood'], ['wood', 'earth'], ['earth', 'water'], ['water', 'fire'], ['fire', 'metal'],
  ];

  it('克制方 ×advMul（默认 1.25）', () => {
    for (const [atk, def] of ADV) expect(elementMul(atk, def)).toBe(1.25);
  });

  it('被克方 ×disMul（默认 0.75）', () => {
    for (const [atk, def] of ADV) expect(elementMul(def, atk)).toBe(0.75);
  });

  it('无关系 ×1.0（含自身）', () => {
    const all: Element[] = ELEMENTS.map((e) => e.id);
    for (const a of all) for (const d of all) {
      if (a === d) continue;
      if (ADV.some(([x, y]) => (x === a && y === d) || (x === d && y === a))) continue;
      expect(elementMul(a, d)).toBe(1.0);
    }
    for (const a of all) expect(elementMul(a, a)).toBe(1.0);
  });

  it('任一方为 null → ×1.0（兵种/无属性图不参与克制）', () => {
    for (const e of ELEMENTS.map((x) => x.id)) {
      expect(elementMul(e, null)).toBe(1.0);
      expect(elementMul(null, e)).toBe(1.0);
    }
    expect(elementMul(null, null)).toBe(1.0);
  });

  it('倍率可由调用方传入（TUNING 热改）', () => {
    expect(elementMul('water', 'fire', 1.4, 0.6)).toBe(1.4);
    expect(elementMul('fire', 'water', 1.4, 0.6)).toBe(0.6);
  });
});

describe('ELEMENTS 元数据', () => {
  it('五元素齐全，中文/色值一一对应', () => {
    expect(ELEMENTS.map((e) => e.id)).toEqual(['metal', 'wood', 'water', 'fire', 'earth']);
    expect(ELEMENTS.map((e) => e.zh)).toEqual(['金', '木', '水', '火', '土']);
    for (const e of ELEMENTS) {
      expect(ELEMENT_ZH[e.id]).toBe(e.zh);
      expect(ELEMENT_COLOR[e.id]).toBe(e.color);
      expect(e.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
