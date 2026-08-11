// web/tests/ai-active-timing.test.ts
import { describe, it, expect } from 'vitest';
import { Battle, makePlacedUnit, type Monster } from '../src/battle';

type GateBattle = Battle & {
  aiShouldTriggerActive(effect: string): boolean;
  aiActiveSlotPriority(i: number): number;
  tickAiShovelReserve(): void;
  tickAiOffensiveActiveDelay(dt: number): void;
};

/** 陨石/紧箍咒新增的「距离解锁 + 随机延迟」门槛：先解锁再快进过延迟，令其确定性就绪 */
function armOffensiveActives(b: GateBattle): void {
  b.tickAiOffensiveActiveDelay(0); // 解锁瞬间：滚随机延迟
  b.tickAiOffensiveActiveDelay(10); // 快进过 aiOffensiveActiveDelayMax，使延迟归零
}

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

  it('陨石：怪堆叠 / Boss / Boss 波才触发（且需最远怪物越过 8 格 + 随机延迟解锁）', () => {
    const b = new Battle(1) as GateBattle;
    b.aiMonsters = [mkMonster(1, 9)];
    armOffensiveActives(b);
    expect(b.aiShouldTriggerActive('meteor')).toBe(false); // 数量不足
    b.aiMonsters.push(mkMonster(2, 9), mkMonster(3, 9));
    expect(b.aiShouldTriggerActive('meteor')).toBe(true);
  });

  it('陨石：数量达标但最远怪物未越过 8 格，不会一开怪就打出', () => {
    const b = new Battle(1) as GateBattle;
    b.aiMonsters = [mkMonster(1, 3), mkMonster(2, 4), mkMonster(3, 5)];
    armOffensiveActives(b);
    expect(b.aiShouldTriggerActive('meteor')).toBe(false);
  });

  it('紧箍咒：≥2 怪或精英/Boss 才触发（且需最远怪物越过 8 格 + 随机延迟解锁）', () => {
    const b = new Battle(1) as GateBattle;
    b.aiMonsters = [mkMonster(1, 9)];
    armOffensiveActives(b);
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
    armOffensiveActives(b);
    const cells = b.aiUnlockedCells();
    b.aiUnits.push(makePlacedUnit('spear', 1, cells[0]!));
    b.aiUnits.push(makePlacedUnit('archer', 1, cells[1]!));
    expect(b.aiActiveSlotPriority(1)).toBeLessThan(b.aiActiveSlotPriority(2));
    expect(b.aiActiveSlotPriority(2)).toBeLessThan(b.aiActiveSlotPriority(0));
  });
});

describe('AI 攻击型主动技能(陨石/紧箍咒)择时延迟', () => {
  it('未越过 8 格：延迟保持未解锁，不会解锁计时', () => {
    const b = new Battle(1) as GateBattle;
    b.aiMonsters = [mkMonster(1, 5)];
    b.tickAiOffensiveActiveDelay(0);
    b.tickAiOffensiveActiveDelay(10);
    b.aiMonsters = [{ ...mkMonster(1, 9) }];
    expect(b.aiShouldTriggerActive('meteor')).toBe(false); // 尚未 tick 过，未解锁
  });

  it('越过 8 格瞬间需随机延迟，快进后才就绪', () => {
    const b = new Battle(1) as GateBattle;
    b.aiMonsters = [mkMonster(1, 9), mkMonster(2, 9), mkMonster(3, 9)];
    b.tickAiOffensiveActiveDelay(0); // 解锁瞬间：只滚延迟，未必已就绪
    // 不做 false 断言（随机延迟可能刚好为 0），仅验证快进后一定就绪
    b.tickAiOffensiveActiveDelay(10);
    expect(b.aiShouldTriggerActive('meteor')).toBe(true);
  });

  it('怪物退回阈值下：延迟清空，需重新解锁', () => {
    const b = new Battle(1) as GateBattle;
    b.aiMonsters = [mkMonster(1, 9), mkMonster(2, 9), mkMonster(3, 9)];
    b.tickAiOffensiveActiveDelay(0);
    b.tickAiOffensiveActiveDelay(10);
    expect(b.aiShouldTriggerActive('meteor')).toBe(true);
    b.aiMonsters = [mkMonster(1, 2)];
    b.tickAiOffensiveActiveDelay(0);
    expect(b.aiShouldTriggerActive('meteor')).toBe(false);
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
