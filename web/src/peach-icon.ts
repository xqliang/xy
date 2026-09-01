// 蟠桃货币/飘字图标：复用 Seedream「蟠桃园」技能图，缺图回退 emoji。
import { sprite } from './assets';
import { createOffscreenCanvas } from './platform';

/** 与被动技能 pas_pantao 同图（skill-pas-pantao） */
export const PEACH_ASSET_KEY = 'skill-pas-pantao';

/**
 * 像素级灰度化（原地，BT.601 亮度 × 0.9 亮度系数，近似 CSS grayscale(1) brightness(0.9)）。
 * 预渲染灰版贴图用——替代曾经的每帧 `ctx.filter`：实时滤镜在弱 GPU 上是每帧像素计算
 * （部分实现还要读回 CPU），「桃不足时必卡、桃回满恢复」的元凶（2026-09-01 真机实锤）。
 * 纯函数供单测；alpha 通道保留（PNG 透明区不糊黑）。
 */
export function grayscalePeachPixels(p: Uint8ClampedArray): void {
  for (let i = 0; i + 3 < p.length; i += 4) {
    const g = (0.299 * p[i]! + 0.587 * p[i + 1]! + 0.114 * p[i + 2]!) * 0.9;
    p[i] = p[i + 1]! = p[i + 2]! = g;
  }
}

/** 灰版桃图缓存：按源图引用失效（素材异步加载完成后引用变化 → 重建一次）。 */
let grayPeachCache: { src: CanvasImageSource; canvas: HTMLCanvasElement } | null = null;

function grayPeachSprite(): HTMLCanvasElement | null {
  const img = sprite('peach') ?? sprite(PEACH_ASSET_KEY);
  if (!img) return null;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  if (grayPeachCache && grayPeachCache.src === img) return grayPeachCache.canvas;
  // 一次性生成：复制源图 → getImageData 手动灰度（规避 ctx.filter 的运行时支持差异）。
  // 生成失败（读回受限的罕见环境）保留彩色原样，仅语义降级，不再走每帧滤镜。
  const cv = createOffscreenCanvas(w, h);
  const c2 = cv.getContext('2d')!;
  c2.drawImage(img, 0, 0, w, h);
  try {
    const data = c2.getImageData(0, 0, w, h);
    grayscalePeachPixels(data.data);
    c2.putImageData(data, 0, 0);
  } catch { /* 读回失败：彩色降级 */ }
  grayPeachCache = { src: img, canvas: cv };
  return cv;
}

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
    // 灰版走预渲染贴图（曾经的 ctx.filter 每帧实时滤镜是「桃不足必卡」的元凶，见上）
    const src = opts?.gray
      ? (grayPeachSprite() ?? img)
      : img;
    ctx.drawImage(src, cx - size / 2, cy - size / 2, size, size);
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
