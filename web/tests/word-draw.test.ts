import { describe, it, expect, afterEach } from 'vitest';
import {
  phaseWeight,
  phaseWeightRatio,
  pickWordChar,
  PAIR_PITY_AFTER,
  neededPartnerChars,
  pendingPartnerChars,
} from '../src/word-draw';
import { Battle, TUNING } from '../src/battle';
import { hintGeneralForChar } from '../src/generals';

class FakeRng {
  constructor(private seq: number[], private i = 0) {}
  next(): number {
    return this.seq[this.i++ % this.seq.length]!;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length]!;
  }
}

describe('征兵阶段权重', () => {
  it('前期满3权重大于满5，后期相反', () => {
    expect(phaseWeight(1, 3)).toBeGreaterThan(phaseWeight(1, 5));
    expect(phaseWeight(8, 5)).toBeGreaterThan(phaseWeight(8, 3));
    const early = phaseWeightRatio(2);
    const late = phaseWeightRatio(9);
    expect(early.t3).toBeGreaterThan(early.t5);
    expect(late.t5).toBeGreaterThan(late.t3);
  });

  it('孤儿补缺：forcePartner 只出配对字', () => {
    const rng = new FakeRng([0, 0.5, 0.9]);
    const pick = pickWordChar(rng, 3, ['悟'], [], true);
    expect(neededPartnerChars(['悟'])).toEqual(expect.arrayContaining(['空', '能']));
    expect(['空', '能']).toContain(pick.char);
  });

  it('有孤儿时 pendingPartner 排除本盘已抽到的配对字', () => {
    expect(pendingPartnerChars(['悟'], ['空'])).toEqual(expect.arrayContaining(['能']));
    expect(pendingPartnerChars(['悟'], ['空'])).not.toContain('空');
  });

  it('尽量不抽已拥有字：已有「悟」时加权抽其它字', () => {
    let dup = 0;
    for (let i = 0; i < 200; i++) {
      const rng = new FakeRng([i / 200, 0.3, 0.7]);
      const pick = pickWordChar(rng, 5, [], [], false, ['悟']);
      if (pick.char === '悟') dup++;
    }
    expect(dup).toBeLessThan(15);
  });

  it('本盘不抽重复配对字：tray 已有「空」则不再抽「空」', () => {
    let dup = 0;
    for (let i = 0; i < 200; i++) {
      const rng = new FakeRng([i / 200]);
      const pick = pickWordChar(rng, 5, ['悟'], ['空'], false, ['悟']);
      if (pick.char === '空') dup++;
    }
    expect(dup).toBe(0);
  });
});

describe('半对保底 N=4', () => {
  const origWord = TUNING.wordDrawChance;
  afterEach(() => {
    TUNING.wordDrawChance = origWord;
  });

  it('PAIR_PITY_AFTER 为 4', () => {
    expect(PAIR_PITY_AFTER).toBe(4);
    expect(TUNING.pairPityAfter).toBe(4);
  });

  it('有孤儿且连续未补满 pairPityAfter 次后强制出配对字', () => {
    TUNING.wordDrawChance = 0;
    const b = new Battle(7);
    b.grantPeach(10_000);
    b.wave = 3;
    const cell = b.unlockedCells()[0]!;
    b.words.set(`${cell.c},${cell.r}`, {
      char: '悟',
      general: hintGeneralForChar('悟'),
      tier: 1,
      cell,
    });
    b.summon();
    b.forcePairPityForTest();
    b.forceWordPityForTest();
    expect(b.summon()).toBe(true);
    const words = b.tray.filter((t) => t.kind === 'word');
    expect(words.length).toBeGreaterThanOrEqual(1);
    const chars = words.map((t) => (t.kind === 'word' ? t.char : ''));
    expect(chars.some((c) => c === '空' || c === '能')).toBe(true);
  });
});
