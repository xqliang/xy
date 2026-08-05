// 体力系统：跨平台存储持久化。每日回满到上限；看广告/分享补充；开始游戏消耗 1。
import { storeGet, storeSet } from './storage';
const KEY = 'dasheng.stamina';
export const STAMINA_MAX = 30;

export interface Stamina {
  value: number;
  day: number;
}

function today(): number {
  return Math.floor(Date.now() / 86400000);
}

export function loadStamina(): Stamina {
  try {
    const raw = storeGet(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (typeof s.value === 'number' && typeof s.day === 'number') {
        if (s.day !== today()) return save({ value: Math.max(s.value, STAMINA_MAX), day: today() }); // 跨天回满
        return s;
      }
    }
  } catch {
    /* ignore */
  }
  return save({ value: STAMINA_MAX, day: today() });
}

function save(s: Stamina): Stamina {
  try {
    storeSet(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  return s;
}

export function addStamina(s: Stamina, n: number): Stamina {
  return save({ value: Math.min(99, s.value + n), day: s.day });
}

export function spendStamina(s: Stamina): { ok: boolean; state: Stamina } {
  if (s.value <= 0) return { ok: false, state: s };
  return { ok: true, state: save({ value: s.value - 1, day: s.day }) };
}
