import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { generalById } from '../src/generals';

function placeErlangPair(b: Battle) {
  const cells = b.unlockedCells();
  const a = cells[0]!;
  const r = cells.find((c) => c.r === a.r && c.c === a.c + 1)!;
  b.unlocked.add(`${r.c},${r.r}`);
  const def = generalById('erlang')!;
  b.words.set(`${a.c},${a.r}`, { char: def.chars[0]!, general: def.id, tier: 1, cell: a });
  b.words.set(`${r.c},${r.r}`, { char: def.chars[1]!, general: def.id, tier: 1, cell: r });
  return { a, r, def };
}

/** 构造一个 ready 的仙丹槽并施加到给定格（模拟拖放施放） */
function applyAtkPill(b: Battle, cell: { c: number; r: number }): boolean {
  b.activeSlots[0] = { id: 'act_atk', cd: 0, cdMax: 80, ready: true, flash: 0 };
  return b.applyPillActive(0, cell);
}

describe('武将增益随身：拆开重合/回候选区再放回不丢（2026-09-04 用户报仙丹丢失）', () => {
  it('施加仙丹 → 拆开 → 原位重合：pillAtk 保留', () => {
    const b = new Battle(1);
    b.status = 'playing';
    const { a, r } = placeErlangPair(b);
    b.activeGenerals();
    expect(applyAtkPill(b, a)).toBe(true);
    expect(b.activeGenerals()[0]!.state.pillAtk).toBe(true);

    // 拆开：右字离开（同 hero-skill-cd 测试惯例——直接 words 操作）
    const rightWord = b.words.get(`${r.c},${r.r}`)!;
    b.words.delete(`${r.c},${r.r}`);
    expect(b.activeGenerals().length).toBe(0);

    // 重合：同一字牌对象放回原位（pillAtk 在字牌上随身）
    b.words.set(`${r.c},${r.r}`, rightWord);
    const g2 = b.activeGenerals()[0]!;
    expect(g2).toBeTruthy();
    expect(g2.state.pillAtk).toBe(true); // 修前：state 按格子对 prune，重合后全新 state 丢失
  });

  it('施加仙丹 → 拆开 → 字牌回候选区再放回重合：pillAtk 保留（地图↔候选区随身）', () => {
    const b = new Battle(1);
    b.status = 'playing';
    const { a, r } = placeErlangPair(b);
    b.activeGenerals();
    expect(applyAtkPill(b, a)).toBe(true);
    b.tray = []; // 清空候选区给回拖腾槽

    // 右字拖回候选区（拆开）
    expect(b.recallToTray(r, 0)).toBe(true);
    expect(b.activeGenerals().length).toBe(0);
    const token = b.tray[0]!;
    expect(token.kind === 'word' && token.pillAtk).toBe(true); // 候选区也随身

    // 放回原位重合
    expect(b.placeFromTray(0, r)).toBe(true);
    const g2 = b.activeGenerals()[0]!;
    expect(g2).toBeTruthy();
    expect(g2.state.pillAtk).toBe(true);
  });

  it('换位置重合（新 pairKey）：pillAtk 同样保留', () => {
    const b = new Battle(1);
    b.status = 'playing';
    const { a, r } = placeErlangPair(b);
    b.activeGenerals();
    expect(applyAtkPill(b, a)).toBe(true);

    // 两字整体搬到新位置（新 pairKey = stateOfPair 全新 state）
    const cells = b.unlockedCells();
    const base = cells[2]!;
    const a2 = base, r2 = { c: base.c + 1, r: base.r };
    if (!cells.some((c) => c.c === r2.c && c.r === r2.r)) b.unlocked.add(`${r2.c},${r2.r}`);
    const leftWord = b.words.get(`${a.c},${a.r}`)!;
    const rightWord = b.words.get(`${r.c},${r.r}`)!;
    b.words.delete(`${a.c},${a.r}`);
    b.words.delete(`${r.c},${r.r}`);
    leftWord.cell = a2;
    rightWord.cell = r2;
    b.words.set(`${a2.c},${a2.r}`, leftWord);
    b.words.set(`${r2.c},${r2.r}`, rightWord);
    const g2 = b.activeGenerals()[0]!;
    expect(g2).toBeTruthy();
    expect(g2.state.pillAtk).toBe(true); // 修前：新 pairKey = 全新 state
  });
});
