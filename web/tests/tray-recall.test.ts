import { describe, it, expect } from 'vitest';
import { Battle, TUNING } from '../src/battle';

function freshWithGarden(): Battle {
  return new Battle(1, 1, undefined, undefined, undefined, [], ['pas_pantao']);
}

describe('棋盘拖回候选区', () => {
  it('兵器有空槽时可收回', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.units.set(`${cell.c},${cell.r}`, {
      type: 'dao', tier: 2, cell, cooldown: 0, firePulse: 0, combo: 0,
      stunT: 0, slowT: 0, weakenT: 0, rangeCutT: 0, knockdownT: 0,
      stunImmuneT: 0, slowImmuneT: 0, weakenImmuneT: 0, rangeCutImmuneT: 0, knockdownImmuneT: 0,
    });
    b.tray = [{ kind: 'unit', type: 'spear', tier: 1 }];
    expect(b.recallToTray(cell, 1)).toBe(true);
    expect(b.units.has(`${cell.c},${cell.r}`)).toBe(false);
    expect(b.tray[1]).toEqual({ kind: 'unit', type: 'dao', tier: 2 });
    expect(b.tray[0]).toEqual({ kind: 'unit', type: 'spear', tier: 1 });
  });

  it('候选区满时不可收回', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.units.set(`${cell.c},${cell.r}`, {
      type: 'dao', tier: 1, cell, cooldown: 0, firePulse: 0, combo: 0,
      stunT: 0, slowT: 0, weakenT: 0, rangeCutT: 0, knockdownT: 0,
      stunImmuneT: 0, slowImmuneT: 0, weakenImmuneT: 0, rangeCutImmuneT: 0, knockdownImmuneT: 0,
    });
    b.tray = Array.from({ length: TUNING.traySize }, () => ({ kind: 'unit' as const, type: 'dao' as const, tier: 1 }));
    expect(b.recallToTray(cell, 0)).toBe(false);
  });
});

describe('桃树候选区暂停/恢复产桃', () => {
  it('收回候选区后 growT 冻结，种回后继续', () => {
    const b = freshWithGarden();
    const cell = b.lockedCells()[0]!;
    b.trees.set(`${cell.c},${cell.r}`, { level: 1, cell, growT: 19.5 });
    expect(b.recallToTray(cell, 0)).toBe(true);
    expect(b.trees.has(`${cell.c},${cell.r}`)).toBe(false);
    expect(b.tray[0]).toEqual({ kind: 'tree', level: 1, growT: 19.5 });

    const before = b.peach;
    for (let i = 0; i < 60; i++) b.step(1 / 60); // 1s，在 tray 中不应产桃
    expect(b.peach - before).toBe(0);
    expect(b.tray[0]).toEqual({ kind: 'tree', level: 1, growT: 19.5 });

    const spot = b.lockedCells()[1]!;
    expect(b.placeFromTray(0, spot)).toBe(true);
    const planted = b.trees.get(`${spot.c},${spot.r}`)!;
    expect(planted.growT).toBeCloseTo(19.5, 5);

    for (let i = 0; i < 60; i++) b.step(1 / 60);
    expect(b.peach - before).toBe(1);
  });
});

describe('征兵清空候选区', () => {
  it('征兵时收回的桃树/兵器一并清除', () => {
    const b = freshWithGarden();
    b.grantPeach(1000);
    const cell = b.lockedCells()[0]!;
    b.trees.set(`${cell.c},${cell.r}`, { level: 2, cell, growT: 3 });
    b.recallToTray(cell, 2);
    expect(b.tray[2]?.kind).toBe('tree');

    b.summon();
    expect(b.tray[2]?.kind).not.toBe('tree');
    expect(b.tray.filter(Boolean)).toHaveLength(TUNING.summonDraws);
  });
});
