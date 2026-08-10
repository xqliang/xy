import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import type { Monster } from '../src/battle';

function makeMonster(id: number, dist: number, hp: number, maxHp: number = hp): Monster {
  return {
    id, dist, hp, maxHp, spd: 0,
    isBoss: false, isMiniBoss: false, miniBossKind: null, isCavalry: false,
    hitFlash: 0, skill: null, skillCd: 99, castFlash: 0, spawnT: 1,
    stunT: 0, slowT: 0, hasteT: 0, healFlash: 0,
    burnT: 0, burnDps: 0,
  };
}

// 武器/英雄攻击目标优先级：范围内始终优先打沿路走过格子最多(dist 最大，离唐僧最近)的怪，
// 即使该怪满血、而另一只在射程内的怪快死了——也不应转去"集火残血"而放过即将破防的威胁。
describe('攻击目标优先级：范围内优先打离唐僧最近(dist 最大)的怪', () => {
  it('单体武将/兵种：满血但更靠前的怪优先于残血但更靠后的怪', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.tray = [{ kind: 'unit', type: 'archer', tier: 5 }];
    expect(b.placeFromTray(0, cell)).toBe(true);
    (b as unknown as { status: string }).status = 'playing';

    const entrance = (b as unknown as { entranceDist: number }).entranceDist;
    const near = makeMonster(1, entrance, 1, 100); // 残血(1%)、离出生点近
    const far = makeMonster(2, entrance + 1.2, 100, 100); // 满血、沿路走得更远(离唐僧更近)
    b.monsters.push(near, far);

    b.step(1 / 30);

    const nearAfter = b.monsters.find((m) => m.id === 1)!;
    const farAfter = b.monsters.find((m) => m.id === 2)!;
    expect(farAfter.hp).toBeLessThan(100); // 更靠后的怪被打了
    expect(nearAfter.hp).toBe(1); // 残血怪未被牵扯，未被打
  });

  it('即便险情迫近(危险提示触发)，目标优先级仍不改变——始终打最靠前的怪', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.tray = [{ kind: 'unit', type: 'archer', tier: 5 }];
    expect(b.placeFromTray(0, cell)).toBe(true);
    (b as unknown as { status: string }).status = 'playing';

    const pathLen = (b as unknown as { pathLen: number }).pathLen;
    const entrance = (b as unknown as { entranceDist: number }).entranceDist;
    const near = makeMonster(1, entrance, 1, 100); // 残血(1%)，在射程内但离唐僧还远
    const far = makeMonster(2, entrance + 1.2, 100, 100); // 满血，在射程内且离唐僧更近
    // 射程外的第三只怪单独触发全局险情提示，不参与本次攻击目标之争
    const escaping = makeMonster(3, pathLen - 0.5, 100, 100);
    b.monsters.push(near, far, escaping);
    expect(b.dangerNear()).toBe(true); // 确认已进入险情判定

    b.step(1 / 30);

    const nearAfter = b.monsters.find((m) => m.id === 1)!;
    const farAfter = b.monsters.find((m) => m.id === 2)!;
    expect(farAfter.hp).toBeLessThan(100); // 险情下仍打射程内更靠前的怪
    expect(nearAfter.hp).toBe(1); // 险情下也不应转去集火射程内的残血怪
  });

  it('多目标兵种(如骑兵 targets=2)：射程内按沿路远近取前 N 个同时命中，多出的最靠后目标不受影响', () => {
    const b = new Battle(1);
    const cell = b.unlockedCells()[0]!;
    b.tray = [{ kind: 'unit', type: 'cavalry', tier: 5 }]; // targets=2，射程内命中数固定为2
    expect(b.placeFromTray(0, cell)).toBe(true);
    (b as unknown as { status: string }).status = 'playing';

    const entrance = (b as unknown as { entranceDist: number }).entranceDist;
    const back = makeMonster(1, entrance, 100, 100); // 射程内三只怪中最靠后
    const mid = makeMonster(2, entrance + 0.4, 100, 100);
    const front = makeMonster(3, entrance + 0.8, 100, 100); // 离唐僧最近
    b.monsters.push(back, mid, front);

    b.step(1 / 30);

    const backAfter = b.monsters.find((m) => m.id === 1)!;
    const midAfter = b.monsters.find((m) => m.id === 2)!;
    const frontAfter = b.monsters.find((m) => m.id === 3)!;
    expect(frontAfter.hp).toBeLessThan(100); // 命中：最靠前
    expect(midAfter.hp).toBeLessThan(100); // 命中：第二靠前
    expect(backAfter.hp).toBe(100); // 未命中：射程内最靠后的第三只（超出 targets=2 上限）
  });
});
