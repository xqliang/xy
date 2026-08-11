// 局外「功德商店」（神秘商人）：跨局 localStorage 持久化的永久成长。
// 功德在对局结束时结算获得；可买断若干温和加成（有等级上限），开局注入本局。
import type { MetaBonuses } from './battle';
import { storeGet, storeSet, parseStoredJson, safeNumber } from './storage';

const KEY = 'dasheng.merit';

// 功德点持有上限：超出部分作废（对局结算/管理员发放/购买退款等一切增加途径统一封顶）
export const MERIT_MAX = 300;

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

// 永久成长升级池已清空：蟠桃加持/洞天福地/金刚之躯/神兵淬炼等下架。
// 同类效果改由每日主动/被动技能提供。保留类型与购买 API 以便日后加项。
export const UPGRADES: MeritUpgrade[] = [];

export function upgradeById(id: string): MeritUpgrade | undefined {
  return UPGRADES.find((u) => u.id === id);
}

export interface MeritState {
  merit: number;
  levels: Record<string, number>; // 各项已购等级
}

const DEFAULT_MERIT: MeritState = { merit: 0, levels: {} };

function normalizeMerit(raw: unknown): MeritState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.merit !== 'number' || !s.levels || typeof s.levels !== 'object') return null;
  const levels: Record<string, number> = {};
  for (const [id, lv] of Object.entries(s.levels as Record<string, unknown>)) {
    if (typeof id !== 'string' || typeof lv !== 'number' || !Number.isFinite(lv)) continue;
    levels[id] = Math.max(0, Math.floor(lv));
  }
  return { merit: Math.min(MERIT_MAX, Math.max(0, Math.floor(safeNumber(s.merit, 0, 0)))), levels };
}

export function loadMerit(): MeritState {
  return parseStoredJson(storeGet(KEY), normalizeMerit, DEFAULT_MERIT);
}

export function saveMerit(s: MeritState): void {
  try {
    storeSet(KEY, JSON.stringify(normalizeMerit(s) ?? DEFAULT_MERIT));
  } catch {
    /* ignore */
  }
}

export function levelOf(s: MeritState, id: string): number {
  return s.levels[id] ?? 0;
}

export type MeritRewardOpts = { endless?: boolean };

// 对局结算获得功德：通关基础 + 波次奖励（失败也给少量参与奖励）。
// 无尽模式按实际抵达波数计（含第 10 波以后，不做封顶）。
export function meritReward(won: boolean, wave: number, opts?: MeritRewardOpts): number {
  const w = Math.max(1, Math.floor(wave));
  const base = opts?.endless ? 5 : won ? 20 : 5;
  return base + w * 2;
}

export function addMerit(s: MeritState, amount: number): MeritState {
  const raw = s.merit + amount;
  // 增加功德时封顶 300；扣费（amount<0）只做下限保护，不因起始余额而额外截断。
  const merit = amount >= 0 ? Math.min(MERIT_MAX, Math.max(0, raw)) : Math.max(0, raw);
  const next: MeritState = { merit, levels: { ...s.levels } };
  saveMerit(next);
  return next;
}

/** 将功德设为指定值（测试/调试入口用） */
export function setMerit(s: MeritState, amount: number): MeritState {
  const next: MeritState = { merit: Math.min(MERIT_MAX, Math.max(0, Math.floor(amount))), levels: { ...s.levels } };
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

// 汇总已购等级 → 开局注入的加成（永久升级池为空时恒为 0，旧存档等级也不再生效）
export function metaBonuses(_s: MeritState): MetaBonuses {
  return { bonusPeach: 0, bonusHp: 0, bonusSlots: 0, atkPct: 0, frqPct: 0 };
}

// 扣除功德（用于购买主动技能等每日消耗；不校验余额，调用方自行保证 merit>=amount）
export function spendMerit(s: MeritState, amount: number): MeritState {
  return addMerit(s, -amount);
}

export const RARITY_COLOR: Record<Rarity, string> = { 普通: '#8a9a6a', 稀有: '#4a7ad0', 史诗: '#a05ad0' };
