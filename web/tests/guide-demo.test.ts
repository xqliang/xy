import { describe, it, expect } from 'vitest';
import {
  GUIDE_DEMO_PERIOD_S,
  guideDemoPhase,
  GUIDE_DEMO_PHASES,
  pickDemoDeployCell,
  type GuideDemoInput,
} from '../src/guide-demo';

const base = (t: number): GuideDemoInput => ({ t });

describe('引导拖拽演示时间相位 guideDemoPhase（纯函数，驱动手型/ghost/虚线高亮）', () => {
  it('周期与相位表存在且时间轴单调覆盖 [0, 周期)', () => {
    expect(GUIDE_DEMO_PERIOD_S).toBeGreaterThan(1);
    let last = 0;
    for (const p of GUIDE_DEMO_PHASES) {
      expect(p.t0).toBeGreaterThanOrEqual(last);
      expect(p.t1).toBeGreaterThan(p.t0);
      last = p.t1;
    }
    expect(last).toBeCloseTo(GUIDE_DEMO_PERIOD_S, 6); // 相位表拼满整周期
  });

  it('循环：t 超周期取模', () => {
    const a = guideDemoPhase(base(0.5));
    const b = guideDemoPhase(base(GUIDE_DEMO_PERIOD_S + 0.5));
    expect(b.phase).toBe(a.phase);
    expect(b.tInPhase).toBeCloseTo(a.tInPhase, 6);
  });

  it('负 t 容错（时钟回退）取模后仍在相位内', () => {
    const p = guideDemoPhase(base(-0.5));
    expect(p.tInPhase).toBeGreaterThanOrEqual(0);
    expect(p.tInPhase).toBeLessThan(GUIDE_DEMO_PERIOD_S);
  });

  it('关键相位按时间轴出现：起点按下 → 移动中 → 终点按下 → 停顿 → 淡出 → 间歇', () => {
    const order = ['pressFrom', 'move', 'pressTo', 'hold', 'fade', 'rest'] as const;
    const seen: string[] = [];
    for (let i = 0; i < 100; i++) {
      const p = guideDemoPhase(base((i / 100) * GUIDE_DEMO_PERIOD_S)).phase;
      if (p !== seen[seen.length - 1]) seen.push(p);
    }
    expect(seen).toEqual([...order]);
  });

  it('move 相位给出 0→1 的缓动进度（easeInOut：中段快两端慢）', () => {
    const mid = guideDemoPhase(base(0.5 * (GUIDE_DEMO_PHASES.find((p) => p.phase === 'move')!.t0 + GUIDE_DEMO_PHASES.find((p) => p.phase === 'move')!.t1)));
    const early = guideDemoPhase(base(GUIDE_DEMO_PHASES.find((p) => p.phase === 'move')!.t0 + 0.01));
    expect(early.k).toBeLessThan(0.1);
    expect(mid.k).toBeGreaterThan(0.35);
    expect(mid.k).toBeLessThan(0.65);
  });

  it('alpha：淡出相位 1→0，其余可见相位为 1', () => {
    const hold = guideDemoPhase(base(GUIDE_DEMO_PHASES.find((p) => p.phase === 'hold')!.t0 + 0.05));
    expect(hold.alpha).toBe(1);
    const fadeP = GUIDE_DEMO_PHASES.find((p) => p.phase === 'fade')!;
    const fadeMid = guideDemoPhase(base((fadeP.t0 + fadeP.t1) / 2));
    expect(fadeMid.alpha).toBeGreaterThan(0);
    expect(fadeMid.alpha).toBeLessThan(1);
    const rest = guideDemoPhase(base(GUIDE_DEMO_PERIOD_S - 0.01));
    expect(rest.alpha).toBe(0);
  });
});

describe('布阵演示推荐空格 pickDemoDeployCell', () => {
  it('取第一个未被占用的贴路径格', () => {
    const cells = [{ c: 1, r: 2 }, { c: 3, r: 4 }, { c: 5, r: 6 }];
    expect(pickDemoDeployCell(cells, new Set(['3,4']))).toEqual({ c: 1, r: 2 });
    expect(pickDemoDeployCell(cells, new Set(['1,2']))).toEqual({ c: 3, r: 4 });
  });
  it('全被占/空列表 → null（无可演示落点，调用方不画演示）', () => {
    expect(pickDemoDeployCell([{ c: 1, r: 2 }], new Set(['1,2']))).toBeNull();
    expect(pickDemoDeployCell([], new Set())).toBeNull();
  });
});
