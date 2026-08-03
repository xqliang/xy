// 伤害 = ATK（或 ATK − DEF）。单一乘区，无暴击/增伤/抗性；结果不为负。
export function damage(atk: number, def = 0): number {
  return Math.max(0, atk - def);
}

// POW怪 = HP × 移动速度
export function monsterPOW(hp: number, spd: number): number {
  return hp * spd;
}

// 当 POW塔 ≥ POW怪 时，理论上可拦截
export function canIntercept(towerPow: number, monsterPow: number): boolean {
  return towerPow >= monsterPow;
}
