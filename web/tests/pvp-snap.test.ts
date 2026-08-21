// web/tests/pvp-snap.test.ts
// Plan C Task 4 + Task 7.5：快照序列化 round-trip + PvpOppView 渲染平滑三件套契约。
//
// 背景：本方每 100ms 经 WS 推 PvpSnap；对手端 PvpOppView 维护双缓冲，对怪物 dist 做平滑渲染。
// Task 7.5 引入三层平滑（自适应缓冲 / 断流外推 / 误差慢纠偏），核心契约：网络抖动/突发/乱序
// 造成的「回退/卡顿」必须消除（单调不减 dist 流下渲染永不倒退）；只有真实游戏事件（dist 真实
// 下降，如来神掌击退）才允许显示回退。本测试额外锁死：
//   - 平滑节律：稳定 100ms 到达 + 均匀 dist → 采样渲染接近匀速、滞后≈自适应缓冲；
//   - 抗回退（核心契约）：抖动/突发/重排的单调 dist 流 → 细步采样渲染全程单调不减、无长冻结；
//   - 真实回退放行：dist 真实下降 → 渲染跟随下降但平滑（无瞬移）；
//   - 外推封顶：单对快照后远查 → dist 被硬上限 + 封顶时间约束；
//   - 自适应缓冲边界：稳定到达收敛到低延迟、抖动大时加宽（≤上限）。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META } from '../src/battle';
import { MAPS } from '../src/board';
import {
  PvpOppView,
  fxAlive,
  INTERP_DELAY_MS,
  normalizeSnapClock,
  type PvpSnap,
  type PvpSnapFx,
  type PvpSnapMonster,
} from '../src/pvp-snap';

// 与 pvp-bridge.test.ts 的 mkPvp 同构：同 seed/difficulty=1、pvpInit.enabled=true；meta 传 NO_META。
const mkPvp = () =>
  new Battle(1, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: true });

