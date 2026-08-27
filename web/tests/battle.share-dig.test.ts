// 分享奖励：shareDigBest() 复用洛阳铲玩家侧路径自动挖最优格。
// 契约：有可挖格→挖1格(unlocked+1、digFx+1、返回true、message为分享文案)；无可挖格→返回false不改动。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META, type PeachTree } from '../src/battle';
import { MAPS } from '../src/board';

const mkBattle = () =>
  new Battle(7, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined);
const treeAt = (c: number, r: number): PeachTree => ({ level: 1, cell: { c, r }, growT: 0 });

describe('shareDigBest：分享奖励自动挖最优格', () => {
  it('有可挖格 → 挖开一格并返回 true', () => {
    const b = mkBattle();
    expect(b.status).toBe('ready'); // 初始态可挖
    expect(b.lockedCells().length).toBeGreaterThan(0);
    const before = b.unlocked.size;
    const beforeFx = b.digFx.length;
    const ok = b.shareDigBest();
    expect(ok).toBe(true);
    expect(b.unlocked.size).toBe(before + 1);
    expect(b.digFx.length).toBe(beforeFx + 1);
    expect(b.message).toBe('好友助力，铲开新阵位！');
  });

  it('只挖一格（不多挖）', () => {
    const b = mkBattle();
    const before = b.unlocked.size;
    b.shareDigBest();
    b.shareDigBest();
    expect(b.unlocked.size).toBe(before + 2); // 两次各挖一格
  });

  it('无可挖格（锁定格全被桃树占） → 返回 false 且不改动', () => {
    const b = mkBattle();
    for (const c of b.lockedCells()) b.trees.set(`${c.c},${c.r}`, treeAt(c.c, c.r));
    const before = b.unlocked.size;
    const ok = b.shareDigBest();
    expect(ok).toBe(false);
    expect(b.unlocked.size).toBe(before);
    expect(b.digFx.length).toBe(0);
  });
});

describe('hasDiggableCell', () => {
  it('有锁定非桃树格→true；全被桃树占→false', () => {
    const b = mkBattle();
    expect(b.hasDiggableCell()).toBe(true);
    for (const c of b.lockedCells()) b.trees.set(`${c.c},${c.r}`, treeAt(c.c, c.r));
    expect(b.hasDiggableCell()).toBe(false);
  });
});
