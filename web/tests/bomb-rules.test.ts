// 轰天雷放置规则：唐僧格禁埋 + 每格最多一颗 + 信息弹窗伤害倍率
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { TUNING } from '../src/battle';

function readyBomb(b: Battle) {
  (b as unknown as { activeSlots: unknown[] }).activeSlots = [
    { id: 'act_bomb', cd: 0, cdMax: 60, ready: true, flash: 0 },
  ];
}

describe('轰天雷放置规则', () => {
  it('唐僧所在格不能埋雷', () => {
    const b = new Battle(7, 1);
    b.status = 'playing';
    readyBomb(b);
    const tang = b.map.tangseng;
    expect(b.placeBomb(0, tang)).toBe(false);
    expect(b.bombs.length).toBe(0);
  });

  it('同一格子最多埋一颗（第二颗被拒）', () => {
    const b = new Battle(7, 1);
    b.status = 'playing';
    readyBomb(b);
    const tang = b.map.tangseng;
    const cell = b.map.path.find((c) => !(c.c === tang.c && c.r === tang.r))!;
    expect(b.placeBomb(0, cell)).toBe(true);
    readyBomb(b);
    expect(b.placeBomb(0, cell)).toBe(false);
    expect(b.bombs.length).toBe(1);
  });

  it('AI 侧同样：唐僧格禁埋 + 每格最多一颗', () => {
    const b = new Battle(7, 1);
    b.status = 'playing';
    (b as unknown as { aiActiveSlots: unknown[] }).aiActiveSlots = [
      { id: 'act_bomb', cd: 0, cdMax: 60, ready: true, flash: 0 },
    ];
    const tang = b.aiTangseng;
    expect(b.placeAiBomb(tang)).toBe(false);
    const cell = b.aiPath.find((c) => !(c.c === tang.c && c.r === tang.r))!;
    expect(b.placeAiBomb(cell)).toBe(true);
    expect(b.placeAiBomb(cell)).toBe(false);
    expect(b.aiBombs.length).toBe(1);
  });

  it('伤害倍率为 2.0', () => {
    expect(TUNING.bombDmgMul).toBe(2.0);
  });
});
