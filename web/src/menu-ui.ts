// 首页 / 弹窗共用水墨 UI 组件（朱红金边、宣纸底，无 emoji）。
import { sprite } from './assets';
import { VIEW_W, VIEW_H, fillViewScrim, drawPalaceRoof } from './render';

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

/** 弹窗标题栏高度（内容区距弹窗顶的偏移；宫檐横带「戴」在弹窗顶上方） */
export const INK_POPUP_HEAD_H = 46;
/** 宫檐整体上移量：檐口压到弹窗顶内、盖住弹窗顶部圆角边角（drawInkPopupFrame 用）。用户两轮要求上移：5→10 */
const BAND_LIFT = 10;
/** 关闭按钮随宫檐整体上移量（与宫檐同步，压在瓦面上） */
const CLOSE_LIFT = 0;
/** 宫檐横带素材实测比例（tools/seeddream/_process-roof.mjs 量得，v3 水墨檐带）：
 *  檐梁只占素材宽的 ~90%（两端各内缩 ~5%），翘角外缘伸到素材两侧边。
 *  据此把檐梁两端对齐弹窗左右侧边（x / x+w），翘角自然外挑到弹窗外。 */
const ROOF_BEAM_SPAN = 0.902; // bandW 基础 = w / ROOF_BEAM_SPAN
const ROOF_BEAM_LEFT = 0.051; // bandLeft = x - ROOF_BEAM_LEFT * baseBandW - ROOF_EXTRA_W
/** 宫檐在「檐梁对齐弹窗侧边」基础上左右各再外扩的像素（用户要求整体再宽 5px/边） */
const ROOF_EXTRA_W = 5;

export function inkPopupCloseRect(
  popX: number,
  popY: number,
  btnW = 36,
  btnH = 30,
): { x: number; y: number; w: number; h: number } {
  return {
    x: popX + 10,
    y: popY + (INK_POPUP_HEAD_H - btnH) / 2 - CLOSE_LIFT,
    w: btnW,
    h: btnH,
  };
}

/** 宫檐标题匾额：优先用生成的红木牌匾图 palace-title-plaque（金龙雕花框），缺图回退程序化红木匾。
 *  居中于 (cx,cy)；返回匾内可题字的最大宽度（供调用方按需缩小字号适配长标题）。 */
