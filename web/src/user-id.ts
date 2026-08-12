// 本地用户标识：缺失时自动生成匿名 UID；个人信息页可展示/复制。
import { storeGet, storeSet } from './storage';

const KEY = 'dasheng.uid';

function isValidUid(raw: string | null): raw is string {
  return !!raw && /^\d{8,20}$/.test(raw);
}

function randomUid(): string {
  // 16 位数字，避免前导 0
  let s = String(1 + Math.floor(Math.random() * 9));
  for (let i = 0; i < 15; i++) s += String(Math.floor(Math.random() * 10));
  return s;
}

/** 读取已持久化的 uid；缺失或非法时返回 null */
export function loadUserId(): string | null {
  const cached = storeGet(KEY);
  return isValidUid(cached) ? cached : null;
}

/** 平台登录等场景写入 uid */
export function saveUserId(uid: string): string | null {
  if (!isValidUid(uid)) return null;
  try {
    storeSet(KEY, uid);
  } catch {
    return null;
  }
  return uid;
}

/** 保证有合法 UID：已有则返回，否则生成并持久化 */
export function ensureUserId(): string {
  const existing = loadUserId();
  if (existing) return existing;
  for (let i = 0; i < 5; i++) {
    const uid = randomUid();
    if (saveUserId(uid)) return uid;
  }
  // 极端：storage 失败时仍返回内存 UID
  return randomUid();
}

export async function copyUserId(uid: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(uid);
      return true;
    }
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = uid;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
