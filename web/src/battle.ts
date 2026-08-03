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
  TANGSENG_INITIAL_HP,
  monstersInWave,
  monsterPOW,
} from '@core';
import type { UnitType } from '@core';
import { RNG } from './rng';
import {
  COLS,
  ROWS,
  FENCE_ROW,
  pathTotalLen,
  posAtDistance,
  posAlong,
  lenOf,
  mirrorPath,
  mirrorCell,
  slotUnlockOrder,
  placeableCells,
  isPathCell,
  MAPS,
  type GameMap,
  type Cell,
} from './board';

// —— 本切片的战场调参（非原作数值：原作只给出 POW 框架与怪物数，未给绝对 HP）——
// 保留 POW 关系：POW怪 = HP×SPD，POW塔 = ATK×FRQ×RGE；这里选可玩的绝对值，可再调。
export const TUNING = {
  monsterSpd: 0.55, // 格/秒
  monsterHpBase: 6, // 第 n 波 HP = base + step*n
  monsterHpStep: 3,
  bossEveryWave: 5, // 每 5 波出一个 BOSS
  bossHpMul: 6,
  spawnInterval: 0.8, // 秒/只
  summonCostStart: 12, // 首次征兵成本（对齐原作"征兵"量级）
  summonCostStep: 2, // 每次征兵后 +2（抽卡成本递增）
  summonDraws: 5, // 每次征兵产出 5 个候选（放入候选区）
  shovelDrawChance: 0.16, // 候选中出现铲子的概率
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
  ultChargeTime: 12, // 从空到满的蓄力秒数
  ultRadius: 2.5, // 绝招作用半径（格）
  ultDmgMul: 2.6, // 绝招伤害 = 当前波基础怪血 × 该系数（清扫一片小怪）
};

// 怪物技能：对附近武将施加的减益类型
export type MonsterSkill = 'stun' | 'slow' | 'weaken';
export const SKILL_META: Record<MonsterSkill, { name: string; color: string; icon: string }> = {
  stun: { name: '定身', color: '#ffd34d', icon: '💫' },
  slow: { name: '迟滞', color: '#5bd1ff', icon: '🐌' },
  weaken: { name: '弱身', color: '#c77dff', icon: '⬇' },
};

// 候选区令牌：兵种（带阶数，可在候选区内合并）或 铲子
export type TrayToken = { kind: 'unit'; type: UnitType; tier: number } | { kind: 'shovel' };

export type Status = 'ready' | 'playing' | 'won' | 'lost';

export interface PlacedUnit {
  type: UnitType;
  tier: number;
  cell: Cell;
  cooldown: number; // 距下次攻击的秒数
  firePulse: number; // 开火脉冲(1→0)，用于渲染缩放
  stunT: number; // 眩晕剩余(秒)：>0 时无法攻击
  slowT: number; // 减速剩余(秒)：>0 时冷却拉长
  weakenT: number; // 降攻剩余(秒)：>0 时伤害削弱
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
}

export interface HitFx {
  from: { c: number; r: number };
  to: { c: number; r: number };
  ttl: number;
  maxTtl: number;
  color: string;
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

// —— 日重置道具（胜利后 3 选 1，肉鸽 Build）——
export type ItemKind = '主动' | '被动';
export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  desc: string;
}
export const ITEMS: ItemDef[] = [
  { id: 'xiandan', name: '仙丹', kind: '主动', desc: '全体攻击 +15%' },
  { id: 'fenghuolun', name: '风火轮符', kind: '主动', desc: '全体攻速 +20%' },
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
}

const cellKey = (c: number, r: number) => `${c},${r}`;

export class Battle {
  peach = INITIAL_PEACH;
  tangsengHP = TANGSENG_INITIAL_HP;
  wave = 0;
  status: Status = 'ready';
  summonCost = TUNING.summonCostStart;

  units = new Map<string, PlacedUnit>();
  monsters: Monster[] = [];
  fx: HitFx[] = [];
  bursts: Burst[] = []; // 命中/击杀/合成爆发特效
  summonFlash = 0; // 征兵闪光(1→0)
  palmUsedThisWave = false; // 如来神掌每波限用一次

  // —— 英雄绝招 ——
  heroKey = 'hero-wukong'; // 出战英雄（默认齐天大圣，后续可从菜单选择）
  heroEnergy = 0; // 绝招能量 0..1
  ultFlash = 0; // 绝招释放特效计时(秒)
  ultCenter: { c: number; r: number } | null = null; // 绝招爆心（渲染用）
  ultCount = 0; // 本局绝招释放次数

  // 开局入场：唐僧沿路走到归位，这段时间玩家可征兵布阵；归位后自动开打第一波
  introT = 0;
  introDone = false;
  static readonly INTRO_DUR = 6; // 秒

