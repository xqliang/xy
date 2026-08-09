// 本地用户标识：由平台登录等写入；设置页只展示已存在的 uid。
import { storeGet, storeSet } from './storage';

const KEY = 'dasheng.uid';

function isValidUid(raw: string | null): raw is string {
  return !!raw && /^\d{8,20}$/.test(raw);
}

/** 读取已持久化的 uid；缺失或非法时返回 null（不自动生成） */
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
