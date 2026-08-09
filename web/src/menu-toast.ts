// 首页飘字提示：透明横条自下而上飘过并淡出（体力不足等）。
import { VIEW_W } from './render';
import { roundRect } from './menu-ui';
import { menuStartToastAnchorY } from './menu';

export interface MenuFloatToast {
  text: string;
  y: number;
  age: number;
  maxAge: number;
}

const BAR_H = 46;
const BAR_GAP = 8;
const STACK_STEP = BAR_H + BAR_GAP;

const toasts: MenuFloatToast[] = [];

export function pushMenuFloatToast(text: string): void {
  const baseY = menuStartToastAnchorY();
  for (const t of toasts) t.y -= STACK_STEP;
  toasts.push({ text, y: baseY, age: 0, maxAge: 2.4 });
}

export function updateMenuFloatToasts(dt: number): void {
  for (const t of toasts) {
    t.age += dt;
    t.y -= 52 * dt;
  }
  for (let i = toasts.length - 1; i >= 0; i--) {
    if (toasts[i]!.age >= toasts[i]!.maxAge) toasts.splice(i, 1);
  }
}

export function drawMenuFloatToasts(ctx: CanvasRenderingContext2D): void {
  for (const t of toasts) {
    const enter = Math.min(1, t.age / 0.12);
    const exit = Math.max(0, 1 - (t.age - 0.2) / (t.maxAge - 0.2));
    const alpha = enter * exit;
    const barW = VIEW_W - 72;
    const x = (VIEW_W - barW) / 2;
    const y = t.y - BAR_H / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    roundRect(ctx, x, y, barW, BAR_H, BAR_H / 2);
    ctx.fillStyle = 'rgba(28,20,14,0.38)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,230,190,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fff6e8';
    ctx.font = 'bold 16px "PingFang SC", "STKaiti", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.text, VIEW_W / 2, t.y);
    ctx.restore();
  }
}

export function clearMenuFloatToasts(): void {
  toasts.length = 0;
}
