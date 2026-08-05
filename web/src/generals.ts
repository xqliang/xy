// 武将系统配置。对齐竞品武将体系：
//  1) 征兵有概率产出「字牌」，凑齐同一武将的两个字 → 召唤该武将（占棋盘两格）
//  2) 五阶品质：白/绿/蓝/紫/橙，两张同名同阶武将合成升一阶
//  3) 定位：输出 / 控制 / 辅助 / 过渡；强度梯队 T0(三核) / T1(核心) / T2(过渡)
//  4) 羁绊：悟空(主角)上场即激活「大圣护法」，全队攻击提升（对应竞品 赵云+阿斗 羁绊）
//
// 数值自洽：武将 ATK/FRQ 沿用文章兵种成长系数 [1.0,1.5,2.1,2.73,3.276] 逐阶缩放，
// POW = ATK×FRQ×RGE×目标数。白阶 POW 约 18~26，橙阶约 60~90。
// 武将占两格，其"每格战力"仍低于满阶兵(80.4/格)，故不破坏兵种终局强度。
import { TIER_COEFFICIENTS, MAX_TIER } from '@core';

export type GeneralRole = '输出' | '控制' | '辅助' | '过渡';
export type GeneralTierRank = 'T0' | 'T1' | 'T2';
// burst=范围爆发 ranged=远程重击 stun=群体定身 knock=击退 slow=减速 heal=回复唐僧 none=无技能
export type GeneralSkill = 'burst' | 'ranged' | 'stun' | 'knock' | 'slow' | 'heal' | 'none';

export const QUALITY_NAMES = ['白', '绿', '蓝', '紫', '橙'] as const;
export const QUALITY_COLORS = ['#cfd3d8', '#7ec46a', '#4a9be0', '#a86ad0', '#e8912c'] as const;

export function qualityName(tier: number): string {
  return QUALITY_NAMES[Math.max(0, Math.min(MAX_TIER - 1, tier - 1))]!;
}
export function qualityColor(tier: number): string {
  return QUALITY_COLORS[Math.max(0, Math.min(MAX_TIER - 1, tier - 1))]!;
}

export interface GeneralDef {
  id: string;
  name: string; // 双字名
  chars: [string, string];
  role: GeneralRole;
  rank: GeneralTierRank;
  skill: GeneralSkill;
  skillName: string;
  skillDesc: string;
  atk: number; // 白阶基础
  frq: number;
  rge: number;
  targets: number;
  skillCd: number; // 秒；0 = 无技能
  weight: number; // 字牌掉落权重（越小越稀有）
  asset: string;
}

