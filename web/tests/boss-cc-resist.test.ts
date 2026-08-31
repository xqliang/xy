// BOSS CC 抗性回归：bossCcResist=0.5 只作用于 BOSS/小 Boss 的武将控制
//（定身/击退/哮天犬咬），普通妖不受影响；击退满5为 1.0 格。
// 直接驱动 castGeneralSkill（确定性，不依赖走位/射程碰运气）。
import { describe, it, expect } from 'vitest';
import { Battle, TUNING, type Monster } from '../src/battle';
import { GENERALS } from '../src/generals';

const cellKey = (c: number, r: number) => `${c},${r}`;

function placeGeneral(b: Battle, id: string, r: number) {
  const def = GENERALS.find((d) => d.id === id)!;
  const unlocked = (b as unknown as { unlocked: Set<string> }).unlocked;
  const l = { c: 0, r }, rt = { c: 1, r };
  unlocked.add(cellKey(l.c, l.r)); unlocked.add(cellKey(rt.c, rt.r));
  b.words.set(cellKey(l.c, l.r), { char: def.chars[0]!, general: id, tier: def.maxTier, cell: l });
  b.words.set(cellKey(rt.c, rt.r), { char: def.chars[1]!, general: id, tier: def.maxTier, cell: rt });
  return b.activeGenerals()[0]!;
}

/** 直接以 castGeneralSkill 施放（绕开私有与目标筛选的不确定性）。 */
function cast(b: Battle, g: ReturnType<Battle['activeGenerals']>[number], m: Partial<Monster> & { isBoss: boolean; isMiniBoss: boolean; dist: number }): void {
  const mon = {
    id: 1, dist: m.dist, spd: 0.6, hp: 1e9, maxHp: 1e9, hitFlash: 0, spawnT: 1,
    skill: null, skillCd: 0, castFlash: 0, isBoss: m.isBoss, isMiniBoss: m.isMiniBoss,
    miniBossKind: null, isCavalry: false, element: null,
    stunT: 0, frozenT: 0, slowT: 0, hasteT: 0, healFlash: 0, burnT: 0, burnDps: 0,
    miniBossCasted: false, ...m,
  } as Monster;
  (b as unknown as { castGeneralSkill: (g: never, inRange: unknown[]) => void })
    .castGeneralSkill(g as never, [{ m: mon, p: { c: 0, r: 5 } }]);
  // 把结果写回 m 供断言（castGeneralSkill 只改 mon 本体字段）
  m.stunT = mon.stunT;
  m.dist = mon.dist;
}

describe('BOSS/小 Boss CC 抗性（bossCcResist）', () => {
  it('TUNING：击退满5=1.0 格、BOSS 抗性=0.5', () => {
    expect(TUNING.heroKnockPushMain).toBe(1.0);
    expect(TUNING.bossCcResist).toBe(0.5);
  });

  it('定身：普通妖吃满 1.5s；BOSS 与小 Boss 均减半', () => {
    const cases = [
      { isBoss: false, isMiniBoss: false, want: TUNING.heroStunDurMain },
      { isBoss: true, isMiniBoss: false, want: TUNING.heroStunDurMain * TUNING.bossCcResist },
      { isBoss: false, isMiniBoss: true, want: TUNING.heroStunDurMain * TUNING.bossCcResist },
    ] as const;
    for (const c of cases) {
      const b = new Battle(7, 1);
      const g = placeGeneral(b, 'bajie', 5); // 八戒：定身 T0 满5
      const out = { isBoss: c.isBoss, isMiniBoss: c.isMiniBoss, dist: 8, stunT: 0 };
      cast(b, g, out);
      expect(out.stunT).toBeCloseTo(c.want, 5);
    }
  });

  it('击退：普通妖推 1.0 格；BOSS 只推 0.5 格', () => {
    const cases = [
      { isBoss: false, isMiniBoss: false, want: TUNING.heroKnockPushMain },
      { isBoss: true, isMiniBoss: false, want: TUNING.heroKnockPushMain * TUNING.bossCcResist },
      { isBoss: false, isMiniBoss: true, want: TUNING.heroKnockPushMain * TUNING.bossCcResist },
    ] as const;
    for (const c of cases) {
      const b = new Battle(7, 1);
      const g = placeGeneral(b, 'tieshan', 5); // 铁扇：击退 T1 满5
      const out = { isBoss: c.isBoss, isMiniBoss: c.isMiniBoss, dist: 8, stunT: 0 };
      cast(b, g, out);
      expect(out.dist).toBeCloseTo(8 - c.want, 5);
    }
  });
});
