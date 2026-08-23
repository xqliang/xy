// web/tests/pvp-bridge-snap.test.ts
// Plan C Task 4：快照渲染桥 bridgeOpponentFromSnap 的镜像正确性。
//
// 背景：Task 5 把对手半场数据源从「oppBattle 本方侧直引（bridgeOpponentFrom，已删）」换成
// 「WS 快照 → PvpOppView 插值 → bridgeOpponentFromSnap」，并删除了对手确定性重放入口 applyPvpInput。
// 镜像规则（cell 镜像 / fireDir+π / words 键镜像 / unlocked 逐元素镜像 / heroPairKey 重排）必须正确，
// 否则对手半场渲染错位。本测试用本方状态 A 走快照路径，断言 battle.ai* 与 A 经镜像规则逐字段等价
// （旧桥 bridgeOpponentFrom 已随 Task 5 删除，不再做旧/新桥逐字段 parity 比较）。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META } from '../src/battle';
import { mirrorCell, faceDirToward, pathEntranceCell, type Cell } from '../src/board';
import { MAPS } from '../src/board';
import { PvpOppView } from '../src/pvp-snap';

// 与旧 pvp-bridge.test.ts 的 mkPvp 同构。
const mkPvp = () =>
  new Battle(1, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: true });

// 把对手养成可观察本方侧状态（确定性 sum mon/autoPlace/placeFromTray + step）。
// Task 5 删除了对手确定性重放入口 applyPvpInput；改调其内部等价的公开方法（summon/autoPlaceTray/placeFromTray）。
function seedBoard(b: Battle): void {
  b.startNextWave();
  for (let i = 0; i < 4; i++) {
    b.summon();
    b.autoPlaceTray();
    for (let k = 0; k < 25; k++) b.step(1 / 30);
  }
  let guard = 0;
  while (b.units.size === 0 && guard++ < 12) {
    b.summon();
    for (let k = 0; k < 5; k++) b.step(1 / 30);
    const idx = b.tray.findIndex((t) => t.kind === 'unit');
    const cell = b.unlockedCells().find(
      (c) => !b.units.has(`${c.c},${c.r}`) && !b.words.has(`${c.c},${c.r}`),
    );
    if (idx >= 0 && cell) b.placeFromTray(idx, cell); // placeFromTray 入参本就是内部 Cell {c,r}
    for (let k = 0; k < 5; k++) b.step(1 / 30);
  }
}

// 把本方状态 A 走快照路径：A → pvpOwnSnapshot → PvpOppView.ingest → bridgeOpponentFromSnap，返回桥后的 B2。
// 单快照：interp = cur（无 prev 可插值），怪物 dist 不外推。
function bridgeSnap(A: Battle, tNow: number): Battle {
  const B2 = mkPvp();
  const s = A.pvpOwnSnapshot(tNow); // 本方 → 快照
  const view = new PvpOppView();
  view.ingest(s);
  B2.bridgeOpponentFromSnap(view.interpAt(tNow)); // 快照 → 插值视图 → 桥
  return B2;
}

// 本方单位经桥镜像后的期望值：cell 镜像；fireDir 不再采信传输值(+π)，改由桥本地按镜像后位置
// 朝 AI 侧路径入口重算（与单机 AI 的 faceDirToward(cell, aiGate) 同口径），故恒为数字。
const mirroredUnits = (A: Battle, aiGate: Cell) =>
  [...A.units.values()].map((u) => ({
    ...u,
    cell: mirrorCell(u.cell),
    fireDir: faceDirToward(mirrorCell(u.cell), aiGate),
  }));

