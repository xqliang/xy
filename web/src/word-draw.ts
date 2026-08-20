// 武将字牌抽取：阶段权重（前期满3 / 后期满5）+ 孤儿补缺 + 半对保底
// 优先级：配对字 > 不重复 > 高级（满5）
// 每局限制：同盘不重复字、场上字数上限、满5在场时压低同门派满3
import {
  GENERALS,
  charHeroCapacity,
  generalsWithChar,
  hintGeneralForChar,
  maxTierForChar,
  partnerChars,
  variantChar,
  type GeneralDef,
  type GeneralRole,
} from './generals';

export const PAIR_PITY_AFTER = 6;
/** 半对保底聚焦：场上独特单字 ≥ 该数时，随机选一个提高其配对权重 */
export const PAIR_PITY_FOCUS_MIN_ORPHANS = 3;
/** 半对保底：聚焦孤儿所需配对字的相对权重 */
export const PAIR_PITY_FOCUS_W = 0.4;
/** 半对保底：非聚焦（或孤儿不足时全部）配对字的相对权重 */
export const PAIR_PITY_OTHER_W = 0.2;
export const SUMMON_MAX_WORD_SLOTS = 2;
/** @deprecated 用 SUMMON_MAX_WORD_SLOTS */
export const SUMMON_MAX_WORD_SLOTS_GROWING = SUMMON_MAX_WORD_SLOTS;
/** 缺角色时抽字加权（输出/控制/辅助） */
export const ROLE_DIVERSITY_BOOST = 2.8;

export const CORE_HERO_ROLES: GeneralRole[] = ['输出', '控制', '辅助'];

/** 非配对时：已拥有字的权重倍率（尽量不重复；有 charCounts 时由出现次数衰减取代） */
export const DUP_WEIGHT = 0.04;
/** 半对孤儿所需配对字相对基础权重的倍率（非 forcePartner 软加权；保底见 PAIR_PITY_*） */
export const PARTNER_BOOST = 0.12;
/** 无配对需求时，满5 相对满3 的额外倍率（叠在 phaseWeight 之上） */
export const HIGH_TIER_BIAS = 1.75;
export const LOW_TIER_BIAS = 0.65;
/** 每多出现 1 次，权重乘以该系数（配对缺口字不受此打压） */
export const OCCURRENCE_DECAY = 0.55;
/** 场上已有同门派满5 激活时，满3 过渡将字的权重倍率 */
export const FAMILY_MAX5_ACTIVE_T3_PENALTY = 0.12;
/** 观音/梵音字已出现后，君/殊门派字权重倍率（降 60%） */
export const YIN_SUPPORT_PRESS_MUL = 0.4;
/** 近 N 局匹配过的武将字权重倍率（降 60%） */
export const RECENT_HERO_REPEAT_MUL = 0.4;
/** 跨局降重记忆局数 */
export const RECENT_HERO_HISTORY_LEN = 10;
/** 观音/梵音相关字（出现任一则触发君/殊软压） */
export const YIN_SUPPORT_CHARS = new Set(['观', '音', '梵']);
/** 被音系软压的门派 */
export const YIN_PRESS_FAMILIES = new Set(['君', '殊']);
/** 匹配保底：有半对可补时，补场上单字的概率；其余直接出一对新英雄 */
export const FORCE_MATCH_HALF_PAIR_P = 0.6;

/** 波段对满3/满5的相对权重（需压过满3基础 weight≈3、满5≈1 的差距） */
export function phaseWeight(wave: number, maxTier: 3 | 5): number {
  const w = Math.max(1, wave);
  if (w <= 4) return maxTier === 3 ? 0.8 : 0.2;
  if (w <= 7) return 0.5;
  return maxTier === 3 ? 0.2 : 0.8;
}

