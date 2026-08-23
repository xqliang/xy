// web/tests/pvp-opp-juice.test.ts
// #2 对手半场「战斗反馈」本地补演（PvP 专用）：stepOpponentJuice。
//
// 背景：Model C 下对手半场是快照木偶——bridgeOpponentFromSnap 每帧整体重建 aiUnits/aiMonsters，
// 对手的战斗 sim 不在本机跑，故普通武器攻击特效、怪物掉血飘字、击杀加桃全部缺失（武器立绘还因
// 采样的 firePulse 是「保持样本」而冻结/一顿一顿）。stepOpponentJuice 用「已在快照里的权威数据」
// （aiMonsters.hp 离散、成员表、aiTangsengHP）在本机补演这三样视觉，不算伤害（伤害/死亡以服务端为准）：
//   1. 帧间 hp 下降 → 伤害飘字 + 命中特效，并让最近的在射程内 aiUnit 出招脉冲（武器挥砍动画）；
//   2. 怪物从成员表消失且 aiTangsengHP 未降 → 击杀 → 加桃飘字 + death 爆点（漏怪则不加桃）；
//   3. firePulse 本地维护并每帧回写到重建后的 aiUnits，摆脱采样冻结。
// 契约要点：hp 在一份快照生命周期内恒定（interpAt 只插值 dist，hp 取 cur），故 hp-delta 每次快照切换
// 只触发一次（不逐帧刷屏）；飘字/特效/爆点复用共享数组（坐标已是 AI 半场镜像格，drawFx/…直接渲染）。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META, type Monster, type PlacedUnit } from '../src/battle';
import { MAPS } from '../src/board';

const mkPvp = () =>
  new Battle(1, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: true });
const mkSingle = () =>
  new Battle(1, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: false });

// 最小怪：只填 stepOpponentJuice / aiMonsterPos 会读的字段，其余留给渲染（此处不渲染）。
function mon(p: Partial<Monster> & { id: number }): Monster {
  return {
    dist: 3, hp: 100, maxHp: 100, isBoss: false, isMiniBoss: false, skill: null,
    ...p,
  } as unknown as Monster;
}
// 最小单位：type/tier 供 getUnitStat；cell 供 inAttackRange/cellKey/回写。
function unit(cell: { c: number; r: number }, type = 'dao'): PlacedUnit {
  return { type, tier: 1, cell, firePulse: 0, combo: 0, fireDir: 0 } as unknown as PlacedUnit;
}
// 把单位放在怪物当前渲染格上（距离 0，任何兵种都在射程内），便于验证「归因脉冲」。
function unitOnMonster(b: Battle, m: Monster, type = 'dao'): PlacedUnit {
  const p = b.aiMonsterPos(m);
  return unit({ c: p.c, r: p.r }, type);
}

describe('stepOpponentJuice：对手掉血飘字 + 命中特效 + 出招脉冲（hp-delta 本地补演）', () => {
  it('首帧建立基线，不凭空产生飘字/特效', () => {
    const b = mkPvp();
    const m = mon({ id: 1, dist: 3, hp: 100 });
    b.aiUnits = [unitOnMonster(b, m)];
    b.aiMonsters = [m];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000);
    expect(b.damageFloats.length).toBe(0);
    expect(b.fx.length).toBe(0);
    expect(b.peachFloats.length).toBe(0);
  });

  it('帧间 hp 下降 → 1 条伤害飘字 + 1 条命中特效(wtype=攻击者) + 最近单位出招脉冲', () => {
    const b = mkPvp();
    const m0 = mon({ id: 1, dist: 3, hp: 100 });
    const u = unitOnMonster(b, m0, 'dao');
    b.aiUnits = [u];
    b.aiMonsters = [m0];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000); // 基线

    b.aiMonsters = [mon({ id: 1, dist: 3, hp: 70 })]; // 掉 30
    b.stepOpponentJuice(1016);

    expect(b.damageFloats.length).toBe(1);
    const pos = b.aiMonsterPos(mon({ id: 1, dist: 3 }));
    expect(b.damageFloats[0]!.c).toBeCloseTo(pos.c, 6);
    expect(b.damageFloats[0]!.r).toBeCloseTo(pos.r, 6);
    expect(b.fx.length).toBe(1);
    expect(b.fx[0]!.wtype).toBe('dao');
    // 归因脉冲：回写到重建后的 aiUnits.firePulse（武器挥砍动画的驱动量）
    expect(b.aiUnits[0]!.firePulse).toBeGreaterThan(0.5);
  });

  it('同一份快照 hp 不变 → 不重复产生飘字（不逐帧刷屏）', () => {
    const b = mkPvp();
    b.aiUnits = [unit({ c: 0, r: 0 })];
    b.aiMonsters = [mon({ id: 1, dist: 3, hp: 100 })];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000);
    b.aiMonsters = [mon({ id: 1, dist: 3, hp: 70 })];
    b.stepOpponentJuice(1016); // 掉血一次
    expect(b.damageFloats.length).toBe(1);
    // 后续两帧 hp 仍是 70（同一快照被多帧渲染）→ 不应再新增
    b.stepOpponentJuice(1032);
    b.stepOpponentJuice(1048);
    expect(b.damageFloats.length).toBe(1);
  });

  it('射程外无单位可归因时，仍显示伤害飘字（不产生脉冲/特效）', () => {
    const b = mkPvp();
    const m0 = mon({ id: 1, dist: 3, hp: 100 });
    const p = b.aiMonsterPos(m0);
    b.aiUnits = [unit({ c: p.c + 6, r: p.r + 6 }, 'dao')]; // 远离，melee 射程外
    b.aiMonsters = [m0];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000);
    b.aiMonsters = [mon({ id: 1, dist: 3, hp: 70 })];
    b.stepOpponentJuice(1016);
    expect(b.damageFloats.length).toBe(1); // 伤害数字照常显示
    expect(b.fx.length).toBe(0); // 无归因单位 → 无兵器命中特效
    expect(b.aiUnits[0]!.firePulse).toBe(0); // 未出招
  });
});

