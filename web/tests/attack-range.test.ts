import { describe, it, expect } from 'vitest';
import { inAttackRange, TUNING } from '../src/battle';

// inAttackRange(ax, ay, rgeCells, p)：以 (ax,ay) 为圆心、半径 (rge + 0.5) 格的圆，
// 是否与目标(p)所在方格真实相交(边相切不算 → 严格 <)。目标方格取 round(p)。
// 半格来自 TUNING.rangeTolerance（=0.5）。
const TOL = TUNING.rangeTolerance;

describe('inAttackRange：圆(半径 rge+0.5 格)与目标方格相交判定', () => {
  it('TOL 常量为半个格子 0.5', () => {
    expect(TOL).toBe(0.5);
  });

  it('rge=1 近战：正上/下/左/右相邻格命中', () => {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      expect(inAttackRange(0, 0, 1, { c: dc, r: dr })).toBe(true);
    }
  });

  it('rge=1 近战：四个斜角相邻格命中(圆与方格相交)', () => {
    for (const [dc, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      expect(inAttackRange(0, 0, 1, { c: dc, r: dr })).toBe(true);
    }
  });

  it('rge=1 近战：正向隔一格(距离2)的方格近边正好在半径处 → 边不算，不命中', () => {
    // 半径=1.5；(2,0) 方格近边在 c=1.5，最近点距圆心=1.5，严格< 为 false
    expect(inAttackRange(0, 0, 1, { c: 2, r: 0 })).toBe(false);
  });

  it('rge=1 近战：距离2的斜/远格不命中', () => {
    expect(inAttackRange(0, 0, 1, { c: 2, r: 1 })).toBe(false);
    expect(inAttackRange(0, 0, 1, { c: 2, r: 2 })).toBe(false);
  });

  it('半径随 rge 增大：rge=2 时距离2正向格命中(近边0.5×3=1.5 < 2.5)', () => {
    expect(inAttackRange(0, 0, 2, { c: 2, r: 0 })).toBe(true);
    // 距离3正向格近边=2.5，半径=2.5，边不算 → false
    expect(inAttackRange(0, 0, 2, { c: 3, r: 0 })).toBe(false);
  });

  it('英雄半格圆心(两格中点 ax=0.5)：近侧方格命中', () => {
    // 圆心 (0.5,0)，rge=1 → 半径1.5
    expect(inAttackRange(0.5, 0, 1, { c: 0, r: 0 })).toBe(true);  // 近边距0
    expect(inAttackRange(0.5, 0, 1, { c: 1, r: 0 })).toBe(true);  // 近边距0
    expect(inAttackRange(0.5, 0, 1, { c: -1, r: 0 })).toBe(true); // 近边 c=-0.5，距圆心1.0<1.5
    expect(inAttackRange(0.5, 0, 1, { c: -2, r: 0 })).toBe(false); // 近边 c=-1.5，距圆心2.0>1.5
  });

  it('连续坐标目标按 round 归入方格：p=(1.4,0) 归 c=1 格', () => {
    // round(1.4)=1，与 {c:1} 同格，rge=1 命中
    expect(inAttackRange(0, 0, 1, { c: 1.4, r: 0 })).toBe(true);
  });
});