// —— 满3→满5 切换爬坡：场上有满3过渡武将时，随波次提升同门满5"非共享字"权重，
//    使 6-10 波能抽到该字、把满3换非共享字升为同门满5（如牛郎 牛+郎 → 抽到 二 → 二郎）。 ——
export const TRANSIT_UPGRADE_BOOST_FROM_WAVE = 4; // 第 4 波起开始爬坡
export const TRANSIT_UPGRADE_BOOST_FULL_WAVE = 8; // 第 8 波达到满额
export const TRANSIT_UPGRADE_BOOST_MUL_MAX = 8; // 满额倍率（×8，强压过满5基础 weight=1 与其它衰减）
/** 波次爬坡倍率：wave<from→1（前期不影响）；from→full 线性升至 max；full 后保持。 */
export function transitUpgradeBoostMul(wave: number): number {
  const w = Math.max(1, wave);
  if (w < TRANSIT_UPGRADE_BOOST_FROM_WAVE) return 1;
  if (w >= TRANSIT_UPGRADE_BOOST_FULL_WAVE) return TRANSIT_UPGRADE_BOOST_MUL_MAX;
  const t = (w - TRANSIT_UPGRADE_BOOST_FROM_WAVE) / (TRANSIT_UPGRADE_BOOST_FULL_WAVE - TRANSIT_UPGRADE_BOOST_FROM_WAVE);
  return 1 + (TRANSIT_UPGRADE_BOOST_MUL_MAX - 1) * t;
}

export interface WordPick {
  char: string;
  general: string;
}

export interface Rng {
  next(): number;
  pick<T>(arr: readonly T[]): T;
}

/** 当前未激活占用的字 → 需要的配对字列表（去重） */
export function neededPartnerChars(orphanChars: string[]): string[] {
  const need = new Set<string>();
  for (const c of orphanChars) {
    for (const p of partnerChars(c)) need.add(p);
  }
  return [...need];
}

/**
 * 本盘还缺的配对字：孤儿所需 + 本盘已抽字所需，且排除本盘已抽出的字。
 */
export function pendingPartnerChars(orphanChars: string[], trayCharsAlready: string[]): string[] {
  const need = new Set(neededPartnerChars(orphanChars));
  for (const c of trayCharsAlready) {
    for (const p of partnerChars(c)) need.add(p);
  }
  for (const c of trayCharsAlready) need.delete(c);
  return [...need];
}

/**
 * 从棋盘+tray 字中收集「孤儿」：未处于已激活武将格上的字。
 * activeCellKeys: 已激活武将占用的格子 key 集合（`${c},${r}`）；tray 字无格，一律算潜在孤儿来源。
 */
export function collectOrphanChars(
  boardWords: { char: string; cellKey: string }[],
  trayChars: string[],
  activeCellKeys: Set<string>,
): string[] {
  const orphans: string[] = [];
  for (const w of boardWords) {
    if (!activeCellKeys.has(w.cellKey)) orphans.push(w.char);
  }
  for (const c of trayChars) orphans.push(c);
  return orphans;
}

/** 统计字频 */
export function countChars(chars: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of chars) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}

/**
 * 匹配英雄：某一武将双字同时存在于 tray ∪ 棋盘（可组合，不必已激活）。
 */
export function matchedHeroIds(
  trayChars: readonly string[],
  boardChars: readonly string[],
): string[] {
  const counts = countChars([...trayChars, ...boardChars]);
  const out: string[] = [];
  for (const g of GENERALS) {
    const a = g.chars[0]!;
    const b = g.chars[1]!;
    if ((counts.get(a) ?? 0) >= 1 && (counts.get(b) ?? 0) >= 1) out.push(g.id);
  }
  return out;
}

export function hasAnyHeroMatch(
  trayChars: readonly string[],
  boardChars: readonly string[],
): boolean {
  return matchedHeroIds(trayChars, boardChars).length > 0;
}

/** 是否出现过观音/梵音相关字 */
export function yinSupportCharsPresent(chars: Iterable<string>): boolean {
  for (const c of chars) {
    if (YIN_SUPPORT_CHARS.has(c)) return true;
  }
  return false;
}

/** 该字是否属于近 N 局匹配过的武将 */
export function charInRecentMatchedHeroes(
  char: string,
  recentMatchedHeroIds: ReadonlySet<string> | readonly string[],
): boolean {
  const set = recentMatchedHeroIds instanceof Set
    ? recentMatchedHeroIds
    : new Set(recentMatchedHeroIds);
  if (set.size === 0) return false;
  for (const g of GENERALS) {
    if (g.chars.includes(char) && set.has(g.id)) return true;
  }
  return false;
}

