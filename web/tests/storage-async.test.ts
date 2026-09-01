import { describe, it, expect, beforeEach, vi } from 'vitest';

// 仿 pvp-save.test.ts：node 环境无原生 localStorage，装一份内存版。
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
installMemStorage();

describe('storeSetAsync 异步落档写入', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (globalThis as Record<string, unknown>).wx;
  });

  it('Web/无 wx 环境：行为与 storeSet 一致（同步写 localStorage，写后立即可读）', async () => {
    const { storeSetAsync } = await import('../src/storage');
    storeSetAsync('k1', 'v1');
    expect(localStorage.getItem('k1')).toBe('v1');
  });

  it('wx 环境：走 wx.setStorage 异步分支，绝不碰同步 setStorageSync（IPC 阻塞源）', async () => {
    const calls: { key: string; data: string }[] = [];
    const syncCalls: string[] = [];
    (globalThis as Record<string, unknown>).wx = {
      getStorageSync: () => '',
      setStorageSync: (k: string) => { syncCalls.push(k); },
      setStorage: (o: { key: string; data: string }) => { calls.push({ key: o.key, data: o.data }); },
    };
    // useWxStore 是模块加载时常量 → 先置 wx 再动态 import，确保本用例拿到 wx 分支实现
    vi.resetModules();
    const { storeSetAsync } = await import('../src/storage');
    storeSetAsync('dasheng.session', '{"v":1}');
    expect(calls).toEqual([{ key: 'dasheng.session', data: '{"v":1}' }]);
    expect(syncCalls).toEqual([]); // 关键断言：同步 IPC 一次都不能碰
  });

  it('wx.setStorage 抛错/缺方法时静默兜底：不抛错、web 路径不误伤', async () => {
    (globalThis as Record<string, unknown>).wx = {
      getStorageSync: () => '',
      setStorage: () => { throw new Error('boom'); },
    };
    vi.resetModules();
    const { storeSetAsync } = await import('../src/storage');
    expect(() => storeSetAsync('k', 'v')).not.toThrow();
  });

  it('wx 环境缺 setStorage（旧内核）：回退同步 setStorageSync，保住持久化', async () => {
    const syncCalls: { key: string; data: string }[] = [];
    (globalThis as Record<string, unknown>).wx = {
      getStorageSync: () => '',
      setStorageSync: (k: string, v: string) => { syncCalls.push({ key: k, data: v }); },
      // 无 setStorage
    };
    vi.resetModules();
    const { storeSetAsync } = await import('../src/storage');
    storeSetAsync('k2', 'v2');
    expect(syncCalls).toEqual([{ key: 'k2', data: 'v2' }]);
  });
});