  // —— 伪竞技 AI 对手（上半场，对角唐僧）——
  readonly aiPath: Cell[];
  readonly aiTangseng: Cell;
  readonly aiCells: Cell[]; // AI 可部署格 = 玩家可摆放格的镜像
  private aiPathLen: number;
  aiTangsengHP = TANGSENG_INITIAL_HP;
  aiMonsters: Monster[] = [];
  aiUnits: PlacedUnit[] = []; // AI 自动部署的单位（上半场）
  aiDefeated = false;
  private nextWaveTimer = 0; // 波间自动切换倒计时

  // 候选区（征兵产出）与铲子（开格资源）
  tray: TrayToken[] = [];
  shovels = TUNING.initialShovels;
  unlocked = new Set<string>(); // 已解锁阵位的 key 集合

  // 道具与修正器
  mods: Modifiers = { atkMul: 1, frqMul: 1, killBonus: 0, monsterSpdMul: 1, summonCostDelta: 0 };
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

  constructor(seed = 1, difficultyMul = 1, map: GameMap = MAPS[0]!) {
    this.rng = new RNG(seed);
    this.difficultyMul = difficultyMul;
    this.map = map;
    this.pathLen = pathTotalLen(map);
    this.slotOrder = slotUnlockOrder(map);
    // AI 对手：点对称镜像路径与唐僧（上半场）
    this.aiPath = mirrorPath(map.path);
    this.aiPathLen = lenOf(this.aiPath);
    this.aiTangseng = mirrorCell(map.tangseng);
    this.aiCells = placeableCells(map).map(mirrorCell);
    // 初始解锁：地图的初始 6 格
    for (let i = 0; i < TUNING.initialOpenSlots && i < this.slotOrder.length; i++) {
      const s = this.slotOrder[i]!;
      this.unlocked.add(cellKey(s.c, s.r));
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

  // 征兵：消耗蟠桃，随机产出 5 个候选（兵种/铲子）放入候选区。成本递增。
  // 候选区非空时：若棋盘仍有空位则须先布阵；若无空位则本次征兵覆盖候选区剩余。
  summon(): boolean {
    if (this.status === 'won' || this.status === 'lost') return false;
    if (this.tray.length > 0 && this.hasEmptyUnlocked()) {
      this.message = '先把候选区的兵拖到绿格';
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
    this.tray = []; // 覆盖剩余候选
    const types = Object.keys(UNITS) as UnitType[];
    for (let i = 0; i < TUNING.summonDraws; i++) {
      if (this.rng.next() < TUNING.shovelDrawChance) {
        this.tray.push({ kind: 'shovel' });
      } else {
        this.tray.push({ kind: 'unit', type: this.rng.pick(types), tier: 1 });
      }
    }
    this.message = '把候选区的兵拖到绿格，铲子拖到锁定格开挖';
    return true;
  }

  private hasEmptyUnlocked(): boolean {
    return this.unlockedCells().some((c) => !this.units.has(cellKey(c.c, c.r)));
  }

  // 计入道具修正后的当前征兵成本
  effectiveSummonCost(): number {
    return Math.max(1, this.summonCost + this.mods.summonCostDelta);
  }

  // 候选区内合并：把第 from 个令牌拖到第 to 个上，同型同级则合并升阶。
  mergeTrayTokens(from: number, to: number): boolean {
    if (from === to) return false;
    const a = this.tray[from];
    const b = this.tray[to];
    if (!a || !b || a.kind !== 'unit' || b.kind !== 'unit') return false;
    if (a.type !== b.type || a.tier !== b.tier || b.tier >= MAX_TIER) {
      this.message = '候选区只有同型同级可合并';
      return false;
    }
    this.tray[to] = { kind: 'unit', type: b.type, tier: b.tier + 1 };
    this.tray.splice(from, 1);
    this.message = `候选区合成 ${UNITS[b.type].name} ${b.tier + 1} 阶`;
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
      this.unlocked.add(cellKey(to.c, to.r));
      this.tray.splice(index, 1);
      this.message = '铲子挖开了新阵位';
      return true;
    }
    if (!this.isUnlocked(to.c, to.r)) {
      this.message = '只能放到已解锁的绿格';
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
        return true;
      }
      // 不可合并 → 交换：候选区令牌落格，原格单位回到候选区该槽（绝不删除）
      this.units.set(cellKey(to.c, to.r), { type: token.type, tier: token.tier, cell: { c: to.c, r: to.r }, cooldown: 0, firePulse: 0, stunT: 0, slowT: 0, weakenT: 0 });
      this.tray[index] = { kind: 'unit', type: exist.type, tier: exist.tier };
      this.message = `与 ${UNITS[exist.type].name} 交换`;
      return true;
    }
    this.units.set(cellKey(to.c, to.r), { type: token.type, tier: token.tier, cell: { c: to.c, r: to.r }, cooldown: 0, firePulse: 0, stunT: 0, slowT: 0, weakenT: 0 });
    this.tray.splice(index, 1);
    this.message = `布置了 ${UNITS[token.type].name}`;
    return true;
  }

  // 直接用铲子（不经候选区，供 UI 便捷开挖最靠前锁定格）
  useShovelOn(to: Cell): boolean {
    if (this.shovels <= 0) return false;
    if (this.isUnlocked(to.c, to.r) || !this.isPlaceable(to.c, to.r)) return false;
    this.shovels -= 1;
    this.unlocked.add(cellKey(to.c, to.r));
    this.message = '铲子挖开了新阵位';
    return true;
  }

  // 拖拽：把 from 格的单位移动到 to 格。同型同级则合成；空的已解锁格则移动。
  dragUnit(from: Cell, to: Cell): boolean {
    const a = this.units.get(cellKey(from.c, from.r));
    if (!a) return false;
    if (from.c === to.c && from.r === to.r) return false;
    if (!this.isUnlocked(to.c, to.r)) return false;

    const b = this.units.get(cellKey(to.c, to.r));
    if (b) {
      if (canMerge({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier })) {
        const merged = mergeUnits({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier });
        this.units.set(cellKey(to.c, to.r), { ...b, type: merged.type, tier: merged.tier, cooldown: 0 });
        this.units.delete(cellKey(from.c, from.r));
        this.bursts.push({ kind: 'merge', c: to.c, r: to.r, ttl: 0.35, maxTtl: 0.35, big: false, color: '#ffd76a' });
        this.message = `合成 ${UNITS[merged.type].name} ${merged.tier} 阶`;
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
    this.spawnRemaining = monstersInWave(this.wave); // 9 + n
    this.spawnTimer = 0;
    this.message = `第 ${this.wave} 波来袭`;
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
    this.message = '如来神掌！妖怪被推回起点';
    return true;
  }

  // 从当前商店 3 选 1（index 0..2）
  chooseItem(index: number): boolean {
    if (!this.pendingShop) return false;
    const id = this.pendingShop[index];
    if (!id) return false;
    this.applyItem(id);
    this.pickedItems.push(id);
    this.pendingShop = null;
    const def = itemById(id);
    this.message = `获得道具：${def?.name ?? id}`;
    return true;
  }

  private applyItem(id: string): void {
    switch (id) {
      case 'xiandan': this.mods.atkMul += 0.15; break;
      case 'fenghuolun': this.mods.frqMul += 0.2; break;
      case 'xianyuan': this.mods.summonCostDelta -= 1; break;
      case 'jubaopen': this.mods.killBonus += 1; break;
      case 'hushen': this.tangsengHP += 1; break;
      case 'zhuwang': this.mods.monsterSpdMul = Math.max(0.4, this.mods.monsterSpdMul - 0.12); break;
      case 'dinghai': { const lc = this.lockedCells(); if (lc[0]) this.unlocked.add(cellKey(lc[0].c, lc[0].r)); break; }
    }
  }

  // 胜利后随机开出 3 件道具供选择
  private rollShop(): void {
    const pool = [...ITEMS];
    const picks: string[] = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) {
      const idx = this.rng.int(pool.length);
      picks.push(pool.splice(idx, 1)[0]!.id);
    }
    this.pendingShop = picks;
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
      dist: 0,
      hp,
      maxHp: hp,
      spd: TUNING.monsterSpd * this.mods.monsterSpdMul * (1 + 0.1 * (this.difficultyMul - 1)), // 高境界妖怪更快
      isBoss,
      hitFlash: 0,
      skill,
      skillCd: TUNING.skillFirstDelay,
      castFlash: 0,
    });
    // AI 对手同波同步出怪（镜像路）
    this.aiMonsters.push({
      id: this.nextMonsterId++,
      dist: 0,
      hp,
      maxHp: hp,
      spd: TUNING.monsterSpd * (1 + 0.1 * (this.difficultyMul - 1)),
      isBoss,
      hitFlash: 0,
      skill,
      skillCd: TUNING.skillFirstDelay,
      castFlash: 0,
    });
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
    // 本波补 2 个 1 阶到空的 AI 格
    let added = 0;
    for (const cell of this.aiCells) {
      if (added >= 2) break;
      if (this.aiUnits.some((u) => u.cell.c === cell.c && u.cell.r === cell.r)) continue;
      this.aiUnits.push({ type: this.rng.pick(types), tier: 1, cell, cooldown: 0, firePulse: 0, stunT: 0, slowT: 0, weakenT: 0 });
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
      u.firePulse = Math.max(0, u.firePulse - dt * 6);
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
        .filter((x) => x.d <= stat.rge)
        .sort((a, b) => b.m.dist - a.m.dist);
      if (inRange.length === 0) continue;
      const dmg = damage(stat.atk);
      let hit = 0;
      for (const t of inRange) {
        if (hit >= maxTargets) break;
        t.m.hp -= dmg;
        t.m.hitFlash = 0.1;
        hit++;
      }
      if (hit > 0) u.firePulse = 1;
      u.cooldown = 1 / stat.frq;
    }
  }

