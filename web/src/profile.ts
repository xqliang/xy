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

// 模块级缓存：主循环每帧都会读 profile（菜单顶栏头像、PvP 匹配页昵称），
// 每次都走同步存储读 + JSON.parse 会白白消耗 CPU（微信端 wx.getStorageSync 还要跨 JS-bridge）。
// 结果几乎不变，缓存一份；所有写入都经 saveProfile/applyServerProfile（全代码库唯一写入口），
// 写时同步刷新缓存，故不会读到脏数据。
let profileCache: ProfileState | null = null;

export function loadProfile(): ProfileState {
  if (profileCache) return profileCache;
  profileCache = parseStoredJson(storeGet(KEY), normalize, { ...DEFAULT });
  return profileCache;
}

export function saveProfile(p: ProfileState): void {
  profileCache = p; // 写时同步缓存，读侧立即可见
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
