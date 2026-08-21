// web/tests/pvp-relay-reliability.test.ts
// cause-2 网络可靠性：出站重传窗口 + 入站按 seq 去重。锁死「1s 轮询丢包下命令既不丢、也不重复施加」。
//
// 背景：HTTP 1s 轮询无 ACK，旧逻辑 pop-before-ack + 丢 tick 即丢命令 → oppBattle 漏命令 → 对手防御单位没摆上
// → 怪没被杀 → 重放的对手唐僧死 → 玩家看到彻底发散的对手半场。修复：客户端出站保留时间窗整窗重发
// （覆盖「我上传丢了」），服务端保留窗口重发（覆盖「响应丢了」），两端按发送方单调 seq 去重幂等施加
// （防重复 → 保证 oppBattle 每条命令恰好施加一次，rng 流不分叉）。
import { describe, it, expect } from 'vitest';
import { PvpSync } from '../src/pvp-battle';
import { RETRANSMIT_WINDOW_MS } from '../src/pvp-fixedstep';

// 可控时钟：t() 读出/写回同一 ms，测试里手动推进 now。
const clk = (ms: { v: number }) => () => ms.v;
const mk = (ms: { v: number }) =>
  new PvpSync({ matchId: 'm', seed: 1, startAtServerMs: 0, serverOffsetMs: 0, delayTicks: 0, now: clk(ms) });

describe('PvpSync 出站重传窗口（buildTick 不清空 + 超窗剔除）', () => {
  it('窗口内整窗重发；超窗剔除；每条动作带单调 seq', () => {
    const ms = { v: 1000 };
    const s = mk(ms);
    s.record({ op: 'summon' }, 30);
    s.record({ op: 'startWave' }, 60);

    // 第一次组 tick：两条都在窗口内 → 都下发，且各自带不同单调 seq。
    const r1 = s.buildTick({} as any, null, 'playing');
    expect(r1.inputs.map((a) => a.op)).toEqual(['summon', 'startWave']);
    const seqs = r1.inputs.map((a) => a.seq);
    expect(seqs[0]).not.toBe(seqs[1]);          // 两条动作 seq 不同（单调分配）
    expect(seqs[1]).toBe((seqs[0] as number) + 1);

    // 关键：buildTick 不清空。模拟「响应丢了」——再组一次 tick（仍在窗口内）→ 同样两条仍在（重发）。
    const r2 = s.buildTick({} as any, null, 'playing');
    expect(r2.inputs.map((a) => a.op)).toEqual(['summon', 'startWave']);

    // 推进 now 刚好在窗口边界内（<= RETRANSMIT_WINDOW_MS）：仍重发（覆盖最多 ~3 个连续丢包 tick）。
    ms.v = 1000 + RETRANSMIT_WINDOW_MS;
    const r3 = s.buildTick({} as any, null, 'playing');
    expect(r3.inputs.map((a) => a.op)).toEqual(['summon', 'startWave']);

    // 超过窗口：两条都被剔除（防缓冲无限增长），下发变空。
    ms.v = 1000 + RETRANSMIT_WINDOW_MS + 1;
    const r4 = s.buildTick({} as any, null, 'playing');
    expect(r4.inputs).toEqual([]);
  });
});

describe('PvpSync 入站按 seq 去重（服务端重发窗口会重复下发）', () => {
  it('同 seq 重发只施加一次，且保持 t 升序', () => {
    const s = mk({ v: 0 });
    const batch = [
      { t: 60, seq: 1, op: 'startWave' as const },
      { t: 30, seq: 0, op: 'summon' as const },
    ];
    s.ingestOpponent(batch);
    // 重复下发同一批（同 seq）——去重后不应新增。
    s.ingestOpponent(batch);

    const ready = s.takeReady(1000).map((a) => a.op);
    expect(ready).toEqual(['summon', 'startWave']); // 每个动作恰好一次，且按 t 升序（30 在 60 前）
  });

  it('向后兼容：无 seq 的动作不去重（退化=现网行为，两份都保留）', () => {
    const s = mk({ v: 0 });
    const batch = [{ t: 30, op: 'summon' as const }, { t: 60, op: 'startWave' as const }];
    s.ingestOpponent(batch);
    s.ingestOpponent(batch); // 无 seq → 无法去重，两份都在
    const ready = s.takeReady(1000);
    expect(ready).toHaveLength(4); // 2 条 × 2 份
  });
});
