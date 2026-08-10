// 武将字牌抽取：阶段权重（前期满3 / 后期满5）+ 孤儿补缺 + 半对保底
// 优先级：配对字 > 不重复 > 高级（满5）
// 每局限制：同盘不重复字、场上字数上限、满5在场时压低同门派满3
import {
  GENERALS,
  charHeroCapacity,
  hintGeneralForChar,
  partnerChars,
  type GeneralDef,
} from './generals';

export const PAIR_PITY_AFTER = 4;

/** 非配对时：已拥有字的权重倍率（尽量不重复；有 charCounts 时由出现次数衰减取代） */
export const DUP_WEIGHT = 0.04;
/** 配对字相对基础权重的倍率 */
export const PARTNER_BOOST = 12;
/** 无配对需求时，满5 相对满3 的额外倍率（叠在 phaseWeight 之上） */
export const HIGH_TIER_BIAS = 1.75;
export const LOW_TIER_BIAS = 0.65;
/** 每多出现 1 次，权重乘以该系数（配对缺口字不受此打压） */
export const OCCURRENCE_DECAY = 0.55;
/** 场上已有同门派满5 激活时，满3 过渡将字的权重倍率 */
export const FAMILY_MAX5_ACTIVE_T3_PENALTY = 0.12;

/** 波段对满3/满5的相对权重（需压过满3基础 weight≈3、满5≈1 的差距） */
export function phaseWeight(wave: number, maxTier: 3 | 5): number {
  const w = Math.max(1, wave);
  if (w <= 4) return maxTier === 3 ? 0.8 : 0.2;
  if (w <= 7) return 0.5;
  return maxTier === 3 ? 0.2 : 0.8;
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
): { char: string; general: string; w: number }[] {
  const needed = new Set(pendingPartnerChars(orphanChars, trayCharsAlready));
  const owned = new Set([...ownedChars, ...orphanChars, ...trayCharsAlready]);

  const entries: { char: string; general: string; w: number }[] = [];
  const seen = new Set<string>();

  for (const g of GENERALS) {
    const pw = phaseWeight(wave, g.maxTier);
    let familyPenalty = 1;
    if (g.maxTier === 3 && activeMax5Families?.has(g.family)) {
      familyPenalty = FAMILY_MAX5_ACTIVE_T3_PENALTY;
    }
    for (const c of g.chars) {
      if (isCharDrawBlocked(c, trayCharsAlready, fieldCharCounts)) continue;
      const base = g.weight * pw;
      const isPartner = needed.has(c);
      // 配对最优先；无配对时偏向满5 高级字
      let mult = isPartner ? PARTNER_BOOST : g.maxTier === 5 ? HIGH_TIER_BIAS * tier5BiasMul : LOW_TIER_BIAS;
      const count = charCountOf(charCounts, c);
      if (!isPartner && count > 0) {
        // 出现次数越多，后续再抽到的概率越低
        mult *= OCCURRENCE_DECAY ** count;
      } else if (owned.has(c) && !isPartner) {
        mult *= DUP_WEIGHT;
      }
      mult *= familyPenalty;
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
  );
}

/**
 * 抽一张字牌。
 * - forcePartner：只从仍缺的配对字中抽
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
  if (forcePartner) {
    const need = pendingPartnerChars(orphanChars, trayCharsAlready).filter(
      (c) => !isCharDrawBlocked(c, trayCharsAlready, fieldCharCounts),
    );
    if (need.length > 0) {
      const char = rng.pick(need);
      return { char, general: hintGeneralForChar(char) };
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
