import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';
import { userAgentTick } from '../src/versus-user-agent';

// 构造一个本地 AI 对战局（endless=false）。map 用固定图，seed 固定以复现。
function newVersus(seed: number): Battle {
  return new Battle(seed, 1, mapById('huoyanshan'), undefined, undefined, undefined, undefined, false, 1.0, 1);
}

// 驱动到"清完第 1 波后的 ready 检查点"并冻结（不再 step）。
function driveToReadyAfterWave1(b: Battle): void {
  const dt = 1 / 30;
  for (let f = 0; f < 30 * 300; f++) { // 上限 ~300s sim，防挂
    if (b.status === 'ready') {
      if (b.wave >= 1) return;   // 已清 ≥1 波、停在 ready → 波次检查点
      b.startNextWave();         // 从 intro/波间 ready 起手开波
    } else {
      userAgentTick(b);          // playing：征兵/布阵/放技能（确定性，用 battle 内 RNG）
    }
    b.step(dt);
    if (b.status === 'won' || b.status === 'lost') throw new Error('对局在检查点前已终局');
  }
  throw new Error('未能在上限内到达 wave≥1 的 ready');
}

describe('Battle 序列化/恢复', () => {
  it('serialize → JSON 往返 → applyCoreState 后再 serialize 完全相等', () => {
    const a = newVersus(20260823);
    driveToReadyAfterWave1(a);
    const dumped = JSON.parse(JSON.stringify(a.serialize())); // 模拟落 localStorage
    const b = new Battle(1, dumped.config.difficultyMul, mapById(dumped.config.mapId),
      undefined, undefined, undefined, undefined, dumped.config.endless, undefined, dumped.config.aiAdjustIntervalScale);
    b.applyCoreState(dumped.core);
    // 比较「JSON 归一化后」的形态（即真正落盘的形态）：applyCoreState 会把 tray 的 null 槽还原成洞，
    // 直接 toEqual 会因「洞 vs null」误判；再 JSON 往返一次把两侧都归一化到 null，锁字段集/值保真。
    expect(JSON.parse(JSON.stringify(b.serialize().core))).toEqual(dumped.core);
  });

  it('恢复后与原局同输入步进 → 观测量一致（证明无遗漏 sim 字段 + RNG 正确）', () => {
    const a = newVersus(11111);
    driveToReadyAfterWave1(a);
    const dumped = JSON.parse(JSON.stringify(a.serialize()));
    const b = new Battle(1, dumped.config.difficultyMul, mapById(dumped.config.mapId),
      undefined, undefined, undefined, undefined, dumped.config.endless, undefined, dumped.config.aiAdjustIntervalScale);
    b.applyCoreState(dumped.core);

    const dt = 1 / 30;
    for (let f = 0; f < 30 * 40; f++) { // 继续打 ~40s：会开第 2 波并交火
      if (a.status === 'ready') a.startNextWave(); else userAgentTick(a);
      if (b.status === 'ready') b.startNextWave(); else userAgentTick(b);
      a.step(dt); b.step(dt);
      if (a.status === 'won' || a.status === 'lost') break;
    }
    const sa = a.snapshot();
    const sb = b.snapshot();
    expect(sb.wave).toBe(sa.wave);
    expect(sb.status).toBe(sa.status);
    expect(sb.tangsengHP).toBeCloseTo(sa.tangsengHP, 5);
    expect(sb.aiHp).toBeCloseTo(sa.aiHp, 5);
    expect(sb.units).toBe(sa.units);       // snapshot.units = 数量
    expect(sb.monsters).toBe(sa.monsters); // snapshot.monsters = 数量
    expect(sb.peach).toBe(sa.peach);       // 经济观测：桃子数须逐帧一致（收紧遗漏 sim 字段的网）
  });

  it('无尽局同样可往返（endless=true）', () => {
    const a = new Battle(999, 1, mapById('huoyanshan'), undefined, undefined, undefined, undefined, true, 1.0, 1);
    driveToReadyAfterWave1(a);
    const dumped = JSON.parse(JSON.stringify(a.serialize()));
    const b = new Battle(1, dumped.config.difficultyMul, mapById(dumped.config.mapId),
      undefined, undefined, undefined, undefined, dumped.config.endless, undefined, dumped.config.aiAdjustIntervalScale);
    b.applyCoreState(dumped.core);
    expect(JSON.parse(JSON.stringify(b.serialize().core))).toEqual(dumped.core);
  });

  it('applyCoreState 把 tray 的 null 槽恢复成洞（稀疏语义），forEach 不读到 null', () => {
    const a = newVersus(555);
    driveToReadyAfterWave1(a);
    const dumped = JSON.parse(JSON.stringify(a.serialize()));
    dumped.core.tray = [null, null, null];      // 模拟 JSON 把洞变 null
    const b = new Battle(1, dumped.config.difficultyMul, mapById(dumped.config.mapId), undefined, undefined, undefined, undefined, dumped.config.endless, undefined, dumped.config.aiAdjustIntervalScale);
    b.applyCoreState(dumped.core);
    expect(0 in b.tray).toBe(false);            // 是洞，不是 null
    expect(2 in b.tray).toBe(false);
    expect(b.tray.length).toBe(3);
    let sawNull = false;
    b.tray.forEach((t) => { if (t === null) sawNull = true; else void t.kind; }); // 洞被跳过；绝不产出 null
    expect(sawNull).toBe(false);
  });
});
