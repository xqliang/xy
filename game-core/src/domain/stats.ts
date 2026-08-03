import type { UnitStat, UnitType } from './types';
import { UNITS, TIER_COEFFICIENTS, MAX_TIER } from '../config/units';

// 某兵种在某阶的属性：ATK/FRQ 按成长系数缩放，RGE/目标数固定
export function getUnitStat(type: UnitType, tier: number): UnitStat {
  if (tier < 1 || tier > MAX_TIER) {
    throw new RangeError(`阶数 ${tier} 超出范围 1-${MAX_TIER}`);
  }
  const cfg = UNITS[type];
  const coeff = TIER_COEFFICIENTS[tier - 1]!;
  return {
    atk: cfg.baseAtk * coeff,
    frq: cfg.baseFrq * coeff,
    rge: cfg.rge,
    targets: cfg.targets,
  };
}

// POW塔 = ATK × FRQ × RGE × 目标数（单位时间覆盖伤害）
export function towerPOW(type: UnitType, tier: number): number {
  const s = getUnitStat(type, tier);
  return s.atk * s.frq * s.rge * s.targets;
}
