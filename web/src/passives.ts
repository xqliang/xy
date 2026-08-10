// 每日被动技能池：与主动技能(actives.ts)并列，玩家在功德商店用「功德」购买、当天生效、跨天重置。
// 被动技能开局注入本局，效果实现在 battle.ts（按 id 分派）。本文件只放纯数据/类型，不 import Battle。

export interface PassiveSkillDef {
  id: string; // 稳定 id（与 actives 刻意区分）
  name: string;
  /** 图标：优先单字汉字（跨端清晰）；避免细线 emoji 在深色底看不清 */
  icon: string;
  cost: number; // 购买消耗功德
  desc: string; // 商店说明（新人能看懂）
  /** true = 下架：商店不展示、不可购买、开局不注入（改配置即可禁用） */
  disabled?: boolean;
}

// 最多「生效」的被动技能数（购买不设上限，仅保留最新 N 个生效）
export const MAX_EQUIPPED_PASSIVES = 6;

export const PASSIVE_SKILLS: PassiveSkillDef[] = [
  {
    id: 'pas_pantao',
    name: '蟠桃园',
    icon: '桃',
    cost: 75,
    desc: '每40s在空地自动种下1棵桃树；桃树按等级产桃(20/10/5/3/2s)，同级拖动可合并升级，最高5级',
  },
  { id: 'xiandan', name: '仙丹符', icon: '丹', cost: 55, desc: '全体攻击 +10%' },
  { id: 'fenghuolun', name: '风火轮符', icon: '轮', cost: 55, desc: '全体攻速 +10%' },
  { id: 'fabaofu', name: '法宝符', icon: '宝', cost: 80, desc: '武将初始品质阶 +1' },
  { id: 'zhaoxian', name: '招贤榜', icon: '贤', cost: 50, desc: '武将字牌掉率 +10%' },
  { id: 'mojin', name: '摸金校尉', icon: '金', cost: 45, desc: '每次用铲子额外 +6 蟠桃' },
  { id: 'luoyangchan', name: '洛阳铲', icon: '铲', cost: 50, desc: '每 45 秒自动获得 1 把铲子' },
  { id: 'yunshi', name: '陨石', icon: '陨', cost: 65, desc: '每波开始对最前妖怪造成较弱陨石伤害（×1.4）' },
  { id: 'yuni', name: '淤泥', icon: '泥', cost: 50, desc: '出怪口附近妖怪移速 -18%' },
  { id: 'xianyuan', name: '仙缘幡', icon: '缘', cost: 35, desc: '召唤成本 -1' },
  { id: 'jubaopen', name: '聚宝盆', icon: '盆', cost: 55, desc: '击杀额外 +1 蟠桃' },
  { id: 'hushen', name: '护身金光', icon: '护', cost: 40, desc: '唐僧 +1 血' },
  { id: 'zhuwang', name: '绊妖蛛网', icon: '网', cost: 55, desc: '妖怪移速 -10%' },
  { id: 'tongxin', name: '同心咒', icon: '心', cost: 60, desc: '唐僧 +3 血（对手仅 +2）' },
  { id: 'dinghai', name: '自动定海针', icon: '针', cost: 55, desc: '立即开辟 1 阵位' },
];

export function passiveById(id: string): PassiveSkillDef | undefined {
  return PASSIVE_SKILLS.find((p) => p.id === id);
}

/** 是否可上架/装备（未标记 disabled） */
export function isPassiveEnabled(id: string): boolean {
  const def = passiveById(id);
  return !!def && !def.disabled;
}

/** 商店与布局用：仅启用中的被动技能 */
export function enabledPassives(): PassiveSkillDef[] {
  return PASSIVE_SKILLS.filter((p) => !p.disabled);
}
