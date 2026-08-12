import { storeGet, storeSet, safeNumber } from './storage';

const KEY = 'dasheng.clearCount';

export function loadClearCount(): number {
  const raw = storeGet(KEY);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function bumpClearCount(): number {
  const n = loadClearCount() + 1;
  storeSet(KEY, String(n));
  return n;
}

/** 云存档合并用 */
export function setClearCount(n: number): void {
  const v = Math.max(0, Math.floor(safeNumber(n, 0)));
  storeSet(KEY, String(v));
}
