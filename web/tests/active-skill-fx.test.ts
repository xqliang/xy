import { describe, it, expect } from 'vitest';
import { Battle, SKILL_FX_DUR } from '../src/battle';

describe('主动技能专属特效', () => {
  it('天降陨石触发 playerSkillFx', () => {
    const b = new Battle(1, 1, undefined, undefined, undefined, ['act_meteor'], [], false);
    b.introDone = true;
    b.status = 'playing';
    b.wave = 1;
    b.waveActive = true;
    b.activeSlots[0]!.cd = 0;
    b.activeSlots[0]!.ready = true;
    b.monsters = [{
      id: 1, dist: 5, hp: 20, maxHp: 20, spd: 0, isBoss: false, isMiniBoss: false,
      miniBossKind: null, isCavalry: false, hitFlash: 0, skill: null, skillCd: 99,
      castFlash: 0, spawnT: 1, stunT: 0, slowT: 0, hasteT: 0, healFlash: 0, burnT: 0, burnDps: 0,
    }];
    expect(b.triggerActive(0)).toBe(true);
    expect(b.playerSkillFx?.kind).toBe('meteor');
    for (let t = 0; t < SKILL_FX_DUR + 0.05; t += 1 / 60) b.step(1 / 60);
    expect(b.playerSkillFx).toBeNull();
  });

  it('仙丹触发 atkBuff 特效', () => {
    const b = new Battle(1, 1, undefined, undefined, undefined, ['act_atk'], [], false);
    b.introDone = true;
    b.status = 'playing';
    b.activeSlots[0]!.cd = 0;
    b.activeSlots[0]!.ready = true;
    expect(b.triggerActive(0)).toBe(true);
    expect(b.playerSkillFx?.kind).toBe('atkBuff');
  });

  it('冰封定身触发 freeze 特效', () => {
    const b = new Battle(1, 1, undefined, undefined, undefined, ['act_freeze'], [], false);
    b.introDone = true;
    b.status = 'playing';
    b.activeSlots[0]!.cd = 0;
    b.activeSlots[0]!.ready = true;
    b.monsters = [{
      id: 1, dist: 3, hp: 20, maxHp: 20, spd: 0, isBoss: false, isMiniBoss: false,
      miniBossKind: null, isCavalry: false, hitFlash: 0, skill: null, skillCd: 99,
      castFlash: 0, spawnT: 1, stunT: 0, slowT: 0, hasteT: 0, healFlash: 0, burnT: 0, burnDps: 0,
    }];
    expect(b.triggerActive(0)).toBe(true);
    expect(b.playerSkillFx?.kind).toBe('freeze');
  });
});
