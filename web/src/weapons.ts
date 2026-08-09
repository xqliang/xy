// 武器（神兵）系统：每位武将一件专属神兵，五级品质 白/绿/蓝/紫/金。
// 对局中随机掉落；重复掉落自动升品质；背包内最多装备 3 件（形成取舍）。
// 数值有上限：攻击/攻速最高 +20%（比例）；范围按品质每阶 +0.35 格（格数加成）。
import { GENERALS, generalById } from './generals';
import { storeGet, storeSet, parseStoredJson, safeStringArray } from './storage';

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
  { id: 'jingubang', name: '如意金箍棒', general: 'dasheng', stat: 'rge' },
  { id: 'xiaodingpa', name: '小钉耙', general: 'damang', stat: 'atk' },
  { id: 'sanjianliangrendao', name: '三尖两刃刀', general: 'erlang', stat: 'atk' },
  { id: 'zhiyunjian', name: '织云箭', general: 'niulang', stat: 'frq' },
  { id: 'huojianqiang', name: '火尖枪', general: 'nezha', stat: 'frq' },
  { id: 'kanyaodao', name: '砍妖刀', general: 'jinzha', stat: 'atk' },
  { id: 'huntianling', name: '混天绫', general: 'honghaier', stat: 'frq' },
  { id: 'chiyanpao', name: '赤焰袍', general: 'hongpao', stat: 'frq' },
  { id: 'jiuchidingba', name: '九齿钉耙', general: 'bajie', stat: 'atk' },
  { id: 'duandingpa', name: '仙葫芦', general: 'baxian', stat: 'atk' },
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

export const WEAPON_RANGE_STEP = 0.35; // 神兵范围：每品质阶 +0.35 格（金阶 +1.75）

// 品质 → 攻击/攻速比例加成（+4%/级，金阶 +20%）
export function weaponPctBonus(tier: number): number {
  return 0.04 * Math.max(1, Math.min(MAX_WEAPON_TIER, tier));
}

/** 兼容旧名：攻击/攻速比例加成 */
export function weaponBonus(tier: number): number {
  return weaponPctBonus(tier);
}

/** 神兵范围：每品质阶 +0.35 格（白 +0.35 … 金 +1.75） */
export function weaponRangeBonusGrids(tier: number): number {
  return WEAPON_RANGE_STEP * Math.max(1, Math.min(MAX_WEAPON_TIER, tier));
}

/** 背包/UI 用加成文案 */
export function weaponBonusLabel(stat: WeaponStat, tier: number): string {
  if (stat === 'rge') {
    const g = weaponRangeBonusGrids(tier);
    return `${STAT_LABEL[stat]} +${g % 1 === 0 ? g : g.toFixed(1)}格`;
  }
  return `${STAT_LABEL[stat]} +${Math.round(weaponPctBonus(tier) * 100)}%`;
}

export interface BagState {
  owned: Record<string, number>; // weaponId → 品质阶
  equipped: string[]; // 已装备的 weaponId（最多 MAX_EQUIPPED）
}

const DEFAULT_BAG: BagState = { owned: {}, equipped: [] };

function normalizeBag(raw: unknown): BagState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!s.owned || typeof s.owned !== 'object' || !Array.isArray(s.equipped)) return null;
  const owned: Record<string, number> = {};
  for (const [id, tier] of Object.entries(s.owned as Record<string, unknown>)) {
    if (!weaponById(id) || typeof tier !== 'number' || !Number.isFinite(tier)) continue;
    owned[id] = Math.max(1, Math.min(MAX_WEAPON_TIER, Math.floor(tier)));
  }
  const equipped = safeStringArray(s.equipped)
    .filter((id) => id in owned)
    .slice(0, MAX_EQUIPPED);
  return { owned, equipped };
}

export function loadBag(): BagState {
  return parseStoredJson(storeGet(KEY), normalizeBag, DEFAULT_BAG);
}

export function saveBag(s: BagState): void {
  try {
    storeSet(KEY, JSON.stringify(normalizeBag(s) ?? DEFAULT_BAG));
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

// 每位武将的加成（仅已装备的神兵生效）：atk/frq 为比例(0~0.2)，rge 为格数(0.5~2.5)
export type WeaponBonuses = Record<string, { atk: number; frq: number; rge: number }>;
export function weaponBonuses(s: BagState): WeaponBonuses {
  const out: WeaponBonuses = {};
  for (const id of s.equipped) {
    const def = weaponById(id);
    const tier = s.owned[id];
    if (!def || !tier) continue;
    const b = def.stat === 'rge' ? weaponRangeBonusGrids(tier) : weaponPctBonus(tier);
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

/** 从战斗内已注入的加成反查该武将当前装备神兵（仅已装备且生效时有值） */
export function generalEquippedWeapon(
  generalId: string,
  wb?: { atk: number; frq: number; rge: number },
): { def: WeaponDef; tier: number } | null {
  if (!wb) return null;
  const def = weaponOfGeneral(generalId);
  if (!def) return null;
  const raw = wb[def.stat];
  if (!raw || raw <= 0) return null;
  const tier =
    def.stat === 'rge'
      ? Math.round(raw / WEAPON_RANGE_STEP)
      : Math.round(raw / weaponPctBonus(1));
  if (tier < 1) return null;
  return { def, tier: Math.max(1, Math.min(MAX_WEAPON_TIER, tier)) };
}

export const ALL_GENERAL_IDS = GENERALS.map((g) => g.id);
