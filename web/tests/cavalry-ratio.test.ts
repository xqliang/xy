import { describe, it, expect } from 'vitest';
import { Battle, cavalryRatioBounds, rollCavalryWaveRatio } from '../src/battle';

describe('cavalryRatioBounds', () => {
  it('wave 6: start=41%, max=61%', () => {
    expect(cavalryRatioBounds(6)).toEqual({ start: 0.41, max: 0.61 });
  });

  it('wave 20: start=55%, max=70% (cap)', () => {
    expect(cavalryRatioBounds(20)).toEqual({ start: 0.55, max: 0.7 });
  });

  it('wave 100+: bonus capped at +20%', () => {
    expect(cavalryRatioBounds(100)).toEqual({ start: 0.55, max: 0.7 });
    expect(cavalryRatioBounds(200)).toEqual({ start: 0.55, max: 0.7 });
  });
});

describe('rollCavalryWaveRatio', () => {
  it('returns start when rng=0 and max when rng=1', () => {
    const { start, max } = cavalryRatioBounds(6);
    expect(rollCavalryWaveRatio(6, () => 0)).toBeCloseTo(start, 6);
    expect(rollCavalryWaveRatio(6, () => 1)).toBeCloseTo(max, 6);
  });
});

describe('cavalry wave spawn ratio', () => {
  it('spawn respects cavalryWaveRatio when stubbed', () => {
    const b = new Battle(1);
    (b as unknown as { wave: number }).wave = 6;
    (b as unknown as { cavalryWave: boolean }).cavalryWave = true;
    (b as unknown as { waveMiniBoss: null }).waveMiniBoss = null;
    (b as unknown as { miniBossSpawnIdx: number }).miniBossSpawnIdx = -1;
    (b as unknown as { waveMonsterCount: number }).waveMonsterCount = 5;
    (b as unknown as { spawnRemaining: number }).spawnRemaining = 5;
    (b as unknown as { status: string }).status = 'playing';

    (b as unknown as { cavalryWaveRatio: number }).cavalryWaveRatio = 0;
    (b as unknown as { spawnMonster(dist?: number): void }).spawnMonster(0);
    expect(b.monsters[0]?.isCavalry).toBe(false);

    b.monsters.length = 0;
    (b as unknown as { spawnRemaining: number }).spawnRemaining = 5;
    (b as unknown as { cavalryWaveRatio: number }).cavalryWaveRatio = 1;
    (b as unknown as { spawnMonster(dist?: number): void }).spawnMonster(0);
    expect(b.monsters[0]?.isCavalry).toBe(true);
  });

  it('rolls ratio into wave bounds on cavalry wave start', () => {
    const b = new Battle(99);
    (b as unknown as { wave: number }).wave = 5;
    (b as unknown as { waveActive: boolean }).waveActive = false;
    (b as unknown as { status: string }).status = 'ready';
    (b as unknown as { introDone: boolean }).introDone = true;
    expect(b.startNextWave()).toBe(true);
    expect((b as unknown as { cavalryWave: boolean }).cavalryWave).toBe(true);
    const ratio = (b as unknown as { cavalryWaveRatio: number }).cavalryWaveRatio;
    const { start, max } = cavalryRatioBounds(6);
    expect(ratio).toBeGreaterThanOrEqual(start);
    expect(ratio).toBeLessThanOrEqual(max);
  });

  it('does not spawn cavalry before cavalryFromWave', () => {
    const b = new Battle(1);
    (b as unknown as { wave: number }).wave = 0;
    (b as unknown as { waveActive: boolean }).waveActive = false;
    (b as unknown as { status: string }).status = 'ready';
    (b as unknown as { introDone: boolean }).introDone = true;
    b.startNextWave();
    expect((b as unknown as { cavalryWave: boolean }).cavalryWave).toBe(false);
    expect((b as unknown as { cavalryWaveRatio: number }).cavalryWaveRatio).toBe(0);
  });
});
