// 武将字牌抽取：阶段权重（前期满3 / 后期满5）+ 孤儿补缺 + 半对保底
// 优先级：配对字 > 不重复 > 高级（满5）
import { GENERALS, hintGeneralForChar, partnerChars, type GeneralDef } from './generals';

export const PAIR_PITY_AFTER = 4;

/** 非配对时：已拥有字的权重倍率（尽量不重复） */
export const DUP_WEIGHT = 0.04;
/** 配对字相对基础权重的倍率 */
export const PARTNER_BOOST = 12;
/** 无配对需求时，满5 相对满3 的额外倍率（叠在 phaseWeight 之上） */
export const HIGH_TIER_BIAS = 1.75;
export const LOW_TIER_BIAS = 0.65;

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

function buildWeightedEntries(
  wave: number,
  orphanChars: string[],
  trayCharsAlready: string[],
  ownedChars: string[],
): { char: string; general: string; w: number }[] {
  const needed = new Set(pendingPartnerChars(orphanChars, trayCharsAlready));
  const owned = new Set([...ownedChars, ...orphanChars, ...trayCharsAlready]);

  const entries: { char: string; general: string; w: number }[] = [];
  const seen = new Set<string>();

  for (const g of GENERALS) {
    const pw = phaseWeight(wave, g.maxTier);
    for (const c of g.chars) {
      const base = g.weight * pw;
      const isPartner = needed.has(c);
      // 配对最优先；无配对时偏向满5 高级字
      let mult = isPartner ? PARTNER_BOOST : g.maxTier === 5 ? HIGH_TIER_BIAS : LOW_TIER_BIAS;
      // 已有字尽量不重复（配对缺口本身不会在 tray 里，owned 里的孤儿字也不该再抽）
      if (owned.has(c) && !isPartner) mult *= DUP_WEIGHT;
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

/**
 * 抽一张字牌。
 * - forcePartner：只从仍缺的配对字中抽
 * - 否则：配对加权 ≫ 不重复的高级字 ≫ 重复字（接近不抽）
 * - ownedChars：棋盘已有字（含已激活），用于去重
 */
export function pickWordChar(
  rng: Rng,
  wave: number,
  orphanChars: string[],
  trayCharsAlready: string[],
  forcePartner: boolean,
  ownedChars: string[] = [],
): WordPick {
  if (forcePartner) {
    const need = pendingPartnerChars(orphanChars, trayCharsAlready);
    if (need.length > 0) {
      const char = rng.pick(need);
      return { char, general: hintGeneralForChar(char) };
    }
  }
  return pickFromWeighted(rng, buildWeightedEntries(wave, orphanChars, trayCharsAlready, ownedChars));
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
