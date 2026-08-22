import { describe, it, expect, afterEach } from 'vitest';
import { earlySummonGates } from '../src/summon-early';
import { Battle, TUNING } from '../src/battle';

const T = {
  earlyWordCapWave: 3,
  earlyWordCap: 1,
  earlyWordGuaranteeWave: 6,
  earlyWordGuarantee: 1,
  earlyShovelWave: 3,
  earlyShovelMin: 1,
  earlyShovelMax: 3,
};

describe('earlySummonGates', () => {
  it('前 3 波：字最多 1，铲 1–3', () => {
    const g0 = earlySummonGates(1, { wordsInCapWindow: 0, wordsInGuaranteeWindow: 0, shovelsInWindow: 0 }, T);
    expect(g0.maxWords).toBe(1);
    expect(g0.forceWord).toBe(false);
    expect(g0.maxShovels).toBe(3);
    expect(g0.forceShovel).toBe(true);

    const gCap = earlySummonGates(2, { wordsInCapWindow: 1, wordsInGuaranteeWindow: 1, shovelsInWindow: 3 }, T);
    expect(gCap.maxWords).toBe(0);
    expect(gCap.maxShovels).toBe(0);
    expect(gCap.forceShovel).toBe(false);
  });

  it('第 6 波仍无字则强制出字', () => {
    const g = earlySummonGates(6, { wordsInCapWindow: 0, wordsInGuaranteeWindow: 0, shovelsInWindow: 0 }, T);
    expect(g.forceWord).toBe(true);
    expect(g.maxWords).toBeGreaterThan(0);
  });
});

describe('征兵前期配额（Battle.summon）', () => {
  const origWord = TUNING.wordDrawChance;
  const origShovel = TUNING.shovelDrawChance;
  afterEach(() => {
    TUNING.wordDrawChance = origWord;
    TUNING.shovelDrawChance = origShovel;
  });

  it('前 3 波累计最多 1 字', () => {
    TUNING.wordDrawChance = 1; // 非首抽尽量转字
    TUNING.shovelDrawChance = 0;
    const b = new Battle(7);
    b.grantPeach(10_000, true);
    b.setWaveForTest(1);
    expect(b.summon()).toBe(true); // 首次不转字
    expect(b.tray.some((t) => t.kind === 'word')).toBe(false);

    let words = 0;
    for (let i = 0; i < 6; i++) {
      expect(b.summon()).toBe(true);
      words += b.tray.filter((t) => t.kind === 'word').length;
    }
    expect(words).toBeLessThanOrEqual(1);
    expect(b.earlySummonStatsForTest().wordsCap).toBeLessThanOrEqual(1);
  });

  it('第 6 波仍无字时强制至少 1 字', () => {
    TUNING.wordDrawChance = 0;
    TUNING.shovelDrawChance = 0;
    const b = new Battle(11);
    b.grantPeach(10_000, true);
    b.setWaveForTest(1);
    expect(b.summon()).toBe(true); // 首次
    b.setWaveForTest(6);
    expect(b.summon()).toBe(true);
    expect(b.tray.some((t) => t.kind === 'word')).toBe(true);
    expect(b.earlySummonStatsForTest().wordsGuarantee).toBeGreaterThanOrEqual(1);
  });

  it('前 3 波铲子累计在 1–3', () => {
    TUNING.shovelDrawChance = 1;
    TUNING.wordDrawChance = 0;
    const b = new Battle(13);
    b.grantPeach(10_000, true);
    b.setWaveForTest(1);
    // 挖掉一部分格，避免中途 allOpen 导致不出铲
    for (let i = 0; i < 8; i++) {
      expect(b.summon()).toBe(true);
      const stats = b.earlySummonStatsForTest();
      expect(stats.shovels).toBeGreaterThanOrEqual(1);
      expect(stats.shovels).toBeLessThanOrEqual(3);
    }
    expect(b.earlySummonStatsForTest().shovels).toBe(3);
  });
});
