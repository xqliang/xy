// web/tests/battle.ai-kill-juice.test.ts
// 离线 AI 对战（伪竞技）：AI 半场击杀的掉桃特效。
// 语义对称性：玩家击杀有 death 爆点 + 桃飘字（updateMonsters）；在线 PvP 对手击杀由
// stepOpponentJuice→spawnAiKillJuice 快照补演同样两件套；离线 AI 对战此前走 creditAiKill
// 只加 aiPeach 数字、无任何视觉反馈 —— 修复后应复用 spawnAiKillJuice，与在线补演完全一致。
import { describe, it, expect } from 'vitest';
import { Battle, type Monster } from '../src/battle';

/** 最小合法 Monster（字段对齐 ai-active-timing.test.ts 的 mkMonster）。 */
function mkMonster(id: number, dist: number, extra: Partial<Monster> = {}): Monster {
  return {
    id,
    dist,
    hp: 10,
    maxHp: 10,
    spd: 1,
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
    ...extra,
  };
}

/** 离线 AI 对战起局（伪竞技：pvp=false，updateAi 本地跑 AI 半场完整 sim）。 */
function mkAiBattle(): Battle & { updateAi(dt: number): void } {
  const b = new Battle(7, 1);
  b.status = 'playing';
  return b as unknown as Battle & { updateAi(dt: number): void };
}

describe('离线 AI 对战：AI 击杀掉桃特效', () => {
  it('AI 半场怪 hp<=0 被清时：death 爆点 + 桃飘字 + aiPeach 照旧累计', () => {
    const b = mkAiBattle();
    const peachBefore = b.aiPeach;                   // 开局有 INITIAL_PEACH 底仓
    b.aiMonsters = [mkMonster(1, 5)];
    b.aiMonsters[0]!.hp = 0; // 已被打死，等 updateAi 清怪结算

    b.updateAi(1 / 30);

    expect(b.aiMonsters).toHaveLength(0);            // 击杀清怪（回归保护）
    expect(b.aiPeach).toBeGreaterThan(peachBefore);  // 经济照旧只记一次（creditAiKill）
    expect(b.peachFloats.length).toBe(1);            // 桃飘字：击杀特效
    expect(b.peachFloats[0]!.amount).toBeGreaterThan(0);
    expect(b.bursts.some((x) => x.kind === 'death')).toBe(true); // death 爆点
  });

  it('击杀特效坐标落在 AI 半场（aiPath 沿线，非玩家侧路径）', () => {
    const b = mkAiBattle();
    b.aiMonsters = [mkMonster(1, 5)];
    b.aiMonsters[0]!.hp = 0;
    b.updateAi(1 / 30);

    const f = b.peachFloats[0]!;
    // AI 路径格集合：飘字格应与 aiPath 某格重合（镜像上半场），而不是落在玩家路径上
    const onAiPath = b.aiPath.some((c) => c.c === f.c && c.r === f.r);
    expect(onAiPath).toBe(true);
  });

  it('漏怪（走到终点吃唐僧）不产生击杀特效、不产桃', () => {
    const b = mkAiBattle();
    const hpBefore = b.aiTangsengHP;
    const peachBefore = b.aiPeach;                   // 开局有 INITIAL_PEACH 底仓
    b.aiMonsters = [mkMonster(1, b.aiPathLen - 0.01, { hp: 1 })]; // 满血但马上游走到终点
    b.updateAi(1 / 30);

    expect(b.aiMonsters).toHaveLength(0);            // 漏怪同样清场
    expect(b.aiPeach).toBe(peachBefore);             // 漏怪不产桃（语义不变）
    expect(b.peachFloats.length).toBe(0);            // 无击杀特效
    expect(b.bursts.some((x) => x.kind === 'death')).toBe(false);
    expect(b.aiTangsengHP).toBeLessThan(hpBefore);   // 但唐僧确实扣血了（确是漏怪路径）
  });
});