  // AI 侧推进：单位攻击 + 怪物移动 + 漏怪扣血
  private updateAi(dt: number): void {
    this.updateAiUnits(dt);
    const survivors: Monster[] = [];
    for (const m of this.aiMonsters) {
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
      u.firePulse = Math.max(0, u.firePulse - dt * 6); // 开火脉冲衰减
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
        .filter((x) => x.d <= stat.rge)
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
        this.fx.push({ from: { c: u.cell.c, r: u.cell.r }, to: target.p, ttl: 0.16, maxTtl: 0.16, color });
        this.bursts.push({ kind: 'hit', c: target.p.c, r: target.p.r, ttl: 0.22, maxTtl: 0.22, big: false, color });
        hitCount++;
      }
      if (hitCount > 0) u.firePulse = 1; // 开火脉冲
      // 减速减益：拉长攻击间隔（等效攻速下降）
      u.cooldown = (1 / stat.frq) * (u.slowT > 0 ? TUNING.slowCooldownMul : 1);
    }
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

  // 英雄绝招：战斗中持续蓄力，满能量后自动对最靠前妖怪群释放大范围爆发。
  private updateHero(dt: number): void {
    if (this.ultFlash > 0) this.ultFlash = Math.max(0, this.ultFlash - dt);
    if (this.status !== 'playing' || this.monsters.length === 0) return;
    this.heroEnergy = Math.min(1, this.heroEnergy + dt / TUNING.ultChargeTime);
    if (this.heroEnergy >= 1) this.castUltimate();
  }