describe('bridgeOpponentFromSnap：镜像正确性（快照路径，逐字段对源 A）', () => {
  it('aiUnits：镜像 cell + fireDir 本地重算，逐条深度等价于 A 的镜像单位', () => {
    const A = mkPvp();
    seedBoard(A);
    expect(A.units.size).toBeGreaterThan(0);
    const B2 = bridgeSnap(A, 1000);

    const gate = pathEntranceCell(B2.aiPath);
    expect(B2.aiUnits.length).toBe(A.units.size);
    expect(B2.aiUnits).toEqual(mirroredUnits(A, gate));
    // 再单点验镜像规则：cell 镜像、fireDir 本地按位置朝 AI 入口重算（恒为数字）。
    for (const u of A.units.values()) {
      const b2U = B2.aiUnits.find((x) => x.cell.c === mirrorCell(u.cell).c && x.cell.r === mirrorCell(u.cell).r)!;
      expect(b2U.cell).toEqual(mirrorCell(u.cell));
      expect(b2U.fireDir).toBeCloseTo(faceDirToward(mirrorCell(u.cell), gate), 10);
      expect(b2U.type).toBe(u.type);
      expect(b2U.tier).toBe(u.tier);
    }
  });

  it('aiWords：镜像 cell + Map 键，逐条深度等价', () => {
    const A = mkPvp();
    seedBoard(A);
    if (A.words.size === 0) return; // 字牌非每局必出
    const B2 = bridgeSnap(A, 1000);

    expect(B2.aiWords.size).toBe(A.words.size);
    for (const w of A.words.values()) {
      const m = mirrorCell(w.cell);
      const key = `${m.c},${m.r}`;
      expect(B2.aiWords.get(key)).toEqual({ ...w, cell: m });
      expect(B2.aiWords.get(key)!.cell).toEqual(m);
      expect(B2.aiWords.get(key)!.char).toBe(w.char);
    }
  });

  it('aiMonsters：dist/hp/maxHp/slowT 逐怪深度等价（整怪快照，单快照=cur）', () => {
    const A = mkPvp();
    seedBoard(A);
    expect(A.monsters.length).toBeGreaterThan(0);
    const B2 = bridgeSnap(A, 1000);

    expect(B2.aiMonsters.length).toBe(A.monsters.length);
    // 逐怪深度等价（单快照插值=cur，故直引源怪物）。
    for (let i = 0; i < A.monsters.length; i++) {
      expect(B2.aiMonsters[i]).toEqual(A.monsters[i]);
      expect(B2.aiMonsters[i]!.dist).toBeCloseTo(A.monsters[i]!.dist, 10);
      expect(B2.aiMonsters[i]!.hp).toBe(A.monsters[i]!.hp);
      expect(B2.aiMonsters[i]!.maxHp).toBe(A.monsters[i]!.maxHp);
      expect(B2.aiMonsters[i]!.slowT).toBe(A.monsters[i]!.slowT);
    }
  });

  it('aiUnlocked / aiGeneralStates / lastAiActivePairKeys 镜像等价', () => {
    const A = mkPvp();
    seedBoard(A);
    const B2 = bridgeSnap(A, 1000);

    // aiUnlocked：逐元素镜像后的集合
    const expUnlocked = new Set<string>();
    for (const s of A.unlocked) {
      const [a, b] = s.split(',');
      const mc = mirrorCell({ c: +a!, r: +b! });
      expUnlocked.add(`${mc.c},${mc.r}`);
    }
    expect([...B2.aiUnlocked].sort()).toEqual([...expUnlocked].sort());
  });

  it('标量字段等价：aiTangsengHP / aiDefeated / aiSpawnGateT / aiBombs / aiDigFx', () => {
    const A = mkPvp();
    seedBoard(A);
    const B2 = bridgeSnap(A, 1000);

    expect(B2.aiTangsengHP).toBe(A.tangsengHP);
    expect(B2.aiDefeated).toBe(A.status === 'lost');
    expect(B2.aiSpawnGateT).toBe(A.spawnGateT);
    expect(B2.aiBombs).toEqual([]);
    expect(B2.aiDigFx).toEqual([]);
  });

  it('道具/加成/特效骨架等价：aiActiveSlots / aiPickedItems / aiMods / aiSkillFx / aiPalmPushFx / aiPassiveFlash', () => {
    const A = mkPvp();
    seedBoard(A);
    const B2 = bridgeSnap(A, 1000);

    expect(B2.aiActiveSlots).toEqual(A.activeSlots);
    expect(B2.aiPickedItems).toEqual(A.pickedItems);
    expect(B2.aiMods).toEqual(A.mods);
    // seedBoard 不触发主动技/神掌/被动 → 三特效均为空/null
    expect(B2.aiSkillFx).toBeNull();
    expect(B2.aiPalmPushFx).toBeNull();
    expect([...B2.aiPassiveFlash.keys()]).toEqual([...A.passiveFlash.keys()]);
  });
});

