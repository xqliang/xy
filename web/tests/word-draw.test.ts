import { describe, it, expect, afterEach, beforeEach } from 'vitest';
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
  matchedHeroIds,
  hasAnyHeroMatch,
  forcedMatchWordChars,
  FORCE_MATCH_HALF_PAIR_P,
  YIN_SUPPORT_PRESS_MUL,
  RECENT_HERO_REPEAT_MUL,
} from '../src/word-draw';
import { Battle, TUNING } from '../src/battle';
import { hintGeneralForChar, charHeroCapacity } from '../src/generals';
import { loadHeroMatchHistory, recordHeroMatchGame } from '../src/hero-match-history';

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

  it('有未升满将 → 最多2张满5字，排除已在将上的字', () => {
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

describe('武将匹配与软权重', () => {
  it('matchedHeroIds：tray+棋盘可组合双字即匹配', () => {
    expect(matchedHeroIds(['大', '圣'], [])).toContain('dasheng');
    expect(matchedHeroIds(['圣'], ['大'])).toContain('dasheng');
    expect(hasAnyHeroMatch(['大'], [])).toBe(false);
    expect(hasAnyHeroMatch(['大'], ['圣'])).toBe(true);
  });

  it('音系出现后君/殊字权重 ×0.4', () => {
    const base = wordDrawEntries(5, [], [], [], undefined, {}).find((e) => e.char === '老')?.w ?? 0;
    const pressed = wordDrawEntries(5, [], [], [], undefined, { yinPressActive: true })
      .find((e) => e.char === '老')?.w ?? 0;
    expect(base).toBeGreaterThan(0);
    expect(pressed / base).toBeCloseTo(YIN_SUPPORT_PRESS_MUL, 5);
  });

  it('近10局匹配英雄字权重 ×0.4', () => {
    // 「圣」仅属大圣，避免共享字叠加干扰比值
    const base = wordDrawEntries(5, [], [], [], undefined, {}).find((e) => e.char === '圣')?.w ?? 0;
    const pressed = wordDrawEntries(5, [], [], [], undefined, {
      recentMatchedHeroIds: ['dasheng'],
    }).find((e) => e.char === '圣')?.w ?? 0;
    expect(base).toBeGreaterThan(0);
    expect(pressed / base).toBeCloseTo(RECENT_HERO_REPEAT_MUL, 5);
  });

  it('FORCE_MATCH_HALF_PAIR_P 为 0.6', () => {
    expect(FORCE_MATCH_HALF_PAIR_P).toBe(0.6);
  });

  it('forcedMatchWordChars：有半对且抽中半对分支时补配对字', () => {
    // next()<0.6 → 半对；随后 pick
    const rng = new FakeRng([0, 0]);
    const picks = forcedMatchWordChars(rng, [], ['大'], 2);
    expect(picks.length).toBe(1);
    expect(['圣', '蟒']).toContain(picks[0]!.char);
  });

  it('forcedMatchWordChars：有半对时 40% 可直接出一对新英雄', () => {
    // next()=0.7 ≥ 0.6 → 新英雄双字（不含已在场的「大」）
    const rng = new FakeRng([0.7, 0]);
    const picks = forcedMatchWordChars(rng, [], ['大'], 2);
    expect(picks.length).toBe(2);
    expect(picks.every((p) => p.char !== '大')).toBe(true);
    expect(hasAnyHeroMatch(picks.map((p) => p.char), [])).toBe(true);
  });

  it('forcedMatchWordChars：空场可一次给出双字', () => {
    const rng = new FakeRng([0]);
    const picks = forcedMatchWordChars(rng, [], [], 2);
    expect(picks.length).toBe(2);
    expect(hasAnyHeroMatch(picks.map((p) => p.char), [])).toBe(true);
  });

  it('forcedMatchWordChars：半对仅能复刷已匹配英雄时改抽新武将', () => {
    // 半对分支：只能补「蟒」（大圣已排除）
    const rng = new FakeRng([0, 0, 0, 0]);
    const picks = forcedMatchWordChars(rng, [], ['大'], 2, {
      excludeHeroIds: new Set(['dasheng']),
    });
    expect(picks.every((p) => p.char !== '圣')).toBe(true);
    const chars = picks.map((p) => p.char);
    if (chars.includes('蟒')) {
      expect(hasAnyHeroMatch(chars, ['大'])).toBe(true);
    } else {
      expect(picks.length).toBeGreaterThanOrEqual(1);
      expect(chars.includes('大') || hasAnyHeroMatch(chars, ['大']) || picks.length === 2).toBe(true);
    }
  });
});

describe('跨局匹配历史', () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => { mem.set(k, String(v)); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => { mem.clear(); },
      key: (i: number) => [...mem.keys()][i] ?? null,
      get length() { return mem.size; },
    } as Storage;
  });

  it('recordHeroMatchGame 写入 lastGameHadMatch 与 recentMatched', () => {
    recordHeroMatchGame(['dasheng', 'bajie']);
    const h = loadHeroMatchHistory();
    expect(h.lastGameHadMatch).toBe(true);
    expect(h.recentMatched.slice(0, 2)).toEqual(['dasheng', 'bajie']);
    recordHeroMatchGame([]);
    expect(loadHeroMatchHistory().lastGameHadMatch).toBe(false);
  });
});

