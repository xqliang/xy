import { describe, it, expect, beforeEach } from 'vitest';
import { loadEndlessEnabled, setEndlessEnabled, getBestWave, recordBestWave } from '../src/endless';

// vitest 默认 node 环境无 localStorage；storage.ts 在无 wx 时走 localStorage。
// 注入内存版 stub（不引入 jsdom 依赖），使 storeGet/storeSet 可往返。
beforeEach(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  } as Storage;
});

describe('endless persistence', () => {
  it('开关默认关闭，可开启并持久化', () => {
    expect(loadEndlessEnabled()).toBe(false);
    setEndlessEnabled(true);
    expect(loadEndlessEnabled()).toBe(true);
    setEndlessEnabled(false);
    expect(loadEndlessEnabled()).toBe(false);
  });

  it('最高波数默认 0', () => {
    expect(getBestWave()).toBe(0);
  });

  it('recordBestWave 仅在更高时更新并返回是否破纪录', () => {
    expect(recordBestWave(5)).toBe(true);
    expect(getBestWave()).toBe(5);
    expect(recordBestWave(3)).toBe(false);
    expect(getBestWave()).toBe(5);
    expect(recordBestWave(9)).toBe(true);
    expect(getBestWave()).toBe(9);
  });
});
