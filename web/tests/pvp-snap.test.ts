// web/tests/pvp-snap.test.ts
// Plan C Task 4：快照序列化 round-trip + PvpOppView 双缓冲插值数学 + 乱序丢弃。
//
// 背景：本方每 100ms 经 WS 推 PvpSnap；对手端 PvpOppView 存 prev/cur 两份快照，对怪物 dist 做
// 滞后 INTERP_DELAY_MS(120ms) 的线性插值，其余字段取 cur。本测试锁死：
//   1. 快照是纯 JSON（JSON 往返不变）且字段面覆盖渲染消费面（round-trip）；
//   2. 插值数学（两快照间线性、越界取端点、单快照取 cur、等时刻取 cur、仅 cur 有怪取 cur）；
//   3. 乱序 ingest 被忽略（时序不变量不被破坏）。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META } from '../src/battle';
import { MAPS } from '../src/board';
import {
  PvpOppView,
  fxAlive,
  INTERP_DELAY_MS,
  type PvpSnap,
  type PvpSnapMonster,
} from '../src/pvp-snap';

// 与 pvp-bridge.test.ts 的 mkPvp 同构：同 seed/difficulty=1、pvpInit.enabled=true；meta 传 NO_META。
const mkPvp = () =>
  new Battle(1, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: true });