/** 场上该字已达可组武将数上限 → 不再生成 */
export function isCharAtFieldCapacity(char: string, fieldCharCounts: ReadonlyMap<string, number>): boolean {
  return (fieldCharCounts.get(char) ?? 0) >= charHeroCapacity(char);
}

function charCountOf(counts: ReadonlyMap<string, number> | undefined, char: string): number {
  return counts?.get(char) ?? 0;
}

function isCharDrawBlocked(
  char: string,
  trayCharsAlready: readonly string[],
  fieldCharCounts: ReadonlyMap<string, number> | undefined,
): boolean {
  if (trayCharsAlready.includes(char)) return true;
  if (fieldCharCounts && isCharAtFieldCapacity(char, fieldCharCounts)) return true;
  return false;
}

function buildWeightedEntries(
  wave: number,
  orphanChars: string[],
  trayCharsAlready: string[],
  ownedChars: string[],
  charCounts?: ReadonlyMap<string, number>,
  tier5BiasMul = 1,
  fieldCharCounts?: ReadonlyMap<string, number>,
  activeMax5Families?: ReadonlySet<string>,
  activeTransitFamilies?: ReadonlySet<string>,
  transitUpgradeBoostMul = 1,
  tier5CapableOnly = false,
  excludeChars: readonly string[] = [],
  preferRoles: readonly GeneralRole[] = [],
  yinPressActive = false,
  recentMatchedHeroIds: readonly string[] = [],
): { char: string; general: string; w: number }[] {
  const needed = new Set(pendingPartnerChars(orphanChars, trayCharsAlready));
  const owned = new Set([...ownedChars, ...orphanChars, ...trayCharsAlready]);
  const exclude = new Set(excludeChars);
  const roleBoost = new Set(preferRoles);
  const recentSet = new Set(recentMatchedHeroIds);

  const entries: { char: string; general: string; w: number }[] = [];
  const seen = new Set<string>();

  for (const g of GENERALS) {
    if (tier5CapableOnly && g.maxTier < 5) continue;
    const pw = phaseWeight(wave, g.maxTier);
    let familyPenalty = 1;
    if (g.maxTier === 3 && activeMax5Families?.has(g.family)) {
      familyPenalty = FAMILY_MAX5_ACTIVE_T3_PENALTY;
    }
    for (const c of g.chars) {
      if (tier5CapableOnly && maxTierForChar(c) < 5) continue;
      if (isCharDrawBlocked(c, trayCharsAlready, fieldCharCounts)) continue;
      const isPartner = needed.has(c);
      if (!isPartner && exclude.has(c)) continue;
      const base = g.weight * pw;
      // 配对最优先；无配对时偏向满5 高级字
      let mult = isPartner ? PARTNER_BOOST : g.maxTier === 5 ? HIGH_TIER_BIAS * tier5BiasMul : LOW_TIER_BIAS;
      const count = charCountOf(charCounts, c);
      if (!isPartner && count > 0) {
        mult *= OCCURRENCE_DECAY ** count;
      } else if (owned.has(c) && !isPartner) {
        mult *= DUP_WEIGHT;
      }
      if (g.role !== '过渡' && roleBoost.has(g.role)) mult *= ROLE_DIVERSITY_BOOST;
      mult *= familyPenalty;
      // 满3在场 → 提升同门满5"非共享字"权重（满3→满5 切换爬坡；只 boost 非共享字，
      // 共享字=门派字两英雄共用，且满3已在场说明该字已有，无需再 boost）
      if (activeTransitFamilies?.has(g.family) && g.maxTier === 5 && c === variantChar(g) && transitUpgradeBoostMul > 1) {
        mult *= transitUpgradeBoostMul;
      }
      if (yinPressActive && YIN_PRESS_FAMILIES.has(g.family)) mult *= YIN_SUPPORT_PRESS_MUL;
      if (recentSet.size > 0 && charInRecentMatchedHeroes(c, recentSet)) {
        mult *= RECENT_HERO_REPEAT_MUL;
      }
      const w = base * mult;
      if (!seen.has(c)) {
        seen.add(c);
        entries.push({ char: c, general: hintGeneralForChar(c), w });
      } else {
        const e = entries.find((x) => x.char === c)!;
        e.w += w;
      }
    }
  }
  return entries;
}

