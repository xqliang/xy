import { describe, it, expect } from 'vitest';
import { Battle, TUNING, makePlacedUnit, type Monster } from '../src/battle';
import { MAPS, type GameMap } from '../src/board';

function pathDistAt(map: GameMap, cell: { c: number; r: number }): number {
  let dist = 0;
  for (let i = 1; i < map.path.length; i++) {
    const a = map.path[i - 1]!;
    const b = map.path[i]!;
    const seg = Math.hypot(b.c - a.c, b.r - a.r);
    if (a.c === cell.c && a.r === cell.r) return dist;
    dist += seg;
    if (b.c === cell.c && b.r === cell.r) return dist;
  }
  return dist;
}

function eliteMonster(partial: Partial<Monster> & { dist: number }): Monster {
  return {
    id: 1,
    hp: 200,
    maxHp: 200,
    spd: 0,
    isBoss: false,
    isMiniBoss: false,
    miniBossKind: null,
    isCavalry: false,
    hitFlash: 0,
    skill: 'stun',
    skillCd: 0,
    castFlash: 0,
    spawnT: 1,
    stunT: 0,
    slowT: 0,
    hasteT: 0,
    healFlash: 0,
    burnT: 0,
    burnDps: 0,
    ...partial,
  };
}

describe('monster control debuff limits', () => {
  it('skill radius is at most 1 cell', () => {
    expect(TUNING.skillRadius).toBeLessThanOrEqual(1);
  });

  it('control skill only hits the nearest weapon within 1 cell', () => {
    const map = MAPS.find((m) => m.id === 'baiguling') ?? MAPS[0]!;
    const b = new Battle(1, 1, map);
    // 路径格 (4,6)：正交邻格命中，对角/远处不命中
    const pathCell = { c: 4, r: 6 };
    const adj = { c: 3, r: 6 }; // d=1
    const diag = { c: 3, r: 5 }; // d=√2≈1.41 > 1
    const farCell = { c: 1, r: 6 }; // d=3

    b.units.set(`${adj.c},${adj.r}`, makePlacedUnit('dao', 1, adj));
    b.units.set(`${diag.c},${diag.r}`, makePlacedUnit('spear', 1, diag));
    b.units.set(`${farCell.c},${farCell.r}`, makePlacedUnit('archer', 1, farCell));

    b.monsters.push(eliteMonster({ id: 9, dist: pathDistAt(map, pathCell), skillCd: 0 }));
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);

    const hit = b.units.get(`${adj.c},${adj.r}`)!;
    const missDiag = b.units.get(`${diag.c},${diag.r}`)!;
    const missFar = b.units.get(`${farCell.c},${farCell.r}`)!;
    expect(hit.stunT).toBeGreaterThan(0);
    expect(missDiag.stunT).toBe(0);
    expect(missFar.stunT).toBe(0);
  });

  it('when two weapons are within 1 cell, only the nearest is debuffed', () => {
    const map = MAPS.find((m) => m.id === 'baiguling') ?? MAPS[0]!;
    const b = new Battle(2, 1, map);
    const pathCell = { c: 4, r: 6 };
    // 两把都在半径内；怪物偏左，应只打更近的 a
    const a = { c: 3, r: 6 };
    const bb = { c: 5, r: 6 };
    b.units.set(`${a.c},${a.r}`, makePlacedUnit('dao', 1, a));
    b.units.set(`${bb.c},${bb.r}`, makePlacedUnit('spear', 1, bb));

    // 路径 (3,6)->(4,6)->(5,6)：dist 取 (4,6) 再略偏左，使 a 更近
    const base = pathDistAt(map, pathCell);
    b.monsters.push(eliteMonster({ id: 3, dist: base - 0.35, skillCd: 0 }));
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);

    const ua = b.units.get(`${a.c},${a.r}`)!;
    const ub = b.units.get(`${bb.c},${bb.r}`)!;
    const hitCount = (ua.stunT > 0 ? 1 : 0) + (ub.stunT > 0 ? 1 : 0);
    expect(hitCount).toBe(1);
    expect(ua.stunT).toBeGreaterThan(0); // 偏左 → 打近的 a
    expect(ub.stunT).toBe(0);
  });

  it('weapon is immune to the same debuff for a while after being hit', () => {
    const map = MAPS.find((m) => m.id === 'baiguling') ?? MAPS[0]!;
    const b = new Battle(3, 1, map);
    const pathCell = { c: 4, r: 6 };
    const cell = { c: 3, r: 6 };
    b.units.set(`${cell.c},${cell.r}`, makePlacedUnit('dao', 1, cell));
    b.monsters.push(eliteMonster({ id: 1, dist: pathDistAt(map, pathCell), skillCd: 0 }));
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    const u = b.units.get(`${cell.c},${cell.r}`)!;
    expect(u.stunT).toBeGreaterThan(0);

    // 清掉当前眩晕，立刻再施法：应被免疫挡住
    u.stunT = 0;
    const m = b.monsters[0]!;
    m.skillCd = 0;
    b.step(0.05);
    expect(u.stunT).toBe(0);

    // 推进超过免疫时间后再施法应生效
    b.step(TUNING.debuffImmuneDur + 0.1);
    m.skillCd = 0;
    b.step(0.05);
    expect(u.stunT).toBeGreaterThan(0);
  });

  it('does not spawn skilled elites back-to-back without a gap', () => {
    // 把精英概率拉满，仍应在两次精英之间至少隔 eliteMinGap 只普通妖
    const origChance = TUNING.eliteChance;
    const origFrom = TUNING.eliteFromWave;
    (TUNING as { eliteChance: number }).eliteChance = 1;
    (TUNING as { eliteFromWave: number }).eliteFromWave = 1;
    try {
      const b = new Battle(11);
      (b as unknown as { wave: number }).wave = 5;
      (b as unknown as { waveActive: boolean }).waveActive = false;
      (b as unknown as { status: string }).status = 'ready';
      b.tangsengHP = 99;
      b.aiTangsengHP = 99;
      expect(b.startNextWave()).toBe(true);

      const skills: boolean[] = [];
      let guard = 0;
      while (skills.length < 12 && guard++ < 800) {
        const before = b.monsters.length;
        b.step(0.2);
        if (b.monsters.length > before) {
          for (let i = before; i < b.monsters.length; i++) {
            const m = b.monsters[i]!;
            if (m.isBoss || m.isMiniBoss) continue;
            skills.push(m.skill != null);
          }
        }
      }
      expect(skills.length).toBeGreaterThan(4);
      // 任意两次 true 之间至少隔 eliteMinGap 个 false
      let sinceElite = TUNING.eliteMinGap; // 开局允许出第一只
      for (const has of skills) {
        if (has) {
          expect(sinceElite).toBeGreaterThanOrEqual(TUNING.eliteMinGap);
          sinceElite = 0;
        } else {
          sinceElite++;
        }
      }
    } finally {
      (TUNING as { eliteChance: number }).eliteChance = origChance;
      (TUNING as { eliteFromWave: number }).eliteFromWave = origFrom;
    }
  });
});
