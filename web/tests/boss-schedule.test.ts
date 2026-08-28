import { describe, it, expect } from 'vitest';
import { Battle, TUNING } from '../src/battle';

function bossWavesInRange(b: Battle, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let w = lo; w <= hi; w++) if (b.isBossWave(w)) out.push(w);
  return out;
}

describe('boss wave schedule', () => {
  it('1–4 无妖王；5–10 恰有 1–2 个', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const b = new Battle(seed);
      expect(bossWavesInRange(b, 1, 4)).toEqual([]);
      const first = bossWavesInRange(b, 5, 10);
      expect(first.length).toBeGreaterThanOrEqual(TUNING.bossFirstSegMin);
      expect(first.length).toBeLessThanOrEqual(TUNING.bossFirstSegMax);
      for (const w of first) {
        expect(w).toBeGreaterThanOrEqual(5);
        expect(w).toBeLessThanOrEqual(10);
      }
    }
  });

  it('之后每 10 波恰有 2–3 个妖王波', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const b = new Battle(seed);
      for (let seg = 0; seg < 3; seg++) {
        const lo = 11 + seg * 10;
        const hi = lo + 9;
        const waves = bossWavesInRange(b, lo, hi);
        expect(waves.length).toBeGreaterThanOrEqual(TUNING.bossSegMin);
        expect(waves.length).toBeLessThanOrEqual(TUNING.bossSegMax);
      }
    }
  });

  it('无尽与对战共用预排（不再每 5 波固定）', () => {
    const versus = new Battle(7, 1, undefined, undefined, {}, [], [], false);
    const endless = new Battle(7, 1, undefined, undefined, {}, [], [], true);
    // 同 seed 同排程；且非「凡 %5==0 必出」
    for (let w = 1; w <= 30; w++) {
      expect(versus.isBossWave(w)).toBe(endless.isBossWave(w));
    }
    const fixedEvery5 = [5, 10, 15, 20, 25, 30];
    const hits = fixedEvery5.filter((w) => versus.isBossWave(w)).length;
    // 允许碰巧命中若干，但不要求全中；全中才像旧逻辑
    expect(hits).toBeLessThan(fixedEvery5.length);
  });
});

describe('versus infinite waves', () => {
  it('对战清空第 12 波不判通关，继续 ready', () => {
    const b = new Battle(1, 1, undefined, undefined, {}, [], [], false);
    for (let w = 0; w < 12; w++) {
      b.startNextWave();
      b.forceClearWaveForTest();
    }
    expect(b.wave).toBe(12);
    expect(b.status).not.toBe('won');
    expect(b.status).toBe('ready');
  });

  it('对战 effectiveDifficulty 随圈连续上升（前10波保护、圈末对齐、无悬崖）', () => {
    const b = new Battle(1, 1.5, undefined, undefined, {}, [], [], false);
    const S = TUNING.cycleStrengthMul;
    expect(b.effectiveDifficulty(1)).toBeCloseTo(1.5, 5); // 前 10 波恒 ×difficultyMul
    expect(b.effectiveDifficulty(11)).toBeCloseTo(1.5 * S ** 0.1, 5); // 波 11 缓起，不再悬崖 ×S
    expect(b.effectiveDifficulty(20)).toBeCloseTo(1.5 * S, 5); // 圈末与旧台阶对齐
    expect(b.effectiveDifficulty(30)).toBeCloseTo(1.5 * S * S, 5); // 下一圈末对齐
  });
});
