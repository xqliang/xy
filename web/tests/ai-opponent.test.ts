// web/tests/ai-opponent.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Battle, TUNING } from '../src/battle';
import { PEACH_PER_KILL } from '@core';

describe('AI 道具', () => {
  it('玩家装备被动时 AI 也会随机携带道具', () => {
    const b = new Battle(42, 1, undefined, undefined, undefined, [], ['xiandan', 'jubaopen']);
    expect(b.aiPickedItems.length).toBeGreaterThan(0);
  });

  it('玩家未装备时 AI 可随机带 0..2 个道具', () => {
    const b0 = new Battle(100, 1, undefined, undefined, undefined, [], []);
    expect(b0.aiPickedItems.length).toBeLessThanOrEqual(2);
    const b2 = new Battle(101, 1, undefined, undefined, undefined, [], []);
    expect(b2.aiPickedItems.length).toBeLessThanOrEqual(2);
  });

  it('无尽模式 AI 不带道具', () => {
    const b = new Battle(42, 1, undefined, undefined, undefined, ['act_palm'], ['xiandan'], true);
    expect(b.aiPickedItems.length).toBe(0);
  });
});

describe('AI 落子与激活', () => {
  it('aiPlaceFromTray：铲子只挖锁定 AI 格并解锁', () => {
    const b = new Battle(1);
    const locked = b.aiLockedCells();
    expect(locked.length).toBeGreaterThan(0);
    b.aiTray = [{ kind: 'shovel' }];
    const ok = b.aiPlaceFromTray(0, locked[0]!);
    expect(ok).toBe(true);
    expect(b.aiUnlocked.has(`${locked[0]!.c},${locked[0]!.r}`)).toBe(true);
  });

  it('aiPlaceFromTray：同型同阶兵合成升阶', () => {
    const b = new Battle(1);
    const cell = b.aiUnlockedCells()[0]!;
    b.aiTray = [{ kind: 'unit', type: 'spear', tier: 1 }];
    b.aiPlaceFromTray(0, cell);
    b.aiTray = [{ kind: 'unit', type: 'spear', tier: 1 }];
    b.aiPlaceFromTray(0, cell); // 落到同格 → 合成
    const u = b.aiUnits.find((x) => x.cell.c === cell.c && x.cell.r === cell.r)!;
    expect(u.tier).toBe(2);
  });

  it('aiActiveGenerals：同将两字连读相邻则激活', () => {
    const b = new Battle(1);
    const cells = b.aiUnlockedCells();
    let left: { c: number; r: number } | undefined, right: { c: number; r: number } | undefined;
    for (const l of cells) {
      const r = cells.find((c) => c.r === l.r && c.c === l.c + 1);
      if (r) { left = l; right = r; break; }
    }
    expect(left && right).toBeTruthy(); // seed-1 地图应存在左右相邻对
    b.aiWords.set(`${left!.c},${left!.r}`, { char: '大', general: 'dasheng', tier: 1, cell: left! });
    b.aiWords.set(`${right!.c},${right!.r}`, { char: '圣', general: 'dasheng', tier: 1, cell: right! });
    const gens = b.aiActiveGenerals();
    expect(gens.length).toBe(1);
    expect(gens[0]!.def.id).toBe('dasheng');
  });

  it('AI 武将攻击累积升阶经验', () => {
    const b = new Battle(1);
    const cells = b.aiUnlockedCells();
    let left: { c: number; r: number } | undefined, right: { c: number; r: number } | undefined;
    for (const l of cells) {
      const r = cells.find((c) => c.r === l.r && c.c === l.c + 1);
      if (r) { left = l; right = r; break; }
    }
    expect(left && right).toBeTruthy();
    b.aiWords.set(`${left!.c},${left!.r}`, { char: '八', general: 'bajie', tier: 1, cell: left! });
    b.aiWords.set(`${right!.c},${right!.r}`, { char: '戒', general: 'bajie', tier: 1, cell: right! });
    const g = b.aiActiveGenerals()[0]!;
    expect(g.tier).toBe(1);
    b.addGeneralCombatExp(g, Battle.expToNext(g.state.level), true);
    expect(b.aiWords.get(`${left!.c},${left!.r}`)?.tier).toBe(2);
    expect(b.aiWords.get(`${right!.c},${right!.r}`)?.tier).toBe(2);
    expect(b.aiActiveGenerals()[0]!.tier).toBe(2);
  });
});

