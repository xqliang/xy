import { describe, expect, it } from 'vitest';
import { exitDistToPath, EXIT_PATH_REACH, mapById } from '../src/board';
import { digPriorityScore } from '../src/autoplace';

describe('exitDistToPath', () => {
  const path = Array.from({ length: 8 }, (_, c) => ({ c, r: 0 }));

  it('导出 REACH=3.5', () => {
    expect(EXIT_PATH_REACH).toBe(3.5);
  });

  it('一律用沿程下标差（够得着路也不再走欧氏）', () => {
    const cell = { c: 2, r: 2 }; // 最近点 (2,0) index 2
    expect(exitDistToPath(path, cell)).toBe(2);
  });

  it('路径末段附着点：沿程更大', () => {
    const nearEnd = { c: 7, r: 5 }; // 最近点 (7,0) index 7
    const nearStart = { c: 0, r: 5 }; // 最近点 (0,0) index 0
    expect(exitDistToPath(path, nearEnd)).toBe(7);
    expect(exitDistToPath(path, nearStart)).toBe(0);
    expect(exitDistToPath(path, nearEnd)).toBeGreaterThan(exitDistToPath(path, nearStart));
  });

  it('几何近 gate 但最近点在后段：沿程大于欧氏到 gate（避免假近）', () => {
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
    const cell = { c: 1, r: 9 }; // 到末点 (1,5) = 4；到 gate 欧氏 = hypot(1,9)
    const euclid = Math.hypot(1, 9);
    expect(exitDistToPath(bent, cell)).toBe(bent.length - 1); // 最近点末格
    expect(exitDistToPath(bent, cell)).toBeGreaterThan(euclid);
  });

  it('流沙河：几何近门但沿程晚的格，挖铲分低于左谷多贴边格', () => {
    // (2,5) 欧氏到门≈2、最近路 (2,6) 沿程≈9；(1,8) 欧氏≈3.2、沿程≈3 且三边贴路
    const map = mapById('liushahe');
    const fakeNear = { c: 2, r: 5 };
    const leftValley = { c: 1, r: 8 };
    expect(exitDistToPath(map.path, fakeNear)).toBeGreaterThan(exitDistToPath(map.path, leftValley));
    const fakeScore = digPriorityScore(1, 1, exitDistToPath(map.path, fakeNear));
    const valleyScore = digPriorityScore(3, 1, exitDistToPath(map.path, leftValley));
    expect(valleyScore).toBeLessThan(fakeScore);
  });
});
