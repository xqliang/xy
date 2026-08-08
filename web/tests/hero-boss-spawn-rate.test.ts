import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { GENERALS } from '../src/generals';

function adjacentPairs(b: Battle, n: number) {
  const cells = b.unlockedCells();
  const set = new Set(cells.map((c) => `${c.c},${c.r}`));
  const used = new Set<string>();
  const out: Array<[{ c: number; r: number }, { c: number; r: number }]> = [];
  for (const c of cells) {
    if (out.length >= n) break;
    const kL = `${c.c},${c.r}`;
    const kR = `${c.c + 1},${c.r}`;
    if (!set.has(kR) || used.has(kL) || used.has(kR)) continue;
    used.add(kL);
    used.add(kR);
    out.push([c, { c: c.c + 1, r: c.r }]);
  }
  return out;
}

function placeHeroes(b: Battle, count: number) {
  const pairs = adjacentPairs(b, count);
  for (let i = 0; i < count; i++) {
    const g = GENERALS[i]!;
    const [L, R] = pairs[i]!;
    b.tray = [{ kind: 'word', char: g.chars[0]!, general: g.id, tier: 1 }];
    b.placeFromTray(0, L);
    b.tray = [{ kind: 'word', char: g.chars[1]!, general: g.id, tier: 1 }];
    b.placeFromTray(0, R);
  }
}

describe('hero boss spawn rate', () => {
  it('开波时 timer 已 roll 为正，首帧不立刻刷妖王', () => {
    const b = new Battle(11);
    placeHeroes(b, 2);
    b.startNextWave();
    expect((b as unknown as { heroBossTimer: number }).heroBossTimer).toBeGreaterThan(0);
    const before = b.monsters.filter((m) => m.isBoss).length;
    b.step(1 / 60);
    expect(b.monsters.filter((m) => m.isBoss).length).toBe(before);
  });
});
