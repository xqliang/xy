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
  TANGSENG_INITIAL_HP,
  monstersInWave,
  monsterPOW,
} from '@core';
import type { UnitType } from '@core';
import { RNG } from './rng';
import { generalById, generalStat, qualityName, qualityColor, WORD_POOL, BOND_GENERAL, BOND_ATK_BONUS, type GeneralDef } from './generals';
import { rollWeaponDrop, type WeaponBonuses } from './weapons';
import { drawSummonTray } from './summon-draw';
import {
  COLS,
  ROWS,
  FENCE_ROW,
  pathTotalLen,
  posAtDistance,
  posAlong,
  lenOf,
  entranceDistance,
  mirrorPath,
  mirrorCell,
  slotUnlockOrder,
  placeableCells,
  placeableByProximity,
  isPathCell,
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
  bossEveryWave: 5, // 每 5 波出一个 BOSS
  bossHpMul: 7,
  spawnInterval: 1.25, // 秒/只（出怪节奏；更舒缓）
  summonCostStart: 12, // 首次征兵成本（对齐原作"征兵"量级）
  summonCostStep: 2, // 每次征兵后 +2（抽卡成本递增）
  summonDraws: 5, // 每次征兵产出 5 个候选（放入候选区）
  shovelDrawChance: 0.16, // 候选中出现铲子的概率
  wordDrawChance: 0.14, // 候选中出现武将字牌的概率（凑双字召唤武将）
  summonMaxPerKey: 3, // 单次征兵同 key（兵种/铲）上限
  traySize: 5, // 候选区容量
  initialShovels: 2, // 开局赠送铲子数
  initialOpenSlots: 6, // 初始 6 个阵位（照搬原作初始6格）
  winWave: 8, // 通关波次（切片演示）
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
  // —— 英雄绝招（定期蓄力释放的大范围爆发，独立于武将基础数值，伤害有上限）——
  ultChargeTime: 20, // 从空到满的蓄力秒数（手动释放；调长以降低清场频率）
  ultRadius: 2.5, // 绝招作用半径（格）
  ultDmgMul: 2.6, // 绝招伤害 = 当前波基础怪血 × 该系数（清扫一片小怪）
  // 命中判定宽容量：基础 rge 为欧氏距离，斜向相邻格中心≈1.414，若不放宽则 rge=1 的
  // 近战(棍猴)几乎无法命中相邻怪。加 0.5 格宽容使近战可覆盖相邻格(含斜角)。基础 rge 展示不变。
  rangeTolerance: 0.5,
  // AI 对手每波部署的新单位数(基数 + 波次×系数)，使 AI 战力与玩家大致对称(伪竞技公平性)
  aiDeployBase: 8,
  aiDeployPerWave: 1.5,
};

// 怪物技能：对附近武将施加的减益类型
export type MonsterSkill = 'stun' | 'slow' | 'weaken';
export const SKILL_META: Record<MonsterSkill, { name: string; color: string; icon: string }> = {
  stun: { name: '定身', color: '#ffd34d', icon: '💫' },
  slow: { name: '迟滞', color: '#5bd1ff', icon: '🐌' },
  weaken: { name: '弱身', color: '#c77dff', icon: '⬇' },
};

// 候选区令牌：兵种 / 铲子 / 武将字牌（字牌带阶数，可同字同阶合并升阶）
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
}

// 棋盘上的单个武将字牌（占一格，带阶数；同字同阶可合并升阶）
export interface PlacedWord {
  char: string;
  general: string; // 所属武将 id
  tier: number;
  cell: Cell;
}

// 武将的持续状态（按武将 id 记录，拆分再重组可延续等级/经验）
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
  hitFlash: number; // 受击闪白(秒)
  skill: MonsterSkill | null; // 精英/BOSS 携带的减益技能（普通妖为 null）
  skillCd: number; // 距下次施法的秒数
  castFlash: number; // 施法闪光(1→0)，用于渲染
  spawnT: number; // 出生后经过秒数（用于"由小变大崩出"入场缩放）
  stunT: number; // 被武将定身剩余(秒)：>0 时不前进
  slowT: number; // 被武将减速剩余(秒)：>0 时移速降低
}

export interface HitFx {
  from: { c: number; r: number };
  to: { c: number; r: number };
  ttl: number;
  maxTtl: number;
  color: string;
  wtype?: UnitType; // 攻击来源兵种，用于区分弹道动画（棍/枪/骑/弓）
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

// —— 日重置道具（波间 3 选 1，肉鸽 Build）——
// 携带上限对齐竞品：主动最多 2 个、被动最多 6 个。
export const MAX_ACTIVE_ITEMS = 2;
export const MAX_PASSIVE_ITEMS = 6;
export type ItemKind = '主动' | '被动';
export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  desc: string;
}
export const ITEMS: ItemDef[] = [
  // 主动（最多 2）
  { id: 'xiandan', name: '仙丹', kind: '主动', desc: '全体攻击 +15%' },
  { id: 'fenghuolun', name: '风火轮符', kind: '主动', desc: '全体攻速 +20%（对应攻速符）' },
  { id: 'fabaofu', name: '法宝符', kind: '主动', desc: '所有武将等级 +1（对应神兵符）' },
  { id: 'jifeng', name: '疾风咒', kind: '主动', desc: '敌我双方全体攻速 +25%（双刃道具）' },
  // 被动（最多 6）
  { id: 'pantaoyuan', name: '蟠桃园', kind: '被动', desc: '每 8 秒自动产 1 蟠桃（对应农民）' },
  { id: 'zhaoxian', name: '招贤榜', kind: '被动', desc: '武将字牌掉率 +10%' },
  { id: 'mojin', name: '摸金校尉', kind: '被动', desc: '每次用铲子额外 +6 蟠桃' },
  { id: 'luoyangchan', name: '洛阳铲', kind: '被动', desc: '每 45 秒自动获得 1 把铲子' },
  { id: 'yunshi', name: '陨石', kind: '被动', desc: '每波开始砸向最前妖怪（容错保险）' },
  { id: 'yuni', name: '淤泥', kind: '被动', desc: '出怪口附近妖怪移速 -18%' },
  { id: 'tongxin', name: '同心咒', kind: '被动', desc: '敌我双方唐僧生命各 +1（双刃道具）' },
  { id: 'xianyuan', name: '仙缘幡', kind: '被动', desc: '召唤成本 -1' },
  { id: 'jubaopen', name: '聚宝盆', kind: '被动', desc: '击杀额外 +1 蟠桃' },
  { id: 'hushen', name: '护身金光', kind: '被动', desc: '唐僧 +1 血' },
  { id: 'zhuwang', name: '绊妖蛛网', kind: '被动', desc: '妖怪移速 -12%' },
  { id: 'dinghai', name: '自动定海针', kind: '被动', desc: '立即开辟 1 阵位' },
];
export function itemById(id: string): ItemDef | undefined {
  return ITEMS.find((x) => x.id === id);
}

