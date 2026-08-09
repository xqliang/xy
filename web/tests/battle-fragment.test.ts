import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';
import { BATTLE_FRAGMENT_ELIGIBLE_CHANCE, HERO_ATTACK_FRAGMENT_CHANCE } from '../src/weapons';

function tryHeroFragmentDrop(b: Battle): void {
  (b as unknown as { tryRollFragmentOnHeroAttack(): void }).tryRollFragmentOnHeroAttack();
}

describe('battle fragment drop', () => {
  it('planBattleFragmentDrop 预排 dropId 或 null', () => {
    const b = new Battle(5, 1, mapById('pansidong'));
    b.weaponPickupVisible = () => true;
    b.planBattleFragmentDrop();
    expect(b.battleFragmentDropId === null || typeof b.battleFragmentDropId === 'string').toBe(true);
  });

  it('整局最多掉落一次', () => {
    const b = new Battle(1, 1, mapById('pansidong'));
    b.weaponPickupVisible = () => true;
    b.battleFragmentDropId = 'jingubang';
    b.battleFragmentDropped = false;
    // 令 10% 掷骰恒成功
    let attackRolls = 0;
    const origNext = b.rng.next.bind(b.rng);
    b.rng.next = () => {
      attackRolls++;
      return 0;
    };
    tryHeroFragmentDrop(b);
    tryHeroFragmentDrop(b);
    b.rng.next = origNext;
    expect(b.pendingWeaponPickups).toEqual(['jingubang']);
    expect(attackRolls).toBe(1);
  });

  it('碎片已集齐时不展示但仍消耗本局掉落机会', () => {
    const b = new Battle(1, 1, mapById('pansidong'));
    b.battleFragmentDropId = 'jingubang';
    b.weaponPickupVisible = () => false;
    b.rng.next = () => 0;
    tryHeroFragmentDrop(b);
    expect(b.pendingWeaponPickups.length).toBe(0);
  });

  it('掉落概率常量', () => {
    expect(BATTLE_FRAGMENT_ELIGIBLE_CHANCE).toBe(0.35);
    expect(HERO_ATTACK_FRAGMENT_CHANCE).toBe(0.10);
  });
});
