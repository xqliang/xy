import { describe, it, expect } from 'vitest';
import { drawPvpMatching, pvpMatchingHitAt, EXIT_RECT, COPY_RECT, FAIL_OK_RECT, type PvpMatchingView } from '../src/pvp-screen';

// 测试专用 stub ctx：Proxy 兜住所有 CanvasRenderingContext2D 方法/属性，
// 渐变类（createLinearGradient/createRadialGradient/createPattern）返回带 addColorStop 的假对象，
// 避免 drawInkActionButton / 渲染代码因调用未覆盖方法而抛错。
function stubCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop: () => {} };
  return new Proxy({}, {
    get: (_t, p) => {
      if (p === 'measureText') return () => ({ width: 40 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern') return () => grad;
      if (p === 'canvas') return { width: 540, height: 960 };
      return () => {};
    },
  }) as unknown as CanvasRenderingContext2D;
}

// 构造默认视图的工厂：允许按字段覆盖，方便测不同态。
const view = (o: Partial<PvpMatchingView> = {}): PvpMatchingView =>
  ({ mode: 'random', phase: 'queuing', remainMs: 90_000, opponent: null, link: null, copied: false, message: '', ...o });

describe('pvp-screen', () => {
  it('random/invite/failed 各态都能画且不抛', () => {
    const ctx = stubCtx();
    // 默认 random 排队态
    expect(() => drawPvpMatching(ctx, view())).not.toThrow();
    // 邀请态（带分享链接，应额外画复制按钮）
    expect(() => drawPvpMatching(ctx, view({ mode: 'invite', link: 'https://x/?versus=AB12CD' }))).not.toThrow();
    // 失败态（画消息 + 确认按钮）
    expect(() => drawPvpMatching(ctx, view({ phase: 'failed', message: '未匹配到对手' }))).not.toThrow();
  });

  it('queuing 态 exit 命中', () => {
    // 命中点落在 EXIT_RECT 内，应返回 'exit'
    expect(pvpMatchingHitAt(EXIT_RECT.x + 1, EXIT_RECT.y + 1, view())).toBe('exit');
  });

  it('invite 态复制链接命中 copy', () => {
    // 邀请态命中 COPY_RECT 应返回 'copy'
    expect(pvpMatchingHitAt(COPY_RECT.x + 1, COPY_RECT.y + 1, view({ mode: 'invite', link: 'l' }))).toBe('copy');
  });

  it('failed 态确认命中 ok', () => {
    // 失败态命中 FAIL_OK_RECT 应返回 'ok'
    expect(pvpMatchingHitAt(FAIL_OK_RECT.x + 1, FAIL_OK_RECT.y + 1, view({ phase: 'failed' }))).toBe('ok');
  });
});
