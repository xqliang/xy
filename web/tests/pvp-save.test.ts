import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildSessionSave, readSession, clearSessionSave,
  sessionSaveCheckpoint, SESSION_SAVE_MIN_INTERVAL_MS, SESSION_SAVE_MAX_INTERVAL_MS,
  type SessionSaveV1,
} from '../src/pvp-save';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';

// 仿 battle-save.test.ts：本仓 vitest 跑在 node 环境（未装 jsdom），原生无 localStorage，
// 故在模块加载时装一份内存版，供下方用例（及 beforeEach 的 localStorage.clear）直接使用。
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

function makePveBattle(seed = 7): Battle {
  const b = new Battle(seed, 1, mapById('pansidong'));
  b.startNextWave();
  for (let i = 0; i < 60; i++) b.step(1 / 30);
  return b;
}

beforeEach(() => { localStorage.clear(); });

describe('pvp-save 读写往返', () => {
  it('build→read 往返保留 wave 与 RNG 态', () => {
    const b = makePveBattle();
    const save = buildSessionSave('pve', b, { seed: 7, mapId: 'pansidong' });
    localStorage.setItem('dasheng.session', JSON.stringify(save));
    const back = readSession();
    expect(back).not.toBeNull();
    expect(back!.kind).toBe('pve');
    expect(back!.core.wave).toBe(b.wave);
    expect(back!.core.rngS).toEqual(b.serialize().core.rngS);
  });

  it('版本/结构校验：缺 core 或版本不符返回 null', () => {
    localStorage.setItem('dasheng.session', JSON.stringify({ v: 999 }));
    expect(readSession()).toBeNull();
    localStorage.setItem('dasheng.session', 'not json{');
    expect(readSession()).toBeNull();
  });

  it('终局(won/lost)不写', () => {
    const b = makePveBattle();
    b.status = 'won';
    const wrote = sessionSaveCheckpoint('pve', b, { seed: 7, mapId: 'pansidong' });
    expect(wrote).toBe(false);
    expect(localStorage.getItem('dasheng.session')).toBeNull();
  });
});

describe('pvp-save 节流', () => {
  it('dirty 后未过 MIN 间隔不写；force 过 MAX 间隔必写', () => {
    const b = makePveBattle();
    const base = { seed: 7, mapId: 'pansidong' };
    expect(sessionSaveCheckpoint('pve', b, base, { now: 1000, force: true })).toBe(true);
    const first = localStorage.getItem('dasheng.session');
    expect(sessionSaveCheckpoint('pve', b, base, { now: 1000 + SESSION_SAVE_MIN_INTERVAL_MS - 1, dirty: true })).toBe(false);
    expect(localStorage.getItem('dasheng.session')).toBe(first);
    expect(sessionSaveCheckpoint('pve', b, base, { now: 1000 + SESSION_SAVE_MAX_INTERVAL_MS + 1 })).toBe(true);
  });
});
