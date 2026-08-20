// 武将系统配置。门派共享字 + 满级差（满5/满3）+ 攻击方式区分。
//  1) 征兵产出字牌；左右紧邻且匹配某武将 chars 序对 → 激活
//  2) 品质阶上限按武将 maxTier（3 或 5）；单字不可互相合并
//  3) 同门派共享一字，便于激活时继承对齐
import { TIER_COEFFICIENTS, MAX_TIER } from '@core';

export type GeneralRole = '输出' | '控制' | '辅助' | '过渡';
export type GeneralTierRank = 'T0' | 'T1' | 'T2';
// burst=范围爆发 ranged=远程重击 stun=群体定身 knock=击退 slow=减速 heal=回复 burn=灼烧(命中+持续掉血)
// buff=友军攻击增益 cdr=缩短友军大招CD none=无技能
export type GeneralSkill = 'burst' | 'ranged' | 'stun' | 'knock' | 'slow' | 'heal' | 'burn' | 'buff' | 'cdr' | 'none';

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
  /** 升阶经验需求倍率覆盖；缺省时按 `generalExpCostMul`（输出 1.3 / 控制 1.15 / 观音 1.05） */
  expCostMul?: number;
}

/** 武器位=输出 ×1.3；控制 ×1.15；观音 ×1.05；其余 ×1。显式 `expCostMul` 优先。 */
export function generalExpCostMul(
  def?: Pick<GeneralDef, 'id' | 'role' | 'expCostMul'> | null,
): number {
  if (def?.expCostMul != null) return def.expCostMul;
  if (!def) return 1;
  if (def.id === 'guanyin') return 1.05;
  if (def.role === '输出') return 1.3;
  if (def.role === '控制') return 1.15;
  return 1;
}