function drawTitlePlaque(ctx: CanvasRenderingContext2D, cx: number, cy: number): number {
  const img = sprite('palace-title-plaque');
  if (img && img.naturalWidth) {
    const dispH = 59; // 显示高（用户两轮要求逐步加高：38→44→59；水墨牌匾更大更醒目）
    const dispW = dispH * (img.naturalWidth / img.naturalHeight);
    ctx.drawImage(img, cx - dispW / 2, cy - dispH / 2, dispW, dispH);
    return dispW * 0.60; // 中央木面可题字宽（v3 水墨牌匾龙纹更大，占比回调到 0.60，题字不压龙）
  }
  // 回退（CDN 图未就绪）：程序化红木匾——暖褐红木底 + 双金线框
  const pw = 260, ph = 59, padX = 30;
  const px = cx - pw / 2, py = cy - ph / 2, r = 8;
  ctx.save();
  const g = ctx.createLinearGradient(0, py, 0, py + ph);
  g.addColorStop(0, '#93582f');
  g.addColorStop(0.5, '#74401f');
  g.addColorStop(1, '#5c3016');
  roundRect(ctx, px, py, pw, ph, r);
  ctx.fillStyle = g;
  ctx.fill();
  roundRect(ctx, px, py, pw, ph, r);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#caa24e';
  ctx.stroke();
  roundRect(ctx, px + 4, py + 4, pw - 8, ph - 8, Math.max(1, r - 3));
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(230,200,120,0.65)';
  ctx.stroke();
  ctx.restore();
  return pw - padX * 2;
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
  // 半透明压暗底层界面（菜单/战场），卷轴浮在其上（小游戏下同时记录蒙层色，帧尾给黑边补色）
  fillViewScrim(ctx, 'rgba(28,22,16,0.38)');

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
  // 不再画老的朱红渐变标题背景条（用户反馈多余）：标题栏视觉完全由厚重宫檐承担，
  // 宫檐透明处直接露出弹窗米色体（檐梁底边即标题栏与内容区的分界）。
  // 水墨宫檐横带（Seedream 生成 palace-roof-band，v3 国风水墨）：正脊+翘角+宝顶高出弹窗上沿（屋顶「戴」在弹窗顶上），
  // 瓦面与檐梁构成标题栏主体，标题牌匾嵌在瓦面上。
  // 三段式绘制：左右翘角段按原图比例不变形，中间瓦面段横向拉伸补足。
  // 关键：素材里檐梁只占宽 ~90%（翘角外挑），故 bandW=w/ROOF_BEAM_SPAN、bandLeft=x-ROOF_BEAM_LEFT*bandW，
  //       使「檐梁两端」正好压在弹窗左右侧边、翘角凸出到弹窗外（用户要求：屋顶下边缘对齐弹窗两边、屋角凸出）。
  // 素材未加载时回退矢量 drawPalaceRoof（同样造型，无细节纹理）。
  const band = sprite('palace-roof-band');
  const bandH = 104; // 显示高（v3 水墨檐带更扁）
  const bandLift = BAND_LIFT; // 整体上移量：檐口压进弹窗顶、盖住顶部圆角边角
  const baseBandW = w / ROOF_BEAM_SPAN; // 檐梁恰好 = 弹窗宽 w 时的基础宽
  const bandW = baseBandW + ROOF_EXTRA_W * 2; // 用户要求宫檐左右各再宽 5px
  const bandLeft = x - ROOF_BEAM_LEFT * baseBandW - ROOF_EXTRA_W; // 檐梁≈对齐弹窗侧边，整体再外扩 5px/边
  const bandTop = y + headH - bandLift - bandH; // 檐梁底在 y+headH-bandLift（弹窗顶附近）
  if (band && band.naturalWidth) {
    const imgW = band.naturalWidth, imgH = band.naturalHeight;
    const endSrcW = imgW * 0.25; // 源图两端翘角段各占 1/4 宽
    const endW = bandH * (endSrcW / imgH); // 翘角段显示宽按原图纵横比，保持不变形
    const midW = Math.max(0, bandW - 2 * endW);
    ctx.drawImage(band, 0, 0, endSrcW, imgH, bandLeft, bandTop, endW, bandH);
    ctx.drawImage(band, endSrcW, 0, imgW - 2 * endSrcW, imgH, bandLeft + endW, bandTop, midW, bandH);
    ctx.drawImage(band, imgW - endSrcW, 0, endSrcW, imgH, bandLeft + endW + midW, bandTop, endW, bandH);
  } else {
    drawPalaceRoof(ctx, x + w / 2, y + 10, w + 24, 26);
  }
  // 标题画在瓦面下带（檐梁上方 ~20px，避开正脊）。宫檐瓦面花纹杂、纯描边字偏糊，
  // 故先在檐上嵌一块红木牌匾（生成图，缺图回退程序化匾），标题再题在匾木面上——对比强、像宫门匾额。
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const titleCx = x + w / 2;
  const titleCy = y + 11; // 匾中心（相对弹窗顶固定，与宫檐上移解耦；用户逐轮上移：19→17→14→11）
  const innerW = drawTitlePlaque(ctx, titleCx, titleCy);
  // 题字：默认 20px，超过匾木面宽则按比例缩小字号适配（长标题如「继续上次对局？」）
  let fs = 24; // 题字字号（原 20，用户要求稍微放大）
  ctx.font = `900 ${fs}px "PingFang SC", "STKaiti", serif`;
  const tw = ctx.measureText(title).width;
  if (tw > innerW) {
    fs = Math.max(13, Math.floor((fs * innerW) / tw));
    ctx.font = `900 ${fs}px "PingFang SC", "STKaiti", serif`;
  }
  // 米金字 + 极细深棕描边（匾木面已提供对比，描边只为字口清晰）；题字居中于匾（水平/垂直皆取匾中心）
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.8; // 描边加粗（原 2），配合字号放大让字口更醒目
  ctx.strokeStyle = 'rgba(50,20,6,0.7)';
  ctx.strokeText(title, titleCx, titleCy);
  ctx.fillStyle = '#ffe9b8';
  ctx.fillText(title, titleCx, titleCy);

  roundRect(ctx, closeR.x, closeR.y, closeR.w, closeR.h, 6);
  ctx.fillStyle = 'rgba(48,28,12,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,160,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // × 用两条对角线描出（几何居中），不依赖字体 textBaseline——微信真机 'middle' 基线与浏览器不一致会让字形偏上。
  {
    const cx = closeR.x + closeR.w / 2;
    const cy = closeR.y + closeR.h / 2;
    const r = Math.min(closeR.w, closeR.h) * 0.26;
    ctx.strokeStyle = '#ffe8c0';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r);
    ctx.lineTo(cx + r, cy + r);
    ctx.moveTo(cx - r, cy + r);
    ctx.lineTo(cx + r, cy - r);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  return y + headH + 12;
}

/** 普通弹窗框（无宫檐/牌匾）：米色卷轴体 + 顶部居中标题 + 淡金分隔线，返回内容区 top。
 *  用于需要「简化、无屋顶」的确认类弹窗（如续玩「继续对局/回到首页」）。 */
