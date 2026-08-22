import { describe, it, expect } from 'vitest';
import { MINI_BOSS_KINDS, MINI_BOSS_META, TUNING, Battle, makePlacedUnit, type Monster } from '../src/battle';
import { MAPS, type GameMap } from '../src/board';

describe('黄狮精 lion 小 Boss 登记', () => {
  it('lion 在合法种类列表与 meta 中', () => {
    expect(MINI_BOSS_KINDS).toContain('lion');
    const meta = MINI_BOSS_META.lion;
    expect(meta.name).toBe('黄狮精');
    expect(meta.skillName).toBe('卷走');
    expect(meta.color).toBeTruthy();
    expect(meta.icon).toBeTruthy();
    expect(meta.desc).toContain('卷走');
  });

  it('steal 调参存在且范围合法', () => {
    expect(TUNING.miniBossStealRadius).toBe(3);
    expect(TUNING.miniBossStealDelayMin).toBeGreaterThanOrEqual(1);
    expect(TUNING.miniBossStealDelayMax).toBeGreaterThan(TUNING.miniBossStealDelayMin);
  });
});

// 造一只静止在路径某格的黄狮精（spd=0 不移动；skillCd 可控，便于确定性推进施法）
function lionOnPath(map: GameMap, pathCell: { c: number; r: number }, skillCd: number): { b: Battle; lion: Monster } {
  const b = new Battle(1, 1, map);
  let dist = 0;
  let found = false;
  for (let i = 1; i < map.path.length; i++) {
    const a = map.path[i - 1]!, c = map.path[i]!;
    if (a.c === pathCell.c && a.r === pathCell.r) { found = true; break; }
    dist += Math.hypot(c.c - a.c, c.r - a.r);
    if (c.c === pathCell.c && c.r === pathCell.r) { found = true; break; }
  }
  if (!found) {
    // 请求格不在路径上（如火焰山无中行路径）：就近停到最近路径格，保证半径内可命中目标
    let best = 0, bestD = Infinity;
    for (let i = 0; i < map.path.length; i++) {
      const p = map.path[i]!;
      const d = Math.hypot(p.c - pathCell.c, p.r - pathCell.r);
      if (d < bestD) { bestD = d; best = i; }
    }
    dist = 0;
    for (let i = 1; i <= best; i++) {
      const a = map.path[i - 1]!, c = map.path[i]!;
      dist += Math.hypot(c.c - a.c, c.r - a.r);
    }
  }
  const lion: Monster = {
    id: 999, dist, hp: 500, maxHp: 500, spd: 0,
    isBoss: false, isMiniBoss: true, miniBossKind: 'lion', isCavalry: false,
    hitFlash: 0, skill: null, skillCd, castFlash: 0, spawnT: 1,
    stunT: 0, slowT: 0, hasteT: 0, healFlash: 0, burnT: 0, burnDps: 0,
    miniBossCasted: false,
  };
  b.monsters.push(lion);
  (b as unknown as { tangsengHP: number }).tangsengHP = 99; // 防漏怪判负
  return { b, lion };
}

describe('黄狮精 一次性触发', () => {
  it('半径内无目标时不消耗机会、会重试', () => {
    const map = MAPS.find((m) => m.id === 'baiguling') ?? MAPS[0]!;
    const { b, lion } = lionOnPath(map, { c: 4, r: 6 }, 0);
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    expect(lion.miniBossCasted).toBe(false); // 没偷到、未置位
    expect(lion.skillCd).toBeGreaterThan(0); // 被重置为 miniBossInterval 等下轮
  });

  it('偷到一次后 miniBossCasted=true、后续再不偷（依赖 Task 4 的 lion 施法效果）', () => {
    const map = MAPS.find((m) => m.id === 'baiguling') ?? MAPS[0]!;
    const target = { c: 3, r: 5 };
    const { b, lion } = lionOnPath(map, { c: 4, r: 6 }, 0);
    b.units.set(`${target.c},${target.r}`, makePlacedUnit('dao', 1, target));
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    expect(lion.miniBossCasted).toBe(true); // << Task 4 实现后为 true；本任务会仍为 false
    expect(b.units.has(`${target.c},${target.r}`)).toBe(false);
  });
});

