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
  PATH_TOTAL_LEN,
  posAtDistance,
  placeableCellsByPathProximity,
  isPathCell,
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
  summonCostStart: 3, // 首次召唤成本
  summonCostStep: 1, // 每次召唤后 +1（抽卡成本递增）
  openSlotCost: 12, // 开辟一个阵位消耗蟠桃（对应原作"铲子/定海符"）
  initialOpenSlots: 6, // 初始 6 个阵位（照搬原作初始6格）
  winWave: 8, // 通关波次（切片演示）
};

export type Status = 'ready' | 'playing' | 'won' | 'lost';

export interface PlacedUnit {
  type: UnitType;
  tier: number;
  cell: Cell;
  cooldown: number; // 距下次攻击的秒数
}

export interface Monster {
  id: number;
  dist: number; // 沿路进度（格）
  hp: number;
  maxHp: number;
  spd: number;
  isBoss: boolean;
}

export interface HitFx {
  from: { c: number; r: number };
  to: { c: number; r: number };
  ttl: number;
  maxTtl: number;
  color: string;
}

const cellKey = (c: number, r: number) => `${c},${r}`;

export class Battle {
  peach = INITIAL_PEACH;
  tangsengHP = TANGSENG_INITIAL_HP;
  wave = 0;
  status: Status = 'ready';
  summonCost = TUNING.summonCostStart;
  openSlots = TUNING.initialOpenSlots;

  units = new Map<string, PlacedUnit>();
  monsters: Monster[] = [];
  fx: HitFx[] = [];
  palmUsedThisWave = false; // 如来神掌每波限用一次

  private rng: RNG;
  private slotOrder: Cell[] = placeableCellsByPathProximity();
  private spawnRemaining = 0;
  private spawnTimer = 0;
  private nextMonsterId = 1;
  private waveActive = false;
  message = '点击「召唤」布阵，然后「下一波」开始';

  constructor(seed = 1) {
    this.rng = new RNG(seed);
  }

  // 已解锁的阵位集合（前 openSlots 个可摆放格）
  private isUnlocked(c: number, r: number): boolean {
    for (let i = 0; i < this.openSlots && i < this.slotOrder.length; i++) {
      const s = this.slotOrder[i]!;
      if (s.c === c && s.r === r) return true;
    }
    return false;
  }

  unlockedCells(): Cell[] {
    return this.slotOrder.slice(0, this.openSlots);
  }

  private firstEmptyUnlocked(): Cell | null {
    for (let i = 0; i < this.openSlots && i < this.slotOrder.length; i++) {
      const s = this.slotOrder[i]!;
      if (!this.units.has(cellKey(s.c, s.r))) return s;
    }
    return null;
  }

  // 召唤：消耗蟠桃，随机产出一个 1 阶兵种放入首个空阵位。成本递增。
  summon(): boolean {
    if (this.status === 'won' || this.status === 'lost') return false;
    if (this.peach < this.summonCost) {
      this.message = '蟠桃不足，无法召唤';
      return false;
    }
    const cell = this.firstEmptyUnlocked();
    if (!cell) {
      this.message = '没有空阵位，先合成或开辟阵位';
      return false;
    }
    this.peach -= this.summonCost;
    this.summonCost += TUNING.summonCostStep;
    const types = Object.keys(UNITS) as UnitType[];
    const type = this.rng.pick(types);
    this.units.set(cellKey(cell.c, cell.r), { type, tier: 1, cell, cooldown: 0 });
    this.message = `召唤了 ${UNITS[type].name}`;
    return true;
  }