// 把对手养成「可观察的本方侧状态」：开波出怪 + 征兵/布阵让单位、字牌上板。
// Task 5 删除了对手确定性重放入口 applyPvpInput；改调其内部等价的公开方法（summon/autoPlaceTray/placeFromTray）。
function seedBoard(b: Battle): void {
  b.startNextWave();
  for (let i = 0; i < 4; i++) {
    b.summon();
    b.autoPlaceTray();
    for (let k = 0; k < 25; k++) b.step(1 / 30);
  }
  // 兜底：若自动布阵还没落出单位，强制征兵→把首个 unit 令牌放到首个空闲已解锁格（确定性）。
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

describe('PvpOppView：平滑渲染（Task 7.5 三件套）', () => {
  // 说明：Task 7.5 后插值滞后改为「自适应缓冲」（floor=INTERP_DELAY_MS）、越界改为「外推」、
  // 输出经「误差慢纠偏棘轮」。故不再断言「精确 = 旧固定 alpha 值」，而是断言「渲染值落在
  // 自适应缓冲 + 外推封顶所界定的合理带内、且基本单调」。逐怪数学正确性由下方的合同测试覆盖。
  const TOL = 0.05; // 自适应缓冲/棘轮追赶带来的容差（格）

  it('两快照间：渲染值落在 prev~cur+外推带内（自适应缓冲 + 外推封顶）', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1000, [mkMonster(1.0)]));
    view.ingest(mkSnap(1100, [mkMonster(1.1)]));
    // renderTime = nowMs - delay（delay∈[120,150)）。renderTime=1020 → 落在 (prev.t,cur.t) 内，
    // 棘轮从 1.0 追赶向 ~1.02；允许自适应延迟 + 追赶的容差。
    const v = view.interpAt(1020 + INTERP_DELAY_MS);
    expect(v.monsters).toHaveLength(1);
    expect(v.monsters[0]!.dist).toBeGreaterThanOrEqual(1.0 - TOL);
    expect(v.monsters[0]!.dist).toBeLessThanOrEqual(1.1 + TOL);
    // renderTime = nowMs - adaptiveDelay（delay∈[120,400]），不再固定 120。
    const d = 1020 + INTERP_DELAY_MS - v.renderTime;
    expect(d).toBeGreaterThanOrEqual(INTERP_DELAY_MS);
    expect(d).toBeLessThanOrEqual(400);
  });

  it('渲染时刻早于 prev.t → 取 prev 值（棘轮初始即目标，不前冲）', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1000, [mkMonster(1.0)]));
    view.ingest(mkSnap(1100, [mkMonster(1.1)]));
    // nowMs=1000 → renderTime=880 < prev.t=1000 → 目标=prev=1.0，棘轮从 1.0 起步 → 1.0
    expect(view.interpAt(1000).monsters[0]!.dist).toBeCloseTo(1.0, 6);
  });

  it('渲染时刻晚于 cur.t → 平滑外推前进（不再钳制冻结，但受硬上限约束）', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1000, [mkMonster(1.0)]));
    view.ingest(mkSnap(1100, [mkMonster(1.1)]));
    // nowMs=1300 → renderTime=1180 > cur.t=1100。旧行为钳到 1.1；新行为按最近速度外推前进（>1.1），
    // 但被外推封顶约束在 cur + hardCap*excess 内（segVel=0.001 格/ms，cap=2.0 格/秒）。
    const d = view.interpAt(1300).monsters[0]!.dist;
    expect(d).toBeGreaterThanOrEqual(1.1 - 1e-6); // 至少不低于 cur（dist 流单调，棘轮不回退）
    expect(d).toBeLessThanOrEqual(1.1 + 2.0 * 0.5 + TOL); // 外推封顶（500ms×2.0格/秒）+ 容差
  });

  it('单快照 → 直取 cur 值（无 prev 可外推，棘轮初始即目标）', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1100, [mkMonster(1.1)]));
    expect(view.interpAt(2000).monsters[0]!.dist).toBeCloseTo(1.1, 6);
  });

  it('prev.t == cur.t（等时刻）→ 取 cur，不外推（防除零 NaN）', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1100, [mkMonster(1.0)]));
    view.ingest(mkSnap(1100, [mkMonster(1.1)])); // 同时刻
    expect(view.interpAt(2000).monsters[0]!.dist).toBeCloseTo(1.1, 6);
  });

  it('怪物仅 cur 有（prev 无对应 index）→ 取 cur 值，不外推', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1000, [])); // prev 无怪
    view.ingest(mkSnap(1100, [mkMonster(1.1)])); // cur 有 1 怪
    expect(view.interpAt(1140).monsters[0]!.dist).toBeCloseTo(1.1, 6);
  });

  it('多怪按 index 独立平滑（各自有 prev/cur，落在各自带内）', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1000, [mkMonster(1.0, { id: 1 }), mkMonster(2.0, { id: 2 })]));
    view.ingest(mkSnap(1100, [mkMonster(1.1, { id: 1 }), mkMonster(2.2, { id: 2 })]));
    const v = view.interpAt(1020 + INTERP_DELAY_MS); // renderTime 落在两快照间
    expect(v.monsters[0]!.dist).toBeGreaterThanOrEqual(1.0 - TOL);
    expect(v.monsters[0]!.dist).toBeLessThanOrEqual(1.1 + TOL);
    expect(v.monsters[1]!.dist).toBeGreaterThanOrEqual(2.0 - TOL);
    expect(v.monsters[1]!.dist).toBeLessThanOrEqual(2.2 + TOL);
  });

  it('interpAt 返回浅拷贝：改写返回值不污染内部棘轮缓冲', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1100, [mkMonster(1.1)]));
    const v1 = view.interpAt(2000);
    v1.monsters[0]!.dist = 999; // 污染测试
    const v2 = view.interpAt(2000);
    expect(v2.monsters[0]!.dist).toBeCloseTo(1.1, 6); // 内部缓冲未被污染
  });
});