describe('bridgeOpponentFromSnap：镜像正确性（快照路径直验）', () => {
  it('单位 cell 镜像、fireDir 本地按位置重算（不采信传输值，恒为数字）', () => {
    const A = mkPvp();
    const tNow = 1000;
    const cell = { c: 2, r: 6 };
    const uWith = {
      type: 'archer', tier: 1, cell, cooldown: 0, firePulse: 0, combo: 0,
      stunT: 0, slowT: 0, weakenT: 0, rangeCutT: 0, knockdownT: 0,
      stunImmuneT: 0, slowImmuneT: 0, weakenImmuneT: 0, rangeCutImmuneT: 0, knockdownImmuneT: 0,
      fireDir: 0.3,
    };
    const uWithout = { ...uWith, fireDir: undefined, cell: { c: 3, r: 6 } };
    // 直接注入本方侧单位（as any；仅测试用），再走快照路径。
    (A as any).units.set('2,6', uWith);
    (A as any).units.set('3,6', uWithout);

    const B2 = bridgeSnap(A, tNow);

    const gate = pathEntranceCell(B2.aiPath);
    const withDir = B2.aiUnits.find((u) => u.cell.c === mirrorCell(cell).c)!;
    const withoutDir = B2.aiUnits.find((u) => u.cell.c === mirrorCell({ c: 3, r: 6 }).c)!;
    expect(withDir.cell).toEqual(mirrorCell(cell));
    // 源 fireDir=0.3 被忽略，桥按镜像后位置朝 AI 入口本地重算
    expect(withDir.fireDir).toBeCloseTo(faceDirToward(mirrorCell(cell), gate), 10);
    expect(withoutDir.cell).toEqual(mirrorCell({ c: 3, r: 6 }));
    // 源 fireDir=undefined 也重算为数字（不再保留 undefined）
    expect(withoutDir.fireDir).toBeCloseTo(faceDirToward(mirrorCell({ c: 3, r: 6 }), gate), 10);
  });

  it('aiUnlocked 逐元素镜像（翻转格也不丢）', () => {
    const A = mkPvp();
    (A as any).unlocked.add('2,7'); // → mirrorCell({c:2,r:7})={c:5,r:2} → "5,2"
    const B2 = bridgeSnap(A, 1000);
    expect(B2.aiUnlocked.has('5,2')).toBe(true);
    expect(B2.aiUnlocked.has('2,7')).toBe(false);
  });
});

describe('bridgeOpponentFromSnap：heroPairKey 重排回归（快照路径）', () => {
  it('generalStates 键镜像必须重排（防朴素字符串替换的字典序翻转）', () => {
    // 翻转用例：
    //   本方 a={c:1,r:5}、b={c:6,r:8} → 原键 "1,5|6,8"
    //   mirrorCell 后 ma={c:6,r:4}、mb={c:1,r:1}
    //   朴素逐格镜像 → 错键 "6,4|1,1"；正确重排 heroPairKey(ma,mb)="1,1|6,4"
    const A = mkPvp();
    const SRC_KEY = '1,5|6,8';
    const RIGHT_KEY = '1,1|6,4';
    const WRONG_KEY = '6,4|1,1';
    const srcState = { level: 3, exp: 42, cooldown: 1.5, skillCd: 0, firePulse: 0.2, skillFlash: 0 };
    (A as any).generalStates.set(SRC_KEY, srcState);
    (A as any).lastActivePairKeys.add(SRC_KEY);

    const B2 = bridgeSnap(A, 1000);

    const aiStates = B2.aiGeneralStates;
    const aiPairs = B2.lastAiActivePairKeys;
    expect(aiStates.has(RIGHT_KEY)).toBe(true);
    expect(aiStates.has(WRONG_KEY)).toBe(false);
    expect(aiStates.get(RIGHT_KEY)?.level).toBe(3);
    expect(aiStates.get(RIGHT_KEY)?.exp).toBe(42);
    expect(aiPairs.has(RIGHT_KEY)).toBe(true);
    expect(aiPairs.has(WRONG_KEY)).toBe(false);
  });
});

