// web/tests/autoplace.test.ts
import { it, expect } from 'vitest';
import {
  planAutoPlace,
  planAutoPlaceSteps,
  planBattleReposition,
  runBattleReposition,
  aiHeroPartnerAdjustPending,
  rollAiAdjustInterval,
  AI_WEAPON_ADJUST_INTERVAL_MIN,
  AI_WEAPON_ADJUST_INTERVAL_MAX,
  AI_PARTNER_ADJUST_INTERVAL_MIN,
  AI_PARTNER_ADJUST_INTERVAL_MAX,
  dangerSeatBonus,
  imminentPathScore,
  dangerPlacementBonus,
  digPriorityScore,
  mergeKeepScore,
  placeCellScore,
  seatScore,
  placeExitWeight,
  singleWordScore,
  heroSeatScore,
  lowHpEngageMul,
  engageThreatAt,
  boardMatePreferScore,
  entrancePathSeatBonus,
  frontMonsterEngageWeight,
  type AutoPlaceView,
  type BattleRepositionView,
  type BattleRepositionHeroPair,
  type MonsterEngageLite,
  type PlaceToken,
  type Cell,
} from '../src/autoplace';
import { getUnitStat } from '@core';
import { posAlong, mapById, lenOf, entranceDistance } from '../src/board';
import { pathCoverageLenEntranceWeighted, pathFirstEngageDist } from '../src/board-power';
import { inAttackRange } from '../src/battle';
import { Battle, makePlacedUnit } from '../src/battle';
import { matchGeneral } from '../src/generals';

// —— 内存假视图：格按 c 坐标离路(第0行)越近越小；nearestPathDist = r（行号即离路距）——
// 唐僧在 (7,5)：单字偏好高 r（远路）且靠近 (7,5)
class FakeView implements AutoPlaceView {
  trayArr: PlaceToken[];
  unlocked = new Set<string>();      // "c,r"
  unitsMap = new Map<string, { type: any; tier: number; cell: Cell }>();
  wordsMap = new Map<string, { char: string; general: string; cell: Cell; tier: number }>();
  diggable: Cell[];
  generalRgeVal = 2;
  /** 假路径：水平 r=0，用于 imminent 路段评分 */
  readonly fakePath = Array.from({ length: 8 }, (_, c) => ({ c, r: 0 }));
  pathLen = 7;
  entranceDist = 0;
  monsterDists: number[] = [];
  waveNum = 0;
  wave() { return this.waveNum; }
  private key(c: number, r: number) { return `${c},${r}`; }
  constructor(tray: PlaceToken[], unlocked: Cell[], diggable: Cell[] = []) {
    this.trayArr = tray.slice();
    for (const c of unlocked) this.unlocked.add(this.key(c.c, c.r));
    this.diggable = diggable.slice();
  }
  tray() { return this.trayArr; }
  freeCells() {
    return [...this.unlocked].map((k) => { const [c, r] = k.split(',').map(Number); return { c, r }; })
      .filter((c) => !this.unitsMap.has(this.key(c.c, c.r)) && !this.wordsMap.has(this.key(c.c, c.r)))
      .sort((a, b) => a.r - b.r || a.c - b.c);
  }
  diggableCells() { return this.diggable.slice(); }
  placedUnits() { return [...this.unitsMap.values()]; }
  placedWords() { return [...this.wordsMap.values()]; }
  nearestPathDist(cell: Cell) { return cell.r; } // 行号=离路距
  // 假路径：整行 r=0；r=1 贴一边；其余未贴路
  pathTouchSides(cell: Cell) { return cell.r === 1 ? 1 : cell.r === 0 ? 1 : 0; }
  exitDist(cell: Cell) { return cell.c; } // 列号=离出口距（出口在 c=0）
  tangsengDist(cell: Cell) { return Math.hypot(cell.c - 7, cell.r - 5); }
  imminentPathScore(cell: Cell) {
    return imminentPathScore(this.fakePath, this.pathLen, this.entranceDist, this.monsterDists, cell);
  }
  pathCover(cell: Cell, type: any, tier: number) {
    return Math.max(0, getUnitStat(type, tier).rge - this.nearestPathDist(cell) + 1);
  }
  pathCoverAt(ax: number, ay: number, rge: number) {
    // 中点越靠近路(ay 小)且越靠近出口(ax 小)覆盖越高
    return Math.max(0, rge - ay + 1) + Math.max(0, 3 - ax) * 0.1;
  }
  pathCoverEarlyAt(ax: number, ay: number, rge: number) {
    return this.pathCoverAt(ax, ay, rge);
  }
  pathFirstEngageAt(_ax: number, _ay: number, _rge: number) {
    return 0;
  }
  generalRge(_general: string, _tier: number) { return this.generalRgeVal; }
  wordChars(general: string) { return general === 'g' ? (['大', '圣'] as const) : undefined; }
  place(index: number, to: Cell): boolean {
    const t = this.trayArr[index]; if (!t) return false;
    const k = this.key(to.c, to.r);
    if (t.kind === 'shovel') {
      const di = this.diggable.findIndex((d) => d.c === to.c && d.r === to.r); if (di < 0) return false;
      this.diggable.splice(di, 1); this.unlocked.add(k); this.trayArr.splice(index, 1); return true;
    }
    if (t.kind === 'unit') {
      const ex = this.unitsMap.get(k);
      if (ex) {
        if (ex.type === t.type && ex.tier === t.tier) {
          ex.tier += 1; this.trayArr.splice(index, 1); return true;
        }
        // 不可合 → 与棋盘兵交换（对齐 battle.placeFromTray）
        this.unitsMap.set(k, { type: t.type, tier: t.tier, cell: to });
        this.trayArr[index] = { kind: 'unit', type: ex.type, tier: ex.tier };
        return true;
      }
      if (!this.unlocked.has(k) || this.wordsMap.has(k)) return false;
      this.unitsMap.set(k, { type: t.type, tier: t.tier, cell: to }); this.trayArr.splice(index, 1); return true;
    }
    // word：同字同阶不可合并；同字异阶或异字 → 交换；有兵 → 与兵交换（对齐 battle.placeFromTray）
    const ex = this.wordsMap.get(k);
    if (ex) {
      if (ex.char === t.char && ex.tier === t.tier) return false;
      this.wordsMap.set(k, { char: t.char, general: t.general, cell: to, tier: t.tier });
      this.trayArr[index] = { kind: 'word', char: ex.char, general: ex.general, tier: ex.tier };
      return true;
    }
    const uex = this.unitsMap.get(k);
    if (uex) {
      this.unitsMap.delete(k);
      this.wordsMap.set(k, { char: t.char, general: t.general, cell: to, tier: t.tier });
      this.trayArr[index] = { kind: 'unit', type: uex.type, tier: uex.tier };
      return true;
    }
    if (!this.unlocked.has(k)) return false;
    this.wordsMap.set(k, { char: t.char, general: t.general, cell: to, tier: t.tier }); this.trayArr.splice(index, 1); return true;
  }
  moveUnit(from: Cell, to: Cell): boolean {
    const kf = this.key(from.c, from.r), kt = this.key(to.c, to.r);
    const u = this.unitsMap.get(kf); if (!u) return false;
    if (!this.unlocked.has(kt) || this.unitsMap.has(kt) || this.wordsMap.has(kt)) return false;
    this.unitsMap.delete(kf); u.cell = to; this.unitsMap.set(kt, u); return true;
  }
  swapUnits(a: Cell, b: Cell): boolean {
    const ka = this.key(a.c, a.r), kb = this.key(b.c, b.r);
    const ua = this.unitsMap.get(ka), ub = this.unitsMap.get(kb);
    if (!ua || !ub) return false;
    this.unitsMap.delete(ka); this.unitsMap.delete(kb);
    ua.cell = b; ub.cell = a;
    this.unitsMap.set(kb, ua); this.unitsMap.set(ka, ub);
    return true;
  }
  swapUnitWord(unitCell: Cell, wordCell: Cell): boolean {
    const uk = this.key(unitCell.c, unitCell.r);
    const wk = this.key(wordCell.c, wordCell.r);
    const u = this.unitsMap.get(uk);
    const w = this.wordsMap.get(wk);
    if (!u || !w || this.isActiveHeroCell(wordCell)) return false;
    this.unitsMap.delete(uk);
    this.wordsMap.delete(wk);
    u.cell = { ...wordCell };
    w.cell = { ...unitCell };
    this.unitsMap.set(wk, u);
    this.wordsMap.set(uk, w);
    return true;
  }
  moveWord(from: Cell, to: Cell): boolean {
    const kf = this.key(from.c, from.r), kt = this.key(to.c, to.r);
    const w = this.wordsMap.get(kf); if (!w) return false;
    if (!this.unlocked.has(kt) || this.unitsMap.has(kt) || this.wordsMap.has(kt)) return false;
    this.wordsMap.delete(kf); w.cell = to; this.wordsMap.set(kt, w); return true;
  }
  swapWords(from: Cell, to: Cell): boolean {
    const kf = this.key(from.c, from.r), kt = this.key(to.c, to.r);
    const w = this.wordsMap.get(kf);
    const tw = this.wordsMap.get(kt);
    if (!w || !tw) return false;
    if (w.char === tw.char && w.tier === tw.tier) return false;
    this.wordsMap.set(kf, { ...tw, cell: from });
    this.wordsMap.set(kt, { ...w, cell: to });
    return true;
  }
  isActiveHeroCell(cell: Cell): boolean {
    // 与 battle.activeGenerals 一致：按左右连读匹配，不要求 general 字段相同
    const paired = (leftChar: string, rightChar: string, hintGeneral: string) => {
      if (matchGeneral(leftChar, rightChar)) return true;
      const chars = this.wordChars(hintGeneral);
      return !!(chars && chars[0] === leftChar && chars[1] === rightChar);
    };
    const w = this.wordsMap.get(this.key(cell.c, cell.r));
    if (!w) return false;
    const right = this.wordsMap.get(this.key(cell.c + 1, cell.r));
    if (right && paired(w.char, right.char, w.general)) return true;
    const left = this.wordsMap.get(this.key(cell.c - 1, cell.r));
    if (left && paired(left.char, w.char, w.general)) return true;
    return false;
  }
  dangerNearFlag = false;
  dangerNear() { return this.dangerNearFlag; }
  mergeTray(from: number, to: number): boolean {
    if (from === to) return false;
    const a = this.trayArr[from], b = this.trayArr[to];
    if (!a || !b || a.kind !== 'unit' || b.kind !== 'unit') return false;
    if (a.type !== b.type || a.tier !== b.tier) return false;
    this.trayArr[to] = { kind: 'unit', type: b.type, tier: b.tier + 1 };
    this.trayArr.splice(from, 1);
    return true;
  }
  mergeBoard(from: Cell, to: Cell): boolean {
    const kf = this.key(from.c, from.r), kt = this.key(to.c, to.r);
    const a = this.unitsMap.get(kf), b = this.unitsMap.get(kt);
    if (!a || !b || a.type !== b.type || a.tier !== b.tier) return false;
    b.tier += 1;
    this.unitsMap.delete(kf);
    return true;
  }
  trayCap = 5;
  displaceToTray(cell: Cell): boolean {
    if (this.isActiveHeroCell(cell)) return false;
    const k = this.key(cell.c, cell.r);
    const w = this.wordsMap.get(k);
    if (w) {
      if (this.trayArr.length >= this.trayCap) return false;
      this.wordsMap.delete(k);
      this.trayArr.push({ kind: 'word', char: w.char, general: w.general, tier: w.tier, displaced: true });
      return true;
    }
    const u = this.unitsMap.get(k);
    if (u) {
      if (this.trayArr.length >= this.trayCap) return false;
      this.unitsMap.delete(k);
      this.trayArr.push({ kind: 'unit', type: u.type, tier: u.tier, displaced: true });
      return true;
    }
    return true;
  }
}
const rng = () => 0; // 恒 0：从不触发次优

it('不丢弃：无位可放的令牌保留在 tray', () => {
  const v = new FakeView(
    [{ kind: 'unit', type: 'dao', tier: 1 }, { kind: 'unit', type: 'dao', tier: 1 }],
    [{ c: 0, r: 0 }],
  );
  planAutoPlace(v, { rng });
  expect(v.tray().length).toBe(0);
  const u = v.placedUnits(); expect(u.length).toBe(1); expect(u[0]!.tier).toBe(2);
});

it('布阵局面重复时立即停止（防武将来回挪占满 guard）', () => {
  let toggle = false;
  class OscView extends FakeView {
    moveWord(from: Cell, to: Cell): boolean {
      toggle = !toggle;
      return super.moveWord(from, to);
    }
  }
  const cells = [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }];
  const v = new OscView([], cells);
  v.wordsMap.set('0,0', { char: '白', general: 'baigujing', cell: { c: 0, r: 0 }, tier: 1 });
  v.wordsMap.set('1,0', { char: '骨', general: 'baigujing', cell: { c: 1, r: 0 }, tier: 1 });
  v.generalRgeVal = 2;
  const steps = planAutoPlaceSteps(v, { rng, maxSteps: 100, maxGuard: 100 });
  expect(steps).toBeLessThan(10);
});

it('射程感知：短兵占近格，弓箭手占远格', () => {
  const v = new FakeView(
    [{ kind: 'unit', type: 'archer', tier: 1 }, { kind: 'unit', type: 'dao', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 0, r: 3 }],
  );
  planAutoPlace(v, { rng });
  const byCell = new Map(v.placedUnits().map((u) => [`${u.cell.c},${u.cell.r}`, u.type]));
  expect(byCell.get('0,0')).toBe('dao');
  expect(byCell.get('0,3')).toBe('archer');
});

it('有空格时 tray 孤儿字必上板（任意波次）', () => {
  const v = new FakeView(
    [{ kind: 'word', char: '青', general: 'qingniu', tier: 1 }],
    [{ c: 3, r: 5 }, { c: 4, r: 5 }, { c: 5, r: 5 }],
  );
  v.waveNum = 2;
  planAutoPlace(v, { rng });
  expect(v.placedWords().some((w) => w.char === '青')).toBe(true);
  expect(v.tray()).toHaveLength(0);
});

it('有空格时 tray 兵种必上板（任意波次）', () => {
  const v = new FakeView(
    [{ kind: 'unit', type: 'dao', tier: 1 }],
    [{ c: 0, r: 5 }],
  );
  planAutoPlaceSteps(v, { rng, maxSteps: 1 });
  expect(v.placedUnits()).toHaveLength(1);
  expect(v.tray()).toHaveLength(0);
});

it('有空格时落子优先于调位：单步先上 tray 兵', () => {
  const v = new FakeView(
    [{ kind: 'unit', type: 'cavalry', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 0, r: 1 }],
  );
  v.unitsMap.set('0,0', { type: 'archer', tier: 3, cell: { c: 0, r: 0 } });
  planAutoPlaceSteps(v, { rng, maxSteps: 1 });
  expect(v.placedUnits().some((u) => u.type === 'cavalry')).toBe(true);
  expect(v.tray()).toHaveLength(0);
});