describe('stepOpponentJuice：击杀加桃 vs 漏怪不加桃（成员消失 + 唐僧血 delta 分类）', () => {
  it('怪物消失且唐僧血未降 → 击杀：1 条加桃飘字 + death 爆点', () => {
    const b = mkPvp();
    b.aiUnits = [unit({ c: 0, r: 0 })];
    b.aiMonsters = [mon({ id: 1, dist: 3, hp: 20 })];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000); // 基线：怪在场

    b.aiMonsters = []; // 怪消失，唐僧血不变（=10）→ 判为击杀
    b.stepOpponentJuice(1016);
    expect(b.peachFloats.length).toBe(1);
    expect(b.peachFloats[0]!.amount).toBeGreaterThan(0);
    expect(b.bursts.some((x) => x.kind === 'death')).toBe(true);
  });

  it('怪物消失但唐僧血降 1 → 漏怪：不加桃', () => {
    const b = mkPvp();
    b.aiUnits = [unit({ c: 0, r: 0 })];
    b.aiMonsters = [mon({ id: 1, dist: 9.5, hp: 20 })];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000);

    b.aiMonsters = [];
    b.aiTangsengHP = 9; // 漏怪扣血
    b.stepOpponentJuice(1016);
    expect(b.peachFloats.length).toBe(0);
  });

  it('BOSS 击杀加桃数量 > 普通怪击杀', () => {
    const normal = mkPvp();
    normal.aiUnits = [unit({ c: 0, r: 0 })];
    normal.aiMonsters = [mon({ id: 1, dist: 3, hp: 5 })];
    normal.aiTangsengHP = 10;
    normal.stepOpponentJuice(1000);
    normal.aiMonsters = [];
    normal.stepOpponentJuice(1016);

    const boss = mkPvp();
    boss.aiUnits = [unit({ c: 0, r: 0 })];
    boss.aiMonsters = [mon({ id: 2, dist: 3, hp: 5, isBoss: true })];
    boss.aiTangsengHP = 10;
    boss.stepOpponentJuice(1000);
    boss.aiMonsters = [];
    boss.stepOpponentJuice(1016);

    expect(boss.peachFloats[0]!.amount).toBeGreaterThan(normal.peachFloats[0]!.amount);
  });

  it('同帧一杀一漏（唐僧血降1）→ 恰好 1 条加桃（靠近终点者判为漏怪）', () => {
    const b = mkPvp();
    b.aiUnits = [unit({ c: 0, r: 0 })];
    b.aiMonsters = [
      mon({ id: 1, dist: 9.8, hp: 10 }), // 更靠近终点 → 漏
      mon({ id: 2, dist: 3.0, hp: 10 }), // 靠后 → 被杀
    ];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000);
    b.aiMonsters = [];
    b.aiTangsengHP = 9; // 1 漏
    b.stepOpponentJuice(1016);
    expect(b.peachFloats.length).toBe(1);
  });
});

describe('stepOpponentJuice：单机（非 PvP）为 no-op（对手 sim 本地跑，视觉自出）', () => {
  it('非 PvP 调用不产生任何补演飘字', () => {
    const b = mkSingle();
    b.aiUnits = [unit({ c: 0, r: 0 })];
    b.aiMonsters = [mon({ id: 1, dist: 3, hp: 100 })];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000);
    b.aiMonsters = [mon({ id: 1, dist: 3, hp: 50 })];
    b.stepOpponentJuice(1016);
    expect(b.damageFloats.length).toBe(0);
    expect(b.peachFloats.length).toBe(0);
    expect(b.fx.length).toBe(0);
  });
});
