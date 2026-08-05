// 每日被动技能池：与主动技能(actives.ts)并列，玩家在功德商店用「功德」购买、当天生效、跨天重置。
// 被动技能开局注入本局，效果实现在 battle.ts（按 id 分派）。本文件只放纯数据/类型，不 import Battle。

export interface PassiveSkillDef {
  id: string; // 稳定 id（与 actives/ITEMS 刻意区分）
  name: string;
  icon: string; // 图标（emoji 或 1 个汉字，Canvas fillText 渲染）
  cost: number; // 购买消耗功德
  desc: string; // 商店说明（新人能看懂）
}

// 最多可装备（购买）的被动技能数
export const MAX_EQUIPPED_PASSIVES = 2;

export const PASSIVE_SKILLS: PassiveSkillDef[] = [
  {
    id: 'pas_pantao',
    name: '蟠桃园',
    icon: '🍑',
    cost: 60,
    desc: '每40s在空地自动种下1棵桃树；桃树按等级产桃(20/10/5/3/2s)，同级拖动可合并升级，最高5级',
  },
];

export function passiveById(id: string): PassiveSkillDef | undefined {
  return PASSIVE_SKILLS.find((p) => p.id === id);
}
