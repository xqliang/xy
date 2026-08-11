// 局内战斗状态机。所有兵种/经济数值来自 game-core（@core），保证与原作数值一致。
import {
  UNITS,
  getUnitStat,
  towerPOW,
  damage,
  canMerge,
  merge as mergeUnits,
  MAX_TIER,
  INITIAL_PEACH,
  PEACH_PER_KILL,
  PEACH_PER_BLEED,
  PEACH_PER_BOSS,
  PEACH_PER_ELITE,
  PEACH_PER_MINI_BOSS,
  TANGSENG_INITIAL_HP,
  monstersInWave,
  monsterPOW,
} from '@core';
import type { UnitType } from '@core';
import { RNG } from './rng';
import { getSettings } from './settings';
import {
  generalById,
  generalStat,
  qualityName,
  qualityColor,
  matchGeneral,
  partnerChars,
  BOND_GENERAL,
  BOND_ATK_BONUS,
  BOND_NAME,
  ultTypeOf,
  heroAttackFxTtl,
  CRIT_MULT,
  type GeneralDef,
} from './generals';
import { collectOrphanChars, countChars, pickWordChar, PAIR_PITY_AFTER } from './word-draw';
import {
  rollWeaponDrop,
  weaponById,
  BATTLE_FRAGMENT_ELIGIBLE_CHANCE,
  HERO_ATTACK_FRAGMENT_CHANCE,
  type WeaponBonuses,
} from './weapons';
import { drawSummonTray } from './summon-draw';
import { planAutoPlaceSteps, planBattleReposition, runBattleReposition, aiHeroPartnerAdjustPending, rollAiAdjustInterval, PLAYER_PLACE_MAX_STEPS, PLAYER_PLACE_MAX_GUARD, PLAYER_REPOSITION_MAX_STEPS, AI_PLACE_MAX_STEPS, AI_PLACE_MAX_GUARD, imminentPathScore, placeCellScore, engageThreatAt, type AutoPlaceView, type BattleRepositionView } from './autoplace';
import {
  estimateOptimalBoardPower,
  pathCoverageLen,
  pathCoverageLenEntranceWeighted,
  pathFirstEngageDist,
  pathCoverageLenEntranceWeightedAlong,
  pathFirstEngageDistAlong,
  planWavePressure,
  pressureRatioForWave,
  spawnBatchCap,
  SPAWN_DIST_JITTER,
  type BoardPowerResult,
  type PressurePlan,
} from './board-power';
import { activeById, MAX_EQUIPPED_ACTIVES, type ActiveEffect } from './actives';
import { MAX_EQUIPPED_PASSIVES, isPassiveEnabled } from './passives';
import {
  DEFAULT_AI_SKILL, rollAiLoadout, skillToKnobs, aiWeaponScale, scaleWeaponBonuses,
  loadPlayerWinStreak, loadPlayerLossStreak, versusRubberBand, effectiveAiSkill,
} from './ai-skill';
import {
  COLS,
  ROWS,
  pathTotalLen,
  posAtDistance,
  posAlong,
  lenOf,
  entranceDistance,
  pathEntranceCell,
  exitDistToPath,
  faceDirToward,
  mirrorPath,
  mirrorCell,
  slotUnlockOrder,
  placeableCells,
  placeableByProximity,
  isPathCell,
  isPlayerCell,
  MAPS,
  type GameMap,
  type Cell,
} from './board';

// —— 本切片的战场调参（非原作数值：原作只给出 POW 框架与怪物数，未给绝对 HP）——
// 保留 POW 关系：POW怪 = HP×SPD，POW塔 = ATK×FRQ×RGE；这里选可玩的绝对值，可再调。
export const TUNING = {
  monsterSpd: 0.68, // 格/秒（略快：更早触发危险、利好高RGE兵，符合文章"高速利远程"）
  dangerRemaining: 5, // 危险提示：怪物距唐僧沿路剩余 ≤ 该格数时触发
  monsterHpBase: 24, // 第 n 波 HP = base + step*n（波5起形成"第5波危机"，波1-4对正常操作友好）
  monsterHpStep: 16,
  // —— 妖王波预排（对战/无尽共用）：5–10 出 1–2 个；之后每 10 波出 2–3 个；无「每 5 波固定」——
  bossFirstSegLo: 5, // 首段候选波下界
  bossFirstSegHi: 10, // 首段候选波上界（亦为段长锚点）
  bossFirstSegMin: 1, // 首段妖王波最少个数
  bossFirstSegMax: 2, // 首段妖王波最多个数
  bossSegMin: 2, // 第 11 波起每段最少妖王波
  bossSegMax: 3, // 第 11 波起每段最多妖王波
  bossHpMul: 14, // 后期 BOSS 血量倍数
  bossHpMulEarly: 8, // 前期(约第5波)BOSS 血量倍数；随波次线性爬升到 bossHpMul
  bossSpdMul: 0.625, // BOSS 移速倍率：比普通妖慢（血厚推进慢，给玩家集火时间），但不至于过分迟缓
  bossHpRampWaves: 20, // 血量倍数从 early 爬到满所用波跨度（自 bossFirstSegLo 起算）
  bossEscortMin: 4, // 妖王出场护卫最少只数
  bossEscortMax: 8, // 妖王出场护卫最多只数
  bossEscortHpShare: 0.35, // 妖王总血池分给护卫的比例（余下给妖王本体）
  bossEscortSpacing: 0.38, // 护卫在妖王身后的沿路间距（格）
  // —— 骑兵波（后期随机某波：比例随波次升高；移速翻倍、血量略低）——
  cavalryFromWave: 6, // 第 6 波起（游戏后期）才可能出现骑兵波
  cavalryWaveChance: 0.5, // 达到后期后，每波成为骑兵波的概率
  cavalryRatioBase: 0.35, // 本波骑兵比例下界：base + min(waveBonusCap, 波次/100)
  cavalryRatioWaveBonusCap: 0.2,
  cavalryRatioWaveDiv: 100,
  cavalryRatioMaxSpread: 0.2, // 上界 = min(cap, 下界 + spread)，开波时在 [下界, 上界] 随机
  cavalryRatioCap: 0.7,
  cavalrySpdMul: 2, // 骑兵移速倍率：比普通妖快一倍
  cavalryHpMul: 2 / 3, // 骑兵血量倍率：比普通妖低 1/3（快怪用薄血换速度，避免 HP×移速 威胁翻倍）
  // —— 后期堆量：怪物数量在经济基准(9+n)之上，后期按超出波数额外叠加（越后越密，贴合"按战力堆量"）——
  lateWaveFrom: 6, // 第 6 波起开始额外堆量
  lateWaveExtraPerWave: 5, // 每超出一波额外 +5 只（越到后期越密，波6:+5 … 波12:+35）
  // —— 前期减量：开局前几波压低出怪数，降低上手压力（波1=7, 波2=9）——
  earlyWaveTo: 2, // 前 2 波享受减量
  earlyWaveReduce: 2, // 每提前一波多减 2 只（波2:-2, 波1:-4）；波1 另见 wave1Bonus
  earlyWaveHpTo: 5, // 波 1–earlyWaveHpTo：HP × earlyWaveHpMul
  earlyWaveHpMul: 0.8,
  earlyWaveHpMul6: 0.9, // 第 6 波软血
  earlyWaveHpMul7: 0.95, // 第 7 波软血；第 8 波起满血
  wave1Bonus: 1, // 第一波在减量后再 +1
  minWaveMonsters: 5, // 单波出怪数下限（防止减量后过少）
  spawnInterval: 1.25, // 秒/批（基础出怪节奏；同批可随机 1..N 只）
  spawnIntervalMin: 0.35, // 出怪间隔下限
  summonCostStart: 10, // 首次征兵成本
  summonCostStep: 2, // 每次征兵后 +2（抽卡成本递增）
  summonDraws: 5, // 每次征兵产出 5 个候选（放入候选区）
  shovelDrawChance: 0.16, // 候选中出现铲子的概率
  shovelPityAfter: 2, // 铲子保底：连续 N 次征兵没出铲，则下次征兵强制出 1 把铲（避免没空位放兵）
  wordDrawChance: 0.14, // 候选中出现武将字牌的概率（凑双字召唤武将）
  wordPityAfter: 10, // 字牌保底：连续 N 次征兵没出字，则下次征兵强制把 1 个兵槽换成字
  pairPityAfter: PAIR_PITY_AFTER, // 半对保底：连续 N 次征兵仍有孤儿未补，则强制出配对字
  summonMaxPerKey: 3, // 单次征兵同 key（兵种/铲）上限
  summonMaxPerKeyAllOpen: 5, // 阵位全开后：铲子无用，放宽同兵种上限到 5（更快堆同型合成）
  traySize: 5, // 候选区容量
  initialShovels: 2, // 开局赠送铲子数
  initialOpenSlots: 6, // 初始 6 个阵位（照搬原作初始6格）
  // —— 分圈难度（对战/无尽共用）：每 10 波为一圈，每进一圈怪物强度 ×endlessCycleStep ——
  endlessWavesPerCycle: 10,
  endlessCycleStep: 1.3,
  aiDpsBase: 8, // AI 对手拦截 DPS 基数
  aiDpsPerWave: 4, // AI 拦截 DPS 每波增量
  // —— 怪物等级与技能（精英/BOSS 会对附近武将释放减益，不改动基础数值，仅施加临时计时器）——
  eliteFromWave: 4, // 第 4 波起可能刷出精英妖（略推迟控场，降低开局秒杀感）
  eliteChance: 0.28, // 非 BOSS 怪成为精英的概率
  eliteMinGap: 2, // 两次带技能精英之间至少隔几只普通妖（避免连控导致大片兵器失效）
  skillRadius: 1, // 控制技能作用半径（格）
  skillTargetMin: 1, // 单次施法最少命中兵器数
  skillTargetMax: 2, // 单次施法最多命中兵器数（在半径内按距离取最近 N 把）
  skillInterval: 4.5, // 两次施法间隔（秒）
  skillFirstDelay: 2.5, // 入场后首次施法延迟（秒）
  stunDur: 1.4, // 眩晕：武将暂停攻击（秒）
  slowDur: 3, // 减速：攻击间隔拉长（秒）
  slowCooldownMul: 1.6, // 减速期间冷却倍率（≈攻速×0.63）
  weakenDur: 3, // 降攻：攻击力削弱（秒）
  weakenAtkMul: 0.65, // 降攻期间攻击倍率
  webbindDur: 3.5, // 缠丝：攻击范围削减持续（秒）
  webbindRangeCut: 0.5, // 缠丝：有效射程 -0.5 格（见 updateUnits）
  debuffImmuneDur: 4.5, // 兵器对同一种 debuff 的免疫时间（秒，含效果期内）
  // —— 小 Boss（第 4 波之后、非妖王波：有概率刷出跨地图小头目，各带独立光环技能）——
  miniBossFromWave: 5, // 第 5 波起（第 4 波之后）才可能出现
  miniBossChance: 0.42, // 非 BOSS 波出现小 Boss 的概率
  miniBossHpMul: 3.5, // 血量相对普通妖倍数（介于精英与妖王之间）
  miniBossSpdMul: 0.82, // 移速略慢，给玩家反应窗口
  miniBossRadius: 2.8, // 光环作用半径（格；gale/blood 用；frost/blight/quake 仍用 skillRadius）
  miniBossInterval: 4.0, // 两次施法间隔（秒）
  miniBossFirstDelay: 2.0, // 入场后首次施法延迟（秒）
  eliteHpMul: 1.4, // 精英血量倍数：精英掉落桃子是普通妖 4 倍，血量需相应更高，否则性价比失衡
  knockdownDur: 2.0, // 倒下：武器横躺、无法攻击（秒）
  hasteDur: 3.0, // 疾风：周围妖怪加速持续（秒）
  hasteSpdMul: 1.25, // 加速期间移速倍率
  healPct: 0.08, // 血泉：每次回复目标最大生命的比例
  // —— AI 清场 / 紧箍咒 ——
  aiClearChargeTime: 20, // AI 从空到满的蓄力秒数
  aiClearRadius: 2.5, // AI 清场 / 紧箍咒作用半径（格）
  aiClearDmgMul: 2.3, // 清场伤害 = 当前波基础怪血 × 有效难度 × 该系数
  // —— 主动技能数值 ——
  palmPushCells: 6, // 如来神掌沿路击退格数（不再重置到 0）
  meteorDmgMul: 2.2, // 主动陨石：波基础怪血 × 有效难度 × 该系数
  meteorRadius: 1.4, // 主动陨石半径
  meteorPassiveDmgMul: 1.4, // 被动陨石更弱，避免与主动双吃
  jingguDmgMul: 2.3, // 紧箍咒伤害倍率（与 aiClear 对齐，用有效难度）
  atkBuffMul: 1.4, // 主动仙丹攻击倍率（与风火轮对齐）
  frqBuffMul: 1.4, // 主动风火轮攻速倍率
  atkBuffDur: 8, // 仙丹持续（秒）
  frqBuffDur: 8, // 风火轮持续（秒）
  freezeStunDur: 2.5, // 冰封定身时长（全场；CD 24s）
  // —— 武将大招控制分档 ——
  heroStunDurMain: 1.5, // 满5 定身时长
  heroStunDurTransit: 1.0, // 满3 定身时长
  heroKnockPushMain: 1.5, // 满5 击退格数
  heroKnockPushTransit: 1.0, // 满3 击退格数
  heroStunDmgMul: 0.8, // 定身附带轻伤（牛魔线另乘冲撞倍率）
  heroChargeStunDmgMul: 2.0, // 牛魔/青牛定身附带重创
  heroKnockDmgMul: 1.2, // 击退附带轻伤
  heroSlowDmgMulMain: 2.8, // 白龙减速附带撕咬（再加强，弥补其单体定位的总量短板）
  heroSlowDmgMulTransit: 1.5, // 白骨减速附带轻伤
  heroSlowDur: 3,
  heroHealSlowDur: 2.5,
  heroBurnHitMul: 1.6, // 红孩/红袍：大招瞬时命中倍率（低于纯爆发系，余量转入灼烧 DoT）
  heroBurnDpsMul: 0.6, // 灼烧每秒伤害 = atk × 该系数
  heroBurnDur: 3, // 灼烧持续时间（秒）
  // 命中判定/范围环显示的半格外扩：攻击圆半径 = (rge + 0.5) 格。判定采用「圆与目标方格相交」
  // (见 inAttackRange)，显示环半径同为 (rge + 0.5)*CELL，两者一致。0.5 即半个格子。
  rangeTolerance: 0.5,
  // AI 对手每波部署的新单位数(基数 + 波次×系数)，使 AI 战力与玩家大致对称(伪竞技公平性)
  aiDeployBase: 8,
  aiDeployPerWave: 1.5,
  aiDeployInterval: 2.2, // AI 逐个部署的间隔(秒)：模拟人手动从候选区往地图放，不再开波瞬间铺满(总量不变，只拉长过程)
  // —— 双雄及以上：波中额外刷大 Boss（妖王）；间隔随机 ∈ [min, maxBase - min(shrinkCap, 英雄数-1)] ——
  heroBossFromCount: 2, // 至少几名已配对英雄才触发
  heroBossIntervalMin: 8, // 间隔下界（秒）
  heroBossIntervalMaxBase: 15, // 间隔上界基数（秒）
  heroBossIntervalShrinkCap: 4, // 英雄越多上界越压，最多压 shrinkCap 秒
  heroBossMaxPerWave: 4, // 每波最多额外引妖王次数（与英雄数取 min，防长波连刷）
};

/**
 * 武将大招对单体(专注火力)的平均秒伤估算：与 castGeneralSkill 的各分支伤害公式同口径，
 * 供 estimateOptimalPower 并入 Boss 压力账本，避免大招（尤其二郎暴击）游离于难度曲线外。
 * 不含主动技能临时增益（与 estimateOptimalPower 整体口径一致，见其函数注释）。
 */
function heroSkillFocusDps(def: GeneralDef, atk: number): number {
  const cd = def.skillCd;
  if (def.skill === 'none' || cd <= 0) return 0;
  switch (def.skill) {
    case 'burst': return (atk * 3) / cd;
    case 'ranged': return (atk * 5 * CRIT_MULT) / cd;
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
    default: {
      const _exhaustive: never = def.skill;
      return _exhaustive;
    }
  }
}

/** 双雄引妖王：间隔上界 = maxBase - min(shrinkCap, heroCount-1) */
export function heroBossIntervalHi(heroCount: number): number {
  const shrink = Math.min(TUNING.heroBossIntervalShrinkCap, Math.max(0, heroCount - 1));
  return Math.max(TUNING.heroBossIntervalMin, TUNING.heroBossIntervalMaxBase - shrink);
}

/** 妖王总血池在妖王本体与护卫间拆分（护卫总血 + 妖王血 ≈ totalHp） */
export function splitBossHpBudget(
  totalHp: number,
  escortCount: number,
  normalHp: number,
  escortHpShare: number,
): { bossHp: number; escortHpEach: number } {
  if (escortCount <= 0 || escortHpShare <= 0) {
    return { bossHp: totalHp, escortHpEach: 0 };
  }
  const share = Math.min(0.75, Math.max(0, escortHpShare));
  const escortPool = totalHp * share;
  const bossHp = Math.max(normalHp, totalHp - escortPool);
  const actualPool = totalHp - bossHp;
  if (actualPool <= 0) {
    return { bossHp: totalHp, escortHpEach: 0 };
  }
  const escortHpEach = actualPool / escortCount;
  return { bossHp, escortHpEach };
}

/** 某波骑兵比例区间：[起始, 最大]（开波时在区间内随机一次，逐怪独立判定） */
export function cavalryRatioBounds(wave: number): { start: number; max: number } {
  const start = TUNING.cavalryRatioBase + Math.min(TUNING.cavalryRatioWaveBonusCap, wave / TUNING.cavalryRatioWaveDiv);
  const max = Math.min(TUNING.cavalryRatioCap, start + TUNING.cavalryRatioMaxSpread);
  return { start, max };
}

/** 在 [起始, 最大] 内均匀随机本波骑兵占比 */
export function rollCavalryWaveRatio(wave: number, rngNext: () => number): number {
  const { start, max } = cavalryRatioBounds(wave);
  if (max <= start) return start;
  return start + rngNext() * (max - start);
}

// 攻击命中判定：以 (ax,ay) 为圆心、半径 (rgeCells + 0.5) 格的攻击圆(与范围环显示同一个圆)，
// 是否与目标所在方格真实相交(边相切不算 → 严格小于)。目标方格取其中心 round 后的整格。
// (ax,ay) 用格中心坐标：兵为其所在格整数坐标，英雄为两格中点(可为半格)。
export function inAttackRange(ax: number, ay: number, rgeCells: number, p: { c: number; r: number }): boolean {
  const mc = Math.round(p.c), mr = Math.round(p.r);        // 目标所在方格
  const nx = Math.min(mc + 0.5, Math.max(mc - 0.5, ax));   // 方格内离圆心最近点(clamp)
  const ny = Math.min(mr + 0.5, Math.max(mr - 0.5, ay));
  return Math.hypot(ax - nx, ay - ny) < rgeCells + TUNING.rangeTolerance; // 半径含半格；严格<，边不算
}

// 怪物技能：对附近武将施加的减益类型
export type MonsterSkill = 'stun' | 'slow' | 'weaken' | 'webbind';
export const SKILL_META: Record<MonsterSkill, { name: string; color: string; icon: string }> = {
  stun: { name: '定身', color: '#ffd34d', icon: '定' },
  slow: { name: '迟滞', color: '#5bd1ff', icon: '迟' },
  weaken: { name: '弱身', color: '#c77dff', icon: '弱' },
  webbind: { name: '缠丝', color: '#b76bd6', icon: '网' },
};

// 小 Boss 种类（跨地图通用，与地图专属精英/妖王技能独立）
export type MiniBossKind = 'frost' | 'blight' | 'quake' | 'gale' | 'blood';
export const MINI_BOSS_KINDS: MiniBossKind[] = ['frost', 'blight', 'quake', 'gale', 'blood'];
export const MINI_BOSS_META: Record<
  MiniBossKind,
  { name: string; skillName: string; color: string; icon: string; desc: string }
> = {
  frost: { name: '霜魄妖', skillName: '霜缚', color: '#7ec8ff', icon: '霜', desc: '范围内兵器攻速↓' },
  blight: { name: '蚀甲妖', skillName: '蚀甲', color: '#c77dff', icon: '蚀', desc: '范围内兵器伤害↓' },
  quake: { name: '撼地妖', skillName: '震地', color: '#e0a060', icon: '震', desc: '范围内兵器倒下' },
  gale: { name: '疾风妖', skillName: '疾风', color: '#7dffb0', icon: '风', desc: '周围妖怪加速' },
  blood: { name: '血泉妖', skillName: '血泉', color: '#ff6a7a', icon: '血', desc: '周围妖怪少量回血' },
};

// 武器侧状态（含小 Boss「倒下」），供 UI 统一取色/图标
export type UnitStatusId = 'stun' | 'slow' | 'weaken' | 'webbind' | 'knockdown';
export const UNIT_STATUS_META: Record<UnitStatusId, { name: string; color: string; icon: string }> = {
  stun: SKILL_META.stun,
  slow: SKILL_META.slow,
  weaken: SKILL_META.weaken,
  webbind: SKILL_META.webbind,
  knockdown: { name: '倒下', color: '#e0a060', icon: '😵' },
};

// 妖怪侧状态（武将控制 + 小 Boss 光环）
export type MonsterStatusId = 'stun' | 'slow' | 'haste' | 'heal' | 'burn';
export const MONSTER_STATUS_META: Record<MonsterStatusId, { name: string; color: string; icon: string }> = {
  stun: { name: '定身', color: '#ffd34d', icon: '💫' },
  slow: { name: '迟滞', color: '#5bd1ff', icon: '🐌' },
  haste: { name: '疾风', color: '#7dffb0', icon: '💨' },
  heal: { name: '回春', color: '#ff6a7a', icon: '💚' },
  burn: { name: '灼烧', color: '#ff8a3d', icon: '🔥' },
};

// 每张地图的专属技能主题：该图 Boss 必带、精英小怪也带同一技能（不再随机三选一）
export const MAP_SKILL: Record<string, MonsterSkill> = {
  huoyanshan: 'weaken', // 火焰山：烈焰灼身，攻击↓
  liushahe: 'slow', // 流沙河：流沙裹足，出手变慢
  baiguling: 'stun', // 白骨岭：白骨魅惑，无法出手
  pansidong: 'webbind', // 盘丝洞：蛛网黏附，攻击范围骤减
};

// 候选区令牌：兵种 / 铲子 / 武将字牌 / 桃树（字牌不可互相合并，升阶靠激活继承/喂字/战斗）
export type TrayToken =
  | { kind: 'unit'; type: UnitType; tier: number; /** 地图挤回候选区，布阵待换低阶上板 */ displaced?: boolean }
  | { kind: 'shovel' }
  | { kind: 'word'; char: string; general: string; tier: number }
  | { kind: 'tree'; level: number; growT: number };

/** 候选区有效令牌（clearTraySlot 用 delete 留空洞，遍历须跳过） */
export function trayTokens(tray: readonly (TrayToken | undefined)[]): TrayToken[] {
  const out: TrayToken[] = [];
  for (let i = 0; i < tray.length; i++) {
    const t = tray[i];
    if (t) out.push(t);
  }
  return out;
}

export function findTrayIndex(
  tray: readonly (TrayToken | undefined)[],
  pred: (t: TrayToken) => boolean,
): number {
  for (let i = 0; i < tray.length; i++) {
    const t = tray[i];
    if (t && pred(t)) return i;
  }
  return -1;
}

export function traySome(
  tray: readonly (TrayToken | undefined)[],
  pred: (t: TrayToken) => boolean,
): boolean {
  return findTrayIndex(tray, pred) >= 0;
}

export type Status = 'ready' | 'playing' | 'won' | 'lost';

export interface PlacedUnit {
  type: UnitType;
  tier: number;
  cell: Cell;
  cooldown: number; // 距下次攻击的秒数
  firePulse: number; // 开火脉冲(1→0)，用于渲染缩放
  combo: number; // 连击计数：上次出招未收完就再次命中则累加，归零则清零（枪连刺形变用）
  fireDir?: number; // 上次开火朝向(弧度，格坐标系)，用于兵器形变动画朝向目标
  stunT: number; // 眩晕剩余(秒)：>0 时无法攻击
  slowT: number; // 减速剩余(秒)：>0 时冷却拉长
  weakenT: number; // 降攻剩余(秒)：>0 时伤害削弱
  rangeCutT: number; // 缠丝剩余(秒)：>0 时有效射程削减
  knockdownT: number; // 倒下剩余(秒)：>0 时无法攻击，立绘横躺
  // 同种 debuff 免疫剩余(秒)：>0 时再被同类型控制无效
  stunImmuneT: number;
  slowImmuneT: number;
  weakenImmuneT: number;
  rangeCutImmuneT: number;
  knockdownImmuneT: number;
}

/** 新建落位兵器的公共初始状态（含减益计时器）；可选朝向出怪口 */
export function makePlacedUnit(
  type: UnitType,
  tier: number,
  cell: Cell,
  faceToward?: Cell,
): PlacedUnit {
  return {
    type,
    tier,
    cell,
    cooldown: 0,
    firePulse: 0,
    combo: 0,
    fireDir: faceToward ? faceDirToward(cell, faceToward) : undefined,
    stunT: 0,
    slowT: 0,
    weakenT: 0,
    rangeCutT: 0,
    knockdownT: 0,
    stunImmuneT: 0,
    slowImmuneT: 0,
    weakenImmuneT: 0,
    rangeCutImmuneT: 0,
    knockdownImmuneT: 0,
  };
}

// 棋盘上的单个武将字牌（占一格，带阶数；同字同阶可合并升阶）
export interface PlacedWord {
  char: string;
  general: string; // 所属武将 id
  tier: number;
  cell: Cell;
}

// 蟠桃园桃树：种在「未开垦」空地上，按等级周期产桃，同级可拖动合并升级（最高 5 级）。
export interface PeachTree {
  level: number; // 1..5
  cell: Cell;
  growT: number; // 距下次产桃已累积秒数
}
// 各等级产 1 桃的间隔（秒）：1级20s / 2级10s / 3级5s / 4级3s / 5级2s
export const PEACH_TREE_INTERVALS = [20, 10, 5, 3, 2];
export const PEACH_TREE_MAX_LEVEL = 5;
export const PEACH_TREE_PLANT_INTERVAL = 40; // 蟠桃园每 40s 自动种 1 棵

/** 地图上全是 N 级树时，蟠桃园累计多少棵「虚拟树」才合并升级 1 棵（N→N+1） */
export function peachTreeMergeBankNeed(level: number): number {
  return 1 << Math.max(0, level - 1);
}

export const SKILL_FX_DUR = 0.8; // 主动技能爆发特效时长（秒）
export const BUFF_SKILL_FX_DUR = 1.25; // 仙丹/风火轮施放冲击特效（秒，略长便于感知）
/** @deprecated 使用 SKILL_FX_DUR */
export const PALM_PUSH_DUR = SKILL_FX_DUR;

// 如来神掌沿路回推动画：从最前怪沿路径逐格回推
export interface PalmPushFx {
  t: number;
  dur: number;
  cells: number;
  frontStartDist: number;
  snapshots: { id: number; startDist: number }[];
}

/** 主动技能瞬时爆发特效（玩家/AI 半场各可独立播放） */
export type SkillFxKind = 'jinggu' | 'meteor' | 'freeze' | 'atkBuff' | 'frqBuff';

export interface SkillFx {
  kind: SkillFxKind;
  t: number;
  dur: number;
  c: number;
  r: number;
}

// 武将的持续状态（按激活对格子 key 记录；拆分后该对进度清除，重组从 1 档重计）
// level/exp 为升阶进度内部计数，不对玩家展示为战斗 Lv
export interface GeneralState {
  level: number;
  exp: number;
  cooldown: number;
  skillCd: number;
  firePulse: number;
  fireDir?: number; // 上次开火朝向(弧度)，字牌攻击时驱动兵器形变
  skillFlash: number;
}

