import { describe, it, expect } from 'vitest';
import { Battle, TUNING } from '../src/battle';
import { MAPS, COLS, ROWS } from '../src/board';

// 沿路径累加到第 k 个顶点的弧长（与 posAtDistance 同口径，怪物 dist 落在该顶点上）
function arcDistToVertex(path: { c: number; r: number }[], k: number): number {
  let d = 0;
  for (let i = 1; i <= k; i++) d += Math.hypot(path[i]!.c - path[i - 1]!.c, path[i]!.r - path[i - 1]!.r);
  return d;
}

function makeMonster(dist: number, hp: number) {
  return {
    id: 1, dist, hp, maxHp: hp, spd: 0,
    isBoss: false, isMiniBoss: false, miniBossKind: null, isCavalry: false,
    hitFlash: 0, skill: null, skillCd: 0, castFlash: 0, spawnT: 1,
    stunT: 0, slowT: 0, hasteT: 0, healFlash: 0,
  };
}

function readySlot() {
  return { id: 'act_bomb', cd: 0, cdMax: 26, ready: true, flash: 0 };
}

describe('炸药 bomb 主动技能', () => {
  it('placeBomb：路径格成功、同格拒绝、非路径拒绝', () => {
    const map = MAPS[0]!;
    const b = new Battle(1, 1, map);
    (b as unknown as { status: string }).status = 'playing';
    (b as unknown as { activeSlots: unknown[] }).activeSlots = [readySlot()];

    const k = Math.floor(map.path.length / 2);
    const pv = map.path[k]!;
    // 1) 路径格成功
    expect(b.placeBomb(0, { c: pv.c, r: pv.r })).toBe(true);
    expect(b.bombs.length).toBe(1);

    // 2) 同一格再放：即便技能重新就绪也应被拒（同格最多一颗）
    (b as unknown as { activeSlots: { ready: boolean; cd: number }[] }).activeSlots[0]!.ready = true;
    (b as unknown as { activeSlots: { ready: boolean; cd: number }[] }).activeSlots[0]!.cd = 0;
    expect(b.placeBomb(0, { c: pv.c, r: pv.r })).toBe(false);
    expect(b.bombs.length).toBe(1);

    // 3) 非路径格：扫描棋盘找离路径最远的格，应被拒
    let far = { c: 0, r: 0 };
    let farD = -1;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const d = Math.min(...map.path.map((p) => Math.hypot(p.c - c, p.r - r)));
        if (d > farD) { farD = d; far = { c, r }; }
      }
    }
    expect(farD).toBeGreaterThan(0.75); // 该图确有远离路径的格
    (b as unknown as { activeSlots: { ready: boolean; cd: number }[] }).activeSlots[0]!.ready = true;
    (b as unknown as { activeSlots: { ready: boolean; cd: number }[] }).activeSlots[0]!.cd = 0;
    expect(b.placeBomb(0, far)).toBe(false);
    expect(b.bombs.length).toBe(1);
  });

  it('波间等待（ready）也能预埋炸药', () => {
    const map = MAPS[0]!;
    const b = new Battle(1, 1, map);
    (b as unknown as { status: string }).status = 'ready'; // 清波后的波间等待
    (b as unknown as { activeSlots: unknown[] }).activeSlots = [readySlot()];
    const pv = map.path[Math.floor(map.path.length / 2)]!;
    expect(b.placeBomb(0, { c: pv.c, r: pv.r })).toBe(true);
    expect(b.bombs.length).toBe(1);
  });

  it('可埋多颗（不同格），各自独立', () => {
    const map = MAPS[0]!;
    const b = new Battle(1, 1, map);
    (b as unknown as { status: string }).status = 'playing';
    (b as unknown as { activeSlots: { ready: boolean; cd: number }[] }).activeSlots = [readySlot()];
    const place = (v: { c: number; r: number }) => {
      (b as unknown as { activeSlots: { ready: boolean; cd: number }[] }).activeSlots[0]!.ready = true;
      (b as unknown as { activeSlots: { ready: boolean; cd: number }[] }).activeSlots[0]!.cd = 0;
      return b.placeBomb(0, v);
    };
    const k1 = Math.floor(map.path.length * 0.35);
    const k2 = Math.floor(map.path.length * 0.65);
    expect(place(map.path[k1]!)).toBe(true);
    expect(place(map.path[k2]!)).toBe(true);
    expect(b.bombs.length).toBe(2);
  });

  it('怪物踏入引爆：范围内掉血且该颗炸药消失', () => {
    const map = MAPS[0]!;
    const b = new Battle(1, 1, map);
    (b as unknown as { status: string }).status = 'playing';
    const k = Math.floor(map.path.length / 2);
    const pv = map.path[k]!;
    const dist = arcDistToVertex(map.path, k);
    b.bombs.push({ c: pv.c, r: pv.r, t: 0 });
    b.monsters.push(makeMonster(dist, 500) as never);
    const hp0 = b.monsters[0]!.hp;
    b.step(0.05);
    expect(b.bombs.length).toBe(0); // 引爆后消失
    expect(b.monsters[0]!.hp).toBeLessThan(hp0); // 受到爆炸伤害
  });

  it('范围外的怪不被波及', () => {
    const map = MAPS[0]!;
    const b = new Battle(1, 1, map);
    (b as unknown as { status: string }).status = 'playing';
    const k = Math.floor(map.path.length / 2);
    const pv = map.path[k]!;
    // 炸药埋在中点，怪物停在入口（远离中点，超出爆炸半径）
    b.bombs.push({ c: pv.c, r: pv.r, t: 0 });
    b.monsters.push(makeMonster(0.0, 500) as never);
    const hp0 = b.monsters[0]!.hp;
    b.step(0.05);
    // 入口离中点通常远大于接触/爆炸半径：炸药不触发、怪不掉血
    expect(b.bombs.length).toBe(1);
    expect(b.monsters[0]!.hp).toBe(hp0);
    expect(TUNING.bombExplodeRadius).toBeGreaterThan(0);
  });
});
