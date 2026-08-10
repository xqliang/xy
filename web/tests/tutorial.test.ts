import { describe, it, expect } from 'vitest';
import {
  loadTutorialState,
  hasSeenTutorial,
  markTutorialSeen,
  maybeStartTutorial,
  advanceTutorial,
  skipTutorial,
  tutorialHitAt,
  drawTutorialOverlay,
  type TutorialState,
  type TutorialSequence,
  type TutorialOverlay,
} from '../src/tutorial';
import { VIEW_W, VIEW_H } from '../src/render';

function makeCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    textAlign: 'left',
    textBaseline: 'top',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowColor: '',
    shadowBlur: 0,
    measureText: (text: string) => ({ width: String(text).length * 8 }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: () => undefined,
    arcTo: () => undefined,
    rect: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    fillRect: () => undefined,
    fillText: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    clip: () => undefined,
    setLineDash: () => undefined,
    translate: () => undefined,
    scale: () => undefined,
    drawImage: () => undefined,
  } as unknown as CanvasRenderingContext2D;
}

function seq(id: string, stepCount = 1, anchor: (() => { x: number; y: number; w: number; h: number } | null) | null = null): TutorialSequence {
  return {
    id,
    steps: Array.from({ length: stepCount }, (_, i) => ({
      id: `${id}-${i}`,
      title: `标题${i}`,
      text: `这是第 ${i + 1} 步的引导说明文字，用来测试自动换行是否正常工作而不会抛错。`,
      getAnchor: anchor ?? (() => null),
    })),
  };
}

describe('新手引导：状态持久化', () => {
  it('默认无任何已展示记录', () => {
    const state = loadTutorialState();
    expect(state.seen).toEqual({});
  });

  it('标记已展示后 hasSeenTutorial 返回 true，且不影响原对象', () => {
    const before: TutorialState = { seen: {} };
    const after = markTutorialSeen(before, 'battleIntro');
    expect(hasSeenTutorial(before, 'battleIntro')).toBe(false);
    expect(hasSeenTutorial(after, 'battleIntro')).toBe(true);
  });

  it('重复标记同一 id 不产生新对象引用（幂等）', () => {
    const once = markTutorialSeen({ seen: {} }, 'firstSummon');
    const twice = markTutorialSeen(once, 'firstSummon');
    expect(twice).toBe(once);
  });
});

describe('新手引导：触发/前进/跳过', () => {
  it('未展示过且当前无引导时可以触发', () => {
    const state: TutorialState = { seen: {} };
    const overlay = maybeStartTutorial(state, null, seq('battleIntro', 4));
    expect(overlay?.sequenceId).toBe('battleIntro');
    expect(overlay?.stepIndex).toBe(0);
    expect(overlay?.steps.length).toBe(4);
  });

  it('已展示过的序列不会再次触发', () => {
    const state: TutorialState = { seen: { battleIntro: true } };
    const overlay = maybeStartTutorial(state, null, seq('battleIntro', 4));
    expect(overlay).toBeNull();
  });

  it('已有引导展示中时不会被新序列打断', () => {
    const state: TutorialState = { seen: {} };
    const active: TutorialOverlay = { sequenceId: 'a', steps: seq('a', 2).steps, stepIndex: 0 };
    const overlay = maybeStartTutorial(state, active, seq('b', 1));
    expect(overlay).toBe(active);
  });

  it('advanceTutorial 逐步前进，最后一步后关闭并记为已展示', () => {
    let state: TutorialState = { seen: {} };
    let overlay = maybeStartTutorial(state, null, seq('firstPlacement', 2));
    expect(overlay).not.toBeNull();

    let res = advanceTutorial(overlay!, state);
    overlay = res.overlay;
    state = res.state;
    expect(overlay?.stepIndex).toBe(1);
    expect(hasSeenTutorial(state, 'firstPlacement')).toBe(false);

    res = advanceTutorial(overlay!, state);
    overlay = res.overlay;
    state = res.state;
    expect(overlay).toBeNull();
    expect(hasSeenTutorial(state, 'firstPlacement')).toBe(true);
  });

  it('skipTutorial 立即关闭并记为已展示，不论当前处于哪一步', () => {
    const state: TutorialState = { seen: {} };
    const overlay = maybeStartTutorial(state, null, seq('firstHeroWord', 3));
    const res = skipTutorial(overlay!, state);
    expect(res.overlay).toBeNull();
    expect(hasSeenTutorial(res.state, 'firstHeroWord')).toBe(true);
  });

  it('跳过后同一序列不会再触发', () => {
    let state: TutorialState = { seen: {} };
    const overlay = maybeStartTutorial(state, null, seq('merchantFirstOpen', 2));
    const res = skipTutorial(overlay!, state);
    state = res.state;
    const again = maybeStartTutorial(state, res.overlay, seq('merchantFirstOpen', 2));
    expect(again).toBeNull();
  });
});

describe('新手引导：命中测试', () => {
  it('点击「跳过引导」按钮返回 skip', () => {
    const ctx = makeCtx();
    const overlay: TutorialOverlay = { sequenceId: 'battleIntro', steps: seq('battleIntro', 1).steps, stepIndex: 0 };
    // 跳过按钮固定贴在卷轴卡片右上角，卡片位置随锚点浮动；遍历屏幕上半部分找到它即可
    let found = false;
    for (let x = 0; x < VIEW_W; x += 4) {
      for (let y = 0; y < VIEW_H; y += 4) {
        if (tutorialHitAt(ctx, x, y, overlay).kind === 'skip') {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    expect(found).toBe(true);
  });

  it('点击非跳过区域（如高亮锚点附近）前进到下一步', () => {
    const ctx = makeCtx();
    const overlay: TutorialOverlay = { sequenceId: 'battleIntro', steps: seq('battleIntro', 1).steps, stepIndex: 0 };
    const hit = tutorialHitAt(ctx, 5, 5, overlay);
    expect(hit.kind).toBe('advance');
  });

  it('有锚点时命中测试与无锚点时表现一致（跳过按钮始终可点，其余前进）', () => {
    const ctx = makeCtx();
    const withAnchor = seq('firstPlacement', 1, () => ({ x: 100, y: 100, w: 40, h: 40 }));
    const overlay: TutorialOverlay = { sequenceId: withAnchor.id, steps: withAnchor.steps, stepIndex: 0 };
    expect(tutorialHitAt(ctx, 100, 100, overlay).kind).toBe('advance');
  });
});

describe('新手引导：绘制', () => {
  it('无锚点（居中提示）绘制不抛错', () => {
    const ctx = makeCtx();
    const overlay: TutorialOverlay = { sequenceId: 'merchantFirstOpen', steps: seq('merchantFirstOpen', 2).steps, stepIndex: 0 };
    expect(() => drawTutorialOverlay(ctx, overlay, 1234)).not.toThrow();
  });

  it('有锚点（高亮镂空 + 箭头）绘制不抛错', () => {
    const ctx = makeCtx();
    const withAnchor = seq('battleIntro', 4, () => ({ x: 50, y: 700, w: 60, h: 60 }));
    const overlay: TutorialOverlay = { sequenceId: withAnchor.id, steps: withAnchor.steps, stepIndex: 2 };
    expect(() => drawTutorialOverlay(ctx, overlay, 5678)).not.toThrow();
  });

  it('步骤索引越界（防御性）不抛错', () => {
    const ctx = makeCtx();
    const overlay: TutorialOverlay = { sequenceId: 'x', steps: seq('x', 1).steps, stepIndex: 5 };
    expect(() => drawTutorialOverlay(ctx, overlay, 0)).not.toThrow();
  });
});
