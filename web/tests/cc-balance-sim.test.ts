// 控制强度分析模拟（临时诊断工具，非回归测试）：
// 问题：英雄控制（定身/击退/减速）结合各自 CD 是否过强？
// 方法：同地图同摆放位（按路径覆盖贪心选 5 对格，两套阵容共用），
// 三套阵容（纯控制/纯输出+观音/混合）各跑多 seed 到战败，
// 逐波记录：通关用时、唐僧掉血、怪物被定身/减速的时间覆盖率。
// 结论看 console 输出（不断言）。
import { describe, it } from 'vitest';
import { Battle, makePlacedUnit } from '../src/battle';
import { MAPS, isEitherPathCell, isPlayerCell } from '../src/board';
import { GENERALS } from '../src/generals';

const cellKey = (c: number, r: number) => `${c},${r}`;

const LINEUPS: Record<string, string[]> = {
  // 纯控制 5 主力：双定身 + 双击退 + 减速（基础 atk 全在 3.9~5.7 的低档）
  控制5: ['bajie', 'niumowang', 'tieshan', 'shaseng', 'bailong'],
  // 纯输出 4 主力 + 观音辅助（基础 atk 4.2~6.0 高档）
  输出4加观音: ['dasheng', 'erlang', 'nezha', 'honghaier', 'guanyin'],
  // 混合（接近实战阵容）：2 输出 + 2 控制 + 1 辅助
  混合: ['dasheng', 'erlang', 'bajie', 'tieshan', 'guanyin'],
  // —— 同上，但全员配同一套满5兵器（CC 会放大兵器输出：怪被控得越久兵器打越久）——
  控制5加兵器: ['bajie', 'niumowang', 'tieshan', 'shaseng', 'bailong'],
  输出4加兵器: ['dasheng', 'erlang', 'nezha', 'honghaier', 'guanyin'],
  混合加兵器: ['dasheng', 'erlang', 'bajie', 'tieshan', 'guanyin'],
};
/** 带「加兵器」后缀的阵容补同一套满5兵器（4 兵种各一 + 补一枪），同格摆放保证公平。 */
const WITH_WEAPONS = (name: string) => name.includes('加兵器');

/** 路径覆盖贪心：玩家半场非路径格里选覆盖路径最多的 5 对横排格（武将）+ 5 个单格（兵器）。
 *  两套阵容共用同一组格子，保证公平。 */
function pickPlacements(b: Battle): { pairs: { l: { c: number; r: number }; r: { c: number; r: number } }[]; weaponCells: { c: number; r: number }[] } {
  const path = b.map.path;
  const score = (c: number, r: number) =>
    path.filter((p) => Math.hypot(p.c - (c + 0.5), p.r - r) <= 2.5).length;
  const cands: { c: number; r: number; s: number }[] = [];
  for (let r = 5; r < 10; r++) {
    for (let c = 0; c < 8; c++) {
      if (isEitherPathCell(b.map, c, r)) continue;
      if (!isPlayerCell(b.map, c, r)) continue;
      cands.push({ c, r, s: score(c, r) });
    }
  }
  cands.sort((a, b2) => b2.s - a.s);
  const used = new Set<string>();
  const pairs: { l: { c: number; r: number }; r: { c: number; r: number } }[] = [];
  for (const cand of cands) {
    const right = cands.find((x) => x.c === cand.c + 1 && x.r === cand.r);
    if (!right) continue;
    const k1 = cellKey(cand.c, cand.r), k2 = cellKey(right.c, right.r);
    if (used.has(k1) || used.has(k2)) continue;
    used.add(k1); used.add(k2);
    pairs.push({ l: { c: cand.c, r: cand.r }, r: { c: right.c, r: right.r } });
    if (pairs.length === 5) break;
  }
  const weaponCells: { c: number; r: number }[] = [];
  for (const cand of cands) {
    const k = cellKey(cand.c, cand.r);
    if (used.has(k)) continue;
    used.add(k);
    weaponCells.push({ c: cand.c, r: cand.r });
    if (weaponCells.length === 5) break;
  }
  return { pairs, weaponCells };
}

function placeGenerals(b: Battle, ids: string[], withWeapons: boolean): void {
  const { pairs, weaponCells } = pickPlacements(b);
  const unlocked = (b as unknown as { unlocked: Set<string> }).unlocked;
  ids.forEach((id, i) => {
    const def = GENERALS.find((d) => d.id === id)!;
    const p = pairs[i]!;
    unlocked.add(cellKey(p.l.c, p.l.r));
    unlocked.add(cellKey(p.r.c, p.r.r));
    b.words.set(cellKey(p.l.c, p.l.r), { char: def.chars[0]!, general: id, tier: def.maxTier, cell: p.l });
    b.words.set(cellKey(p.r.c, p.r.r), { char: def.chars[1]!, general: id, tier: def.maxTier, cell: p.r });
  });
  if (withWeapons) {
    // 同一套满5兵器（近远程混编）摆在同一组格，控制/输出阵容间唯一差异仍是武将构成
    const types = ['dao', 'spear', 'archer', 'cavalry', 'spear'] as const;
    types.forEach((type, i) => {
      const cell = weaponCells[i]!;
      unlocked.add(cellKey(cell.c, cell.r));
      b.units.set(cellKey(cell.c, cell.r), makePlacedUnit(type, 5, cell, { c: cell.c, r: Math.max(0, cell.r - 1) }));
    });
  }
}

interface WaveStat {
  wave: number; secs: number; hpLost: number;
  stunUptime: number; slowUptime: number; boss: boolean; lost: boolean; stalled: boolean;
}

