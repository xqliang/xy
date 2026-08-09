// 游戏设置持久化：伤害飘字、音乐/音效开关与音量。
import { storeGet, storeSet, parseStoredJson } from './storage';

const KEY = 'dasheng.settings';
const LEGACY_MUSIC_KEY = 'dasheng.music';

export interface GameSettings {
  showDamageNumbers: boolean;
  musicEnabled: boolean;
  sfxEnabled: boolean;
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
}

const DEFAULTS: GameSettings = {
  showDamageNumbers: true,
  musicEnabled: true,
  sfxEnabled: true,
  musicVolume: 0.7,
  sfxVolume: 0.8,
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function readBool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

/** 合并默认值并校验字段，避免 localStorage 脏数据拖垮运行时 */
export function normalizeSettings(raw: Partial<GameSettings> = {}): GameSettings {
  return {
    showDamageNumbers: readBool(raw.showDamageNumbers, DEFAULTS.showDamageNumbers),
    musicEnabled: readBool(raw.musicEnabled, DEFAULTS.musicEnabled),
    sfxEnabled: readBool(raw.sfxEnabled, DEFAULTS.sfxEnabled),
    musicVolume: clamp01(
      typeof raw.musicVolume === 'number' ? raw.musicVolume : DEFAULTS.musicVolume,
    ),
    sfxVolume: clamp01(typeof raw.sfxVolume === 'number' ? raw.sfxVolume : DEFAULTS.sfxVolume),
  };
}

function normalizeStoredSettings(raw: unknown): GameSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const partial = raw as Partial<GameSettings>;
  const normalized = normalizeSettings(partial);
  if (typeof partial.musicEnabled !== 'boolean' && storeGet(LEGACY_MUSIC_KEY) === '0') {
    return { ...normalized, musicEnabled: false };
  }
  return normalized;
}

export function loadSettings(): GameSettings {
  return parseStoredJson(storeGet(KEY), normalizeStoredSettings, { ...DEFAULTS });
}

function save(s: GameSettings): GameSettings {
  const normalized = normalizeSettings(s);
  try {
    storeSet(KEY, JSON.stringify(normalized));
  } catch {
    /* ignore */
  }
  return normalized;
}

export function setShowDamageNumbers(current: GameSettings, on: boolean): GameSettings {
  return updateSettings({ ...current, showDamageNumbers: on });
}

export function setMusicEnabled(current: GameSettings, on: boolean): GameSettings {
  return updateSettings({ ...current, musicEnabled: on });
}

export function setSfxEnabled(current: GameSettings, on: boolean): GameSettings {
  return updateSettings({ ...current, sfxEnabled: on });
}

export function setMusicVolume(current: GameSettings, v: number): GameSettings {
  return updateSettings({ ...current, musicVolume: clamp01(v) });
}

export function setSfxVolume(current: GameSettings, v: number): GameSettings {
  return updateSettings({ ...current, sfxVolume: clamp01(v) });
}

let cached: GameSettings | null = null;

export function getSettings(): GameSettings {
  if (!cached) cached = loadSettings();
  return cached;
}

export function updateSettings(next: GameSettings): GameSettings {
  cached = save(next);
  return cached;
}

export function patchSettings(patch: Partial<GameSettings>): GameSettings {
  return updateSettings({ ...getSettings(), ...patch });
}

/** 恢复默认设置（localStorage 异常时可由控制台或调试入口调用） */
export function resetSettings(): GameSettings {
  cached = save({ ...DEFAULTS });
  return cached;
}