it('近战贴路：可达格中优先 pathCover 高（近路）的格', () => {
  // dao rge=1：r=0 覆盖代理更高 → 落 (0,0)
  const v = new FakeView(
    [{ kind: 'unit', type: 'dao', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 0, r: 1 }],
  );
  planAutoPlace(v, { rng });
  expect(v.placedUnits()[0]!.cell).toEqual({ c: 0, r: 0 });
  expect(v.freeCells().some((c) => c.r === 1)).toBe(true);
});

it('pathCover 同分时优先近出口', () => {
  // FakeView pathCover 只看 r；两格同 r=0 覆盖相同 → 出口加权选 c=0
  const v = new FakeView(
    [{ kind: 'unit', type: 'dao', tier: 1 }],
    [{ c: 3, r: 0 }, { c: 0, r: 0 }],
  );
  planAutoPlace(v, { rng });
  expect(v.placedUnits()[0]!.cell).toEqual({ c: 0, r: 0 });
});

it('枪优先高覆盖且近出口：覆盖相同时不落远处', () => {
  // spear 可达两格；FakeView 同 r → 同 cover，应选近出口 (0,1) 而非 (4,1)
  const v = new FakeView(
    [{ kind: 'unit', type: 'spear', tier: 1 }],
    [{ c: 4, r: 1 }, { c: 0, r: 1 }],
  );
  planAutoPlace(v, { rng });
  expect(v.placedUnits()[0]!.cell).toEqual({ c: 0, r: 1 });
});

it('铲子优先挖最近锁定格', () => {
  const v = new FakeView([{ kind: 'shovel' }], [], [{ c: 0, r: 0 }, { c: 0, r: 5 }]);
  planAutoPlace(v, { rng });
  expect(v.freeCells().some((c) => c.r === 0)).toBe(true);
});

it('铲子加权：同贴路距时优先挖靠近出口的格', () => {
  // 两格都贴路(r=0)；出口在 c=0 → 应挖 (0,0) 而非 (4,0)
  const v = new FakeView([{ kind: 'shovel' }], [], [{ c: 4, r: 0 }, { c: 0, r: 0 }]);
  planAutoPlace(v, { rng });
  expect(v.freeCells().some((c) => c.c === 0 && c.r === 0)).toBe(true);
  expect(v.diggable.some((c) => c.c === 4)).toBe(true); // 远处未挖
});

it('危险时铲子优先挖怪物即将路过的路段旁', () => {
  const v = new FakeView([{ kind: 'shovel' }], [], [{ c: 0, r: 0 }, { c: 6, r: 1 }]);
  v.dangerNearFlag = true;
  v.monsterDists = [6]; // 最靠前怪在路径 dist=6
  planAutoPlace(v, { rng });
  expect(v.unlocked.has('6,1')).toBe(true);
  expect(v.unlocked.has('0,0')).toBe(false);
});

it('铲子：tray 与棋盘 orphan 凑将时优先挖左右相邻锁定格', () => {
  const v = new FakeView(
    [{ kind: 'shovel' }, { kind: 'word', char: '郎', general: 'erlang', tier: 1 }],
    [{ c: 1, r: 2 }],
    [{ c: 0, r: 0 }, { c: 2, r: 2 }],
  );
  v.wordChars = (g) => (g === 'erlang' ? (['二', '郎'] as const) : undefined);
  v.wordsMap.set('1,2', { char: '二', general: 'erlang', cell: { c: 1, r: 2 }, tier: 1 });
  planAutoPlace(v, { rng });
  expect(v.unlocked.has('2,2')).toBe(true);
  expect(v.unlocked.has('0,0')).toBe(false);
});

it('imminentPathScore：更贴近怪头路段的格分更高', () => {
  const path = [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 }, { c: 4, r: 0 }, { c: 5, r: 0 }, { c: 6, r: 0 }];
  const nearFront = imminentPathScore(path, 6, 0, [5], { c: 5, r: 1 });
  const nearExit = imminentPathScore(path, 6, 0, [5], { c: 0, r: 1 });
  expect(nearFront).toBeGreaterThan(nearExit);
});

it('digPriorityScore 危险模式：imminent 分高的格更优先挖', () => {
  const nearFront = digPriorityScore(1, 1, 5, 0, { danger: true, imminentScore: 0.8 });
  const nearExit = digPriorityScore(1, 1, 0, 0, { danger: true, imminentScore: 0.1 });
  expect(nearFront).toBeLessThan(nearExit);
});

it('digPriorityScore：1格优先于远距三边；0格≈2格；同距贴边多更好；近出口权重大', () => {
  // 一边但离路1格 << 三边但离路4格
  expect(digPriorityScore(1, 1, 5)).toBeLessThan(digPriorityScore(3, 4, 0));
  // 0格与2格同档（差仅来自贴边/出口）
  expect(Math.abs(digPriorityScore(0, 0, 0) - digPriorityScore(0, 2, 0))).toBeLessThan(0.01);
  // 同为1格：三边优于一边
  expect(digPriorityScore(3, 1, 0)).toBeLessThan(digPriorityScore(1, 1, 0));
  // 同贴边同距离：更近出口更好
  expect(digPriorityScore(1, 1, 1)).toBeLessThan(digPriorityScore(1, 1, 3));
  // 近出口可压过小幅贴边差（一边但出口近 优于 三边但出口远2格）
  expect(digPriorityScore(1, 1, 0)).toBeLessThan(digPriorityScore(3, 1, 2));
  // 1格优于2格（利于就近输出）
  expect(digPriorityScore(1, 1, 0)).toBeLessThan(digPriorityScore(1, 2, 0));
  // 自定义出口权重：0.5 时出口差影响弱于默认 3
  expect(digPriorityScore(1, 1, 2, 0.5)).toBeLessThan(digPriorityScore(1, 1, 2, 3));
});

it('AI randomDigExitWeight：同批候选下出口权重可改写挖点', () => {
  // 两格同离路1、同贴边1；c=0 近出口，c=4 远出口。高权重挖近出口，低权重仍挖近出口但分差变小
  const near = digPriorityScore(1, 1, 0, 3);
  const farHigh = digPriorityScore(1, 1, 4, 3);
  const farLow = digPriorityScore(1, 1, 4, 0.5);
  expect(near).toBeLessThan(farHigh);
  expect(near).toBeLessThan(farLow);
  expect(farLow - near).toBeLessThan(farHigh - near);
});

it('铲子优先挖离路约1格的格（优于更远格）', () => {
  // FakeView：r=nearestPathDist；r=1 一边贴路；r=3 更远。应挖 r=1
  const v = new FakeView([{ kind: 'shovel' }], [], [{ c: 2, r: 3 }, { c: 2, r: 1 }]);
  planAutoPlace(v, { rng });
  expect(v.freeCells().some((c) => c.r === 1)).toBe(true);
});

it('有空格时 tray 兵占任意空格（即使打不到路径）', () => {
  const v = new FakeView([{ kind: 'unit', type: 'dao', tier: 1 }], [{ c: 0, r: 3 }]);
  planAutoPlace(v, { rng });
  expect(v.tray().length).toBe(0);
  expect(v.placedUnits()).toHaveLength(1);
});

it('字牌按连读顺序放到能激活的相邻格', () => {
  const v = new FakeView([{ kind: 'word', char: '圣', general: 'g', tier: 1 }], [{ c: 2, r: 0 }]);
  v.wordsMap.set('1,0', { char: '大', general: 'g', cell: { c: 1, r: 0 }, tier: 1 });
  v.unlocked.add('1,0');
  planAutoPlace(v, { rng });
  expect(v.placedWords().some((w) => w.char === '圣' && w.cell.c === 2 && w.cell.r === 0)).toBe(true);
});

it('单字优先远离路径且靠近唐僧', () => {
  // 唐僧 (7,5)；远路高 r、近唐僧 → 应选 (7,4) 而非贴路 (0,0)
  const v = new FakeView(
    [{ kind: 'word', char: '大', general: 'g', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 7, r: 4 }],
  );
  planAutoPlace(v, { rng });
  expect(v.placedWords()[0]!.cell).toEqual({ c: 7, r: 4 });
});

it('singleWordScore：远路近唐僧分更高', () => {
  expect(singleWordScore(3, 1)).toBeGreaterThan(singleWordScore(1, 1));
  expect(singleWordScore(2, 1)).toBeGreaterThan(singleWordScore(2, 4));
});

it('heroSeatScore：覆盖更高优先，不因贴出口加分', () => {
  expect(heroSeatScore(5, 1)).toBeGreaterThan(heroSeatScore(3, 0));
  // 同覆盖时略偏好离路更近；与 exit 无关（无 exit 参数）
  expect(heroSeatScore(4, 0)).toBeGreaterThan(heroSeatScore(4, 2));
});

it('激活武将：宁可覆盖高的中段，不追贴出口列', () => {
  // FakeView：exitDist=c，pathCover 随 ay 降、随 ax 略降。
  // (0,0)-(1,0) 贴口但 cover 高；(5,0)-(6,0) 离口远、cover 略低。
  // 旧 seatScore 会强烈偏好 c=0；新规则 cover 接近时不应只因贴口选左对。
  // 这里造 cover 相同（同 ay）、右对 cover 因 ax 略低 → 仍选左对因 cover；
  // 另测：左对 r=1 cover 更低、右对 r=0 cover 更高 → 选右对（不贴口列也能赢）。
  const v = new FakeView(
    [
      { kind: 'word', char: '大', general: 'g', tier: 1 },
      { kind: 'word', char: '圣', general: 'g', tier: 1 },
    ],
    [{ c: 0, r: 1 }, { c: 1, r: 1 }, { c: 5, r: 0 }, { c: 6, r: 0 }],
  );
  planAutoPlace(v, { rng });
  const words = v.placedWords();
  expect(words).toHaveLength(2);
  // r=0 覆盖更高，应落在 (5,0)-(6,0) 而非贴口的 r=1
  expect(words.every((w) => w.cell.r === 0)).toBe(true);
  expect(words.every((w) => w.cell.c >= 5)).toBe(true);
});

it('激活武将：邻格被武器占时可挪开再落字', () => {
  // 「大」在 (1,0)；可迁到 (0,0)-(1,0)，或原地以 (1,0)-(2,0) 挪开 dao 后落「圣」
  const v = new FakeView(
    [{ kind: 'word', char: '圣', general: 'g', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }],
  );
  v.wordsMap.set('1,0', { char: '大', general: 'g', cell: { c: 1, r: 0 }, tier: 1 });
  v.unitsMap.set('2,0', { type: 'dao', tier: 1, cell: { c: 2, r: 0 } });
  planAutoPlace(v, { rng });
  const byChar = new Map(v.placedWords().map((w) => [w.char, w.cell]));
  const da = byChar.get('大');
  const sheng = byChar.get('圣');
  expect(da).toBeDefined();
  expect(sheng).toBeDefined();
  expect(sheng).toEqual({ c: da!.c + 1, r: da!.r });
  expect(v.placedUnits().length).toBe(1); // 武器保留
});

it('激活武将：邻格被孤儿字占时可挪开，迁伴侣到高分对', () => {
  // 「大」在差位 (0,2)；最优对 (0,0)-(1,0) 的 (1,0) 被孤儿「郎」占；(2,2) 可安置孤儿
  // tray「圣」→ 挪「郎」、迁「大」到 (0,0)、落「圣」到 (1,0)
  const v = new FakeView(
    [{ kind: 'word', char: '圣', general: 'g', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 0, r: 2 }, { c: 2, r: 2 }],
  );
  v.wordsMap.set('0,2', { char: '大', general: 'g', cell: { c: 0, r: 2 }, tier: 1 });
  v.wordsMap.set('1,0', { char: '郎', general: 'erlang', cell: { c: 1, r: 0 }, tier: 1 });
  planAutoPlace(v, { rng });
  const byChar = new Map(v.placedWords().map((w) => [w.char, w.cell]));
  expect(byChar.get('大')).toEqual({ c: 0, r: 0 });
  expect(byChar.get('圣')).toEqual({ c: 1, r: 0 });
  expect(byChar.get('郎')).toBeDefined();
  expect(byChar.get('郎')).not.toEqual({ c: 1, r: 0 });
});

it('激活武将：不拆散其他已激活英雄占格', () => {
  // (0,0)-(1,0) 已是「大圣」激活；伴侣「二」在 (0,2)，tray「郎」只能找别对或单放，不得拆「大圣」
  const v = new FakeView(
    [{ kind: 'word', char: '郎', general: 'erlang', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 0, r: 2 }, { c: 1, r: 2 }],
  );
  v.wordChars = (g: string) => {
    if (g === 'g') return ['大', '圣'] as const;
    if (g === 'erlang') return ['二', '郎'] as const;
    return undefined;
  };
  v.wordsMap.set('0,0', { char: '大', general: 'g', cell: { c: 0, r: 0 }, tier: 1 });
  v.wordsMap.set('1,0', { char: '圣', general: 'g', cell: { c: 1, r: 0 }, tier: 1 });
  v.wordsMap.set('0,2', { char: '二', general: 'erlang', cell: { c: 0, r: 2 }, tier: 1 });
  planAutoPlace(v, { rng });
  // 大圣仍在原位
  expect(v.wordsMap.get('0,0')?.char).toBe('大');
  expect(v.wordsMap.get('1,0')?.char).toBe('圣');
  // 二郎在 (0,2)-(1,2) 激活
  expect(v.wordsMap.get('0,2')?.char).toBe('二');
  expect(v.wordsMap.get('1,2')?.char).toBe('郎');
});

it('tray 双字：落到 pathCover 更高的邻格对', () => {
  // 两对邻格：(0,2)-(1,2) 与 (0,0)-(1,0)；FakeView 中 ay 更小覆盖更高 → 落在 r=0
  const v = new FakeView(
    [
      { kind: 'word', char: '大', general: 'g', tier: 1 },
      { kind: 'word', char: '圣', general: 'g', tier: 1 },
    ],
    [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 0, r: 2 }, { c: 1, r: 2 }],
  );
  planAutoPlace(v, { rng });
  const words = v.placedWords();
  expect(words).toHaveLength(2);
  expect(words.every((w) => w.cell.r === 0)).toBe(true);
  const byChar = new Map(words.map((w) => [w.char, w.cell]));
  expect(byChar.get('大')).toEqual({ c: 0, r: 0 });
  expect(byChar.get('圣')).toEqual({ c: 1, r: 0 });
});

it('pSubOptimal=1 时会选非最优格（覆盖次优分支，但仍不丢弃/不越界）', () => {
  const v = new FakeView(
    [{ kind: 'unit', type: 'archer', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 0, r: 3 }],
  );
  const r = (() => { let s = 1; return () => { s = (s * 48271) % 2147483647; return s / 2147483647; }; })();
  planAutoPlace(v, { rng: r, pSubOptimal: 1 });
  expect(v.placedUnits().length).toBe(1);
});

