import { getUnitStat, towerPOW, type UnitType } from '@core';
import { UNITS } from '@core';
import { TUNING } from '../battle';
import { ACTIVE_SKILLS, type ActiveSkillDef } from '../actives';
import { GENERALS, GENERAL_TUNING, generalStat, type GeneralDef } from '../generals';
import { WEAPONS, weaponPctBonus, weaponRangeBonusGrids, type WeaponDef } from '../weapons';

export type DpsKind = 'hero' | 'unit' | 'weapon' | 'active';

export interface DpsRow {
  kind: DpsKind;
  id: string;
  name: string;
  group: string;
  /** 综合输出指标（同 kind 内可比；跨 kind 口径不同） */
  dps: number;
  detail: string;
}

/** 武将大招对单体专注火力的平均秒伤（与 battle.heroSkillFocusDps 同口径） */
export function heroSkillFocusDps(def: GeneralDef, atk: number): number {
  const cd = def.skillCd;
  if (def.skill === 'none' || cd <= 0) return 0;
  switch (def.skill) {
    case 'burst': return (atk * 3) / cd;
    case 'ranged': return (atk * 5 * GENERAL_TUNING.CRIT_MULT) / cd;
    case 'stun': {
      const isCharge = def.id === 'niumowang' || def.id === 'qingniu';
      const dmgMul = isCharge ? TUNING.heroChargeStunDmgMul : TUNING.heroStunDmgMul;
      return (atk * dmgMul) / cd;
    }
    case 'knock': return (atk * TUNING.heroKnockDmgMul) / cd;
    case 'slow': {
      const dmgMul = def.maxTier === 5 ? TUNING.heroSlowDmgMulMain : TUNING.heroSlowDmgMulTransit;
      return (atk * dmgMul) / cd;
    }
    case 'burn': return (atk * TUNING.heroBurnHitMul + atk * TUNING.heroBurnDpsMul * TUNING.heroBurnDur) / cd;
    case 'heal': return 0;
    case 'buff': return 0;
    case 'cdr': return 0;
    default: {
      const _exhaustive: never = def.skill;
      return _exhaustive;
    }
  }
}

function heroBasicDps(def: GeneralDef, tier: number): number {
  const s = generalStat(def, tier);
  return s.atk * s.frq * s.targets;
}

export function computeHeroDps(tier = 5): DpsRow[] {
  return GENERALS.map((g) => {
    const t = Math.min(tier, g.maxTier);
    const basic = heroBasicDps(g, t);
    const atk = generalStat(g, t).atk;
    const skill = heroSkillFocusDps(g, atk);
    const dps = basic + skill;
    return {
      kind: 'hero' as const,
      id: g.id,
      name: g.name,
      group: `${g.role}/${g.rank}`,
      dps,
      detail: `普攻 ${basic.toFixed(1)} + 大招 ${skill.toFixed(1)} · T${t}`,
    };
  }).sort((a, b) => b.dps - a.dps);
}

export function computeUnitDps(tier = 5): DpsRow[] {
  return (Object.keys(UNITS) as UnitType[]).map((type) => {
    const cfg = UNITS[type];
    const pow = towerPOW(type, tier);
    const s = getUnitStat(type, tier);
    return {
      kind: 'unit' as const,
      id: type,
      name: cfg.name,
      group: cfg.role,
      dps: pow,
      detail: `POW=ATK×FRQ×RGE×目标 · ${s.atk.toFixed(2)}×${s.frq.toFixed(2)}×${s.rge}×${s.targets} · T${tier}`,
    };
  }).sort((a, b) => b.dps - a.dps);
}

/**
 * 神兵：只计「相对专属武将普攻的增益量」，避免与武将本体叠成「加成后总伤」误登顶。
 * atk/frq：base × pct；rge：base × (Δ格 / 基础射程)。
 */
