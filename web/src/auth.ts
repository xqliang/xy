// 平台登录编排：换取会话令牌，安置本机 uid。昵称/存档仍由随后的 cloudLogin 负责（本模块不碰）。
import { apiFetch } from './api/client';
import { getToken, saveToken, clearToken } from './auth-token';
import { wxLogin } from './platform';
import { ensureUserId, loadUserId, saveUserId } from './user-id';

export { getToken, clearToken };

export interface AuthLoginResp {
  token: string;
  expiresAt?: string;
  uid: string;
  nickname?: string | null;
  avatarId: string;
  unlockedAvatars: string[];
  saveJson?: string | null;
  saveUpdatedAt?: number | null;
}

/** 纯函数：按平台拼登录请求体。wx 带 code（可能为空，服务端会拒）；两端都带本机 uid（wx 用于迁移）。 */
export function loginRequestBody(
  isWx: boolean, code: string | null, localUid: string,
): { platform: 'wx' | 'web'; code?: string; uid: string } {
  if (isWx) return { platform: 'wx', code: code ?? '', uid: localUid };
  return { platform: 'web', uid: localUid };
}

/** 应用登录响应：存 token；若服务端返回的 uid 与本机不同（微信命中既有绑定）→ 切换本机 uid。 */
export function applyLoginResponse(resp: AuthLoginResp): void {
  if (resp.token) saveToken(resp.token);
  if (resp.uid && resp.uid !== loadUserId()) saveUserId(resp.uid);
}

/** 启动登录：微信 wx.login 拿 code→换 token；Web 用本机 uid TOFU。失败回退匿名，不阻塞进游戏。 */
export async function bootstrapAuth(): Promise<void> {
  const localUid = ensureUserId();
  let code: string | null = null;
  try { code = await wxLogin(); } catch { code = null; }
  const isWx = code !== null;   // wxLogin 仅微信下返回非 null
  const body = loginRequestBody(isWx, code, localUid);
  const res = await apiFetch<AuthLoginResp>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    uid: localUid,               // 灰度期同时带 X-Uid（apiFetch 默认行为）
  });
  if (res.ok) applyLoginResponse(res.data);
  // 失败：无 token，后续 apiFetch 回退 X-Uid（灰度期服务端允许）；strict 期由服务端 401，属预期需真机联调
}
