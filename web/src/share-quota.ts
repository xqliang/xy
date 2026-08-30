// 每日分享次数额度：自然日重置。两类**独立**额度——分享加体力、分享得铲子，各上限 3 次/天，互不占用。
// 仿 loadout.ts 的自然日索引与跨天重置；核心判定抽成纯函数便于单测。
import { storeGet, storeSet, parseStoredJson, safeNumber } from './storage';

const KEY = 'dasheng.shareQuota';
export const MAX_DAILY_STAMINA_SHARES = 3; // 分享加体力：每日上限
export const MAX_DAILY_SHOVEL_SHARES = 3;  // 分享得铲子：每日上限
export type ShareKind = 'stamina' | 'shovel';

export interface ShareQuota {
  /** 自然日索引（floor(Date.now()/86400000)），跨天则重置计数 */
  day: number;
  /** 今日已「分享加体力」次数（0..MAX_DAILY_STAMINA_SHARES） */
  stamina: number;
  /** 今日已「分享得铲子」次数（0..MAX_DAILY_SHOVEL_SHARES） */
  shovel: number;
}

function maxOf(kind: ShareKind): number {
  return kind === 'stamina' ? MAX_DAILY_STAMINA_SHARES : MAX_DAILY_SHOVEL_SHARES;
}

// 日索引 floor(Date.now()/86400000)：按 UTC 零点切天（与 loadout.ts 同口径）
function today(): number {
  return Math.floor(Date.now() / 86400000);
}

/** 纯函数：给定已存状态与当日索引，算规范化后的状态（跨天清零、两类次数各自夹紧） */
export function normalizeQuota(q: ShareQuota | null, todayIdx: number): ShareQuota {
  if (!q || q.day !== todayIdx) return { day: todayIdx, stamina: 0, shovel: 0 };
  return {
    day: todayIdx,
    stamina: Math.max(0, Math.min(MAX_DAILY_STAMINA_SHARES, Math.floor(q.stamina))),
    shovel: Math.max(0, Math.min(MAX_DAILY_SHOVEL_SHARES, Math.floor(q.shovel))),
  };
}

/** 纯函数：某类额度今日剩余可分享次数 */
export function remainingOf(q: ShareQuota, kind: ShareKind): number {
  const used = kind === 'stamina' ? q.stamina : q.shovel;
  return Math.max(0, maxOf(kind) - used);
}

function normalizeRaw(raw: unknown): ShareQuota | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.day !== 'number') return null;
  // 旧版单池字段 count 已废弃：不迁移（每日重置，最多让老用户当天多一次额度，无害）。
  return {
    day: Math.floor(safeNumber(s.day, today(), 0)),
    stamina: Math.floor(safeNumber(s.stamina, 0, 0, MAX_DAILY_STAMINA_SHARES)),
    shovel: Math.floor(safeNumber(s.shovel, 0, 0, MAX_DAILY_SHOVEL_SHARES)),
  };
}

function save(q: ShareQuota): ShareQuota {
  try {
    storeSet(KEY, JSON.stringify(q));
  } catch {
    /* ignore */
  }
  return q;
}

/** 读取今日额度（跨天自动清零并持久化） */
export function loadShareQuota(): ShareQuota {
  const raw = parseStoredJson<ShareQuota | null>(storeGet(KEY), normalizeRaw, null);
  const q = normalizeQuota(raw, today());
  // 仅当规范化结果与已存不同(无存档/跨天重置/异常夹紧)才落盘，避免纯读重复写
  if (!raw || raw.day !== q.day || raw.stamina !== q.stamina || raw.shovel !== q.shovel) save(q);
  return q;
}

// 内存缓存：remainingShares/canShare 可能被战斗渲染每帧调用，避免每次读 storage。
// 仅首次 / 跨天 / consumeShare 后刷新；配额是本地量(不云同步)，无其它外部变更源。
let cache: ShareQuota | null = null;
function current(): ShareQuota {
  const t = today();
  if (!cache || cache.day !== t) cache = loadShareQuota(); // 仅缓存缺失或跨天才读盘
  return cache;
}

/** 某类额度今日剩余可分享次数（走内存缓存，可安全每帧调用） */
export function remainingShares(kind: ShareKind): number {
  return remainingOf(current(), kind);
}

/** 某类额度今日是否还能分享 */
export function canShare(kind: ShareKind): boolean {
  return remainingShares(kind) > 0;
}

/** 记一次某类成功分享（对应计数 +1，夹到上限并持久化+更新缓存）。调用方须保证分享确已成功。 */
export function consumeShare(kind: ShareKind): ShareQuota {
  const q = current();
  const next: ShareQuota = { ...q };
  if (kind === 'stamina') next.stamina = Math.min(MAX_DAILY_STAMINA_SHARES, q.stamina + 1);
  else next.shovel = Math.min(MAX_DAILY_SHOVEL_SHARES, q.shovel + 1);
  cache = save(next);
  return cache;
}