  // 开辟一个新阵位（消耗蟠桃）
  openNewSlot(): boolean {
    if (this.openSlots >= this.slotOrder.length) {
      this.message = '阵位已全部开辟';
      return false;
    }
    if (this.peach < TUNING.openSlotCost) {
      this.message = '蟠桃不足，无法开辟阵位';
      return false;
    }
    this.peach -= TUNING.openSlotCost;
    this.openSlots += 1;
    this.message = '开辟了新阵位';
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
        this.message = `合成 ${UNITS[merged.type].name} ${merged.tier} 阶`;
        return true;
      }
      this.message = '只有同型同级可合成';
      return false;
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
    this.wave += 1;
    this.status = 'playing';
    this.waveActive = true;
    this.palmUsedThisWave = false;
    this.spawnRemaining = monstersInWave(this.wave); // 9 + n
    this.spawnTimer = 0;
    this.message = `第 ${this.wave} 波来袭`;
    return true;
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

  private spawnMonster(): void {
    const isBoss =
      this.wave % TUNING.bossEveryWave === 0 && this.spawnRemaining === 1; // 每波最后一只为 BOSS
    let hp = TUNING.monsterHpBase + TUNING.monsterHpStep * this.wave;
    if (isBoss) hp *= TUNING.bossHpMul;
    this.monsters.push({
      id: this.nextMonsterId++,
      dist: 0,
      hp,
      maxHp: hp,
      spd: TUNING.monsterSpd,
      isBoss,
    });
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
      u.cooldown -= dt;
      if (u.cooldown > 0) continue;
      const stat = getUnitStat(u.type, u.tier); // atk/frq/rge/targets（来自 game-core）
      // 命中平均目标数：整数部分 + 小数部分按概率
      const base = Math.floor(stat.targets);
      const extra = this.rng.next() < stat.targets - base ? 1 : 0;
      const maxTargets = Math.max(1, base + extra);
      // 找范围内妖怪（按距离近优先）
      const inRange = this.monsters
        .map((m) => {
          const p = posAtDistance(m.dist);
          const d = Math.hypot(p.c - u.cell.c, p.r - u.cell.r);
          return { m, d, p };
        })
        .filter((x) => x.d <= stat.rge)
        .sort((a, b) => b.m.dist - a.m.dist); // 优先打最靠前（进度大）的妖怪
      if (inRange.length === 0) continue;
      const dmg = damage(stat.atk);
      let hitCount = 0;
      for (const target of inRange) {
        if (hitCount >= maxTargets) break;
        target.m.hp -= dmg;
        this.fx.push({
          from: { c: u.cell.c, r: u.cell.r },
          to: target.p,
          ttl: 0.16,
          maxTtl: 0.16,
          color: this.unitColor(u.type),
        });
        hitCount++;
      }
      u.cooldown = 1 / stat.frq; // 攻速（次/秒）
    }
  }

  private updateMonsters(dt: number): void {
    const survivors: Monster[] = [];
    for (const m of this.monsters) {
      if (m.hp <= 0) {
        this.peach += m.isBoss ? PEACH_PER_BOSS : PEACH_PER_KILL; // 击杀产蟠桃
        continue;
      }
      m.dist += m.spd * dt;
      if (m.dist >= PATH_TOTAL_LEN) {
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
  }

  // 推进 dt 秒
  step(dt: number): void {
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
        this.spawnTimer = TUNING.spawnInterval;
      }
    }
    this.updateUnits(dt);
    this.updateMonsters(dt);
    this.updateFx(dt);

    // 波次清空判定
    if (this.waveActive && this.spawnRemaining === 0 && this.monsters.length === 0) {
      this.waveActive = false;
      if (this.wave >= TUNING.winWave) {
        this.status = 'won';
        this.message = `守护成功！通关第 ${this.wave} 波，取得真经！`;
      } else {
        this.status = 'ready';
        this.message = `第 ${this.wave} 波已清，点「下一波」继续`;
      }
    }
  }

  // 调试/自测用：直接增蟠桃（正式玩法不暴露）
  grantPeach(n: number): void {
    this.peach += n;
  }

  // 便于自测/渲染读取的快照
  snapshot() {
    return {
      peach: this.peach,
      tangsengHP: this.tangsengHP,
      wave: this.wave,
      status: this.status,
      summonCost: this.summonCost,
      openSlots: this.openSlots,
      units: this.units.size,
      monsters: this.monsters.length,
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
