import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadLoadout,
  buyActive,
  buyPassive,
  unequipActive,
  unequipPassive,
  isEquipped,
  isPassiveEquipped,
  ACTIVE_FULL_HINT,
  PASSIVE_FULL_HINT,
} from '../src/loadout';
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

describe('每日商店购买：满额需先禁用腾位', () => {
  it('被动满 6 个后再买会提示需先禁用', () => {
    let lo = loadLoadout();
    let m = merit(9999);
    const ids = ['xiandan', 'fenghuolun', 'fabaofu', 'zhaoxian', 'mojin', 'luoyangchan'];
    for (const id of ids) {
      const r = buyPassive(lo, m, id);
      expect(r.ok).toBe(true);
      lo = r.loadout; m = r.merit;
    }
    const blocked = buyPassive(lo, m, 'yunshi');
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe(PASSIVE_FULL_HINT);
    expect(lo.passives).toEqual(ids);
  });

  it('主动满 2 个后再买会提示需先禁用', () => {
    let lo = loadLoadout();
    let m = merit(9999);
    for (const id of ['act_palm', 'act_meteor']) {
      const r = buyActive(lo, m, id);
      expect(r.ok).toBe(true);
      lo = r.loadout; m = r.merit;
    }
    const blocked = buyActive(lo, m, 'act_atk');
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe(ACTIVE_FULL_HINT);
    expect(lo.equipped).toEqual(['act_palm', 'act_meteor']);
  });

  it('禁用后可再购买', () => {
    let lo = loadLoadout();
    let m = merit(9999);
    lo = buyActive(lo, m, 'act_palm').loadout;
    const r1 = buyActive(lo, merit(9999), 'act_meteor');
    lo = r1.loadout; m = r1.merit;
    lo = unequipActive(lo, 'act_palm');
    expect(isEquipped(lo, 'act_palm')).toBe(false);
    const r2 = buyActive(lo, m, 'act_atk');
    expect(r2.ok).toBe(true);
    expect(r2.loadout.equipped).toEqual(['act_meteor', 'act_atk']);
  });

  it('被动禁用后可再购买', () => {
    let lo = loadLoadout();
    let m = merit(9999);
    const ids = ['xiandan', 'fenghuolun', 'fabaofu', 'zhaoxian', 'mojin', 'luoyangchan'];
    for (const id of ids) {
      const r = buyPassive(lo, m, id);
      lo = r.loadout; m = r.merit;
    }
    lo = unequipPassive(lo, 'xiandan');
    const r = buyPassive(lo, m, 'yunshi');
    expect(r.ok).toBe(true);
    expect(isPassiveEquipped(r.loadout, 'yunshi')).toBe(true);
    expect(isPassiveEquipped(r.loadout, 'xiandan')).toBe(false);
  });

  it('功德不足则不购买', () => {
    const lo = loadLoadout();
    const r = buyPassive(lo, merit(0), 'xiandan');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('功德不足');
    expect(r.loadout.passives.length).toBe(0);
  });

  it('已启用的技能不可重复购买', () => {
    const lo0 = loadLoadout();
    const r1 = buyPassive(lo0, merit(9999), 'xiandan');
    const r2 = buyPassive(r1.loadout, r1.merit, 'xiandan');
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('已启用');
  });

  it('跨天清空装备', () => {
    localStorage.setItem('dasheng.loadout', JSON.stringify({ day: 0, equipped: ['act_palm'], passives: ['xiandan'] }));
    const lo = loadLoadout();
    expect(lo.equipped).toEqual([]);
    expect(lo.passives).toEqual([]);
  });

  it('disabled 技能不可购买', async () => {
    const { ACTIVE_SKILLS } = await import('../src/actives');
    const { PASSIVE_SKILLS } = await import('../src/passives');
    const act = ACTIVE_SKILLS.find((a) => a.id === 'act_palm')!;
    const pas = PASSIVE_SKILLS.find((p) => p.id === 'xiandan')!;
    const prevAct = act.disabled;
    const prevPas = pas.disabled;
    act.disabled = true;
    pas.disabled = true;
    try {
      const lo = loadLoadout();
      const ra = buyActive(lo, merit(9999), 'act_palm');
      expect(ra.ok).toBe(false);
      expect(ra.reason).toBe('技能已下架');
      const rp = buyPassive(lo, merit(9999), 'xiandan');
      expect(rp.ok).toBe(false);
      expect(rp.reason).toBe('技能已下架');
    } finally {
      act.disabled = prevAct;
      pas.disabled = prevPas;
    }
  });

  it('loadLoadout 剔除已下架装备', async () => {
    const { ACTIVE_SKILLS } = await import('../src/actives');
    const act = ACTIVE_SKILLS.find((a) => a.id === 'act_palm')!;
    const prev = act.disabled;
    act.disabled = true;
    try {
      const day = Math.floor(Date.now() / 86400000);
      localStorage.setItem(
        'dasheng.loadout',
        JSON.stringify({ day, equipped: ['act_palm', 'act_meteor'], passives: ['xiandan'] }),
      );
      const lo = loadLoadout();
      expect(lo.equipped).toEqual(['act_meteor']);
      expect(lo.passives).toEqual(['xiandan']);
    } finally {
      act.disabled = prev;
    }
  });
});
