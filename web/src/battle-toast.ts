// 战斗内飘字 toast：屏幕上部半透明横条，淡入→停留→淡出（当前用于「续玩恢复」提示）。
// 仿 menu-toast 的淡出节奏，但定位在战斗区（HUD 下方居中），且不依赖首页布局。
// 与 render.ts 解耦：仅用其导出的 VIEW_W/HUD_H 常量与 menu-ui 的 roundRect 画圆角条。
import { VIEW_W, HUD_H } from './render';
import { roundRect } from './menu-ui';

interface BattleToast {
  text: string;
  age: number;   // 已存在秒数
  maxAge: number; // 总时长（含淡入淡出）
}

const BAR_H = 44;
const FADE_IN = 0.15;  // 淡入时长（秒）
const FADE_OUT = 0.6;  // 淡出时长（秒）

// 单条即可（续玩提示不叠加）；push 时替换旧的。
let toasts: BattleToast[] = [];

/** 弹出一条战斗 toast（替换现有）。maxAge 默认 3s。 */
export function pushBattleToast(text: string, maxAge = 3): void {
  toasts = [{ text, age: 0, maxAge }];
}

/** 每帧推进（按真实时间淡出）。 */
export function updateBattleToasts(dt: number): void {
  for (const t of toasts) t.age += dt;
  toasts = toasts.filter((t) => t.age < t.maxAge);
}

/** 清空（开新局/退出时调用，避免残留）。 */
export function clearBattleToasts(): void {
  toasts = [];
}

/** 当前 toast 文案（无则 null）——供 headless 冒烟/自测探针读取。 */
export function peekBattleToast(): string | null {
  return toasts.length > 0 ? toasts[0]!.text : null;
}

/** 绘制（在战斗绘制链路中、结算/暂停等叠层之下调用）。 */
export function drawBattleToasts(ctx: CanvasRenderingContext2D): void {
  for (const t of toasts) {
    const enter = Math.min(1, t.age / FADE_IN);
    const exit = Math.max(0, Math.min(1, (t.maxAge - t.age) / FADE_OUT));
    const alpha = enter * exit;
    if (alpha <= 0) continue;
    const barW = Math.min(VIEW_W - 72, 360);
    const x = (VIEW_W - barW) / 2;
    const y = HUD_H + 20; // HUD 正下方
    ctx.save();
    ctx.globalAlpha = alpha;
    roundRect(ctx, x, y, barW, BAR_H, BAR_H / 2);
    ctx.fillStyle = 'rgba(28,20,14,0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,230,190,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fff6e8';
    ctx.font = 'bold 16px "PingFang SC", "STKaiti", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.text, VIEW_W / 2, y + BAR_H / 2);
    ctx.restore();
  }
}