describe('PvpOppView：平滑节律（稳定到达应近乎匀速、滞后≈自适应缓冲）', () => {
  // 背景：对手均匀 +0.1/100ms 推进；稳定到达下自适应缓冲应收敛到低延迟（≈120~150ms），
  // 棘轮以略高于实时速的速率追赶目标 → 细步采样接近匀速，相邻采样速度比被约束在 2× 内。
  it('稳定 100ms 到达 + 均匀 dist → 16ms 步采样接近匀速（相邻速度比 < 2×）', () => {
    const view = new PvpOppView();
    const STEP = 100;
    const DSTEP = 0.1; // 每 100ms 前进 0.1 格 → 1 格/秒
    const snaps: PvpSnap[] = [];
    for (let i = 0; i < 12; i++) snaps.push(mkSnap(1000 + i * STEP, [mkMonster(1.0 + i * DSTEP)]));

    // 仿真真实节奏：ingest 与 16ms 帧交错推进（ingest 全前置会让缓冲定格在末两帧、renderTime 落不到活段）。
    const lastArrival = snaps[snaps.length - 1]!.t;
    const samples: { t: number; d: number }[] = [];
    let nextSnap = 0;
    for (let t = 1000; t <= lastArrival + 60; t += 16) {
      while (nextSnap < snaps.length && snaps[nextSnap]!.t <= t) {
        view.ingest(snaps[nextSnap]!);
        nextSnap++;
      }
      if (view.hasSnap) samples.push({ t, d: view.interpAt(t).monsters[0]!.dist });
    }

    // 相邻采样速度比应被约束：无「一顿一顿」的尖峰。判据：最大增量 ≤ 2× 中位增量（抗单点噪声）。
    const deltas = samples.slice(1).map((s, i) => s.d - samples[i]!.d).filter((x) => x > 1e-9);
    const sorted = [...deltas].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const maxDelta = Math.max(...deltas);
    expect(maxDelta).toBeLessThanOrEqual(median * 2 + 1e-9);

    // 且整体近乎匀速：全程 dist 增量 ≈ 期望（1 格/秒），容差放宽到 ±40%。
    const total = samples[samples.length - 1]!.d - samples[0]!.d;
    const elapsed = samples[samples.length - 1]!.t - samples[0]!.t;
    const rate = total / (elapsed / 1000);
    expect(rate).toBeGreaterThan(0.6);
    expect(rate).toBeLessThan(1.4);
  });
});

describe('PvpOppView：抗回退契约（核心）——单调 dist 流下渲染永不倒退', () => {
  // 背景：网络抖动/突发/重排只会让 target 落后或短暂外推，绝不应让渲染倒退。
  // 契约：喂入一条「乱序到达 + 大间隔突发 + 重排」但「incoming dist 单调不减」的流，
  // 细步采样渲染 dist 必须全程单调不减，且相邻前进采样间隔被外推封顶约束（无长冻结）。
  it('抖动/突发/重排的单调 dist 流 → 细步采样渲染全程单调不减、无长冻结', () => {
    const view = new PvpOppView();
    // incoming dist 严格递增（模拟对手怪匀速推进），到达时刻高度抖动。
    // gaps(ms): 100,100,400,50,50,300,100,100 —— 含 400ms 突发与 50ms 密集。
    const arrivals = [1000, 1100, 1200, 1600, 1650, 1700, 2000, 2100, 2200];
    const dists = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8];
    for (let i = 0; i < arrivals.length; i++) view.ingest(mkSnap(arrivals[i]!, [mkMonster(dists[i]!)]));

    // 用真实节奏「逐帧」采样（16ms 步），从开播起贯穿整个到达窗口 + 一小段尾部。
    // 注：真实对局快照持续到达，渲染不会出现「无新快照的长尾冻结」；契约 2 的「无长冻结」在
    // 「活跃采样期」内度量（跳过开播冷启动那段——见下）。长断流失控由「外推封顶」测试单独锁。
    const lastArrival = arrivals[arrivals.length - 1]!;

    // 逐帧采样（ingest 与帧交错，模拟真实节奏）。
    const sampleTs: number[] = [];
    let si = 0;
    for (let t = 1000; t <= lastArrival + 200; t += 16) {
      while (si < arrivals.length && arrivals[si]! <= t) {
        view.ingest(mkSnap(arrivals[si]!, [mkMonster(dists[si]!)]));
        si++;
      }
      sampleTs.push(t);
    }
    const ds = sampleTs.map((t) => view.interpAt(t).monsters[0]!.dist);

    // 契约 1：全程单调不减（网络抖动绝不造成回退）。
    for (let i = 1; i < ds.length; i++) {
      expect(ds[i]! + 1e-9).toBeGreaterThanOrEqual(ds[i - 1]!);
    }
    // 契约 2：无长冻结——但跳过「开播冷启动」那段（缓冲滞后让 renderTime 起初远落在 prev.t 之前，
    // render 会 hold 在 prev.dist 直到追上，这是开局长延迟的固有一次性现象，非网络抖动/断流）。
    // 故从「renderTime 首次越过 prev.t」之后才开始计量停滞（活跃采样期）。
    let activeStart = 0;
    for (let i = 0; i < sampleTs.length; i++) {
      // renderTime = sampleTs - delay；越过 prev.t 即进入活跃期（粗判：sampleTs - 120 > prevT 不够，
      // 用 render 已开始前进的启发——取 render 首次 > ds[0] 的下标）。
      if (ds[i]! > ds[0]! + 1e-6) {
        activeStart = i;
        break;
      }
    }
    let lastAdvanceT = sampleTs[activeStart]!;
    let maxStall = 0;
    for (let i = activeStart + 1; i < ds.length; i++) {
      if (ds[i]! > ds[i - 1]! + 1e-9) {
        maxStall = Math.max(maxStall, sampleTs[i]! - lastAdvanceT);
        lastAdvanceT = sampleTs[i]!;
      }
    }
    expect(maxStall).toBeLessThan(600);
    // 契约 3：收尾时渲染追到最新附近（不应永久落后于最新快照 dist 太多）。
    expect(ds[ds.length - 1]!).toBeGreaterThanOrEqual(dists[dists.length - 1]! - 0.05);
  });
});