interface Modifiers {
  atkMul: number;
  frqMul: number;
  killBonus: number;
  monsterSpdMul: number;
  summonCostDelta: number;
  wordRateBonus: number; // 招贤榜：字牌掉率加成
  shovelPeach: number; // 摸金校尉：每次开挖额外蟠桃
  peachFarm: boolean; // 蟠桃园：定期产桃
  autoShovel: boolean; // 洛阳铲：定期产铲
  meteor: boolean; // 陨石：每波开始砸最前妖怪
  mud: boolean; // 淤泥：出怪口附近减速
}

// 局外「功德商店」买断的永久加成，开局注入本局（数值温和有上限，避免破坏塔 DPS 平衡）
export interface MetaBonuses {
  bonusPeach: number; // 初始蟠桃 +
  bonusHp: number; // 唐僧初始血 +
  bonusSlots: number; // 额外初始阵位 +
  atkPct: number; // 全体攻击 +（加到 atkMul）
  frqPct: number; // 全体攻速 +（加到 frqMul）
  ultChargeMul: number; // 绝招蓄力时间倍率（<1 更快）
}
export const NO_META: MetaBonuses = { bonusPeach: 0, bonusHp: 0, bonusSlots: 0, atkPct: 0, frqPct: 0, ultChargeMul: 1 };

const cellKey = (c: number, r: number) => `${c},${r}`;

export class Battle {
  peach = INITIAL_PEACH;
  tangsengHP = TANGSENG_INITIAL_HP;
  wave = 0;
  status: Status = 'ready';
  summonCost = TUNING.summonCostStart;
  summonCount = 0;

  units = new Map<string, PlacedUnit>();
  words = new Map<string, PlacedWord>(); // 棋盘上的武将字牌（各占一格）
  generalStates = new Map<string, GeneralState>(); // 各武将的等级/经验/冷却（按 id）
  monsters: Monster[] = [];
  fx: HitFx[] = [];
  bursts: Burst[] = []; // 命中/击杀/合成爆发特效
  summonFlash = 0; // 征兵闪光(1→0)
  summonAnimT = 999; // 距上次征兵的秒数（用于候选令牌逐个"飞入槽位"的入场动画）
  sfxEvents: string[] = []; // 引擎发出的音效事件名，由音频层每帧取走播放（保持引擎与DOM解耦）
  private emit(name: string): void { if (this.sfxEvents.length < 32) this.sfxEvents.push(name); }
  palmUsedThisWave = false; // 如来神掌每波限用一次
  healUsedThisWave = false; // 观音甘露每波限回一次
  tangsengMaxHP = TANGSENG_INITIAL_HP; // 唐僧血量上限（受功德/道具提升）

  // —— 英雄绝招 ——
  heroKey = 'hero-wukong'; // 出战英雄（默认齐天大圣，后续可从菜单选择）
  heroEnergy = 0; // 绝招能量 0..1
  ultFlash = 0; // 绝招释放特效计时(秒)
  ultCenter: { c: number; r: number } | null = null; // 绝招爆心（渲染用）
  ultCount = 0; // 本局绝招释放次数
  ultChargeMul = 1; // 绝招蓄力时间倍率（功德商店可降低）
  aiHeroEnergy = 0; // AI 英雄绝招能量（对称：AI 也有英雄定期清场，维持伪竞技公平）
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

  // 道具与修正器
  mods: Modifiers = { atkMul: 1, frqMul: 1, killBonus: 0, monsterSpdMul: 1, summonCostDelta: 0, wordRateBonus: 0, shovelPeach: 0, peachFarm: false, autoShovel: false, meteor: false, mud: false };
  private farmTimer = 0; // 蟠桃园产桃计时
  private shovelTimer = 0; // 洛阳铲产铲计时
  private meteorPending = false; // 本波陨石是否待触发
  weaponBonuses: WeaponBonuses = {}; // 已装备神兵给各武将的加成
  droppedWeapons: string[] = []; // 本局掉落的神兵（结算时入背包）
  pickedItems: string[] = [];
  pendingShop: string[] | null = null; // 非空时：胜利后 3 选 1，待玩家选择

  private rng: RNG;
  readonly map: GameMap;
  readonly pathLen: number;
  private slotOrder: Cell[];
  private spawnRemaining = 0;
  private spawnTimer = 0;
  private nextMonsterId = 1;
  private waveActive = false;
  readonly difficultyMul: number; // 由境界决定的怪物强度系数
  message = '点「征兵」抽兵到候选区，拖到绿格布阵';

