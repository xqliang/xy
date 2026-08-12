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

  it('候选区满且目标槽有武器时可交换', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.units.set(`${cell.c},${cell.r}`, {
      type: 'dao', tier: 2, cell, cooldown: 0, firePulse: 0, combo: 0,
      stunT: 0, slowT: 0, weakenT: 0, rangeCutT: 0, knockdownT: 0,
      stunImmuneT: 0, slowImmuneT: 0, weakenImmuneT: 0, rangeCutImmuneT: 0, knockdownImmuneT: 0,
    });
    b.tray = Array.from({ length: TUNING.traySize }, () => ({ kind: 'unit' as const, type: 'spear' as const, tier: 1 }));
    expect(b.recallToTray(cell, 0)).toBe(true);
    expect(b.tray[0]).toEqual({ kind: 'unit', type: 'dao', tier: 2 });
    const onBoard = b.units.get(`${cell.c},${cell.r}`)!;
    expect(onBoard.type).toBe('spear');
    expect(onBoard.tier).toBe(1);
  });

  it('棋盘字牌可拖到空槽', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.words.set(`${cell.c},${cell.r}`, { char: '大', general: 'dasheng', tier: 1, cell });
    b.tray = [];
    expect(b.recallToTray(cell, 0)).toBe(true);
    expect(b.words.has(`${cell.c},${cell.r}`)).toBe(false);
    expect(b.tray[0]).toEqual({ kind: 'word', char: '大', general: 'dasheng', tier: 1 });
  });

  it('棋盘武器与候选区字牌交换', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.units.set(`${cell.c},${cell.r}`, {
      type: 'dao', tier: 1, cell, cooldown: 0, firePulse: 0, combo: 0,
      stunT: 0, slowT: 0, weakenT: 0, rangeCutT: 0, knockdownT: 0,
      stunImmuneT: 0, slowImmuneT: 0, weakenImmuneT: 0, rangeCutImmuneT: 0, knockdownImmuneT: 0,
    });
    b.tray = [{ kind: 'word', char: '圣', general: 'dasheng', tier: 2 }];
    expect(b.recallToTray(cell, 0)).toBe(true);
    expect(b.units.has(`${cell.c},${cell.r}`)).toBe(false);
    expect(b.words.get(`${cell.c},${cell.r}`)).toMatchObject({ char: '圣', tier: 2 });
    expect(b.tray[0]).toEqual({ kind: 'unit', type: 'dao', tier: 1 });
  });

  it('棋盘字牌与候选区武器交换', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.words.set(`${cell.c},${cell.r}`, { char: '大', general: 'dasheng', tier: 1, cell });
    b.tray = [{ kind: 'unit', type: 'archer', tier: 3 }];
    expect(b.recallToTray(cell, 0)).toBe(true);
    expect(b.words.has(`${cell.c},${cell.r}`)).toBe(false);
    expect(b.units.get(`${cell.c},${cell.r}`)).toMatchObject({ type: 'archer', tier: 3 });
    expect(b.tray[0]).toEqual({ kind: 'word', char: '大', general: 'dasheng', tier: 1 });
  });

  it('已激活武将可拖单字回候选区并拆开', () => {
    const b = new Battle(1);
    const cells = b.unlockedCells();
    const a = cells[0]!;
    const right = cells.find((c) => c.r === a.r && c.c === a.c + 1) ?? cells[1]!;
    // 若找不到同行右格，解锁相邻格
    const br = { c: a.c + 1, r: a.r };
    b.unlocked.add(`${br.c},${br.r}`);
    b.words.set(`${a.c},${a.r}`, { char: '大', general: 'dasheng', tier: 2, cell: a });
    b.words.set(`${br.c},${br.r}`, { char: '圣', general: 'dasheng', tier: 2, cell: br });
    expect(b.activeGenerals().some((g) => g.def.id === 'dasheng')).toBe(true);
    b.tray = [];
    expect(b.recallToTray(a, 0)).toBe(true);
    expect(b.tray[0]).toEqual({ kind: 'word', char: '大', general: 'dasheng', tier: 2 });
    expect(b.words.has(`${a.c},${a.r}`)).toBe(false);
    expect(b.words.get(`${br.c},${br.r}`)).toMatchObject({ char: '圣', tier: 2 });
    expect(b.activeGenerals().some((g) => g.def.id === 'dasheng')).toBe(false);
  });

  it('与铲子槽不可交换', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.units.set(`${cell.c},${cell.r}`, {
      type: 'dao', tier: 1, cell, cooldown: 0, firePulse: 0, combo: 0,
      stunT: 0, slowT: 0, weakenT: 0, rangeCutT: 0, knockdownT: 0,
      stunImmuneT: 0, slowImmuneT: 0, weakenImmuneT: 0, rangeCutImmuneT: 0, knockdownImmuneT: 0,
    });
    b.tray = [{ kind: 'shovel' }];
    expect(b.recallToTray(cell, 0)).toBe(false);
    expect(b.units.has(`${cell.c},${cell.r}`)).toBe(true);
    expect(b.tray[0]).toEqual({ kind: 'shovel' });
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
