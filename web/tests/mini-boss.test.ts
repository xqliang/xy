import { describe, it, expect } from 'vitest';
import { Battle, TUNING, MINI_BOSS_KINDS, makePlacedUnit } from '../src/battle';
import { MAPS } from '../src/board';

describe('mini-boss spawn & skills', () => {
  it('does not schedule mini-boss before wave 5', () => {
    for (let seed = 1; seed < 50; seed++) {
      const b = new Battle(seed);
      expect(b.startNextWave()).toBe(true); // wave 1
      expect((b as unknown as { waveMiniBoss: unknown }).waveMiniBoss).toBeNull();
    }
  });

  it('never schedules mini-boss on a boss wave', () => {
    for (let seed = 1; seed < 60; seed++) {
      const b = new Battle(seed);
      for (let w = 1; w <= TUNING.winWave; w++) {
        (b as unknown as { waveActive: boolean }).waveActive = false;
        (b as unknown as { status: string }).status = 'ready';
        b.startNextWave();
        if (b.isBossWave(w)) {
          expect((b as unknown as { waveMiniBoss: unknown }).waveMiniBoss).toBeNull();
          expect((b as unknown as { miniBossSpawnIdx: number }).miniBossSpawnIdx).toBe(-1);
        }
      }
    }
  });

  it('can schedule and spawn mini-boss on non-boss waves after wave 4', () => {
    let seen = false;
    for (let seed = 1; seed < 150 && !seen; seed++) {
      const b = new Battle(seed);
      for (let w = 1; w <= TUNING.winWave && !seen; w++) {
        b.monsters.length = 0;
        b.aiMonsters.length = 0;
        b.tangsengHP = 99; // 防止空板漏怪提前判负、中断出怪
        b.aiTangsengHP = 99;
        (b as unknown as { waveActive: boolean }).waveActive = false;
        (b as unknown as { status: string }).status = 'ready';
        b.startNextWave();
        const kind = (b as unknown as { waveMiniBoss: string | null }).waveMiniBoss;
        const idx = (b as unknown as { miniBossSpawnIdx: number }).miniBossSpawnIdx;
        if (!b.isBossWave(w) && w >= TUNING.miniBossFromWave && kind != null && idx >= 0) {
          seen = true;
          expect(MINI_BOSS_KINDS).toContain(kind);
          let guard = 0;
          while (b.monsters.filter((m) => m.isMiniBoss).length === 0 && guard++ < 500) {
            b.step(0.2);
          }
          const mini = b.monsters.find((m) => m.isMiniBoss);
          expect(mini).toBeTruthy();
          expect(mini!.miniBossKind).toBe(kind);
          expect(mini!.skill).toBeNull();
          expect(mini!.maxHp).toBeGreaterThan(TUNING.monsterHpBase);
        }
      }
    }
    expect(seen).toBe(true);
  });

  it('quake mini-boss can knock down nearby weapons', () => {
    const map = MAPS[0]!;
    const b = new Battle(1, 1, map);
    // 找靠近路径的解锁格
    const cell = b.unlockedCells().sort((a, c) => {
      const da = Math.min(...map.path.map((p) => Math.hypot(p.c - a.c, p.r - a.r)));
      const dc = Math.min(...map.path.map((p) => Math.hypot(p.c - c.c, p.r - c.r)));
      return da - dc;
    })[0]!;
    b.units.set(`${cell.c},${cell.r}`, makePlacedUnit('monkey', 1, { c: cell.c, r: cell.r }));
    const near = map.path.reduce((best, p) => {
      const d = Math.hypot(p.c - cell.c, p.r - cell.r);
      return d < best.d ? { p, d } : best;
    }, { p: map.path[0]!, d: Infinity });
    // 把小 Boss 放到路径上最近格对应的 progress
    let dist = 0;
    for (let i = 1; i < map.path.length; i++) {
      const a = map.path[i - 1]!, bb = map.path[i]!;
      const seg = Math.hypot(bb.c - a.c, bb.r - a.r);
      if (a.c === near.p.c && a.r === near.p.r) break;
      dist += seg;
      if (bb.c === near.p.c && bb.r === near.p.r) break;
    }
    b.monsters.push({
      id: 999,
      dist,
      hp: 200,
      maxHp: 200,
      spd: 0,
      isBoss: false,
      isMiniBoss: true,
      miniBossKind: 'quake',
      isCavalry: false,
      hitFlash: 0,
      skill: null,
      skillCd: 0,
      castFlash: 0,
      spawnT: 1,
      stunT: 0,
      slowT: 0,
      hasteT: 0,
      healFlash: 0,
    });
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    const u = b.units.get(`${cell.c},${cell.r}`)!;
    expect(near.d).toBeLessThanOrEqual(TUNING.miniBossRadius + 0.5);
    expect(u.knockdownT).toBeGreaterThan(0);
  });

  it('gale mini-boss hastes nearby monsters', () => {
    const b = new Battle(2);
    b.monsters.push({
      id: 1,
      dist: 2,
      hp: 50,
      maxHp: 50,
      spd: 0,
      isBoss: false,
      isMiniBoss: true,
      miniBossKind: 'gale',
      isCavalry: false,
      hitFlash: 0,
      skill: null,
      skillCd: 0,
      castFlash: 0,
      spawnT: 1,
      stunT: 0,
      slowT: 0,
      hasteT: 0,
      healFlash: 0,
    });
    b.monsters.push({
      id: 2,
      dist: 2.3,
      hp: 40,
      maxHp: 40,
      spd: 0,
      isBoss: false,
      isMiniBoss: false,
      miniBossKind: null,
      isCavalry: false,
      hitFlash: 0,
      skill: null,
      skillCd: 99,
      castFlash: 0,
      spawnT: 1,
      stunT: 0,
      slowT: 0,
      hasteT: 0,
      healFlash: 0,
    });
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    const ally = b.monsters.find((m) => m.id === 2)!;
    expect(ally.hasteT).toBeGreaterThan(0);
  });

  it('blood mini-boss heals nearby monsters', () => {
    const b = new Battle(3);
    b.monsters.push({
      id: 1,
      dist: 3,
      hp: 80,
      maxHp: 80,
      spd: 0,
      isBoss: false,
      isMiniBoss: true,
      miniBossKind: 'blood',
      isCavalry: false,
      hitFlash: 0,
      skill: null,
      skillCd: 0,
      castFlash: 0,
      spawnT: 1,
      stunT: 0,
      slowT: 0,
      hasteT: 0,
      healFlash: 0,
    });
    b.monsters.push({
      id: 2,
      dist: 3.2,
      hp: 20,
      maxHp: 100,
      spd: 0,
      isBoss: false,
      isMiniBoss: false,
      miniBossKind: null,
      isCavalry: false,
      hitFlash: 0,
      skill: null,
      skillCd: 99,
      castFlash: 0,
      spawnT: 1,
      stunT: 0,
      slowT: 0,
      hasteT: 0,
      healFlash: 0,
    });
    (b as unknown as { status: string }).status = 'playing';
    b.step(0.05);
    const ally = b.monsters.find((m) => m.id === 2)!;
    expect(ally.hp).toBeGreaterThan(20);
    expect(ally.healFlash).toBeGreaterThan(0);
  });
});
