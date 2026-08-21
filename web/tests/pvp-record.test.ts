import { describe, it, expect } from 'vitest';
import { toPvpAction } from '../src/pvp-record';
describe('toPvpAction', () => {
  it('place: 记 index + cell', () => {
    expect(toPvpAction('place', { index: 0, cell: 'r2c4', token: '金' })).toMatchObject({ op: 'place', index: 0, cell: 'r2c4' });
  });
  it('autoplace: 只记命令（无 cells）', () => {
    expect(toPvpAction('autoplace', {})).toEqual({ op: 'autoplace' });
  });
  it('summon: 只记命令', () => { expect(toPvpAction('summon', {})).toEqual({ op: 'summon' }); });
  it('move: from/to', () => { expect(toPvpAction('move', { from: 'r1c1', to: 'r2c1' })).toMatchObject({ op: 'move', from: 'r1c1', to: 'r2c1' }); });
  it('active: slot/id/可选 cell', () => {
    expect(toPvpAction('active', { slot: 0, id: 'act_x' })).toMatchObject({ op: 'active', slot: 0, id: 'act_x' });
    expect(toPvpAction('active', { slot: 1, id: 'act_y', cell: 'r3c3' })).toMatchObject({ op: 'active', slot: 1, id: 'act_y', cell: 'r3c3' });
  });
  it('merge/recall/shovel/claimDrop', () => {
    expect(toPvpAction('merge', { from: 0, to: 1 })).toMatchObject({ op: 'merge', from: 0, to: 1 });
    expect(toPvpAction('recall', { from: 'r2c2', slot: 3 })).toMatchObject({ op: 'recall', from: 'r2c2', slot: 3 });
    expect(toPvpAction('claimDrop', { id: 'w_gold' })).toMatchObject({ op: 'claimDrop', id: 'w_gold' });
  });
});
