// web/tests/battle.auto-shovel.test.ts
// T9.6：洛阳铲被动重做——cd 到期自动挖一个高评分槽位，无可挖则跳过。
//
// 背景：原行为是每 45s 往库存 +1 把铲子（banking）；现改为到期直接用共享评分
// scoreDiggableCells 选最高评分槽位并开挖（与玩家手铲/拖铲同效）。本测试锁定三条契约：
//   1) cd 到期 + 有可挖高评分格 → 自动挖一格（unlocked/digFx 各 +1，洛阳铲斜光触发）；
//   2) 无可挖格（玩家侧全被桃树占）→ 不挖、不闪、不崩（计时器已重置，下周期再试）；
//   3) cd 未到 → 不提前触发。
// 另附 AI 侧镜像用例（强制 aiMods.autoShovel），验证对称生效。
//
// 构造与 battle.singleplayer-guard 同构：同 seed、difficulty=1、NO_META。luoyangchan 作为
// 开局被动注入（passives 参数），构造期 applyItem 会把 this.mods.autoShovel 置 true。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META, AUTO_SHOVEL_INTERVAL_S, type PeachTree } from '../src/battle';
import { MAPS } from '../src/board';

// 带洛阳铲被动的单人实例（玩家侧 autoShovel=true）
const mkBattle = () =>
  new Battle(7, 1, MAPS[0]!, NO_META, {}, [], ['luoyangchan'], false, undefined, 1, undefined);

// 构造一棵占格桃树（只用于占位，使 diggableCells 排除该格）
const treeAt = (c: number, r: number): PeachTree => ({ level: 1, cell: { c, r }, growT: 0 });

describe('洛阳铲被动：到期自动挖高评分槽位', () => {
  it('cd 到期且有可挖高评分格 → 自动挖一格（unlocked+1、digFx+1、洛阳铲斜光）', () => {
    const b = mkBattle();
    expect(b.mods.autoShovel).toBe(true); // 洛阳铲已注入玩家侧
    // 默认棋盘：初始 6 格已解锁，其余锁定且无桃树 → 有可挖高评分格
    expect(b.lockedCells().length).toBeGreaterThan(0);
    const before = b.unlocked.size;
    const beforeFx = b.digFx.length;
    // 把洛阳铲计时顶到距到期 0.01s
    b.setAutoShovelTimerForTest(AUTO_SHOVEL_INTERVAL_S - 0.01);
    b.step(0.05); // 跨过 45s → 触发一次自动挖
    expect(b.unlocked.size).toBe(before + 1); // 挖开一个新阵位
    expect(b.digFx.length).toBe(beforeFx + 1); // 挖坑动画已推入
    expect((b.passiveFlash.get('luoyangchan') ?? 0)).toBeGreaterThan(0); // 洛阳铲斜光反馈
  });

  it('计时器重置：同一步内不会连挖，跨过到期只挖一次', () => {
    const b = mkBattle();
    const before = b.unlocked.size;
    b.setAutoShovelTimerForTest(AUTO_SHOVEL_INTERVAL_S - 0.01);
    b.step(0.05); // 触发一次
    expect(b.unlocked.size).toBe(before + 1);
    // 紧接着再 step 一小段（远未到下一个 45s）：不应再挖
    b.step(0.5);
    expect(b.unlocked.size).toBe(before + 1); // 仍只多 1 格
  });

  it('cd 未到（10s）不触发：阵位数不变', () => {
    const b = mkBattle();
    const before = b.unlocked.size;
    b.setAutoShovelTimerForTest(10); // 远未到 45s
    b.step(0.05);
    expect(b.unlocked.size).toBe(before); // 没挖
    expect(b.digFx.length).toBe(0); // 无挖坑动画
  });

  it('无可挖格（玩家侧锁定格全被桃树占）→ 不挖、不闪、不崩', () => {
    const b = mkBattle();
    // 把所有锁定格都种上桃树 → 玩家侧 diggableCells 变空（useShovelOn 也不能开垦桃树）
    for (const c of b.lockedCells()) b.trees.set(`${c.c},${c.r}`, treeAt(c.c, c.r));
    expect(b.lockedCells().length).toBeGreaterThan(0); // 仍有锁定格，但都被桃树占了
    const before = b.unlocked.size;
    b.setAutoShovelTimerForTest(AUTO_SHOVEL_INTERVAL_S - 0.01);
    b.step(0.05); // 到期但无候选 → 跳过
    expect(b.unlocked.size).toBe(before); // 没挖
    expect(b.digFx.length).toBe(0); // 无挖坑动画
    expect((b.passiveFlash.get('luoyangchan') ?? 0)).toBe(0); // 没闪（无挖则不反馈）
  });

  it('多个可挖格时只挖一格，且挖中的是原锁定可挖格（无桃树）', () => {
    const b = mkBattle();
    const openBefore = b.unlocked.size;
    // 可挖格 = 锁定且无桃树（玩家侧 diggableCells 口径）
    const diggableBefore = b.lockedCells().filter((c) => !b.trees.has(`${c.c},${c.r}`));
    expect(diggableBefore.length).toBeGreaterThan(1); // 多个候选，确保「选一个」有意义
    b.setAutoShovelTimerForTest(AUTO_SHOVEL_INTERVAL_S - 0.01);
    b.step(0.05);
    expect(b.unlocked.size).toBe(openBefore + 1); // 恰好多开一格（不多挖）
    // 新开的那个格确实原属可挖集合
    const newlyOpened = diggableBefore.filter((c) => b.unlocked.has(`${c.c},${c.r}`));
    expect(newlyOpened.length).toBe(1);
  });
});

describe('洛阳铲被动：AI 侧镜像', () => {
  it('AI 侧到期自动挖一格（aiUnlocked+1、aiDigFx+1、AI 斜光）', () => {
    const b = mkBattle();
    // AI 不随机携带洛阳铲（见 AI_EXCLUDED_PASSIVES），这里强制挂上以验证镜像路径
    b.aiMods.autoShovel = true;
    expect(b.aiLockedCells().length).toBeGreaterThan(0); // AI 侧有可挖格
    const before = b.aiUnlocked.size;
    const beforeFx = b.aiDigFx.length;
    b.setAutoShovelTimerForTest(AUTO_SHOVEL_INTERVAL_S - 0.01, true);
    b.step(0.05);
    expect(b.aiUnlocked.size).toBe(before + 1); // AI 挖开一格
    expect(b.aiDigFx.length).toBe(beforeFx + 1); // AI 挖坑动画
    expect((b.aiPassiveFlash.get('luoyangchan') ?? 0)).toBeGreaterThan(0); // AI 侧斜光
  });

  it('AI 侧无锁定格时不挖', () => {
    const b = mkBattle();
    b.aiMods.autoShovel = true;
    // 解锁所有 AI 格 → aiLockedCells 空 → 无可挖
    for (const c of b.aiCells) b.aiUnlocked.add(`${c.c},${c.r}`);
    expect(b.aiLockedCells().length).toBe(0);
    const before = b.aiUnlocked.size;
    b.setAutoShovelTimerForTest(AUTO_SHOVEL_INTERVAL_S - 0.01, true);
    b.step(0.05);
    expect(b.aiUnlocked.size).toBe(before); // 没挖
    expect(b.aiDigFx.length).toBe(0);
  });
});
