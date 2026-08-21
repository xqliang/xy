import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { MAPS } from '../src/board';

// 与 main.ts onPvpMatched 的 mk() 同构：同 seed、同 difficulty=1、pvpInit.enabled=true。
// 注意 a8/aiAdjustIntervalScale 传 1（对齐单人 AI 节律，pvp 下不用但保持构造签名一致）。
const mkPvp = () =>
  new Battle(1, 1, MAPS[0]!, {}, {}, [], [], false, undefined, 1, undefined, { enabled: true });

describe('applyPvpInput + pvp 微门（Plan C Task 7）', () => {
  it('applyPvpInput(summon) 使 tray 非空、autoplace 不抛', () => {
    const b = mkPvp();
    b.applyPvpInput({ t: 1, op: 'summon' });
    expect(b.tray.length).toBeGreaterThan(0); // summon 征兵 → 候选区有货
    // autoplace 在 pvp 下已确定化（deadlineMs=undefined），施加应不抛
    expect(() => b.applyPvpInput({ t: 2, op: 'autoplace' })).not.toThrow();
  });

  it('pvp 微门：updateAi 跳过 + spawnMonster 不填对手侧 aiMonsters（本方怪照常）', () => {
    const b = mkPvp();
    b.startNextWave();
    for (let i = 0; i < 5; i++) b.step(1 / 30); // 先步进触发出怪（spawnTimer 从 0 起，首步即出）
    // 本方怪照常出（spawnMonster 只把 ai* 侧 push 收紧为本方侧不受影响）
    expect(b.monsters.length).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) b.step(1 / 30);
    expect(b.aiMonsters.length).toBe(0); // pvp 不往不用的 ai* 侧出怪
  });

  it('pvp 微门：checkOpponentDefeated 恒 false（本方未亡也绝不本地判胜）', () => {
    const b = mkPvp();
    b.startNextWave();
    for (let i = 0; i < 90; i++) b.step(1 / 30); // 本方怪全死，但 pvp 终局由服务端裁决
    expect(b.status).not.toBe('won'); // 本地不因对手侧 aiDefeated 判胜
  });

  it('确定性：两实例同 seed + 同动作序列 → snapshot 关键项逐项一致', () => {
    const run = () => {
      const b = mkPvp();
      b.startNextWave();
      b.applyPvpInput({ t: 1, op: 'summon' });
      b.applyPvpInput({ t: 2, op: 'autoplace' });
      for (let i = 0; i < 120; i++) b.step(1 / 30);
      const s = b.snapshot();
      return { wave: s.wave, tangsengHP: s.tangsengHP, kills: s.kills, towerPow: s.towerPow, status: s.status, units: s.units };
    };
    expect(run()).toEqual(run()); // 同 seed 同序 → 逐帧复现（oppBattle 重放的保真地基）
  });
});
