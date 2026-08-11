import { describe, it, expect } from 'vitest';
import { Battle, TUNING, SKILL_FX_DUR, makePlacedUnit } from '../src/battle';

function placeErlang(b: Battle, tier = 3) {
  const cells = b.unlockedCells();
  const a = cells[0]!;
  const right = { c: a.c + 1, r: a.r };
  b.unlocked.add(`${right.c},${right.r}`);
  b.words.set(`${a.c},${a.r}`, { char: '二', general: 'erlang', tier, cell: { c: a.c, r: a.r } });
  b.words.set(`${right.c},${right.r}`, { char: '郎', general: 'erlang', tier, cell: { c: right.c, r: right.r } });
  return a;
}

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

  it('仙丹拖到兵器：单体攻击 +40% 本局，每单位仅一次', () => {
    const b = new Battle(1, 1, undefined, undefined, undefined, ['act_atk'], [], false);
    b.introDone = true;
    b.status = 'playing';
    b.activeSlots[0]!.cd = 0;
    b.activeSlots[0]!.ready = true;
    const cell = { c: 2, r: 7 };
    b.units.set(`${cell.c},${cell.r}`, makePlacedUnit('spear', 1, cell));
    expect(b.triggerActive(0)).toBe(false);
    expect(b.applyPillActive(0, cell)).toBe(true);
    expect(b.playerSkillFx?.kind).toBe('atkBuff');
    expect(b.units.get(`${cell.c},${cell.r}`)?.pillAtk).toBe(true);
    expect(TUNING.atkBuffMul).toBe(1.4);
    expect(b.applyPillActive(0, cell)).toBe(false);
    expect(b.pillBuffRoster('atkBuff')).toEqual(['枪天兵 Lv.1']);
  });

  it('仙丹拖到武将：跨调用持久生效（回归：activeGenerals() 每次返回新对象，须落到 GeneralState 才不丢）', () => {
    const b = new Battle(1, 1, undefined, undefined, undefined, ['act_atk'], [], false);
    b.introDone = true;
    b.status = 'playing';
    b.activeSlots[0]!.cd = 0;
    b.activeSlots[0]!.ready = true;
    const cell = placeErlang(b);
    expect(b.applyPillActive(0, cell)).toBe(true);
    // 关键断言：重新调用 activeGenerals() 取到的是全新对象，buff 仍须读到
    const g = b.activeGenerals().find((ag) => ag.cells.some((c) => c.c === cell.c && c.r === cell.r));
    expect(g?.pillAtk).toBe(true);
    expect(b.generalAtk(g!)).toBeCloseTo(b.generalAtk({ ...g!, pillAtk: false } as typeof g) * TUNING.atkBuffMul, 5);
    expect(b.pillBuffRoster('atkBuff')).toEqual(['二郎']);
    expect(b.canApplyPill(cell, 'atkBuff')).toBe(false);
  });

  it('风火轮拖到武将：跨调用持久生效', () => {
    const b = new Battle(1, 1, undefined, undefined, undefined, ['act_frq'], [], false);
    b.introDone = true;
    b.status = 'playing';
    b.activeSlots[0]!.cd = 0;
    b.activeSlots[0]!.ready = true;
    const cell = placeErlang(b);
    expect(b.applyPillActive(0, cell)).toBe(true);
    const g = b.activeGenerals().find((ag) => ag.cells.some((c) => c.c === cell.c && c.r === cell.r));
    expect(g?.pillFrq).toBe(true);
    expect(b.generalFrq(g!)).toBeCloseTo(b.generalFrq({ ...g!, pillFrq: false } as typeof g) * TUNING.frqBuffMul, 5);
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
