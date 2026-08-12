/**
 * 观音下方 rge=1 的刀：欧氏离路近但攻圆盖不到路径时，
 * 布阵应迁到 pathCover>0 的空位（有则必迁；全无才留最近够不着格）。
 */
import { describe, it, expect } from 'vitest';
import { getUnitStat } from '@core';
import { Battle, makePlacedUnit } from '../src/battle';
import { mapById, isPlayerCell, isPathCell } from '../src/board';
import { pathCoverageLen } from '../src/board-power';
import { planAutoPlaceSteps } from '../src/autoplace';

const cellKey = (c: number, r: number) => `${c},${r}`;

function unlockAllBuild(b: Battle) {
  const unlocked = (b as unknown as { unlocked: Set<string> }).unlocked;
  for (let c = 0; c < b.map.cols; c++) {
    for (let r = 0; r < b.map.rows; r++) {
      if (isPlayerCell(b.map, c, r) && !isPathCell(b.map, c, r)) {
        unlocked.add(cellKey(c, r));
      }
    }
  }
}

function cover(b: Battle, c: number, r: number, type: 'dao' | 'archer', tier: number): number {
  const rge = getUnitStat(type, tier).rge;
  return pathCoverageLen(b.map, b.entranceDist, b.pathLen, c, r, rge);
}

function flushAutoPlace(b: Battle) {
  let guard = 0;
  while ((b as unknown as { autoPlacePlaying: boolean }).autoPlacePlaying && guard++ < 400) {
    (b as unknown as { autoPlacePlaybackGap: number }).autoPlacePlaybackGap = 0;
    (b as unknown as { tickAutoPlacePlayback: (dt: number) => void }).tickAutoPlacePlayback(1);
    for (const d of [...b.autoPlaceDragFx]) {
      (b as unknown as { commitAutoPlaceDrag: (d: typeof b.autoPlaceDragFx[number]) => void })
        .commitAutoPlaceDrag(d);
    }
    b.autoPlaceDragFx = [];
  }
}

describe('短兵落点：优先能盖到路径', () => {
  it('盘丝洞：观音下够不着的刀会迁到有 pathCover 的空位', () => {
    const b = new Battle(20260812, 1, mapById('pansidong'));
    unlockAllBuild(b);
    b.status = 'playing';
    b.wave = 16;

    const guanyinLeft = { c: 4, r: 7 };
    const guanyinRight = { c: 5, r: 7 };
    const daoCell = { c: 5, r: 8 };
    b.words.set(cellKey(guanyinLeft.c, guanyinLeft.r), {
      char: '观', general: 'guanyin', tier: 5, cell: { ...guanyinLeft },
    });
    b.words.set(cellKey(guanyinRight.c, guanyinRight.r), {
      char: '音', general: 'guanyin', tier: 5, cell: { ...guanyinRight },
    });
    b.units.set(
      cellKey(daoCell.c, daoCell.r),
      makePlacedUnit('dao', 1, daoCell, { c: 0, r: -1 }),
    );

    expect(cover(b, daoCell.c, daoCell.r, 'dao', 1)).toBeLessThanOrEqual(0.05);

    const freeCover = b.unlockedCells().filter((c) => {
      const k = cellKey(c.c, c.r);
      if (b.units.has(k) || b.words.has(k)) return false;
      return cover(b, c.c, c.r, 'dao', 1) > 0.05;
    });
    expect(freeCover.length).toBeGreaterThan(0);

    b.tray = [];
    b.autoPlaceTray();
    flushAutoPlace(b);

    const dao = [...b.units.values()].find((u) => u.type === 'dao' && u.tier === 1);
    expect(dao).toBeTruthy();
    expect(cover(b, dao!.cell.c, dao!.cell.r, 'dao', 1)).toBeGreaterThan(0.05);
    expect(dao!.cell.c === daoCell.c && dao!.cell.r === daoCell.r).toBe(false);
  });

  it('tray 刀：有覆盖空位时绝不落到 pathCover=0 的最近格', () => {
    const b = new Battle(42, 1, mapById('pansidong'));
    unlockAllBuild(b);
    b.status = 'playing';

    const unlocked = b.unlockedCells();
    const withCover = unlocked.filter((c) => cover(b, c.c, c.r, 'dao', 1) > 0.05);
    const noCover = unlocked.filter((c) => cover(b, c.c, c.r, 'dao', 1) <= 0.05);
    expect(withCover.length).toBeGreaterThan(0);
    expect(noCover.length).toBeGreaterThan(0);

    const keepCover = withCover[0]!;
    const keepNear = noCover.reduce((best, c) =>
      (b.nearestPathDist(c) < b.nearestPathDist(best) ? c : best));

    // 占掉其余覆盖格，只留 keepCover；keepNear 与其它无覆盖格保持空闲亦可
    for (const c of withCover) {
      if (c.c === keepCover.c && c.r === keepCover.r) continue;
      b.units.set(cellKey(c.c, c.r), makePlacedUnit('archer', 2, c, { c: 0, r: -1 }));
    }

    b.tray = [{ kind: 'unit', type: 'dao', tier: 1 }];
    const view = (b as unknown as {
      buildPlayerAutoView: () => Parameters<typeof planAutoPlaceSteps>[0];
    }).buildPlayerAutoView();
    planAutoPlaceSteps(view, { rng: () => 0.5, pSubOptimal: 0, maxSteps: 5 });

    const dao = [...b.units.values()].find((u) => u.type === 'dao');
    expect(dao).toBeTruthy();
    expect(cover(b, dao!.cell.c, dao!.cell.r, 'dao', 1)).toBeGreaterThan(0.05);
    expect(dao!.cell.c === keepNear.c && dao!.cell.r === keepNear.r).toBe(false);
  });
});
