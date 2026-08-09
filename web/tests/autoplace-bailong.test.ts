/**
 * 用户截图盘面（火焰山）：顶行流沙+白贴唐，tray 龙 → 白龙。
 */
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';
import { matchGeneral } from '../src/generals';
import { planAutoPlaceSteps } from '../src/autoplace';
import { BAILONG_DOT_CELLS, setupBailongScreenshot } from './fixtures/bailong-screenshot-board';

const cellKey = (c: number, r: number) => `${c},${r}`;

const SHA = { c: 5, r: 5 };
const BAI = { c: 6, r: 5 };

describe('tray龙 + 棋盘白（用户截图盘面）→ 白龙', () => {
  it('盘面：白左沙、右唐，周围有武器', () => {
    const b = new Battle(20260809, 3, mapById('huoyanshan'));
    setupBailongScreenshot(b);
    expect(b.words.get(cellKey(5, 5))?.char).toBe('沙');
    expect(b.words.get(cellKey(6, 5))?.char).toBe('白');
    expect(b.units.get(cellKey(1, 6))?.tier).toBe(5);
    expect(b.units.get(cellKey(1, 7))?.tier).toBe(5);
    expect(b.activeGenerals().some((g) => g.def.id === 'fanyin')).toBe(true);
  });

  it('布阵后待处理弓2应换低阶武器上板', () => {
    const b = new Battle(20260809, 3, mapById('huoyanshan'));
    setupBailongScreenshot(b);
    b.autoPlaceTray();

    expect(b.tray.every((t) => t.kind !== 'unit' || !t.displaced)).toBe(true);
    expect([...b.units.values()].some((u) => u.type === 'archer' && u.tier === 2)).toBe(true);
  });

  it('布阵后不把兵挪到路径格（用户 · 格）', () => {
    const b = new Battle(20260809, 3, mapById('huoyanshan'));
    setupBailongScreenshot(b);
    b.autoPlaceTray();

    for (const { c, r } of BAILONG_DOT_CELLS) {
      expect(b.units.has(cellKey(c, r)), `(${c},${r}) 为路径，不应落兵`).toBe(false);
    }
  });

  it('布阵后激活白龙，tray 龙清空', () => {
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

  it('单步：朝白龙方向推进（腾位/落龙/移白）', () => {
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