describe('黄狮精 卷走目标', () => {
  it('卷走兵器：永久删除、不入 tray、不给蟠桃', () => {
    const map = MAPS.find((m) => m.id === 'baiguling') ?? MAPS[0]!;
    const target = { c: 3, r: 5 };
    const { b } = lionOnPath(map, { c: 4, r: 6 }, 0);
    b.units.set(`${target.c},${target.r}`, makePlacedUnit('dao', 1, target));
    const peachBefore = b.peach;
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    expect(b.units.has(`${target.c},${target.r}`)).toBe(false);
    expect(b.tray.every((s) => s === null)).toBe(true); // 兵器没退回候选区
    expect(b.peach).toBe(peachBefore); // 无蟠桃奖励
  });

  it('卷走英雄字块：孤儿字直接删除', () => {
    const map = MAPS.find((m) => m.id === 'baiguling') ?? MAPS[0]!;
    const wcell = { c: 2, r: 5 };
    const { b } = lionOnPath(map, { c: 3, r: 6 }, 0);
    b.words.set(`${wcell.c},${wcell.r}`, { char: '大', general: 'dasheng', tier: 1, cell: wcell });
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    expect(b.words.has(`${wcell.c},${wcell.r}`)).toBe(false);
  });

  it('配对英雄只拆一字：成对时随机拆一字，另一字保留、配对解散', () => {
    const map = MAPS.find((m) => m.id === 'baiguling') ?? MAPS[0]!;
    // '大'=2,5 与 '圣'=3,5 左右紧邻成「大圣」对，距狮子(4,6) 分别 √5≈2.24、√2≈1.41，都在半径 3 内
    const aChar = { c: 2, r: 5 };
    const bChar = { c: 3, r: 5 };
    const { b } = lionOnPath(map, { c: 4, r: 6 }, 0);
    b.words.set(`${aChar.c},${aChar.r}`, { char: '大', general: 'dasheng', tier: 1, cell: aChar });
    b.words.set(`${bChar.c},${bChar.r}`, { char: '圣', general: 'dasheng', tier: 1, cell: bChar });
    expect(b.activeGenerals().length).toBe(1); // 开局成对
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    // 2 字都在半径内 → 随机取 1 字删除；结果与随机到哪个字无关：恰剩 1 字、配对必解散
    expect(b.words.size).toBe(1);
    expect(b.activeGenerals().length).toBe(0);
  });

  it('卷走桃树：永久删除', () => {
    const map = MAPS.find((m) => m.id === 'baiguling') ?? MAPS[0]!;
    const tcell = { c: 3, r: 5 };
    const { b } = lionOnPath(map, { c: 4, r: 6 }, 0);
    b.trees.set(`${tcell.c},${tcell.r}`, { level: 3, cell: tcell, growT: 0 });
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    expect(b.trees.has(`${tcell.c},${tcell.r}`)).toBe(false);
  });
});

describe('黄狮精 特效与提示', () => {
  it('偷到后弹出金色 death 粒子 + 底部提示带目标名', () => {
    const map = MAPS.find((m) => m.id === 'baiguling') ?? MAPS[0]!;
    const target = { c: 3, r: 5 };
    const { b, lion } = lionOnPath(map, { c: 4, r: 6 }, 0);
    b.units.set(`${target.c},${target.r}`, makePlacedUnit('dao', 1, target));
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    // 被偷格有金色 death 粒子
    const burst = b.bursts.find((x) => x.c === target.c && x.r === target.r && x.kind === 'death');
    expect(burst).toBeTruthy();
    expect(burst!.color).toBe(MINI_BOSS_META.lion.color);
    // 底部提示包含怪物名 + 目标名
    expect(b.message).toContain('黄狮精');
    expect(b.message).toContain('刀兵');
    expect(lion.castFlash).toBeGreaterThan(0);
  });
});
