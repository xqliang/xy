import { describe, it, expect } from 'vitest';
import { applyMerchantHit, merchantClosed, type MerchantUiState } from '../src/merchant';
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
  it('已装备主动技能显示卸下并可点击卸下', () => {
    const lo = loadout({
      ownedActives: ['act_jinggu'],
      equipped: ['act_jinggu', 'act_meteor'],
    });
    const m = merchant([{ kind: 'active', id: 'act_jinggu', owned: true }]);
    const r = applyMerchantHit({ kind: 'offer', index: 0 }, m, lo, merit);
    expect(r.loadout.equipped).toEqual(['act_meteor']);
    expect(r.merchant.toast).toBe('已卸下');
  });

  it('主动槽满时阻止购买并提示', () => {
    const lo = loadout({ equipped: ['act_jinggu', 'act_meteor'] });
    const m = merchant([{ kind: 'active', id: 'act_freeze', owned: false }]);
    const r = applyMerchantHit({ kind: 'offer', index: 0 }, m, lo, merit);
    expect(r.merchant.confirmOffer).toBeNull();
    expect(r.merchant.toast).toBe(ACTIVE_FULL_HINT);
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
    expect(r.merchant.toast).toBe(ACTIVE_FULL_HINT);
  });
});
