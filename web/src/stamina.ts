// 体力系统：跨平台存储持久化。开局消耗 STAMINA_COST；未满时每 STAMINA_REGEN_MS 自动 +1（上限 STAMINA_MAX）。
import { isWeChat } from './platform';
import { storeGet, storeSet, parseStoredJson, safeNumber } from './storage';

const KEY = 'dasheng.stamina';
/** Web 50 / 微信小游戏 30 */
export const STAMINA_MAX = isWeChat ? 30 : 50;
export const STAMINA_COST = 5;
/** 未满体时恢复间隔：10 分钟回 1 点 */
export const STAMINA_REGEN_MS = 10 * 60 * 1000;

export interface Stamina {
  value: number;
  /** 上次计入恢复的时间戳（ms）；未满时按间隔累加 */
  lastTick: number;
}

function save(s: Stamina): Stamina {
  try {
    storeSet(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  return s;
}

/** 按 lastTick 结算已过间隔的恢复；满体时不累计 */
export function syncStamina(s: Stamina): Stamina {
  if (s.value >= STAMINA_MAX) return s;
  const now = Date.now();
  const gained = Math.floor((now - s.lastTick) / STAMINA_REGEN_MS);
  if (gained <= 0) return s;
  const value = Math.min(STAMINA_MAX, s.value + gained);
  // 满体后重置时钟；未满则推进已结算的整数间隔，保留余数进度
  const lastTick = value >= STAMINA_MAX ? now : s.lastTick + gained * STAMINA_REGEN_MS;
  return save({ value, lastTick });
}

const DEFAULT_STAMINA: Stamina = { value: STAMINA_MAX, lastTick: Date.now() };

function normalizeStamina(raw: unknown): Stamina | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.value !== 'number') return null;
  const value = Math.floor(safeNumber(s.value, STAMINA_MAX, 0, STAMINA_MAX));
  const lastTick = safeNumber(s.lastTick, Date.now(), 0);
  return syncStamina({ value, lastTick });
}

export function loadStamina(): Stamina {
  const loaded = parseStoredJson(storeGet(KEY), normalizeStamina, DEFAULT_STAMINA);
  return save(loaded);
}

export function addStamina(s: Stamina, n: number): Stamina {
  s = syncStamina(s);
  const value = Math.min(STAMINA_MAX, s.value + n);
  // 补满后停表，避免离满体瞬间再结算历史间隔
  const lastTick = value >= STAMINA_MAX ? Date.now() : s.lastTick;
  return save({ value, lastTick });
}

export function spendStamina(s: Stamina): { ok: boolean; state: Stamina } {
  s = syncStamina(s);
  if (s.value < STAMINA_COST) return { ok: false, state: s };
  const value = s.value - STAMINA_COST;
  // 从满体扣下时开始计时；否则保留当前恢复进度
  const lastTick = s.value >= STAMINA_MAX ? Date.now() : s.lastTick;
  return { ok: true, state: save({ value, lastTick }) };
}
