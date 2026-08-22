// 局内战斗状态机。所有兵种/经济数值来自 game-core（@core），保证与原作数值一致。
import {
  UNITS,
  getUnitStat,
  towerPOW,
  damage,
  canMerge,
  merge as mergeUnits,
  MAX_TIER,
  ECONOMY,
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
  BOND_NAME,
  GENERAL_TUNING,
  ultTypeOf,
  heroAttackFxTtl,
  generalExpCostMul,
  type GeneralDef,
} from './generals';
import {
  activeHeroCharsFromPairs,
  collectOrphanChars,
  computeSummonWordPolicy,
  countChars,
  forcedMatchWordChars,
  matchedHeroIds,
  pickWordChar,
  yinSupportCharsPresent,
  PAIR_PITY_AFTER,
  type SummonWordPolicy,
  type SummonWordPolicyInput,
} from './word-draw';
import {
  rollWeaponDrop,
  weaponById,
  WEAPON_TUNING,
  type WeaponBonuses,
} from './weapons';
import { applyForceShovel, drawSummonTray } from './summon-draw';
import { earlySummonGates } from './summon-early';
import { planAutoPlaceSteps, planBattleReposition, runBattleReposition, aiHeroPartnerAdjustPending, rollAiAdjustInterval, autoPlaceBoardKey, PLAYER_PLACE_MAX_STEPS, PLAYER_PLACE_MAX_GUARD, PLAYER_PLACE_DEADLINE_MS, PLAYER_PLACE_DEADLINE_PREP_MS, PLAYER_REPOSITION_MAX_STEPS, AI_PLACE_MAX_STEPS, AI_PLACE_MAX_GUARD, AI_PLACE_DEADLINE_MS, AI_MAX_ORPHAN_WORDS, imminentPathScore, placeCellScore, engageThreatAt, type AutoPlaceView, type BattleRepositionView } from './autoplace';
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
  monsterHpFromBoardPower,
  BOARD_POWER,
  type BoardPowerResult,
  type PressurePlan,
} from './board-power';
import { activeById, isPillActiveEffect, isDragActiveEffect, MAX_EQUIPPED_ACTIVES, type ActiveEffect } from './actives';
import { MAX_EQUIPPED_PASSIVES, isPassiveEnabled, passiveById } from './passives';
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

// DevTools 模块级配置：第 N 次征兵必出指定英雄两字（跨 restart 持久）
// null = 关闭；非 null = 新 Battle 构造时自动读取
let DEV_FORCE_SUMMON_HERO: { heroId: string; summonN: number } | null = null;