it('近格被占时：tray 短兵先落能打到的远格，不强制救援换座', () => {
  const v = new FakeView([{ kind: 'unit', type: 'dao', tier: 1 }], [{ c: 0, r: 0 }, { c: 0, r: 1 }]);
  v.unitsMap.set('0,0', { type: 'archer', tier: 1, cell: { c: 0, r: 0 } });
  planAutoPlace(v, { rng });
  const byCell = new Map(v.placedUnits().map((u) => [`${u.cell.c},${u.cell.r}`, u.type]));
  expect(byCell.get('0,0')).toBe('archer');
  expect(byCell.get('0,1')).toBe('dao');
  expect(v.tray().length).toBe(0);
});

it('近格被占时：tray 骑兵落能打到的远格，不赶走占位短兵', () => {
  const v = new FakeView([{ kind: 'unit', type: 'cavalry', tier: 1 }], [{ c: 0, r: 0 }, { c: 0, r: 1 }]);
  v.unitsMap.set('0,0', { type: 'dao', tier: 1, cell: { c: 0, r: 0 } });
  planAutoPlace(v, { rng });
  const byCell = new Map(v.placedUnits().map((u) => [`${u.cell.c},${u.cell.r}`, u.type]));
  expect(byCell.get('0,0')).toBe('dao');
  expect(byCell.get('0,1')).toBe('cavalry');
  expect(v.tray().length).toBe(0);
});

it('满槽：tray 两枚同阶可合且合后能上棋盘再合 → 先 tray 合再落到棋盘', () => {
  // 棋盘满：一格被 dao T2 占。tray 两枚 dao T1 → 合为 T2 → 再与棋盘 T2 合成 T3
  const v = new FakeView(
    [
      { kind: 'unit', type: 'dao', tier: 1 },
      { kind: 'unit', type: 'dao', tier: 1 },
    ],
    [{ c: 0, r: 0 }],
  );
  v.unitsMap.set('0,0', { type: 'dao', tier: 2, cell: { c: 0, r: 0 } });
  planAutoPlace(v, { rng });
  expect(v.tray().length).toBe(0);
  expect(v.placedUnits().length).toBe(1);
  expect(v.placedUnits()[0]!.tier).toBe(3);
});

it('tray 牛+魔 优先组牛魔，不与棋盘 orphan 郎 组牛郎', () => {
  const cells = [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 }];
  const v = new FakeView(
    [
      { kind: 'word', char: '牛', general: 'niumowang', tier: 1 },
      { kind: 'word', char: '魔', general: 'niumowang', tier: 1 },
    ],
    cells,
  );
  v.wordsMap.set('3,0', { char: '郎', general: 'niulang', cell: { c: 3, r: 0 }, tier: 1 });
  planAutoPlace(v, { rng });
  const niu = v.placedWords().find((w) => w.char === '牛');
  const mo = v.placedWords().find((w) => w.char === '魔');
  expect(niu).toBeDefined();
  expect(mo).toBeDefined();
  expect(Math.abs(niu!.cell.c - mo!.cell.c)).toBe(1);
  expect(niu!.cell.r).toBe(mo!.cell.r);
  expect(matchGeneral(niu!.char, mo!.char)?.id).toBe('niumowang');
  expect(v.isActiveHeroCell(niu!.cell)).toBe(true);
});

it('已激活牛郎时 tray 魔 替换郎 升牛魔', () => {
  const cells = [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }];
  const v = new FakeView(
    [{ kind: 'word', char: '魔', general: 'niumowang', tier: 1 }],
    cells,
  );
  v.wordsMap.set('0,0', { char: '牛', general: 'niulang', cell: { c: 0, r: 0 }, tier: 3 });
  v.wordsMap.set('1,0', { char: '郎', general: 'niulang', cell: { c: 1, r: 0 }, tier: 3 });
  expect(v.isActiveHeroCell({ c: 0, r: 0 })).toBe(true);
  planAutoPlaceSteps(v, { rng, maxSteps: 5 });
  const niu = v.placedWords().find((w) => w.char === '牛');
  const mo = v.placedWords().find((w) => w.char === '魔');
  expect(niu?.cell).toEqual({ c: 0, r: 0 });
  expect(mo?.cell).toEqual({ c: 1, r: 0 });
  expect(matchGeneral(niu!.char, mo!.char)?.id).toBe('niumowang');
  expect(v.isActiveHeroCell(niu!.cell)).toBe(true);
  const lang = v.placedWords().find((w) => w.char === '郎');
  expect(lang).toBeDefined();
  expect(v.isActiveHeroCell(lang!.cell)).toBe(false);
});

it('满盘时 tray 兵种合成链后与棋盘同阶再合', () => {
  const v = new FakeView(
    [
      { kind: 'unit', type: 'spear', tier: 1 },
      { kind: 'unit', type: 'spear', tier: 1 },
      { kind: 'unit', type: 'spear', tier: 1 },
      { kind: 'unit', type: 'spear', tier: 1 },
    ],
    [{ c: 0, r: 0 }],
  );
  v.unitsMap.set('0,0', { type: 'spear', tier: 3, cell: { c: 0, r: 0 } });
  planAutoPlace(v, { rng });
  expect(v.placedUnits().length).toBe(1);
  expect(v.placedUnits()[0]!.tier).toBe(4);
  expect(v.tray().length).toBe(0);
});

it('tray 合后同一步再试上棋盘合', () => {
  const v = new FakeView(
    [
      { kind: 'unit', type: 'spear', tier: 2 },
      { kind: 'unit', type: 'spear', tier: 2 },
    ],
    [{ c: 0, r: 0 }],
  );
  v.unitsMap.set('0,0', { type: 'spear', tier: 3, cell: { c: 0, r: 0 } });
  planAutoPlaceSteps(v, { rng, maxSteps: 1 });
  expect(v.placedUnits().length).toBe(1);
  expect(v.placedUnits()[0]!.tier).toBe(4);
});

it('有空格时 tray 不抢先做合成链', () => {
  const v = new FakeView(
    [
      { kind: 'unit', type: 'spear', tier: 1 },
      { kind: 'unit', type: 'spear', tier: 1 },
    ],
    [{ c: 0, r: 0 }, { c: 0, r: 1 }],
  );
  planAutoPlaceSteps(v, { rng, maxSteps: 1 });
  expect(v.tray().filter((t) => t.kind === 'unit' && t.tier === 2).length).toBe(0);
  expect(v.placedUnits().some((u) => u.type === 'spear' && u.tier === 1)).toBe(true);
});

it('满盘 tray 字：棋盘同级武器合并腾位后落字', () => {
  const v = new FakeView(
    [{ kind: 'word', char: '沙', general: 'shaseng', tier: 1 }],
    [],
  );
  v.unitsMap.set('0,0', { type: 'spear', tier: 2, cell: { c: 0, r: 0 } });
  v.unitsMap.set('1,0', { type: 'spear', tier: 2, cell: { c: 1, r: 0 } });
  v.unlocked.add('0,0');
  v.unlocked.add('1,0');
  planAutoPlace(v, { rng });
  expect(v.tray().length).toBe(0);
  expect(v.placedWords().some((w) => w.char === '沙')).toBe(true);
  expect(v.placedUnits().some((u) => u.type === 'spear' && u.tier === 3)).toBe(true);
});

it('盘丝洞满盘：tray 沙应通过合并或腾位上板', () => {
  const b = new Battle(1, 1, mapById('pansidong'));
  const gate = { c: 0, r: 9 };
  const units: { type: 'dao' | 'spear' | 'archer' | 'cavalry'; tier: number; cell: { c: number; r: number } }[] = [
    { type: 'cavalry', tier: 2, cell: { c: 0, r: 7 } },
    { type: 'spear', tier: 2, cell: { c: 1, r: 7 } },
    { type: 'archer', tier: 2, cell: { c: 2, r: 7 } },
    { type: 'dao', tier: 1, cell: { c: 3, r: 7 } },
    { type: 'dao', tier: 2, cell: { c: 4, r: 7 } },
    { type: 'cavalry', tier: 3, cell: { c: 5, r: 7 } },
    { type: 'archer', tier: 3, cell: { c: 6, r: 7 } },
    { type: 'spear', tier: 2, cell: { c: 0, r: 8 } },
    { type: 'cavalry', tier: 2, cell: { c: 1, r: 8 } },
    { type: 'archer', tier: 2, cell: { c: 4, r: 8 } },
    { type: 'dao', tier: 2, cell: { c: 5, r: 8 } },
    { type: 'cavalry', tier: 2, cell: { c: 6, r: 8 } },
  ];
  const unlocked = (b as unknown as { unlocked: Set<string> }).unlocked;
  const cellKey = (c: number, r: number) => `${c},${r}`;
  for (const u of units) {
    b.units.set(cellKey(u.cell.c, u.cell.r), makePlacedUnit(u.type, u.tier, u.cell, gate));
    unlocked.add(cellKey(u.cell.c, u.cell.r));
  }
  b.words.set(cellKey(2, 8), { char: '牛', general: 'niulang', tier: 1, cell: { c: 2, r: 8 } });
  b.words.set(cellKey(3, 8), { char: '郎', general: 'niulang', tier: 1, cell: { c: 3, r: 8 } });
  unlocked.add(cellKey(2, 8));
  unlocked.add(cellKey(3, 8));
  b.tray = [{ kind: 'word', char: '沙', general: 'shaseng', tier: 1 }];
  b.wave = 4;
  b.status = 'playing';

  b.autoPlaceTray();

  expect(b.tray.some((t) => t?.kind === 'word')).toBe(false);
  expect([...b.words.values()].some((w) => w.char === '沙')).toBe(true);
  expect(b.message).not.toBe('布阵：当前暂无可执行操作');
});

it('满盘 tray 骑1+矛1：先 tray 合骑再棋盘骑2+骑2 腾位落矛', () => {
  const v = new FakeView(
    [
      { kind: 'unit', type: 'cavalry', tier: 1 },
      { kind: 'unit', type: 'spear', tier: 1 },
    ],
    [
      { c: 0, r: 0 },
      { c: 1, r: 0 },
      { c: 2, r: 0 },
      { c: 0, r: 1 },
    ],
  );
  v.unitsMap.set('0,0', { type: 'cavalry', tier: 2, cell: { c: 0, r: 0 } });
  v.unitsMap.set('1,0', { type: 'cavalry', tier: 1, cell: { c: 1, r: 0 } });
  v.unitsMap.set('2,0', { type: 'cavalry', tier: 1, cell: { c: 2, r: 0 } });
  v.unitsMap.set('0,1', { type: 'spear', tier: 4, cell: { c: 0, r: 1 } });
  planAutoPlace(v, { rng });
  expect(v.tray().length).toBe(0);
  expect(v.placedUnits().some((u) => u.type === 'cavalry' && u.tier === 3)).toBe(true);
  expect(v.placedUnits().filter((u) => u.type === 'spear' && u.tier === 1).length).toBeGreaterThanOrEqual(1);
});

it('满槽：tray 无可合时棋盘同阶合，保留覆盖更大格，腾位落 tray', () => {
  // 两格都占满：近路(0,0)与远路(0,2) 各一只 dao T1；tray 一只 archer
  // 应合两 dao，保留近路（pathCover 更大），腾出远格放 archer
  const v = new FakeView(
    [{ kind: 'unit', type: 'archer', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 0, r: 2 }],
  );
  v.unitsMap.set('0,0', { type: 'dao', tier: 1, cell: { c: 0, r: 0 } });
  v.unitsMap.set('0,2', { type: 'dao', tier: 1, cell: { c: 0, r: 2 } });
  planAutoPlace(v, { rng });
  const byCell = new Map(v.placedUnits().map((u) => [`${u.cell.c},${u.cell.r}`, u]));
  expect(byCell.get('0,0')?.type).toBe('dao');
  expect(byCell.get('0,0')?.tier).toBe(2); // 保留近路并升阶
  expect(byCell.get('0,2')?.type).toBe('archer'); // 腾位放 tray
  expect(v.tray().length).toBe(0);
});

it('有空格但 tray 刀够不着：棋盘同阶合腾贴路格再落 tray', () => {
  // 贴路 (0,0)(1,0) 两刀 T3 可合；远端 (2,0) 弓占位；(0,2) 空但刀 T1 射程够不着
  const v = new FakeView(
    [{ kind: 'unit', type: 'dao', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 0, r: 2 }],
  );
  v.unitsMap.set('0,0', { type: 'dao', tier: 3, cell: { c: 0, r: 0 } });
  v.unitsMap.set('1,0', { type: 'dao', tier: 3, cell: { c: 1, r: 0 } });
  v.unitsMap.set('2,0', { type: 'archer', tier: 1, cell: { c: 2, r: 0 } });
  planAutoPlace(v, { rng });
  expect(v.tray().length).toBe(0);
  expect(v.placedUnits().some((u) => u.type === 'dao' && u.tier === 1)).toBe(true);
  expect(v.placedUnits().some((u) => u.type === 'dao' && u.tier >= 3)).toBe(true);
});

it('mergeKeepScore / placeCellScore / seatScore：近出口 + 短射程更看重贴口', () => {
  expect(mergeKeepScore(3, 0)).toBeGreaterThan(mergeKeepScore(3, 4));
  expect(mergeKeepScore(3, 0)).toBeGreaterThan(mergeKeepScore(3.5, 5));
  expect(placeCellScore(5, 0)).toBeGreaterThan(placeCellScore(5.5, 2));
  expect(placeCellScore(8, 1)).toBeGreaterThan(placeCellScore(11, 4));
  // 刀(rge=1)出口权重大于弓(rge=3)
  expect(placeExitWeight(1)).toBeGreaterThan(placeExitWeight(3));
  // 同覆盖同离路：刀更偏好贴口格
  expect(seatScore(8, 1, 1, 1)).toBeGreaterThan(seatScore(8, 4, 1, 1));
});

it('空位更优时已上场枪会迁到近出口空格', () => {
  // 枪在远端 (4,0)；近出口 (0,0) 空着且贴路 → 应迁枪过去
  const v = new FakeView([], [{ c: 0, r: 0 }, { c: 4, r: 0 }]);
  v.unitsMap.set('4,0', { type: 'spear', tier: 2, cell: { c: 4, r: 0 } });
  planAutoPlace(v, { rng });
  const spear = v.placedUnits().find((u) => u.type === 'spear');
  expect(spear?.cell).toEqual({ c: 0, r: 0 });
});

it('刀在右侧、左侧近出口空着时应迁到左侧（结合射程与出口）', () => {
  // 两格同离路 r=0；出口在 c=0 → 刀应占 (0,0) 而非 (1,0)
  const v = new FakeView([], [{ c: 0, r: 0 }, { c: 1, r: 0 }]);
  v.unitsMap.set('1,0', { type: 'dao', tier: 2, cell: { c: 1, r: 0 } });
  planAutoPlace(v, { rng });
  const knife = v.placedUnits().find((u) => u.type === 'dao');
  expect(knife?.cell).toEqual({ c: 0, r: 0 });
});

