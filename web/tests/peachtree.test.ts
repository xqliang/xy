import { describe, it, expect } from 'vitest';
import { Battle, PEACH_TREE_INTERVALS } from '../src/battle';

// 桃树系统：产桃间隔、倒计时、拖动合并/移动、铲子限制。
// 说明：种树/产桃只在 status 为 playing/ready 时推进；用开局 intro(ready, <6s) 窗口做产桃计时测试。

function fresh(): Battle {
  // 参数：seed, 难度, 地图, 功德加成, 神兵, 主动技能, 被动技能(装备蟠桃园)
  return new Battle(1, 1, undefined, undefined, undefined, [], ['pas_pantao']);
}

describe('桃树倒计时/产桃', () => {
  it('各等级产桃间隔为 20/10/5/3/2s', () => {
    expect(PEACH_TREE_INTERVALS).toEqual([20, 10, 5, 3, 2]);
  });

  it('treeCountdown = 间隔 - 已积累', () => {
    const b = fresh();
    expect(b.treeCountdown({ level: 1, cell: { c: 0, r: 9 }, growT: 5 })).toBeCloseTo(15, 5);
    expect(b.treeCountdown({ level: 5, cell: { c: 0, r: 9 }, growT: 0 })).toBeCloseTo(2, 5);
  });

  it('1级树满 20s 产 1 桃', () => {
    const b = fresh();
    const cell = b.lockedCells()[0]!;
    b.trees.set(`${cell.c},${cell.r}`, { level: 1, cell, growT: 19.9 });
    const before = b.peach;
    for (let i = 0; i < 12; i++) b.step(1 / 60); // ~0.2s，仍在 intro 窗口
    expect(b.peach - before).toBe(1);
  });

  it('5级树满 2s 产 1 桃', () => {
    const b = fresh();
    const cell = b.lockedCells()[0]!;
    b.trees.set(`${cell.c},${cell.r}`, { level: 5, cell, growT: 1.9 });
    const before = b.peach;
    for (let i = 0; i < 12; i++) b.step(1 / 60);
    expect(b.peach - before).toBe(1);
  });
});

describe('桃树拖动合并/移动', () => {
  it('同级拖动合并升级(≤5)，源树消失', () => {
    const b = fresh();
    const locked = b.lockedCells();
    const a = locked[0]!, c = locked[1]!;
    b.trees.set(`${a.c},${a.r}`, { level: 2, cell: a, growT: 0 });
    b.trees.set(`${c.c},${c.r}`, { level: 2, cell: c, growT: 0 });
    expect(b.dragTree(a, c)).toBe(true);
    expect(b.trees.has(`${a.c},${a.r}`)).toBe(false);
    expect(b.trees.get(`${c.c},${c.r}`)!.level).toBe(3);
  });

  it('拖到空的未开垦格 → 移动', () => {
    const b = fresh();
    const locked = b.lockedCells();
    const a = locked[0]!, c = locked[1]!;
    b.trees.set(`${a.c},${a.r}`, { level: 1, cell: a, growT: 0 });
    expect(b.dragTree(a, c)).toBe(true);
    expect(b.trees.has(`${a.c},${a.r}`)).toBe(false);
    expect(b.trees.get(`${c.c},${c.r}`)!.level).toBe(1);
  });
});

describe('铲子不能开垦有桃树的格', () => {
  it('useShovelOn 有桃树的锁定格返回 false', () => {
    const b = fresh();
    const cell = b.lockedCells()[0]!;
    b.trees.set(`${cell.c},${cell.r}`, { level: 1, cell, growT: 0 });
    b.shovels = 3;
    expect(b.useShovelOn(cell)).toBe(false);
    expect(b.trees.has(`${cell.c},${cell.r}`)).toBe(true);
  });
});