// 把对手养成「可观察的本方侧状态」：开波出怪 + 征兵/布阵让单位、字牌上板。
// 复用 pvp-bridge.test.ts 的 seedOpponentBoard 同款确定性输入（applyPvpInput + step）。
function seedBoard(b: Battle): void {
  b.startNextWave();
  for (let i = 0; i < 4; i++) {
    b.applyPvpInput({ op: 'summon' });
    b.applyPvpInput({ op: 'autoplace' });
    for (let k = 0; k < 25; k++) b.step(1 / 30);
  }
  // 兜底：若自动布阵还没落出单位，强制征兵→把首个 unit 令牌放到首个空闲已解锁格（确定性）。
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

// —— 插值测试用的小工具：最小合法 Monster（全必填字段）/Mods/快照 ——
function mkMonster(dist: number, over: Partial<PvpSnapMonster> = {}): PvpSnapMonster {
  return {
    id: 1,
    dist,
    hp: 10,
    maxHp: 10,
    spd: 0.6,
    isBoss: false,
    isMiniBoss: false,
    miniBossKind: null,
    isCavalry: false,
    hitFlash: 0,
    skill: null,
    skillCd: 0,
    castFlash: 0,
    spawnT: 0,
    stunT: 0,
    slowT: 0,
    hasteT: 0,
    healFlash: 0,
    burnT: 0,
    burnDps: 0,
    ...over,
  };
}

// 最小合法 PvpSnap（非插值相关字段填无害默认值）。
function mkSnap(t: number, monsters: PvpSnapMonster[] = [], over: Partial<PvpSnap> = {}): PvpSnap {
  return {
    t,
    wave: 1,
    waveActive: true,
    spawnRemaining: 0,
    tangsengHP: 100,
    status: 'playing',
    peach: 0,
    kills: 0,
    spawnGateT: 0,
    introT: 0,
    introDone: true,
    monsters,
    units: [],
    words: [],
    unlocked: [],
    generalStates: [],
    lastActivePairKeys: [],
    activeSlots: [],
    pickedItems: [],
    bombs: [],
    digFx: [],
    fx: [],
    mods: {
      atkMul: 1, frqMul: 1, killBonus: 0, monsterSpdMul: 1, summonCostDelta: 0,
      wordRateBonus: 0, shovelPeach: 0, autoShovel: false, meteor: false, mud: false, generalTierDelta: 0,
    },
    ...over,
  };
}

describe('pvpOwnSnapshot：本方半场快照序列化（Plan C Task 4）', () => {
  it('快照是纯 JSON：JSON.parse(JSON.stringify(s)) 与 s 深度相等（无 Map/Set/class/函数泄漏）', () => {
    const b = mkPvp();
    seedBoard(b);
    // 前置：确有可序列化内容（怪已出；单位/字牌可能 0，但 round-trip 对空容器同样成立）。
    expect(b.monsters.length).toBeGreaterThan(0);

    const tNow = 1000; // 调用方戳的发送端 ms（测试用固定值，避免 Date.now 不确定性）
    const s = b.pvpOwnSnapshot(tNow);

    // 往返：序列化再解析应与原对象深度相等（证明全是 JSON-safe 原语，无 Map/Set/类实例）。
    const rt = JSON.parse(JSON.stringify(s));
    expect(rt).toEqual(s);
    // 反向也成立（undefined 字段两侧同源，toEqual 对 undefined 一致忽略）。
    expect(s).toEqual(rt);
    // 发送端时刻原样保留（插值/老化时基）。
    expect(s.t).toBe(tNow);
  });

  it('快照字段面覆盖渲染消费面：单位/字牌/怪/解锁/武将态/道具/特效骨架都在', () => {
    const b = mkPvp();
    seedBoard(b);
    const s = b.pvpOwnSnapshot(2000);

    // 标量骨架
    expect(typeof s.wave).toBe('number');
    expect(typeof s.waveActive).toBe('boolean');
    expect(typeof s.spawnRemaining).toBe('number');
    expect(typeof s.tangsengHP).toBe('number');
    expect(s.status === 'playing' || s.status === 'lost').toBe(true);
    expect(typeof s.peach).toBe('number');
    expect(typeof s.kills).toBe('number');
    expect(typeof s.spawnGateT).toBe('number');
    expect(typeof s.introT).toBe('number');
    expect(typeof s.introDone).toBe('boolean');

    // 容器（数组/记录，非 Map/Set）
    expect(Array.isArray(s.monsters)).toBe(true);
    expect(Array.isArray(s.units)).toBe(true);
    expect(Array.isArray(s.words)).toBe(true);
    expect(Array.isArray(s.unlocked)).toBe(true);
    expect(Array.isArray(s.generalStates)).toBe(true); // Map → [k,v][]
    expect(Array.isArray(s.lastActivePairKeys)).toBe(true); // Set → string[]
    expect(Array.isArray(s.activeSlots)).toBe(true);
    expect(Array.isArray(s.pickedItems)).toBe(true);
    expect(Array.isArray(s.bombs)).toBe(true);
    expect(Array.isArray(s.digFx)).toBe(true);
    expect(Array.isArray(s.fx)).toBe(true);
    expect(typeof s.mods).toBe('object');

    // 怪物整怪快照：渲染实读字段齐全（dist/hp/maxHp/isBoss/isMiniBoss/slowT 等）。
    const m = s.monsters[0]!;
    expect(typeof m.dist).toBe('number');
    expect(typeof m.hp).toBe('number');
    expect(typeof m.maxHp).toBe('number');
    expect(typeof m.isBoss).toBe('boolean');
    expect(typeof m.isMiniBoss).toBe('boolean');
    expect(typeof m.slowT).toBe('number');
  });
});

describe('PvpOppView：双缓冲插值（Plan C Task 4）', () => {
  it('两快照间线性插值：renderTime=nowMs-120，alpha 在两值之间', () => {
    const view = new PvpOppView();
    const prev = mkSnap(1000, [mkMonster(1.0)]);
    const cur = mkSnap(1100, [mkMonster(1.1)]);
    view.ingest(prev);
    view.ingest(cur);

    // 要得 alpha=0.2（dist=1.02），需 renderTime=1020 → nowMs = renderTime + INTERP_DELAY = 1020+120 = 1140。
    // 插值时刻 = renderTime = nowMs - 120 = 1020；alpha = (1020-1000)/(1100-1000) = 0.2。
    const nowMs = 1020 + INTERP_DELAY_MS; // 1140
    const v = view.interpAt(nowMs);
    expect(v.monsters).toHaveLength(1);
    expect(v.monsters[0]!.dist).toBeCloseTo(1.02, 10);
    expect(v.renderTime).toBe(1020);
  });

  it('渲染时刻早于 prev.t → 取 prev 值（alpha 钳到 0）', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1000, [mkMonster(1.0)]));
    view.ingest(mkSnap(1100, [mkMonster(1.1)]));
    // nowMs=1000 → renderTime=880 < prev.t=1000 → alpha<0 钳到 0 → prev=1.0
    expect(view.interpAt(1000).monsters[0]!.dist).toBeCloseTo(1.0, 10);
  });

  it('渲染时刻晚于 cur.t → 取 cur 值（alpha 钳到 1）', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1000, [mkMonster(1.0)]));
    view.ingest(mkSnap(1100, [mkMonster(1.1)]));
    // nowMs=1300 → renderTime=1180 > cur.t=1100 → alpha>1 钳到 1 → cur=1.1
    expect(view.interpAt(1300).monsters[0]!.dist).toBeCloseTo(1.1, 10);
  });

  it('单快照 → 直取 cur 值（无 prev 可插值）', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1100, [mkMonster(1.1)]));
    expect(view.interpAt(2000).monsters[0]!.dist).toBeCloseTo(1.1, 10);
  });

  it('prev.t == cur.t（等时刻）→ 取 cur，不外推（防除零 NaN）', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1100, [mkMonster(1.0)]));
    view.ingest(mkSnap(1100, [mkMonster(1.1)])); // 同时刻
    expect(view.interpAt(2000).monsters[0]!.dist).toBeCloseTo(1.1, 10);
  });

  it('怪物仅 cur 有（prev 无对应 index）→ 取 cur 值，不外推', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1000, [])); // prev 无怪
    view.ingest(mkSnap(1100, [mkMonster(1.1)])); // cur 有 1 怪
    expect(view.interpAt(1140).monsters[0]!.dist).toBeCloseTo(1.1, 10);
  });

  it('多怪按 index 独立插值（各自有 prev/cur）', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1000, [mkMonster(1.0, { id: 1 }), mkMonster(2.0, { id: 2 })]));
    view.ingest(mkSnap(1100, [mkMonster(1.1, { id: 1 }), mkMonster(2.2, { id: 2 })]));
    const v = view.interpAt(1020 + INTERP_DELAY_MS); // alpha=0.2
    expect(v.monsters[0]!.dist).toBeCloseTo(1.02, 10);
    expect(v.monsters[1]!.dist).toBeCloseTo(2.04, 10);
  });

  it('interpAt 返回浅拷贝：改写返回值不污染内部缓冲', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1100, [mkMonster(1.1)]));
    const v1 = view.interpAt(2000);
    v1.monsters[0]!.dist = 999; // 污染测试
    const v2 = view.interpAt(2000);
    expect(v2.monsters[0]!.dist).toBeCloseTo(1.1, 10); // 内部缓冲未被污染
  });
});

