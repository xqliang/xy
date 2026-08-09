// 游戏设置持久化：伤害飘字、音乐/音效开关与音量。
import { storeGet, storeSet } from './storage';

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
  return Math.max(0, Math.min(1, n));
}

export function loadSettings(): GameSettings {
  try {
    const raw = storeGet(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<GameSettings>;
      return {
        showDamageNumbers: s.showDamageNumbers !== false,
        musicEnabled:
          typeof s.musicEnabled === 'boolean'
            ? s.musicEnabled
            : storeGet(LEGACY_MUSIC_KEY) !== '0',
        sfxEnabled: s.sfxEnabled !== false,
        musicVolume: clamp01(typeof s.musicVolume === 'number' ? s.musicVolume : DEFAULTS.musicVolume),
        sfxVolume: clamp01(typeof s.sfxVolume === 'number' ? s.sfxVolume : DEFAULTS.sfxVolume),
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

function save(s: GameSettings): GameSettings {
  try {
    storeSet(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  return s;
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
