// 五行相克：数据层校验（武将 element 字段 / MAP_ELEMENT / 注入）。
// 各段由对应任务追加；本文件随功能分阶段成长。
import { describe, it, expect } from 'vitest';
import { GENERALS } from '../src/generals';
import { ELEMENTS, type Element } from '@core';

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
