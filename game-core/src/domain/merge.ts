import type { Unit } from './types';
import { MAX_TIER } from '../config/units';

// 两单位可合成：同类型、同等级、且未满级
export function canMerge(a: Unit, b: Unit): boolean {
  return a.type === b.type && a.tier === b.tier && a.tier < MAX_TIER;
}

// 合成为同型高一阶单位
export function merge(a: Unit, b: Unit): Unit {
  if (!canMerge(a, b)) {
    throw new Error('无法合成：需同型、同级且未满级');
  }
  return { type: a.type, tier: a.tier + 1 };
}
