// web/tests/pvp-opp-juice.test.ts
// #2 对手半场「战斗反馈」本地补演（PvP 专用）：stepOpponentJuice。
//
// 背景：Model C 下对手半场是快照木偶——bridgeOpponentFromSnap 每帧整体重建 aiUnits/aiMonsters，
// 对手的战斗 sim 不在本机跑，故普通武器/英雄普攻动效、怪物掉血飘字、击杀加桃全部缺失（立绘还因
// 采样的 firePulse 是「保持样本」而冻结/一顿一顿）。stepOpponentJuice 的补演策略：
//   1) 兵器/英雄普攻动效由「本地视觉模拟」驱动——按真实攻击间隔本地出招（只发攻击特效 + 出招
//      脉冲 + 朝向，不落任何伤害；hp/生死以服务端快照为准）。冷却存本地表，首见用快照 cooldown
//      做种子对齐起步节奏，之后不读快照样本（aiUnits 每帧被 bridge 重建，样本是 100ms 前旧值）；
//   2) 帧间 hp 下降 → 只补「伤害飘字」（数值真实；命中特效已由 1) 按真实节奏模拟，不再按掉血
//      离散归因——那样特效会打成一坨且常归因错单位）；
//   3) 怪物从成员表消失且 aiTangsengHP 未降 → 击杀 → 加桃飘字 + death 爆点（漏怪则不加桃）；
//   4) firePulse 本地维护并每帧回写，摆脱采样冻结。
// 契约要点：hp 在一份快照生命周期内恒定（interpAt 只插值 dist，hp 取 cur），故 hp-delta 每次快照切换
// 只触发一次（不逐帧刷屏）；特效复用共享数组（坐标已是 AI 半场镜像格，drawFx/…直接渲染）。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META, type Monster, type PlacedUnit } from '../src/battle';
import { MAPS } from '../src/board';
import { getUnitStat } from '@core';

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
// 最小单位：type/tier 供 getUnitStat；cell 供 inAttackRange/cellKey/回写；cooldown 供本地视觉模拟种子。
function unit(cell: { c: number; r: number }, type = 'dao', cooldown = 1): PlacedUnit {
  return { type, tier: 1, cell, cooldown, firePulse: 0, combo: 0, fireDir: 0 } as unknown as PlacedUnit;
}
// 把单位放在怪物当前渲染格上（距离 0，任何兵种都在射程内），便于验证出招模拟。
function unitOnMonster(b: Battle, m: Monster, type = 'dao', cooldown = 1): PlacedUnit {
  const p = b.aiMonsterPos(m);
  return unit({ c: p.c, r: p.r }, type, cooldown);
}

