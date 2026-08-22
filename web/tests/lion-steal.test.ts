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
  for (let i = 1; i < map.path.length; i++) {
    const a = map.path[i - 1]!, c = map.path[i]!;
    if (a.c === pathCell.c && a.r === pathCell.r) break;
    dist += Math.hypot(c.c - a.c, c.r - a.r);
    if (c.c === pathCell.c && c.r === pathCell.r) break;
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
    const map = MAPS[0]!;
    const { b, lion } = lionOnPath(map, { c: 4, r: 6 }, 0);
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    expect(lion.miniBossCasted).toBe(false); // 没偷到、未置位
    expect(lion.skillCd).toBeGreaterThan(0); // 被重置为 miniBossInterval 等下轮
  });

  it('偷到一次后 miniBossCasted=true、后续再不偷（依赖 Task 4 的 lion 施法效果）', () => {
    const map = MAPS[0]!;
    const target = { c: 3, r: 5 };
    const { b, lion } = lionOnPath(map, { c: 4, r: 6 }, 0);
    b.units.set(`${target.c},${target.r}`, makePlacedUnit('dao', 1, target));
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    expect(lion.miniBossCasted).toBe(true); // << Task 4 实现后为 true；本任务会仍为 false
    expect(b.units.has(`${target.c},${target.r}`)).toBe(false);
  });
});