it('挖出空位后 tray 枪优先占近出口，刀留原格', () => {
  const v = new FakeView(
    [
      { kind: 'shovel' },
      { kind: 'unit', type: 'spear', tier: 1 },
    ],
    [{ c: 4, r: 0 }],
    [{ c: 0, r: 0 }],
  );
  v.unitsMap.set('4,0', { type: 'dao', tier: 2, cell: { c: 4, r: 0 } });
  planAutoPlace(v, { rng });
  const byType = new Map(v.placedUnits().map((u) => [u.type, u]));
  expect(byType.get('spear')).toBeDefined();
  expect(byType.get('dao')).toBeDefined();
  // 枪占近出口或短刀被换到近出口（二者之一在 c=0）
  expect(Math.min(byType.get('spear')!.cell.c, byType.get('dao')!.cell.c)).toBe(0);
  expect(v.tray().some((t) => t.kind === 'unit')).toBe(false);
});

it('tray 合出高级后可换地图上更低阶异型武器', () => {
  // 满盘：弓 T1 占近出口好位；tray 两把刀可合 T2 → 换掉弓
  const v = new FakeView(
    [
      { kind: 'unit', type: 'dao', tier: 1 },
      { kind: 'unit', type: 'dao', tier: 1 },
    ],
    [{ c: 0, r: 0 }, { c: 3, r: 0 }],
  );
  v.unitsMap.set('0,0', { type: 'archer', tier: 1, cell: { c: 0, r: 0 } });
  v.unitsMap.set('3,0', { type: 'spear', tier: 2, cell: { c: 3, r: 0 } });
  planAutoPlace(v, { rng });
  const atGate = v.placedUnits().find((u) => u.cell.c === 0 && u.cell.r === 0);
  expect(atGate?.type).toBe('dao');
  expect(atGate?.tier).toBe(2);
  expect(v.tray().some((t) => t.kind === 'unit' && t.type === 'archer' && t.tier === 1)).toBe(true);
});

it('tray 遗留缺种武器时与地图重复同级/低阶异型互换', () => {
  const v = new FakeView(
    [{ kind: 'unit', type: 'spear', tier: 1 }],
    [{ c: 2, r: 2 }, { c: 4, r: 2 }],
  );
  v.unitsMap.set('2,2', { type: 'dao', tier: 1, cell: { c: 2, r: 2 } });
  v.unitsMap.set('4,2', { type: 'dao', tier: 1, cell: { c: 4, r: 2 } });
  planAutoPlaceSteps(v, { rng, maxSteps: 1 });
  expect(v.placedUnits().some((u) => u.type === 'spear')).toBe(true);
  expect(v.tray().some((t) => t.kind === 'unit' && t.type === 'dao')).toBe(true);
});

it('缺种互换：不换地图唯一兵种，也不换高于 tray 阶的兵器', () => {
  const v = new FakeView(
    [{ kind: 'unit', type: 'spear', tier: 1 }],
    [{ c: 2, r: 2 }, { c: 4, r: 2 }],
  );
  v.unitsMap.set('2,2', { type: 'dao', tier: 1, cell: { c: 2, r: 2 } });
  v.unitsMap.set('4,2', { type: 'archer', tier: 2, cell: { c: 4, r: 2 } });
  planAutoPlaceSteps(v, { rng, maxSteps: 3 });
  expect(v.placedUnits().some((u) => u.type === 'spear')).toBe(false);
  expect(v.tray().some((t) => t.kind === 'unit' && t.type === 'spear')).toBe(true);
});

it('满槽棋盘合：覆盖相近时优先保留靠近出口的格', () => {
  // 两格同贴路(r=0)→pathCover 相同；出口在 c=0 → 应保留 (0,0)，腾 (5,0) 放 archer
  const v = new FakeView(
    [{ kind: 'unit', type: 'archer', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 5, r: 0 }],
  );
  v.unitsMap.set('0,0', { type: 'dao', tier: 1, cell: { c: 0, r: 0 } });
  v.unitsMap.set('5,0', { type: 'dao', tier: 1, cell: { c: 5, r: 0 } });
  planAutoPlace(v, { rng });
  const byCell = new Map(v.placedUnits().map((u) => [`${u.cell.c},${u.cell.r}`, u]));
  expect(byCell.get('0,0')?.type).toBe('dao');
  expect(byCell.get('0,0')?.tier).toBe(2);
  expect(byCell.get('5,0')?.type).toBe('archer');
});

it('高阶同型可与占更好位的低阶交换座位', () => {
  // T2 在较差格 r=1，T1 在更好格 r=0 → 交换后 T2 占 r=0
  const v = new FakeView([], [{ c: 0, r: 0 }, { c: 0, r: 1 }]);
  v.unitsMap.set('0,1', { type: 'dao', tier: 2, cell: { c: 0, r: 1 } });
  v.unitsMap.set('0,0', { type: 'dao', tier: 1, cell: { c: 0, r: 0 } });
  planAutoPlace(v, { rng });
  const byCell = new Map(v.placedUnits().map((u) => [`${u.cell.c},${u.cell.r}`, u]));
  expect(byCell.get('0,0')?.tier).toBe(2);
  expect(byCell.get('0,1')?.tier).toBe(1);
});

it('棋盘已有可配对两字（general 不同）时优先迁到相邻激活', () => {
  // 「大」hint 大圣、「蟒」hint 大蟒 —— 按字匹配应组成大蟒
  const v = new FakeView([], [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 0, r: 2 }, { c: 1, r: 2 }]);
  v.wordChars = (g: string) => {
    if (g === 'dasheng') return ['大', '圣'] as const;
    if (g === 'damang') return ['大', '蟒'] as const;
    return undefined;
  };
  v.wordsMap.set('0,2', { char: '大', general: 'dasheng', cell: { c: 0, r: 2 }, tier: 1 });
  v.wordsMap.set('3,2', { char: '蟒', general: 'damang', cell: { c: 3, r: 2 }, tier: 1 });
  v.unlocked.add('0,2');
  v.unlocked.add('3,2');
  planAutoPlace(v, { rng });
  const da = v.placedWords().find((w) => w.char === '大');
  const mang = v.placedWords().find((w) => w.char === '蟒');
  expect(da?.cell).toEqual({ c: 0, r: 0 });
  expect(mang?.cell).toEqual({ c: 1, r: 0 });
});

it('tray梵+棋盘音（左邻被占）一键布阵应激活梵音', () => {
  const v = new FakeView(
    [
      { kind: 'word', char: '梵', general: 'fanyin', tier: 1 },
      { kind: 'unit', type: 'archer', tier: 1 },
    ],
    [{ c: 0, r: 5 }, { c: 1, r: 5 }, { c: 2, r: 5 }, { c: 3, r: 5 }, { c: 4, r: 5 }],
  );
  v.waveNum = 5;
  v.wordChars = (g: string) => {
    if (g === 'fanyin') return ['梵', '音'] as const;
    if (g === 'guanyin') return ['观', '音'] as const;
    return undefined;
  };
  v.wordsMap.set('1,5', { char: '音', general: 'guanyin', cell: { c: 1, r: 5 }, tier: 1 });
  v.unitsMap.set('0,5', { type: 'spear', tier: 1, cell: { c: 0, r: 5 } });
  for (const k of ['0,5', '1,5', '2,5', '3,5', '4,5']) v.unlocked.add(k);
  planAutoPlace(v, { rng });
  const fan = v.placedWords().find((w) => w.char === '梵');
  const yin = v.placedWords().find((w) => w.char === '音');
  expect(fan).toBeDefined();
  expect(yin).toBeDefined();
  expect(yin!.cell.c).toBe(fan!.cell.c + 1);
  expect(yin!.cell.r).toBe(fan!.cell.r);
  expect(v.tray().some((t) => t.kind === 'word' && t.char === '梵')).toBe(false);
});

it('观音已激活时 tray梵仍应（无更优选择时）与棋盘音激活梵音', () => {
  const v = new FakeView(
    [{ kind: 'word', char: '梵', general: 'fanyin', tier: 1 }],
    [{ c: 2, r: 5 }, { c: 3, r: 5 }, { c: 4, r: 5 }],
  );
  v.wordChars = (g: string) => {
    if (g === 'fanyin') return ['梵', '音'] as const;
    if (g === 'guanyin') return ['观', '音'] as const;
    return undefined;
  };
  v.wordsMap.set('0,5', { char: '观', general: 'guanyin', cell: { c: 0, r: 5 }, tier: 5 });
  v.wordsMap.set('1,5', { char: '音', general: 'guanyin', cell: { c: 1, r: 5 }, tier: 5 });
  v.wordsMap.set('3,5', { char: '音', general: 'fanyin', cell: { c: 3, r: 5 }, tier: 1 });
  for (const k of ['0,5', '1,5', '2,5', '3,5', '4,5']) v.unlocked.add(k);
  planAutoPlace(v, { rng });
  const fan = v.placedWords().find((w) => w.char === '梵');
  const yin = v.placedWords().find((w) => w.char === '音' && w.general === 'fanyin');
  expect(fan).toBeDefined();
  expect(yin).toBeDefined();
  expect(fan!.cell.c + 1).toBe(yin!.cell.c);
  expect(fan!.cell.r).toBe(yin!.cell.r);
  expect(v.tray().some((t) => t.kind === 'word' && t.char === '梵')).toBe(false);
});

it('棋盘孤儿梵+音（general 不同）一键布阵时优先凑对', () => {
  const v = new FakeView([], [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }]);
  v.wordChars = (g: string) => {
    if (g === 'fanyin') return ['梵', '音'] as const;
    if (g === 'guanyin') return ['观', '音'] as const;
    return undefined;
  };
  v.wordsMap.set('0,2', { char: '梵', general: 'fanyin', cell: { c: 0, r: 2 }, tier: 1 });
  v.wordsMap.set('2,2', { char: '音', general: 'guanyin', cell: { c: 2, r: 2 }, tier: 1 });
  v.unlocked.add('0,2');
  v.unlocked.add('2,2');
  planAutoPlace(v, { rng });
  const fan = v.placedWords().find((w) => w.char === '梵');
  const yin = v.placedWords().find((w) => w.char === '音');
  expect(fan?.cell).toEqual({ c: 0, r: 0 });
  expect(yin?.cell).toEqual({ c: 1, r: 0 });
});

it('配对时优先选棋盘最高阶孤儿伴侣', () => {
  // 两枚「大」t1/t3 + tray「圣」→ 与 t3 激活（圣落在 t3 右侧或把 t3 迁到对位）
  const v = new FakeView(
    [{ kind: 'word', char: '圣', general: 'g', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 3, r: 2 }, { c: 4, r: 2 }],
  );
  v.wordsMap.set('3,2', { char: '大', general: 'g', cell: { c: 3, r: 2 }, tier: 1 });
  v.wordsMap.set('0,0', { char: '大', general: 'g', cell: { c: 0, r: 0 }, tier: 3 });
  v.unlocked.add('3,2');
  planAutoPlace(v, { rng });
  const daT3 = v.placedWords().find((w) => w.char === '大' && w.tier === 3);
  const sheng = v.placedWords().find((w) => w.char === '圣');
  expect(daT3).toBeDefined();
  expect(sheng).toBeDefined();
  expect(sheng!.cell.c).toBe(daT3!.cell.c + 1);
  expect(sheng!.cell.r).toBe(daT3!.cell.r);
});

it('tray 同字更高阶与棋盘低阶孤儿互换', () => {
  const v = new FakeView(
    [{ kind: 'word', char: '大', general: 'g', tier: 3 }],
    [{ c: 0, r: 2 }, { c: 1, r: 2 }],
  );
  v.wordsMap.set('0,2', { char: '大', general: 'g', cell: { c: 0, r: 2 }, tier: 1 });
  planAutoPlace(v, { rng });
  const onBoard = v.placedWords().filter((w) => w.char === '大');
  expect(onBoard).toHaveLength(2);
  expect(onBoard.some((w) => w.tier === 3)).toBe(true);
  expect(onBoard.some((w) => w.tier === 1)).toBe(true);
  expect(v.tray()).toHaveLength(0);
});

it('tray 同型更高阶与棋盘低阶兵器互换', () => {
  const cells = [
    { c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 },
    { c: 0, r: 1 }, { c: 1, r: 1 }, { c: 2, r: 1 }, { c: 3, r: 1 },
    { c: 0, r: 2 }, { c: 1, r: 2 }, { c: 2, r: 2 }, { c: 3, r: 2 },
  ];
  const v = new FakeView(
    [
      { kind: 'unit', type: 'archer', tier: 3 },
      { kind: 'unit', type: 'dao', tier: 1 },
    ],
    cells,
  );
  v.wordChars = (g: string) => (g === 'baigujing' ? (['白', '骨'] as const) : undefined);
  v.unitsMap.set('0,0', { type: 'archer', tier: 1, cell: { c: 0, r: 0 } });
  v.unitsMap.set('1,1', { type: 'cavalry', tier: 2, cell: { c: 1, r: 1 } });
  v.unitsMap.set('2,1', { type: 'spear', tier: 2, cell: { c: 2, r: 1 } });
  v.unitsMap.set('3,1', { type: 'spear', tier: 3, cell: { c: 3, r: 1 } });
  v.wordsMap.set('1,2', { char: '白', general: 'baigujing', cell: { c: 1, r: 2 }, tier: 1 });
  v.wordsMap.set('2,2', { char: '骨', general: 'baigujing', cell: { c: 2, r: 2 }, tier: 1 });
  v.unitsMap.set('3,2', { type: 'dao', tier: 2, cell: { c: 3, r: 2 } });
  planAutoPlaceSteps(v, { rng, maxSteps: 1 });
  const archer = v.placedUnits().find((u) => u.type === 'archer');
  expect(archer?.tier).toBe(3);
  expect(archer?.cell).toEqual({ c: 0, r: 0 });
  expect(v.tray()).toContainEqual({ kind: 'unit', type: 'archer', tier: 1 });
});

it('重复孤儿只留最高阶，低阶用 tray 异字换回候选区', () => {
  // 棋盘「大」t1+t3；tray「圣」「郎」→ 与 t3 激活后，t1 被换下，棋盘不再有两枚「大」
  const v = new FakeView(
    [
      { kind: 'word', char: '圣', general: 'g', tier: 1 },
      { kind: 'word', char: '郎', general: 'erlang', tier: 1 },
    ],
    [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 2 }, { c: 3, r: 2 }, { c: 4, r: 2 }],
  );
  v.wordChars = (g: string) => {
    if (g === 'g') return ['大', '圣'] as const;
    if (g === 'erlang') return ['二', '郎'] as const;
    return undefined;
  };
  v.wordsMap.set('0,0', { char: '大', general: 'g', cell: { c: 0, r: 0 }, tier: 3 });
  v.wordsMap.set('2,2', { char: '大', general: 'g', cell: { c: 2, r: 2 }, tier: 1 });
  v.unlocked.add('2,2');
  planAutoPlace(v, { rng });
  const das = v.placedWords().filter((w) => w.char === '大');
  expect(das.some((w) => w.tier === 3)).toBe(true);
  const sheng = v.placedWords().find((w) => w.char === '圣');
  expect(sheng).toBeDefined();
  const daT3 = das.find((w) => w.tier === 3)!;
  expect(sheng!.cell.c).toBe(daT3.cell.c + 1);
  expect(v.tray()).toHaveLength(0);
});