  private castUltimate(): void {
    let front = this.monsters[0]!;
    for (const m of this.monsters) if (m.dist > front.dist) front = m;
    const center = posAtDistance(this.map, front.dist);
    // 伤害以“当前波基础怪血 × 系数”封顶，保证不喧宾夺主，不改动武将基础数值
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
  }

  private updateMonsters(dt: number): void {
    const survivors: Monster[] = [];
    for (const m of this.monsters) {
      if (m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt);
      if (m.hp <= 0) {
        this.peach += (m.isBoss ? PEACH_PER_BOSS : PEACH_PER_KILL) + this.mods.killBonus; // 击杀产蟠桃(+道具)
        const dp = posAtDistance(this.map, m.dist);
        this.bursts.push({ kind: 'death', c: dp.c, r: dp.r, ttl: 0.4, maxTtl: 0.4, big: m.isBoss, color: m.isBoss ? '#ff5a8a' : '#c25a5a' });
        continue;
      }
      m.dist += m.spd * dt;
      if (m.dist >= this.pathLen) {
        // 撞到唐僧：扣血 + 舍身饲魔补偿蟠桃
        this.tangsengHP -= 1;
        this.peach += PEACH_PER_BLEED;
        if (this.tangsengHP <= 0) {
          this.tangsengHP = 0;
          this.status = 'lost';
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
    for (const bt of this.bursts) bt.ttl -= dt;
    this.bursts = this.bursts.filter((bt) => bt.ttl > 0);
    if (this.summonFlash > 0) this.summonFlash = Math.max(0, this.summonFlash - dt * 2);
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
    this.updateMonsterSkills(dt);
    this.updateHero(dt);
    this.updateMonsters(dt);
    this.updateAi(dt);
    this.updateFx(dt);

    // 波次清空判定（仅在仍在进行中时；避免覆盖同帧发生的 lost）
    if (this.status === 'playing' && this.waveActive && this.spawnRemaining === 0 && this.monsters.length === 0) {
      this.waveActive = false;
      if (this.wave >= TUNING.winWave) {
        this.status = 'won';
        this.message = `守护成功！通关第 ${this.wave} 波，取得真经！`;
      } else {
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
      if (token.kind !== 'unit') { this.tray.splice(0, 1); continue; }
      // 优先合成：找同型同级单位
      const mergeTarget = [...this.units.values()].find((u) => u.type === token.type && u.tier === token.tier);
      if (mergeTarget) {
        if (this.placeFromTray(0, mergeTarget.cell)) continue;
      }
      // 否则放到首个空的已解锁格
      const empty = this.unlockedCells().find((c) => !this.units.has(cellKey(c.c, c.r)));
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
