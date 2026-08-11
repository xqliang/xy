import { describe, it, expect, afterEach } from 'vitest';
import {
  phaseWeight,
  phaseWeightRatio,
  pickWordChar,
  PAIR_PITY_AFTER,
  neededPartnerChars,
  pendingPartnerChars,
  wordDrawEntries,
  FAMILY_MAX5_ACTIVE_T3_PENALTY,
  isCharAtFieldCapacity,
  computeSummonWordPolicy,
  SUMMON_MAX_WORD_SLOTS_GROWING,
  missingHeroRoles,
} from '../src/word-draw';
import { Battle, TUNING } from '../src/battle';
import { hintGeneralForChar, charHeroCapacity } from '../src/generals';

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
    const pick = pickWordChar(rng, 3, ['大'], [], true);
    expect(neededPartnerChars(['大'])).toEqual(expect.arrayContaining(['圣', '蟒']));
    expect(['圣', '蟒']).toContain(pick.char);
  });

  it('有孤儿时 pendingPartner 排除本盘已抽到的配对字', () => {
    expect(pendingPartnerChars(['大'], ['圣'])).toEqual(expect.arrayContaining(['蟒']));
    expect(pendingPartnerChars(['大'], ['圣'])).not.toContain('圣');
  });

  it('尽量不抽已拥有字：已有「大」时加权抽其它字', () => {
    let dup = 0;
    for (let i = 0; i < 200; i++) {
      const rng = new FakeRng([i / 200, 0.3, 0.7]);
      const pick = pickWordChar(rng, 5, [], [], false, ['大']);
      if (pick.char === '大') dup++;
    }
    expect(dup).toBeLessThan(15);
  });

  it('本盘不抽重复配对字：tray 已有「圣」则不再抽「圣」', () => {
    let dup = 0;
    for (let i = 0; i < 200; i++) {
      const rng = new FakeRng([i / 200]);
      const pick = pickWordChar(rng, 5, ['大'], ['圣'], false, ['大']);
      if (pick.char === '圣') dup++;
    }
    expect(dup).toBe(0);
  });

  it('出现次数越多，后续抽到同字的概率越低', () => {
    const counts = new Map<string, number>([['仙', 4]]);
    let xian = 0;
    for (let i = 0; i < 300; i++) {
      const rng = new FakeRng([i / 300, 0.2]);
      const pick = pickWordChar(rng, 5, [], [], false, [], counts);
      if (pick.char === '仙') xian++;
    }
    expect(xian).toBeLessThan(20);
  });

  it('同盘征兵绝不重复相同字', () => {
    for (let i = 0; i < 300; i++) {
      const rng = new FakeRng([i / 300, 0.4, 0.8]);
      const pick = pickWordChar(rng, 5, [], ['铁'], false);
      expect(pick.char).not.toBe('铁');
    }
  });

  it('charHeroCapacity：牛可 3 张、魔仅 1 张', () => {
    expect(charHeroCapacity('牛')).toBe(3);
    expect(charHeroCapacity('魔')).toBe(1);
    expect(isCharAtFieldCapacity('魔', new Map([['魔', 1]]))).toBe(true);
    expect(isCharAtFieldCapacity('牛', new Map([['牛', 2]]))).toBe(false);
    expect(isCharAtFieldCapacity('牛', new Map([['牛', 3]]))).toBe(true);
  });

  it('场上魔字已满则不再抽魔', () => {
    for (let i = 0; i < 200; i++) {
      const rng = new FakeRng([i / 200, 0.3]);
      const pick = pickWordChar(rng, 5, [], [], false, [], undefined, {
        fieldCharCounts: new Map([['魔', 1]]),
      });
      expect(pick.char).not.toBe('魔');
    }
  });

  it('场上已有牛魔时压低同门派满3字（青）权重', () => {
    const base = wordDrawEntries(5, [], [], [], undefined, {}).find((e) => e.char === '青')?.w ?? 0;
    const penalized = wordDrawEntries(5, [], [], [], undefined, {
      activeMax5Families: new Set(['牛']),
    }).find((e) => e.char === '青')?.w ?? 0;
    expect(penalized).toBeLessThan(base * FAMILY_MAX5_ACTIVE_T3_PENALTY + 0.001);
  });
});

describe('半对保底 N=6', () => {
  const origWord = TUNING.wordDrawChance;
  afterEach(() => {
    TUNING.wordDrawChance = origWord;
  });

  it('PAIR_PITY_AFTER 为 6', () => {
    expect(PAIR_PITY_AFTER).toBe(6);
    expect(TUNING.pairPityAfter).toBe(6);
  });

  it('有孤儿且连续未补满 pairPityAfter 次后强制出配对字', () => {
    TUNING.wordDrawChance = 0;
    const b = new Battle(7);
    b.grantPeach(10_000);
    b.wave = 3;
    const cell = b.unlockedCells()[0]!;
    b.words.set(`${cell.c},${cell.r}`, {
      char: '大',
      general: hintGeneralForChar('大'),
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
    expect(chars.some((c) => c === '圣' || c === '蟒')).toBe(true);
  });
});

describe('征兵字牌策略', () => {
  it('满盘且激活将均为满5 → 不出字牌', () => {
    const policy = computeSummonWordPolicy({
      wave: 8,
      freeCellCount: 0,
      activeGenerals: [
        { role: '输出', maxTier: 5, tier: 5 },
        { role: '控制', maxTier: 5, tier: 5 },
      ],
      activeHeroChars: ['哪', '吒', '铁', '扇'],
    });
    expect(policy.maxWordSlots).toBe(0);
    expect(policy.wordSlotChanceMul).toBe(0);
    expect(policy.allowForceWord).toBe(false);
  });

  it('有未升满将 → 最多4张满5字，排除已在将上的字', () => {
    const policy = computeSummonWordPolicy({
      wave: 6,
      freeCellCount: 2,
      activeGenerals: [{ role: '输出', maxTier: 5, tier: 3 }],
      activeHeroChars: ['哪', '吒'],
    });
    expect(policy.maxWordSlots).toBe(SUMMON_MAX_WORD_SLOTS_GROWING);
    // 抽字统一从 1 阶起（继承对齐会在激活/喂字时自动补到搭档当前阶），不预设满5
    expect(policy.wordTier).toBe(1);
    expect(policy.tier5CapableOnly).toBe(true);
    expect(policy.excludeChars).toEqual(['哪', '吒']);
  });

  it('缺控制/辅助时 preferRoles 含缺失角色', () => {
    const missing = missingHeroRoles([{ role: '输出', maxTier: 5, tier: 5 }]);
    expect(missing).toEqual(expect.arrayContaining(['控制', '辅助']));
  });

  it('tier5CapableOnly 时不抽满3过渡字', () => {
    let qing = 0;
    for (let i = 0; i < 300; i++) {
      const rng = new FakeRng([i / 300, 0.2]);
      const pick = pickWordChar(rng, 5, [], [], false, [], undefined, { tier5CapableOnly: true });
      if (pick.char === '青') qing++;
    }
    expect(qing).toBe(0);
  });

  it('excludeChars 排除非配对缺口字', () => {
    for (let i = 0; i < 200; i++) {
      const rng = new FakeRng([i / 200, 0.3]);
      const pick = pickWordChar(rng, 5, [], [], false, [], undefined, { excludeChars: ['哪'] });
      expect(pick.char).not.toBe('哪');
    }
  });
});
