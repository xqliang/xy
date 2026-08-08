import { describe, it, expect } from 'vitest';
import { Battle, TUNING, heroBossIntervalHi } from '../src/battle';
import { GENERALS } from '../src/generals';

/** 找若干组横向相邻已解锁格 */
function adjacentPairs(b: Battle, n: number): Array<[{ c: number; r: number }, { c: number; r: number }]> {
  const cells = b.unlockedCells();
  const set = new Set(cells.map((c) => `${c.c},${c.r}`));
  const used = new Set<string>();
  const out: Array<[{ c: number; r: number }, { c: number; r: number }]> = [];
  for (const c of cells) {
    if (out.length >= n) break;
    const kL = `${c.c},${c.r}`, kR = `${c.c + 1},${c.r}`;
    if (!set.has(kR) || used.has(kL) || used.has(kR)) continue;
    used.add(kL); used.add(kR);
    out.push([c, { c: c.c + 1, r: c.r }]);
  }
  return out;
}

function placeHeroes(b: Battle, count: number): void {
  const pairs = adjacentPairs(b, count);
  expect(pairs.length).toBeGreaterThanOrEqual(count);
  for (let i = 0; i < count; i++) {
    const g = GENERALS[i]!;
    const [L, R] = pairs[i]!;
    b.tray = [{ kind: 'word', char: g.chars[0]!, general: g.id, tier: 1 }];
    expect(b.placeFromTray(0, L)).toBe(true);
    b.tray = [{ kind: 'word', char: g.chars[1]!, general: g.id, tier: 1 }];
    expect(b.placeFromTray(0, R)).toBe(true);
  }
  expect(b.activeGenerals().length).toBe(count);
}

describe('heroBossIntervalHi', () => {
  it('上界 = 15 - min(4, 英雄数-1)', () => {
    expect(heroBossIntervalHi(2)).toBe(15 - 1);
    expect(heroBossIntervalHi(3)).toBe(15 - 2);
    expect(heroBossIntervalHi(5)).toBe(15 - 4);
    expect(heroBossIntervalHi(8)).toBe(15 - 4);
    expect(heroBossIntervalHi(2)).toBeGreaterThanOrEqual(TUNING.heroBossIntervalMin);
  });
});

describe('双雄引妖王', () => {
  it('少于 2 名配对英雄时不额外刷妖王', () => {
    const b = new Battle(3);
    placeHeroes(b, 1);
    b.startNextWave();
    // 保持波进行中，但不靠定额出妖王
    (b as unknown as { spawnRemaining: number }).spawnRemaining = 50;
    (b as unknown as { heroBossTimer: number }).heroBossTimer = 0.01;
    const before = b.monsters.filter((m) => m.isBoss).length;
    b.step(0.05);
    expect(b.monsters.filter((m) => m.isBoss).length).toBe(before);
  });

  it('≥2 名配对英雄时波中可额外刷大 Boss', () => {
    const b = new Battle(11);
    placeHeroes(b, 2);
    // 开到非妖王波，避免定额最后一只干扰断言
    for (let i = 0; i < 20; i++) {
      b.startNextWave();
      if (!b.isBossWave(b.wave)) break;
      b.forceClearWaveForTest();
    }
    expect(b.isBossWave(b.wave)).toBe(false);
    (b as unknown as { spawnRemaining: number }).spawnRemaining = 50;
    (b as unknown as { heroBossTimer: number }).heroBossTimer = 0.01;
    const before = b.monsters.filter((m) => m.isBoss).length;
    b.step(0.05);
    expect(b.monsters.filter((m) => m.isBoss).length).toBeGreaterThan(before);
    expect(b.monsters.some((m) => m.isBoss && !m.isMiniBoss)).toBe(true);
  });

  it('双雄召唤 Boss 血量走压力公式（非静态×8~14）', () => {
    const b = new Battle(11);
    placeHeroes(b, 2);
    for (let i = 0; i < 20; i++) {
      b.startNextWave();
      if (!b.isBossWave(b.wave)) break;
      b.forceClearWaveForTest();
    }
    expect(b.isBossWave(b.wave)).toBe(false);
    const planned = (b as unknown as { wavePressure: { bossHp: number } | null }).wavePressure?.bossHp;
    expect(planned).toBeGreaterThan(0);
    (b as unknown as { spawnRemaining: number }).spawnRemaining = 50;
    (b as unknown as { heroBossTimer: number }).heroBossTimer = 0.01;
    b.step(0.05);
    const boss = b.monsters.find((m) => m.isBoss);
    expect(boss).toBeTruthy();
    expect(boss!.maxHp).toBeCloseTo(planned!, 5);
  });

  it('英雄不足时重置计时，再凑齐后需重新等满间隔', () => {
    const b = new Battle(5);
    placeHeroes(b, 2);
    b.startNextWave();
    (b as unknown as { spawnRemaining: number }).spawnRemaining = 50;
    (b as unknown as { heroBossTimer: number }).heroBossTimer = 0.5;
    // 拆掉一个英雄字 → 不足 2
    const g0 = b.activeGenerals()[0]!;
    b.words.delete(`${g0.cells[0]!.c},${g0.cells[0]!.r}`);
    expect(b.activeGenerals().length).toBeLessThan(2);
    b.step(0.05);
    expect((b as unknown as { heroBossTimer: number }).heroBossTimer).toBe(0);
  });
});
