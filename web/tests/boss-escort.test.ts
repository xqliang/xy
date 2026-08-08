import { describe, it, expect } from 'vitest';
import { Battle, TUNING, splitBossHpBudget } from '../src/battle';

describe('splitBossHpBudget', () => {
  it('护卫分走 share 比例，妖王+护卫总血 ≈ 原池', () => {
    const totalHp = 2000;
    const normalHp = 100;
    const escortCount = 3;
    const { bossHp, escortHpEach } = splitBossHpBudget(totalHp, escortCount, normalHp, 0.35);
    expect(bossHp).toBeGreaterThanOrEqual(normalHp);
    expect(bossHp).toBeLessThan(totalHp);
    expect(escortHpEach).toBeGreaterThan(0);
    expect(bossHp + escortHpEach * escortCount).toBeCloseTo(totalHp, 4);
  });

  it('无护卫时妖王独占总池', () => {
    const { bossHp, escortHpEach } = splitBossHpBudget(1500, 0, 80, 0.35);
    expect(bossHp).toBe(1500);
    expect(escortHpEach).toBe(0);
  });
});

describe('妖王携护卫出场', () => {
  it('妖王波最后一只出妖王 + 4~8 护卫，总血池不变', () => {
    const b = new Battle(42);
    (b as unknown as { bossWaves: Set<number> }).bossWaves = new Set([8]);
    (b as unknown as { wave: number }).wave = 7;
    (b as unknown as { waveActive: boolean }).waveActive = false;
    (b as unknown as { status: string }).status = 'ready';
    (b as unknown as { introDone: boolean }).introDone = true;
    for (const c of b.unlockedCells().slice(0, 4)) {
      b.tray = [{ kind: 'unit', type: 'archer', tier: 4 }];
      b.placeFromTray(0, c);
    }
    expect(b.startNextWave()).toBe(true);
    expect(b.wave).toBe(8);
    const plannedBossHp = (b as unknown as { wavePressure: { bossHp: number } }).wavePressure?.bossHp ?? 0;
    const normalHp = TUNING.monsterHpBase + TUNING.monsterHpStep * 8;
    expect(plannedBossHp).toBeGreaterThan(normalHp);
    (b as unknown as { spawnRemaining: number }).spawnRemaining = 1;
    (b as unknown as { spawnTimer: number }).spawnTimer = 0;
    b.step(0.05);
    const boss = b.monsters.find((m) => m.isBoss);
    const escorts = b.monsters.filter(
      (m) => !m.isBoss && !m.isMiniBoss && boss && m.dist < boss.dist && m.dist >= boss.dist - 2,
    );
    expect(boss).toBeTruthy();
    expect(escorts.length).toBeGreaterThanOrEqual(TUNING.bossEscortMin);
    expect(escorts.length).toBeLessThanOrEqual(TUNING.bossEscortMax);
    const totalHp = (boss?.maxHp ?? 0) + escorts.reduce((s, m) => s + m.maxHp, 0);
    expect(totalHp).toBeCloseTo(plannedBossHp, 4);
    expect(boss!.maxHp).toBeLessThan(plannedBossHp);
    for (const e of escorts) {
      expect(e.dist).toBeLessThan(boss!.dist);
    }
  });
});
