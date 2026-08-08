// 武将系统配置。门派共享字 + 满级差（满5/满3）+ 攻击方式区分。
//  1) 征兵产出字牌；左右紧邻且匹配某武将 chars 序对 → 激活
//  2) 品质阶上限按武将 maxTier（3 或 5）；单字不可互相合并
//  3) 同门派共享一字，便于激活时继承对齐
import { TIER_COEFFICIENTS, MAX_TIER } from '@core';

export type GeneralRole = '输出' | '控制' | '辅助' | '过渡';
export type GeneralTierRank = 'T0' | 'T1' | 'T2';
// burst=范围爆发 ranged=远程重击 stun=群体定身 knock=击退 slow=减速 heal=回复 none=无技能
export type GeneralSkill = 'burst' | 'ranged' | 'stun' | 'knock' | 'slow' | 'heal' | 'none';

export const QUALITY_NAMES = ['白', '绿', '蓝', '紫', '橙'] as const;
// 白阶用纯白（一级英雄名）；其后绿/蓝/紫/橙
export const QUALITY_COLORS = ['#ffffff', '#7ec46a', '#4a9be0', '#a86ad0', '#e8912c'] as const;

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
  weight: number; // 基础掉落权重（越小越稀有）；满5偏小、满3偏大
  asset: string;
  maxTier: 3 | 5;
  atkStyle: string;
  family: string; // 门派共享字
}

