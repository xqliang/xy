import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { GENERALS } from '../src/generals';

// 找一对横向相邻的已解锁格（初始阵位），用于激活武将（左右紧邻两字）
function adjacentPair(b: Battle): [{ c: number; r: number }, { c: number; r: number }] | null {
  const cells = b.unlockedCells();
  const set = new Set(cells.map((c) => `${c.c},${c.r}`));
  for (const c of cells) {
    if (set.has(`${c.c + 1},${c.r}`)) return [c, { c: c.c + 1, r: c.r }];
  }
  return null;
}

describe('tray 候选区内字↔兵可交换', () => {
  it('字牌拖到兵种槽 → 两槽交换', () => {
    const b = new Battle(1);
    const g = GENERALS[0]!;
    b.tray = [
      { kind: 'word', char: g.chars[0]!, general: g.id, tier: 1 },
      { kind: 'unit', type: 'archer', tier: 2 },
    ];
    expect(b.mergeTrayTokens(0, 1)).toBe(true);
    expect(b.tray[0]).toEqual({ kind: 'unit', type: 'archer', tier: 2 });
    expect(b.tray[1]).toEqual({ kind: 'word', char: g.chars[0]!, general: g.id, tier: 1 });
  });

  it('兵种拖到字牌槽 → 两槽交换', () => {
    const b = new Battle(1);
    const g = GENERALS[0]!;
    b.tray = [
      { kind: 'unit', type: 'spear', tier: 1 },
      { kind: 'word', char: g.chars[1]!, general: g.id, tier: 1 },
    ];
    expect(b.mergeTrayTokens(0, 1)).toBe(true);
    expect(b.tray[0]).toEqual({ kind: 'word', char: g.chars[1]!, general: g.id, tier: 1 });
    expect(b.tray[1]).toEqual({ kind: 'unit', type: 'spear', tier: 1 });
  });
});

describe('tray 放置：字↔兵可交换', () => {
  it('字牌落到有兵的格 → 交换：字上板、兵回候选槽', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.tray = [{ kind: 'unit', type: 'dao', tier: 1 }];
    expect(b.placeFromTray(0, cell)).toBe(true);
    const g = GENERALS[0]!;
    b.tray = [{ kind: 'word', char: g.chars[0]!, general: g.id, tier: 1 }];
    expect(b.placeFromTray(0, cell)).toBe(true);
    expect(b.words.has(`${cell.c},${cell.r}`)).toBe(true);
    expect(b.units.has(`${cell.c},${cell.r}`)).toBe(false);
    expect(b.tray[0]).toEqual({ kind: 'unit', type: 'dao', tier: 1 });
  });

  it('兵落到有字牌的格 → 交换：兵上板、字回候选槽', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    const g = GENERALS[0]!;
    b.tray = [{ kind: 'word', char: g.chars[0]!, general: g.id, tier: 1 }];
    expect(b.placeFromTray(0, cell)).toBe(true);
    b.tray = [{ kind: 'unit', type: 'archer', tier: 1 }];
    expect(b.placeFromTray(0, cell)).toBe(true);
    expect(b.units.has(`${cell.c},${cell.r}`)).toBe(true);
    expect(b.words.has(`${cell.c},${cell.r}`)).toBe(false);
    expect(b.tray[0]).toEqual({ kind: 'word', char: g.chars[0]!, general: g.id, tier: 1 });
  });
});

describe('喂 1 张字牌升整个已激活英雄', () => {
  it('1级X + 放同将 1级字 → 整对升 2 级、字牌消耗', () => {
    const b = new Battle(1);
    const pair = adjacentPair(b);
    expect(pair).not.toBeNull(); // 初始阵位应存在横向相邻格
    const [L, R] = pair!;
    const g = GENERALS[0]!;
    b.tray = [{ kind: 'word', char: g.chars[0]!, general: g.id, tier: 1 }];
    expect(b.placeFromTray(0, L)).toBe(true);
    b.tray = [{ kind: 'word', char: g.chars[1]!, general: g.id, tier: 1 }];
    expect(b.placeFromTray(0, R)).toBe(true);
    const before = b.activeGenerals();
    expect(before.length).toBe(1);
    expect(before[0]!.tier).toBe(1);
    // 再喂一张同将 1 级字 → 整对升 2 级
    b.tray = [{ kind: 'word', char: g.chars[0]!, general: g.id, tier: 1 }];
    expect(b.placeFromTray(0, L)).toBe(true);
    const after = b.activeGenerals();
    expect(after.length).toBe(1);
    expect(after[0]!.tier).toBe(2);
    expect(b.tray.length).toBe(0);
  });
});
