// 轻量 API 客户端：同源 /api 或 VITE_API_BASE。
import { ensureUserId } from '../user-id';
import { getToken } from '../auth-token';

declare const __API_BASE__: string | undefined;

function apiBase(): string {
  try {
    if (typeof __API_BASE__ === 'string' && __API_BASE__) return __API_BASE__.replace(/\/$/, '');
  } catch {
    /* ignore */
  }
  const env = (import.meta as ImportMeta & { env?: { VITE_API_BASE?: string } }).env;
  const fromEnv = env?.VITE_API_BASE;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return '';
}

export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; status: number; error: string };

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { uid?: string | null } = {},
): Promise<ApiResult<T>> {
  const uid = init.uid === undefined ? ensureUserId() : init.uid;
  const headers = new Headers(init.headers || {});
  if (uid) headers.set('X-Uid', uid);
  // 会话令牌：登录后带 Bearer，服务端据此校验账号身份（无 token 则匿名走 X-Uid）。
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const url = `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const res = await fetch(url, { ...init, headers });
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const err =
        data && typeof data === 'object' && data !== null && 'error' in data
          ? JSON.stringify((data as { error: unknown }).error)
          : `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: err };
    }
    return { ok: true, data: data as T, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
