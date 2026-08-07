// 四类基础兵种（西游披皮 → 原作对应）
// dao=刀兵(刀) / spear=枪天兵(枪) / cavalry=天马骑兵(骑) / archer=神箭手(弓)
export type UnitType = 'dao' | 'spear' | 'cavalry' | 'archer';

export interface UnitConfig {
  type: UnitType;
  name: string;    // 中文名
  origin: string;  // 原作对应兵种
  role: string;    // 战术定位
  baseAtk: number; // 1 阶攻击力
  baseFrq: number; // 1 阶攻速（次/秒）
  rge: number;     // 攻击范围
  targets: number; // 平均攻击目标数
}

export interface UnitStat {
  atk: number;
  frq: number;
  rge: number;
  targets: number;
}

export interface Unit {
  type: UnitType;
  tier: number; // 1..MAX_TIER
}
