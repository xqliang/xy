// 蟠桃货币/飘字图标：复用 Seedream「蟠桃园」技能图，缺图回退 emoji。
import { sprite } from './assets';

/** 与被动技能 pas_pantao 同图（skill-pas-pantao） */
export const PEACH_ASSET_KEY = 'skill-pas-pantao';

/** 在 (cx,cy) 居中绘制桃图，返回占用宽度（便于与数字并排） */
export function drawPeachIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  opts?: { alpha?: number; gray?: boolean },
): number {
  const img = sprite('peach') ?? sprite(PEACH_ASSET_KEY);
  if (img) {
    ctx.save();
    if (opts?.alpha != null) ctx.globalAlpha *= opts.alpha;
    if (opts?.gray) ctx.filter = 'grayscale(1) brightness(0.9)';
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
    return size;
  }
  // fallback：emoji（资源未加载时）
  const peach = '🍑';
  ctx.save();
  if (opts?.alpha != null) ctx.globalAlpha *= opts.alpha;
  ctx.font = `bold ${Math.round(size * 0.92)}px "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts?.gray ? '#9a9080' : '#fffef6';
  ctx.fillText(peach, cx, cy);
  const w = ctx.measureText(peach).width;
  ctx.restore();
  return w;
}