// 由「左右紧邻的两个同将字牌」激活的武将（占两格，带金框）
export interface ActiveGeneral {
  def: GeneralDef;
  tier: number; // 取两字阶数的较小值
  cells: [Cell, Cell];
  state: GeneralState;
}

export interface Monster {
  id: number;
  dist: number; // 沿路进度（格）
  hp: number;
  maxHp: number;
  spd: number;
  isBoss: boolean;
  isMiniBoss: boolean; // 小 Boss：跨地图头目，带独立光环技能
  miniBossKind: MiniBossKind | null; // 小 Boss 种类（非小 Boss 为 null）
  isCavalry: boolean; // 骑兵：移速翻倍、血量 ×cavalryHpMul（骑兵波中按本波随机比例，BOSS 不会是骑兵）
  hitFlash: number; // 受击闪白(秒)
  skill: MonsterSkill | null; // 精英/BOSS 携带的减益技能（普通妖/小 Boss 为 null）
  skillCd: number; // 距下次施法的秒数
  castFlash: number; // 施法闪光(1→0)，用于渲染
  spawnT: number; // 出生后经过秒数（用于"由小变大崩出"入场缩放）
  stunT: number; // 被武将定身剩余(秒)：>0 时不前进
  slowT: number; // 被武将减速剩余(秒)：>0 时移速降低
  hasteT: number; // 疾风加速剩余(秒)：>0 时移速提高
  healFlash: number; // 刚被血泉治疗的闪光(1→0)，用于 UI
  burnT: number; // 灼烧剩余(秒)：>0 时每秒按 burnDps 掉血（红孩/红袍大招）
  burnDps: number; // 灼烧每秒伤害（施法时写入，刷新取更高值）
}

/** 弹道/命中特效种类：四兵种 + 英雄悟空金箍棒（原棍兵特效迁至此） */
export type HitFxStyle = UnitType | 'staff';

export interface HitFx {
  from: { c: number; r: number };
  to: { c: number; r: number };
  ttl: number;
  maxTtl: number;
  color: string;
  wtype?: HitFxStyle; // 攻击来源：刀/枪/骑/弓，或英雄悟空金箍棒 staff
  tier?: number; // 攻击者阶数，用于让特效随等级加大(圈数/范围/时长)
  heroId?: string; // 武将普攻：按 heroId 渲染专属特效
}

// 爆发型特效（命中/击杀/合成），渲染于格坐标
export interface Burst {
  kind: 'hit' | 'death' | 'merge';
  c: number;
  r: number;
  ttl: number;
  maxTtl: number;
  big: boolean;
  color: string;
}

// 武将大招专属特效（每英雄一套动画，渲染于格坐标；与主动技能的 ultFlash 无关）
export interface HeroUltFx {
  heroId: string;        // 分派动画用（对应 GeneralDef.id）
  c: number;             // 爆心列（通常取最前目标 inRange[0]）
  r: number;             // 爆心行
  ttl: number;
  maxTtl: number;
  tier: number;          // 品质阶(1..5)，用于特效规模
  rge: number;           // 英雄当前射程(格)，范围类动画铺开半径
  crit: boolean;         // true=暴击(单体) false=群攻(范围)
  fromC?: number;        // 施法者格坐标（大圣飞棒 / 二郎·牛郎射线起点）
  fromR?: number;
}

// 击杀蟠桃飘字：头上弹出，上抛半格 + 重力，过顶后再下落 1/5 格消失
export const PEACH_FLOAT_HEAD_Y = -0.55; // 相对格中心（格；负=向上）
export const PEACH_FLOAT_RISE = 0.5;
export const PEACH_FLOAT_FALL = 0.2;
export const PEACH_FLOAT_GRAVITY = 6; // 格/秒²
export interface PeachFloat {
  c: number;
  r: number;
  amount: number;
  y: number;
  vy: number;
  peakY: number;
}

export interface DamageFloat {
  c: number;
  r: number;
  amount: number;
  x: number;
  vx: number;
  y: number;
  vy: number;
  peakY: number;
  age: number;
  crit: boolean;
}

export function peachFloatInitialVy(gravity = PEACH_FLOAT_GRAVITY, rise = PEACH_FLOAT_RISE): number {
  return -Math.sqrt(2 * gravity * rise);
}

// 伤害飘字：自头顶弹出，上抛后受重力回落，过顶后淡出消失
export const DAMAGE_FLOAT_HEAD_Y = -0.48;
export const DAMAGE_FLOAT_RISE = 0.38;
export const DAMAGE_FLOAT_RISE_CRIT = 0.52;
export const DAMAGE_FLOAT_FALL = 0.16;
export const DAMAGE_FLOAT_GRAVITY = 10;
export const DAMAGE_FLOAT_GRAVITY_CRIT = 11;
export const DAMAGE_FLOAT_VX = 0.72; // 左右抛物线初速（格/秒）
export const DAMAGE_FLOAT_VX_CRIT = 0.9;

export const DIG_DUR = 0.5; // 铲子挖坑动画时长（来回挖两下）

interface Modifiers {
  atkMul: number;
  frqMul: number;
  killBonus: number;
  monsterSpdMul: number;
  summonCostDelta: number;
  wordRateBonus: number; // 招贤榜：字牌掉率加成
  shovelPeach: number; // 摸金校尉：每次开挖额外蟠桃
  autoShovel: boolean; // 洛阳铲：定期产铲
  meteor: boolean; // 陨石：每波开始砸最前妖怪
  mud: boolean; // 淤泥：出怪口附近减速
  generalTierDelta: number; // 法宝符：武将首次激活时双字品质阶 +N
}

// 局外「功德商店」买断的永久加成，开局注入本局（数值温和有上限，避免破坏塔 DPS 平衡）
export interface MetaBonuses {
  bonusPeach: number; // 初始蟠桃 +
  bonusHp: number; // 唐僧初始血 +
  bonusSlots: number; // 额外初始阵位 +
  atkPct: number; // 全体攻击 +（加到 atkMul）
  frqPct: number; // 全体攻速 +（加到 frqMul）
}
export const NO_META: MetaBonuses = { bonusPeach: 0, bonusHp: 0, bonusSlots: 0, atkPct: 0, frqPct: 0 };

const cellKey = (c: number, r: number) => `${c},${r}`;

export class Battle {
  peach = INITIAL_PEACH;
  tangsengHP = TANGSENG_INITIAL_HP;
  wave = 0;
  status: Status = 'ready';
  summonCost = TUNING.summonCostStart;
  summonCount = 0;
  private summonsSinceShovel = 0; // 距上次出铲经过的征兵次数（铲子保底计数）
  private summonsSinceWord = 0; // 距上次出字经过的征兵次数（字牌保底计数）
  private summonsSincePair = 0; // 距上次补上孤儿配对经过的征兵次数（半对保底）
  /** 本局各字累计出现次数（棋盘实例 + 历次征兵抽字），用于后续抽字概率打压 */
  private wordCharCounts = new Map<string, number>();

  units = new Map<string, PlacedUnit>();
  words = new Map<string, PlacedWord>(); // 棋盘上的武将字牌（各占一格）
  trees = new Map<string, PeachTree>(); // 蟠桃园桃树（各占一格未开垦地）
  gardenOn = false; // 是否装备了「蟠桃园」被动技能（每日购买）
  private plantTimer = 0; // 距下次自动种树累积秒数
  private plantBank = 0; // 满格时蟠桃园累积的「虚拟树」，达阈值后合并升级
  palmPushFx: PalmPushFx | null = null; // 如来神掌沿路回推（渲染 + 逐帧位移）
  playerSkillFx: SkillFx | null = null; // 玩家半场主动技能爆发特效
  aiSkillFx: SkillFx | null = null; // AI 半场主动技能爆发特效
  generalStates = new Map<string, GeneralState>(); // 各激活对的经验/冷却（按格子对 key，非武将 id）
  monsters: Monster[] = [];
  fx: HitFx[] = [];
  bursts: Burst[] = []; // 命中/击杀/合成爆发特效
  heroUltFx: HeroUltFx[] = []; // 武将大招专属特效
  peachFloats: PeachFloat[] = []; // 击杀蟠桃飘字
  damageFloats: DamageFloat[] = []; // 受击伤害飘字
  digFx: { c: number; r: number; t: number }[] = []; // 铲子挖坑动画(来回两下)，t 累积秒数
  aiDigFx: { c: number; r: number; t: number }[] = []; // AI 侧挖坑动画（对称展示，见 render）
  // 自动布阵对"刚挖开、开格动画未完"的格做的延迟落子：先预占该格，动画结束后由 updateFx 真正落子。
  private pendingPlace: { token: TrayToken; c: number; r: number }[] = [];
  private aiPendingPlace: { token: TrayToken; c: number; r: number }[] = [];
  summonFlash = 0; // 征兵闪光(1→0)
  autoplaceFlash = 0; // 布阵闪光(1→0)
  summonAnimT = 999; // 距上次征兵的秒数（用于候选令牌逐个"飞入槽位"的入场动画）
  sfxEvents: string[] = []; // 引擎发出的音效事件名，由音频层每帧取走播放（保持引擎与DOM解耦）
  private emit(name: string): void { if (this.sfxEvents.length < 32) this.sfxEvents.push(name); }
  healUsedThisWave = false; // 观音甘露每波限回一次
  tangsengMaxHP = TANGSENG_INITIAL_HP; // 唐僧血量上限（受功德/道具提升）

  // —— 主动技能（功德购买、每日装备，最多 2 个；CD 制、手动触发）——
  // 每个装备的技能一个运行时槽：独立冷却计时。
  activeSlots: { id: string; cd: number; cdMax: number; ready: boolean; flash: number }[] = [];
  atkBuffT = 0; atkBuffMul = 1; // 仙丹：全体攻击临时增益
  frqBuffT = 0; frqBuffMul = 1; // 风火轮：全体攻速临时增益
  ultFlash = 0; // AOE 技能(紧箍咒/陨石)释放特效计时(秒)
  ultCenter: { c: number; r: number } | null = null; // AOE 爆心（渲染用）
  spawnGateT = 0; // 玩家出怪口开合动画计时(0.5→0)
  aiSpawnGateT = 0; // AI 出怪口开合动画计时

  // 开局入场：唐僧沿路走到归位，这段时间玩家可征兵布阵；归位后自动开打第一波
  introT = 0;
  introDone = false;
  static readonly INTRO_DUR = 6; // 秒
  // 新手引导展示期间强制渲染唐僧于归位点（不影响 introT/introDone 计时，仅用于展示）
  tangsengRenderOverride = false;

  // —— 伪竞技 AI 对手（上半场，对角唐僧）——
  readonly aiPath: Cell[];
  readonly aiTangseng: Cell;
  readonly aiCells: Cell[]; // AI 可部署格 = 玩家可摆放格的镜像
  readonly aiUnlocked = new Set<string>(); // AI 已开放阵位(初始6格 + 已部署格)，用于渲染其可放置区域
  private aiPathLen: number;
  private entranceDist = 0; // 玩家出怪口沿路距离
  private aiEntranceDist = 0; // AI 出怪口沿路距离
  aiTangsengHP = TANGSENG_INITIAL_HP;
  aiFrqMul = 1; // AI 侧全体攻速倍率（含道具加成）
  aiMods: Modifiers = { atkMul: 1, frqMul: 1, killBonus: 0, monsterSpdMul: 1, summonCostDelta: 0, wordRateBonus: 0, shovelPeach: 0, autoShovel: false, meteor: false, mud: false, generalTierDelta: 0 };
  aiActiveSlots: { id: string; cd: number; cdMax: number; ready: boolean; flash: number }[] = [];
  private aiAtkBuffT = 0;
  private aiFrqBuffT = 0;
  private aiShovelTimer = 0;
  private aiTierBoosted = new Set<string>();
  private aiMeteorPending = false;
  aiPickedItems: string[] = []; // HUD 右上角展示
  aiMonsters: Monster[] = [];
  aiUnits: PlacedUnit[] = []; // AI 自动部署的单位（上半场）
  aiDefeated = false;
  private nextWaveTimer = 0; // 波间自动切换倒计时
  private wasDangerNear = false; // 危险提示边沿：进入 danger 时播一次提示音

  // 候选区（征兵产出）与铲子（开格资源）
  tray: TrayToken[] = [];
  shovels = TUNING.initialShovels;
  unlocked = new Set<string>(); // 已解锁阵位的 key 集合

  // —— AI 对手真玩家化：与玩家平行的经济/候选/资源（后续 C2-C5 使用）——
  aiPeach = INITIAL_PEACH;                 // 基础经济（不加 meta.bonusPeach）
  private aiSummonCost = TUNING.summonCostStart; // 同玩家初始征兵成本
  aiShovels = TUNING.initialShovels;
  aiTray: TrayToken[] = [];
  aiWords = new Map<string, PlacedWord>();
  private aiSummonsSinceShovel = 0;
  private aiSummonsSinceWord = 0; // AI 字牌保底计数（镜像 summonsSinceWord）
  private aiSummonsSincePair = 0;
  private aiWordCharCounts = new Map<string, number>(); // AI 字出现次数（抽字打压）
  private aiSummonCount = 0;
  private aiGeneralStates = new Map<string, GeneralState>();
  private aiRng!: RNG;                      // 独立随机源（构造里派生）
  private aiSummonTimer = 0;                // 距下次可征兵计时
  private aiRepositionTimer = 0;            // 战中调整节流（兵器 1–2.5s / 补配对字 0.5–1s 随机）
  private aiLastRepositionPair: { a: Cell; b: Cell } | null = null;
  private aiAdjustIntervalScale = 1;        // versus-agent 10× 子步进时缩至 0.1
  aiSkill = DEFAULT_AI_SKILL;              // 跨局注入（默认 1.0）
  /** 对战隐藏调节：抽字/道具概率，不在 UI 展示 */
  private versusBand = versusRubberBand(0, 0);

  // 道具与修正器
  mods: Modifiers = { atkMul: 1, frqMul: 1, killBonus: 0, monsterSpdMul: 1, summonCostDelta: 0, wordRateBonus: 0, shovelPeach: 0, autoShovel: false, meteor: false, mud: false, generalTierDelta: 0 };
  private shovelTimer = 0; // 洛阳铲产铲计时
  private meteorPending = false; // 本波陨石是否待触发
  weaponBonuses: WeaponBonuses = {}; // 已装备神兵给各武将的加成
  aiWeaponBonuses: WeaponBonuses = {}; // AI 神兵：按 aiSkill 缩放玩家神兵
  pendingWeaponPickups: string[] = []; // 本局掉落、待左下角点击领取的神兵碎片
  /** 开局预排的本局可能掉落的神兵 id；null 表示本局无掉落资格 */
  battleFragmentDropId: string | null = null;
  battleFragmentDropped = false;
  /** 由 main 注入：碎片已集齐时不展示领取卡片（仍参与随机） */
  weaponPickupVisible: (id: string) => boolean = () => true;
  pickedItems: string[] = [];

  private tierBoosted = new Set<string>(); // 法宝符：已应用首次激活升阶的格子对 key
  private rng: RNG;
  readonly map: GameMap;
  readonly pathLen: number;
  private slotOrder: Cell[];
  private playerNearestPathDistByCell = new Map<string, number>();
  private playerExitDistByCell = new Map<string, number>();
  private aiNearestPathDistByCell = new Map<string, number>();
  private aiExitDistByCell = new Map<string, number>();
  private spawnRemaining = 0;
  private spawnTimer = 0;
  private sinceLastElite = Number.POSITIVE_INFINITY; // 距上一只带技能精英已刷出的普通妖数
  private waveMonsterCount = 0; // 本波出怪总数（含后期堆量），用于出场序号
  private cavalryWave = false; // 本波是否为骑兵波
  private cavalryWaveRatio = 0; // 骑兵波内逐怪成为骑兵的概率（开波时在波次相关区间内随机）
  private waveMiniBoss: MiniBossKind | null = null; // 本波预定的小 Boss 种类（非 BOSS 波才可能）
  private miniBossSpawnIdx = -1; // 小 Boss 出场序号（0-based）；-1 表示本波无
  /** 双雄引妖王：距下次额外大 Boss 的秒数；英雄不足时为 -1，重新凑齐后重 roll 满间隔 */
  private heroBossTimer = -1;
  /** 本波已通过双雄机制额外刷出的大 Boss 数 */
  private heroBossSpawnsThisWave = 0;
  private nextMonsterId = 1;
  private waveActive = false;
  readonly difficultyMul: number; // 由境界决定的怪物强度系数
  readonly endless: boolean; // 无尽模式：波数不限、关对手、只记录最高波数
  message = '点「征兵」抽兵到候选区，拖到绿格布阵';

  private bossWaves = new Set<number>(); // 分段预排的妖王波（对战/无尽共用）
  private bossScheduleRng: RNG; // 妖王波专用 RNG，不扰动出怪/掉落主序列
  private bossScheduleThrough = 0; // 已排程覆盖到的最高波号
  /** 本波按最优输出算出的压力方案（开波时刷新；供出怪血量/数量使用） */
  private wavePressure: PressurePlan | null = null;

  constructor(seed = 1, difficultyMul = 1, map: GameMap = MAPS[0]!, meta: MetaBonuses = NO_META, weapons: WeaponBonuses = {}, actives: string[] = [], passives: string[] = [], endless = false, aiSkill = DEFAULT_AI_SKILL, aiAdjustIntervalScale = 1) {
    this.aiAdjustIntervalScale = aiAdjustIntervalScale;
    this.versusBand = versusRubberBand(
      endless ? 0 : loadPlayerWinStreak(),
      endless ? 0 : loadPlayerLossStreak(),
    );
    const effectiveSkill = effectiveAiSkill(aiSkill, this.versusBand);
    this.weaponBonuses = weapons;
    this.aiWeaponBonuses = scaleWeaponBonuses(weapons, aiWeaponScale(effectiveSkill));
    this.rng = new RNG(seed);
    this.aiRng = new RNG((seed * 2654435761 + 1013904223) >>> 0); // 派生独立流：生成策略同、结果不同
    this.aiSkill = effectiveSkill;
    this.difficultyMul = difficultyMul;
    this.endless = endless;
    this.bossScheduleRng = new RNG((seed ^ 0x5bf03635) >>> 0);
    this.ensureBossSchedule(TUNING.bossFirstSegHi); // 开局先排好首段 1–10
    this.map = map;
    this.pathLen = pathTotalLen(map);
    this.slotOrder = slotUnlockOrder(map);
    // AI 对手：点对称镜像路径与唐僧（上半场）
    this.aiPath = mirrorPath(map.path);
    this.aiPathLen = lenOf(this.aiPath);
    this.entranceDist = entranceDistance(map.path);
    this.aiEntranceDist = entranceDistance(this.aiPath);
    this.aiTangseng = mirrorCell(map.tangseng);
    this.aiCells = placeableByProximity(map).map(mirrorCell); // 按贴路远近排序，AI 优先占贴路格
    // 局外功德加成注入
    this.peach += meta.bonusPeach;
    this.tangsengHP += meta.bonusHp;
    this.tangsengMaxHP += meta.bonusHp;
    this.aiTangsengHP += meta.bonusHp; // 对手同享，维持对称
    this.mods.atkMul += meta.atkPct;
    this.mods.frqMul += meta.frqPct;
    this.aiMods.atkMul += meta.atkPct;
    this.aiMods.frqMul += meta.frqPct;
    // 装备的主动技能（最多 MAX_EQUIPPED_ACTIVES 个）建运行时槽；初始满 CD，避免开局即放
    for (const id of actives.slice(0, MAX_EQUIPPED_ACTIVES)) {
      const def = activeById(id);
      if (!def || def.disabled) continue; // 下架技能不注入
      this.activeSlots.push({ id, cd: def.cd, cdMax: def.cd, ready: false, flash: 0 });
    }
    // 初始解锁：地图的初始 6 格 + 功德额外阵位
    const openSlots = TUNING.initialOpenSlots + meta.bonusSlots;
    for (let i = 0; i < openSlots && i < this.slotOrder.length; i++) {
      const s = this.slotOrder[i]!;
      this.unlocked.add(cellKey(s.c, s.r));
    }
    // AI 初始可放置区域：镜像玩家初始 6 格（与玩家对称展示，后续随部署扩展）
    for (let i = 0; i < TUNING.initialOpenSlots && i < this.slotOrder.length; i++) {
      const m = mirrorCell(this.slotOrder[i]!);
      this.aiUnlocked.add(cellKey(m.c, m.r));
    }
    // 每日被动技能：开局按 id 注入本局。蟠桃园走桃树系统；其余复用 applyItem 效果引擎。
    // 只取前 MAX_EQUIPPED_PASSIVES 个作防御（正常 loadout 已保证 ≤N，且为最新 N）。
    for (const id of passives.slice(0, MAX_EQUIPPED_PASSIVES)) {
      if (!isPassiveEnabled(id)) continue; // 下架技能不注入
      if (id === 'pas_pantao') { this.gardenOn = true; this.pickedItems.push(id); continue; } // 蟠桃园走桃树系统，同时进被动栏展示
      this.applyItem(id);
      this.pickedItems.push(id);
    }
    if (!endless) {
      const aiRoll = rollAiLoadout(
        actives.slice(0, MAX_EQUIPPED_ACTIVES),
        passives.slice(0, MAX_EQUIPPED_PASSIVES),
        effectiveSkill,
        (n) => this.aiRng.int(n),
        {
          itemBonus: this.versusBand.aiItemBonus,
          activeRatioBoost: this.versusBand.aiActiveRatioBoost,
          debuffPassiveBias: this.versusBand.aiDebuffPassiveBias,
        },
      );
      for (const id of aiRoll.actives) {
        const def = activeById(id);
        if (!def || def.disabled) continue;
        this.aiActiveSlots.push({ id, cd: def.cd, cdMax: def.cd, ready: false, flash: 0 });
        this.aiPickedItems.push(id);
      }
      for (const id of aiRoll.passives) {
        if (!isPassiveEnabled(id)) continue;
        this.applyAiItem(id);
        this.aiPickedItems.push(id);
      }
      const knobs = skillToKnobs(effectiveSkill);
      this.aiSummonTimer = knobs.summonInterval * 0.5;
      this.aiRepositionTimer = rollAiAdjustInterval(false, () => this.aiRng.next(), this.aiAdjustIntervalScale);
    }
    this.warmPathDistCaches();
  }

  private warmPathDistCaches(): void {
    for (const s of this.slotOrder) {
      const k = cellKey(s.c, s.r);
      this.playerNearestPathDistByCell.set(k, Battle.nearestPathDistOn(this.map.path, s));
      this.playerExitDistByCell.set(k, exitDistToPath(this.map.path, s));
    }
    for (const s of this.aiCells) {
      const k = cellKey(s.c, s.r);
      this.aiNearestPathDistByCell.set(k, Battle.nearestPathDistOn(this.aiPath, s));
      this.aiExitDistByCell.set(k, exitDistToPath(this.aiPath, s));
    }
  }

  private static nearestPathDistOn(path: Cell[], cell: { c: number; r: number }): number {
    let min = Infinity;
    for (const p of path) {
      if (p.r < 0 || p.r >= ROWS) continue;
      const d = Math.hypot(p.c - cell.c, p.r - cell.r);
      if (d < min) min = d;
    }
    return min;
  }

  // AI 唐僧当前渲染位置（同玩家入场节奏沿镜像路走向归位）
  aiTangsengRenderPos(): { c: number; r: number } {
    if (this.introDone) return posAlong(this.aiPath, this.aiPathLen);
    const p = Math.min(1, this.introT / Battle.INTRO_DUR);
    return posAlong(this.aiPath, p * this.aiPathLen);
  }

  aiMonsterPos(m: Monster): { c: number; r: number } {
    return posAlong(this.aiPath, m.dist);
  }

  /** 玩家侧淤泥：出怪口附近 3 格内妖怪移速降低 */
  monsterInMudZone(m: Monster): boolean {
    return this.mods.mud && m.dist - this.entranceDist < 3;
  }

  /** AI 侧淤泥：镜像 monsterInMudZone，作用于 aiMonsters */
  aiMonsterInMudZone(m: Monster): boolean {
    return this.aiMods.mud && m.dist - this.aiEntranceDist < 3;
  }

  // 该格是否已解锁
  private isUnlocked(c: number, r: number): boolean {
    return this.unlocked.has(cellKey(c, r));
  }

  // 该格是否为可摆放格（玩家半场、非路径、在网格内）
  private isPlaceable(c: number, r: number): boolean {
    return isPlayerCell(this.map, c, r);
  }

  unlockedCells(): Cell[] {
    return this.slotOrder.filter((s) => this.unlocked.has(cellKey(s.c, s.r)));
  }

  // 尚未解锁的可摆放格（供铲子开挖，按贴路顺序）
  lockedCells(): Cell[] {
    return this.slotOrder.filter((s) => !this.unlocked.has(cellKey(s.c, s.r)));
  }

  // 某格到怪物路径的最近距离（格）——与 board.placeableByProximity 的 nearest 同口径
  nearestPathDist(cell: { c: number; r: number }): number {
    const k = cellKey(cell.c, cell.r);
    const cached = this.playerNearestPathDistByCell.get(k);
    if (cached !== undefined) return cached;
    const d = Battle.nearestPathDistOn(this.map.path, cell);
    this.playerNearestPathDistByCell.set(k, d);
    return d;
  }

  private playerExitDist(cell: { c: number; r: number }): number {
    const k = cellKey(cell.c, cell.r);
    const cached = this.playerExitDistByCell.get(k);
    if (cached !== undefined) return cached;
    const d = exitDistToPath(this.map.path, cell);
    this.playerExitDistByCell.set(k, d);
    return d;
  }

  // 征兵：消耗蟠桃随机产出候选（兵种/铲子/武将字牌）。成本递增。
  // 兵/铲的分布走受约束的 drawSummonTray（同 key 上限 + 首次保底≥4兵 + 铲子保底）；
  // 每次征兵整盘重抽：字牌不跨次保留（当盘可凑对，换盘即清）。
  summon(): boolean {
    if (this.status === 'won' || this.status === 'lost') return false;
    const cost = this.effectiveSummonCost();
    if (this.peach < cost) {
      this.message = '蟠桃不足，无法征兵';
      return false;
    }
    this.peach -= cost;
    this.summonCost += TUNING.summonCostStep;
    this.summonFlash = 1; // 征兵闪光
    this.summonAnimT = 0; // 触发候选令牌逐个飞入动画
    this.emit('summon');
    // 整盘重抽：不再保留旧字牌，避免 tray 残留
    const avail = TUNING.traySize;
    const types = Object.keys(UNITS) as UnitType[];
    const firstSummon = this.summonCount === 0;
    // 阵位是否已全部挖开：全开后铲子无用 → 不出铲、不触发铲子保底，且放宽同兵种上限
    const allOpen = this.lockedCells().length === 0;
    // 铲子保底：连续 shovelPityAfter 次没出铲则本次强制出铲——仅在仍有未挖格(空位)时才生效
    const forceShovel = !allOpen && this.summonsSinceShovel >= TUNING.shovelPityAfter;
    // 兵/铲分布：受约束（同 key ≤ 上限，首次保底≥4兵，可选强制出铲）
    const base = drawSummonTray({
      rng: this.rng,
      unitTypes: types,
      draws: avail,
      shovelChance: allOpen ? 0 : TUNING.shovelDrawChance, // 全开后不再产铲
      maxPerKey: allOpen ? TUNING.summonMaxPerKeyAllOpen : TUNING.summonMaxPerKey,
      firstSummon,
      forceShovel,
    });
    this.summonCount += 1;
    // 铲子保底计数：本盘出铲则清零，否则累加
    if (base.some((t) => t.kind === 'shovel')) this.summonsSinceShovel = 0;
    else this.summonsSinceShovel += 1;
    // 非首次征兵：按字牌掉率把部分「兵」槽转成武将字牌（首次保底不转，维持≥4兵）
    const forceWord = !firstSummon && this.summonsSinceWord >= TUNING.wordPityAfter;
    // 配对/去重只看棋盘（旧 tray 整盘替换，不计入孤儿与已拥有）
    const orphansBefore = this.boardOrphanCharsNow();
    const ownedBoard = this.boardWordCharsNow();
    const fieldCharCounts = this.boardFieldCharCounts();
    const activeMax5Families = this.activeMax5FamiliesNow();
    const forcePartner = !firstSummon && orphansBefore.length > 0 && this.summonsSincePair >= TUNING.pairPityAfter;
    const trayWordsSoFar: string[] = [];
    let partnerForced = false;
    const drawOneWord = (forcePair: boolean) => {
      const w = pickWordChar(
        this.rng,
        Math.max(1, this.wave),
        orphansBefore,
        trayWordsSoFar,
        forcePair,
        ownedBoard,
        this.wordDrawCounts(),
        {
          tier5BiasMul: this.versusBand.playerWordTier5Bias,
          fieldCharCounts,
          activeMax5Families,
        },
      );
      trayWordsSoFar.push(w.char);
      this.bumpWordCharCount(w.char);
      if (forcePair || orphansBefore.some((o) => partnerChars(o).includes(w.char))) partnerForced = true;
      return { kind: 'word' as const, char: w.char, general: w.general, tier: 1 };
    };
    const draws: TrayToken[] = base.map((tok) => {
      if (tok.kind === 'unit' && !firstSummon && this.rng.next() < TUNING.wordDrawChance + this.mods.wordRateBonus + this.versusBand.playerWordDrawBonus) {
        const useForce = forcePartner && !partnerForced;
        return drawOneWord(useForce);
      }
      return tok;
    });
    if (forceWord && !draws.some((t) => t.kind === 'word')) {
      const idx = draws.findIndex((t) => t.kind === 'unit');
      if (idx >= 0) draws[idx] = drawOneWord(forcePartner);
    } else if (forcePartner && !partnerForced) {
      const idx = draws.findIndex((t) => t.kind === 'unit');
      if (idx >= 0) draws[idx] = drawOneWord(true);
    }
    this.tray = draws;
    if (draws.some((t) => t.kind === 'word')) this.summonsSinceWord = 0;
    else if (!firstSummon) this.summonsSinceWord += 1; // 首次征兵不计入保底 streak
    // 半对保底：有孤儿时，本盘若抽出了可补缺字则清零，否则累加
    if (firstSummon || orphansBefore.length === 0) this.summonsSincePair = 0;
    else if (partnerForced || trayWordsSoFar.some((c) => orphansBefore.some((o) => partnerChars(o).includes(c)))) {
      this.summonsSincePair = 0;
    } else this.summonsSincePair += 1;
    this.message = '把兵拖到绿格；左右凑齐武将双字可激活（占两格）';
    return true;
  }