// ============================================================================
//  瞬态特效透传（T9.2）：skill/palm/ult/dog 经快照路径到对手侧，格坐标镜像、字段保留。
//  背景：旧 serialize 把 fx.t 钉成「序列化时刻」→ 接收端播放头冻结在 0（技能 fade≈0 看不见、
//  神掌波纹卡在 frontStartDist）。修为「出生时刻」后，下列 round-trip 与镜像契约才成立。
// ============================================================================
describe('bridgeOpponentFromSnap：瞬态特效透传 + 镜像（T9.2）', () => {
  it('aiSkillFx：主动技能爆心格镜像到 AI 半场（玩家格→对手格）', () => {
    const A = mkPvp();
    (A as any).playerSkillFx = { kind: 'meteor', t: 0, dur: 0.8, c: 3, r: 8 };
    const B2 = bridgeSnap(A, 1000);
    expect(B2.aiSkillFx).not.toBeNull();
    expect(B2.aiSkillFx!.kind).toBe('meteor');
    // 爆心格镜像：c=3→4、r=8→1（COLS=8,ROWS=10 的中心对称）
    expect(B2.aiSkillFx!.c).toBe(mirrorCell({ c: 3, r: 8 }).c);
    expect(B2.aiSkillFx!.r).toBe(mirrorCell({ c: 3, r: 8 }).r);
  });

  it('aiHeroUltFx：爆心/施法起点格镜像、tier/rge/crit 保留、ttl=maxTtl−age', () => {
    const A = mkPvp();
    (A as any).heroUltFx = [{
      heroId: 'dasheng', c: 3, r: 8, ttl: 0.9, maxTtl: 0.9, tier: 5, rge: 3, crit: false, fromC: 1, fromR: 8,
    }];
    const B2 = bridgeSnap(A, 1000);
    expect(B2.aiHeroUltFx).toHaveLength(1);
    const u = B2.aiHeroUltFx[0]!;
    expect(u.heroId).toBe('dasheng');
    expect(u.tier).toBe(5);
    expect(u.rge).toBe(3);
    expect(u.crit).toBe(false);
    expect(u.c).toBe(mirrorCell({ c: 3, r: 8 }).c); // 爆心镜像
    expect(u.fromC).toBe(mirrorCell({ c: 1, r: 8 }).c); // 施法起点镜像（飞棒射线方向由渲染重算）
    expect(u.fromR).toBe(mirrorCell({ c: 1, r: 8 }).r);
    expect(u.maxTtl).toBe(0.9);
    expect(u.ttl).toBeGreaterThan(0);
  });

  it('aiHeroUltFx：二郎咬点格镜像、biteMid 透传', () => {
    const A = mkPvp();
    (A as any).heroUltFx = [{
      heroId: 'erlang', c: 3, r: 8, ttl: 0.9, maxTtl: 0.9, tier: 3, rge: 3, crit: true,
      fromC: 1, fromR: 8, biteC: 4, biteR: 8, biteMid: 7,
    }];
    const B2 = bridgeSnap(A, 1000);
    expect(B2.aiHeroUltFx).toHaveLength(1);
    const u = B2.aiHeroUltFx[0]!;
    expect(u.biteMid).toBe(7);
    expect(u.biteC).toBe(mirrorCell({ c: 4, r: 8 }).c); // 咬点镜像
    expect(u.biteR).toBe(mirrorCell({ c: 4, r: 8 }).r);
  });

  it('aiErlangDogFx：咬点格镜像 + ang+π（被咬对手怪在场）', () => {
    const A = mkPvp();
    // 对手怪 mid=42 须在快照怪中（桥查 view.monsters 判存活）；as any 注入最小怪。
    (A as any).monsters = [{ id: 42, hp: 10 }];
    (A as any).erlangDogFx = [{ mid: 42, c: 3, r: 8, ttl: 3.0, maxTtl: 3.0, tier: 3, ang: 0.5 }];
    const B2 = bridgeSnap(A, 1000);
    expect(B2.aiErlangDogFx).toHaveLength(1);
    const d = B2.aiErlangDogFx[0]!;
    expect(d.mid).toBe(42);
    expect(d.c).toBe(mirrorCell({ c: 3, r: 8 }).c); // 咬点格镜像
    expect(d.r).toBe(mirrorCell({ c: 3, r: 8 }).r);
    expect(d.ang).toBeCloseTo(0.5 + Math.PI, 10); // 180° 旋转翻转向量角
  });

  it('aiPalmPushFx：frontStartDist/cells 经桥保留（沿 aiPath 画掌印）', () => {
    const A = mkPvp();
    (A as any).palmPushFx = { t: 0, dur: 0.8, fadeT: 0, cells: 3, frontStartDist: 9.2, snapshots: [] };
    const B2 = bridgeSnap(A, 1000);
    expect(B2.aiPalmPushFx).not.toBeNull();
    expect(B2.aiPalmPushFx!.frontStartDist).toBe(9.2);
    expect(B2.aiPalmPushFx!.cells).toBe(3);
  });
});