export const GENERALS: GeneralDef[] = [
  // ——— 大：快攻贯穿 ———
  { id: 'dasheng', name: '大圣', chars: ['大', '圣'], role: '输出', rank: 'T0', skill: 'burst',
    skillName: '七十二变·横扫', skillDesc: '大范围贯穿爆发', atk: 4.22, frq: 1.6, rge: 2.5, targets: 2, skillCd: 8, weight: 1, asset: 'hero-wukong',
    maxTier: 5, atkStyle: '快攻贯穿', family: '大' },
  { id: 'damang', name: '大蟒', chars: ['大', '蟒'], role: '过渡', rank: 'T2', skill: 'burst',
    skillName: '蟒影横扫', skillDesc: '小范围贯穿（过渡）', atk: 4.22, frq: 1.4, rge: 2, targets: 1.5, skillCd: 10, weight: 3, asset: 'hero-damang',
    maxTier: 3, atkStyle: '快攻贯穿', family: '大' },

  // ——— 郎：远程暴击 ———
  { id: 'erlang', name: '二郎', chars: ['二', '郎'], role: '输出', rank: 'T1', skill: 'ranged',
    skillName: '天眼诛邪', skillDesc: '远距穿透重击', atk: 5.58, frq: 1.5, rge: 3, targets: 1.5, skillCd: 9, weight: 1, asset: 'hero-erlang',
    maxTier: 5, atkStyle: '远程暴击', family: '郎' },
  { id: 'niulang', name: '牛郎', chars: ['牛', '郎'], role: '过渡', rank: 'T2', skill: 'ranged',
    skillName: '织云箭', skillDesc: '单体远距轻击（过渡）', atk: 5.58, frq: 1.3, rge: 2.5, targets: 1, skillCd: 11, weight: 3, asset: 'hero-niulang',
    maxTier: 3, atkStyle: '远程暴击', family: '郎' },

  // ——— 吒：远程清场 ———
  { id: 'nezha', name: '哪吒', chars: ['哪', '吒'], role: '输出', rank: 'T0', skill: 'burst',
    skillName: '火尖枪·万火齐发', skillDesc: '超远范围爆发', atk: 5.97, frq: 1.5, rge: 3.0, targets: 1.5, skillCd: 10, weight: 1, asset: 'hero-nezha',
    maxTier: 5, atkStyle: '远程清场', family: '吒' },
  { id: 'jinzha', name: '金吒', chars: ['金', '吒'], role: '过渡', rank: 'T2', skill: 'burst',
    skillName: '砍妖刀', skillDesc: '小范围火焰爆发（过渡）', atk: 3.73, frq: 1.3, rge: 2.5, targets: 1.5, skillCd: 11, weight: 3, asset: 'hero-jinzha',
    maxTier: 3, atkStyle: '远程清场', family: '吒' },

  // ——— 红：范围灼烧 ———
  { id: 'honghaier', name: '红孩', chars: ['红', '孩'], role: '输出', rank: 'T1', skill: 'burn',
    skillName: '三昧真火', skillDesc: '命中后持续灼烧掉血', atk: 4.22, frq: 1.6, rge: 2.5, targets: 2, skillCd: 9, weight: 1, asset: 'hero-honghaier',
    maxTier: 5, atkStyle: '范围灼烧', family: '红' },
  { id: 'hongpao', name: '红袍', chars: ['红', '袍'], role: '过渡', rank: 'T2', skill: 'burn',
    skillName: '赤焰', skillDesc: '命中后小范围灼烧（过渡）', atk: 4.22, frq: 1.4, rge: 2, targets: 1.5, skillCd: 10, weight: 3, asset: 'hero-hongpao',
    maxTier: 3, atkStyle: '范围灼烧', family: '红' },

  // ——— 八：定身控制 ———
  { id: 'bajie', name: '八戒', chars: ['八', '戒'], role: '控制', rank: 'T0', skill: 'stun',
    skillName: '钉耙震地', skillDesc: '大范围长时间定身并轻伤', atk: 3.86, frq: 1.2, rge: 2, targets: 3, skillCd: 10, weight: 1, asset: 'hero-bajie',
    maxTier: 5, atkStyle: '定身控制', family: '八' },
  { id: 'baxian', name: '八仙', chars: ['八', '仙'], role: '过渡', rank: 'T2', skill: 'stun',
    skillName: '仙缘定身', skillDesc: '小范围短定身并轻伤（过渡）', atk: 3.86, frq: 1.25, rge: 1.5, targets: 2, skillCd: 12, weight: 3, asset: 'hero-baxian',
    maxTier: 3, atkStyle: '定身控制', family: '八' },

  // ——— 牛：冲撞击晕 ———
  { id: 'niumowang', name: '牛魔', chars: ['牛', '魔'], role: '控制', rank: 'T1', skill: 'stun',
    skillName: '蛮牛冲撞', skillDesc: '近身重创并短晕', atk: 5.65, frq: 1.0, rge: 1.5, targets: 2, skillCd: 10, weight: 1, asset: 'hero-niumowang',
    maxTier: 5, atkStyle: '冲撞击晕', family: '牛' },
  { id: 'qingniu', name: '青牛', chars: ['青', '牛'], role: '过渡', rank: 'T2', skill: 'stun',
    skillName: '牛角顶', skillDesc: '短距撞击轻晕并轻伤（过渡）', atk: 5.65, frq: 1.15, rge: 1.5, targets: 1.5, skillCd: 12, weight: 3, asset: 'hero-qingniu',
    maxTier: 3, atkStyle: '冲撞击晕', family: '牛' },

  // ——— 铁：狂风击退 ———
  { id: 'tieshan', name: '铁扇', chars: ['铁', '扇'], role: '控制', rank: 'T1', skill: 'knock',
    skillName: '芭蕉扇·狂风', skillDesc: '狂风群体击退并轻伤', atk: 4.11, frq: 1.4, rge: 2.5, targets: 2, skillCd: 10, weight: 1, asset: 'hero-tieshan',
    maxTier: 5, atkStyle: '狂风击退', family: '铁' },
  { id: 'tiebei', name: '铁背', chars: ['铁', '背'], role: '过渡', rank: 'T2', skill: 'knock',
    skillName: '铁背开山', skillDesc: '小范围击退并轻伤（过渡）', atk: 4.11, frq: 1.2, rge: 2.0, targets: 1.5, skillCd: 12, weight: 3, asset: 'hero-tiebei',
    maxTier: 3, atkStyle: '狂风击退', family: '铁' },

  // ——— 沙：杖扫击退 ———
  { id: 'shaseng', name: '沙僧', chars: ['沙', '僧'], role: '控制', rank: 'T1', skill: 'knock',
    skillName: '降妖宝杖', skillDesc: '横扫伤害并轻击退', atk: 4.42, frq: 1.3, rge: 2.5, targets: 2, skillCd: 10, weight: 1, asset: 'hero-shaseng',
    maxTier: 5, atkStyle: '杖扫击退', family: '沙' },
  { id: 'liusha', name: '流沙', chars: ['流', '沙'], role: '过渡', rank: 'T2', skill: 'knock',
    skillName: '流沙涌', skillDesc: '短距轻击退并轻伤（过渡）', atk: 4.42, frq: 1.2, rge: 2, targets: 1.5, skillCd: 11, weight: 3, asset: 'hero-liusha',
    maxTier: 3, atkStyle: '杖扫击退', family: '沙' },

  // ——— 白：单体突进 ———
  { id: 'bailong', name: '白龙', chars: ['白', '龙'], role: '输出', rank: 'T1', skill: 'slow',
    skillName: '龙牙突进', skillDesc: '突进撕咬并减速', atk: 5.31, frq: 1.4, rge: 2.5, targets: 1.5, skillCd: 9, weight: 1, asset: 'hero-bailong',
    maxTier: 5, atkStyle: '单体突进', family: '白' },
  { id: 'baigujing', name: '白骨', chars: ['白', '骨'], role: '过渡', rank: 'T2', skill: 'slow',
    skillName: '骨雾', skillDesc: '减速并轻伤（前期过渡）', atk: 5.31, frq: 1.3, rge: 2, targets: 1, skillCd: 11, weight: 3, asset: 'hero-baigujing',
    maxTier: 3, atkStyle: '单体突进', family: '白' },

  // ——— 音：辅助治疗 ———
  { id: 'guanyin', name: '观音', chars: ['观', '音'], role: '辅助', rank: 'T1', skill: 'heal',
    skillName: '甘露·净瓶', skillDesc: '减速来敌并为唐僧续命', atk: 3.11, frq: 1.5, rge: 3, targets: 2, skillCd: 12, weight: 1, asset: 'hero-guanyin',
    maxTier: 5, atkStyle: '辅助治疗', family: '音' },
  { id: 'fanyin', name: '梵音', chars: ['梵', '音'], role: '过渡', rank: 'T2', skill: 'heal',
    skillName: '梵音浅润', skillDesc: '弱减速与微量续命（过渡）', atk: 3.11, frq: 1.3, rge: 2.5, targets: 1.5, skillCd: 14, weight: 3, asset: 'hero-fanyin',
    maxTier: 3, atkStyle: '辅助治疗', family: '音' },

  // ——— 君：炼丹增攻 ———
  { id: 'laojun', name: '老君', chars: ['老', '君'], role: '辅助', rank: 'T1', skill: 'buff',
    skillName: '炼丹·金丹', skillDesc: '短时提升全体武将与兵器攻击', atk: 3.33, frq: 1.4, rge: 2.5, targets: 2, skillCd: 13, weight: 1, asset: 'hero-laojun',
    maxTier: 5, atkStyle: '炼丹增攻', family: '君' },
  { id: 'danjun', name: '丹君', chars: ['丹', '君'], role: '过渡', rank: 'T2', skill: 'buff',
    skillName: '小还丹', skillDesc: '短时弱提升武将与兵器攻击（过渡）', atk: 3.33, frq: 1.2, rge: 2.0, targets: 1.5, skillCd: 15, weight: 3, asset: 'hero-danjun',
    maxTier: 3, atkStyle: '炼丹增攻', family: '君' },

  // ——— 殊：般若减 CD ———
  { id: 'wenshu', name: '文殊', chars: ['文', '殊'], role: '辅助', rank: 'T1', skill: 'cdr',
    skillName: '般若·慧剑', skillDesc: '缩短其他武将大招与兵器攻击剩余冷却', atk: 3.33, frq: 1.4, rge: 2.5, targets: 2, skillCd: 13, weight: 1, asset: 'hero-wenshu',
    maxTier: 5, atkStyle: '般若减CD', family: '殊' },
  { id: 'huishu', name: '慧殊', chars: ['慧', '殊'], role: '过渡', rank: 'T2', skill: 'cdr',
    skillName: '慧光浅照', skillDesc: '略缩短友军大招与兵器冷却（过渡）', atk: 3.33, frq: 1.2, rge: 2.0, targets: 1.5, skillCd: 15, weight: 3, asset: 'hero-huishu',
    maxTier: 3, atkStyle: '般若减CD', family: '殊' },
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

/** 信息面板展示用：含该字的满5优先，否则取 maxTier 最高者 */
export function primaryGeneralForChar(char: string): GeneralDef | undefined {
  const id = hintGeneralForChar(char);
  return id ? generalById(id) : undefined;
}

/** 两字按序匹配（任一侧为 char 即可） */
export function generalForPair(a: string, b: string): GeneralDef | undefined {
  return matchGeneral(a, b) ?? matchGeneral(b, a);
}

/** 配对字列表：可组成的武将 maxTier 高者在前 */
export function sortedPartnerChars(char: string): string[] {
  return partnerChars(char).sort((a, b) => {
    const ta = generalForPair(char, a)?.maxTier ?? 0;
    const tb = generalForPair(char, b)?.maxTier ?? 0;
    if (tb !== ta) return tb - ta;
    return a.localeCompare(b, 'zh');
  });
}

/** 未激活字牌底部提示（fromTray=true 时前缀为「候选区」） */
export function inactivePartnerHint(char: string, fromTray = false): string {
  const partners = sortedPartnerChars(char);
  const prefix = fromTray ? '候选区：' : '未激活：';
  if (partners.length === 0) return `${prefix}需配对字左右紧邻`;
  if (partners.length === 1) {
    return `${prefix}需「${partners[0]}」左右紧邻${fromTray ? '激活' : ''}`;
  }
  const listed = partners.map((p) => `「${p}」`).join('或');
  return `${prefix}需与${listed}字左右相邻`;
}

/** 门派内满 5 武将：char 为其非共享字（如 哪→哪吒） */
export function mainGeneralForVariantChar(char: string): GeneralDef | undefined {
  return GENERALS.find((g) => g.maxTier === 5 && g.chars.includes(char) && char !== g.family);
}

/** 同门派满 3 过渡武将 */
export function transitGeneralInFamily(family: string): GeneralDef | undefined {
  return GENERALS.find((g) => g.family === family && g.maxTier === 3);
}

/** 武将中非门派共享的那一字（如 金吒→金，哪吒→哪） */
export function variantChar(def: GeneralDef): string {
  return def.chars[0] === def.family ? def.chars[1]! : def.chars[0]!;
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

/** 某字可归属的武将数 → 场上该字实例数上限（如牛：牛郎/牛魔/青牛 → 3） */
export function charHeroCapacity(char: string): number {
  return generalsWithChar(char).length;
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

/** 满5且射程大（大圣/二郎/哪吒等）：布阵优先棋盘中部 */
export function isWideRangeMaxHero(def: GeneralDef, tier: number): boolean {
  return tier >= 5 && def.maxTier === 5 && def.role !== '控制' && def.rge >= 2.5;
}

/** 非远距武将贴出口优先级：控制满5 > 其他满5 > 控制满3 > 其他满级 */
export function heroEntranceBand(def: GeneralDef, tier: number): number {
  const atCap = tier >= def.maxTier;
  if (!atCap) return 0;
  if (def.maxTier === 5 && def.role === '控制') return 4;
  if (def.maxTier === 5) return 3;
  if (def.maxTier === 3 && def.role === '控制') return 2;
  return 1;
}

// 羁绊：大圣上场 → 全队攻击 +GENERAL_TUNING.BOND_ATK_BONUS
export const BOND_GENERAL = 'dasheng';
export const BOND_NAME = '大圣护法';

/** 武将战斗可调参数（DevTools 可改） */
export const GENERAL_TUNING = {
  CRIT_MULT: 1.5,
  BOND_ATK_BONUS: 0.05,
};

/** @deprecated 快照；运行时请读 GENERAL_TUNING.BOND_ATK_BONUS */
export const BOND_ATK_BONUS = GENERAL_TUNING.BOND_ATK_BONUS;

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

/** @deprecated 快照；运行时请读 GENERAL_TUNING.CRIT_MULT */
export const CRIT_MULT = GENERAL_TUNING.CRIT_MULT;
