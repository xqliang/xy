import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { mapById, isPlayerCell, isPathCell } from '../src/board';
import { pathFirstEngageDist } from '../src/board-power';
import { planAutoPlaceSteps } from '../src/autoplace';
import type { AutoPlaceView } from '../src/autoplace';

const cellKey = (c: number, r: number) => `${c},${r}`;

function unlockCells(b: Battle, cells: { c: number; r: number }[]) {
  const unlocked = (b as unknown as { unlocked: Set<string> }).unlocked;
  for (const { c, r } of cells) {
    if (isPlayerCell(b.map, c, r) && !isPathCell(b.map, c, r)) unlocked.add(cellKey(c, r));
  }
}

function pairFirstEngage(b: Battle, left: { c: number; r: number }, right: { c: number; r: number }): number {
  const ax = (left.c + right.c) / 2;
  const ay = (left.r + right.r) / 2;
  return pathFirstEngageDist(b.map, b.entranceDist, b.pathLen, ax, ay, 2);
}

describe('白骨岭 · 已激活白骨布阵覆盖', () => {
  it('孤儿凑对后微调 coverage（偏右散字 → 左移贴路）', () => {
    const b = new Battle(20260809, 1, mapById('baiguling'));
    unlockCells(
      b,
      [
        { c: 4, r: 6 }, { c: 5, r: 6 }, { c: 6, r: 6 }, { c: 7, r: 6 },
      ],
    );
    // 两字未相邻：凑对属于武将布局变更，才触发 coverage 微调
    b.words.set(cellKey(5, 6), { char: '白', general: 'baigujing', tier: 1, cell: { c: 5, r: 6 } });
    b.words.set(cellKey(7, 6), { char: '骨', general: 'baigujing', tier: 1, cell: { c: 7, r: 6 } });
    b.status = 'playing';

    const beforeEngage = pairFirstEngage(b, { c: 6, r: 6 }, { c: 7, r: 6 });
    const afterTargetEngage = pairFirstEngage(b, { c: 5, r: 6 }, { c: 6, r: 6 });
    expect(afterTargetEngage).toBeLessThan(beforeEngage);

    const view = (b as unknown as { buildPlayerAutoView(): AutoPlaceView }).buildPlayerAutoView();
    planAutoPlaceSteps(view, { rng: () => 0, maxSteps: 30 });

    const bai = [...b.words.values()].find((w) => w.char === '白' && w.general === 'baigujing');
    const gu = [...b.words.values()].find((w) => w.char === '骨' && w.general === 'baigujing');
    expect(bai!.cell).toEqual({ c: 5, r: 6 });
    expect(gu!.cell).toEqual({ c: 6, r: 6 });
    expect(pairFirstEngage(b, bai!.cell, gu!.cell)).toBeLessThan(beforeEngage);
  });

  it('已激活且布局未变：纯布阵不无条件左移', () => {
    const b = new Battle(20260809, 1, mapById('baiguling'));
    unlockCells(b, [{ c: 5, r: 6 }, { c: 6, r: 6 }, { c: 7, r: 6 }]);
    b.words.set(cellKey(6, 6), { char: '白', general: 'baigujing', tier: 1, cell: { c: 6, r: 6 } });
    b.words.set(cellKey(7, 6), { char: '骨', general: 'baigujing', tier: 1, cell: { c: 7, r: 6 } });
    b.status = 'playing';

    const view = (b as unknown as { buildPlayerAutoView(): AutoPlaceView }).buildPlayerAutoView();
    planAutoPlaceSteps(view, { rng: () => 0, maxSteps: 30 });

    expect(b.words.get(cellKey(6, 6))?.char).toBe('白');
    expect(b.words.get(cellKey(7, 6))?.char).toBe('骨');
  });
});