export const TUNING = {
  monsterSpd: 0.6, // 格/秒
  dangerRemaining: 5, // 危险提示：怪物距唐僧沿路剩余 ≤ 该格数时触发
  monsterHpBase: 10, // 第 n 波静态公式 HP = base + step*n（爬坡期目标用）
  monsterHpStep: 13,
  monsterHpNoDiffTo: 3, // 波 1–3 用 monsterHpEarlyFixed；其后朝目标血量爬坡
  /** 前 monsterHpNoDiffTo 波绝对血量（不含境界）；爬坡起点取最后一档 */
  monsterHpEarlyFixed: [20, 40, 65],
  // 爬坡每波上限 = monsterHpStep × rampMulByCycle[cycle] + (wave − rampFrom)
  // cycle = floor((wave−1)/10)；按圈递增，抵消每圈 DPS ×1.2 增长
  monsterHpRampMulByCycle: [2, 4, 7, 10, 14],
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
  // —— 骑兵波（后期随机某波：占比随波次升高；移速 ×cavalrySpdMul、血量略低）——
  cavalryFromWave: 5, // 第 5 波起才可能出现骑兵波
  cavalryWaveChance: 0.5, // 达到后期后，每波成为骑兵波的概率
  cavalryRatioRampLoWave: 5, // 占比线性爬升：本波 → cavalryRatioRampHiWave
  cavalryRatioRampHiWave: 20,
  cavalryRatioRampStart: 0.3, // 第 5 波骑兵占比 30%
  cavalryRatioRampEnd: 0.55, // 第 20 波 55%
  cavalryRatioLateLo: 0.56, // 第 21 波起每波在 [lateLo, lateHi] 随机
  cavalryRatioLateHi: 0.7,
  cavalrySpdMul: 1.25, // 骑兵移速倍率：比普通妖快 25%
  cavalryHpMul: 2 / 3, // 骑兵血量倍率：比普通妖低 1/3（快怪用薄血换速度，避免 HP×移速 威胁翻倍）
  // —— 后期堆量：怪物数量在经济基准(9+n)之上，后期按超出波数额外叠加（越后越密，贴合"按战力堆量"）——
  lateWaveFrom: 6, // 第 6 波起开始额外堆量
  lateWaveExtraPerWave: 5, // 每超出一波额外 +5 只（越到后期越密，波6:+5 … 波12:+35）
  // —— 前期减量：开局前几波压低出怪数，降低上手压力（波1=7, 波2=9）——
  earlyWaveTo: 2, // 前 2 波享受减量
  earlyWaveReduce: 2, // 每提前一波多减 2 只（波2:-2, 波1:-4）；波1 另见 wave1Bonus
  wave1Bonus: 1, // 第一波在减量后再 +1
  minWaveMonsters: 5, // 单波出怪数下限（防止减量后过少）
  spawnInterval: 1.25, // 秒/批（基础出怪节奏；同批可随机 1..N 只）
  spawnIntervalMin: 0.35, // 出怪间隔下限
  summonCostStart: 10, // 首次征兵成本
  summonCostStep: 2, // 每次征兵后 +2（抽卡成本递增）
  summonDraws: 5, // 每次征兵产出 5 个候选（放入候选区）
  shovelDrawChance: 0.18, // 候选中出现铲子的概率
  shovelPityAfter: 4, // 铲子保底：连续 N 次征兵没出铲，则下次征兵强制出 1 把铲（避免没空位放兵）
  wordDrawChance: 0.08, // 候选中出现武将字牌的概率（每兵槽独立判定）
  wordPityAfter: 8, // 字牌保底：连续 N 次征兵没出字，则下次征兵强制把 1 个兵槽换成字
  pairPityAfter: PAIR_PITY_AFTER, // 半对保底：连续 N 次征兵仍有孤儿未补，则强制出配对字
  // —— 前期征兵配额（按征兵时所在波累计 tray 产出；不含 initialShovels）——
  earlyWordCapWave: 3, // 前 N 波字牌累计上限窗口
  earlyWordCap: 1, // 上限窗口内最多出几个字
  earlyWordGuaranteeWave: 6, // 到该波仍无字则强制出字
  earlyWordGuarantee: 1, // 前 earlyWordGuaranteeWave 波至少出几个字
  earlyShovelWave: 3, // 前 N 波铲子累计配额窗口
  earlyShovelMin: 1, // 窗口内至少出几把铲
  earlyShovelMax: 3, // 窗口内最多出几把铲
  summonMaxPerKey: 3, // 单次征兵同 key（兵种/铲）上限
  summonMaxPerKeyAllOpen: 5, // 阵位全开后：铲子无用，放宽同兵种上限到 5（更快堆同型合成）
  traySize: 5, // 候选区容量
  initialShovels: 2, // 开局赠送铲子数
  initialOpenSlots: 6, // 初始 6 个阵位（照搬原作初始6格）
  // —— 分圈难度（对战/无尽共用）：每 10 波为一圈，每进一圈怪物强度 ×endlessCycleStep ——
  endlessWavesPerCycle: 10,
  endlessCycleStep: 1.2,
  aiDpsBase: 8, // AI 对手拦截 DPS 基数
  aiDpsPerWave: 4, // AI 拦截 DPS 每波增量
  // —— 怪物等级与技能（精英/BOSS 会对附近武将释放减益，不改动基础数值，仅施加临时计时器）——
  eliteFromWave: 4, // 第 4 波起可能刷出精英妖（略推迟控场，降低开局秒杀感）
  eliteChance: 0.28, // 非 BOSS 怪成为精英的概率
  eliteMinGap: 2, // 两次带技能精英之间至少隔几只普通妖（避免连控导致大片兵器失效）
  skillRadius: 2, // 控制技能作用半径（格）
  skillTargetMin: 1, // 单次施法最少命中兵器数
  skillTargetMax: 2, // 单次施法最多命中兵器数（在半径内按距离取最近 N 把）
  skillInterval: 4.5, // 两次施法间隔（秒）
  skillFirstDelay: 2.5, // 入场后首次施法延迟（秒）
  stunDur: 4.0, // 眩晕（怪物精英/小Boss）：武器暂停攻击（秒）
  slowDur: 6, // 减速（霜缚）：武器攻击间隔拉长（秒；怪物小Boss霜缚，时长×2）
  slowCooldownMul: 1.6, // 减速期间冷却倍率（≈攻速×0.63）
  weakenDur: 3, // 降攻：攻击力削弱（秒）
  weakenAtkMul: 0.65, // 降攻期间攻击倍率
  webbindDur: 3.5, // 缠丝：攻击范围削减持续（秒）
  webbindRangeCut: 0.5, // 缠丝：有效射程 -0.5 格（见 updateUnits）
  debuffImmuneDur: 4.5, // 兵器对同一种 debuff 的免疫时间（秒，含效果期内）
  // —— 小 Boss（第 4 波之后、非妖王波：有概率刷出跨地图小头目，各带独立光环技能）——
  miniBossFromWave: 5, // 第 5 波起（第 4 波之后）才可能出现
  miniBossChance: 0.5, // 非 BOSS 波出现小 Boss 的概率
  miniBossHpMul: 3.5, // 血量相对普通妖倍数（介于精英与妖王之间）
  miniBossSpdMul: 0.82, // 移速略慢，给玩家反应窗口（blight/blood 等未特指种类用此默认）
  miniBossSpdMulSlow: 0.75, // 霜魄/撼地小 Boss 本体移速倍率（偏慢，给玩家反应）
  miniBossSpdMulFast: 1.1, // 疾风小 Boss 本体移速倍率（本身很快）
  miniBossRadius: 2.8, // 光环作用半径（格；gale/blood 用；frost/blight/quake 仍用 skillRadius）
  miniBossInterval: 4.0, // 两次施法间隔（秒）
  miniBossFirstDelay: 2.0, // 入场后首次施法延迟（秒）
  miniBossStealRadius: 3, // 黄狮精「卷走」作用半径（格）
  miniBossStealDelayMin: 1, // 出场后首次触发最短延时（秒）
  miniBossStealDelayMax: 20, // 出场后首次触发最长延时（秒）
  eliteHpMul: 1.4, // 精英血量倍数：精英掉落桃子是普通妖 4 倍，血量需相应更高，否则性价比失衡
  knockdownDur: 4.0, // 倒下（震地）：武器横躺、无法攻击（秒；怪物小Boss震地，时长×2）
  hasteDur: 3.0, // 疾风：周围妖怪加速持续（秒）
  hasteSpdMul: 1.25, // 疾风光环：周围妖怪加速期间移速倍率
  healPct: 0.08, // 血泉：每次回复目标最大生命的比例
  // —— AI 清场 / 紧箍咒 ——
  aiClearChargeTime: 20, // AI 从空到满的蓄力秒数
  aiClearRadius: 2.5, // AI 清场 / 紧箍咒作用半径（格）
  aiClearDmgMul: 2.3, // 清场伤害 = 当前波基础怪血 × 有效难度 × 该系数
  // —— 主动技能数值 ——
  palmPushCells: 7, // 如来神掌沿路击退格数（不再重置到 0）
  meteorDmgMul: 2.2, // 主动陨石：波基础怪血 × 有效难度 × 该系数
  meteorRadius: 2, // 陨石半径；被动「陨石」亦等最前活怪走过 ≥ 该值后再砸
  meteorPassiveDmgMul: 1.4, // 被动陨石更弱，避免与主动双吃
  jingguDmgMul: 2.3, // 紧箍咒伤害倍率（与 aiClear 对齐，用有效难度）
  bombDmgMul: 2.0, // 埋雷炸药：波基础怪血 × 有效难度 × 该系数（预判埋点，不需高于陨石）
  bombExplodeRadius: 2, // 炸药引爆后的 AOE 伤害半径（格）
  bombContactRadius: 0.55, // 妖怪进入炸药此半径即引爆（踏入触发）
  atkBuffMul: 1.4, // 仙丹单体攻击倍率
  frqBuffMul: 1.4, // 风火轮单体攻速倍率
  freezeStunDur: 3, // 冰封定身时长（全场；CD 24s）
  // —— AI 攻击型主动技能(陨石/紧箍咒)择时 ——
  aiOffensiveActiveMinDist: 8, // 最远怪物需已沿路走过该格数，才允许释放（避免开怪就死板打出）
  aiOffensiveActiveDelayMax: 2, // 达到距离条件后，再随机 0~该值秒才实际释放
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
  heroBuffAtkMulMain: 1.35, // 老君：友军攻击倍率
  heroBuffAtkMulTransit: 1.2, // 丹君：友军攻击倍率
  heroBuffDurMain: 5, // 老君增益时长（秒）
  heroBuffDurTransit: 3.5, // 丹君增益时长（秒）
  heroCdrSecMain: 4, // 文殊：其他武将大招剩余 CD 缩短（秒）
  heroCdrSecTransit: 2.5, // 慧殊：缩短秒数
  tangsengHurtImmuneDur: 1, // 唐僧漏怪扣血后短暂免疫（防同帧连扣）
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
  /** 清波后自动开下一波的等待秒数 */
  waveGapSec: 5,
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

/** 某波骑兵比例区间：5–20 线性 30%→55%；21+ 随机 [56%,70%]；开波时在区间内随机一次，逐怪独立判定 */
export function cavalryRatioBounds(wave: number): { start: number; max: number } {
  const w = Math.max(1, Math.floor(wave));
  if (w < TUNING.cavalryFromWave) return { start: 0, max: 0 };
  if (w > TUNING.cavalryRatioRampHiWave) {
    return { start: TUNING.cavalryRatioLateLo, max: TUNING.cavalryRatioLateHi };
  }
  const lo = TUNING.cavalryRatioRampLoWave;
  const hi = TUNING.cavalryRatioRampHiWave;
  const span = Math.max(1, hi - lo);
  const t = Math.min(1, Math.max(0, (w - lo) / span));
  const ratio = TUNING.cavalryRatioRampStart + t * (TUNING.cavalryRatioRampEnd - TUNING.cavalryRatioRampStart);
  return { start: ratio, max: ratio };
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
export type MiniBossKind = 'frost' | 'blight' | 'quake' | 'gale' | 'blood' | 'lion';
export const MINI_BOSS_KINDS: MiniBossKind[] = ['frost', 'blight', 'quake', 'gale', 'blood', 'lion'];
export const MINI_BOSS_META: Record<
  MiniBossKind,
  { name: string; skillName: string; color: string; icon: string; desc: string }
> = {
  frost: { name: '霜魄妖', skillName: '霜缚', color: '#7ec8ff', icon: '霜', desc: '范围内兵器攻速↓' },
  blight: { name: '蚀甲妖', skillName: '蚀甲', color: '#c77dff', icon: '蚀', desc: '范围内兵器伤害↓' },
  quake: { name: '撼地妖', skillName: '震地', color: '#e0a060', icon: '震', desc: '范围内兵器倒下' },
  gale: { name: '疾风妖', skillName: '疾风', color: '#7dffb0', icon: '风', desc: '周围妖怪加速' },
  blood: { name: '血泉妖', skillName: '血泉', color: '#ff6a7a', icon: '血', desc: '周围妖怪少量回血' },
  lion: { name: '黄狮精', skillName: '卷走', color: '#e8c24a', icon: '偷', desc: '随机卷走3格内一件兵器/英雄/桃树' },
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
  | { kind: 'word'; char: string; general: string; tier: number; fabaofuBoosted?: boolean; displaced?: boolean }
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
  /** 仙丹：本局该兵器攻击 +40%（每单位一次） */
  pillAtk?: boolean;
  /** 风火轮：本局该兵器攻速 +40%（每单位一次） */
  pillFrq?: boolean;
  /** 老君/丹君炼丹：攻击增益剩余秒数 */
  buffAtkT?: number;
  /** 炼丹攻击倍率（与 buffAtkT 成对） */
  buffAtkMul?: number;
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

/** 棋盘同型同阶合成：保留幸存格坐标/减益等，并合并两单位的仙丹/风火轮/炼丹增益 */
function mergePlacedUnitState(
  survivor: PlacedUnit,
  consumed: PlacedUnit,
  merged: { type: UnitType; tier: number },
): PlacedUnit {
  const out: PlacedUnit = {
    ...survivor,
    type: merged.type,
    tier: merged.tier,
    cooldown: 0,
  };
  if (survivor.pillAtk || consumed.pillAtk) out.pillAtk = true;
  else delete out.pillAtk;
  if (survivor.pillFrq || consumed.pillFrq) out.pillFrq = true;
  else delete out.pillFrq;
  const sT = survivor.buffAtkT ?? 0;
  const cT = consumed.buffAtkT ?? 0;
  if (sT >= cT && sT > 0) {
    out.buffAtkT = sT;
    if (survivor.buffAtkMul != null) out.buffAtkMul = survivor.buffAtkMul;
    else delete out.buffAtkMul;
  } else if (cT > 0) {
    out.buffAtkT = cT;
    if (consumed.buffAtkMul != null) out.buffAtkMul = consumed.buffAtkMul;
    else delete out.buffAtkMul;
  } else {
    delete out.buffAtkT;
    delete out.buffAtkMul;
  }
  return out;
}

// 棋盘上的单个武将字牌（占一格，带阶数；同字同阶可合并升阶）
export interface PlacedWord {
  char: string;
  general: string; // 所属武将 id
  tier: number;
  cell: Cell;
  fabaofuBoosted?: boolean; // 法宝符：该字牌已参与过首次激活升阶
}

function placedWordFromTray(token: Extract<TrayToken, { kind: 'word' }>, cell: Cell): PlacedWord {
  return {
    char: token.char,
    general: token.general,
    tier: token.tier,
    cell,
    ...(token.fabaofuBoosted ? { fabaofuBoosted: true } : {}),
  };
}

function trayWordFromPlaced(w: PlacedWord, extra?: { displaced?: boolean }): Extract<TrayToken, { kind: 'word' }> {
  return {
    kind: 'word',
    char: w.char,
    general: w.general,
    tier: w.tier,
    ...(w.fabaofuBoosted ? { fabaofuBoosted: true } : {}),
    ...extra,
  };
}

// 蟠桃园桃树：种在「未开垦」空地上，按等级周期产桃，同级可拖动合并升级（最高 5 级）。
export interface PeachTree {
  level: number; // 1..5
  cell: Cell;
  growT: number; // 距下次产桃已累积秒数
}
// 各等级产 1 桃的间隔（秒）：1级20s / 2级10s / 3级5s / 4级3s / 5级2s
/** 蟠桃园可调参数（DevTools 可改；intervals 为同一数组引用） */
export const PEACH_TREE = {
  intervals: [20, 10, 5, 3, 2] as number[],
  maxLevel: 5,
  plantInterval: 40, // 蟠桃园每 40s 自动种 1 棵
};
export const PEACH_TREE_INTERVALS = PEACH_TREE.intervals;
/** @deprecated 快照；运行时请读 PEACH_TREE.maxLevel */
export const PEACH_TREE_MAX_LEVEL = PEACH_TREE.maxLevel;
/** @deprecated 快照；运行时请读 PEACH_TREE.plantInterval */
export const PEACH_TREE_PLANT_INTERVAL = PEACH_TREE.plantInterval;

/** 地图上全是 N 级树时，蟠桃园累计多少棵「虚拟树」才合并升级 1 棵（N→N+1） */
export function peachTreeMergeBankNeed(level: number): number {
  return 1 << Math.max(0, level - 1);
}

export const SKILL_FX_DUR = 0.8; // 主动技能爆发特效时长（秒）
export const BUFF_SKILL_FX_DUR = 1.25; // 仙丹/风火轮施放冲击特效（秒，略长便于感知）
/** @deprecated 使用 SKILL_FX_DUR */
export const PALM_PUSH_DUR = SKILL_FX_DUR;
/** 推到底后残影快速淡出时长（秒） */
export const PALM_PUSH_FADE_DUR = 0.2;

// 如来神掌沿路回推动画：从最前怪沿路径逐格回推
export interface PalmPushFx {
  t: number;
  dur: number;
  fadeT: number;
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
// level = 升阶次数；exp = 当前升阶进度（选中面板展示「经验 当前/目标」）
export interface GeneralState {
  level: number;
  exp: number;
  cooldown: number;
  skillCd: number;
  firePulse: number;
  fireDir?: number; // 上次开火朝向(弧度)，字牌攻击时驱动兵器形变
  skillFlash: number;
  /** 仙丹：本局攻击 +40%（按格子对持久化，ActiveGeneral 每次调用都是新对象，须存这里才不丢） */
  pillAtk?: boolean;
  /** 风火轮：本局攻速 +40% */
  pillFrq?: boolean;
  /** 老君/丹君炼丹：攻击增益剩余秒数 */
  buffAtkT?: number;
  /** 炼丹增益期间生效的攻击倍率（由施法者满5/满3决定） */
  buffAtkMul?: number;
  /** 该武将对首次组成时的波次（满3→满5 切换爬坡用：相对此波次后续 4-10 波提升同门满5非共享字权重） */
  formedWave?: number;
}

// 由「左右紧邻的两个同将字牌」激活的武将（占两格，带金框）
export interface ActiveGeneral {
  def: GeneralDef;
  tier: number; // 取两字阶数的较小值
  cells: [Cell, Cell];
  state: GeneralState;
  /** 仙丹：本局攻击 +40%（从 state.pillAtk 同步，写入请走 state） */
  pillAtk?: boolean;
  /** 风火轮：本局攻速 +40%（从 state.pillFrq 同步，写入请走 state） */
  pillFrq?: boolean;
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
  isCavalry: boolean; // 骑兵：移速 ×cavalrySpdMul、血量 ×cavalryHpMul（骑兵波中按本波随机比例，BOSS 不会是骑兵）
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
  miniBossCasted: boolean; // 黄狮精「卷走」一次性开关：偷到一次后置 true，本局不再施法
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
  biteC?: number;        // 二郎神哮天犬咬击目标格（最前怪 3 格内血量最高者）
  biteR?: number;
  /** 二郎神哮天犬咬住的怪物 id（3s 内狗跟随该怪；怪死亡则狗消失） */
  biteMid?: number;
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

/** 布阵动画 / 间隔（DevTools 可改） */
export const PLACE_TIMING = {
  digDur: 0.5, // 铲子挖坑动画时长（铲两下）
  dropDur: 0.03, // AI 落子：自半场顶加速落入格心的时长（秒）
  dragDur: 0.18, // 玩家一键布阵：候选区→目标格虚线拖拽时长（秒）
  staggerMin: 0.2, // 连续落子之间的最短间隔（秒）
  staggerMax: 0.25, // 连续落子之间的最长间隔（秒）
};
/** @deprecated 快照；运行时请读 PLACE_TIMING.* */
export const DIG_DUR = PLACE_TIMING.digDur;
export const PLACE_DROP_DUR = PLACE_TIMING.dropDur;
export const PLACE_DRAG_DUR = PLACE_TIMING.dragDur;
export const PLACE_DROP_STAGGER_MIN = PLACE_TIMING.staggerMin;
export const PLACE_DROP_STAGGER_MAX = PLACE_TIMING.staggerMax;

/** 布阵拖拽缓动：先快后慢（ease-out） */
export function placeDragEase(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  return 1 - (1 - t) ** 4;
}

/** 玩家一键布阵：模拟从候选区选中并拖向棋盘（非掉落） */
export interface AutoPlaceDragFx {
  trayIndex: number;
  token: TrayToken;
  c: number;
  r: number;
  t: number;
  sfx: 'place' | 'merge' | 'general' | 'shovel';
  commit: 'placeUnit' | 'placeWord' | 'mergeUnit' | 'feedGeneralWord' | 'digShovel';
  generalCells?: Cell[];
}

/** 玩家一键布阵回放步（先规划再逐步执行，tray 逐个清空） */
export type AutoPlacePlaybackStep =
  | { kind: 'place'; trayIndex: number; cell: Cell; token: TrayToken }
  | { kind: 'mergeTray'; from: number; to: number }
  | { kind: 'mergeBoard'; from: Cell; to: Cell }
  | { kind: 'moveUnit'; from: Cell; to: Cell }
  | { kind: 'swapUnits'; a: Cell; b: Cell }
  | { kind: 'swapUnitWord'; unitCell: Cell; wordCell: Cell }
  | { kind: 'moveWord'; from: Cell; to: Cell }
  | { kind: 'swapWords'; from: Cell; to: Cell }
  | { kind: 'displaceToTray'; cell: Cell }
  | { kind: 'removeWord'; cell: Cell };

/** 棋盘落子掉落动效（AI 布阵与用户点「布阵」） */
export interface PlaceDropFx {
  side: 'player' | 'ai';
  c: number;
  r: number;
  delay: number; // 开始掉落前的等待（秒）
  t: number;
  kind: 'unit' | 'word';
  isMerge: boolean;
  sfx: 'place' | 'merge' | 'general';
  landed: boolean;
  playSfx?: boolean;
  unitType?: UnitType;
  unitTier?: number;
  char?: string;
  wordTier?: number;
}

interface Modifiers {
  atkMul: number;
  frqMul: number;
  killBonus: number;
  monsterSpdMul: number;
  summonCostDelta: number;
  wordRateBonus: number; // 招贤榜：字牌掉率加成
  shovelPeach: number; // 摸金校尉：每次开挖额外蟠桃
  autoShovel: boolean; // 洛阳铲：定期产铲
  meteor: boolean; // 陨石：每波待最前活怪走过 ≥ 半径后再砸（便于砸中一波）
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
  peach = ECONOMY.INITIAL_PEACH;
  tangsengHP = ECONOMY.TANGSENG_INITIAL_HP;
  wave = 0;
  status: Status = 'ready';
  summonCost = TUNING.summonCostStart;
  summonCount = 0;
  private summonsSinceShovel = 0; // 距上次出铲经过的征兵次数（铲子保底计数）
  private summonsSinceWord = 0; // 距上次出字经过的征兵次数（字牌保底计数）
  private summonsSincePair = 0; // 距上次补上孤儿配对经过的征兵次数（半对保底）
  /** 波 ≤ earlyWordCapWave 征兵抽出的字牌累计 */
  private earlySummonWordsCap = 0;
  /** 波 ≤ earlyWordGuaranteeWave 征兵抽出的字牌累计 */
  private earlySummonWordsGuarantee = 0;
  /** 波 ≤ earlyShovelWave 征兵抽出的铲子累计（不含开局赠铲） */
  private earlySummonShovels = 0;
  /** 本局各字累计出现次数（棋盘实例 + 历次征兵抽字），用于后续抽字概率打压 */
  private wordCharCounts = new Map<string, number>();

  units = new Map<string, PlacedUnit>();
  words = new Map<string, PlacedWord>(); // 棋盘上的武将字牌（各占一格）
  trees = new Map<string, PeachTree>(); // 蟠桃园桃树（各占一格未开垦地）
  gardenOn = false; // 是否装备了「蟠桃园」被动技能（每日购买）
  private plantTimer = 0; // 距下次自动种树累积秒数
  private plantBank = 0; // 满格时蟠桃园累积的「虚拟树」，达阈值后合并升级
  palmPushFx: PalmPushFx | null = null; // 如来神掌沿路回推（玩家半场）
  aiPalmPushFx: PalmPushFx | null = null; // 如来神掌沿路回推（AI 半场）
  playerSkillFx: SkillFx | null = null; // 玩家半场主动技能爆发特效
  aiSkillFx: SkillFx | null = null; // AI 半场主动技能爆发特效
  generalStates = new Map<string, GeneralState>(); // 各激活对的经验/冷却（按格子对 key，非武将 id）
  private lastActivePairKeys = new Set<string>(); // 上一帧已激活对，用于检测新激活并重置大招 CD 为满
  monsters: Monster[] = [];
  fx: HitFx[] = [];
  bursts: Burst[] = []; // 命中/击杀/合成爆发特效
  heroUltFx: HeroUltFx[] = []; // 武将大招专属特效
  // 埋雷炸药（主动技能 bomb）：路径上待引爆的地雷，可埋多颗、同一格子最多一颗；t 累积秒用于引信闪烁
  bombs: { c: number; r: number; t: number }[] = [];
  aiBombs: { c: number; r: number; t: number }[] = [];
  bombFx: { c: number; r: number; ttl: number; maxTtl: number; ai: boolean }[] = []; // 引爆爆炸特效
  peachFloats: PeachFloat[] = []; // 击杀蟠桃飘字
  damageFloats: DamageFloat[] = []; // 受击伤害飘字
  digFx: { c: number; r: number; t: number }[] = []; // 铲子挖坑动画(来回两下)，t 累积秒数
  aiDigFx: { c: number; r: number; t: number }[] = []; // AI 侧挖坑动画（对称展示，见 render）
  placeDropFx: PlaceDropFx[] = []; // AI 落子：自上方快速掉落的动效
  autoPlaceDragFx: AutoPlaceDragFx[] = []; // 玩家一键布阵：候选区→棋盘虚线拖拽
  // 自动布阵对"刚挖开、开格动画未完"的格做的延迟落子：先预占该格，动画结束后由 updateFx 真正落子。
  private pendingPlace: { token: TrayToken; c: number; r: number; dropAnim: boolean; trayIndex?: number; keepInTray?: boolean }[] = [];
  private aiPendingPlace: { token: TrayToken; c: number; r: number }[] = [];
  private placeDropAnimDepth = 0; // >0 时玩家一键布阵走虚线拖拽（非掉落）
  private placeDropStagger: Record<'player' | 'ai', number> = { player: 0, ai: 0 };
  private autoPlaceRecorder: AutoPlacePlaybackStep[] | null = null;
  private autoPlaceRecording = false;
  private autoPlacePlayback: AutoPlacePlaybackStep[] = [];
  private autoPlacePlaying = false;
  private autoPlacePlaybackWait = false;
  private autoPlacePlaybackGap = 0;
  private autoPlaceRepositionPending = false;
  private aiAutoPlaceRecorder: AutoPlacePlaybackStep[] | null = null;
  private aiAutoPlaceRecording = false;
  private aiAutoPlacePlayback: AutoPlacePlaybackStep[] = [];
  private aiAutoPlacePlaying = false;
  private aiAutoPlacePlaybackWait = false;
  private aiAutoPlacePlaybackGap = 0;
  summonFlash = 0; // 征兵闪光(1→0)
  autoplaceFlash = 0; // 布阵闪光(1→0)
  /** 上次一键布阵前的局面指纹（含兵器+字牌+候选）；跨点击阻止 A↔B 对抖 */
  private lastAutoPlaceBoardKey: string | null = null;
  private lastAiAutoPlaceBoardKey: string | null = null;

  private clearAutoPlaceLayoutMemory(): void {
    this.lastAutoPlaceBoardKey = null;
  }

  private clearAiAutoPlaceLayoutMemory(): void {
    this.lastAiAutoPlaceBoardKey = null;
  }

  /** 深拷贝棋盘兵器/字牌/武将状态，供布阵对抖时回滚 */
  private cloneAutoplaceLayout(): {
    units: Map<string, PlacedUnit>;
    words: Map<string, PlacedWord>;
    generalStates: Map<string, GeneralState>;
  } {
    const units = new Map<string, PlacedUnit>();
    for (const [k, u] of this.units) {
      units.set(k, { ...u, cell: { ...u.cell }, fireDir: { ...u.fireDir } });
    }
    const words = new Map<string, PlacedWord>();
    for (const [k, w] of this.words) {
      words.set(k, { ...w, cell: { ...w.cell } });
    }
    return { units, words, generalStates: new Map(this.generalStates) };
  }

  private restoreAutoplaceLayout(snap: ReturnType<Battle['cloneAutoplaceLayout']>): void {
    this.units = snap.units;
    this.words = snap.words;
    this.generalStates = snap.generalStates;
  }

  /** 玩家布阵回放：含 tray / 延迟落子 / 开挖动画，便于规划后整局回滚再逐步播放 */
  private clonePlayerAutoPlaceSession(): {
    layout: ReturnType<Battle['cloneAutoplaceLayout']>;
    tray: TrayToken[];
    pendingPlace: { token: TrayToken; c: number; r: number; dropAnim: boolean; trayIndex?: number; keepInTray?: boolean }[];
    digFx: { c: number; r: number; t: number }[];
    unlocked: Set<string>;
  } {
    return {
      layout: this.cloneAutoplaceLayout(),
      tray: this.tray.map((t) => (t ? ({ ...t } as TrayToken) : t)) as TrayToken[],
      pendingPlace: this.pendingPlace.map((p) => ({ ...p, token: { ...p.token } as TrayToken })),
      digFx: this.digFx.map((d) => ({ ...d })),
      unlocked: new Set(this.unlocked),
    };
  }

  private restorePlayerAutoPlaceSession(snap: ReturnType<Battle['clonePlayerAutoPlaceSession']>): void {
    this.restoreAutoplaceLayout(snap.layout);
    this.tray = snap.tray.map((t) => (t ? ({ ...t } as TrayToken) : t)) as TrayToken[];
    this.pendingPlace = snap.pendingPlace.map((p) => ({ ...p, token: { ...p.token } as TrayToken }));
    this.digFx = snap.digFx.map((d) => ({ ...d }));
    this.unlocked = snap.unlocked;
  }

  private recordAutoPlaceStep(step: AutoPlacePlaybackStep): void {
    this.autoPlaceRecorder?.push(step);
  }

  /** AI 半场：兵器数组 + 字牌 + 候选 + 上次调位对（布阵/战中调整共用） */
  private cloneAiAutoplaceLayout(): {
    units: PlacedUnit[];
    words: Map<string, PlacedWord>;
    generalStates: Map<string, GeneralState>;
    tray: TrayToken[];
    lastRepositionPair: { a: Cell; b: Cell } | null;
  } {
    const units = this.aiUnits.map((u) => ({ ...u, cell: { ...u.cell }, fireDir: { ...u.fireDir } }));
    const words = new Map<string, PlacedWord>();
    for (const [k, w] of this.aiWords) {
      words.set(k, { ...w, cell: { ...w.cell } });
    }
    const tray = this.aiTray.map((t) => (t ? ({ ...t } as TrayToken) : t)) as TrayToken[];
    const lastRepositionPair = this.aiLastRepositionPair
      ? { a: { ...this.aiLastRepositionPair.a }, b: { ...this.aiLastRepositionPair.b } }
      : null;
    return { units, words, generalStates: new Map(this.aiGeneralStates), tray, lastRepositionPair };
  }

  private restoreAiAutoplaceLayout(snap: ReturnType<Battle['cloneAiAutoplaceLayout']>): void {
    this.aiUnits = snap.units;
    this.aiWords = snap.words;
    this.aiGeneralStates = snap.generalStates;
    this.aiTray = snap.tray;
    this.aiLastRepositionPair = snap.lastRepositionPair;
  }

  /** AI 布阵回放：含 tray / 延迟落子 / 开挖动画，规划后回滚再逐步播放 */
  private cloneAiAutoPlaceSession(): {
    layout: ReturnType<Battle['cloneAiAutoplaceLayout']>;
    digFx: { c: number; r: number; t: number }[];
    pendingPlace: { token: TrayToken; c: number; r: number }[];
    unlocked: Set<string>;
  } {
    return {
      layout: this.cloneAiAutoplaceLayout(),
      digFx: this.aiDigFx.map((d) => ({ ...d })),
      pendingPlace: this.aiPendingPlace.map((p) => ({ ...p, token: { ...p.token } as TrayToken })),
      unlocked: new Set(this.aiUnlocked),
    };
  }

  private restoreAiAutoPlaceSession(snap: ReturnType<Battle['cloneAiAutoPlaceSession']>): void {
    this.restoreAiAutoplaceLayout(snap.layout);
    this.aiDigFx = snap.digFx.map((d) => ({ ...d }));
    this.aiPendingPlace = snap.pendingPlace.map((p) => ({ ...p, token: { ...p.token } as TrayToken }));
    this.aiUnlocked = snap.unlocked;
  }

  private recordAiAutoPlaceStep(step: AutoPlacePlaybackStep): void {
    this.aiAutoPlaceRecorder?.push(step);
  }

  /** 布阵后提交局面指纹；若回到上一版布局则回滚并返回 false */
  private commitAutoPlaceLayoutMemory(
    side: 'player' | 'ai',
    layoutSnap: ReturnType<Battle['cloneAutoplaceLayout']> | ReturnType<Battle['cloneAiAutoplaceLayout']>,
    keyBefore: string,
  ): boolean {
    const keyAfter = autoPlaceBoardKey(side === 'player' ? this.buildPlayerAutoView() : this.buildAiAutoView());
    const lastKey = side === 'player' ? this.lastAutoPlaceBoardKey : this.lastAiAutoPlaceBoardKey;
    if (keyAfter !== keyBefore && lastKey !== null && keyAfter === lastKey) {
      if (side === 'player') this.restoreAutoplaceLayout(layoutSnap as ReturnType<Battle['cloneAutoplaceLayout']>);
      else this.restoreAiAutoplaceLayout(layoutSnap as ReturnType<Battle['cloneAiAutoplaceLayout']>);
      return false;
    }
    if (keyAfter !== keyBefore) {
      if (side === 'player') this.lastAutoPlaceBoardKey = keyBefore;
      else this.lastAiAutoPlaceBoardKey = keyBefore;
    }
    return true;
  }
  summonAnimT = 999; // 距上次征兵的秒数（用于候选令牌逐个"飞入槽位"的入场动画）
  sfxEvents: string[] = []; // 引擎发出的音效事件名，由音频层每帧取走播放（保持引擎与DOM解耦）
  private emit(name: string): void { if (this.sfxEvents.length < 32) this.sfxEvents.push(name); }

  private beginPlaceDropAnim(): void {
    this.placeDropAnimDepth += 1;
    if (this.placeDropAnimDepth === 1) this.placeDropStagger.player = 0;
  }
  private endPlaceDropAnim(): void { this.placeDropAnimDepth = Math.max(0, this.placeDropAnimDepth - 1); }
  private beginAiPlaceDropStagger(): void { this.placeDropStagger.ai = 0; }

  private nextPlaceDropDelay(side: 'player' | 'ai'): number {
    if (side === 'player' && this.autoPlacePlaying) return 0;
    const delay = this.placeDropStagger[side];
    const rng = side === 'ai' ? this.aiRng : this.rng;
    this.placeDropStagger[side] +=
      PLACE_TIMING.staggerMin + rng.next() * (PLACE_TIMING.staggerMax - PLACE_TIMING.staggerMin);
    return delay;
  }

  private rollAutoPlaceStagger(): number {
    return PLACE_TIMING.staggerMin + this.rng.next() * (PLACE_TIMING.staggerMax - PLACE_TIMING.staggerMin);
  }

  private playerUseAutoPlaceDrag(): boolean {
    return this.autoPlacePlaying && this.placeDropAnimDepth > 0;
  }

  /** 玩家一键布阵：延迟落子，先播候选区→目标格虚线拖拽，着地再真正落子 */
  private queueAutoPlaceDrag(
    trayIndex: number,
    cell: Cell,
    token: TrayToken,
    commit: AutoPlaceDragFx['commit'],
    sfx: AutoPlaceDragFx['sfx'],
    generalCells?: Cell[],
  ): boolean {
    if (this.autoPlaceDragFx.some((d) => d.c === cell.c && d.r === cell.r)) return false;
    // 同一 tray 槽不可排队两次（否则 commit 用克隆 token 会「复制」出第二份字/兵）
    if (this.autoPlaceDragFx.some((d) => d.trayIndex === trayIndex)) return false;
    const cur = this.tray[trayIndex];
    if (!cur || !this.trayTokensMatch(cur, token)) return false;
    // 排队时预扣 tray，避免回放多步/同字双份时二次匹配到同一槽
    this.clearTraySlot(trayIndex);
    this.autoPlaceDragFx.push({
      trayIndex,
      token: this.cloneTrayToken(token),
      c: cell.c,
      r: cell.r,
      t: 0,
      sfx,
      commit,
      ...(generalCells ? { generalCells } : {}),
    });
    return true;
  }

  /** 拖拽中止/落子失败：把预扣的令牌退回原 tray 槽 */
  private restoreQueuedAutoPlaceToken(d: AutoPlaceDragFx): void {
    if (!this.tray[d.trayIndex]) {
      this.tray[d.trayIndex] = this.cloneTrayToken(d.token);
    }
  }

  /** commit 时目标格是否可落：忽略「自己」这条 drag 预占（cellFree 会把 drag 格算占用） */
  private cellFreeForAutoPlaceCommit(c: number, r: number, self: AutoPlaceDragFx): boolean {
    return !this.units.has(cellKey(c, r))
      && !this.words.has(cellKey(c, r))
      && !this.pendingPlace.some((p) => p.c === c && p.r === r)
      && !this.autoPlaceDragFx.some((d) => d !== self && d.c === c && d.r === r);
  }

  private commitAutoPlaceDrag(d: AutoPlaceDragFx): void {
    // 必须仍在排队中：禁止对已提交/伪造的 drag 用克隆 token 再落一份（字牌复制 bug）
    if (!this.autoPlaceDragFx.includes(d)) return;
    const cell = { c: d.c, r: d.r };
    const k = cellKey(d.c, d.r);
    // tray 已在 queue 时预扣；此处只消费克隆 token，失败则退回
    switch (d.commit) {
      case 'placeUnit': {
        const t = d.token;
        if (t.kind !== 'unit') {
          this.restoreQueuedAutoPlaceToken(d);
          break;
        }
        if (!this.isUnlocked(cell.c, cell.r) || !this.cellFreeForAutoPlaceCommit(cell.c, cell.r, d)) {
          this.restoreQueuedAutoPlaceToken(d);
          break;
        }
        this.units.set(k, makePlacedUnit(t.type, t.tier, cell, this.unitFaceGate()));
        break;
      }
      case 'placeWord': {
        const t = d.token;
        if (t.kind !== 'word') {
          this.restoreQueuedAutoPlaceToken(d);
          break;
        }
        if (!this.isUnlocked(cell.c, cell.r) || !this.cellFreeForAutoPlaceCommit(cell.c, cell.r, d)) {
          this.restoreQueuedAutoPlaceToken(d);
          break;
        }
        this.words.set(k, placedWordFromTray(t, cell));
        break;
      }
      case 'mergeUnit': {
        const t = d.token;
        if (t.kind !== 'unit') {
          this.restoreQueuedAutoPlaceToken(d);
          break;
        }
        const exist = this.units.get(k);
        if (!exist) {
          if (!this.isUnlocked(cell.c, cell.r) || !this.cellFreeForAutoPlaceCommit(cell.c, cell.r, d)) {
            this.restoreQueuedAutoPlaceToken(d);
            break;
          }
          this.units.set(k, makePlacedUnit(t.type, t.tier, cell, this.unitFaceGate()));
          break;
        }
        if (!canMerge({ type: exist.type, tier: exist.tier }, { type: t.type, tier: t.tier })) {
          this.restoreQueuedAutoPlaceToken(d);
          break;
        }
        const merged = mergeUnits({ type: exist.type, tier: exist.tier }, { type: t.type, tier: t.tier });
        this.units.set(k, mergePlacedUnitState(exist, makePlacedUnit(t.type, t.tier, cell), merged));
        this.bursts.push({ kind: 'merge', c: d.c, r: d.r, ttl: 0.35, maxTtl: 0.35, big: false, color: '#ffd76a' });
        break;
      }
      case 'feedGeneralWord': {
        const t = d.token;
        if (t.kind !== 'word' || !d.generalCells || d.generalCells.length < 2) {
          this.restoreQueuedAutoPlaceToken(d);
          break;
        }
        const wa = this.wordAt(d.generalCells[0]!.c, d.generalCells[0]!.r);
        const wb = this.wordAt(d.generalCells[1]!.c, d.generalCells[1]!.r);
        if (!wa || !wb) {
          this.restoreQueuedAutoPlaceToken(d);
          break;
        }
        wa.tier += 1;
        wb.tier += 1;
        for (const cc of d.generalCells) {
          this.bursts.push({
            kind: 'merge',
            c: cc.c,
            r: cc.r,
            ttl: 0.35,
            maxTtl: 0.35,
            big: false,
            color: qualityColor(wa.tier),
          });
        }
        break;
      }
      case 'digShovel': {
        if (this.isUnlocked(cell.c, cell.r) || !this.isPlaceable(cell.c, cell.r) || this.trees.has(k)) {
          this.restoreQueuedAutoPlaceToken(d);
          break;
        }
        this.unlocked.add(k);
        this.digFx.push({ c: cell.c, r: cell.r, t: 0 });
        this.peach += this.mods.shovelPeach;
        this.message = this.mods.shovelPeach > 0
          ? `挖开新阵位（摸金 +${this.mods.shovelPeach}桃）`
          : '铲子挖开了新阵位';
        break;
      }
      default: {
        const _exhaustive: never = d.commit;
        void _exhaustive;
      }
    }
    this.emit(d.sfx);
  }

  /** 落子/合成：AI 播掉落动效；玩家手动拖拽即时发声；玩家一键布阵走虚线拖拽 */
  private spawnPlaceDropFx(
    side: 'player' | 'ai',
    cell: Cell,
    opts: {
      kind: 'unit' | 'word';
      isMerge: boolean;
      sfx: 'place' | 'merge' | 'general';
      unitType?: UnitType;
      unitTier?: number;
      char?: string;
      wordTier?: number;
      playSfx?: boolean;
    },
  ): void {
    if (side === 'player' && this.autoPlaceRecording) return;
    if (side === 'ai' && this.aiAutoPlaceRecording) return;
    if (side === 'player') {
      if (this.playerUseAutoPlaceDrag()) return;
      if (this.placeDropAnimDepth <= 0) {
        this.emit(opts.sfx);
        return;
      }
    }
    this.placeDropFx.push({
      side,
      c: cell.c,
      r: cell.r,
      delay: this.nextPlaceDropDelay(side),
      t: 0,
      landed: false,
      ...opts,
    });
  }

  private playerWordPlaceSfx(cell: Cell): 'place' | 'general' {
    return this.activeGenerals().some((g) => g.cells.some((cc) => cc.c === cell.c && cc.r === cell.r))
      ? 'general'
      : 'place';
  }

  private aiWordPlaceSfx(cell: Cell): 'place' | 'general' {
    return this.aiActiveGenerals().some((g) => g.cells.some((cc) => cc.c === cell.c && cc.r === cell.r))
      ? 'general'
      : 'place';
  }

  /** 步间等待：仅虚线拖拽未着地时阻塞；挖坑/预占不挡其他格并行落子 */
  private playerPlaceAnimBusy(): boolean {
    return this.autoPlaceDragFx.length > 0;
  }

  /** 布阵收尾：拖拽、挖坑、延迟落子都结束后才 finish（新坑武器等挖完再落） */
  private playerPlaceAnimSettleBusy(): boolean {
    return this.autoPlaceDragFx.length > 0
      || this.pendingPlace.length > 0
      || this.digFx.length > 0;
  }

  /** 步间等待：仅 AI 落子掉落未完成时阻塞；挖坑/预占不挡其他格 */
  private aiPlaceAnimBusy(): boolean {
    return this.placeDropFx.some((d) => d.side === 'ai' && (d.delay > 0 || d.t < PLACE_TIMING.dropDur));
  }

  private aiPlaceAnimSettleBusy(): boolean {
    return this.aiPlaceAnimBusy()
      || this.aiPendingPlace.length > 0
      || this.aiDigFx.length > 0;
  }

  private cloneTrayToken(t: TrayToken): TrayToken {
    switch (t.kind) {
      case 'unit':
        return { kind: 'unit', type: t.type, tier: t.tier, ...(t.displaced ? { displaced: true } : {}) };
      case 'word':
        return { kind: 'word', char: t.char, general: t.general, tier: t.tier, ...(t.fabaofuBoosted ? { fabaofuBoosted: true } : {}), ...(t.displaced ? { displaced: true } : {}) };
      case 'shovel':
        return { kind: 'shovel' };
      case 'tree':
        return { kind: 'tree', level: t.level, growT: t.growT };
      default: {
        const _exhaustive: never = t;
        void _exhaustive;
        return { kind: 'shovel' };
      }
    }
  }

  private trayTokensMatch(a: TrayToken, b: TrayToken): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
      case 'unit':
        return b.kind === 'unit' && a.type === b.type && a.tier === b.tier;
      case 'word':
        return b.kind === 'word' && a.char === b.char && a.tier === b.tier && a.general === b.general;
      case 'shovel':
        return true;
      case 'tree':
        return b.kind === 'tree' && a.level === b.level;
      default: {
        const _exhaustive: never = a;
        void _exhaustive;
        return false;
      }
    }
  }

  private findTrayIndexForPlaceStep(step: Extract<AutoPlacePlaybackStep, { kind: 'place' }>): number | null {
    const direct = this.tray[step.trayIndex];
    if (direct && this.trayTokensMatch(direct, step.token)) return step.trayIndex;
    for (let i = 0; i < this.tray.length; i++) {
      const t = this.tray[i];
      if (t && this.trayTokensMatch(t, step.token)) return i;
    }
    return null;
  }

  private findAiTrayIndexForPlaceStep(step: Extract<AutoPlacePlaybackStep, { kind: 'place' }>): number | null {
    const direct = this.aiTray[step.trayIndex];
    if (direct && this.trayTokensMatch(direct, step.token)) return step.trayIndex;
    for (let i = 0; i < this.aiTray.length; i++) {
      const t = this.aiTray[i];
      if (t && this.trayTokensMatch(t, step.token)) return i;
    }
    return null;
  }

  /** @returns true=等待动效, null=即时完成, false=步骤失败（丢弃） */
  private runAiAutoPlacePlaybackStep(step: AutoPlacePlaybackStep): boolean | null {
    switch (step.kind) {
      case 'place': {
        const idx = this.findAiTrayIndexForPlaceStep(step);
        if (idx === null || !this.aiAutoPlaceApply(idx, step.cell)) return false;
        return this.aiPlaceAnimBusy() ? true : null;
      }
      case 'mergeTray':
        return this.aiMergeTrayTokens(step.from, step.to) ? null : false;
      case 'mergeBoard':
        return this.aiMergeBoardUnits(step.from, step.to) ? (this.aiPlaceAnimBusy() ? true : null) : false;
      case 'moveUnit': {
        const u = this.aiUnits.find((x) => x.cell.c === step.from.c && x.cell.r === step.from.r);
        if (!u) return false;
        if (!this.aiUnlocked.has(cellKey(step.to.c, step.to.r)) || !this.aiCellFree(step.to.c, step.to.r)) return false;
        u.cell = { c: step.to.c, r: step.to.r };
        u.fireDir = faceDirToward(u.cell, this.unitFaceGate(true));
        return null;
      }
      case 'swapUnits': {
        const ua = this.aiUnits.find((x) => x.cell.c === step.a.c && x.cell.r === step.a.r);
        const ub = this.aiUnits.find((x) => x.cell.c === step.b.c && x.cell.r === step.b.r);
        if (!ua || !ub) return false;
        ua.cell = { c: step.b.c, r: step.b.r };
        ub.cell = { c: step.a.c, r: step.a.r };
        ua.fireDir = faceDirToward(ua.cell, this.unitFaceGate(true));
        ub.fireDir = faceDirToward(ub.cell, this.unitFaceGate(true));
        return null;
      }
      case 'swapUnitWord':
        this.aiSwapUnitWord(step.unitCell, step.wordCell);
        return null;
      case 'moveWord': {
        const kFrom = cellKey(step.from.c, step.from.r);
        const kTo = cellKey(step.to.c, step.to.r);
        const w = this.aiWords.get(kFrom);
        if (!w) return false;
        if (!this.aiUnlocked.has(kTo) || !this.aiCellFree(step.to.c, step.to.r)) return false;
        this.aiWords.delete(kFrom);
        w.cell = { c: step.to.c, r: step.to.r };
        this.aiWords.set(kTo, w);
        return null;
      }
      case 'swapWords':
        this.aiSwapWords(step.from, step.to);
        return null;
      case 'displaceToTray':
        this.aiDisplaceToTray(step.cell);
        return null;
      case 'removeWord':
        this.aiRemoveOrphanWord(step.cell);
        return null;
      default: {
        const _exhaustive: never = step;
        void _exhaustive;
        return false;
      }
    }
  }

  private tickAiAutoPlacePlayback(dt = 0): void {
    if (!this.aiAutoPlacePlaying) return;
    if (this.aiAutoPlacePlaybackGap > 0) {
      this.aiAutoPlacePlaybackGap = Math.max(0, this.aiAutoPlacePlaybackGap - dt);
      return;
    }
    if (this.aiAutoPlacePlaybackWait) {
      if (this.aiPlaceAnimBusy()) return;
      this.aiAutoPlacePlaybackWait = false;
      if (this.aiAutoPlacePlayback.length > 0) {
        this.aiAutoPlacePlaybackGap = this.rollAutoPlaceStagger();
        return;
      }
    }
    while (!this.aiAutoPlacePlaybackWait && this.aiAutoPlacePlayback.length > 0) {
      const step = this.aiAutoPlacePlayback[0]!;
      const wait = this.runAiAutoPlacePlaybackStep(step);
      if (wait === false) {
        this.aiAutoPlacePlayback.shift();
        continue;
      }
      this.aiAutoPlacePlayback.shift();
      if (wait === true) {
        this.aiAutoPlacePlaybackWait = true;
        break;
      }
    }
    if (!this.aiAutoPlacePlaybackWait && this.aiAutoPlacePlayback.length === 0 && !this.aiPlaceAnimSettleBusy()) {
      this.finishAiAutoPlacePlayback();
    }
  }

  private finishAiAutoPlacePlayback(): void {
    this.aiAutoPlacePlaying = false;
    this.aiAutoPlacePlaybackWait = false;
  }

  /** @returns true=等待动效, null=即时完成, false=步骤失败（丢弃） */
  private runAutoPlacePlaybackStep(step: AutoPlacePlaybackStep): boolean | null {
    switch (step.kind) {
      case 'place': {
        const idx = this.findTrayIndexForPlaceStep(step);
        if (idx === null || !this.autoPlaceApply(idx, step.cell)) return false;
        return this.playerPlaceAnimBusy() ? true : null;
      }
      case 'mergeTray':
        return this.mergeTrayTokens(step.from, step.to) ? null : false;
      case 'mergeBoard': {
        const a = this.units.get(cellKey(step.from.c, step.from.r));
        const b = this.units.get(cellKey(step.to.c, step.to.r));
        if (!a || !b) return false;
        if (!canMerge({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier })) return false;
        const merged = mergeUnits({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier });
        this.units.set(cellKey(step.to.c, step.to.r), mergePlacedUnitState(b, a, merged));
        this.units.delete(cellKey(step.from.c, step.from.r));
        this.bursts.push({ kind: 'merge', c: step.to.c, r: step.to.r, ttl: 0.35, maxTtl: 0.35, big: false, color: '#ffd76a' });
        this.emit('merge');
        return null;
      }
      case 'moveUnit': {
        const u = this.units.get(cellKey(step.from.c, step.from.r));
        if (!u) return false;
        if (!this.isUnlocked(step.to.c, step.to.r) || !this.cellFree(step.to.c, step.to.r)) return false;
        this.units.delete(cellKey(step.from.c, step.from.r));
        u.cell = { c: step.to.c, r: step.to.r };
        u.fireDir = faceDirToward(u.cell, this.unitFaceGate());
        this.units.set(cellKey(step.to.c, step.to.r), u);
        return null;
      }
      case 'swapUnits': {
        const ka = cellKey(step.a.c, step.a.r);
        const kb = cellKey(step.b.c, step.b.r);
        const ua = this.units.get(ka);
        const ub = this.units.get(kb);
        if (!ua || !ub) return false;
        this.units.delete(ka);
        this.units.delete(kb);
        ua.cell = { c: step.b.c, r: step.b.r };
        ub.cell = { c: step.a.c, r: step.a.r };
        ua.fireDir = faceDirToward(ua.cell, this.unitFaceGate());
        ub.fireDir = faceDirToward(ub.cell, this.unitFaceGate());
        this.units.set(kb, ua);
        this.units.set(ka, ub);
        return null;
      }
      case 'swapUnitWord':
        this.swapUnitWord(step.unitCell, step.wordCell);
        return null;
      case 'moveWord': {
        const kFrom = cellKey(step.from.c, step.from.r);
        const kTo = cellKey(step.to.c, step.to.r);
        const w = this.words.get(kFrom);
        if (!w) return false;
        if (!this.isUnlocked(step.to.c, step.to.r) || !this.cellFree(step.to.c, step.to.r)) return false;
        this.words.delete(kFrom);
        w.cell = { c: step.to.c, r: step.to.r };
        this.words.set(kTo, w);
        return null;
      }
      case 'swapWords':
        this.dragWord(step.from, step.to);
        return null;
      case 'displaceToTray':
        this.displaceToTray(step.cell);
        return null;
      case 'removeWord':
        this.removeOrphanWord(step.cell);
        return null;
      default: {
        const _exhaustive: never = step;
        void _exhaustive;
        return false;
      }
    }
  }

  private finishAutoPlacePlayback(): void {
    if (this.autoPlaceRepositionPending) {
      this.tickBattleReposition('player', PLAYER_REPOSITION_MAX_STEPS);
      this.autoPlaceRepositionPending = false;
    }
    this.sweepRemainingTrayDeploy();
    this.autoPlacePlaying = false;
    this.autoPlacePlaybackWait = false;
    this.endPlaceDropAnim();
  }

  /** 是否还有可自动落下的 tray 令牌（铲子须仍有可挖格；桃树挡挖的铲不算） */
  private trayHasAutoplaceSweepPending(): boolean {
    for (const t of this.tray) {
      if (!t) continue;
      if (t.kind === 'unit' || t.kind === 'word') return true;
      if (t.kind === 'shovel' && this.hasDiggableSlot()) return true;
      if (t.kind === 'tree' && this.hasTreePlantSlot()) return true;
    }
    return false;
  }

  /** 未开垦且无桃树 → 铲子可挖 */
  private hasDiggableSlot(): boolean {
    return this.lockedCells().some((c) => !this.trees.has(cellKey(c.c, c.r)));
  }

  /** 未开垦空地（可种/换桃树） */
  private hasTreePlantSlot(): boolean {
    return this.lockedCells().some((c) => this.isPlaceable(c.c, c.r));
  }

  /**
   * 回放漏掉的 tray 单位：无动效补落（避免 tray 里还剩兵）。
   * 仅处理仍可落地的令牌——若只剩「桃树挡着挖不了」的铲子，禁止再空转调位（否则可拖到数百 ms）。
   */
  private sweepRemainingTrayDeploy(): void {
    // 收尾兜底：把主规划没落下的 tray 项尽量落地。但若某步只是棋盘布局微调（合并腾位/迁移换座，
    // n=1 但 tray 没少），说明在空转——旧实现会空转到 PLAYER_PLACE_MAX_STEPS(150) 步卡界面。
    // 现按「tray 是否真的少一件」判断：连续 3 步不收缩即停，并加绝对上限兜底。
    const ABS_CAP = 40;
    let noShrink = 0;
    for (let g = 0; g < ABS_CAP; g++) {
      if (!this.trayHasAutoplaceSweepPending()) break;
      const hasFree = this.unlockedCells().some((c) => this.cellFree(c.c, c.r));
      if (!hasFree && !this.hasDiggableSlot()) break;
      const trayBefore = this.tray.length;
      const n = planAutoPlaceSteps(this.buildPlayerAutoView(), {
        rng: () => this.rng.next(),
        pSubOptimal: 0,
        maxSteps: 1,
      });
      if (n === 0) break;
      if (this.tray.length >= trayBefore) {
        if (++noShrink >= 3) break; // 连续空转：停
      } else {
        noShrink = 0;
      }
    }
  }

  private tickAutoPlacePlayback(dt = 0): void {
    if (!this.autoPlacePlaying) return;
    if (this.autoPlacePlaybackGap > 0) {
      this.autoPlacePlaybackGap = Math.max(0, this.autoPlacePlaybackGap - dt);
      return;
    }
    if (this.autoPlacePlaybackWait) {
      if (this.playerPlaceAnimBusy()) return;
      this.autoPlacePlaybackWait = false;
      if (this.autoPlacePlayback.length > 0) {
        this.autoPlacePlaybackGap = this.rollAutoPlaceStagger();
        return;
      }
    }
    while (!this.autoPlacePlaybackWait && this.autoPlacePlayback.length > 0) {
      const step = this.autoPlacePlayback[0]!;
      const wait = this.runAutoPlacePlaybackStep(step);
      if (wait === false) {
        this.autoPlacePlayback.shift();
        continue;
      }
      this.autoPlacePlayback.shift();
      if (wait === true) {
        this.autoPlacePlaybackWait = true;
        break;
      }
    }
    if (!this.autoPlacePlaybackWait && this.autoPlacePlayback.length === 0 && !this.playerPlaceAnimSettleBusy()) {
      this.finishAutoPlacePlayback();
    }
  }

  /** 测试用：跳过落子动效等待，立即播完布阵队列 */
  flushAutoPlacePlaybackForTest(): void {
    while (this.autoPlacePlaying) {
      this.autoPlacePlaybackGap = 0;
      // 挖坑/预占不再挡步间等待，但收尾仍可能卡在 settle；测试直接清掉
      if (this.playerPlaceAnimSettleBusy()) {
        for (const d of this.autoPlaceDragFx) this.commitAutoPlaceDrag(d);
        this.autoPlaceDragFx = [];
        this.pendingPlace = [];
        this.digFx = [];
        this.autoPlacePlaybackWait = false;
      }
      this.tickAutoPlacePlayback();
    }
  }

  tangsengMaxHP = ECONOMY.TANGSENG_INITIAL_HP; // 唐僧血量上限（受功德/道具提升）
  healUsedThisWave = false; // 观音甘露每波限回一次
  aiHealUsedThisWave = false; // AI 侧观音甘露每波限回一次
  tangsengHurtImmuneT = 0; // 漏怪扣血后短暂免疫剩余（秒）

  // —— 主动技能（功德购买、每日装备，最多 2 个；CD 制、手动触发）——
  // 每个装备的技能一个运行时槽：独立冷却计时。
  activeSlots: { id: string; cd: number; cdMax: number; ready: boolean; flash: number }[] = [];
  ultFlash = 0; // AOE 技能(紧箍咒/陨石)释放特效计时(秒)
  ultCenter: { c: number; r: number } | null = null; // AOE 爆心（渲染用）
  /** 二郎神大招「哮天犬」本帧咬击目标格（触发时写入、pushHeroUltFx 消费后清空） */
  biteTarget: { c: number; r: number; mid: number } | null = null;
  /** 二郎哮天犬咬住怪物后的持续跟随特效（3s 内狗停在怪物位置，怪死亡则消失） */
  erlangDogFx: { mid: number; c: number; r: number; ttl: number; maxTtl: number; tier: number; ang: number; fromC: number; fromR: number }[] = [];
  spawnGateT = 0; // 玩家出怪口开合动画计时(0.5→0)
  aiSpawnGateT = 0; // AI 出怪口开合动画计时

  // —— DevTools：第 N 次征兵必出指定英雄两字（测试用）——
  devForceSummonN: number = 0; // 0 = 关闭；非 0 = 第 N 次征兵必出（1-indexed）
  devForceHeroId: string = ''; // 武将 id（如 'erlang'），空 = 关闭
  private devForceSummonCharsDrawn: Set<string> = new Set(); // 已强制出的字（防重复）

  // 开局入场：唐僧沿路走到归位，这段时间玩家可征兵布阵；归位后自动开打第一波
  introT = 0;
  introDone = false;
  static readonly INTRO_DUR = 6; // 秒
  // 新手引导展示期间强制渲染我方/AI 唐僧于归位点（不影响 introT/introDone 计时，仅用于展示）
  tangsengRenderOverride = false;

  // —— 伪竞技 AI 对手（上半场，对角唐僧）——
  readonly aiPath: Cell[];
  readonly aiTangseng: Cell;
  readonly aiCells: Cell[]; // AI 可部署格 = 玩家可摆放格的镜像
  readonly aiUnlocked = new Set<string>(); // AI 已开放阵位(初始6格 + 已部署格)，用于渲染其可放置区域
  private aiPathLen: number;
  private entranceDist = 0; // 玩家出怪口沿路距离
  private aiEntranceDist = 0; // AI 出怪口沿路距离
  aiTangsengHP = ECONOMY.TANGSENG_INITIAL_HP;
  aiTangsengHurtImmuneT = 0; // AI 唐僧漏怪扣血后短暂免疫
  aiFrqMul = 1; // AI 侧全体攻速倍率（含道具加成）
  aiMods: Modifiers = { atkMul: 1, frqMul: 1, killBonus: 0, monsterSpdMul: 1, summonCostDelta: 0, wordRateBonus: 0, shovelPeach: 0, autoShovel: false, meteor: false, mud: false, generalTierDelta: 0 };
  aiActiveSlots: { id: string; cd: number; cdMax: number; ready: boolean; flash: number }[] = [];
  /** 攻击型主动技能(陨石/紧箍咒)：距离条件达成后的随机延迟倒计时（秒）；undefined=未解锁 */
  private aiOffensiveDelay: Partial<Record<'meteor' | 'jinggu' | 'bomb', number>> = {};
  private aiShovelTimer = 0;
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
  aiPeach = ECONOMY.INITIAL_PEACH;                 // 基础经济（不加 meta.bonusPeach）
  private aiSummonCost = TUNING.summonCostStart; // 同玩家初始征兵成本
  aiShovels = TUNING.initialShovels;
  aiTray: TrayToken[] = [];
  aiWords = new Map<string, PlacedWord>();
  private aiSummonsSinceShovel = 0;
  private aiSummonsSinceWord = 0; // AI 字牌保底计数（镜像 summonsSinceWord）
  private aiSummonsSincePair = 0;
  private aiEarlySummonWordsCap = 0;
  private aiEarlySummonWordsGuarantee = 0;
  private aiEarlySummonShovels = 0;
  private aiWordCharCounts = new Map<string, number>(); // AI 字出现次数（抽字打压）
  private aiSummonCount = 0;
  private aiGeneralStates = new Map<string, GeneralState>();
  private lastAiActivePairKeys = new Set<string>();
  private aiRng!: RNG;                      // 独立随机源（构造里派生）
  private aiSummonTimer = 0;                // 距下次可征兵计时
  private aiRepositionTimer = 0;            // 战中调整节流（兵器 1–2.5s / 补配对字 0.3–0.5s 随机）
  private aiLastRepositionPair: { a: Cell; b: Cell } | null = null;
  private aiAdjustIntervalScale = 1;        // versus-agent 10× 子步进时缩至 0.1
  aiSkill = DEFAULT_AI_SKILL;              // 跨局注入（默认 1.0）
  /** 对战隐藏调节：抽字/道具概率，不在 UI 展示 */
  private versusBand = versusRubberBand(0, 0);

  // 道具与修正器
  mods: Modifiers = { atkMul: 1, frqMul: 1, killBonus: 0, monsterSpdMul: 1, summonCostDelta: 0, wordRateBonus: 0, shovelPeach: 0, autoShovel: false, meteor: false, mud: false, generalTierDelta: 0 };
  private shovelTimer = 0; // 洛阳铲产铲计时
  private meteorPending = false; // 本波被动陨石是否待触发（等最前活怪走过 ≥ meteorRadius）
  /** 被动生效时的图标斜光反馈：passive id → 斜光剩余秒数（玩家侧）。衰减在 updateSkillFx */
  passiveFlash = new Map<string, number>();
  /** AI 侧被动生效斜光反馈（独立一份，照 AI 的 HUD 图标） */
  aiPassiveFlash = new Map<string, number>();
  private passivesFlashedAtStart = false; // 首波已给全体被动闪过一次「生效」提示
  weaponBonuses: WeaponBonuses = {}; // 已装备神兵给各武将的加成
  aiWeaponBonuses: WeaponBonuses = {}; // AI 神兵：按 aiSkill 缩放玩家神兵
  pendingWeaponPickups: string[] = []; // 本局掉落、待左下角点击领取的神兵碎片
  /** 开局预排的本局可能掉落的神兵 id；null 表示本局无掉落资格 */
  battleFragmentDropId: string | null = null;
  battleFragmentDropped = false;
  /** 由 main 注入：碎片已集齐时不展示领取卡片（仍参与随机） */
  weaponPickupVisible: (id: string) => boolean = () => true;
  pickedItems: string[] = [];

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
  /** 上一局未匹配 → 本局强制至少达成一次可组合双字 */
  private forceMatchThisGame = false;
  /** AI：与玩家同步的跨局强制匹配（独立计数，不写回玩家 history） */
  private aiForceMatchThisGame = false;
  /** 近 N 局匹配过的武将 id（抽字软降重；玩家/AI 共用列表） */
  private recentMatchedHeroIds: readonly string[] = [];
  /** 本局已达成匹配的武将 id */
  private matchedHeroIdsThisGame = new Set<string>();
  /** AI 本局已达成匹配的武将 id */
  private aiMatchedHeroIdsThisGame = new Set<string>();
  /** 本局新匹配发生时的波次（用于波段窗口保底） */
  private heroMatchWaves: number[] = [];
  /** AI 本局新匹配波次 */
  private aiHeroMatchWaves: number[] = [];

  constructor(
    seed = 1,
    difficultyMul = 1,
    map: GameMap = MAPS[0]!,
    meta: MetaBonuses = NO_META,
    weapons: WeaponBonuses = {},
    actives: string[] = [],
    passives: string[] = [],
    endless = false,
    aiSkill = DEFAULT_AI_SKILL,
    aiAdjustIntervalScale = 1,
    heroMatch?: { forceMatchThisGame?: boolean; recentMatchedHeroIds?: readonly string[] },
  ) {
    this.aiAdjustIntervalScale = aiAdjustIntervalScale;
    this.forceMatchThisGame = !!heroMatch?.forceMatchThisGame;
    this.aiForceMatchThisGame = !!heroMatch?.forceMatchThisGame;
    this.recentMatchedHeroIds = heroMatch?.recentMatchedHeroIds ?? [];
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
      for (const id of aiRoll.actives.slice(0, MAX_EQUIPPED_ACTIVES)) {
        const def = activeById(id);
        if (!def || def.disabled) continue;
        this.aiActiveSlots.push({ id, cd: def.cd, cdMax: def.cd, ready: false, flash: 0 });
        this.aiPickedItems.push(id);
      }
      for (const id of aiRoll.passives.slice(0, MAX_EQUIPPED_PASSIVES)) {
        if (!isPassiveEnabled(id)) continue;
        this.applyAiItem(id);
        this.aiPickedItems.push(id);
      }
      const knobs = skillToKnobs(effectiveSkill);
      this.aiSummonTimer = knobs.summonInterval * 0.5;
      this.aiRepositionTimer = rollAiAdjustInterval(false, () => this.aiRng.next(), this.aiAdjustIntervalScale);
    }
    this.warmPathDistCaches();
    // DevTools：读取模块级强制出英雄配置（跨 restart 持久）
    if (DEV_FORCE_SUMMON_HERO) {
      this.devForceHeroId = DEV_FORCE_SUMMON_HERO.heroId;
      this.devForceSummonN = DEV_FORCE_SUMMON_HERO.summonN;
    }
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

  /** 单轮布阵规划内复用：pathCover / early / firstEngage 采样缓存 */
  private makePathMetricCaches() {
    return { cover: new Map<string, number>(), early: new Map<string, number>(), first: new Map<string, number>() };
  }

  private static pathMetricKey(ax: number, ay: number, rge: number): string {
    return `${ax},${ay},${rge}`;
  }

  private playerPathCoverCached(caches: ReturnType<Battle['makePathMetricCaches']>, ax: number, ay: number, rge: number): number {
    const k = Battle.pathMetricKey(ax, ay, rge);
    let v = caches.cover.get(k);
    if (v === undefined) {
      v = pathCoverageLen(this.map, this.entranceDist, this.pathLen, ax, ay, rge);
      caches.cover.set(k, v);
    }
    return v;
  }

  private playerPathCoverEarlyCached(caches: ReturnType<Battle['makePathMetricCaches']>, ax: number, ay: number, rge: number): number {
    const k = Battle.pathMetricKey(ax, ay, rge);
    let v = caches.early.get(k);
    if (v === undefined) {
      v = pathCoverageLenEntranceWeighted(this.map, this.entranceDist, this.pathLen, ax, ay, rge);
      caches.early.set(k, v);
    }
    return v;
  }

  private playerPathFirstEngageCached(caches: ReturnType<Battle['makePathMetricCaches']>, ax: number, ay: number, rge: number): number {
    const k = Battle.pathMetricKey(ax, ay, rge);
    let v = caches.first.get(k);
    if (v === undefined) {
      v = pathFirstEngageDist(this.map, this.entranceDist, this.pathLen, ax, ay, rge);
      caches.first.set(k, v);
    }
    return v;
  }

  private aiPathCoverCached(caches: ReturnType<Battle['makePathMetricCaches']>, ax: number, ay: number, rge: number): number {
    const k = Battle.pathMetricKey(ax, ay, rge);
    let v = caches.cover.get(k);
    if (v === undefined) {
      v = this.aiPathCoverAt(ax, ay, rge);
      caches.cover.set(k, v);
    }
    return v;
  }

  private aiPathCoverEarlyCached(caches: ReturnType<Battle['makePathMetricCaches']>, ax: number, ay: number, rge: number): number {
    const k = Battle.pathMetricKey(ax, ay, rge);
    let v = caches.early.get(k);
    if (v === undefined) {
      v = pathCoverageLenEntranceWeightedAlong(this.aiPath, this.aiEntranceDist, this.aiPathLen, ax, ay, rge);
      caches.early.set(k, v);
    }
    return v;
  }

  private aiPathFirstEngageCached(caches: ReturnType<Battle['makePathMetricCaches']>, ax: number, ay: number, rge: number): number {
    const k = Battle.pathMetricKey(ax, ay, rge);
    let v = caches.first.get(k);
    if (v === undefined) {
      v = pathFirstEngageDistAlong(this.aiPath, this.aiEntranceDist, this.aiPathLen, ax, ay, rge);
      caches.first.set(k, v);
    }
    return v;
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
    if (this.introDone || this.tangsengRenderOverride) return posAlong(this.aiPath, this.aiPathLen);
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
  // 兵/铲的分布走受约束的 drawSummonTray（同 key 上限 + 首次保底≥4兵）；铲子保底延后 applyForceShovel；
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
    this.clearAutoPlaceLayoutMemory();
    this.emit('summon');
    // 整盘重抽：不再保留旧字牌，避免 tray 残留
    const avail = TUNING.traySize;
    const types = Object.keys(UNITS) as UnitType[];
    const firstSummon = this.summonCount === 0;
    // 阵位全开且无桃树：铲子无用 → 不出铲、不触发铲子保底，且放宽同兵种上限
    // 有桃树时仍可出铲（可挪树后再挖），单次上限 = 待挖空位 + 桃树数
    const shovelUseful = this.shovelUsefulSlots();
    const allOpen = shovelUseful === 0;
    const early = earlySummonGates(this.wave, {
      wordsInCapWindow: this.earlySummonWordsCap,
      wordsInGuaranteeWindow: this.earlySummonWordsGuarantee,
      shovelsInWindow: this.earlySummonShovels,
    }, TUNING);
    // 单次征兵出铲 ≤ 桃树+待挖；再与前期配额 / summonMaxPerKey 取更严
    // 强制出铲延后到字/半对/匹配保底之后，避免覆盖其它保底槽
    const shovelCap = Math.min(shovelUseful, early.maxShovels ?? TUNING.summonMaxPerKey);
    const forceShovel = shovelCap > 0
      && (this.summonsSinceShovel >= TUNING.shovelPityAfter || early.forceShovel);
    // 兵/铲分布：受约束（同 key ≤ 上限，首次保底≥4兵）；强制铲见文末 applyForceShovel
    const base = drawSummonTray({
      rng: this.rng,
      unitTypes: types,
      draws: avail,
      shovelChance: shovelCap <= 0 ? 0 : TUNING.shovelDrawChance,
      maxPerKey: allOpen ? TUNING.summonMaxPerKeyAllOpen : TUNING.summonMaxPerKey,
      firstSummon,
      maxShovels: shovelCap,
    });
    this.summonCount += 1;
    // 非首次征兵：按字牌掉率把部分「兵」槽转成武将字牌（首次保底不转，维持≥4兵）
    const forceWordPity = !firstSummon && this.summonsSinceWord >= TUNING.wordPityAfter;
    const forceWord = !firstSummon && (forceWordPity || early.forceWord) && early.maxWords > 0;
    // 配对/去重只看棋盘（旧 tray 整盘替换，不计入孤儿与已拥有）
    const orphansBefore = this.boardOrphanCharsNow();
    const ownedBoard = this.boardWordCharsNow();
    const fieldCharCounts = this.boardFieldCharCounts();
    const activeMax5Families = this.activeMax5FamiliesNow();
    const activeTransitFamilies = this.activeTransitFamiliesNow();
    const wordPolicy = this.summonWordPolicyNow();
    const wordSlotsCap = Math.min(wordPolicy.maxWordSlots, early.maxWords);
    const forcePartner = wordPolicy.allowForcePartner
      && !firstSummon
      && orphansBefore.length > 0
      && this.summonsSincePair >= TUNING.pairPityAfter
      && wordSlotsCap > 0;
    const trayWordsSoFar: string[] = [];
    let partnerForced = false;
    const yinPressActive = yinSupportCharsPresent([
      ...this.wordCharCounts.keys(),
      ...ownedBoard,
    ]);
    const wordPickOpts = () => ({
      tier5BiasMul: this.versusBand.playerWordTier5Bias,
      fieldCharCounts,
      activeMax5Families,
      activeTransitFamilies,
      tier5CapableOnly: wordPolicy.tier5CapableOnly,
      excludeChars: wordPolicy.excludeChars,
      preferRoles: wordPolicy.preferRoles,
      yinPressActive: yinPressActive || yinSupportCharsPresent(trayWordsSoFar),
      recentMatchedHeroIds: this.recentMatchedHeroIds,
    });
    const wordDrawChance =
      (TUNING.wordDrawChance + this.mods.wordRateBonus + this.versusBand.playerWordDrawBonus)
      * wordPolicy.wordSlotChanceMul;
    const drawOneWord = (forcePair: boolean) => {
      if (trayWordsSoFar.length >= wordSlotsCap) {
        return null;
      }
      // DevTools：第 N 次征兵必出指定英雄的两字（测试用，1-indexed）
      if (this.devForceHeroId && this.summonCount === this.devForceSummonN) {
        const def = generalById(this.devForceHeroId);
        if (def) {
          for (const ch of def.chars) {
            if (this.devForceSummonCharsDrawn.has(ch)) continue;
            // 跳过已在 tray 或棋盘上的字
            const inTray = trayWordsSoFar.includes(ch) || this.tray.some((t) => t?.kind === 'word' && t.char === ch);
            const onBoard = [...this.words.values()].some((w) => w.char === ch);
            if (inTray || onBoard) { this.devForceSummonCharsDrawn.add(ch); continue; }
            this.devForceSummonCharsDrawn.add(ch);
            trayWordsSoFar.push(ch);
            this.bumpWordCharCount(ch);
            return { kind: 'word' as const, char: ch, general: this.devForceHeroId, tier: wordPolicy.wordTier };
          }
        }
      }
      const w = pickWordChar(
        this.rng,
        Math.max(1, this.wave),
        orphansBefore,
        trayWordsSoFar,
        forcePair,
        ownedBoard,
        this.wordDrawCounts(),
        wordPickOpts(),
      );
      trayWordsSoFar.push(w.char);
      this.bumpWordCharCount(w.char);
      if (forcePair || orphansBefore.some((o) => partnerChars(o).includes(w.char))) partnerForced = true;
      return { kind: 'word' as const, char: w.char, general: w.general, tier: wordPolicy.wordTier };
    };
    const draws: TrayToken[] = base.map((tok) => {
      if (
        tok.kind === 'unit'
        && !firstSummon
        && wordPolicy.wordSlotChanceMul > 0
        && trayWordsSoFar.length < wordSlotsCap
        && this.rng.next() < wordDrawChance
      ) {
        const useForce = forcePartner && !partnerForced;
        const word = drawOneWord(useForce);
        if (word) return word;
      }
      return tok;
    });

    // DevTools：第 N 次征兵必出指定英雄两字——若 tray 里还没有，强制替换 unit 槽
    if (this.devForceHeroId && this.summonCount === this.devForceSummonN) {
      const def = generalById(this.devForceHeroId);
      if (def) {
        for (const ch of def.chars) {
          if (this.devForceSummonCharsDrawn.has(ch)) continue;
          const inTray = trayWordsSoFar.includes(ch) || this.tray.some((t) => t?.kind === 'word' && t.char === ch);
          const inDraws = draws.some((t) => t.kind === 'word' && t.char === ch);
          const onBoard = [...this.words.values()].some((w) => w.char === ch);
          if (inTray || inDraws || onBoard) { this.devForceSummonCharsDrawn.add(ch); continue; }
          // 找一个 unit 槽替换
          const idx = draws.findIndex((t) => t.kind === 'unit');
          if (idx >= 0) {
            draws[idx] = { kind: 'word', char: ch, general: this.devForceHeroId, tier: wordPolicy.wordTier };
            trayWordsSoFar.push(ch);
            this.bumpWordCharCount(ch);
            this.devForceSummonCharsDrawn.add(ch);
          }
        }
      }
    }
    if (
      wordPolicy.allowForceWord
      && forceWord
      && trayWordsSoFar.length < wordSlotsCap
      && !draws.some((t) => t.kind === 'word')
    ) {
      const idx = draws.findIndex((t) => t.kind === 'unit');
      const word = idx >= 0 ? drawOneWord(forcePartner) : null;
      if (word) draws[idx] = word;
    } else if (
      wordPolicy.allowForcePartner
      && forcePartner
      && !partnerForced
      && trayWordsSoFar.length < wordSlotsCap
    ) {
      const idx = draws.findIndex((t) => t.kind === 'unit');
      const word = idx >= 0 ? drawOneWord(true) : null;
      if (word) draws[idx] = word;
    }
    // 跨局 / 波段匹配保底：强制推进「尚未计入本局」的可组合双字
    const freshMatchAlready = matchedHeroIds(trayWordsSoFar, ownedBoard)
      .some((id) => !this.matchedHeroIdsThisGame.has(id));
    if (
      !firstSummon
      && wordPolicy.allowForceWord
      && wordSlotsCap > 0
      && this.needsHeroMatchPity()
      && !freshMatchAlready
    ) {
      const forced = forcedMatchWordChars(
        this.rng,
        trayWordsSoFar,
        ownedBoard,
        wordSlotsCap,
        {
          tier5CapableOnly: wordPolicy.tier5CapableOnly,
          fieldCharCounts,
          excludeHeroIds: this.matchedHeroIdsThisGame,
        },
      );
      for (const w of forced) {
        const idx = draws.findIndex((t) => t.kind === 'unit');
        if (idx < 0) break;
        trayWordsSoFar.push(w.char);
        this.bumpWordCharCount(w.char);
        if (orphansBefore.some((o) => partnerChars(o).includes(w.char))) partnerForced = true;
        draws[idx] = { kind: 'word', char: w.char, general: w.general, tier: wordPolicy.wordTier };
      }
      // 槽未满却仍无字可塞 → 已无未匹配武将可抽，结束保底以免空转
      if (
        forced.length === 0
        && trayWordsSoFar.length < wordSlotsCap
        && this.needsHeroMatchPity()
      ) {
        this.heroMatchWaves.push(this.effectiveSummonWave());
        this.forceMatchThisGame = false;
      }
    }
    // 字/半对/匹配保底落定后再强制出铲，只占剩余兵槽
    if (forceShovel) {
      applyForceShovel(draws, {
        maxShovels: shovelCap,
        minUnits: firstSummon ? 4 : 0,
      });
    }
    // 铲子保底计数：本盘最终出铲则清零，否则累加
    if (draws.some((t) => t.kind === 'shovel')) this.summonsSinceShovel = 0;
    else this.summonsSinceShovel += 1;
    this.tray = draws;
    this.refreshHeroMatchesAfterSummon(trayWordsSoFar);
    const waveNow = Math.max(1, this.wave);
    const shovelN = draws.filter((t) => t.kind === 'shovel').length;
    const wordN = draws.filter((t) => t.kind === 'word').length;
    if (waveNow <= TUNING.earlyShovelWave) this.earlySummonShovels += shovelN;
    if (waveNow <= TUNING.earlyWordCapWave) this.earlySummonWordsCap += wordN;
    if (waveNow <= TUNING.earlyWordGuaranteeWave) this.earlySummonWordsGuarantee += wordN;
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

  /** 局末/测试：本局累计匹配过的武将 id */
  heroMatchedIdsThisGame(): string[] {
    const tray = this.tray.filter((t): t is Extract<TrayToken, { kind: 'word' }> => t.kind === 'word')
      .map((t) => t.char);
    for (const id of matchedHeroIds(tray, this.boardWordCharsNow())) {
      this.matchedHeroIdsThisGame.add(id);
    }
    return [...this.matchedHeroIdsThisGame];
  }

  /** 测试：挂上跨局匹配保底 */
  forceHeroMatchPityForTest(): void {
    this.forceMatchThisGame = true;
  }

  /** 测试：挂上 AI 跨局匹配保底 */
  forceAiHeroMatchPityForTest(): void {
    this.aiForceMatchThisGame = true;
  }

  /** 测试：预设本局已匹配武将与记波（用于波段保底回归） */
  seedHeroMatchForTest(heroId: string, wave: number): void {
    this.matchedHeroIdsThisGame.add(heroId);
    this.heroMatchWaves.push(wave);
    this.forceMatchThisGame = false;
  }

  /** 测试：预设 AI 本局已匹配武将与记波 */
  seedAiHeroMatchForTest(heroId: string, wave: number): void {
    this.aiMatchedHeroIdsThisGame.add(heroId);
    this.aiHeroMatchWaves.push(wave);
    this.aiForceMatchThisGame = false;
  }

  /** 局末/测试：AI 本局累计匹配过的武将 id */
  aiHeroMatchedIdsThisGame(): string[] {
    const tray = this.aiTray.filter((t): t is Extract<TrayToken, { kind: 'word' }> => !!t && t.kind === 'word')
      .map((t) => t.char);
    for (const id of matchedHeroIds(tray, this.aiBoardWordCharsNow())) {
      this.aiMatchedHeroIdsThisGame.add(id);
    }
    return [...this.aiMatchedHeroIdsThisGame];
  }

  /** 波间 ready 时 wave 仍为上一波，征兵保底按「即将进入的波」计 */
  private effectiveSummonWave(): number {
    if (this.status === 'ready' && this.wave > 0) return this.wave + 1;
    return Math.max(1, this.wave);
  }

  private refreshHeroMatchesAfterSummon(trayChars: readonly string[]): void {
    const waveNow = this.effectiveSummonWave();
    const ids = matchedHeroIds(trayChars, this.boardWordCharsNow());
    for (const id of ids) {
      if (this.matchedHeroIdsThisGame.has(id)) continue;
      this.matchedHeroIdsThisGame.add(id);
      this.heroMatchWaves.push(waveNow);
    }
  }

  private refreshAiHeroMatchesAfterSummon(trayChars: readonly string[]): void {
    const waveNow = this.effectiveSummonWave();
    const ids = matchedHeroIds(trayChars, this.aiBoardWordCharsNow());
    for (const id of ids) {
      if (this.aiMatchedHeroIdsThisGame.has(id)) continue;
      this.aiMatchedHeroIdsThisGame.add(id);
      this.aiHeroMatchWaves.push(waveNow);
    }
  }

  /** 跨局未匹配，或波>10 的 10 波窗口末仍无本窗口新匹配 */
  private needsHeroMatchPity(): boolean {
    if (this.forceMatchThisGame && this.matchedHeroIdsThisGame.size === 0) return true;
    const w = this.effectiveSummonWave();
    if (w <= 10 || w % 10 !== 0) return false;
    const windowStart = Math.floor((w - 1) / 10) * 10 + 1;
    return !this.heroMatchWaves.some((mw) => mw >= windowStart && mw <= w);
  }

  private needsAiHeroMatchPity(): boolean {
    if (this.aiForceMatchThisGame && this.aiMatchedHeroIdsThisGame.size === 0) return true;
    const w = this.effectiveSummonWave();
    if (w <= 10 || w % 10 !== 0) return false;
    const windowStart = Math.floor((w - 1) / 10) * 10 + 1;
    return !this.aiHeroMatchWaves.some((mw) => mw >= windowStart && mw <= w);
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

  /**
   * 棋盘单位/字牌/桃树拖到候选区：
   * - 空槽：直接放入
   * - 槽内是武器(unit)或字牌：与棋盘交换（铲子/桃树槽不交换）
   * - 已激活武将的单字可拖回：拆开后武将失活（另一字留在棋盘）
   */
  recallToTray(from: Cell, slot: number): boolean {
    if (slot < 0 || slot >= TUNING.traySize) return false;
    const k = cellKey(from.c, from.r);
    const wasActiveHero = this.activeGenerals().some((g) => g.cells.some((c) => c.c === from.c && c.r === from.r));
    const occupy = this.tray[slot];
    if (!occupy) {
      const tree = this.trees.get(k);
      if (tree) {
        this.trees.delete(k);
        this.tray[slot] = { kind: 'tree', level: tree.level, growT: tree.growT };
        this.message = '桃树已收回候选区（暂停产桃）';
        this.clearAutoPlaceLayoutMemory();
        return true;
      }
      const w = this.words.get(k);
      if (w) {
        this.words.delete(k);
        this.tray[slot] = trayWordFromPlaced(w);
        this.message = wasActiveHero
          ? `拆开武将，字牌「${w.char}」已收回候选区`
          : `字牌「${w.char}」已收回候选区`;
        this.clearAutoPlaceLayoutMemory();
        return true;
      }
      const u = this.units.get(k);
      if (u) {
        this.units.delete(k);
        this.tray[slot] = { kind: 'unit', type: u.type, tier: u.tier };
        this.message = `${UNITS[u.type].name} 已收回候选区`;
        this.emit('place');
        this.clearAutoPlaceLayoutMemory();
        return true;
      }
      return false;
    }

    // —— 与候选槽交换：仅 unit / word（铲子、桃树无法落到已占用解锁格）——
    if (occupy.kind !== 'unit' && occupy.kind !== 'word') {
      this.message = occupy.kind === 'shovel' ? '铲子不能与棋盘单位交换' : '该候选槽不能与棋盘交换';
      return false;
    }
    if (!this.isUnlocked(from.c, from.r)) {
      this.message = '只能与已解锁格上的单位/字牌交换';
      return false;
    }

    const boardWord = this.words.get(k);
    const boardUnit = this.units.get(k);
    if (!boardWord && !boardUnit) {
      this.message = '该格没有可交换的武器或字牌';
      return false;
    }

    // 棋盘件 → 候选槽
    const recalled: TrayToken = boardWord
      ? trayWordFromPlaced(boardWord)
      : { kind: 'unit', type: boardUnit!.type, tier: boardUnit!.tier };

    // 候选件 → 棋盘格（先清格再落子，保证 maps 一致）
    if (boardWord) this.words.delete(k);
    if (boardUnit) this.units.delete(k);

    if (occupy.kind === 'word') {
      this.words.set(k, placedWordFromTray(occupy, { c: from.c, r: from.r }));
    } else {
      this.units.set(k, makePlacedUnit(occupy.type, occupy.tier, { c: from.c, r: from.r }, this.unitFaceGate()));
    }
    this.tray[slot] = recalled;

    if (boardWord && occupy.kind === 'word') {
      this.message = wasActiveHero
        ? `拆开武将，字牌「${boardWord.char}」与「${occupy.char}」交换`
        : `字牌「${boardWord.char}」与「${occupy.char}」交换`;
    } else if (boardUnit && occupy.kind === 'unit') {
      this.message = `${UNITS[boardUnit.type].name} 与 ${UNITS[occupy.type].name} 交换`;
    } else if (boardWord && occupy.kind === 'unit') {
      this.message = wasActiveHero
        ? `拆开武将，字牌「${boardWord.char}」与 ${UNITS[occupy.type].name} 交换`
        : `字牌「${boardWord.char}」与 ${UNITS[occupy.type].name} 交换`;
    } else {
      this.message = `${UNITS[boardUnit!.type].name} 与字牌「${occupy.char}」交换`;
    }
    this.emit('place');
    this.clearAutoPlaceLayoutMemory();
    return true;
  }

  private aiWordAt(c: number, r: number): PlacedWord | undefined {
    return this.aiWords.get(cellKey(c, r));
  }

  // 该格是否空闲（无兵、无字牌、且无延迟落子预占）
  private cellFree(c: number, r: number): boolean {
    return !this.units.has(cellKey(c, r))
      && !this.words.has(cellKey(c, r))
      && !this.pendingPlace.some((p) => p.c === c && p.r === r)
      && !this.autoPlaceDragFx.some((d) => d.c === c && d.r === r);
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
      this.tray[slot] = trayWordFromPlaced(w, { displaced: true });
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
      this.aiTray.push(trayWordFromPlaced(w, { displaced: true }));
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

  /** AI 孤儿裁剪：直接移除未激活字（不进候选区） */
  private aiRemoveOrphanWord(cell: Cell): boolean {
    if (this.aiActiveGenerals().some((g) => g.cells.some((c) => c.c === cell.c && c.r === cell.r))) return false;
    const k = cellKey(cell.c, cell.r);
    if (!this.aiWords.has(k)) return false;
    this.aiWords.delete(k);
    return true;
  }

  private removeOrphanWord(cell: Cell): boolean {
    if (this.activeGenerals().some((g) => g.cells.some((c) => c.c === cell.c && c.r === cell.r))) return false;
    const k = cellKey(cell.c, cell.r);
    if (!this.words.has(k)) return false;
    this.words.delete(k);
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
  setWaveForTest(wave: number): void { this.wave = Math.max(0, wave); }

  /** DevTools：配置第 N 次征兵必出指定英雄的两字（测试用）。summonN=0 关闭。跨 restart 持久。 */
  setDevForceWave2Hero(heroId: string, summonN = 1): void {
    DEV_FORCE_SUMMON_HERO = { heroId, summonN };
    this.devForceHeroId = heroId;
    this.devForceSummonN = summonN;
    this.devForceSummonCharsDrawn.clear();
  }
  /** DevTools：关闭强制出英雄 */
  clearDevForceWave2Hero(): void {
    DEV_FORCE_SUMMON_HERO = null;
    this.devForceHeroId = '';
    this.devForceSummonN = 0;
    this.devForceSummonCharsDrawn.clear();
  }
  /** DevTools：获取当前强制配置（供 UI 显示）。优先读模块级配置（跨 restart）。 */
  devForceWave2HeroStatus(): { summonN: number; heroId: string } {
    if (DEV_FORCE_SUMMON_HERO) return { summonN: DEV_FORCE_SUMMON_HERO.summonN, heroId: DEV_FORCE_SUMMON_HERO.heroId };
    return { summonN: this.devForceSummonN, heroId: this.devForceHeroId };
  }

  earlySummonStatsForTest(): {
    wordsCap: number;
    wordsGuarantee: number;
    shovels: number;
  } {
    return {
      wordsCap: this.earlySummonWordsCap,
      wordsGuarantee: this.earlySummonWordsGuarantee,
      shovels: this.earlySummonShovels,
    };
  }

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

  /** 已激活满3过渡武将的门派 → 组成波次（满3→满5 切换爬坡：相对组成波次后续 4-10 波提升同门满5非共享字） */
  private activeTransitFamiliesNow(): Map<string, number> {
    const map = new Map<string, number>();
    for (const g of this.activeGenerals()) {
      if (g.def.maxTier === 3 && !map.has(g.def.family)) {
        map.set(g.def.family, g.state.formedWave ?? this.wave);
      }
    }
    return map;
  }

  /**
   * 满盘且场上激活将均为满5：布阵可优先用兵器顶孤儿单字。
   * 征兵仍可出字（见 `computeSummonWordPolicy`）。
   */
  isHeroRosterComplete(): boolean {
    const active = this.activeGenerals();
    if (active.length === 0) return false;
    if (!active.every((g) => g.def.maxTier === 5 && g.tier >= 5)) return false;
    return this.unlockedCells().every((c) => !this.cellFree(c.c, c.r));
  }

  /** 铲子用途上限：待挖空位 + 地图桃树（桃树占格时可先挪树再挖） */
  private shovelUsefulSlots(): number {
    const diggable = this.lockedCells().filter((c) => !this.trees.has(cellKey(c.c, c.r))).length;
    return diggable + this.trees.size;
  }

  private summonWordPolicyInput(active: ActiveGeneral[], freeCellCount: number): SummonWordPolicyInput {
    const pairs: { left: string; right: string }[] = [];
    for (const g of active) {
      const wa = this.wordAt(g.cells[0].c, g.cells[0].r);
      const wb = this.wordAt(g.cells[1].c, g.cells[1].r);
      if (wa && wb) pairs.push({ left: wa.char, right: wb.char });
    }
    return {
      wave: Math.max(1, this.wave),
      freeCellCount,
      activeGenerals: active.map((g) => ({
        role: g.def.role,
        maxTier: g.def.maxTier,
        tier: g.tier,
      })),
      activeHeroChars: activeHeroCharsFromPairs(pairs),
    };
  }

  private summonWordPolicyNow(): SummonWordPolicy {
    const active = this.activeGenerals();
    const freeCellCount = this.unlockedCells().filter((c) => this.cellFree(c.c, c.r)).length;
    return computeSummonWordPolicy(this.summonWordPolicyInput(active, freeCellCount));
  }

  private aiSummonWordPolicyNow(): SummonWordPolicy {
    const active = this.aiActiveGenerals();
    const freeCellCount = this.aiUnlockedCells().filter((c) => this.aiCellFree(c.c, c.r)).length;
    return computeSummonWordPolicy(this.summonWordPolicyInputForAi(active, freeCellCount));
  }

  private summonWordPolicyInputForAi(active: ActiveGeneral[], freeCellCount: number): SummonWordPolicyInput {
    const pairs: { left: string; right: string }[] = [];
    for (const g of active) {
      const wa = this.aiWords.get(cellKey(g.cells[0].c, g.cells[0].r));
      const wb = this.aiWords.get(cellKey(g.cells[1].c, g.cells[1].r));
      if (wa && wb) pairs.push({ left: wa.char, right: wb.char });
    }
    return {
      wave: Math.max(1, this.wave),
      freeCellCount,
      activeGenerals: active.map((g) => ({
        role: g.def.role,
        maxTier: g.def.maxTier,
        tier: g.tier,
      })),
      activeHeroChars: activeHeroCharsFromPairs(pairs),
    };
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

  /** AI 侧已激活满3过渡武将的门派 → 组成波次（与玩家对称，满3→满5 切换爬坡） */
  private aiActiveTransitFamiliesNow(): Map<string, number> {
    const map = new Map<string, number>();
    for (const g of this.aiActiveGenerals()) {
      if (g.def.maxTier === 3 && !map.has(g.def.family)) {
        map.set(g.def.family, g.state.formedWave ?? this.wave);
      }
    }
    return map;
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
      if (a.level === b.level && b.level < PEACH_TREE.maxLevel) {
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

  private static initialHeroSkillCd(def: GeneralDef): number {
    return def.skill !== 'none' && def.skillCd > 0 ? def.skillCd : 0;
  }

  private stateOfPair(cells: [Cell, Cell], def: GeneralDef): GeneralState {
    const key = Battle.heroPairKey(cells[0], cells[1]);
    let s = this.generalStates.get(key);
    if (!s) {
      s = {
        level: 1,
        exp: 0,
        cooldown: 0,
        skillCd: Battle.initialHeroSkillCd(def),
        firePulse: 0,
        skillFlash: 0,
        formedWave: this.wave,
      };
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
      if (this.mods.generalTierDelta > 0 && !w.fabaofuBoosted && !right.fabaofuBoosted) {
        w.fabaofuBoosted = true;
        right.fabaofuBoosted = true;
        for (let i = 0; i < this.mods.generalTierDelta; i++) {
          if (w.tier < cap) w.tier += 1;
          if (right.tier < cap) right.tier += 1;
        }
      }
      const state = this.stateOfPair(cells, def);
      if (!this.lastActivePairKeys.has(pairKey)) state.skillCd = Battle.initialHeroSkillCd(def);
      const tierVal = Math.min(w.tier, right.tier, cap);
      // 不变量：state.level 恒等于当前 tier（二者同步递增）。按格子对复用 state 时，
      // 若旧英雄阵亡/字牌被换成低阶新字，会残留高 level → 升级经验虚高(如 168)、面板 Lv 与地图阶不符。此处每帧纠正。
      if (state.level > tierVal) state.exp = 0; // 残留旧英雄进度：清掉防止纠正后瞬间连升多阶
      state.level = tierVal;
      out.push({
        def,
        tier: tierVal,
        cells,
        state,
        pillAtk: state.pillAtk,
        pillFrq: state.pillFrq,
      });
    }
    this.lastActivePairKeys = activePairKeys;
    this.pruneHeroStates(activePairKeys, this.generalStates);
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
      if (this.aiMods.generalTierDelta > 0 && !w.fabaofuBoosted && !right.fabaofuBoosted) {
        w.fabaofuBoosted = true;
        right.fabaofuBoosted = true;
        for (let i = 0; i < this.aiMods.generalTierDelta; i++) {
          if (w.tier < cap) w.tier += 1;
          if (right.tier < cap) right.tier += 1;
        }
      }
      const aiState = this.stateOfPairForAi(cells, def);
      if (!this.lastAiActivePairKeys.has(pairKey)) aiState.skillCd = Battle.initialHeroSkillCd(def);
      const tierVal = Math.min(w.tier, right.tier, cap);
      if (aiState.level > tierVal) aiState.exp = 0; // 见 activeGenerals：清残留 exp 防纠正后连升
      aiState.level = tierVal; // 不变量 level==tier；纠正复用 state 残留的高 level（见 activeGenerals 注释）
      out.push({
        def,
        tier: tierVal,
        cells,
        state: aiState,
        pillAtk: aiState.pillAtk,
        pillFrq: aiState.pillFrq,
      });
    }
    this.lastAiActivePairKeys = activePairKeys;
    this.pruneHeroStates(activePairKeys, this.aiGeneralStates);
    return out;
  }

  private stateOfPairForAi(cells: [Cell, Cell], def: GeneralDef): GeneralState {
    const key = Battle.heroPairKey(cells[0], cells[1]);
    let s = this.aiGeneralStates.get(key);
    if (!s) {
      s = {
        level: 1,
        exp: 0,
        cooldown: 0,
        skillCd: Battle.initialHeroSkillCd(def),
        firePulse: 0,
        fireDir: undefined,
        skillFlash: 0,
        formedWave: this.wave,
      };
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
      this.emit('shovel'); // 第一铲；半程再铲一声
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
        this.aiWords.set(k, placedWordFromTray(token, { c: to.c, r: to.r }));
        this.aiTray[index] = trayWordFromPlaced(exist);
        return true;
      }
      if (!this.aiCellFree(to.c, to.r)) return false;
      this.aiWords.set(k, placedWordFromTray(token, { c: to.c, r: to.r }));
      this.aiTray.splice(index, 1);
      this.spawnPlaceDropFx('ai', to, {
        kind: 'word',
        isMerge: false,
        sfx: this.aiWordPlaceSfx(to),
        char: token.char,
        wordTier: token.tier,
      });
      return true;
    }
    if (token.kind !== 'unit') return false;
    // unit
    const wOnCell = this.aiWords.get(k);
    if (wOnCell) {
      if (this.aiActiveGenerals().some((g) => g.cells.some((c) => c.c === to.c && c.r === to.r))) return false;
      this.aiWords.delete(k);
      this.aiUnits.push(makePlacedUnit(token.type, token.tier, { c: to.c, r: to.r }, this.unitFaceGate(true)));
      if (!this.aiSummonWordPolicyNow().maxWordSlots) {
        this.aiTray.splice(index, 1);
      } else {
        this.aiTray[index] = trayWordFromPlaced(wOnCell);
      }
      this.spawnPlaceDropFx('ai', to, {
        kind: 'unit',
        isMerge: false,
        sfx: 'place',
        unitType: token.type,
        unitTier: token.tier,
      });
      return true;
    }
    const ex = this.aiUnits.find((u) => u.cell.c === to.c && u.cell.r === to.r);
    if (ex) {
      if (canMerge({ type: ex.type, tier: ex.tier }, { type: token.type, tier: token.tier })) {
        const m = mergeUnits({ type: ex.type, tier: ex.tier }, { type: token.type, tier: token.tier });
        Object.assign(ex, mergePlacedUnitState(ex, makePlacedUnit(token.type, token.tier, ex.cell), m));
        this.aiTray.splice(index, 1);
        this.spawnPlaceDropFx('ai', to, {
          kind: 'unit',
          isMerge: true,
          sfx: 'merge',
          unitType: m.type,
          unitTier: m.tier,
        });
        return true;
      }
      return false;
    }
    if (!this.aiCellFree(to.c, to.r)) return false;
    this.aiUnits.push(makePlacedUnit(token.type, token.tier, { c: to.c, r: to.r }, this.unitFaceGate(true)));
    this.aiTray.splice(index, 1);
    this.spawnPlaceDropFx('ai', to, {
      kind: 'unit',
      isMerge: false,
      sfx: 'place',
      unitType: token.type,
      unitTier: token.tier,
    });
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
    // 与玩家一致：单次出铲 ≤ 待挖空位（AI 侧无桃树）
    const diggableLeft = this.aiLockedCells().length;
    const allOpen = diggableLeft === 0;
    const early = earlySummonGates(this.wave, {
      wordsInCapWindow: this.aiEarlySummonWordsCap,
      wordsInGuaranteeWindow: this.aiEarlySummonWordsGuarantee,
      shovelsInWindow: this.aiEarlySummonShovels,
    }, TUNING);
    const shovelCap = Math.min(diggableLeft, early.maxShovels ?? TUNING.summonMaxPerKey);
    const forceShovel = shovelCap > 0
      && (this.aiSummonsSinceShovel >= TUNING.shovelPityAfter || early.forceShovel);
    const base = drawSummonTray({
      rng: this.aiRng, unitTypes: types, draws: TUNING.traySize,
      shovelChance: shovelCap <= 0 ? 0 : TUNING.shovelDrawChance,
      maxPerKey: allOpen ? TUNING.summonMaxPerKeyAllOpen : TUNING.summonMaxPerKey,
      firstSummon,
      maxShovels: shovelCap,
    });
    this.aiSummonCount += 1;
    this.clearAiAutoPlaceLayoutMemory();
    // 字牌抽取：镜像玩家 summon（字/半对/匹配保底 + 音系软压 + 近局降重）
    const forceWordPity = !firstSummon && this.aiSummonsSinceWord >= TUNING.wordPityAfter;
    const forceWord = !firstSummon && (forceWordPity || early.forceWord) && early.maxWords > 0;
    const orphansBefore = this.aiBoardOrphanCharsNow();
    const ownedBoard = this.aiBoardWordCharsNow();
    const fieldCharCounts = this.aiBoardFieldCharCounts();
    const activeMax5Families = this.aiActiveMax5FamiliesNow();
    const activeTransitFamilies = this.aiActiveTransitFamiliesNow();
    const wordPolicy = this.aiSummonWordPolicyNow();
    const wordSlotsCap = Math.min(wordPolicy.maxWordSlots, early.maxWords);
    const forcePartner = wordPolicy.allowForcePartner
      && !firstSummon
      && orphansBefore.length > 0
      && this.aiSummonsSincePair >= TUNING.pairPityAfter
      && wordSlotsCap > 0;
    const trayWordsSoFar: string[] = [];
    let partnerForced = false;
    const yinPressActive = yinSupportCharsPresent([
      ...this.aiWordCharCounts.keys(),
      ...ownedBoard,
    ]);
    const wordPickOpts = () => ({
      tier5BiasMul: this.versusBand.aiWordTier5Bias,
      fieldCharCounts,
      activeMax5Families,
      activeTransitFamilies,
      tier5CapableOnly: wordPolicy.tier5CapableOnly,
      excludeChars: wordPolicy.excludeChars,
      preferRoles: wordPolicy.preferRoles,
      yinPressActive: yinPressActive || yinSupportCharsPresent(trayWordsSoFar),
      recentMatchedHeroIds: this.recentMatchedHeroIds,
    });
    const wordDrawChance =
      (TUNING.wordDrawChance + this.aiMods.wordRateBonus + this.versusBand.aiWordDrawBonus)
      * wordPolicy.wordSlotChanceMul;
    const drawOneWord = (forcePair: boolean) => {
      if (trayWordsSoFar.length >= wordSlotsCap) {
        return null;
      }
      const w = pickWordChar(
        this.aiRng,
        Math.max(1, this.wave),
        orphansBefore,
        trayWordsSoFar,
        forcePair,
        ownedBoard,
        this.aiWordDrawCounts(),
        wordPickOpts(),
      );
      trayWordsSoFar.push(w.char);
      this.bumpAiWordCharCount(w.char);
      if (forcePair || orphansBefore.some((o) => partnerChars(o).includes(w.char))) partnerForced = true;
      return { kind: 'word' as const, char: w.char, general: w.general, tier: wordPolicy.wordTier };
    };
    const draws: TrayToken[] = base.map((tok) => {
      if (
        tok.kind === 'unit'
        && !firstSummon
        && wordPolicy.wordSlotChanceMul > 0
        && trayWordsSoFar.length < wordSlotsCap
        && this.aiRng.next() < wordDrawChance
      ) {
        return drawOneWord(forcePartner && !partnerForced) ?? tok;
      }
      return tok;
    });
    if (
      wordPolicy.allowForceWord
      && forceWord
      && trayWordsSoFar.length < wordSlotsCap
      && !draws.some((t) => t.kind === 'word')
    ) {
      const idx = draws.findIndex((t) => t.kind === 'unit');
      const word = idx >= 0 ? drawOneWord(forcePartner) : null;
      if (word) draws[idx] = word;
    } else if (
      wordPolicy.allowForcePartner
      && forcePartner
      && !partnerForced
      && trayWordsSoFar.length < wordSlotsCap
    ) {
      const idx = draws.findIndex((t) => t.kind === 'unit');
      const word = idx >= 0 ? drawOneWord(true) : null;
      if (word) draws[idx] = word;
    }
    // 跨局 / 波段匹配保底（与玩家 summon 对称；不写回玩家 heroMatchHistory）
    const freshMatchAlready = matchedHeroIds(trayWordsSoFar, ownedBoard)
      .some((id) => !this.aiMatchedHeroIdsThisGame.has(id));
    if (
      !firstSummon
      && wordPolicy.allowForceWord
      && wordSlotsCap > 0
      && this.needsAiHeroMatchPity()
      && !freshMatchAlready
    ) {
      const forced = forcedMatchWordChars(
        this.aiRng,
        trayWordsSoFar,
        ownedBoard,
        wordSlotsCap,
        {
          tier5CapableOnly: wordPolicy.tier5CapableOnly,
          fieldCharCounts,
          excludeHeroIds: this.aiMatchedHeroIdsThisGame,
        },
      );
      for (const w of forced) {
        const idx = draws.findIndex((t) => t.kind === 'unit');
        if (idx < 0) break;
        trayWordsSoFar.push(w.char);
        this.bumpAiWordCharCount(w.char);
        if (orphansBefore.some((o) => partnerChars(o).includes(w.char))) partnerForced = true;
        draws[idx] = { kind: 'word', char: w.char, general: w.general, tier: wordPolicy.wordTier };
      }
      if (
        forced.length === 0
        && trayWordsSoFar.length < wordSlotsCap
        && this.needsAiHeroMatchPity()
      ) {
        this.aiHeroMatchWaves.push(this.effectiveSummonWave());
        this.aiForceMatchThisGame = false;
      }
    }
    if (forceShovel) {
      applyForceShovel(draws, {
        maxShovels: shovelCap,
        minUnits: firstSummon ? 4 : 0,
      });
    }
    if (draws.some((t) => t.kind === 'shovel')) this.aiSummonsSinceShovel = 0;
    else this.aiSummonsSinceShovel += 1;
    this.aiTray = draws;
    this.refreshAiHeroMatchesAfterSummon(trayWordsSoFar);
    const waveNow = Math.max(1, this.wave);
    const shovelN = draws.filter((t) => t.kind === 'shovel').length;
    const wordN = draws.filter((t) => t.kind === 'word').length;
    if (waveNow <= TUNING.earlyShovelWave) this.aiEarlySummonShovels += shovelN;
    if (waveNow <= TUNING.earlyWordCapWave) this.aiEarlySummonWordsCap += wordN;
    if (waveNow <= TUNING.earlyWordGuaranteeWave) this.aiEarlySummonWordsGuarantee += wordN;
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
      ? ECONOMY.PEACH_PER_BOSS
      : isMiniBoss
        ? ECONOMY.PEACH_PER_MINI_BOSS
        : isElite
          ? ECONOMY.PEACH_PER_ELITE
          : ECONOMY.PEACH_PER_KILL;
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
    // 与玩家侧同理：路径度量只依赖静态 aiPath 与 (ax,ay,rge)，与棋面无关，
    // 整个 view 生命周期（一次 planAutoPlaceSteps）内缓存复用，无需随落子失效。
    const caches = this.makePathMetricCaches();
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
        return this.aiPathCoverCached(caches, cell.c, cell.r, rge);
      },
      pathCoverAt: (ax, ay, rge) => this.aiPathCoverCached(caches, ax, ay, rge),
      pathCoverEarlyAt: (ax, ay, rge) => this.aiPathCoverEarlyCached(caches, ax, ay, rge),
      pathFirstEngageAt: (ax, ay, rge) => this.aiPathFirstEngageCached(caches, ax, ay, rge),
      generalRge: (general, tier) => {
        const def = generalById(general);
        return def ? generalStat(def, tier).rge : 2;
      },
      wordChars: (general) => generalById(general)?.chars,
      place: (i, cell) => {
        const token = this.aiTray[i];
        if (!token) return false;
        const snap = this.cloneTrayToken(token);
        const ok = this.aiAutoPlaceApply(i, cell);
        if (ok) {
          this.recordAiAutoPlaceStep({
            kind: 'place',
            trayIndex: i,
            cell: { c: cell.c, r: cell.r },
            token: snap,
          });
        }
        return ok;
      },
      moveUnit: (from, to) => {
        const u = this.aiUnits.find((x) => x.cell.c === from.c && x.cell.r === from.r);
        if (!u) return false;
        if (!this.aiUnlocked.has(cellKey(to.c, to.r)) || !this.aiCellFree(to.c, to.r)) return false;
        u.cell = { c: to.c, r: to.r };
        u.fireDir = faceDirToward(u.cell, this.unitFaceGate(true));
        this.recordAiAutoPlaceStep({ kind: 'moveUnit', from: { c: from.c, r: from.r }, to: { c: to.c, r: to.r } });
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
        this.recordAiAutoPlaceStep({ kind: 'swapUnits', a: { c: a.c, r: a.r }, b: { c: b.c, r: b.r } });
        return true;
      },
      swapUnitWord: (unitCell, wordCell) => {
        const ok = this.aiSwapUnitWord(unitCell, wordCell);
        if (ok) {
          this.recordAiAutoPlaceStep({ kind: 'swapUnitWord', unitCell: { ...unitCell }, wordCell: { ...wordCell } });
        }
        return ok;
      },
      swapWords: (from, to) => {
        const ok = this.aiSwapWords(from, to);
        if (ok) {
          this.recordAiAutoPlaceStep({ kind: 'swapWords', from: { c: from.c, r: from.r }, to: { c: to.c, r: to.r } });
        }
        return ok;
      },
      moveWord: (from, to) => {
        const kFrom = cellKey(from.c, from.r);
        const kTo = cellKey(to.c, to.r);
        const w = this.aiWords.get(kFrom);
        if (!w) return false;
        if (!this.aiUnlocked.has(kTo) || !this.aiCellFree(to.c, to.r)) return false;
        this.aiWords.delete(kFrom);
        w.cell = { c: to.c, r: to.r };
        this.aiWords.set(kTo, w);
        this.recordAiAutoPlaceStep({ kind: 'moveWord', from: { c: from.c, r: from.r }, to: { c: to.c, r: to.r } });
        return true;
      },
      displaceToTray: (cell) => {
        const ok = this.aiDisplaceToTray(cell);
        if (ok) {
          this.recordAiAutoPlaceStep({ kind: 'displaceToTray', cell: { c: cell.c, r: cell.r } });
        }
        return ok;
      },
      removeWord: (cell) => {
        const ok = this.aiRemoveOrphanWord(cell);
        if (ok) {
          this.recordAiAutoPlaceStep({ kind: 'removeWord', cell: { c: cell.c, r: cell.r } });
        }
        return ok;
      },
      isActiveHeroCell: (cell) =>
        this.aiActiveGenerals().some((g) => g.cells.some((c) => c.c === cell.c && c.r === cell.r)),
      dangerNear: () => this.aiDangerNear(),
      imminentPathScore: (cell) =>
        this.imminentPathScoreAt(this.aiMonsters, this.aiPath, this.aiPathLen, this.aiEntranceDist, cell),
      monstersPresent: () => this.aiMonsters.length > 0,
      heroRosterComplete: () => {
        const active = this.aiActiveGenerals();
        if (active.length === 0) return false;
        if (!active.every((g) => g.def.maxTier === 5 && g.tier >= 5)) return false;
        return this.aiUnlockedCells().every((c) => this.aiCellFree(c.c, c.r) === false);
      },
      unitEngageScore: (cell, type, tier) =>
        this.engageScoreAt(this.aiMonsters, this.aiPath, this.aiEntranceDist, cell, type, tier, this.aiDangerNear()),
      mergeTray: (from, to) => {
        const ok = this.aiMergeTrayTokens(from, to);
        if (ok) {
          this.recordAiAutoPlaceStep({ kind: 'mergeTray', from, to });
        }
        return ok;
      },
      mergeBoard: (from, to) => {
        const ok = this.aiMergeBoardUnits(from, to);
        if (ok) {
          this.recordAiAutoPlaceStep({ kind: 'mergeBoard', from: { c: from.c, r: from.r }, to: { c: to.c, r: to.r } });
        }
        return ok;
      },
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
    // Monster 已含 dist/hp/maxHp，直接传入避免每次 map 分配（布阵/调位热点）
    return engageThreatAt(
      monsters,
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

  /** 对 AI 半场妖怪扣血并触发受击反馈 */
  private hurtAiMonster(m: Monster, dmg: number, pos: { c: number; r: number }, hitFlash = 0.12, crit = false): void {
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
    const heroPending = aiHeroPartnerAdjustPending(view);
    const layoutSnap = this.cloneAiAutoplaceLayout();
    const keyBefore = autoPlaceBoardKey(view);
    if (heroPending) {
      this.beginAiPlaceDropStagger();
      planAutoPlaceSteps(view, {
        rng: () => this.aiRng.next(),
        pSubOptimal,
        randomDigExitWeight: true,
        maxOrphanWords: AI_MAX_ORPHAN_WORDS,
        maxSteps: 1,
      });
    } else if (this.aiMonsters.length > 0) {
      // 无怪时不做纯调位：调位只按路径覆盖择优，空场会在两套等价布局间反复横跳（见 oscillation-probe）。
      // 与玩家侧一致（玩家仅在有怪/有可落 tray 时 reposition），有怪来袭才按怪群微调。
      this.tickBattleReposition('ai', 1);
    }
    this.commitAutoPlaceLayoutMemory('ai', layoutSnap, keyBefore);
    this.aiRepositionTimer = rollAiAdjustInterval(
      heroPending,
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
    Object.assign(b, mergePlacedUnitState(b, a, merged));
    this.aiUnits.splice(ai, 1);
    this.spawnPlaceDropFx('ai', to, {
      kind: 'unit',
      isMerge: true,
      sfx: 'merge',
      unitType: merged.type,
      unitTier: merged.tier,
    });
    return true;
  }

  // 从候选区把第 index 个令牌落到目标格：
  // - 铲子 → 锁定的可摆放格 → 开挖解锁
  // - 兵种 → 空绿格放置；同型同级则合并升阶；非同型则替换（旧单位被换下）
  placeFromTray(index: number, to: Cell): boolean {
    const ok = this.doPlaceFromTray(index, to);
    if (ok) this.clearAutoPlaceLayoutMemory();
    return ok;
  }

  private doPlaceFromTray(index: number, to: Cell): boolean {
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
      if (this.playerUseAutoPlaceDrag()) {
        return this.queueAutoPlaceDrag(index, to, token, 'digShovel', 'shovel');
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
        if (exist.level === token.level && exist.level < PEACH_TREE.maxLevel) {
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
          if (this.playerUseAutoPlaceDrag()) {
            return this.queueAutoPlaceDrag(
              index,
              to,
              token,
              'feedGeneralWord',
              'merge',
              g.cells.map((cc) => ({ c: cc.c, r: cc.r })),
            );
          }
          wa.tier += 1;
          wb.tier += 1;
          this.clearTraySlot(index);
          this.bursts.push({ kind: 'merge', c: g.cells[0].c, r: g.cells[0].r, ttl: 0.35, maxTtl: 0.35, big: false, color: qualityColor(wa.tier) });
          this.bursts.push({ kind: 'merge', c: g.cells[1].c, r: g.cells[1].r, ttl: 0.35, maxTtl: 0.35, big: false, color: qualityColor(wb.tier) });
          this.message = `${g.def.name} 升为 ${wa.tier} 阶`;
          for (let i = 0; i < g.cells.length; i++) {
            const cc = g.cells[i]!;
            this.spawnPlaceDropFx('player', cc, {
              kind: 'word',
              isMerge: true,
              sfx: 'merge',
              char: cc.c === g.cells[0].c ? wa.char : wb.char,
              wordTier: wa.tier,
              playSfx: i === 0,
            });
          }
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
        this.words.set(cellKey(to.c, to.r), placedWordFromTray(token, { c: to.c, r: to.r }));
        this.tray[index] = trayWordFromPlaced(exist);
        this.message = exist.char === token.char
          ? `「${token.char}」${token.tier} 阶与棋盘 ${exist.tier} 阶交换`
          : `与字牌「${exist.char}」交换`;
        return true;
      }
      // 该格有兵 → 字牌与兵交换（字牌落格，兵回候选槽），与「不同型兵交换」一致
      const uexist = this.units.get(cellKey(to.c, to.r));
      if (uexist) {
        this.units.delete(cellKey(to.c, to.r));
        this.words.set(cellKey(to.c, to.r), placedWordFromTray(token, { c: to.c, r: to.r }));
        this.tray[index] = { kind: 'unit', type: uexist.type, tier: uexist.tier };
        this.message = `与 ${UNITS[uexist.type].name} 交换`;
        return true;
      }
      if (this.playerUseAutoPlaceDrag()) {
        return this.queueAutoPlaceDrag(index, to, token, 'placeWord', this.playerWordPlaceSfx(to));
      }
      this.words.set(cellKey(to.c, to.r), placedWordFromTray(token, { c: to.c, r: to.r }));
      this.clearTraySlot(index);
      this.spawnPlaceDropFx('player', to, {
        kind: 'word',
        isMerge: false,
        sfx: this.playerWordPlaceSfx(to),
        char: token.char,
        wordTier: token.tier,
      });
      if (this.activeGenerals().some((ag) => ag.cells.some((cc) => cc.c === to.c && cc.r === to.r))) {
        const activated = this.activeGenerals().find((ag) => ag.cells.some((cc) => cc.c === to.c && cc.r === to.r))!;
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
      if (this.isHeroRosterComplete()) {
        this.clearTraySlot(index);
      } else {
        this.tray[index] = trayWordFromPlaced(wexist);
      }
      this.message = `与字牌「${wexist.char}」交换`;
      return true;
    }
    const exist = this.units.get(cellKey(to.c, to.r));
    if (exist) {
      if (canMerge({ type: exist.type, tier: exist.tier }, { type: token.type, tier: token.tier })) {
        if (this.playerUseAutoPlaceDrag()) {
          return this.queueAutoPlaceDrag(index, to, token, 'mergeUnit', 'merge');
        }
        const merged = mergeUnits({ type: exist.type, tier: exist.tier }, { type: token.type, tier: token.tier });
        this.units.set(cellKey(to.c, to.r), mergePlacedUnitState(exist, makePlacedUnit(token.type, token.tier, exist.cell), merged));
        this.bursts.push({ kind: 'merge', c: to.c, r: to.r, ttl: 0.35, maxTtl: 0.35, big: false, color: '#ffd76a' });
        this.clearTraySlot(index);
        this.message = `合成 ${UNITS[merged.type].name} ${merged.tier} 阶`;
        this.spawnPlaceDropFx('player', to, {
          kind: 'unit',
          isMerge: true,
          sfx: 'merge',
          unitType: merged.type,
          unitTier: merged.tier,
        });
        return true;
      }
      // 不可合并 → 交换：候选区令牌落格，原格单位回到候选区该槽（绝不删除）
      this.units.set(cellKey(to.c, to.r), makePlacedUnit(token.type, token.tier, { c: to.c, r: to.r }, this.unitFaceGate()));
      this.tray[index] = { kind: 'unit', type: exist.type, tier: exist.tier };
      this.message = `与 ${UNITS[exist.type].name} 交换`;
      return true;
    }
    if (this.playerUseAutoPlaceDrag()) {
      return this.queueAutoPlaceDrag(index, to, token, 'placeUnit', 'place');
    }
    this.units.set(cellKey(to.c, to.r), makePlacedUnit(token.type, token.tier, { c: to.c, r: to.r }, this.unitFaceGate()));
    this.clearTraySlot(index);
    this.message = `布置了 ${UNITS[token.type].name}`;
    this.spawnPlaceDropFx('player', to, {
      kind: 'unit',
      isMerge: false,
      sfx: 'place',
      unitType: token.type,
      unitTier: token.tier,
    });
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
    this.emit('shovel'); // 第一铲；半程再铲一声
    this.peach += this.mods.shovelPeach; // 摸金校尉
    this.message = '铲子挖开了新阵位';
    return true;
  }

  // 棋盘内拖拽总入口：源格是桃树走 dragTree，字牌走 dragWord，否则走 dragUnit
  dragBoard(from: Cell, to: Cell): boolean {
    if (this.trees.has(cellKey(from.c, from.r))) {
      const ok = this.dragTree(from, to);
      if (ok) this.clearAutoPlaceLayoutMemory();
      return ok;
    }
    if (this.words.has(cellKey(from.c, from.r))) {
      const ok = this.dragWord(from, to);
      if (ok) this.clearAutoPlaceLayoutMemory();
      return ok;
    }
    const ok = this.dragUnit(from, to);
    if (ok) this.clearAutoPlaceLayoutMemory();
    return ok;
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
        this.units.set(cellKey(to.c, to.r), mergePlacedUnitState(b, a, merged));
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
    // 首波给全体已装备被动闪一次斜光，作为「这些被动已生效」的确认反馈（静态 buff 无离散触发点）。
    if (!this.passivesFlashedAtStart) {
      this.passivesFlashedAtStart = true;
      for (const id of this.pickedItems) if (passiveById(id)) this.flashPassive(id);
      for (const id of this.aiPickedItems) if (passiveById(id)) this.flashPassive(id, 0.45, true);
    }
    this.introDone = true; // 手动开波则跳过入场
    this.introT = Battle.INTRO_DUR;
    this.wave += 1;
    this.status = 'playing';
    this.waveActive = true;
    this.healUsedThisWave = false;
    this.aiHealUsedThisWave = false;
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
    this.meteorPending = this.mods.meteor; // 本波被动陨石待触发（等最前活怪走过 ≥ meteorRadius）
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
  private startPalmPush(cells: number, ai = false): void {
    const list = ai ? this.aiMonsters : this.monsters;
    if (list.length === 0) return;
    let frontStartDist = 0;
    for (const m of list) if (m.dist > frontStartDist) frontStartDist = m.dist;
    const fx: PalmPushFx = {
      t: 0,
      dur: SKILL_FX_DUR,
      fadeT: 0,
      cells,
      frontStartDist,
      snapshots: list.map((m) => ({ id: m.id, startDist: m.dist })),
    };
    if (ai) this.aiPalmPushFx = fx;
    else this.palmPushFx = fx;
  }

  private palmPushWaveDistFor(fx: PalmPushFx | null): number | null {
    if (!fx) return null;
    const p = Math.min(1, fx.t / fx.dur);
    const eased = 1 - (1 - p) ** 2;
    return fx.frontStartDist - fx.cells * eased;
  }

  private updateOnePalmPush(fx: PalmPushFx | null, monsters: Monster[], dt: number): PalmPushFx | null {
    if (!fx) return null;
    fx.t += dt;
    const p = Math.min(1, fx.t / fx.dur);
    const snapById = new Map(fx.snapshots.map((s) => [s.id, s.startDist]));
    if (p < 1) {
      const eased = 1 - (1 - p) ** 2;
      const pushed = fx.cells * eased;
      for (const m of monsters) {
        const start = snapById.get(m.id);
        if (start !== undefined) m.dist = Math.max(0, start - pushed);
      }
      return fx;
    }
    if (fx.fadeT === 0) {
      for (const m of monsters) {
        const start = snapById.get(m.id);
        if (start !== undefined) m.dist = Math.max(0, start - fx.cells);
      }
    }
    fx.fadeT += dt;
    if (fx.fadeT >= PALM_PUSH_FADE_DUR) return null;
    return fx;
  }

  private updatePalmPush(dt: number): void {
    this.palmPushFx = this.updateOnePalmPush(this.palmPushFx, this.monsters, dt);
    this.aiPalmPushFx = this.updateOnePalmPush(this.aiPalmPushFx, this.aiMonsters, dt);
  }

  /** 回推波前位置（格），供渲染沿路径绘制掌印 */
  palmPushWaveDist(): number | null {
    return this.palmPushWaveDistFor(this.palmPushFx);
  }

  aiPalmPushWaveDist(): number | null {
    return this.palmPushWaveDistFor(this.aiPalmPushFx);
  }

  private setSkillFx(kind: SkillFxKind, cell: { c: number; r: number }, ai: boolean): void {
    const dur = kind === 'atkBuff' || kind === 'frqBuff' ? BUFF_SKILL_FX_DUR : SKILL_FX_DUR;
    const fx: SkillFx = { kind, t: 0, dur, c: cell.c, r: cell.r };
    if (ai) this.aiSkillFx = fx;
    else this.playerSkillFx = fx;
  }

  /** 被动技能生效时的图标斜光提示：设斜光剩余时长（玩家/ AI 各一份）。若已闪则取较长的剩余，避免连触发时过早熄灭。 */
  flashPassive(id: string, dur = 0.45, ai = false): void {
    const store = ai ? this.aiPassiveFlash : this.passiveFlash;
    store.set(id, Math.max(store.get(id) ?? 0, dur));
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
    // 被动生效斜光计时衰减（玩家 + AI 两侧）
    for (const [id, t] of this.passiveFlash) {
      if (t <= dt) this.passiveFlash.delete(id);
      else this.passiveFlash.set(id, t - dt);
    }
    for (const [id, t] of this.aiPassiveFlash) {
      if (t <= dt) this.aiPassiveFlash.delete(id);
      else this.aiPassiveFlash.set(id, t - dt);
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
      if (this.shovelTimer >= 45) { this.shovelTimer = 0; this.shovels += 1; this.flashPassive('luoyangchan'); }
    }
    if (this.aiMods.autoShovel) {
      this.aiShovelTimer += dt;
      if (this.aiShovelTimer >= 45) { this.aiShovelTimer = 0; this.aiShovels += 1; this.flashPassive('luoyangchan', 0.45, true); }
    }
  }

  // 蟠桃园：每 40s 在未开垦空地自动种 1 棵 1 级桃树；满格则尝试往已有桃树合并升级。
  // 仅在 status 为 playing/ready（对局进行中）推进，由 updateFx 调用。
  private updatePeachTrees(dt: number): void {
    if (this.gardenOn) {
      this.plantTimer += dt;
      if (this.plantTimer >= PEACH_TREE.plantInterval) {
        if (this.plantTree()) {
          this.plantTimer = 0;
          this.plantBank = 0;
          this.flashPassive('pas_pantao'); // 蟠桃园生效：种下一棵新桃树
        } else if (this.tryAutoMergePlant()) {
          this.plantTimer = 0;
        } else {
          this.plantTimer = PEACH_TREE.plantInterval; // 全 5 级：封顶不再合并
        }
      }
    }
    for (const t of this.trees.values()) {
      t.growT += dt;
      const iv = PEACH_TREE.intervals[Math.min(t.level, PEACH_TREE.maxLevel) - 1]!;
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
    if (trees.every((t) => t.level >= PEACH_TREE.maxLevel)) return false;

    const minLevel = Math.min(...trees.map((t) => t.level));
    const allSame = trees.every((t) => t.level === minLevel);

    if (!allSame) {
      const target = trees.find((t) => t.level === minLevel);
      if (!target || target.level >= PEACH_TREE.maxLevel) return false;
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
    const iv = PEACH_TREE.intervals[Math.min(t.level, PEACH_TREE.maxLevel) - 1]!;
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
      if (tt.level === t.level && tt.level < PEACH_TREE.maxLevel) {
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

  /**
   * 被动陨石就绪：场上有活怪，且「走过最长」的活怪已离开口 ≥ meteorRadius（攻击范围）。
   * 避免刚出怪口就砸（只能打到 1～2 只）；等怪走进射程圈后再砸，便于覆盖一波。
   */
  private passiveMeteorReady(
    monsters: { dist: number }[],
    entranceDist: number,
  ): boolean {
    if (monsters.length === 0) return false;
    let maxDist = monsters[0]!.dist;
    for (let i = 1; i < monsters.length; i++) {
      if (monsters[i]!.dist > maxDist) maxDist = monsters[i]!.dist;
    }
    return maxDist - entranceDist >= TUNING.meteorRadius;
  }

  // 陨石：被动「陨石」道具触发，带 mods.meteor 守卫。
  private castMeteor(): void {
    if (!this.mods.meteor || this.monsters.length === 0) return;
    // 传 skillFx=true：复用主动陨石那套「下落陨石+陨石坑」完整特效（此前只画了一个小 death 爆发，
    // 玩家几乎看不到、误以为怪物凭空被秒；现与 AI 被动陨石、主动陨石视觉一致）。
    this.doMeteor(TUNING.meteorPassiveDmgMul, true);
    this.flashPassive('yunshi'); // 陨石生效：HUD 陨石图标划斜光
  }

  private castAiMeteor(): void {
    if (!this.aiMods.meteor || this.aiMonsters.length === 0) return;
    this.doAiMeteor(TUNING.meteorPassiveDmgMul, true);
    this.flashPassive('yunshi', 0.45, true); // AI 侧陨石生效斜光
  }

  // 陨石伤害核心（无守卫）：被动道具与「天降陨石」主动技能共用；mul 为相对波血倍率
  // skillFx=true 时即使场上无怪也落点播特效（主动技能反馈）；被动无怪则直接跳过
  private doMeteor(mul: number = TUNING.meteorDmgMul, skillFx = false): void {
    if (this.monsters.length === 0) {
      if (skillFx) {
        const p = posAtDistance(this.map, this.pathLen * 0.55);
        this.setSkillFx('meteor', p, false);
      }
      return;
    }
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
    if (this.aiMonsters.length === 0) {
      if (skillFx) {
        const p = posAlong(this.aiPath, lenOf(this.aiPath) * 0.55);
        this.setSkillFx('meteor', p, true);
      }
      return;
    }
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

  // —— 埋雷炸药（主动技能 bomb）——
  // 落点必须在路径上（妖怪必经之路）；可埋多颗，但同一格子最多一颗（炸响后该格释放，可再埋）。
  // 唐僧所在格不能埋（怪到此即被收/通关，埋雷无意义）。
  private bombOnPath(ai: boolean, cell: { c: number; r: number }): boolean {
    const tang = ai ? this.aiTangseng : this.map.tangseng;
    if (cell.c === tang.c && cell.r === tang.r) return false;
    return Battle.nearestPathDistOn(ai ? this.aiPath : this.map.path, cell) <= 0.75;
  }

  private bombCellTaken(list: { c: number; r: number }[], cell: { c: number; r: number }): boolean {
    return list.some((b) => Math.hypot(b.c - cell.c, b.r - cell.r) < 0.5);
  }

  /** 玩家埋雷：拖拽释放到路径格时调用。返回是否成功（成功才进冷却）。 */
  placeBomb(i: number, cell: Cell): boolean {
    // 波间等待（status='ready'）也允许埋雷，供玩家提前布置迎接下一波
    if (this.status !== 'playing' && this.status !== 'ready') return false;
    const slot = this.activeSlots[i];
    if (!slot?.ready) return false;
    const def = activeById(slot.id);
    if (!def || def.effect !== 'bomb') return false;
    if (!this.bombOnPath(false, cell)) { this.message = '炸药只能埋在妖怪必经的路径上'; return false; }
    if (this.bombCellTaken(this.bombs, cell)) { this.message = '这个格子已经埋了炸药'; return false; }
    this.bombs.push({ c: cell.c, r: cell.r, t: 0 });
    slot.cd = slot.cdMax;
    slot.ready = false;
    slot.flash = 0.6;
    this.message = '轰天雷已埋下，静候妖怪踏入';
    this.emit('item');
    return true;
  }

  /** AI 埋雷：在指定路径格埋下（由 triggerAiActive 调用；CD 交给其公共尾部统一处理，风格同仙丹）。 */
  private placeAiBomb(cell: { c: number; r: number }): boolean {
    if (!this.bombOnPath(true, cell) || this.bombCellTaken(this.aiBombs, cell)) return false;
    this.aiBombs.push({ c: cell.c, r: cell.r, t: 0 });
    return true;
  }

  /** AI 埋点：从离唐僧最近（路径末端）往外（入口方向）找第一个还能埋的路径格，
   *  必须落在路径格正中间（整数格），不能放 fractional 位置。 */
  private aiBombPlacementCell(): { c: number; r: number } | null {
    const path = this.aiPath;
    const tang = this.aiTangseng;
    for (let i = path.length - 1; i >= 0; i--) {
      const cell = path[i]!;
      if (cell.c === tang.c && cell.r === tang.r) continue; // 唐僧格禁埋
      if (this.bombCellTaken(this.aiBombs, cell)) continue; // 每格最多一颗
      return { c: cell.c, r: cell.r };
    }
    return null;
  }

  /** AI 是否还有可埋雷的路径格（供 aiShouldTriggerActive 判是否值得触发，避免空触发耗 CD） */
  private hasAiBombSlot(): boolean {
    return this.aiBombPlacementCell() !== null;
  }

  // 每帧：引信闪烁计时 + 妖怪踏入引爆（逐颗判定）+ 爆炸特效寿命推进
  private updateBombs(dt: number): void {
    this.stepBombs(this.bombs, false, dt);
    this.stepBombs(this.aiBombs, true, dt);
    if (this.bombFx.length) {
      for (const f of this.bombFx) f.ttl -= dt;
      this.bombFx = this.bombFx.filter((f) => f.ttl > 0);
    }
  }

  private stepBombs(list: { c: number; r: number; t: number }[], ai: boolean, dt: number): void {
    for (let k = list.length - 1; k >= 0; k--) {
      const bmb = list[k]!;
      bmb.t += dt;
      if (this.anyMonsterAtBomb(bmb, ai)) {
        this.explodeBombAt(bmb, ai);
        list.splice(k, 1);
      }
    }
  }

  private anyMonsterAtBomb(bomb: { c: number; r: number }, ai: boolean): boolean {
    const monsters = ai ? this.aiMonsters : this.monsters;
    for (const m of monsters) {
      if (m.hp <= 0) continue;
      const p = ai ? posAlong(this.aiPath, m.dist) : posAtDistance(this.map, m.dist);
      if (Math.hypot(p.c - bomb.c, p.r - bomb.r) <= TUNING.bombContactRadius) return true;
    }
    return false;
  }

  // 单颗炸药引爆：范围 AOE 伤害 + 特效（不改动列表，由调用方移除该颗）
  private explodeBombAt(bomb: { c: number; r: number }, ai: boolean): void {
    const p = { c: bomb.c, r: bomb.r };
    const dmg = ai
      ? (TUNING.monsterHpBase + TUNING.monsterHpStep * this.wave) * this.effectiveDifficulty() * TUNING.bombDmgMul
      : this.normalMonsterHp() * TUNING.bombDmgMul;
    const monsters = ai ? this.aiMonsters : this.monsters;
    for (const m of monsters) {
      if (m.hp <= 0) continue;
      const q = ai ? posAlong(this.aiPath, m.dist) : posAtDistance(this.map, m.dist);
      if (Math.hypot(q.c - p.c, q.r - p.r) > TUNING.bombExplodeRadius) continue;
      if (ai) { m.hp -= dmg; m.hitFlash = 0.2; this.spawnDamageFloat(q.c, q.r, dmg); }
      else this.hurtMonster(m, dmg, q, 0.2);
    }
    this.bombFx.push({ c: p.c, r: p.r, ttl: 0.6, maxTtl: 0.6, ai });
    this.bursts.push({ kind: 'death', c: p.c, r: p.r, ttl: 0.5, maxTtl: 0.5, big: true, color: '#ff7a3c' });
    if (!ai) {
      this.ultFlash = Math.max(this.ultFlash, 0.4);
      this.message = '轰天雷炸响！';
      this.emit('ult');
    }
  }

  // 开局预排本局神兵碎片：是否可能掉落 + 掉哪一件（main 注入可见性后调用）
  planBattleFragmentDrop(): void {
    this.battleFragmentDropId = null;
    this.battleFragmentDropped = false;
    if (this.rng.next() >= WEAPON_TUNING.battleFragmentEligibleChance) return;
    this.battleFragmentDropId = rollWeaponDrop(this.rng.next());
  }

  /** 武将攻击命中时 10% 触发预排碎片（整局最多 1 次；已集齐则不展示） */
  private tryRollFragmentOnHeroAttack(): void {
    const id = this.battleFragmentDropId;
    if (!id || this.battleFragmentDropped) return;
    if (!this.weaponPickupVisible(id)) return;
    if (this.rng.next() >= WEAPON_TUNING.heroAttackFragmentChance) return;
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

  /** 波 >10 后 HP 线性加成（每波 +1%）；移速固定不乘此系数 */
  wavePostMul(wave: number = this.wave): number {
    if (wave <= 10) return 1;
    return 1 + (wave - 10) / 100;
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

  // 本波出怪总数基准：10 + 波次 - 1（wave1=10 …）；经济掉落与 game-core monstersInWave 对齐。
  // 第 PRESSURE_FROM_WAVE 波起还会按最优输出抬升（见 computeWavePressure），本函数结果作为最低保底。
  private baselineWaveSpawnCount(wave: number): number {
    return monstersInWave(wave);
  }

  /** 前 monsterHpNoDiffTo 波固定血量（不含境界 / DPS 缩放）；表外回退 base+step×wave */
  private fixedMonsterHp(wave: number): number {
    const w = Math.max(1, Math.floor(wave));
    const early = TUNING.monsterHpEarlyFixed[w - 1];
    const baseHp = early ?? TUNING.monsterHpBase + TUNING.monsterHpStep * w;
    return baseHp * this.wavePostMul(w);
  }

  /**
   * 目标血量：静态公式 × effectiveDifficulty，第 MONSTER_HP_FROM_WAVE 波起再与 DPS 公式取 max。
   * 不含爬坡上限（爬坡见 normalMonsterHp）。
   */
  private targetMonsterHp(wave: number, optimalDps?: number): number {
    const diffMul = this.effectiveDifficulty(wave);
    const staticHp =
      (TUNING.monsterHpBase + TUNING.monsterHpStep * wave) * diffMul * this.wavePostMul(wave);
    if (wave < BOARD_POWER.MONSTER_HP_FROM_WAVE) return staticHp;
    const dps = optimalDps ?? this.estimateOptimalPower().optimalDps;
    const powerBase = monsterHpFromBoardPower(wave, dps, pressureRatioForWave(wave));
    if (powerBase <= 0) return staticHp;
    return Math.max(staticHp, powerBase * diffMul * this.wavePostMul(wave));
  }

  /** 爬坡起始波（紧接固定公式波之后，默认 4） */
  private monsterHpRampFromWave(): number {
    return TUNING.monsterHpNoDiffTo + 1;
  }

  /** 第 wave 波爬坡上限增量：monsterHpStep×rampMul(cycle) + (wave − 起始波) */
  private monsterHpRampMaxStep(wave: number): number {
    const cycle = Math.floor((Math.max(1, wave) - 1) / TUNING.endlessWavesPerCycle);
    const mul = TUNING.monsterHpRampMulByCycle[Math.min(cycle, TUNING.monsterHpRampMulByCycle.length - 1)]!;
    return TUNING.monsterHpStep * mul + (wave - this.monsterHpRampFromWave());
  }

  /**
   * 普通怪基础血量（不含 Boss/精英倍乘）：
   * - 波 ≤ monsterHpNoDiffTo：monsterHpEarlyFixed
   * - 其后：从上波实际血量朝 targetMonsterHp 爬坡，每波最多 +monsterHpRampMaxStep(wave)
   */
  private normalMonsterHp(wave: number = this.wave): number {
    const w = Math.max(1, Math.floor(wave));
    if (w <= TUNING.monsterHpNoDiffTo) return this.fixedMonsterHp(w);
    const optimalDps = this.estimateOptimalPower().optimalDps;
    let hp = this.fixedMonsterHp(TUNING.monsterHpNoDiffTo);
    for (let i = TUNING.monsterHpNoDiffTo + 1; i <= w; i++) {
      hp = Math.min(this.targetMonsterHp(i, optimalDps), hp + this.monsterHpRampMaxStep(i));
    }
    return hp;
  }

  /** 某波普通怪基础移速（固定 TUNING.monsterSpd；不含被动减速、Boss/骑兵倍乘） */
  private endlessMonsterBaseSpeed(_wave: number = this.wave): number {
    return TUNING.monsterSpd;
  }

  /** 某波普通怪移速（含被动减速，不含 Boss/骑兵倍乘） */
  private normalMonsterSpeed(wave: number = this.wave): number {
    return this.endlessMonsterBaseSpeed(wave) * this.mods.monsterSpdMul;
  }

  /** 某波 Boss 移速（含被动减速） */
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
      difficultySpawnFactor: 1,
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
    return Math.max(TUNING.spawnIntervalMin, TUNING.spawnInterval);
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

  /** 小 Boss 按种类的移速倍率（本体固有移速，非疾风光环加速，DevTools 可调）：
   *  霜魄/撼地用 miniBossSpdMulSlow、疾风用 miniBossSpdMulFast、其余用默认 miniBossSpdMul。 */
  static miniBossSpawnSpdMul(
    kind: MiniBossKind | null,
    t: { miniBossSpdMul: number; miniBossSpdMulSlow: number; miniBossSpdMulFast: number },
  ): number {
    if (kind === 'frost' || kind === 'quake') return t.miniBossSpdMulSlow;
    if (kind === 'gale') return t.miniBossSpdMulFast;
    return t.miniBossSpdMul;
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
        // 精英击杀给普通妖 4 倍蟠桃，血量需相应更高，否则性价比失衡（见 ECONOMY.PEACH_PER_ELITE）
        hp *= TUNING.eliteHpMul;
      }
      if (isCavalry) hp *= TUNING.cavalryHpMul;
    }

    // 移速倍率：BOSS/小 Boss 略慢、骑兵快（互斥）；小 Boss 再按种类细分（霜魄/撼地慢、疾风快）
    const spdMul = isBoss
      ? TUNING.bossSpdMul
      : isMiniBoss
        ? Battle.miniBossSpawnSpdMul(miniKind, TUNING)
        : isCavalry
          ? TUNING.cavalrySpdMul
          : 1;

    const skillCd = isMiniBoss
      ? (miniKind === 'lion'
        ? TUNING.miniBossStealDelayMin + this.rng.next() * (TUNING.miniBossStealDelayMax - TUNING.miniBossStealDelayMin)
        : TUNING.miniBossFirstDelay)
      : TUNING.skillFirstDelay;
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
      miniBossCasted: false,
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
        const escortOff = off - (i + 1) * TUNING.bossEscortSpacing - this.rng.next() * BOARD_POWER.SPAWN_DIST_JITTER;
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
      // 老君炼丹增益倒计时：镜像玩家侧 updateUnits，逐帧衰减，到点清空倍率（否则 AI 兵器加成常驻、状态图标不消失）
      if ((u.buffAtkT ?? 0) > 0) {
        u.buffAtkT = Math.max(0, (u.buffAtkT ?? 0) - dt);
        if (u.buffAtkT <= 0) u.buffAtkMul = undefined;
      }
      u.cooldown -= dt;
      if (u.cooldown > 0) continue;
      const stat = getUnitStat(u.type, u.tier);
      const base = Math.floor(stat.targets);
      const extra = this.aiRng.next() < stat.targets - base ? 1 : 0; // 用 AI 独立随机流，不扰动玩家 rng
      const maxTargets = Math.max(1, base + extra);
      const inRangeRaw = monsterPos.filter((x) => inAttackRange(u.cell.c, u.cell.r, stat.rge, x.p));
      if (inRangeRaw.length === 0) continue;
      const inRange = this.sortCombatTargets(inRangeRaw);
      // 仙丹增伤 + 大圣羁绊 + 老君炼丹增益（与玩家侧同一套计算）
      const heroAtkBuff = (u.buffAtkT ?? 0) > 0 ? (u.buffAtkMul ?? 1) : 1;
      const dmg = damage(stat.atk * this.aiMods.atkMul * (u.pillAtk ? TUNING.atkBuffMul : 1) * this.aiBondAtkMul() * heroAtkBuff);
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
      u.cooldown = 1 / (stat.frq * this.aiFrqMul * this.aiMods.frqMul * (u.pillFrq ? TUNING.frqBuffMul : 1));
    }
  }

  // AI 武将攻击 tick：镜像玩家 updateGenerals（含 AI 道具 / 神兵 / 羁绊 / 大招）。
  private updateAiGenerals(dt: number): void {
    for (const g of this.aiActiveGenerals()) {
      const stat = generalStat(g.def, g.tier);
      const s = g.state;
      s.firePulse = Math.max(0, s.firePulse - dt * 6);
      s.skillFlash = Math.max(0, s.skillFlash - dt * 3);
      if ((s.buffAtkT ?? 0) > 0) {
        s.buffAtkT = Math.max(0, (s.buffAtkT ?? 0) - dt);
        if (s.buffAtkT <= 0) s.buffAtkMul = undefined;
      }
      const ax = (g.cells[0].c + g.cells[1].c) / 2;
      const ay = (g.cells[0].r + g.cells[1].r) / 2;
      const inRange = this.sortCombatTargets(
        this.aiMonsters
          .map((m) => ({ m, p: posAlong(this.aiPath, m.dist) }))
          .filter((x) => inAttackRange(ax, ay, this.aiGeneralRge(g), x.p)),
      );

      if (g.def.skill !== 'none' && g.def.skillCd > 0) {
        s.skillCd -= dt;
        const needsTarget = g.def.skill !== 'buff' && g.def.skill !== 'cdr';
        if (s.skillCd <= 0 && (!needsTarget || inRange.length > 0)) {
          this.castGeneralSkill(g, inRange, true);
          s.skillCd = g.def.skillCd;
        }
      }

      s.cooldown -= dt;
      if (s.cooldown > 0 || inRange.length === 0) continue;
      const base = Math.floor(stat.targets);
      const extra = this.aiRng.next() < stat.targets - base ? 1 : 0;
      const maxTargets = Math.max(1, base + extra);
      const dmg = damage(this.aiGeneralAtk(g));
      let hit = 0;
      for (const t of inRange) {
        if (hit >= maxTargets) break;
        this.hurtAiMonster(t.m, dmg, t.p, 0.12);
        this.pushGeneralAttackFx(g, t.p);
        hit++;
      }
      if (hit > 0) {
        s.firePulse = 1;
        const tp = inRange[0]!.p;
        s.fireDir = Math.atan2(tp.r - ay, tp.c - ax);
        this.addGeneralCombatExp(g, Battle.combatExpFromHits(dmg, hit), true);
      }
      const frq = stat.frq * (1 + (this.aiWeaponBonuses[g.def.id]?.frq ?? 0));
      s.cooldown = 1 / (frq * this.aiMods.frqMul * (g.pillFrq ? TUNING.frqBuffMul : 1));
    }
  }

  // AI 侧推进：真玩家循环（征兵节奏→共享布阵→单位/武将攻击→怪物推进/漏怪扣血/击杀产桃）
  private updateAi(dt: number): void {
    if (this.endless) return; // 无尽模式无 AI 对手
    const knobs = skillToKnobs(this.aiSkill);
    // 1) 征兵节奏：到点且够桃则征一次，随后共享布阵
    let aiPlacedThisFrame = false;
    this.aiSummonTimer -= dt;
    // 自动部署（aiAutoPlacePlaying）播放期间暂停征兵：上一波落子还在逐步回放上板，
    // 此时再征兵会重新 clone/restore 会话快照，覆盖尚未播完的布局。
    if (this.aiSummonTimer <= 0 && !this.aiAutoPlacePlaying) {
      this.aiSummonTimer = knobs.summonInterval;
      if (this.aiSummon()) {
        aiPlacedThisFrame = true;
        const sessionSnap = this.cloneAiAutoPlaceSession();
        const keyBefore = autoPlaceBoardKey(this.buildAiAutoView());
        const recorded: AutoPlacePlaybackStep[] = [];
        this.aiAutoPlaceRecorder = recorded;
        this.aiAutoPlaceRecording = true;
        this.beginAiPlaceDropStagger();
        planAutoPlaceSteps(this.buildAiAutoView(), {
          rng: () => this.aiRng.next(),
          pSubOptimal: knobs.pSubOptimal,
          randomDigExitWeight: true,
          maxOrphanWords: AI_MAX_ORPHAN_WORDS,
          maxSteps: AI_PLACE_MAX_STEPS,
          maxGuard: AI_PLACE_MAX_GUARD,
          deadlineMs: this.aiMonsters.length > 0
            ? performance.now() + AI_PLACE_DEADLINE_MS
            : undefined,
        });
        this.aiAutoPlaceRecording = false;
        this.aiAutoPlaceRecorder = null;
        this.tickAiShovelReserve();
        const keyAfter = autoPlaceBoardKey(this.buildAiAutoView());
        const oscillating =
          keyAfter !== keyBefore
          && this.lastAiAutoPlaceBoardKey !== null
          && keyAfter === this.lastAiAutoPlaceBoardKey;
        this.restoreAiAutoPlaceSession(sessionSnap);
        if (oscillating) {
          // 与玩家布阵一致：回到上一版布局则跳过本次
        } else {
          if (keyAfter !== keyBefore) this.lastAiAutoPlaceBoardKey = keyBefore;
          if (recorded.length > 0) {
            this.aiAutoPlacePlayback = [...recorded];
            this.aiAutoPlacePlaying = true;
            this.aiAutoPlacePlaybackWait = false;
            this.aiAutoPlacePlaybackGap = 0;
            this.placeDropStagger.ai = 0;
            this.tickAiAutoPlacePlayback();
          }
        }
      }
    }
    // 2) 战中调整：兵器调位 1–2.5s 随机；待补英雄配对字时 0.3–0.5s 单步布阵（与征兵同帧错开）
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
    if (this.aiMeteorPending && this.passiveMeteorReady(this.aiMonsters, this.aiEntranceDist)) {
      this.aiMeteorPending = false;
      this.castAiMeteor();
    }
    if (this.status === 'playing') {
      this.updateAiActives(dt);
      this.tickAiActives();
    }
    this.updateAiUnits(dt);
    this.updateAiGenerals(dt);
    // 4) 怪物推进 + 漏怪扣血 + 击杀产桃（基础经济）
    if (this.aiTangsengHurtImmuneT > 0) {
      this.aiTangsengHurtImmuneT = Math.max(0, this.aiTangsengHurtImmuneT - dt);
    }
    const survivors: Monster[] = [];
    for (const m of this.aiMonsters) {
      m.spawnT += dt;
      if (m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt);
      if (m.hp <= 0) {
        this.creditAiKill(m.isBoss, !m.isBoss && !m.isMiniBoss && !!m.skill, m.isMiniBoss);
        continue;
      } // 击杀产桃（精英/小Boss/大Boss 分档，对齐玩家语义）
      if (m.stunT > 0) {
        m.stunT = Math.max(0, m.stunT - dt);
      } else if (!this.aiPalmPushFx) {
        m.dist += m.spd * (m.hasteT > 0 ? TUNING.hasteSpdMul : 1)
          * (this.aiMonsterInMudZone(m) ? 0.82 : 1) * dt;
      }
      if (m.hasteT > 0) m.hasteT = Math.max(0, m.hasteT - dt);
      if (m.dist >= this.aiPathLen) {
        if (this.aiTangsengHurtImmuneT > 0) continue;
        this.aiTangsengHP -= 1;
        this.aiTangsengHurtImmuneT = TUNING.tangsengHurtImmuneDur;
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

  // 最远(沿路走得最远)的 AI 侧怪物已推进的格数；无怪时返回 -Infinity（视为未解锁）
  private aiFrontMonsterDist(): number {
    let d = -Infinity;
    for (const m of this.aiMonsters) if (m.dist > d) d = m.dist;
    return d;
  }

  /** 攻击型主动技能(陨石/紧箍咒)择时倒计时：最远怪物越过 aiOffensiveActiveMinDist 才「解锁」，
   * 解锁瞬间随机滚 0~aiOffensiveActiveDelayMax 秒延迟，避免一开怪就死板打出；怪物退回阈值下则清空重来。 */
  private tickAiOffensiveActiveDelay(dt: number): void {
    const unlocked = this.aiFrontMonsterDist() >= TUNING.aiOffensiveActiveMinDist;
    for (const effect of ['meteor', 'jinggu', 'bomb'] as const) {
      if (!unlocked) {
        delete this.aiOffensiveDelay[effect];
        continue;
      }
      const remain = this.aiOffensiveDelay[effect];
      if (remain === undefined) {
        this.aiOffensiveDelay[effect] = this.aiRng.next() * TUNING.aiOffensiveActiveDelayMax;
      } else if (remain > 0) {
        this.aiOffensiveDelay[effect] = Math.max(0, remain - dt);
      }
    }
  }

  private aiOffensiveActiveReady(effect: 'meteor' | 'jinggu' | 'bomb'): boolean {
    const remain = this.aiOffensiveDelay[effect];
    return remain !== undefined && remain <= 0;
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
      if ((u.buffAtkT ?? 0) > 0) {
        u.buffAtkT = Math.max(0, (u.buffAtkT ?? 0) - dt);
        if (u.buffAtkT <= 0) u.buffAtkMul = undefined;
      }
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
      // 降攻减益：仅临时削弱伤害，不改动基础数值；仙丹增益 + 大圣羁绊 + 老君炼丹抬高攻击
      const heroAtkBuff = (u.buffAtkT ?? 0) > 0 ? (u.buffAtkMul ?? 1) : 1;
      const atkMul = this.mods.atkMul * (u.weakenT > 0 ? TUNING.weakenAtkMul : 1) * (u.pillAtk ? TUNING.atkBuffMul : 1) * this.bondAtkMul() * heroAtkBuff;
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
      u.cooldown = (1 / (stat.frq * this.mods.frqMul * (u.pillFrq ? TUNING.frqBuffMul : 1))) * (u.slowT > 0 ? TUNING.slowCooldownMul : 1);
    }
  }

  // 羁绊：大圣激活 → 全队攻击加成（对应竞品 赵云+阿斗 羁绊）
  bondActive(): boolean {
    return this.activeGenerals().some((g) => g.def.id === BOND_GENERAL);
  }
  private bondAtkMul(): number {
    return this.bondActive() ? 1 + GENERAL_TUNING.BOND_ATK_BONUS : 1;
  }

  aiBondActive(): boolean {
    return this.aiActiveGenerals().some((g) => g.def.id === BOND_GENERAL);
  }

  private aiBondAtkMul(): number {
    return this.aiBondActive() ? 1 + GENERAL_TUNING.BOND_ATK_BONUS : 1;
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
        return this.aiOffensiveActiveReady('meteor') && (
          this.aiMonsters.length >= 3
          || this.aiMonsters.some((m) => m.isBoss)
          || (this.isBossWave(this.wave) && this.aiMonsters.length >= 1)
        );
      case 'jinggu':
        return this.aiOffensiveActiveReady('jinggu') && (
          this.aiMonsters.length >= 2
          || this.aiMonsters.some((m) => m.isBoss || m.isMiniBoss)
        );
      case 'atkBuff':
      case 'frqBuff':
        return this.aiDpsPieceCount() >= 2 && this.aiHasPillTarget(effect);
      case 'bomb':
        // 主动预埋：有怪且 CD 就绪就埋（不依赖陨石/紧箍那套「怪走过一段」的择时窗口，
        // 避免 CD 就绪却要等择时而浪费）。无有效落点（路径被占满）则留给下帧。
        return this.aiMonsters.length >= 1 && this.hasAiBombSlot();
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
      case 'bomb':
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
    this.emit('shovel'); // 第一铲；半程再铲一声
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
      msg += ` · ${BOND_NAME}：全队攻击+${Math.round(GENERAL_TUNING.BOND_ATK_BONUS * 100)}%`;
    }
    return msg;
  }

  /** 经验数值保留 1 位小数（阈值与累积进度共用） */
  static roundExp(n: number): number {
    return Math.round(n * 10) / 10;
  }
  // 武将升阶进度：5×2^level；倍率见 generalExpCostMul（输出/武器 1.3、控制 1.15、观音 1.05）
  static expToNext(
    level: number,
    def?: Pick<GeneralDef, 'id' | 'role' | 'expCostMul'> | null,
  ): number {
    const base = 5 * 2 ** level;
    return Battle.roundExp(base * generalExpCostMul(def));
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
    s.exp = Battle.roundExp(s.exp + amount);
    while (s.exp >= Battle.expToNext(s.level, g.def)) {
      const wa2 = wordAt(g.cells[0].c, g.cells[0].r);
      const wb2 = wordAt(g.cells[1].c, g.cells[1].r);
      if (!wa2 || !wb2) break;
      const can = wa2.tier < cap || wb2.tier < cap;
      if (!can) {
        s.exp = 0; // 升阶过程中触顶：清掉剩余进度，避免拆开后多段连升
        break;
      }
      s.exp = Battle.roundExp(s.exp - Battle.expToNext(s.level, g.def));
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
    const atkBuffMul = (g.state.buffAtkT ?? 0) > 0 ? (g.state.buffAtkMul ?? 1) : 1;
    return base * (1 + (wb?.atk ?? 0)) * this.mods.atkMul * (g.pillAtk ? TUNING.atkBuffMul : 1) * this.bondAtkMul() * atkBuffMul;
  }

  /** 场上兵器实际攻击力（含羁绊 / 仙丹 / 老君炼丹 / 减益） */
  unitAtk(u: PlacedUnit): number {
    const stat = getUnitStat(u.type, u.tier);
    const heroAtkBuff = (u.buffAtkT ?? 0) > 0 ? (u.buffAtkMul ?? 1) : 1;
    return stat.atk * this.mods.atkMul
      * (u.weakenT > 0 ? TUNING.weakenAtkMul : 1)
      * (u.pillAtk ? TUNING.atkBuffMul : 1)
      * this.bondAtkMul()
      * heroAtkBuff;
  }

  // 计入神兵加成的武将攻速/范围
  generalFrq(g: ActiveGeneral): number {
    const wb = this.weaponBonuses[g.def.id];
    return generalStat(g.def, g.tier).frq * (1 + (wb?.frq ?? 0)) * this.mods.frqMul * (g.pillFrq ? TUNING.frqBuffMul : 1);
  }
  generalRge(g: ActiveGeneral): number {
    const wb = this.weaponBonuses[g.def.id];
    return generalStat(g.def, g.tier).rge + (wb?.rge ?? 0);
  }

  /** AI 半场武将实际攻击力（含神兵 / 羁绊 / 仙丹 / 老君炼丹） */
  aiGeneralAtk(g: ActiveGeneral): number {
    const base = generalStat(g.def, g.tier).atk;
    const wb = this.aiWeaponBonuses[g.def.id];
    const atkBuffMul = (g.state.buffAtkT ?? 0) > 0 ? (g.state.buffAtkMul ?? 1) : 1;
    return base * (1 + (wb?.atk ?? 0)) * this.aiMods.atkMul * (g.pillAtk ? TUNING.atkBuffMul : 1) * this.aiBondAtkMul() * atkBuffMul;
  }

  aiGeneralRge(g: ActiveGeneral): number {
    const wb = this.aiWeaponBonuses[g.def.id];
    return generalStat(g.def, g.tier).rge + (wb?.rge ?? 0);
  }

  /** 武将大招专属特效（玩家 / AI 共用 heroUltFx，格坐标在各自半场） */
  private pushHeroUltFx(
    g: ActiveGeneral,
    center: { c: number; r: number },
    gAx: number,
    gAy: number,
    rgeCells: number,
  ): void {
    const crit = ultTypeOf(g.def) === 'crit';
    const ultTtl = g.def.id === 'dasheng' ? 0.9
      : g.def.id === 'honghaier' ? 0.9
      : g.def.id === 'bailong' ? 0.8
      : (g.def.skill === 'heal' || g.def.skill === 'buff' || g.def.skill === 'cdr') ? 0.85
      : 0.6;
    const fxAtCaster = g.def.skill === 'buff' || g.def.skill === 'cdr';
    const bite = this.biteTarget;
    this.biteTarget = null; // 消费即清，避免下次大招残留旧目标
    this.heroUltFx.push({
      heroId: g.def.id,
      c: fxAtCaster ? gAx : center.c,
      r: fxAtCaster ? gAy : center.r,
      ttl: ultTtl, maxTtl: ultTtl,
      tier: g.tier,
      rge: rgeCells,
      crit,
      ...(g.def.id === 'dasheng' || g.def.id === 'erlang' || g.def.id === 'niulang' || g.def.id === 'niumowang'
        || g.def.skill === 'buff' || g.def.skill === 'cdr'
        ? { fromC: gAx, fromR: gAy }
        : {}),
      ...(bite ? { biteC: bite.c, biteR: bite.r, biteMid: bite.mid } : {}),
    });
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
      if ((s.buffAtkT ?? 0) > 0) {
        s.buffAtkT = Math.max(0, (s.buffAtkT ?? 0) - dt);
        if (s.buffAtkT <= 0) s.buffAtkMul = undefined;
      }
      const ax = (g.cells[0].c + g.cells[1].c) / 2;
      const ay = (g.cells[0].r + g.cells[1].r) / 2;
      const inRange = this.sortCombatTargets(
        this.monsters
          .map((m) => ({ m, p: posAtDistance(this.map, m.dist) }))
          .filter((x) => inAttackRange(ax, ay, this.generalRge(g), x.p)),
      );

      if (g.def.skill !== 'none' && g.def.skillCd > 0) {
        s.skillCd -= dt;
        // buff/cdr 不依赖射程内有怪；其余大招仍需有目标才施放
        const needsTarget = g.def.skill !== 'buff' && g.def.skill !== 'cdr';
        if (s.skillCd <= 0 && (!needsTarget || inRange.length > 0)) {
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

  private castGeneralSkill(
    g: ActiveGeneral,
    inRange: { m: Monster; p: { c: number; r: number } }[],
    ai = false,
  ): void {
    const atk = ai ? this.aiGeneralAtk(g) : this.generalAtk(g);
    const rgeCells = ai ? this.aiGeneralRge(g) : this.generalRge(g);
    const entranceDist = ai ? this.aiEntranceDist : this.entranceDist;
    const hurt = (m: Monster, dmg: number, p: { c: number; r: number }, flash: number, crit = false) => {
      if (ai) this.hurtAiMonster(m, dmg, p, flash, crit);
      else this.hurtMonster(m, dmg, p, flash, crit);
    };
    g.state.skillFlash = 1;
    const gAx = (g.cells[0].c + g.cells[1].c) / 2;
    const gAy = (g.cells[0].r + g.cells[1].r) / 2;
    let center = inRange[0]?.p ?? { c: gAx, r: gAy };
    switch (g.def.skill) {
      case 'burst': {
        for (const t of inRange) hurt(t.m, damage(atk * 3), t.p, 0.15);
        // 哪吒「万火齐发」命中音效（单个清脆穿刺声，对齐枪雨落点）
        if (g.def.id === 'nezha' && inRange.length > 0) this.emit('hit');
        break;
      }
      case 'ranged': {
        // 真·穿透：命中「二郎→主目标」这条直线走廊上的多个敌人（垂距≤~1 格）。
        // 二郎「天眼诛邪」贯穿最多 4 个；牛郎「织云箭」为单体过渡，仍只打 1 个。
        const primary = inRange[0]!;
        const pierceMax = g.def.id === 'erlang' ? 4 : 1;
        const dirC = primary.p.c - gAx;
        const dirR = primary.p.r - gAy;
        const len = Math.hypot(dirC, dirR) || 1;
        const ux = dirC / len;
        const uy = dirR / len;
        const CORRIDOR = 0.95; // 光束轴向的垂直半宽（格）
        const line = inRange
          .map((x) => {
            const rx = x.p.c - gAx;
            const ry = x.p.r - gAy;
            return { m: x.m, p: x.p, proj: rx * ux + ry * uy, perp: Math.abs(rx * uy - ry * ux) };
          })
          .filter((x) => x.proj >= 0 && x.perp <= CORRIDOR)
          .sort((a, b) => a.proj - b.proj)
          .slice(0, pierceMax);
        const dmg = damage(atk * 5 * GENERAL_TUNING.CRIT_MULT);
        for (const t of line) hurt(t.m, dmg, t.p, 0.2, true);
        // 光束延伸到最远命中目标，凸显「贯穿一整条线」
        center = line[line.length - 1]?.p ?? primary.p;
        // 哮天犬：定身被咬怪 3s + 推送跟随特效
        if (g.def.id === 'erlang' && line.length > 0) {
          const front = line[0]!;
          let pick: { m: Monster; p: { c: number; r: number } } | null = null;
          for (const t of line) {
            const d = Math.hypot(t.p.c - front.p.c, t.p.r - front.p.r);
            if (d > 3) continue;
            if (!pick || t.m.maxHp > pick.m.maxHp) pick = t;
          }
          if (pick) {
            pick.m.stunT = Math.max(pick.m.stunT ?? 0, 3.0);
            this.biteTarget = { c: Math.round(pick.p.c), r: Math.round(pick.p.r), mid: pick.m.id };
            // 光束角度：从施法者中心→咬点（让狗朝向光束冲锋方向）
            const beamAng = Math.atan2(pick.p.r - gAy, pick.p.c - gAx);
            // 哮天犬咬住后持续跟随 3s（怪死亡则消失）
            this.erlangDogFx.push({ mid: pick.m.id, c: Math.round(pick.p.c), r: Math.round(pick.p.r), ttl: 3.0, maxTtl: 3.0, tier: g.tier, ang: beamAng, fromC: gAx, fromR: gAy });
          }
        }
        break;
      }
      case 'stun': {
        const dur = g.def.maxTier === 5 ? TUNING.heroStunDurMain : TUNING.heroStunDurTransit;
        const isCharge = g.def.id === 'niumowang' || g.def.id === 'qingniu';
        const dmgMul = isCharge ? TUNING.heroChargeStunDmgMul : TUNING.heroStunDmgMul;
        for (const t of inRange) {
          t.m.stunT = Math.max(t.m.stunT, dur);
          hurt(t.m, damage(atk * dmgMul), t.p, 0.12);
        }
        break;
      }
      case 'knock': {
        const push = g.def.maxTier === 5 ? TUNING.heroKnockPushMain : TUNING.heroKnockPushTransit;
        for (const t of inRange) {
          t.m.dist = Math.max(entranceDist, t.m.dist - push);
          hurt(t.m, damage(atk * TUNING.heroKnockDmgMul), t.p, 0.12);
        }
        break;
      }
      case 'slow': {
        const dmgMul = g.def.maxTier === 5 ? TUNING.heroSlowDmgMulMain : TUNING.heroSlowDmgMulTransit;
        for (const t of inRange) {
          t.m.slowT = Math.max(t.m.slowT, TUNING.heroSlowDur);
          hurt(t.m, damage(atk * dmgMul), t.p, 0.12);
        }
        break;
      }
      case 'heal': {
        for (const t of inRange) t.m.slowT = Math.max(t.m.slowT, TUNING.heroHealSlowDur);
        if (ai) {
          if (!this.aiHealUsedThisWave && this.aiTangsengHP < this.tangsengMaxHP) {
            this.aiTangsengHP += 1;
            this.aiHealUsedThisWave = true;
          }
        } else if (!this.healUsedThisWave && this.tangsengHP < this.tangsengMaxHP) {
          this.tangsengHP += 1;
          this.healUsedThisWave = true;
          this.message = `${g.def.name}甘露：唐僧回复 1 血`;
        }
        break;
      }
      case 'buff': {
        const mul = g.def.maxTier === 5 ? TUNING.heroBuffAtkMulMain : TUNING.heroBuffAtkMulTransit;
        const dur = g.def.maxTier === 5 ? TUNING.heroBuffDurMain : TUNING.heroBuffDurTransit;
        if (ai) {
          for (const ally of this.aiActiveGenerals()) {
            ally.state.buffAtkT = Math.max(ally.state.buffAtkT ?? 0, dur);
            ally.state.buffAtkMul = Math.max(ally.state.buffAtkMul ?? 1, mul);
          }
          for (const u of this.aiUnits) {
            u.buffAtkT = Math.max(u.buffAtkT ?? 0, dur);
            u.buffAtkMul = Math.max(u.buffAtkMul ?? 1, mul);
          }
        } else {
          for (const ally of this.activeGenerals()) {
            ally.state.buffAtkT = Math.max(ally.state.buffAtkT ?? 0, dur);
            ally.state.buffAtkMul = Math.max(ally.state.buffAtkMul ?? 1, mul);
          }
          for (const u of this.units.values()) {
            u.buffAtkT = Math.max(u.buffAtkT ?? 0, dur);
            u.buffAtkMul = Math.max(u.buffAtkMul ?? 1, mul);
          }
          this.message = `${g.def.name}炼丹：武将与兵器攻击 ×${mul.toFixed(2)}（${dur}s）`;
        }
        break;
      }
      case 'cdr': {
        const sec = g.def.maxTier === 5 ? TUNING.heroCdrSecMain : TUNING.heroCdrSecTransit;
        if (ai) {
          for (const ally of this.aiActiveGenerals()) {
            if (ally.state === g.state) continue;
            ally.state.skillCd = Math.max(0, ally.state.skillCd - sec);
          }
          for (const u of this.aiUnits) {
            if (u.cooldown <= 0) continue;
            u.cooldown = Math.max(0, u.cooldown - sec);
          }
        } else {
          let n = 0;
          for (const ally of this.activeGenerals()) {
            if (ally.state === g.state) continue;
            ally.state.skillCd = Math.max(0, ally.state.skillCd - sec);
            n++;
          }
          let unitsN = 0;
          for (const u of this.units.values()) {
            if (u.cooldown <= 0) continue;
            u.cooldown = Math.max(0, u.cooldown - sec);
            unitsN++;
          }
          if (n > 0 && unitsN > 0) {
            this.message = `${g.def.name}慧剑：${n} 武将大招 CD、${unitsN} 兵器间隔 −${sec}s`;
          } else if (n > 0) {
            this.message = `${g.def.name}慧剑：${n} 名武将大招 CD −${sec}s`;
          } else if (unitsN > 0) {
            this.message = `${g.def.name}慧剑：${unitsN} 件兵器攻击间隔 −${sec}s`;
          } else {
            this.message = `${g.def.name}慧剑：场上暂无其他友军`;
          }
        }
        break;
      }
      case 'burn': {
        for (const t of inRange) {
          hurt(t.m, damage(atk * TUNING.heroBurnHitMul), t.p, 0.15);
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
    this.pushHeroUltFx(g, center, gAx, gAy, rgeCells);
    this.addGeneralCombatExp(g, Battle.heroSkillExp, ai);
    if (!ai) this.tryRollFragmentOnHeroAttack();
  }

  // 怪物施法：精英/BOSS 对半径内随机 1~2 件最近兵器施加地图减益；小 Boss 施展跨地图光环
  private updateMonsterSkills(dt: number): void {
    for (const m of this.monsters) {
      if (m.hp <= 0) continue;
      m.castFlash = Math.max(0, m.castFlash - dt * 4);
      // 小 Boss 光环
      if (m.isMiniBoss && m.miniBossKind) {
        if (m.miniBossCasted) continue; // 黄狮精：卷走只触发一次，偷到后本局跳过
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
      case 'lion': {
        // 黄狮精「卷走」：半径内随机取 1 件（兵器/英雄字块/桃树），永久删除。
        // 配对英雄只拆一格：words.delete 只删这一格，activeGenerals 下帧自动解散该对、
        // pruneHeroStates 清掉对应武将状态。无目标时不置位，由上层按 miniBossInterval 重试。
        const R = TUNING.miniBossStealRadius;
        type Cand = { kind: 'unit' | 'word' | 'tree'; key: string; c: number; r: number; name: string };
        const cands: Cand[] = [];
        for (const u of this.units.values()) {
          if (Math.hypot(mp.c - u.cell.c, mp.r - u.cell.r) <= R) {
            cands.push({ kind: 'unit', key: cellKey(u.cell.c, u.cell.r), c: u.cell.c, r: u.cell.r, name: UNITS[u.type].name });
          }
        }
        for (const w of this.words.values()) {
          if (Math.hypot(mp.c - w.cell.c, mp.r - w.cell.r) <= R) {
            cands.push({ kind: 'word', key: cellKey(w.cell.c, w.cell.r), c: w.cell.c, r: w.cell.r, name: w.char });
          }
        }
        for (const t of this.trees.values()) {
          if (Math.hypot(mp.c - t.cell.c, mp.r - t.cell.r) <= R) {
            cands.push({ kind: 'tree', key: cellKey(t.cell.c, t.cell.r), c: t.cell.c, r: t.cell.r, name: '蟠桃树' });
          }
        }
        if (cands.length === 0) break; // 半径内无目标：不消耗机会，skillCd 已被上层置为 miniBossInterval，下轮重试
        const pick = cands[this.rng.int(cands.length)]!;
        if (pick.kind === 'unit') this.units.delete(pick.key);
        else if (pick.kind === 'word') this.words.delete(pick.key);
        else this.trees.delete(pick.key);
        this.clearAutoPlaceLayoutMemory(); // 与 recallToTray 一致：移除后清自动布阵记忆，避免 AI 引用失效格
        affected = 1;
        m.miniBossCasted = true; // 偷到一次，本局不再触发
        m.castFlash = 1; // 施法闪光（与其它小 Boss 一致，供渲染）
        // 消失特效：在被偷格子爆开金色 death 粒子环（复用 drawBursts，无需新增 SkillFxKind）
        this.bursts.push({ kind: 'death', c: pick.c, r: pick.r, ttl: 0.45, maxTtl: 0.45, big: true, color: meta.color });
        // 底部提示：点明被卷走的具体目标
        this.message = `⚠ ${meta.name}卷走了「${pick.name}」！`;
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
      // lion 已在分支内自设 message 与金色 death 粒子，这里只处理其它小 Boss 的通用光环提示
      if (kind !== 'lion') {
        this.bursts.push({ kind: 'hit', c: mp.c, r: mp.r, ttl: 0.45, maxTtl: 0.45, big: true, color: meta.color });
        this.message = `${meta.name}施展「${meta.skillName}」`;
      }
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
  }

  private updateAiActives(dt: number): void {
    for (const slot of this.aiActiveSlots) {
      if (slot.cd > 0) {
        slot.cd = Math.max(0, slot.cd - dt);
        if (slot.cd === 0) slot.ready = true;
      } else {
        slot.ready = true;
      }
      if (slot.flash > 0) slot.flash = Math.max(0, slot.flash - dt);
    }
    this.tickAiOffensiveActiveDelay(dt);
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
        this.startPalmPush(TUNING.palmPushCells, true);
        this.emit('palm');
        break;
      case 'meteor':
        this.doAiMeteor(TUNING.meteorDmgMul, true);
        this.emit('ult');
        break;
      case 'atkBuff':
        if (!this.applyAiPillActive(i, 'atkBuff')) return false;
        this.emit('item');
        break;
      case 'frqBuff':
        if (!this.applyAiPillActive(i, 'frqBuff')) return false;
        this.emit('item');
        break;
      case 'freeze': {
        for (const m of this.aiMonsters) m.stunT = Math.max(m.stunT, TUNING.freezeStunDur);
        const fc = this.frontMonsterCell(true);
        if (fc) this.setSkillFx('freeze', fc, true);
        this.emit('item');
        break;
      }
      case 'jinggu':
        this.doAiJingu();
        this.emit('ult');
        break;
      case 'bomb': {
        const cell = this.aiBombPlacementCell();
        if (!cell || !this.placeAiBomb(cell)) return false;
        break;
      }
    }
    if (def.effect === 'meteor' || def.effect === 'jinggu') {
      this.ultFlash = Math.max(this.ultFlash, 0.35);
    }
    slot.cd = slot.cdMax;
    slot.ready = false;
    slot.flash = 0.6;
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

  /** 玩家半场：格上兵器或激活武将 */
  private playerPillTarget(cell: Cell): { kind: 'unit'; u: PlacedUnit } | { kind: 'general'; g: ActiveGeneral } | null {
    const u = this.units.get(cellKey(cell.c, cell.r));
    if (u) return { kind: 'unit', u };
    const g = this.activeGenerals().find((ag) => ag.cells.some((c) => c.c === cell.c && c.r === cell.r));
    return g ? { kind: 'general', g } : null;
  }

  canApplyPill(cell: Cell, effect: 'atkBuff' | 'frqBuff'): boolean {
    const t = this.playerPillTarget(cell);
    if (!t) return false;
    if (effect === 'atkBuff') return t.kind === 'unit' ? !t.u.pillAtk : !t.g.pillAtk;
    return t.kind === 'unit' ? !t.u.pillFrq : !t.g.pillFrq;
  }

  /** 该格能否埋炸药：在路径上且该格尚未埋（供拖拽落点高亮） */
  canPlaceBomb(cell: Cell): boolean {
    return this.bombOnPath(false, cell) && !this.bombCellTaken(this.bombs, cell);
  }

  private pillTargetLabel(t: { kind: 'unit'; u: PlacedUnit } | { kind: 'general'; g: ActiveGeneral }): string {
    return t.kind === 'unit' ? `${UNITS[t.u.type].name} Lv.${t.u.tier}` : t.g.def.name;
  }

  /** 仙丹/风火轮：拖到单体兵器或武将，本局 +40%，每单位各一次 */
  applyPillActive(i: number, cell: Cell): boolean {
    // 备战(ready)与对战(playing)都可给兵器/武将上仙丹/风火轮（预布增益）
    if (this.status !== 'playing' && this.status !== 'ready') return false;
    const slot = this.activeSlots[i];
    if (!slot?.ready) return false;
    const def = activeById(slot.id);
    if (!def || !isPillActiveEffect(def.effect)) return false;
    const t = this.playerPillTarget(cell);
    if (!t) {
      this.message = '请拖到兵器或武将上';
      return false;
    }
    const isAtk = def.effect === 'atkBuff';
    const already = t.kind === 'unit' ? (isAtk ? t.u.pillAtk : t.u.pillFrq) : (isAtk ? t.g.pillAtk : t.g.pillFrq);
    if (already) {
      this.message = isAtk ? '该单位已使用过仙丹' : '该单位已使用过风火轮';
      return false;
    }
    if (t.kind === 'unit') {
      if (isAtk) t.u.pillAtk = true;
      else t.u.pillFrq = true;
    } else if (isAtk) {
      t.g.state.pillAtk = true;
    } else {
      t.g.state.pillFrq = true;
    }
    this.setSkillFx(isAtk ? 'atkBuff' : 'frqBuff', cell, false);
    const statLabel = isAtk ? '攻击' : '攻速';
    this.message = `${def.name}！${this.pillTargetLabel(t)} ${statLabel} +40%（本局）`;
    slot.cd = slot.cdMax;
    slot.ready = false;
    slot.flash = 0.6;
    this.ultFlash = Math.max(this.ultFlash, 0.35);
    this.emit('item');
    return true;
  }

  /** 介绍弹窗：已施加的单体增益列表 */
  pillBuffRoster(effect: 'atkBuff' | 'frqBuff'): string[] {
    const lines: string[] = [];
    const isAtk = effect === 'atkBuff';
    for (const u of this.units.values()) {
      if (isAtk ? u.pillAtk : u.pillFrq) lines.push(`${UNITS[u.type].name} Lv.${u.tier}`);
    }
    for (const g of this.activeGenerals()) {
      if (isAtk ? g.pillAtk : g.pillFrq) lines.push(g.def.name);
    }
    return lines;
  }

  private aiHasPillTarget(effect: 'atkBuff' | 'frqBuff'): boolean {
    const isAtk = effect === 'atkBuff';
    for (const g of this.aiActiveGenerals()) {
      if (isAtk ? !g.pillAtk : !g.pillFrq) return true;
    }
    for (const u of this.aiUnits) {
      if (isAtk ? !u.pillAtk : !u.pillFrq) return true;
    }
    return false;
  }

  private pickAiPillTarget(effect: 'atkBuff' | 'frqBuff'): Cell | null {
    const isAtk = effect === 'atkBuff';
    let best: { cell: Cell; score: number } | null = null;
    const consider = (cell: Cell, score: number, used: boolean) => {
      if (used || score <= 0) return;
      if (!best || score > best.score) best = { cell, score };
    };
    for (const g of this.aiActiveGenerals()) {
      const stat = generalStat(g.def, g.tier);
      const wb = this.aiWeaponBonuses[g.def.id];
      const score = isAtk
        ? stat.atk * (1 + (wb?.atk ?? 0))
        : stat.frq * (1 + (wb?.frq ?? 0));
      consider(g.cells[0], score, isAtk ? !!g.pillAtk : !!g.pillFrq);
    }
    for (const u of this.aiUnits) {
      const stat = getUnitStat(u.type, u.tier);
      consider(u.cell, isAtk ? stat.atk : stat.frq, isAtk ? !!u.pillAtk : !!u.pillFrq);
    }
    return best?.cell ?? null;
  }

  private applyAiPillActive(i: number, effect: 'atkBuff' | 'frqBuff'): boolean {
    const cell = this.pickAiPillTarget(effect);
    if (!cell) return false;
    const isAtk = effect === 'atkBuff';
    const u = this.aiUnits.find((x) => x.cell.c === cell.c && x.cell.r === cell.r);
    if (u) {
      if (isAtk) u.pillAtk = true;
      else u.pillFrq = true;
    } else {
      const g = this.aiActiveGenerals().find((ag) => ag.cells.some((c) => c.c === cell.c && c.r === cell.r));
      if (!g) return false;
      if (isAtk) g.state.pillAtk = true;
      else g.state.pillFrq = true;
    }
    this.setSkillFx(isAtk ? 'atkBuff' : 'frqBuff', cell, true);
    return true;
  }

  // 触发第 i 个主动技能。返回是否成功（就绪且效果生效才进入冷却）。仙丹/风火轮请用 applyPillActive。
  triggerActive(i: number): boolean {
    if (this.status !== 'playing') return false;
    const slot = this.activeSlots[i];
    if (!slot || !slot.ready) return false;
    const def = activeById(slot.id);
    if (!def) return false;
    if (isDragActiveEffect(def.effect)) return false; // 仙丹/风火轮/炸药需拖拽释放，不响应点按
    // 需要场上有怪才有意义的技能：无怪时不触发、不进冷却（避免空放浪费）
    // 陨石除外：无怪也可释放并播放落点特效（清波收尾/空场点技能都要看得到）
    const needsMonsters: ActiveEffect[] = ['palm', 'freeze', 'jinggu'];
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
    if (this.tangsengHurtImmuneT > 0) {
      this.tangsengHurtImmuneT = Math.max(0, this.tangsengHurtImmuneT - dt);
    }
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
          ? ECONOMY.PEACH_PER_BOSS
          : m.isMiniBoss
            ? ECONOMY.PEACH_PER_MINI_BOSS
            : isElite
              ? ECONOMY.PEACH_PER_ELITE
              : ECONOMY.PEACH_PER_KILL;
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
        // 撞到唐僧：扣血 + 舍身饲魔；扣血后短暂免疫，避免同帧连扣
        if (this.tangsengHurtImmuneT > 0) continue;
        this.tangsengHP -= 1;
        this.peach += ECONOMY.PEACH_PER_BLEED;
        this.tangsengHurtImmuneT = TUNING.tangsengHurtImmuneDur;
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
    this.erlangDogFx = []; // 二郎哮天犬跟随特效
    this.bombFx = []; // 爆炸残影清掉；已埋未引爆的地雷（bombs/aiBombs）作为玩法状态保留跨波
    this.peachFloats = [];
    this.damageFloats = [];
    this.ultFlash = 0;
    this.ultCenter = null;
    this.palmPushFx = null;
    this.aiPalmPushFx = null;
    // 主动技能爆发（陨石/紧箍等）保留到自然播完：清波瞬间若清掉，收尾一击的特效会「闪一下没了」
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
    // 二郎哮天犬：被咬怪物死亡则狗立即消失（否则跟随 3s）；玩家/AI 怪物分属两数组，都要查
    this.heroUltFx = this.heroUltFx.filter((uf) => {
      if (uf.ttl <= 0) return false;
      if (uf.biteMid != null) {
        const m = this.monsters.find((mm) => mm.id === uf.biteMid)
          ?? this.aiMonsters.find((mm) => mm.id === uf.biteMid);
        if (!m || m.hp <= 0) return false;
      }
      return true;
    });
    // 二郎哮天犬跟随特效：3s 递减；被咬怪物死亡则立即移除
    for (const d of this.erlangDogFx) d.ttl -= dt;
    this.erlangDogFx = this.erlangDogFx.filter((d) => {
      if (d.ttl <= 0) return false;
      const m = this.monsters.find((mm) => mm.id === d.mid)
        ?? this.aiMonsters.find((mm) => mm.id === d.mid);
      return !!m && m.hp > 0;
    });
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
    // 挖坑：时长内铲两下；第一铲在开挖瞬间 emit，半程再播第二铲
    const digHalf = PLACE_TIMING.digDur * 0.5;
    for (const d of this.digFx) {
      const prev = d.t;
      d.t += dt;
      if (prev < digHalf && d.t >= digHalf) this.emit('shovel');
    }
    this.digFx = this.digFx.filter((d) => d.t < PLACE_TIMING.digDur);
    for (const d of this.aiDigFx) {
      const prev = d.t;
      d.t += dt;
      if (prev < digHalf && d.t >= digHalf) this.emit('shovel');
    }
    this.aiDigFx = this.aiDigFx.filter((d) => d.t < PLACE_TIMING.digDur);
    for (let i = this.autoPlaceDragFx.length - 1; i >= 0; i--) {
      const d = this.autoPlaceDragFx[i]!;
      d.t += dt;
      if (d.t >= PLACE_TIMING.dragDur) {
        this.commitAutoPlaceDrag(d);
        this.autoPlaceDragFx.splice(i, 1);
      }
    }
    for (const d of this.placeDropFx) {
      if (d.delay > 0) {
        d.delay -= dt;
        continue;
      }
      d.t += dt;
      if (!d.landed && d.t >= PLACE_TIMING.dropDur) {
        d.landed = true;
        if (d.playSfx !== false) this.emit(d.sfx);
      }
    }
    this.placeDropFx = this.placeDropFx.filter((d) => d.delay > 0 || d.t < PLACE_TIMING.dropDur + 0.04);
    this.tickAutoPlacePlayback(dt);
    this.tickAiAutoPlacePlayback(dt);
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
          const offset = i === 0 ? 0 : -this.rng.next() * BOARD_POWER.SPAWN_DIST_JITTER;
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
    if (this.meteorPending && this.passiveMeteorReady(this.monsters, this.entranceDist)) {
      this.meteorPending = false;
      this.castMeteor();
    }
    this.updateMonsterSkills(dt);
    this.updateGenerals(dt);
    this.updateActives(dt);
    this.updateBombs(dt);
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
      this.nextWaveTimer = TUNING.waveGapSec;
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
      const dropAnim = this.placeDropAnimDepth > 0;
      const keepInTray = this.autoPlacePlaying;
      this.pendingPlace.push({ token, c: cell.c, r: cell.r, dropAnim, trayIndex: index, keepInTray });
      if (!keepInTray) this.tray.splice(index, 1);
      return true;
    }
    return this.doPlaceFromTray(index, cell);
  }

  // 延迟落子结算：预占格的开格动画结束后，真正把预占的兵/字牌落到该格（每帧由 updateFx 调用）。
  private updatePendingPlace(): void {
    if (this.pendingPlace.length > 0) {
      const still: { token: TrayToken; c: number; r: number; dropAnim: boolean; trayIndex?: number; keepInTray?: boolean }[] = [];
      for (const p of this.pendingPlace) {
        if (this.digFx.some((d) => d.c === p.c && d.r === p.r)) { still.push(p); continue; } // 动画未完，继续等
        const cell = { c: p.c, r: p.r };
        if (p.dropAnim && this.playerUseAutoPlaceDrag() && p.trayIndex !== undefined) {
          const commit = p.token.kind === 'word' ? 'placeWord' : 'placeUnit';
          const sfx = p.token.kind === 'word' ? this.playerWordPlaceSfx(cell) : 'place';
          this.queueAutoPlaceDrag(p.trayIndex, cell, p.token, commit, sfx);
          continue;
        }
        if (p.keepInTray && p.trayIndex !== undefined) {
          this.clearTraySlot(p.trayIndex);
        }
        if (p.token.kind === 'unit') {
          this.units.set(cellKey(p.c, p.r), makePlacedUnit(p.token.type, p.token.tier, cell, this.unitFaceGate()));
          if (p.dropAnim) {
            this.spawnPlaceDropFx('player', cell, {
              kind: 'unit',
              isMerge: false,
              sfx: 'place',
              unitType: p.token.type,
              unitTier: p.token.tier,
            });
          } else {
            this.emit('place');
          }
        } else if (p.token.kind === 'word') {
          const w = p.token;
          this.words.set(cellKey(p.c, p.r), placedWordFromTray(w, cell));
          if (p.dropAnim) {
            this.spawnPlaceDropFx('player', cell, {
              kind: 'word',
              isMerge: false,
              sfx: this.playerWordPlaceSfx(cell),
              char: w.char,
              wordTier: w.tier,
            });
          } else {
            this.emit(this.playerWordPlaceSfx(cell));
          }
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
          this.spawnPlaceDropFx('ai', cell, {
            kind: 'unit',
            isMerge: false,
            sfx: 'place',
            unitType: p.token.type,
            unitTier: p.token.tier,
          });
        } else if (p.token.kind === 'word') {
          this.aiWords.set(cellKey(p.c, p.r), placedWordFromTray(p.token, cell));
          this.spawnPlaceDropFx('ai', cell, {
            kind: 'word',
            isMerge: false,
            sfx: this.aiWordPlaceSfx(cell),
            char: p.token.char,
            wordTier: p.token.tier,
          });
        }
      }
      this.aiPendingPlace = still;
    }
  }

  private buildPlayerAutoView(): AutoPlaceView {
    // 单轮规划复用：路径覆盖/首战等度量仅依赖静态地图与 (ax,ay,rge)，与棋面无关，
    // 整个 view 生命周期（一次 planAutoPlaceSteps）内缓存，避免逐格逐候选重复采样路径。
    const caches = this.makePathMetricCaches();
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
        this.playerPathCoverCached(caches, cell.c, cell.r, getUnitStat(type, tier).rge),
      pathCoverAt: (ax, ay, rge) => this.playerPathCoverCached(caches, ax, ay, rge),
      pathCoverEarlyAt: (ax, ay, rge) => this.playerPathCoverEarlyCached(caches, ax, ay, rge),
      pathFirstEngageAt: (ax, ay, rge) => this.playerPathFirstEngageCached(caches, ax, ay, rge),
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
        this.engageScoreAt(this.monsters, this.map.path, this.entranceDist, cell, type, tier, this.dangerNear()),
      wordChars: (general) => generalById(general)?.chars,
      place: (i, cell) => {
        const token = this.tray[i];
        if (!token) return false;
        const snap = this.cloneTrayToken(token);
        const ok = this.autoPlaceApply(i, cell);
        if (ok) {
          this.recordAutoPlaceStep({
            kind: 'place',
            trayIndex: i,
            cell: { c: cell.c, r: cell.r },
            token: snap,
          });
        }
        return ok;
      },
      moveUnit: (from, to) => {
        const u = this.units.get(cellKey(from.c, from.r));
        if (!u) return false;
        if (!this.isUnlocked(to.c, to.r) || !this.cellFree(to.c, to.r)) return false;
        this.units.delete(cellKey(from.c, from.r));
        u.cell = { c: to.c, r: to.r };
        u.fireDir = faceDirToward(u.cell, this.unitFaceGate());
        this.units.set(cellKey(to.c, to.r), u);
        this.recordAutoPlaceStep({ kind: 'moveUnit', from: { c: from.c, r: from.r }, to: { c: to.c, r: to.r } });
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
        this.recordAutoPlaceStep({ kind: 'swapUnits', a: { c: a.c, r: a.r }, b: { c: b.c, r: b.r } });
        return true;
      },
      swapUnitWord: (unitCell, wordCell) => {
        const ok = this.swapUnitWord(unitCell, wordCell);
        if (ok) this.recordAutoPlaceStep({ kind: 'swapUnitWord', unitCell: { ...unitCell }, wordCell: { ...wordCell } });
        return ok;
      },
      swapWords: (from, to) => {
        const ok = this.dragWord(from, to);
        if (ok) this.recordAutoPlaceStep({ kind: 'swapWords', from: { c: from.c, r: from.r }, to: { c: to.c, r: to.r } });
        return ok;
      },
      moveWord: (from, to) => {
        const kFrom = cellKey(from.c, from.r);
        const kTo = cellKey(to.c, to.r);
        const w = this.words.get(kFrom);
        if (!w) return false;
        if (!this.isUnlocked(to.c, to.r) || !this.cellFree(to.c, to.r)) return false;
        this.words.delete(kFrom);
        w.cell = { c: to.c, r: to.r };
        this.words.set(kTo, w);
        this.recordAutoPlaceStep({ kind: 'moveWord', from: { c: from.c, r: from.r }, to: { c: to.c, r: to.r } });
        return true;
      },
      displaceToTray: (cell) => {
        const ok = this.displaceToTray(cell);
        if (ok) this.recordAutoPlaceStep({ kind: 'displaceToTray', cell: { c: cell.c, r: cell.r } });
        return ok;
      },
      removeWord: (cell) => {
        const ok = this.removeOrphanWord(cell);
        if (ok) this.recordAutoPlaceStep({ kind: 'removeWord', cell: { c: cell.c, r: cell.r } });
        return ok;
      },
      isActiveHeroCell: (cell) =>
        this.activeGenerals().some((g) => g.cells.some((c) => c.c === cell.c && c.r === cell.r)),
      dangerNear: () => this.dangerNear(),
      imminentPathScore: (cell) =>
        this.imminentPathScoreAt(this.monsters, this.map.path, this.pathLen, this.entranceDist, cell),
      monstersPresent: () => this.monsters.length > 0,
      heroRosterComplete: () => this.isHeroRosterComplete(),
      mergeTray: (from, to) => {
        const ok = this.mergeTrayTokens(from, to);
        if (ok) this.recordAutoPlaceStep({ kind: 'mergeTray', from, to });
        return ok;
      },
      mergeBoard: (from, to) => {
        const a = this.units.get(cellKey(from.c, from.r));
        const b = this.units.get(cellKey(to.c, to.r));
        if (!a || !b) return false;
        if (!canMerge({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier })) return false;
        const merged = mergeUnits({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier });
        this.units.set(cellKey(to.c, to.r), mergePlacedUnitState(b, a, merged));
        this.units.delete(cellKey(from.c, from.r));
        this.bursts.push({ kind: 'merge', c: to.c, r: to.r, ttl: 0.35, maxTtl: 0.35, big: false, color: '#ffd76a' });
        if (!this.autoPlaceRecording) {
          this.emit('merge');
        }
        this.recordAutoPlaceStep({ kind: 'mergeBoard', from: { c: from.c, r: from.r }, to: { c: to.c, r: to.r } });
        return true;
      },
    };
  }

  autoPlaceTray(): void {
    if (this.autoPlacePlaying) {
      this.message = '布阵进行中…';
      return;
    }
    const sessionSnap = this.clonePlayerAutoPlaceSession();
    const keyBefore = autoPlaceBoardKey(this.buildPlayerAutoView());
    const trayBefore = this.tray.length;
    const recorded: AutoPlacePlaybackStep[] = [];
    this.autoPlaceRecorder = recorded;
    this.autoPlaceRecording = true;
    const placed = planAutoPlaceSteps(this.buildPlayerAutoView(), {
      rng: () => this.rng.next(),
      pSubOptimal: 0,
      maxOrphanWords: AI_MAX_ORPHAN_WORDS,
      maxSteps: PLAYER_PLACE_MAX_STEPS,
      maxGuard: PLAYER_PLACE_MAX_GUARD,
      // 有怪时按紧预算截断（防掉帧）；无怪时用更宽松的备战预算兜底，防极端局面单帧卡死。
      deadlineMs: performance.now() + (this.monsters.length > 0
        ? PLAYER_PLACE_DEADLINE_MS
        : PLAYER_PLACE_DEADLINE_PREP_MS),
    });
    this.autoPlaceRecording = false;
    this.autoPlaceRecorder = null;
    // 有怪：布阵后按怪群调位（含空 tray）。无怪：仅当 tray 仍有可落物时才挂调位，
    // 避免「只剩挖不了的铲」仍走 finish→sweep 空转调位。
    const needsReposition = this.monsters.length > 0
      ? (trayBefore > 0 || this.tray.length > 0 || placed > 0)
      : this.trayHasAutoplaceSweepPending();
    const keyAfter = autoPlaceBoardKey(this.buildPlayerAutoView());
    const lastKey = this.lastAutoPlaceBoardKey;
    if (keyAfter !== keyBefore && lastKey !== null && keyAfter === lastKey) {
      this.restorePlayerAutoPlaceSession(sessionSnap);
      this.message = '布阵：当前暂无可执行操作';
      return;
    }
    if (keyAfter !== keyBefore) this.lastAutoPlaceBoardKey = keyBefore;

    this.restorePlayerAutoPlaceSession(sessionSnap);
    this.autoPlaceDragFx = [];
    const totalPlan = placed + (needsReposition ? 1 : 0);
    if (recorded.length === 0 && !needsReposition) {
      if (this.tray.length === 0 && this.units.size === 0 && this.words.size === 0) {
        this.message = '请先征兵，再点布阵';
      } else {
        this.message = '布阵：当前暂无可执行操作';
      }
      return;
    }

    this.autoPlacePlayback = [...recorded];
    this.autoPlacePlaying = true;
    this.autoPlacePlaybackWait = false;
    this.autoPlaceRepositionPending = needsReposition;
    this.placeDropStagger.player = 0;
    this.beginPlaceDropAnim();
    this.tickAutoPlacePlayback();

    if (placed > 0 && needsReposition) this.message = `布阵：落子 ${placed} 步，随后调位`;
    else if (placed > 0) this.message = `布阵：落子/合成 ${placed} 步`;
    else if (needsReposition) this.message = '布阵：调位中';
    else this.message = '布阵中…';
    if (totalPlan > 0) this.autoplaceFlash = 1;
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
