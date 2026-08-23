import { ECONOMY } from '@core';
import { UNITS } from '@core';
import { TUNING, PEACH_TREE, PLACE_TIMING } from '../battle';
import { BOARD_POWER } from '../board-power';
import { AI_TIMING } from '../autoplace';
import { GENERALS, GENERAL_TUNING, type GeneralDef } from '../generals';
import { ACTIVE_SKILLS } from '../actives';
import { PASSIVE_SKILLS } from '../passives';
import { WEAPON_TUNING } from '../weapons';
import { assignDeep, collectDiffs, deepClone, type DiffEntry } from './clone';

export type TunableBagId =
  | 'tuning'
  | 'economy'
  | 'boardPower'
  | 'placeTiming'
  | 'peachTree'
  | 'aiTiming'
  | 'generalTuning'
  | 'weaponTuning'
  | 'generals'
  | 'actives'
  | 'passives'
  | 'units';

export interface TunableBag {
  id: TunableBagId;
  label: string;
  /** 可变运行时对象（保持引用） */
  live: object;
  /** 模块加载时的默认快照 */
  defaults: object;
}

function bag(id: TunableBagId, label: string, live: object): TunableBag {
  return { id, label, live, defaults: deepClone(live) };
}

/** 所有可调参数袋（按注册顺序展示） */
export const TUNABLE_BAGS: TunableBag[] = [
  bag('tuning', '战场 TUNING', TUNING),
  bag('economy', '经济 ECONOMY', ECONOMY),
  bag('boardPower', '承压 BOARD_POWER', BOARD_POWER),
  bag('placeTiming', '布阵间隔 PLACE_TIMING', PLACE_TIMING),
  bag('peachTree', '蟠桃园 PEACH_TREE', PEACH_TREE),
  bag('aiTiming', 'AI 调位 AI_TIMING', AI_TIMING),
  bag('generalTuning', '英雄战斗 GENERAL_TUNING', GENERAL_TUNING),
  bag('weaponTuning', '神兵 WEAPON_TUNING', WEAPON_TUNING),
  bag('generals', '英雄 GENERALS', GENERALS),
  bag('actives', '主动技能 ACTIVE_SKILLS', ACTIVE_SKILLS),
  bag('passives', '被动技能 PASSIVE_SKILLS', PASSIVE_SKILLS),
  bag('units', '兵器 UNITS', UNITS),
];

export function bagById(id: TunableBagId): TunableBag | undefined {
  return TUNABLE_BAGS.find((b) => b.id === id);
}

export function resetBag(id: TunableBagId): void {
  const b = bagById(id);
  if (!b) return;
  assignDeep(b.live, b.defaults);
}

export function resetAllBags(): void {
  for (const b of TUNABLE_BAGS) assignDeep(b.live, b.defaults);
}

export function allDiffs(): Array<DiffEntry & { bag: string; bagId: TunableBagId }> {
  const out: Array<DiffEntry & { bag: string; bagId: TunableBagId }> = [];
  for (const b of TUNABLE_BAGS) {
    for (const d of collectDiffs(b.live, b.defaults)) {
      out.push({ ...d, bag: b.label, bagId: b.id });
    }
  }
  return out;
}

/** 导出当前全部可调配置（深拷贝） */
export function exportLiveConfig(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const b of TUNABLE_BAGS) out[b.id] = deepClone(b.live);
  return out;
}

/** 导出默认配置快照 */
export function exportDefaultsConfig(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const b of TUNABLE_BAGS) out[b.id] = deepClone(b.defaults);
  return out;
}

/** 仅导出有变动的路径：{ bagId: { path: { from, to } } } */
export function exportChangedConfig(): Record<string, Record<string, { from: unknown; to: unknown }>> {
  const out: Record<string, Record<string, { from: unknown; to: unknown }>> = {};
  for (const d of allDiffs()) {
    const bag = out[d.bagId] ?? (out[d.bagId] = {});
    bag[d.path] = { from: d.from, to: d.to };
  }
  return out;
}

// —— TUNING 按功能互斥分组（每键只出现在一处，便于 Tab 筛选）——

/** 出怪：血量 / 波次数量 / 移速危险 */
export const TUNING_MONSTER_WAVE_KEYS = new Set([
  'monsterSpd', 'dangerRemaining',
  'monsterHpBase', 'monsterHpStep', 'monsterHpEarlyFixed', 'monsterHpNoDiffTo', 'monsterHpRampMulByCycle',
  'lateWaveFrom', 'lateWaveExtraPerWave', 'earlyWaveTo', 'earlyWaveReduce',
  'wave1Bonus', 'minWaveMonsters', 'spawnInterval', 'spawnIntervalMin',
  'endlessWavesPerCycle', 'endlessCycleStep',
]);

