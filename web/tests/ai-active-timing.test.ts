// web/tests/ai-active-timing.test.ts
import { describe, it, expect } from 'vitest';
import { Battle, makePlacedUnit, type Monster } from '../src/battle';

type GateBattle = Battle & {
  aiShouldTriggerActive(effect: string): boolean;
  aiActiveSlotPriority(i: number): number;
  tickAiShovelReserve(): void;
};

function mkMonster(id: number, dist: number, extra: Partial<Monster> = {}): Monster {
  return {
    id,
    dist,
    hp: 10,
    maxHp: 10,
    spd: 1,
    isBoss: false,
    isMiniBoss: false,
    miniBossKind: null,
    isCavalry: false,
    hitFlash: 0,
    skill: null,
    skillCd: 0,
    castFlash: 0,
    spawnT: 0,
    stunT: 0,
    slowT: 0,
    hasteT: 0,
    healFlash: 0,
    burnT: 0,
    burnDps: 0,
    ...extra,
  };
}

describe('AI 主动技能释放时机', () => {
  it('如来神掌/冰封：仅在 aiDangerNear 时触发', () => {
    const b = new Battle(1) as GateBattle;
    b.aiMonsters = [mkMonster(1, 5)];
    expect(b.aiShouldTriggerActive('palm')).toBe(false);
    expect(b.aiShouldTriggerActive('freeze')).toBe(false);
    b.aiMonsters[0]!.dist = b.aiPathLen - 0.5;
    expect(b.aiShouldTriggerActive('palm')).toBe(true);
    expect(b.aiShouldTriggerActive('freeze')).toBe(true);
  });

  it('陨石：怪堆叠 / Boss / Boss 波才触发', () => {
    const b = new Battle(1) as GateBattle;
    b.aiMonsters = [mkMonster(1, 3)];
    expect(b.aiShouldTriggerActive('meteor')).toBe(false);
    b.aiMonsters.push(mkMonster(2, 4), mkMonster(3, 5));
    expect(b.aiShouldTriggerActive('meteor')).toBe(true);
  });

  it('紧箍咒：≥2 怪或精英/Boss 才触发', () => {
    const b = new Battle(1) as GateBattle;
    b.aiMonsters = [mkMonster(1, 3)];
    expect(b.aiShouldTriggerActive('jinggu')).toBe(false);
    b.aiMonsters[0]!.isMiniBoss = true;
    expect(b.aiShouldTriggerActive('jinggu')).toBe(true);
  });

  it('仙丹/风火轮：场上有足够 DPS 棋子才触发', () => {
    const b = new Battle(1) as GateBattle;
    b.aiMonsters = [mkMonster(1, 3)];
    expect(b.aiShouldTriggerActive('atkBuff')).toBe(false);
    const cells = b.aiUnlockedCells();
    b.aiUnits.push(makePlacedUnit('spear', 1, cells[0]!));
    b.aiUnits.push(makePlacedUnit('archer', 1, cells[1]!));
    expect(b.aiShouldTriggerActive('atkBuff')).toBe(true);
    expect(b.aiShouldTriggerActive('frqBuff')).toBe(true);
  });

  it('优先级：危险技先于爆发技先于增益技', () => {
    const b = new Battle(1) as GateBattle;
    b.aiActiveSlots = [
      { id: 'act_atk', cd: 0, cdMax: 10, ready: true, flash: 0 },
      { id: 'act_palm', cd: 0, cdMax: 10, ready: true, flash: 0 },
      { id: 'act_meteor', cd: 0, cdMax: 10, ready: true, flash: 0 },
    ];
    b.aiMonsters = [
      mkMonster(1, b.aiPathLen - 0.5),
      mkMonster(2, b.aiPathLen - 1),
      mkMonster(3, b.aiPathLen - 2),
    ];
    const cells = b.aiUnlockedCells();
    b.aiUnits.push(makePlacedUnit('spear', 1, cells[0]!));
    b.aiUnits.push(makePlacedUnit('archer', 1, cells[1]!));
    expect(b.aiActiveSlotPriority(1)).toBeLessThan(b.aiActiveSlotPriority(2));
    expect(b.aiActiveSlotPriority(2)).toBeLessThan(b.aiActiveSlotPriority(0));
  });
});

describe('AI 库存铲子', () => {
  it('tray 无铲时用 aiShovels 自动开挖', () => {
    const b = new Battle(1) as GateBattle;
    const lockedBefore = b.aiLockedCells().length;
    expect(lockedBefore).toBeGreaterThan(0);
    b.aiShovels = 1;
    b.aiTray = [];
    b.tickAiShovelReserve();
    expect(b.aiShovels).toBe(0);
    expect(b.aiLockedCells().length).toBe(lockedBefore - 1);
  });
});
