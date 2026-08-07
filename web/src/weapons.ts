// 武器（神兵）系统：每位武将一件专属神兵，五级品质 白/绿/蓝/紫/金。
// 对局中随机掉落；重复掉落自动升品质；背包内最多装备 3 件（形成取舍）。
// 数值有上限：最高品质也只给 +20% 单一属性，避免破坏兵种/武将的终局平衡。
import { GENERALS, generalById } from './generals';
import { storeGet, storeSet } from './storage';

const KEY = 'dasheng.bag';

export const WEAPON_QUALITY_NAMES = ['白', '绿', '蓝', '紫', '金'] as const;
export const WEAPON_QUALITY_COLORS = ['#cfd3d8', '#7ec46a', '#4a9be0', '#a86ad0', '#e8c22c'] as const;
export const MAX_WEAPON_TIER = 5;
export const MAX_EQUIPPED = 3; // 同时可装备的神兵数

export function weaponQualityName(tier: number): string {
  return WEAPON_QUALITY_NAMES[Math.max(0, Math.min(MAX_WEAPON_TIER - 1, tier - 1))]!;
}
export function weaponQualityColor(tier: number): string {
  return WEAPON_QUALITY_COLORS[Math.max(0, Math.min(MAX_WEAPON_TIER - 1, tier - 1))]!;
}

// 加成属性：攻击 / 攻速 / 范围（对应竞品"叠攻速""扩大攻击范围"等神兵定位）
export type WeaponStat = 'atk' | 'frq' | 'rge';
export const STAT_LABEL: Record<WeaponStat, string> = { atk: '攻击', frq: '攻速', rge: '范围' };

export interface WeaponDef {
  id: string;
  name: string;
  general: string; // 专属武将 id
  stat: WeaponStat;
}

// 每位武将一件专属神兵（与 GENERALS 一一对应）
export const WEAPONS: WeaponDef[] = [
  { id: 'jingubang', name: '如意金箍棒', general: 'wukong', stat: 'rge' },
  { id: 'xiaodingpa', name: '小钉耙', general: 'wuneng', stat: 'atk' },
  { id: 'sanjianliangrendao', name: '三尖两刃刀', general: 'erlang', stat: 'atk' },
  { id: 'zhiyunjian', name: '织云箭', general: 'niulang', stat: 'frq' },
  { id: 'huojianqiang', name: '火尖枪', general: 'nezha', stat: 'frq' },
  { id: 'kanyaodao', name: '砍妖刀', general: 'jinzha', stat: 'atk' },
  { id: 'huntianling', name: '混天绫', general: 'honghaier', stat: 'frq' },
  { id: 'chiyanpao', name: '赤焰袍', general: 'hongpao', stat: 'frq' },
  { id: 'jiuchidingba', name: '九齿钉耙', general: 'bajie', stat: 'atk' },
  { id: 'duandingpa', name: '短钉耙', general: 'xiaojie', stat: 'atk' },
  { id: 'niujiao', name: '混铁棍', general: 'niumowang', stat: 'atk' },
  { id: 'qingniujiao', name: '青牛角', general: 'qingniu', stat: 'atk' },
  { id: 'bajiaoshan', name: '芭蕉扇', general: 'tieshan', stat: 'rge' },
  { id: 'tiebeijia', name: '铁背甲', general: 'tiebei', stat: 'atk' },
  { id: 'jiangyaozhang', name: '降妖宝杖', general: 'shaseng', stat: 'atk' },
  { id: 'liushazhang', name: '流沙杖', general: 'liusha', stat: 'rge' },
  { id: 'longyajian', name: '龙牙剑', general: 'bailong', stat: 'atk' },
  { id: 'baiguzhang', name: '白骨爪', general: 'baigujing', stat: 'frq' },
  { id: 'jingping', name: '净瓶玉露', general: 'guanyin', stat: 'frq' },
  { id: 'fanyinzhu', name: '梵音珠', general: 'fanyin', stat: 'rge' },
];

export function weaponById(id: string): WeaponDef | undefined {
  return WEAPONS.find((w) => w.id === id);
}
export function weaponOfGeneral(generalId: string): WeaponDef | undefined {
  return WEAPONS.find((w) => w.general === generalId);
}

// 品质 → 加成倍率（+4%/级，金阶 +20%）
export function weaponBonus(tier: number): number {
  return 0.04 * Math.max(1, Math.min(MAX_WEAPON_TIER, tier));
}

export interface BagState {
  owned: Record<string, number>; // weaponId → 品质阶
  equipped: string[]; // 已装备的 weaponId（最多 MAX_EQUIPPED）
}

export function loadBag(): BagState {
  try {
    const raw = storeGet(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && typeof s.owned === 'object' && Array.isArray(s.equipped)) {
        return { owned: s.owned, equipped: s.equipped };
      }
    }
  } catch {
    /* ignore */
  }
  return { owned: {}, equipped: [] };
}

export function saveBag(s: BagState): void {
  try {
    storeSet(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

// 获得一件神兵：已有则升品质（上限金阶），未有则以白阶入包
export function addWeapon(s: BagState, id: string): { state: BagState; upgraded: boolean; tier: number } {
  const owned = { ...s.owned };
  const cur = owned[id] ?? 0;
  const upgraded = cur > 0;
  owned[id] = Math.min(MAX_WEAPON_TIER, cur + 1);
  const next: BagState = { owned, equipped: [...s.equipped] };
  // 首次获得且还有装备位 → 自动装备，减少操作负担
  if (!upgraded && next.equipped.length < MAX_EQUIPPED) next.equipped.push(id);
  saveBag(next);
  return { state: next, upgraded, tier: owned[id]! };
}

// 切换装备（受 MAX_EQUIPPED 限制）
export function toggleEquip(s: BagState, id: string): { state: BagState; ok: boolean; reason?: string } {
  if (!s.owned[id]) return { state: s, ok: false, reason: '尚未获得该神兵' };
  const equipped = [...s.equipped];
  const i = equipped.indexOf(id);
  if (i >= 0) {
    equipped.splice(i, 1);
  } else {
    if (equipped.length >= MAX_EQUIPPED) return { state: s, ok: false, reason: `最多装备 ${MAX_EQUIPPED} 件` };
    equipped.push(id);
  }
  const next: BagState = { owned: { ...s.owned }, equipped };
  saveBag(next);
  return { state: next, ok: true };
}

// 每位武将的加成（仅已装备的神兵生效），供开局注入 Battle
export type WeaponBonuses = Record<string, { atk: number; frq: number; rge: number }>;
export function weaponBonuses(s: BagState): WeaponBonuses {
  const out: WeaponBonuses = {};
  for (const id of s.equipped) {
    const def = weaponById(id);
    const tier = s.owned[id];
    if (!def || !tier) continue;
    const b = weaponBonus(tier);
    const e = (out[def.general] ??= { atk: 0, frq: 0, rge: 0 });
    e[def.stat] += b;
  }
  return out;
}

// 掉落：从 12 件中随机一件（用传入的随机数，便于确定性自测）
export function rollWeaponDrop(rand: number): string {
  const i = Math.floor(rand * WEAPONS.length) % WEAPONS.length;
  return WEAPONS[i]!.id;
}

export function generalNameOfWeapon(id: string): string {
  const def = weaponById(id);
  return def ? generalById(def.general)?.name ?? '' : '';
}

export const ALL_GENERAL_IDS = GENERALS.map((g) => g.id);
