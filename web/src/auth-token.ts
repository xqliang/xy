// 会话令牌的本地读写。单独成文件：api/client.ts 只依赖它，避免与 auth.ts（依赖 apiFetch）循环。
import { storeGet, storeSet, storeRemove } from './storage';

const TOKEN_KEY = 'dasheng.token';

/** 读取会话令牌；无则 null。 */
export function getToken(): string | null {
  const t = storeGet(TOKEN_KEY);
  return t && t.length > 0 ? t : null;
}

/** 写入令牌；空串等价清除。 */
export function saveToken(token: string): void {
  if (!token) { storeRemove(TOKEN_KEY); return; }
  storeSet(TOKEN_KEY, token);
}

/** 清除令牌（401 时触发下次重登）。 */
export function clearToken(): void {
  storeRemove(TOKEN_KEY);
}
