// 武器（神兵）系统：每位武将一件专属神兵，五级品质 白/绿/蓝/紫/金。
// 对局随机掉落碎片（武将攻击触发）；左下角点击领取；集齐碎片激活；最多装备 3 件。
// 掉落：开局 35% 预排本局可掉 1 片，武将攻击命中时再 10% 触发（整局最多 1 次）。
// 数值有上限：攻击/攻速最高 +20%（比例）；范围按品质每阶 +0.35 格（格数加成）。
import { GENERALS, generalById } from './generals';
import { storeGet, storeSet, parseStoredJson, safeStringArray } from './storage';

const KEY = 'dasheng.bag';

export const WEAPON_QUALITY_NAMES = ['白', '绿', '蓝', '紫', '金'] as const;
export const WEAPON_QUALITY_COLORS = ['#cfd3d8', '#7ec46a', '#4a9be0', '#a86ad0', '#e8c22c'] as const;
export const MAX_WEAPON_TIER = 5;
export const MAX_EQUIPPED = 3; // 同时可装备的神兵数

/** 神兵稀有度：决定集齐激活所需碎片数（低1/普2/中3/高4） */
export type WeaponGrade = 'low' | 'normal' | 'mid' | 'high';
export const WEAPON_GRADE_NAMES: Record<WeaponGrade, string> = {
  low: '低级', normal: '普通', mid: '中级', high: '高级',
};
export const WEAPON_GRADE_FRAGMENTS: Record<WeaponGrade, number> = {
  low: 1, normal: 2, mid: 3, high: 4,
};
export const WEAPON_GRADE_COLORS: Record<WeaponGrade, string> = {
  low: '#9a9588', normal: '#7ec46a', mid: '#4a9be0', high: '#e8c22c',
};

export function weaponQualityName(tier: number): string {
  return WEAPON_QUALITY_NAMES[Math.max(0, Math.min(MAX_WEAPON_TIER - 1, tier - 1))]!;
}
export function weaponQualityColor(tier: number): string {
  return WEAPON_QUALITY_COLORS[Math.max(0, Math.min(MAX_WEAPON_TIER - 1, tier - 1))]!;
}

export function weaponGrade(def: WeaponDef): WeaponGrade {
  const g = generalById(def.general);
  if (!g) return 'normal';
  if (g.rank === 'T0') return 'high';
  if (g.role === '过渡') return 'low';
  if (g.role === '辅助') return 'normal';
  return 'mid';
}

export function weaponGradeName(id: string): string {
  const def = weaponById(id);
  return def ? WEAPON_GRADE_NAMES[weaponGrade(def)] : '';
}

export function weaponGradeColor(id: string): string {
  const def = weaponById(id);
  return def ? WEAPON_GRADE_COLORS[weaponGrade(def)] : '#9a9588';
}

export function weaponFragmentsRequired(id: string): number {
  const def = weaponById(id);
  return def ? WEAPON_GRADE_FRAGMENTS[weaponGrade(def)] : 1;
}

export function weaponFragmentCount(s: BagState, id: string): number {
  return s.fragments[id] ?? 0;
}

export function isWeaponActivated(s: BagState, id: string): boolean {
  return (s.owned[id] ?? 0) > 0;
}

/** 碎片已集齐或神兵已激活 → 对局内不再展示掉落卡片（仍参与随机） */
export function isWeaponFragmentsComplete(s: BagState, id: string): boolean {
  if (isWeaponActivated(s, id)) return true;
  return weaponFragmentCount(s, id) >= weaponFragmentsRequired(id);
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
  owned: Record<string, number>; // weaponId → 品质阶（激活后 ≥1）
  fragments: Record<string, number>; // weaponId → 已收集碎片数
  equipped: string[]; // 已装备的 weaponId（最多 MAX_EQUIPPED）
}

const DEFAULT_BAG: BagState = { owned: {}, fragments: {}, equipped: [] };

