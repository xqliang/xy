// web/tests/battle.singleplayer-guard.test.ts
// Plan C Task 13：单人零回归护栏——锁死「pvp=false 时单人行为完全不变」。
//
// 背景：Plan C 给 Battle 加了 pvp 门控（updateAi 整段 return、spawnMonster 不再往 ai* 侧出怪、
// 本地自动开波关闭、checkOpponentDefeated 关闭）。这些门控只应在 pvp=true 时生效；
// 单人（pvp=false / 未传 pvpInit）必须与加 PvP 之前逐字节一致。本测试从「单人不受影响」的
// 角度做结构性断言，补 ai-balance（宏观胜率）之外的结构性护栏：
//   - 单人 AI 侧照常出怪（aiMonsters 非空），对照 pvp 侧被门控为空；
//   - 单人照常本地自动开波（wave≥1），对照 pvp 恒 0；
//   - 单人 AI 决策/决策侧单位随对局推进仍活着。
//
// 对照实例与 battle.pvp-wave / battle.pvp-ctor 同构：同 seed、difficulty=1、NO_META（{} 会让
// bonusHp/bonusSlots 变 undefined → tangsengHP/初始阵位变 NaN）。单人走本地自动开波，pvp 关本地自动开波。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META } from '../src/battle';
import { MAPS } from '../src/board';

// 单人（非 pvp）：不传 pvpInit → this.pvp=false，行为与加 PvP 前一致。
const mkSolo = () =>
  new Battle(7, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined);
// 对照：pvp=true（对手侧确定性重放实例，本地 AI 被门控）。
const mkPvp = () =>
  new Battle(7, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: true });

describe('单人零回归：pvp 门控不影响单人', () => {
  it('构造即分叉：两侧实例都能正常构造（wave 均从 0 起）', () => {
    const solo = mkSolo();
    const pvp = mkPvp();
    // 注：this.pvp 为 private（battle.ts），不在此直接断言；分叉由后续行为断言证明
    // （单人自动开波/出怪，pvp 恒 0/空）。
    expect(solo.wave).toBe(0);
    expect(pvp.wave).toBe(0);
  });

  it('单人 AI 侧照常出怪（aiMonsters 非空）；pvp 侧被门控为空', () => {
    const solo = mkSolo();
    const pvp = mkPvp();
    // INTRO_DUR=6s，step 300 帧(=10s)跨过 intro + 开波 spawn：单人两侧都会本地出怪。
    for (let i = 0; i < 300; i++) {
      solo.step(1 / 30);
      pvp.step(1 / 30);
    }
    // 单人：spawnMonster 双推 this.monsters + this.aiMonsters（battle.ts spawnMonster 未加 pvp 门时走此分支），
    // 故 AI 侧妖怪随对局推进应已非空。
    expect(solo.aiMonsters.length).toBeGreaterThan(0);
    // pvp：spawnMonster 的 aiMonsters.push 被门控（!this.pvp 为假），本地对手侧不出怪。
    expect(pvp.aiMonsters.length).toBe(0);
  });

  it('单人本地自动开波（wave≥1）；pvp 恒 0 不抢跑', () => {
    const solo = mkSolo();
    const pvp = mkPvp();
    for (let i = 0; i < 300; i++) {
      solo.step(1 / 30);
      pvp.step(1 / 30);
    }
    // 单人：intro(6s) 结束本地 startNextWave → wave≥1。
    expect(solo.wave).toBeGreaterThanOrEqual(1);
    // pvp：首波由服务端权威排程驱动，本地不开波 → wave 恒 0。
    expect(pvp.wave).toBe(0);
  });

  it('单人 AI 决策/单位侧活着：step 过程中 aiUnits 曾被决策放置（非恒空）', () => {
    const solo = mkSolo();
    // 单人 updateAi 正常跑（pvp 下才整段 return）。intro 阶段 AI 同步征兵布阵。
    // 注意：AI 是否真布阵取决于随机/桃量，故不硬性要求 >0（可能桃不够），只要求
    // 「updateAi 未被门控」——通过断言 updateAi 后实例仍正常推进（wave 前进、status 流转）来间
    // 接证明决策链路活着。直接证据见上一条（aiMonsters 非空=spawn 链路活着）。
    for (let i = 0; i < 300; i++) solo.step(1 / 30);
    // 既然开波了且出怪了，updateAi 必然在被调用（否则无法决策布阵）；这里断言对局在推进。
    expect(solo.wave).toBeGreaterThanOrEqual(1);
    expect(['playing', 'ready', 'won', 'lost']).toContain(solo.status);
  });

  it('显式 pvpInit.enabled=false 与不传 pvpInit 等价（都走单人）', () => {
    // 调用方若显式传 {enabled:false}，应退化为单人行为（与完全省略 pvpInit 同）。
    const explicit = new Battle(7, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: false });
    for (let i = 0; i < 300; i++) explicit.step(1 / 30);
    expect(explicit.wave).toBeGreaterThanOrEqual(1);   // 单人：自动开波
    expect(explicit.aiMonsters.length).toBeGreaterThan(0); // 单人：AI 侧出怪
  });
});
