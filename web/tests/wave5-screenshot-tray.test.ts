/**
 * 复现用户截图：第5波、铁背+金吒已激活、tray 红+牛、右侧有空格，点布阵应落字。
 */
import { describe, it, expect } from 'vitest';
import { planAutoPlaceSteps } from '../src/autoplace';
import { Battle, makePlacedUnit } from '../src/battle';
import { isPlayerCell, isPathCell, mapById } from '../src/board';
import { matchGeneral } from '../src/generals';

const cellKey = (c: number, r: number) => `${c},${r}`;

function unlockCells(b: Battle, cells: readonly { c: number; r: number }[]) {
  const unlocked = (b as unknown as { unlocked: Set<string> }).unlocked;
  for (const { c, r } of cells) {
    if (isPlayerCell(b.map, c, r) && !isPathCell(b.map, c, r)) {
      unlocked.add(cellKey(c, r));
    }
  }
}

function setupScreenshotLikeBoard(b: Battle) {
  const m = b.map;
  const placeable: { c: number; r: number }[] = [];
  for (let c = 0; c < 8; c++) {
    for (let r = 5; r < 10; r++) {
      if (isPlayerCell(m, c, r) && !isPathCell(m, c, r)) placeable.push({ c, r });
    }
  }
  unlockCells(b, placeable);

  b.words.set(cellKey(3, 6), { char: '铁', general: 'tiebei', tier: 1, cell: { c: 3, r: 6 } });
  b.words.set(cellKey(4, 6), { char: '背', general: 'tiebei', tier: 1, cell: { c: 4, r: 6 } });
  b.words.set(cellKey(3, 7), { char: '金', general: 'jinzha', tier: 1, cell: { c: 3, r: 7 } });
  b.words.set(cellKey(4, 7), { char: '吒', general: 'jinzha', tier: 1, cell: { c: 4, r: 7 } });

  const face = { c: 0, r: 5 };
  b.units.set(cellKey(0, 6), makePlacedUnit('archer', 1, { c: 0, r: 6 }, face));
  b.units.set(cellKey(1, 6), makePlacedUnit('cavalry', 3, { c: 1, r: 6 }, face));
  b.units.set(cellKey(2, 6), makePlacedUnit('dao', 2, { c: 2, r: 6 }, face));
  b.units.set(cellKey(2, 7), makePlacedUnit('dao', 1, { c: 2, r: 7 }, face));
  b.units.set(cellKey(0, 7), makePlacedUnit('spear', 2, { c: 0, r: 7 }, face));
  b.units.set(cellKey(1, 7), makePlacedUnit('cavalry', 2, { c: 1, r: 7 }, face));

  b.tray = [
    { kind: 'word', char: '红', general: 'honghaier', tier: 1 },
    { kind: 'word', char: '牛', general: 'niulang', tier: 1 },
  ];
  (b as unknown as { wave: number }).wave = 5;
  (b as unknown as { status: string }).status = 'playing';
}

describe('wave5 screenshot tray words', () => {
  it('autoPlaceTray 应将 tray 红+牛落到空格', () => {
    const b = new Battle(mapById('pansidong'));
    setupScreenshotLikeBoard(b);
    const freeBefore = b.unlockedCells().filter(
      (c) => !b.units.has(cellKey(c.c, c.r)) && !b.words.has(cellKey(c.c, c.r)),
    );
    expect(freeBefore.length).toBeGreaterThan(0);

    b.autoPlaceTray();

    expect(b.tray.some((t) => t.kind === 'word')).toBe(false);
    expect([...b.words.values()].some((w) => w.char === '红')).toBe(true);
    expect([...b.words.values()].some((w) => w.char === '牛')).toBe(true);
    expect(b.message).not.toMatch(/暂无可执行/);
  });

  it('步数受限时仍应优先落 tray 孤儿字', () => {
    const b = new Battle(mapById('pansidong'));
    setupScreenshotLikeBoard(b);
    const view = (b as unknown as { buildPlayerAutoView: () => import('../src/autoplace').AutoPlaceView }).buildPlayerAutoView();
    const placed = planAutoPlaceSteps(view, { rng: () => 0, maxSteps: 3, pSubOptimal: 0 });
    expect(placed).toBeGreaterThan(0);
    expect(b.tray.some((t) => t.kind === 'word')).toBe(false);
  });

  it('placeFromTray 手动落字到空格应成功', () => {
    const b = new Battle(mapById('pansidong'));
    setupScreenshotLikeBoard(b);
    const target = b.unlockedCells().find(
      (c) => !b.units.has(cellKey(c.c, c.r)) && !b.words.has(cellKey(c.c, c.r)),
    )!;
    expect(target).toBeDefined();
    const ok = b.placeFromTray(0, target);
    expect(ok).toBe(true);
    expect(b.tray.length).toBe(1);
    expect(b.tray[0]?.kind === 'word' && b.tray[0].char).toBe('牛');
  });
});
