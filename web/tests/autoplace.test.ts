// web/tests/autoplace.test.ts
import { it, expect } from 'vitest';
import {
  planAutoPlace,
  digPriorityScore,
  mergeKeepScore,
  placeCellScore,
  seatScore,
  placeExitWeight,
  singleWordScore,
  type AutoPlaceView,
  type PlaceToken,
  type Cell,
} from '../src/autoplace';
import { getUnitStat } from '@core';

// —— 内存假视图：格按 c 坐标离路(第0行)越近越小；nearestPathDist = r（行号即离路距）——
// 唐僧在 (7,5)：单字偏好高 r（远路）且靠近 (7,5)
class FakeView implements AutoPlaceView {
  trayArr: PlaceToken[];
  unlocked = new Set<string>();      // "c,r"
  unitsMap = new Map<string, { type: any; tier: number; cell: Cell }>();
  wordsMap = new Map<string, { char: string; general: string; cell: Cell; tier: number }>();
  diggable: Cell[];
  generalRgeVal = 2;
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
  pathCover(cell: Cell, type: any, tier: number) {
    return Math.max(0, getUnitStat(type, tier).rge - this.nearestPathDist(cell) + 1);
  }
  pathCoverAt(ax: number, ay: number, rge: number) {
    // 中点越靠近路(ay 小)且越靠近出口(ax 小)覆盖越高
    return Math.max(0, rge - ay + 1) + Math.max(0, 3 - ax) * 0.1;
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
      if (ex) { if (ex.type !== t.type || ex.tier !== t.tier) return false; ex.tier += 1; this.trayArr.splice(index, 1); return true; }
      if (!this.unlocked.has(k) || this.wordsMap.has(k)) return false;
      this.unitsMap.set(k, { type: t.type, tier: t.tier, cell: to }); this.trayArr.splice(index, 1); return true;
    }
    // word
    const ex = this.wordsMap.get(k);
    if (ex) { if (ex.char === t.char) { this.trayArr.splice(index, 1); return true; } return false; }
    if (!this.unlocked.has(k) || this.unitsMap.has(k)) return false;
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
  moveWord(from: Cell, to: Cell): boolean {
    const kf = this.key(from.c, from.r), kt = this.key(to.c, to.r);
    const w = this.wordsMap.get(kf); if (!w) return false;
    if (!this.unlocked.has(kt) || this.unitsMap.has(kt) || this.wordsMap.has(kt)) return false;
    this.wordsMap.delete(kf); w.cell = to; this.wordsMap.set(kt, w); return true;
  }
  isActiveHeroCell(cell: Cell): boolean {
    const w = this.wordsMap.get(this.key(cell.c, cell.r));
    if (!w) return false;
    const chars = this.wordChars(w.general);
    if (!chars) return false;
    if (w.char === chars[0]) {
      const r = this.wordsMap.get(this.key(cell.c + 1, cell.r));
      return !!(r && r.char === chars[1] && r.general === w.general);
    }
    if (w.char === chars[1]) {
      const l = this.wordsMap.get(this.key(cell.c - 1, cell.r));
      return !!(l && l.char === chars[0] && l.general === w.general);
    }
    return false;
  }
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

it('够不着(仅远格 + 无同阶合成)则保留在 tray，不浪费格', () => {
  const v = new FakeView([{ kind: 'unit', type: 'dao', tier: 1 }], [{ c: 0, r: 3 }]);
  planAutoPlace(v, { rng });
  expect(v.tray().length).toBe(1);
  expect(v.placedUnits().length).toBe(0);
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

it('激活武将：邻格被武器占时可挪开再落字', () => {
  // 「大」在 (1,0)；最优对为 (0,0)-(1,0)。可把「大」迁到 (0,0)，「圣」落 (1,0)；
  // 若落在 (1,0)-(2,0) 则需挪开 (2,0) 的 dao。
  const v = new FakeView(
    [{ kind: 'word', char: '圣', general: 'g', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }],
  );
  v.wordsMap.set('1,0', { char: '大', general: 'g', cell: { c: 1, r: 0 }, tier: 1 });
  v.unitsMap.set('2,0', { type: 'dao', tier: 1, cell: { c: 2, r: 0 } });
  planAutoPlace(v, { rng });
  const byChar = new Map(v.placedWords().map((w) => [w.char, w.cell]));
  expect(byChar.get('大')).toEqual({ c: 0, r: 0 });
  expect(byChar.get('圣')).toEqual({ c: 1, r: 0 });
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

it('救援式重排：远程兵占着近格挡住短兵 → 挪远程兵到远格、腾近格给短兵', () => {
  // 已解锁近格(0,0 r=0) 被 archer 占；远格(0,3 r=3) 空。tray 有 dao(rge1) 够不着远格。
  // 期望：archer 挪到 0,3，dao 落到 0,0。
  const v = new FakeView([{ kind: 'unit', type: 'dao', tier: 1 }], [{ c: 0, r: 0 }, { c: 0, r: 3 }]);
  v.unitsMap.set('0,0', { type: 'archer', tier: 1, cell: { c: 0, r: 0 } });
  planAutoPlace(v, { rng });
  const byCell = new Map(v.placedUnits().map((u) => [`${u.cell.c},${u.cell.r}`, u.type]));
  expect(byCell.get('0,0')).toBe('dao'); // 近格腾给短兵
  expect(byCell.get('0,3')).toBe('archer'); // 远程兵挪到远格
  expect(v.tray().length).toBe(0);          // 不丢弃
});

it('救援不误伤：不把射程更短的占位兵从近格赶走（占位兵射程<待放兵才不挪）', () => {
  // 近格(0,0)被 dao(rge1)占；远格(0,3)空。tray 是 cavalry(rge1.5)，够不着远格。
  // cavalry 射程 > 占位 dao，若挪走 dao 反而把更该待在近格的短兵赶走 → 规则拒绝，cavalry 保留。
  const v = new FakeView([{ kind: 'unit', type: 'cavalry', tier: 1 }], [{ c: 0, r: 0 }, { c: 0, r: 3 }]);
  v.unitsMap.set('0,0', { type: 'dao', tier: 1, cell: { c: 0, r: 0 } });
  planAutoPlace(v, { rng });
  const byCell = new Map(v.placedUnits().map((u) => [`${u.cell.c},${u.cell.r}`, u.type]));
  expect(byCell.get('0,0')).toBe('dao'); // 短兵稳守近格，不被赶走
  expect(v.tray().length).toBe(1);          // cavalry 够不着，保留（不丢弃、不硬塞）
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
