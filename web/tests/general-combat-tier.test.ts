import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { COLS } from '../src/board';

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
  it('同名两组激活：经验与升阶进度各自独立', () => {
    const b = new Battle(1);
    const cells = b.unlockedCells();
    const row0 = cells.filter((c) => c.r === cells[0]!.r).sort((a, c) => a.c - c.c);
    const a1 = row0[0]!;
    const r1 = row0.find((c) => c.c === a1.c + 1)!;
    b.unlocked.add(`${r1.c},${r1.r}`);
    const row1 = cells.filter((c) => c.r !== a1.r && c.c + 1 < COLS);
    const a2 = row1.find((c) => row1.some((x) => x.r === c.r && x.c === c.c + 1)) ?? row1[0]!;
    const r2 = { c: a2.c + 1, r: a2.r };
    b.unlocked.add(`${a2.c},${a2.r}`);
    b.unlocked.add(`${r2.c},${r2.r}`);

    b.words.set(`${a1.c},${a1.r}`, { char: '二', general: 'erlang', tier: 2, cell: a1 });
    b.words.set(`${r1.c},${r1.r}`, { char: '郎', general: 'erlang', tier: 2, cell: r1 });
    b.words.set(`${a2.c},${a2.r}`, { char: '二', general: 'erlang', tier: 2, cell: a2 });
    b.words.set(`${r2.c},${r2.r}`, { char: '郎', general: 'erlang', tier: 2, cell: r2 });

    const gs = b.activeGenerals();
    expect(gs.length).toBe(2);
    const [g1, g2] = gs;
    expect(g1!.state).not.toBe(g2!.state);

    const need = Battle.expToNext(g1!.state.level);
    b.addGeneralCombatExp(g1!, need);
    expect(b.words.get(`${a1.c},${a1.r}`)?.tier).toBe(3);
    expect(b.words.get(`${a2.c},${a2.r}`)?.tier).toBe(2);
    expect(g2!.state.exp).toBe(0);
    expect(g2!.state.level).toBe(1);
  });

  it('满经验后双字各 +1，徽标上升；拆开保留', () => {
    const b = new Battle(1);
    const { a, right } = placeErlang(b, 2, 3);
    // 激活时继承对齐：2+3 → 双字均为 3
    const g = b.activeGenerals()[0]!;
    expect(g.tier).toBe(3);
    expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(3);
    expect(b.words.get(`${right.c},${right.r}`)?.tier).toBe(3);
    const need = Battle.expToNext(g.state.level);
    b.addGeneralCombatExp(g, need);
    expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(4);
    expect(b.words.get(`${right.c},${right.r}`)?.tier).toBe(4);
    expect(b.activeGenerals()[0]!.tier).toBe(4);
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
    g.state.level = 1;
    const atk1 = b.generalAtk(g);
    g.state.level = 10;
    const atk10 = b.generalAtk(g);
    expect(atk10).toBeCloseTo(atk1, 5);
  });

  it('双字满阶时不累积经验，拆开后重组不连升', () => {
    const b = new Battle(1);
    const { a, right } = placeErlang(b, 5, 5);
    const g = b.activeGenerals()[0]!;
    g.state.exp = 0;
    g.state.level = 1;
    b.addGeneralCombatExp(g, 9999);
    expect(g.state.exp).toBe(0);
    // 拆开后以低阶字牌重组，不应因残留 exp 连升
    b.words.delete(`${a.c},${a.r}`);
    b.words.delete(`${right.c},${right.r}`);
    placeErlang(b, 2, 2);
    const g2 = b.activeGenerals()[0]!;
    expect(g2.state.exp).toBe(0);
    b.addGeneralCombatExp(g2, Battle.expToNext(g2.state.level));
    expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(3);
    expect(b.words.get(`${right.c},${right.r}`)?.tier).toBe(3);
  });

  it('combatExpFromHits：额外目标折计，避免 multi-target 刷经验', () => {
    expect(Battle.combatExpFromHits(10, 1)).toBeCloseTo(0.42, 5);
    expect(Battle.combatExpFromHits(10, 3)).toBeCloseTo(0.714, 5);
    expect(Battle.combatExpFromHits(10, 3)).toBeLessThan(10 * 3 * 0.05);
  });

  it('expToNext：5×3^level', () => {
    expect(Battle.expToNext(1)).toBe(15);
    expect(Battle.expToNext(2)).toBe(45);
    expect(Battle.expToNext(3)).toBe(135);
    expect(Battle.expToNext(4)).toBe(405);
  });

  it('heroSkillExp 低于首档升阶阈值', () => {
    expect(Battle.heroSkillExp).toBeLessThan(Battle.expToNext(1));
  });
});
