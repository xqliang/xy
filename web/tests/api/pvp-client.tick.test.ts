import { describe, it, expect, vi } from 'vitest';
import { versusTick, type TickRequest } from '../../src/api/pvp-client';
import * as client from '../../src/api/client';

describe('versusTick', () => {
  it('POST /api/versus/tick，透传 body，解出 opponentInputs', async () => {
    const spy = vi.spyOn(client, 'apiFetch').mockResolvedValue({ ok: true, status: 200,
      data: { serverMs: 111, opponentInputs: [{ t: 5, op: 'summon' }], opponentDigest: null, nextWave: null, opponentStatus: 'playing', result: null, cheatNotice: null } });
    const req: TickRequest = { matchId: 'm1', clientMs: 100, inputs: [{ t: 3, op: 'summon' }],
      digest: { wave: 1, power: 10, kills: 0, tangsengHP: 3, peach: 5, units: 2 }, waveClearedAt: null, status: 'playing' };
    const r = await versusTick(req);
    expect(spy).toHaveBeenCalledWith('/api/versus/tick', expect.objectContaining({ method: 'POST' }));
    expect(r.ok && r.data.opponentInputs[0].op).toBe('summon');
  });
});
