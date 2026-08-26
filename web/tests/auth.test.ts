import { describe, it, expect, beforeEach } from 'vitest';
import { getToken, saveToken, clearToken } from '../src/auth-token';
import { loginRequestBody, applyLoginResponse } from '../src/auth';
import { loadUserId } from '../src/user-id';

// 仿 battle-save.test.ts：node 环境装内存版 localStorage
function installMemStorage(): void {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  } as Storage;
}

describe('auth-token 本地读写', () => {
  beforeEach(() => { installMemStorage(); });

  it('save→get 往返；clear 后为 null', () => {
    expect(getToken()).toBeNull();
    saveToken('abc123');
    expect(getToken()).toBe('abc123');
    clearToken();
    expect(getToken()).toBeNull();
  });

  it('saveToken 空串按清除处理', () => {
    saveToken('x');
    saveToken('');
    expect(getToken()).toBeNull();
  });
});

describe('auth 登录请求体（纯函数）', () => {
  it('wx 平台带 code 与本机 uid', () => {
    expect(loginRequestBody(true, 'CODE1', '1000000000000001'))
      .toEqual({ platform: 'wx', code: 'CODE1', uid: '1000000000000001' });
  });
  it('web 平台只带 uid，不带 code', () => {
    expect(loginRequestBody(false, null, '1000000000000002'))
      .toEqual({ platform: 'web', uid: '1000000000000002' });
  });
});

describe('auth 应用登录响应', () => {
  beforeEach(() => { installMemStorage(); });

  it('存 token；服务端返回不同 uid 时切换本机 uid', () => {
    applyLoginResponse({ token: 'tk1', uid: '1000000000000777', avatarId: 'wukong', unlockedAvatars: [] });
    expect(getToken()).toBe('tk1');
    expect(loadUserId()).toBe('1000000000000777');
  });
});

import { vi } from 'vitest';
import { apiFetch } from '../src/api/client';
import { saveToken as _saveToken } from '../src/auth-token';
import { buildWsUrl } from '../src/pvp-ws';

describe('apiFetch 带 Authorization', () => {
  beforeEach(() => { installMemStorage(); });

  it('有 token 时带 Bearer 头', async () => {
    _saveToken('tok-xyz');
    const spy = vi.fn(async () => new Response('{}', { status: 200 }));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = spy as unknown as typeof fetch;
    await apiFetch('/api/player/me', { method: 'GET' });
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer tok-xyz');
  });
});

describe('buildWsUrl 带 token', () => {
  it('token 存在时追加 &token=', () => {
    const url = buildWsUrl('M1', 'A1', 'tok-1');
    expect(url).toContain('matchId=M1');
    expect(url).toContain('uid=A1');
    expect(url).toContain('token=tok-1');
  });
  it('无 token 时不追加', () => {
    expect(buildWsUrl('M1', 'A1')).not.toContain('token=');
  });
});