function pickFromWeighted(rng: Rng, entries: { char: string; general: string; w: number }[]): WordPick {
  const total = entries.reduce((s, e) => s + e.w, 0);
  if (total <= 0 || entries.length === 0) {
    const g = GENERALS[0]!;
    return { char: g.chars[0], general: g.id };
  }
  let r = rng.next() * total;
  for (const e of entries) {
    r -= e.w;
    if (r <= 0) return { char: e.char, general: e.general };
  }
  const last = entries[entries.length - 1]!;
  return { char: last.char, general: last.general };
}

export interface WordPickOpts {
  tier5BiasMul?: number;
  /** 场上各字实例数（仅棋盘，不含本盘 tray） */
  fieldCharCounts?: ReadonlyMap<string, number>;
  /** 已激活满5 武将的门派 family 集合 */
  activeMax5Families?: ReadonlySet<string>;
  /** 已激活满3过渡武将的门派集合 → 提升同门满5"非共享字"权重（满3→满5 切换爬坡） */
  activeTransitFamilies?: ReadonlySet<string>;
  /** 满3在场时同门满5非共享字的波次爬坡倍率（1=不 boost；caller 按 wave 用 transitUpgradeBoostMul 算） */
  transitUpgradeBoostMul?: number;
  /** 只抽可升到 5 阶的字（排除满3过渡字） */
  tier5CapableOnly?: boolean;
  /** 已在激活武将上的字（非配对缺口时不抽） */
  excludeChars?: readonly string[];
  /** 优先补齐的角色 */
  preferRoles?: readonly GeneralRole[];
  /** 本局已出现观音/梵音字 → 君/殊权重 × YIN_SUPPORT_PRESS_MUL */
  yinPressActive?: boolean;
  /** 近 N 局匹配过的武将 id → 其字权重 × RECENT_HERO_REPEAT_MUL */
  recentMatchedHeroIds?: readonly string[];
}

/** 激活武将已占用的字 */
export function activeHeroCharsFromPairs(
  pairs: readonly { left: string; right: string }[],
): string[] {
  const out: string[] = [];
  for (const p of pairs) {
    out.push(p.left, p.right);
  }
  return out;
}

/** 场上仍缺的核心角色（输出/控制/辅助，不含过渡） */
export function missingHeroRoles(
  active: readonly { role: GeneralRole; maxTier: number; tier: number }[],
): GeneralRole[] {
  const present = new Set<GeneralRole>();
  for (const g of active) {
    if (g.role === '过渡') continue;
    if (g.tier >= g.maxTier || g.maxTier === 5) present.add(g.role);
    else present.add(g.role); // 未升满仍算已有该路线
  }
  return CORE_HERO_ROLES.filter((r) => !present.has(r));
}

export interface SummonWordPolicyInput {
  wave: number;
  freeCellCount: number;
  activeGenerals: readonly { role: GeneralRole; maxTier: number; tier: number }[];
  activeHeroChars: readonly string[];
}

export interface SummonWordPolicy {
  wordSlotChanceMul: number;
  allowForceWord: boolean;
  allowForcePartner: boolean;
  maxWordSlots: number;
  wordTier: number;
  tier5CapableOnly: boolean;
  excludeChars: readonly string[];
  preferRoles: readonly GeneralRole[];
}