  // 某格是否有字牌
  private wordAt(c: number, r: number): PlacedWord | undefined {
    return this.words.get(cellKey(c, r));
  }

  /** 候选区首个空槽（0..traySize-1），满则 null */
  firstEmptyTraySlot(): number | null {
    for (let i = 0; i < TUNING.traySize; i++) {
      if (!this.tray[i]) return i;
    }
    return null;
  }

  private clearTraySlot(index: number): void {
    delete this.tray[index];
  }

  /** 棋盘单位/字牌/桃树拖回候选区空槽（已激活武将不可收回） */
  recallToTray(from: Cell, slot: number): boolean {
    if (slot < 0 || slot >= TUNING.traySize) return false;
    if (this.tray[slot]) {
      this.message = '该候选槽已有令牌';
      return false;
    }
    if (this.activeGenerals().some((g) => g.cells.some((c) => c.c === from.c && c.r === from.r))) {
      this.message = '已激活武将不能收回候选区';
      return false;
    }
    const k = cellKey(from.c, from.r);
    const tree = this.trees.get(k);
    if (tree) {
      this.trees.delete(k);
      this.tray[slot] = { kind: 'tree', level: tree.level, growT: tree.growT };
      this.message = '桃树已收回候选区（暂停产桃）';
      return true;
    }
    const w = this.words.get(k);
    if (w) {
      this.words.delete(k);
      this.tray[slot] = { kind: 'word', char: w.char, general: w.general, tier: w.tier };
      this.message = `字牌「${w.char}」已收回候选区`;
      return true;
    }
    const u = this.units.get(k);
    if (u) {
      this.units.delete(k);
      this.tray[slot] = { kind: 'unit', type: u.type, tier: u.tier };
      this.message = `${UNITS[u.type].name} 已收回候选区`;
      this.emit('place');
      return true;
    }
    return false;
  }

  private aiWordAt(c: number, r: number): PlacedWord | undefined {
    return this.aiWords.get(cellKey(c, r));
  }

  // 该格是否空闲（无兵、无字牌、且无延迟落子预占）
  private cellFree(c: number, r: number): boolean {
    return !this.units.has(cellKey(c, r)) && !this.words.has(cellKey(c, r)) && !this.pendingPlace.some((p) => p.c === c && p.r === r);
  }

  /** 自动布阵腾位：未激活字/普通武器顶回候选（候选未满）；已激活武将格失败 */
  private displaceToTray(cell: Cell): boolean {
    if (this.activeGenerals().some((g) => g.cells.some((c) => c.c === cell.c && c.r === cell.r))) return false;
    const k = cellKey(cell.c, cell.r);
    const w = this.words.get(k);
    if (w) {
      const slot = this.firstEmptyTraySlot();
      if (slot === null) return false;
      this.words.delete(k);
      this.tray[slot] = { kind: 'word', char: w.char, general: w.general, tier: w.tier, displaced: true };
      return true;
    }
    const u = this.units.get(k);
    if (u) {
      const slot = this.firstEmptyTraySlot();
      if (slot === null) return false;
      this.units.delete(k);
      this.tray[slot] = { kind: 'unit', type: u.type, tier: u.tier, displaced: true };
      return true;
    }
    return true;
  }

  private aiDisplaceToTray(cell: Cell): boolean {
    if (this.aiActiveGenerals().some((g) => g.cells.some((c) => c.c === cell.c && c.r === cell.r))) return false;
    const k = cellKey(cell.c, cell.r);
    const w = this.aiWords.get(k);
    if (w) {
      if (this.aiTray.length >= TUNING.traySize) return false;
      this.aiWords.delete(k);
      this.aiTray.push({ kind: 'word', char: w.char, general: w.general, tier: w.tier, displaced: true });
      return true;
    }
    const ui = this.aiUnits.findIndex((x) => x.cell.c === cell.c && x.cell.r === cell.r);
    if (ui >= 0) {
      if (this.aiTray.length >= TUNING.traySize) return false;
      const u = this.aiUnits[ui]!;
      this.aiUnits.splice(ui, 1);
      this.aiTray.push({ kind: 'unit', type: u.type, tier: u.tier, displaced: true });
      return true;
    }
    return true;
  }

  private swapUnitWord(unitCell: Cell, wordCell: Cell): boolean {
    if (this.activeGenerals().some((g) => g.cells.some((c) => c.c === wordCell.c && c.r === wordCell.r))) return false;
    const uk = cellKey(unitCell.c, unitCell.r);
    const wk = cellKey(wordCell.c, wordCell.r);
    const u = this.units.get(uk);
    const w = this.words.get(wk);
    if (!u || !w) return false;
    this.units.delete(uk);
    this.words.delete(wk);
    u.cell = { c: wordCell.c, r: wordCell.r };
    w.cell = { c: unitCell.c, r: unitCell.r };
    u.fireDir = faceDirToward(u.cell, this.unitFaceGate());
    this.units.set(wk, u);
    this.words.set(uk, w);
    return true;
  }

  private aiSwapUnitWord(unitCell: Cell, wordCell: Cell): boolean {
    if (this.aiActiveGenerals().some((g) => g.cells.some((c) => c.c === wordCell.c && c.r === wordCell.r))) return false;
    const u = this.aiUnits.find((x) => x.cell.c === unitCell.c && x.cell.r === unitCell.r);
    const wk = cellKey(wordCell.c, wordCell.r);
    const w = this.aiWords.get(wk);
    if (!u || !w) return false;
    this.aiWords.delete(wk);
    u.cell = { c: wordCell.c, r: wordCell.r };
    w.cell = { c: unitCell.c, r: unitCell.r };
    u.fireDir = faceDirToward(u.cell, this.unitFaceGate(true));
    this.aiWords.set(cellKey(unitCell.c, unitCell.r), w);
    return true;
  }

  /** AI 棋盘两字互换（对齐 dragWord 异字/同字异阶交换） */
  private aiSwapWords(from: Cell, to: Cell): boolean {
    const kFrom = cellKey(from.c, from.r);
    const kTo = cellKey(to.c, to.r);
    const w = this.aiWords.get(kFrom);
    const tw = this.aiWords.get(kTo);
    if (!w || !tw) return false;
    if (tw.char === w.char && tw.tier === w.tier) return false;
    this.aiWords.set(kFrom, { ...tw, cell: { c: from.c, r: from.r } });
    this.aiWords.set(kTo, { ...w, cell: { c: to.c, r: to.r } });
    return true;
  }

  // 计入道具修正后的当前征兵成本
  effectiveSummonCost(): number {
    return Math.max(1, this.summonCost + this.mods.summonCostDelta);
  }

  effectiveAiSummonCost(): number {
    return Math.max(1, this.aiSummonCost + this.aiMods.summonCostDelta);
  }

  /** 测试钩子：将字牌保底计数设为阈值，便于单测触发 forceWord */
  forceWordPityForTest(): void { this.summonsSinceWord = TUNING.wordPityAfter; }
  /** 测试钩子：将铲子保底计数设为阈值，便于单测触发 forceShovel */
  forceShovelPityForTest(): void { this.summonsSinceShovel = TUNING.shovelPityAfter; }
  /** 测试钩子：将半对保底计数设为阈值 */
  forcePairPityForTest(): void { this.summonsSincePair = TUNING.pairPityAfter; }

  /** 当前孤儿字（棋盘未激活 + tray） */
  orphanCharsNow(): string[] {
    const actives = this.activeGenerals();
    const activeKeys = new Set<string>();
    for (const g of actives) {
      for (const c of g.cells) activeKeys.add(cellKey(c.c, c.r));
    }
    const board = [...this.words.entries()].map(([k, w]) => ({ char: w.char, cellKey: k }));
    const trayChars = trayTokens(this.tray)
      .filter((t): t is Extract<TrayToken, { kind: 'word' }> => t.kind === 'word')
      .map((t) => t.char);
    return collectOrphanChars(board, trayChars, activeKeys);
  }

  /** 仅棋盘未激活孤儿（征兵抽字用：旧 tray 即将整盘替换） */
  private boardOrphanCharsNow(): string[] {
    const actives = this.activeGenerals();
    const activeKeys = new Set<string>();
    for (const g of actives) {
      for (const c of g.cells) activeKeys.add(cellKey(c.c, c.r));
    }
    const board = [...this.words.entries()].map(([k, w]) => ({ char: w.char, cellKey: k }));
    return collectOrphanChars(board, [], activeKeys);
  }

  /** 棋盘已有全部字（含已激活），抽字去重用 */
  private boardWordCharsNow(): string[] {
    return [...this.words.values()].map((w) => w.char);
  }

  /** 场上各字实例数（仅棋盘，不含 tray） */
  private boardFieldCharCounts(): Map<string, number> {
    return countChars(this.boardWordCharsNow());
  }

  /** 已激活满5 武将的门派集合 */
  private activeMax5FamiliesNow(): Set<string> {
    const families = new Set<string>();
    for (const g of this.activeGenerals()) {
      if (g.def.maxTier === 5) families.add(g.def.family);
    }
    return families;
  }

  private aiBoardFieldCharCounts(): Map<string, number> {
    return countChars([...this.aiWords.values()].map((w) => w.char));
  }

  private aiActiveMax5FamiliesNow(): Set<string> {
    const families = new Set<string>();
    for (const g of this.aiActiveGenerals()) {
      if (g.def.maxTier === 5) families.add(g.def.family);
    }
    return families;
  }

  /** 抽字用：历次抽字计数 + 当前棋盘各字实例数 */
  private wordDrawCounts(): Map<string, number> {
    const m = new Map(this.wordCharCounts);
    for (const w of this.words.values()) {
      m.set(w.char, (m.get(w.char) ?? 0) + 1);
    }
    return m;
  }

  private bumpWordCharCount(char: string): void {
    this.wordCharCounts.set(char, (this.wordCharCounts.get(char) ?? 0) + 1);
  }

  private aiWordDrawCounts(): Map<string, number> {
    const m = new Map(this.aiWordCharCounts);
    for (const w of this.aiWords.values()) {
      m.set(w.char, (m.get(w.char) ?? 0) + 1);
    }
    return m;
  }

  private bumpAiWordCharCount(char: string): void {
    this.aiWordCharCounts.set(char, (this.aiWordCharCounts.get(char) ?? 0) + 1);
  }

  // 候选区内：兵种同型同级升阶；字牌禁止互相合并；字/兵/铲异类可交换槽位。
  mergeTrayTokens(from: number, to: number): boolean {
    if (from === to) return false;
    const a = this.tray[from];
    const b = this.tray[to];
    if (!a || !b) return false;
    if (a.kind === 'word' && b.kind === 'word') {
      this.message = '单字不可合并，需凑对激活后升阶';
      return false;
    }
    if (a.kind === 'unit' && b.kind === 'unit') {
      if (a.type !== b.type || a.tier !== b.tier || b.tier >= MAX_TIER) {
        this.message = '候选区只有同型同级可合并';
        return false;
      }
      this.tray[to] = { kind: 'unit', type: b.type, tier: b.tier + 1 };
      this.clearTraySlot(from);
      this.message = `候选区合成 ${UNITS[b.type].name} ${b.tier + 1} 阶`;
      this.emit('merge');
      return true;
    }
    if (a.kind === 'tree' && b.kind === 'tree') {
      if (a.level === b.level && b.level < PEACH_TREE_MAX_LEVEL) {
        this.tray[to] = { kind: 'tree', level: b.level + 1, growT: 0 };
        this.clearTraySlot(from);
        this.message = `候选区桃树升为 ${b.level + 1} 级`;
        this.emit('merge');
        return true;
      }
    }
    // 字牌 ↔ 兵种/铲子：交换候选槽（与棋盘字↔兵交换一致）
    this.tray[from] = b;
    this.tray[to] = a;
    this.message = '候选区交换位置';
    return true;
  }

  // 激活对稳定 key（左右格无序），用于独立经验/CD
  private static heroPairKey(a: Cell, b: Cell): string {
    const k1 = cellKey(a.c, a.r);
    const k2 = cellKey(b.c, b.r);
    return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
  }

  private stateOfPair(cells: [Cell, Cell]): GeneralState {
    const key = Battle.heroPairKey(cells[0], cells[1]);
    let s = this.generalStates.get(key);
    if (!s) {
      s = { level: 1, exp: 0, cooldown: 0, skillCd: 0, firePulse: 0, skillFlash: 0 };
      this.generalStates.set(key, s);
    }
    return s;
  }

  private pruneHeroStates(activePairKeys: Set<string>, store: Map<string, GeneralState>): void {
    for (const k of [...store.keys()]) {
      if (!activePairKeys.has(k)) store.delete(k);
    }
  }

  // 扫描棋盘：左右紧邻且 chars 序对匹配某武将 → 激活（按字匹配，支持门派共享字）
  activeGenerals(): ActiveGeneral[] {
    const out: ActiveGeneral[] = [];
    const used = new Set<string>();
    const activePairKeys = new Set<string>();
    for (const w of this.words.values()) {
      const kL = cellKey(w.cell.c, w.cell.r);
      if (used.has(kL)) continue;
      const right = this.words.get(cellKey(w.cell.c + 1, w.cell.r));
      if (!right) continue;
      const kR = cellKey(right.cell.c, right.cell.r);
      if (used.has(kR)) continue;
      // 左→右按武将名连读匹配（如「二郎」成立，「郎二」不激活）；不要求 general 字段一致
      const def = matchGeneral(w.char, right.char);
      if (!def) continue;
      used.add(kL);
      used.add(kR);
      // 继承对齐：只升不降，受该武将 maxTier 封顶
      const cap = def.maxTier;
      const target = Math.min(Math.max(w.tier, right.tier), cap);
      if (w.tier < target) w.tier = target;
      if (right.tier < target) right.tier = target;
      w.general = def.id;
      right.general = def.id;
      const cells: [Cell, Cell] = [w.cell, right.cell];
      const pairKey = Battle.heroPairKey(cells[0], cells[1]);
      activePairKeys.add(pairKey);
      if (this.mods.generalTierDelta > 0 && !this.tierBoosted.has(pairKey)) {
        this.tierBoosted.add(pairKey);
        for (let i = 0; i < this.mods.generalTierDelta; i++) {
          if (w.tier < cap) w.tier += 1;
          if (right.tier < cap) right.tier += 1;
        }
      }
      out.push({
        def,
        tier: Math.min(w.tier, right.tier, cap),
        cells,
        state: this.stateOfPair(cells),
      });
    }
    this.pruneHeroStates(activePairKeys, this.generalStates);
    for (const k of [...this.tierBoosted]) {
      if (!activePairKeys.has(k)) this.tierBoosted.delete(k);
    }
    return out;
  }

  // AI 已解锁/未解锁格（镜像玩家口径；aiCells 已按贴路近→远）
  aiUnlockedCells(): Cell[] { return this.aiCells.filter((c) => this.aiUnlocked.has(cellKey(c.c, c.r))); }
  aiLockedCells(): Cell[] { return this.aiCells.filter((c) => !this.aiUnlocked.has(cellKey(c.c, c.r))); }
  // AI 格是否可落新棋子（无兵、无字牌、且无延迟落子预占）
  private aiCellFree(c: number, r: number): boolean {
    return !this.aiUnits.some((u) => u.cell.c === c && u.cell.r === r) && !this.aiWords.has(cellKey(c, r)) && !this.aiPendingPlace.some((p) => p.c === c && p.r === r);
  }

  // AI 侧武将激活扫描（镜像 activeGenerals：matchGeneral 配对 + 继承对齐，读 aiWords/aiGeneralStates）。
  aiActiveGenerals(): ActiveGeneral[] {
    const out: ActiveGeneral[] = [];
    const used = new Set<string>();
    const activePairKeys = new Set<string>();
    for (const w of this.aiWords.values()) {
      const kL = cellKey(w.cell.c, w.cell.r);
      if (used.has(kL)) continue;
      const right = this.aiWords.get(cellKey(w.cell.c + 1, w.cell.r));
      if (!right) continue;
      const kR = cellKey(right.cell.c, right.cell.r);
      if (used.has(kR)) continue;
      const def = matchGeneral(w.char, right.char); // 按字连读匹配，支持门派共享字
      if (!def) continue;
      used.add(kL); used.add(kR);
      const cap = def.maxTier;
      const target = Math.min(Math.max(w.tier, right.tier), cap); // 继承对齐：只升不降、受 maxTier 封顶
      if (w.tier < target) w.tier = target;
      if (right.tier < target) right.tier = target;
      w.general = def.id;
      right.general = def.id;
      const cells: [Cell, Cell] = [w.cell, right.cell];
      const pairKey = Battle.heroPairKey(cells[0], cells[1]);
      activePairKeys.add(pairKey);
      if (this.aiMods.generalTierDelta > 0 && !this.aiTierBoosted.has(pairKey)) {
        this.aiTierBoosted.add(pairKey);
        for (let i = 0; i < this.aiMods.generalTierDelta; i++) {
          if (w.tier < cap) w.tier += 1;
          if (right.tier < cap) right.tier += 1;
        }
      }
      out.push({
        def,
        tier: Math.min(w.tier, right.tier, cap),
        cells,
        state: this.stateOfPairForAi(cells),
      });
    }
    this.pruneHeroStates(activePairKeys, this.aiGeneralStates);
    for (const k of [...this.aiTierBoosted]) {
      if (!activePairKeys.has(k)) this.aiTierBoosted.delete(k);
    }
    return out;
  }

  private stateOfPairForAi(cells: [Cell, Cell]): GeneralState {
    const key = Battle.heroPairKey(cells[0], cells[1]);
    let s = this.aiGeneralStates.get(key);
    if (!s) {
      s = { level: 1, exp: 0, cooldown: 0, skillCd: 0, firePulse: 0, fireDir: undefined, skillFlash: 0 };
      this.aiGeneralStates.set(key, s);
    }
    return s;
  }

  private aiBoardOrphanCharsNow(): string[] {
    const activeKeys = new Set<string>();
    for (const g of this.aiActiveGenerals()) for (const c of g.cells) activeKeys.add(cellKey(c.c, c.r));
    const board = [...this.aiWords.entries()].map(([k, w]) => ({ char: w.char, cellKey: k }));
    return collectOrphanChars(board, [], activeKeys);
  }

  private aiBoardWordCharsNow(): string[] {
    return [...this.aiWords.values()].map((w) => w.char);
  }

  // AI 落子入口（planAutoPlace 会调用的子集：shovel / unit(place|merge) / word(place|merge)）
  aiPlaceFromTray(index: number, to: Cell): boolean {
    const token = this.aiTray[index];
    if (!token) return false;
    const k = cellKey(to.c, to.r);
    if (token.kind === 'shovel') {
      if (this.aiUnlocked.has(k)) return false;
      if (!this.aiCells.some((c) => c.c === to.c && c.r === to.r)) return false; // 只挖 AI 可摆放格
      this.aiUnlocked.add(k);
      this.aiDigFx.push({ c: to.c, r: to.r, t: 0 }); // 开格动画（对称展示；延迟落子据此判定）
      if (this.aiMods.shovelPeach > 0) this.aiPeach += this.aiMods.shovelPeach;
      this.aiTray.splice(index, 1);
      return true;
    }
    if (!this.aiUnlocked.has(k)) return false;
    if (token.kind === 'word') {
      const exist = this.aiWords.get(k);
      if (exist) {
        // 与玩家一致：同字同阶不可合并；同字异阶或异字 → 交换
        if (exist.char === token.char && exist.tier === token.tier) return false;
        this.aiWords.set(k, { char: token.char, general: token.general, tier: token.tier, cell: { c: to.c, r: to.r } });
        this.aiTray[index] = { kind: 'word', char: exist.char, general: exist.general, tier: exist.tier };
        return true;
      }
      if (!this.aiCellFree(to.c, to.r)) return false;
      this.aiWords.set(k, { char: token.char, general: token.general, tier: token.tier, cell: { c: to.c, r: to.r } });
      this.aiTray.splice(index, 1);
      return true;
    }
    // unit
    const ex = this.aiUnits.find((u) => u.cell.c === to.c && u.cell.r === to.r);
    if (ex) {
      if (canMerge({ type: ex.type, tier: ex.tier }, { type: token.type, tier: token.tier })) {
        const m = mergeUnits({ type: ex.type, tier: ex.tier }, { type: token.type, tier: token.tier });
        ex.type = m.type; ex.tier = m.tier; ex.cooldown = 0;
        this.aiTray.splice(index, 1);
        return true;
      }
      return false;
    }
    if (!this.aiCellFree(to.c, to.r)) return false;
    this.aiUnits.push(makePlacedUnit(token.type, token.tier, { c: to.c, r: to.r }, this.unitFaceGate(true)));
    this.aiTray.splice(index, 1);
    return true;
  }

  // AI 侧格到 AI 怪路的最近距离（格）——直接量 aiPath，避免镜像换算
  private aiNearestPathDist(cell: { c: number; r: number }): number {
    const k = cellKey(cell.c, cell.r);
    const cached = this.aiNearestPathDistByCell.get(k);
    if (cached !== undefined) return cached;
    const d = Battle.nearestPathDistOn(this.aiPath, cell);
    this.aiNearestPathDistByCell.set(k, d);
    return d;
  }

  private aiExitDist(cell: { c: number; r: number }): number {
    const k = cellKey(cell.c, cell.r);
    const cached = this.aiExitDistByCell.get(k);
    if (cached !== undefined) return cached;
    const d = exitDistToPath(this.aiPath, cell);
    this.aiExitDistByCell.set(k, d);
    return d;
  }

  // AI 征兵：与玩家同生成策略（drawSummonTray + 字牌转化），用 aiRng，够桃才征
  private aiSummon(): boolean {
    if (this.aiPeach < this.effectiveAiSummonCost()) return false;
    this.aiPeach -= this.effectiveAiSummonCost();
    this.aiSummonCost += TUNING.summonCostStep;
    const types = Object.keys(UNITS) as UnitType[];
    const firstSummon = this.aiSummonCount === 0;
    const allOpen = this.aiLockedCells().length === 0;
    const forceShovel = !allOpen && this.aiSummonsSinceShovel >= TUNING.shovelPityAfter;
    const base = drawSummonTray({
      rng: this.aiRng, unitTypes: types, draws: TUNING.traySize,
      shovelChance: allOpen ? 0 : TUNING.shovelDrawChance,
      maxPerKey: allOpen ? TUNING.summonMaxPerKeyAllOpen : TUNING.summonMaxPerKey,
      firstSummon, forceShovel,
    });
    this.aiSummonCount += 1;
    if (base.some((t) => t.kind === 'shovel')) this.aiSummonsSinceShovel = 0; else this.aiSummonsSinceShovel += 1;
    // 字牌抽取：镜像玩家 summon 的字牌保底 + 半对保底 + 孤儿配对（无玩家 mods.wordRateBonus）
    const forceWord = !firstSummon && this.aiSummonsSinceWord >= TUNING.wordPityAfter;
    const orphansBefore = this.aiBoardOrphanCharsNow();
    const ownedBoard = this.aiBoardWordCharsNow();
    const fieldCharCounts = this.aiBoardFieldCharCounts();
    const activeMax5Families = this.aiActiveMax5FamiliesNow();
    const forcePartner = !firstSummon && orphansBefore.length > 0 && this.aiSummonsSincePair >= TUNING.pairPityAfter;
    const trayWordsSoFar: string[] = [];
    let partnerForced = false;
    const drawOneWord = (forcePair: boolean) => {
      const w = pickWordChar(
        this.aiRng,
        Math.max(1, this.wave),
        orphansBefore,
        trayWordsSoFar,
        forcePair,
        ownedBoard,
        this.aiWordDrawCounts(),
        {
          tier5BiasMul: this.versusBand.aiWordTier5Bias,
          fieldCharCounts,
          activeMax5Families,
        },
      );
      trayWordsSoFar.push(w.char);
      this.bumpAiWordCharCount(w.char);
      if (forcePair || orphansBefore.some((o) => partnerChars(o).includes(w.char))) partnerForced = true;
      return { kind: 'word' as const, char: w.char, general: w.general, tier: 1 };
    };
    const draws: TrayToken[] = base.map((tok) => {
      if (tok.kind === 'unit' && !firstSummon && this.aiRng.next() < TUNING.wordDrawChance + this.aiMods.wordRateBonus + this.versusBand.aiWordDrawBonus) {
        return drawOneWord(forcePartner && !partnerForced);
      }
      return tok;
    });
    if (forceWord && !draws.some((t) => t.kind === 'word')) {
      const idx = draws.findIndex((t) => t.kind === 'unit');
      if (idx >= 0) draws[idx] = drawOneWord(forcePartner);
    } else if (forcePartner && !partnerForced) {
      const idx = draws.findIndex((t) => t.kind === 'unit');
      if (idx >= 0) draws[idx] = drawOneWord(true);
    }
    this.aiTray = draws;
    if (draws.some((t) => t.kind === 'word')) this.aiSummonsSinceWord = 0;
    else if (!firstSummon) this.aiSummonsSinceWord += 1;
    if (firstSummon || orphansBefore.length === 0) this.aiSummonsSincePair = 0;
    else if (partnerForced || trayWordsSoFar.some((c) => orphansBefore.some((o) => partnerChars(o).includes(c)))) this.aiSummonsSincePair = 0;
    else this.aiSummonsSincePair += 1;
    return true;
  }

  // AI 击杀产桃（基础值，无 mods.killBonus/摸金/蟠桃园）
  private creditAiKill(isBoss: boolean, isElite: boolean, isMiniBoss = false): void {
    const base = isBoss
      ? PEACH_PER_BOSS
      : isMiniBoss
        ? PEACH_PER_MINI_BOSS
        : isElite
          ? PEACH_PER_ELITE
          : PEACH_PER_KILL;
    this.aiPeach += base + this.aiMods.killBonus;
  }

