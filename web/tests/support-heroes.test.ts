import { describe, it, expect } from 'vitest';
import { Battle, TUNING, makePlacedUnit } from '../src/battle';
import { GENERALS, generalById, generalPOW } from '../src/generals';
import { WEAPONS } from '../src/weapons';
import { ECONOMY, getUnitStat } from '@core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cellKey = (c: number, r: number) => `${c},${r}`;

function findPairs(b: Battle, n: number): [{ c: number; r: number }, { c: number; r: number }][] {
  const cells = b.unlockedCells();
  const pairs: [{ c: number; r: number }, { c: number; r: number }][] = [];
  const used = new Set<string>();
  for (const c of cells) {
    const r = { c: c.c + 1, r: c.r };
    const k0 = `${c.c},${c.r}`;
    const k1 = `${r.c},${r.r}`;
    if (cells.some((x) => x.c === r.c && x.r === r.r) && !used.has(k0) && !used.has(k1)) {
      pairs.push([c, r]);
      used.add(k0);
      used.add(k1);
      if (pairs.length >= n) break;
    }
  }
  return pairs;
}

function placeHero(b: Battle, id: string, L: { c: number; r: number }, R: { c: number; r: number }) {
  const def = generalById(id)!;
  b.tray = [{ kind: 'word', char: def.chars[0]!, general: def.id, tier: 1 }];
  expect(b.placeFromTray(0, L)).toBe(true);
  b.tray = [{ kind: 'word', char: def.chars[1]!, general: def.id, tier: 1 }];
  expect(b.placeFromTray(0, R)).toBe(true);
}

function castSkill(b: Battle, g: ReturnType<Battle['activeGenerals']>[number]) {
  (b as unknown as { castGeneralSkill: (g: typeof g, t: []) => void }).castGeneralSkill(g, []);
}

function updateGenerals(b: Battle, dt: number) {
  (b as unknown as { updateGenerals: (dt: number) => void }).updateGenerals(dt);
}

function updateMonsters(b: Battle, dt: number) {
  (b as unknown as { updateMonsters: (dt: number) => void }).updateMonsters(dt);
}

function makeLeakMonster(b: Battle, id: number) {
  return {
    id,
    dist: b.pathLen,
    hp: 10,
    maxHp: 10,
    spd: 1,
    isBoss: false,
    isMiniBoss: false,
    miniBossKind: null as null,
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
    burnT: 0,
    burnDps: 0,
  };
}

describe('验收：门派与神兵', () => {
  it('24 武将、12 门派、每门派一满5一满3，神兵一一对应', () => {
    expect(GENERALS).toHaveLength(24);
    const families = new Set(GENERALS.map((g) => g.family));
    expect(families.size).toBe(12);
    for (const f of families) {
      const gs = GENERALS.filter((g) => g.family === f);
      expect(gs.map((g) => g.maxTier).sort()).toEqual([3, 5]);
    }
    expect(WEAPONS).toHaveLength(GENERALS.length);
    for (const g of GENERALS) {
      expect(WEAPONS.some((w) => w.general === g.id)).toBe(true);
    }
  });

  it('主力@5 战力 > 过渡@3 战力（核心排序：满5主力 > 满3过渡）', () => {
    // 过渡 base atk 可高于主力（过渡是早期 carry，同档 tier3 短暂强于主力），
    // 但主力靠 tier4-5 更高上限反超，保证 主力@5 > 过渡@3。
    // 目标：输出型@3≈100 / 控制型@3≈75 / 辅助型@3≈60，主力@5 远高于此。
    for (const f of new Set(GENERALS.map((g) => g.family))) {
      const gs = GENERALS.filter((g) => g.family === f);
      const main = gs.find((g) => g.maxTier === 5)!;
      const transit = gs.find((g) => g.maxTier === 3)!;
      expect(generalPOW(main, main.maxTier)).toBeGreaterThan(generalPOW(transit, transit.maxTier));
    }
  });

  it('君/殊辅助配置：skill 与字序正确', () => {
    expect(generalById('laojun')).toMatchObject({
      chars: ['老', '君'], skill: 'buff', role: '辅助', maxTier: 5, skillCd: 13, rge: 2.5,
    });
    expect(generalById('danjun')).toMatchObject({
      chars: ['丹', '君'], skill: 'buff', role: '过渡', maxTier: 3, skillCd: 15,
    });
    expect(generalById('wenshu')).toMatchObject({
      chars: ['文', '殊'], skill: 'cdr', role: '辅助', maxTier: 5, skillCd: 13, rge: 2.5,
    });
    expect(generalById('huishu')).toMatchObject({
      chars: ['慧', '殊'], skill: 'cdr', role: '过渡', maxTier: 3, skillCd: 15,
    });
  });
});