it('回收重复字时绝不拆散已激活武将', () => {
  // 已激活「大圣」t1 在 (0,0)-(1,0)；孤儿更高阶「大」t3 在 (2,2)；tray「郎」
  // 统计同字时会看到重复，但不可拆「大圣」；t3 孤儿保留，郎单放
  const v = new FakeView(
    [{ kind: 'word', char: '郎', general: 'erlang', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 2 }, { c: 3, r: 2 }, { c: 7, r: 4 }],
  );
  v.wordChars = (g: string) => {
    if (g === 'g') return ['大', '圣'] as const;
    if (g === 'erlang') return ['二', '郎'] as const;
    return undefined;
  };
  v.wordsMap.set('0,0', { char: '大', general: 'g', cell: { c: 0, r: 0 }, tier: 1 });
  v.wordsMap.set('1,0', { char: '圣', general: 'g', cell: { c: 1, r: 0 }, tier: 1 });
  v.wordsMap.set('2,2', { char: '大', general: 'g', cell: { c: 2, r: 2 }, tier: 3 });
  v.unlocked.add('2,2');
  expect(v.isActiveHeroCell({ c: 0, r: 0 })).toBe(true);
  expect(v.isActiveHeroCell({ c: 1, r: 0 })).toBe(true);
  planAutoPlace(v, { rng });
  // 大圣仍在原格激活
  expect(v.wordsMap.get('0,0')).toMatchObject({ char: '大', tier: 1 });
  expect(v.wordsMap.get('1,0')).toMatchObject({ char: '圣', tier: 1 });
  expect(v.isActiveHeroCell({ c: 0, r: 0 })).toBe(true);
  expect(v.isActiveHeroCell({ c: 1, r: 0 })).toBe(true);
  // 更高阶孤儿「大」仍在棋盘（不能拿激活的低阶去换它）
  expect(v.placedWords().some((w) => w.char === '大' && w.tier === 3)).toBe(true);
});

it('已激活高阶同字时，只回收未激活的低阶重复', () => {
  // 已激活「大圣」t3；另有孤儿「大」t1；tray「郎」→ 换下 t1，大圣不动
  const v = new FakeView(
    [{ kind: 'word', char: '郎', general: 'erlang', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 2 }, { c: 7, r: 4 }],
  );
  v.wordChars = (g: string) => {
    if (g === 'g') return ['大', '圣'] as const;
    if (g === 'erlang') return ['二', '郎'] as const;
    return undefined;
  };
  v.wordsMap.set('0,0', { char: '大', general: 'g', cell: { c: 0, r: 0 }, tier: 3 });
  v.wordsMap.set('1,0', { char: '圣', general: 'g', cell: { c: 1, r: 0 }, tier: 3 });
  v.wordsMap.set('2,2', { char: '大', general: 'g', cell: { c: 2, r: 2 }, tier: 1 });
  v.unlocked.add('2,2');
  planAutoPlace(v, { rng });
  expect(v.wordsMap.get('0,0')).toMatchObject({ char: '大', tier: 3 });
  expect(v.wordsMap.get('1,0')).toMatchObject({ char: '圣', tier: 3 });
  expect(v.isActiveHeroCell({ c: 0, r: 0 })).toBe(true);
  expect(v.placedWords().filter((w) => w.char === '大')).toHaveLength(2);
  expect(v.tray()).toHaveLength(0);
});

it('满槽时 tray「郎」可换下邻格孤儿「仙」原地激活二郎', () => {
  // 截图2：金吒已激活；二|仙 相邻；无空位；tray 有郎 → 郎换仙，组成二郎
  const cells = [
    { c: 0, r: 0 }, { c: 1, r: 0 },
    { c: 0, r: 1 }, { c: 1, r: 1 },
    { c: 0, r: 2 }, { c: 1, r: 2 },
  ];
  const v = new FakeView(
    [
      { kind: 'word', char: '戒', general: 'bajie', tier: 1 },
      { kind: 'unit', type: 'cavalry', tier: 1 },
      { kind: 'word', char: '铁', general: 'tieshan', tier: 1 },
      { kind: 'unit', type: 'cavalry', tier: 1 },
      { kind: 'word', char: '郎', general: 'erlang', tier: 1 },
    ],
    cells,
  );
  v.wordChars = (g: string) => {
    if (g === 'jinzha') return ['金', '吒'] as const;
    if (g === 'erlang') return ['二', '郎'] as const;
    if (g === 'baxian') return ['八', '仙'] as const;
    if (g === 'bajie') return ['八', '戒'] as const;
    return undefined;
  };
  v.unitsMap.set('0,0', { type: 'archer', tier: 2, cell: { c: 0, r: 0 } });
  v.unitsMap.set('1,0', { type: 'spear', tier: 2, cell: { c: 1, r: 0 } });
  v.wordsMap.set('0,1', { char: '金', general: 'jinzha', cell: { c: 0, r: 1 }, tier: 2 });
  v.wordsMap.set('1,1', { char: '吒', general: 'jinzha', cell: { c: 1, r: 1 }, tier: 2 });
  v.wordsMap.set('0,2', { char: '二', general: 'erlang', cell: { c: 0, r: 2 }, tier: 1 });
  v.wordsMap.set('1,2', { char: '仙', general: 'baxian', cell: { c: 1, r: 2 }, tier: 1 });
  expect(v.freeCells()).toHaveLength(0);
  planAutoPlace(v, { rng });
  const er = v.placedWords().find((w) => w.char === '二');
  const lang = v.placedWords().find((w) => w.char === '郎');
  expect(er).toBeDefined();
  expect(lang).toBeDefined();
  expect(lang!.cell).toEqual({ c: er!.cell.c + 1, r: er!.cell.r });
  expect(v.isActiveHeroCell(er!.cell)).toBe(true);
  // 「仙」被换下：在候选区，或随后与 tray「八」再组八仙
  const xianOnBoard = v.placedWords().find((w) => w.char === '仙');
  const xianInTray = v.tray().some((t) => t.kind === 'word' && t.char === '仙');
  expect(xianOnBoard || xianInTray).toBeTruthy();
});

it('金吒已激活时 tray「哪」布阵替换「金」组成哪吒', () => {
  const cells = [
    { c: 0, r: 0 }, { c: 1, r: 0 },
    { c: 0, r: 1 }, { c: 1, r: 1 },
  ];
  const v = new FakeView(
    [{ kind: 'word', char: '哪', general: 'nezha', tier: 1 }],
    cells,
  );
  v.wordChars = (g: string) => {
    if (g === 'jinzha') return ['金', '吒'] as const;
    if (g === 'nezha') return ['哪', '吒'] as const;
    return undefined;
  };
  v.wordsMap.set('0,1', { char: '金', general: 'jinzha', cell: { c: 0, r: 1 }, tier: 3 });
  v.wordsMap.set('1,1', { char: '吒', general: 'jinzha', cell: { c: 1, r: 1 }, tier: 3 });
  expect(v.isActiveHeroCell({ c: 0, r: 1 })).toBe(true);
  planAutoPlace(v, { rng });
  const ne = v.placedWords().find((w) => w.char === '哪');
  const zha = v.placedWords().find((w) => w.char === '吒');
  expect(ne).toBeDefined();
  expect(zha).toBeDefined();
  expect(ne!.cell.c + 1).toBe(zha!.cell.c);
  expect(ne!.cell.r).toBe(zha!.cell.r);
  expect(matchGeneral(ne!.char, zha!.char)?.id).toBe('nezha');
  expect(v.isActiveHeroCell(ne!.cell)).toBe(true);
  expect(v.tray()).toHaveLength(0);
});

it('贴路行满槽：tray白左移腾位保留金吒并激活白骨', () => {
  const cells = [
    { c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 },
    { c: 4, r: 0 }, { c: 5, r: 0 }, { c: 6, r: 0 },
  ];
  const v = new FakeView(
    [{ kind: 'word', char: '白', general: 'baigujing', tier: 1 }],
    cells,
  );
  v.wordChars = (g: string) => {
    if (g === 'niulang') return ['牛', '郎'] as const;
    if (g === 'jinzha') return ['金', '吒'] as const;
    if (g === 'baigujing') return ['白', '骨'] as const;
    return undefined;
  };
  v.unitsMap.set('0,0', { type: 'cavalry', tier: 5, cell: { c: 0, r: 0 } });
  v.wordsMap.set('1,0', { char: '牛', general: 'niulang', cell: { c: 1, r: 0 }, tier: 3 });
  v.wordsMap.set('2,0', { char: '郎', general: 'niulang', cell: { c: 2, r: 0 }, tier: 3 });
  v.wordsMap.set('3,0', { char: '金', general: 'jinzha', cell: { c: 3, r: 0 }, tier: 1 });
  v.wordsMap.set('4,0', { char: '吒', general: 'jinzha', cell: { c: 4, r: 0 }, tier: 1 });
  v.wordsMap.set('5,0', { char: '骨', general: 'baigujing', cell: { c: 5, r: 0 }, tier: 1 });
  v.unitsMap.set('6,0', { type: 'archer', tier: 3, cell: { c: 6, r: 0 } });
  planAutoPlace(v, { rng });
  const bai = v.placedWords().find((w) => w.char === '白');
  const gu = v.placedWords().find((w) => w.char === '骨');
  const jin = v.placedWords().find((w) => w.char === '金');
  const zha = v.placedWords().find((w) => w.char === '吒');
  const niu = v.placedWords().find((w) => w.char === '牛');
  expect(bai?.cell).toEqual({ c: 4, r: 0 });
  expect(gu?.cell).toEqual({ c: 5, r: 0 });
  expect(matchGeneral(bai!.char, gu!.char)?.id).toBe('baigujing');
  expect(matchGeneral(jin!.char, zha!.char)?.id).toBe('jinzha');
  expect(v.isActiveHeroCell(jin!.cell)).toBe(true);
  expect(v.isActiveHeroCell(niu!.cell)).toBe(true);
  expect(niu!.cell.c).toBeLessThan(jin!.cell.c);
  // 左移腾位的骑兵先进 tray；后续若满盘无更优换占则暂留候选区
  const cavOnBoard = v.placedUnits().some((u) => u.type === 'cavalry');
  const cavInTray = v.tray().some((t) => t.kind === 'unit' && t.type === 'cavalry');
  expect(cavOnBoard || cavInTray).toBe(true);
});

it('仅 tray 白时左移金吒一格后激活白骨', () => {
  const cells = [
    { c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 },
    { c: 4, r: 0 }, { c: 5, r: 0 },
  ];
  const v = new FakeView([{ kind: 'word', char: '白', general: 'baigujing', tier: 1 }], cells);
  v.waveNum = 4;
  v.wordsMap.set('2,0', { char: '金', general: 'jinzha', cell: { c: 2, r: 0 }, tier: 1 });
  v.wordsMap.set('3,0', { char: '吒', general: 'jinzha', cell: { c: 3, r: 0 }, tier: 1 });
  v.wordsMap.set('5,0', { char: '骨', general: 'baigujing', cell: { c: 5, r: 0 }, tier: 1 });
  planAutoPlaceSteps(v, { rng, maxSteps: 1 });
  expect(v.placedWords().find((w) => w.char === '白')?.cell).toEqual({ c: 4, r: 0 });
  expect(v.isActiveHeroCell({ c: 4, r: 0 })).toBe(true);
});

it('满级牛郎在前时布阵将未升满金吒前移', () => {
  const cells = [
    { c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 },
    { c: 4, r: 0 }, { c: 5, r: 0 }, { c: 6, r: 0 }, { c: 7, r: 0 },
  ];
  const v = new FakeView([], cells);
  v.wordChars = (g: string) => {
    if (g === 'niulang') return ['牛', '郎'] as const;
    if (g === 'jinzha') return ['金', '吒'] as const;
    return undefined;
  };
  v.unitsMap.set('0,0', { type: 'cavalry', tier: 5, cell: { c: 0, r: 0 } });
  v.wordsMap.set('1,0', { char: '牛', general: 'niulang', cell: { c: 1, r: 0 }, tier: 3 });
  v.wordsMap.set('2,0', { char: '郎', general: 'niulang', cell: { c: 2, r: 0 }, tier: 3 });
  v.wordsMap.set('3,0', { char: '金', general: 'jinzha', cell: { c: 3, r: 0 }, tier: 1 });
  v.wordsMap.set('4,0', { char: '吒', general: 'jinzha', cell: { c: 4, r: 0 }, tier: 1 });
  planAutoPlaceSteps(v, { rng, maxSteps: 8 });
  const jin = v.placedWords().find((w) => w.char === '金');
  const niu = v.placedWords().find((w) => w.char === '牛');
  expect(jin!.cell.c).toBeLessThan(niu!.cell.c);
});

it('「骨」贴已激活英雄时，tray「白」可与邻格兵交换激活白骨', () => {
  // 截图1：大蟒已激活，骨在其右（左邻不可用）；无空位且无同阶可合兵 → 白与邻格兵交换后组成白骨
  const cells = [
    { c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 },
    { c: 0, r: 1 }, { c: 1, r: 1 }, { c: 2, r: 1 }, { c: 3, r: 1 },
  ];
  const v = new FakeView(
    [{ kind: 'word', char: '白', general: 'bailong', tier: 1 }],
    cells,
  );
  v.wordChars = (g: string) => {
    if (g === 'damang') return ['大', '蟒'] as const;
    if (g === 'baigujing') return ['白', '骨'] as const;
    if (g === 'bailong') return ['白', '龙'] as const;
    return undefined;
  };
  // 异型/异阶填满，避免「棋盘同阶合」腾位掩盖 bug
  const fillers: { type: 'dao' | 'spear' | 'archer' | 'cavalry'; tier: number }[] = [
    { type: 'dao', tier: 1 }, { type: 'dao', tier: 2 }, { type: 'spear', tier: 1 }, { type: 'spear', tier: 2 },
    { type: 'archer', tier: 1 }, { type: 'archer', tier: 2 }, { type: 'cavalry', tier: 1 }, { type: 'cavalry', tier: 2 },
  ];
  cells.forEach((cell, i) => {
    const f = fillers[i]!;
    v.unitsMap.set(`${cell.c},${cell.r}`, { type: f.type, tier: f.tier, cell: { ...cell } });
  });
  v.unitsMap.delete('0,0');
  v.unitsMap.delete('1,0');
  v.unitsMap.delete('2,0');
  v.wordsMap.set('0,0', { char: '大', general: 'damang', cell: { c: 0, r: 0 }, tier: 3 });
  v.wordsMap.set('1,0', { char: '蟒', general: 'damang', cell: { c: 1, r: 0 }, tier: 3 });
  v.wordsMap.set('2,0', { char: '骨', general: 'baigujing', cell: { c: 2, r: 0 }, tier: 1 });
  expect(v.freeCells()).toHaveLength(0);
  planAutoPlace(v, { rng });
  const gu = v.placedWords().find((w) => w.char === '骨');
  const bai = v.placedWords().find((w) => w.char === '白');
  expect(gu).toBeDefined();
  expect(bai).toBeDefined();
  expect(bai!.cell.c + 1).toBe(gu!.cell.c);
  expect(bai!.cell.r).toBe(gu!.cell.r);
  expect(v.isActiveHeroCell(bai!.cell)).toBe(true);
});

