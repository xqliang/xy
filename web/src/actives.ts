// 主动技能池：CD 制、战斗中手动触发的技能。
// 玩家在功德商店用「功德」购买（每日重置，最多装备 MAX_EQUIPPED_ACTIVES 个），
// 开局注入本局。具体效果实现在 battle.ts 的 triggerActive() 里按 effect 分派。
// 本文件只放纯数据/类型，不 import Battle，避免与 battle.ts 循环依赖。

// 技能效果种类：
// - palm    如来神掌：把场上所有妖怪沿路击退若干格
// - meteor  天降陨石：对最靠前的妖怪群造成波血比例伤害
// - atkBuff 仙丹：短时间全体攻击力提升
// - frqBuff 风火轮：短时间全体攻速提升
// - freeze  冰封定身：全体妖怪短暂定身
// - jinggu  紧箍咒：以最前妖怪为中心的大范围 AOE 爆发
export type ActiveEffect = 'palm' | 'meteor' | 'atkBuff' | 'frqBuff' | 'freeze' | 'jinggu';

export interface ActiveSkillDef {
  id: string; // 稳定 id（与被动技能 id 刻意区分，两套系统互不查表）
  name: string;
  /** 图标：优先单字汉字（跨端清晰）；避免细线 emoji 在深色底看不清 */
  icon: string;
  cd: number; // 冷却秒数
  cost: number; // 购买消耗功德
  effect: ActiveEffect;
  desc: string; // 商店说明（新人能看懂）
  /** true = 下架：商店不展示、不可购买、开局不注入（改配置即可禁用） */
  disabled?: boolean;
}

// 最多可装备（购买）的主动技能数
export const MAX_EQUIPPED_ACTIVES = 2;

// 主动技能池（数值经平衡修订：压掌/陨石节奏，统一大招缩放）
export const ACTIVE_SKILLS: ActiveSkillDef[] = [
  { id: 'act_palm', name: '如来神掌', icon: '掌', cd: 75, cost: 65, effect: 'palm',
    desc: '把场上所有妖怪沿路回推 6 格（从最前怪沿路径逐格击退）' },
  { id: 'act_meteor', name: '天降陨石', icon: '陨', cd: 28, cost: 60, effect: 'meteor',
    desc: '对最前方妖怪群砸下波血×2.2 的伤害（半径 1.4）' },
  { id: 'act_atk', name: '仙丹', icon: '丹', cd: 22, cost: 50, effect: 'atkBuff',
    desc: '5 秒内全体攻击 +30%' },
  { id: 'act_frq', name: '风火轮', icon: '轮', cd: 22, cost: 50, effect: 'frqBuff',
    desc: '5 秒内全体攻速 +30%' },
  { id: 'act_freeze', name: '冰封定身', icon: '冰', cd: 24, cost: 70, effect: 'freeze',
    desc: '全体妖怪定身 2.5 秒' },
  { id: 'act_jinggu', name: '紧箍咒', icon: '咒', cd: 55, cost: 70, effect: 'jinggu',
    desc: '以最前妖怪为中心大范围爆发（波血×2.3，半径 2.5）' },
];

export function activeById(id: string): ActiveSkillDef | undefined {
  return ACTIVE_SKILLS.find((a) => a.id === id);
}

/** 是否可上架/装备（未标记 disabled） */
export function isActiveEnabled(id: string): boolean {
  const def = activeById(id);
  return !!def && !def.disabled;
}

/** 商店与布局用：仅启用中的主动技能 */
export function enabledActives(): ActiveSkillDef[] {
  return ACTIVE_SKILLS.filter((a) => !a.disabled);
}
