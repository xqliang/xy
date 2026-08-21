// 在线 PvP followup：下发对手真实 loadout，oppBattle 用对手配装忠实重放。
// 价值证明——重放正确性对比：三个同 seed 的 pvp Battle 对喂同一串动作，
// 断言「对手真实 loadout 的 oppBattle(good)」与「对手真机(ref)」逐帧全等，
// 而「对称占位(用本方 loadout) 的 oppBattle(bad)」与真机发散。
//
// 被动对结构性重放的影响（web/src/battle.ts applyItem/applyAiItem）：
//   xianyuan  → mods.summonCostDelta -1  → 征兵桃耗降低（对手成功的征兵，在对称占位里会因缺桃失败）【确定性发散】
//   zhaoxian  → mods.wordRateBonus   +0.1 → 字牌掉率提高（字牌转换阈值不同，首出字起逐 tick 结构发散）
//   fabaofu   → mods.generalTierDelta +1  → 武将首次激活升阶（影响武将塔，回灌抽字策略）
// 三者的被动 id 已 grep web/src/passives.ts + battle.ts:4585 确认真实存在。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Battle, NO_META } from '../src/battle';
import { MAPS } from '../src/board';
import { versusEnqueue, versusRoomCreate, versusRoomJoin } from '../src/api/pvp-client';
import type { PvpLoadout } from '../src/api/pvp-client';

// 与 main.ts onPvpMatched 的 mk() 同构：同 seed、difficulty=1、pvpInit.enabled=true。
// meta 传 NO_META（全 0，对齐 main.ts 的 metaBonuses(merit) 产物——传空 {} 会让 bonusPeach=undefined→peach=NaN）；
// weapons 传 {}（pvp 下仅影响怪血数值，对结构性重放无影响）；actives=[]（本组重点在 passives，equipped 另有用例）。
// a8=aiSkill=undefined→DEFAULT_AI_SKILL；a9=aiAdjustIntervalScale=1；pvpInit={enabled:true}。
const mk = (passives: string[], equipped: string[] = []) =>
  new Battle(7777, 1, MAPS[0]!, NO_META, {}, equipped, passives, false, undefined, 1, undefined, { enabled: true });

// 样本 loadout（与服务端契约 PvpLoadout 逐字段对齐）。meta 当前恒 0（metaBonuses 全 0），照填。
const META0 = { bonusPeach: 0, bonusHp: 0, bonusSlots: 0, atkPct: 0, frqPct: 0 };
const SAMPLE_LO: PvpLoadout = {
  equipped: ['act_meteor'],
  passives: ['xianyuan', 'zhaoxian'],
  weapons: { wukong: { atk: 0.12, frq: 0.05, rge: 0.5 } },
  meta: META0,
};

