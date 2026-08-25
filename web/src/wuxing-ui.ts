// 五行徽章：圆形色底 + 汉字（金/木/水/火/土）。纯 canvas 绘制，不依赖图片素材。
import { ELEMENT_ZH, ELEMENT_COLOR, elementMul, type Element } from '@core';

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

/** 武将 vs 地图的克制关系：'adv'=克图、'dis'=被图克、null=同行/任一方无属性（不画徽章） */
export type CounterRelation = 'adv' | 'dis' | null;

/**
 * 推导武将五行对地图五行的克制关系（复用 elementMul，保证与实际伤害倍率同口径）：
 * 倍率 >1 → 'adv'（克图），<1 → 'dis'（被图克），=1（同行或任一方 null）→ null。
 * 倍率参数可注入（默认 1.25/0.75），调用方传 TUNING.wuxingAdvMul/DisMul 即可跟随 DevTools 调参。
 */
export function counterRelation(
  generalEl: Element | null,
  mapEl: Element | null,
  advMul = 1.25,
  disMul = 0.75,
): CounterRelation {
  const mul = elementMul(generalEl, mapEl, advMul, disMul);
  return mul > 1 ? 'adv' : mul < 1 ? 'dis' : null;
}

/** 克制徽章配色：克=金底（与「克」飘字同色系）、被克=石板灰底 */
const COUNTER_COLOR: Record<'adv' | 'dis', string> = {
  adv: '#d8a018',
  dis: '#6a7280',
};

/**
 * 在 (cx,cy) 画半径 r 的「克/被」小徽章（棋盘武将右下角用）。
 * rel 为 null 直接返回（同行/无属性不占位）。风格对齐 drawElementBadge：
 * 实心色底圆 + 半透明黑边 + 白字居中，字号随半径缩放。
 */
export function drawCounterBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rel: CounterRelation): void {
  if (!rel) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = COUNTER_COLOR[rel];
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(r * 1.15)}px "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(rel === 'adv' ? '克' : '被', cx, cy + r * 0.06);
  ctx.restore();
}