  // AI 布阵视图（喂给共享 planAutoPlace）
  // AI 自动布阵专用落子：镜像玩家 autoPlaceApply——刚挖开、开格动画未完的空格延迟落子（预占）。
  private aiAutoPlaceApply(index: number, cell: Cell): boolean {
    const token = this.aiTray[index];
    if (!token) return false;
    const animating = this.aiDigFx.some((d) => d.c === cell.c && d.r === cell.r);
    if (token.kind !== 'shovel' && animating && this.aiUnlocked.has(cellKey(cell.c, cell.r)) && this.aiCellFree(cell.c, cell.r)) {
      this.aiPendingPlace.push({ token, c: cell.c, r: cell.r });
      this.aiTray.splice(index, 1);
      return true;
    }
    return this.aiPlaceFromTray(index, cell);
  }

  private buildAiAutoView(): AutoPlaceView {
    return {
      wave: () => this.wave,
      tray: () => this.aiTray,
      freeCells: () => this.aiUnlockedCells().filter((c) => this.aiCellFree(c.c, c.r)),
      diggableCells: () => this.aiLockedCells(),
      placedUnits: () => this.aiUnits.map((u) => ({ type: u.type, tier: u.tier, cell: u.cell })),
      placedWords: () => [...this.aiWords.values()].map((w) => ({ char: w.char, general: w.general, cell: w.cell, tier: w.tier })),
      nearestPathDist: (cell) => this.aiNearestPathDist(cell),
      pathTouchSides: (cell) => this.pathTouchSidesOf(this.aiPath, cell),
      exitDist: (cell) => this.aiExitDist(cell),
      tangsengDist: (cell) => Math.hypot(cell.c - this.aiTangseng.c, cell.r - this.aiTangseng.r),
      pathCover: (cell, type, tier) => {
        const rge = getUnitStat(type, tier).rge;
        return this.aiPathCoverAt(cell.c, cell.r, rge);
      },
      pathCoverAt: (ax, ay, rge) => this.aiPathCoverAt(ax, ay, rge),
      pathCoverEarlyAt: (ax, ay, rge) =>
        pathCoverageLenEntranceWeightedAlong(this.aiPath, this.aiEntranceDist, this.aiPathLen, ax, ay, rge),
      pathFirstEngageAt: (ax, ay, rge) =>
        pathFirstEngageDistAlong(this.aiPath, this.aiEntranceDist, this.aiPathLen, ax, ay, rge),
      generalRge: (general, tier) => {
        const def = generalById(general);
        return def ? generalStat(def, tier).rge : 2;
      },
      wordChars: (general) => generalById(general)?.chars,
      place: (i, cell) => this.aiAutoPlaceApply(i, cell),
      moveUnit: (from, to) => {
        const u = this.aiUnits.find((x) => x.cell.c === from.c && x.cell.r === from.r);
        if (!u) return false;
        if (!this.aiUnlocked.has(cellKey(to.c, to.r)) || !this.aiCellFree(to.c, to.r)) return false;
        u.cell = { c: to.c, r: to.r };
        u.fireDir = faceDirToward(u.cell, this.unitFaceGate(true));
        return true;
      },
      swapUnits: (a, b) => {
        const ua = this.aiUnits.find((x) => x.cell.c === a.c && x.cell.r === a.r);
        const ub = this.aiUnits.find((x) => x.cell.c === b.c && x.cell.r === b.r);
        if (!ua || !ub) return false;
        ua.cell = { c: b.c, r: b.r };
        ub.cell = { c: a.c, r: a.r };
        ua.fireDir = faceDirToward(ua.cell, this.unitFaceGate(true));
        ub.fireDir = faceDirToward(ub.cell, this.unitFaceGate(true));
        return true;
      },
      swapUnitWord: (unitCell, wordCell) => this.aiSwapUnitWord(unitCell, wordCell),
      swapWords: (from, to) => this.aiSwapWords(from, to),
      moveWord: (from, to) => {
        const kFrom = cellKey(from.c, from.r);
        const kTo = cellKey(to.c, to.r);
        const w = this.aiWords.get(kFrom);
        if (!w) return false;
        if (!this.aiUnlocked.has(kTo) || !this.aiCellFree(to.c, to.r)) return false;
        this.aiWords.delete(kFrom);
        w.cell = { c: to.c, r: to.r };
        this.aiWords.set(kTo, w);
        return true;
      },
      displaceToTray: (cell) => this.aiDisplaceToTray(cell),
      isActiveHeroCell: (cell) =>
        this.aiActiveGenerals().some((g) => g.cells.some((c) => c.c === cell.c && c.r === cell.r)),
      dangerNear: () => this.aiDangerNear(),
      imminentPathScore: (cell) =>
        this.imminentPathScoreAt(this.aiMonsters, this.aiPath, this.aiPathLen, this.aiEntranceDist, cell),
      unitEngageScore: (cell, type, tier) =>
        this.aiMonsters.length > 0
          ? this.engageScoreAt(this.aiMonsters, this.aiPath, this.aiEntranceDist, cell, type, tier, this.aiDangerNear())
          : 0,
      mergeTray: (from, to) => this.aiMergeTrayTokens(from, to),
      mergeBoard: (from, to) => this.aiMergeBoardUnits(from, to),
    };
  }

  /** 该格兵种对指定怪群的路径威胁分（范围内怪 atk×残血加权之和）；无怪时假设出怪口有怪 */
  private engageScoreAt(
    monsters: Monster[],
    path: Cell[],
    entranceDist: number,
    cell: Cell,
    type: UnitType,
    tier: number,
    dangerNear: boolean,
  ): number {
    const stat = getUnitStat(type, tier);
    const lite = monsters.map((m) => ({ dist: m.dist, hp: m.hp, maxHp: m.maxHp }));
    return engageThreatAt(
      lite,
      path,
      entranceDist,
      cell.c,
      cell.r,
      stat.rge,
      stat.atk,
      dangerNear,
      type,
    );
  }

  /** 对妖怪扣血并触发受击反馈（闪白 + 可选伤害飘字） */
  private hurtMonster(m: Monster, dmg: number, pos: { c: number; r: number }, hitFlash = 0.12, crit = false): void {
    m.hp -= dmg;
    m.hitFlash = hitFlash;
    this.spawnDamageFloat(pos.c, pos.r, dmg, crit);
  }

  private spawnDamageFloat(c: number, r: number, amount: number, crit = false): void {
    if (!getSettings().showDamageNumbers || amount <= 0) return;
    const gravity = crit ? DAMAGE_FLOAT_GRAVITY_CRIT : DAMAGE_FLOAT_GRAVITY;
    const rise = crit ? DAMAGE_FLOAT_RISE_CRIT : DAMAGE_FLOAT_RISE;
    const vxBase = crit ? DAMAGE_FLOAT_VX_CRIT : DAMAGE_FLOAT_VX;
    const side = this.rng.next() < 0.5 ? -1 : 1;
    const vx = side * (vxBase + this.rng.next() * vxBase * 0.45);
    this.damageFloats.push({
      c,
      r,
      amount,
      x: 0,
      vx,
      y: DAMAGE_FLOAT_HEAD_Y,
      vy: peachFloatInitialVy(gravity, rise),
      peakY: DAMAGE_FLOAT_HEAD_Y,
      age: 0,
      crit,
    });
  }

  /** 攻击目标优先级：始终优先打攻击范围内沿路走过格子最多（dist 最大，即离唐僧最近）的怪，不因险情改变 */
  private sortCombatTargets<T extends { m: Monster }>(inRange: T[]): T[] {
    return inRange.sort((a, b) => b.m.dist - a.m.dist);
  }

  private heroEngageScoreAt(
    monsters: Monster[],
    path: Cell[],
    entranceDist: number,
    left: Cell,
    right: Cell,
    general: string,
    tier: number,
    dangerNear: boolean,
    ai = false,
  ): number {
    const def = generalById(general);
    if (!def) return 0;
    const ax = (left.c + right.c) / 2;
    const ay = (left.r + right.r) / 2;
    const stat = generalStat(def, tier);
    const wb = ai ? this.aiWeaponBonuses[general] : this.weaponBonuses[general];
    const atk = stat.atk * (1 + (wb?.atk ?? 0));
    const rge = stat.rge + (wb?.rge ?? 0);
    const lite = monsters.map((m) => ({ dist: m.dist, hp: m.hp, maxHp: m.maxHp }));
    return engageThreatAt(lite, path, entranceDist, ax, ay, rge, atk, dangerNear);
  }

  private dangerEngageAtPlayer(ax: number, ay: number, rge: number, atk: number): number {
    if (!this.dangerNear()) return 0;
    const lite = this.monsters.map((m) => ({ dist: m.dist, hp: m.hp, maxHp: m.maxHp }));
    return engageThreatAt(lite, this.map.path, this.entranceDist, ax, ay, rge, atk, true);
  }

  private repositionHeroPair(fromLeft: Cell, fromRight: Cell, toLeft: Cell, toRight: Cell, ai = false): boolean {
    if (toLeft.c + 1 !== toRight.c || toLeft.r !== toRight.r) return false;
    if (fromLeft.c === toLeft.c && fromLeft.r === toLeft.r && fromRight.c === toRight.c && fromRight.r === toRight.r) {
      return false;
    }
    const cellFree = ai
      ? (c: Cell) => this.aiCellFree(c.c, c.r)
      : (c: Cell) => this.cellFree(c.c, c.r);
    const isUnlocked = ai
      ? (c: number, r: number) => this.aiUnlocked.has(cellKey(c, r))
      : (c: number, r: number) => this.isUnlocked(c, r);
    const canOccupy = (to: Cell, fromA: Cell, fromB: Cell) => {
      if ((to.c === fromA.c && to.r === fromA.r) || (to.c === fromB.c && to.r === fromB.r)) return true;
      return isUnlocked(to.c, to.r) && cellFree(to);
    };
    if (!canOccupy(toLeft, fromLeft, fromRight) || !canOccupy(toRight, fromLeft, fromRight)) return false;
    const moveWord = ai
      ? (from: Cell, to: Cell) => {
          const kFrom = cellKey(from.c, from.r);
          const kTo = cellKey(to.c, to.r);
          const w = this.aiWords.get(kFrom);
          if (!w) return false;
          if (!this.aiUnlocked.has(kTo) || !this.aiCellFree(to.c, to.r)) return false;
          this.aiWords.delete(kFrom);
          w.cell = { c: to.c, r: to.r };
          this.aiWords.set(kTo, w);
          return true;
        }
      : (from: Cell, to: Cell) => {
          const kFrom = cellKey(from.c, from.r);
          const kTo = cellKey(to.c, to.r);
          const w = this.words.get(kFrom);
          if (!w) return false;
          if (!this.isUnlocked(to.c, to.r) || !this.cellFree(to.c, to.r)) return false;
          this.words.delete(kFrom);
          w.cell = { c: to.c, r: to.r };
          this.words.set(kTo, w);
          return true;
        };
    const order =
      (toLeft.c === fromRight.c && toLeft.r === fromRight.r) || (toRight.c === fromLeft.c && toRight.r === fromLeft.r)
        ? [[fromRight, toRight], [fromLeft, toLeft]] as const
        : [[fromLeft, toLeft], [fromRight, toRight]] as const;
    for (const [from, to] of order) {
      if (from.c === to.c && from.r === to.r) continue;
      if (!moveWord(from, to)) return false;
    }
    return true;
  }

  private findAdjacentFreePair(ai: boolean): { left: Cell; right: Cell } | null {
    const cells = ai
      ? this.aiUnlockedCells().filter((c) => this.aiCellFree(c.c, c.r))
      : this.unlockedCells().filter((c) => this.cellFree(c.c, c.r));
    const set = new Set(cells.map((c) => cellKey(c)));
    for (const left of cells) {
      const right: Cell = { c: left.c + 1, r: left.r };
      if (set.has(cellKey(right))) return { left, right };
    }
    return null;
  }

  /** 两对已激活武将互换座位（经临时空位三连移） */
  private swapHeroPairs(
    aLeft: Cell,
    aRight: Cell,
    bLeft: Cell,
    bRight: Cell,
    ai = false,
  ): boolean {
    if (
      aLeft.c === bLeft.c && aLeft.r === bLeft.r && aRight.c === bRight.c && aRight.r === bRight.r
    ) return false;
    const temp = this.findAdjacentFreePair(ai);
    if (!temp) return false;
    if (!this.repositionHeroPair(bLeft, bRight, temp.left, temp.right, ai)) return false;
    if (!this.repositionHeroPair(aLeft, aRight, bLeft, bRight, ai)) return false;
    return this.repositionHeroPair(temp.left, temp.right, aLeft, aRight, ai);
  }

  /** 格对「怪物即将路过」路段的贴近分（挖铲/危险布阵用） */
  private imminentPathScoreAt(
    monsters: Monster[],
    path: Cell[],
    pathLen: number,
    entranceDist: number,
    cell: Cell,
  ): number {
    return imminentPathScore(
      path,
      pathLen,
      entranceDist,
      monsters.map((m) => m.dist),
      cell,
    );
  }

  private buildBattleRepositionView(side: 'player' | 'ai'): BattleRepositionView {
    if (side === 'ai') {
      return {
        placedUnits: () => this.aiUnits.map((u) => ({ type: u.type, tier: u.tier, cell: u.cell })),
        freeCells: () => this.aiUnlockedCells().filter((c) => this.aiCellFree(c.c, c.r)),
        moveUnit: (from, to) => {
          const u = this.aiUnits.find((x) => x.cell.c === from.c && x.cell.r === from.r);
          if (!u) return false;
          if (!this.aiUnlocked.has(cellKey(to.c, to.r)) || !this.aiCellFree(to.c, to.r)) return false;
          u.cell = { c: to.c, r: to.r };
          u.fireDir = faceDirToward(u.cell, this.unitFaceGate(true));
          return true;
        },
      swapUnits: (a, b) => {
        const ua = this.aiUnits.find((x) => x.cell.c === a.c && x.cell.r === a.r);
        const ub = this.aiUnits.find((x) => x.cell.c === b.c && x.cell.r === b.r);
        if (!ua || !ub) return false;
        ua.cell = { c: b.c, r: b.r };
        ub.cell = { c: a.c, r: a.r };
        ua.fireDir = faceDirToward(ua.cell, this.unitFaceGate(true));
        ub.fireDir = faceDirToward(ub.cell, this.unitFaceGate(true));
        return true;
      },
      swapUnitWord: (unitCell, wordCell) => this.aiSwapUnitWord(unitCell, wordCell),
      orphanWords: () =>
        [...this.aiWords.values()]
          .filter((w) => !this.aiActiveGenerals().some((g) => g.cells.some((c) => c.c === w.cell.c && c.r === w.cell.r)))
          .map((w) => ({ char: w.char, general: w.general, cell: w.cell, tier: w.tier })),
      isActiveHeroCell: (cell) =>
        this.aiActiveGenerals().some((g) => g.cells.some((c) => c.c === cell.c && c.r === cell.r)),
      canEngage: (cell, type, tier) =>
        this.engageScoreAt(this.aiMonsters, this.aiPath, this.aiEntranceDist, cell, type, tier, this.aiDangerNear()) > 0,
      engageScore: (cell, type, tier) =>
        this.engageScoreAt(this.aiMonsters, this.aiPath, this.aiEntranceDist, cell, type, tier, this.aiDangerNear()),
      seatScore: (cell, type, tier) => {
        const rge = getUnitStat(type, tier).rge;
        return placeCellScore(
          this.aiPathCoverAt(cell.c, cell.r, rge),
          this.aiExitDist(cell),
          rge,
          this.aiNearestPathDist(cell),
        );
      },
      dangerNear: () => this.aiDangerNear(),
      exitDist: (cell) => this.aiExitDist(cell),
      tangsengDist: (cell) => Math.hypot(cell.c - this.aiTangseng.c, cell.r - this.aiTangseng.r),
      imminentPathScore: (cell) =>
        this.imminentPathScoreAt(this.aiMonsters, this.aiPath, this.aiPathLen, this.aiEntranceDist, cell),
      activeHeroPairs: () =>
        this.aiActiveGenerals().map((g) => ({
          left: g.cells[0]!,
          right: g.cells[1]!,
          general: g.def.id,
          tier: g.tier,
          maxTier: g.def.maxTier,
        })),
      heroEngageScore: (left, right, general, tier) =>
        this.heroEngageScoreAt(this.aiMonsters, this.aiPath, this.aiEntranceDist, left, right, general, tier, this.aiDangerNear(), true),
      moveHeroPair: (fromLeft, fromRight, toLeft, toRight) =>
        this.repositionHeroPair(fromLeft, fromRight, toLeft, toRight, true),
      swapHeroPairs: (aLeft, aRight, bLeft, bRight) =>
        this.swapHeroPairs(aLeft, aRight, bLeft, bRight, true),
      monstersPresent: () => this.aiMonsters.length > 0,
      };
    }
    return {
      placedUnits: () => [...this.units.values()].map((u) => ({ type: u.type, tier: u.tier, cell: u.cell })),
      orphanWords: () =>
        [...this.words.values()]
          .filter((w) => !this.activeGenerals().some((g) => g.cells.some((c) => c.c === w.cell.c && c.r === w.cell.r)))
          .map((w) => ({ char: w.char, general: w.general, cell: w.cell, tier: w.tier })),
      freeCells: () => this.unlockedCells().filter((c) => this.cellFree(c.c, c.r)),
      moveUnit: (from, to) => {
        const u = this.units.get(cellKey(from.c, from.r));
        if (!u) return false;
        if (!this.isUnlocked(to.c, to.r) || !this.cellFree(to.c, to.r)) return false;
        this.units.delete(cellKey(from.c, from.r));
        u.cell = { c: to.c, r: to.r };
        u.fireDir = faceDirToward(u.cell, this.unitFaceGate());
        this.units.set(cellKey(to.c, to.r), u);
        return true;
      },
      swapUnits: (a, b) => {
        const ka = cellKey(a.c, a.r);
        const kb = cellKey(b.c, b.r);
        const ua = this.units.get(ka);
        const ub = this.units.get(kb);
        if (!ua || !ub) return false;
        this.units.delete(ka);
        this.units.delete(kb);
        ua.cell = { c: b.c, r: b.r };
        ub.cell = { c: a.c, r: a.r };
        ua.fireDir = faceDirToward(ua.cell, this.unitFaceGate());
        ub.fireDir = faceDirToward(ub.cell, this.unitFaceGate());
        this.units.set(kb, ua);
        this.units.set(ka, ub);
        return true;
      },
      swapUnitWord: (unitCell, wordCell) => this.swapUnitWord(unitCell, wordCell),
      isActiveHeroCell: (cell) =>
        this.activeGenerals().some((g) => g.cells.some((c) => c.c === cell.c && c.r === cell.r)),
      canEngage: (cell, type, tier) =>
        this.engageScoreAt(this.monsters, this.map.path, this.entranceDist, cell, type, tier, this.dangerNear()) > 0,
      engageScore: (cell, type, tier) =>
        this.engageScoreAt(this.monsters, this.map.path, this.entranceDist, cell, type, tier, this.dangerNear()),
      seatScore: (cell, type, tier) => {
        const rge = getUnitStat(type, tier).rge;
        return placeCellScore(
          pathCoverageLen(this.map, this.entranceDist, this.pathLen, cell.c, cell.r, rge),
          this.playerExitDist(cell),
          rge,
          this.nearestPathDist(cell),
        );
      },
      dangerNear: () => this.dangerNear(),
      exitDist: (cell) => this.playerExitDist(cell),
      tangsengDist: (cell) => Math.hypot(cell.c - this.map.tangseng.c, cell.r - this.map.tangseng.r),
      imminentPathScore: (cell) =>
        this.imminentPathScoreAt(this.monsters, this.map.path, this.pathLen, this.entranceDist, cell),
      activeHeroPairs: () =>
        this.activeGenerals().map((g) => ({
          left: g.cells[0]!,
          right: g.cells[1]!,
          general: g.def.id,
          tier: g.tier,
        })),
      heroEngageScore: (left, right, general, tier) =>
        this.heroEngageScoreAt(this.monsters, this.map.path, this.entranceDist, left, right, general, tier, this.dangerNear()),
      moveHeroPair: (fromLeft, fromRight, toLeft, toRight) =>
        this.repositionHeroPair(fromLeft, fromRight, toLeft, toRight),
    };
  }

  /** 依当前怪群动态调整武器位；AI 侧 maxSteps=1（随机节流），玩家一键布阵可连续多步 */
  private tickBattleReposition(side: 'player' | 'ai', maxSteps = 1): number {
    if (side === 'ai') {
      if (this.aiActiveGenerals().length === 0 && this.aiUnits.length === 0) return 0;
      const r = planBattleReposition(this.buildBattleRepositionView('ai'), {
        blockedPair: this.aiLastRepositionPair ?? undefined,
        heroLeveling: true,
      });
      this.aiLastRepositionPair = r.ok && r.pair ? r.pair : this.aiLastRepositionPair;
      return r.ok ? 1 : 0;
    }
    if (this.units.size === 0) {
      return 0;
    }
    return runBattleReposition(this.buildBattleRepositionView('player'), maxSteps);
  }

  /** AI 战中调整：有待补英雄配对字时单步布阵，否则兵器调位；下次间隔按类型随机 */
  private tickAiBattleAdjust(pSubOptimal: number): void {
    const view = this.buildAiAutoView();
    if (aiHeroPartnerAdjustPending(view)) {
      planAutoPlaceSteps(view, {
        rng: () => this.aiRng.next(),
        pSubOptimal,
        randomDigExitWeight: true,
        maxSteps: 1,
      });
    } else {
      this.tickBattleReposition('ai', 1);
    }
    this.aiRepositionTimer = rollAiAdjustInterval(
      aiHeroPartnerAdjustPending(view),
      () => this.aiRng.next(),
      this.aiAdjustIntervalScale,
    );
  }

  private aiPathCoverAt(ax: number, ay: number, rge: number): number {
    const step = 0.25;
    let covered = 0;
    for (let d = this.aiEntranceDist; d < this.aiPathLen; d += step) {
      const p = posAlong(this.aiPath, d);
      if (inAttackRange(ax, ay, rge, p)) covered += step;
    }
    return covered;
  }

  /** 格与路径正交相邻的边数（上下左右四向） */
  private pathTouchSidesOf(path: { c: number; r: number }[], cell: { c: number; r: number }): number {
    const keys = new Set<string>();
    for (const p of path) {
      if (p.c < 0 || p.c >= COLS || p.r < 0 || p.r >= ROWS) continue;
      keys.add(cellKey(p.c, p.r));
    }
    let n = 0;
    if (keys.has(cellKey(cell.c + 1, cell.r))) n++;
    if (keys.has(cellKey(cell.c - 1, cell.r))) n++;
    if (keys.has(cellKey(cell.c, cell.r + 1))) n++;
    if (keys.has(cellKey(cell.c, cell.r - 1))) n++;
    return n;
  }

  /** 格到路径出怪口距离（沿程下标差；见 exitDistToPath） */
  private distToPathEntrance(path: { c: number; r: number }[], cell: { c: number; r: number }): number {
    return exitDistToPath(path, cell);
  }

  /** 出怪口格（兵器落位默认朝向） */
  private unitFaceGate(ai = false): Cell {
    return pathEntranceCell(ai ? this.aiPath : this.map.path);
  }

  /** AI 候选区同型同阶合成（镜像 mergeTrayTokens） */
  private aiMergeTrayTokens(from: number, to: number): boolean {
    if (from === to) return false;
    const a = this.aiTray[from];
    const b = this.aiTray[to];
    if (!a || !b || a.kind !== 'unit' || b.kind !== 'unit') return false;
    if (!canMerge({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier })) return false;
    this.aiTray[to] = { kind: 'unit', type: b.type, tier: b.tier + 1 };
    this.aiTray.splice(from, 1);
    return true;
  }

  /** AI 棋盘同型同阶合成：from 并入 to */
  private aiMergeBoardUnits(from: Cell, to: Cell): boolean {
    const ai = this.aiUnits.findIndex((u) => u.cell.c === from.c && u.cell.r === from.r);
    const bi = this.aiUnits.findIndex((u) => u.cell.c === to.c && u.cell.r === to.r);
    if (ai < 0 || bi < 0 || ai === bi) return false;
    const a = this.aiUnits[ai]!;
    const b = this.aiUnits[bi]!;
    if (!canMerge({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier })) return false;
    const merged = mergeUnits({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier });
    b.type = merged.type;
    b.tier = merged.tier;
    b.cooldown = 0;
    this.aiUnits.splice(ai, 1);
    return true;
  }