class FakeRepositionView implements BattleRepositionView {
  unitsMap = new Map<string, { type: 'dao' | 'spear' | 'archer' | 'cavalry'; tier: number; cell: Cell }>();
  wordsMap = new Map<string, { char: string; general: string; cell: Cell; tier: number }>();
  free: Cell[] = [];
  heroCells = new Set<string>();
  heroPairs: BattleRepositionHeroPair[] = [];
  heroRge = 3;
  heroAtk = 12;
  monsterCells: Cell[] = [];
  monsterEngage: MonsterEngageLite[] = [];
  dangerNearFlag = false;
  monsterDists: number[] = [];
  readonly fakePath = Array.from({ length: 8 }, (_, c) => ({ c, r: 0 }));
  pathLen = 7;
  entranceDist = 0;

  placedUnits() {
    return [...this.unitsMap.values()].map((u) => ({ type: u.type, tier: u.tier, cell: u.cell }));
  }
  orphanWords() {
    return [...this.wordsMap.values()].filter((w) => !this.isActiveHeroCell(w.cell));
  }
  freeCells() { return this.free.slice(); }
  isActiveHeroCell(cell: Cell) { return this.heroCells.has(`${cell.c},${cell.r}`); }
  dangerNear() { return this.dangerNearFlag; }
  exitDist(cell: Cell) { return cell.c; }
  tangsengDist(cell: Cell) { return Math.hypot(cell.c - 7, cell.r - 5); }
  imminentPathScore(cell: Cell) {
    return imminentPathScore(this.fakePath, this.pathLen, this.entranceDist, this.monsterDists, cell);
  }
  seatScore(cell: Cell, type: 'dao' | 'spear' | 'archer' | 'cavalry', tier: number) {
    // 假座位：越靠近假路径(r=0)且越靠出口列(c 小)越好；远程略放大覆盖
    const rge = getUnitStat(type, tier).rge;
    const cover = Math.max(0, rge - cell.r + 1);
    return placeCellScore(cover, cell.c, rge, cell.r);
  }
  canEngage(cell: Cell, type: 'dao' | 'spear' | 'archer' | 'cavalry', tier: number) {
    return this.engageScore(cell, type, tier) > 0;
  }
  engageScore(cell: Cell, type: 'dao' | 'spear' | 'archer' | 'cavalry', tier: number) {
    const stat = getUnitStat(type, tier);
    if (this.monsterEngage.length > 0) {
      return engageThreatAt(
        this.monsterEngage,
        this.fakePath,
        this.entranceDist,
        cell.c,
        cell.r,
        stat.rge,
        stat.atk,
        this.dangerNearFlag,
        type,
      );
    }
    const targets =
      this.monsterCells.length > 0
        ? this.monsterCells
        : [posAlong(this.fakePath, this.entranceDist)];
    let score = 0;
    for (const m of targets) {
      if (inAttackRange(cell.c, cell.r, stat.rge, m)) score += stat.atk;
    }
    return score;
  }
  activeHeroPairs() { return this.heroPairs; }
  heroEngageScore(left: Cell, right: Cell, _general: string, _tier: number) {
    const ax = (left.c + right.c) / 2;
    const ay = (left.r + right.r) / 2;
    return engageThreatAt(
      this.monsterEngage,
      this.fakePath,
      this.entranceDist,
      ax,
      ay,
      this.heroRge,
      this.heroAtk,
      this.dangerNearFlag,
    );
  }
  moveHeroPair(fromLeft: Cell, fromRight: Cell, toLeft: Cell, toRight: Cell) {
    const wl = this.wordsMap.get(`${fromLeft.c},${fromLeft.r}`);
    const wr = this.wordsMap.get(`${fromRight.c},${fromRight.r}`);
    if (!wl || !wr) return false;
    const canOccupy = (to: Cell, fromA: Cell, fromB: Cell) => {
      if (to.c === fromA.c && to.r === fromA.r) return true;
      if (to.c === fromB.c && to.r === fromB.r) return true;
      return !this.unitsMap.has(`${to.c},${to.r}`) && !this.wordsMap.has(`${to.c},${to.r}`);
    };
    if (!canOccupy(toLeft, fromLeft, fromRight) || !canOccupy(toRight, fromLeft, fromRight)) return false;
    const moveWord = (from: Cell, to: Cell) => {
      const w = this.wordsMap.get(`${from.c},${from.r}`);
      if (!w) return false;
      if (from.c === to.c && from.r === to.r) return true;
      if (this.unitsMap.has(`${to.c},${to.r}`) || this.wordsMap.has(`${to.c},${to.r}`)) return false;
      this.wordsMap.delete(`${from.c},${from.r}`);
      w.cell = { c: to.c, r: to.r };
      this.wordsMap.set(`${to.c},${to.r}`, w);
      this.heroCells.delete(`${from.c},${from.r}`);
      this.heroCells.add(`${to.c},${to.r}`);
      return true;
    };
    const order =
      (toLeft.c === fromRight.c && toLeft.r === fromRight.r) || (toRight.c === fromLeft.c && toRight.r === fromLeft.r)
        ? [[fromRight, toRight], [fromLeft, toLeft]] as const
        : [[fromLeft, toLeft], [fromRight, toRight]] as const;
    for (const [from, to] of order) {
      if (!moveWord(from, to)) return false;
    }
    this.heroPairs = this.heroPairs.map((p) =>
      p.left.c === fromLeft.c && p.left.r === fromLeft.r
        ? { ...p, left: toLeft, right: toRight }
        : p,
    );
    return true;
  }
  moveUnit(from: Cell, to: Cell) {
    const kFrom = `${from.c},${from.r}`;
    const u = this.unitsMap.get(kFrom);
    if (!u) return false;
    this.unitsMap.delete(kFrom);
    u.cell = { c: to.c, r: to.r };
    this.unitsMap.set(`${to.c},${to.r}`, u);
    this.free = this.free.filter((c) => c.c !== to.c || c.r !== to.r);
    this.free.push(from);
    return true;
  }
  swapUnits(a: Cell, b: Cell) {
    const ua = this.unitsMap.get(`${a.c},${a.r}`);
    const ub = this.unitsMap.get(`${b.c},${b.r}`);
    if (!ua || !ub) return false;
    ua.cell = { c: b.c, r: b.r };
    ub.cell = { c: a.c, r: a.r };
    this.unitsMap.set(`${b.c},${b.r}`, ua);
    this.unitsMap.set(`${a.c},${a.r}`, ub);
    return true;
  }
  swapUnitWord(unitCell: Cell, wordCell: Cell) {
    const uk = `${unitCell.c},${unitCell.r}`;
    const wk = `${wordCell.c},${wordCell.r}`;
    const u = this.unitsMap.get(uk);
    const w = this.wordsMap.get(wk);
    if (!u || !w || this.isActiveHeroCell(wordCell)) return false;
    this.unitsMap.delete(uk);
    this.wordsMap.delete(wk);
    u.cell = { ...wordCell };
    w.cell = { ...unitCell };
    this.unitsMap.set(wk, u);
    this.wordsMap.set(uk, w);
    return true;
  }
}

it('挖出贴路：有空格时 tray 字必上板（可占新挖格）', () => {
  const v = new FakeView(
    [
      { kind: 'shovel' },
      { kind: 'word', char: '金', general: 'jinzha', tier: 1 },
    ],
    [{ c: 2, r: 2 }],
    [{ c: 0, r: 1 }],
  );
  v.unitsMap.set('2,2', { type: 'dao', tier: 1, cell: { c: 2, r: 2 } });
  v.swapUnitWord = () => false;
  v.moveWord = () => false;
  planAutoPlace(v, { rng });
  expect(v.wordsMap.get('0,1')?.char).toBe('金');
  expect(v.unitsMap.get('2,2')?.type).toBe('dao');
  expect(v.tray()).toHaveLength(0);
});

it('未激活孤儿字让出高覆盖攻位给兵器', () => {
  // 「骨」占贴路高分格 (0,0)；射手在远位 (0,3) → 布阵后射手占前排，骨让到后排
  const v = new FakeView([], [
    { c: 0, r: 0 }, { c: 1, r: 0 }, { c: 0, r: 3 }, { c: 1, r: 3 },
  ]);
  v.wordsMap.set('0,0', { char: '骨', general: 'baigujing', cell: { c: 0, r: 0 }, tier: 1 });
  v.unitsMap.set('0,3', { type: 'archer', tier: 1, cell: { c: 0, r: 3 } });
  planAutoPlace(v, { rng });
  expect(v.unitsMap.get('0,0')?.type).toBe('archer');
  const gu = v.placedWords().find((w) => w.char === '骨');
  expect(gu).toBeDefined();
  expect(gu!.cell.r).toBeGreaterThan(0); // 不再贴路
  expect(v.wordsMap.has('0,0')).toBe(false);
});

it('孤儿字迁到更远离路径的空位', () => {
  const v = new FakeView([], [
    { c: 0, r: 0 }, { c: 7, r: 4 },
  ]);
  v.wordsMap.set('0,0', { char: '红', general: 'honghaier', cell: { c: 0, r: 0 }, tier: 1 });
  planAutoPlace(v, { rng });
  expect(v.wordsMap.get('7,4')?.char).toBe('红');
  expect(v.wordsMap.has('0,0')).toBe(false);
});

it('战中调位：兵与孤儿字互换以提升威胁/座位', () => {
  const v = new FakeRepositionView();
  // 射手在差位；骨占能打怪的好位
  v.unitsMap.set('0,3', { type: 'archer', tier: 1, cell: { c: 0, r: 3 } });
  v.wordsMap.set('5,0', { char: '骨', general: 'baigujing', cell: { c: 5, r: 0 }, tier: 1 });
  v.monsterCells = [{ c: 5, r: 0 }];
  expect(planBattleReposition(v).ok).toBe(true);
  expect(v.unitsMap.get('5,0')?.type).toBe('archer');
  expect(v.wordsMap.get('0,3')?.char).toBe('骨');
});

it('战中调位：前排高阶够不着时与后方低阶互换', () => {
  const v = new FakeRepositionView();
  v.unitsMap.set('0,0', { type: 'archer', tier: 3, cell: { c: 0, r: 0 } }); // 前排高阶，够不着
  v.unitsMap.set('5,0', { type: 'dao', tier: 1, cell: { c: 5, r: 0 } });     // 后方低阶，能打
  v.monsterCells = [{ c: 5, r: 0 }];
  expect(planBattleReposition(v).ok).toBe(true);
  const hi = v.unitsMap.get('5,0');
  const lo = v.unitsMap.get('0,0');
  expect(hi?.type).toBe('archer');
  expect(hi?.tier).toBe(3);
  expect(lo?.type).toBe('dao');
});

it('战中调位：空闲高阶挪到能打怪的空格', () => {
  const v = new FakeRepositionView();
  v.unitsMap.set('0,0', { type: 'spear', tier: 2, cell: { c: 0, r: 0 } });
  v.free = [{ c: 4, r: 0 }];
  v.monsterCells = [{ c: 4, r: 0 }];
  expect(planBattleReposition(v).ok).toBe(true);
  expect(v.unitsMap.has('4,0')).toBe(true);
  expect(v.unitsMap.has('0,0')).toBe(false);
});

it('无怪时假设出怪口有怪，仍可调位', () => {
  const v = new FakeRepositionView();
  v.unitsMap.set('5,0', { type: 'archer', tier: 3, cell: { c: 5, r: 0 } }); // 远，够不着出口
  v.unitsMap.set('0,0', { type: 'dao', tier: 1, cell: { c: 0, r: 0 } });   // 贴出口，能打
  v.monsterCells = [];
  v.entranceDist = 0; // 假路径出口在 (0,0)
  expect(planBattleReposition(v).ok).toBe(true);
  expect(v.unitsMap.get('0,0')?.type).toBe('archer');
  expect(v.unitsMap.get('5,0')?.type).toBe('dao');
});

it('战中调位：双方都能打到时不动作', () => {
  const v = new FakeRepositionView();
  v.unitsMap.set('0,0', { type: 'dao', tier: 1, cell: { c: 0, r: 0 } });
  v.unitsMap.set('1,0', { type: 'dao', tier: 1, cell: { c: 1, r: 0 } });
  v.monsterCells = [{ c: 0, r: 0 }, { c: 1, r: 0 }];
  expect(planBattleReposition(v).ok).toBe(false);
});

it('战中调位：不拆已激活武将格', () => {
  const v = new FakeRepositionView();
  v.unitsMap.set('0,0', { type: 'archer', tier: 3, cell: { c: 0, r: 0 } });
  v.unitsMap.set('5,0', { type: 'dao', tier: 1, cell: { c: 5, r: 0 } });
  v.heroCells.add('5,0');
  v.monsterCells = [{ c: 5, r: 0 }];
  expect(planBattleReposition(v).ok).toBe(false);
});

it('同一对位置不能连续 swap', () => {
  const v = new FakeRepositionView();
  v.unitsMap.set('0,0', { type: 'archer', tier: 3, cell: { c: 0, r: 0 } });
  v.unitsMap.set('5,0', { type: 'dao', tier: 1, cell: { c: 5, r: 0 } });
  v.monsterCells = [{ c: 5, r: 0 }];
  const r1 = planBattleReposition(v);
  expect(r1.ok).toBe(true);
  expect(r1.pair).toBeDefined();
  const r2 = planBattleReposition(v, { blockedPair: r1.pair });
  expect(r2.ok).toBe(false);
});

it('runBattleReposition 可连续多步', () => {
  const v = new FakeRepositionView();
  v.unitsMap.set('0,0', { type: 'archer', tier: 3, cell: { c: 0, r: 0 } });
  v.unitsMap.set('5,0', { type: 'dao', tier: 1, cell: { c: 5, r: 0 } });
  v.unitsMap.set('6,0', { type: 'spear', tier: 1, cell: { c: 6, r: 0 } });
  v.free = [{ c: 4, r: 0 }];
  v.monsterCells = [{ c: 4, r: 0 }, { c: 6, r: 0 }];
  const steps = runBattleReposition(v, 50);
  expect(steps).toBeGreaterThanOrEqual(1);
});