describe('AI 经济与征兵', () => {
  it('AI 够桃才征兵；征后扣桃、涨价', () => {
    const b = new Battle(3);
    (b as any).aiPeach = 999;
    const beforePeach = b.aiPeach;
    const beforeCost = (b as any).aiSummonCost;
    const ok = (b as any).aiSummon();
    expect(ok).toBe(true);
    expect(b.aiPeach).toBeLessThan(beforePeach);
    expect((b as any).aiSummonCost).toBeGreaterThan(beforeCost);
    expect(b.aiTray.length).toBeGreaterThan(0);
  });

  it('桃不足时 aiSummon 不产候选', () => {
    const b = new Battle(3);
    (b as any).aiPeach = 0;
    const ok = (b as any).aiSummon();
    expect(ok).toBe(false);
    expect(b.aiTray.length).toBe(0);
  });

  it('AI 击杀普通怪产基础桃 PEACH_PER_KILL（无玩家加成）', () => {
    const b = new Battle(3);
    const before = b.aiPeach;
    (b as any).creditAiKill(false, false);
    expect(b.aiPeach - before).toBe(PEACH_PER_KILL);
  });
});

describe('updateAi 真玩家循环', () => {
  it('入场阶段（唐僧归位中）AI 即开始征兵布阵', () => {
    const b = new Battle(7);
    expect(b.introDone).toBe(false);
    (b as any).aiPeach = 999;
    for (let t = 0; t < 30; t++) b.step(0.1); // 3s，仍在 6s 入场窗口内
    expect(b.introDone).toBe(false);
    expect(b.aiUnits.length).toBeGreaterThan(0);
  });

  it('推进若干秒后，AI 会征兵→布阵→出现 aiUnits（无凭空铺兵、无清场字段）', () => {
    const b = new Battle(7);
    (b as any).aiPeach = 999;
    for (let t = 0; t < 200; t++) (b as any).updateAi(0.1); // 20s
    expect(b.aiUnits.length).toBeGreaterThan(0);
    for (const u of b.aiUnits) expect(b.aiUnlocked.has(`${u.cell.c},${u.cell.r}`)).toBe(true);
  });

  it('无尽模式不驱动 AI', () => {
    const b = new Battle(7, 1, undefined, undefined, undefined, undefined, undefined, true);
    for (let t = 0; t < 100; t++) (b as any).updateAi(0.1);
    expect(b.aiUnits.length).toBe(0);
  });

  it('战中调整节流：短于最小兵器间隔内至多一次', () => {
    const b = new Battle(7) as any;
    b.aiMonsters = [{ dist: 10, hp: 100, spd: 1, isBoss: true, isMiniBoss: false, spawnT: 0, hitFlash: 0, hasteT: 0, stunT: 0, slowT: 0 }];
    b.aiPathLen = 20;
    b.aiPath = [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 }, { c: 4, r: 0 }];
    b.aiUnits = [
      { type: 'archer', tier: 3, cell: { c: 0, r: 0 }, cooldown: 0, combo: 0, firePulse: 0, fireDir: 0 },
      { type: 'dao', tier: 1, cell: { c: 4, r: 0 }, cooldown: 0, combo: 0, firePulse: 0, fireDir: 0 },
    ];
    const spy = vi.spyOn(b, 'tickAiBattleAdjust');
    b.aiRepositionTimer = 0;
    b.aiSummonTimer = 999;
    b.updateAi(0.05);
    b.updateAi(0.05);
    b.updateAi(0.05);
    expect(spy.mock.calls.length).toBe(1);
    spy.mockRestore();
  });
});

describe('AI 字牌保底（对齐玩家 word pity）', () => {
  it('连续 wordPityAfter 次无字后，下一次 aiSummon 强制产出字牌', () => {
    const b = new Battle(9) as any;
    b.aiPeach = 1e9;
    b.wave = 3;
    // 把字牌保底计数顶到阈值，模拟"连续多次没出字"
    b.aiSummonsSinceWord = TUNING.wordPityAfter;
    b.aiSummonCount = 5; // 非首次征兵（首次不触发保底）
    b.aiSummon();
    expect(b.aiTray.some((t: any) => t.kind === 'word')).toBe(true);
  });
});
