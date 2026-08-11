import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { generalById } from '../src/generals';

function placeErlangPair(b: Battle, leftTier = 1, rightTier = 1) {
  const cells = b.unlockedCells();
  const a = cells[0]!;
  const r = cells.find((c) => c.r === a.r && c.c === a.c + 1)!;
  b.unlocked.add(`${r.c},${r.r}`);
  const def = generalById('erlang')!;
  b.words.set(`${a.c},${a.r}`, { char: def.chars[0]!, general: def.id, tier: leftTier, cell: a });
  b.words.set(`${r.c},${r.r}`, { char: def.chars[1]!, general: def.id, tier: rightTier, cell: r });
  return { a, r, def };
}

describe('英雄合成/激活时大招 CD', () => {
  it('首次激活 skillCd 从满 CD 开始', () => {
    const b = new Battle(1);
    b.status = 'playing';
    placeErlangPair(b);
    const g = b.activeGenerals()[0]!;
    expect(g.state.skillCd).toBe(g.def.skillCd);
  });

  it('拆开后重新激活 skillCd 重置为满 CD', () => {
    const b = new Battle(1);
    const { a, def } = placeErlangPair(b);
    const g = b.activeGenerals()[0]!;
    g.state.skillCd = 2;
    b.words.delete(`${a.c},${a.r}`);
    b.activeGenerals();
    b.words.set(`${a.c},${a.r}`, { char: def.chars[0]!, general: def.id, tier: 1, cell: a });
    const g2 = b.activeGenerals()[0]!;
    expect(g2.state.skillCd).toBe(g2.def.skillCd);
  });

  it('placeFromTray 凑对激活后 skillCd 从满 CD 开始', () => {
    const b = new Battle(1);
    b.status = 'playing';
    const cells = b.unlockedCells();
    const a = cells[0]!;
    const r = cells.find((c) => c.r === a.r && c.c === a.c + 1)!;
    b.unlocked.add(`${r.c},${r.r}`);
    const def = generalById('erlang')!;
    b.tray = [{ kind: 'word', char: def.chars[0]!, general: def.id, tier: 1 }];
    expect(b.placeFromTray(0, a)).toBe(true);
    b.tray = [{ kind: 'word', char: def.chars[1]!, general: def.id, tier: 1 }];
    expect(b.placeFromTray(0, r)).toBe(true);
    const g = b.activeGenerals()[0]!;
    expect(g.state.skillCd).toBe(g.def.skillCd);
  });

  it('喂字升阶后 skillCd 不变', () => {
    const b = new Battle(1);
    const { a, def } = placeErlangPair(b);
    const g = b.activeGenerals()[0]!;
    g.state.skillCd = 7;
    b.tray = [{ kind: 'word', char: def.chars[0]!, general: def.id, tier: 1 }];
    expect(b.placeFromTray(0, a)).toBe(true);
    const g2 = b.activeGenerals()[0]!;
    expect(g2.state.skillCd).toBe(7);
  });

  it('战斗升阶后 skillCd 不变', () => {
    const b = new Battle(1);
    placeErlangPair(b);
    const g = b.activeGenerals()[0]!;
    g.state.skillCd = 7;
    b.addGeneralCombatExp(g, Battle.expToNext(g.state.level, g.def));
    expect(g.state.skillCd).toBe(7);
  });
});
