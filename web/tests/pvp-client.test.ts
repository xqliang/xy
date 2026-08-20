import { describe, it, expect, vi, afterEach } from 'vitest';
import { versusEnqueue, versusPoll, versusCancel, versusRoomCreate, versusRoomJoin } from '../src/api/pvp-client';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}
afterEach(() => vi.restoreAllMocks());

describe('pvp-client', () => {
  it('enqueue 传 rank，回 ticket', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { ticket: 'tk1' }));
    const r = await versusEnqueue(3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.ticket).toBe('tk1');
  });
  it('poll 回 matched + matchStart', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { status: 'matched', matchStart: { matchId: 'm', seed: 1, map: 'huoyanshan', startAtServerMs: 10, opponent: { uid: '***1', nickname: '乙', avatarId: 'wukong', rankLevel: 3 } } }));
    const r = await versusPoll('tk1');
    expect(r.ok && r.data.status).toBe('matched');
  });
  it('roomCreate 回 code+link', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { code: 'AB12CD', link: 'https://x/?versus=AB12CD', ticket: 'tk', map: 'huoyanshan' }));
    const r = await versusRoomCreate(4);
    expect(r.ok && r.data.code).toBe('AB12CD');
  });
  it('cancel / roomJoin 走通', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { ok: true }));
    expect((await versusCancel('tk')).ok).toBe(true);
    vi.stubGlobal('fetch', mockFetch(200, { status: 'matched', matchStart: { matchId: 'm', seed: 1, map: 'huoyanshan', startAtServerMs: 10, opponent: { uid: '***1', nickname: '甲', avatarId: 'wukong', rankLevel: 4 } } }));
    expect((await versusRoomJoin('AB12CD')).ok).toBe(true);
  });
});