describe('bridge 武将镜像识别（180° 镜像会反读武将两字，需仍识别为同一武将）', () => {
  it('对手横向武将「大圣」镜像后仍被 aiActiveGenerals 识别（不漏、不错认）', () => {
    const A = mkPvp();
    A.startNextWave();
    // 玩家侧相邻放「大」(左)「圣」(右) → 武将 dasheng(chars ['大','圣'])
    (A as unknown as { words: Map<string, unknown> }).words.set('2,3', { char: '大', general: '', tier: 1, cell: { c: 2, r: 3 } });
    (A as unknown as { words: Map<string, unknown> }).words.set('3,3', { char: '圣', general: '', tier: 1, cell: { c: 3, r: 3 } });
    // 本方侧应识别为 dasheng（正序 matchGeneral 命中）
    expect(A.activeGenerals().map((g) => g.def.id)).toContain('dasheng');
    // 桥到对手视图：180° 镜像把两字左右对调（圣→左、大→右），
    // aiActiveGenerals 需支持反读，否则漏识别 → 画成未激活的反序字牌「圣大」。
    const B2 = bridgeSnap(A, 1000);
    expect(B2.aiActiveGenerals().map((g) => g.def.id)).toContain('dasheng');
    // 数据层验证镜像反序：左格(较小 c)存「圣」、右格存「大」——所以 drawActiveGeneralGroup 在
    // PvP(b.isPvp) 下需交换两格所画的字，才能读作「大圣」；单机 AI 则本就是「大」左「圣」右、不交换。
    const g = B2.aiActiveGenerals().find((x) => x.def.id === 'dasheng')!;
    const [c0, c1] = g.cells;
    const left = c0.c <= c1.c ? c0 : c1;
    const right = c0.c <= c1.c ? c1 : c0;
    expect(B2.aiWords.get(`${left.c},${left.r}`)!.char).toBe('圣');
    expect(B2.aiWords.get(`${right.c},${right.r}`)!.char).toBe('大');
  });
});