describe('验收：老君 buff', () => {
  it('大招后友军攻击按倍率提升；持续结束后恢复', () => {
    const b = new Battle(1);
    const pairs = findPairs(b, 2);
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    placeHero(b, 'laojun', pairs[0]![0], pairs[0]![1]);
    placeHero(b, 'dasheng', pairs[1]![0], pairs[1]![1]);
    const laojun = b.activeGenerals().find((g) => g.def.id === 'laojun')!;
    const dasheng = b.activeGenerals().find((g) => g.def.id === 'dasheng')!;
    const atkBefore = b.generalAtk(dasheng);

    castSkill(b, laojun);
    // 与 updateGenerals 施放后重置一致，避免本帧 CD=0 立刻再放掩盖「到期恢复」
    laojun.state.skillCd = laojun.def.skillCd;
    expect(dasheng.state.buffAtkT).toBeCloseTo(TUNING.heroBuffDurMain, 5);
    expect(dasheng.state.buffAtkMul).toBe(TUNING.heroBuffAtkMulMain);
    expect(b.generalAtk(dasheng)).toBeCloseTo(atkBefore * TUNING.heroBuffAtkMulMain, 5);

    // 推进略超增益时长（小于 skillCd，不会二次施放）
    updateGenerals(b, TUNING.heroBuffDurMain + 0.05);
    expect(dasheng.state.buffAtkT ?? 0).toBeLessThanOrEqual(0);
    expect(b.generalAtk(dasheng)).toBeCloseTo(atkBefore, 5);
  });

  it('大招同时加持场上普通兵器攻击', () => {
    const b = new Battle(1);
    const [L, R] = findPairs(b, 1)[0]!;
    placeHero(b, 'laojun', L, R);
    const empty = b.unlockedCells().find((c) => !b.words.has(cellKey(c.c, c.r)) && !b.units.has(cellKey(c.c, c.r)))!;
    b.units.set(cellKey(empty.c, empty.r), makePlacedUnit('archer', 1, empty));
    const unit = b.units.get(cellKey(empty.c, empty.r))!;
    const laojun = b.activeGenerals().find((g) => g.def.id === 'laojun')!;
    castSkill(b, laojun);
    expect(unit.buffAtkT).toBeCloseTo(TUNING.heroBuffDurMain, 5);
    expect(unit.buffAtkMul).toBe(TUNING.heroBuffAtkMulMain);
    const base = getUnitStat(unit.type, unit.tier).atk;
    expect(b.unitAtk(unit)).toBeCloseTo(base * TUNING.heroBuffAtkMulMain, 5);
  });

  it('无怪时 CD 就绪仍可施放 buff', () => {
    const b = new Battle(1);
    b.status = 'playing';
    b.monsters = [];
    const [L, R] = findPairs(b, 1)[0]!;
    placeHero(b, 'laojun', L, R);
    const g = b.activeGenerals()[0]!;
    g.state.skillCd = 0;
    updateGenerals(b, 0.016);
    expect(g.state.buffAtkT).toBeGreaterThan(0);
    expect(g.state.skillCd).toBeCloseTo(g.def.skillCd, 5);
  });
});