/** 依棋盘武将饱和度决定本盘征兵字牌策略（满盘/满5 仍可出字） */
export function computeSummonWordPolicy(input: SummonWordPolicyInput): SummonWordPolicy {
  const { activeGenerals, activeHeroChars } = input;
  const preferRoles = missingHeroRoles(activeGenerals);
  const allMax5 =
    activeGenerals.length > 0
    && activeGenerals.every((g) => g.maxTier === 5 && g.tier >= 5);
  const hasGrowing = activeGenerals.some((g) => g.tier < 5);

  // wordTier 统一从 1 起：配对/喂字时的"继承对齐"（activeGenerals() 里 target = max(左, 右)）
  // 已经会把新字自动补到已激活搭档的当前阶，无需在抽字时就预设高阶——否则会让满5可培养的字
  // 一出场就是满级，跳过合并升阶的过程。
  if (hasGrowing || (activeGenerals.length > 0 && !allMax5)) {
    return {
      wordSlotChanceMul: 1,
      allowForceWord: true,
      allowForcePartner: true,
      maxWordSlots: SUMMON_MAX_WORD_SLOTS,
      wordTier: 1,
      tier5CapableOnly: true,
      excludeChars: activeHeroChars,
      preferRoles,
    };
  }

  return {
    wordSlotChanceMul: 1,
    allowForceWord: true,
    allowForcePartner: true,
    maxWordSlots: SUMMON_MAX_WORD_SLOTS,
    wordTier: 1,
    tier5CapableOnly: false,
    excludeChars: activeHeroChars,
    preferRoles,
  };
}

/** 测试/诊断：当前抽字权重表 */
export function wordDrawEntries(
  wave: number,
  orphanChars: string[],
  trayCharsAlready: string[],
  ownedChars: string[] = [],
  charCounts?: ReadonlyMap<string, number>,
  opts?: WordPickOpts,
): { char: string; general: string; w: number }[] {
  return buildWeightedEntries(
    wave,
    orphanChars,
    trayCharsAlready,
    ownedChars,
    charCounts,
    opts?.tier5BiasMul ?? 1,
    opts?.fieldCharCounts,
    opts?.activeMax5Families,
    opts?.activeTransitFamilies,
    opts?.transitUpgradeBoostMul ?? 1,
    opts?.tier5CapableOnly ?? false,
    opts?.excludeChars ?? [],
    opts?.preferRoles ?? [],
    opts?.yinPressActive ?? false,
    opts?.recentMatchedHeroIds ?? [],
  );
}

/**
 * 补上该字后，是否能让某个「尚未计入 excludeHeroIds」的武将达成匹配。
 * 用于波段保底：避免反复补齐早已匹配过的半对（如已记过大圣仍强塞「圣」），导致窗口匹配永远不推进。
 */
export function charCompletesNewHeroMatch(
  char: string,
  counts: ReadonlyMap<string, number>,
  excludeHeroIds: ReadonlySet<string>,
): boolean {
  for (const g of generalsWithChar(char)) {
    if (excludeHeroIds.has(g.id)) continue;
    const a = g.chars[0]!;
    const b = g.chars[1]!;
    const hasA = (counts.get(a) ?? 0) >= 1;
    const hasB = (counts.get(b) ?? 0) >= 1;
    if (hasA && hasB) continue;
    const nextA = hasA || a === char;
    const nextB = hasB || b === char;
    if (nextA && nextB) return true;
  }
  return false;
}

/**
 * 保底推进匹配：有半对可补时 `FORCE_MATCH_HALF_PAIR_P` 补场上单字，否则（及无半对时）
 * 尽量一次给出某未匹配武将双字（slots≥2）或首字。
 * 返回 0–2 个尚未在 tray 中的字（调用方负责写入 tray）。
 */
export function forcedMatchWordChars(
  rng: Rng,
  trayCharsAlready: readonly string[],
  boardChars: readonly string[],
  maxSlots: number,
  opts?: {
    tier5CapableOnly?: boolean;
    fieldCharCounts?: ReadonlyMap<string, number>;
    excludeHeroIds?: ReadonlySet<string>;
  },
): WordPick[] {
  const slotsLeft = Math.max(0, maxSlots - trayCharsAlready.length);
  if (slotsLeft <= 0) return [];
  const counts = countChars([...boardChars, ...trayCharsAlready]);
  const field = opts?.fieldCharCounts;
  const t5Only = opts?.tier5CapableOnly ?? false;
  const excludeHeroes = opts?.excludeHeroIds ?? new Set<string>();

  const pending = pendingPartnerChars(boardChars, [...trayCharsAlready]).filter(
    (c) =>
      (counts.get(c) ?? 0) < 1
      && !isCharDrawBlocked(c, trayCharsAlready, field)
      && charCompletesNewHeroMatch(c, counts, excludeHeroes),
  );
  const preferHalfPair = pending.length > 0 && rng.next() < FORCE_MATCH_HALF_PAIR_P;
  if (preferHalfPair) {
    const char = rng.pick(pending);
    return [{ char, general: hintGeneralForChar(char) }];
  }

  // 一对新英雄（双字皆不在池中）优先；否则回退补半对 / 未完整武将
  const freshPair = pickForcedFreshHeroPair(
    rng,
    counts,
    trayCharsAlready,
    slotsLeft,
    t5Only,
    excludeHeroes,
    field,
  );
  if (freshPair.length > 0) return freshPair;

  if (pending.length > 0) {
    const char = rng.pick(pending);
    return [{ char, general: hintGeneralForChar(char) }];
  }

  return pickForcedIncompleteHeroChars(
    rng,
    counts,
    trayCharsAlready,
    slotsLeft,
    t5Only,
    excludeHeroes,
    field,
  );
}