describe('PvpOppView：真实回退放行（神掌击退）——下降但平滑', () => {
  // 背景：如来神掌把对手自己的怪沿路击退 → dist 真实下降。这是唯一允许显示回退的情形，
  // 但必须平滑（无瞬移），跟随目标下降。
  it('dist 真实骤降（5.0→3.0，神掌式）→ 渲染跟随下降、但无瞬移', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1000, [mkMonster(5.0)]));
    view.ingest(mkSnap(1100, [mkMonster(5.1)]));
    // 先推进到稳定（render 已追到 >5.0）：取 renderTime 稳定落在 (prev.t,cur.t) 内的时刻。
    view.interpAt(1120);
    const before = view.interpAt(1180).monsters[0]!.dist; // renderTime=1030∈(1000,1100) → 棘轮追到 ~5.03
    expect(before).toBeGreaterThan(5.0);

    // 神掌击退：dist 真实骤降到 3.0。
    view.ingest(mkSnap(1200, [mkMonster(3.0)]));
    // 击退刚发生后的瞬间采样：渲染应在「旧值 ~5.1」与「新目标 3.0」之间（平滑过渡中，非瞬移）。
    const rightAfter = view.interpAt(1205).monsters[0]!.dist;
    expect(rightAfter).toBeLessThan(before); // 确实在下降
    expect(rightAfter).toBeGreaterThan(3.0 - 0.01); // 未瞬移到 3.0（之上留有余量）
    expect(rightAfter).toBeLessThanOrEqual(before + 1e-6);

    // 持续采样：应单调逼近 3.0 并最终到达附近。
    view.interpAt(1250);
    view.interpAt(1300);
    const settled = view.interpAt(1400).monsters[0]!.dist;
    expect(settled).toBeLessThanOrEqual(before + 1e-6); // 仍在下降/收敛
    expect(settled).toBeGreaterThanOrEqual(3.0 - 0.05); // 已逼近 3.0
  });
});

describe('PvpOppView：外推封顶（防长断流失控）', () => {
  // 背景：单对快照后长时间无新快照（断流），外推不能无限前进——硬限速 + 限时后冻结。
  it('单对快照后远查 → dist ≤ cur + hardCap*excess，且超封顶时间后冻结', () => {
    const view = new PvpOppView();
    view.ingest(mkSnap(1000, [mkMonster(1.0)]));
    view.ingest(mkSnap(1100, [mkMonster(1.1)])); // segVel = 0.1/100ms = 0.001 格/ms
    const HARD_CAP = 2.0; // 格/秒 = 0.002 格/ms（与实现常量一致）
    const CAP_MS = 500;

    // 预热：以 16ms 步递增查询，让外推 extrapMs 累积越过封顶时间（>500ms beyond cur.t=1100）。
    for (let t = 1100; t <= 1750; t += 16) view.interpAt(t);

    // +2s 远查（excess 900ms beyond cur.t）：外推受 hardCap 与 capTime 双重约束。
    const far = view.interpAt(1000 + 2000).monsters[0]!.dist;
    const excessMs = 2000 - 1100; // 900ms beyond cur.t
    const capped = Math.min(excessMs, CAP_MS) * (HARD_CAP / 1000);
    expect(far).toBeLessThanOrEqual(1.1 + capped + 0.02); // 硬上限 + 容差
    expect(far).toBeGreaterThanOrEqual(1.1 - 1e-6); // 单调棘轮不低于 cur

    // 超封顶时间后继续查询 → 冻结不再增长（extrapMs 已钳到 CAP_MS）。
    const a = view.interpAt(1000 + 1700).monsters[0]!.dist;
    const b = view.interpAt(1000 + 2500).monsters[0]!.dist;
    expect(b).toBeCloseTo(a, 6);
  });
});

