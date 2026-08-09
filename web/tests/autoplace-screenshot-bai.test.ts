/**
 * 复现用户截图：「白」右侧贴唐僧行，其左下 (2,6)/(3,6) 有空位、
 * tray 满 5 个 1 阶兵，点布阵应填满空位且不能卡顿。
 *
 * 根因（2026-08）：tryPairBoardOrphans / 凑字调位在 tryDeployTrayUnits 之前，
 * 48 步被字牌挪动吃光，tray 兵一直落不下去。
 */
import { describe, it, expect } from 'vitest';
import { Battle, makePlacedUnit } from '../src/battle';
import { mapById, isPlayerCell, isPathCell } from '../src/board';
import {
  PLAYER_PLACE_MAX_GUARD,
  PLAYER_PLACE_MAX_STEPS,
  PLAYER_REPOSITION_MAX_STEPS,
  planAutoPlaceSteps,
} from '../src/autoplace';

const cellKey = (c: number, r: number) => `${c},${r}`;

/** 截图盘面关键格（火焰山，0 起算列行） */
export const SCREENSHOT_BAI = { c: 4, r: 5 } as const;
export const SCREENSHOT_EMPTY_LEFT = [{ c: 2, r: 6 }, { c: 3, r: 6 }] as const;

function unlockPlayerCells(b: Battle, cells: readonly { c: number; r: number }[]) {
  for (const { c, r } of cells) {
    if (isPlayerCell(b.map, c, r) && !isPathCell(b.map, c, r)) {
      (b as unknown as { unlocked: Set<string> }).unlocked.add(cellKey(c, r));
    }
  }
}

function putUnit(b: Battle, type: 'dao' | 'spear' | 'cavalry' | 'archer', tier: number, c: number, r: number) {
  b.units.set(cellKey(c, r), makePlacedUnit(type, tier, { c, r }, { c: 0, r: 5 }));
}

function putWord(b: Battle, char: string, general: string, tier: number, c: number, r: number) {
  b.words.set(cellKey(c, r), { char, general, tier, cell: { c, r } });
}

/** 按截图还原的 mid-game 盘面（简化：保留白/八仙/右侧孤字 + 主要武器） */
function setupScreenshotBoard(b: Battle) {
  const m = b.map;
  const allPlaceable: { c: number; r: number }[] = [];
  for (let c = 0; c < 8; c++) {
    for (let r = 5; r < 10; r++) {
      if (isPlayerCell(m, c, r) && !isPathCell(m, c, r)) allPlaceable.push({ c, r });
    }
  }
  unlockPlayerCells(b, allPlaceable);

  // 顶行（贴唐僧）：三骑 + 白（白左侧 (3,5) 在本布局被 L3 骑占，空位在左下 (2,6)(3,6)）
  putUnit(b, 'cavalry', 2, 1, 5);
  putUnit(b, 'cavalry', 2, 2, 5);
  putUnit(b, 'cavalry', 3, 3, 5);
  putWord(b, '白', 'baigujing', 1, SCREENSHOT_BAI.c, SCREENSHOT_BAI.r);

  putUnit(b, 'dao', 1, 0, 6);
  putWord(b, '郎', 'erlang', 1, 4, 6);
  putUnit(b, 'dao', 3, 0, 7);
  putUnit(b, 'dao', 2, 2, 7);
  putUnit(b, 'spear', 4, 3, 7);
  putWord(b, '二', 'erlang', 1, 4, 7);

  putUnit(b, 'spear', 2, 0, 8);
  putWord(b, '八', 'baxian', 1, 2, 8);
  putWord(b, '仙', 'baxian', 1, 3, 8);
  putWord(b, '圣', 'dasheng', 1, 4, 8);

  putUnit(b, 'archer', 3, 2, 9);
  putUnit(b, 'archer', 3, 3, 9);

  // 截图 tray：5 个 1 阶兵
  b.tray = [
    { kind: 'unit', type: 'cavalry', tier: 1 },
    { kind: 'unit', type: 'archer', tier: 1 },
    { kind: 'unit', type: 'spear', tier: 1 },
    { kind: 'unit', type: 'cavalry', tier: 1 },
    { kind: 'unit', type: 'archer', tier: 1 },
  ];

  b.status = 'playing';
  b.wave = 4;
  b.monsters.push({
    id: 1,
    hp: 8000,
    maxHp: 8000,
    dist: b.pathLen - 6,
    spd: 0.4,
    side: 'player',
  } as never);
}

function cellOccupied(b: Battle, c: number, r: number): boolean {
  const k = cellKey(c, r);
  return b.units.has(k) || b.words.has(k);
}

