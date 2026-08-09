// 首页 / 弹窗共用水墨 UI 组件（朱红金边、宣纸底，无 emoji）。
import { sprite } from './assets';
import { VIEW_W, VIEW_H } from './render';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawInkVeil(ctx: CanvasRenderingContext2D, w: number, h: number, strength = 0.5): void {
  ctx.fillStyle = `rgba(240,233,220,${strength})`;
  ctx.fillRect(0, 0, w, h);
}

/** 弹窗标题栏高度（关闭钮在此区域内垂直居中） */
export const INK_POPUP_HEAD_H = 46;

/** × 在按钮框内视觉上略偏下，仅上移字形不改按钮位置 */
const INK_POPUP_CLOSE_GLYPH_Y = -1;

export function inkPopupCloseRect(
  popX: number,
  popY: number,
  btnW = 36,
  btnH = 30,
): { x: number; y: number; w: number; h: number } {
  return {
    x: popX + 10,
    y: popY + (INK_POPUP_HEAD_H - btnH) / 2,
    w: btnW,
    h: btnH,
  };
}

/** 弹窗卷轴框：返回内容区 top（标题栏下方） */
export function drawInkPopupFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  closeR: { x: number; y: number; w: number; h: number },
): number {
  ctx.fillStyle = 'rgba(28,22,16,0.42)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  roundRect(ctx, x, y, w, h, 14);
  const body = ctx.createLinearGradient(x, y, x, y + h);
  body.addColorStop(0, '#f0e6d0');
  body.addColorStop(1, '#dcc9a4');
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,60,30,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  roundRect(ctx, x + 6, y + 6, w - 12, h - 12, 10);
  ctx.strokeStyle = 'rgba(180,140,90,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const headH = INK_POPUP_HEAD_H;
  roundRect(ctx, x, y, w, headH, 14);
  const head = ctx.createLinearGradient(x, y, x, y + headH);
  head.addColorStop(0, '#8a4020');
  head.addColorStop(1, '#5a2810');
  ctx.fillStyle = head;
  ctx.fill();
  ctx.fillStyle = '#fff4e0';
  ctx.font = 'bold 20px "PingFang SC", "STKaiti", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, x + w / 2, y + headH / 2);

  roundRect(ctx, closeR.x, closeR.y, closeR.w, closeR.h, 6);
  ctx.fillStyle = 'rgba(48,28,12,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,160,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ffe8c0';
  ctx.font = 'bold 22px "PingFang SC", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('×', closeR.x + closeR.w / 2, closeR.y + closeR.h / 2 + INK_POPUP_CLOSE_GLYPH_Y);

  return y + headH + 12;
}

export type MenuInteract = 'none' | 'hover' | 'pressed';

export function menuInteract(
  pressedId: string | null,
  hoverId: string | null,
  id: string,
): MenuInteract {
  if (pressedId === id) return 'pressed';
  if (hoverId === id) return 'hover';
  return 'none';
}

export function applyMenuInteract(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  interact: MenuInteract,
): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  if (interact === 'pressed') {
    ctx.translate(cx, cy + 2);
    ctx.scale(0.93, 0.93);
    ctx.translate(-cx, -cy);
  } else if (interact === 'hover') {
    ctx.translate(cx, cy);
    ctx.scale(1.06, 1.06);
    ctx.translate(-cx, -cy);
  }
}

