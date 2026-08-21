// web/tests/battle.pvp-ctor.test.ts
// Plan C Task 3：Battle 构造加 pvp 选项后，PvP 模式对手侧无本地 AI 生成物。
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { MAPS } from '../src/board';

describe('Battle pvp 构造', () => {
  it('pvp 模式不本地生成 AI 配装/征兵（对手侧起始为空，等回放）', () => {
    const b = new Battle(123, 1, MAPS[0]!, undefined, {}, [], [], false, undefined, 1, undefined, { enabled: true });
    const s = b.snapshot();
    expect(b.aiUnits.length).toBe(0);       // 无本地 AI 决策产生的初始单位
    expect(s.aiDefeated).toBe(false);
    expect(b.wave).toBe(0);
    // aiPickedItems 应为空（未 rollAiLoadout）
    expect(b.aiPickedItems.length).toBe(0);
  });
  it('pvp=false（默认）行为与既有一致（回归）', () => {
    const b = new Battle(123, 1, MAPS[0]!);
    expect(b.wave).toBe(0);
  });
});
