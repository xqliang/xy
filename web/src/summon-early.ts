/** 前期征兵字/铲配额（按「征兵时所在波次」累计，不含开局赠铲） */

export interface EarlySummonCounts {
  /** 波 ≤ earlyWordCapWave 期间征兵抽出的字牌数 */
  wordsInCapWindow: number;
  /** 波 ≤ earlyWordGuaranteeWave 期间征兵抽出的字牌数 */
  wordsInGuaranteeWindow: number;
  /** 波 ≤ earlyShovelWave 期间征兵抽出的铲子数 */
  shovelsInWindow: number;
}

export interface EarlySummonTuning {
  earlyWordCapWave: number;
  earlyWordCap: number;
  earlyWordGuaranteeWave: number;
  earlyWordGuarantee: number;
  earlyShovelWave: number;
  earlyShovelMin: number;
  earlyShovelMax: number;
}

export interface EarlySummonGates {
  /** 本盘铲子槽上限；null 表示不额外限制（仍受 maxPerKey） */
  maxShovels: number | null;
  /** 未达前期铲下限时强制出铲 */
  forceShovel: boolean;
  /** 本盘最多转几个字；0 = 禁字（含保底/半对） */
  maxWords: number;
  /** 保底波仍无字时强制出字 */
  forceWord: boolean;
}

export function earlySummonGates(wave: number, counts: EarlySummonCounts, t: EarlySummonTuning): EarlySummonGates {
  const w = Math.max(1, wave);

  let maxShovels: number | null = null;
  let forceShovel = false;
  if (w <= t.earlyShovelWave) {
    maxShovels = Math.max(0, t.earlyShovelMax - counts.shovelsInWindow);
    forceShovel = counts.shovelsInWindow < t.earlyShovelMin && maxShovels > 0;
  }

  // 默认不限制字数；上限窗内按剩余额度
  let maxWords = 99;
  if (w <= t.earlyWordCapWave) {
    maxWords = Math.max(0, t.earlyWordCap - counts.wordsInCapWindow);
  }

  // 恰在保底波、窗口内累计仍不足、且本盘还允许出字 → 强制
  const forceWord =
    w === t.earlyWordGuaranteeWave
    && counts.wordsInGuaranteeWindow < t.earlyWordGuarantee
    && maxWords > 0;

  return { maxShovels, forceShovel, maxWords, forceWord };
}