  // 从候选区把第 index 个令牌落到目标格：
  // - 铲子 → 锁定的可摆放格 → 开挖解锁
  // - 兵种 → 空绿格放置；同型同级则合并升阶；非同型则替换（旧单位被换下）
  placeFromTray(index: number, to: Cell): boolean {
    const token = this.tray[index];
    if (!token) return false;
    if (token.kind === 'shovel') {
      if (this.isUnlocked(to.c, to.r) || !this.isPlaceable(to.c, to.r)) {
        this.message = '铲子只能挖开锁定的绿格';
        return false;
      }
      if (this.trees.has(cellKey(to.c, to.r))) {
        this.message = '该格有桃树，不能开垦';
        return false;
      }
      this.unlocked.add(cellKey(to.c, to.r));
      this.digFx.push({ c: to.c, r: to.r, t: 0 }); // 挖坑动画
      this.clearTraySlot(index);
      this.peach += this.mods.shovelPeach; // 摸金校尉
      this.emit('shovel');
      this.message = this.mods.shovelPeach > 0 ? `挖开新阵位（摸金 +${this.mods.shovelPeach}桃）` : '铲子挖开了新阵位';
      return true;
    }
    if (token.kind === 'tree') {
      if (this.isUnlocked(to.c, to.r) || !this.isPlaceable(to.c, to.r)) {
        this.message = '桃树只能种在未开垦的空地';
        return false;
      }
      const k = cellKey(to.c, to.r);
      const exist = this.trees.get(k);
      if (exist) {
        if (exist.level === token.level && exist.level < PEACH_TREE_MAX_LEVEL) {
          exist.level += 1;
          exist.growT = 0;
          this.clearTraySlot(index);
          this.bursts.push({ kind: 'merge', c: to.c, r: to.r, ttl: 0.35, maxTtl: 0.35, big: false, color: '#7ec46a' });
          this.message = `桃树升为 ${exist.level} 级`;
          this.emit('merge');
          return true;
        }
        this.trees.set(k, { level: token.level, cell: { c: to.c, r: to.r }, growT: token.growT });
        this.tray[index] = { kind: 'tree', level: exist.level, growT: exist.growT };
        this.message = '桃树交换位置';
        return true;
      }
      this.trees.set(k, { level: token.level, cell: { c: to.c, r: to.r }, growT: token.growT });
      this.clearTraySlot(index);
      this.message = '桃树已种回（恢复产桃）';
      return true;
    }
    if (!this.isUnlocked(to.c, to.r)) {
      this.message = '只能放到已解锁的绿格';
      return false;
    }
    // 字牌：占一格；禁止同字合并。与可匹配另一字左右紧邻即激活武将。
    if (token.kind === 'word') {
      // 喂 1 张同将字符、同阶字牌给「已激活武将」→ 整对一起升阶（受 maxTier）
      const g = this.activeGenerals().find((gg) => gg.cells.some((cc) => cc.c === to.c && cc.r === to.r));
      if (g && g.def.chars.includes(token.char)) {
        const wa = this.wordAt(g.cells[0].c, g.cells[0].r);
        const wb = this.wordAt(g.cells[1].c, g.cells[1].r);
        const cap = g.def.maxTier;
        if (wa && wb && wa.tier === wb.tier && token.tier === wa.tier && wa.tier < cap) {
          wa.tier += 1;
          wb.tier += 1;
          this.clearTraySlot(index);
          this.bursts.push({ kind: 'merge', c: g.cells[0].c, r: g.cells[0].r, ttl: 0.35, maxTtl: 0.35, big: false, color: qualityColor(wa.tier) });
          this.bursts.push({ kind: 'merge', c: g.cells[1].c, r: g.cells[1].r, ttl: 0.35, maxTtl: 0.35, big: false, color: qualityColor(wb.tier) });
          this.message = `${g.def.name} 升为 ${wa.tier} 阶`;
          this.emit('merge');
          return true;
        }
      }
      const exist = this.wordAt(to.c, to.r);
      if (exist) {
        // 同字同阶不可合并；同字异阶或异字 → 与该格字牌交换（便于高阶上板 / 回收低阶）
        if (exist.char === token.char && exist.tier === token.tier) {
          this.message = '单字不可合并，需凑对激活后升阶';
          return false;
        }
        this.words.set(cellKey(to.c, to.r), { char: token.char, general: token.general, tier: token.tier, cell: { c: to.c, r: to.r } });
        this.tray[index] = { kind: 'word', char: exist.char, general: exist.general, tier: exist.tier };
        this.message = exist.char === token.char
          ? `「${token.char}」${token.tier} 阶与棋盘 ${exist.tier} 阶交换`
          : `与字牌「${exist.char}」交换`;
        return true;
      }
      // 该格有兵 → 字牌与兵交换（字牌落格，兵回候选槽），与「不同型兵交换」一致
      const uexist = this.units.get(cellKey(to.c, to.r));
      if (uexist) {
        this.units.delete(cellKey(to.c, to.r));
        this.words.set(cellKey(to.c, to.r), { char: token.char, general: token.general, tier: token.tier, cell: { c: to.c, r: to.r } });
        this.tray[index] = { kind: 'unit', type: uexist.type, tier: uexist.tier };
        this.message = `与 ${UNITS[uexist.type].name} 交换`;
        return true;
      }
      this.words.set(cellKey(to.c, to.r), { char: token.char, general: token.general, tier: token.tier, cell: { c: to.c, r: to.r } });
      this.clearTraySlot(index);
      const activated = this.activeGenerals().find((ag) => ag.cells.some((cc) => cc.c === to.c && cc.r === to.r));
      this.emit(activated ? 'general' : 'place');
      if (activated) {
        this.message = this.generalActivateMessage(activated.def.name, activated.def.id);
      } else {
        const mates = partnerChars(token.char).join('/');
        this.message = `放下「${token.char}」，与「${mates}」按武将名左右相邻可激活`;
      }
      return true;
    }
    if (token.kind !== 'unit') return false;
    // 该格被字牌占用 → 兵与字牌交换（兵落格，字牌回候选槽），与「字牌落到兵格」对称
    const wexist = this.words.get(cellKey(to.c, to.r));
    if (wexist) {
      this.words.delete(cellKey(to.c, to.r));
      this.units.set(cellKey(to.c, to.r), makePlacedUnit(token.type, token.tier, { c: to.c, r: to.r }, this.unitFaceGate()));
      this.tray[index] = { kind: 'word', char: wexist.char, general: wexist.general, tier: wexist.tier };
      this.message = `与字牌「${wexist.char}」交换`;
      return true;
    }
    const exist = this.units.get(cellKey(to.c, to.r));
    if (exist) {
      if (canMerge({ type: exist.type, tier: exist.tier }, { type: token.type, tier: token.tier })) {
        const merged = mergeUnits({ type: exist.type, tier: exist.tier }, { type: token.type, tier: token.tier });
        this.units.set(cellKey(to.c, to.r), { ...exist, type: merged.type, tier: merged.tier, cooldown: 0 });
        this.bursts.push({ kind: 'merge', c: to.c, r: to.r, ttl: 0.35, maxTtl: 0.35, big: false, color: '#ffd76a' });
        this.clearTraySlot(index);
        this.message = `合成 ${UNITS[merged.type].name} ${merged.tier} 阶`;
        this.emit('merge');
        return true;
      }
      // 不可合并 → 交换：候选区令牌落格，原格单位回到候选区该槽（绝不删除）
      this.units.set(cellKey(to.c, to.r), makePlacedUnit(token.type, token.tier, { c: to.c, r: to.r }, this.unitFaceGate()));
      this.tray[index] = { kind: 'unit', type: exist.type, tier: exist.tier };
      this.message = `与 ${UNITS[exist.type].name} 交换`;
      return true;
    }
    this.units.set(cellKey(to.c, to.r), makePlacedUnit(token.type, token.tier, { c: to.c, r: to.r }, this.unitFaceGate()));
    this.clearTraySlot(index);
    this.message = `布置了 ${UNITS[token.type].name}`;
    this.emit('place');
    return true;
  }

  // 直接用铲子（不经候选区，供 UI 便捷开挖最靠前锁定格）
  useShovelOn(to: Cell): boolean {
    if (this.shovels <= 0) return false;
    if (this.isUnlocked(to.c, to.r) || !this.isPlaceable(to.c, to.r)) return false;
    if (this.trees.has(cellKey(to.c, to.r))) { this.message = '该格有桃树，不能开垦'; return false; }
    this.shovels -= 1;
    this.unlocked.add(cellKey(to.c, to.r));
    this.digFx.push({ c: to.c, r: to.r, t: 0 }); // 挖坑动画
    this.peach += this.mods.shovelPeach; // 摸金校尉
    this.message = '铲子挖开了新阵位';
    return true;
  }

  // 棋盘内拖拽总入口：源格是桃树走 dragTree，字牌走 dragWord，否则走 dragUnit
  dragBoard(from: Cell, to: Cell): boolean {
    if (this.trees.has(cellKey(from.c, from.r))) return this.dragTree(from, to);
    if (this.words.has(cellKey(from.c, from.r))) return this.dragWord(from, to);
    return this.dragUnit(from, to);
  }

  // 拖拽字牌：移动到空格 / 同字同阶喂字升阶 / 同字异阶或异字与目标(字牌或兵)交换。
  // 拖走已激活武将的一个字即自动拆分（激活由相邻关系实时推导）。
  dragWord(from: Cell, to: Cell): boolean {
    const kFrom = cellKey(from.c, from.r);
    const w = this.words.get(kFrom);
    if (!w) return false;
    if (from.c === to.c && from.r === to.r) return false;
    if (!this.isUnlocked(to.c, to.r) || !this.isPlaceable(to.c, to.r)) {
      this.message = '只能放到已解锁的空位';
      return false;
    }
    const kTo = cellKey(to.c, to.r);
    const wasActive = this.activeGenerals().some((g) => g.cells.some((cc) => cc.c === from.c && cc.r === from.r));
    // 把一张同将字符、同阶的备用字牌拖到「已激活武将」→ 整对升阶（与从候选区喂字一致）
    const gTo = this.activeGenerals().find((gg) => gg.cells.some((cc) => cc.c === to.c && cc.r === to.r));
    if (gTo && gTo.def.chars.includes(w.char) && !gTo.cells.some((cc) => cc.c === from.c && cc.r === from.r)) {
      const wa = this.words.get(cellKey(gTo.cells[0].c, gTo.cells[0].r));
      const wb = this.words.get(cellKey(gTo.cells[1].c, gTo.cells[1].r));
      const cap = gTo.def.maxTier;
      if (wa && wb && wa.tier === wb.tier && w.tier === wa.tier && wa.tier < cap) {
        wa.tier += 1;
        wb.tier += 1;
        this.words.delete(kFrom); // 消耗被拖入的字牌
        this.bursts.push({ kind: 'merge', c: gTo.cells[0].c, r: gTo.cells[0].r, ttl: 0.35, maxTtl: 0.35, big: false, color: qualityColor(wa.tier) });
        this.bursts.push({ kind: 'merge', c: gTo.cells[1].c, r: gTo.cells[1].r, ttl: 0.35, maxTtl: 0.35, big: false, color: qualityColor(wb.tier) });
        this.message = `${gTo.def.name} 升为 ${wa.tier} 阶`;
        this.emit('merge');
        return true;
      }
    }
    const tw = this.words.get(kTo);
    const tu = this.units.get(kTo);
    let tierSwapMsg: string | undefined;
    if (tw) {
      if (tw.char === w.char && tw.tier === w.tier) {
        this.message = '单字不可合并，需凑对激活后升阶';
        return false;
      }
      // 同字异阶或异字 → 互换位置（与 placeFromTray 一致）
      this.words.set(kFrom, { ...tw, cell: { c: from.c, r: from.r } });
      this.words.set(kTo, { ...w, cell: { c: to.c, r: to.r } });
      if (tw.char === w.char) {
        tierSwapMsg = `「${w.char}」${w.tier} 阶与棋盘 ${tw.tier} 阶交换`;
      }
    } else if (tu) {
      // 字牌与兵互换位置
      this.units.delete(kTo);
      this.units.set(kFrom, { ...tu, cell: { c: from.c, r: from.r }, cooldown: 0 });
      this.words.delete(kFrom);
      this.words.set(kTo, { ...w, cell: { c: to.c, r: to.r } });
    } else {
      // 移到空格
      this.words.delete(kFrom);
      this.words.set(kTo, { ...w, cell: { c: to.c, r: to.r } });
    }
    // 反馈：是否因移动而激活/拆分
    const nowActive = this.activeGenerals().some((g) => g.cells.some((cc) => cc.c === to.c && cc.r === to.r));
    const def = generalById(w.general);
    if (nowActive) {
      this.emit('general');
      this.message = this.generalActivateMessage(def?.name ?? '', def?.id ?? '');
    } else if (wasActive) {
      let msg = `${def?.name ?? ''} 已拆分，失去输出`;
      if (def?.id === BOND_GENERAL) msg += ` · ${BOND_NAME}已失效`;
      this.message = msg;
    } else if (tierSwapMsg) {
      this.message = tierSwapMsg;
    }
    return true;
  }

  // 拖拽：把 from 格的单位移动到 to 格。同型同级则合成；空的已解锁格则移动。
  dragUnit(from: Cell, to: Cell): boolean {
    const a = this.units.get(cellKey(from.c, from.r));
    if (!a) return false;
    if (from.c === to.c && from.r === to.r) return false;
    if (!this.isUnlocked(to.c, to.r)) return false;

    // 目标是字牌 → 兵与字牌互换位置
    const tw = this.words.get(cellKey(to.c, to.r));
    if (tw) {
      this.words.delete(cellKey(to.c, to.r));
      this.words.set(cellKey(from.c, from.r), { ...tw, cell: { c: from.c, r: from.r } });
      this.units.delete(cellKey(from.c, from.r));
      this.units.set(cellKey(to.c, to.r), {
        ...a,
        cell: { c: to.c, r: to.r },
        cooldown: 0,
        fireDir: faceDirToward(to, this.unitFaceGate()),
      });
      this.message = '兵与字牌交换位置';
      return true;
    }

    const b = this.units.get(cellKey(to.c, to.r));
    if (b) {
      if (canMerge({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier })) {
        const merged = mergeUnits({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier });
        this.units.set(cellKey(to.c, to.r), { ...b, type: merged.type, tier: merged.tier, cooldown: 0 });
        this.units.delete(cellKey(from.c, from.r));
        this.bursts.push({ kind: 'merge', c: to.c, r: to.r, ttl: 0.35, maxTtl: 0.35, big: false, color: '#ffd76a' });
        this.message = `合成 ${UNITS[merged.type].name} ${merged.tier} 阶`;
        this.emit('merge');
        return true;
      }
      // 非同型同级 → 两格交换位置
      this.units.set(cellKey(from.c, from.r), {
        ...b,
        cell: { c: from.c, r: from.r },
        cooldown: 0,
        fireDir: faceDirToward(from, this.unitFaceGate()),
      });
      this.units.set(cellKey(to.c, to.r), {
        ...a,
        cell: { c: to.c, r: to.r },
        cooldown: 0,
        fireDir: faceDirToward(to, this.unitFaceGate()),
      });
      this.message = '交换了两个单位位置';
      return true;
    }
    // 移动到空格
    this.units.delete(cellKey(from.c, from.r));
    a.cell = { c: to.c, r: to.r };
    a.fireDir = faceDirToward(a.cell, this.unitFaceGate());
    this.units.set(cellKey(to.c, to.r), a);
    return true;
  }

  // 开始下一波
  startNextWave(): boolean {
    if (this.waveActive) return false;
    if (this.status === 'won' || this.status === 'lost') return false;
    this.introDone = true; // 手动开波则跳过入场
    this.introT = Battle.INTRO_DUR;
    this.wave += 1;
    this.status = 'playing';
    this.waveActive = true;
    this.healUsedThisWave = false;
    // 按当前地图 + 战场武器最优重排 DPS，规划本波数量/Boss 血（压力比随波次升高）
    this.wavePressure = this.computeWavePressure(this.wave);
    this.spawnRemaining = this.wavePressure.count;
    this.waveMonsterCount = this.spawnRemaining;
    const bossWave = this.isBossWave(this.wave);
    // 后期(第 6 波起)随机某波成为骑兵波；占比在 [35%+min(20%,波/100), min(70%,起始+20%)] 内随机
    this.cavalryWave =
      this.wave >= TUNING.cavalryFromWave && this.rng.next() < TUNING.cavalryWaveChance;
    this.cavalryWaveRatio = this.cavalryWave ? rollCavalryWaveRatio(this.wave, () => this.rng.next()) : 0;
    // 第 4 波之后、非妖王波：有概率刷出 1 只跨地图小 Boss（顶替本波 1 只普通怪出场）
    this.waveMiniBoss = null;
    this.miniBossSpawnIdx = -1;
    if (
      this.wave >= TUNING.miniBossFromWave &&
      !bossWave &&
      this.spawnRemaining >= 3 &&
      this.rng.next() < TUNING.miniBossChance
    ) {
      this.waveMiniBoss = MINI_BOSS_KINDS[this.rng.int(MINI_BOSS_KINDS.length)]!;
      // 二次核算压力账本：小 Boss 比普通怪多出的血量需占预算，否则怪量不变、
      // 血量却更高，实际压力会悄悄超出规划比例（见 computeWavePressure）
      this.wavePressure = this.computeWavePressure(this.wave, true);
      this.spawnRemaining = this.wavePressure.count;
      this.waveMonsterCount = this.spawnRemaining;
      // 避开首尾：中间段出场，避免与开波/收波节奏抢戏
      const lo = 1;
      const hi = Math.max(lo, this.spawnRemaining - 2);
      this.miniBossSpawnIdx = lo + this.rng.int(hi - lo + 1);
    }
    this.spawnTimer = 0;
    this.heroBossSpawnsThisWave = 0;
    const heroCount = this.activeGenerals().length;
    this.heroBossTimer =
      heroCount >= TUNING.heroBossFromCount ? this.rollHeroBossInterval(heroCount) : -1;
    this.meteorPending = this.mods.meteor; // 本波陨石待触发（等首批怪出现）
    this.aiMeteorPending = this.aiMods.meteor;
    // 开波提示（波次号顶部 HUD 已显示，底部只报类型）：BOSS 优先，其次小 Boss/骑兵，否则普通
    if (bossWave) this.message = '⚠ 妖王携护卫来袭！';
    else if (this.waveMiniBoss) this.message = `⚠ ${MINI_BOSS_META[this.waveMiniBoss].name}来袭！`;
    else if (this.cavalryWave) this.message = '骑兵突袭！';
    else this.message = '妖怪来袭！';
    this.emit('wave');
    return true;
  }

  // 唐僧当前渲染位置（入场时沿路走向归位；归位后固定在终点格）
  tangsengRenderPos(): { c: number; r: number } {
    if (this.introDone || this.tangsengRenderOverride) return posAtDistance(this.map, this.pathLen);
    const p = Math.min(1, this.introT / Battle.INTRO_DUR);
    return posAtDistance(this.map, p * this.pathLen);
  }

  // 如来神掌：从最前怪沿路径逐格回推（动画结束后各怪 dist 减 cells）
  private startPalmPush(cells: number): void {
    if (this.monsters.length === 0) return;
    let frontStartDist = 0;
    for (const m of this.monsters) if (m.dist > frontStartDist) frontStartDist = m.dist;
    this.palmPushFx = {
      t: 0,
      dur: SKILL_FX_DUR,
      cells,
      frontStartDist,
      snapshots: this.monsters.map((m) => ({ id: m.id, startDist: m.dist })),
    };
  }

  private updatePalmPush(dt: number): void {
    const fx = this.palmPushFx;
    if (!fx) return;
    fx.t += dt;
    const p = Math.min(1, fx.t / fx.dur);
    const eased = 1 - (1 - p) ** 2;
    const pushed = fx.cells * eased;
    const snapById = new Map(fx.snapshots.map((s) => [s.id, s.startDist]));
    for (const m of this.monsters) {
      const start = snapById.get(m.id);
      if (start !== undefined) m.dist = Math.max(0, start - pushed);
    }
    if (p >= 1) {
      for (const m of this.monsters) {
        const start = snapById.get(m.id);
        if (start !== undefined) m.dist = Math.max(0, start - fx.cells);
      }
      this.palmPushFx = null;
    }
  }

  /** 回推波前位置（格），供渲染沿路径绘制掌印 */
  palmPushWaveDist(): number | null {
    const fx = this.palmPushFx;
    if (!fx) return null;
    const p = Math.min(1, fx.t / fx.dur);
    const eased = 1 - (1 - p) ** 2;
    return fx.frontStartDist - fx.cells * eased;
  }

  private setSkillFx(kind: SkillFxKind, cell: { c: number; r: number }, ai: boolean): void {
    const dur = kind === 'atkBuff' || kind === 'frqBuff' ? BUFF_SKILL_FX_DUR : SKILL_FX_DUR;
    const fx: SkillFx = { kind, t: 0, dur, c: cell.c, r: cell.r };
    if (ai) this.aiSkillFx = fx;
    else this.playerSkillFx = fx;
  }

  private frontMonsterCell(ai: boolean): { c: number; r: number } | null {
    const list = ai ? this.aiMonsters : this.monsters;
    if (list.length === 0) return null;
    let front = list[0]!;
    for (const m of list) if (m.dist > front.dist) front = m;
    const p = ai ? posAlong(this.aiPath, front.dist) : posAtDistance(this.map, front.dist);
    return { c: p.c, r: p.r };
  }

  private updateSkillFx(dt: number): void {
    if (this.playerSkillFx) {
      this.playerSkillFx.t += dt;
      if (this.playerSkillFx.t >= this.playerSkillFx.dur) this.playerSkillFx = null;
    }
    if (this.aiSkillFx) {
      this.aiSkillFx.t += dt;
      if (this.aiSkillFx.t >= this.aiSkillFx.dur) this.aiSkillFx = null;
    }
  }

  // 被动道具进度（供 HUD 点击查看）：返回 0..1 进度与说明文本；无进度类返回 null
  passiveProgress(id: string): { ratio: number; text: string } | null {
    if (id === 'luoyangchan') return { ratio: this.shovelTimer / 45, text: `产铲 ${this.shovelTimer.toFixed(0)}/45s` };
    return null;
  }

  private applyItem(id: string): void {
    switch (id) {
      case 'xiandan': this.mods.atkMul += 0.10; break;
      case 'fenghuolun': this.mods.frqMul += 0.10; break;
      case 'fabaofu': this.mods.generalTierDelta += 1; break;
      case 'zhaoxian': this.mods.wordRateBonus += 0.1; break;
      case 'mojin': this.mods.shovelPeach += 6; break;
      case 'luoyangchan': this.mods.autoShovel = true; break;
      case 'yunshi': this.mods.meteor = true; break;
      case 'yuni': this.mods.mud = true; break;
      case 'xianyuan': this.mods.summonCostDelta -= 1; break;
      case 'jubaopen': this.mods.killBonus += 1; break;
      case 'hushen': this.tangsengMaxHP += 1; this.tangsengHP += 1; break;
      // 非对称正向：我方收益优于 AI 对手
      case 'tongxin': this.tangsengMaxHP += 3; this.tangsengHP += 3; this.aiTangsengHP += 2; break;
      case 'zhuwang': this.mods.monsterSpdMul = Math.max(0.4, this.mods.monsterSpdMul - 0.10); break;
      case 'dinghai': { const lc = this.lockedCells(); if (lc[0]) this.unlocked.add(cellKey(lc[0].c, lc[0].r)); break; }
    }
  }

  /** AI 侧被动道具：镜像 applyItem，作用于 aiMods / 双方唐僧 */
  private applyAiItem(id: string): void {
    switch (id) {
      case 'xiandan': this.aiMods.atkMul += 0.10; break;
      case 'fenghuolun': this.aiMods.frqMul += 0.10; break;
      case 'fabaofu': this.aiMods.generalTierDelta += 1; break;
      case 'zhaoxian': this.aiMods.wordRateBonus += 0.1; break;
      case 'mojin': this.aiMods.shovelPeach += 6; break;
      case 'luoyangchan': this.aiMods.autoShovel = true; break;
      case 'yunshi': this.aiMods.meteor = true; break;
      case 'yuni': this.aiMods.mud = true; break;
      case 'xianyuan': this.aiMods.summonCostDelta -= 1; break;
      case 'jubaopen': this.aiMods.killBonus += 1; break;
      case 'hushen': this.aiTangsengHP += 1; break;
      case 'tongxin': this.aiTangsengHP += 3; this.tangsengMaxHP += 2; this.tangsengHP += 2; break;
      case 'zhuwang': this.aiMods.monsterSpdMul = Math.max(0.4, this.aiMods.monsterSpdMul - 0.10); break;
      case 'dinghai': {
        const lc = this.aiCells.find((c) => !this.aiUnlocked.has(cellKey(c.c, c.r)));
        if (lc) this.aiUnlocked.add(cellKey(lc.c, lc.r));
        break;
      }
    }
  }

  // 被动道具的持续效果：洛阳铲产铲
  private updateItemEffects(dt: number): void {
    if (this.mods.autoShovel) {
      this.shovelTimer += dt;
      if (this.shovelTimer >= 45) { this.shovelTimer = 0; this.shovels += 1; }
    }
    if (this.aiMods.autoShovel) {
      this.aiShovelTimer += dt;
      if (this.aiShovelTimer >= 45) { this.aiShovelTimer = 0; this.aiShovels += 1; }
    }
  }

  // 蟠桃园：每 40s 在未开垦空地自动种 1 棵 1 级桃树；满格则尝试往已有桃树合并升级。
  // 仅在 status 为 playing/ready（对局进行中）推进，由 updateFx 调用。
  private updatePeachTrees(dt: number): void {
    if (this.gardenOn) {
      this.plantTimer += dt;
      if (this.plantTimer >= PEACH_TREE_PLANT_INTERVAL) {
        if (this.plantTree()) {
          this.plantTimer = 0;
          this.plantBank = 0;
        } else if (this.tryAutoMergePlant()) {
          this.plantTimer = 0;
        } else {
          this.plantTimer = PEACH_TREE_PLANT_INTERVAL; // 全 5 级：封顶不再合并
        }
      }
    }
    for (const t of this.trees.values()) {
      t.growT += dt;
      const iv = PEACH_TREE_INTERVALS[Math.min(t.level, PEACH_TREE_MAX_LEVEL) - 1]!;
      if (t.growT >= iv) {
        t.growT -= iv;
        this.peach += 1;
        // 桃树旁「+1」飘字（复用击杀蟠桃飘字）
        this.peachFloats.push({ c: t.cell.c, r: t.cell.r, amount: 1, y: PEACH_FLOAT_HEAD_Y, vy: peachFloatInitialVy(), peakY: PEACH_FLOAT_HEAD_Y });
      }
    }
  }

  // 在一处「未开垦(未挖锁定)且无树」的可摆放格随机种下 1 级桃树；无候选返回 false。
  private plantTree(): boolean {
    const spots = this.lockedCells().filter((c) => !this.trees.has(cellKey(c.c, c.r)));
    if (spots.length === 0) return false;
    const spot = spots[this.rng.int(spots.length)]!;
    this.trees.set(cellKey(spot.c, spot.r), { level: 1, cell: { c: spot.c, r: spot.r }, growT: 0 });
    return true;
  }

  /** 满格时：虚拟新树合并进已有桃树；同级全满则按 2^(L-1) 棵累计后再升一级 */
  private tryAutoMergePlant(): boolean {
    const trees = [...this.trees.values()];
    if (trees.length === 0) return false;
    if (trees.every((t) => t.level >= PEACH_TREE_MAX_LEVEL)) return false;

    const minLevel = Math.min(...trees.map((t) => t.level));
    const allSame = trees.every((t) => t.level === minLevel);

    if (!allSame) {
      const target = trees.find((t) => t.level === minLevel);
      if (!target || target.level >= PEACH_TREE_MAX_LEVEL) return false;
      target.level += 1;
      target.growT = 0;
      this.burstTreeMerge(target.cell);
      this.message = `蟠桃园：桃树升为 ${target.level} 级`;
      return true;
    }

    const need = peachTreeMergeBankNeed(minLevel);
    this.plantBank += 1;
    if (this.plantBank < need) return true;

    const target = trees[this.rng.int(trees.length)]!;
    target.level = minLevel + 1;
    target.growT = 0;
    this.plantBank -= need;
    this.burstTreeMerge(target.cell);
    this.message = `蟠桃园：桃树升为 ${target.level} 级`;
    return true;
  }

  private burstTreeMerge(cell: Cell): void {
    this.bursts.push({ kind: 'merge', c: cell.c, r: cell.r, ttl: 0.35, maxTtl: 0.35, big: false, color: '#7ec46a' });
    this.emit('merge');
  }

  // 距下次产桃剩余秒数（供 UI 进度条），无树返回 null
  treeCountdown(t: PeachTree): number {
    const iv = PEACH_TREE_INTERVALS[Math.min(t.level, PEACH_TREE_MAX_LEVEL) - 1]!;
    return Math.max(0, iv - t.growT);
  }

  // 拖拽桃树：仅能在「未开垦空地」之间移动；落到同级桃树则合并升级(≤5)，落到不同级则交换位置。
  dragTree(from: Cell, to: Cell): boolean {
    const kFrom = cellKey(from.c, from.r);
    const t = this.trees.get(kFrom);
    if (!t) return false;
    if (from.c === to.c && from.r === to.r) return false;
    // 目标必须是未开垦的可摆放格（桃树不进兵阵位）
    if (!this.isPlaceable(to.c, to.r) || this.isUnlocked(to.c, to.r)) {
      this.message = '桃树只能种在未开垦的空地';
      return false;
    }
    const kTo = cellKey(to.c, to.r);
    const tt = this.trees.get(kTo);
    if (tt) {
      if (tt.level === t.level && tt.level < PEACH_TREE_MAX_LEVEL) {
        tt.level += 1;
        tt.growT = 0;
        this.trees.delete(kFrom);
        this.bursts.push({ kind: 'merge', c: to.c, r: to.r, ttl: 0.35, maxTtl: 0.35, big: false, color: '#7ec46a' });
        this.message = `桃树升为 ${tt.level} 级`;
        this.emit('merge');
        return true;
      }
      // 不同级 → 交换位置
      this.trees.set(kFrom, { ...tt, cell: { c: from.c, r: from.r } });
      this.trees.set(kTo, { ...t, cell: { c: to.c, r: to.r } });
      return true;
    }
    // 移到空的未开垦格
    this.trees.delete(kFrom);
    this.trees.set(kTo, { ...t, cell: { c: to.c, r: to.r } });
    return true;
  }

  // 陨石：每波开始时砸向最前妖怪（容错保险）。被动「陨石」道具触发，带 mods.meteor 守卫。
  private castMeteor(): void {
    if (!this.mods.meteor || this.monsters.length === 0) return;
    this.doMeteor(TUNING.meteorPassiveDmgMul);
  }

  private castAiMeteor(): void {
    if (!this.aiMods.meteor || this.aiMonsters.length === 0) return;
    this.doAiMeteor(TUNING.meteorPassiveDmgMul);
  }

