import { describe, it, expect } from 'vitest';
import { Battle, TUNING, type Monster } from '../src/battle';

type MeteorBattle = Battle & {
  meteorPending: boolean;
  aiMeteorPending: boolean;
  entranceDist: number;
  aiEntranceDist: number;
  passiveMeteorReady(monsters: { dist: number }[], entranceDist: number): boolean;
};

function mkMonster(id: number, dist: number, hp = 999): Monster {
  return {
    id,
    dist,
    hp,
    maxHp: hp,
    spd: 0,
    isBoss: false,
    isMiniBoss: false,
    miniBossKind: null,
    isCavalry: false,
    hitFlash: 0,
    skill: null,
    skillCd: 0,
    castFlash: 0,
    spawnT: 0,
    stunT: 0,
    slowT: 0,
    hasteT: 0,
    healFlash: 0,
    burnT: 0,
    burnDps: 0,
  };
}

describe('被动陨石择时', () => {
  it('最前活怪走过长度 < meteorRadius 时不砸', () => {
    const b = new Battle(1, 1, undefined, undefined, undefined, [], ['yunshi'], false) as MeteorBattle;
    expect(b.mods.meteor).toBe(true);
    b.introDone = true;
    b.status = 'playing';
    b.waveActive = true;
    b.meteorPending = true;
    const near = b.entranceDist + TUNING.meteorRadius - 0.01;
    b.monsters = [mkMonster(1, near), mkMonster(2, near - 0.5), mkMonster(3, near - 1)];
    const hpBefore = b.monsters.map((m) => m.hp);
    b.step(1 / 60);
    expect(b.meteorPending).toBe(true);
    expect(b.monsters.map((m) => m.hp)).toEqual(hpBefore);
  });

  it('最前活怪走过长度 ≥ meteorRadius 时才砸（便于打中一波）', () => {
    const b = new Battle(1, 1, undefined, undefined, undefined, [], ['yunshi'], false) as MeteorBattle;
    b.introDone = true;
    b.status = 'playing';
    b.waveActive = true;
    b.meteorPending = true;
    const ready = b.entranceDist + TUNING.meteorRadius;
    b.monsters = [
      mkMonster(1, ready),
      mkMonster(2, ready - 0.4),
      mkMonster(3, ready - 0.8),
    ];
    const hpBefore = b.monsters.map((m) => m.hp);
    b.step(1 / 60);
    expect(b.meteorPending).toBe(false);
    expect(b.monsters.some((m, i) => m.hp < hpBefore[i]!)).toBe(true);
  });

  it('AI 被动陨石同样等走过 ≥ meteorRadius', () => {
    const b = new Battle(1, 1, undefined, undefined, undefined, [], [], false) as MeteorBattle;
    b.introDone = true;
    b.status = 'playing';
    b.waveActive = true;
    b.spawnRemaining = 1; // 避免玩家侧空场立刻清波，把 pending 又 reset
    b.aiUnits = [];
    b.aiSummonTimer = 999;
    b.aiMods.meteor = true;
    b.aiMeteorPending = true;
    const near = b.aiEntranceDist + TUNING.meteorRadius - 0.01;
    b.aiMonsters = [mkMonster(1, near), mkMonster(2, near), mkMonster(3, near)];
    b.step(1 / 60);
    expect(b.aiMeteorPending).toBe(true);
    b.aiMonsters[0]!.dist = b.aiEntranceDist + TUNING.meteorRadius;
    b.step(1 / 60);
    expect(b.aiMeteorPending).toBe(false);
  });

  it('passiveMeteorReady：以最远活怪走过长度为准', () => {
    const b = new Battle(1) as MeteorBattle;
    const e = 3;
    expect(b.passiveMeteorReady([], e)).toBe(false);
    expect(b.passiveMeteorReady([{ dist: e + TUNING.meteorRadius - 0.001 }], e)).toBe(false);
    expect(b.passiveMeteorReady([{ dist: e + 0.5 }, { dist: e + TUNING.meteorRadius }], e)).toBe(true);
  });
});