describe('征兵匹配保底', () => {
  const origWord = TUNING.wordDrawChance;
  afterEach(() => {
    TUNING.wordDrawChance = origWord;
  });

  it('跨局未匹配保底：第二次征兵可组合出一对字', () => {
    TUNING.wordDrawChance = 0;
    const b = new Battle(11, 1, undefined, undefined, {}, [], [], false, undefined, 1, {
      forceMatchThisGame: true,
    });
    b.grantPeach(10_000);
    b.wave = 5;
    b.status = 'ready';
    expect(b.summon()).toBe(true); // 首次不转字
    expect(b.summon()).toBe(true);
    const trayChars = b.tray.filter((t) => t.kind === 'word').map((t) => (t.kind === 'word' ? t.char : ''));
    expect(hasAnyHeroMatch(trayChars, [])).toBe(true);
    expect(b.heroMatchedIdsThisGame().length).toBeGreaterThan(0);
  });

  it('波20窗口无匹配时强制补对', () => {
    TUNING.wordDrawChance = 0;
    const b = new Battle(13);
    b.grantPeach(10_000);
    b.setWaveForTest(19);
    b.status = 'ready'; // 即将进入第 20 波
    expect(b.summon()).toBe(true);
    expect(b.summon()).toBe(true);
    const trayChars = b.tray.filter((t) => t.kind === 'word').map((t) => (t.kind === 'word' ? t.char : ''));
    expect(hasAnyHeroMatch(trayChars, [])).toBe(true);
  });

  it('波20保底：早年已匹配大圣时不反复刷圣', () => {
    TUNING.wordDrawChance = 0;
    const b = new Battle(13);
    b.grantPeach(100_000);
    const cell = b.unlockedCells()[0]!;
    b.words.set(`${cell.c},${cell.r}`, {
      char: '大',
      general: hintGeneralForChar('大'),
      tier: 1,
      cell,
    });
    // 早年曾凑齐大圣（已计入匹配），「圣」已不在场；波20窗口仍要新匹配
    b.seedHeroMatchForTest('dasheng', 5);
    b.setWaveForTest(19);
    b.status = 'ready';
    b.summon(); // 首次不转字
    let sheng = 0;
    for (let i = 0; i < 8; i++) {
      expect(b.summon()).toBe(true);
      const chars = b.tray.filter((t) => t.kind === 'word').map((t) => (t.kind === 'word' ? t.char : ''));
      sheng += chars.filter((c) => c === '圣').length;
    }
    expect(sheng).toBe(0);
    expect(b.heroMatchedIdsThisGame().some((id) => id !== 'dasheng')).toBe(true);
  });
});
