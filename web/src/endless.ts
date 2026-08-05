// 无尽模式的本地持久化：开局前的勾选开关 + 历史最高波数。
// 复用 storage.ts 跨平台键值层（Web=localStorage，微信=wx storage），行为一致。
import { storeGet, storeSet } from './storage';

const KEY_ENABLED = 'endless.enabled';
const KEY_BEST = 'endless.bestWave';

// 读取开局前的无尽勾选状态（默认关闭）。
export function loadEndlessEnabled(): boolean {
  return storeGet(KEY_ENABLED) === '1';
}

// 写入无尽勾选状态。
export function setEndlessEnabled(on: boolean): void {
  storeSet(KEY_ENABLED, on ? '1' : '0');
}

// 读取历史最高波数（默认 0）。
export function getBestWave(): number {
  const v = Number(storeGet(KEY_BEST) ?? '0');
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// 若本局波数超过历史最高则更新；返回是否破纪录。
export function recordBestWave(wave: number): boolean {
  if (wave > getBestWave()) {
    storeSet(KEY_BEST, String(Math.floor(wave)));
    return true;
  }
  return false;
}