export function drawPlainPopupFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
): number {
  fillViewScrim(ctx, 'rgba(28,22,16,0.38)');
  roundRect(ctx, x, y, w, h, 14);
  const bodyG = ctx.createLinearGradient(x, y, x, y + h);
  bodyG.addColorStop(0, '#f0e6d0');
  bodyG.addColorStop(1, '#dcc9a4');
  ctx.fillStyle = bodyG;
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,60,30,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  roundRect(ctx, x + 6, y + 6, w - 12, h - 12, 10);
  ctx.strokeStyle = 'rgba(180,140,90,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const headH = INK_POPUP_HEAD_H;
  // 顶部居中标题（深棕水墨字）+ 一条淡金分隔线（替代宫檐/牌匾）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 22px "PingFang SC", "STKaiti", serif';
  ctx.fillStyle = '#5a3a12';
  ctx.fillText(title, x + w / 2, y + headH / 2 + 6);
  ctx.strokeStyle = 'rgba(150,110,60,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 20, y + headH);
  ctx.lineTo(x + w - 20, y + headH);
  ctx.stroke();

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
  // 朱印风格：未选=宣纸米底细棕边；选中=朱红印底白勾（方形圆角近印章，配水墨 UI）
  roundRect(ctx, box.x, box.y, box.w, box.h, 3);
  ctx.fillStyle = on ? 'rgba(168,58,34,0.92)' : 'rgba(250,243,224,0.75)';
  ctx.fill();
  ctx.strokeStyle = on ? '#7a2410' : 'rgba(90,60,30,0.55)';
  ctx.lineWidth = on ? 2 : 1.5;
  ctx.stroke();
  if (on) {
    ctx.strokeStyle = '#fff6e6';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(box.x + 4, box.y + box.h / 2);
    ctx.lineTo(box.x + 7, box.y + box.h - 4);
    ctx.lineTo(box.x + box.w - 3, box.y + 3);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }
  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 14px "PingFang SC", "STKaiti", serif';
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

/** 资源条图标显示边长（素材按 ×3 生成，见 resize-portraits TARGET） */
export const MERIT_ICON_DISPLAY = 24;
export const STAMINA_ICON_DISPLAY = 24;
/** 功德商店标题旁 / 体力弹窗主图 */
export const MERIT_ICON_PAGE_DISPLAY = 36;
export const STAMINA_ICON_PAGE_DISPLAY = 84;

export function drawUiIcon(
  ctx: CanvasRenderingContext2D,
  key: 'icon-merit' | 'icon-stamina',
  cx: number,
  cy: number,
  size: number,
): boolean {
  const img = sprite(key);
  if (!img) return false;
  ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  return true;
}

export function drawInkResourceBar(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  tag: string,
  text: string,
  rightPad = 0,
  icon?: 'icon-merit' | 'icon-stamina',
): void {
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.h / 2);
  // 暖琥珀釉面：贴合首页宣纸底，避免冷灰半透明条
  const barBg = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  barBg.addColorStop(0, 'rgba(255,236,200,0.88)');
  barBg.addColorStop(1, 'rgba(230,180,110,0.9)');
  ctx.fillStyle = barBg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(160,100,40,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const padX = Math.round(rect.h * 0.28);
  const iconSize = Math.min(
    rect.h - 6,
    icon === 'icon-stamina' ? STAMINA_ICON_DISPLAY : MERIT_ICON_DISPLAY,
  );
  const cy = rect.y + rect.h / 2;
  let cursor = rect.x + padX;
  if (icon && drawUiIcon(ctx, icon, cursor + iconSize / 2, cy, iconSize)) {
    cursor += iconSize + Math.round(rect.h * 0.18);
  } else {
    const tagPx = Math.max(13, Math.round(rect.h * 0.42));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8a5520';
    ctx.font = `bold ${tagPx}px "PingFang SC", "STKaiti", serif`;
    ctx.fillText(tag, cursor, cy);
    cursor += ctx.measureText(tag).width + Math.round(rect.h * 0.22);
  }
  const numPx = Math.max(15, Math.round(rect.h * 0.5));
  const textMaxW = rect.x + rect.w - cursor - padX - rightPad;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5a3010';
  ctx.font = `bold ${numPx}px "PingFang SC", sans-serif`;
  let shown = text;
  while (shown.length > 1 && ctx.measureText(shown).width > textMaxW) shown = shown.slice(0, -1);
  if (shown !== text && shown.length > 0) shown += '…';
  ctx.fillText(shown, cursor, cy);
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
  const outer = size * 0.46;
  const inner = size * 0.2;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * (Math.PI / 5);
    const rad = i % 2 === 0 ? outer : inner;
    const px = x + Math.cos(ang) * rad;
    const py = y + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  if (on) {
    const g = ctx.createRadialGradient(x, y - size * 0.08, 1, x, y, outer);
    g.addColorStop(0, '#f0d060');
    g.addColorStop(1, '#c08018');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#8a5810';
  } else {
    ctx.fillStyle = 'rgba(120,90,40,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,60,30,0.55)';
  }
  ctx.lineWidth = Math.max(1.2, size * 0.04);
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
  const sweepCycle = 2.5;
  const sweepDur = 0.38;
  const sweepPhase = t % sweepCycle;
  const inCtaSweep = anim === 'cta' && interact === 'none' && sweepPhase <= sweepDur;

  ctx.save();
  if (interact !== 'none') {
    applyMenuInteract(ctx, rect, interact);
  } else {
    let pulse = 1;
    if (inCtaSweep) {
      const u = sweepPhase / sweepDur;
      pulse = 1 + Math.sin(u * Math.PI) * 0.045;
    } else if (anim === 'soft') {
      pulse = 1 + Math.sin(t * 2.2 + 0.6) * 0.012;
    }
    if (pulse !== 1) {
      ctx.translate(cx, cy);
      ctx.scale(pulse, pulse);
      ctx.translate(-cx, -cy);
    }
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
