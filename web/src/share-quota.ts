// 每日分享次数额度：自然日重置，全局上限 4 次；体力弹窗分享 + tray 铲子分享共用同一池。
// 仿 loadout.ts 的自然日索引与跨天重置；核心判定抽成纯函数便于单测。
import { storeGet, storeSet, parseStoredJson, safeNumber } from './storage';

const KEY = 'dasheng.shareQuota';
export const MAX_DAILY_SHARES = 4;

export interface ShareQuota {
  /** 自然日索引（floor(Date.now()/86400000)），跨天则重置 count */
  day: number;
  /** 今日已成功分享次数（0..MAX_DAILY_SHARES） */
  count: number;
}

// 日索引 floor(Date.now()/86400000)：按 UTC 零点切天（与 loadout.ts 同口径）
function today(): number {
  return Math.floor(Date.now() / 86400000);
}

/** 纯函数：给定已存状态与当日索引，算规范化后的状态（跨天清零、次数夹紧） */
export function normalizeQuota(q: ShareQuota | null, todayIdx: number): ShareQuota {
  if (!q || q.day !== todayIdx) return { day: todayIdx, count: 0 };
  const count = Math.max(0, Math.min(MAX_DAILY_SHARES, Math.floor(q.count)));
  return { day: todayIdx, count };
}

/** 纯函数：剩余可分享次数 */
export function remainingOf(q: ShareQuota): number {
  return Math.max(0, MAX_DAILY_SHARES - q.count);
}

function normalizeRaw(raw: unknown): ShareQuota | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.day !== 'number') return null;
  return {
    day: Math.floor(safeNumber(s.day, today(), 0)),
    count: Math.floor(safeNumber(s.count, 0, 0, MAX_DAILY_SHARES)),
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
  if (!raw || raw.day !== q.day || raw.count !== q.count) save(q);
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

/** 今日剩余可分享次数（走内存缓存，可安全每帧调用） */
export function remainingShares(): number {
  return remainingOf(current());
}

/** 今日是否还能分享 */
export function canShare(): boolean {
  return remainingShares() > 0;
}

/** 记一次成功分享（count+1，夹到上限并持久化+更新缓存）。调用方须保证分享确已成功。 */
export function consumeShare(): ShareQuota {
  const q = current();
  cache = save({ day: q.day, count: Math.min(MAX_DAILY_SHARES, q.count + 1) });
  return cache;
}