export const GENERALS: GeneralDef[] = [
  // ——— 大：快攻贯穿 ———
  { id: 'dasheng', name: '大圣', chars: ['大', '圣'], role: '输出', rank: 'T0', skill: 'burst',
    skillName: '七十二变·横扫', skillDesc: '大范围贯穿爆发', atk: 3.4, frq: 1.6, rge: 2.5, targets: 2, skillCd: 8, weight: 1, asset: 'hero-wukong',
    maxTier: 5, atkStyle: '快攻贯穿', family: '大' },
  { id: 'damang', name: '大蟒', chars: ['大', '蟒'], role: '过渡', rank: 'T2', skill: 'burst',
    skillName: '钉耙小扫', skillDesc: '小范围贯穿（过渡）', atk: 2.4, frq: 1.4, rge: 2, targets: 1.5, skillCd: 10, weight: 3, asset: 'hero-bajie',
    maxTier: 3, atkStyle: '快攻贯穿', family: '大' },

  // ——— 郎：远程暴击 ———
  { id: 'erlang', name: '二郎', chars: ['二', '郎'], role: '输出', rank: 'T1', skill: 'ranged',
    skillName: '天眼诛邪', skillDesc: '远距穿透重击', atk: 3.8, frq: 1.5, rge: 3, targets: 1.5, skillCd: 9, weight: 1, asset: 'hero-erlang',
    maxTier: 5, atkStyle: '远程暴击', family: '郎' },
  { id: 'niulang', name: '牛郎', chars: ['牛', '郎'], role: '过渡', rank: 'T2', skill: 'ranged',
    skillName: '织云箭', skillDesc: '单体远距轻击（过渡）', atk: 2.6, frq: 1.3, rge: 2.5, targets: 1, skillCd: 11, weight: 3, asset: 'hero-erlang',
    maxTier: 3, atkStyle: '远程暴击', family: '郎' },

  // ——— 吒：远程清场 ———
  { id: 'nezha', name: '哪吒', chars: ['哪', '吒'], role: '输出', rank: 'T0', skill: 'burst',
    skillName: '火尖枪·万火齐发', skillDesc: '超远范围爆发并灼烧', atk: 4.0, frq: 1.5, rge: 3.5, targets: 1.5, skillCd: 9, weight: 1, asset: 'hero-nezha',
    maxTier: 5, atkStyle: '远程清场', family: '吒' },
  { id: 'jinzha', name: '金吒', chars: ['金', '吒'], role: '过渡', rank: 'T2', skill: 'burst',
    skillName: '砍妖刀', skillDesc: '小范围火焰（过渡）', atk: 2.8, frq: 1.3, rge: 2.5, targets: 1.5, skillCd: 11, weight: 3, asset: 'hero-nezha',
    maxTier: 3, atkStyle: '远程清场', family: '吒' },

  // ——— 红：范围灼烧 ———
  { id: 'honghaier', name: '红孩', chars: ['红', '孩'], role: '输出', rank: 'T1', skill: 'burst',
    skillName: '三昧真火', skillDesc: '范围灼烧爆发', atk: 3.0, frq: 1.6, rge: 2.5, targets: 2, skillCd: 8, weight: 1, asset: 'hero-honghaier',
    maxTier: 5, atkStyle: '范围灼烧', family: '红' },
  { id: 'hongpao', name: '红袍', chars: ['红', '袍'], role: '过渡', rank: 'T2', skill: 'burst',
    skillName: '赤焰', skillDesc: '小范围灼烧（过渡）', atk: 2.2, frq: 1.4, rge: 2, targets: 1.5, skillCd: 10, weight: 3, asset: 'hero-honghaier',
    maxTier: 3, atkStyle: '范围灼烧', family: '红' },

  // ——— 戒：定身控制 ———
  { id: 'bajie', name: '八戒', chars: ['八', '戒'], role: '控制', rank: 'T0', skill: 'stun',
    skillName: '钉耙震地', skillDesc: '大范围长时间定身', atk: 3.4, frq: 1.2, rge: 2, targets: 3, skillCd: 10, weight: 1, asset: 'hero-bajie',
    maxTier: 5, atkStyle: '定身控制', family: '戒' },
  { id: 'xiaojie', name: '小戒', chars: ['小', '戒'], role: '过渡', rank: 'T2', skill: 'stun',
    skillName: '短耙震地', skillDesc: '小范围短定身（过渡）', atk: 2.4, frq: 1.1, rge: 1.5, targets: 2, skillCd: 12, weight: 3, asset: 'hero-bajie',
    maxTier: 3, atkStyle: '定身控制', family: '戒' },

  // ——— 牛：冲撞击晕 ———
  { id: 'niumowang', name: '牛魔', chars: ['牛', '魔'], role: '控制', rank: 'T1', skill: 'stun',
    skillName: '蛮牛冲撞', skillDesc: '近身重创并短晕', atk: 4.8, frq: 1.0, rge: 1.5, targets: 2, skillCd: 10, weight: 1, asset: 'hero-niumowang',
    maxTier: 5, atkStyle: '冲撞击晕', family: '牛' },
  { id: 'qingniu', name: '青牛', chars: ['青', '牛'], role: '过渡', rank: 'T2', skill: 'stun',
    skillName: '牛角顶', skillDesc: '短距撞击轻晕（过渡）', atk: 3.2, frq: 1.0, rge: 1.5, targets: 1.5, skillCd: 12, weight: 3, asset: 'hero-niumowang',
    maxTier: 3, atkStyle: '冲撞击晕', family: '牛' },

  // ——— 铁：狂风击退 ———
  { id: 'tieshan', name: '铁扇', chars: ['铁', '扇'], role: '控制', rank: 'T1', skill: 'knock',
    skillName: '芭蕉扇·狂风', skillDesc: '狂风群体击退', atk: 2.8, frq: 1.4, rge: 2.5, targets: 2, skillCd: 10, weight: 1, asset: 'hero-tieshan',
    maxTier: 5, atkStyle: '狂风击退', family: '铁' },
  { id: 'tiebei', name: '铁背', chars: ['铁', '背'], role: '过渡', rank: 'T2', skill: 'knock',
    skillName: '铁背开山', skillDesc: '小范围击退（过渡）', atk: 2.2, frq: 1.2, rge: 2.0, targets: 1.5, skillCd: 12, weight: 3, asset: 'hero-tieshan',
    maxTier: 3, atkStyle: '狂风击退', family: '铁' },

  // ——— 沙：杖扫击退 ———
  { id: 'shaseng', name: '沙僧', chars: ['沙', '僧'], role: '控制', rank: 'T1', skill: 'knock',
    skillName: '降妖宝杖', skillDesc: '横扫伤害并轻击退', atk: 3.2, frq: 1.3, rge: 2.5, targets: 2, skillCd: 9, weight: 1, asset: 'hero-shaseng',
    maxTier: 5, atkStyle: '杖扫击退', family: '沙' },
  { id: 'liusha', name: '流沙', chars: ['流', '沙'], role: '过渡', rank: 'T2', skill: 'knock',
    skillName: '流沙涌', skillDesc: '短距轻击退（过渡）', atk: 2.2, frq: 1.2, rge: 2, targets: 1.5, skillCd: 11, weight: 3, asset: 'hero-shaseng',
    maxTier: 3, atkStyle: '杖扫击退', family: '沙' },

  // ——— 白：单体突进 ———
  { id: 'bailong', name: '白龙', chars: ['白', '龙'], role: '输出', rank: 'T1', skill: 'slow',
    skillName: '龙牙突进', skillDesc: '单体突进撕咬', atk: 3.6, frq: 1.4, rge: 2.5, targets: 1, skillCd: 9, weight: 1, asset: 'hero-baigujing',
    maxTier: 5, atkStyle: '单体突进', family: '白' },
  { id: 'baigujing', name: '白骨', chars: ['白', '骨'], role: '过渡', rank: 'T2', skill: 'slow',
    skillName: '骨雾', skillDesc: '单体减速（前期过渡）', atk: 2.8, frq: 1.3, rge: 2, targets: 1, skillCd: 11, weight: 3, asset: 'hero-baigujing',
    maxTier: 3, atkStyle: '单体突进', family: '白' },

  // ——— 音：辅助治疗 ———
  { id: 'guanyin', name: '观音', chars: ['观', '音'], role: '辅助', rank: 'T1', skill: 'heal',
    skillName: '甘露·净瓶', skillDesc: '减速来敌并为唐僧续命', atk: 2.2, frq: 1.4, rge: 3, targets: 2, skillCd: 12, weight: 1, asset: 'hero-guanyin',
    maxTier: 5, atkStyle: '辅助治疗', family: '音' },
  { id: 'fanyin', name: '梵音', chars: ['梵', '音'], role: '过渡', rank: 'T2', skill: 'heal',
    skillName: '梵音浅润', skillDesc: '弱减速与微量续命（过渡）', atk: 1.6, frq: 1.2, rge: 2.5, targets: 1.5, skillCd: 14, weight: 3, asset: 'hero-guanyin',
    maxTier: 3, atkStyle: '辅助治疗', family: '音' },
];

