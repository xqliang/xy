import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  phaseWeight,
  phaseWeightRatio,
  pickWordChar,
  pickForcedPartnerChar,
  PAIR_PITY_AFTER,
  PAIR_PITY_FOCUS_MIN_ORPHANS,
  PAIR_PITY_FOCUS_W,
  PAIR_PITY_OTHER_W,
  neededPartnerChars,
  pendingPartnerChars,
  wordDrawEntries,
  FAMILY_MAX5_ACTIVE_T3_PENALTY,
  isCharAtFieldCapacity,
  computeSummonWordPolicy,
  SUMMON_MAX_WORD_SLOTS,
  SUMMON_MAX_WORD_SLOTS_GROWING,
  missingHeroRoles,
  matchedHeroIds,
  hasAnyHeroMatch,
  forcedMatchWordChars,
  FORCE_MATCH_HALF_PAIR_P,
  YIN_SUPPORT_PRESS_MUL,
  RECENT_HERO_REPEAT_MUL,
  transitUpgradeBoostMul,
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

  it('半对保底：≥3 单字时聚焦孤儿配对权重大于其它配对', () => {
    expect(PAIR_PITY_FOCUS_MIN_ORPHANS).toBe(3);
    expect(PAIR_PITY_FOCUS_W).toBe(0.4);
    expect(PAIR_PITY_OTHER_W).toBe(0.2);
    const orphans = ['大', '哪', '铁'];
    const need = pendingPartnerChars(orphans, []);
    // 大→圣/蟒；哪→吒；铁→扇/背。首抽固定聚焦「大」(pick index 0)
    let focusHits = 0;
    let otherHits = 0;
    for (let i = 0; i < 800; i++) {
      const rng = new FakeRng([0, i / 800]);
      const pick = pickForcedPartnerChar(rng, orphans, need);
      if (pick.char === '圣' || pick.char === '蟒') focusHits++;
      else otherHits++;
    }
    // 聚焦侧 0.4×2、其它 0.2×3 → P(聚焦)≈0.4/0.7≈0.57
    expect(focusHits).toBeGreaterThan(otherHits);
    expect(focusHits / (focusHits + otherHits)).toBeGreaterThan(0.48);
    expect(focusHits / (focusHits + otherHits)).toBeLessThan(0.72);
  });

  it('半对保底：单字不足 3 时配对字等权', () => {
    const orphans = ['大', '哪'];
    const need = pendingPartnerChars(orphans, []);
    const counts = new Map<string, number>();
    for (let i = 0; i < 600; i++) {
      const rng = new FakeRng([i / 600]);
      const pick = pickForcedPartnerChar(rng, orphans, need);
      counts.set(pick.char, (counts.get(pick.char) ?? 0) + 1);
    }
    const vals = [...counts.values()];
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    // 等权 0.2：各配对字出现次数不应差太多
    expect(max - min).toBeLessThan(120);
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
    b.grantPeach(10_000, true);
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
  it('满盘且激活将均为满5 → 仍可出字牌', () => {
    const policy = computeSummonWordPolicy({
      wave: 8,
      freeCellCount: 0,
      activeGenerals: [
        { role: '输出', maxTier: 5, tier: 5 },
        { role: '控制', maxTier: 5, tier: 5 },
      ],
      activeHeroChars: ['哪', '吒', '铁', '扇'],
    });
    expect(policy.maxWordSlots).toBe(SUMMON_MAX_WORD_SLOTS);
    expect(policy.wordSlotChanceMul).toBe(1);
    expect(policy.allowForceWord).toBe(true);
    expect(policy.tier5CapableOnly).toBe(false);
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

  it('FORCE_MATCH_HALF_PAIR_P 为 0.8', () => {
    expect(FORCE_MATCH_HALF_PAIR_P).toBe(0.8);
  });

  it('forcedMatchWordChars：有半对且抽中半对分支时补配对字', () => {
    // next()<0.6 → 半对；随后 pick
    const rng = new FakeRng([0, 0]);
    const picks = forcedMatchWordChars(rng, [], ['大'], 2);
    expect(picks.length).toBe(1);
    expect(['圣', '蟒']).toContain(picks[0]!.char);
  });

  it('forcedMatchWordChars：有半对时 40% 只发首字（拆对，第二张下次再发）', () => {
    // next()=0.7 ≥ 0.6 → 走 fresh pair 分支，但拆对后只返回 1 个首字，不直接成对
    const rng = new FakeRng([0.7, 0]);
    const picks = forcedMatchWordChars(rng, [], ['大'], 2);
    expect(picks.length).toBe(1);
    expect(picks[0]!.char).not.toBe('大');
    // 单字不能独立成对
    expect(hasAnyHeroMatch(picks.map((p) => p.char), [])).toBe(false);
  });

  it('forcedMatchWordChars：空场只发一个首字（拆对）', () => {
    const rng = new FakeRng([0]);
    const picks = forcedMatchWordChars(rng, [], [], 2);
    expect(picks.length).toBe(1);
    // 单字不能独立成对
    expect(hasAnyHeroMatch(picks.map((p) => p.char), [])).toBe(false);
  });

  it('forcedMatchWordChars：半对仅能复刷已匹配英雄时改抽新武将首字', () => {
    // 半对分支：只能补「蟒」（大圣已排除），拆对后只给 1 个字
    const rng = new FakeRng([0, 0, 0, 0]);
    const picks = forcedMatchWordChars(rng, [], ['大'], 2, {
      excludeHeroIds: new Set(['dasheng']),
    });
    expect(picks.every((p) => p.char !== '圣')).toBe(true);
    expect(picks.length).toBe(1);
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

  it('跨局未匹配保底：拆对后多次征兵+放棋盘可凑对（不一次出一对）', () => {
    TUNING.wordDrawChance = 0;
    const b = new Battle(11, 1, undefined, undefined, {}, [], [], false, undefined, 1, {
      forceMatchThisGame: true,
    });
    b.grantPeach(100_000, true);
    b.wave = 5;
    b.status = 'ready';
    const cells = b.unlockedCells();
    let boardWords: { char: string; general: string; cell: { c: number; r: number } }[] = [];
    const placeTrayWordsOnBoard = () => {
      for (const t of b.tray) {
        if (t.kind !== 'word') continue;
        const cell = cells.find((c) => !boardWords.some((w) => w.cell.c === c.c && w.cell.r === c.r));
        if (!cell) break;
        boardWords.push({ char: t.char, general: t.general, cell: { c: cell.c, r: cell.r } });
        b.words.set(`${cell.c},${cell.r}`, { char: t.char, general: t.general, tier: 1, cell: { c: cell.c, r: cell.r } });
      }
    };
    expect(b.summon()).toBe(true); // 首次不转字
    // 多次征兵：每次把 tray 字放棋盘积累，force match 逐步给出首字→配对字
    for (let i = 0; i < 8 && b.heroMatchedIdsThisGame().length === 0; i++) {
      expect(b.summon()).toBe(true);
      placeTrayWordsOnBoard();
    }
    expect(b.heroMatchedIdsThisGame().length).toBeGreaterThan(0);
  });

  it('波20窗口无匹配时强制拆对（不一次出一对）', () => {
    TUNING.wordDrawChance = 0;
    const b = new Battle(13);
    b.grantPeach(100_000, true);
    b.setWaveForTest(19);
    b.status = 'ready'; // 即将进入第 20 波 → 波窗保底
    const cells = b.unlockedCells();
    let boardWords: { char: string; cell: { c: number; r: number } }[] = [];
    const placeTrayWordsOnBoard = () => {
      for (const t of b.tray) {
        if (t.kind !== 'word') continue;
        const cell = cells.find((c) => !boardWords.some((w) => w.cell.c === c.c && w.cell.r === c.r));
        if (!cell) break;
        boardWords.push({ char: t.char, cell: { c: cell.c, r: cell.r } });
        b.words.set(`${cell.c},${cell.r}`, { char: t.char, general: t.general, tier: 1, cell: { c: cell.c, r: cell.r } });
      }
    };
    expect(b.summon()).toBe(true);
    for (let i = 0; i < 8 && b.heroMatchedIdsThisGame().length === 0; i++) {
      expect(b.summon()).toBe(true);
      placeTrayWordsOnBoard();
    }
    expect(b.heroMatchedIdsThisGame().length).toBeGreaterThan(0);
  });

  it('波20保底：早年已匹配大圣时不反复刷圣', () => {
    TUNING.wordDrawChance = 0;
    const b = new Battle(13);
    b.grantPeach(100_000, true);
    // 早年曾凑齐大圣（已计入匹配）；场上不留「大」孤儿，避免半对保底合法补「圣」
    b.seedHeroMatchForTest('dasheng', 5);
    b.setWaveForTest(19);
    b.status = 'ready';
    const cells = b.unlockedCells();
    let boardWords: { char: string; cell: { c: number; r: number } }[] = [];
    const placeTrayWordsOnBoard = () => {
      for (const t of b.tray) {
        if (t.kind !== 'word') continue;
        const cell = cells.find((c) => !boardWords.some((w) => w.cell.c === c.c && w.cell.r === c.r));
        if (!cell) break;
        boardWords.push({ char: t.char, cell: { c: cell.c, r: cell.r } });
        b.words.set(`${cell.c},${cell.r}`, { char: t.char, general: t.general, tier: 1, cell: { c: cell.c, r: cell.r } });
      }
    };
    b.summon(); // 首次不转字
    let sheng = 0;
    for (let i = 0; i < 8; i++) {
      expect(b.summon()).toBe(true);
      placeTrayWordsOnBoard();
      const chars = b.tray.filter((t) => t.kind === 'word').map((t) => (t.kind === 'word' ? t.char : ''));
      sheng += chars.filter((c) => c === '圣').length;
    }
    expect(sheng).toBe(0);
    expect(b.heroMatchedIdsThisGame().some((id) => id !== 'dasheng')).toBe(true);
  });
});

describe('AI 征兵匹配保底', () => {
  const origWord = TUNING.wordDrawChance;
  afterEach(() => {
    TUNING.wordDrawChance = origWord;
  });

  it('跨局保底：AI 独立维护（不跟随玩家 forceMatchThisGame）', () => {
    // AI 自带 aiForceMatchThisGame=true，与玩家 forceMatchThisGame 独立
    // 即使玩家 forceMatchThisGame=false，AI 仍有自己的保底
    TUNING.wordDrawChance = 0;
    const b = new Battle(11, 1, undefined, undefined, {}, [], [], false, undefined, 1, {
      forceMatchThisGame: false, // 玩家不挂保底
    });
    (b as any).aiPeach = 10_000;
    b.wave = 5;
    b.status = 'ready';
    expect((b as any).aiSummon()).toBe(true);
    expect((b as any).aiSummon()).toBe(true);
    const trayChars = b.aiTray.filter((t) => t?.kind === 'word').map((t) => (t!.kind === 'word' ? t.char : ''));
    // AI 自带保底，应获得字（即使玩家没挂保底）
    expect(trayChars.length).toBeGreaterThan(0);
  });

  it('波20窗口无匹配时 AI 仍可拆对补字（波窗保底独立于跨局）', () => {
    TUNING.wordDrawChance = 0;
    const b = new Battle(13);
    (b as any).aiPeach = 100_000;
    b.setWaveForTest(19);
    b.status = 'ready'; // 即将进入第 20 波 → 波窗保底触发
    const cells = b.aiUnlockedCells();
    let boardWords: { char: string; cell: { c: number; r: number } }[] = [];
    const placeTrayWordsOnBoard = () => {
      for (const t of b.aiTray) {
        if (!t || t.kind !== 'word') continue;
        const cell = cells.find((c) => !boardWords.some((w) => w.cell.c === c.c && w.cell.r === c.r));
        if (!cell) break;
        boardWords.push({ char: t.char, cell: { c: cell.c, r: cell.r } });
        b.aiWords.set(`${cell.c},${cell.r}`, { char: t.char, general: t.general, tier: 1, cell: { c: cell.c, r: cell.r } });
      }
    };
    expect((b as any).aiSummon()).toBe(true);
    // 拆对：多次征兵+放棋盘，凑对
    for (let i = 0; i < 8 && b.aiHeroMatchedIdsThisGame().length === 0; i++) {
      expect((b as any).aiSummon()).toBe(true);
      placeTrayWordsOnBoard();
    }
    expect(b.aiHeroMatchedIdsThisGame().length).toBeGreaterThan(0);
  });
});

describe('满3在场 → 抽同门满5非共享字爬坡（相对满3组成波次）', () => {
  // 场上有满3过渡（如牛郎 牛+郎）时，相对其组成波次在后续 4-10 波内提升同门满5
  // （二郎 二+郎）非共享字「二」的权重，使玩家能抽到「二」、把满3换非共享字升为同门满5。
  // 共享字「郎」两英雄共用，不 boost。各满3各自独立计时（不同波次组成各自爬坡）。
  it('transitUpgradeBoostMul：age<4 为 1、age10 达满额 8、后保持', () => {
    // formed=5：age0/3 →1；age5 已生效；age10/20 →8
    expect(transitUpgradeBoostMul(5, 5)).toBe(1);   // age0 刚组成
    expect(transitUpgradeBoostMul(5, 8)).toBe(1);   // age3 喘息期
    expect(transitUpgradeBoostMul(5, 10)).toBeGreaterThan(1); // age5 爬坡中
    expect(transitUpgradeBoostMul(5, 15)).toBe(8);  // age10 满额
    expect(transitUpgradeBoostMul(5, 25)).toBe(8);  // age20 保持
  });

  it('满3(郎)第5波组成、第15波抽字：同门满5非共享字「二」权重 ×8', () => {
    const base = wordDrawEntries(15, [], [], [], undefined, { activeTransitFamilies: new Map() })
      .find((e) => e.char === '二')?.w ?? 0;
    const boosted = wordDrawEntries(15, [], [], [], undefined, {
      activeTransitFamilies: new Map([['郎', 5]]),
    }).find((e) => e.char === '二')?.w ?? 0;
    expect(base).toBeGreaterThan(0);
    expect(boosted).toBeCloseTo(base * 8, 5);
  });

  it('boost 只作用于满5非共享字：共享字「郎」不受 boost 影响', () => {
    const withBoost = wordDrawEntries(15, [], [], [], undefined, {
      activeTransitFamilies: new Map([['郎', 5]]),
    }).find((e) => e.char === '郎')?.w ?? 0;
    const without = wordDrawEntries(15, [], [], [], undefined, { activeTransitFamilies: new Map() })
      .find((e) => e.char === '郎')?.w ?? 0;
    expect(withBoost).toBeCloseTo(without, 5);
  });

  it('相对性：同当前波、不同组成波次的满3，爬坡进度不同', () => {
    // 当前第 10 波：郎第5波组成(age5 爬坡中) > 郎第9波组成(age1 未 boost) ≈ 无满3
    const formedEarly = wordDrawEntries(10, [], [], [], undefined, {
      activeTransitFamilies: new Map([['郎', 5]]),
    }).find((e) => e.char === '二')?.w ?? 0;
    const formedLate = wordDrawEntries(10, [], [], [], undefined, {
      activeTransitFamilies: new Map([['郎', 9]]),
    }).find((e) => e.char === '二')?.w ?? 0;
    const none = wordDrawEntries(10, [], [], [], undefined, { activeTransitFamilies: new Map() })
      .find((e) => e.char === '二')?.w ?? 0;
    expect(formedEarly).toBeGreaterThan(formedLate);
    expect(formedLate).toBeCloseTo(none, 5);
  });
});
