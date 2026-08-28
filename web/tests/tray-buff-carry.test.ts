// 回归：兵器在地图获得的增益（仙丹/风火轮/炼丹）随候选区令牌携带——
// 地图→候选区→地图往返不丢；候选区/棋盘合成时两侧并集继承（A有风火轮+B有仙丹 → 合成后两个都有）。
import { describe, it, expect } from 'vitest';
import { Battle, type PlacedUnit } from '../src/battle';

function buffedUnit(type: PlacedUnit['type'], tier: number, cell: { c: number; r: number }, buffs?: Partial<PlacedUnit>): PlacedUnit {
  return {
    type, tier, cell, cooldown: 0, firePulse: 0, combo: 0,
    stunT: 0, slowT: 0, weakenT: 0, rangeCutT: 0, knockdownT: 0,
    stunImmuneT: 0, slowImmuneT: 0, weakenImmuneT: 0, rangeCutImmuneT: 0, knockdownImmuneT: 0,
    ...buffs,
  };
}

function firstUnlocked(b: Battle): { c: number; r: number } {
  return b.unlockedCells()[0]!;
}

describe('兵器增益随身（候选区往返/合成继承）', () => {
  it('收回候选区：丹/轮/炼丹随身不丢', () => {
    const b = new Battle(1);
    const cell = firstUnlocked(b);
    b.units.set(`${cell.c},${cell.r}`, buffedUnit('dao', 2, cell, { pillAtk: true, pillFrq: true, buffAtkT: 5, buffAtkMul: 1.4 }));
    b.tray = [];
    expect(b.recallToTray(cell, 0)).toBe(true);
    expect(b.tray[0]).toEqual({
      kind: 'unit', type: 'dao', tier: 2,
      pillAtk: true, pillFrq: true, buffAtkT: 5, buffAtkMul: 1.4,
    });
  });

  it('候选区放回地图：增益还原到棋盘兵器上', () => {
    const b = new Battle(1);
    const cell = firstUnlocked(b);
    b.tray = [{ kind: 'unit', type: 'dao', tier: 2, pillAtk: true, pillFrq: true, buffAtkT: 5, buffAtkMul: 1.4 }];
    expect(b.placeFromTray(0, cell)).toBe(true);
    const u = b.units.get(`${cell.c},${cell.r}`)!;
    expect(u.pillAtk).toBe(true);
    expect(u.pillFrq).toBe(true);
    expect(u.buffAtkT).toBe(5);
    expect(u.buffAtkMul).toBe(1.4);
  });

  it('候选区合成：A有风火轮 + B有仙丹 → 合成后两个都有', () => {
    const b = new Battle(1);
    b.tray = [
      { kind: 'unit', type: 'spear', tier: 1, pillFrq: true },
      { kind: 'unit', type: 'spear', tier: 1, pillAtk: true },
    ];
    expect(b.mergeTrayTokens(0, 1)).toBe(true);
    expect(b.tray[1]).toEqual({ kind: 'unit', type: 'spear', tier: 2, pillAtk: true, pillFrq: true });
    expect(b.tray[0]).toBeUndefined();
  });

  it('候选区合成：炼丹增益取剩余更久的一档', () => {
    const b = new Battle(1);
    b.tray = [
      { kind: 'unit', type: 'dao', tier: 1, buffAtkT: 2, buffAtkMul: 1.2 },
      { kind: 'unit', type: 'dao', tier: 1, buffAtkT: 6, buffAtkMul: 1.5 },
    ];
    expect(b.mergeTrayTokens(0, 1)).toBe(true);
    expect(b.tray[1]).toEqual({ kind: 'unit', type: 'dao', tier: 2, buffAtkT: 6, buffAtkMul: 1.5 });
  });

  it('棋盘兵器并入候选区同级兵器：增益并集继承', () => {
    const b = new Battle(1);
    const cell = firstUnlocked(b);
    b.units.set(`${cell.c},${cell.r}`, buffedUnit('cavalry', 1, cell, { pillFrq: true }));
    b.tray = [{ kind: 'unit', type: 'cavalry', tier: 1, pillAtk: true }];
    expect(b.recallToTray(cell, 0)).toBe(true);
    expect(b.tray[0]).toEqual({ kind: 'unit', type: 'cavalry', tier: 2, pillAtk: true, pillFrq: true });
  });

  it('候选区兵器落到棋盘同级兵器上合成：增益并集继承', () => {
    const b = new Battle(1);
    const cell = firstUnlocked(b);
    b.units.set(`${cell.c},${cell.r}`, buffedUnit('archer', 1, cell, { pillAtk: true }));
    b.tray = [{ kind: 'unit', type: 'archer', tier: 1, pillFrq: true }];
    expect(b.placeFromTray(0, cell)).toBe(true);
    const merged = b.units.get(`${cell.c},${cell.r}`)!;
    expect(merged.tier).toBe(2);
    expect(merged.pillAtk).toBe(true);
    expect(merged.pillFrq).toBe(true);
  });

  it('棋盘兵器与候选区兵器交换：双方增益各自随身', () => {
    const b = new Battle(1);
    const cell = firstUnlocked(b);
    b.units.set(`${cell.c},${cell.r}`, buffedUnit('dao', 2, cell, { pillAtk: true }));
    b.tray = [{ kind: 'unit', type: 'spear', tier: 3, pillFrq: true, buffAtkT: 4, buffAtkMul: 1.3 }];
    expect(b.recallToTray(cell, 0)).toBe(true);
    // 棋盘上的枪兵带着轮/炼丹
    const onBoard = b.units.get(`${cell.c},${cell.r}`)!;
    expect(onBoard.type).toBe('spear');
    expect(onBoard.pillFrq).toBe(true);
    expect(onBoard.buffAtkT).toBe(4);
    // 候选区里的刀兵带着丹
    expect(b.tray[0]).toEqual({ kind: 'unit', type: 'dao', tier: 2, pillAtk: true });
  });

  it('存档序列化：随身增益随 serialize 落盘不丢', () => {
    const b = new Battle(1);
    b.tray = [{ kind: 'unit', type: 'dao', tier: 1, pillAtk: true, pillFrq: true, buffAtkT: 3, buffAtkMul: 1.4 }];
    // serialize 别名实时状态，须立即 JSON 往返深拷贝（与 battle-save 同口径）
    const core = JSON.parse(JSON.stringify(b.serialize().core));
    expect(core.tray[0]).toMatchObject({
      kind: 'unit', type: 'dao', pillAtk: true, pillFrq: true, buffAtkT: 3, buffAtkMul: 1.4,
    });
  });
});