/** 尚未出场的武将：一次尽量塞双字 */
function pickForcedFreshHeroPair(
  rng: Rng,
  counts: ReadonlyMap<string, number>,
  trayCharsAlready: readonly string[],
  slotsLeft: number,
  t5Only: boolean,
  excludeHeroes: ReadonlySet<string>,
  field: ReadonlyMap<string, number> | undefined,
): WordPick[] {
  if (slotsLeft < 2) return [];
  const candidates = GENERALS.filter((g) => {
    if (excludeHeroes.has(g.id)) return false;
    if (t5Only && g.maxTier < 5) return false;
    const a = g.chars[0]!;
    const b = g.chars[1]!;
    if ((counts.get(a) ?? 0) >= 1 || (counts.get(b) ?? 0) >= 1) return false;
    if (isCharDrawBlocked(a, trayCharsAlready, field)) return false;
    if (isCharDrawBlocked(b, [...trayCharsAlready, a], field)) return false;
    if (t5Only && (maxTierForChar(a) < 5 || maxTierForChar(b) < 5)) return false;
    return true;
  });
  if (candidates.length === 0) return [];
  const g = rng.pick(candidates);
  return [
    { char: g.chars[0]!, general: g.id },
    { char: g.chars[1]!, general: g.id },
  ];
}

/** 未完整匹配武将：补缺字或开新半对 */
function pickForcedIncompleteHeroChars(
  rng: Rng,
  counts: ReadonlyMap<string, number>,
  trayCharsAlready: readonly string[],
  slotsLeft: number,
  t5Only: boolean,
  excludeHeroes: ReadonlySet<string>,
  field: ReadonlyMap<string, number> | undefined,
): WordPick[] {
  const candidates = GENERALS.filter((g) => {
    if (excludeHeroes.has(g.id)) return false;
    if (t5Only && g.maxTier < 5) return false;
    const a = g.chars[0]!;
    const b = g.chars[1]!;
    const hasA = (counts.get(a) ?? 0) >= 1;
    const hasB = (counts.get(b) ?? 0) >= 1;
    if (hasA && hasB) return false;
    return true;
  });
  if (candidates.length === 0) return [];
  const g = rng.pick(candidates);
  const a = g.chars[0]!;
  const b = g.chars[1]!;
  const hasA = (counts.get(a) ?? 0) >= 1;
  const hasB = (counts.get(b) ?? 0) >= 1;
  const out: WordPick[] = [];
  const tryPush = (c: string) => {
    if (out.length >= slotsLeft) return;
    if (isCharDrawBlocked(c, [...trayCharsAlready, ...out.map((x) => x.char)], field)) return;
    if (t5Only && maxTierForChar(c) < 5) return;
    out.push({ char: c, general: g.id });
  };
  if (!hasA && !hasB) {
    if (slotsLeft >= 2) {
      tryPush(a);
      tryPush(b);
    } else {
      tryPush(a);
    }
  } else if (!hasA) {
    tryPush(a);
  } else if (!hasB) {
    tryPush(b);
  }
  return out;
}