export function generalById(id: string): GeneralDef | undefined {
  return GENERALS.find((g) => g.id === id);
}

/** 左字+右字按序匹配武将（「郎二」不匹配二郎） */
export function matchGeneral(leftChar: string, rightChar: string): GeneralDef | undefined {
  return GENERALS.find((g) => g.chars[0] === leftChar && g.chars[1] === rightChar);
}

/** 含该字的全部武将 */
export function generalsWithChar(char: string): GeneralDef[] {
  return GENERALS.filter((g) => g.chars[0] === char || g.chars[1] === char);
}

/** 抽字时的提示武将 id：优先满5 */
export function hintGeneralForChar(char: string): string {
  const gs = generalsWithChar(char);
  const pref = gs.find((g) => g.maxTier === 5) ?? gs[0];
  return pref?.id ?? '';
}

/** 可与该字组成武将的另一侧字（去重） */
export function partnerChars(char: string): string[] {
  const out = new Set<string>();
  for (const g of generalsWithChar(char)) {
    if (g.chars[0] === char) out.add(g.chars[1]);
    if (g.chars[1] === char) out.add(g.chars[0]);
  }
  return [...out];
}

/** 字牌品质阶上限：取含该字的武将中较高 maxTier（共享字可升到 5，再由激活武将封顶） */
export function maxTierForChar(char: string): number {
  const gs = generalsWithChar(char);
  if (gs.length === 0) return MAX_TIER;
  return Math.max(...gs.map((g) => g.maxTier));
}

// 某阶武将实际属性（atk/frq 按成长系数缩放；rge/目标数固定）
export function generalStat(def: GeneralDef, tier: number): { atk: number; frq: number; rge: number; targets: number } {
  const cap = Math.min(MAX_TIER, def.maxTier);
  const coeff = TIER_COEFFICIENTS[Math.max(0, Math.min(cap - 1, tier - 1))]!;
  return { atk: def.atk * coeff, frq: def.frq * coeff, rge: def.rge, targets: def.targets };
}

export function generalPOW(def: GeneralDef, tier: number): number {
  const s = generalStat(def, tier);
  return s.atk * s.frq * s.rge * s.targets;
}

// 羁绊：大圣上场 → 全队攻击 +12%
export const BOND_GENERAL = 'dasheng';
export const BOND_NAME = '大圣护法';
export const BOND_ATK_BONUS = 0.12;

// 字牌掉落基础池（按 weight 展开）；实际抽字见 word-draw.ts（阶段权重 + 孤儿）
export const WORD_POOL: { char: string; general: string }[] = GENERALS.flatMap((g) =>
  g.chars.flatMap((c) => Array.from({ length: g.weight }, () => ({ char: c, general: g.id }))),
);

// —— 大招（复用 skillCd 定期触发）——
export type UltType = 'aoe' | 'crit';

export function ultTypeOf(def: GeneralDef): UltType {
  return def.skill === 'ranged' ? 'crit' : 'aoe';
}

/** 普攻特效时长：高阶更慢一拍、更有存在感（可按英雄微调 base） */
const HERO_FX_TTL_BASE: Partial<Record<string, number>> = {
  dasheng: 0.58,
  tieshan: 0.44,
  liusha: 0.4,
  nezha: 0.38,
  niumowang: 0.36,
};

export function heroAttackFxTtl(def: GeneralDef, tier: number): number {
  const s = 0.55 + 0.45 * ((tier - 1) / Math.max(1, def.maxTier - 1));
  const base = HERO_FX_TTL_BASE[def.id] ?? 0.34;
  return base + (tier - 1) * 0.055 * s;
}

export const CRIT_MULT = 1.5;