function runOne(lineup: string[], seed: number, waveCap: number, withWeapons: boolean): WaveStat[] {
  // 无尽模式：无 AI 对手（否则对手第 1 波就死、status='won' 提前终局），纯测阵容生存能力
  const b = new Battle(seed, 1, MAPS[0]!, undefined, {}, [], [], true);
  placeGenerals(b, lineup, withWeapons);
  b.grantPeach(999, true); // 经济不设限：纯比阵容强度
  const stats: WaveStat[] = [];
  while (b.wave < waveCap && b.status !== 'lost') {
    b.startNextWave();
    const hpBefore = b.tangsengHP;
    let t = 0;
    let stunSamples = 0, slowSamples = 0, monSamples = 0;
    let lost = false;
    while (b.waveActive && t < 600) {
      b.step(1 / 30);
      b.sfxEvents.length = 0; // 主循环里每帧清，sim 里也要清（否则无界增长）
      t += 1 / 30;
      for (const m of b.monsters) {
        monSamples++;
        if (m.stunT > 0) stunSamples++;
        if (m.slowT > 0) slowSamples++;
      }
      if (b.status === 'lost') { lost = true; break; }
    }
    // 600s 仍清不掉：既没死也没输 → 怪被钉死/输出不足，判「停滞」直接结束本局
    //（这正是控制强度的关键信号：停滞=该阵容理论上永远打不死也永远不会输）
    const stalled = !lost && b.waveActive && t >= 600;
    const boss = b.monsters.some((m) => m.isBoss);
    stats.push({
      wave: b.wave,
      secs: +t.toFixed(1),
      hpLost: hpBefore - b.tangsengHP,
      stunUptime: monSamples ? +(stunSamples / monSamples).toFixed(2) : 0,
      slowUptime: monSamples ? +(slowSamples / monSamples).toFixed(2) : 0,
      boss,
      lost,
      stalled,
    });
    if (lost || stalled) break;
  }
  // eslint-disable-next-line no-console
  console.log(`[runOne ${lineup[0]} seed=${seed}] waves=${stats.length} last=${JSON.stringify(stats[stats.length - 1] ?? null)} finalStatus=${b.status} finalWave=${b.wave}`);
  return stats;
}

describe('控制强度分析（定身/击退/减速 vs CD）', () => {
  // 手动诊断工具：CC_SIM=1 npx vitest run tests/cc-balance-sim.test.ts
  // 默认 skip（要跑几分钟），不进常规门禁。
  it.runIf(process.env.CC_SIM === '1')('三阵容多 seed 对比', () => {
    const seeds = (process.env.CC_SEEDS ?? "7,101,202").split(",").map(Number);
    const waveCap = 32;
    const report: Record<string, { waves: number; totalTime: number; totalHpLost: number; stun: number; slow: number; losses: number; waveDetail: Record<number, { t: number; hp: number; stun: number; slow: number; n: number }> }> = {};
    for (const [name, lineup] of Object.entries(LINEUPS)) {
      const agg = { waves: 0, totalTime: 0, totalHpLost: 0, stun: 0, slow: 0, losses: 0, stalls: 0, wins: 0, waveDetail: {} as Record<number, { t: number; hp: number; stun: number; slow: number; n: number }> };
      for (const seed of seeds) {
        const stats = runOne(lineup, seed, waveCap, WITH_WEAPONS(name));
        const last = stats[stats.length - 1];
        if (last?.lost) agg.losses++;
        if (last?.stalled) agg.stalls++;
        if (!last?.lost && !last?.stalled && stats.length >= waveCap) agg.wins++;
        agg.waves += stats.filter((s) => !s.lost && !s.stalled).length;
        for (const s of stats) {
          agg.totalTime += s.secs;
          agg.totalHpLost += s.hpLost;
          agg.stun += s.stunUptime;
          agg.slow += s.slowUptime;
          const d = (agg.waveDetail[s.wave] ??= { t: 0, hp: 0, stun: 0, slow: 0, n: 0 });
          d.t += s.secs; d.hp += s.hpLost; d.stun += s.stunUptime; d.slow += s.slowUptime; d.n++;
        }
      }
      report[name] = agg;
    }
    const rows = Object.entries(report).map(([name, a]) => {
      const games = seeds.length;
      const wavesPerGame = a.waves / games;
      return {
        阵容: name,
        平均到达波次: +wavesPerGame.toFixed(1),
        战败次数: `${a.losses}/${games}`,
        停滞次数: `${a.stalls}/${games}`,
        平均每波用时: +(a.totalTime / (games * waveCap)).toFixed(1),
        平均每波唐僧掉血: +(a.totalHpLost / (games * waveCap)).toFixed(2),
        定身覆盖率均值: +(a.stun / (games * waveCap)).toFixed(2),
        减速覆盖率均值: +(a.slow / (games * waveCap)).toFixed(2),
      };
    });
    console.log('\n=== 阵容对比（3 seed × 最多32波，同摆放位/同经济/难度1） ===');
    console.table(rows);
    for (const [name, a] of Object.entries(report)) {
      const detail = Object.entries(a.waveDetail).slice(0, 32).map(([w, d]) => ({
        波: w, 用时: +(d.t / d.n).toFixed(1), 掉血: +(d.hp / d.n).toFixed(1),
        定身: +(d.stun / d.n).toFixed(2), 减速: +(d.slow / d.n).toFixed(2),
      }));
      console.log(`\n=== ${name} 逐波明细（均值） ===`);
      console.table(detail);
    }
  }, 600_000);
});
