import { describe, it, expect, beforeEach } from 'vitest';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';
import { getButtons } from '../src/render';
import { setShowAutoplaceBtn } from '../src/dev-flags';

// Task 10：布阵按钮默认隐藏（DevTools 可开）。本文件专门测「一键布阵」按钮的几何与行为，
// 故 beforeEach 显式打开该开关，否则 getButtons 不会包含 autoplace 按钮、几何断言无从谈起。
beforeEach(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  } as Storage;
  setShowAutoplaceBtn(true);
});

describe('流沙河一键布阵', () => {
  it('征兵后布阵能落子', () => {
    const b = new Battle(1, 1, mapById('liushahe'));
    b.grantPeach(9999, true);
    const before = b.units.size + b.words.size;
    b.summon();
    expect(b.tray.length).toBeGreaterThan(0);
    b.autoPlaceTray();
    b.flushAutoPlacePlaybackForTest();
    expect(b.units.size + b.words.size).toBeGreaterThan(before);
  });

  it('布阵按钮在候选区右侧，不与槽位重叠', () => {
    const b = new Battle(1, 1, mapById('liushahe'));
    const btn = getButtons(b).find((x) => x.id === 'autoplace')!;
    expect(btn.x).toBeGreaterThanOrEqual(450);
    expect(btn.w).toBeGreaterThan(80);
    expect(btn.x).toBeGreaterThan(447);
  });

  it('空盘布阵有提示文案', () => {
    const b = new Battle(1, 1, mapById('liushahe'));
    b.autoPlaceTray();
    expect(b.message).toContain('征兵');
  });

  it('短兵在流沙河底行时布阵会换到更贴出怪口的格子', () => {
    const b = new Battle(1, 1, mapById('liushahe'));
    b.units.set('3,7', { type: 'archer', tier: 2, cell: { c: 3, r: 7 }, cooldown: 0, fireDir: { c: 0, r: 0 } });
    b.units.set('4,7', { type: 'archer', tier: 1, cell: { c: 4, r: 7 }, cooldown: 0, fireDir: { c: 0, r: 0 } });
    b.units.set('3,8', { type: 'spear', tier: 2, cell: { c: 3, r: 8 }, cooldown: 0, fireDir: { c: 0, r: 0 } });
    b.units.set('4,8', { type: 'spear', tier: 1, cell: { c: 4, r: 8 }, cooldown: 0, fireDir: { c: 0, r: 0 } });
    b.units.set('3,9', { type: 'cavalry', tier: 2, cell: { c: 3, r: 9 }, cooldown: 0, fireDir: { c: 0, r: 0 } });
    b.units.set('4,9', { type: 'dao', tier: 1, cell: { c: 4, r: 9 }, cooldown: 0, fireDir: { c: 0, r: 0 } });
    // 现行设计：无怪且 tray 为空时不做纯调位（避免布局在两套状态间抖动，见 oscillation-probe）。
    // 放一只怪触发战中调位后，底行短兵（dao 初始 (4,9)）应被挪到更贴出怪口（exitDist 更小）的格子。
    (b as unknown as { status: string }).status = 'playing';
    b.monsters.push({ id: 1, hp: 5000, maxHp: 5000, dist: b.pathLen - 5, spd: 0.3, side: 'player' } as never);
    b.autoPlaceTray();
    b.flushAutoPlacePlaybackForTest();
    const dao = [...b.units.values()].find((u) => u.type === 'dao');
    expect(dao).toBeDefined();
    // 「更贴出怪口」= 出口距离更近。原用例断言 r<9（错误坐标轴，且现设计短兵留后排），改用 exitDist。
    const view = (b as unknown as { buildPlayerAutoView(): import('../src/autoplace').AutoPlaceView }).buildPlayerAutoView();
    expect(view.exitDist(dao!.cell)).toBeLessThan(view.exitDist({ c: 4, r: 9 }));
  });
});