  constructor(seed = 1, difficultyMul = 1, map: GameMap = MAPS[0]!, meta: MetaBonuses = NO_META, weapons: WeaponBonuses = {}) {
    this.weaponBonuses = weapons;
    this.rng = new RNG(seed);
    this.difficultyMul = difficultyMul;
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
    this.ultChargeMul = meta.ultChargeMul;
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

  // 该格是否为可摆放格（玩家半场、非路径、在网格内且解锁）
  private isPlaceable(c: number, r: number): boolean {
    return !isPathCell(this.map, c, r) && c >= 0 && c < COLS && r >= FENCE_ROW && r < ROWS;
  }

  unlockedCells(): Cell[] {
    return this.slotOrder.filter((s) => this.unlocked.has(cellKey(s.c, s.r)));
  }

  // 尚未解锁的可摆放格（供铲子开挖，按贴路顺序）
  lockedCells(): Cell[] {
    return this.slotOrder.filter((s) => !this.unlocked.has(cellKey(s.c, s.r)));
  }

  // 征兵：消耗蟠桃随机产出候选（兵种/铲子/武将字牌）。成本递增。
  // 兵/铲的分布走受约束的 drawSummonTray（同 key 上限 + 首次保底≥4兵）；
  // 「字牌/已凑齐武将」属收集品，跨次征兵保留累积；非首次征兵按掉率把部分兵槽转为字牌。
  summon(): boolean {
    if (this.status === 'won' || this.status === 'lost') return false;
    const keep = this.tray.filter((t) => t.kind === 'word');
    if (keep.length >= TUNING.traySize) {
      this.message = '字牌已满：请先凑成武将或让武将上场';
      return false;
    }
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
    // 保留字牌/武将（收集品），清掉残余兵与铲；新抽只填满剩余槽位
    const avail = Math.max(0, TUNING.traySize - keep.length);
    const types = Object.keys(UNITS) as UnitType[];
    const firstSummon = this.summonCount === 0;
    // 兵/铲分布：受约束（同 key ≤ summonMaxPerKey，首次保底≥4兵）
    const base = drawSummonTray({
      rng: this.rng,
      unitTypes: types,
      draws: avail,
      shovelChance: TUNING.shovelDrawChance,
      maxPerKey: TUNING.summonMaxPerKey,
      firstSummon,
    });
    this.summonCount += 1;
    // 非首次征兵：按字牌掉率把部分「兵」槽转成武将字牌（首次保底不转，维持≥4兵）
    const draws: TrayToken[] = base.map((tok) => {
      if (tok.kind === 'unit' && !firstSummon && this.rng.next() < TUNING.wordDrawChance + this.mods.wordRateBonus) {
        const w = this.rng.pick(WORD_POOL);
        return { kind: 'word', char: w.char, general: w.general, tier: 1 };
      }
      return tok;
    });
    this.tray = [...keep, ...draws];
    this.message = '把兵拖到绿格；两个同将字牌可凑成武将（占两格）';
    return true;
  }

  // 某格是否有字牌
  private wordAt(c: number, r: number): PlacedWord | undefined {
    return this.words.get(cellKey(c, r));
  }

  // 该格是否空闲（无兵、无字牌）
  private cellFree(c: number, r: number): boolean {
    return !this.units.has(cellKey(c, r)) && !this.words.has(cellKey(c, r));
  }

  // 计入道具修正后的当前征兵成本
  effectiveSummonCost(): number {
    return Math.max(1, this.summonCost + this.mods.summonCostDelta);
  }

  // 候选区内合并：兵种同型同级升阶；字牌同字同阶升阶。
  mergeTrayTokens(from: number, to: number): boolean {
    if (from === to) return false;
    const a = this.tray[from];
    const b = this.tray[to];
    if (!a || !b) return false;
    if (a.kind === 'word' && b.kind === 'word') {
      if (a.char !== b.char || a.tier !== b.tier || b.tier >= MAX_TIER) {
        this.message = '字牌需同字同阶才能升阶';
        return false;
      }
      this.tray[to] = { kind: 'word', char: b.char, general: b.general, tier: b.tier + 1 };
      this.tray.splice(from, 1);
      this.message = `字牌「${b.char}」升为 ${b.tier + 1} 阶`;
      this.emit('merge');
      return true;
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

  // 扫描棋盘：左右紧邻且同将的两个不同字 → 激活武将（中间有空格/别的兵则不生效）
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
      if (right.general !== w.general || right.char === w.char) continue;
      const def = generalById(w.general);
      if (!def) continue;
      used.add(kL);
      used.add(kR);
      out.push({
        def,
        tier: Math.min(w.tier, right.tier), // 以较弱的字为准
        cells: [w.cell, right.cell],
        state: this.stateOf(def.id),
      });
    }
    return out;
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
      this.unlocked.add(cellKey(to.c, to.r));
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
    // 字牌：占一格落在棋盘上；同字同阶则升阶。与同将另一个字左右紧邻即自动激活武将。
    if (token.kind === 'word') {
      const exist = this.wordAt(to.c, to.r);
      if (exist) {
        if (exist.char === token.char && exist.tier === token.tier && exist.tier < MAX_TIER) {
          exist.tier += 1;
          this.bursts.push({ kind: 'merge', c: to.c, r: to.r, ttl: 0.35, maxTtl: 0.35, big: false, color: qualityColor(exist.tier) });
          this.tray.splice(index, 1);
          this.message = `字牌「${exist.char}」升为 ${exist.tier} 阶`;
          return true;
        }
        // 不同字 → 与该格字牌交换
        this.words.set(cellKey(to.c, to.r), { char: token.char, general: token.general, tier: token.tier, cell: { c: to.c, r: to.r } });
        this.tray[index] = { kind: 'word', char: exist.char, general: exist.general, tier: exist.tier };
        return true;
      }
      if (this.units.has(cellKey(to.c, to.r))) {
        this.message = '该格已有兵，请放到空格';
        return false;
      }
      this.words.set(cellKey(to.c, to.r), { char: token.char, general: token.general, tier: token.tier, cell: { c: to.c, r: to.r } });
      this.tray.splice(index, 1);
      const def = generalById(token.general);
      const active = this.activeGenerals().some((g) => g.def.id === token.general);
      this.emit(active ? 'general' : 'place');
      this.message = active ? `${def?.name ?? ''} 已激活！(金框生效)` : `放下「${token.char}」，与「${def?.chars.find((c) => c !== token.char)}」左右相邻可激活`;
      return true;
    }
    // 该格被字牌占用则不可放兵
    if (this.words.has(cellKey(to.c, to.r))) {
      this.message = '该格已有武将字牌';
      return false;
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
      this.units.set(cellKey(to.c, to.r), { type: token.type, tier: token.tier, cell: { c: to.c, r: to.r }, cooldown: 0, firePulse: 0, combo: 0, stunT: 0, slowT: 0, weakenT: 0 });
      this.tray[index] = { kind: 'unit', type: exist.type, tier: exist.tier };
      this.message = `与 ${UNITS[exist.type].name} 交换`;
      return true;
    }
    this.units.set(cellKey(to.c, to.r), { type: token.type, tier: token.tier, cell: { c: to.c, r: to.r }, cooldown: 0, firePulse: 0, combo: 0, stunT: 0, slowT: 0, weakenT: 0 });
    this.tray.splice(index, 1);
    this.message = `布置了 ${UNITS[token.type].name}`;
    this.emit('place');
    return true;
  }

  // 直接用铲子（不经候选区，供 UI 便捷开挖最靠前锁定格）
  useShovelOn(to: Cell): boolean {
    if (this.shovels <= 0) return false;
    if (this.isUnlocked(to.c, to.r) || !this.isPlaceable(to.c, to.r)) return false;
    this.shovels -= 1;
    this.unlocked.add(cellKey(to.c, to.r));
    this.peach += this.mods.shovelPeach; // 摸金校尉
    this.message = '铲子挖开了新阵位';
    return true;
  }

  // 棋盘内拖拽总入口：源格是字牌走 dragWord，否则走 dragUnit
  dragBoard(from: Cell, to: Cell): boolean {
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
    const tw = this.words.get(kTo);
    const tu = this.units.get(kTo);
    if (tw) {
      if (tw.char === w.char && tw.tier === w.tier && tw.tier < MAX_TIER) {
        tw.tier += 1; // 同字同阶 → 升阶
        this.words.delete(kFrom);
        this.bursts.push({ kind: 'merge', c: to.c, r: to.r, ttl: 0.35, maxTtl: 0.35, big: false, color: qualityColor(tw.tier) });
        this.message = `字牌「${tw.char}」升为 ${tw.tier} 阶`;
        return true;
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
      this.units.set(cellKey(to.c, to.r), { ...a, cell: { c: to.c, r: to.r }, cooldown: 0 });
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
      this.units.set(cellKey(from.c, from.r), { ...b, cell: { c: from.c, r: from.r }, cooldown: 0 });
      this.units.set(cellKey(to.c, to.r), { ...a, cell: { c: to.c, r: to.r }, cooldown: 0 });
      this.message = '交换了两个单位位置';
      return true;
    }
    // 移动到空格
    this.units.delete(cellKey(from.c, from.r));
    a.cell = { c: to.c, r: to.r };
    this.units.set(cellKey(to.c, to.r), a);
    return true;
  }

  // 开始下一波
  startNextWave(): boolean {
    if (this.waveActive) return false;
    if (this.status === 'won' || this.status === 'lost') return false;
    if (this.pendingShop) {
      this.message = '请先选择一件道具';
      return false;
    }
    this.introDone = true; // 手动开波则跳过入场
    this.introT = Battle.INTRO_DUR;
    this.wave += 1;
    this.aiDeploy(); // AI 同步部署本波防御
    this.status = 'playing';
    this.waveActive = true;
    this.palmUsedThisWave = false;
    this.healUsedThisWave = false;
    this.spawnRemaining = monstersInWave(this.wave); // 9 + n
    this.spawnTimer = 0;
    this.meteorPending = this.mods.meteor; // 本波陨石待触发（等首批怪出现）
    this.message = `第 ${this.wave} 波来袭`;
    this.emit('wave');
    return true;
  }

  // 唐僧当前渲染位置（入场时沿路走向归位；归位后固定在终点格）
  tangsengRenderPos(): { c: number; r: number } {
    if (this.introDone) return posAtDistance(this.map, this.pathLen);
    const p = Math.min(1, this.introT / Battle.INTRO_DUR);
    return posAtDistance(this.map, p * this.pathLen);
  }

  // 如来神掌是否可用（对战中且本波未用过）
  palmAvailable(): boolean {
    return this.status === 'playing' && !this.palmUsedThisWave && this.monsters.length > 0;
  }

  // 如来神掌：把场上所有妖怪推回起点（原作"退兵盾牌兵"广告点，绝境救命）。每波限一次。
  usePalm(): boolean {
    if (this.status !== 'playing' || this.palmUsedThisWave) return false;
    for (const m of this.monsters) m.dist = 0;
    this.palmUsedThisWave = true;
    this.emit('palm');
    this.message = '如来神掌！妖怪被推回起点';
    return true;
  }

  // 已携带的主动/被动道具数
  itemCount(kind: ItemKind): number {
    return this.pickedItems.filter((id) => itemById(id)?.kind === kind).length;
  }
  // 是否还能再携带该道具（受主动2/被动6上限限制）
  canCarry(id: string): boolean {
    const def = itemById(id);
    if (!def) return false;
    const cap = def.kind === '主动' ? MAX_ACTIVE_ITEMS : MAX_PASSIVE_ITEMS;
    return this.itemCount(def.kind) < cap;
  }

  // 从当前商店 3 选 1（index 0..2）
  chooseItem(index: number): boolean {
    if (!this.pendingShop) return false;
    const id = this.pendingShop[index];
    if (!id) return false;
    const def = itemById(id);
    if (!this.canCarry(id)) {
      this.message = `${def?.kind}道具已满（主动${MAX_ACTIVE_ITEMS}/被动${MAX_PASSIVE_ITEMS}），请换一件`;
      return false;
    }
    this.applyItem(id);
    this.pickedItems.push(id);
    this.pendingShop = null;
    this.message = `获得道具：${def?.name ?? id}`;
    this.emit('item');
    return true;
  }

  private applyItem(id: string): void {
    switch (id) {
      case 'xiandan': this.mods.atkMul += 0.15; break;
      case 'fenghuolun': this.mods.frqMul += 0.2; break;
      // 法宝符：所有武将等级 +1（对应神兵符）
      case 'fabaofu': {
        for (const g of this.activeGenerals()) {
          g.state.level = Math.min(Battle.GENERAL_MAX_LEVEL, g.state.level + 1);
        }
        break;
      }
      case 'pantaoyuan': this.mods.peachFarm = true; break;
      case 'zhaoxian': this.mods.wordRateBonus += 0.1; break;
      case 'mojin': this.mods.shovelPeach += 6; break;
      case 'luoyangchan': this.mods.autoShovel = true; break;
      case 'yunshi': this.mods.meteor = true; break;
      case 'yuni': this.mods.mud = true; break;
      case 'xianyuan': this.mods.summonCostDelta -= 1; break;
      case 'jubaopen': this.mods.killBonus += 1; break;
      case 'hushen': this.tangsengMaxHP += 1; this.tangsengHP += 1; break;
      // 双刃道具：同时作用于敌我双方（照搬原作「双向影响」设计）
      case 'jifeng': this.mods.frqMul += 0.25; this.aiFrqMul += 0.25; break;
      case 'tongxin': this.tangsengMaxHP += 1; this.tangsengHP += 1; this.aiTangsengHP += 1; break;
      case 'zhuwang': this.mods.monsterSpdMul = Math.max(0.4, this.mods.monsterSpdMul - 0.12); break;
      case 'dinghai': { const lc = this.lockedCells(); if (lc[0]) this.unlocked.add(cellKey(lc[0].c, lc[0].r)); break; }
    }
  }

  // 被动道具的持续效果：蟠桃园产桃 / 洛阳铲产铲
  private updateItemEffects(dt: number): void {
    if (this.mods.peachFarm) {
      this.farmTimer += dt;
      if (this.farmTimer >= 8) { this.farmTimer = 0; this.peach += 1; }
    }
    if (this.mods.autoShovel) {
      this.shovelTimer += dt;
      if (this.shovelTimer >= 45) { this.shovelTimer = 0; this.shovels += 1; }
    }
  }

  // 陨石：每波开始时砸向最前妖怪（容错保险）
  private castMeteor(): void {
    if (!this.mods.meteor || this.monsters.length === 0) return;
    let front = this.monsters[0]!;
    for (const m of this.monsters) if (m.dist > front.dist) front = m;
    const dmg = (TUNING.monsterHpBase + TUNING.monsterHpStep * this.wave) * this.difficultyMul * 3;
    const p = posAtDistance(this.map, front.dist);
    for (const m of this.monsters) {
      const q = posAtDistance(this.map, m.dist);
      if (Math.hypot(q.c - p.c, q.r - p.r) <= 1.6) { m.hp -= dmg; m.hitFlash = 0.2; }
    }
    this.bursts.push({ kind: 'death', c: p.c, r: p.r, ttl: 0.5, maxTtl: 0.5, big: true, color: '#ff7a3c' });
  }

  // 清波掉落神兵：基础 35%，BOSS 波必掉（对应竞品"对局随机掉落"）
  private rollWeaponDropOnClear(): void {
    const isBossWave = this.wave % TUNING.bossEveryWave === 0;
    if (!isBossWave && this.rng.next() > 0.35) return;
    const id = rollWeaponDrop(this.rng.next());
    this.droppedWeapons.push(id);
    this.message = `第 ${this.wave} 波已清！掉落神兵`;
  }

  // 胜利后随机开出 3 件道具供选择（只开还能携带的）
  private rollShop(): void {
    const pool = ITEMS.filter((it) => this.canCarry(it.id));
    const picks: string[] = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) {
      const idx = this.rng.int(pool.length);
      picks.push(pool.splice(idx, 1)[0]!.id);
    }
    this.pendingShop = picks.length > 0 ? picks : null;
  }

  private spawnMonster(): void {
    const isBoss =
      this.wave % TUNING.bossEveryWave === 0 && this.spawnRemaining === 1; // 每波最后一只为 BOSS
    let hp = TUNING.monsterHpBase + TUNING.monsterHpStep * this.wave;
    hp *= this.difficultyMul; // 境界越高妖怪越强
    if (isBoss) hp *= TUNING.bossHpMul;
    const skill = this.rollMonsterSkill(isBoss);
    this.monsters.push({
      id: this.nextMonsterId++,
      dist: this.entranceDist, // 从出怪口冒出（而非网格外平移）
      hp,
      maxHp: hp,
      spd: TUNING.monsterSpd * this.mods.monsterSpdMul * (1 + 0.1 * (this.difficultyMul - 1)), // 高境界妖怪更快
      isBoss,
      hitFlash: 0,
      skill,
      skillCd: TUNING.skillFirstDelay,
      castFlash: 0,
      spawnT: 0, stunT: 0, slowT: 0,
    });
    // AI 对手同波同步出怪（镜像路）
    this.aiMonsters.push({
      id: this.nextMonsterId++,
      dist: this.aiEntranceDist, // 从 AI 出怪口冒出
      hp,
      maxHp: hp,
      spd: TUNING.monsterSpd * (1 + 0.1 * (this.difficultyMul - 1)),
      isBoss,
      hitFlash: 0,
      skill,
      skillCd: TUNING.skillFirstDelay,
      castFlash: 0,
      spawnT: 0, stunT: 0, slowT: 0,
    });
    this.spawnGateT = 0.5; // 触发出怪口"开合"动画
    this.aiSpawnGateT = 0.5;
  }

  // 决定怪物携带的技能：BOSS 必带（随机一种），精英按概率带，普通妖无
  private rollMonsterSkill(isBoss: boolean): MonsterSkill | null {
    const pool: MonsterSkill[] = ['stun', 'slow', 'weaken'];
    if (isBoss) return this.rng.pick(pool);
    if (this.wave >= TUNING.eliteFromWave && this.rng.next() < TUNING.eliteChance) {
      return this.rng.pick(pool);
    }
    return null;
  }

  // AI 自动部署：每波在上半场镜像格补兵并合成升阶（模拟一名对手玩家）
  private aiDeploy(): void {
    const types = Object.keys(UNITS) as UnitType[];
    // 本波补若干 1 阶到空的 AI 格（数量随波次与难度增长，逼近玩家战力曲线并跟上高境界怪物）
    let added = 0;
    const target = Math.round((TUNING.aiDeployBase + this.wave * TUNING.aiDeployPerWave) * this.difficultyMul);
    for (const cell of this.aiCells) {
      if (added >= target) break;
      if (this.aiUnits.some((u) => u.cell.c === cell.c && u.cell.r === cell.r)) continue;
      this.aiUnits.push({ type: this.rng.pick(types), tier: 1, cell, cooldown: 0, firePulse: 0, combo: 0, stunT: 0, slowT: 0, weakenT: 0 });
      this.aiUnlocked.add(cellKey(cell.c, cell.r)); // 部署到的格纳入AI可放置区域
      added++;
    }
    // 合成：同型同级两两合并升阶
    for (let pass = 0; pass < 10; pass++) {
      let merged = false;
      for (let i = 0; i < this.aiUnits.length && !merged; i++) {
        for (let j = i + 1; j < this.aiUnits.length; j++) {
          const a = this.aiUnits[i]!;
          const b = this.aiUnits[j]!;
          if (a.type === b.type && a.tier === b.tier && a.tier < MAX_TIER) {
            b.tier += 1;
            b.cooldown = 0;
            this.aiUnits.splice(i, 1);
            merged = true;
            break;
          }
        }
      }
      if (!merged) break;
    }
  }

  // AI 单位攻击 AI 怪（与玩家同一套战斗数值，无道具加成、不产特效）
  private updateAiUnits(dt: number): void {
    for (const u of this.aiUnits) {
      u.cooldown -= dt;
      if (u.cooldown > 0) continue;
      const stat = getUnitStat(u.type, u.tier);
      const base = Math.floor(stat.targets);
      const extra = this.rng.next() < stat.targets - base ? 1 : 0;
      const maxTargets = Math.max(1, base + extra);
      const inRange = this.aiMonsters
        .map((m) => {
          const p = posAlong(this.aiPath, m.dist);
          return { m, d: Math.hypot(p.c - u.cell.c, p.r - u.cell.r) };
        })
        .filter((x) => x.d <= stat.rge + TUNING.rangeTolerance)
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
        this.fx.push({ from: { c: u.cell.c, r: u.cell.r }, to: p, ttl: 0.3 + (u.tier - 1) * 0.04, maxTtl: 0.3 + (u.tier - 1) * 0.04, color, wtype: u.type, tier: u.tier }); // AI 侧也播放攻击特效
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

  // AI 侧推进：单位攻击 + 怪物移动 + 漏怪扣血
  private updateAi(dt: number): void {
    this.updateAiUnits(dt);
    // AI 英雄绝招：随境界增强以跟上高难度怪物(维持对手不被单方碾压)。就绪后带随机时机，仍弱于玩家。
    if (this.aiMonsters.length > 0) {
      this.aiHeroEnergy = Math.min(1, this.aiHeroEnergy + dt / (TUNING.ultChargeTime * 1.4) * this.difficultyMul);
      if (this.aiHeroEnergy >= 1 && this.rng.next() < dt * 0.6) {
        let front = this.aiMonsters[0]!;
        for (const m of this.aiMonsters) if (m.dist > front.dist) front = m;
        const center = posAlong(this.aiPath, front.dist);
        const dmg = (TUNING.monsterHpBase + TUNING.monsterHpStep * this.wave) * this.difficultyMul * TUNING.ultDmgMul * 0.7 * this.difficultyMul;
        for (const m of this.aiMonsters) {
          const p = posAlong(this.aiPath, m.dist);
          if (Math.hypot(p.c - center.c, p.r - center.r) <= TUNING.ultRadius) { m.hp -= dmg; m.hitFlash = 0.15; }
        }
        this.aiHeroEnergy = 0;
      }
    }
    const survivors: Monster[] = [];
    for (const m of this.aiMonsters) {
      m.spawnT += dt;
      if (m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt);
      if (m.hp <= 0) continue;
      m.dist += m.spd * dt;
      if (m.dist >= this.aiPathLen) {
        this.aiTangsengHP -= 1;
        if (this.aiTangsengHP <= 0) {
          this.aiTangsengHP = 0;
          this.aiDefeated = true;
        }
        continue;
      }
      survivors.push(m);
    }
    this.aiMonsters = survivors;
  }

  // 对手唐僧阵亡 → 我方获胜（伪竞技对局的胜利条件之一）
  private checkOpponentDefeated(): boolean {
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
    for (const m of this.monsters) if (this.pathLen - m.dist <= 3) return true;
    return false;
  }
  aiDangerNear(): boolean {
    for (const m of this.aiMonsters) if (this.aiPathLen - m.dist <= 3) return true;
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

  // 单位攻击结算
  private updateUnits(dt: number): void {
    for (const u of this.units.values()) {
      // firePulse/combo 的衰减改在 updateFx（所有状态推进），避免波间冻结导致兵器卡在槽位
      // 减益计时衰减
      if (u.stunT > 0) u.stunT = Math.max(0, u.stunT - dt);
      if (u.slowT > 0) u.slowT = Math.max(0, u.slowT - dt);
      if (u.weakenT > 0) u.weakenT = Math.max(0, u.weakenT - dt);
      if (u.stunT > 0) continue; // 眩晕：本帧无法攻击（冷却也不推进）
      u.cooldown -= dt;
      if (u.cooldown > 0) continue;
      const stat = getUnitStat(u.type, u.tier); // atk/frq/rge/targets（来自 game-core）
      const base = Math.floor(stat.targets);
      const extra = this.rng.next() < stat.targets - base ? 1 : 0;
      const maxTargets = Math.max(1, base + extra);
      const inRange = this.monsters
        .map((m) => {
          const p = posAtDistance(this.map, m.dist);
          const d = Math.hypot(p.c - u.cell.c, p.r - u.cell.r);
          return { m, d, p };
        })
        .filter((x) => x.d <= stat.rge + TUNING.rangeTolerance)
        .sort((a, b) => b.m.dist - a.m.dist); // 优先打最靠前（进度大）的妖怪
      if (inRange.length === 0) continue;
      // 降攻减益：仅临时削弱伤害，不改动基础数值
      const atkMul = this.mods.atkMul * (u.weakenT > 0 ? TUNING.weakenAtkMul : 1);
      const dmg = damage(stat.atk * atkMul); // 道具增伤 + 减益
      const color = this.unitColor(u.type);
      let hitCount = 0;
      for (const target of inRange) {
        if (hitCount >= maxTargets) break;
        target.m.hp -= dmg;
        target.m.hitFlash = 0.12; // 受击闪白
        this.fx.push({ from: { c: u.cell.c, r: u.cell.r }, to: target.p, ttl: 0.3 + (u.tier - 1) * 0.04, maxTtl: 0.3 + (u.tier - 1) * 0.04, color, wtype: u.type, tier: u.tier });
        this.bursts.push({ kind: 'hit', c: target.p.c, r: target.p.r, ttl: 0.22, maxTtl: 0.22, big: false, color });
        hitCount++;
      }
      if (hitCount > 0) {
        // 上次出招还没收完(firePulse 尚高)就再次命中 → 连击累加，用于枪的连刺形变
        u.combo = u.firePulse > 0.35 ? Math.min(9, u.combo + 1) : 0;
        u.firePulse = 1;
        u.fireDir = Math.atan2(inRange[0]!.p.r - u.cell.r, inRange[0]!.p.c - u.cell.c); // 朝最靠前目标形变出招
        this.emit('attack');
      }
      // 攻速修正(道具/功德 frqMul) + 减速减益(拉长间隔)
      u.cooldown = (1 / (stat.frq * this.mods.frqMul)) * (u.slowT > 0 ? TUNING.slowCooldownMul : 1);
    }
  }

  // 羁绊：悟空激活 → 全队攻击加成（对应竞品 赵云+阿斗 羁绊）
  bondActive(): boolean {
    return this.activeGenerals().some((g) => g.def.id === BOND_GENERAL);
  }
  private bondAtkMul(): number {
    return this.bondActive() ? 1 + BOND_ATK_BONUS : 1;
  }

  // 武将局内升级：每级所需经验 = 10 × 当前等级；每级 +8% 攻击（上限 10 级）
  static readonly GENERAL_MAX_LEVEL = 10;
  static expToNext(level: number): number {
    return 10 * level;
  }
  private gainGeneralExp(g: ActiveGeneral, amount: number): void {
    const s = g.state;
    if (s.level >= Battle.GENERAL_MAX_LEVEL) return;
    s.exp += amount;
    while (s.level < Battle.GENERAL_MAX_LEVEL && s.exp >= Battle.expToNext(s.level)) {
      s.exp -= Battle.expToNext(s.level);
      s.level += 1;
      this.bursts.push({ kind: 'merge', c: g.cells[0].c, r: g.cells[0].r, ttl: 0.4, maxTtl: 0.4, big: false, color: '#ffe27a' });
    }
  }
  // 含品质阶与局内等级的武将实际攻击力
  generalAtk(g: ActiveGeneral): number {
    const base = generalStat(g.def, g.tier).atk;
    const wb = this.weaponBonuses[g.def.id];
    return base * (1 + 0.08 * (g.state.level - 1)) * (1 + (wb?.atk ?? 0)) * this.mods.atkMul * this.bondAtkMul();
  }

  // 计入神兵加成的武将攻速/范围
  generalFrq(g: ActiveGeneral): number {
    const wb = this.weaponBonuses[g.def.id];
    return generalStat(g.def, g.tier).frq * (1 + (wb?.frq ?? 0)) * this.mods.frqMul;
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
        .map((m) => {
          const p = posAtDistance(this.map, m.dist);
          return { m, d: Math.hypot(p.c - ax, p.r - ay), p };
        })
        .filter((x) => x.d <= this.generalRge(g) + TUNING.rangeTolerance)
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
        this.fx.push({ from: { c: ax, r: ay }, to: t.p, ttl: 0.16, maxTtl: 0.16, color: qualityColor(g.tier) });
        hit++;
      }
      if (hit > 0) {
        s.firePulse = 1;
        this.gainGeneralExp(g, dmg * hit * 0.05); // 输出转经验
      }
      s.cooldown = 1 / this.generalFrq(g);
    }
  }

  private castGeneralSkill(g: ActiveGeneral, inRange: { m: Monster; d: number; p: { c: number; r: number } }[]): void {
    const atk = this.generalAtk(g);
    g.state.skillFlash = 1;
    const center = inRange[0]!.p;
    switch (g.def.skill) {
      case 'burst': {
        for (const t of inRange) { t.m.hp -= damage(atk * 3); t.m.hitFlash = 0.15; }
        this.bursts.push({ kind: 'death', c: center.c, r: center.r, ttl: 0.45, maxTtl: 0.45, big: true, color: '#ffb03c' });
        break;
      }
      case 'ranged': {
        const t = inRange[0]!;
        t.m.hp -= damage(atk * 5);
        t.m.hitFlash = 0.18;
        this.bursts.push({ kind: 'hit', c: t.p.c, r: t.p.r, ttl: 0.4, maxTtl: 0.4, big: true, color: '#ff6a4a' });
        break;
      }
      case 'stun': {
        for (const t of inRange) t.m.stunT = Math.max(t.m.stunT, 1.8);
        this.bursts.push({ kind: 'hit', c: center.c, r: center.r, ttl: 0.45, maxTtl: 0.45, big: true, color: '#ffd34d' });
        break;
      }
      case 'knock': {
        for (const t of inRange) t.m.dist = Math.max(this.entranceDist, t.m.dist - 2);
        this.bursts.push({ kind: 'hit', c: center.c, r: center.r, ttl: 0.4, maxTtl: 0.4, big: true, color: '#9ad0ff' });
        break;
      }
      case 'slow': {
        for (const t of inRange) t.m.slowT = Math.max(t.m.slowT, 3);
        this.bursts.push({ kind: 'hit', c: center.c, r: center.r, ttl: 0.4, maxTtl: 0.4, big: false, color: '#8ad8ff' });
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
    this.gainGeneralExp(g, 4);
  }

  // 怪物施法：精英/BOSS 进场后定期对半径内武将施加减益（不改动基础数值，仅施加计时器）
  private updateMonsterSkills(dt: number): void {
    for (const m of this.monsters) {
      if (!m.skill || m.hp <= 0) continue;
      m.castFlash = Math.max(0, m.castFlash - dt * 4);
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

  private applyDebuff(u: PlacedUnit, skill: MonsterSkill): void {
    if (skill === 'stun') u.stunT = Math.max(u.stunT, TUNING.stunDur);
    else if (skill === 'slow') u.slowT = Math.max(u.slowT, TUNING.slowDur);
    else if (skill === 'weaken') u.weakenT = Math.max(u.weakenT, TUNING.weakenDur);
  }

  // 英雄绝招：战斗中持续蓄力；满能量后由玩家手动释放（不再自动触发）。
  private updateHero(dt: number): void {
    if (this.status !== 'playing' || this.monsters.length === 0) return;
    this.heroEnergy = Math.min(1, this.heroEnergy + dt / (TUNING.ultChargeTime * this.ultChargeMul));
  }

  // 绝招是否就绪（能量满且对战中有怪可打）
  ultReady(): boolean {
    return this.status === 'playing' && this.heroEnergy >= 1 && this.monsters.length > 0;
  }

  // 距绝招就绪的剩余秒数（用于 CD 倒计时显示）
  ultCooldownRemaining(): number {
    return Math.max(0, (1 - this.heroEnergy) * TUNING.ultChargeTime * this.ultChargeMul);
  }

  // 手动释放绝招：以最靠前妖怪为中心大范围爆发。返回是否成功。
  castUltimate(): boolean {
    if (!this.ultReady()) return false;
    let front = this.monsters[0]!;
    for (const m of this.monsters) if (m.dist > front.dist) front = m;
    const center = posAtDistance(this.map, front.dist);
    // 伤害以"当前波基础怪血 × 系数"封顶，保证不喧宾夺主，不改动武将基础数值
    const dmg = (TUNING.monsterHpBase + TUNING.monsterHpStep * this.wave) * this.difficultyMul * TUNING.ultDmgMul;
    for (const m of this.monsters) {
      const p = posAtDistance(this.map, m.dist);
      if (Math.hypot(p.c - center.c, p.r - center.r) <= TUNING.ultRadius) {
        m.hp -= dmg;
        m.hitFlash = 0.15;
      }
    }
    this.heroEnergy = 0;
    this.ultFlash = 0.6;
    this.ultCenter = center;
    this.ultCount++;
    this.bursts.push({ kind: 'death', c: center.c, r: center.r, ttl: 0.6, maxTtl: 0.6, big: true, color: '#ffdb4d' });
    this.message = '齐天大圣·绝招！金箍棒横扫';
    this.emit('ult');
    return true;
  }

  private updateMonsters(dt: number): void {
    const survivors: Monster[] = [];
    for (const m of this.monsters) {
      m.spawnT += dt;
      if (m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt);
      if (m.hp <= 0) {
        const isElite = !m.isBoss && m.skill !== null; // 精英=非BOSS但带词条(技能)
        this.peach += (m.isBoss ? PEACH_PER_BOSS : PEACH_PER_KILL) + (isElite ? PEACH_PER_ELITE : 0) + this.mods.killBonus; // 击杀产蟠桃(精英额外+10, +道具)
        const dp = posAtDistance(this.map, m.dist);
        this.bursts.push({ kind: 'death', c: dp.c, r: dp.r, ttl: 0.4, maxTtl: 0.4, big: m.isBoss, color: m.isBoss ? '#ff5a8a' : '#c25a5a' });
        this.emit(m.isBoss ? 'bosskill' : 'kill');
        continue;
      }
      // 武将控制：定身期间不前进，减速期间移速减半
      if (m.stunT > 0) {
        m.stunT = Math.max(0, m.stunT - dt);
      } else {
        const mudMul = this.mods.mud && m.dist - this.entranceDist < 3 ? 0.82 : 1; // 淤泥：出怪口附近减速
        m.dist += m.spd * (m.slowT > 0 ? 0.5 : 1) * mudMul * dt;
      }
      if (m.slowT > 0) m.slowT = Math.max(0, m.slowT - dt);
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
    for (const u of this.units.values()) {
      u.firePulse = Math.max(0, u.firePulse - dt * 6);
      if (u.firePulse <= 0.02) u.combo = 0; // 收招完成即清连击
    }
    for (const u of this.aiUnits) {
      u.firePulse = Math.max(0, u.firePulse - dt * 6);
      if (u.firePulse <= 0.02) u.combo = 0;
    }
    for (const bt of this.bursts) bt.ttl -= dt;
    this.bursts = this.bursts.filter((bt) => bt.ttl > 0);
    if (this.summonFlash > 0) this.summonFlash = Math.max(0, this.summonFlash - dt * 2);
    if (this.summonAnimT < 2) this.summonAnimT += dt;
    if (this.ultFlash > 0) this.ultFlash = Math.max(0, this.ultFlash - dt); // 绝招特效衰减(在所有状态下都推进，避免波间卡住)
    if (this.spawnGateT > 0) this.spawnGateT = Math.max(0, this.spawnGateT - dt);
    if (this.aiSpawnGateT > 0) this.aiSpawnGateT = Math.max(0, this.aiSpawnGateT - dt);
    this.updateItemEffects(dt); // 被动道具收益（蟠桃园/洛阳铲）在所有状态下持续
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
    // 生成妖怪
    if (this.spawnRemaining > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnMonster();
        this.spawnRemaining -= 1;
        // 高境界出怪更密集
        this.spawnTimer = Math.max(0.3, TUNING.spawnInterval / (1 + 0.07 * (this.difficultyMul - 1)));
      }
    }
    this.updateUnits(dt);
    if (this.meteorPending && this.monsters.length >= 3) { this.meteorPending = false; this.castMeteor(); }
    this.updateMonsterSkills(dt);
    this.updateGenerals(dt);
    this.updateHero(dt);
    this.updateMonsters(dt);
    this.updateAi(dt);
    this.updateFx(dt);
    if (this.checkOpponentDefeated()) return; // 对手先阵亡 → 我方胜

    // 波次清空判定（仅在仍在进行中时；避免覆盖同帧发生的 lost）
    if (this.status === 'playing' && this.waveActive && this.spawnRemaining === 0 && this.monsters.length === 0) {
      this.waveActive = false;
      if (this.wave >= TUNING.winWave) {
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

  // 一键布阵：把候选区令牌自动落位（铲子挖最靠前锁定格；兵种优先合成同型同级，否则放空格）。
  // 供"一键布阵"便捷按钮与自动化自测使用。
  autoPlaceTray(): void {
    let guard = 0;
    while (this.tray.length > 0 && guard++ < 200) {
      const idx = this.tray.findIndex((t) => t.kind === 'shovel');
      if (idx >= 0) {
        const locked = this.lockedCells();
        if (locked.length > 0) {
          this.placeFromTray(idx, locked[0]!);
          continue;
        }
        this.tray.splice(idx, 1); // 无处可挖则弃置
        continue;
      }
      const token = this.tray[0]!;
      // 字牌：优先放到能与同将另一个字左右相邻的格（直接激活武将）；否则放任意空格
      if (token.kind === 'word') {
        const mate = [...this.words.values()].find((w) => w.general === token.general && w.char !== token.char);
        const cells = this.unlockedCells().filter((c) => this.cellFree(c.c, c.r));
        let target = mate
          ? cells.find((c) => c.r === mate.cell.r && (c.c === mate.cell.c + 1 || c.c === mate.cell.c - 1))
          : undefined;
        target ??= cells[0];
        if (target && this.placeFromTray(0, target)) continue;
        this.tray.splice(0, 1); // 无空格可放则弃置
        continue;
      }
      if (token.kind !== 'unit') { this.tray.splice(0, 1); continue; }
      // 优先合成：找同型同级单位
      const mergeTarget = [...this.units.values()].find((u) => u.type === token.type && u.tier === token.tier);
      if (mergeTarget) {
        if (this.placeFromTray(0, mergeTarget.cell)) continue;
      }
      // 否则放到首个空的已解锁格
      const empty = this.unlockedCells().find((c) => this.cellFree(c.c, c.r));
      if (empty) {
        this.placeFromTray(0, empty);
      } else {
        this.tray.splice(0, 1); // 无空位，弃置该兵
      }
    }
  }

  // 便于自测/渲染读取的快照
  snapshot() {
    let maxDist = 0;
    for (const m of this.monsters) if (m.dist > maxDist) maxDist = m.dist;
    let skillMonsters = 0;
    for (const m of this.monsters) if (m.skill) skillMonsters++;
    let debuffed = 0;
    for (const u of this.units.values()) if (u.stunT > 0 || u.slowT > 0 || u.weakenT > 0) debuffed++;
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
      palmReady: this.palmAvailable(),
      aiHp: this.aiTangsengHP,
      aiDefeated: this.aiDefeated,
      skillMonsters,
      debuffed,
      heroEnergy: Math.round(this.heroEnergy * 100),
      ultCount: this.ultCount,
      towerPow: Math.round(towerPowTotal),
      generals: this.activeGenerals().length,
      words: this.words.size,
      drops: this.droppedWeapons.length,
      bond: this.bondActive(),
      aiPow: Math.round(aiPowTotal),
      monsterPow: Math.round(monsterPowTotal),
      itemsPicked: this.pickedItems.length,
      shopOpen: this.pendingShop !== null,
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
