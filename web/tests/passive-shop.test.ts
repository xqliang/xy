import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadLoadout,
  buyActive,
  buyPassive,
  equipActive,
  equipPassive,
  unequipActive,
  unequipPassive,
  isEquipped,
  isPassiveEquipped,
  isOwnedActive,
  isOwnedPassive,
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

describe('每日商店：购买一次，卸下/再装备不重复扣费', () => {
  it('被动满 6 个装备槽后仍可购买（仅拥有）；装备需先卸下', () => {
    let lo = loadLoadout();
    let m = merit(9999);
    const ids = ['xiandan', 'fenghuolun', 'fabaofu', 'zhaoxian', 'mojin', 'luoyangchan'];
    for (const id of ids) {
      const r = buyPassive(lo, m, id);
      expect(r.ok).toBe(true);
      lo = r.loadout; m = r.merit;
    }
    const bought = buyPassive(lo, m, 'yunshi');
    expect(bought.ok).toBe(true);
    lo = bought.loadout;
    expect(isOwnedPassive(lo, 'yunshi')).toBe(true);
    expect(isPassiveEquipped(lo, 'yunshi')).toBe(false);
    const blocked = equipPassive(lo, 'yunshi');
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe(PASSIVE_FULL_HINT);
  });

  it('主动满 2 个装备槽后仍可购买；装备需先卸下', () => {
    let lo = loadLoadout();
    let m = merit(9999);
    for (const id of ['act_palm', 'act_meteor']) {
      const r = buyActive(lo, m, id);
      expect(r.ok).toBe(true);
      lo = r.loadout; m = r.merit;
    }
    const bought = buyActive(lo, m, 'act_atk');
    expect(bought.ok).toBe(true);
    lo = bought.loadout;
    expect(isOwnedActive(lo, 'act_atk')).toBe(true);
    expect(isEquipped(lo, 'act_atk')).toBe(false);
    const blocked = equipActive(lo, 'act_atk');
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe(ACTIVE_FULL_HINT);
  });

  it('卸下后可再装备，不扣功德', () => {
    let lo = loadLoadout();
    let m = merit(9999);
    lo = buyActive(lo, m, 'act_palm').loadout;
    const r1 = buyActive(lo, merit(9999), 'act_meteor');
    lo = r1.loadout;
    const meritBefore = r1.merit.merit;
    lo = unequipActive(lo, 'act_palm');
    expect(isEquipped(lo, 'act_palm')).toBe(false);
    expect(isOwnedActive(lo, 'act_palm')).toBe(true);
    const eq = equipActive(lo, 'act_palm');
    expect(eq.ok).toBe(true);
    expect(isEquipped(eq.loadout, 'act_palm')).toBe(true);
    // 再装备不走 spendMerit；余额不变（此处未再调用 buy）
    expect(meritBefore).toBe(r1.merit.merit);
  });

  it('被动卸下后可再装备', () => {
    let lo = loadLoadout();
    let m = merit(9999);
    const ids = ['xiandan', 'fenghuolun', 'fabaofu', 'zhaoxian', 'mojin', 'luoyangchan'];
    for (const id of ids) {
      const r = buyPassive(lo, m, id);
      lo = r.loadout; m = r.merit;
    }
    lo = unequipPassive(lo, 'xiandan');
    expect(isOwnedPassive(lo, 'xiandan')).toBe(true);
    const eq = equipPassive(lo, 'xiandan');
    expect(eq.ok).toBe(true);
    expect(isPassiveEquipped(eq.loadout, 'xiandan')).toBe(true);
  });

  it('功德不足则不购买', () => {
    const lo = loadLoadout();
    const r = buyPassive(lo, merit(0), 'xiandan');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('功德不足');
    expect(r.loadout.ownedPassives.length).toBe(0);
  });

  it('今日已购买不可重复购买', () => {
    const lo0 = loadLoadout();
    const r1 = buyPassive(lo0, merit(9999), 'xiandan');
    const r2 = buyPassive(r1.loadout, r1.merit, 'xiandan');
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('今日已购买');
  });

  it('跨天清空拥有与装备', () => {
    localStorage.setItem('dasheng.loadout', JSON.stringify({
      day: 0,
      ownedActives: ['act_palm'],
      ownedPassives: ['xiandan'],
      equipped: ['act_palm'],
      passives: ['xiandan'],
    }));
    const lo = loadLoadout();
    expect(lo.equipped).toEqual([]);
    expect(lo.passives).toEqual([]);
    expect(lo.ownedActives).toEqual([]);
    expect(lo.ownedPassives).toEqual([]);
  });

  it('旧存档无 owned 字段时，装备项迁移为已拥有', () => {
    const day = Math.floor(Date.now() / 86400000);
    localStorage.setItem(
      'dasheng.loadout',
      JSON.stringify({ day, equipped: ['act_palm'], passives: ['xiandan'] }),
    );
    const lo = loadLoadout();
    expect(lo.ownedActives).toEqual(['act_palm']);
    expect(lo.ownedPassives).toEqual(['xiandan']);
    expect(lo.equipped).toEqual(['act_palm']);
    expect(lo.passives).toEqual(['xiandan']);
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

  it('loadLoadout 剔除已下架装备与拥有', async () => {
    const { ACTIVE_SKILLS } = await import('../src/actives');
    const act = ACTIVE_SKILLS.find((a) => a.id === 'act_palm')!;
    const prev = act.disabled;
    act.disabled = true;
    try {
      const day = Math.floor(Date.now() / 86400000);
      localStorage.setItem(
        'dasheng.loadout',
        JSON.stringify({
          day,
          ownedActives: ['act_palm', 'act_meteor'],
          ownedPassives: ['xiandan'],
          equipped: ['act_palm', 'act_meteor'],
          passives: ['xiandan'],
        }),
      );
      const lo = loadLoadout();
      expect(lo.ownedActives).toEqual(['act_meteor']);
      expect(lo.equipped).toEqual(['act_meteor']);
      expect(lo.passives).toEqual(['xiandan']);
    } finally {
      act.disabled = prev;
    }
  });
});
