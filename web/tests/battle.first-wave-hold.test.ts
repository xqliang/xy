// web/tests/battle.first-wave-hold.test.ts
// Task 10 首局体验：首局第 1 波「押后」——在玩家布阵完成前不自动开波，放行后照常。
// 验证 battle.ts 的 holdFirstWaveForSetup + shouldHoldFirstWave 判定，彻底杜绝「永远不开波」死锁：
//   - 首局(intro 已完成) + tray 仍有兵/字牌 → 不自动开波（wave 仍 0）。
//   - 首局 + 玩家至少征兵过一次(summonCount>0) + tray 兵/字牌清空 → 放行开第 1 波。
//   - 非首局(flag=false) → intro 完即自动开波（零回归）。
//   - 跳过(setHold false) → 即便 tray 还有兵也立即放行。
// 直接操控 holdFirstWaveForSetup / summonCount / tray / introT 做确定性单测（不跑完整 sim）。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META, type TrayToken } from '../src/battle';
import { MAPS } from '../src/board';

// 同 battle.singleplayer-guard：seed=7、difficulty=1、NO_META（避免 NaN）、单人（不传 pvpInit）。
function mkBattle(): Battle {
  return new Battle(7, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined);
}

// 把 intro 推到「已完成」附近（跨过 INTRO_DUR），使 step() 进入自动开波分支。
function completeIntro(b: Battle): void {
  b.introT = Battle.INTRO_DUR; // step 内会 += dt，随即 >= INTRO_DUR 进入分支
}

const UNIT: TrayToken = { kind: 'unit', type: 'dao', tier: 1 };
const SHOVEL: TrayToken = { kind: 'shovel' };

describe('首局第 1 波押后（battle.holdFirstWaveForSetup）', () => {
  it('首局 + intro 完成 + tray 有兵 → 不自动开波（wave 仍 0）', () => {
    const b = mkBattle();
    b.holdFirstWaveForSetup = true;
    b.tray = [UNIT];
    completeIntro(b);
    b.step(0.05);
    expect(b.wave).toBe(0);
    expect(b.waveActive).toBe(false);
  });

  it('首局 + 征兵过(summonCount>0) + tray 兵/字牌清空 → 放行开第 1 波', () => {
    const b = mkBattle();
    b.holdFirstWaveForSetup = true;
    b.summonCount = 1; // 玩家已至少征兵一次
    b.tray = []; // tray 已无可部署令牌
    completeIntro(b);
    b.step(0.05);
    expect(b.wave).toBe(1);
    expect(b.waveActive).toBe(true);
  });

  it('首局 + tray 先有兵后清空 → 先押后、清空后放行', () => {
    const b = mkBattle();
    b.holdFirstWaveForSetup = true;
    b.summonCount = 1;
    b.tray = [UNIT, { kind: 'word', char: '悟', general: 'wukong', tier: 1 }];
    completeIntro(b);
    b.step(0.05);
    expect(b.wave).toBe(0); // 仍有兵/字牌 → 押后
    b.tray = []; // 玩家把剩下的都拖上场了
    b.step(0.05);
    expect(b.wave).toBe(1); // tray 清空 → 放行
  });

  it('非首局(flag=false) → intro 完即自动开波（回归：行为与未加首局逻辑前一致）', () => {
    const b = mkBattle();
    b.holdFirstWaveForSetup = false;
    b.tray = [UNIT]; // 即使 tray 有兵，非首局也不押后
    completeIntro(b);
    b.step(0.05);
    expect(b.wave).toBe(1);
  });

  it('跳过（setHold=false）→ 即便 tray 还有兵也立即放行', () => {
    const b = mkBattle();
    b.holdFirstWaveForSetup = true;
    b.tray = [UNIT];
    completeIntro(b);
    b.step(0.05);
    expect(b.wave).toBe(0); // 先押后
    b.holdFirstWaveForSetup = false; // main.ts 在玩家点「跳过」时置 false
    b.step(0.05);
    expect(b.wave).toBe(1); // 放行
  });

  it('铲子不阻塞：首局 + 征兵过 + tray 只剩铲子 → 放行（非兵/字牌不阻塞）', () => {
    const b = mkBattle();
    b.holdFirstWaveForSetup = true;
    b.summonCount = 1;
    b.tray = [SHOVEL]; // 只剩洛阳铲（非可部署令牌）
    completeIntro(b);
    b.step(0.05);
    expect(b.wave).toBe(1);
  });

  it('超时兜底：首局永不征兵、不跳过 → 超过 INTRO_DUR+MAX_EXTRA 强制放行（防永久卡死）', () => {
    const b = mkBattle();
    b.holdFirstWaveForSetup = true;
    b.summonCount = 0; // 从未征兵
    b.tray = []; // tray 空（无兵可拖）
    b.introT = Battle.INTRO_DUR + Battle.FIRST_WAVE_HOLD_MAX_EXTRA + 1; // 超时
    b.step(0.05);
    expect(b.wave).toBe(1);
  });
});
