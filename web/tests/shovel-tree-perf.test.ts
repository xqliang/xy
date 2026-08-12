/**
 * tray 铲子 + 地图桃树挡挖：布阵收尾不得因「tray 非空」空转调位。
 */
import { describe, it, expect } from 'vitest';
import { Battle, makePlacedUnit } from '../src/battle';
import { mapById } from '../src/board';

const cellKey = (c: number, r: number) => `${c},${r}`;

function setupShovelBlockedByTree(b: Battle) {
  b.status = 'playing';
  b.wave = 10;
  const unlocked = (b as unknown as { unlocked: Set<string> }).unlocked;
  const locked = b.lockedCells();
  expect(locked.length).toBeGreaterThan(0);
  const treeCell = locked[0]!;
  for (const c of locked.slice(1)) unlocked.add(cellKey(c.c, c.r));
  b.trees.set(cellKey(treeCell.c, treeCell.r), {
    level: 1,
    cell: { ...treeCell },
    growT: 0,
  });
  let n = 0;
  for (const c of b.unlockedCells()) {
    if (n >= 14) break;
    const type = (['dao', 'spear', 'archer', 'cavalry'] as const)[n % 4]!;
    b.units.set(cellKey(c.c, c.r), makePlacedUnit(type, 1 + (n % 3), c, { c: 0, r: -1 }));
    n++;
  }
  b.tray = [{ kind: 'shovel' }];
}

describe('铲子+桃树挡挖 布阵性能', () => {
  it('autoPlaceTray 同场景应在一帧内结束（无 sweep 空转）', () => {
    const b = new Battle(99, 1, mapById('pansidong'));
    setupShovelBlockedByTree(b);
    const t0 = performance.now();
    b.autoPlaceTray();
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(80);
    expect(b.tray.some((t) => t?.kind === 'shovel')).toBe(true);
    expect(b.message).not.toMatch(/随后调位/);
  });
});
