import { describe, it, expect } from 'vitest';
import { Battle, TUNING } from '../src/battle';

describe('Battle.summon tray rules', () => {
  it('clears leftover tray tokens before writing the new hand', () => {
    const b = new Battle(42);
    b.grantPeach(1000);
    expect(b.summon()).toBe(true);
    const first = b.tray.map((t) => JSON.stringify(t));
    expect(b.tray).toHaveLength(TUNING.summonDraws);
    // 人为塞入「历史」token（模拟未清空时的叠留）
    b.tray.push({ kind: 'shovel' }, { kind: 'shovel' });
    expect(b.summon()).toBe(true);
    expect(b.tray).toHaveLength(TUNING.summonDraws);
    // 新手数不得大于 draws（证明没有 append 历史）
    expect(b.tray.length).toBe(5);
    // 内容应来自新抽取（允许与 first 相同种子巧合，但长度与无额外铲叠留即可）
    const shovels = b.tray.filter((t) => t.kind === 'shovel').length;
    expect(shovels).toBeLessThanOrEqual(3);
    void first;
  });

  it('first summon has >= 4 units', () => {
    const b = new Battle(7);
    b.grantPeach(100);
    b.summon();
    expect(b.tray.filter((t) => t.kind === 'unit').length).toBeGreaterThanOrEqual(4);
  });
});

describe('Battle.placeFromTray', () => {
  it('swaps with a different unit on an unlocked cell', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.units.set(`${cell.c},${cell.r}`, {
      type: 'monkey', tier: 1, cell: { c: cell.c, r: cell.r },
      cooldown: 0, firePulse: 0, stunT: 0, slowT: 0, weakenT: 0,
    });
    b.tray = [{ kind: 'unit', type: 'spear', tier: 1 }];
    expect(b.placeFromTray(0, cell)).toBe(true);
    expect(b.units.get(`${cell.c},${cell.r}`)?.type).toBe('spear');
    expect(b.tray[0]).toEqual({ kind: 'unit', type: 'monkey', tier: 1 });
  });

  it('merges same type and tier', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.units.set(`${cell.c},${cell.r}`, {
      type: 'monkey', tier: 1, cell: { c: cell.c, r: cell.r },
      cooldown: 0, firePulse: 0, stunT: 0, slowT: 0, weakenT: 0,
    });
    b.tray = [{ kind: 'unit', type: 'monkey', tier: 1 }];
    expect(b.placeFromTray(0, cell)).toBe(true);
    expect(b.units.get(`${cell.c},${cell.r}`)?.tier).toBe(2);
    expect(b.tray).toHaveLength(0);
  });
});