  // 陨石伤害核心（无守卫）：被动道具与「天降陨石」主动技能共用；mul 为相对波血倍率
  private doMeteor(mul: number = TUNING.meteorDmgMul, skillFx = false): void {
    if (this.monsters.length === 0) return;
    let front = this.monsters[0]!;
    for (const m of this.monsters) if (m.dist > front.dist) front = m;
    const dmg = this.normalMonsterHp() * mul;
    const p = posAtDistance(this.map, front.dist);
    for (const m of this.monsters) {
      const q = posAtDistance(this.map, m.dist);
      if (Math.hypot(q.c - p.c, q.r - p.r) <= TUNING.meteorRadius) this.hurtMonster(m, dmg, q, 0.2);
    }
    if (skillFx) this.setSkillFx('meteor', p, false);
    else this.bursts.push({ kind: 'death', c: p.c, r: p.r, ttl: 0.5, maxTtl: 0.5, big: true, color: '#ff7a3c' });
  }

  private doAiMeteor(mul: number = TUNING.meteorDmgMul, skillFx = false): void {
    if (this.aiMonsters.length === 0) return;
    let front = this.aiMonsters[0]!;
    for (const m of this.aiMonsters) if (m.dist > front.dist) front = m;
    const dmg = (TUNING.monsterHpBase + TUNING.monsterHpStep * this.wave) * this.effectiveDifficulty() * mul;
    const p = posAlong(this.aiPath, front.dist);
    for (const m of this.aiMonsters) {
      const q = posAlong(this.aiPath, m.dist);
      if (Math.hypot(q.c - p.c, q.r - p.r) <= TUNING.meteorRadius) {
        m.hp -= dmg;
        m.hitFlash = 0.2;
        this.spawnDamageFloat(q.c, q.r, dmg);
      }
    }
    if (skillFx) this.setSkillFx('meteor', p, true);
    else this.bursts.push({ kind: 'death', c: p.c, r: p.r, ttl: 0.5, maxTtl: 0.5, big: true, color: '#ff7a3c' });
  }

  // 开局预排本局神兵碎片：是否可能掉落 + 掉哪一件（main 注入可见性后调用）
  planBattleFragmentDrop(): void {
    this.battleFragmentDropId = null;
    this.battleFragmentDropped = false;
    if (this.rng.next() >= BATTLE_FRAGMENT_ELIGIBLE_CHANCE) return;
    this.battleFragmentDropId = rollWeaponDrop(this.rng.next());
  }

  /** 武将攻击命中时 10% 触发预排碎片（整局最多 1 次；已集齐则不展示） */
  private tryRollFragmentOnHeroAttack(): void {
    const id = this.battleFragmentDropId;
    if (!id || this.battleFragmentDropped) return;
    if (!this.weaponPickupVisible(id)) return;
    if (this.rng.next() >= HERO_ATTACK_FRAGMENT_CHANCE) return;
    this.battleFragmentDropped = true;
    this.pendingWeaponPickups.push(id);
    const wname = weaponById(id)?.name ?? id;
    this.message = `掉落「${wname}」碎片（点击左下角领取）`;
  }

  // 有效怪物强度系数：对战/无尽均为境界系数 × 分圈阶梯。
  // 圈系数 = endlessCycleStep ^ floor((wave-1)/endlessWavesPerCycle)：波1-10 ×1，波11-20 ×STEP…
  effectiveDifficulty(wave: number = this.wave): number {
    const cycle = Math.floor((Math.max(1, wave) - 1) / TUNING.endlessWavesPerCycle);
    return this.difficultyMul * TUNING.endlessCycleStep ** cycle;
  }

  /** 波 >10：基础血量/移速算完后 × (1 + (wave-10)/100) */
  wavePostMul(wave: number = this.wave): number {
    if (wave <= 10) return 1;
    return 1 + (wave - 10) / 100;
  }

  /** 前期软血：波 1–5 ×0.8，波 6 ×0.9，波 7 ×0.95，其后满血 */
  earlyWaveHpMul(wave: number = this.wave): number {
    const w = Math.max(1, Math.floor(wave));
    if (w <= TUNING.earlyWaveHpTo) return TUNING.earlyWaveHpMul;
    if (w === 6) return TUNING.earlyWaveHpMul6;
    if (w === 7) return TUNING.earlyWaveHpMul7;
    return 1;
  }

  /** 确保妖王波排程覆盖到 wave（含）；按段懒生成，确定性可复现。 */
  private ensureBossSchedule(wave: number): void {
    const target = Math.max(1, wave);
    while (this.bossScheduleThrough < target) this.generateNextBossSegment();
  }

  /** 生成下一段妖王波：首段 5–10 出 1–2；其后每 10 波出 2–3。 */
  private generateNextBossSegment(): void {
    const rng = this.bossScheduleRng;
    if (this.bossScheduleThrough < TUNING.bossFirstSegHi) {
      const pool: number[] = [];
      for (let w = TUNING.bossFirstSegLo; w <= TUNING.bossFirstSegHi; w++) pool.push(w);
      const span = TUNING.bossFirstSegMax - TUNING.bossFirstSegMin + 1;
      const count = TUNING.bossFirstSegMin + rng.int(span);
      this.pickBossWavesFromPool(pool, count, rng);
      this.bossScheduleThrough = TUNING.bossFirstSegHi;
      return;
    }
    const start = this.bossScheduleThrough + 1;
    const end = this.bossScheduleThrough + TUNING.endlessWavesPerCycle;
    const pool: number[] = [];
    for (let w = start; w <= end; w++) pool.push(w);
    const span = TUNING.bossSegMax - TUNING.bossSegMin + 1;
    const count = TUNING.bossSegMin + rng.int(span);
    this.pickBossWavesFromPool(pool, count, rng);
    this.bossScheduleThrough = end;
  }

  private pickBossWavesFromPool(pool: number[], count: number, rng: RNG): void {
    const remaining = pool.slice();
    const n = Math.min(count, remaining.length);
    for (let i = 0; i < n; i++) {
      const idx = rng.int(remaining.length);
      this.bossWaves.add(remaining.splice(idx, 1)[0]!);
    }
  }

  // 某波是否为妖王波（查分段预排表）
  isBossWave(wave: number): boolean {
    this.ensureBossSchedule(wave);
    return this.bossWaves.has(wave);
  }

  // 本波出怪总数基准：经济基准(9+n，同时决定掉落) + 后期堆量。
  // 只在 battle 层叠加，不改 game-core 的 monstersInWave，保持"第5波蟠桃转负"的经济不变量与测试。
  // 第 PRESSURE_FROM_WAVE 波起还会按最优输出抬升（见 computeWavePressure），本函数结果作为最低保底。
  private baselineWaveSpawnCount(wave: number): number {
    const base = monstersInWave(wave); // 9 + n
    const extra =
      wave >= TUNING.lateWaveFrom
        ? (wave - (TUNING.lateWaveFrom - 1)) * TUNING.lateWaveExtraPerWave
        : 0;
    // 前期减量：波1=7, 波2=9（降低上手压力，不影响经济曲线）
    const early =
      wave <= TUNING.earlyWaveTo
        ? (TUNING.earlyWaveTo - wave + 1) * TUNING.earlyWaveReduce
        : 0;
    const bonus = wave === 1 ? TUNING.wave1Bonus : 0;
    return Math.max(TUNING.minWaveMonsters, base + extra - early + bonus);
  }

  /** 普通怪基础血量（含境界/分圈系数、前3波减量与波>10 加成，不含 Boss/精英倍乘） */
  private normalMonsterHp(wave: number = this.wave): number {
    const base = (TUNING.monsterHpBase + TUNING.monsterHpStep * wave) * this.effectiveDifficulty(wave);
    return base * this.earlyWaveHpMul(wave) * this.wavePostMul(wave);
  }

  /** 某波普通怪基础移速（含难度加速与波>10 加成，不含被动减速、Boss/骑兵倍乘） */
  private endlessMonsterBaseSpeed(wave: number = this.wave): number {
    const diffSpd = 1 + 0.1 * (this.effectiveDifficulty(wave) - 1);
    return TUNING.monsterSpd * diffSpd * this.wavePostMul(wave);
  }

  /** 某波普通怪移速（含被动减速、难度加速与波>10 加成，不含 Boss/骑兵倍乘） */
  private normalMonsterSpeed(wave: number = this.wave): number {
    return this.endlessMonsterBaseSpeed(wave) * this.mods.monsterSpdMul;
  }

  /** 某波 Boss 移速（含被动减速、难度加速） */
  private bossSpeed(wave: number = this.wave): number {
    return this.normalMonsterSpeed(wave) * TUNING.bossSpdMul;
  }

  /**
   * 当前地图下，把战场兵种按最优重排后的输出（含被动攻速/伤害、武将神兵/羁绊）。
   * 不计主动技能临时增益，避免开波瞬间吃 Buff 抬高整波难度。
   */
  estimateOptimalPower(): BoardPowerResult {
    const bond = this.bondAtkMul();
    const atkMul = this.mods.atkMul * bond;
    const frqMul = this.mods.frqMul;
    const wordKeys = new Set(this.words.keys());
    const freeCells = this.unlockedCells().filter((c) => !wordKeys.has(cellKey(c.c, c.r)));
    const units = [...this.units.values()].map((u) => ({ type: u.type, tier: u.tier }));
    const generals = this.activeGenerals().map((g) => {
      const base = generalStat(g.def, g.tier);
      const wb = this.weaponBonuses[g.def.id];
      const atk = base.atk * (1 + (wb?.atk ?? 0)) * atkMul;
      return {
        atk,
        frq: base.frq * (1 + (wb?.frq ?? 0)) * frqMul,
        rge: base.rge + (wb?.rge ?? 0),
        targets: base.targets,
        ax: (g.cells[0].c + g.cells[1].c) / 2,
        ay: (g.cells[0].r + g.cells[1].r) / 2,
        skillFocusDps: heroSkillFocusDps(g.def, atk),
      };
    });
    return estimateOptimalBoardPower({
      map: this.map,
      entranceDist: this.entranceDist,
      pathLen: this.pathLen,
      units,
      freeCells,
      nearestPathDist: (cell) => this.nearestPathDist(cell),
      generals,
      atkMul,
      frqMul,
      rangeTolerance: TUNING.rangeTolerance,
    });
  }

  /**
   * 按最优 DPS 规划本波出怪数、Boss 血量与出怪间隔（压力比随波次升高）。
   * @param hasMiniBoss 本波是否预定顶替 1 只普通怪刷小 Boss：其额外血量需占预算，
   *   否则怪量不变但血量更高会让实际压力悄悄超出规划比例（见 planWavePressure）。
   */
  /** 按当前战场最优输出 × 路径覆盖 × Boss 移速，估算妖王血量（正式妖王波与双雄引妖王共用口径） */
  private computeCurrentBossHp(): number {
    const power = this.estimateOptimalPower();
    const pathDmg = power.pathDamage(this.bossSpeed());
    return Math.max(this.normalMonsterHp(), pathDmg * pressureRatioForWave(this.wave));
  }

  private computeWavePressure(wave: number, hasMiniBoss = false): PressurePlan {
    const power = this.estimateOptimalPower();
    const normalHp = this.normalMonsterHp(wave);
    return planWavePressure({
      wave,
      baselineCount: this.baselineWaveSpawnCount(wave),
      normalHp,
      isBossWave: this.isBossWave(wave),
      bossSpd: this.bossSpeed(wave),
      monsterSpd: this.normalMonsterSpeed(wave),
      baseSpawnInterval: TUNING.spawnInterval,
      difficultySpawnFactor: 1 + 0.07 * (this.effectiveDifficulty(wave) - 1),
      minSpawnInterval: TUNING.spawnIntervalMin,
      power,
      miniBossExtraHp: hasMiniBoss ? normalHp * (TUNING.miniBossHpMul - 1) : 0,
    });
  }

  /** 本波出怪间隔：优先用压力方案（基础节奏 + 门口防秒）；叠怪靠随机批次 */
  private currentSpawnInterval(): number {
    if (this.wavePressure && this.wavePressure.spawnInterval > 0) {
      return this.wavePressure.spawnInterval;
    }
    return Math.max(
      TUNING.spawnIntervalMin,
      TUNING.spawnInterval / (1 + 0.07 * (this.effectiveDifficulty() - 1)),
    );
  }

  /** 双雄引妖王：均匀随机间隔秒数 ∈ [min, hi(heroCount)] */
  private rollHeroBossInterval(heroCount: number): number {
    const lo = TUNING.heroBossIntervalMin;
    const hi = heroBossIntervalHi(heroCount);
    if (hi <= lo) return lo;
    return lo + this.rng.next() * (hi - lo);
  }

  /** 波中额外刷一只大 Boss（不占用 spawnRemaining） */
  private spawnHeroSummonedBoss(): void {
    this.spawnMonster(0, { forceBoss: true });
    this.message = '⚠ 英雄引来妖王携护卫！';
    this.emit('wave');
  }

  private rollBossEscortCount(): number {
    const span = TUNING.bossEscortMax - TUNING.bossEscortMin + 1;
    return TUNING.bossEscortMin + this.rng.int(span);
  }

  /** @param distOffset 相对出怪口沿路偏移（负值=尚未走到门口，用于同批错位） */
  private spawnMonster(distOffset = 0, opts?: { forceBoss?: boolean }): void {
    // BOSS：强制（双雄引妖王）/ boss 波的最后一只
    const isBoss =
      opts?.forceBoss === true ||
      (this.isBossWave(this.wave) && this.spawnRemaining === 1);
    // 骑兵：仅骑兵波、非 BOSS/小 Boss；逐怪按本波随机比例判定
    const spawnedIdx = this.waveMonsterCount - this.spawnRemaining; // 0-based 出场序号
    // 小 Boss：预定序号出场；与 BOSS 互斥，也不做骑兵
    const miniKind = !isBoss && spawnedIdx === this.miniBossSpawnIdx ? this.waveMiniBoss : null;
    const isMiniBoss = miniKind != null;
    const isCavalry =
      this.cavalryWave && !isBoss && !isMiniBoss && this.rng.next() < this.cavalryWaveRatio;

    // 小 Boss 带独立光环；精英/妖王带地图技能；普通妖无
    const skill = isMiniBoss ? null : this.rollMonsterSkill(isBoss);
    const isElite = !isBoss && !isMiniBoss && skill !== null; // 精英=非BOSS/非小Boss但带词条

    let hp = this.normalMonsterHp();
    let bossEscortCount = 0;
    let bossEscortHpEach = 0;
    if (isBoss) {
      // 双雄引妖王：按当前阵容实时重算（开波后增兵/升阶/新激活英雄会抬高血量）
      let totalHp: number;
      if (opts?.forceBoss) {
        totalHp = this.computeCurrentBossHp();
      } else {
        // 正式妖王波：开波压力方案；无方案时回退旧倍乘
        const planned = this.wavePressure?.bossHp;
        if (planned != null && planned > 0) {
          totalHp = planned;
        } else {
          const t = Math.max(0, Math.min(1, (this.wave - TUNING.bossFirstSegLo) / Math.max(1, TUNING.bossHpRampWaves)));
          totalHp = hp * (TUNING.bossHpMulEarly + (TUNING.bossHpMul - TUNING.bossHpMulEarly) * t);
        }
      }
      bossEscortCount = this.rollBossEscortCount();
      const split = splitBossHpBudget(totalHp, bossEscortCount, hp, TUNING.bossEscortHpShare);
      hp = split.bossHp;
      bossEscortHpEach = split.escortHpEach;
      if (bossEscortHpEach <= 0) bossEscortCount = 0;
    } else if (isMiniBoss) {
      hp *= TUNING.miniBossHpMul;
    } else {
      if (isElite) {
        // 精英击杀给普通妖 4 倍蟠桃，血量需相应更高，否则性价比失衡（见 PEACH_PER_ELITE）
        hp *= TUNING.eliteHpMul;
      }
      if (isCavalry) hp *= TUNING.cavalryHpMul;
    }

    // 移速倍率：BOSS/小 Boss 略慢、骑兵翻倍（互斥）
    const spdMul = isBoss
      ? TUNING.bossSpdMul
      : isMiniBoss
        ? TUNING.miniBossSpdMul
        : isCavalry
          ? TUNING.cavalrySpdMul
          : 1;
    const skillCd = isMiniBoss ? TUNING.miniBossFirstDelay : TUNING.skillFirstDelay;
    type MonsterSpec = {
      hp: number;
      isBoss: boolean;
      isMiniBoss: boolean;
      miniBossKind: MiniBossKind | null;
      isCavalry: boolean;
      skill: MonsterSkill | null;
      skillCd: number;
    };
    const makeOne = (dist: number, spd: number, spec: MonsterSpec): Monster => ({
      id: this.nextMonsterId++,
      dist,
      hp: spec.hp,
      maxHp: spec.hp,
      spd,
      isBoss: spec.isBoss,
      isMiniBoss: spec.isMiniBoss,
      miniBossKind: spec.miniBossKind,
      isCavalry: spec.isCavalry,
      hitFlash: 0,
      skill: spec.skill,
      skillCd: spec.skillCd,
      castFlash: 0,
      spawnT: 0,
      stunT: 0,
      slowT: 0,
      hasteT: 0,
      healFlash: 0,
      burnT: 0,
      burnDps: 0,
    });
    const bossSpec: MonsterSpec = {
      hp,
      isBoss,
      isMiniBoss,
      miniBossKind: miniKind,
      isCavalry,
      skill,
      skillCd,
    };
    const off = Math.min(0, distOffset);
    const playerSpd = this.normalMonsterSpeed() * spdMul;
    const aiSpd = this.endlessMonsterBaseSpeed() * this.aiMods.monsterSpdMul * spdMul;
    this.monsters.push(makeOne(this.entranceDist + off, playerSpd, bossSpec));
    if (!this.endless) {
      this.aiMonsters.push(makeOne(this.aiEntranceDist + off, aiSpd, bossSpec));
    }
    if (isBoss && bossEscortCount > 0) {
      const escortSpec: MonsterSpec = {
        hp: bossEscortHpEach,
        isBoss: false,
        isMiniBoss: false,
        miniBossKind: null,
        isCavalry: false,
        skill: null,
        skillCd: TUNING.skillFirstDelay,
      };
      const escortPlayerSpd = this.normalMonsterSpeed();
      const escortAiSpd = this.endlessMonsterBaseSpeed() * this.aiMods.monsterSpdMul;
      for (let i = 0; i < bossEscortCount; i++) {
        const escortOff = off - (i + 1) * TUNING.bossEscortSpacing - this.rng.next() * SPAWN_DIST_JITTER;
        this.monsters.push(makeOne(this.entranceDist + escortOff, escortPlayerSpd, escortSpec));
        if (!this.endless) {
          this.aiMonsters.push(makeOne(this.aiEntranceDist + escortOff, escortAiSpd, escortSpec));
        }
      }
    }
    this.spawnGateT = 0.5; // 触发出怪口"开合"动画
    this.aiSpawnGateT = 0.5;
  }

  // 决定怪物携带的技能：BOSS 必带，精英按概率带且两次精英之间至少隔 eliteMinGap 只普通妖
  private rollMonsterSkill(isBoss: boolean): MonsterSkill | null {
    // 技能按地图主题固定（该图 Boss 必带；精英小怪按概率带同一技能）；未配置的地图回退定身。
    const skill = MAP_SKILL[this.map.id] ?? 'stun';
    if (isBoss) return skill;
    if (this.wave < TUNING.eliteFromWave) return null;
    if (this.sinceLastElite < TUNING.eliteMinGap) {
      this.sinceLastElite++;
      return null;
    }
    if (this.rng.next() < TUNING.eliteChance) {
      this.sinceLastElite = 0;
      return skill;
    }
    this.sinceLastElite++;
    return null;
  }

  // AI 单位攻击 AI 怪（与玩家同一套战斗数值；出招特效走共用 this.fx）
  private updateAiUnits(dt: number): void {
    if (this.aiMonsters.length === 0) return;
    const monsterPos = this.aiMonsters.map((m) => ({ m, p: posAlong(this.aiPath, m.dist) }));
    for (const u of this.aiUnits) {
      u.cooldown -= dt;
      if (u.cooldown > 0) continue;
      const stat = getUnitStat(u.type, u.tier);
      const base = Math.floor(stat.targets);
      const extra = this.aiRng.next() < stat.targets - base ? 1 : 0; // 用 AI 独立随机流，不扰动玩家 rng
      const maxTargets = Math.max(1, base + extra);
      const inRangeRaw = monsterPos.filter((x) => inAttackRange(u.cell.c, u.cell.r, stat.rge, x.p));
      if (inRangeRaw.length === 0) continue;
      const inRange = this.sortCombatTargets(inRangeRaw);
      const dmg = damage(stat.atk * this.aiMods.atkMul * (this.aiAtkBuffT > 0 ? TUNING.atkBuffMul : 1) * this.aiBondAtkMul());
      const color = this.unitColor(u.type);
      let hit = 0;
      for (const t of inRange) {
        if (hit >= maxTargets) break;
        t.m.hp -= dmg;
        t.m.hitFlash = 0.1;
        this.spawnDamageFloat(t.p.c, t.p.r, dmg);
        const fxTtl = this.attackFxTtl(u.type, u.tier);
        this.fx.push({ from: { c: u.cell.c, r: u.cell.r }, to: t.p, ttl: fxTtl, maxTtl: fxTtl, color, wtype: u.type, tier: u.tier }); // AI 侧也播放攻击特效
        hit++;
      }
      if (hit > 0) {
        u.combo = u.firePulse > 0.35 ? Math.min(9, u.combo + 1) : 0;
        u.firePulse = 1;
        const tp = inRange[0]!.p;
        u.fireDir = Math.atan2(tp.r - u.cell.r, tp.c - u.cell.c);
      }
      u.cooldown = 1 / (stat.frq * this.aiFrqMul * this.aiMods.frqMul * (this.aiFrqBuffT > 0 ? TUNING.frqBuffMul : 1));
    }
  }

  // AI 武将攻击 tick：镜像玩家 updateGenerals（含 AI 道具 / 神兵 / 羁绊）。
  private updateAiGenerals(dt: number): void {
    for (const g of this.aiActiveGenerals()) {
      const stat = generalStat(g.def, g.tier);
      const wb = this.aiWeaponBonuses[g.def.id];
      const atk = stat.atk * (1 + (wb?.atk ?? 0));
      const rge = stat.rge + (wb?.rge ?? 0);
      const frq = stat.frq * (1 + (wb?.frq ?? 0));
      const s = g.state;
      s.firePulse = Math.max(0, s.firePulse - dt * 6);
      const ax = (g.cells[0].c + g.cells[1].c) / 2;
      const ay = (g.cells[0].r + g.cells[1].r) / 2;
      const inRange = this.sortCombatTargets(
        this.aiMonsters
          .map((m) => ({ m, p: posAlong(this.aiPath, m.dist) }))
          .filter((x) => inAttackRange(ax, ay, rge, x.p)),
      );
      s.cooldown -= dt;
      if (s.cooldown > 0 || inRange.length === 0) continue;
      const base = Math.floor(stat.targets);
      const extra = this.aiRng.next() < stat.targets - base ? 1 : 0;
      const maxTargets = Math.max(1, base + extra);
      const dmg = damage(atk * this.aiMods.atkMul * (this.aiAtkBuffT > 0 ? TUNING.atkBuffMul : 1) * this.aiBondAtkMul());
      let hit = 0;
      for (const t of inRange) {
        if (hit >= maxTargets) break;
        t.m.hp -= dmg;
        t.m.hitFlash = 0.12;
        this.spawnDamageFloat(t.p.c, t.p.r, dmg);
        this.pushGeneralAttackFx(g, t.p);
        hit++;
      }
      if (hit > 0) {
        s.firePulse = 1;
        const tp = inRange[0]!.p;
        s.fireDir = Math.atan2(tp.r - ay, tp.c - ax);
        this.addGeneralCombatExp(g, Battle.combatExpFromHits(dmg, hit), true);
      }
      s.cooldown = 1 / (frq * this.aiMods.frqMul * (this.aiFrqBuffT > 0 ? TUNING.frqBuffMul : 1));
    }
  }

  // AI 侧推进：真玩家循环（征兵节奏→共享布阵→单位/武将攻击→怪物推进/漏怪扣血/击杀产桃）
  private updateAi(dt: number): void {
    if (this.endless) return; // 无尽模式无 AI 对手
    const knobs = skillToKnobs(this.aiSkill);
    // 1) 征兵节奏：到点且够桃则征一次，随后共享布阵
    let aiPlacedThisFrame = false;
    this.aiSummonTimer -= dt;
    if (this.aiSummonTimer <= 0) {
      this.aiSummonTimer = knobs.summonInterval;
      if (this.aiSummon()) {
        aiPlacedThisFrame = true;
        planAutoPlaceSteps(this.buildAiAutoView(), {
          rng: () => this.aiRng.next(),
          pSubOptimal: knobs.pSubOptimal,
          randomDigExitWeight: true,
          maxSteps: AI_PLACE_MAX_STEPS,
          maxGuard: AI_PLACE_MAX_GUARD,
        });
        this.tickAiShovelReserve();
      }
    }
    // 2) 战中调整：兵器调位 1–2.5s 随机；待补英雄配对字时 0.5–1s 单步布阵（与征兵同帧错开）
    this.aiRepositionTimer -= dt;
    if (this.aiRepositionTimer <= 0) {
      if (aiPlacedThisFrame) {
        this.aiRepositionTimer = rollAiAdjustInterval(
          aiHeroPartnerAdjustPending(this.buildAiAutoView()),
          () => this.aiRng.next(),
          this.aiAdjustIntervalScale,
        );
      } else {
        this.tickAiBattleAdjust(knobs.pSubOptimal);
      }
    }
    // 3) 战斗：AI 兵 + AI 武将攻击 aiMonsters
    if (this.aiMeteorPending && this.aiMonsters.length >= 3) {
      this.aiMeteorPending = false;
      this.castAiMeteor();
    }
    this.updateAiActives(dt);
    this.tickAiActives();
    this.updateAiUnits(dt);
    this.updateAiGenerals(dt);
    // 4) 怪物推进 + 漏怪扣血 + 击杀产桃（基础经济）
    const survivors: Monster[] = [];
    for (const m of this.aiMonsters) {
      m.spawnT += dt;
      if (m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt);
      if (m.hp <= 0) {
        this.creditAiKill(m.isBoss, !m.isBoss && !m.isMiniBoss && !!m.skill, m.isMiniBoss);
        continue;
      } // 击杀产桃（精英/小Boss/大Boss 分档，对齐玩家语义）
      m.dist += m.spd * (m.hasteT > 0 ? TUNING.hasteSpdMul : 1)
        * (this.aiMonsterInMudZone(m) ? 0.82 : 1) * dt;
      if (m.hasteT > 0) m.hasteT = Math.max(0, m.hasteT - dt);
      if (m.dist >= this.aiPathLen) {
        this.aiTangsengHP -= 1;
        if (this.aiTangsengHP <= 0) { this.aiTangsengHP = 0; this.aiDefeated = true; }
        continue;
      }
      survivors.push(m);
    }
    this.aiMonsters = survivors;
  }

  // 对手唐僧阵亡 → 我方获胜（伪竞技对局的胜利条件之一）
  private checkOpponentDefeated(): boolean {
    if (this.endless) return false; // 无尽模式禁用「击败对手=胜」
    if (this.aiDefeated && this.status !== 'won' && this.status !== 'lost') {
      this.status = 'won';
      this.waveActive = false;
      this.emit('win');
      this.message = '对方唐僧被妖怪吃了，我方获胜！';
      return true;
    }
    return false;
  }

  // 危险提示：任一怪物距唐僧（沿路剩余）≤ dangerRemaining 格
  dangerNear(): boolean {
    for (const m of this.monsters) if (this.pathLen - m.dist <= TUNING.dangerRemaining) return true;
    return false;
  }
  aiDangerNear(): boolean {
    for (const m of this.aiMonsters) if (this.aiPathLen - m.dist <= TUNING.dangerRemaining) return true;
    return false;
  }

  private unitColor(type: UnitType): string {
    switch (type) {
      case 'dao': return '#ff9a3c';
      case 'spear': return '#5bd1ff';
      case 'cavalry': return '#7dff8a';
      case 'archer': return '#c79bff';
    }
  }

  /** 兵种攻击特效时长：骑基础再慢一倍(1.2s)，随阶加快；其它约 0.3s 起 */
  private attackFxTtl(type: UnitType, tier: number): number {
    if (type === 'cavalry') return 1.2 / (1 + (tier - 1) * 0.22);
    if (type === 'dao') return (0.2 + (tier - 1) * 0.02) * 1.2; // 刀砍：略长于初版，但比 ×1.5 更快
    return 0.3 + (tier - 1) * 0.04;
  }

