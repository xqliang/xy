// web/tests/pvp-bridge.test.ts
// Plan C Task 8：渲染桥 bridgeOpponentFrom。
//
// 在线 PvP 本机跑两个确定性 Battle：battle（本方实时权威）+ oppBattle（对手，同 seed、延迟重放）。
// pvp 下两实例都不用自己的 ai* 侧（T7 已门控）——对手半场靠把 oppBattle 的「本方侧」每帧镜像进
// battle.ai* 来渲染（复用现成 drawAiSide/drawAiItemsHud 画上半场）。本测试锁死这座桥的字段映射。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META } from '../src/battle';
import { mirrorCell } from '../src/board';
import { MAPS } from '../src/board';

// 与 battle.pvp-input.test.ts 的 mkPvp 同构：同 seed/difficulty=1、pvpInit.enabled=true。
// meta 传 NO_META（全 0）而非 {}：{} 会让 bonusHp/bonusSlots 变 undefined → tangsengHP/初始阵位变 NaN，
// 既不真实也挡不住桥的等价断言。NO_META 正是真实 pvp 路径（main.ts 传 metaBonuses(merit)）对一个新玩家的取值。
const mkPvp = () =>
  new Battle(1, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: true });

// 把对手 opp 养成「可观察的本方侧状态」：开波出怪 + 征兵/布阵让单位、字牌上板。
// 用确定性 pvp 输入（applyPvpInput）+ step 推进；自动布阵在 pvp 下已确定化（deadlineMs=undefined）。
function seedOpponentBoard(opp: Battle): void {
  opp.startNextWave(); // 开波：后续 step 会出怪（spawnTimer 从 0 起，首步即出）
  for (let i = 0; i < 3; i++) {
    opp.applyPvpInput({ op: 'summon' });
    opp.applyPvpInput({ op: 'autoplace' });
    for (let k = 0; k < 25; k++) opp.step(1 / 30); // 布阵播放节拍 + 出怪
  }
  // 兜底：若自动布阵还没落出单位，强制征兵→把首个 unit 令牌放到首个空闲已解锁格（确定性）。
  let guard = 0;
  while (opp.units.size === 0 && guard++ < 12) {
    opp.applyPvpInput({ op: 'summon' });
    for (let k = 0; k < 5; k++) opp.step(1 / 30);
    const idx = opp.tray.findIndex((t) => t.kind === 'unit');
    const cell = opp.unlockedCells().find(
      (c) => !opp.units.has(`${c.c},${c.r}`) && !opp.words.has(`${c.c},${c.r}`),
    );
    if (idx >= 0 && cell) {
      opp.applyPvpInput({ op: 'place', cell: `r${cell.r}c${cell.c}`, index: idx });
    }
    for (let k = 0; k < 5; k++) opp.step(1 / 30);
  }
}

describe('bridgeOpponentFrom：oppBattle 本方侧 → battle.ai* 镜像（Plan C Task 8）', () => {
  it('桥接后：aiUnits cell 镜像、aiMonsters 同源、aiTangsengHP 同步、aiWords 镜像键', () => {
    const battle = mkPvp();
    const opp = mkPvp();
    seedOpponentBoard(opp);

    // 前置：对手侧确有可镜像状态
    expect(opp.units.size).toBeGreaterThan(0); // 至少一个本方单位
    expect(opp.monsters.length).toBeGreaterThan(0); // 开波后已出怪
    expect(opp.tangsengHP).toBeGreaterThan(0); // 唐僧血量（满血）

    battle.bridgeOpponentFrom(opp);

    // ① aiUnits：把 opp.units 逐条镜像 cell（drawAiSide 直接用 u.cell，不再二次镜像）
    expect(battle.aiUnits.length).toBe(opp.units.size);
    for (const u of opp.units.values()) {
      const mirrored = battle.aiUnits.find((a) => a.cell.c === mirrorCell(u.cell).c && a.cell.r === mirrorCell(u.cell).r);
      expect(mirrored, `opp 单位@(${u.cell.c},${u.cell.r}) 应在 aiUnits 镜像到 (${mirrorCell(u.cell).c},${mirrorCell(u.cell).r})`).toBeTruthy();
      expect(mirrored!.type).toBe(u.type);
      expect(mirrored!.tier).toBe(u.tier);
    }

    // ② aiMonsters：直引同源（pvp 下无 sim 写 ai*，共享引用安全；怪物 dist 沿 aiPath 自动镜像到上半场）
    expect(battle.aiMonsters).toBe(opp.monsters); // 同一引用
    expect(battle.aiMonsters.length).toBe(opp.monsters.length);

    // ③ aiTangsengHP 同步
    expect(battle.aiTangsengHP).toBe(opp.tangsengHP);
  });

  it('桥接后：aiWords 用镜像后的 cell 与 Map 键（供 aiActiveGenerals 左右邻接配对）', () => {
    const battle = mkPvp();
    const opp = mkPvp();
    seedOpponentBoard(opp);
    // 若这次没布出字牌，跳过（字牌非每局必出；配对细节由 ai-balance 覆盖）
    if (opp.words.size === 0) return;

    battle.bridgeOpponentFrom(opp);

    expect(battle.aiWords.size).toBe(opp.words.size);
    for (const w of opp.words.values()) {
      const m = mirrorCell(w.cell);
      const hit = battle.aiWords.get(`${m.c},${m.r}`); // 键也镜像
      expect(hit, `opp 字牌@(${w.cell.c},${w.cell.r}) 应在 aiWords 镜像键 (${m.c},${m.r})`).toBeTruthy();
      expect(hit!.char).toBe(w.char);
      expect(hit!.cell.c).toBe(m.c);
      expect(hit!.cell.r).toBe(m.r);
    }
  });

  it('未调用桥时单人 ai* 行为不变（零影响兜底）', () => {
    const b = mkPvp();
    b.startNextWave();
    for (let i = 0; i < 5; i++) b.step(1 / 30);
    // 未桥接：aiUnits/aiWords 仍空（pvp 下无 sim 写 ai*），aiMonsters 空
    expect(b.aiUnits.length).toBe(0);
    expect(b.aiWords.size).toBe(0);
    expect(b.aiMonsters.length).toBe(0);
  });
});
