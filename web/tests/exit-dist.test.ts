import { describe, expect, it } from 'vitest';
import { exitDistToPath, EXIT_PATH_REACH } from '../src/board';

describe('exitDistToPath', () => {
  const path = Array.from({ length: 8 }, (_, c) => ({ c, r: 0 }));

  it('导出 REACH=3.5', () => {
    expect(EXIT_PATH_REACH).toBe(3.5);
  });

  it('pathDist ≤ REACH：等于欧氏到 gate', () => {
    const cell = { c: 2, r: 2 }; // dist to path = 2 ≤ 3.5
    expect(exitDistToPath(path, cell)).toBeCloseTo(Math.hypot(2, 2));
  });

  it('pathDist > REACH：用沿程下标差（路径末段更大）', () => {
    const nearEnd = { c: 7, r: 5 }; // dist=5 > 3.5，最近点 (7,0) index 7
    const nearStart = { c: 0, r: 5 }; // 最近点 (0,0) index 0
    expect(exitDistToPath(path, nearEnd)).toBe(7);
    expect(exitDistToPath(path, nearStart)).toBe(0);
    expect(exitDistToPath(path, nearEnd)).toBeGreaterThan(exitDistToPath(path, nearStart));
  });

  it('够不着路且最近点在后段：沿程大于欧氏到 gate（避免假近）', () => {
    // 入口 (0,0) → 右 → 下 → 左到 (1,5)；末段几何上离入口不算极远，但下标大
    const bent = [
      { c: 0, r: 0 },
      { c: 1, r: 0 },
      { c: 2, r: 0 },
      { c: 3, r: 0 },
      { c: 4, r: 0 },
      { c: 5, r: 0 },
      { c: 6, r: 0 },
      { c: 7, r: 0 },
      { c: 7, r: 1 },
      { c: 7, r: 2 },
      { c: 7, r: 3 },
      { c: 7, r: 4 },
      { c: 7, r: 5 },
      { c: 6, r: 5 },
      { c: 5, r: 5 },
      { c: 4, r: 5 },
      { c: 3, r: 5 },
      { c: 2, r: 5 },
      { c: 1, r: 5 },
    ];
    const cell = { c: 1, r: 9 }; // 到末点 (1,5) = 4 > 3.5；到 gate 欧氏 = hypot(1,9)
    const euclid = Math.hypot(1, 9);
    expect(euclid).toBeCloseTo(Math.hypot(1, 9));
    expect(exitDistToPath(bent, cell)).toBe(bent.length - 1); // 最近点末格
    expect(exitDistToPath(bent, cell)).toBeGreaterThan(euclid);
  });
});