describe('PvpOppView：自适应缓冲边界', () => {
  // 自适应缓冲 = clamp(hw*1.5, INTERP_DELAY_MS, 400)，hw 为衰减式高点（hw=max(gap, hw*0.95)）。
  const delay = (view: PvpOppView, atMs: number): number => {
    // renderTime = nowMs - delay → delay = nowMs - renderTime。取一份稳定快照后反推。
    const v = view.interpAt(atMs);
    return atMs - v.renderTime;
  };

  it('稳定 100ms 到达 → 缓冲收敛到 [120,160]', () => {
    const view = new PvpOppView();
    for (let i = 0; i < 30; i++) view.ingest(mkSnap(1000 + i * 100, [mkMonster(1.0 + i * 0.1)]));
    const d = delay(view, 1000 + 29 * 100 + 50);
    expect(d).toBeGreaterThanOrEqual(120);
    expect(d).toBeLessThanOrEqual(160);
  });

  it('抖动大（100/400 交替）→ 缓冲加宽，显著高于稳定值（≤上限 400）', () => {
    const steady = new PvpOppView();
    for (let i = 0; i < 30; i++) steady.ingest(mkSnap(1000 + i * 100, [mkMonster(1.0 + i * 0.1)]));
    const dSteady = delay(steady, 1000 + 29 * 100 + 50);

    const jitter = new PvpOppView();
    let t = 1000;
    for (let i = 0; i < 30; i++) {
      jitter.ingest(mkSnap(t, [mkMonster(1.0 + i * 0.1)]));
      t += i % 2 === 0 ? 100 : 400; // 交替 100/400
    }
    const dJitter = delay(jitter, t + 50);
    expect(dJitter).toBeGreaterThan(dSteady + 20); // 抖动下明显加宽
    expect(dJitter).toBeLessThanOrEqual(400); // 不超过上限
    expect(dJitter).toBeGreaterThanOrEqual(120); // 不低于下限
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

describe('normalizeSnapClock：把收到的发送端时钟快照归一化到本机时钟（Task 5）', () => {
  // 背景：interpAt 用本机 nowMs 与 snap.t 比较、fx 按 (nowMs - fx.t) 老化。跨机时钟不可混用，
  // 故收到快照须把 t 与各 fx.t 平移到本机时基（d = 本机接收时刻 − 发送端序列化时刻）。
  it('t 与各 fx.t 被平移到本机时基（d = recvMs - 原 t，加到每个 fx.t）', () => {
    const sendT = 1000; // 发送端序列化时刻
    const recvMs = 1050; // 本机接收时刻（收发延迟 50ms）
    const fx = { kind: 'skill', t: sendT + 10, skillKind: 'meteor', dur: 0.8, c: 1, r: 1 };
    const s = mkSnap(sendT, [], { fx: [fx as PvpSnapFx] });
    const out = normalizeSnapClock(s, recvMs);
    expect(out).toBe(s); // 原地改写、返回同一引用
    expect(s.t).toBe(recvMs); // t 直接置为本机接收时刻
    expect(s.fx[0]!.t).toBe(sendT + 10 + (recvMs - sendT)); // fx.t += d = 1010 + 50 = 1060
  });

  it('归一化后 interpAt 用本机 nowMs 比较得正确 alpha（跨机时钟不混用）', () => {
    // 发送端两份快照 t=1000/1100；本机延迟 50ms 收到 → 归一化后 t=1050/1150。
    const view = new PvpOppView();
    const s0 = mkSnap(1000, [mkMonster(1.0)]);
    const s1 = mkSnap(1100, [mkMonster(1.1)]);
    normalizeSnapClock(s0, 1050);
    normalizeSnapClock(s1, 1150);
    view.ingest(s0);
    view.ingest(s1);
    // 本机 nowMs=1170 → renderTime=1050（delay=120）；lagRatio=(1050-1050)/100=0 → 棘轮 hold 在 prev=1.0
    expect(view.interpAt(1170).monsters[0]!.dist).toBeCloseTo(1.0, 6);
    // 本机 nowMs=1220 → renderTime=1100=cur.t；lagRatio=1 → 棘轮追到 cur=1.1（平滑后落在 [1.0,1.1] 内）。
    // Task 7.5 后不再精确等于旧固定 alpha 的 1.05（自适应缓冲+棘轮），改为带内断言。
    const d1220 = view.interpAt(1220).monsters[0]!.dist;
    expect(d1220).toBeGreaterThanOrEqual(1.0 - 0.02);
    expect(d1220).toBeLessThanOrEqual(1.1 + 0.02);
  });
});
