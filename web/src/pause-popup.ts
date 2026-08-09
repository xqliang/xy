// 局内暂停弹窗：继续 / 终止（二次确认），水墨卷轴风。
import { VIEW_W, VIEW_H } from './render';
import { drawInkPopupFrame, drawInkActionButton } from './menu-ui';

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export type PausePhase = 'main' | 'confirmQuit';

export type PauseHit =
  | { kind: 'continue' }
  | { kind: 'quit' }
  | { kind: 'confirmQuit' }
  | { kind: 'cancelQuit' }
  | null;

const PW = 340;
const PX = (VIEW_W - PW) / 2;
const PAD = 24;
const BTN_H = 46;
const BTN_GAP = 14;

const MAIN_PY = (VIEW_H - 248) / 2;
const MAIN_PH = 248;
const MAIN_CLOSE = { x: PX + 10, y: MAIN_PY + 8, w: 36, h: 30 };
const MAIN_CONTINUE = { x: PX + PAD, y: MAIN_PY + 128, w: PW - PAD * 2, h: BTN_H };
const MAIN_QUIT = { x: PX + PAD, y: MAIN_CONTINUE.y + BTN_H + BTN_GAP, w: PW - PAD * 2, h: BTN_H };

const CONF_PY = (VIEW_H - 228) / 2;
const CONF_PH = 228;
const CONF_CLOSE = { x: PX + 10, y: CONF_PY + 8, w: 36, h: 30 };
const CONF_CANCEL = { x: PX + PAD, y: CONF_PY + CONF_PH - PAD - BTN_H, w: (PW - PAD * 2 - 12) / 2, h: BTN_H };
const CONF_OK = { x: PX + PW / 2 + 6, y: CONF_CANCEL.y, w: CONF_CANCEL.w, h: BTN_H };

export function pausePopupHitAt(x: number, y: number, phase: PausePhase): PauseHit {
  if (phase === 'main') {
    if (inRect(x, y, MAIN_CLOSE) || inRect(x, y, MAIN_CONTINUE)) return { kind: 'continue' };
    if (inRect(x, y, MAIN_QUIT)) return { kind: 'quit' };
    if (x >= PX && x <= PX + PW && y >= MAIN_PY && y <= MAIN_PY + MAIN_PH) return null;
    return { kind: 'continue' };
  }
  if (inRect(x, y, CONF_CANCEL) || inRect(x, y, CONF_CLOSE)) return { kind: 'cancelQuit' };
  if (inRect(x, y, CONF_OK)) return { kind: 'confirmQuit' };
  if (x >= PX && x <= PX + PW && y >= CONF_PY && y <= CONF_PY + CONF_PH) return null;
  return null;
}

export function drawPausePopup(ctx: CanvasRenderingContext2D, phase: PausePhase): void {
  if (phase === 'main') {
    const bodyTop = drawInkPopupFrame(ctx, PX, MAIN_PY, PW, MAIN_PH, '暂停', MAIN_CLOSE);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5a3a12';
    ctx.font = '15px "PingFang SC", serif';
    ctx.fillText('游戏已暂停，可随时继续', PX + PW / 2, bodyTop + 28);
    drawInkActionButton(ctx, MAIN_CONTINUE, '继续游戏', false, 'primary');
    drawInkActionButton(ctx, MAIN_QUIT, '终止游戏', false, 'secondary');
    return;
  }

  const bodyTop = drawInkPopupFrame(ctx, PX, CONF_PY, PW, CONF_PH, '确认终止', CONF_CLOSE);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5a3a12';
  ctx.font = '15px "PingFang SC", serif';
  ctx.fillText('终止后本局进度不会保存', PX + PW / 2, bodyTop + 24);
  ctx.fillText('也不会获得结算奖励', PX + PW / 2, bodyTop + 48);
  drawInkActionButton(ctx, CONF_CANCEL, '取消', false, 'secondary');
  drawInkActionButton(ctx, CONF_OK, '确认终止', false, 'primary');
}