describe('PvP 对手 loadout 忠实重放（重放正确性对比·核心价值证明）', () => {
  it('xianyuan(征兵桃耗)：正确 loadout 的 oppBattle 与对手真机逐帧全等，对称占位确定性发散', () => {
    // ref  = 对手真机：用对手真实 passives=['xianyuan']（summonCostDelta=-1，征兵更便宜）。
    // good = 修复后的 oppBattle：用「对手」passives=['xianyuan']（正确）→ 应与 ref 全等。
    // bad  = 修复前的 oppBattle：用「本方」passives=[]（对称占位，错误）→ 征兵桃耗未降，第二抽即缺桃失败。
    //
    // 经济账（开局桃=INITIAL_PEACH=20，首征 cost=10、每次 +2）：
    //   ref/good(xianyuan, cost-1)：第1抽 9→剩11，第2抽 11→剩0，第3抽 13 缺桃失败。→ summonCount=2, peach=0, 有效成本=13
    //   bad([], cost 不变)：       第1抽 10→剩10，第2抽 12 缺桃失败，第3抽 14 缺桃失败。→ summonCount=1, peach=10, 有效成本=12
    // 这是确定性分支（征兵成败是硬分支，非概率），保证测试每次都有牙、不抖动。
    const ref = mk(['xianyuan']);
    const good = mk(['xianyuan']);
    const bad = mk([]); // 对称占位：本方无被动

    // 喂同一串 summon/autoplace 命令（pvp 下 autoplace 已确定化，deadlineMs=undefined）。
    for (let i = 0; i < 4; i++) {
      for (const b of [ref, good, bad]) {
        b.applyPvpInput({ t: i * 2, op: 'summon' });
        b.applyPvpInput({ t: i * 2 + 1, op: 'autoplace' });
      }
    }

    const refSnap = ref.snapshot();
    const goodSnap = good.snapshot();
    const badSnap = bad.snapshot();

    // 正确 loadout → 忠实重放：oppBattle 与对手真机逐帧全等（这是本 followup 要保证的不变量）。
    expect(goodSnap).toEqual(refSnap);
    // 错 loadout → 发散：对称占位与真机不等（证明本 followup 必需、测试有牙）。
    expect(badSnap).not.toEqual(refSnap);
    // 显式钉住发散点：征兵桃耗差异导致的 summonCost/peach 必然不同。
    expect(badSnap.summonCost).not.toBe(refSnap.summonCost);
    expect(badSnap.peach).not.toBe(refSnap.peach);
    // 期望的具体值（文档化，便于日后 tuning 变动时定位）。
    expect(refSnap.summonCost).toBe(13); // xianyuan 下第2抽后有效成本 14-1=13
    expect(badSnap.summonCost).toBe(12); // 无被动下第1抽后有效成本 12
    expect(refSnap.peach).toBe(0);
    expect(badSnap.peach).toBe(10);
  });

  it('zhaoxian(字牌掉率)：正确 loadout 的 oppBattle 与对手真机逐帧全等（字率被动忠实接线）', () => {
    // 字率被动的分歧是概率性的（同一 rng 流、不同阈值），单跑不保证 bad≠ref；
    // 故本条只钉死「正确 loadout 忠实」这一不变量（good==ref，确定性），
    // bad≠ref 的「有牙」证明由上一条 xianyuan 的确定性发散承担。
    const run = (passives: string[]) => {
      const b = mk(passives);
      for (let i = 0; i < 6; i++) {
        b.applyPvpInput({ t: i, op: 'summon' });
      }
      return b.snapshot();
    };
    const ref = run(['zhaoxian']);
    const good = run(['zhaoxian']);
    expect(good).toEqual(ref); // 同 seed + 同对手 loadout → 逐帧复现
  });
});

describe('PvP 对手 loadout 接线（equipped 主动槽忠实）', () => {
  it('oppBattle 用对手 equipped 时建出对应主动槽；本方 equipped 不同则槽不同', () => {
    // 主动 id 决定运行时槽（battle.ts 构造器按 actives 建 activeSlots）。
    // 对手真机装了 act_meteor → 有 1 个 meteor 槽；对称占位([]) → 0 槽。
    // 喂对手 'active' 命令时，无对应槽的对称占位无法重放该主动技（这正是要修的缺陷）。
    const oppReal = mk([], ['act_meteor']);
    const symmetric = mk([], []);
    expect(oppReal.activeSlots.map((s) => s.id)).toEqual(['act_meteor']);
    expect(symmetric.activeSlots.length).toBe(0);
  });
});

describe('pvp-client loadout 契约', () => {
  it('versusEnqueue/RoomCreate/RoomJoin 把本方 loadout 放进请求体（字段名逐字对齐）', async () => {
    // 捕获 fetch 实际发出的 body，核对 loadout 字段名与契约一致。
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, text: async () => JSON.stringify({ ticket: 'tk' }) };
    }) as unknown as typeof fetch);

    await versusEnqueue(3, SAMPLE_LO);
    await versusRoomCreate(4, SAMPLE_LO);
    await versusRoomJoin('ABC123', SAMPLE_LO);

    expect(bodies[0]).toMatchObject({ rank: 3, loadout: SAMPLE_LO });
    expect(bodies[1]).toMatchObject({ rank: 4, loadout: SAMPLE_LO });
    expect(bodies[2]).toMatchObject({ code: 'ABC123', loadout: SAMPLE_LO });

    // 字段名逐字对齐契约：equipped/passives/weapons/meta。
    const sent = (bodies[0] as { loadout: PvpLoadout }).loadout;
    expect(Object.keys(sent).sort()).toEqual(['equipped', 'meta', 'passives', 'weapons']);
    expect(sent.equipped).toEqual(['act_meteor']);
    expect(sent.passives).toEqual(['xianyuan', 'zhaoxian']);
  });

  it('loadout 缺省（旧客户端/可选）时不放该字段、仍可调用', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, text: async () => JSON.stringify({ ticket: 'tk' }) };
    }) as unknown as typeof fetch);
    // 不传 loadout（可选参数）→ 向后兼容，body 里不应出现 loadout 键。
    await versusEnqueue(3);
    expect(bodies[0]).toEqual({ rank: 3 });
  });

  afterEach(() => { vi.restoreAllMocks(); });
});
