// web/tests/autoplace.test.ts
import { describe, it, expect } from 'vitest';
import { planAutoPlace, type AutoPlaceView, type PlaceToken, type Cell } from '../src/autoplace';
import { getUnitStat } from '@core';

// —— 内存假视图：格按 c 坐标离路(第0行)越近越小；nearestPathDist = r（行号即离路距）——
class FakeView implements AutoPlaceView {
  trayArr: PlaceToken[];
  unlocked = new Set<string>();      // "c,r"
  unitsMap = new Map<string, { type: any; tier: number; cell: Cell }>();
  wordsMap = new Map<string, { char: string; general: string; cell: Cell }>();
  diggable: Cell[];
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
    this.wordsMap.set(k, { char: t.char, general: t.general, cell: to }); this.trayArr.splice(index, 1); return true;
  }
  moveUnit(from: Cell, to: Cell): boolean {
    const kf = this.key(from.c, from.r), kt = this.key(to.c, to.r);
    const u = this.unitsMap.get(kf); if (!u) return false;
    if (!this.unlocked.has(kt) || this.unitsMap.has(kt) || this.wordsMap.has(kt)) return false;
    this.unitsMap.delete(kf); u.cell = to; this.unitsMap.set(kt, u); return true;
  }
}
const rng = () => 0; // 恒 0：从不触发次优、farthest 取确定分支

it('不丢弃：无位可放的令牌保留在 tray', () => {
  const v = new FakeView(
    [{ kind: 'unit', type: 'monkey', tier: 1 }, { kind: 'unit', type: 'monkey', tier: 1 }],
    [{ c: 0, r: 0 }],
  );
  planAutoPlace(v, { rng });
  expect(v.tray().length).toBe(0);
  const u = v.placedUnits(); expect(u.length).toBe(1); expect(u[0]!.tier).toBe(2);
});

it('射程感知：短兵占近格，弓箭手占远格', () => {
  const v = new FakeView(
    [{ kind: 'unit', type: 'archer', tier: 1 }, { kind: 'unit', type: 'monkey', tier: 1 }],
    [{ c: 0, r: 0 }, { c: 0, r: 3 }],
  );
  planAutoPlace(v, { rng });
  const byCell = new Map(v.placedUnits().map((u) => [`${u.cell.c},${u.cell.r}`, u.type]));
  expect(byCell.get('0,0')).toBe('monkey');
  expect(byCell.get('0,3')).toBe('archer');
});

it('铲子优先挖最近锁定格', () => {
  const v = new FakeView([{ kind: 'shovel' }], [], [{ c: 0, r: 0 }, { c: 0, r: 5 }]);
  planAutoPlace(v, { rng });
  expect(v.freeCells().some((c) => c.r === 0)).toBe(true);
});

it('够不着(仅远格 + 无同阶合成)则保留在 tray，不浪费格', () => {
  const v = new FakeView([{ kind: 'unit', type: 'monkey', tier: 1 }], [{ c: 0, r: 3 }]);
  planAutoPlace(v, { rng });
  expect(v.tray().length).toBe(1);
  expect(v.placedUnits().length).toBe(0);
});

it('字牌按连读顺序放到能激活的相邻格', () => {
  const v = new FakeView([{ kind: 'word', char: '圣', general: 'g', tier: 1 }], [{ c: 2, r: 0 }]);
  v.wordsMap.set('1,0', { char: '大', general: 'g', cell: { c: 1, r: 0 } });
  v.unlocked.add('1,0');
  planAutoPlace(v, { rng });
  expect(v.placedWords().some((w) => w.char === '圣' && w.cell.c === 2 && w.cell.r === 0)).toBe(true);
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
  // 已解锁近格(0,0 r=0) 被 archer 占；远格(0,3 r=3) 空。tray 有 monkey(rge1) 够不着远格。
  // 期望：archer 挪到 0,3，monkey 落到 0,0。
  const v = new FakeView([{ kind: 'unit', type: 'monkey', tier: 1 }], [{ c: 0, r: 0 }, { c: 0, r: 3 }]);
  v.unitsMap.set('0,0', { type: 'archer', tier: 1, cell: { c: 0, r: 0 } });
  planAutoPlace(v, { rng });
  const byCell = new Map(v.placedUnits().map((u) => [`${u.cell.c},${u.cell.r}`, u.type]));
  expect(byCell.get('0,0')).toBe('monkey'); // 近格腾给短兵
  expect(byCell.get('0,3')).toBe('archer'); // 远程兵挪到远格
  expect(v.tray().length).toBe(0);          // 不丢弃
});

it('救援不误伤：不把射程更短的占位兵从近格赶走（占位兵射程<待放兵才不挪）', () => {
  // 近格(0,0)被 monkey(rge1)占；远格(0,3)空。tray 是 cavalry(rge1.5)，够不着远格。
  // cavalry 射程 > 占位 monkey，若挪走 monkey 反而把更该待在近格的短兵赶走 → 规则拒绝，cavalry 保留。
  const v = new FakeView([{ kind: 'unit', type: 'cavalry', tier: 1 }], [{ c: 0, r: 0 }, { c: 0, r: 3 }]);
  v.unitsMap.set('0,0', { type: 'monkey', tier: 1, cell: { c: 0, r: 0 } });
  planAutoPlace(v, { rng });
  const byCell = new Map(v.placedUnits().map((u) => [`${u.cell.c},${u.cell.r}`, u.type]));
  expect(byCell.get('0,0')).toBe('monkey'); // 短兵稳守近格，不被赶走
  expect(v.tray().length).toBe(1);          // cavalry 够不着，保留（不丢弃、不硬塞）
});
