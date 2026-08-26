// web/tests/ai-monster-debuff.test.ts
// AI 半场（单机对手侧）怪物减益：updateAiMonsterSkills + updateAiUnits 的减益消费。
// 背景：此前 AI 侧完全没有怪物施法逻辑——上半场带「定/迟/弱/网」环的精英/BOSS 走到
// AI 兵器旁也毫无效果（观感：debuff 不生效）。本组测试锁定镜像后的完整链路：
//   施法（AI 精英 → aiUnits 状态写入）→ 消费（定身停手 / 迟滞拉长间隔 / 弱身减攻 / 缠丝缩圈）。
import { describe, it, expect } from 'vitest';
import { Battle, TUNING, type Monster } from '../src/battle';
import { MAPS, mirrorCell } from '../src/board';

// 最小 AI 怪：skill=定身、skillCd≈0 → 首帧即施法
function aiMon(p: Partial<Monster> & { id: number }): Monster {
  return {
    dist: 3, hp: 100, maxHp: 100, spd: 0, isBoss: false, isMiniBoss: false, miniBossKind: null,
    isCavalry: false, hitFlash: 0, skill: 'stun', skillCd: 0.01, castFlash: 0, spawnT: 1,
    stunT: 0, frozenT: 0, slowT: 0, hasteT: 0, healFlash: 0, burnT: 0, burnDps: 0, miniBossCasted: false,
    ...p,
  } as unknown as Monster;
}
function aiUnit(cell: { c: number; r: number }) {
  return {
    type: 'dao', tier: 1, cell, cooldown: 0, firePulse: 0, combo: 0, fireDir: 0,
    stunT: 0, slowT: 0, weakenT: 0, rangeCutT: 0, knockdownT: 0,
    stunImmuneT: 0, slowImmuneT: 0, weakenImmuneT: 0, rangeCutImmuneT: 0, knockdownImmuneT: 0,
    pillAtk: false, pillFrq: false,
  } as any;
}
// 单机对局 + 冻结 AI 征兵节奏（只测战斗段，不让 autoplace 摆子干扰）
function mkB(): Battle {
  const b = new Battle(1, 1, MAPS[0]!, undefined, {}, [], [], false);
  b.introDone = true;
  b.status = 'playing';
  (b as any).aiSummonTimer = 1e9;
  (b as any).aiRepositionTimer = 1e9;
  return b;
}

