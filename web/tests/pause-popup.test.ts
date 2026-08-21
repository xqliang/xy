// 暂停弹窗命中测试（Task 10）：PvP（context='match'）新增「认输」，单人（context='battle'）保持继续/终止。
// 几何以 pause-popup.ts 内的布局常量为准（VIEW_W/VIEW_H 来自 render.ts），避免写死错误视口。
import { describe, it, expect } from 'vitest';
import { pausePopupHitAt } from '../src/pause-popup';
import { VIEW_W, VIEW_H } from '../src/render';

// 与 pause-popup.ts 内部布局常量保持一致（仅供测试重建按钮中心点）。
const PW = 340;
const PX = (VIEW_W - PW) / 2;
const PAD = 24;
const BTN_H = 46;
const BTN_GAP = 14;
const MAIN_PY = (VIEW_H - 248) / 2;
const MAIN_CONTINUE = { x: PX + PAD, y: MAIN_PY + 128, w: PW - PAD * 2, h: BTN_H };
const MAIN_QUIT = { x: PX + PAD, y: MAIN_CONTINUE.y + BTN_H + BTN_GAP, w: PW - PAD * 2, h: BTN_H };

const cx = (r: { x: number; y: number; w: number; h: number }) => r.x + r.w / 2;
const cy = (r: { x: number; y: number; w: number; h: number }) => r.y + r.h / 2;

describe('pausePopupHitAt context', () => {
  it('context=battle（单人）：命中「继续」与「终止」', () => {
    expect(pausePopupHitAt(cx(MAIN_CONTINUE), cy(MAIN_CONTINUE), 'main', 'battle')).toEqual({ kind: 'continue' });
    expect(pausePopupHitAt(cx(MAIN_QUIT), cy(MAIN_QUIT), 'main', 'battle')).toEqual({ kind: 'quit' });
  });

  it('context=match（PvP）：命中「继续」与「认输」', () => {
    expect(pausePopupHitAt(cx(MAIN_CONTINUE), cy(MAIN_CONTINUE), 'main', 'match')).toEqual({ kind: 'continue' });
    expect(pausePopupHitAt(cx(MAIN_QUIT), cy(MAIN_QUIT), 'main', 'match')).toEqual({ kind: 'surrender' });
  });

  it('context=match 不应再出现「终止」', () => {
    // 扫描整个主弹窗区域，确保 quit/confirmQuit 都不会出现在 match 模式
    let sawQuit = false;
    for (let x = PX; x <= PX + PW; x += 10) {
      for (let y = MAIN_PY; y <= MAIN_PY + 248; y += 10) {
        const hit = pausePopupHitAt(x, y, 'main', 'match');
        if (hit && (hit.kind === 'quit' || hit.kind === 'confirmQuit')) sawQuit = true;
      }
    }
    expect(sawQuit).toBe(false);
  });

  it('兼容旧签名：不传 context 仍可用（单人默认）', () => {
    expect(pausePopupHitAt(cx(MAIN_QUIT), cy(MAIN_QUIT), 'main')).toEqual({ kind: 'quit' });
  });

  it('二次确认阶段不受 context 影响（单人确认终止）', () => {
    const CONF_PY = (VIEW_H - 228) / 2;
    const CONF_OK = { x: PX + PW / 2 + 6, y: CONF_PY + 228 - 24 - BTN_H, w: (PW - PAD * 2 - 12) / 2, h: BTN_H };
    expect(pausePopupHitAt(cx(CONF_OK), cy(CONF_OK), 'confirmQuit', 'battle')).toEqual({ kind: 'confirmQuit' });
  });
});