describe('stepOpponentJuice：对手普攻本地视觉模拟（兵器 + 英雄，不落伤害）', () => {
  it('冷却就绪 + 圈内有怪 → 出攻击特效 + 脉冲=1 + 朝向目标；hp 不被本地扣', () => {
    const b = mkPvp();
    const m = mon({ id: 1, dist: 3, hp: 100 });
    b.aiUnits = [unitOnMonster(b, m, 'dao', 0)]; // cooldown=0 → 首帧即出招
    b.aiMonsters = [m];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000);
    expect(b.fx.length).toBeGreaterThanOrEqual(1);
    expect(b.fx[0]!.wtype).toBe('dao');
    // 出招脉冲回写（武器挥砍/立绘跳起的驱动量）
    expect(b.aiUnits[0]!.firePulse).toBe(1);
    // 纯视觉：不扣血（伤害以服务端快照为准）
    expect(b.aiMonsters[0]!.hp).toBe(100);
    expect(b.damageFloats.length).toBe(0); // 本地出招不生成伤害飘字（飘字只来自快照 hp 下降）
  });

  it('出招后进入本地冷却：间隔内不再出招，间隔到点再出', () => {
    const b = mkPvp();
    const m = mon({ id: 1, dist: 3, hp: 100 });
    b.aiUnits = [unitOnMonster(b, m, 'dao', 0)];
    b.aiMonsters = [m];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000); // 出招一次
    expect(b.fx.length).toBeGreaterThanOrEqual(1);
    const fired = b.fx.length;

    b.stepOpponentJuice(1016); // +16ms，远小于攻击间隔 → 不出招
    expect(b.fx.length).toBe(fired);
    // 脉冲本地衰减（6/s）
    expect(b.aiUnits[0]!.firePulse).toBeLessThan(1);

    // 推进满一个攻击间隔 → 再出招（帧粒度 100ms 上限，逐帧推进避免 dt 钳制）
    const stat = getUnitStat('dao', 1);
    const interval = 1 / stat.frq;
    let t = 1016;
    while (t < 1000 + interval * 1000 + 16) {
      t += 16;
      b.stepOpponentJuice(t);
    }
    expect(b.fx.length).toBeGreaterThan(fired);
  });

  it('圈内无怪 → 憋招不出特效；冷却停在 0（进怪立刻打）', () => {
    const b = mkPvp();
    const m = mon({ id: 1, dist: 3, hp: 100 });
    const p = b.aiMonsterPos(m);
    b.aiUnits = [unit({ c: p.c + 6, r: p.r + 6 }, 'dao', 0)]; // 射程外
    b.aiMonsters = [m];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000);
    b.stepOpponentJuice(1016);
    expect(b.fx.length).toBe(0);
    expect(b.aiUnits[0]!.firePulse).toBe(0);
  });

  it('英雄普攻同样本地模拟：特效带 heroId、脉冲回写武将 state、不扣血', () => {
    const b = mkPvp();
    const m = mon({ id: 1, dist: 3, hp: 100 });
    const p = b.aiMonsterPos(m);
    // 大圣字对摆在怪旁（激活组由 aiWords 推导；镜像坐标 = AI 半场格）
    b.aiWords.set(`${p.c},${p.r + 1}`, { char: '大', general: 'dasheng', tier: 1, cell: { c: p.c, r: p.r + 1 } });
    b.aiWords.set(`${p.c + 1},${p.r + 1}`, { char: '圣', general: 'dasheng', tier: 1, cell: { c: p.c + 1, r: p.r + 1 } });
    b.aiMonsters = [m];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000);
    const genFx = b.fx.filter((f) => f.heroId === 'dasheng');
    expect(genFx.length).toBeGreaterThanOrEqual(1);
    const g = b.aiActiveGenerals().find((x) => x.def.id === 'dasheng')!;
    expect(g.state.firePulse).toBe(1);
    expect(g.state.fireDir).toBeDefined();
    expect(b.aiMonsters[0]!.hp).toBe(100); // 纯视觉
  });

  it('单位换格后旧键清理、新格用快照 cooldown 重新做种子', () => {
    const b = mkPvp();
    const m = mon({ id: 1, dist: 3, hp: 100 });
    const p = b.aiMonsterPos(m);
    b.aiUnits = [unit({ c: p.c, r: p.r }, 'dao', 0)];
    b.aiMonsters = [m];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000); // 出招一次
    // 对手把兵器挪到远处新格（bridge 重建后 key 变化），快照 cooldown=2 → 本地先歇 2s 不出招
    b.aiUnits = [unit({ c: p.c + 6, r: p.r + 6 }, 'dao', 2)];
    b.stepOpponentJuice(1016);
    const n = b.fx.length;
    b.stepOpponentJuice(1032);
    expect(b.fx.length).toBe(n); // 新格冷却中，不因旧键残留而立刻出招
  });
});

describe('stepOpponentJuice：对手掉血飘字（hp-delta 补演，数值以服务端为准）', () => {
  it('首帧建立基线，不凭空产生飘字', () => {
    const b = mkPvp();
    const m = mon({ id: 1, dist: 3, hp: 100 });
    b.aiUnits = [unitOnMonster(b, m)];
    b.aiMonsters = [m];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000);
    expect(b.damageFloats.length).toBe(0);
    expect(b.peachFloats.length).toBe(0);
  });

  it('帧间 hp 下降 → 1 条伤害飘字（不再按掉血归因出命中特效）', () => {
    const b = mkPvp();
    const m0 = mon({ id: 1, dist: 3, hp: 100 });
    const p = b.aiMonsterPos(m0);
    b.aiUnits = [unit({ c: p.c + 6, r: p.r + 6 }, 'dao')]; // 射程外：确保 fx 只可能来自 hp-delta 旧逻辑
    b.aiMonsters = [m0];
    b.aiTangsengHP = 10;
    b.stepOpponentJuice(1000); // 基线

    b.aiMonsters = [mon({ id: 1, dist: 3, hp: 70 })]; // 掉 30
    b.stepOpponentJuice(1016);

    expect(b.damageFloats.length).toBe(1);
    const pos = b.aiMonsterPos(mon({ id: 1, dist: 3 }));
    expect(b.damageFloats[0]!.c).toBeCloseTo(pos.c, 6);
    expect(b.damageFloats[0]!.r).toBeCloseTo(pos.r, 6);
    expect(b.fx.length).toBe(0); // 掉血只出飘字；命中特效由本地视觉模拟按真实节奏出
    expect(b.aiUnits[0]!.firePulse).toBe(0);
  });

  it('同一份快照 hp 不变 → 不重复产生飘字（不逐帧刷屏）', () => {
    const b = mkPvp();
    const m0 = mon({ id: 1, dist: 3, hp: 100 });
    const p = b.aiMonsterPos(m0);
    b.aiUnits = [unit({ c: p.c + 6, r: p.r + 6 })];
    b.aiMonsters = [m0];
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
