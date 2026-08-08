// 主动技能池：CD 制、战斗中手动触发的技能。
// 玩家在功德商店用「功德」购买（每日重置，最多装备 MAX_EQUIPPED_ACTIVES 个），
// 开局注入本局。具体效果实现在 battle.ts 的 triggerActive() 里按 effect 分派。
// 本文件只放纯数据/类型，不 import Battle，避免与 battle.ts 循环依赖。

// 技能效果种类：
// - palm    如来神掌：把场上所有妖怪推回起点
// - meteor  天降陨石：对最靠前的妖怪群造成大额伤害
// - atkBuff 仙丹：短时间全体攻击力提升
// - frqBuff 风火轮：短时间全体攻速提升
// - freeze  冰封定身：全体妖怪短暂定身
// - jinggu  紧箍咒：以最前妖怪为中心的大范围 AOE 爆发（复用原英雄绝招效果）
export type ActiveEffect = 'palm' | 'meteor' | 'atkBuff' | 'frqBuff' | 'freeze' | 'jinggu';

export interface ActiveSkillDef {
  id: string; // 稳定 id（与被动技能 id 刻意区分，两套系统互不查表）
  name: string;
  icon: string; // 图标（emoji 或 1 个汉字，Canvas fillText 渲染）
  cd: number; // 冷却秒数
  cost: number; // 购买消耗功德
  effect: ActiveEffect;
  desc: string; // 商店说明（新人能看懂）
}

// 最多可装备（购买）的主动技能数
export const MAX_EQUIPPED_ACTIVES = 2;

// 主动技能池（数值为初版估计，后续用 tools/sweep*.mjs 做平衡）
export const ACTIVE_SKILLS: ActiveSkillDef[] = [
  { id: 'act_palm', name: '如来神掌', icon: '🖐', cd: 60, cost: 60, effect: 'palm',
    desc: '把场上所有妖怪推回起点（绝境救命）' },
  { id: 'act_meteor', name: '天降陨石', icon: '☄', cd: 18, cost: 60, effect: 'meteor',
    desc: '对最前方妖怪群砸下大额伤害' },
  { id: 'act_atk', name: '仙丹', icon: '🔴', cd: 20, cost: 50, effect: 'atkBuff',
    desc: '5 秒内全体武将攻击 +50%' },
  { id: 'act_frq', name: '风火轮', icon: '🔥', cd: 20, cost: 50, effect: 'frqBuff',
    desc: '5 秒内全体武将攻速 +40%' },
  { id: 'act_freeze', name: '冰封定身', icon: '❄', cd: 22, cost: 70, effect: 'freeze',
    desc: '全体妖怪定身 2 秒' },
  { id: 'act_jinggu', name: '紧箍咒', icon: '💫', cd: 60, cost: 70, effect: 'jinggu',
    desc: '以最前妖怪为中心大范围爆发伤害' },
];

export function activeById(id: string): ActiveSkillDef | undefined {
  return ACTIVE_SKILLS.find((a) => a.id === id);
}
