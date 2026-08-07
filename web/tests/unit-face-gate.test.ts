import { describe, it, expect } from 'vitest';
import { MAPS, pathEntranceCell, faceDirToward } from '../src/board';
import { Battle, makePlacedUnit } from '../src/battle';

describe('武器落位朝向出怪口', () => {
  it('faceDirToward：朝左出口时 cos < 0（立绘翻转）', () => {
    const gate = { c: 0, r: 5 };
    const cell = { c: 3, r: 6 };
    const dir = faceDirToward(cell, gate);
    expect(Math.cos(dir)).toBeLessThan(0);
  });

  it('placeFromTray 后 fireDir 指向本图出怪口', () => {
    const map = MAPS[0]!;
    const b = new Battle(1, 1, map);
    const cell = b.unlockedCells()[0]!;
    b.tray = [{ kind: 'unit', type: 'monkey', tier: 1 }];
    expect(b.placeFromTray(0, cell)).toBe(true);
    const u = b.units.get(`${cell.c},${cell.r}`)!;
    expect(u.fireDir).toBeDefined();
    const gate = pathEntranceCell(map.path);
    expect(u.fireDir!).toBeCloseTo(faceDirToward(cell, gate), 5);
  });

  it('makePlacedUnit 可显式传入朝向目标', () => {
    const u = makePlacedUnit('archer', 2, { c: 4, r: 7 }, { c: 0, r: 7 });
    expect(u.fireDir).toBeCloseTo(Math.PI, 5); // 正左
  });
});
