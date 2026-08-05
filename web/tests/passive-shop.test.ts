import { describe, it, expect, beforeEach } from 'vitest';
import { loadLoadout, buyActive, buyPassive, isEquipped, isPassiveEquipped } from '../src/loadout';
import type { MeritState } from '../src/merit';

// vitest 默认 node 环境无 localStorage；storage.ts 在非 wx 时走 localStorage 分支，
// 这里注入一个内存版，让 loadout 的读写/跨天逻辑可测。
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

const merit = (n: number): MeritState => ({ merit: n, levels: {} });

describe('每日商店购买：不限次数 + 最新N生效(FIFO挤旧)', () => {
  it('被动仅保留最新6个，最早的被挤出', () => {
    let lo = loadLoadout();
    let m = merit(9999);
    const ids = ['xiandan', 'fenghuolun', 'fabaofu', 'zhaoxian', 'mojin', 'luoyangchan', 'yunshi'];
    for (const id of ids) {
      const r = buyPassive(lo, m, id);
      expect(r.ok).toBe(true);
      lo = r.loadout; m = r.merit;
    }
    expect(lo.passives.length).toBe(6);
    expect(lo.passives).toEqual(ids.slice(1)); // 最早的 xiandan 被挤出
    expect(isPassiveEquipped(lo, 'xiandan')).toBe(false);
    expect(isPassiveEquipped(lo, 'yunshi')).toBe(true);
  });

  it('主动仅保留最新2个', () => {
    let lo = loadLoadout();
    let m = merit(9999);
    for (const id of ['act_palm', 'act_meteor', 'act_atk']) {
      const r = buyActive(lo, m, id);
      expect(r.ok).toBe(true);
      lo = r.loadout; m = r.merit;
    }
    expect(lo.equipped).toEqual(['act_meteor', 'act_atk']);
    expect(isEquipped(lo, 'act_palm')).toBe(false);
  });

  it('功德不足则不购买', () => {
    const lo = loadLoadout();
    const r = buyPassive(lo, merit(0), 'xiandan');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('功德不足');
    expect(r.loadout.passives.length).toBe(0);
  });

  it('已生效的技能不可重复购买', () => {
    const lo0 = loadLoadout();
    const r1 = buyPassive(lo0, merit(9999), 'xiandan');
    const r2 = buyPassive(r1.loadout, r1.merit, 'xiandan');
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('已装备');
  });

  it('跨天清空装备', () => {
    localStorage.setItem('dasheng.loadout', JSON.stringify({ day: 0, equipped: ['act_palm'], passives: ['xiandan'] }));
    const lo = loadLoadout();
    expect(lo.equipped).toEqual([]);
    expect(lo.passives).toEqual([]);
  });
});
