import { describe, it, expect } from 'vitest';
import { RNG } from '../src/rng';
import { applyForceShovel, drawSummonTray } from '../src/summon-draw';
import { UNITS } from '@core';
import type { UnitType } from '@core';

const types = Object.keys(UNITS) as UnitType[];

function keyOf(t: { kind: string; type?: string }) {
  return t.kind === 'shovel' ? 'shovel' : `unit:${t.type}`;
}

function counts(tokens: ReturnType<typeof drawSummonTray>) {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(keyOf(t), (m.get(keyOf(t)) ?? 0) + 1);
  return m;
}

describe('drawSummonTray', () => {
  it('always returns exactly draws tokens', () => {
    const tray = drawSummonTray({
      rng: new RNG(1),
      unitTypes: types,
      draws: 5,
      shovelChance: 0.16,
      maxPerKey: 3,
      firstSummon: false,
    });
    expect(tray).toHaveLength(5);
  });

  it('first summon has at least 4 units', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const tray = drawSummonTray({
        rng: new RNG(seed),
        unitTypes: types,
        draws: 5,
        shovelChance: 0.9, // 高压铲子
        maxPerKey: 3,
        firstSummon: true,
      });
      const units = tray.filter((t) => t.kind === 'unit').length;
      expect(units).toBeGreaterThanOrEqual(4);
      expect(tray.filter((t) => t.kind === 'shovel').length).toBeLessThanOrEqual(1);
    }
  });

  it('never exceeds maxPerKey for any key', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const tray = drawSummonTray({
        rng: new RNG(seed),
        unitTypes: types,
        draws: 5,
        shovelChance: 0.5,
        maxPerKey: 3,
        firstSummon: false,
      });
      for (const n of counts(tray).values()) expect(n).toBeLessThanOrEqual(3);
    }
  });

  it('respects maxShovels even when chance is high', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const tray = drawSummonTray({
        rng: new RNG(seed),
        unitTypes: types,
        draws: 5,
        shovelChance: 1,
        maxPerKey: 3,
        firstSummon: false,
        maxShovels: 1,
      });
      expect(tray.filter((t) => t.kind === 'shovel')).toHaveLength(1);
    }
  });

  it('applyForceShovel 只替换 unit，不覆盖 word', () => {
    const tray: Array<{ kind: string; type?: string; char?: string }> = [
      { kind: 'word', char: '大' },
      { kind: 'unit', type: 'dao' },
      { kind: 'unit', type: 'spear' },
    ];
    expect(applyForceShovel(tray, { maxShovels: 1 })).toBe(true);
    expect(tray.filter((t) => t.kind === 'word')).toHaveLength(1);
    expect(tray.filter((t) => t.kind === 'shovel')).toHaveLength(1);
    expect(tray[0]!.kind).toBe('word');
  });

  it('applyForceShovel 在 minUnits 不足时放弃', () => {
    const tray: Array<{ kind: string }> = [
      { kind: 'word' },
      { kind: 'word' },
      { kind: 'unit' },
      { kind: 'shovel' },
    ];
    expect(applyForceShovel(tray, { maxShovels: 2 })).toBe(false); // 已有铲
    const noSpare: Array<{ kind: string }> = [
      { kind: 'word' },
      { kind: 'word' },
      { kind: 'unit' },
      { kind: 'unit' },
    ];
    expect(applyForceShovel(noSpare, { maxShovels: 1, minUnits: 2 })).toBe(false);
    expect(noSpare.every((t) => t.kind !== 'shovel')).toBe(true);
  });
});