/**
 * 半对保底：在仍缺的配对字中加权抽取。
 * - 场上独特单字 ≥ PAIR_PITY_FOCUS_MIN_ORPHANS：随机选一个孤儿，其配对字权重 PAIR_PITY_FOCUS_W，其余配对字 PAIR_PITY_OTHER_W
 * - 否则：全部配对字等权 PAIR_PITY_OTHER_W
 */
export function pickForcedPartnerChar(
  rng: Rng,
  orphanChars: string[],
  need: string[],
): WordPick {
  if (need.length === 0) {
    const g = GENERALS[0]!;
    return { char: g.chars[0]!, general: g.id };
  }
  const needSet = new Set(need);
  const uniqueOrphans = [...new Set(orphanChars)].filter((o) =>
    partnerChars(o).some((p) => needSet.has(p)),
  );
  let focusPartners: Set<string> | null = null;
  if (uniqueOrphans.length >= PAIR_PITY_FOCUS_MIN_ORPHANS) {
    const focus = rng.pick(uniqueOrphans);
    focusPartners = new Set(partnerChars(focus).filter((p) => needSet.has(p)));
  }
  const entries = need.map((c) => ({
    char: c,
    general: hintGeneralForChar(c),
    w: focusPartners?.has(c) ? PAIR_PITY_FOCUS_W : PAIR_PITY_OTHER_W,
  }));
  return pickFromWeighted(rng, entries);
}

/**
 * 抽一张字牌。
 * - forcePartner：只从仍缺的配对字中抽（≥3 单字时聚焦其一，见 pickForcedPartnerChar）
 * - 否则：配对加权 ≫ 不重复的高级字 ≫ 重复字（接近不抽）
 * - ownedChars：棋盘已有字（含已激活），用于去重
 * - 同盘 trayCharsAlready：本盘已抽字，绝不再出相同字
 * - fieldCharCounts：场上字数达武将上限则剔除
 */
export function pickWordChar(
  rng: Rng,
  wave: number,
  orphanChars: string[],
  trayCharsAlready: string[],
  forcePartner: boolean,
  ownedChars: string[] = [],
  charCounts?: ReadonlyMap<string, number>,
  opts?: WordPickOpts,
): WordPick {
  const tier5BiasMul = opts?.tier5BiasMul ?? 1;
  const fieldCharCounts = opts?.fieldCharCounts;
  const activeMax5Families = opts?.activeMax5Families;
  const activeTransitFamilies = opts?.activeTransitFamilies;
  const transitUpgradeBoostMul = opts?.transitUpgradeBoostMul ?? 1;
  const tier5CapableOnly = opts?.tier5CapableOnly ?? false;
  const excludeChars = opts?.excludeChars ?? [];
  const preferRoles = opts?.preferRoles ?? [];
  const yinPressActive = opts?.yinPressActive ?? false;
  const recentMatchedHeroIds = opts?.recentMatchedHeroIds ?? [];
  if (forcePartner) {
    const need = pendingPartnerChars(orphanChars, trayCharsAlready).filter(
      (c) => !isCharDrawBlocked(c, trayCharsAlready, fieldCharCounts),
    );
    if (need.length > 0) {
      return pickForcedPartnerChar(rng, orphanChars, need);
    }
  }
  return pickFromWeighted(
    rng,
    buildWeightedEntries(
      wave,
      orphanChars,
      trayCharsAlready,
      ownedChars,
      charCounts,
      tier5BiasMul,
      fieldCharCounts,
      activeMax5Families,
      activeTransitFamilies,
      transitUpgradeBoostMul,
      tier5CapableOnly,
      excludeChars,
      preferRoles,
      yinPressActive,
      recentMatchedHeroIds,
    ),
  );
}

/** 统计用：给定波次下满3/满5 字的期望权重比（测试） */
export function phaseWeightRatio(wave: number): { t3: number; t5: number } {
  let t3 = 0;
  let t5 = 0;
  for (const g of GENERALS) {
    const pw = phaseWeight(wave, g.maxTier);
    const add = g.weight * pw * 2; // 每武将两字
    if (g.maxTier === 3) t3 += add;
    else t5 += add;
  }
  return { t3, t5 };
}

export function isMax3General(def: GeneralDef): boolean {
  return def.maxTier === 3;
}