/** 出怪：妖王 / 骑兵 / 精英 / 小 Boss / 双雄引妖王 */
export const TUNING_MONSTER_ELITE_KEYS = new Set([
  'bossFirstSegLo', 'bossFirstSegHi', 'bossFirstSegMin', 'bossFirstSegMax',
  'bossSegMin', 'bossSegMax', 'bossHpMul', 'bossHpMulEarly', 'bossSpdMul',
  'bossHpRampWaves', 'bossEscortMin', 'bossEscortMax', 'bossEscortHpShare', 'bossEscortSpacing',
  'cavalryFromWave', 'cavalryWaveChance',
  'cavalryRatioRampLoWave', 'cavalryRatioRampHiWave', 'cavalryRatioRampStart', 'cavalryRatioRampEnd',
  'cavalryRatioLateLo', 'cavalryRatioLateHi',
  'cavalrySpdMul', 'cavalryHpMul',
  'eliteFromWave', 'eliteChance', 'eliteMinGap', 'eliteHpMul',
  'miniBossFromWave', 'miniBossChance', 'miniBossHpMul', 'miniBossSpdMul',
  'miniBossSpdMulSlow', 'miniBossSpdMulFast',
  'miniBossRadius', 'miniBossInterval', 'miniBossFirstDelay',
  'miniBossStealRadius', 'miniBossStealDelayMin', 'miniBossStealDelayMax', 'miniBossStealFlashDur',
  'heroBossFromCount', 'heroBossIntervalMin', 'heroBossIntervalMaxBase',
  'heroBossIntervalShrinkCap', 'heroBossMaxPerWave',
]);

/** 出怪：怪物技能与对兵器控制 */
export const TUNING_MONSTER_SKILL_KEYS = new Set([
  'skillRadius', 'skillTargetMin', 'skillTargetMax', 'skillInterval', 'skillFirstDelay',
  'stunDur', 'slowDur', 'slowCooldownMul', 'weakenDur', 'weakenAtkMul',
  'webbindDur', 'webbindRangeCut', 'debuffImmuneDur',
  'knockdownDur', 'hasteDur', 'hasteSpdMul', 'healPct',
]);

/** 怪物 Tab：上述三组并集 */
export const TUNING_MONSTER_KEYS = new Set([
  ...TUNING_MONSTER_WAVE_KEYS,
  ...TUNING_MONSTER_ELITE_KEYS,
  ...TUNING_MONSTER_SKILL_KEYS,
]);

/** 英雄技能 Tab：主动技能数值 + 英雄大招分档与全部大招效果数值 + 命中容差 */
export const TUNING_SKILL_KEYS = new Set([
  'palmPushCells', 'meteorDmgMul', 'meteorRadius', 'meteorPassiveDmgMul', 'jingguDmgMul',
  'bombDmgMul', 'bombExplodeRadius', 'bombContactRadius',
  'atkBuffMul', 'frqBuffMul', 'freezeStunDur',
  'heroStunDurMain', 'heroStunDurTransit', 'heroKnockPushMain', 'heroKnockPushTransit',
  'heroStunDmgMul', 'heroChargeStunDmgMul', 'heroKnockDmgMul',
  'heroSlowDmgMulMain', 'heroSlowDmgMulTransit', 'heroSlowDur', 'heroHealSlowDur',
  'heroBurnHitMul', 'heroBurnDpsMul', 'heroBurnDur',
  'heroBuffAtkMulMain', 'heroBuffAtkMulTransit', 'heroBuffDurMain', 'heroBuffDurTransit',
  'heroCdrSecMain', 'heroCdrSecTransit', 'tangsengHurtImmuneDur',
  'heroBurstDmgMul', 'heroRangedDmgMul',
  'heroPierceMaxMain', 'heroPierceMaxTransit', 'heroBeamCorridor',
  'heroDogStunDur', 'heroDogTtl', 'heroHealHp',
  'heroUltFxTtlLong', 'heroUltFxTtlBite', 'heroUltFxTtlSupport', 'heroUltFxTtlDefault',
  'rangeTolerance',
]);

/** @deprecated 用 TUNING_SKILL_KEYS；保留别名以免外部旧引用断裂 */
export const TUNING_ATTACK_KEYS = TUNING_SKILL_KEYS;

/**
 * 每个英雄大招实际用到的 TUNING 键（与 battle.castGeneralSkill / pushHeroUltFx 取值口径一致）。
 * DevTools「英雄逐条」区把这些键直接展示在对应英雄介绍下方，便于按英雄调大招数值
 * （如文殊的减 CD 秒数、老君的增益倍率）。共享键会在多个英雄下出现，改一处即全生效。
 */
