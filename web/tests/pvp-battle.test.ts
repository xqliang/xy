import { describe, it, expect } from 'vitest';
import { PvpSync } from '../src/pvp-battle';
const clk = (ms: number) => () => ms;
describe('PvpSync', () => {
  it('simTick 与延迟 aiSimTick', () => {
    const s = new PvpSync({ matchId: 'm', seed: 1, startAtServerMs: 1000, serverOffsetMs: 0, delayTicks: 15, now: clk(1000 + 1000) });
    expect(s.simTick()).toBe(30);          // 1000ms / (1000/30)=33.33 → 30
    expect(s.aiSimTick()).toBe(15);        // 30 - 15
  });
  it('本方打点 → drainOutbound 有序清空', () => {
    let t = 1000; const s = new PvpSync({ matchId: 'm', seed: 1, startAtServerMs: 1000, serverOffsetMs: 0, delayTicks: 15, now: () => t });
    t = 1066; s.record({ op: 'summon' }, 30);
    t = 1132; s.record({ op: 'startWave' }, 60);
    const out = s.drainOutbound();
    expect(out.map((a) => a.op)).toEqual(['summon', 'startWave']);
    expect(out[0].t).toBe(30);            // record 把调用方传入的 t 原样盖到命令上（= localSimTick 固定步数）
    expect(out[1].t).toBe(60);
    expect(out[0].t).toBeLessThan(out[1].t); // 出站保持施加顺序
    expect(s.drainOutbound()).toEqual([]);
  });
  it('入站对手动作按 t 归并有序，takeReady 只取 t<=给定值', () => {
    const s = new PvpSync({ matchId: 'm', seed: 1, startAtServerMs: 0, serverOffsetMs: 0, delayTicks: 0, now: clk(0) });
    s.ingestOpponent([{ t: 10, op: 'summon' }, { t: 2, op: 'startWave' }]);
    expect(s.takeReady(5).map((a) => a.op)).toEqual(['startWave']); // 仅 t<=5
    expect(s.takeReady(20).map((a) => a.op)).toEqual(['summon']);   // 其余
  });
});
