import { describe, it, expect, beforeEach } from 'vitest';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';
import { userAgentTick } from '../src/versus-user-agent';
import { writeBattleSave, readBattleSave, clearBattleSave, saveResumeCheckpoint, loadResumeBattle, SAVE_KEY } from '../src/battle-save';
import { storeGet, storeSet } from '../src/storage';

// 仿 play-history.test.ts：node 环境无 localStorage，装内存版。
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

function readyVersus(seed: number, endless = false): Battle {
  const b = new Battle(seed, 1, mapById('huoyanshan'), undefined, undefined, undefined, undefined, endless, 1.0, 1);
  const dt = 1 / 30;
  for (let f = 0; f < 30 * 300; f++) {
    if (b.status === 'ready') { if (b.wave >= 1) return b; b.startNextWave(); }
    else userAgentTick(b);
    b.step(dt);
    if (b.status === 'won' || b.status === 'lost') throw new Error('检查点前终局');
  }
  throw new Error('未到 ready');
}

describe('battle-save 存档编排', () => {
  beforeEach(() => { installMemStorage(); clearBattleSave(); });

  it('write → read 往返：mode/config/core 一致', () => {
    const b = readyVersus(20260823);
    writeBattleSave(b);
    const save = readBattleSave();
    expect(save).not.toBeNull();
    expect(save!.mode).toBe('versus');
    expect(save!.config.endless).toBe(false);
    expect(save!.core.wave).toBe(b.wave);
  });

  it('loadResumeBattle 重建的对局与存档一致', () => {
    const b = readyVersus(4242);
    writeBattleSave(b);
    const r = loadResumeBattle();
    expect(r).not.toBeNull();
    expect(r!.battle.wave).toBe(b.wave);
    expect(r!.battle.status).toBe('ready');
    expect(r!.mapId).toBe('huoyanshan');
  });

  it('版本不匹配 → 丢弃返回 null', () => {
    const b = readyVersus(1);
    writeBattleSave(b);
    const raw = JSON.parse(storeGet(SAVE_KEY)!);
    raw.v = 999;
    storeSet(SAVE_KEY, JSON.stringify(raw));
    expect(readBattleSave()).toBeNull();
  });

  it('gameVersion 不匹配 → 丢弃', () => {
    const b = readyVersus(1);
    writeBattleSave(b);
    const raw = JSON.parse(storeGet(SAVE_KEY)!);
    raw.gameVersion = '0.0.0-old';
    storeSet(SAVE_KEY, JSON.stringify(raw));
    expect(readBattleSave()).toBeNull();
  });

  it('损坏 JSON → 返回 null 不抛', () => {
    storeSet(SAVE_KEY, '{不是合法json');
    expect(readBattleSave()).toBeNull();
  });

  it('终局(status=won/lost)存档不可续 → loadResumeBattle 返回 null', () => {
    const b = readyVersus(7);
    writeBattleSave(b);
    const raw = JSON.parse(storeGet(SAVE_KEY)!);
    raw.core.status = 'lost';
    storeSet(SAVE_KEY, JSON.stringify(raw));
    expect(loadResumeBattle()).toBeNull();
  });

  it('saveResumeCheckpoint 只在 ready 落档、PvP 不落档', () => {
    // 本地 ready → 落档
    const b = readyVersus(2);
    saveResumeCheckpoint(b);
    expect(readBattleSave()).not.toBeNull();
    clearBattleSave();
    // PvP 局 → 不落档
    const pvp = new Battle(3, 1, mapById('huoyanshan'), undefined, undefined, undefined, undefined, false, 1.0, 1, undefined, { enabled: true });
    // 直接把 status 设成 ready 不便；用一个刚构造的 pvp（intro ready）即可
    saveResumeCheckpoint(pvp);
    expect(readBattleSave()).toBeNull();
  });

  it('clearBattleSave 后 read 为 null', () => {
    writeBattleSave(readyVersus(9));
    clearBattleSave();
    expect(readBattleSave()).toBeNull();
  });

  it('saveResumeCheckpoint 同一 ready 窗去重、clear 后可重写', () => {
    const b = readyVersus(321);
    saveResumeCheckpoint(b);
    expect(readBattleSave()).not.toBeNull();
    storeSet(SAVE_KEY, 'SENTINEL');      // 篡改：若再写会被覆盖
    saveResumeCheckpoint(b);             // 同 (mode,wave) → 去重 → 不写
    expect(storeGet(SAVE_KEY)).toBe('SENTINEL');
    clearBattleSave();                   // 重置 lastKey
    saveResumeCheckpoint(b);             // 再次落档
    expect(readBattleSave()).not.toBeNull();
  });

  it('本地 playing（非 ready）不落档', () => {
    const b = new Battle(555, 1, mapById('huoyanshan'), undefined, undefined, undefined, undefined, false, 1.0, 1);
    const dt = 1 / 30;
    let entered = false;
    for (let f = 0; f < 30 * 300; f++) {
      if (b.status === 'ready') b.startNextWave();
      else if (b.status === 'playing') { entered = true; break; }
      b.step(dt);
      if (b.status === 'won' || b.status === 'lost') break;
    }
    expect(entered).toBe(true);          // 确实进入交战态
    saveResumeCheckpoint(b);             // status!=='ready' → 不写
    expect(readBattleSave()).toBeNull();
  });
});
