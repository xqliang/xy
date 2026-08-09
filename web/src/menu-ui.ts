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

  const headH = 46;
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
  ctx.font = 'bold 20px "PingFang SC", serif';
  ctx.fillText('×', closeR.x + closeR.w / 2, closeR.y + closeR.h / 2 + 1);

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
  ctx.font = `bold ${rect.h >= 70 ? 18 : 15}px "PingFang SC", "STKaiti", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy);
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
): void {
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.h / 2);
  ctx.fillStyle = 'rgba(48,28,12,0.62)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,160,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e0c080';
  ctx.font = 'bold 13px "PingFang SC", "STKaiti", serif';
  ctx.fillText(tag, rect.x + 10, rect.y + rect.h / 2);
  ctx.fillStyle = '#fff6e6';
  ctx.font = 'bold 14px "PingFang SC", sans-serif';
  ctx.fillText(text, rect.x + 38, rect.y + rect.h / 2);
}

export function drawInkPlusButton(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  interact: MenuInteract,
): void {
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
  ctx.font = `bold ${Math.round(rect.h * 0.62)}px "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('+', cx, cy);
  ctx.restore();
}

function drawRankStarFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  on: boolean,
): void {
  ctx.beginPath();
  for (let p = 0; p < 5; p++) {
    const ang = -Math.PI / 2 + p * ((Math.PI * 2) / 5);
    const rad = p % 2 === 0 ? 9 : 4;
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
