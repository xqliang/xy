import type { Battle } from '../../src/battle';
import { makePlacedUnit } from '../../src/battle';

const cellKey = (c: number, r: number) => `${c},${r}`;

/** 用户盘面里 · 表示路径/不可放格，只解锁已有兵或字的格 */
function unlockOccupied(b: Battle) {
  const unlocked = (b as unknown as { unlocked: Set<string> }).unlocked;
  unlocked.clear();
  for (const k of b.units.keys()) unlocked.add(k);
  for (const k of b.words.keys()) unlocked.add(k);
}

/** 用户标注为 · 的格（路径），布阵后不应落兵 */
export const BAILONG_DOT_CELLS: readonly { c: number; r: number }[] = [
  { c: 0, r: 5 },
  { c: 0, r: 6 }, { c: 2, r: 6 }, { c: 3, r: 6 }, { c: 4, r: 6 }, { c: 5, r: 6 }, { c: 7, r: 6 },
  { c: 0, r: 7 }, { c: 2, r: 7 }, { c: 5, r: 7 }, { c: 7, r: 7 },
  { c: 0, r: 8 }, { c: 2, r: 8 }, { c: 5, r: 8 }, { c: 7, r: 8 },
  { c: 0, r: 9 }, { c: 1, r: 9 }, { c: 2, r: 9 }, { c: 5, r: 9 }, { c: 6, r: 9 }, { c: 7, r: 9 },
];

/** 用户截图盘面（c0–c7, r5–r9） */
export function setupBailongScreenshot(b: Battle) {
  const pathAnchor = { c: 0, r: 5 };

  b.units.set(cellKey(1, 5), makePlacedUnit('spear', 2, { c: 1, r: 5 }, pathAnchor));
  b.units.set(cellKey(2, 5), makePlacedUnit('spear', 4, { c: 2, r: 5 }, pathAnchor));
  b.units.set(cellKey(3, 5), makePlacedUnit('archer', 2, { c: 3, r: 5 }, pathAnchor));
  b.words.set(cellKey(4, 5), { char: '流', general: 'liusha', tier: 1, cell: { c: 4, r: 5 } });
  b.words.set(cellKey(5, 5), { char: '沙', general: 'liusha', tier: 1, cell: { c: 5, r: 5 } });
  b.words.set(cellKey(6, 5), { char: '白', general: 'bailong', tier: 1, cell: { c: 6, r: 5 } });

  b.units.set(cellKey(1, 6), makePlacedUnit('archer', 5, { c: 1, r: 6 }, pathAnchor));
  b.units.set(cellKey(6, 6), makePlacedUnit('cavalry', 2, { c: 6, r: 6 }, pathAnchor));

  b.units.set(cellKey(1, 7), makePlacedUnit('cavalry', 5, { c: 1, r: 7 }, pathAnchor));
  b.words.set(cellKey(3, 7), { char: '八', general: 'baxian', tier: 2, cell: { c: 3, r: 7 } });
  b.words.set(cellKey(4, 7), { char: '仙', general: 'baxian', tier: 2, cell: { c: 4, r: 7 } });
  b.units.set(cellKey(6, 7), makePlacedUnit('dao', 1, { c: 6, r: 7 }, pathAnchor));

  b.units.set(cellKey(1, 8), makePlacedUnit('dao', 4, { c: 1, r: 8 }, pathAnchor));
  b.words.set(cellKey(3, 8), { char: '牛', general: 'niulang', tier: 2, cell: { c: 3, r: 8 } });
  b.words.set(cellKey(4, 8), { char: '郎', general: 'niulang', tier: 2, cell: { c: 4, r: 8 } });
  b.units.set(cellKey(6, 8), makePlacedUnit('spear', 1, { c: 6, r: 8 }, pathAnchor));

  b.words.set(cellKey(3, 9), { char: '梵', general: 'fanyin', tier: 1, cell: { c: 3, r: 9 } });
  b.words.set(cellKey(4, 9), { char: '音', general: 'fanyin', tier: 1, cell: { c: 4, r: 9 } });

  b.tray = [{ kind: 'word', char: '龙', general: 'bailong', tier: 1 }];
  b.status = 'playing';
  unlockOccupied(b);
}
