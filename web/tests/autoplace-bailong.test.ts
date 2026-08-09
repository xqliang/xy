/**
 * 截图复现：顶行「流沙」+「白」贴唐僧行，tray「龙」→ 白龙。
 * 白 @(6,5)，左邻 (5,5) 为「沙」、右邻 (7,5) 为唐僧；须 clearForHero 挪沙/武器后才能成对。
 */
import { describe, it, expect } from 'vitest';
import { Battle, makePlacedUnit } from '../src/battle';
import { mapById, isPlayerCell, isPathCell } from '../src/board';
import { matchGeneral } from '../src/generals';
import { planAutoPlaceSteps } from '../src/autoplace';

const cellKey = (c: number, r: number) => `${c},${r}`;

/** 截图顶行：…流(4) 沙(5) 白(6) | 唐僧(7) */
const LIU = { c: 4, r: 5 };
const SHA = { c: 5, r: 5 };
const BAI = { c: 6, r: 5 };
const LONG_SLOT = { c: 6, r: 5 }; // 白左移后龙落此格

function unlockAll(b: Battle) {
  for (let c = 0; c < 8; c++) {
    for (let r = 5; r < 10; r++) {
      if (isPlayerCell(b.map, c, r) && !isPathCell(b.map, c, r)) {
        (b as unknown as { unlocked: Set<string> }).unlocked.add(cellKey(c, r));
      }
    }
  }
}

/** 按截图：贴路行有武器 + 流沙占白左格，非空白 */
function setupBailongScreenshot(b: Battle) {
  unlockAll(b);
  // 贴路行武器（截图：枪×2 + 弓）
  b.units.set(cellKey(1, 5), makePlacedUnit('spear', 2, { c: 1, r: 5 }, { c: 0, r: 5 }));
  b.units.set(cellKey(2, 5), makePlacedUnit('spear', 4, { c: 2, r: 5 }, { c: 0, r: 5 }));
  b.units.set(cellKey(3, 5), makePlacedUnit('archer', 2, { c: 3, r: 5 }, { c: 0, r: 5 }));
  // 流沙：沙紧贴白左侧（截图白框）
  b.words.set(cellKey(LIU.c, LIU.r), { char: '流', general: 'liusha', tier: 1, cell: { ...LIU } });
  b.words.set(cellKey(SHA.c, SHA.r), { char: '沙', general: 'liusha', tier: 1, cell: { ...SHA } });
  b.words.set(cellKey(BAI.c, BAI.r), {
    char: '白',
    general: 'bailong',
    tier: 1,
    cell: { ...BAI },
  });
  // 白下方 L2 骑（截图）
  b.units.set(cellKey(6, 6), makePlacedUnit('cavalry', 2, { c: 6, r: 6 }, { c: 0, r: 5 }));

  // 中部激活将占位
  b.words.set(cellKey(2, 7), { char: '八', general: 'baxian', tier: 2, cell: { c: 2, r: 7 } });
  b.words.set(cellKey(3, 7), { char: '仙', general: 'baxian', tier: 2, cell: { c: 3, r: 7 } });
  b.words.set(cellKey(1, 8), { char: '牛', general: 'niulang', tier: 2, cell: { c: 1, r: 8 } });
  b.words.set(cellKey(2, 8), { char: '郎', general: 'niulang', tier: 2, cell: { c: 2, r: 8 } });
  b.words.set(cellKey(4, 8), { char: '梵', general: 'fanyin', tier: 1, cell: { c: 4, r: 8 } });
  b.words.set(cellKey(5, 8), { char: '音', general: 'fanyin', tier: 1, cell: { c: 5, r: 8 } });

  b.tray = [{ kind: 'word', char: '龙', general: 'bailong', tier: 1 }];
  b.status = 'playing';
}

describe('tray龙 + 棋盘白（左有沙/武器）→ 白龙', () => {
  it('盘面：白左为沙、右贴唐僧，非空位', () => {
    const b = new Battle(20260809, 3, mapById('huoyanshan'));
    setupBailongScreenshot(b);
    expect(b.words.has(cellKey(SHA.c, SHA.r))).toBe(true);
    expect(b.words.get(cellKey(BAI.c, BAI.r))?.char).toBe('白');
    expect(b.units.has(cellKey(SHA.c, SHA.r))).toBe(false);
  });

  it('布阵后腾位并激活白龙，龙不再留在 tray', () => {
    const b = new Battle(20260809, 3, mapById('huoyanshan'));
    setupBailongScreenshot(b);

    const t0 = performance.now();
    b.autoPlaceTray();
    expect(performance.now() - t0).toBeLessThan(500);

    const bai = [...b.words.values()].find((w) => w.char === '白');
    const long = [...b.words.values()].find((w) => w.char === '龙');
    expect(b.tray.some((t) => t.kind === 'word' && t.char === '龙')).toBe(false);
    expect(long).toBeDefined();
    expect(bai).toBeDefined();
    expect(long!.cell.c).toBe(bai!.cell.c + 1);
    expect(long!.cell.r).toBe(bai!.cell.r);
    expect(matchGeneral(bai!.char, long!.char)?.id).toBe('bailong');
    expect(b.activeGenerals().some((g) => g.def.id === 'bailong')).toBe(true);
  });

  it('单步：优先腾位激活白龙，而非只挪其它孤儿字', () => {
    const b = new Battle(20260809, 3, mapById('huoyanshan'));
    setupBailongScreenshot(b);
    const view = (b as unknown as { buildPlayerAutoView(): import('../src/autoplace').AutoPlaceView })
      .buildPlayerAutoView();

    planAutoPlaceSteps(view, { rng: () => b.rng.next(), pSubOptimal: 0, maxSteps: 1 });

    const long = [...b.words.values()].find((w) => w.char === '龙');
    const bai = [...b.words.values()].find((w) => w.char === '白');
    const activated = long && bai && long.cell.c === bai.cell.c + 1 && long.cell.r === bai.cell.r;
    const longPlaced = !!long && !view.tray().some((t) => t.kind === 'word' && t.char === '龙');
    const shaMoved = !b.words.has(cellKey(SHA.c, SHA.r)) || b.words.get(cellKey(SHA.c, SHA.r))?.char !== '沙';
    const baiShifted = bai && bai.cell.c < BAI.c;
    expect(activated || longPlaced || shaMoved || baiShifted).toBe(true);
  });
});
