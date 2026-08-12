// 本地缓存的云端资料：头像 / 昵称 / 解锁列表。
import { storeGet, storeSet, parseStoredJson, safeStringArray } from './storage';

const KEY = 'dasheng.profile';

export interface ProfileState {
  nickname: string | null;
  avatarId: string;
  unlockedAvatars: string[];
}

const DEFAULT: ProfileState = {
  nickname: null,
  avatarId: 'wukong',
  unlockedAvatars: [],
};

function normalize(raw: unknown): ProfileState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const avatarId = typeof o.avatarId === 'string' && o.avatarId ? o.avatarId : 'wukong';
  const nickname = typeof o.nickname === 'string' && o.nickname ? o.nickname : null;
  const unlockedAvatars = safeStringArray(o.unlockedAvatars);
  return { nickname, avatarId, unlockedAvatars };
}

export function loadProfile(): ProfileState {
  return parseStoredJson(storeGet(KEY), normalize, { ...DEFAULT });
}

export function saveProfile(p: ProfileState): void {
  storeSet(KEY, JSON.stringify(p));
}

export function applyServerProfile(partial: {
  nickname?: string | null;
  avatarId?: string;
  unlockedAvatars?: string[];
}): ProfileState {
  const cur = loadProfile();
  const next: ProfileState = {
    nickname: partial.nickname !== undefined ? partial.nickname : cur.nickname,
    avatarId: partial.avatarId || cur.avatarId,
    unlockedAvatars: partial.unlockedAvatars ?? cur.unlockedAvatars,
  };
  saveProfile(next);
  return next;
}
