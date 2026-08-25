/**
 * 拖武器（兵/unit）到棋盘上的英雄单字（word）格：占格字牌必须换回 tray，绝不丢失。
 *
 * 回归点：旧版 doPlaceFromTray「兵落字格」分支在 isHeroRosterComplete() 为真时
 * 只 clearTraySlot、把占格字牌 delete 掉（字牌凭空消失）；现一律交换回 tray。
 * 与对称的「字落兵格」分支保持一致。
 */
import { describe, it, expect } from 'vitest';
import { Battle, makePlacedUnit } from '../src/battle';
import { UNITS, type UnitType } from '@core';
import { mapById } from '../src/board';

const cellKey = (c: number, r: number) => `${c},${r}`;

describe('兵落字格不丢字（始终与 tray 交换）', () => {
  it('兵落到被字牌占用的格：字牌换回 tray，兵落格，棋盘字牌总数不变', () => {
    const b = new Battle(1, 1, mapById('pansidong'));
    b.status = 'ready';
    for (const c of b.lockedCells()) b.unlocked.add(cellKey(c.c, c.r)); // 全场解锁，目标格可落

    const cells = b.unlockedCells();
    const wordCell = cells[0]!;
    const unitType = Object.keys(UNITS)[0] as UnitType;

    // 棋盘上一个单字（英雄单字）
    b.words.set(cellKey(wordCell.c, wordCell.r), {
      char: '太', general: 'taibai', tier: 1, cell: { ...wordCell },
    });
    const wordsBefore = b.words.size;
    // tray 里一个兵（武器）
    b.tray = [{ kind: 'unit', type: unitType, tier: 1 }];

    const ok = b.placeFromTray(0, wordCell);
    expect(ok).toBe(true);

    // 兵落格
    expect(b.units.get(cellKey(wordCell.c, wordCell.r))?.type).toBe(unitType);
    // 占格字牌换回 tray（未丢），棋盘该格已空
    expect(b.words.get(cellKey(wordCell.c, wordCell.r))).toBeUndefined();
    const trayWord = b.tray[0];
    expect(trayWord?.kind).toBe('word');
    if (trayWord?.kind === 'word') expect(trayWord.char).toBe('太');
    // 棋盘字牌被换走（减少 1），且字牌未凭空消失（进了 tray）
    expect(b.words.size).toBe(wordsBefore - 1);
  });

  it('即使武将全满（isHeroRosterComplete=true），兵落字格仍把字牌换回 tray，不吞字', () => {
    const b = new Battle(1, 1, mapById('pansidong'));
    b.status = 'ready';
    for (const c of b.lockedCells()) b.unlocked.add(cellKey(c.c, c.r)); // 全场解锁

    const cells = b.unlockedCells();
    const wordCell = cells[0]!;
    const unitType = Object.keys(UNITS)[0] as UnitType;

    b.words.set(cellKey(wordCell.c, wordCell.r), {
      char: '太', general: 'taibai', tier: 1, cell: { ...wordCell },
    });
    b.tray = [{ kind: 'unit', type: unitType, tier: 1 }];

    // 强制 isHeroRosterComplete()=true，命中旧版 bug 分支（旧分支会 delete 占格字牌）。
    const stub = b as unknown as { isHeroRosterComplete: () => boolean };
    const orig = stub.isHeroRosterComplete;
    stub.isHeroRosterComplete = () => true;
    try {
      const ok = b.placeFromTray(0, wordCell);
      expect(ok).toBe(true);
      // 兵落格
      expect(b.units.get(cellKey(wordCell.c, wordCell.r))?.type).toBe(unitType);
      // 占格字牌被换回 tray，而非被吞掉
      const trayWord = b.tray[0];
      expect(trayWord?.kind).toBe('word');
      if (trayWord?.kind === 'word') expect(trayWord.char).toBe('太');
      // 棋盘上该字牌已离开
      expect(b.words.has(cellKey(wordCell.c, wordCell.r))).toBe(false);
    } finally {
      stub.isHeroRosterComplete = orig;
    }
  });
});

// 供其它用例参考：兵/兵不可合并时的对称交换也应保留占格单位（不再丢失）。
describe('兵落兵格对称（不可合并时交换，不吞单位）', () => {
  it('不同型兵落到兵格：占格兵换回 tray，不删除', () => {
    const b = new Battle(1, 1, mapById('pansidong'));
    b.status = 'ready';
    for (const c of b.lockedCells()) b.unlocked.add(cellKey(c.c, c.r));
    const cells = b.unlockedCells();
    const cell = cells[0]!;
    const types = Object.keys(UNITS) as UnitType[];
    if (types.length < 2) return; // 至少两种兵才能构造「不可合并」
    const a = types[0]!;
    const bType = types[1]!;
    b.units.set(cellKey(cell.c, cell.r), makePlacedUnit(a, 1, cell));
    b.tray = [{ kind: 'unit', type: bType, tier: 1 }];
    const ok = b.placeFromTray(0, cell);
    expect(ok).toBe(true);
    expect(b.units.get(cellKey(cell.c, cell.r))?.type).toBe(bType);
    const trayUnit = b.tray[0];
    expect(trayUnit?.kind).toBe('unit');
    if (trayUnit?.kind === 'unit') expect(trayUnit.type).toBe(a);
  });
});
