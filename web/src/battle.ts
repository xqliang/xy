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
import {
  generalById,
  generalStat,
  qualityName,
  qualityColor,
  matchGeneral,
  partnerChars,
  BOND_GENERAL,
  BOND_ATK_BONUS,
  ultTypeOf,
  CRIT_MULT,
  type GeneralDef,
} from './generals';
import { collectOrphanChars, pickWordChar, PAIR_PITY_AFTER } from './word-draw';
import { rollWeaponDrop, type WeaponBonuses } from './weapons';
import { drawSummonTray } from './summon-draw';
import { planAutoPlace, type AutoPlaceView } from './autoplace';
import {
  estimateOptimalBoardPower,
  pathCoverageLen,
  planWavePressure,
  spawnBatchCap,
  SPAWN_DIST_JITTER,
  type BoardPowerResult,
  type PressurePlan,
} from './board-power';
import { activeById, MAX_EQUIPPED_ACTIVES, type ActiveEffect } from './actives';
import { MAX_EQUIPPED_PASSIVES } from './passives';
import { DEFAULT_AI_SKILL, skillToKnobs } from './ai-skill';
import {
  COLS,
  ROWS,
  pathTotalLen,
  posAtDistance,
  posAlong,
  lenOf,
  entranceDistance,
  pathEntranceCell,
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
  monsterHpBase: 24, // 第 n 波 HP = base + step*n（波5起形成"第5波危机"，波1-4对正常操作友好）
  monsterHpStep: 16,
  bossEveryWave: 5, // 无尽模式：每 5 波出一个 BOSS（正常模式改用随机 BOSS 波，见 computeBossWaves）
  bossWaveChance: 0.35, // 正常模式：第 5..winWave-1 波各自成为 BOSS 波的概率
  bossMinBosses: 2, // 正常模式：第 5..winWave-1 波至少出现的 BOSS 次数
  bossHpMul: 14, // 后期(通关波)BOSS 血量倍数
  bossHpMulEarly: 8, // 前期(第5波)BOSS 血量倍数；第5波→通关波之间线性爬升到 bossHpMul
  bossSpdMul: 0.625, // BOSS 移速倍率：比普通妖慢（血厚推进慢，给玩家集火时间），但不至于过分迟缓
  // —— 骑兵波（后期随机某波：半数怪替换为骑兵，骑兵移速翻倍、血量与普通妖相同）——
  cavalryFromWave: 6, // 第 6 波起（游戏后期）才可能出现骑兵波
  cavalryWaveChance: 0.5, // 达到后期后，每波有 50% 概率成为骑兵波
  cavalrySpdMul: 2, // 骑兵移速倍率：比普通妖快一倍
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
  shovelDrawChance: 0.16, // 候选中出现铲子的概率
  shovelPityAfter: 3, // 铲子保底：连续 N 次征兵没出铲，则下次征兵强制出 1 把铲（避免没空位放兵）
  wordDrawChance: 0.14, // 候选中出现武将字牌的概率（凑双字召唤武将）
  wordPityAfter: 10, // 字牌保底：连续 N 次征兵没出字，则下次征兵强制把 1 个兵槽换成字
  pairPityAfter: PAIR_PITY_AFTER, // 半对保底：连续 N 次征兵仍有孤儿未补，则强制出配对字
  summonMaxPerKey: 3, // 单次征兵同 key（兵种/铲）上限
  summonMaxPerKeyAllOpen: 5, // 阵位全开后：铲子无用，放宽同兵种上限到 5（更快堆同型合成）
  traySize: 5, // 候选区容量
  initialShovels: 2, // 开局赠送铲子数
  initialOpenSlots: 6, // 初始 6 个阵位（照搬原作初始6格）
  winWave: 12, // 通关波次
  // —— 无尽模式：每 10 波为一圈，每进一圈怪物强度阶梯式 ×endlessCycleStep ——
  endlessWavesPerCycle: 10,
  endlessCycleStep: 1.3,
  aiDpsBase: 8, // AI 对手拦截 DPS 基数
  aiDpsPerWave: 4, // AI 拦截 DPS 每波增量
  // —— 怪物等级与技能（精英/BOSS 会对附近武将释放减益，不改动基础数值，仅施加临时计时器）——
  eliteFromWave: 3, // 第 3 波起可能刷出精英妖
  eliteChance: 0.28, // 非 BOSS 怪成为精英的概率
  skillRadius: 2.2, // 技能作用半径（格）
  skillInterval: 4.5, // 两次施法间隔（秒）
  skillFirstDelay: 2.5, // 入场后首次施法延迟（秒）
  stunDur: 1.4, // 眩晕：武将暂停攻击（秒）
  slowDur: 3, // 减速：攻击间隔拉长（秒）
  slowCooldownMul: 1.6, // 减速期间冷却倍率（≈攻速×0.63）
  weakenDur: 3, // 降攻：攻击力削弱（秒）
  weakenAtkMul: 0.65, // 降攻期间攻击倍率
  webbindDur: 3.5, // 缠丝：攻击范围削减持续（秒）
  webbindRangeMul: 0.5, // 缠丝期间有效射程倍率（最低 1 格，见 updateUnits）
  // —— 小 Boss（第 4 波之后、非妖王波：有概率刷出跨地图小头目，各带独立光环技能）——
  miniBossFromWave: 5, // 第 5 波起（第 4 波之后）才可能出现
  miniBossChance: 0.42, // 非 BOSS 波出现小 Boss 的概率
  miniBossHpMul: 4.2, // 血量相对普通妖倍数（介于精英与妖王之间）
  miniBossSpdMul: 0.82, // 移速略慢，给玩家反应窗口
  miniBossRadius: 2.8, // 光环作用半径（格）
  miniBossInterval: 4.0, // 两次施法间隔（秒）
  miniBossFirstDelay: 2.0, // 入场后首次施法延迟（秒）
  knockdownDur: 2.2, // 倒下：武器横躺、无法攻击（秒）
  hasteDur: 3.5, // 疾风：周围妖怪加速持续（秒）
  hasteSpdMul: 1.45, // 加速期间移速倍率
  healPct: 0.14, // 血泉：每次回复目标最大生命的比例
  // —— AI 清场（AI 对手定期释放的大范围爆发，维持伪竞技对称；玩家侧无此机制）——
  aiClearChargeTime: 20, // AI 从空到满的蓄力秒数
  aiClearRadius: 2.5, // AI 清场作用半径（格）
  aiClearDmgMul: 2.6, // AI 清场伤害 = 当前波基础怪血 × 该系数
  // 命中判定/范围环显示的半格外扩：攻击圆半径 = (rge + 0.5) 格。判定采用「圆与目标方格相交」
  // (见 inAttackRange)，显示环半径同为 (rge + 0.5)*CELL，两者一致。0.5 即半个格子。
  rangeTolerance: 0.5,
  // AI 对手每波部署的新单位数(基数 + 波次×系数)，使 AI 战力与玩家大致对称(伪竞技公平性)
  aiDeployBase: 8,
  aiDeployPerWave: 1.5,
  aiDeployInterval: 2.2, // AI 逐个部署的间隔(秒)：模拟人手动从候选区往地图放，不再开波瞬间铺满(总量不变，只拉长过程)
};

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
  stun: { name: '定身', color: '#ffd34d', icon: '💫' },
  slow: { name: '迟滞', color: '#5bd1ff', icon: '🐌' },
  weaken: { name: '弱身', color: '#c77dff', icon: '⬇' },
  webbind: { name: '缠丝', color: '#b76bd6', icon: '🕸' },
};

// 小 Boss 种类（跨地图通用，与地图专属精英/妖王技能独立）
export type MiniBossKind = 'frost' | 'blight' | 'quake' | 'gale' | 'blood';
export const MINI_BOSS_KINDS: MiniBossKind[] = ['frost', 'blight', 'quake', 'gale', 'blood'];
export const MINI_BOSS_META: Record<
  MiniBossKind,
  { name: string; skillName: string; color: string; icon: string; desc: string }