describe('验收：文殊 cdr', () => {
  it('缩短其他武将 skillCd，不缩短自己', () => {
    const b = new Battle(1);
    const pairs = findPairs(b, 2);
    placeHero(b, 'wenshu', pairs[0]![0], pairs[0]![1]);
    placeHero(b, 'bajie', pairs[1]![0], pairs[1]![1]);
    const wenshu = b.activeGenerals().find((g) => g.def.id === 'wenshu')!;
    const bajie = b.activeGenerals().find((g) => g.def.id === 'bajie')!;
    bajie.state.skillCd = 10;
    wenshu.state.skillCd = 0;
    castSkill(b, wenshu);
    expect(bajie.state.skillCd).toBeCloseTo(10 - TUNING.heroCdrSecMain, 5);
    expect(wenshu.state.skillCd).toBe(0);
  });

  it('同时缩短场上兵器当前攻击间隔', () => {
    const b = new Battle(1);
    const [L, R] = findPairs(b, 1)[0]!;
    placeHero(b, 'wenshu', L, R);
    const empty = b.unlockedCells().find((c) => !b.words.has(cellKey(c.c, c.r)) && !b.units.has(cellKey(c.c, c.r)))!;
    const unit = makePlacedUnit('archer', 1, empty);
    unit.cooldown = 2.5;
    b.units.set(cellKey(empty.c, empty.r), unit);
    const wenshu = b.activeGenerals().find((g) => g.def.id === 'wenshu')!;
    castSkill(b, wenshu);
    expect(unit.cooldown).toBeCloseTo(Math.max(0, 2.5 - TUNING.heroCdrSecMain), 5);
  });

  it('无怪时 CD 就绪仍可施放 cdr', () => {
    const b = new Battle(1);
    b.status = 'playing';
    b.monsters = [];
    const pairs = findPairs(b, 2);
    placeHero(b, 'wenshu', pairs[0]![0], pairs[0]![1]);
    placeHero(b, 'bajie', pairs[1]![0], pairs[1]![1]);
    const wenshu = b.activeGenerals().find((g) => g.def.id === 'wenshu')!;
    const bajie = b.activeGenerals().find((g) => g.def.id === 'bajie')!;
    bajie.state.skillCd = 9;
    wenshu.state.skillCd = 0;
    // dt=0：避免本帧先对八戒 skillCd 倒数再减 CD，干扰断言
    updateGenerals(b, 0);
    expect(bajie.state.skillCd).toBeCloseTo(9 - TUNING.heroCdrSecMain, 5);
    expect(wenshu.state.skillCd).toBeCloseTo(wenshu.def.skillCd, 5);
  });
});

describe('验收：唐僧受伤免疫', () => {
  it('同帧两只怪越线只扣 1 血，第二只不给舍身桃', () => {
    const b = new Battle(1);
    b.status = 'playing';
    b.waveActive = true;
    const hp0 = b.tangsengHP;
    const peach0 = b.peach;
    b.monsters = [makeLeakMonster(b, 1), makeLeakMonster(b, 2)];
    updateMonsters(b, 0.016);
    expect(b.tangsengHP).toBe(hp0 - 1);
    expect(b.peach).toBe(peach0 + ECONOMY.PEACH_PER_BLEED);
    expect(b.tangsengHurtImmuneT).toBeCloseTo(TUNING.tangsengHurtImmuneDur, 5);
    expect(b.monsters.length).toBe(0);
  });

  it('免疫结束后可再次扣血', () => {
    const b = new Battle(1);
    b.status = 'playing';
    const hp0 = b.tangsengHP;
    b.tangsengHurtImmuneT = 0.01;
    updateMonsters(b, 0.02);
    expect(b.tangsengHurtImmuneT).toBe(0);
    b.monsters = [makeLeakMonster(b, 9)];
    updateMonsters(b, 0.016);
    expect(b.tangsengHP).toBe(hp0 - 1);
  });
});

describe('验收：文档与 TUNING 一致', () => {
  it('权威文档含关键常量名与数值', () => {
    const doc = readFileSync(
      resolve(__dirname, '../../docs/hero-combat-reference.md'),
      'utf8',
    );
    expect(doc).toContain('heroBuffAtkMulMain = 1.35');
    expect(doc).toContain('heroBuffDurMain = 5');
    expect(doc).toContain('heroCdrSecMain = 4');
    expect(doc).toContain('tangsengHurtImmuneDur = 1');
    expect(TUNING.heroBuffAtkMulMain).toBe(1.35);
    expect(TUNING.heroBuffDurMain).toBe(5);
    expect(TUNING.heroBuffAtkMulTransit).toBe(1.2);
    expect(TUNING.heroBuffDurTransit).toBe(3.5);
    expect(TUNING.heroCdrSecMain).toBe(4);
    expect(TUNING.heroCdrSecTransit).toBe(2.5);
    expect(TUNING.tangsengHurtImmuneDur).toBe(1);
  });
});
