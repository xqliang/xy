// web/tests/pvp-unit-facing.test.ts
// 修复：真人对战对手「兵」朝向跳变。
// 症状：bridgeOpponentFromSnap 每帧把 aiUnits.fireDir 重置成「朝出怪口」，而 stepOpponentJuice 只在
// 「开火帧」把 fireDir 设成朝实际目标 → 冷却帧又被重置回出怪口 → 每个攻击间隔抖一下。
// 期望：只要射程内有怪，每帧都朝最近的怪；怪离开射程则保持上次朝向（像玩家兵不回摆到出怪口）。
// 本测试模拟「bridge 每帧重置 fireDir（注入杂值 99）→ stepOpponentJuice」的真实时序。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META, type Monster, type PlacedUnit } from '../src/battle';
import { MAPS } from '../src/board';

const mkPvp = () =>
  new Battle(1, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: true });

function mon(p: Partial<Monster> & { id: number }): Monster {
  return { dist: 4, hp: 100, maxHp: 100, isBoss: false, isMiniBoss: false, skill: null, ...p } as unknown as Monster;
}
function unit(cell: { c: number; r: number }, type = 'dao'): PlacedUnit {
  return { type, tier: 1, cell, firePulse: 0, combo: 0, fireDir: 0, cooldown: 0 } as unknown as PlacedUnit;
}

describe('stepOpponentJuice：对手兵朝向跟随实际怪物（修跳变）', () => {
  it('冷却帧也朝目标——不因 bridge 每帧重置成出怪口而跳变', () => {
    const b = mkPvp();
    const m = mon({ id: 1, dist: 4 });
    const mp = b.aiMonsterPos(m);
    const cell = { c: Math.round(mp.c), r: Math.round(mp.r) };
    b.aiUnits = [unit(cell, 'dao')];
    b.aiMonsters = [m];
    const want = Math.atan2(mp.r - cell.r, mp.c - cell.c);

    b.aiUnits[0]!.fireDir = 99; // 模拟 bridge 每帧把朝向重置成朝出怪口的杂值
    b.stepOpponentJuice(1000); // 首帧：开火
    const dir1 = b.aiUnits[0]!.fireDir!;
    b.aiUnits[0]!.fireDir = 99; // bridge 再次重置
    b.stepOpponentJuice(1010); // 次帧：冷却中、不开火
    const dir2 = b.aiUnits[0]!.fireDir!;

    expect(dir1).toBeCloseTo(want, 4); // 开火帧朝怪
    expect(dir2).toBeCloseTo(want, 4); // 修复点：冷却帧仍朝怪，不残留出怪口朝向
  });

  it('怪离开射程后保持上次朝向（不回摆到出怪口）', () => {
    const b = mkPvp();
    const m = mon({ id: 1, dist: 4 });
    const mp = b.aiMonsterPos(m);
    const cell = { c: Math.round(mp.c), r: Math.round(mp.r) };
    b.aiUnits = [unit(cell, 'dao')];
    b.aiMonsters = [m];
    b.aiUnits[0]!.fireDir = 99;
    b.stepOpponentJuice(1000);
    const want = b.aiUnits[0]!.fireDir!; // 已朝怪

    b.aiMonsters = []; // 怪离开
    b.aiUnits[0]!.fireDir = 99; // bridge 又重置成出怪口杂值
    b.stepOpponentJuice(1010);
    expect(b.aiUnits[0]!.fireDir).toBeCloseTo(want, 4); // 保持上次朝怪
    expect(b.aiUnits[0]!.fireDir).not.toBeCloseTo(99, 1);
  });
});