  // 单位攻击结算
  private updateUnits(dt: number): void {
    for (const u of this.units.values()) {
      // firePulse/combo 的衰减改在 updateFx（所有状态推进），避免波间冻结导致兵器卡在槽位
      // 减益计时衰减
      if (u.stunT > 0) u.stunT = Math.max(0, u.stunT - dt);
      if (u.slowT > 0) u.slowT = Math.max(0, u.slowT - dt);
      if (u.weakenT > 0) u.weakenT = Math.max(0, u.weakenT - dt);
      if (u.rangeCutT > 0) u.rangeCutT = Math.max(0, u.rangeCutT - dt);
      if (u.knockdownT > 0) u.knockdownT = Math.max(0, u.knockdownT - dt);
      if (u.stunImmuneT > 0) u.stunImmuneT = Math.max(0, u.stunImmuneT - dt);
      if (u.slowImmuneT > 0) u.slowImmuneT = Math.max(0, u.slowImmuneT - dt);
      if (u.weakenImmuneT > 0) u.weakenImmuneT = Math.max(0, u.weakenImmuneT - dt);
      if (u.rangeCutImmuneT > 0) u.rangeCutImmuneT = Math.max(0, u.rangeCutImmuneT - dt);
      if (u.knockdownImmuneT > 0) u.knockdownImmuneT = Math.max(0, u.knockdownImmuneT - dt);
      if (u.stunT > 0 || u.knockdownT > 0) continue; // 眩晕/倒下：本帧无法攻击（冷却也不推进）
      u.cooldown -= dt;
      if (u.cooldown > 0) continue;
      const stat = getUnitStat(u.type, u.tier); // atk/frq/rge/targets（来自 game-core）
      // 缠丝：有效射程 -0.5 格（最低 0.5 格，仍可与相邻格相交命中）
      const effRge = u.rangeCutT > 0
        ? Math.max(TUNING.rangeTolerance, stat.rge - TUNING.webbindRangeCut)
        : stat.rge;
      const base = Math.floor(stat.targets);
      const extra = this.rng.next() < stat.targets - base ? 1 : 0;
      const maxTargets = Math.max(1, base + extra);
      const inRange = this.sortCombatTargets(
        this.monsters
          .map((m) => ({ m, p: posAtDistance(this.map, m.dist) }))
          .filter((x) => inAttackRange(u.cell.c, u.cell.r, effRge, x.p)),
      );
      if (inRange.length === 0) continue;
      // 降攻减益：仅临时削弱伤害，不改动基础数值；仙丹增益 + 大圣羁绊抬高攻击
      const atkMul = this.mods.atkMul * (u.weakenT > 0 ? TUNING.weakenAtkMul : 1) * (this.atkBuffT > 0 ? this.atkBuffMul : 1) * this.bondAtkMul();
      const dmg = damage(stat.atk * atkMul); // 道具增伤 + 减益
      const color = this.unitColor(u.type);
      let hitCount = 0;
      for (const target of inRange) {
        if (hitCount >= maxTargets) break;
        this.hurtMonster(target.m, dmg, target.p, 0.12);
        const fxTtl = this.attackFxTtl(u.type, u.tier);
        this.fx.push({ from: { c: u.cell.c, r: u.cell.r }, to: target.p, ttl: fxTtl, maxTtl: fxTtl, color, wtype: u.type, tier: u.tier });
        this.bursts.push({ kind: 'hit', c: target.p.c, r: target.p.r, ttl: 0.22, maxTtl: 0.22, big: false, color });
        hitCount++;
      }
      if (hitCount > 0) {
        // 上次出招还没收完(firePulse 尚高)就再次命中 → 连击累加，用于枪连刺 / 刀连砍形变
        u.combo = u.firePulse > 0.35 ? Math.min(9, u.combo + 1) : 0;
        u.firePulse = 1;
        u.fireDir = Math.atan2(inRange[0]!.p.r - u.cell.r, inRange[0]!.p.c - u.cell.c); // 朝最靠前目标形变出招
        this.emit('attack');
      }
      // 攻速修正(道具/功德 frqMul + 风火轮临时增益) + 减速减益(拉长间隔)
      u.cooldown = (1 / (stat.frq * this.mods.frqMul * (this.frqBuffT > 0 ? this.frqBuffMul : 1))) * (u.slowT > 0 ? TUNING.slowCooldownMul : 1);
    }
  }

  // 羁绊：大圣激活 → 全队攻击加成（对应竞品 赵云+阿斗 羁绊）
  bondActive(): boolean {
    return this.activeGenerals().some((g) => g.def.id === BOND_GENERAL);
  }
  private bondAtkMul(): number {
    return this.bondActive() ? 1 + BOND_ATK_BONUS : 1;
  }

  aiBondActive(): boolean {
    return this.aiActiveGenerals().some((g) => g.def.id === BOND_GENERAL);
  }

  private aiBondAtkMul(): number {
    return this.aiBondActive() ? 1 + BOND_ATK_BONUS : 1;
  }

  private aiDpsPieceCount(): number {
    return this.aiUnits.length + this.aiActiveGenerals().length;
  }

  /** AI 主动技能释放时机：危险技 / 爆发技 / 增益技分层 */
  private aiShouldTriggerActive(effect: ActiveEffect): boolean {
    if (this.aiMonsters.length === 0) return false;
    switch (effect) {
      case 'palm':
      case 'freeze':
        return this.aiDangerNear();
      case 'meteor':
        return this.aiMonsters.length >= 3
          || this.aiMonsters.some((m) => m.isBoss)
          || (this.isBossWave(this.wave) && this.aiMonsters.length >= 1);
      case 'jinggu':
        return this.aiMonsters.length >= 2
          || this.aiMonsters.some((m) => m.isBoss || m.isMiniBoss);
      case 'atkBuff':
      case 'frqBuff':
        return this.aiDpsPieceCount() >= 2;
      default: {
        const _exhaustive: never = effect;
        void _exhaustive;
        return true;
      }
    }
  }

  private aiActiveSlotPriority(i: number): number {
    const slot = this.aiActiveSlots[i];
    if (!slot?.ready) return 999;
    const def = activeById(slot.id);
    if (!def || !this.aiShouldTriggerActive(def.effect)) return 998;
    switch (def.effect) {
      case 'palm':
      case 'freeze':
        return 0;
      case 'jinggu':
      case 'meteor':
        return 1;
      case 'atkBuff':
      case 'frqBuff':
        return 2;
      default: {
        const _exhaustive: never = def.effect;
        void _exhaustive;
        return 3;
      }
    }
  }

  /** 库存铲子：tray 无铲且仍有锁定格时自动开挖（洛阳铲产出等） */
  private aiUseShovelOn(to: Cell): boolean {
    if (this.aiShovels <= 0) return false;
    const k = cellKey(to.c, to.r);
    if (this.aiUnlocked.has(k)) return false;
    if (!this.aiCells.some((c) => c.c === to.c && c.r === to.r)) return false;
    this.aiShovels -= 1;
    this.aiUnlocked.add(k);
    this.aiDigFx.push({ c: to.c, r: to.r, t: 0 });
    if (this.aiMods.shovelPeach > 0) this.aiPeach += this.aiMods.shovelPeach;
    return true;
  }

  private tickAiShovelReserve(): void {
    if (this.aiShovels <= 0 || this.aiLockedCells().length === 0) return;
    if (this.aiTray.some((t) => t?.kind === 'shovel')) return;
    const digs = this.aiLockedCells();
    if (digs.length === 0) return;
    this.aiUseShovelOn(digs[0]!);
  }

  private generalActivateMessage(name: string, generalId: string): string {
    let msg = `${name} 已激活！(金框生效)`;
    if (generalId === BOND_GENERAL) {
      msg += ` · ${BOND_NAME}：全队攻击+${Math.round(BOND_ATK_BONUS * 100)}%`;
    }
    return msg;
  }

  // 武将升阶进度：5×3^level（15/45/135/405…）；满条时双字各 +1 阶
  static expToNext(level: number): number {
    return 5 * 3 ** level;
  }
  /** 普攻输出转升阶经验：首目标全额，额外目标折计（避免 multi-target 英雄刷经验过快） */
  static combatExpFromHits(dmg: number, hit: number): number {
    if (hit <= 0) return 0;
    const weightedHits = 1 + 0.35 * (hit - 1);
    return dmg * weightedHits * 0.036;
  }
  /** 大招命中转升阶经验（固定值，低于普攻累积） */
  static heroSkillExp = 1.5;
  addGeneralCombatExp(g: ActiveGeneral, amount: number, ai = false): void {
    const wordAt = ai ? (c: number, r: number) => this.aiWordAt(c, r) : (c: number, r: number) => this.wordAt(c, r);
    const wa = wordAt(g.cells[0].c, g.cells[0].r);
    const wb = wordAt(g.cells[1].c, g.cells[1].r);
    if (!wa || !wb) return;
    const cap = g.def.maxTier;
    if (wa.tier >= cap && wb.tier >= cap) return; // 双字已达该武将满级：丢弃经验

    const s = g.state;
    s.exp += amount;
    while (s.exp >= Battle.expToNext(s.level)) {
      const wa2 = wordAt(g.cells[0].c, g.cells[0].r);
      const wb2 = wordAt(g.cells[1].c, g.cells[1].r);
      if (!wa2 || !wb2) break;
      const can = wa2.tier < cap || wb2.tier < cap;
      if (!can) {
        s.exp = 0; // 升阶过程中触顶：清掉剩余进度，避免拆开后多段连升
        break;
      }
      s.exp -= Battle.expToNext(s.level);
      if (wa2.tier < cap) wa2.tier += 1;
      if (wb2.tier < cap) wb2.tier += 1;
      s.level += 1;
      if (!ai) {
        this.bursts.push({ kind: 'merge', c: g.cells[0].c, r: g.cells[0].r, ttl: 0.4, maxTtl: 0.4, big: false, color: '#ffe27a' });
        this.bursts.push({ kind: 'merge', c: g.cells[1].c, r: g.cells[1].r, ttl: 0.4, maxTtl: 0.4, big: false, color: '#ffe27a' });
        this.message = `${g.def.name} 升为 ${Math.min(wa2.tier, wb2.tier, cap)} 阶`;
      }
    }
  }
  // 含品质阶的武将实际攻击力
  generalAtk(g: ActiveGeneral): number {
    const base = generalStat(g.def, g.tier).atk;
    const wb = this.weaponBonuses[g.def.id];
    return base * (1 + (wb?.atk ?? 0)) * this.mods.atkMul * (this.atkBuffT > 0 ? this.atkBuffMul : 1) * this.bondAtkMul();
  }

  // 计入神兵加成的武将攻速/范围
  generalFrq(g: ActiveGeneral): number {
    const wb = this.weaponBonuses[g.def.id];
    return generalStat(g.def, g.tier).frq * (1 + (wb?.frq ?? 0)) * this.mods.frqMul * (this.frqBuffT > 0 ? this.frqBuffMul : 1);
  }
  generalRge(g: ActiveGeneral): number {
    const wb = this.weaponBonuses[g.def.id];
    return generalStat(g.def, g.tier).rge + (wb?.rge ?? 0);
  }

  /** 武将普攻命中特效：按 heroId 分派，阶数越高 ttl/规模越大 */
  private pushGeneralAttackFx(g: ActiveGeneral, to: { c: number; r: number }): void {
    const ax = (g.cells[0].c + g.cells[1].c) / 2;
    const ay = (g.cells[0].r + g.cells[1].r) / 2;
    const ttl = heroAttackFxTtl(g.def, g.tier);
    this.fx.push({
      from: { c: ax, r: ay },
      to,
      ttl,
      maxTtl: ttl,
      color: qualityColor(g.tier),
      tier: g.tier,
      heroId: g.def.id,
    });
  }

  // 已激活武将的攻击 + 定期技能（未相邻的字牌不产生任何输出）
  private updateGenerals(dt: number): void {
    for (const g of this.activeGenerals()) {
      const stat = generalStat(g.def, g.tier);
      const s = g.state;
      s.firePulse = Math.max(0, s.firePulse - dt * 6);
      s.skillFlash = Math.max(0, s.skillFlash - dt * 3);
      const ax = (g.cells[0].c + g.cells[1].c) / 2;
      const ay = (g.cells[0].r + g.cells[1].r) / 2;
      const inRange = this.sortCombatTargets(
        this.monsters
          .map((m) => ({ m, p: posAtDistance(this.map, m.dist) }))
          .filter((x) => inAttackRange(ax, ay, this.generalRge(g), x.p)),
      );

      if (g.def.skill !== 'none' && g.def.skillCd > 0) {
        s.skillCd -= dt;
        if (s.skillCd <= 0 && inRange.length > 0) {
          this.castGeneralSkill(g, inRange);
          s.skillCd = g.def.skillCd;
        }
      }

      s.cooldown -= dt;
      if (s.cooldown > 0) continue;
      if (inRange.length === 0) continue;
      const base = Math.floor(stat.targets);
      const extra = this.rng.next() < stat.targets - base ? 1 : 0;
      const maxTargets = Math.max(1, base + extra);
      const dmg = damage(this.generalAtk(g));
      let hit = 0;
      for (const t of inRange) {
        if (hit >= maxTargets) break;
        this.hurtMonster(t.m, dmg, t.p, 0.12);
        this.pushGeneralAttackFx(g, t.p);
        hit++;
      }
      if (hit > 0) {
        s.firePulse = 1;
        s.fireDir = Math.atan2(inRange[0]!.p.r - ay, inRange[0]!.p.c - ax);
        this.addGeneralCombatExp(g, Battle.combatExpFromHits(dmg, hit));
        this.tryRollFragmentOnHeroAttack();
      }
      s.cooldown = 1 / this.generalFrq(g);
    }
  }

  private castGeneralSkill(g: ActiveGeneral, inRange: { m: Monster; p: { c: number; r: number } }[]): void {
    const atk = this.generalAtk(g);
    g.state.skillFlash = 1;
    const center = inRange[0]!.p;
    const crit = ultTypeOf(g.def) === 'crit';
    switch (g.def.skill) {
      case 'burst': {
        for (const t of inRange) this.hurtMonster(t.m, damage(atk * 3), t.p, 0.15);
        break;
      }
      case 'ranged': {
        // 暴击：单体高倍 ×(5×CRIT_MULT)
        const t = inRange[0]!;
        const dmg = damage(atk * 5 * CRIT_MULT);
        this.hurtMonster(t.m, dmg, t.p, 0.2, true);
        break;
      }
      case 'stun': {
        const dur = g.def.maxTier === 5 ? TUNING.heroStunDurMain : TUNING.heroStunDurTransit;
        const isCharge = g.def.id === 'niumowang' || g.def.id === 'qingniu';
        const dmgMul = isCharge ? TUNING.heroChargeStunDmgMul : TUNING.heroStunDmgMul;
        for (const t of inRange) {
          t.m.stunT = Math.max(t.m.stunT, dur);
          this.hurtMonster(t.m, damage(atk * dmgMul), t.p, 0.12);
        }
        break;
      }
      case 'knock': {
        const push = g.def.maxTier === 5 ? TUNING.heroKnockPushMain : TUNING.heroKnockPushTransit;
        for (const t of inRange) {
          t.m.dist = Math.max(this.entranceDist, t.m.dist - push);
          this.hurtMonster(t.m, damage(atk * TUNING.heroKnockDmgMul), t.p, 0.12);
        }
        break;
      }
      case 'slow': {
        const dmgMul = g.def.maxTier === 5 ? TUNING.heroSlowDmgMulMain : TUNING.heroSlowDmgMulTransit;
        for (const t of inRange) {
          t.m.slowT = Math.max(t.m.slowT, TUNING.heroSlowDur);
          this.hurtMonster(t.m, damage(atk * dmgMul), t.p, 0.12);
        }
        break;
      }
      case 'heal': {
        for (const t of inRange) t.m.slowT = Math.max(t.m.slowT, TUNING.heroHealSlowDur);
        if (!this.healUsedThisWave && this.tangsengHP < this.tangsengMaxHP) {
          this.tangsengHP += 1;
          this.healUsedThisWave = true;
          this.message = `${g.def.name}甘露：唐僧回复 1 血`;
        }
        break;
      }
      case 'burn': {
        // 红孩/红袍：瞬时命中较轻，余量转为持续灼烧（真正的 DoT，区别于哪吒/金吒的纯爆发）
        for (const t of inRange) {
          this.hurtMonster(t.m, damage(atk * TUNING.heroBurnHitMul), t.p, 0.15);
          t.m.burnT = Math.max(t.m.burnT, TUNING.heroBurnDur);
          t.m.burnDps = Math.max(t.m.burnDps, atk * TUNING.heroBurnDpsMul);
        }
        break;
      }
      case 'none':
        break;
      default: {
        const _exhaustive: never = g.def.skill;
        void _exhaustive;
        break;
      }
    }
    // 专属大招特效（替代原通用 bursts.push）
    const gAx = (g.cells[0].c + g.cells[1].c) / 2;
    const gAy = (g.cells[0].r + g.cells[1].r) / 2;
    const ultTtl = g.def.id === 'dasheng' ? 0.9 : 0.6;
    this.heroUltFx.push({
      heroId: g.def.id,
      c: center.c, r: center.r,
      ttl: ultTtl, maxTtl: ultTtl,
      tier: g.tier,
      rge: this.generalRge(g),
      crit,
      ...(g.def.id === 'dasheng' || g.def.id === 'erlang' || g.def.id === 'niulang' ? { fromC: gAx, fromR: gAy } : {}),
    });
    this.addGeneralCombatExp(g, Battle.heroSkillExp);
    this.tryRollFragmentOnHeroAttack();
  }

  // 怪物施法：精英/BOSS 对半径内随机 1~2 件最近兵器施加地图减益；小 Boss 施展跨地图光环
  private updateMonsterSkills(dt: number): void {
    for (const m of this.monsters) {
      if (m.hp <= 0) continue;
      m.castFlash = Math.max(0, m.castFlash - dt * 4);
      // 小 Boss 光环
      if (m.isMiniBoss && m.miniBossKind) {
        m.skillCd -= dt;
        if (m.skillCd > 0) continue;
        m.skillCd = TUNING.miniBossInterval;
        this.castMiniBossSkill(m);
        continue;
      }
      // 精英 / 妖王：地图专属减益（半径内随机 1~2 把最近兵器）
      if (!m.skill) continue;
      m.skillCd -= dt;
      if (m.skillCd > 0) continue;
      m.skillCd = TUNING.skillInterval;
      const mp = posAtDistance(this.map, m.dist);
      const targets = this.pickSkillTargets(mp.c, mp.r);
      let affected = 0;
      for (const target of targets) {
        if (this.applyDebuff(target, m.skill)) affected++;
      }
      if (affected > 0) {
        m.castFlash = 1;
        this.bursts.push({ kind: 'hit', c: mp.c, r: mp.r, ttl: 0.4, maxTtl: 0.4, big: true, color: SKILL_META[m.skill].color });
        this.message = `${m.isBoss ? 'BOSS' : '精英妖'}施展「${SKILL_META[m.skill].name}」`;
      }
    }
  }

  private rollSkillTargetCount(): number {
    const lo = TUNING.skillTargetMin;
    const hi = TUNING.skillTargetMax;
    if (hi <= lo) return lo;
    return lo + this.rng.int(hi - lo + 1);
  }

  /** 半径内按距离取最近的若干兵器（至多 count 把） */
  private nearestUnitsInRadius(c: number, r: number, radius: number, count: number): PlacedUnit[] {
    const max = Math.max(0, Math.floor(count));
    if (max <= 0) return [];
    const hit: { u: PlacedUnit; d: number }[] = [];
    for (const u of this.units.values()) {
      const d = Math.hypot(c - u.cell.c, r - u.cell.r);
      if (d > radius) continue;
      hit.push({ u, d });
    }
    hit.sort((a, b) => a.d - b.d);
    return hit.slice(0, max).map((x) => x.u);
  }

  /** 单次怪物控制技：随机 1~2 把，在 skillRadius 内取最近 */
  private pickSkillTargets(c: number, r: number): PlacedUnit[] {
    const want = this.rollSkillTargetCount();
    return this.nearestUnitsInRadius(c, r, TUNING.skillRadius, want);
  }

  private castMiniBossSkill(m: Monster): void {
    const kind = m.miniBossKind;
    if (!kind) return;
    const meta = MINI_BOSS_META[kind];
    const mp = posAtDistance(this.map, m.dist);
    let affected = 0;
    switch (kind) {
      case 'frost':
      case 'blight':
      case 'quake': {
        // 对兵器的控制：与精英同口径——半径内随机 1~2 把最近 + 同种免疫
        const status: UnitStatusId = kind === 'frost' ? 'slow' : kind === 'blight' ? 'weaken' : 'knockdown';
        for (const target of this.pickSkillTargets(mp.c, mp.r)) {
          if (this.applyUnitStatus(target, status)) affected++;
        }
        break;
      }
      case 'gale': {
        for (const o of this.monsters) {
          if (o.id === m.id || o.hp <= 0) continue;
          const op = posAtDistance(this.map, o.dist);
          if (Math.hypot(mp.c - op.c, mp.r - op.r) > TUNING.miniBossRadius) continue;
          o.hasteT = Math.max(o.hasteT, TUNING.hasteDur);
          affected++;
        }
        break;
      }
      case 'blood': {
        for (const o of this.monsters) {
          if (o.id === m.id || o.hp <= 0) continue;
          const op = posAtDistance(this.map, o.dist);
          if (Math.hypot(mp.c - op.c, mp.r - op.r) > TUNING.miniBossRadius) continue;
          const heal = o.maxHp * TUNING.healPct;
          o.hp = Math.min(o.maxHp, o.hp + heal);
          o.healFlash = 1;
          affected++;
        }
        break;
      }
      default: {
        const _exhaustive: never = kind;
        void _exhaustive;
        break;
      }
    }
    if (affected > 0) {
      m.castFlash = 1;
      this.bursts.push({ kind: 'hit', c: mp.c, r: mp.r, ttl: 0.45, maxTtl: 0.45, big: true, color: meta.color });
      this.message = `${meta.name}施展「${meta.skillName}」`;
    }
  }

  private applyDebuff(u: PlacedUnit, skill: MonsterSkill): boolean {
    switch (skill) {
      case 'stun': return this.applyUnitStatus(u, 'stun');
      case 'slow': return this.applyUnitStatus(u, 'slow');
      case 'weaken': return this.applyUnitStatus(u, 'weaken');
      case 'webbind': return this.applyUnitStatus(u, 'webbind');
      default: {
        const _exhaustive: never = skill;
        void _exhaustive;
        return false;
      }
    }
  }

  /** 对兵器施加状态；同种免疫期内返回 false */
  private applyUnitStatus(u: PlacedUnit, status: UnitStatusId): boolean {
    switch (status) {
      case 'stun':
        if (u.stunImmuneT > 0) return false;
        u.stunT = Math.max(u.stunT, TUNING.stunDur);
        u.stunImmuneT = TUNING.debuffImmuneDur;
        return true;
      case 'slow':
        if (u.slowImmuneT > 0) return false;
        u.slowT = Math.max(u.slowT, TUNING.slowDur);
        u.slowImmuneT = TUNING.debuffImmuneDur;
        return true;
      case 'weaken':
        if (u.weakenImmuneT > 0) return false;
        u.weakenT = Math.max(u.weakenT, TUNING.weakenDur);
        u.weakenImmuneT = TUNING.debuffImmuneDur;
        return true;
      case 'webbind':
        if (u.rangeCutImmuneT > 0) return false;
        u.rangeCutT = Math.max(u.rangeCutT, TUNING.webbindDur);
        u.rangeCutImmuneT = TUNING.debuffImmuneDur;
        return true;
      case 'knockdown':
        if (u.knockdownImmuneT > 0) return false;
        u.knockdownT = Math.max(u.knockdownT, TUNING.knockdownDur);
        u.knockdownImmuneT = TUNING.debuffImmuneDur;
        return true;
      default: {
        const _exhaustive: never = status;
        void _exhaustive;
        return false;
      }
    }
  }

  // 主动技能：每帧推进各槽冷却与临时增益计时。
  private updateActives(dt: number): void {
    for (const slot of this.activeSlots) {
      if (slot.cd > 0) {
        slot.cd = Math.max(0, slot.cd - dt);
        if (slot.cd === 0) slot.ready = true;
      } else {
        slot.ready = true;
      }
      if (slot.flash > 0) slot.flash = Math.max(0, slot.flash - dt);
    }
    if (this.atkBuffT > 0) this.atkBuffT = Math.max(0, this.atkBuffT - dt);
    if (this.frqBuffT > 0) this.frqBuffT = Math.max(0, this.frqBuffT - dt);
  }

  private updateAiActives(dt: number): void {
    for (const slot of this.aiActiveSlots) {
      if (slot.cd > 0) {
        slot.cd = Math.max(0, slot.cd - dt);
        if (slot.cd === 0) slot.ready = true;
      } else {
        slot.ready = true;
      }
    }
    if (this.aiAtkBuffT > 0) this.aiAtkBuffT = Math.max(0, this.aiAtkBuffT - dt);
    if (this.aiFrqBuffT > 0) this.aiFrqBuffT = Math.max(0, this.aiFrqBuffT - dt);
  }

  /** AI 主动技能：按优先级择时释放（每帧至多一个，未满足时机则保留 CD）。 */
  private tickAiActives(): void {
    if (this.status !== 'playing') return;
    const order = this.aiActiveSlots
      .map((_, i) => i)
      .sort((a, b) => this.aiActiveSlotPriority(a) - this.aiActiveSlotPriority(b));
    for (const i of order) {
      const slot = this.aiActiveSlots[i];
      if (!slot?.ready) continue;
      if (this.triggerAiActive(i)) return;
    }
  }

  private triggerAiActive(i: number): boolean {
    if (this.status !== 'playing') return false;
    const slot = this.aiActiveSlots[i];
    if (!slot || !slot.ready) return false;
    const def = activeById(slot.id);
    if (!def) return false;
    if (!this.aiShouldTriggerActive(def.effect)) return false;
    switch (def.effect) {
      case 'palm':
        for (const m of this.aiMonsters) {
          const p = posAlong(this.aiPath, m.dist);
          this.bursts.push({ kind: 'hit', c: p.c, r: p.r, ttl: 0.35, maxTtl: 0.35, big: false, color: '#8fd3ff' });
        }
        for (const m of this.aiMonsters) m.dist = Math.max(0, m.dist - TUNING.palmPushCells);
        break;
      case 'meteor':
        this.doAiMeteor(TUNING.meteorDmgMul, true);
        break;
      case 'atkBuff':
        this.aiAtkBuffT = TUNING.atkBuffDur;
        this.setSkillFx('atkBuff', this.aiTangseng, true);
        break;
      case 'frqBuff':
        this.aiFrqBuffT = TUNING.frqBuffDur;
        this.setSkillFx('frqBuff', this.aiTangseng, true);
        break;
      case 'freeze': {
        for (const m of this.aiMonsters) m.stunT = Math.max(m.stunT, TUNING.freezeStunDur);
        const fc = this.frontMonsterCell(true);
        if (fc) this.setSkillFx('freeze', fc, true);
        break;
      }
      case 'jinggu':
        this.doAiJingu();
        break;
    }
    slot.cd = slot.cdMax;
    slot.ready = false;
    return true;
  }

  private doAiJingu(): void {
    if (this.aiMonsters.length === 0) return;
    let front = this.aiMonsters[0]!;
    for (const m of this.aiMonsters) if (m.dist > front.dist) front = m;
    const center = posAlong(this.aiPath, front.dist);
    const dmg = (TUNING.monsterHpBase + TUNING.monsterHpStep * this.wave) * this.effectiveDifficulty() * TUNING.jingguDmgMul;
    for (const m of this.aiMonsters) {
      const p = posAlong(this.aiPath, m.dist);
      if (Math.hypot(p.c - center.c, p.r - center.r) <= TUNING.aiClearRadius) {
        m.hp -= dmg;
        m.hitFlash = 0.15;
        this.spawnDamageFloat(p.c, p.r, dmg);
      }
    }
    this.bursts.push({ kind: 'death', c: center.c, r: center.r, ttl: 0.6, maxTtl: 0.6, big: true, color: '#ffdb4d' });
    this.setSkillFx('jinggu', center, true);
  }

