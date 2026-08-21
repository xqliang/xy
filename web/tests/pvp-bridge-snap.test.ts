// web/tests/pvp-bridge-snap.test.ts
// Plan C Task 4：快照渲染桥 bridgeOpponentFromSnap 与旧桥 bridgeOpponentFrom 的逐字段等价。
//
// 背景：Task 5 会把对手半场数据源从「oppBattle 本方侧直引（bridgeOpponentFrom）」换成
// 「WS 快照 → PvpOppView 插值 → bridgeOpponentFromSnap」。镜像规则（cell 镜像 / fireDir+π /
// words 键镜像 / unlocked 逐元素镜像 / heroPairKey 重排）必须逐字一致，否则对手半场渲染错位。
// 本测试用同一份本方状态 A，分别走旧桥与新桥，断言两侧 battle.ai* 深度等价——锁死「换源不换形」。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META } from '../src/battle';
import { mirrorCell } from '../src/board';
import { MAPS } from '../src/board';
import { PvpOppView } from '../src/pvp-snap';

// 与 pvp-bridge.test.ts 的 mkPvp 同构。
const mkPvp = () =>
  new Battle(1, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: true });

// 把对手养成可观察本方侧状态（确定性 applyPvpInput + step）；与 pvp-bridge.test.ts 的 seedOpponentBoard 同款。
function seedBoard(b: Battle): void {
  b.startNextWave();
  for (let i = 0; i < 4; i++) {
    b.applyPvpInput({ op: 'summon' });
    b.applyPvpInput({ op: 'autoplace' });
    for (let k = 0; k < 25; k++) b.step(1 / 30);
  }
  let guard = 0;
  while (b.units.size === 0 && guard++ < 12) {
    b.applyPvpInput({ op: 'summon' });
    for (let k = 0; k < 5; k++) b.step(1 / 30);
    const idx = b.tray.findIndex((t) => t.kind === 'unit');
    const cell = b.unlockedCells().find(
      (c) => !b.units.has(`${c.c},${c.r}`) && !b.words.has(`${c.c},${c.r}`),
    );
    if (idx >= 0 && cell) b.applyPvpInput({ op: 'place', cell: `r${cell.r}c${cell.c}`, index: idx });
    for (let k = 0; k < 5; k++) b.step(1 / 30);
  }
}

// 把同一份本方状态 A 分别走旧桥与新桥，返回两侧 battle（B 旧桥、B2 新桥）。
// 关键：A 在两次桥接间不被改写（无 step），保证两侧数据源同一时刻。
function bridgeBoth(A: Battle, tNow: number): { B: Battle; B2: Battle } {
  const B = mkPvp();
  B.bridgeOpponentFrom(A); // 旧路径：oppBattle 本方侧直引 + 镜像

  const B2 = mkPvp();
  const s = A.pvpOwnSnapshot(tNow); // 本方 → 快照
  const view = new PvpOppView();
  view.ingest(s); // 单快照：interp = cur（无 prev 可插值）
  B2.bridgeOpponentFromSnap(view.interpAt(tNow)); // 新路径：快照 → 插值视图 → 桥

  return { B, B2 };
}

