import type { UnitConfig, UnitType } from '../domain/types';

export const MAX_TIER = 5;

// 逐阶增幅：2阶+50%、3阶+40%、4阶+30%、5阶+20%（边际收益递减）
export const TIER_GROWTH_INCREMENTS = [0.5, 0.4, 0.3, 0.2] as const;

// 成长系数链：1阶=1.0，逐阶累乘 → [1.0, 1.5, 2.1, 2.73, 3.276]
// 注：原文 5 阶写作 3.28 为四舍五入；用 3.276 才能还原 5 阶 骑=6.55、刀=9.83。
export const TIER_COEFFICIENTS: number[] = (() => {
  const coeffs = [1.0];
  for (const inc of TIER_GROWTH_INCREMENTS) {
    coeffs.push(coeffs[coeffs.length - 1]! * (1 + inc));
  }
  return coeffs;
})();

// 基础攻速：四兵种统一，且使 5 阶攻速 = BASE_FRQ × 3.276 ≈ 4.09
export const BASE_FRQ = 4.09 / TIER_COEFFICIENTS[4]!;

export const UNITS: Record<UnitType, UnitConfig> = {
  monkey:  { type: 'monkey',  name: '棍猴',    origin: '刀', role: '近战单体·收割', baseAtk: 3, baseFrq: BASE_FRQ, rge: 1,   targets: 1 },
  spear:   { type: 'spear',   name: '枪天兵',  origin: '枪', role: '中距穿刺',       baseAtk: 2, baseFrq: BASE_FRQ, rge: 2,   targets: 1.5 },
  cavalry: { type: 'cavalry', name: '天马骑兵', origin: '骑', role: '近战 AOE 冲锋',  baseAtk: 2, baseFrq: BASE_FRQ, rge: 1.5, targets: 2 },
  archer:  { type: 'archer',  name: '神箭手',  origin: '弓', role: '远程单点',       baseAtk: 2, baseFrq: BASE_FRQ, rge: 3,   targets: 1 },
};
