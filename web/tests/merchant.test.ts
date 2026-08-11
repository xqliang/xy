import { describe, it, expect } from 'vitest';
import { applyMerchantHit, merchantClosed, openMerchantTest, merchantMaxScroll, merchantApplyWheel, merchantTestScrollAreaContains, type MerchantUiState } from '../src/merchant';
import { VIEW_W } from '../src/render';
import { enabledActives } from '../src/actives';
import { enabledPassives } from '../src/passives';
import { ACTIVE_FULL_HINT, type LoadoutState } from '../src/loadout';
import type { MeritState } from '../src/merit';

const merit: MeritState = { merit: 999 };

function loadout(partial: Partial<LoadoutState>): LoadoutState {
  return {
    day: 0,
    ownedActives: [],
    ownedPassives: [],
    equipped: [],
    passives: [],
    ...partial,
  };
}

function merchant(offers: MerchantUiState['offers']): MerchantUiState {
  return { ...merchantClosed(), open: true, offers };
}

describe('merchant offer actions', () => {
  it('已装备主动技能点击卸下需二次确认后才真正卸下', () => {
    const lo = loadout({
      ownedActives: ['act_jinggu'],
      equipped: ['act_jinggu', 'act_meteor'],
    });
    const m = merchant([{ kind: 'active', id: 'act_jinggu', owned: true }]);
    const r1 = applyMerchantHit({ kind: 'offer', index: 0 }, m, lo, merit);
    // 第一步：只弹出确认，不直接卸下
    expect(r1.loadout.equipped).toEqual(['act_jinggu', 'act_meteor']);
    expect(r1.merchant.confirmUnequip).toEqual({ kind: 'active', id: 'act_jinggu' });
    const r2 = applyMerchantHit({ kind: 'confirmUnequip' }, r1.merchant, r1.loadout, r1.merit);
    expect(r2.loadout.equipped).toEqual(['act_meteor']);
    expect(r2.merchant.confirmUnequip).toBeNull();
    expect(r2.merchant.toast).toBe('');
  });

  it('卸下确认可取消，不影响已装备状态', () => {
    const lo = loadout({
      ownedActives: ['act_jinggu'],
      equipped: ['act_jinggu', 'act_meteor'],
    });
    const m = merchant([{ kind: 'active', id: 'act_jinggu', owned: true }]);
    const r1 = applyMerchantHit({ kind: 'offer', index: 0 }, m, lo, merit);
    const r2 = applyMerchantHit({ kind: 'cancelUnequip' }, r1.merchant, r1.loadout, r1.merit);
    expect(r2.loadout.equipped).toEqual(['act_jinggu', 'act_meteor']);
    expect(r2.merchant.confirmUnequip).toBeNull();
  });

  it('主动槽满时阻止购买并提示', () => {
    const lo = loadout({ equipped: ['act_jinggu', 'act_meteor'] });
    const m = merchant([{ kind: 'active', id: 'act_freeze', owned: false }]);
    const r = applyMerchantHit({ kind: 'offer', index: 0 }, m, lo, merit);
    expect(r.merchant.confirmOffer).toBeNull();
    expect(r.merchant.toast).toBe('');
    expect(r.merit.merit).toBe(999);
  });

  it('已购买未装备且槽满时阻止装备并提示', () => {
    const lo = loadout({
      ownedActives: ['act_freeze'],
      equipped: ['act_jinggu', 'act_meteor'],
    });
    const m = merchant([{ kind: 'active', id: 'act_freeze', owned: true }]);
    const r = applyMerchantHit({ kind: 'offer', index: 0 }, m, lo, merit);
    expect(r.loadout.equipped).toEqual(['act_jinggu', 'act_meteor']);
    expect(r.merchant.toast).toBe('');
  });

  it('测试模式：未拥有技能可免费 grant 并装备', () => {
    const lo = loadout({});
    const m = { ...merchant([{ kind: 'active', id: 'act_atk', owned: true }]), testMode: true };
    const r = applyMerchantHit({ kind: 'offer', index: 0 }, m, lo, merit);
    expect(r.loadout.ownedActives).toContain('act_atk');
    expect(r.loadout.equipped).toContain('act_atk');
  });

  it('装配栏 × 号点击卸下需二次确认，取消不生效、确认后生效', () => {
    const lo = loadout({ ownedActives: ['act_meteor'], equipped: ['act_meteor'] });
    const m = merchant([]);
    const r1 = applyMerchantHit({ kind: 'unequipActive', id: 'act_meteor' }, m, lo, merit);
    expect(r1.loadout.equipped).toEqual(['act_meteor']);
    expect(r1.merchant.confirmUnequip).toEqual({ kind: 'active', id: 'act_meteor' });
    const cancelled = applyMerchantHit({ kind: 'cancelUnequip' }, r1.merchant, r1.loadout, r1.merit);
    expect(cancelled.loadout.equipped).toEqual(['act_meteor']);
    const confirmed = applyMerchantHit({ kind: 'confirmUnequip' }, r1.merchant, r1.loadout, r1.merit);
    expect(confirmed.loadout.equipped).toEqual([]);
    expect(confirmed.merchant.confirmUnequip).toBeNull();
  });
});

describe('merchant skill info popup', () => {
  it('点击已装配/抽奖预览技能打开详情，关闭后清空', () => {
    const m = merchant([]);
    const opened = applyMerchantHit({ kind: 'skillInfo', skillKind: 'active', id: 'act_meteor' }, m, loadout({}), merit);
    expect(opened.merchant.skillInfo).toEqual({ kind: 'active', id: 'act_meteor' });
    const closed = applyMerchantHit({ kind: 'closeSkillInfo' }, opened.merchant, loadout({}), merit);
    expect(closed.merchant.skillInfo).toBeNull();
  });
});

describe('openMerchantTest', () => {
  it('列出全部启用中的主动与被动技能且可滚动', () => {
    const m = openMerchantTest(loadout({}));
    const expected = enabledActives().length + enabledPassives().length;
    expect(m.testMode).toBe(true);
    expect(m.offers.length).toBe(expected);
    expect(merchantMaxScroll(m)).toBeGreaterThan(0);
  });

  it('merchantApplyWheel 可增减 scrollY', () => {
    const m = openMerchantTest(loadout({}));
    const max = merchantMaxScroll(m);
    const down = merchantApplyWheel(m, 120);
    expect(down.scrollY).toBeGreaterThan(0);
    const up = merchantApplyWheel(down, -9999);
    expect(up.scrollY).toBe(0);
    const capped = merchantApplyWheel(m, 99999);
    expect(capped.scrollY).toBe(max);
  });

  it('merchantTestScrollAreaContains 覆盖中间列表区', () => {
    openMerchantTest(loadout({}));
    expect(merchantTestScrollAreaContains(VIEW_W / 2, 400)).toBe(true);
    expect(merchantTestScrollAreaContains(VIEW_W / 2, 900)).toBe(false);
  });
});