describe('bridgeOpponentFromSnap 与 bridgeOpponentFrom 逐字段等价（Plan C Task 4）', () => {
  it('aiUnits：镜像 cell + fireDir+π，逐条深度等价', () => {
    const A = mkPvp();
    seedBoard(A);
    expect(A.units.size).toBeGreaterThan(0);
    const { B, B2 } = bridgeBoth(A, 1000);

    expect(B2.aiUnits.length).toBe(B.aiUnits.length);
    // 逐条对齐（顺序由 [...units.values()] 决定，两侧同源同序）。
    for (let i = 0; i < B.aiUnits.length; i++) {
      expect(B2.aiUnits[i]).toEqual(B.aiUnits[i]);
    }
    // 再单点验镜像规则（与旧桥测试一致）：cell 镜像、fireDir 有值 +π。
    for (const u of A.units.values()) {
      const bU = B.aiUnits.find((x) => x.cell.c === mirrorCell(u.cell).c && x.cell.r === mirrorCell(u.cell).r)!;
      const b2U = B2.aiUnits.find((x) => x.cell.c === mirrorCell(u.cell).c && x.cell.r === mirrorCell(u.cell).r)!;
      expect(b2U.cell).toEqual(mirrorCell(u.cell));
      if (u.fireDir != null) {
        expect(b2U.fireDir).toBeCloseTo(u.fireDir + Math.PI, 10);
        expect(b2U.fireDir).toBeCloseTo(bU.fireDir!, 10);
      } else {
        expect(b2U.fireDir).toBeUndefined();
      }
      expect(b2U.type).toBe(u.type);
      expect(b2U.tier).toBe(u.tier);
    }
  });

  it('aiWords：镜像 cell + Map 键，逐条深度等价', () => {
    const A = mkPvp();
    seedBoard(A);
    if (A.words.size === 0) return; // 字牌非每局必出
    const { B, B2 } = bridgeBoth(A, 1000);

    expect(B2.aiWords.size).toBe(B.aiWords.size);
    for (const w of A.words.values()) {
      const m = mirrorCell(w.cell);
      const key = `${m.c},${m.r}`;
      expect(B2.aiWords.get(key)).toEqual(B.aiWords.get(key));
      expect(B2.aiWords.get(key)!.cell).toEqual(m);
      expect(B2.aiWords.get(key)!.char).toBe(w.char);
    }
  });

  it('aiMonsters：dist/hp/maxHp/type?/tier? 逐怪深度等价（整怪快照，单快照=cur）', () => {
    const A = mkPvp();
    seedBoard(A);
    expect(A.monsters.length).toBeGreaterThan(0);
    const { B, B2 } = bridgeBoth(A, 1000);

    expect(B2.aiMonsters.length).toBe(B.aiMonsters.length);
    // 逐怪深度等价（单快照插值=cur，故 dist 与旧桥直引一致）。
    for (let i = 0; i < B.aiMonsters.length; i++) {
      expect(B2.aiMonsters[i]).toEqual(B.aiMonsters[i]);
      expect(B2.aiMonsters[i]!.dist).toBeCloseTo(B.aiMonsters[i]!.dist, 10);
      expect(B2.aiMonsters[i]!.hp).toBe(B.aiMonsters[i]!.hp);
      expect(B2.aiMonsters[i]!.maxHp).toBe(B.aiMonsters[i]!.maxHp);
      expect(B2.aiMonsters[i]!.slowT).toBe(B.aiMonsters[i]!.slowT);
    }
  });

  it('aiUnlocked / aiGeneralStates / lastAiActivePairKeys 镜像等价', () => {
    const A = mkPvp();
    seedBoard(A);
    const { B, B2 } = bridgeBoth(A, 1000);

    // aiUnlocked：Set 逐元素等价
    expect([...B2.aiUnlocked].sort()).toEqual([...B.aiUnlocked].sort());
    // aiGeneralStates：Map 键+值等价
    expect([...B2.aiGeneralStates.keys()].sort()).toEqual([...B.aiGeneralStates.keys()].sort());
    for (const [k, v] of B.aiGeneralStates) {
      expect(B2.aiGeneralStates.get(k)).toEqual(v);
    }
    // lastAiActivePairKeys：Set 等价
    expect([...B2.lastAiActivePairKeys].sort()).toEqual([...B.lastAiActivePairKeys].sort());
  });

  it('标量字段等价：aiTangsengHP / aiDefeated / aiSpawnGateT / aiBombs / aiDigFx', () => {
    const A = mkPvp();
    seedBoard(A);
    const { B, B2 } = bridgeBoth(A, 1000);

    expect(B2.aiTangsengHP).toBe(B.aiTangsengHP);
    expect(B2.aiTangsengHP).toBe(A.tangsengHP);
    expect(B2.aiDefeated).toBe(B.aiDefeated);
    expect(B2.aiSpawnGateT).toBe(B.aiSpawnGateT);
    expect(B2.aiBombs).toEqual(B.aiBombs);
    expect(B2.aiDigFx).toEqual(B.aiDigFx);
  });

  it('道具/加成/特效骨架等价：aiActiveSlots / aiPickedItems / aiMods / aiSkillFx / aiPalmPushFx / aiPassiveFlash', () => {
    const A = mkPvp();
    seedBoard(A);
    const { B, B2 } = bridgeBoth(A, 1000);

    expect(B2.aiActiveSlots).toEqual(B.aiActiveSlots);
    expect(B2.aiPickedItems).toEqual(B.aiPickedItems);
    expect(B2.aiMods).toEqual(B.aiMods);
    // seedBoard 不触发主动技/神掌/被动 → 三特效均为空/null
    expect(B2.aiSkillFx).toEqual(B.aiSkillFx);
    expect(B2.aiPalmPushFx).toEqual(B.aiPalmPushFx);
    expect([...B2.aiPassiveFlash.keys()]).toEqual([...B.aiPassiveFlash.keys()]);
  });
});

describe('bridgeOpponentFromSnap：镜像正确性（快照路径直验）', () => {
  it('单位 cell 镜像、fireDir 有值 +π、undefined 保留', () => {
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

    const s = A.pvpOwnSnapshot(tNow);
    const view = new PvpOppView();
    view.ingest(s);
    const B2 = mkPvp();
    B2.bridgeOpponentFromSnap(view.interpAt(tNow));

    const withDir = B2.aiUnits.find((u) => u.cell.c === mirrorCell(cell).c)!;
    const withoutDir = B2.aiUnits.find((u) => u.cell.c === mirrorCell({ c: 3, r: 6 }).c)!;
    expect(withDir.cell).toEqual(mirrorCell(cell));
    expect(withDir.fireDir).toBeCloseTo(0.3 + Math.PI, 10);
    expect(withoutDir.cell).toEqual(mirrorCell({ c: 3, r: 6 }));
    expect(withoutDir.fireDir).toBeUndefined();
  });

  it('aiUnlocked 逐元素镜像（翻转格也不丢）', () => {
    const A = mkPvp();
    (A as any).unlocked.add('2,7'); // → mirrorCell({c:2,r:7})={c:5,r:2} → "5,2"
    const s = A.pvpOwnSnapshot(1000);
    const view = new PvpOppView();
    view.ingest(s);
    const B2 = mkPvp();
    B2.bridgeOpponentFromSnap(view.interpAt(1000));
    expect(B2.aiUnlocked.has('5,2')).toBe(true);
    expect(B2.aiUnlocked.has('2,7')).toBe(false);
  });
});

describe('bridgeOpponentFromSnap：heroPairKey 重排回归（快照路径）', () => {
  it('generalStates 键镜像必须重排（防朴素字符串替换的字典序翻转）', () => {
    // 同 pvp-bridge.test.ts 的翻转用例：
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

    const s = A.pvpOwnSnapshot(1000);
    const view = new PvpOppView();
    view.ingest(s);
    const B2 = mkPvp();
    B2.bridgeOpponentFromSnap(view.interpAt(1000));

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
