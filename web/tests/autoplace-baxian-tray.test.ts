/**
 * tray「仙」+ 棋盘「八」→ 一次布阵激活八仙（勿先 placeSingleWord 扔到远处）。
 */
import { describe, it, expect } from 'vitest';
import { Battle, makePlacedUnit } from '../src/battle';
import { mapById } from '../src/board';
import { planAutoPlaceSteps } from '../src/autoplace';

const cellKey = (c: number, r: number) => `${c},${r}`;

function setupBaigulingBaxian(b: Battle) {
  b.units.set(cellKey(0, 7), makePlacedUnit('dao', 2, { c: 0, r: 7 }, { c: 0, r: 6 }));
  b.units.set(cellKey(1, 7), makePlacedUnit('dao', 2, { c: 1, r: 7 }, { c: 0, r: 6 }));
  b.units.set(cellKey(2, 7), makePlacedUnit('spear', 2, { c: 2, r: 7 }, { c: 0, r: 6 }));
  b.units.set(cellKey(3, 7), makePlacedUnit('spear', 2, { c: 3, r: 7 }, { c: 0, r: 6 }));
  b.units.set(cellKey(0, 8), makePlacedUnit('cavalry', 2, { c: 0, r: 8 }, { c: 0, r: 6 }));
  b.units.set(cellKey(3, 8), makePlacedUnit('archer', 2, { c: 3, r: 8 }, { c: 0, r: 6 }));
  b.words.set(cellKey(3, 9), { char: '八', general: 'baxian', tier: 1, cell: { c: 3, r: 9 } });
  b.tray = [{ kind: 'word', char: '仙', general: 'baxian', tier: 1 }];
  b.status = 'playing';
  const unlocked = (b as unknown as { unlocked: Set<string> }).unlocked;
  unlocked.clear();
  for (const k of b.units.keys()) unlocked.add(k);
  for (const k of b.words.keys()) unlocked.add(k);
}

describe('tray仙 + 棋盘八 → 一次八仙', () => {
  it('仅 occupied 解锁时第一步即激活（伴侣可迁座）', () => {
    const b = new Battle(20260809, 4, mapById('baiguling'));
    setupBaigulingBaxian(b);

    planAutoPlaceSteps(
      (b as unknown as { buildPlayerAutoView(): import('../src/autoplace').AutoPlaceView })
        .buildPlayerAutoView(),
      { rng: () => 0, maxSteps: 1 },
    );

    expect(b.tray.some((t) => t.kind === 'word' && t.char === '仙')).toBe(false);
    expect(b.activeGenerals().some((g) => g.def.id === 'baxian')).toBe(true);
    const xian = [...b.words.values()].find((w) => w.char === '仙');
    const ba = [...b.words.values()].find((w) => w.char === '八');
    expect(xian && ba && xian.cell.c === ba.cell.c + 1 && xian.cell.r === ba.cell.r).toBe(true);
  });

  it('八在底块、邻格有弓：一次布阵换座并激活', () => {
    const b = new Battle(20260809, 4, mapById('baiguling'));
    setupBaigulingBaxian(b);
    b.words.delete(cellKey(3, 9));
    b.words.set(cellKey(2, 8), { char: '八', general: 'baxian', tier: 1, cell: { c: 2, r: 8 } });
    const unlocked = (b as unknown as { unlocked: Set<string> }).unlocked;
    unlocked.delete(cellKey(3, 9));
    unlocked.add(cellKey(2, 8));
    unlocked.add(cellKey(4, 8));
    unlocked.add(cellKey(4, 9));

    b.autoPlaceTray();

    expect(b.activeGenerals().some((g) => g.def.id === 'baxian')).toBe(true);
    const ba = [...b.words.values()].find((w) => w.char === '八');
    const xian = [...b.words.values()].find((w) => w.char === '仙');
    expect(ba?.cell).toEqual({ c: 2, r: 8 });
    expect(xian?.cell).toEqual({ c: 3, r: 8 });
  });
});
