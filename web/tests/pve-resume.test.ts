// PvE「刷新续玩」的核心行为锁：restoreBattle + 存档往返后，恢复出的 Battle 在
// 「恢复瞬间」与存档逐位一致，且「继续步进」与原始 battle 保持前向确定性一致。
// 这是本功能的头号承诺——刷新恢复能忠实还原「波次进行中」的中段状态并继续打。
//
// 说明（勿删）：本仓 vitest 跑在 node 环境（未装 jsdom），原生无 localStorage。
// pvp-save 走 ./storage，node 端 ./storage 落到 localStorage。故与 pvp-save.test.ts
// 一致，在模块加载时装一份内存版 localStorage，使 storeGet/storeSet 与用例直接读写同源。
import { describe, it, expect, beforeEach } from 'vitest';
import { buildSessionSave, restoreBattle, readSession, clearSessionSave, SESSION_KEY } from '../src/pvp-save';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';

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

beforeEach(() => { localStorage.clear(); clearSessionSave(); });

describe('PvE restoreBattle 前向一致', () => {
  it('restore 后 step 与原始 battle 同 seed 同输入推进结果一致', () => {
    // 构造一局、步进到 playing 中段
    const b = new Battle(7, 1, mapById('pansidong'));
    b.startNextWave();
    for (let i = 0; i < 150; i++) b.step(1 / 30); // 进入 playing 中段
    // 落档 → 读回 → 恢复（opts 只带 seed：mapId 已随 serialize 落入 config.mapId，SessionSaveOpts 无 mapId 字段）
    const save = buildSessionSave('pve', b, { seed: 1 });
    localStorage.setItem(SESSION_KEY, JSON.stringify(save));
    const rb = restoreBattle(readSession()!);
    // 断言恢复瞬间状态与存档一致（wave/RNG/怪物数）
    const bs = b.serialize(), rs = rb.serialize();
    expect(rs.core.wave).toBe(bs.core.wave);
    expect(rs.core.rngS).toEqual(bs.core.rngS);
    expect(rs.core.monsters.length).toBe(bs.core.monsters.length);
    // 各自再 step 60 帧，状态应逐位一致（前向确定性）
    for (let i = 0; i < 60; i++) { b.step(1 / 30); rb.step(1 / 30); }
    expect(rb.serialize().core.rngS).toEqual(b.serialize().core.rngS);
    expect(rb.serialize().core.tangsengHP).toBe(b.serialize().core.tangsengHP);
  });

  it('终局(won)恢复后 status 仍为 won（不误当进行中）', () => {
    const b = new Battle(7, 1, mapById('pansidong'));
    b.status = 'won';
    const save = buildSessionSave('pve', b, { seed: 1 });
    localStorage.setItem(SESSION_KEY, JSON.stringify(save));
    const rb = restoreBattle(readSession()!);
    expect(rb.status).toBe('won');
  });
});