export function drawInkActionButton(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  label: string,
  pressed: boolean,
  tone: 'primary' | 'secondary' | 'accent' = 'primary',
): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  ctx.save();
  if (pressed) {
    ctx.translate(cx, cy + 2);
    ctx.scale(0.97, 0.97);
    ctx.translate(-cx, -cy);
  }
  const r = Math.min(rect.h / 2, 16);
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, r);
  const g = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  if (tone === 'primary') {
    g.addColorStop(0, pressed ? '#8a2810' : '#b5381f');
    g.addColorStop(1, pressed ? '#6a1808' : '#8a2810');
  } else if (tone === 'accent') {
    g.addColorStop(0, pressed ? '#9a7018' : '#c89828');
    g.addColorStop(1, pressed ? '#7a5810' : '#a07820');
  } else {
    g.addColorStop(0, pressed ? 'rgba(48,28,12,0.72)' : 'rgba(55,32,14,0.58)');
    g.addColorStop(1, pressed ? 'rgba(38,22,10,0.78)' : 'rgba(45,28,12,0.65)');
  }
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,160,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = tone === 'secondary' ? '#fff4e0' : '#fff8ee';
  const lines = label.split('\n');
  const fontSize = lines.length > 1 ? 15 : (rect.h >= 70 ? 18 : 15);
  ctx.font = `bold ${fontSize}px "PingFang SC", "STKaiti", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (lines.length === 1) {
    ctx.fillText(label, cx, cy);
  } else {
    const lineGap = fontSize * 1.2;
    const y0 = cy - ((lines.length - 1) * lineGap) / 2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i]!, cx, y0 + i * lineGap);
    }
  }
  ctx.restore();
}

export function drawInkSideButton(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  label: string,
  pressed: boolean,
): void {
  drawInkActionButton(ctx, rect, label, pressed, 'secondary');
}

export function drawInkCheckbox(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  label: string,
  on: boolean,
  interact: MenuInteract,
): void {
  if (interact !== 'none') {
    ctx.fillStyle = interact === 'pressed' ? 'rgba(48,28,12,0.12)' : 'rgba(255,248,235,0.1)';
    roundRect(ctx, box.x - 4, box.y - 6, label.length * 14 + box.w + 20, box.h + 12, 6);
    ctx.fill();
  }
  roundRect(ctx, box.x, box.y, box.w, box.h, 4);
  ctx.fillStyle = on ? 'rgba(180,90,70,0.4)' : 'rgba(255,248,235,0.6)';
  ctx.fill();
  ctx.strokeStyle = on ? '#8a4020' : 'rgba(90,60,30,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (on) {
    ctx.strokeStyle = '#5a3010';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(box.x + 4, box.y + box.h / 2);
    ctx.lineTo(box.x + 7, box.y + box.h - 4);
    ctx.lineTo(box.x + box.w - 3, box.y + 3);
    ctx.stroke();
  }
  ctx.fillStyle = '#5a3a12';
  ctx.font = '14px "PingFang SC", serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, box.x + box.w + 8, box.y + box.h / 2);
}

/** 勾选框 + 标签整体以 centerX 居中（用于开始按钮下方） */
export function inkCheckboxCenteredLayout(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  y: number,
  label: string,
  boxSize = 18,
): {
  box: { x: number; y: number; w: number; h: number };
  hit: { x: number; y: number; w: number; h: number };
} {
  ctx.font = '14px "PingFang SC", serif';
  const textW = ctx.measureText(label).width;
  const gap = 8;
  const totalW = boxSize + gap + textW;
  const boxX = centerX - totalW / 2;
  return {
    box: { x: boxX, y, w: boxSize, h: boxSize },
    hit: { x: boxX - 6, y: y - 8, w: totalW + 12, h: boxSize + 16 },
  };
}

export function drawInkSlider(
  ctx: CanvasRenderingContext2D,
  rowY: number,
  label: string,
  track: { x: number; y: number; w: number; h: number },
  knob: { x: number; y: number; w: number; h: number },
  value: number,
): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5a3a12';
  ctx.font = '15px "PingFang SC", serif';
  ctx.fillText(label, track.x, rowY);
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillStyle = '#8a6030';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(value * 100)}%`, track.x + track.w, rowY);

  roundRect(ctx, track.x, track.y, track.w, track.h, track.h / 2);
  ctx.fillStyle = 'rgba(48,28,12,0.35)';
  ctx.fill();
  if (value > 0) {
    roundRect(ctx, track.x, track.y, Math.max(track.h, track.w * value), track.h, track.h / 2);
    const fg = ctx.createLinearGradient(track.x, track.y, track.x + track.w * value, track.y);
    fg.addColorStop(0, '#b5381f');
    fg.addColorStop(1, '#8a4020');
    ctx.fillStyle = fg;
    ctx.fill();
  }
  roundRect(ctx, knob.x, knob.y, knob.w, knob.h, knob.h / 2);
  ctx.fillStyle = '#d4c4a0';
  ctx.fill();
  ctx.strokeStyle = '#8a6020';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export function drawInkResourceBar(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  tag: string,
  text: string,
  rightPad = 0,
): void {
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.h / 2);
  ctx.fillStyle = 'rgba(48,28,12,0.62)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,160,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const padX = Math.round(rect.h * 0.35);
  const tagPx = Math.max(13, Math.round(rect.h * 0.42));
  const numPx = Math.max(15, Math.round(rect.h * 0.5));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e0c080';
  ctx.font = `bold ${tagPx}px "PingFang SC", "STKaiti", serif`;
  ctx.fillText(tag, rect.x + padX, rect.y + rect.h / 2);
  const tagW = ctx.measureText(tag).width;
  const textOffset = padX + tagW + Math.round(rect.h * 0.22);
  const textX = rect.x + textOffset;
  const textMaxW = rect.w - textOffset - padX - rightPad;
  ctx.fillStyle = '#fff6e6';
  ctx.font = `bold ${numPx}px "PingFang SC", sans-serif`;
  let shown = text;
  while (shown.length > 1 && ctx.measureText(shown).width > textMaxW) shown = shown.slice(0, -1);
  if (shown !== text && shown.length > 0) shown += '…';
  ctx.fillText(shown, textX, rect.y + rect.h / 2);
}

