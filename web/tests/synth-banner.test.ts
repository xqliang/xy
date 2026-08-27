// web/tests/synth-banner.test.ts
// 需求3：武将「首次合成/激活」那一刻，在武将上方浮现黄色大字「合成神将」（水墨底、闪几下、上浮淡出）。
// 本测试锁定「战斗侧」契约（渲染表现走真机冒烟）：
//   1) 两张同将字牌左右相邻首次成将 → 生成 1 条浮字，锚定武将左格，文字「合成神将」；
//   2) 浮字随时间衰减、到期自动清除；
//   3) 同一对武将持续激活不重复弹字（不刷屏）；
//   4) 拆开后再合成 → 重新弹字；
//   5) 续玩（applyCoreState 恢复已激活武将）→ 不误弹字（synthSeenPairKeys 随恢复播种）。
//
// 触发路径无关：探测器放在 updateFx，每帧对比当前激活对；这里直接驱动 (b as any).updateFx(dt)
// 做确定性验证，绕开 step 的开波/倒计时分支。二郎＝「二」+「郎」（matchGeneral 左→右）。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META, type Cell } from '../src/battle';
import { MAPS } from '../src/board';

const mkBattle = () =>
  new Battle(7, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined);
const key = (c: Cell) => `${c.c},${c.r}`;

// 找一对左右相邻的已解锁格 [左, 右]
function adjacentOpenPair(b: Battle): [Cell, Cell] {
  const open = b.unlockedCells();
  const set = new Set(open.map((c) => `${c.c},${c.r}`));
  for (const c of open) {
    if (set.has(`${c.c + 1},${c.r}`)) return [c, { c: c.c + 1, r: c.r }];
  }
  throw new Error('测试棋盘没有左右相邻的已解锁格');
}

// 在 [L,R] 摆下二郎的「二」「郎」两字（1 阶）
function placeErlang(b: Battle, L: Cell, R: Cell): void {
  b.words.set(key(L), { char: '二', general: 'erlang', tier: 1, cell: L });
  b.words.set(key(R), { char: '郎', general: 'erlang', tier: 1, cell: R });
}

describe('需求3 · 合成神将浮字特效', () => {
  it('两字相邻首次成将 → 生成 1 条「合成神将」浮字，锚定武将左格', () => {
    const b = mkBattle();
    const [L, R] = adjacentOpenPair(b);
    placeErlang(b, L, R);

    (b as any).updateFx(0.05);

    expect(b.synthBanners.length).toBe(1);
    expect(b.synthBanners[0]!.text).toBe('合成神将');
    expect(b.synthBanners[0]!.c).toBe(L.c);
    expect(b.synthBanners[0]!.r).toBe(L.r);
  });

  it('浮字随时间衰减，到期自动清除', () => {
    const b = mkBattle();
    const [L, R] = adjacentOpenPair(b);
    placeErlang(b, L, R);
    (b as any).updateFx(0.05);
    expect(b.synthBanners.length).toBe(1);

    // 累计推进足够久（> 生命）→ 清空。用较大步长，避免依赖具体 TTL 常量。
    for (let i = 0; i < 40; i++) (b as any).updateFx(0.1);

    expect(b.synthBanners.length).toBe(0);
  });

  it('同一对武将持续激活不重复弹字', () => {
    const b = mkBattle();
    const [L, R] = adjacentOpenPair(b);
    placeErlang(b, L, R);
    (b as any).updateFx(0.05); // 首次成将 → 1 条
    const after1 = b.synthBanners.length;

    (b as any).updateFx(0.05); // 仍是同一对，不应再弹
    (b as any).updateFx(0.05);

    expect(b.synthBanners.length).toBe(after1); // 没有新增
  });

  it('拆开后再合成 → 重新弹字', () => {
    const b = mkBattle();
    const [L, R] = adjacentOpenPair(b);
    placeErlang(b, L, R);
    (b as any).updateFx(0.05);
    expect(b.synthBanners.length).toBe(1);

    b.words.delete(key(R)); // 拿走右字 → 武将拆开失活
    (b as any).updateFx(0.05);
    const beforeReform = b.synthBanners.length;

    b.words.set(key(R), { char: '郎', general: 'erlang', tier: 1, cell: R }); // 再合成
    (b as any).updateFx(0.05);

    expect(b.synthBanners.length).toBeGreaterThan(beforeReform); // 重新弹了一条
  });

  it('续玩恢复已激活武将 → 不误弹字', () => {
    const a = mkBattle();
    const [L, R] = adjacentOpenPair(a);
    placeErlang(a, L, R);
    (a as any).updateFx(0.05); // 让 a 形成武将并写入 lastActivePairKeys
    const dumped = JSON.parse(JSON.stringify(a.serialize())); // 模拟落盘

    const b = mkBattle();
    b.applyCoreState(dumped.core); // 续玩恢复：武将已在场
    (b as any).updateFx(0.05);

    expect(b.synthBanners.length).toBe(0); // 恢复的旧武将不应触发「合成」浮字
  });
});