export const GENERALS: GeneralDef[] = [
  // ——— T0 三核（必练）———
  // 对应「黄忠」：远程 AOE 清场天花板
  { id: 'nezha', name: '哪吒', chars: ['哪', '吒'], role: '输出', rank: 'T0', skill: 'ranged',
    skillName: '火尖枪·万火齐发', skillDesc: '超远范围爆发并灼烧', atk: 4.0, frq: 1.5, rge: 3.5, targets: 1.5, skillCd: 9, weight: 1, asset: 'hero-nezha' },
  // 对应「赵云」：近战突进贯穿，全能副C（本作主角）
  { id: 'wukong', name: '悟空', chars: ['悟', '空'], role: '输出', rank: 'T0', skill: 'burst',
    skillName: '七十二变·横扫', skillDesc: '大范围贯穿爆发', atk: 3.4, frq: 1.6, rge: 2.2, targets: 2, skillCd: 8, weight: 1, asset: 'hero-wukong' },
  // 对应「张飞」：群体强控核心
  { id: 'bajie', name: '八戒', chars: ['八', '戒'], role: '控制', rank: 'T0', skill: 'stun',
    skillName: '钉耙震地', skillDesc: '大范围长时间定身', atk: 3.4, frq: 1.2, rge: 2, targets: 3, skillCd: 10, weight: 1, asset: 'hero-bajie' },

  // ——— T1 核心辅助 / 副C ———
  // 对应「刘备」：群体控制 + 治疗
  { id: 'guanyin', name: '观音', chars: ['观', '音'], role: '辅助', rank: 'T1', skill: 'heal',
    skillName: '甘露·净瓶', skillDesc: '减速来敌并为唐僧续命', atk: 2.2, frq: 1.4, rge: 3, targets: 2, skillCd: 12, weight: 2, asset: 'hero-guanyin' },
  // 对应「关羽」：长刀横扫，范围 + 击退
  { id: 'shaseng', name: '沙僧', chars: ['沙', '僧'], role: '控制', rank: 'T1', skill: 'knock',
    skillName: '降妖宝杖', skillDesc: '横扫并击退来敌', atk: 3.2, frq: 1.3, rge: 2.4, targets: 2, skillCd: 9, weight: 2, asset: 'hero-shaseng' },
  { id: 'erlang', name: '二郎', chars: ['二', '郎'], role: '输出', rank: 'T1', skill: 'ranged',
    skillName: '天眼诛邪', skillDesc: '远距穿透重击', atk: 3.8, frq: 1.5, rge: 3, targets: 1.5, skillCd: 9, weight: 2, asset: 'hero-erlang' },
  { id: 'honghaier', name: '红孩', chars: ['红', '孩'], role: '输出', rank: 'T1', skill: 'burst',
    skillName: '三昧真火', skillDesc: '范围灼烧爆发', atk: 3.0, frq: 1.6, rge: 2.2, targets: 2, skillCd: 8, weight: 2, asset: 'hero-honghaier' },
  { id: 'tieshan', name: '铁扇', chars: ['铁', '扇'], role: '控制', rank: 'T1', skill: 'stun',
    skillName: '芭蕉扇·狂风', skillDesc: '狂风定住来敌', atk: 2.8, frq: 1.4, rge: 2.5, targets: 2, skillCd: 10, weight: 2, asset: 'hero-tieshan' },
  { id: 'niumowang', name: '牛魔', chars: ['牛', '魔'], role: '控制', rank: 'T1', skill: 'knock',
    skillName: '蛮牛冲撞', skillDesc: '近身重创并击退', atk: 4.8, frq: 1.0, rge: 1.5, targets: 2, skillCd: 10, weight: 2, asset: 'hero-niumowang' },

  // ——— T2 过渡 / 替补 ———
  // 对应「马超」：单体刮痧，前期过渡
  { id: 'baigujing', name: '白骨', chars: ['白', '骨'], role: '过渡', rank: 'T2', skill: 'slow',
    skillName: '骨雾', skillDesc: '小范围减速（前期过渡）', atk: 2.8, frq: 1.3, rge: 2, targets: 1, skillCd: 11, weight: 3, asset: 'hero-baigujing' },
  { id: 'tangseng', name: '御弟', chars: ['御', '弟'], role: '过渡', rank: 'T2', skill: 'slow',
    skillName: '诵经', skillDesc: '迟滞来敌（前期过渡）', atk: 2.0, frq: 1.4, rge: 2.5, targets: 1.5, skillCd: 11, weight: 3, asset: 'hero-tangseng-hero' },
  // 对应「黄盖」：无专属技能，纯过渡
  { id: 'mile', name: '弥勒', chars: ['弥', '勒'], role: '过渡', rank: 'T2', skill: 'none',
    skillName: '—', skillDesc: '无专属技能（新手过渡）', atk: 3.0, frq: 1.3, rge: 2, targets: 1.5, skillCd: 0, weight: 3, asset: 'hero-mile' },
];

export function generalById(id: string): GeneralDef | undefined {
  return GENERALS.find((g) => g.id === id);
}

// 某阶武将实际属性（atk/frq 按成长系数缩放；rge/目标数固定）
export function generalStat(def: GeneralDef, tier: number): { atk: number; frq: number; rge: number; targets: number } {
  const coeff = TIER_COEFFICIENTS[Math.max(0, Math.min(MAX_TIER - 1, tier - 1))]!;
  return { atk: def.atk * coeff, frq: def.frq * coeff, rge: def.rge, targets: def.targets };
}

export function generalPOW(def: GeneralDef, tier: number): number {
  const s = generalStat(def, tier);
  return s.atk * s.frq * s.rge * s.targets;
}

// 羁绊：悟空上场 → 全队攻击 +12%（对应竞品 赵云+阿斗 羁绊）
export const BOND_GENERAL = 'wukong';
export const BOND_NAME = '大圣护法';
export const BOND_ATK_BONUS = 0.12;

// 字牌掉落池（按 weight 展开，权重越小越稀有）
export const WORD_POOL: { char: string; general: string }[] = GENERALS.flatMap((g) =>
  g.chars.flatMap((c) => Array.from({ length: g.weight }, () => ({ char: c, general: g.id }))),
);

// —— 大招（复用 skillCd 定期触发）——
// 类型按 skill 派生：远程单点(ranged) = 暴击(单体高倍 + 飘「暴击!」)，其余 = 群攻(范围结算)。
export type UltType = 'aoe' | 'crit';

export function ultTypeOf(def: GeneralDef): UltType {
  return def.skill === 'ranged' ? 'crit' : 'aoe';
}

// 暴击英雄大招在其单体基础倍数上再乘的倍率（初版，后续用 tools/sweep*.mjs 复核平衡）
export const CRIT_MULT = 1.5;
