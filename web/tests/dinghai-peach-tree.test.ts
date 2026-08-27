// web/tests/dinghai-peach-tree.test.ts
// 需求1：定海针（自动定海针被动）自动挖格子时跳过「种了桃树」的格 —— 桃树格不可开垦，
//        改开下一个「无树」的锁定格；若锁定格全被桃树占则本轮不开（与洛阳铲 playerAutoDigCell 一致）。
// 需求2：若只剩桃树占着的未挖格、没有其他可直接开挖的空位，则单次征兵最多出 1 把铲子
//        （无空位可供挪树腾挖，铲子再多也只够先处理一棵，避免铲子刷满 tray）。
//
// 构造与 battle.auto-shovel 同构：同 seed、difficulty=1、NO_META。dinghai 作为开局被动注入。
// openDinghaiSlot / shovelUsefulSlots 是私有方法，测试经 (b as any) 访问（与既有测试一致）。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META, type PeachTree } from '../src/battle';
import { MAPS } from '../src/board';

// 带「自动定海针」被动的单人实例（开局会首开 1 阵位）
const mkDinghai = () =>
  new Battle(7, 1, MAPS[0]!, NO_META, {}, [], ['dinghai'], false, undefined, 1, undefined);

// 占格桃树（只用于占位，使该格「已种桃树 → 不可开垦」）
const treeAt = (c: number, r: number): PeachTree => ({ level: 1, cell: { c, r }, growT: 0 });
const key = (c: { c: number; r: number }) => `${c.c},${c.r}`;

describe('需求1 · 定海针跳过桃树格', () => {
  it('下一个待开格被桃树占 → 跳过它、改开第一个「无树」锁定格', () => {
    const b = mkDinghai();
    const locked = b.lockedCells(); // 贴路顺序
    expect(locked.length).toBeGreaterThan(1);
    const treeCell = locked[0]!; // 定海针原本会开的第一个格
    const nextFree = locked[1]!; // 期望改开的第一个无树格
    b.trees.set(key(treeCell), treeAt(treeCell.c, treeCell.r));

    const opened = (b as any).openDinghaiSlot(false);

    expect(opened).toBe(true);
    expect(b.unlocked.has(key(treeCell))).toBe(false); // 桃树格没被挖开
    expect(b.unlocked.has(key(nextFree))).toBe(true); // 改开了下一个无树格
  });

  it('所有锁定格都被桃树占 → 本轮不开格、返回 false、unlocked 不变', () => {
    const b = mkDinghai();
    for (const c of b.lockedCells()) b.trees.set(key(c), treeAt(c.c, c.r));
    const before = b.unlocked.size;

    const opened = (b as any).openDinghaiSlot(false);

    expect(opened).toBe(false);
    expect(b.unlocked.size).toBe(before);
  });

  it('无桃树 → 行为不变：开第一个锁定格（回归）', () => {
    const b = mkDinghai();
    const first = b.lockedCells()[0]!;

    const opened = (b as any).openDinghaiSlot(false);

    expect(opened).toBe(true);
    expect(b.unlocked.has(key(first))).toBe(true);
  });
});

describe('需求2 · 只剩桃树挡着时征兵最多 1 把铲子', () => {
  it('diggable=0 且有桃树 → shovelUsefulSlots()===1', () => {
    const b = mkDinghai();
    const locked = b.lockedCells();
    for (const c of locked) b.trees.set(key(c), treeAt(c.c, c.r)); // 全锁定格种树：无其他可挖空位
    expect(locked.length).toBeGreaterThan(1); // 确保「1」不是巧合等于真实待挖数
    expect(b.trees.size).toBeGreaterThan(1);

    expect((b as any).shovelUsefulSlots()).toBe(1);
  });

  it('还有可直接开挖的空位 → shovelUsefulSlots() 不变（无树待挖 + 桃树数）(回归)', () => {
    const b = mkDinghai();
    const locked = b.lockedCells();
    b.trees.set(key(locked[0]!), treeAt(locked[0]!.c, locked[0]!.r)); // 仅 1 格种树，其余可直接挖
    const expected = (locked.length - 1) + 1; // diggable(无树锁定格) + trees.size

    expect((b as any).shovelUsefulSlots()).toBe(expected);
  });

  it('阵位全开（无锁定格） → shovelUsefulSlots()===0（回归）', () => {
    const b = mkDinghai();
    for (const c of b.lockedCells()) b.unlocked.add(key(c));
    expect(b.lockedCells().length).toBe(0);

    expect((b as any).shovelUsefulSlots()).toBe(0);
  });

  it('端到端：只剩桃树挡着 + 连续强制出铲保底 → 每次征兵铲子数 ≤1', () => {
    const b = mkDinghai();
    (b as any).wave = 20; // 越过前期出铲限制窗口
    for (const c of b.lockedCells()) b.trees.set(key(c), treeAt(c.c, c.r)); // 只剩桃树挡着
    let maxShovels = 0;
    for (let i = 0; i < 30; i++) {
      b.peach = 99999; // 保证够征兵
      (b as any).summonsSinceShovel = 999; // 顶满铲子保底 → 强制出铲
      expect(b.summon()).toBe(true);
      const shovels = b.tray.filter((t: any) => t && t.kind === 'shovel').length;
      maxShovels = Math.max(maxShovels, shovels);
    }
    expect(maxShovels).toBeLessThanOrEqual(1);
  });
});