export function drawInkPlusButton(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  interact: MenuInteract,
  variant: 'raised' | 'inset' = 'raised',
): void {
  if (variant === 'inset') {
    drawInkPlusButtonInset(ctx, rect, interact);
    return;
  }
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  ctx.save();
  applyMenuInteract(ctx, rect, interact);
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.w / 2);
  ctx.fillStyle =
    interact === 'pressed' ? 'rgba(70,120,70,0.85)' : interact === 'hover' ? 'rgba(100,150,90,0.95)' : 'rgba(90,140,80,0.9)';
  ctx.fill();
  ctx.strokeStyle = interact === 'hover' ? 'rgba(255,220,160,0.65)' : 'rgba(255,220,160,0.5)';
  ctx.lineWidth = interact === 'hover' ? 2 : 1.5;
  ctx.stroke();
  ctx.fillStyle = '#fff8ee';
  ctx.font = `bold ${Math.round(rect.h * 0.58)}px "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('+', cx, cy);
  ctx.restore();
}

function drawInkPlusButtonInset(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  interact: MenuInteract,
): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const r = Math.min(rect.w, rect.h) / 2;
  const pressed = interact === 'pressed';
  const hover = interact === 'hover';
  ctx.save();
  if (interact !== 'none') applyMenuInteract(ctx, rect, interact);

  // 浅槽底：略深于键帽，托住立体按钮
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, r);
  const well = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  well.addColorStop(0, 'rgba(52,78,46,0.42)');
  well.addColorStop(1, 'rgba(42,64,38,0.32)');
  ctx.fillStyle = well;
  ctx.fill();

  const pad = 2;
  const fx = rect.x + pad;
  const fy = rect.y + pad + (pressed ? 1 : 0);
  const fw = rect.w - pad * 2;
  const fh = rect.h - pad * 2;
  const fr = r - pad;

  // 底部投影：托起立体键帽
  if (!pressed) {
    ctx.save();
    roundRect(ctx, fx, fy + 2, fw, fh, fr);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fill();
    ctx.restore();
  }

  // 键帽主体：上亮下暗渐变
  roundRect(ctx, fx, fy, fw, fh, fr);
  const face = ctx.createLinearGradient(fx, fy, fx, fy + fh);
  if (pressed) {
    face.addColorStop(0, '#688f62');
    face.addColorStop(1, '#557848');
  } else if (hover) {
    face.addColorStop(0, '#98b890');
    face.addColorStop(0.45, '#84a87c');
    face.addColorStop(1, '#6d9264');
  } else {
    face.addColorStop(0, '#8faa86');
    face.addColorStop(0.5, '#7a9872');
    face.addColorStop(1, '#68865e');
  }
  ctx.fillStyle = face;
  ctx.fill();

  // 顶部高光层
  ctx.save();
  roundRect(ctx, fx, fy, fw, fh, fr);
  ctx.clip();
  const shine = ctx.createLinearGradient(fx, fy, fx, fy + fh);
  shine.addColorStop(0, 'rgba(255,255,255,0.2)');
  shine.addColorStop(0.55, 'rgba(255,255,255,0.04)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.fillRect(fx, fy, fw, fh);
  ctx.restore();

  ctx.strokeStyle = hover ? 'rgba(255,248,220,0.42)' : 'rgba(255,240,200,0.28)';
  ctx.lineWidth = 1;
  roundRect(ctx, fx, fy, fw, fh, fr);
  ctx.stroke();

  const plusPx = Math.round(fh * 0.54);
  ctx.font = `bold ${plusPx}px "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const ty = cy + (pressed ? 0.5 : -0.5);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillText('+', cx - 0.5, ty - 1);
  ctx.fillStyle = pressed ? '#dce8d6' : hover ? '#eef6ea' : '#e4ede0';
  ctx.fillText('+', cx, ty);
  ctx.fillStyle = 'rgba(28,48,22,0.28)';
  ctx.fillText('+', cx + 0.5, ty + 1);
  ctx.restore();
}

function drawRankStarFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  on: boolean,
  size = 22,
): void {
  const outer = size * 0.41;
  const inner = size * 0.18;
  ctx.beginPath();
  for (let p = 0; p < 5; p++) {
    const ang = -Math.PI / 2 + p * ((Math.PI * 2) / 5);
    const rad = p % 2 === 0 ? outer : inner;
    const px = x + Math.cos(ang) * rad;
    const py = y + Math.sin(ang) * rad;
    if (p === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = on ? '#d4a020' : 'rgba(120,90,40,0.45)';
  ctx.fill();
  ctx.strokeStyle = '#8a6010';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** 水墨星星排：fills[i]∈[0,1] 控制第 i 颗由空→满的叠化（结算加星/减星动画） */
export function drawRankStarsAnimated(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  fills: number[],
  opts?: { total?: number; gap?: number; size?: number },
): void {
  const total = opts?.total ?? fills.length;
  const gap = opts?.gap ?? 28;
  const size = opts?.size ?? 22;
  const x0 = cx - ((total - 1) * gap) / 2;
  const starOn = sprite('rank-star-on');
  const starOff = sprite('rank-star-off');

  for (let i = 0; i < total; i++) {
    const fill = Math.max(0, Math.min(1, fills[i] ?? 0));
    const x = x0 + i * gap;
    const transitioning = fill > 0.02 && fill < 0.995;
    const scale = transitioning ? 1 + 0.16 * Math.sin(fill * Math.PI) : 1;
    const onSize = size * scale;

    ctx.save();
    if (starOff && starOn) {
      ctx.drawImage(starOff, x - size / 2, y - size / 2, size, size);
      if (fill > 0.001) {
        ctx.globalAlpha = fill;
        if (transitioning) {
          ctx.shadowColor = 'rgba(255,210,80,0.85)';
          ctx.shadowBlur = 10 * fill;
        }
        ctx.drawImage(starOn, x - onSize / 2, y - onSize / 2, onSize, onSize);
      }
    } else {
      drawRankStarFallback(ctx, x, y, fill >= 0.5, size);
    }
    ctx.restore();
  }
}

export function drawRankStars(ctx: CanvasRenderingContext2D, cx: number, y: number, filled: number, total = 5): void {
  const gap = 28;
  const size = 22;
  const x0 = cx - ((total - 1) * gap) / 2;
  const starOn = sprite('rank-star-on');
  const starOff = sprite('rank-star-off');
  for (let i = 0; i < total; i++) {
    const x = x0 + i * gap;
    const on = i < filled;
    const img = on ? starOn : starOff;
    if (img) {
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    } else {
      drawRankStarFallback(ctx, x, y, on);
    }
  }
}

export type MenuBtnAnim = 'cta' | 'soft' | 'none';
export type SpriteFit = 'contain' | 'cover';

function fitSpriteRect(
  img: HTMLImageElement,
  rect: { x: number; y: number; w: number; h: number },
  fit: SpriteFit = 'contain',
): { x: number; y: number; w: number; h: number } {
  const sw = rect.w / img.width;
  const sh = rect.h / img.height;
  const scale = fit === 'cover' ? Math.max(sw, sh) : Math.min(sw, sh);
  const w = img.width * scale;
  const h = img.height * scale;
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

/** 刀光左→右扫过（竞品主按钮提示可点）；marginX/marginY 为左右/上下留白，高光不贴边 */
function drawSlashSweep(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  t: number,
  strength: number,
  marginX = 0,
  marginY = 0,
): void {
  const cycle = 2.5;
  const sweep = 0.38;
  const phase = t % cycle;
  if (phase > sweep) return;
  const u = phase / sweep;
  const innerW = Math.max(0, rect.w - marginX * 2);
  const innerH = Math.max(0, rect.h - marginY * 2);
  const cx = rect.x + marginX + u * innerW;
  const r = Math.min(innerH / 2, 14);
  ctx.save();
  roundRect(ctx, rect.x + marginX, rect.y + marginY, innerW, innerH, r);
  ctx.clip();
  ctx.translate(cx, rect.y + rect.h / 2);
  ctx.rotate(-0.42);
  const g = ctx.createLinearGradient(-18, 0, 18, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.45, `rgba(255,248,230,${0.72 * strength})`);
  g.addColorStop(0.55, `rgba(255,255,255,${0.85 * strength})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-22, -innerH * 0.8, 44, innerH * 1.6);
  ctx.restore();
}

/** Seedream 按钮图：contain/cover + 可选呼吸放大与刀光；iconOnly 时不 clip、不加底色 overlay */
export function drawMenuSpriteButton(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | undefined,
  rect: { x: number; y: number; w: number; h: number },
  interact: MenuInteract,
  anim: MenuBtnAnim,
  fallbackLabel?: string,
  fallbackTone: 'primary' | 'secondary' | 'accent' = 'secondary',
  fit: SpriteFit = 'contain',
  iconOnly = false,
): boolean {
  if (!img) {
    if (!fallbackLabel) return false;
    drawInkActionButton(ctx, rect, fallbackLabel, interact === 'pressed', fallbackTone);
    return true;
  }

  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const t = performance.now() / 1000;
  const clipR = Math.min(rect.h / 2, fit === 'cover' && rect.w > rect.h * 1.2 ? 14 : 16);

  ctx.save();
  if (interact !== 'none') {
    applyMenuInteract(ctx, rect, interact);
  } else if (anim === 'soft') {
    const pulse = 1 + Math.sin(t * 2.2 + 0.6) * 0.012;
    ctx.translate(cx, cy);
    ctx.scale(pulse, pulse);
    ctx.translate(-cx, -cy);
  }

  if (!iconOnly) {
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, clipR);
    ctx.clip();
  }
  const drawn = fitSpriteRect(img, rect, fit);
  ctx.drawImage(img, drawn.x, drawn.y, drawn.w, drawn.h);

  if (interact === 'none') {
    if (anim === 'cta') drawSlashSweep(ctx, rect, t, 1, 40, 10);
    else if (anim === 'soft' && Math.floor(t / 2.5) % 2 === 0) drawSlashSweep(ctx, rect, t, 0.55);
  }
  ctx.restore();
  return true;
}