export function heroUltTuningKeys(def: GeneralDef): string[] {
  const keys: string[] = [];
  switch (def.skill) {
    case 'burst': keys.push('heroBurstDmgMul'); break;
    case 'ranged':
      keys.push('heroRangedDmgMul', 'heroBeamCorridor');
      keys.push(def.id === 'erlang' ? 'heroPierceMaxMain' : 'heroPierceMaxTransit');
      if (def.id === 'erlang') keys.push('heroDogStunDur', 'heroDogTtl');
      break;
    case 'stun':
      keys.push(def.maxTier === 5 ? 'heroStunDurMain' : 'heroStunDurTransit');
      keys.push(def.id === 'niumowang' || def.id === 'qingniu' ? 'heroChargeStunDmgMul' : 'heroStunDmgMul');
      break;
    case 'knock':
      keys.push(def.maxTier === 5 ? 'heroKnockPushMain' : 'heroKnockPushTransit', 'heroKnockDmgMul');
      break;
    case 'slow':
      keys.push(def.maxTier === 5 ? 'heroSlowDmgMulMain' : 'heroSlowDmgMulTransit', 'heroSlowDur');
      break;
    case 'heal': keys.push('heroHealSlowDur', 'heroHealHp'); break;
    case 'buff':
      keys.push(def.maxTier === 5 ? 'heroBuffAtkMulMain' : 'heroBuffAtkMulTransit');
      keys.push(def.maxTier === 5 ? 'heroBuffDurMain' : 'heroBuffDurTransit');
      break;
    case 'cdr':
      keys.push(def.maxTier === 5 ? 'heroCdrSecMain' : 'heroCdrSecTransit');
      break;
    case 'burn': keys.push('heroBurnHitMul', 'heroBurnDpsMul', 'heroBurnDur'); break;
    case 'none': break;
    default: break;
  }
  // 大招动画时长（pushHeroUltFx 分档）
  if (def.id === 'dasheng' || def.id === 'honghaier') keys.push('heroUltFxTtlLong');
  else if (def.id === 'bailong') keys.push('heroUltFxTtlBite');
  else if (def.skill === 'heal' || def.skill === 'buff' || def.skill === 'cdr') keys.push('heroUltFxTtlSupport');
  else if (def.skill !== 'none') keys.push('heroUltFxTtlDefault');
  return keys;
}

/** 全部英雄大招 TUNING 键并集（英雄逐条区展示，底部公共数值区排除） */
export const TUNING_HERO_ULT_KEYS = new Set(GENERALS.flatMap((g) => heroUltTuningKeys(g)));

/** 征兵 AI Tab：征兵成本 / 字铲保底 / 候选区 */
export const TUNING_SUMMON_KEYS = new Set([
  'summonCostStart', 'summonCostStep', 'summonDraws',
  'shovelDrawChance', 'shovelPityAfter', 'wordDrawChance', 'wordPityAfter', 'pairPityAfter',
  'earlyWordCapWave', 'earlyWordCap', 'earlyWordGuaranteeWave', 'earlyWordGuarantee',
  'earlyShovelWave', 'earlyShovelMin', 'earlyShovelMax',
  'summonMaxPerKey', 'summonMaxPerKeyAllOpen', 'traySize', 'initialShovels', 'initialOpenSlots',
  'waveGapSec',
]);

/** 征兵 AI Tab：AI 部署 / 清场 / 主动择时 */
export const TUNING_AI_KEYS = new Set([
  'aiDpsBase', 'aiDpsPerWave',
  'aiClearChargeTime', 'aiClearRadius', 'aiClearDmgMul',
  'aiDeployBase', 'aiDeployPerWave', 'aiDeployInterval',
  'aiOffensiveActiveMinDist', 'aiOffensiveActiveDelayMax',
]);

/** @deprecated 旧「系统」并集；现已拆成 SUMMON + AI，且不再含技能键 */
export const TUNING_SYSTEM_KEYS = new Set([
  ...TUNING_SUMMON_KEYS,
  ...TUNING_AI_KEYS,
]);

/** 实战会读的掉桃键（击杀 / 漏怪补偿）+ 上限 cap */
export const ECONOMY_LIVE_PEACH_KEYS = new Set([
  'PEACH_PER_KILL',
  'PEACH_PER_ELITE',
  'PEACH_PER_MINI_BOSS',
  'PEACH_PER_BOSS',
  'PEACH_PER_BLEED',
  'TANGSENG_MAX_HP',
  'MAX_PEACH',
]);

/** 开局经济（征兵 Tab） */
export const ECONOMY_START_KEYS = new Set([
  'INITIAL_PEACH',
  'TANGSENG_INITIAL_HP',
]);

/**
 * 仅供 game-core 参考曲线 / 单测；实战征兵用 TUNING.summonCost*，
 * 出怪基数用 monstersInWave 硬编码，改这些不会改对局。
 */
export const ECONOMY_REFERENCE_KEYS = new Set([
  'MONSTER_BASE',
  'PEACH_COST_BASE',
  'PEACH_COST_STEP',
  'REMAINING_INTERCEPT',
]);

/** DevTools 筛选用到的全部 TUNING 键（应覆盖 TUNING 全部字段） */
export function allTuningFilterKeys(): Set<string> {
  return new Set([
    ...TUNING_MONSTER_KEYS,
    ...TUNING_SKILL_KEYS,
    ...TUNING_SUMMON_KEYS,
    ...TUNING_AI_KEYS,
  ]);
}
