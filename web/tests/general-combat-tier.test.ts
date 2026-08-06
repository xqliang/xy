import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { generalStat } from '../src/generals';

function placeErlang(b: Battle, leftTier: number, rightTier: number) {
  const cells = b.unlockedCells();
  const a = cells[0]!;
  const right = cells.find((c) => c.r === a.r && c.c === a.c + 1) ?? { c: a.c + 1, r: a.r };
  // 确保右格解锁
  b.unlocked.add(`${right.c},${right.r}`);
  b.words.set(`${a.c},${a.r}`, { char: '二', general: 'erlang', tier: leftTier, cell: { c: a.c, r: a.r } });
  b.words.set(`${right.c},${right.r}`, { char: '郎', general: 'erlang', tier: rightTier, cell: { c: right.c, r: right.r } });
  return { a, right };
}

describe('攻击升品质阶', () => {
  it('满经验后双字各 +1，徽标 min 上升；拆开保留', () => {
    const b = new Battle(1);
    const { a, right } = placeErlang(b, 2, 3);
    const g = b.activeGenerals()[0]!;
    expect(g.tier).toBe(2);
    const need = Battle.expToNext(g.state.level);
    b.addGeneralCombatExp(g, need);
    expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(3);
    expect(b.words.get(`${right.c},${right.r}`)?.tier).toBe(4);
    expect(b.activeGenerals()[0]!.tier).toBe(3);
  });

  it('一字已满阶时只升另一字', () => {
    const b = new Battle(1);
    const { a, right } = placeErlang(b, 5, 4);
    const g = b.activeGenerals()[0]!;
    b.addGeneralCombatExp(g, Battle.expToNext(g.state.level));
    expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(5);
    expect(b.words.get(`${right.c},${right.r}`)?.tier).toBe(5);
  });

  it('法宝符：首次激活两字各 +1 阶', () => {
    const b = new Battle(1, 1, undefined, undefined, undefined, [], ['fabaofu']);
    expect(b.mods.generalTierDelta).toBe(1);
    const { a, right } = placeErlang(b, 1, 1);
    b.activeGenerals(); // 触发首次激活升阶
    expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(2);
    expect(b.words.get(`${right.c},${right.r}`)?.tier).toBe(2);
    b.activeGenerals(); // 再次扫描不叠乘
    expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(2);
  });

  it('generalAtk 不再吃 level 系数', () => {
    const b = new Battle(1);
    placeErlang(b, 2, 2);
    const g = b.activeGenerals()[0]!;
    g.state.level = 10; // 即使残留 level 字段被抬高
    const expected = generalStat(g.def, g.tier).atk * b.mods.atkMul * b.bondAtkMul();
    // bondAtkMul 若为 private，改为只比「高 level 与 level=1 时 atk 相等」：
    g.state.level = 1;
    const atk1 = b.generalAtk(g);
    g.state.level = 10;
    const atk10 = b.generalAtk(g);
    expect(atk10).toBeCloseTo(atk1, 5);
    void expected;
  });
});