> = {
  frost: { name: '霜魄妖', skillName: '霜缚', color: '#7ec8ff', icon: '❄', desc: '范围内兵器攻速↓' },
  blight: { name: '蚀甲妖', skillName: '蚀甲', color: '#c77dff', icon: '☠', desc: '范围内兵器伤害↓' },
  quake: { name: '撼地妖', skillName: '震地', color: '#e0a060', icon: '💥', desc: '范围内兵器倒下' },
  gale: { name: '疾风妖', skillName: '疾风', color: '#7dffb0', icon: '💨', desc: '周围妖怪加速' },
  blood: { name: '血泉妖', skillName: '血泉', color: '#ff6a7a', icon: '🩸', desc: '周围妖怪回血' },
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
export type MonsterStatusId = 'stun' | 'slow' | 'haste' | 'heal';
export const MONSTER_STATUS_META: Record<MonsterStatusId, { name: string; color: string; icon: string }> = {
  stun: { name: '定身', color: '#ffd34d', icon: '💫' },
  slow: { name: '迟滞', color: '#5bd1ff', icon: '🐌' },
  haste: { name: '疾风', color: '#7dffb0', icon: '💨' },
  heal: { name: '回春', color: '#ff6a7a', icon: '💚' },
};

// 每张地图的专属技能主题：该图 Boss 必带、精英小怪也带同一技能（不再随机三选一）
const MAP_SKILL: Record<string, MonsterSkill> = {
  huoyanshan: 'weaken', // 火焰山：烈焰灼身，攻击↓
  liushahe: 'slow', // 流沙河：流沙裹足，出手变慢
  baiguling: 'stun', // 白骨岭：白骨魅惑，无法出手
  pansidong: 'webbind', // 盘丝洞：蛛网黏附，攻击范围骤减
};

// 候选区令牌：兵种 / 铲子 / 武将字牌（字牌不可互相合并，升阶靠激活继承/喂字/战斗）
export type TrayToken =
  | { kind: 'unit'; type: UnitType; tier: number }
  | { kind: 'shovel' }
  | { kind: 'word'; char: string; general: string; tier: number };

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

// 武将的持续状态（按武将 id 记录，拆分再重组可延续升阶进度）
// level/exp 为升阶进度内部计数，不对玩家展示为战斗 Lv
export interface GeneralState {
  level: number;
  exp: number;
  cooldown: number;
  skillCd: number;
  firePulse: number;
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
  isCavalry: boolean; // 骑兵：移速翻倍、血量与普通妖相同（骑兵波中占半数，BOSS 不会是骑兵）
  hitFlash: number; // 受击闪白(秒)
  skill: MonsterSkill | null; // 精英/BOSS 携带的减益技能（普通妖/小 Boss 为 null）
  skillCd: number; // 距下次施法的秒数
  castFlash: number; // 施法闪光(1→0)，用于渲染
  spawnT: number; // 出生后经过秒数（用于"由小变大崩出"入场缩放）
  stunT: number; // 被武将定身剩余(秒)：>0 时不前进
  slowT: number; // 被武将减速剩余(秒)：>0 时移速降低
  hasteT: number; // 疾风加速剩余(秒)：>0 时移速提高
  healFlash: number; // 刚被血泉治疗的闪光(1→0)，用于 UI
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
  critDmg?: number;      // 暴击伤害数字(crit 时飘字)
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

export function peachFloatInitialVy(gravity = PEACH_FLOAT_GRAVITY, rise = PEACH_FLOAT_RISE): number {
  return -Math.sqrt(2 * gravity * rise);
}

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

  units = new Map<string, PlacedUnit>();
  words = new Map<string, PlacedWord>(); // 棋盘上的武将字牌（各占一格）
  trees = new Map<string, PeachTree>(); // 蟠桃园桃树（各占一格未开垦地）
  gardenOn = false; // 是否装备了「蟠桃园」被动技能（每日购买）
  private plantTimer = 0; // 距下次自动种树累积秒数
  generalStates = new Map<string, GeneralState>(); // 各武将的等级/经验/冷却（按 id）
  monsters: Monster[] = [];
  fx: HitFx[] = [];
  bursts: Burst[] = []; // 命中/击杀/合成爆发特效
  heroUltFx: HeroUltFx[] = []; // 武将大招专属特效
  peachFloats: PeachFloat[] = []; // 击杀蟠桃飘字
  digFx: { c: number; r: number; t: number }[] = []; // 铲子挖坑动画(来回两下)，t 累积秒数
  aiDigFx: { c: number; r: number; t: number }[] = []; // AI 侧挖坑动画（对称展示，见 render）
  // 自动布阵对"刚挖开、开格动画未完"的格做的延迟落子：先预占该格，动画结束后由 updateFx 真正落子。
  private pendingPlace: { token: TrayToken; c: number; r: number }[] = [];
  private aiPendingPlace: { token: TrayToken; c: number; r: number }[] = [];
  summonFlash = 0; // 征兵闪光(1→0)
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

  // —— 伪竞技 AI 对手（上半场，对角唐僧）——
  readonly aiPath: Cell[];
  readonly aiTangseng: Cell;
  readonly aiCells: Cell[]; // AI 可部署格 = 玩家可摆放格的镜像
  readonly aiUnlocked = new Set<string>(); // AI 已开放阵位(初始6格 + 已部署格)，用于渲染其可放置区域
  private aiPathLen: number;
  private entranceDist = 0; // 玩家出怪口沿路距离
  private aiEntranceDist = 0; // AI 出怪口沿路距离
  aiTangsengHP = TANGSENG_INITIAL_HP;
  aiFrqMul = 1; // AI 侧全体攻速倍率（双刃道具「疾风咒」会同时抬高敌我两侧）
  aiMonsters: Monster[] = [];
  aiUnits: PlacedUnit[] = []; // AI 自动部署的单位（上半场）
  aiDefeated = false;
  private nextWaveTimer = 0; // 波间自动切换倒计时

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
  private aiSummonsSincePair = 0; // AI 半对保底计数（镜像 summonsSincePair）
  private aiSummonCount = 0;
  private aiGeneralStates = new Map<string, GeneralState>();
  private aiRng!: RNG;                      // 独立随机源（构造里派生）
  private aiSummonTimer = 0;                // 距下次可征兵计时
  aiSkill = DEFAULT_AI_SKILL;              // 跨局注入（默认 1.0）

  // 道具与修正器
  mods: Modifiers = { atkMul: 1, frqMul: 1, killBonus: 0, monsterSpdMul: 1, summonCostDelta: 0, wordRateBonus: 0, shovelPeach: 0, autoShovel: false, meteor: false, mud: false, generalTierDelta: 0 };
  private shovelTimer = 0; // 洛阳铲产铲计时
  private meteorPending = false; // 本波陨石是否待触发
  weaponBonuses: WeaponBonuses = {}; // 已装备神兵给各武将的加成
  droppedWeapons: string[] = []; // 本局掉落的神兵（结算时入背包）
  pickedItems: string[] = [];

  private tierBoosted = new Set<string>(); // 法宝符：已应用首次激活升阶的武将 id
  private rng: RNG;
  readonly map: GameMap;
  readonly pathLen: number;
  private slotOrder: Cell[];
  private spawnRemaining = 0;
  private spawnTimer = 0;
  private waveMonsterCount = 0; // 本波出怪总数（含后期堆量），用于骑兵半数判定
  private cavalryWave = false; // 本波是否为骑兵波（半数怪为骑兵）
  private waveMiniBoss: MiniBossKind | null = null; // 本波预定的小 Boss 种类（非 BOSS 波才可能）
  private miniBossSpawnIdx = -1; // 小 Boss 出场序号（0-based）；-1 表示本波无
  private nextMonsterId = 1;
  private waveActive = false;
  readonly difficultyMul: number; // 由境界决定的怪物强度系数
  readonly endless: boolean; // 无尽模式：波数不限、关对手、只记录最高波数
  message = '点「征兵」抽兵到候选区，拖到绿格布阵';

  private bossWaves = new Set<number>(); // 正常模式预计算的 BOSS 波集合（无尽模式不用，见 isBossWave）
  /** 本波按最优输出算出的压力方案（开波时刷新；供出怪血量/数量使用） */
  private wavePressure: PressurePlan | null = null;

  constructor(seed = 1, difficultyMul = 1, map: GameMap = MAPS[0]!, meta: MetaBonuses = NO_META, weapons: WeaponBonuses = {}, actives: string[] = [], passives: string[] = [], endless = false, aiSkill = DEFAULT_AI_SKILL) {
    this.weaponBonuses = weapons;
    this.rng = new RNG(seed);
    this.aiRng = new RNG((seed * 2654435761 + 1013904223) >>> 0); // 派生独立流：生成策略同、结果不同
    this.aiSkill = aiSkill;
    this.difficultyMul = difficultyMul;
    this.endless = endless;
    // 预计算 BOSS 波（正常模式）：用独立 rng，避免扰动出怪/掉落的主 rng 序列
    if (!endless) this.bossWaves = this.computeBossWaves(new RNG((seed ^ 0x5bf03635) >>> 0));
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
    // 装备的主动技能（最多 MAX_EQUIPPED_ACTIVES 个）建运行时槽；初始给半程 CD，避免开局即放
    for (const id of actives.slice(0, MAX_EQUIPPED_ACTIVES)) {
      const def = activeById(id);
      if (!def) continue;
      this.activeSlots.push({ id, cd: def.cd * 0.5, cdMax: def.cd, ready: false, flash: 0 });
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
      if (id === 'pas_pantao') { this.gardenOn = true; this.pickedItems.push(id); continue; } // 蟠桃园走桃树系统，同时进被动栏展示
      this.applyItem(id);
      this.pickedItems.push(id);
    }
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
    let min = Infinity;
    for (const p of this.map.path) {
      if (p.r < 0 || p.r >= ROWS) continue;
      const d = Math.hypot(p.c - cell.c, p.r - cell.r);
      if (d < min) min = d;
    }
    return min;
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
    const orphansBefore = this.orphanCharsNow();
    const forcePartner = !firstSummon && orphansBefore.length > 0 && this.summonsSincePair >= TUNING.pairPityAfter;
    const trayWordsSoFar: string[] = [];
    let partnerForced = false;
    const drawOneWord = (forcePair: boolean) => {
      const w = pickWordChar(this.rng, Math.max(1, this.wave), orphansBefore, trayWordsSoFar, forcePair);
      trayWordsSoFar.push(w.char);
      if (forcePair || orphansBefore.some((o) => partnerChars(o).includes(w.char))) partnerForced = true;
      return { kind: 'word' as const, char: w.char, general: w.general, tier: 1 };
    };
    const draws: TrayToken[] = base.map((tok) => {
      if (tok.kind === 'unit' && !firstSummon && this.rng.next() < TUNING.wordDrawChance + this.mods.wordRateBonus) {
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

  // 该格是否空闲（无兵、无字牌、且无延迟落子预占）
  private cellFree(c: number, r: number): boolean {
    return !this.units.has(cellKey(c, r)) && !this.words.has(cellKey(c, r)) && !this.pendingPlace.some((p) => p.c === c && p.r === r);
  }

  // 计入道具修正后的当前征兵成本
  effectiveSummonCost(): number {
    return Math.max(1, this.summonCost + this.mods.summonCostDelta);
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
    const trayChars = this.tray.filter((t): t is Extract<TrayToken, { kind: 'word' }> => t.kind === 'word').map((t) => t.char);
    return collectOrphanChars(board, trayChars, activeKeys);
  }

  // 候选区内合并：仅兵种同型同级升阶；字牌禁止互相合并。
  mergeTrayTokens(from: number, to: number): boolean {
    if (from === to) return false;
    const a = this.tray[from];
    const b = this.tray[to];
    if (!a || !b) return false;
    if (a.kind === 'word' && b.kind === 'word') {
      this.message = '单字不可合并，需凑对激活后升阶';
      return false;
    }
    if (a.kind !== 'unit' || b.kind !== 'unit') return false;
    if (a.type !== b.type || a.tier !== b.tier || b.tier >= MAX_TIER) {
      this.message = '候选区只有同型同级可合并';
      return false;
    }
    this.tray[to] = { kind: 'unit', type: b.type, tier: b.tier + 1 };
    this.tray.splice(from, 1);
    this.message = `候选区合成 ${UNITS[b.type].name} ${b.tier + 1} 阶`;
    this.emit('merge');
    return true;
  }

  // 取某武将的持续状态（不存在则初始化）
  private stateOf(id: string): GeneralState {
    let s = this.generalStates.get(id);
    if (!s) {
      s = { level: 1, exp: 0, cooldown: 0, skillCd: 0, firePulse: 0, skillFlash: 0 };
      this.generalStates.set(id, s);
    }
    return s;
  }

  // 扫描棋盘：左右紧邻且 chars 序对匹配某武将 → 激活（按字匹配，支持门派共享字）
  activeGenerals(): ActiveGeneral[] {
    const out: ActiveGeneral[] = [];
    const used = new Set<string>();
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
      if (this.mods.generalTierDelta > 0 && !this.tierBoosted.has(def.id)) {
        this.tierBoosted.add(def.id);
        for (let i = 0; i < this.mods.generalTierDelta; i++) {
          if (w.tier < cap) w.tier += 1;
          if (right.tier < cap) right.tier += 1;
        }
      }
      out.push({
        def,
        tier: Math.min(w.tier, right.tier, cap),
        cells: [w.cell, right.cell],
        state: this.stateOf(def.id),
      });
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
  // AI 基础经济：不享法宝符 generalTierDelta 加成。
  aiActiveGenerals(): ActiveGeneral[] {
    const out: ActiveGeneral[] = [];
    const used = new Set<string>();
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
      let s = this.aiGeneralStates.get(def.id);
      if (!s) { s = { level: 1, exp: 0, cooldown: 0, skillCd: 0, firePulse: 0, skillFlash: 0 }; this.aiGeneralStates.set(def.id, s); }
      out.push({ def, tier: Math.min(w.tier, right.tier, cap), cells: [w.cell, right.cell], state: s });
    }
    return out;
  }

  // AI 侧孤儿字（镜像 orphanCharsNow）：未激活的已放字牌 + tray 中的字，用于半对保底
  private aiOrphanCharsNow(): string[] {
    const activeKeys = new Set<string>();
    for (const g of this.aiActiveGenerals()) for (const c of g.cells) activeKeys.add(cellKey(c.c, c.r));
    const board = [...this.aiWords.entries()].map(([k, w]) => ({ char: w.char, cellKey: k }));
    const trayChars = this.aiTray.filter((t): t is Extract<TrayToken, { kind: 'word' }> => t.kind === 'word').map((t) => t.char);
    return collectOrphanChars(board, trayChars, activeKeys);
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
      this.aiTray.splice(index, 1);
      return true;
    }
    if (!this.aiUnlocked.has(k)) return false;
    if (token.kind === 'word') {
      const exist = this.aiWords.get(k);
      if (exist) {
        if (exist.char === token.char && exist.tier === token.tier && exist.tier < MAX_TIER) { exist.tier += 1; this.aiTray.splice(index, 1); return true; }
        return false;
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
    let min = Infinity;
    for (const p of this.aiPath) {
      if (p.r < 0 || p.r >= ROWS) continue;
      const d = Math.hypot(p.c - cell.c, p.r - cell.r);
      if (d < min) min = d;
    }
    return min;
  }

  // AI 征兵：与玩家同生成策略（drawSummonTray + 字牌转化），用 aiRng，够桃才征
  private aiSummon(): boolean {
    if (this.aiPeach < this.aiSummonCost) return false;
    this.aiPeach -= this.aiSummonCost;
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
    const orphansBefore = this.aiOrphanCharsNow();
    const forcePartner = !firstSummon && orphansBefore.length > 0 && this.aiSummonsSincePair >= TUNING.pairPityAfter;
    const trayWordsSoFar: string[] = [];
    let partnerForced = false;
    const drawOneWord = (forcePair: boolean) => {
      const w = pickWordChar(this.aiRng, Math.max(1, this.wave), orphansBefore, trayWordsSoFar, forcePair);
      trayWordsSoFar.push(w.char);
      if (forcePair || orphansBefore.some((o) => partnerChars(o).includes(w.char))) partnerForced = true;
      return { kind: 'word' as const, char: w.char, general: w.general, tier: 1 };
    };
    const draws: TrayToken[] = base.map((tok) => {
      if (tok.kind === 'unit' && !firstSummon && this.aiRng.next() < TUNING.wordDrawChance) {
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
    this.aiPeach += base;
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
      tray: () => this.aiTray,
      freeCells: () => this.aiUnlockedCells().filter((c) => this.aiCellFree(c.c, c.r)),
      diggableCells: () => this.aiLockedCells(),
      placedUnits: () => this.aiUnits.map((u) => ({ type: u.type, tier: u.tier, cell: u.cell })),
      placedWords: () => [...this.aiWords.values()].map((w) => ({ char: w.char, general: w.general, cell: w.cell, tier: w.tier })),
      nearestPathDist: (cell) => this.aiNearestPathDist(cell),
      pathTouchSides: (cell) => this.pathTouchSidesOf(this.aiPath, cell),
      exitDist: (cell) => this.distToPathEntrance(this.aiPath, cell),
      tangsengDist: (cell) => Math.hypot(cell.c - this.aiTangseng.c, cell.r - this.aiTangseng.r),
      pathCover: (cell, type, tier) => {
        const rge = getUnitStat(type, tier).rge;
        return this.aiPathCoverAt(cell.c, cell.r, rge);
      },
      pathCoverAt: (ax, ay, rge) => this.aiPathCoverAt(ax, ay, rge),
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
      isActiveHeroCell: (cell) =>
        this.aiActiveGenerals().some((g) => g.cells.some((c) => c.c === cell.c && c.r === cell.r)),
      mergeTray: (from, to) => this.aiMergeTrayTokens(from, to),
      mergeBoard: (from, to) => this.aiMergeBoardUnits(from, to),
    };
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

  /** 格到路径「出怪口」（首个在网格内的点）的欧氏距离 */
  private distToPathEntrance(path: { c: number; r: number }[], cell: { c: number; r: number }): number {
    let gate: { c: number; r: number } | null = null;
    for (const p of path) {
      if (p.c >= 0 && p.c < COLS && p.r >= 0 && p.r < ROWS) { gate = p; break; }
    }
    if (!gate) gate = path[0] ?? { c: 0, r: 0 };
    return Math.hypot(cell.c - gate.c, cell.r - gate.r);
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
      this.tray.splice(index, 1);
      this.peach += this.mods.shovelPeach; // 摸金校尉
      this.emit('shovel');
      this.message = this.mods.shovelPeach > 0 ? `挖开新阵位（摸金 +${this.mods.shovelPeach}🍑）` : '铲子挖开了新阵位';
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
          this.tray.splice(index, 1);
          this.bursts.push({ kind: 'merge', c: g.cells[0].c, r: g.cells[0].r, ttl: 0.35, maxTtl: 0.35, big: false, color: qualityColor(wa.tier) });
          this.bursts.push({ kind: 'merge', c: g.cells[1].c, r: g.cells[1].r, ttl: 0.35, maxTtl: 0.35, big: false, color: qualityColor(wb.tier) });
          this.message = `${g.def.name} 升为 ${wa.tier} 阶`;
          this.emit('merge');
          return true;
        }
      }
      const exist = this.wordAt(to.c, to.r);
      if (exist) {
        if (exist.char === token.char) {
          this.message = '单字不可合并，需凑对激活后升阶';
          return false;
        }
        // 不同字 → 与该格字牌交换
        this.words.set(cellKey(to.c, to.r), { char: token.char, general: token.general, tier: token.tier, cell: { c: to.c, r: to.r } });
        this.tray[index] = { kind: 'word', char: exist.char, general: exist.general, tier: exist.tier };
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
      this.tray.splice(index, 1);
      const activated = this.activeGenerals().find((ag) => ag.cells.some((cc) => cc.c === to.c && cc.r === to.r));
      this.emit(activated ? 'general' : 'place');
      if (activated) {
        this.message = `${activated.def.name} 已激活！(金框生效)`;
      } else {
        const mates = partnerChars(token.char).join('/');
        this.message = `放下「${token.char}」，与「${mates}」按武将名左右相邻可激活`;
      }
      return true;
    }
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
        this.tray.splice(index, 1);
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
    this.tray.splice(index, 1);
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

  // 拖拽字牌：移动到空格 / 同字同阶升阶 / 与目标(字牌或兵)交换。
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
    if (tw) {
      if (tw.char === w.char) {
        this.message = '单字不可合并，需凑对激活后升阶';
        return false;
      }
      // 两张字牌互换位置
      this.words.set(kFrom, { ...tw, cell: { c: from.c, r: from.r } });
      this.words.set(kTo, { ...w, cell: { c: to.c, r: to.r } });
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
    if (nowActive) { this.emit('general'); this.message = `${def?.name ?? ''} 已激活！(金框生效)`; }
    else if (wasActive) this.message = `${def?.name ?? ''} 已拆分，失去输出`;
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
    // 按当前地图 + 战场武器最优重排 DPS，规划本波数量/Boss 血（约 70% 压力）
    this.wavePressure = this.computeWavePressure(this.wave);
    this.spawnRemaining = this.wavePressure.count;
    this.waveMonsterCount = this.spawnRemaining; // 记录总数用于骑兵半数判定
    const bossWave = this.isBossWave(this.wave);
    // 后期(第 6 波起)随机某波成为骑兵波：半数怪替换为骑兵（移速翻倍、血量相同）
    this.cavalryWave =
      this.wave >= TUNING.cavalryFromWave && this.rng.next() < TUNING.cavalryWaveChance;
    // 第 4 波之后、非妖王波：有概率刷出 1 只跨地图小 Boss
    this.waveMiniBoss = null;
    this.miniBossSpawnIdx = -1;
    if (
      this.wave >= TUNING.miniBossFromWave &&
      !bossWave &&
      this.spawnRemaining >= 3 &&
      this.rng.next() < TUNING.miniBossChance
    ) {
      this.waveMiniBoss = MINI_BOSS_KINDS[this.rng.int(MINI_BOSS_KINDS.length)]!;
      // 避开首尾：中间段出场，避免与开波/收波节奏抢戏
      const lo = 1;
      const hi = Math.max(lo, this.spawnRemaining - 2);
      this.miniBossSpawnIdx = lo + this.rng.int(hi - lo + 1);
    }
    this.spawnTimer = 0;
    this.meteorPending = this.mods.meteor; // 本波陨石待触发（等首批怪出现）
    // 开波提示（波次号顶部 HUD 已显示，底部只报类型）：BOSS 优先，其次小 Boss/骑兵，否则普通
    if (bossWave) this.message = '⚠ 妖王来袭！';
    else if (this.waveMiniBoss) this.message = `⚠ ${MINI_BOSS_META[this.waveMiniBoss].name}来袭！`;
    else if (this.cavalryWave) this.message = '骑兵突袭！';
    else this.message = '妖怪来袭！';
    this.emit('wave');
    return true;
  }

  // 唐僧当前渲染位置（入场时沿路走向归位；归位后固定在终点格）
  tangsengRenderPos(): { c: number; r: number } {
    if (this.introDone) return posAtDistance(this.map, this.pathLen);
    const p = Math.min(1, this.introT / Battle.INTRO_DUR);
    return posAtDistance(this.map, p * this.pathLen);
  }

  // 把玩家场上所有妖怪推回起点（神掌按钮与「如来神掌」主动技能共用）
  private pushMonstersToStart(): void {
    for (const m of this.monsters) m.dist = 0;
  }

  // 被动道具进度（供 HUD 点击查看）：返回 0..1 进度与说明文本；无进度类返回 null
  passiveProgress(id: string): { ratio: number; text: string } | null {
    if (id === 'luoyangchan') return { ratio: this.shovelTimer / 45, text: `产铲 ${this.shovelTimer.toFixed(0)}/45s` };
    return null;
  }

  private applyItem(id: string): void {
    switch (id) {
      case 'xiandan': this.mods.atkMul += 0.15; break;
      case 'fenghuolun': this.mods.frqMul += 0.2; break;
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
      case 'jifeng': this.mods.frqMul += 0.5; this.aiFrqMul += 0.25; break;
      case 'tongxin': this.tangsengMaxHP += 3; this.tangsengHP += 3; this.aiTangsengHP += 2; break;
      case 'zhuwang': this.mods.monsterSpdMul = Math.max(0.4, this.mods.monsterSpdMul - 0.12); break;
      case 'dinghai': { const lc = this.lockedCells(); if (lc[0]) this.unlocked.add(cellKey(lc[0].c, lc[0].r)); break; }
    }
  }

  // 被动道具的持续效果：洛阳铲产铲
  private updateItemEffects(dt: number): void {
    if (this.mods.autoShovel) {
      this.shovelTimer += dt;
      if (this.shovelTimer >= 45) { this.shovelTimer = 0; this.shovels += 1; }
    }
  }

  // 蟠桃园：每 40s 在未开垦空地自动种 1 棵 1 级桃树；每棵树按等级周期产桃。
  // 仅在 status 为 playing/ready（对局进行中）推进，由 updateFx 调用。
  private updatePeachTrees(dt: number): void {
    if (this.gardenOn) {
      this.plantTimer += dt;
      if (this.plantTimer >= PEACH_TREE_PLANT_INTERVAL) {
        if (this.plantTree()) this.plantTimer = 0;
        else this.plantTimer = PEACH_TREE_PLANT_INTERVAL; // 无空地则封顶，等有空地立刻种
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
    this.doMeteor();
  }

  // 陨石伤害核心（无守卫）：被动道具与「天降陨石」主动技能共用
  private doMeteor(): void {
    if (this.monsters.length === 0) return;
    let front = this.monsters[0]!;
    for (const m of this.monsters) if (m.dist > front.dist) front = m;
    const dmg = (TUNING.monsterHpBase + TUNING.monsterHpStep * this.wave) * this.effectiveDifficulty() * 3;
    const p = posAtDistance(this.map, front.dist);
    for (const m of this.monsters) {
      const q = posAtDistance(this.map, m.dist);
      if (Math.hypot(q.c - p.c, q.r - p.r) <= 1.6) { m.hp -= dmg; m.hitFlash = 0.2; }
    }
    this.bursts.push({ kind: 'death', c: p.c, r: p.r, ttl: 0.5, maxTtl: 0.5, big: true, color: '#ff7a3c' });
  }

  // 清波掉落神兵：基础 35%，BOSS 波必掉（对应竞品"对局随机掉落"）
  private rollWeaponDropOnClear(): void {
    const isBossWave = this.isBossWave(this.wave);
    if (!isBossWave && this.rng.next() > 0.35) return;
    const id = rollWeaponDrop(this.rng.next());
    this.droppedWeapons.push(id);
    this.message = `第 ${this.wave} 波已清！掉落神兵`;
  }

  // 有效怪物强度系数：正常模式=境界系数；无尽模式=境界系数 × 分圈阶梯系数。
  // 圈系数 = endlessCycleStep ^ floor((wave-1)/endlessWavesPerCycle)：波1-10 ×1，波11-20 ×STEP…
  effectiveDifficulty(wave: number = this.wave): number {
    if (!this.endless) return this.difficultyMul;
    const cycle = Math.floor((Math.max(1, wave) - 1) / TUNING.endlessWavesPerCycle);
    return this.difficultyMul * TUNING.endlessCycleStep ** cycle;
  }

  // 预计算正常模式的 BOSS 波：第 5..winWave-1 波各按 bossWaveChance 随机成为 BOSS 波，
  // 保证该区间至少 bossMinBosses 个；通关波(winWave)必出 BOSS。用独立 rng，确定性可复现。
  private computeBossWaves(rng: RNG): Set<number> {
    const s = new Set<number>();
    s.add(TUNING.winWave); // 通关波必出
    const lo = 5, hi = TUNING.winWave - 1;
    const pool: number[] = [];
    for (let w = lo; w <= hi; w++) {
      pool.push(w);
      if (rng.next() < TUNING.bossWaveChance) s.add(w);
    }
    // 保证 [lo,hi] 至少 bossMinBosses 个 BOSS 波
    let inRange = pool.filter((w) => s.has(w)).length;
    const remaining = pool.filter((w) => !s.has(w));
    while (inRange < TUNING.bossMinBosses && remaining.length > 0) {
      s.add(remaining.splice(rng.int(remaining.length), 1)[0]!);
      inRange++;
    }
    return s;
  }

  // 某波是否为 BOSS 波：无尽模式每 bossEveryWave 波，正常模式查预计算集合。
  isBossWave(wave: number): boolean {
    return this.endless ? wave % TUNING.bossEveryWave === 0 : this.bossWaves.has(wave);
  }

  // 本波出怪总数基准：经济基准(9+n，同时决定掉落) + 后期堆量。
  // 只在 battle 层叠加，不改 game-core 的 monstersInWave，保持"第5波蟠桃转负"的经济不变量与测试。
  // 第 4 波起还会按最优输出抬升（见 computeWavePressure），本函数结果作为最低保底。
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

  /** 普通怪基础血量（含境界/无尽圈系数，不含 Boss 倍乘） */
  private normalMonsterHp(wave: number = this.wave): number {
    return (TUNING.monsterHpBase + TUNING.monsterHpStep * wave) * this.effectiveDifficulty(wave);
  }

  /** 某波普通怪移速（含被动减速、难度加速，不含 Boss/骑兵倍乘） */
  private normalMonsterSpeed(wave: number = this.wave): number {
    const diffSpd = 1 + 0.1 * (this.effectiveDifficulty(wave) - 1);
    return TUNING.monsterSpd * this.mods.monsterSpdMul * diffSpd;
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
      return {
        atk: base.atk * (1 + (wb?.atk ?? 0)) * atkMul,
        frq: base.frq * (1 + (wb?.frq ?? 0)) * frqMul,
        rge: base.rge * (1 + (wb?.rge ?? 0)),
        targets: base.targets,
        ax: (g.cells[0].c + g.cells[1].c) / 2,
        ay: (g.cells[0].r + g.cells[1].r) / 2,
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

  /** 按最优 DPS 规划本波出怪数、Boss 血量与出怪间隔（约 70% 压力） */
  private computeWavePressure(wave: number): PressurePlan {
    const power = this.estimateOptimalPower();
    return planWavePressure({
      wave,
      baselineCount: this.baselineWaveSpawnCount(wave),
      normalHp: this.normalMonsterHp(wave),
      isBossWave: this.isBossWave(wave),
      bossSpd: this.bossSpeed(wave),
      monsterSpd: this.normalMonsterSpeed(wave),
      baseSpawnInterval: TUNING.spawnInterval,
      difficultySpawnFactor: 1 + 0.07 * (this.effectiveDifficulty(wave) - 1),
      minSpawnInterval: TUNING.spawnIntervalMin,
      power,
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

  /** @param distOffset 相对出怪口沿路偏移（负值=尚未走到门口，用于同批错位） */
  private spawnMonster(distOffset = 0): void {
    // BOSS：boss 波的最后一只，或最终通关波的最后一只
    const isBoss =
      this.isBossWave(this.wave) &&
      this.spawnRemaining === 1;
    // 骑兵：仅骑兵波、非 BOSS，按出场序号隔一出一 → 约占本波半数
    const spawnedIdx = this.waveMonsterCount - this.spawnRemaining; // 0-based 出场序号
    // 小 Boss：预定序号出场；与 BOSS 互斥，也不做骑兵
    const miniKind = !isBoss && spawnedIdx === this.miniBossSpawnIdx ? this.waveMiniBoss : null;
    const isMiniBoss = miniKind != null;
    const isCavalry = this.cavalryWave && !isBoss && !isMiniBoss && spawnedIdx % 2 === 0;

    let hp = this.normalMonsterHp();
    if (isBoss) {
      // Boss 血：当前地图最优重排全路集火伤害 × ~70%；无方案时回退旧倍乘
      const planned = this.wavePressure?.bossHp;
      if (planned != null && planned > 0) {
        hp = planned;
      } else {
        const t = Math.max(0, Math.min(1, (this.wave - 5) / Math.max(1, TUNING.winWave - 5)));
        hp *= TUNING.bossHpMulEarly + (TUNING.bossHpMul - TUNING.bossHpMulEarly) * t;
      }
    } else if (isMiniBoss) {
      hp *= TUNING.miniBossHpMul;
    }

    // 移速倍率：BOSS/小 Boss 略慢、骑兵翻倍（互斥）
    const spdMul = isBoss
      ? TUNING.bossSpdMul
      : isMiniBoss
        ? TUNING.miniBossSpdMul
        : isCavalry
          ? TUNING.cavalrySpdMul
          : 1;
    const diffSpd = 1 + 0.1 * (this.effectiveDifficulty() - 1); // 高难度妖怪更快

    // 小 Boss 带独立光环；精英/妖王带地图技能；普通妖无
    const skill = isMiniBoss ? null : this.rollMonsterSkill(isBoss);
    const skillCd = isMiniBoss ? TUNING.miniBossFirstDelay : TUNING.skillFirstDelay;
    const makeOne = (dist: number, spd: number): Monster => ({
      id: this.nextMonsterId++,
      dist,
      hp,
      maxHp: hp,
      spd,
      isBoss,
      isMiniBoss,
      miniBossKind: miniKind,
      isCavalry,
      hitFlash: 0,
      skill,
      skillCd,
      castFlash: 0,
      spawnT: 0,
      stunT: 0,
      slowT: 0,
      hasteT: 0,
      healFlash: 0,
    });
    const off = Math.min(0, distOffset);
    this.monsters.push(
      makeOne(this.entranceDist + off, TUNING.monsterSpd * this.mods.monsterSpdMul * diffSpd * spdMul),
    );
    // AI 对手同波同步出怪（镜像路，无玩家的 monsterSpdMul 道具加成）。无尽模式无对手，跳过。
    if (!this.endless) {
      this.aiMonsters.push(makeOne(this.aiEntranceDist + off, TUNING.monsterSpd * diffSpd * spdMul));
    }
    this.spawnGateT = 0.5; // 触发出怪口"开合"动画
    this.aiSpawnGateT = 0.5;
  }

  // 决定怪物携带的技能：BOSS 必带（随机一种），精英按概率带，普通妖无
  private rollMonsterSkill(isBoss: boolean): MonsterSkill | null {
    // 技能按地图主题固定（该图 Boss 必带；精英小怪按概率带同一技能）；未配置的地图回退定身。
    const skill = MAP_SKILL[this.map.id] ?? 'stun';
    if (isBoss) return skill;
    if (this.wave >= TUNING.eliteFromWave && this.rng.next() < TUNING.eliteChance) return skill;
    return null;
  }

  // AI 单位攻击 AI 怪（与玩家同一套战斗数值；出招特效走共用 this.fx）
  private updateAiUnits(dt: number): void {
    for (const u of this.aiUnits) {
      u.cooldown -= dt;
      if (u.cooldown > 0) continue;
      const stat = getUnitStat(u.type, u.tier);
      const base = Math.floor(stat.targets);
      const extra = this.aiRng.next() < stat.targets - base ? 1 : 0; // 用 AI 独立随机流，不扰动玩家 rng
      const maxTargets = Math.max(1, base + extra);
      const inRange = this.aiMonsters
        .map((m) => ({ m, p: posAlong(this.aiPath, m.dist) }))
        .filter((x) => inAttackRange(u.cell.c, u.cell.r, stat.rge, x.p))
        .sort((a, b) => b.m.dist - a.m.dist);
      if (inRange.length === 0) continue;
      const dmg = damage(stat.atk);
      const color = this.unitColor(u.type);
      let hit = 0;
      for (const t of inRange) {
        if (hit >= maxTargets) break;
        t.m.hp -= dmg;
        t.m.hitFlash = 0.1;
        const p = posAlong(this.aiPath, t.m.dist);
        const fxTtl = this.attackFxTtl(u.type, u.tier);
        this.fx.push({ from: { c: u.cell.c, r: u.cell.r }, to: p, ttl: fxTtl, maxTtl: fxTtl, color, wtype: u.type, tier: u.tier }); // AI 侧也播放攻击特效
        hit++;
      }
      if (hit > 0) {
        u.combo = u.firePulse > 0.35 ? Math.min(9, u.combo + 1) : 0;
        u.firePulse = 1;
        const tp = posAlong(this.aiPath, inRange[0]!.m.dist);
        u.fireDir = Math.atan2(tp.r - u.cell.r, tp.c - u.cell.c);
      }
      u.cooldown = 1 / (stat.frq * this.aiFrqMul);
    }
  }

  // AI 武将攻击 tick：镜像玩家 updateGenerals 的“攻击”部分，但用基础数值
  //（无武器加成 / 无 this.mods / 无羁绊），且无玩家专属副作用（不产 bursts/emit/exp）。
  // 主动技能（眩晕/治疗等）本阶段有意不镜像——仅基础普攻。对 this.aiMonsters 造成伤害。
  private updateAiGenerals(dt: number): void {
    for (const g of this.aiActiveGenerals()) {
      const stat = generalStat(g.def, g.tier);
      const s = g.state;
      const ax = (g.cells[0].c + g.cells[1].c) / 2;
      const ay = (g.cells[0].r + g.cells[1].r) / 2;
      const inRange = this.aiMonsters
        .map((m) => ({ m, p: posAlong(this.aiPath, m.dist) }))
        .filter((x) => inAttackRange(ax, ay, stat.rge, x.p))
        .sort((a, b) => b.m.dist - a.m.dist);
      s.cooldown -= dt;
      if (s.cooldown > 0 || inRange.length === 0) continue;
      const base = Math.floor(stat.targets);
      const extra = this.aiRng.next() < stat.targets - base ? 1 : 0;
      const maxTargets = Math.max(1, base + extra);
      const dmg = damage(stat.atk); // 基础，无 bond/weapon/mods
      let hit = 0;
      for (const t of inRange) {
        if (hit >= maxTargets) break;
        t.m.hp -= dmg;
        t.m.hitFlash = 0.12;
        const isStaff = g.def.id === 'wukong';
        const ttl = isStaff ? 0.3 + (g.tier - 1) * 0.04 : 0.16;
        this.fx.push({
          from: { c: ax, r: ay },
          to: t.p,
          ttl,
          maxTtl: ttl,
          color: qualityColor(g.tier),
          ...(isStaff ? { wtype: 'staff' as const, tier: g.tier } : {}),
        });
        hit++;
      }
      s.cooldown = 1 / stat.frq;
    }
  }

  // AI 侧推进：真玩家循环（征兵节奏→共享布阵→单位/武将攻击→怪物推进/漏怪扣血/击杀产桃）
  private updateAi(dt: number): void {
    if (this.endless) return; // 无尽模式无 AI 对手
    const knobs = skillToKnobs(this.aiSkill);
    // 1) 征兵节奏：到点且够桃则征一次，随后共享布阵
    this.aiSummonTimer -= dt;
    if (this.aiSummonTimer <= 0) {
      this.aiSummonTimer = knobs.summonInterval;
      if (this.aiSummon()) {
        planAutoPlace(this.buildAiAutoView(), {
          rng: () => this.aiRng.next(),
          pSubOptimal: knobs.pSubOptimal,
          randomDigExitWeight: true,
        });
      }
    }
    // 2) 战斗：AI 兵 + AI 武将攻击 aiMonsters
    this.updateAiUnits(dt);
    this.updateAiGenerals(dt);
    // 3) 怪物推进 + 漏怪扣血 + 击杀产桃（基础经济）
    const survivors: Monster[] = [];
    for (const m of this.aiMonsters) {
      m.spawnT += dt;
      if (m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt);
      if (m.hp <= 0) {
        this.creditAiKill(m.isBoss, !m.isBoss && !m.isMiniBoss && !!m.skill, m.isMiniBoss);
        continue;
      } // 击杀产桃（精英/小Boss/大Boss 分档，对齐玩家语义）
      m.dist += m.spd * (m.hasteT > 0 ? TUNING.hasteSpdMul : 1) * dt;
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

  // 危险提示：任一怪物距唐僧（沿路剩余）≤3 格
  dangerNear(): boolean {
    for (const m of this.monsters) if (this.pathLen - m.dist <= 4) return true;
    return false;
  }
  aiDangerNear(): boolean {
    for (const m of this.aiMonsters) if (this.aiPathLen - m.dist <= 4) return true;
    return false;
  }

  private unitColor(type: UnitType): string {
    switch (type) {
      case 'monkey': return '#ff9a3c';
      case 'spear': return '#5bd1ff';
      case 'cavalry': return '#7dff8a';
      case 'archer': return '#c79bff';
    }
  }

  /** 兵种攻击特效时长：骑基础再慢一倍(1.2s)，随阶加快；其它约 0.3s 起 */
  private attackFxTtl(type: UnitType, tier: number): number {
    if (type === 'cavalry') return 1.2 / (1 + (tier - 1) * 0.22);
    if (type === 'monkey') return 0.2 + (tier - 1) * 0.02; // 刀砍更快一截
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
      if (u.stunT > 0 || u.knockdownT > 0) continue; // 眩晕/倒下：本帧无法攻击（冷却也不推进）
      u.cooldown -= dt;
      if (u.cooldown > 0) continue;
      const stat = getUnitStat(u.type, u.tier); // atk/frq/rge/targets（来自 game-core）
      // 缠丝：有效射程削减（最低 1 格），逼近战化，配合盘丝洞蛛网主题
      const effRge = u.rangeCutT > 0 ? Math.max(1, stat.rge * TUNING.webbindRangeMul) : stat.rge;
      const base = Math.floor(stat.targets);
      const extra = this.rng.next() < stat.targets - base ? 1 : 0;
      const maxTargets = Math.max(1, base + extra);
      const inRange = this.monsters
        .map((m) => ({ m, p: posAtDistance(this.map, m.dist) }))
        .filter((x) => inAttackRange(u.cell.c, u.cell.r, effRge, x.p))
        .sort((a, b) => b.m.dist - a.m.dist); // 优先打最靠前（进度大）的妖怪
      if (inRange.length === 0) continue;
      // 降攻减益：仅临时削弱伤害，不改动基础数值；仙丹增益临时抬高攻击
      const atkMul = this.mods.atkMul * (u.weakenT > 0 ? TUNING.weakenAtkMul : 1) * (this.atkBuffT > 0 ? this.atkBuffMul : 1);
      const dmg = damage(stat.atk * atkMul); // 道具增伤 + 减益
      const color = this.unitColor(u.type);
      let hitCount = 0;
      for (const target of inRange) {
        if (hitCount >= maxTargets) break;
        target.m.hp -= dmg;
        target.m.hitFlash = 0.12; // 受击闪白
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

  // 羁绊：悟空激活 → 全队攻击加成（对应竞品 赵云+阿斗 羁绊）
  bondActive(): boolean {
    return this.activeGenerals().some((g) => g.def.id === BOND_GENERAL);
  }
  private bondAtkMul(): number {
    return this.bondActive() ? 1 + BOND_ATK_BONUS : 1;
  }

  // 武将升阶进度：每级所需经验 = 10 × 当前 level；满条时双字各 +1 阶（level 仅作阈值曲线，不参与攻力）
  static expToNext(level: number): number {
    return 10 * level;
  }
  addGeneralCombatExp(g: ActiveGeneral, amount: number): void {
    const wa = this.wordAt(g.cells[0].c, g.cells[0].r);
    const wb = this.wordAt(g.cells[1].c, g.cells[1].r);
    if (!wa || !wb) return;
    const cap = g.def.maxTier;
    if (wa.tier >= cap && wb.tier >= cap) return; // 双字已达该武将满级：丢弃经验

    const s = g.state;
    s.exp += amount;
    while (s.exp >= Battle.expToNext(s.level)) {
      const wa2 = this.wordAt(g.cells[0].c, g.cells[0].r);
      const wb2 = this.wordAt(g.cells[1].c, g.cells[1].r);
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
      this.bursts.push({ kind: 'merge', c: g.cells[0].c, r: g.cells[0].r, ttl: 0.4, maxTtl: 0.4, big: false, color: '#ffe27a' });
      this.bursts.push({ kind: 'merge', c: g.cells[1].c, r: g.cells[1].r, ttl: 0.4, maxTtl: 0.4, big: false, color: '#ffe27a' });
      this.message = `${g.def.name} 升为 ${Math.min(wa2.tier, wb2.tier, cap)} 阶`;
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
    return generalStat(g.def, g.tier).rge * (1 + (wb?.rge ?? 0));
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
      const inRange = this.monsters
        .map((m) => ({ m, p: posAtDistance(this.map, m.dist) }))
        .filter((x) => inAttackRange(ax, ay, this.generalRge(g), x.p))
        .sort((a, b) => b.m.dist - a.m.dist);

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
        t.m.hp -= dmg;
        t.m.hitFlash = 0.12;
        // 悟空普攻：复用原棍兵金箍棒旋转特效；其余武将仍用短线弹道
        const isStaff = g.def.id === 'wukong';
        const ttl = isStaff ? 0.3 + (g.tier - 1) * 0.04 : 0.16;
        this.fx.push({
          from: { c: ax, r: ay },
          to: t.p,
          ttl,
          maxTtl: ttl,
          color: qualityColor(g.tier),
          ...(isStaff ? { wtype: 'staff' as const, tier: g.tier } : {}),
        });
        hit++;
      }
      if (hit > 0) {
        s.firePulse = 1;
        this.addGeneralCombatExp(g, dmg * hit * 0.05); // 输出转升阶进度
      }
      s.cooldown = 1 / this.generalFrq(g);
    }
  }

  private castGeneralSkill(g: ActiveGeneral, inRange: { m: Monster; p: { c: number; r: number } }[]): void {
    const atk = this.generalAtk(g);
    g.state.skillFlash = 1;
    const center = inRange[0]!.p;
    const crit = ultTypeOf(g.def) === 'crit';
    let critDmg: number | undefined;
    switch (g.def.skill) {
      case 'burst': {
        for (const t of inRange) { t.m.hp -= damage(atk * 3); t.m.hitFlash = 0.15; }
        break;
      }
      case 'ranged': {
        // 暴击：单体高倍 ×(5×CRIT_MULT)
        const t = inRange[0]!;
        const dmg = damage(atk * 5 * CRIT_MULT);
        t.m.hp -= dmg;
        t.m.hitFlash = 0.2;
        critDmg = dmg;
        break;
      }
      case 'stun': {
        for (const t of inRange) t.m.stunT = Math.max(t.m.stunT, 1.8);
        break;
      }
      case 'knock': {
        for (const t of inRange) t.m.dist = Math.max(this.entranceDist, t.m.dist - 2);
        break;
      }
      case 'slow': {
        for (const t of inRange) t.m.slowT = Math.max(t.m.slowT, 3);
        break;
      }
      case 'heal': {
        for (const t of inRange) t.m.slowT = Math.max(t.m.slowT, 2.5);
        if (!this.healUsedThisWave && this.tangsengHP < this.tangsengMaxHP) {
          this.tangsengHP += 1;
          this.healUsedThisWave = true;
          this.message = '观音甘露：唐僧回复 1 血';
        }
        break;
      }
    }
    // 专属大招特效（替代原通用 bursts.push）
    this.heroUltFx.push({
      heroId: g.def.id,
      c: center.c, r: center.r,
      ttl: 0.6, maxTtl: 0.6,
      tier: g.tier,
      rge: this.generalRge(g),
      crit,
      critDmg,
    });
    this.addGeneralCombatExp(g, 4);
  }

  // 怪物施法：精英/BOSS 对半径内兵器施加地图减益；小 Boss 施展跨地图光环
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
      // 精英 / 妖王：地图专属减益
      if (!m.skill) continue;
      m.skillCd -= dt;
      if (m.skillCd > 0) continue;
      m.skillCd = TUNING.skillInterval;
      const mp = posAtDistance(this.map, m.dist);
      let affected = 0;
      for (const u of this.units.values()) {
        const d = Math.hypot(mp.c - u.cell.c, mp.r - u.cell.r);
        if (d > TUNING.skillRadius) continue;
        this.applyDebuff(u, m.skill);
        affected++;
      }
      if (affected > 0) {
        m.castFlash = 1;
        this.bursts.push({ kind: 'hit', c: mp.c, r: mp.r, ttl: 0.4, maxTtl: 0.4, big: true, color: SKILL_META[m.skill].color });
        this.message = `${m.isBoss ? 'BOSS' : '精英妖'}施展「${SKILL_META[m.skill].name}」`;
      }
    }
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
        for (const u of this.units.values()) {
          const d = Math.hypot(mp.c - u.cell.c, mp.r - u.cell.r);
          if (d > TUNING.miniBossRadius) continue;
          if (kind === 'frost') u.slowT = Math.max(u.slowT, TUNING.slowDur);
          else if (kind === 'blight') u.weakenT = Math.max(u.weakenT, TUNING.weakenDur);
          else u.knockdownT = Math.max(u.knockdownT, TUNING.knockdownDur);
          affected++;
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

  private applyDebuff(u: PlacedUnit, skill: MonsterSkill): void {
    if (skill === 'stun') u.stunT = Math.max(u.stunT, TUNING.stunDur);
    else if (skill === 'slow') u.slowT = Math.max(u.slowT, TUNING.slowDur);
    else if (skill === 'weaken') u.weakenT = Math.max(u.weakenT, TUNING.weakenDur);
    else if (skill === 'webbind') u.rangeCutT = Math.max(u.rangeCutT, TUNING.webbindDur);
    else {
      const _exhaustive: never = skill;
      void _exhaustive;
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
        // 推回前在每只妖怪处爆冲击环，让"推"看得见
        for (const m of this.monsters) { const p = posAtDistance(this.map, m.dist); this.bursts.push({ kind: 'hit', c: p.c, r: p.r, ttl: 0.35, maxTtl: 0.35, big: false, color: '#8fd3ff' }); }
        this.pushMonstersToStart();
        this.message = '如来神掌！妖怪被推回起点';
        this.emit('palm');
        break;
      case 'meteor':
        this.doMeteor();
        this.message = '天降陨石！';
        this.emit('ult');
        break;
      case 'atkBuff':
        this.atkBuffT = 5; this.atkBuffMul = 1.5;
        for (const u of this.units.values()) this.bursts.push({ kind: 'merge', c: u.cell.c, r: u.cell.r, ttl: 0.45, maxTtl: 0.45, big: false, color: '#ff7a3c' }); // 己方单位泛红光
        this.message = '仙丹！全体攻击提升';
        this.emit('item');
        break;
      case 'frqBuff':
        this.frqBuffT = 5; this.frqBuffMul = 1.4;
        for (const u of this.units.values()) this.bursts.push({ kind: 'merge', c: u.cell.c, r: u.cell.r, ttl: 0.45, maxTtl: 0.45, big: false, color: '#ffd76a' }); // 己方单位泛金光
        this.message = '风火轮！全体攻速提升';
        this.emit('item');
        break;
      case 'freeze':
        for (const m of this.monsters) { m.stunT = Math.max(m.stunT, 2); const p = posAtDistance(this.map, m.dist); this.bursts.push({ kind: 'hit', c: p.c, r: p.r, ttl: 0.5, maxTtl: 0.5, big: false, color: '#9fe8ff' }); } // 每只妖怪冰霜爆
        this.message = '冰封定身！';
        this.emit('item');
        break;
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
    // 伤害以"当前波基础怪血 × 系数"封顶，保证不喧宾夺主，不改动武将基础数值
    const dmg = (TUNING.monsterHpBase + TUNING.monsterHpStep * this.wave) * this.difficultyMul * TUNING.aiClearDmgMul;
    for (const m of this.monsters) {
      const p = posAtDistance(this.map, m.dist);
      if (Math.hypot(p.c - center.c, p.r - center.r) <= TUNING.aiClearRadius) {
        m.hp -= dmg;
        m.hitFlash = 0.15;
      }
    }
    this.ultFlash = 0.6;
    this.ultCenter = center;
    this.bursts.push({ kind: 'death', c: center.c, r: center.r, ttl: 0.6, maxTtl: 0.6, big: true, color: '#ffdb4d' });
    this.message = '紧箍咒！金光横扫';
  }

  private updateMonsters(dt: number): void {
    const survivors: Monster[] = [];
    for (const m of this.monsters) {
      m.spawnT += dt;
      if (m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt);
      if (m.hp <= 0) {
        const isElite = !m.isBoss && !m.isMiniBoss && m.skill !== null; // 精英=非BOSS/非小Boss但带词条
        const base = m.isBoss
          ? PEACH_PER_BOSS
          : m.isMiniBoss
            ? PEACH_PER_MINI_BOSS
            : isElite
              ? PEACH_PER_ELITE
              : PEACH_PER_KILL;
        const amount = base + this.mods.killBonus; // 击杀产蟠桃（普通1 / 精英5 / 小Boss10 / 大Boss20，+道具）
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
      } else {
        const mudMul = this.mods.mud && m.dist - this.entranceDist < 3 ? 0.82 : 1; // 淤泥：出怪口附近减速
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
    for (const d of this.digFx) d.t += dt;
    this.digFx = this.digFx.filter((d) => d.t < DIG_DUR);
    for (const d of this.aiDigFx) d.t += dt;
    this.aiDigFx = this.aiDigFx.filter((d) => d.t < DIG_DUR);
    this.updatePendingPlace(); // 开格动画结束后落下预占的兵/字牌
    if (this.summonFlash > 0) this.summonFlash = Math.max(0, this.summonFlash - dt * 2);
    if (this.summonAnimT < 2) this.summonAnimT += dt;
    if (this.ultFlash > 0) this.ultFlash = Math.max(0, this.ultFlash - dt); // 绝招特效衰减(在所有状态下都推进，避免波间卡住)
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
    this.updateUnits(dt);
    if (this.meteorPending && this.monsters.length >= 3) { this.meteorPending = false; this.castMeteor(); }
    this.updateMonsterSkills(dt);
    this.updateGenerals(dt);
    this.updateActives(dt);
    this.updateMonsters(dt);
    this.updateAi(dt);
    this.updateFx(dt);
    if (this.checkOpponentDefeated()) return; // 对手先阵亡 → 我方胜

    // 波次清空判定（仅在仍在进行中时；避免覆盖同帧发生的 lost）
    if (this.status === 'playing' && this.waveActive && this.spawnRemaining === 0 && this.monsters.length === 0) {
      this.waveActive = false;
      if (!this.endless && this.wave >= TUNING.winWave) {
        this.rollWeaponDropOnClear();
        this.status = 'won';
        this.emit('win');
        this.message = `守护成功！通关第 ${this.wave} 波，取得真经！`;
      } else {
        this.rollWeaponDropOnClear();
        this.status = 'ready';
        this.nextWaveTimer = 5; // 5秒后自动开下一波
        this.message = `第 ${this.wave} 波已清！`;
      }
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
      tray: () => this.tray,
      freeCells: () => this.unlockedCells().filter((c) => this.cellFree(c.c, c.r)),
      diggableCells: () => this.lockedCells().filter((c) => !this.trees.has(cellKey(c.c, c.r))),
      placedUnits: () => [...this.units.values()].map((u) => ({ type: u.type, tier: u.tier, cell: u.cell })),
      placedWords: () => [...this.words.values()].map((w) => ({ char: w.char, general: w.general, cell: w.cell, tier: w.tier })),
      nearestPathDist: (cell) => this.nearestPathDist(cell),
      pathTouchSides: (cell) => this.pathTouchSidesOf(this.map.path, cell),
      exitDist: (cell) => this.distToPathEntrance(this.map.path, cell),
      tangsengDist: (cell) => Math.hypot(cell.c - this.map.tangseng.c, cell.r - this.map.tangseng.r),
      pathCover: (cell, type, tier) =>
        pathCoverageLen(this.map, this.entranceDist, this.pathLen, cell.c, cell.r, getUnitStat(type, tier).rge),
      pathCoverAt: (ax, ay, rge) =>
        pathCoverageLen(this.map, this.entranceDist, this.pathLen, ax, ay, rge),
      generalRge: (general, tier) => {
        const def = generalById(general);
        if (!def) return 2;
        const wb = this.weaponBonuses[def.id];
        return generalStat(def, tier).rge * (1 + (wb?.rge ?? 0));
      },
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
      isActiveHeroCell: (cell) =>
        this.activeGenerals().some((g) => g.cells.some((c) => c.c === cell.c && c.r === cell.r)),
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
    planAutoPlace(this.buildPlayerAutoView(), { rng: () => this.rng.next(), pSubOptimal: 0 });
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
      drops: this.droppedWeapons.length,
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
    case 'monkey': return '#ff9a3c';
    case 'spear': return '#5bd1ff';
    case 'cavalry': return '#7dff8a';
    case 'archer': return '#c79bff';
  }
}

export { COLS, ROWS, isPathCell };