it('危险时：打不到的弓应换到能打到怪的枪位', () => {
  const v = new FakeRepositionView();
  v.dangerNearFlag = true;
  v.monsterDists = [7];
  // 怪在 (7,0)：枪 rge2 在 (4,0) 打不到，弓从枪位 rge3 打得到，从 (2,2) 打不到
  v.monsterCells = [{ c: 7, r: 0 }];
  v.unitsMap.set('4,0', { type: 'spear', tier: 2, cell: { c: 4, r: 0 } });
  v.unitsMap.set('2,2', { type: 'archer', tier: 1, cell: { c: 2, r: 2 } });
  v.wordsMap.set('2,3', { char: '沙', general: 'shaseng', cell: { c: 2, r: 3 }, tier: 1 });
  expect(planBattleReposition(v).ok).toBe(true);
  expect(v.unitsMap.get('4,0')?.type).toBe('archer');
  expect(v.unitsMap.get('2,2')?.type).toBe('spear');
});

it('危险时：两空闲兵不因贴路分来回对抖', () => {
  const v = new FakeRepositionView();
  v.dangerNearFlag = true;
  v.monsterDists = [7];
  v.monsterCells = [{ c: 7, r: 0 }]; // 双方都打不到
  v.unitsMap.set('0,0', { type: 'dao', tier: 2, cell: { c: 0, r: 0 } });
  v.unitsMap.set('4,0', { type: 'spear', tier: 2, cell: { c: 4, r: 0 } });
  expect(planBattleReposition(v).ok).toBe(false);
});

it('runBattleReposition 不会 A↔B 无限对抖', () => {
  const v = new FakeRepositionView();
  v.dangerNearFlag = true;
  v.monsterDists = [7];
  v.monsterCells = [{ c: 7, r: 0 }];
  v.unitsMap.set('0,0', { type: 'dao', tier: 2, cell: { c: 0, r: 0 } });
  v.unitsMap.set('4,0', { type: 'spear', tier: 2, cell: { c: 4, r: 0 } });
  const steps = runBattleReposition(v, 50);
  expect(steps).toBe(0);
});

it('危险时：同阶两刀已在交战不因贴路分互换', () => {
  const v = new FakeRepositionView();
  v.dangerNearFlag = true;
  v.monsterDists = [5, 6];
  v.monsterCells = [{ c: 5, r: 0 }, { c: 6, r: 0 }];
  v.unitsMap.set('5,0', { type: 'dao', tier: 1, cell: { c: 5, r: 0 } });
  v.unitsMap.set('2,0', { type: 'dao', tier: 1, cell: { c: 2, r: 0 } });
  expect(planBattleReposition(v).ok).toBe(false);
  expect(runBattleReposition(v, 50)).toBe(0);
});

it('危险时：高阶刀在右上角已优位时不与低阶互换', () => {
  const v = new FakeRepositionView();
  v.dangerNearFlag = true;
  v.monsterDists = [5, 6];
  v.monsterCells = [{ c: 5, r: 0 }, { c: 6, r: 0 }];
  v.unitsMap.set('5,0', { type: 'dao', tier: 2, cell: { c: 5, r: 0 } });
  v.unitsMap.set('2,0', { type: 'dao', tier: 1, cell: { c: 2, r: 0 } });
  expect(planBattleReposition(v).ok).toBe(false);
  expect(runBattleReposition(v, 50)).toBe(0);
});

it('危险时：低阶占优位时应与高阶刀互换一次', () => {
  const v = new FakeRepositionView();
  v.dangerNearFlag = true;
  v.monsterDists = [5];
  v.monsterCells = [{ c: 5, r: 0 }];
  v.unitsMap.set('5,0', { type: 'dao', tier: 1, cell: { c: 5, r: 0 } });
  v.unitsMap.set('2,0', { type: 'dao', tier: 2, cell: { c: 2, r: 0 } });
  expect(planBattleReposition(v).ok).toBe(true);
  expect(v.unitsMap.get('5,0')?.tier).toBe(2);
  expect(v.unitsMap.get('2,0')?.tier).toBe(1);
  expect(runBattleReposition(v, 50)).toBe(0);
});

it('危险时优先把兵力往怪物即将路过的路段调度', () => {
  const v = new FakeRepositionView();
  v.dangerNearFlag = true;
  v.monsterDists = [5];
  v.monsterCells = [{ c: 5, r: 0 }];
  v.unitsMap.set('0,0', { type: 'spear', tier: 2, cell: { c: 0, r: 0 } });
  v.free = [{ c: 5, r: 1 }];
  expect(planBattleReposition(v).ok).toBe(true);
  expect(v.unitsMap.has('5,1')).toBe(true);
});

it('dangerSeatBonus：沿路径更靠唐僧且欧氏更近则分更高', () => {
  expect(dangerSeatBonus(6, 2)).toBeGreaterThan(dangerSeatBonus(1, 8));
});

it('lowHpEngageMul：非危险或满血时不加权', () => {
  expect(lowHpEngageMul(100, 100, false)).toBe(1);
  expect(lowHpEngageMul(100, 100, true)).toBe(1);
  expect(lowHpEngageMul(50, 100, false, 'archer')).toBe(1);
});

it('lowHpEngageMul：危险时残血加权更高，弓兵额外加成', () => {
  const low = lowHpEngageMul(10, 100, true);
  const mid = lowHpEngageMul(50, 100, true);
  const archerLow = lowHpEngageMul(10, 100, true, 'archer');
  const spearLow = lowHpEngageMul(10, 100, true, 'spear');
  expect(low).toBeGreaterThan(mid);
  expect(archerLow).toBeGreaterThan(spearLow);
});

it('engageThreatAt：危险时覆盖残血怪的座位分更高', () => {
  const path = Array.from({ length: 8 }, (_, c) => ({ c, r: 0 }));
  const monsters: MonsterEngageLite[] = [
    { dist: 6, hp: 90, maxHp: 100 },
    { dist: 7, hp: 8, maxHp: 100 },
  ];
  const stat = getUnitStat('archer', 1);
  const near = engageThreatAt(monsters, path, 0, 3, 0, stat.rge, stat.atk, true, 'archer');
  const far = engageThreatAt(monsters, path, 0, 5, 0, stat.rge, stat.atk, true, 'archer');
  const nearSafe = engageThreatAt(monsters, path, 0, 3, 0, stat.rge, stat.atk, false, 'archer');
  expect(far).toBeGreaterThan(near);
  expect(far).toBeGreaterThan(nearSafe);
});

it('frontMonsterEngageWeight：最前怪权重高于队尾', () => {
  expect(frontMonsterEngageWeight(7, 7, 0)).toBeCloseTo(1, 5);
  expect(frontMonsterEngageWeight(6, 7, 0)).toBeLessThan(frontMonsterEngageWeight(7, 7, 0));
  expect(frontMonsterEngageWeight(0, 7, 0)).toBeCloseTo(0.15, 5);
});

it('entrancePathSeatBonus：同覆盖时更早接到出怪口分更高', () => {
  const map = mapById('huoyanshan');
  const ent = entranceDistance(map.path);
  const pathLen = lenOf(map.path);
  const rge = getUnitStat('archer', 1).rge;
  const nearEntrance = entrancePathSeatBonus(
    pathCoverageLenEntranceWeighted(map, ent, pathLen, 3, 7, rge),
    pathFirstEngageDist(map, ent, pathLen, 3, 7, rge),
    rge,
  );
  const farEntrance = entrancePathSeatBonus(
    pathCoverageLenEntranceWeighted(map, ent, pathLen, 4, 7, rge),
    pathFirstEngageDist(map, ent, pathLen, 4, 7, rge),
    rge,
  );
  expect(nearEntrance).toBeGreaterThan(farEntrance);
});

it('火焰山：无怪时弓优先落更早接到出怪口的格', () => {
  const b = new Battle(20260809, 1, mapById('huoyanshan'));
  const rge = getUnitStat('archer', 1).rge;
  b.grantPeach(999);
  b.tray.push({ kind: 'unit', type: 'archer', tier: 1 });
  b.autoPlaceTray();
  const archer = [...b.units.values()].find((u) => u.type === 'archer');
  expect(archer?.cell.c).toBeLessThanOrEqual(3);
  expect(pathFirstEngageDist(b.map, b.entranceDist, b.pathLen, archer!.cell.c, archer!.cell.r, rge)).toBeLessThan(3);
});

it('危险时：弓兵会前移以覆盖残血怪', () => {
  const v = new FakeRepositionView();
  v.dangerNearFlag = true;
  v.monsterDists = [6, 7];
  v.monsterEngage = [
    { dist: 6, hp: 90, maxHp: 100 },
    { dist: 7, hp: 8, maxHp: 100 },
  ];
  v.unitsMap.set('3,0', { type: 'archer', tier: 1, cell: { c: 3, r: 0 } });
  v.free = [{ c: 5, r: 0 }];
  expect(planBattleReposition(v).ok).toBe(true);
  expect(v.unitsMap.get('5,0')?.type).toBe('archer');
});

it('非危险时：弓兵已在交战位则不因残血加权前移', () => {
  const v = new FakeRepositionView();
  v.dangerNearFlag = false;
  v.monsterDists = [6, 7];
  v.monsterEngage = [
    { dist: 6, hp: 90, maxHp: 100 },
    { dist: 7, hp: 8, maxHp: 100 },
  ];
  v.unitsMap.set('3,0', { type: 'archer', tier: 1, cell: { c: 3, r: 0 } });
  v.free = [{ c: 5, r: 0 }];
  expect(planBattleReposition(v).ok).toBe(false);
  expect(v.unitsMap.get('3,0')?.type).toBe('archer');
});

it('危险时：已激活武将整体挪位以打到残血怪', () => {
  const v = new FakeRepositionView();
  v.dangerNearFlag = true;
  v.monsterDists = [5];
  v.monsterEngage = [{ dist: 5, hp: 6, maxHp: 100 }];
  v.heroRge = 2;
  v.heroAtk = 12;
  v.wordsMap.set('0,0', { char: '白', general: 'baigujing', cell: { c: 0, r: 0 }, tier: 1 });
  v.wordsMap.set('1,0', { char: '骨', general: 'baigujing', cell: { c: 1, r: 0 }, tier: 1 });
  v.heroCells.add('0,0');
  v.heroCells.add('1,0');
  v.heroPairs = [{ left: { c: 0, r: 0 }, right: { c: 1, r: 0 }, general: 'baigujing', tier: 1 }];
  v.free = [{ c: 4, r: 0 }, { c: 5, r: 0 }];
  expect(planBattleReposition(v).ok).toBe(true);
  expect(v.wordsMap.get('4,0')?.char).toBe('白');
  expect(v.wordsMap.get('5,0')?.char).toBe('骨');
});

it('rollAiAdjustInterval：兵器 1–2.5s、配对字 0.5–1s', () => {
  expect(rollAiAdjustInterval(false, () => 0)).toBe(AI_WEAPON_ADJUST_INTERVAL_MIN);
  expect(rollAiAdjustInterval(false, () => 1)).toBe(AI_WEAPON_ADJUST_INTERVAL_MAX);
  expect(rollAiAdjustInterval(true, () => 0)).toBe(AI_PARTNER_ADJUST_INTERVAL_MIN);
  expect(rollAiAdjustInterval(true, () => 1)).toBe(AI_PARTNER_ADJUST_INTERVAL_MAX);
});

it('boardMatePreferScore：铁优先配扇(满5)而非更高阶背(满3)', () => {
  expect(boardMatePreferScore('铁', { char: '扇', tier: 1 })).toBeGreaterThan(
    boardMatePreferScore('铁', { char: '背', tier: 5 }),
  );
});

it('tray铁：棋盘背阶高但仍优先与扇凑铁扇', () => {
  const v = new FakeView(
    [{ kind: 'word', char: '铁', general: 'tieshan', tier: 1 }],
    [{ c: 2, r: 5 }, { c: 4, r: 5 }, { c: 5, r: 5 }, { c: 6, r: 5 }],
  );
  v.wordsMap.set('3,5', { char: '背', general: 'tiebei', cell: { c: 3, r: 5 }, tier: 3 });
  v.wordsMap.set('5,5', { char: '扇', general: 'tieshan', cell: { c: 5, r: 5 }, tier: 1 });
  planAutoPlace(v, { rng });
  const tie = v.placedWords().find((w) => w.char === '铁');
  const shan = v.placedWords().find((w) => w.char === '扇');
  expect(tie).toBeDefined();
  expect(shan).toBeDefined();
  expect(tie!.cell.c + 1).toBe(shan!.cell.c);
  expect(tie!.cell.r).toBe(shan!.cell.r);
  expect(tie!.general).toBe('tieshan');
  expect(v.tray()).toHaveLength(0);
});

it('aiHeroPartnerAdjustPending：tray 有棋盘孤儿的配对字', () => {
  const v = new FakeView([], [{ c: 3, r: 5 }, { c: 4, r: 5 }]);
  v.wordsMap.set('3,5', { char: '铁', general: 'tieshan', cell: { c: 3, r: 5 }, tier: 1 });
  v.trayArr = [{ kind: 'word', char: '扇', general: 'tieshan', tier: 1 }];
  expect(aiHeroPartnerAdjustPending(v)).toBe(true);
});

it('aiHeroPartnerAdjustPending：仅有单字孤儿且无配对 tray 字时为 false', () => {
  const v = new FakeView([], [{ c: 3, r: 5 }]);
  v.wordsMap.set('3,5', { char: '铁', general: 'tieshan', cell: { c: 3, r: 5 }, tier: 1 });
  v.trayArr = [{ kind: 'unit', type: 'dao', tier: 1 }];
  expect(aiHeroPartnerAdjustPending(v)).toBe(false);
});

it('待处理：地图挤回 tray 的高阶兵换棋盘更低阶武器上板', () => {
  const v = new FakeView(
    [{ kind: 'unit', type: 'archer', tier: 2, displaced: true }],
    [],
  );
  v.unitsMap.set('2,2', { type: 'spear', tier: 1, cell: { c: 2, r: 2 } });
  v.unitsMap.set('4,2', { type: 'dao', tier: 1, cell: { c: 4, r: 2 } });
  planAutoPlaceSteps(v, { rng, maxSteps: 3 });
  expect(v.tray().some((t) => t.kind === 'unit' && t.displaced)).toBe(false);
  const archer = v.placedUnits().find((u) => u.type === 'archer' && u.tier === 2);
  expect(archer).toBeDefined();
});