describe('PvpOppView：乱序 ingest 被忽略', () => {
  it('ingest 比 cur.t 旧的快照被丢弃（prev/cur 时序不变量不被破坏）', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1100, [mkMonster(1.1)])); // cur.t=1100
    view.ingest(mkSnap(1000, [mkMonster(9.9)])); // 乱序（1000 < 1100）→ 忽略
    // 单快照语义：直取 cur.t=1100 的 1.1（乱序的 9.9 未写入 prev 也未覆盖 cur）
    expect(view.interpAt(2000).monsters[0]!.dist).toBeCloseTo(1.1, 10);
  });

  it('ingest 与 cur.t 相等的快照允许推进（prev=旧 cur，cur=新；t 不旧即不丢）', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1100, [mkMonster(1.1)]));
    view.ingest(mkSnap(1100, [mkMonster(1.2)])); // t 相等 → 不 < cur.t → 允许推进
    expect(view.interpAt(2000).monsters[0]!.dist).toBeCloseTo(1.2, 10);
  });
});

describe('fxAlive：瞬态特效老化', () => {
  it('出生在寿命内 → 存活；超过寿命 → 死亡', () => {
    const skill = { kind: 'skill', t: 1000, skillKind: 'meteor', dur: 0.8, c: 1, r: 1 } as const;
    expect(fxAlive(skill, 1000 + 500)).toBe(true); // 500ms < 1500ms 寿命
    expect(fxAlive(skill, 1000 + 1500)).toBe(false); // == 寿命 → 不存活（严格 <）
    const palm = { kind: 'palm', t: 1000, dur: 0.8, fadeT: 0, cells: 3, frontStartDist: 5 } as const;
    expect(fxAlive(palm, 1000 + 1299)).toBe(true);
    expect(fxAlive(palm, 1000 + 1300)).toBe(false);
    const flash = { kind: 'flash', t: 1000, id: 'pas_x', value: 0.5 } as const;
    expect(fxAlive(flash, 1000 + 699)).toBe(true);
    expect(fxAlive(flash, 1000 + 700)).toBe(false);
  });
});
