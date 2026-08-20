import { describe, it, expect, vi } from 'vitest';
import { PvpMatchController, MATCH_TIMEOUT_MS, POLL_INTERVAL_MS } from '../src/pvp-match';
import type { MatchStart } from '../src/api/pvp-client';

const flush = () => new Promise((r) => setTimeout(r, 0));
const MS: MatchStart = { matchId: 'm', seed: 1, map: 'huoyanshan', startAtServerMs: 0, opponent: { uid: '***1', nickname: '乙', avatarId: 'wukong', rankLevel: 3 } };

function net(overrides: Partial<any> = {}) {
  return {
    enqueue: vi.fn(async () => ({ ok: true, data: { ticket: 'tk1' }, status: 200 })),
    poll: vi.fn(async () => ({ ok: true, data: { status: 'waiting' }, status: 200 })),
    cancel: vi.fn(async () => ({ ok: true, data: { ok: true }, status: 200 })),
    roomCreate: vi.fn(async () => ({ ok: true, data: { code: 'AB12CD', link: 'l', ticket: 'tk', map: 'huoyanshan' }, status: 200 })),
    roomJoin: vi.fn(async () => ({ ok: true, data: { status: 'matched', matchStart: MS }, status: 200 })),
    ...overrides,
  };
}

describe('PvpMatchController 随机匹配', () => {
  it('startRandom 入队后进入 queuing 并按间隔轮询', async () => {
    let t = 0; const n = net();
    const c = new PvpMatchController({ net: n as any, now: () => t, onMatched: vi.fn(), onFailed: vi.fn() });
    await c.startRandom(3); await flush();
    expect(c.state.phase).toBe('queuing');
    expect(n.enqueue).toHaveBeenCalledWith(3);
    t = POLL_INTERVAL_MS; c.pump(t); await flush();
    t = POLL_INTERVAL_MS * 2 + 1; c.pump(t); await flush();
    expect(n.poll.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('poll 到 matched → onMatched(matchStart)，停止轮询', async () => {
    let t = 0; const onMatched = vi.fn();
    const n = net({ poll: vi.fn(async () => ({ ok: true, data: { status: 'matched', matchStart: MS }, status: 200 })) });
    const c = new PvpMatchController({ net: n as any, now: () => t, onMatched, onFailed: vi.fn() });
    await c.startRandom(3); await flush();
    t = POLL_INTERVAL_MS + 1; c.pump(t); await flush();
    expect(onMatched).toHaveBeenCalledWith(MS);
    expect(c.state.phase).toBe('matched');
    const before = n.poll.mock.calls.length;
    t += POLL_INTERVAL_MS + 1; c.pump(t); await flush();
    expect(n.poll.mock.calls.length).toBe(before);
  });

  it('2 分钟超时 → onFailed(timeout) 且尝试 cancel', async () => {
    let t = 0; const onFailed = vi.fn(); const n = net();
    const c = new PvpMatchController({ net: n as any, now: () => t, onMatched: vi.fn(), onFailed });
    await c.startRandom(3); await flush();
    t = MATCH_TIMEOUT_MS + 1; c.pump(t); await flush();
    expect(onFailed).toHaveBeenCalledWith('timeout');
    expect(c.state.phase).toBe('failed');
    expect(n.cancel).toHaveBeenCalled();
  });

  it('cancel() → 调用 net.cancel 且回 idle', async () => {
    let t = 0; const n = net();
    const c = new PvpMatchController({ net: n as any, now: () => t, onMatched: vi.fn(), onFailed: vi.fn() });
    await c.startRandom(3); await flush();
    await c.cancel(); await flush();
    expect(n.cancel).toHaveBeenCalledWith('tk1');
    expect(c.state.phase).toBe('idle');
  });

  it('入队 banned → onFailed(banned)', async () => {
    let t = 0; const onFailed = vi.fn();
    const n = net({ enqueue: vi.fn(async () => ({ ok: true, data: { banned: true, msg: 'x' }, status: 200 })) });
    const c = new PvpMatchController({ net: n as any, now: () => t, onMatched: vi.fn(), onFailed });
    await c.startRandom(3); await flush();
    expect(onFailed).toHaveBeenCalledWith('banned');
  });
});
