// AI 轰天雷预埋方向验证：CD 就绪时应从离唐僧最近的路径格往外埋（而非怪跟前单颗）
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { lenOf, posAlong } from '../src/board';

function mkMonster(b: Battle, dist: number) {
  return {
    id: 1, dist, hp: 1e9, maxHp: 1e9, spd: b.endlessMonsterBaseSpeed(),
    isBoss: false, isMiniBoss: false, miniBossKind: null, isCavalry: false,
    hitFlash: 0, skill: null, skillCd: 0, castFlash: 0, spawnT: 1,
    stunT: 0, slowT: 0, hasteT: 0, healFlash: 0, burnT: 0, burnDps: 0,
  } as never;
}

describe('AI 轰天雷主动预埋', () => {
  it('CD 就绪时从离唐僧最近处往外埋（落点靠近路径末端）', () => {
    const b = new Battle(7, 1);
    b.status = 'playing';
    (b as unknown as { aiActiveSlots: unknown[] }).aiActiveSlots = [
      { id: 'act_bomb', cd: 0, cdMax: 50, ready: true, flash: 0 },
    ];
    // 怪在入口附近，确保「需要时」逻辑不会干扰；我们验证的是预埋方向
    b.aiMonsters.push(mkMonster(b, b.aiEntranceDist + 0.5));
    const tang = b.aiPath[b.aiPath.length - 1]!;
    const total = lenOf(b.aiPath);
    // 触发一次
    b.tickAiActives();
    expect(b.aiBombs.length).toBe(1);
    const bomb = b.aiBombs[0]!;
    // 落点应靠近唐僧（路径末端），dist 占总长的较大部分
    const bombDist = b.aiPath.reduce((best, cell, i) => {
      const d = Math.hypot(cell.c - bomb.c, cell.r - bomb.r);
      return d < best.d ? { d, i } : best;
    }, { d: Infinity, i: 0 });
    // 落点沿路径索引应偏末端（> 50%）
    expect(bombDist.i / b.aiPath.length).toBeGreaterThan(0.5);
  });

  it('多次触发会依次往外铺（不重复同格）', () => {
    const b = new Battle(7, 1);
    b.status = 'playing';
    (b as unknown as { aiActiveSlots: unknown[] }).aiActiveSlots = [
      { id: 'act_bomb', cd: 0, cdMax: 50, ready: true, flash: 0 },
    ];
    b.aiMonsters.push(mkMonster(b, b.aiEntranceDist + 0.5));
    for (let k = 0; k < 5; k++) {
      b.aiActiveSlots[0]!.ready = true;
      b.tickAiActives();
    }
    expect(b.aiBombs.length).toBe(5);
    // 各炸弹位置互不重叠
    const keys = new Set(b.aiBombs.map((x) => `${Math.round(x.c * 4)},${Math.round(x.r * 4)}`));
    expect(keys.size).toBe(5);
  });
});
