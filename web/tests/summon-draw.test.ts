import { describe, it, expect } from 'vitest';
import { RNG } from '../src/rng';
import { drawSummonTray } from '../src/summon-draw';
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
});
