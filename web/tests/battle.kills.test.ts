// web/tests/battle.kills.test.ts
// PvP 摘要/反作弊用：Battle.snapshot() 需暴露本局本方累计击杀 kills。
// 断言：开局 kills===0；放置足够防御、推进波次后 kills>0。
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';

// 按 ai-balance 的脚本玩家思路推进：够桃就征兵+一键布阵，开波后逐帧 step，
// 直到分出胜负、击杀>0 或时间/波次上限。防守站住则玩家胜，过程中必有击杀。
function playUntilKill(b: Battle): { kills: number; status: string } {
  const CAP = 120 * 30; // 约 2 分钟游戏时（30fps）
  const WAVE_CAP = 12; // 超时波封顶，避免无限波拖慢 sim
  let t = 0;
  while (b.status !== 'won' && b.status !== 'lost' && t < CAP && b.wave < WAVE_CAP) {
    if (b.status === 'ready') b.startNextWave();
    if (b.peach >= b.snapshot().summonCost) { b.summon(); b.autoPlaceTray(); }
    b.step(1 / 30);
    t++;
    if (b.snapshot().kills > 0) break; // 已有击杀即可验证字段语义
  }
  return { kills: b.snapshot().kills, status: b.status };
}

describe('Battle.snapshot().kills（PvP 摘要/反作弊）', () => {
  it('开局本局累计击杀为 0', () => {
    const b = new Battle(1);
    expect(b.snapshot().kills).toBe(0);
  });

  it('放置防御、推进波次后，累计击杀 > 0', () => {
    const b = new Battle(1);
    const { kills, status } = playUntilKill(b);
    expect(kills).toBeGreaterThan(0);
    // 击杀应在正常战斗流程中产生（防守未崩：未在击杀前就输掉）
    expect(status).not.toBe('lost');
  });
});