export function computeWeaponDps(): DpsRow[] {
  return WEAPONS.map((w: WeaponDef) => {
    const g = GENERALS.find((x) => x.id === w.general);
    const heroName = g?.name ?? w.general;
    const tier = 5;
    const base = g ? heroBasicDps(g, Math.min(tier, g.maxTier)) : 1;
    let gainMul = 0;
    let detail = '';
    if (w.stat === 'atk' || w.stat === 'frq') {
      const pct = weaponPctBonus(tier);
      gainMul = pct;
      detail = `${w.stat === 'atk' ? '攻击' : '攻速'} +${Math.round(pct * 100)}% → 增益 ${ (base * pct).toFixed(1) } · 专属 ${heroName}`;
    } else {
      const grids = weaponRangeBonusGrids(tier);
      const baseRge = g?.rge ?? 2;
      gainMul = grids / Math.max(0.5, baseRge);
      detail = `范围 +${grids.toFixed(2)}格 (÷${baseRge}) → 增益 ${ (base * gainMul).toFixed(1) } · 专属 ${heroName}`;
    }
    const dps = base * gainMul;
    return {
      kind: 'weapon' as const,
      id: w.id,
      name: w.name,
      group: w.stat,
      dps,
      detail,
    };
  }).sort((a, b) => b.dps - a.dps);
}

function activeApproxDps(a: ActiveSkillDef): { dps: number; detail: string } {
  if (a.cd <= 0) return { dps: 0, detail: '无 CD' };
  // 用第 10 波怪血作伤害标尺，便于横向对比主动技能
  const waveHp = TUNING.monsterHpBase + TUNING.monsterHpStep * 10;
  switch (a.effect) {
    case 'meteor': {
      const dmg = waveHp * TUNING.meteorDmgMul;
      return { dps: dmg / a.cd, detail: `波血×${TUNING.meteorDmgMul} / ${a.cd}s` };
    }
    case 'jinggu': {
      const dmg = waveHp * TUNING.jingguDmgMul;
      return { dps: dmg / a.cd, detail: `波血×${TUNING.jingguDmgMul} / ${a.cd}s` };
    }
    case 'bomb': {
      const dmg = waveHp * TUNING.bombDmgMul;
      return { dps: dmg / a.cd, detail: `波血×${TUNING.bombDmgMul} 埋雷 / ${a.cd}s` };
    }
    case 'palm':
      return { dps: (TUNING.palmPushCells * 2) / a.cd, detail: `击退 ${TUNING.palmPushCells} 格（控场折算）` };
    case 'freeze':
      return { dps: (TUNING.freezeStunDur * 3) / a.cd, detail: `定身 ${TUNING.freezeStunDur}s（控场折算）` };
    case 'atkBuff':
      return { dps: ((TUNING.atkBuffMul - 1) * 40) / a.cd, detail: `单体攻击 ×${TUNING.atkBuffMul}` };
    case 'frqBuff':
      return { dps: ((TUNING.frqBuffMul - 1) * 40) / a.cd, detail: `单体攻速 ×${TUNING.frqBuffMul}` };
    default: {
      const _exhaustive: never = a.effect;
      return _exhaustive;
    }
  }
}

export function computeActiveDps(): DpsRow[] {
  return ACTIVE_SKILLS.filter((a) => !a.disabled).map((a) => {
    const { dps, detail } = activeApproxDps(a);
    return {
      kind: 'active' as const,
      id: a.id,
      name: a.name,
      group: a.effect,
      dps,
      detail: `${detail} · CD ${a.cd}s`,
    };
  }).sort((a, b) => b.dps - a.dps);
}

export function computeAllDps(heroTier = 5, unitTier = 5): DpsRow[] {
  return [
    ...computeHeroDps(heroTier),
    ...computeUnitDps(unitTier),
    ...computeWeaponDps(),
    ...computeActiveDps(),
  ];
}

/** 「全部」视图：各类 internally 归一到 0–100，避免不同口径柱高误导 */
export function normalizeDpsByKind(rows: DpsRow[]): DpsRow[] {
  const maxByKind: Partial<Record<DpsKind, number>> = {};
  for (const r of rows) {
    maxByKind[r.kind] = Math.max(maxByKind[r.kind] ?? 0, r.dps);
  }
  return rows.map((r) => {
    const m = maxByKind[r.kind] ?? 1;
    const norm = m > 0 ? (r.dps / m) * 100 : 0;
    return {
      ...r,
      dps: norm,
      detail: `${r.detail} · 类内相对 ${norm.toFixed(0)}/100（绝对值 ${r.dps.toFixed(1)}）`,
    };
  }).sort((a, b) => b.dps - a.dps);
}
