// 局外「功德商店」（神秘商人）：跨局 localStorage 持久化的永久成长。
// 功德在对局结束时结算获得；可买断若干温和加成（有等级上限），开局注入本局。
import type { MetaBonuses } from './battle';
import { storeGet, storeSet } from './storage';

const KEY = 'dasheng.merit';

export type Rarity = '普通' | '稀有' | '史诗';

// 单个可升级项：每级提供固定增量，成本随等级递增。
export interface MeritUpgrade {
  id: string;
  name: string;
  icon: string;
  rarity: Rarity;
  desc: (lv: number) => string; // 展示"下一级"效果
  maxLevel: number;
  cost: (lv: number) => number; // 从 lv→lv+1 的功德花费
}

// 稀有度→基础成本系数
const RARITY_COST: Record<Rarity, number> = { 普通: 30, 稀有: 60, 史诗: 120 };
const costFor = (rarity: Rarity) => (lv: number) => Math.round(RARITY_COST[rarity] * (lv + 1));

export const UPGRADES: MeritUpgrade[] = [
  { id: 'peach', name: '蟠桃加持', icon: '🍑', rarity: '普通', maxLevel: 5, cost: costFor('普通'),
    desc: (lv) => `开局蟠桃 +${(lv + 1) * 8}` },
  { id: 'slot', name: '洞天福地', icon: '⛰', rarity: '稀有', maxLevel: 3, cost: costFor('稀有'),
    desc: (lv) => `额外初始阵位 +${lv + 1}` },
  { id: 'hp', name: '金刚之躯', icon: '🛡', rarity: '史诗', maxLevel: 2, cost: costFor('史诗'),
    desc: (lv) => `唐僧初始血 +${lv + 1}` },
  { id: 'atk', name: '神兵淬炼', icon: '⚔', rarity: '稀有', maxLevel: 4, cost: costFor('稀有'),
    desc: (lv) => `全体攻击 +${(lv + 1) * 5}%` },
  { id: 'frq', name: '疾风咒', icon: '🌀', rarity: '稀有', maxLevel: 4, cost: costFor('稀有'),
    desc: (lv) => `全体攻速 +${(lv + 1) * 5}%` },
];

export function upgradeById(id: string): MeritUpgrade | undefined {
  return UPGRADES.find((u) => u.id === id);
}

export interface MeritState {
  merit: number;
  levels: Record<string, number>; // 各项已购等级
}

export function loadMerit(): MeritState {
  try {
    const raw = storeGet(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (typeof s.merit === 'number' && s.levels && typeof s.levels === 'object') {
        return { merit: s.merit, levels: s.levels };
      }
    }
  } catch {
    /* ignore */
  }
  return { merit: 0, levels: {} };
}

export function saveMerit(s: MeritState): void {
  try {
    storeSet(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function levelOf(s: MeritState, id: string): number {
  return s.levels[id] ?? 0;
}

// 对局结算获得功德：通关基础 + 波次奖励（失败也给少量参与奖励）
export function meritReward(won: boolean, wave: number): number {
  return (won ? 20 : 5) + wave * 2;
}

export function addMerit(s: MeritState, amount: number): MeritState {
  const next: MeritState = { merit: s.merit + amount, levels: { ...s.levels } };
  saveMerit(next);
  return next;
}

// 购买：功德足够且未满级则升一级。返回新状态与是否成功。
export function buyUpgrade(s: MeritState, id: string): { state: MeritState; ok: boolean; reason?: string } {
  const up = upgradeById(id);
  if (!up) return { state: s, ok: false, reason: '无此项' };
  const lv = levelOf(s, id);
  if (lv >= up.maxLevel) return { state: s, ok: false, reason: '已满级' };
  const cost = up.cost(lv);
  if (s.merit < cost) return { state: s, ok: false, reason: '功德不足' };
  const next: MeritState = { merit: s.merit - cost, levels: { ...s.levels, [id]: lv + 1 } };
  saveMerit(next);
  return { state: next, ok: true };
}

// 汇总已购等级 → 开局注入的加成
export function metaBonuses(s: MeritState): MetaBonuses {
  const lv = (id: string) => levelOf(s, id);
  return {
    bonusPeach: lv('peach') * 8,
    bonusHp: lv('hp'),
    bonusSlots: lv('slot'),
    atkPct: lv('atk') * 0.05,
    frqPct: lv('frq') * 0.05,
  };
}

// 扣除功德（用于购买主动技能等每日消耗；不校验余额，调用方自行保证 merit>=amount）
export function spendMerit(s: MeritState, amount: number): MeritState {
  return addMerit(s, -amount);
}

export const RARITY_COLOR: Record<Rarity, string> = { 普通: '#8a9a6a', 稀有: '#4a7ad0', 史诗: '#a05ad0' };
