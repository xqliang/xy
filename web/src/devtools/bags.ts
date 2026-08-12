import { ECONOMY } from '@core';
import { UNITS } from '@core';
import { TUNING, PEACH_TREE, PLACE_TIMING } from '../battle';
import { BOARD_POWER } from '../board-power';
import { AI_TIMING } from '../autoplace';
import { GENERALS, GENERAL_TUNING } from '../generals';
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
  bag('generalTuning', '武将战斗 GENERAL_TUNING', GENERAL_TUNING),
  bag('weaponTuning', '神兵 WEAPON_TUNING', WEAPON_TUNING),
  bag('generals', '武将 GENERALS', GENERALS),
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

/** TUNING 字段分组（怪物 / 系统），便于 Tab 筛选 */
export const TUNING_MONSTER_KEYS = new Set([
  'monsterSpd', 'monsterHpBase', 'monsterHpStep',
  'bossFirstSegLo', 'bossFirstSegHi', 'bossFirstSegMin', 'bossFirstSegMax',
  'bossSegMin', 'bossSegMax', 'bossHpMul', 'bossHpMulEarly', 'bossSpdMul',
  'bossHpRampWaves', 'bossEscortMin', 'bossEscortMax', 'bossEscortHpShare', 'bossEscortSpacing',
  'cavalryFromWave', 'cavalryWaveChance', 'cavalryRatioBase', 'cavalryRatioWaveBonusCap',
  'cavalryRatioWaveDiv', 'cavalryRatioMaxSpread', 'cavalryRatioCap', 'cavalrySpdMul', 'cavalryHpMul',
  'lateWaveFrom', 'lateWaveExtraPerWave', 'earlyWaveTo', 'earlyWaveReduce',
  'wave1Bonus', 'minWaveMonsters', 'spawnInterval', 'spawnIntervalMin',
  'eliteFromWave', 'eliteChance', 'eliteMinGap', 'eliteHpMul',
  'skillRadius', 'skillTargetMin', 'skillTargetMax', 'skillInterval', 'skillFirstDelay',
  'stunDur', 'slowDur', 'slowCooldownMul', 'weakenDur', 'weakenAtkMul',
  'webbindDur', 'webbindRangeCut', 'debuffImmuneDur',
  'miniBossFromWave', 'miniBossChance', 'miniBossHpMul', 'miniBossSpdMul',
  'miniBossRadius', 'miniBossInterval', 'miniBossFirstDelay',
  'knockdownDur', 'hasteDur', 'hasteSpdMul', 'healPct',
  'dangerRemaining', 'endlessWavesPerCycle', 'endlessCycleStep',
  'heroBossFromCount', 'heroBossIntervalMin', 'heroBossIntervalMaxBase',
  'heroBossIntervalShrinkCap', 'heroBossMaxPerWave',
]);

export const TUNING_SYSTEM_KEYS = new Set([
  'summonCostStart', 'summonCostStep', 'summonDraws',
  'shovelDrawChance', 'shovelPityAfter', 'wordDrawChance', 'wordPityAfter', 'pairPityAfter',
  'earlyWordCapWave', 'earlyWordCap', 'earlyWordGuaranteeWave', 'earlyWordGuarantee',
  'earlyShovelWave', 'earlyShovelMin', 'earlyShovelMax',
  'summonMaxPerKey', 'summonMaxPerKeyAllOpen', 'traySize', 'initialShovels', 'initialOpenSlots',
  'aiDpsBase', 'aiDpsPerWave', 'aiClearChargeTime', 'aiClearRadius', 'aiClearDmgMul',
  'palmPushCells', 'meteorDmgMul', 'meteorRadius', 'meteorPassiveDmgMul', 'jingguDmgMul',
  'atkBuffMul', 'frqBuffMul', 'freezeStunDur',
  'heroStunDurMain', 'heroStunDurTransit', 'heroKnockPushMain', 'heroKnockPushTransit',
  'heroStunDmgMul', 'heroChargeStunDmgMul', 'heroKnockDmgMul',
  'heroSlowDmgMulMain', 'heroSlowDmgMulTransit', 'heroSlowDur', 'heroHealSlowDur',
  'heroBurnHitMul', 'heroBurnDpsMul', 'heroBurnDur',
  'heroBuffAtkMulMain', 'heroBuffAtkMulTransit', 'heroBuffDurMain', 'heroBuffDurTransit',
  'heroCdrSecMain', 'heroCdrSecTransit', 'tangsengHurtImmuneDur',
  'rangeTolerance', 'aiDeployBase', 'aiDeployPerWave', 'aiDeployInterval',
  'waveGapSec',
]);

export const TUNING_ATTACK_KEYS = new Set([
  'palmPushCells', 'meteorDmgMul', 'meteorRadius', 'meteorPassiveDmgMul', 'jingguDmgMul',
  'atkBuffMul', 'frqBuffMul', 'freezeStunDur',
  'heroStunDurMain', 'heroStunDurTransit', 'heroKnockPushMain', 'heroKnockPushTransit',
  'heroStunDmgMul', 'heroChargeStunDmgMul', 'heroKnockDmgMul',
  'heroSlowDmgMulMain', 'heroSlowDmgMulTransit', 'heroSlowDur', 'heroHealSlowDur',
  'heroBurnHitMul', 'heroBurnDpsMul', 'heroBurnDur',
  'heroBuffAtkMulMain', 'heroBuffAtkMulTransit', 'heroBuffDurMain', 'heroBuffDurTransit',
  'heroCdrSecMain', 'heroCdrSecTransit', 'tangsengHurtImmuneDur',
  'rangeTolerance',
]);