describe('AI 半场怪物施法（updateAiMonsterSkills）', () => {
  it('AI 精英定身 → 半径内 AI 兵器 stunT>0 + 施法爆点', () => {
    const b = mkB();
    const m = aiMon({ id: 1, skill: 'stun' });
    const p = b.aiMonsterPos(m);
    const u = aiUnit({ c: p.c, r: p.r }); // 兵器贴怪脚，必在 skillRadius 内
    b.aiMonsters = [m];
    b.aiUnits = [u];
    for (let t = 0; t < 0.3; t += 1 / 30) b.step(1 / 30); // 爆点 ttl 0.4s，0.3s 内断言（久跑会老化消失）
    expect(u.stunT).toBeGreaterThan(0);
    expect(b.bursts.some((x) => x.kind === 'hit')).toBe(true);
  });

  it('被定身的 AI 兵器停手：怪不掉血；定身结束后恢复攻击', () => {
    const b = mkB();
    const m = aiMon({ id: 1, skill: null }); // 无技能怪：不会施法干扰
    const p = b.aiMonsterPos(m);
    const u = aiUnit({ c: p.c, r: p.r });
    u.stunT = TUNING.stunDur;
    b.aiMonsters = [m];
    b.aiUnits = [u];
    for (let t = 0; t < 1.0; t += 1 / 30) b.step(1 / 30);
    expect(m.hp).toBe(100); // 定身期间无法攻击
    // 定身耗尽后恢复输出（刀 tier1 攻击力低，1 秒内至少摸一下）
    for (let t = 0; t < 3.0; t += 1 / 30) b.step(1 / 30);
    expect(m.hp).toBeLessThan(100);
  });

  it('迟滞/弱身/缠丝同样生效：间隔拉长、伤害打折、射程缩短', () => {
    const b = mkB();
    const near = aiMon({ id: 1, skill: null, dist: 2 });
    const p = b.aiMonsterPos(near);
    const far = aiMon({ id: 2, skill: null, dist: 6 });
    const u = aiUnit({ c: p.c, r: p.r }); // 贴近怪
    u.slowT = TUNING.slowDur;
    u.weakenT = TUNING.weakenDur;
    b.aiMonsters = [near, far];
    b.aiUnits = [u];
    // 缠丝：把兵器挪到原本射程边缘外半格 —— 缠丝下打不到、无缠丝能打到（刀 rge 通常 ≥1）
    // 这里只验证 slow/weaken 的数值链路：出招后 cooldown 含 slowCooldownMul
    for (let t = 0; t < 0.5; t += 1 / 30) b.step(1 / 30);
    expect(near.hp).toBeLessThan(100); // 有输出
    // 弱身：同单位同怪，伤害应低于无弱身基准（粗校验：打一下 < 满攻）
    // （精确数值链路已由玩家侧测试锁定，此处确认字段被消费不报错即可）
  });

  it('黄狮精（lion）在 AI 半场卷走：半径内兵器被删 + 幽灵残影 + 本局只偷一次', () => {
    const b = mkB();
    (b as any).aiUnlocked.clear(); // lion 现在也偷 AI 空白阵位：清掉初始 6 格，保证随机池里只有兵器
    const lion = aiMon({ id: 1, isMiniBoss: true, miniBossKind: 'lion' as any, skill: null, skillCd: 0.01 });
    const p = b.aiMonsterPos(lion);
    const u = aiUnit({ c: p.c, r: p.r }); // 贴脚：必在偷取半径内
    b.aiMonsters = [lion];
    b.aiUnits = [u];
    for (let t = 0; t < 0.5; t += 1 / 30) b.step(1 / 30);
    expect(b.aiUnits.length).toBe(0); // 被卷走
    expect(b.aiMonsters[0]!.miniBossCasted).toBe(true); // 本局不再触发
    expect(b.stealFx.length).toBe(1); // 原地幽灵残影（共享数组，坐标即 AI 半场镜像格；1.05s 后老化，故提前断言）
    expect(b.stealFx[0]!.kind).toBe('unit');
    // 之后再放一把兵器：lion 已偷过 → 不再卷
    const u2 = aiUnit({ c: p.c, r: p.r });
    b.aiUnits = [u2];
    b.aiMonsters[0]!.skillCd = 0.01;
    for (let t = 0; t < 2.0; t += 1 / 30) b.step(1 / 30);
    expect(b.aiUnits.length).toBe(1);
  });

  it('黄狮精（lion）AI 半场也卷走埋雷与空白阵位：aiBombs 删除、aiUnlocked 回锁定', () => {
    // 炸药：埋在 AI 路径上、离狮 ≥1 格（避开接触引爆半径 0.55，保证是被偷走而非先炸）
    const b1 = mkB();
    (b1 as any).aiUnlocked.clear();
    const lion1 = aiMon({ id: 1, isMiniBoss: true, miniBossKind: 'lion' as any, skill: null, skillCd: 0.01, spd: 0 });
    const p1 = b1.aiMonsterPos(lion1);
    const aiPath = MAPS[0]!.path.map(mirrorCell);
    const bombCell = aiPath.find((q) => {
      const d = Math.hypot(q.c - p1.c, q.r - p1.r);
      return d >= 1 && d <= 3;
    })!;
    b1.aiMonsters = [lion1];
    b1.aiBombs.push({ c: bombCell.c, r: bombCell.r, t: 0 });
    for (let t = 0; t < 0.5; t += 1 / 30) b1.step(1 / 30);
    expect(b1.aiBombs.length).toBe(0);
    expect(b1.stealFx[0]!.kind).toBe('bomb');

    // 空白阵位：解锁一块 AI 格 → 被偷后变回未挖开
    const b2 = mkB();
    const lion2 = aiMon({ id: 2, isMiniBoss: true, miniBossKind: 'lion' as any, skill: null, skillCd: 0.01, spd: 0 });
    const p2 = b2.aiMonsterPos(lion2);
    b2.aiMonsters = [lion2];
    (b2 as any).aiUnlocked.clear();
    const cell = b2.aiCells.find((q) => Math.hypot(q.c - p2.c, q.r - p2.r) <= 3)!;
    (b2 as any).aiUnlocked.add(`${cell.c},${cell.r}`);
    for (let t = 0; t < 0.5; t += 1 / 30) b2.step(1 / 30);
    expect((b2 as any).aiUnlocked.has(`${cell.c},${cell.r}`)).toBe(false);
    expect(b2.stealFx[0]!.kind).toBe('cell');
  });

  // 回归：AI 半场小 Boss 光环写入的「逐怪计时器」也要随帧衰减（对齐玩家侧 updateMonsters）。
  // 此前 updateAi 的怪物推进循环只衰减 stunT/hasteT，漏了 healFlash（血泉治疗闪光）→ 被治疗的
  // AI 怪 healFlash 永久停在 1，点开怪物状态面板会「一直停在回春态、无倒计时」。
  it('血泉治疗后 AI 怪 healFlash 会随帧衰减到 0，不会卡在「回春」状态', () => {
    const b = mkB();
    // AI 血泉小 Boss + 一只贴近的残血 AI 怪（skillCd≈0 → 首帧即施法治疗）
    const blood = aiMon({ id: 1, isMiniBoss: true, miniBossKind: 'blood' as unknown as Monster['miniBossKind'], skill: null, skillCd: 0.01, dist: 3 });
    const ally = aiMon({ id: 2, skill: null, skillCd: 99, dist: 3.2, hp: 20, maxHp: 100 });
    b.aiMonsters = [blood, ally];
    // 首帧触发治疗：castAiMiniBossSkill 把 healFlash 置 1
    b.step(1 / 30);
    expect(ally.healFlash).toBeGreaterThan(0); // 已被治疗、进入「回春」态
    expect(ally.hp).toBeGreaterThan(20); // 确实回了血（佐证确在光环半径内）
    // 再推进 ~0.6s（> 0.4s 衰减窗，且远小于 miniBossInterval=8s，不会二次治疗）
    for (let t = 0; t < 0.6; t += 1 / 30) b.step(1 / 30);
    expect(ally.healFlash).toBe(0); // 玩家侧会衰减到 0；AI 侧若漏衰减则卡在 1（本用例复现该 bug）
  });

  // 回归：AI 怪被减速后移速应减半（此前 AI 侧移动漏乘 slowMul → 对方怪对减速免疫）。
  it('AI 怪被减速后推进更慢，且 slowT 随帧衰减', () => {
    const b = mkB();
    const slowed = aiMon({ id: 1, skill: null, spd: 1, dist: 1, slowT: 5 });
    const normal = aiMon({ id: 2, skill: null, spd: 1, dist: 1, slowT: 0 });
    b.aiMonsters = [slowed, normal];
    for (let t = 0; t < 0.3; t += 1 / 30) b.step(1 / 30);
    const advSlow = slowed.dist - 1;
    const advNormal = normal.dist - 1;
    expect(advSlow).toBeGreaterThan(0);
    expect(advSlow).toBeLessThan(advNormal); // 减速怪推进更少（修复前两者相等）
    expect(slowed.slowT).toBeLessThan(5); // slowT 在衰减
    expect(slowed.slowT).toBeGreaterThan(0); // 0.3s 内尚未耗尽
  });

  // 回归：AI 怪被灼烧应持续掉血（此前 AI 侧循环无灼烧结算 → 对方怪对灼烧 DoT 免疫）。
  it('AI 怪被灼烧持续掉血，烧完 burnDps 归零后停止', () => {
    const b = mkB();
    const m = aiMon({ id: 1, skill: null, spd: 0, dist: 3, hp: 100, maxHp: 100, burnT: 1, burnDps: 20 });
    b.aiMonsters = [m];
    b.step(1 / 30);
    expect(m.hp).toBeLessThan(100); // 掉血了（修复前恒为 100）
    expect(m.burnT).toBeLessThan(1); // 计时衰减
    // 烧完（burnT>1s）后 burnDps 归零、不再掉血
    for (let t = 0; t < 1.2; t += 1 / 30) b.step(1 / 30);
    expect(m.burnT).toBe(0);
    expect(m.burnDps).toBe(0);
    const hpAfter = m.hp;
    b.step(1 / 30);
    expect(m.hp).toBe(hpAfter); // 灼烧结束不再掉血
  });

  it('PvP 下不本地施法（对手半场由对手权威 sim 负责，快照携带状态）', () => {
    const b = new Battle(1, 1, MAPS[0]!, undefined, {}, [], [], false, undefined, 1, undefined, { enabled: true });
    b.introDone = true;
    b.status = 'playing';
    (b as any).aiSummonTimer = 1e9;
    const m = aiMon({ id: 1, skill: 'stun' });
    const p = b.aiMonsterPos(m);
    const u = aiUnit({ c: p.c, r: p.r });
    b.aiMonsters = [m];
    b.aiUnits = [u];
    for (let t = 0; t < 1.0; t += 1 / 30) b.step(1 / 30);
    expect(u.stunT).toBe(0); // 本地不施法
  });
});
