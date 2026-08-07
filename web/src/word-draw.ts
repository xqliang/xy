// 武将字牌抽取：阶段权重（前期满3 / 后期满5）+ 孤儿补缺 + 半对保底
import { GENERALS, hintGeneralForChar, partnerChars, type GeneralDef } from './generals';

export const PAIR_PITY_AFTER = 4;

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
): { char: string; general: string; w: number }[] {
  const needed = new Set(neededPartnerChars(orphanChars));
  // 同盘协同：已抽出的字也产生配对需求
  for (const c of trayCharsAlready) {
    for (const p of partnerChars(c)) needed.add(p);
  }

  const entries: { char: string; general: string; w: number }[] = [];
  const seen = new Set<string>(); // char 去重：同一字只进一次，权重取各武将贡献之和

  for (const g of GENERALS) {
    const pw = phaseWeight(wave, g.maxTier);
    for (const c of g.chars) {
      const base = g.weight * pw;
      const orphanBoost = needed.has(c) ? 4 : 1;
      const key = c;
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({ char: c, general: hintGeneralForChar(c), w: base * orphanBoost });
      } else {
        const e = entries.find((x) => x.char === key)!;
        e.w += base * orphanBoost;
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

/** 抽一张字牌；forcePartner=true 时只从孤儿所需配对字中抽 */
export function pickWordChar(
  rng: Rng,
  wave: number,
  orphanChars: string[],
  trayCharsAlready: string[],
  forcePartner: boolean,
): WordPick {
  if (forcePartner) {
    const need = neededPartnerChars(orphanChars);
    if (need.length > 0) {
      const char = rng.pick(need);
      return { char, general: hintGeneralForChar(char) };
    }
  }
  return pickFromWeighted(rng, buildWeightedEntries(wave, orphanChars, trayCharsAlready));
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
