import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';

const K = (c: number, r: number) => `${c},${r}`;

describe('英雄 level 与 tier 同步(修复复用state残留高level)', () => {
  it('篡改 state.level=5 后再查应纠正回 tier=1，expToNext=10.5', () => {
    const b = new Battle(1, 1, mapById('baiguling'));
    b.words.set(K(1, 6), { char: '观', general: 'guanyin', tier: 1, cell: { c: 1, r: 6 } } as never);
    b.words.set(K(2, 6), { char: '音', general: 'guanyin', tier: 1, cell: { c: 2, r: 6 } } as never);
    const g1 = b.activeGenerals().find((g) => g.def.id === 'guanyin');
    expect(g1).toBeDefined();
    expect(g1!.tier).toBe(1);
    // 模拟复用 state 残留的高 level（旧高阶观音死亡/换字后）
    g1!.state.level = 5;
    g1!.state.exp = 120; // 残留高 exp：纠正后不应触发瞬间连升
    // 再次查询：应把 level 纠正回当前 tier
    const g2 = b.activeGenerals().find((g) => g.def.id === 'guanyin')!;
    expect(g2.tier).toBe(1);
    expect(g2.state.level).toBe(1);
    expect(g2.state.exp).toBe(0);
    expect(Battle.expToNext(g2.state.level, g2.def)).toBeCloseTo(10.5, 1);
  });

  it('AI 侧同样纠正', () => {
    const b = new Battle(1, 1, mapById('baiguling'));
    b.aiWords.set(K(1, 6), { char: '观', general: 'guanyin', tier: 1, cell: { c: 1, r: 6 } } as never);
    b.aiWords.set(K(2, 6), { char: '音', general: 'guanyin', tier: 1, cell: { c: 2, r: 6 } } as never);
    const g1 = b.aiActiveGenerals().find((g) => g.def.id === 'guanyin')!;
    g1.state.level = 5;
    g1.state.exp = 120;
    const g2 = b.aiActiveGenerals().find((g) => g.def.id === 'guanyin')!;
    expect(g2.state.level).toBe(1);
    expect(g2.state.exp).toBe(0);
  });
});
