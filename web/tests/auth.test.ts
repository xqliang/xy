import { describe, it, expect, beforeEach } from 'vitest';
import { getToken, saveToken, clearToken } from '../src/auth-token';

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
