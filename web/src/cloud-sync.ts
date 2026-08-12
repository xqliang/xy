// 玩法存档备份与登录合并。
import { apiFetch } from './api/client';
import { storeGet, storeSet } from './storage';
import { loadClearCount, setClearCount } from './clear-count';
import { applyServerProfile, loadProfile } from './profile';
import { loadRank } from './rank';
import { ensureUserId } from './user-id';
import { maskUid } from './avatar-catalog';
import { clampNickname } from './nickname';
import { invalidateLeaderboardCache } from './leaderboard';

const SAVE_TS_KEY = 'dasheng.saveUpdatedAt';
const KEYS = [
  'dasheng.stamina',
  'dasheng.merit',
  'dasheng.rank',
  'dasheng.loadout',
  'dasheng.bag',
  'dasheng.settings',
  'dasheng.map',
  'dasheng.tutorial',
  'dasheng.clearCount',
  'dasheng.profile',
  'endless.enabled',
  'endless.bestWave',
] as const;

export function loadSaveUpdatedAt(): number {
  const n = Number(storeGet(SAVE_TS_KEY) ?? '0');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function touchSaveUpdatedAt(ts = Date.now()): number {
  storeSet(SAVE_TS_KEY, String(ts));
  return ts;
}

export function buildSaveJson(): { saveJson: string; saveUpdatedAt: number } {
  const bag: Record<string, string | null> = {};
  for (const k of KEYS) bag[k] = storeGet(k);
  let ts = loadSaveUpdatedAt();
  if (!ts) ts = touchSaveUpdatedAt();
  return { saveJson: JSON.stringify(bag), saveUpdatedAt: ts };
}

export function applySaveJson(raw: string): void {
  let bag: Record<string, unknown>;
  try {
    bag = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  for (const k of KEYS) {
    const v = bag[k];
    if (typeof v === 'string') storeSet(k, v);
  }
  if (typeof bag['dasheng.clearCount'] === 'string') {
    setClearCount(Number(bag['dasheng.clearCount']) || 0);
  }
  const ts = bag[SAVE_TS_KEY];
  if (typeof ts === 'number' || typeof ts === 'string') {
    storeSet(SAVE_TS_KEY, String(ts));
  }
}

interface LoginResp {
  uid: string;
  nickname: string | null;
  avatarId: string;
  unlockedAvatars: string[];
  saveJson?: string | null;
  saveUpdatedAt?: number | null;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleCloudSync(delayMs = 30_000): void {
  touchSaveUpdatedAt();
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void pushCloudSync();
  }, delayMs);
}

export async function cloudLogin(): Promise<boolean> {
  const res = await apiFetch<LoginResp>('/api/player/login', { method: 'POST', body: '{}' });
  if (!res.ok) return false;
  applyServerProfile({
    nickname: res.data.nickname,
    avatarId: res.data.avatarId,
    unlockedAvatars: res.data.unlockedAvatars,
  });
  const cloudTs = res.data.saveUpdatedAt ?? 0;
  const localTs = loadSaveUpdatedAt();
  if (res.data.saveJson && cloudTs && cloudTs > localTs) {
    applySaveJson(res.data.saveJson);
    storeSet(SAVE_TS_KEY, String(cloudTs));
  } else {
    void pushCloudSync();
  }
  return true;
}

export async function pushCloudSync(): Promise<void> {
  const { saveJson, saveUpdatedAt } = buildSaveJson();
  const res = await apiFetch<{ status: string; saveJson?: string; saveUpdatedAt?: number }>(
    '/api/player/sync',
    {
      method: 'POST',
      body: JSON.stringify({ saveJson, saveUpdatedAt }),
    },
  );
  if (!res.ok) return;
  if (res.data.status === 'server_newer' && res.data.saveJson && res.data.saveUpdatedAt) {
    applySaveJson(res.data.saveJson);
    storeSet(SAVE_TS_KEY, String(res.data.saveUpdatedAt));
  }
}

export async function submitLeaderboard(): Promise<void> {
  const level = loadRank().level;
  await apiFetch('/api/leaderboard/submit', {
    method: 'POST',
    body: JSON.stringify({ rankLevel: level }),
  });
}

export async function syncAvatarUnlocks(): Promise<string[]> {
  const res = await apiFetch<{ newlyUnlocked: string[]; unlockedAvatars: string[] }>(
    '/api/avatar/unlock',
    {
      method: 'POST',
      body: JSON.stringify({
        rankLevel: loadRank().level,
        clearCount: loadClearCount(),
      }),
    },
  );
  if (!res.ok) return [];
  applyServerProfile({ unlockedAvatars: res.data.unlockedAvatars });
  return res.data.newlyUnlocked || [];
}

export async function updateProfile(opts: {
  nickname?: string | null;
  avatarId?: string;
}): Promise<boolean> {
  const body: Record<string, unknown> = {};
  if ('nickname' in opts) body.nickname = opts.nickname != null ? clampNickname(opts.nickname.trim()) || null : null;
  if (opts.avatarId) body.avatarId = opts.avatarId;
  const res = await apiFetch<{
    nickname: string | null;
    avatarId: string;
    unlockedAvatars: string[];
  }>('/api/player/profile', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) return false;
  applyServerProfile({
    nickname: res.data.nickname,
    avatarId: res.data.avatarId,
    unlockedAvatars: res.data.unlockedAvatars,
  });
  // 资料改完后丢掉榜单本地缓存，下次进排行榜会重新拉（服务端也会同步今日快照）
  invalidateLeaderboardCache();
  scheduleCloudSync(1000);
  return true;
}

export function displayName(): string {
  const p = loadProfile();
  if (p.nickname) return p.nickname;
  return maskUid(ensureUserId());
}
