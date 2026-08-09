/**
 * 复现用户截图：盘丝洞第 4 波 mid-game 卡死（音乐继续、点击无响应）。
 * 根因之一：AI buildAiAutoView 误传 Cell[] 给 pathFirstEngageDist → 抛错 → rAF 停转。
 */
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';
import {
  AI_PLACE_MAX_GUARD,
  AI_PLACE_MAX_STEPS,
  planAutoPlaceSteps,
  type AutoPlaceView,
} from '../src/autoplace';
import { setupPansidongWave4Screenshot } from './fixtures/pansidong-wave4-screenshot-board';

describe('盘丝洞第4波 · 截图卡死复现', () => {
  it('buildAiAutoView + pathFirstEngageAt 不抛错', () => {
    const b = new Battle(20260809, 1, mapById('pansidong'));
    setupPansidongWave4Screenshot(b);
    const view = (b as unknown as { buildAiAutoView(): AutoPlaceView }).buildAiAutoView();

    expect(() => view.pathFirstEngageAt(3.5, 2, 2)).not.toThrow();
    expect(() => view.pathCoverEarlyAt(3.5, 2, 2)).not.toThrow();
    expect(Number.isFinite(view.pathFirstEngageAt(3.5, 2, 2))).toBe(true);
  });

  it('AI 布阵单轮在步数上限内完成', () => {
    const b = new Battle(20260809, 1, mapById('pansidong'));
    setupPansidongWave4Screenshot(b);
    const view = (b as unknown as { buildAiAutoView(): AutoPlaceView }).buildAiAutoView();

    const t0 = performance.now();
    const steps = planAutoPlaceSteps(view, {
      rng: () => b.aiRng.next(),
      pSubOptimal: 0,
      randomDigExitWeight: true,
      maxSteps: AI_PLACE_MAX_STEPS,
      maxGuard: AI_PLACE_MAX_GUARD,
    });
    const elapsed = performance.now() - t0;

    expect(steps).toBeLessThanOrEqual(AI_PLACE_MAX_STEPS);
    expect(elapsed).toBeLessThan(500);
  });

  it('推进 600 帧 step+updateAi 不抛错且耗时受控', () => {
    const b = new Battle(20260809, 1, mapById('pansidong'));
    setupPansidongWave4Screenshot(b);

    const t0 = performance.now();
    expect(() => {
      for (let i = 0; i < 600; i++) {
        b.step(1 / 60);
      }
    }).not.toThrow();
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(3000);
    expect(['playing', 'ready', 'won']).toContain(b.status);
  });

  it('玩家点布阵：牛郎+tray沙 局面不卡顿', () => {
    const b = new Battle(20260809, 1, mapById('pansidong'));
    setupPansidongWave4Screenshot(b);

    expect(b.activeGenerals().some((g) => g.def.id === 'niulang')).toBe(true);

    const t0 = performance.now();
    expect(() => b.autoPlaceTray()).not.toThrow();
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(500);
    expect(b.message).not.toBe('布阵：当前暂无可执行操作');
  });
});
