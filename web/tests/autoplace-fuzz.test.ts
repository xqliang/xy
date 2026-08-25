/**
 * 布阵卡顿回归：满盘/英雄 + tray 放不下项时，autoPlaceTray 不应卡界面。
 *
 * 历史根因（2026-08）：收尾 sweepRemainingTrayDeploy 空转到 150 步——每步 planAutoPlaceSteps(maxSteps:1)
 * 只做棋盘布局微调（合并腾位/迁移换座，n=1 但 tray 不收缩），无跨步循环检测，点击布阵卡数百 ms。
 * 修复：sweep 按「tray 是否真少一件」判断，连续 3 步不收缩即停，并加绝对上限兜底。
 *
 * 本用例随机堆出含英雄组合/单字 + 放不下 tray 的沉重局面，断言最坏耗时低于卡顿阈值。
 */
import { describe, it, expect } from 'vitest';
import { Battle, makePlacedUnit } from '../src/battle';
import { mapById, isPlayerCell, isPathCell } from '../src/board';

const cellKey = (c: number, r: number) => `${c},${r}`;
const TYPES = ['dao', 'spear', 'archer', 'cavalry'] as const;
const MAPS = ['huoyanshan', 'baiguling', 'liushahe', 'pansidong'];
const HERO_PAIRS: [string, string, string][] = [
  ['二', '郎', 'erlang'], ['哪', '吒', 'nezha'], ['大', '圣', 'dasheng'],
  ['八', '戒', 'bajie'], ['铁', '扇', 'tieshan'], ['沙', '僧', 'shaseng'],
  ['观', '音', 'guanyin'], ['太', '白', 'taibai'], ['牛', '魔', 'niumowang'],
];
const HERO_CHARS = ['哪', '吒', '大', '圣', '二', '郎', '八', '戒', '铁', '扇', '沙', '僧', '观', '音', '太', '白', '牛', '魔', '金', '红', '孩'];
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

function randomBoard(b: Battle, seed: number, fillRatio: number, trayN: number) {
  const r = rng(seed);
  const m = b.map;
  const placeable: { c: number; r: number }[] = [];
  for (let c = 0; c < 8; c++) for (let rr = 5; rr < 10; rr++)
    if (isPlayerCell(m, c, rr) && !isPathCell(m, c, rr)) placeable.push({ c, rr });
  for (const p of placeable) (b as unknown as { unlocked: Set<string> }).unlocked.add(cellKey(p.c, p.rr));
  let pi = 0;
  const pairs = 1 + Math.floor(r() * 3);
  for (let k = 0; k < pairs && pi + 1 < placeable.length; k++) {
    const a = placeable[pi++]!, right = placeable[pi++]!;
    if (right.c === a.c + 1 && right.rr === a.rr) {
      const [lc, rc, g] = HERO_PAIRS[Math.floor(r() * HERO_PAIRS.length)]!;
      b.words.set(cellKey(a.c, a.rr), { char: lc, general: g, tier: 1 + Math.floor(r() * 3), cell: { c: a.c, r: a.rr } });
      b.words.set(cellKey(right.c, right.rr), { char: rc, general: g, tier: 1 + Math.floor(r() * 3), cell: { c: right.c, r: right.rr } });
    }
  }
  const orphans = 1 + Math.floor(r() * 3);
  for (let k = 0; k < orphans && pi < placeable.length; k++) {
    const p = placeable[pi++]!;
    const ch = HERO_CHARS[Math.floor(r() * HERO_CHARS.length)]!;
    b.words.set(cellKey(p.c, p.rr), { char: ch, general: 'x', tier: 1, cell: { c: p.c, r: p.rr } });
  }
  for (; pi < placeable.length; pi++) {
    const p = placeable[pi]!;
    if (r() < fillRatio) {
      const type = TYPES[Math.floor(r() * 4)];
      const tier = 1 + Math.floor(r() * 5);
      b.units.set(cellKey(p.c, p.rr), makePlacedUnit(type, tier, { c: p.c, r: p.rr }, { c: 0, r: 5 }));
    }
  }
  const tray = [];
  for (let i = 0; i < trayN; i++) {
    if (r() < 0.5) tray.push({ kind: 'unit' as const, type: TYPES[Math.floor(r() * 4)], tier: 1 + Math.floor(r() * 3) });
    else { const ch = HERO_CHARS[Math.floor(r() * HERO_CHARS.length)]!; tray.push({ kind: 'word' as const, char: ch, general: 'x', tier: 1 }); }
  }
  b.tray = tray;
  b.status = 'playing'; b.wave = 6;
  b.monsters.push({ id: 1, hp: 8000, maxHp: 8000, dist: b.pathLen - 6, spd: 0.4, side: 'player' } as never);
}

describe('布阵卡顿回归（含英雄）', () => {
  it('200 个随机沉重局面最坏耗时低于卡顿阈值', () => {
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const mapId = MAPS[i % MAPS.length]!;
      const b = new Battle(1000 + i, 1, mapById(mapId));
      randomBoard(b, i, 0.4 + (i % 6) * 0.11, 1 + (i % 5));
      const t0 = performance.now();
      b.autoPlaceTray();
      worst = Math.max(worst, performance.now() - t0);
      b.flushAutoPlacePlaybackForTest();
    }
    // 修复前此 fuzz 最坏 ~291ms（sweep 空转 150 步）；修复后应远低于此。
    // 阈值取 200ms：仍远低于冻结卡顿区间，留余量容纳不同功能叠加后的较重盘面（当前最坏 ~150ms）。
    expect(worst).toBeLessThan(200);
  });
});
