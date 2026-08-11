import { describe, it, expect } from 'vitest';
import { lenOf } from '../src/board';
import { Battle, TUNING, PALM_PUSH_DUR } from '../src/battle';

describe('如来神掌沿路回推', () => {
  it('击退格数为 6', () => {
    expect(TUNING.palmPushCells).toBe(6);
  });

  it('释放后沿路径逐帧回推，结束后各怪 dist 减 6', () => {
    const b = new Battle(1, 1, undefined, undefined, undefined, ['act_palm'], [], false);
    b.introDone = true;
    b.status = 'playing';
    b.wave = 1;
    b.waveActive = true;
    b.activeSlots[0]!.cd = 0;
    b.activeSlots[0]!.ready = true;

    const mk = (dist: number) => ({
      id: b['nextMonsterId']++,
      dist,
      hp: 10,
      maxHp: 10,
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
      burnT: 0,
      burnDps: 0,
    });
    b.monsters = [mk(12), mk(8)];

    b.triggerActive(0);
    expect(b.palmPushFx).not.toBeNull();
    expect(b.monsters[0]!.dist).toBe(12);

    const dur = PALM_PUSH_DUR + 0.05;
    for (let t = 0; t < dur; t += 1 / 60) b.step(1 / 60);

    expect(b.palmPushFx).toBeNull();
    expect(b.monsters[0]!.dist).toBeCloseTo(6, 5);
    expect(b.monsters[1]!.dist).toBeCloseTo(2, 5);
  });

  it('AI 释放后沿 aiPath 逐帧回推，结束后各怪 dist 减 6', () => {
    type GateBattle = Battle & {
      triggerAiActive(i: number): boolean;
      aiShouldTriggerActive(effect: string): boolean;
    };
    const b = new Battle(1) as GateBattle;
    b.introDone = true;
    b.status = 'playing';
    b.wave = 1;
    b.waveActive = true;
    b.aiActiveSlots = [{ id: 'act_palm', cd: 0, cdMax: 10, ready: true, flash: 0 }];

    const mk = (dist: number) => ({
      id: b['nextMonsterId']++,
      dist,
      hp: 10,
      maxHp: 10,
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
      burnT: 0,
      burnDps: 0,
    });
    const pathLen = lenOf(b.aiPath);
    const d0 = pathLen - 1;
    const d1 = pathLen - 5;
    b.aiMonsters = [mk(d0), mk(d1)];
    // 玩家侧留怪，避免 spawnRemaining=0 且 monsters=[] 触发清波并打断 AI 掌推特效
    b.monsters = [mk(3)];

    expect(b.triggerAiActive(0)).toBe(true);
    expect(b.aiPalmPushFx).not.toBeNull();
    expect(b.aiMonsters[0]!.dist).toBe(d0);

    const dur = PALM_PUSH_DUR + 0.05;
    for (let t = 0; t < dur; t += 1 / 60) b.step(1 / 60);

    expect(b.aiPalmPushFx).toBeNull();
    expect(b.aiMonsters[0]!.dist).toBeCloseTo(d0 - 6, 5);
    expect(b.aiMonsters[1]!.dist).toBeCloseTo(d1 - 6, 5);
  });
});