describe('截图复现：白字左下空位 + tray 满兵', () => {
  it('布阵应填满 (2,6)/(3,6)，且耗时受步数上限约束', () => {
    const b = new Battle(20260809, 1, mapById('huoyanshan'));
    setupScreenshotBoard(b);

    for (const { c, r } of SCREENSHOT_EMPTY_LEFT) {
      expect(b.unlocked.has(cellKey(c, r))).toBe(true);
      expect(cellOccupied(b, c, r)).toBe(false);
    }

    const nd = b.nearestPathDist(SCREENSHOT_EMPTY_LEFT[0]!);
    expect(nd).toBeLessThanOrEqual(2.5); // 离路约 1–2 格，任何 1 阶兵都够得着

    const trayBefore = b.tray.length;
    const t0 = performance.now();
    b.autoPlaceTray();
    const elapsed = performance.now() - t0;

    const filled = SCREENSHOT_EMPTY_LEFT.filter(({ c, r }) => b.units.has(cellKey(c, r)));
    expect(filled.length).toBeGreaterThan(0);
    expect(b.tray.length).toBeLessThan(trayBefore);
    expect(elapsed).toBeLessThan(200);
    expect(b.message).not.toBe('布阵：当前暂无可执行操作');
  });

  it('性能回归：单轮布阵步数不超过 PLAYER 上限', () => {
    const b = new Battle(20260809, 1, mapById('huoyanshan'));
    setupScreenshotBoard(b);
    const view = (b as unknown as { buildPlayerAutoView(): import('../src/autoplace').AutoPlaceView })
      .buildPlayerAutoView();

    const t0 = performance.now();
    const steps = planAutoPlaceSteps(view, {
      rng: () => b.rng.next(),
      pSubOptimal: 0,
      maxSteps: PLAYER_PLACE_MAX_STEPS,
      maxGuard: PLAYER_PLACE_MAX_GUARD,
    });
    const elapsed = performance.now() - t0;

    expect(steps).toBeLessThanOrEqual(PLAYER_PLACE_MAX_STEPS);
    expect(elapsed).toBeLessThan(150);
    expect(
      SCREENSHOT_EMPTY_LEFT.some(({ c, r }) => b.units.has(cellKey(c, r))),
    ).toBe(true);
  });

  it('单步回归：tray 仅 1 阶兵时第一步必须落子，不能先挪字', () => {
    const b = new Battle(20260809, 1, mapById('huoyanshan'));
    setupScreenshotBoard(b);
    const unitsBefore = b.units.size;
    const view = (b as unknown as { buildPlayerAutoView(): import('../src/autoplace').AutoPlaceView })
      .buildPlayerAutoView();

    planAutoPlaceSteps(view, {
      rng: () => b.rng.next(),
      pSubOptimal: 0,
      maxSteps: 1,
    });

    expect(b.units.size).toBe(unitsBefore + 1);
    expect(b.tray.length).toBe(4);
  });

  it('白骨岭变体：骨在远处、白旁空位仍应落 tray 兵', () => {
    const b = new Battle(20260809, 2, mapById('baiguling'));
    const cells: { c: number; r: number }[] = [];
    for (let c = 0; c < 8; c++) {
      for (let r = 5; r < 10; r++) {
        if (isPlayerCell(b.map, c, r) && !isPathCell(b.map, c, r)) cells.push({ c, r });
      }
    }
    unlockPlayerCells(b, cells);

    putUnit(b, 'cavalry', 2, 1, 6);
    putUnit(b, 'cavalry', 2, 2, 6);
    putUnit(b, 'cavalry', 3, 3, 6);
    putWord(b, '白', 'baigujing', 1, 6, 5);
    putWord(b, '骨', 'baigujing', 1, 6, 8);
    putWord(b, '八', 'baxian', 1, 1, 5);
    putWord(b, '仙', 'baxian', 1, 2, 5);
    putWord(b, '郎', 'erlang', 1, 6, 6);
    putWord(b, '二', 'erlang', 1, 6, 7);
    putUnit(b, 'archer', 3, 2, 9);
    putUnit(b, 'spear', 2, 0, 7);

    const emptyBesideBai = { c: 5, r: 5 }; // 白(6,5) 左邻
    expect(isPathCell(b.map, emptyBesideBai.c, emptyBesideBai.r)).toBe(false);
    expect(cellOccupied(b, emptyBesideBai.c, emptyBesideBai.r)).toBe(false);

    b.tray = [
      { kind: 'unit', type: 'cavalry', tier: 1 },
      { kind: 'unit', type: 'archer', tier: 1 },
      { kind: 'unit', type: 'spear', tier: 1 },
      { kind: 'unit', type: 'cavalry', tier: 1 },
      { kind: 'unit', type: 'archer', tier: 1 },
    ];
    b.status = 'playing';
    b.monsters.push({ id: 1, hp: 5000, maxHp: 5000, dist: b.pathLen - 5, spd: 0.3 } as never);

    const t0 = performance.now();
    b.autoPlaceTray();
    expect(performance.now() - t0).toBeLessThan(200);
    expect(b.units.has(cellKey(emptyBesideBai.c, emptyBesideBai.r))).toBe(true);
    expect(b.tray.length).toBeLessThan(5);
  });

  it('常量：玩家布阵步数上限', () => {
    expect(PLAYER_PLACE_MAX_STEPS).toBe(150);
    expect(PLAYER_PLACE_MAX_GUARD).toBe(300);
    expect(PLAYER_REPOSITION_MAX_STEPS).toBe(100);
  });
});