  // 主动技能是否就绪（供渲染/交互判断）
  activeReady(i: number): boolean {
    const slot = this.activeSlots[i];
    return this.status === 'playing' && !!slot && slot.ready;
  }

  // 触发第 i 个主动技能。返回是否成功（就绪且效果生效才进入冷却）。
  triggerActive(i: number): boolean {
    if (this.status !== 'playing') return false;
    const slot = this.activeSlots[i];
    if (!slot || !slot.ready) return false;
    const def = activeById(slot.id);
    if (!def) return false;
    // 需要场上有怪才有意义的技能：无怪时不触发、不进冷却（避免空放浪费）
    const needsMonsters: ActiveEffect[] = ['palm', 'meteor', 'freeze', 'jinggu'];
    if (needsMonsters.includes(def.effect) && this.monsters.length === 0) {
      this.message = '场上无妖，技能待命';
      return false;
    }
    switch (def.effect) {
      case 'palm':
        this.startPalmPush(TUNING.palmPushCells);
        this.message = `如来神掌！妖怪沿路回推 ${TUNING.palmPushCells} 格`;
        this.emit('palm');
        break;
      case 'meteor':
        this.doMeteor(TUNING.meteorDmgMul, true);
        this.message = '天降陨石！';
        this.emit('ult');
        break;
      case 'atkBuff':
        this.atkBuffT = TUNING.atkBuffDur; this.atkBuffMul = TUNING.atkBuffMul;
        this.setSkillFx('atkBuff', this.tangsengRenderPos(), false);
        this.message = '仙丹！全体攻击 +40%（8秒）';
        this.emit('item');
        break;
      case 'frqBuff':
        this.frqBuffT = TUNING.frqBuffDur; this.frqBuffMul = TUNING.frqBuffMul;
        this.setSkillFx('frqBuff', this.tangsengRenderPos(), false);
        this.message = '风火轮！全体攻速 +40%（8秒）';
        this.emit('item');
        break;
      case 'freeze': {
        for (const m of this.monsters) m.stunT = Math.max(m.stunT, TUNING.freezeStunDur);
        const fc = this.frontMonsterCell(false);
        if (fc) this.setSkillFx('freeze', fc, false);
        this.message = '冰封定身！';
        this.emit('item');
        break;
      }
      case 'jinggu':
        this.doJingu();
        this.emit('ult');
        break;
    }
    this.ultFlash = Math.max(this.ultFlash, 0.35); // 释放主动技能时统一来一下屏幕闪，增强"放了技能"的反馈
    slot.cd = slot.cdMax;
    slot.ready = false;
    slot.flash = 0.6;
    return true;
  }

  /** AI 半场仙丹/风火轮剩余（渲染用） */
  aiAtkBuffRemaining(): number { return this.aiAtkBuffT; }
  aiFrqBuffRemaining(): number { return this.aiFrqBuffT; }

  // 紧箍咒：以最靠前妖怪为中心的大范围 AOE 爆发（复用原英雄绝招效果）。
  private doJingu(): void {
    if (this.monsters.length === 0) return;
    let front = this.monsters[0]!;
    for (const m of this.monsters) if (m.dist > front.dist) front = m;
    const center = posAtDistance(this.map, front.dist);
    // 伤害以"当前波基础怪血 × 有效难度 × 系数"封顶，与陨石同一缩放基线
    const dmg = (TUNING.monsterHpBase + TUNING.monsterHpStep * this.wave) * this.effectiveDifficulty() * TUNING.jingguDmgMul;
    for (const m of this.monsters) {
      const p = posAtDistance(this.map, m.dist);
      if (Math.hypot(p.c - center.c, p.r - center.r) <= TUNING.aiClearRadius) {
        this.hurtMonster(m, dmg, p, 0.15);
      }
    }
    this.setSkillFx('jinggu', center, false);
    this.bursts.push({ kind: 'death', c: center.c, r: center.r, ttl: 0.6, maxTtl: 0.6, big: true, color: '#ffdb4d' });
    this.message = '紧箍咒！金光横扫';
  }

  private updateMonsters(dt: number): void {
    const survivors: Monster[] = [];
    for (const m of this.monsters) {
      m.spawnT += dt;
      if (m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt);
      if (m.burnT > 0) {
        m.hp -= m.burnDps * dt;
        m.burnT = Math.max(0, m.burnT - dt);
        if (m.burnT <= 0) m.burnDps = 0;
      }
      if (m.hp <= 0) {
        const isElite = !m.isBoss && !m.isMiniBoss && m.skill !== null; // 精英=非BOSS/非小Boss但带词条
        const base = m.isBoss
          ? PEACH_PER_BOSS
          : m.isMiniBoss
            ? PEACH_PER_MINI_BOSS
            : isElite
              ? PEACH_PER_ELITE
              : PEACH_PER_KILL;
        const amount = base + this.mods.killBonus; // 击杀产蟠桃（普通1 / 精英4 / 小Boss6 / 大Boss10，+道具）
        this.peach += amount;
        const dp = posAtDistance(this.map, m.dist);
        this.bursts.push({
          kind: 'death',
          c: dp.c,
          r: dp.r,
          ttl: 0.4,
          maxTtl: 0.4,
          big: m.isBoss || m.isMiniBoss,
          color: m.isBoss ? '#ff5a8a' : m.isMiniBoss ? '#ff9a4a' : '#c25a5a',
        });
        const vy0 = peachFloatInitialVy();
        this.peachFloats.push({
          c: dp.c,
          r: dp.r,
          amount,
          y: PEACH_FLOAT_HEAD_Y,
          vy: vy0,
          peakY: PEACH_FLOAT_HEAD_Y,
        });
        this.emit(m.isBoss ? 'bosskill' : 'kill');
        continue;
      }
      // 武将控制：定身期间不前进；减速减半、疾风加速
      if (m.stunT > 0) {
        m.stunT = Math.max(0, m.stunT - dt);
      } else if (!this.palmPushFx) {
        const mudMul = this.monsterInMudZone(m) ? 0.82 : 1; // 淤泥：出怪口附近减速
        const slowMul = m.slowT > 0 ? 0.5 : 1;
        const hasteMul = m.hasteT > 0 ? TUNING.hasteSpdMul : 1;
        m.dist += m.spd * slowMul * hasteMul * mudMul * dt;
      }
      if (m.slowT > 0) m.slowT = Math.max(0, m.slowT - dt);
      if (m.hasteT > 0) m.hasteT = Math.max(0, m.hasteT - dt);
      if (m.healFlash > 0) m.healFlash = Math.max(0, m.healFlash - dt * 2.5);
      if (m.dist >= this.pathLen) {
        // 撞到唐僧：扣血 + 舍身饲魔补偿蟠桃
        this.tangsengHP -= 1;
        this.peach += PEACH_PER_BLEED;
        this.emit('hurt');
        if (this.tangsengHP <= 0) {
          this.tangsengHP = 0;
          this.status = 'lost';
          this.emit('lose');
          this.message = '唐僧被妖怪吃了…取经失败';
        }
        continue;
      }
      survivors.push(m);
    }
    this.monsters = survivors;
  }

  /** 清波后立刻收掉弹道/爆点/飘字等战斗特效，避免波间倒计时仍残留上一波画面 */
  private clearWaveCombatFx(): void {
    this.fx = [];
    this.bursts = [];
    this.heroUltFx = [];
    this.peachFloats = [];
    this.damageFloats = [];
    this.ultFlash = 0;
    this.ultCenter = null;
    this.palmPushFx = null;
    this.playerSkillFx = null;
    this.aiSkillFx = null;
    for (const u of this.units.values()) {
      u.firePulse = 0;
      u.combo = 0;
    }
    for (const g of this.activeGenerals()) {
      g.state.firePulse = 0;
    }
  }

  private updateFx(dt: number): void {
    for (const f of this.fx) f.ttl -= dt;
    this.fx = this.fx.filter((f) => f.ttl > 0);
    // 开火脉冲/连击衰减：在所有状态(含波间'ready')推进，避免单位兵器卡在槽位一直显示
    // 连击(combo>0)时衰减更快(9 vs 6)，出招/收招更迅捷，视觉更密集（不改实际攻击频率/DPS）
    for (const u of this.units.values()) {
      // 骑：基础转速再减半(1.5)，随阶加快；其它兵种保持原衰减
      const decay = u.type === 'cavalry'
        ? 1.5 * (1 + (u.tier - 1) * 0.28) * (u.combo > 0 ? 1.25 : 1)
        : (u.combo > 0 ? 9 : 6);
      u.firePulse = Math.max(0, u.firePulse - dt * decay);
      if (u.firePulse <= 0.02) u.combo = 0; // 收招完成即清连击
    }
    for (const u of this.aiUnits) {
      const decay = u.type === 'cavalry'
        ? 1.5 * (1 + (u.tier - 1) * 0.28) * (u.combo > 0 ? 1.25 : 1)
        : (u.combo > 0 ? 9 : 6);
      u.firePulse = Math.max(0, u.firePulse - dt * decay);
      if (u.firePulse <= 0.02) u.combo = 0;
    }
    for (const bt of this.bursts) bt.ttl -= dt;
    this.bursts = this.bursts.filter((bt) => bt.ttl > 0);
    for (const uf of this.heroUltFx) uf.ttl -= dt;
    this.heroUltFx = this.heroUltFx.filter((uf) => uf.ttl > 0);
    for (const p of this.peachFloats) {
      p.vy += PEACH_FLOAT_GRAVITY * dt;
      p.y += p.vy * dt;
      if (p.y < p.peakY) p.peakY = p.y;
    }
    this.peachFloats = this.peachFloats.filter((p) => p.y < p.peakY + PEACH_FLOAT_FALL);
    for (const d of this.damageFloats) {
      d.age += dt;
      d.vy += (d.crit ? DAMAGE_FLOAT_GRAVITY_CRIT : DAMAGE_FLOAT_GRAVITY) * dt;
      d.y += d.vy * dt;
      d.x += d.vx * dt;
      if (d.y < d.peakY) d.peakY = d.y;
    }
    this.damageFloats = this.damageFloats.filter((d) => d.y < d.peakY + DAMAGE_FLOAT_FALL);
    for (const d of this.digFx) d.t += dt;
    this.digFx = this.digFx.filter((d) => d.t < DIG_DUR);
    for (const d of this.aiDigFx) d.t += dt;
    this.aiDigFx = this.aiDigFx.filter((d) => d.t < DIG_DUR);
    this.updatePendingPlace(); // 开格动画结束后落下预占的兵/字牌
    if (this.summonFlash > 0) this.summonFlash = Math.max(0, this.summonFlash - dt * 2);
    if (this.autoplaceFlash > 0) this.autoplaceFlash = Math.max(0, this.autoplaceFlash - dt * 2);
    if (this.summonAnimT < 2) this.summonAnimT += dt;
    if (this.ultFlash > 0) this.ultFlash = Math.max(0, this.ultFlash - dt); // 绝招特效衰减(在所有状态下都推进，避免波间卡住)
    this.updatePalmPush(dt);
    this.updateSkillFx(dt);
    if (this.spawnGateT > 0) this.spawnGateT = Math.max(0, this.spawnGateT - dt);
    if (this.aiSpawnGateT > 0) this.aiSpawnGateT = Math.max(0, this.aiSpawnGateT - dt);
    this.updateItemEffects(dt); // 被动道具收益（洛阳铲）在所有状态下持续
    if (this.status === 'playing' || this.status === 'ready') this.updatePeachTrees(dt); // 蟠桃园：对局进行中种树/产桃
  }

  // 推进 dt 秒
  step(dt: number): void {
    // 开局入场：唐僧归位前的备战窗口（玩家可征兵布阵），归位后自动开打第一波
    if (!this.introDone && this.status === 'ready' && this.wave === 0) {
      this.introT += dt;
      this.message = '唐僧归位中…抓紧征兵布阵！';
      if (this.introT >= Battle.INTRO_DUR) {
        this.startNextWave();
      }
      this.updateAi(dt); // 入场阶段：AI 与玩家同步征兵布阵
      this.updateFx(dt);
      return;
    }
    // 波间自动切换：清波后倒计时自动开下一波（期间玩家仍可征兵布阵）
    if (this.introDone && this.status === 'ready' && this.wave > 0) {
      this.nextWaveTimer -= dt;
      this.message = `第 ${this.wave + 1} 波准备中…${Math.max(0, Math.ceil(this.nextWaveTimer))}s（可继续布阵）`;
      this.updateAi(dt); // AI 侧继续清理残余怪
      if (this.checkOpponentDefeated()) { this.updateFx(dt); return; }
      this.updateFx(dt);
      if (this.nextWaveTimer <= 0) this.startNextWave();
      return;
    }
    if (this.status !== 'playing') {
      this.updateFx(dt);
      return;
    }
    // 生成妖怪：每次随机 1..N 只（N 随波次升高）；多出的怪在门口后方半格内错位
    if (this.spawnRemaining > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const cap = spawnBatchCap(this.wave);
        const n = Math.min(this.spawnRemaining, 1 + this.rng.int(cap));
        for (let i = 0; i < n; i++) {
          const offset = i === 0 ? 0 : -this.rng.next() * SPAWN_DIST_JITTER;
          this.spawnMonster(offset);
          this.spawnRemaining -= 1;
        }
        this.spawnTimer = this.currentSpawnInterval();
      }
    }
    // 双雄及以上：当前波随机间隔刷额外大 Boss（不占本波定额；每波有上限）
    if (this.waveActive) {
      const heroCount = this.activeGenerals().length;
      if (heroCount >= TUNING.heroBossFromCount) {
        if (this.heroBossTimer < 0) {
          this.heroBossTimer = this.rollHeroBossInterval(heroCount);
        } else {
          this.heroBossTimer -= dt;
          if (this.heroBossTimer <= 0) {
            const maxSpawns = Math.min(TUNING.heroBossMaxPerWave, heroCount);
            if (this.heroBossSpawnsThisWave < maxSpawns) {
              this.spawnHeroSummonedBoss();
              this.heroBossSpawnsThisWave++;
            }
            this.heroBossTimer = this.rollHeroBossInterval(heroCount);
          }
        }
      } else {
        this.heroBossTimer = -1;
      }
    }
    this.updateUnits(dt);
    if (this.meteorPending && this.monsters.length >= 3) { this.meteorPending = false; this.castMeteor(); }
    this.updateMonsterSkills(dt);
    this.updateGenerals(dt);
    this.updateActives(dt);
    this.updateMonsters(dt);
    const dangerNow = this.dangerNear();
    if (dangerNow && !this.wasDangerNear) this.emit('danger');
    this.wasDangerNear = dangerNow;
    this.updateAi(dt);
    this.updateFx(dt);
    if (this.checkOpponentDefeated()) return; // 对手先阵亡 → 我方胜

    // 波次清空判定（仅在仍在进行中时；避免覆盖同帧发生的 lost）
    // 对战/无尽均不波次封顶通关：对战靠击败对手唐僧，无尽靠失守结束
    if (this.status === 'playing' && this.waveActive && this.spawnRemaining === 0 && this.monsters.length === 0) {
      this.waveActive = false;
      this.clearWaveCombatFx();
      this.status = 'ready';
      this.nextWaveTimer = 5; // 5秒后自动开下一波
      this.message = `第 ${this.wave} 波已清！`;
    }
  }

  // 调试/自测用：直接增蟠桃（正式玩法不暴露）
  grantPeach(n: number): void {
    this.peach += n;
  }

  // 测试辅助：立即清空当前波（清怪 + 触发清波判定）。仅供单测确定性驱动。
  forceClearWaveForTest(): void {
    this.monsters = [];
    this.spawnRemaining = 0;
    this.step(1 / 60); // 触发清波判定分支
  }

  // 一键布阵：把候选区令牌自动落位（铲子挖最靠前锁定格；兵种优先合成同型同级，否则放空格）。
  // 供"一键布阵"便捷按钮与自动化自测使用。委托共享策略 planAutoPlace：射程感知铺格、绝不丢弃。
  // 自动布阵专用落子：若目标是"刚挖开、开格动画未完"的空格，则先预占、延迟到动画结束再真正落子；
  // 铲子(挖格)与合成(落到已有兵格)保持即时。手动拖拽仍走 placeFromTray（不延迟）。
  private autoPlaceApply(index: number, cell: Cell): boolean {
    const token = this.tray[index];
    if (!token) return false;
    const animating = this.digFx.some((d) => d.c === cell.c && d.r === cell.r);
    if (token.kind !== 'shovel' && animating && this.isUnlocked(cell.c, cell.r) && this.cellFree(cell.c, cell.r)) {
      this.pendingPlace.push({ token, c: cell.c, r: cell.r }); // 预占：cellFree 此后视其为占用
      this.tray.splice(index, 1);
      return true;
    }
    return this.placeFromTray(index, cell);
  }

  // 延迟落子结算：预占格的开格动画结束后，真正把预占的兵/字牌落到该格（每帧由 updateFx 调用）。
  private updatePendingPlace(): void {
    if (this.pendingPlace.length > 0) {
      const still: { token: TrayToken; c: number; r: number }[] = [];
      for (const p of this.pendingPlace) {
        if (this.digFx.some((d) => d.c === p.c && d.r === p.r)) { still.push(p); continue; } // 动画未完，继续等
        const cell = { c: p.c, r: p.r };
        if (p.token.kind === 'unit') {
          this.units.set(cellKey(p.c, p.r), makePlacedUnit(p.token.type, p.token.tier, cell, this.unitFaceGate()));
          this.emit('place');
        } else if (p.token.kind === 'word') {
          const w = p.token;
          this.words.set(cellKey(p.c, p.r), { char: w.char, general: w.general, tier: w.tier, cell });
          this.emit(this.activeGenerals().some((g) => g.def.id === w.general) ? 'general' : 'place');
        }
      }
      this.pendingPlace = still;
    }
    if (this.aiPendingPlace.length > 0) {
      const still: { token: TrayToken; c: number; r: number }[] = [];
      for (const p of this.aiPendingPlace) {
        if (this.aiDigFx.some((d) => d.c === p.c && d.r === p.r)) { still.push(p); continue; }
        const cell = { c: p.c, r: p.r };
        if (p.token.kind === 'unit') {
          this.aiUnits.push(makePlacedUnit(p.token.type, p.token.tier, cell, this.unitFaceGate(true)));
        } else if (p.token.kind === 'word') {
          this.aiWords.set(cellKey(p.c, p.r), { char: p.token.char, general: p.token.general, tier: p.token.tier, cell });
        }
      }
      this.aiPendingPlace = still;
    }
  }

  private buildPlayerAutoView(): AutoPlaceView {
    return {
      wave: () => this.wave,
      tray: () => this.tray,
      freeCells: () => this.unlockedCells().filter((c) => this.cellFree(c.c, c.r)),
      diggableCells: () => this.lockedCells().filter((c) => !this.trees.has(cellKey(c.c, c.r))),
      placedUnits: () => [...this.units.values()].map((u) => ({ type: u.type, tier: u.tier, cell: u.cell })),
      placedWords: () => [...this.words.values()].map((w) => ({ char: w.char, general: w.general, cell: w.cell, tier: w.tier })),
      nearestPathDist: (cell) => this.nearestPathDist(cell),
      pathTouchSides: (cell) => this.pathTouchSidesOf(this.map.path, cell),
      exitDist: (cell) => this.playerExitDist(cell),
      tangsengDist: (cell) => Math.hypot(cell.c - this.map.tangseng.c, cell.r - this.map.tangseng.r),
      pathCover: (cell, type, tier) =>
        pathCoverageLen(this.map, this.entranceDist, this.pathLen, cell.c, cell.r, getUnitStat(type, tier).rge),
      pathCoverAt: (ax, ay, rge) =>
        pathCoverageLen(this.map, this.entranceDist, this.pathLen, ax, ay, rge),
      pathCoverEarlyAt: (ax, ay, rge) =>
        pathCoverageLenEntranceWeighted(this.map, this.entranceDist, this.pathLen, ax, ay, rge),
      pathFirstEngageAt: (ax, ay, rge) =>
        pathFirstEngageDist(this.map, this.entranceDist, this.pathLen, ax, ay, rge),
      generalRge: (general, tier) => {
        const def = generalById(general);
        if (!def) return 2;
        const wb = this.weaponBonuses[def.id];
        return generalStat(def, tier).rge + (wb?.rge ?? 0);
      },
      generalAtk: (general, tier) => {
        const def = generalById(general);
        if (!def) return 0;
        const wb = this.weaponBonuses[def.id];
        return generalStat(def, tier).atk * (1 + (wb?.atk ?? 0));
      },
      dangerEngageAt: (ax, ay, rge, atk) => this.dangerEngageAtPlayer(ax, ay, rge, atk),
      unitEngageScore: (cell, type, tier) =>
        this.monsters.length > 0
          ? this.engageScoreAt(this.monsters, this.map.path, this.entranceDist, cell, type, tier, this.dangerNear())
          : 0,
      wordChars: (general) => generalById(general)?.chars,
      place: (i, cell) => this.autoPlaceApply(i, cell),
      moveUnit: (from, to) => {
        const u = this.units.get(cellKey(from.c, from.r));
        if (!u) return false;
        if (!this.isUnlocked(to.c, to.r) || !this.cellFree(to.c, to.r)) return false;
        this.units.delete(cellKey(from.c, from.r));
        u.cell = { c: to.c, r: to.r };
        u.fireDir = faceDirToward(u.cell, this.unitFaceGate());
        this.units.set(cellKey(to.c, to.r), u);
        return true;
      },
      swapUnits: (a, b) => {
        const ka = cellKey(a.c, a.r);
        const kb = cellKey(b.c, b.r);
        const ua = this.units.get(ka);
        const ub = this.units.get(kb);
        if (!ua || !ub) return false;
        this.units.delete(ka);
        this.units.delete(kb);
        ua.cell = { c: b.c, r: b.r };
        ub.cell = { c: a.c, r: a.r };
        ua.fireDir = faceDirToward(ua.cell, this.unitFaceGate());
        ub.fireDir = faceDirToward(ub.cell, this.unitFaceGate());
        this.units.set(kb, ua);
        this.units.set(ka, ub);
        return true;
      },
      swapUnitWord: (unitCell, wordCell) => this.swapUnitWord(unitCell, wordCell),
      swapWords: (from, to) => this.dragWord(from, to),
      moveWord: (from, to) => {
        const kFrom = cellKey(from.c, from.r);
        const kTo = cellKey(to.c, to.r);
        const w = this.words.get(kFrom);
        if (!w) return false;
        if (!this.isUnlocked(to.c, to.r) || !this.cellFree(to.c, to.r)) return false;
        this.words.delete(kFrom);
        w.cell = { c: to.c, r: to.r };
        this.words.set(kTo, w);
        return true;
      },
      displaceToTray: (cell) => this.displaceToTray(cell),
      isActiveHeroCell: (cell) =>
        this.activeGenerals().some((g) => g.cells.some((c) => c.c === cell.c && c.r === cell.r)),
      dangerNear: () => this.dangerNear(),
      imminentPathScore: (cell) =>
        this.imminentPathScoreAt(this.monsters, this.map.path, this.pathLen, this.entranceDist, cell),
      mergeTray: (from, to) => this.mergeTrayTokens(from, to),
      mergeBoard: (from, to) => {
        const a = this.units.get(cellKey(from.c, from.r));
        const b = this.units.get(cellKey(to.c, to.r));
        if (!a || !b) return false;
        if (!canMerge({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier })) return false;
        const merged = mergeUnits({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier });
        this.units.set(cellKey(to.c, to.r), { ...b, type: merged.type, tier: merged.tier, cooldown: 0 });
        this.units.delete(cellKey(from.c, from.r));
        this.bursts.push({ kind: 'merge', c: to.c, r: to.r, ttl: 0.35, maxTtl: 0.35, big: false, color: '#ffd76a' });
        this.emit('merge');
        return true;
      },
    };
  }

  autoPlaceTray(): void {
    const trayBefore = this.tray.length;
    const placed = planAutoPlaceSteps(this.buildPlayerAutoView(), {
      rng: () => this.rng.next(),
      pSubOptimal: 0,
      maxSteps: PLAYER_PLACE_MAX_STEPS,
      maxGuard: PLAYER_PLACE_MAX_GUARD,
    });
    const moved =
      trayBefore > 0 || this.tray.length > 0
        ? this.tickBattleReposition('player', PLAYER_REPOSITION_MAX_STEPS)
        : 0;
    const total = placed + moved;
    if (total > 0) {
      if (placed > 0 && moved > 0) this.message = `布阵：落子 ${placed} 步，调位 ${moved} 步`;
      else if (placed > 0) this.message = `布阵：落子/合成 ${placed} 步`;
      else this.message = `布阵：调位 ${moved} 步`;
      this.autoplaceFlash = 1;
      if (placed > 0) this.emit('place');
    } else if (this.tray.length === 0 && this.units.size === 0 && this.words.size === 0) {
      this.message = '请先征兵，再点布阵';
    } else {
      this.message = '布阵：当前暂无可执行操作';
    }
  }

  // 便于自测/渲染读取的快照
  snapshot() {
    let maxDist = 0;
    for (const m of this.monsters) if (m.dist > maxDist) maxDist = m.dist;
    let skillMonsters = 0;
    for (const m of this.monsters) if (m.skill || m.isMiniBoss) skillMonsters++;
    let debuffed = 0;
    for (const u of this.units.values()) {
      if (u.stunT > 0 || u.slowT > 0 || u.weakenT > 0 || u.rangeCutT > 0 || u.knockdownT > 0) debuffed++;
    }
    // POW 诊断：塔总战力(ATK×FRQ×RGE×目标) 与 场上怪总战力(HP×SPD)，用于数值校准
    let towerPowTotal = 0;
    for (const u of this.units.values()) towerPowTotal += towerPOW(u.type, u.tier);
    let aiPowTotal = 0;
    for (const u of this.aiUnits) aiPowTotal += towerPOW(u.type, u.tier);
    let monsterPowTotal = 0;
    for (const m of this.monsters) monsterPowTotal += monsterPOW(m.hp, m.spd);
    return {
      peach: this.peach,
      tangsengHP: this.tangsengHP,
      wave: this.wave,
      status: this.status,
      summonCost: this.effectiveSummonCost(),
      unlocked: this.unlocked.size,
      tray: this.tray.length,
      shovels: this.shovels,
      units: this.units.size,
      monsters: this.monsters.length,
      dangerPct: Math.round((maxDist / this.pathLen) * 100), // 最靠前妖怪的推进百分比
      aiHp: this.aiTangsengHP,
      aiDefeated: this.aiDefeated,
      skillMonsters,
      debuffed,
      activesReady: this.activeSlots.filter((s) => s.ready).length, // 就绪的主动技能数
      towerPow: Math.round(towerPowTotal),
      optimalDps: Math.round(this.estimateOptimalPower().optimalDps),
      waveCount: this.waveMonsterCount,
      bossHpPlan: this.wavePressure?.bossHp != null ? Math.round(this.wavePressure.bossHp) : null,
      spawnInterval: this.wavePressure != null ? Math.round(this.wavePressure.spawnInterval * 100) / 100 : null,
      generals: this.activeGenerals().length,
      words: this.words.size,
      drops: this.pendingWeaponPickups.length,
      fragmentPlanned: this.battleFragmentDropId,
      fragmentDropped: this.battleFragmentDropped,
      bond: this.bondActive(),
      aiPow: Math.round(aiPowTotal),
      monsterPow: Math.round(monsterPowTotal),
      message: this.message,
    };
  }
}

// 供渲染层取色
export function unitColorOf(type: UnitType): string {
  switch (type) {
    case 'dao': return '#ff9a3c';
    case 'spear': return '#5bd1ff';
    case 'cavalry': return '#7dff8a';
    case 'archer': return '#c79bff';
  }
}

export { COLS, ROWS, isPathCell };