it('第4波：铁背金吒已激活时 tray 红+牛应落入空格', () => {
  const cells: Cell[] = [];
  for (let c = 0; c < 8; c++) for (let r = 5; r < 10; r++) cells.push({ c, r });
  const v = new FakeView(
    [
      { kind: 'word', char: '红', general: 'honghaier', tier: 1 },
      { kind: 'word', char: '牛', general: 'niulang', tier: 1 },
    ],
    cells,
  );
  v.waveNum = 4;
  v.wordChars = (g: string) => {
    if (g === 'tiebei') return ['铁', '背'] as const;
    if (g === 'jinzha') return ['金', '吒'] as const;
    if (g === 'honghaier') return ['红', '孩'] as const;
    if (g === 'niulang') return ['牛', '郎'] as const;
    return undefined;
  };
  v.wordsMap.set('3,6', { char: '铁', general: 'tiebei', cell: { c: 3, r: 6 }, tier: 1 });
  v.wordsMap.set('4,6', { char: '背', general: 'tiebei', cell: { c: 4, r: 6 }, tier: 1 });
  v.wordsMap.set('3,7', { char: '金', general: 'jinzha', cell: { c: 3, r: 7 }, tier: 1 });
  v.wordsMap.set('4,7', { char: '吒', general: 'jinzha', cell: { c: 4, r: 7 }, tier: 1 });
  v.unitsMap.set('0,6', { type: 'archer', tier: 1, cell: { c: 0, r: 6 } });
  v.unitsMap.set('2,6', { type: 'dao', tier: 2, cell: { c: 2, r: 6 } });
  v.unitsMap.set('2,7', { type: 'dao', tier: 1, cell: { c: 2, r: 7 } });
  v.unitsMap.set('1,6', { type: 'cavalry', tier: 3, cell: { c: 1, r: 6 } });
  v.unitsMap.set('1,7', { type: 'cavalry', tier: 2, cell: { c: 1, r: 7 } });
  v.unitsMap.set('0,7', { type: 'spear', tier: 2, cell: { c: 0, r: 7 } });
  planAutoPlaceSteps(v, { rng, maxSteps: 150 });
  expect(v.placedWords().some((w) => w.char === '红')).toBe(true);
  expect(v.placedWords().some((w) => w.char === '牛')).toBe(true);
  expect(v.tray().some((t) => t.kind === 'word')).toBe(false);
});

it('第4波：棋盘 orphan 郎 + tray 牛待激活时不应阻塞 红 落位', () => {
  const cells: Cell[] = [];
  for (let c = 0; c < 8; c++) for (let r = 5; r < 10; r++) cells.push({ c, r });
  const v = new FakeView(
    [
      { kind: 'word', char: '红', general: 'honghaier', tier: 1 },
      { kind: 'word', char: '牛', general: 'niulang', tier: 1 },
    ],
    cells,
  );
  v.waveNum = 4;
  v.wordChars = (g: string) => {
    if (g === 'honghaier') return ['红', '孩'] as const;
    if (g === 'niulang') return ['牛', '郎'] as const;
    return undefined;
  };
  v.wordsMap.set('3,6', { char: '铁', general: 'tiebei', cell: { c: 3, r: 6 }, tier: 1 });
  v.wordsMap.set('4,6', { char: '背', general: 'tiebei', cell: { c: 4, r: 6 }, tier: 1 });
  v.wordsMap.set('3,7', { char: '金', general: 'jinzha', cell: { c: 3, r: 7 }, tier: 1 });
  v.wordsMap.set('4,7', { char: '吒', general: 'jinzha', cell: { c: 4, r: 7 }, tier: 1 });
  v.wordsMap.set('2,7', { char: '郎', general: 'niulang', cell: { c: 2, r: 7 }, tier: 1 });
  v.unitsMap.set('1,7', { type: 'dao', tier: 1, cell: { c: 1, r: 7 } });
  const steps = planAutoPlaceSteps(v, { rng, maxSteps: 150 });
  expect(steps).toBeGreaterThan(0);
  expect(v.placedWords().some((w) => w.char === '红')).toBe(true);
});

it('第4波：伴侣格被占时不应阻塞 orphan 单字落位', () => {
  const cells: Cell[] = [];
  for (let c = 0; c < 8; c++) for (let r = 5; r < 10; r++) cells.push({ c, r });
  const v = new FakeView(
    [
      { kind: 'word', char: '红', general: 'honghaier', tier: 1 },
      { kind: 'word', char: '牛', general: 'niulang', tier: 1 },
      { kind: 'word', char: '吒', general: 'jinzha', tier: 1 },
    ],
    cells,
  );
  v.waveNum = 4;
  v.wordChars = (g: string) => {
    if (g === 'jinzha') return ['金', '吒'] as const;
    if (g === 'honghaier') return ['红', '孩'] as const;
    if (g === 'niulang') return ['牛', '郎'] as const;
    return undefined;
  };
  v.wordsMap.set('3,6', { char: '金', general: 'jinzha', cell: { c: 3, r: 6 }, tier: 1 });
  v.unitsMap.set('4,6', { type: 'dao', tier: 1, cell: { c: 4, r: 6 } });
  planAutoPlaceSteps(v, { rng, maxSteps: 10 });
  expect(v.placedWords().some((w) => w.char === '红')).toBe(true);
  expect(v.placedWords().some((w) => w.char === '牛')).toBe(true);
});

it('第4波起：tray 字优先于 tray 兵种落子', () => {
  const v = new FakeView(
    [
      { kind: 'word', char: '红', general: 'honghaier', tier: 1 },
      { kind: 'unit', type: 'dao', tier: 1 },
    ],
    [{ c: 3, r: 5 }, { c: 4, r: 5 }],
  );
  v.waveNum = 4;
  planAutoPlaceSteps(v, { rng, maxSteps: 1 });
  expect(v.tray().some((t) => t.kind === 'word' && t.char === '红')).toBe(false);
  expect(v.placedWords().some((w) => w.char === '红')).toBe(true);
  expect(v.tray().some((t) => t.kind === 'unit' && t.type === 'dao')).toBe(true);
});

it('第4波起：有空格时 tray 重复字也上板', () => {
  const v = new FakeView(
    [{ kind: 'word', char: '红', general: 'honghaier', tier: 1 }],
    [{ c: 3, r: 5 }],
  );
  v.waveNum = 4;
  v.wordsMap.set('4,5', { char: '红', general: 'honghaier', cell: { c: 4, r: 5 }, tier: 1 });
  planAutoPlaceSteps(v, { rng, maxSteps: 5 });
  expect(v.placedWords().filter((w) => w.char === '红')).toHaveLength(2);
  expect(v.tray()).toHaveLength(0);
});

it('第4波起：tray白+棋盘龙待激活时 tray弓2应落到空位', () => {
  const cells = [
    { c: 2, r: 6 }, { c: 3, r: 6 }, { c: 4, r: 6 },
    { c: 0, r: 7 }, { c: 1, r: 7 },
  ];
  const v = new FakeView(
    [
      { kind: 'word', char: '白', general: 'bailong', tier: 1 },
      { kind: 'unit', type: 'spear', tier: 1 },
      { kind: 'unit', type: 'archer', tier: 2 },
    ],
    cells,
  );
  v.waveNum = 6;
  v.unitsMap.set('0,0', { type: 'dao', tier: 1, cell: { c: 0, r: 0 } });
  v.unitsMap.set('1,1', { type: 'spear', tier: 3, cell: { c: 1, r: 1 } });
  v.unitsMap.set('2,1', { type: 'spear', tier: 3, cell: { c: 2, r: 1 } });
  v.unitsMap.set('0,2', { type: 'cavalry', tier: 3, cell: { c: 0, r: 2 } });
  v.wordsMap.set('4,0', { char: '龙', general: 'bailong', cell: { c: 4, r: 0 }, tier: 1 });
  v.wordsMap.set('5,0', { char: '红', general: 'honghaier', cell: { c: 5, r: 0 }, tier: 1 });
  planAutoPlaceSteps(v, { rng, maxSteps: 5 });
  expect(v.placedUnits().some((u) => u.type === 'archer' && u.tier === 2)).toBe(true);
  expect(v.placedWords().some((w) => w.char === '白')).toBe(true);
  expect(v.tray()).toHaveLength(0);
});

it('第4波起：棋盘金+tray吒应激活金吒（右邻空）', () => {
  const cells = [
    { c: 0, r: 2 }, { c: 1, r: 2 }, { c: 2, r: 2 }, { c: 3, r: 2 },
    { c: 4, r: 2 }, { c: 5, r: 2 }, { c: 6, r: 2 },
    { c: 0, r: 3 }, { c: 1, r: 3 }, { c: 2, r: 3 }, { c: 3, r: 3 },
    { c: 4, r: 3 }, { c: 5, r: 3 }, { c: 6, r: 3 },
  ];
  const v = new FakeView(
    [
      { kind: 'word', char: '吒', general: 'jinzha', tier: 1 },
      { kind: 'unit', type: 'archer', tier: 2 },
      { kind: 'unit', type: 'spear', tier: 1 },
    ],
    cells,
  );
  v.waveNum = 6;
  v.wordChars = (g: string) => {
    if (g === 'jinzha') return ['金', '吒'] as const;
    if (g === 'hongpao') return ['红', '袍'] as const;
    if (g === 'bailong') return ['白', '龙'] as const;
    if (g === 'liusha') return ['流', '沙'] as const;
    if (g === 'fanyin') return ['梵', '音'] as const;
    return undefined;
  };
  v.wordsMap.set('0,2', { char: '白', general: 'bailong', cell: { c: 0, r: 2 }, tier: 2 });
  v.wordsMap.set('1,2', { char: '龙', general: 'bailong', cell: { c: 1, r: 2 }, tier: 2 });
  v.wordsMap.set('2,2', { char: '红', general: 'hongpao', cell: { c: 2, r: 2 }, tier: 2 });
  v.wordsMap.set('3,2', { char: '袍', general: 'hongpao', cell: { c: 3, r: 2 }, tier: 2 });
  v.wordsMap.set('4,2', { char: '金', general: 'jinzha', cell: { c: 4, r: 2 }, tier: 1 });
  v.wordsMap.set('0,3', { char: '流', general: 'liusha', cell: { c: 0, r: 3 }, tier: 1 });
  v.wordsMap.set('1,3', { char: '沙', general: 'liusha', cell: { c: 1, r: 3 }, tier: 1 });
  v.wordsMap.set('2,3', { char: '梵', general: 'fanyin', cell: { c: 2, r: 3 }, tier: 1 });
  v.wordsMap.set('3,3', { char: '音', general: 'fanyin', cell: { c: 3, r: 3 }, tier: 1 });
  v.unitsMap.set('5,3', { type: 'archer', tier: 3, cell: { c: 5, r: 3 } });
  planAutoPlaceSteps(v, { rng, maxSteps: 8 });
  const jin = v.placedWords().find((w) => w.char === '金');
  const zha = v.placedWords().find((w) => w.char === '吒');
  expect(jin).toBeDefined();
  expect(zha).toBeDefined();
  expect(jin!.cell.c + 1).toBe(zha!.cell.c);
  expect(jin!.cell.r).toBe(zha!.cell.r);
  expect(v.isActiveHeroCell(jin!.cell)).toBe(true);
  expect(matchGeneral(jin!.char, zha!.char)?.id).toBe('jinzha');
  expect(v.tray().some((t) => t.kind === 'word' && t.char === '吒')).toBe(false);
});

it('第4波起：棋盘金+tray吒右邻被占时应换兵激活金吒', () => {
  const cells = [
    { c: 3, r: 2 }, { c: 4, r: 2 }, { c: 5, r: 2 }, { c: 6, r: 2 },
    { c: 3, r: 3 }, { c: 4, r: 3 }, { c: 5, r: 3 }, { c: 6, r: 3 },
  ];
  const v = new FakeView(
    [{ kind: 'word', char: '吒', general: 'jinzha', tier: 1 }],
    cells,
  );
  v.waveNum = 6;
  v.wordChars = (g: string) => (g === 'jinzha' ? (['金', '吒'] as const) : undefined);
  v.wordsMap.set('4,2', { char: '金', general: 'jinzha', cell: { c: 4, r: 2 }, tier: 1 });
  v.unitsMap.set('5,2', { type: 'spear', tier: 4, cell: { c: 5, r: 2 } });
  planAutoPlaceSteps(v, { rng, maxSteps: 12 });
  const jin = v.placedWords().find((w) => w.char === '金');
  const zha = v.placedWords().find((w) => w.char === '吒');
  expect(jin).toBeDefined();
  expect(zha).toBeDefined();
  expect(jin!.cell.c + 1).toBe(zha!.cell.c);
  expect(v.isActiveHeroCell(jin!.cell)).toBe(true);
});

it('tray 弓2 满盘时异型替换更低阶枪1', () => {
  const cells = [
    { c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 },
    { c: 0, r: 1 }, { c: 1, r: 1 }, { c: 2, r: 1 }, { c: 3, r: 1 },
    { c: 0, r: 2 }, { c: 1, r: 2 }, { c: 2, r: 2 }, { c: 3, r: 2 },
  ];
  const v = new FakeView([{ kind: 'unit', type: 'archer', tier: 2 }], cells);
  v.unitsMap.set('0,0', { type: 'cavalry', tier: 3, cell: { c: 0, r: 0 } });
  v.unitsMap.set('1,0', { type: 'dao', tier: 2, cell: { c: 1, r: 0 } });
  v.unitsMap.set('2,0', { type: 'spear', tier: 3, cell: { c: 2, r: 0 } });
  v.unitsMap.set('3,0', { type: 'archer', tier: 3, cell: { c: 3, r: 0 } });
  v.unitsMap.set('0,1', { type: 'dao', tier: 3, cell: { c: 0, r: 1 } });
  v.unitsMap.set('1,1', { type: 'spear', tier: 2, cell: { c: 1, r: 1 } });
  v.unitsMap.set('2,1', { type: 'spear', tier: 3, cell: { c: 2, r: 1 } });
  v.unitsMap.set('3,1', { type: 'dao', tier: 2, cell: { c: 3, r: 1 } });
  v.unitsMap.set('0,2', { type: 'dao', tier: 3, cell: { c: 0, r: 2 } });
  v.unitsMap.set('1,2', { type: 'spear', tier: 2, cell: { c: 1, r: 2 } });
  v.unitsMap.set('2,2', { type: 'archer', tier: 3, cell: { c: 2, r: 2 } });
  v.unitsMap.set('3,2', { type: 'spear', tier: 1, cell: { c: 3, r: 2 } });
  planAutoPlaceSteps(v, { rng, maxSteps: 1 });
  expect(v.placedUnits().find((u) => u.type === 'archer' && u.tier === 2)?.cell).toEqual({ c: 3, r: 2 });
  expect(v.tray()).toContainEqual({ kind: 'unit', type: 'spear', tier: 1 });
});

it('异型高阶换低阶：不换场上唯一兵种', () => {
  const v = new FakeView(
    [{ kind: 'unit', type: 'archer', tier: 2 }],
    [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }],
  );
  v.unitsMap.set('0,0', { type: 'dao', tier: 1, cell: { c: 0, r: 0 } });
  v.unitsMap.set('1,0', { type: 'spear', tier: 1, cell: { c: 1, r: 0 } });
  planAutoPlaceSteps(v, { rng, maxSteps: 3 });
  expect(v.placedUnits().find((u) => u.type === 'archer' && u.tier === 2)?.cell).toEqual({ c: 2, r: 0 });
  expect(v.placedUnits().some((u) => u.type === 'dao')).toBe(true);
  expect(v.placedUnits().some((u) => u.type === 'spear')).toBe(true);
});
