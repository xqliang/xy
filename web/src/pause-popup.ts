// 局内暂停弹窗：继续 / 终止（二次确认），水墨卷轴风。
import { VIEW_W, VIEW_H } from './render';
import { drawInkPopupFrame, drawInkActionButton, inkPopupCloseRect } from './menu-ui';

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export type PausePhase = 'main' | 'confirmQuit';

// 暂停来源：battle=单人（继续/终止，终止走二次确认），match=在线 PvP（继续/认输，认输一步到位）。
export type PauseContext = 'battle' | 'match';

export type PauseHit =
  | { kind: 'continue' }
  | { kind: 'quit' }
  | { kind: 'confirmQuit' }
  | { kind: 'cancelQuit' }
  | { kind: 'surrender' }
  | null;

const PW = 340;
const PX = (VIEW_W - PW) / 2;
const PAD = 24;
const BTN_H = 46;
const BTN_GAP = 14;

const MAIN_PY = (VIEW_H - 264) / 2;
// 弹窗高 264（原 248）：终止按钮底距弹窗底曾只有 14px（视觉贴边，用户反馈），加高到 30px
// 留白——对齐并略超二次确认弹窗（PAD=24）的底部惯例；按钮自身位置不变，仅下缘延展。
const MAIN_PH = 264;
const MAIN_CLOSE = inkPopupCloseRect(PX, MAIN_PY);
const MAIN_CONTINUE = { x: PX + PAD, y: MAIN_PY + 128, w: PW - PAD * 2, h: BTN_H };
const MAIN_QUIT = { x: PX + PAD, y: MAIN_CONTINUE.y + BTN_H + BTN_GAP, w: PW - PAD * 2, h: BTN_H };

const CONF_PY = (VIEW_H - 228) / 2;
const CONF_PH = 228;
const CONF_CLOSE = inkPopupCloseRect(PX, CONF_PY);
const CONF_CANCEL = { x: PX + PAD, y: CONF_PY + CONF_PH - PAD - BTN_H, w: (PW - PAD * 2 - 12) / 2, h: BTN_H };
const CONF_OK = { x: PX + PW / 2 + 6, y: CONF_CANCEL.y, w: CONF_CANCEL.w, h: BTN_H };

export function pausePopupHitAt(x: number, y: number, phase: PausePhase, context: PauseContext = 'battle'): PauseHit {
  if (phase === 'main') {
    if (inRect(x, y, MAIN_CLOSE) || inRect(x, y, MAIN_CONTINUE)) return { kind: 'continue' };
    // 第二按钮：单人=终止（走二次确认），PvP=认输（一步到位）
    if (inRect(x, y, MAIN_QUIT)) return context === 'match' ? { kind: 'surrender' } : { kind: 'quit' };
    if (x >= PX && x <= PX + PW && y >= MAIN_PY && y <= MAIN_PY + MAIN_PH) return null;
    return { kind: 'continue' };
  }
  // confirmQuit 阶段只属于单人（PvP 没有确认终止，认输一步生效），context 不影响判定。
  if (inRect(x, y, CONF_CANCEL) || inRect(x, y, CONF_CLOSE)) return { kind: 'cancelQuit' };
  if (inRect(x, y, CONF_OK)) return { kind: 'confirmQuit' };
  if (x >= PX && x <= PX + PW && y >= CONF_PY && y <= CONF_PY + CONF_PH) return null;
  return null;
}

export function drawPausePopup(ctx: CanvasRenderingContext2D, phase: PausePhase, context: PauseContext = 'battle'): void {
  if (phase === 'main') {
    // 标题随 context 变化：单人=暂停（仿真已停）；PvP=退出对局（仿真仍继续，仅模态拦截输入）。
    const title = context === 'match' ? '退出对局？' : '暂停';
    const bodyTop = drawInkPopupFrame(ctx, PX, MAIN_PY, PW, MAIN_PH, title, MAIN_CLOSE);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5a3a12';
    ctx.font = '15px "PingFang SC", serif';
    // 单人提示「可随时继续」；PvP 提示仿真未停 + 认输后果（认输一步判负，之后等服务端 result 结算）
    ctx.fillText(
      context === 'match' ? '对局仍在进行，确认后将离开' : '游戏已暂停，可随时继续',
      PX + PW / 2,
      bodyTop + 28,
    );
    drawInkActionButton(ctx, MAIN_CONTINUE, '继续游戏', false, 'primary');
    // 第二按钮文案随 context 变化
    drawInkActionButton(ctx, MAIN_QUIT, context === 'match' ? '认输' : '终止游戏', false, 'secondary');
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
