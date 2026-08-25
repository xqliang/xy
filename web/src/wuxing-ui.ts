// 五行徽章：圆形色底 + 汉字（金/木/水/火/土）。纯 canvas 绘制，不依赖图片素材。
import { ELEMENT_ZH, ELEMENT_COLOR, type Element } from '@core';

/**
 * 在 (cx,cy) 画半径 r 的五行徽章。
 * 算法：先填元素主题色实心圆（92% 不透明度），再描一圈半透明黑边增强边缘对比，
 * 最后居中叠白字汉字。el 为 null 时直接返回（兵种/未知无五行，不画）。
 * 字体大小随半径缩放（r×1.15），字基线略下移（+r×0.06）做视觉居中补偿。
 *
 * @param ctx 画布上下文
 * @param cx 圆心 x
 * @param cy 圆心 y
 * @param r 半径（像素，过小会被下限钳制到合理值由调用方保证）
 * @param el 五行属性；null 表示无属性，徽章不画
 */
export function drawElementBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, el: Element | null): void {
  if (!el) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = ELEMENT_COLOR[el];
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(r * 1.15)}px "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ELEMENT_ZH[el], cx, cy + r * 0.06);
  ctx.restore();
}