function normalizeBag(raw: unknown): BagState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!s.owned || typeof s.owned !== 'object' || !Array.isArray(s.equipped)) return null;
  const owned: Record<string, number> = {};
  for (const [id, tier] of Object.entries(s.owned as Record<string, unknown>)) {
    if (!weaponById(id) || typeof tier !== 'number' || !Number.isFinite(tier)) continue;
    owned[id] = Math.max(1, Math.min(MAX_WEAPON_TIER, Math.floor(tier)));
  }
  const fragments: Record<string, number> = {};
  if (s.fragments && typeof s.fragments === 'object') {
    for (const [id, n] of Object.entries(s.fragments as Record<string, unknown>)) {
      if (!weaponById(id) || typeof n !== 'number' || !Number.isFinite(n)) continue;
      const req = weaponFragmentsRequired(id);
      fragments[id] = Math.max(0, Math.min(req, Math.floor(n)));
    }
  }
  // 旧存档：已激活的神兵视为碎片集齐
  for (const id of Object.keys(owned)) {
    fragments[id] = weaponFragmentsRequired(id);
  }
  const equipped = safeStringArray(s.equipped)
    .filter((id) => id in owned)
    .slice(0, MAX_EQUIPPED);
  return { owned, fragments, equipped };
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

// 领取对局掉落的一枚神兵碎片：集齐后激活（白阶）
export function addWeaponFragment(
  s: BagState,
  id: string,
): { state: BagState; activated: boolean; upgraded: boolean; fragments: number; required: number; tier: number } {
  const req = weaponFragmentsRequired(id);
  if (isWeaponActivated(s, id)) {
    const r = addWeapon(s, id);
    return { ...r, activated: false, fragments: req, required: req };
  }
  if (isWeaponFragmentsComplete(s, id)) {
    return {
      state: s, activated: false, upgraded: false,
      fragments: weaponFragmentCount(s, id), required: req, tier: 0,
    };
  }
  const fragments = { ...s.fragments };
  const owned = { ...s.owned };
  const cur = fragments[id] ?? 0;
  fragments[id] = Math.min(req, cur + 1);
  let activated = false;
  if (fragments[id] >= req) {
    owned[id] = 1;
    activated = true;
  }
  const next: BagState = { owned, fragments, equipped: [...s.equipped] };
  if (activated && next.equipped.length < MAX_EQUIPPED) next.equipped.push(id);
  saveBag(next);
  return { state: next, activated, upgraded: false, fragments: fragments[id]!, required: req, tier: owned[id] ?? 0 };
}

// 直接获得/升阶神兵（测试钩子）：视为碎片集齐
export function addWeapon(s: BagState, id: string): { state: BagState; upgraded: boolean; tier: number } {
  const owned = { ...s.owned };
  const fragments = { ...s.fragments };
  const req = weaponFragmentsRequired(id);
  const cur = owned[id] ?? 0;
  const upgraded = cur > 0;
  owned[id] = Math.min(MAX_WEAPON_TIER, cur + 1);
  fragments[id] = req;
  const next: BagState = { owned, fragments, equipped: [...s.equipped] };
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
  const next: BagState = { owned: { ...s.owned }, fragments: { ...s.fragments }, equipped };
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

// 掉落：从全部神兵中随机一件（用传入的随机数，便于确定性自测）
export function rollWeaponDrop(rand: number): string {
  const i = Math.floor(rand * WEAPONS.length) % WEAPONS.length;
  return WEAPONS[i]!.id;
}

/** 开局判定本局是否「可能」掉碎片（通过后再在武将攻击时 10% 触发，整局最多 1 次） */
export const BATTLE_FRAGMENT_ELIGIBLE_CHANCE = 0.35;
/** 武将攻击命中时，在已预排的本局碎片掉落上掷骰 */
export const HERO_ATTACK_FRAGMENT_CHANCE = 0.10;

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
