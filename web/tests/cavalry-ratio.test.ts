import { describe, it, expect } from 'vitest';
import { Battle, cavalryRatioBounds, rollCavalryWaveRatio } from '../src/battle';

describe('cavalryRatioBounds', () => {
  it('波 <5：无骑兵占比', () => {
    expect(cavalryRatioBounds(4)).toEqual({ start: 0, max: 0 });
  });

  it('波 5：30%', () => {
    expect(cavalryRatioBounds(5)).toEqual({ start: 0.3, max: 0.3 });
  });

  it('波 10：线性中间值 ≈41.7%', () => {
    expect(cavalryRatioBounds(10).start).toBeCloseTo(0.3 + (5 / 15) * 0.25, 5);
    expect(cavalryRatioBounds(10).max).toBeCloseTo(cavalryRatioBounds(10).start, 5);
  });

  it('波 20：55%', () => {
    expect(cavalryRatioBounds(20)).toEqual({ start: 0.55, max: 0.55 });
  });

  it('波 21+：随机区间 56%–70%', () => {
    expect(cavalryRatioBounds(21)).toEqual({ start: 0.56, max: 0.7 });
    expect(cavalryRatioBounds(100)).toEqual({ start: 0.56, max: 0.7 });
  });
});

describe('rollCavalryWaveRatio', () => {
  it('returns start when rng=0 and max when rng=1', () => {
    const { start, max } = cavalryRatioBounds(21);
    expect(rollCavalryWaveRatio(21, () => 0)).toBeCloseTo(start, 6);
    expect(rollCavalryWaveRatio(21, () => 1)).toBeCloseTo(max, 6);
  });

  it('5–20 波占比固定，rng 不影响结果', () => {
    expect(rollCavalryWaveRatio(10, () => 0)).toBeCloseTo(cavalryRatioBounds(10).start, 6);
    expect(rollCavalryWaveRatio(10, () => 1)).toBeCloseTo(cavalryRatioBounds(10).start, 6);
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
    (b as unknown as { wave: number }).wave = 4;
    (b as unknown as { waveActive: boolean }).waveActive = false;
    (b as unknown as { status: string }).status = 'ready';
    (b as unknown as { introDone: boolean }).introDone = true;
    expect(b.startNextWave()).toBe(true);
    expect(b.wave).toBe(5);
    expect((b as unknown as { cavalryWave: boolean }).cavalryWave).toBe(true);
    const ratio = (b as unknown as { cavalryWaveRatio: number }).cavalryWaveRatio;
    const { start, max } = cavalryRatioBounds(5);
    expect(ratio).toBeGreaterThanOrEqual(start);
    expect(ratio).toBeLessThanOrEqual(max);
  });

  it('does not spawn cavalry before cavalryFromWave', () => {
    const b = new Battle(1);
    (b as unknown as { wave: number }).wave = 3;
    (b as unknown as { waveActive: boolean }).waveActive = false;
    (b as unknown as { status: string }).status = 'ready';
    (b as unknown as { introDone: boolean }).introDone = true;
    b.startNextWave();
    expect(b.wave).toBe(4);
    expect((b as unknown as { cavalryWave: boolean }).cavalryWave).toBe(false);
    expect((b as unknown as { cavalryWaveRatio: number }).cavalryWaveRatio).toBe(0);
  });
});
