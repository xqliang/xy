import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildSessionSave, readSession, clearSessionSave, restoreBattle,
  sessionSaveCheckpoint, SESSION_KEY, SESSION_SAVE_MIN_INTERVAL_MS, SESSION_SAVE_MAX_INTERVAL_MS,
  type SessionSaveV1,
} from '../src/pvp-save';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';

// 仿 battle-save.test.ts：本仓 vitest 跑在 node 环境（未装 jsdom），原生无 localStorage，
// 故在模块加载时装一份内存版。pvp-save 走 ./storage，node 端 ./storage 落到 localStorage，
// 与下方用例直接读写的 localStorage 是同一份内存存储，故读写一致。
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
    const save = buildSessionSave('pve', b, { seed: 7 });
    localStorage.setItem(SESSION_KEY, JSON.stringify(save));
    const back = readSession();
    expect(back).not.toBeNull();
    expect(back!.kind).toBe('pve');
    expect(back!.core.wave).toBe(b.wave);
    expect(back!.core.rngS).toEqual(b.serialize().core.rngS);
  });

  it('版本/结构校验：缺 core 或版本不符返回 null', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ v: 999 }));
    expect(readSession()).toBeNull();
    localStorage.setItem(SESSION_KEY, 'not json{');
    expect(readSession()).toBeNull();
  });

  it('版本/gameVersion 合法但缺 core → null', () => {
    // buildSessionSave 产出的 v/gameVersion/kind 均合法，仅删掉 core，专门验证「缺 core」这条守卫
    const b = makePveBattle();
    const save = buildSessionSave('pve', b, { seed: 7 }) as Partial<SessionSaveV1>;
    delete save.core;
    localStorage.setItem(SESSION_KEY, JSON.stringify(save));
    expect(readSession()).toBeNull();
  });

  it('kind=pvp 但缺 pvp 元信息 → null', () => {
    // 不传 opts.pvp → 结构里没有 pvp 字段；readSession 对 PvP 存档必须要求 pvp 元信息
    const b = makePveBattle();
    const save = buildSessionSave('pvp', b, { seed: 7 });
    expect(save.pvp).toBeUndefined();
    localStorage.setItem(SESSION_KEY, JSON.stringify(save));
    expect(readSession()).toBeNull();
  });

  it('终局(won/lost)不写', () => {
    const b = makePveBattle();
    b.status = 'won';
    const wrote = sessionSaveCheckpoint('pve', b, { seed: 7 });
    expect(wrote).toBe(false);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe('pvp-save 节流', () => {
  it('dirty 后未过 MIN 间隔不写；force 过 MAX 间隔必写', () => {
    const b = makePveBattle();
    const base = { seed: 7 };
    expect(sessionSaveCheckpoint('pve', b, base, { now: 1000, force: true })).toBe(true);
    const first = localStorage.getItem(SESSION_KEY);
    expect(sessionSaveCheckpoint('pve', b, base, { now: 1000 + SESSION_SAVE_MIN_INTERVAL_MS - 1, dirty: true })).toBe(false);
    expect(localStorage.getItem(SESSION_KEY)).toBe(first);
    expect(sessionSaveCheckpoint('pve', b, base, { now: 1000 + SESSION_SAVE_MAX_INTERVAL_MS + 1 })).toBe(true);
  });
});

describe('pvp-save restoreBattle 还原构造参数', () => {
  it('从 config 还原 difficultyMul / aiAdjustIntervalScale（非默认值不丢）', () => {
    // 用非 1 的 difficultyMul(1.5) 与 aiAdjustIntervalScale(2) 构造：这两项只在 config、不在 core，
    // 若 restoreBattle 硬编码 1 就会丢失（怪物强度/AI 节奏走样）。此用例锁死「按 config 还原」。
    const b = new Battle(7, 1.5, mapById('pansidong'), undefined, undefined, undefined, undefined, false, undefined, 2);
    b.startNextWave();
    for (let i = 0; i < 60; i++) b.step(1 / 30);
    const save = buildSessionSave('pve', b, { seed: 7 });
    // 先确认 serialize 如实捕获了非默认 config
    expect(save.config.difficultyMul).toBe(1.5);
    expect(save.config.aiAdjustIntervalScale).toBe(2);
    const rb = restoreBattle(save);
    // difficultyMul 为 public readonly，直接读；aiAdjustIntervalScale 在 Battle 上是 private，用断言读其内部值
    expect(rb.difficultyMul).toBe(save.config.difficultyMul);
    expect((rb as unknown as { aiAdjustIntervalScale: number }).aiAdjustIntervalScale).toBe(save.config.aiAdjustIntervalScale);
  });
});

describe('PvP 对手资料随档持久化（掉线重连结算屏不空）', () => {
  it('pvp 元信息带 opponent → 往返保留；缺省（旧档）容错为 undefined', () => {
    const b = makePveBattle();
    const save = buildSessionSave('pvp', b, {
      seed: 7,
      pvp: {
        matchId: 'm1', uid: 'U1', side: 'a', startAtServerMs: 1000, localSimTick: 12,
        opponent: { nickname: '铁扇公主', avatarId: 'tieshan', rankLevel: 3 },
      },
    });
    localStorage.setItem(SESSION_KEY, JSON.stringify(save));
    const back = readSession();
    expect(back!.pvp!.opponent).toEqual({ nickname: '铁扇公主', avatarId: 'tieshan', rankLevel: 3 });

    // 旧档（无 opponent 字段）：不挡恢复，读回 undefined（调用方回退 null）
    const legacy = { ...save, pvp: { matchId: 'm1', uid: 'U1', side: 'a', startAtServerMs: 1000, localSimTick: 12 } };
    localStorage.setItem(SESSION_KEY, JSON.stringify(legacy));
    const back2 = readSession();
    expect(back2!.pvp!.opponent).toBeUndefined();
  });
});
