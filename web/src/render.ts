// Canvas 渲染层。逻辑分辨率 560×920（竖屏，贴近微信小游戏）。
import {
  COLS,
  ROWS,
  FENCE_ROW,
  isEitherPathCell,
  isPlayerCell,
  posAtDistance,
  posAlong,
  lenOf,
  mirrorCell,
  placeableCells,
  type Cell,
} from './board';
import { Battle, TUNING, SKILL_META, MINI_BOSS_META, UNIT_STATUS_META, MONSTER_STATUS_META, PEACH_TREE_INTERVALS, PEACH_TREE_MAX_LEVEL, PEACH_FLOAT_FALL, DIG_DUR, type TrayToken, type PeachTree, type HeroUltFx, type UnitStatusId, type MonsterStatusId, type MiniBossKind, type Monster } from './battle';
import { passiveById } from './passives';
import { activeById } from './actives';
import { generalById, generalStat, generalsWithChar, partnerChars, qualityColor, qualityName } from './generals';
import { UNITS, getUnitStat, damage, canMerge, MAX_TIER } from '@core';
import type { UnitType } from '@core';
import { sprite, unitAsset, monsterSprite } from './assets';
import { getBestWave } from './endless';

export const VIEW_W = 560;
export const HUD_H = 72;
export const CELL = Math.floor((VIEW_W - 16) / COLS); // 8 列自适应 → 68
export const BOARD_X = Math.round((VIEW_W - CELL * COLS) / 2);
export const BOARD_Y = HUD_H + 12;
export const BOARD_H = CELL * ROWS;
export const TRAY_Y = BOARD_Y + BOARD_H + 8; // 候选区行
export const TRAY_H = 78; // 候选区行高（放大：候选槽≈地图格子大小）
export const CTRL_Y = TRAY_Y + TRAY_H + 26; // 控制按钮行（与候选区拉开间距，避免从「营」拖令牌部署时误点征兵）
export const CTRL_H = 80; // 行高预留：容纳更大的征兵按钮，下方 PAS 行据此下移不重叠
export const PAS_Y = CTRL_Y + CTRL_H + 8; // 被动/强化技能图标行
export const PAS_H = 46;
export const MSG_Y = PAS_Y + PAS_H + 16; // 提示文字行
export const VIEW_H = MSG_Y + 18;

const UNIT_LABEL: Record<UnitType, string> = {
  monkey: '刀',
  spear: '枪',
  cavalry: '骑',
  archer: '弓',
};

export function cellCenterPx(c: number, r: number): { x: number; y: number } {
  return { x: BOARD_X + c * CELL + CELL / 2, y: BOARD_Y + r * CELL + CELL / 2 };
}

export function pxToCell(x: number, y: number): Cell | null {
  const c = Math.floor((x - BOARD_X) / CELL);
  const r = Math.floor((y - BOARD_Y) / CELL);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
  return { c, r };
}

export interface Button {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  enabled: boolean;
}

export function getButtons(b: Battle): Button[] {
  const y = CTRL_Y;
  const h = 64;
  if (b.status === 'won' || b.status === 'lost') {
    return [{ id: 'restart', label: '重新开始', x: 24, y, w: VIEW_W - 48, h, enabled: true }];
  }
  const trayEmpty = b.tray.length === 0;
  const canSummon = b.peach >= b.effectiveSummonCost(); // 桃够即可征兵(不看候选槽；点后清空残余)
  // 备战(ready)与对战(playing)共用同一套底部布局：中央「征兵」，两翼已购主动技能图标(带CD)，左端「布阵」，
  // 下方一排已购被动技能图标。主动/被动都仅在购买后显示；如来神掌等主动技能需在商店购买才出现。
  const trayRightX = TRAY_LEFT + TUNING.traySize * TRAY_SLOT + 8; // 候选槽右侧
  const btns: Button[] = [
    // 布阵：移到候选区(tray)右端，与候选槽同高，便于拿到令牌后就近一键落位
    { id: 'autoplace', label: '布阵', x: trayRightX, y: TRAY_Y + 6, w: VIEW_W - trayRightX - 10, h: TRAY_H - 12, enabled: !trayEmpty },
    // 征兵：主 CTA，加大(200×78)且比两翼按钮更靠下，配合上移的行间距，避免部署令牌时误点
    { id: 'summon', label: `征兵${b.effectiveSummonCost()}`, x: 180, y, w: 200, h: 78, enabled: canSummon },
  ];
  // 两翼主动技能圆形图标：紧贴「征兵」两侧、与之垂直居中（对齐竞品）。仅渲染已装备的槽。
  const ACT_D = 60; // 圆直径
  const ACT_GAP = 10; // 与「征兵」按钮的间隙
  const SUMMON_X = 180, SUMMON_W = 200, SUMMON_H = 78; // 与上方征兵按钮保持一致
  const actX = [SUMMON_X - ACT_GAP - ACT_D, SUMMON_X + SUMMON_W + ACT_GAP]; // 征兵左侧/右侧
  const actY = y + (SUMMON_H - ACT_D) / 2; // 与征兵按钮垂直居中
  for (let i = 0; i < b.activeSlots.length && i < 2; i++) {
    btns.push({ id: `act${i}`, label: '', x: actX[i]!, y: actY, w: ACT_D, h: ACT_D, enabled: true });
  }
  // 被动/强化技能行：居中显示，每个已携带道具一格，可点击查看详情/进度
  const pasPitch = PAS_H + 6;
  const pasStartX = (VIEW_W - (b.pickedItems.length * pasPitch - 6)) / 2;
  for (let i = 0; i < b.pickedItems.length; i++) {
    btns.push({ id: `pas${i}`, label: '', x: pasStartX + i * pasPitch, y: PAS_Y, w: PAS_H, h: PAS_H, enabled: true });
  }
  return btns;
}

export interface UiState {
  dragFrom: Cell | null; // 从棋盘拖动的单位源格
  dragTrayIndex: number | null; // 从候选区拖动的令牌下标
  dragPos: { x: number; y: number } | null;
  selected: Cell | null; // 点击选中的单位格（仅此时显示攻击范围+信息面板）
  selectedMonster: { side: 'player' | 'ai'; id: number } | null; // 点击选中的妖怪（按 id，可跨格移动）
  passivePopup: number | null; // 点击的被动/强化道具下标（显示详情/进度弹窗）
  activePopup: number | null; // 点击的主动技能槽下标（CD中点击显示介绍弹窗，定时自动淡出）
  activePopupUntil: number; // 主动技能弹窗展示截止时间(performance.now ms)
  paused: boolean; // 局内手动暂停（弹窗遮罩，step 停表）
}

/** HUD 左上角暂停按钮：蟠桃数字前方（不压地图，避免挡英雄操作） */
export const PAUSE_BTN = { x: 10, s: 32 };
export function pauseBtnRect(): { x: number; y: number; w: number; h: number } {
  return { x: PAUSE_BTN.x, y: (HUD_H - PAUSE_BTN.s) / 2, w: PAUSE_BTN.s, h: PAUSE_BTN.s };
}

/** 暂停弹窗「继续游戏」按钮几何 */
export function pauseContinueRect(): { x: number; y: number; w: number; h: number } {
  const w = 220, h = 48;
  return { x: (VIEW_W - w) / 2, y: VIEW_H / 2 + 18, w, h };
}

export function hitPauseBtn(x: number, y: number): boolean {
  const r = pauseBtnRect();
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function hitPauseContinue(x: number, y: number): boolean {
  const r = pauseContinueRect();
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// HUD 显示的境界名（由 main 设置）
let hudRankLabel = '';
export function setHudRank(label: string): void {
  hudRankLabel = label;
}

// 背景整屏渐变缓存：全屏渐变每帧重建开销大，而一局内地图主题色固定，按颜色键复用同一对象。
// 坐标固定在逻辑空间(0..VIEW_H)，不随 DPR 变换失效，可跨帧安全复用。
let bgGradCache: { key: string; grad: CanvasGradient } | null = null;
function themeBgGradient(ctx: CanvasRenderingContext2D, bg0: string, bg1: string): CanvasGradient {
  const key = `${bg0}|${bg1}`;
  if (!bgGradCache || bgGradCache.key !== key) {
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, bg0);
    grad.addColorStop(1, bg1);
    bgGradCache = { key, grad };
  }
  return bgGradCache.grad;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 确定性伪随机 0..1（开垦格纹理用，同格稳定） */
function cellHash01(c: number, r: number, salt: number): number {
  let x = (c * 374761393 + r * 668265263 + salt * 982451653) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x >>> 0) % 10000) / 10000;
}

/**
 * 已开垦白格：米白底 + 随机浅淡水斑（软边椭圆晕），轻薄不抢戏。
 */
function drawUnlockedCellFace(
  ctx: CanvasRenderingContext2D,
  ix: number,
  iy: number,
  iw: number,
  ih: number,
  c: number,
  r: number,
  baseColor: string,
) {
  ctx.save();
  roundRect(ctx, ix, iy, iw, ih, 2);
  ctx.clip();
  ctx.fillStyle = baseColor;
  ctx.fillRect(ix, iy, iw, ih);

  // 每格 2～5 块水斑，位置/大小/深浅都随机但同格稳定
  const n = 2 + Math.floor(cellHash01(c, r, 3) * 4);
  for (let k = 0; k < n; k++) {
    const px = ix + 4 + cellHash01(c, r, 10 + k * 7) * (iw - 8);
    const py = iy + 4 + cellHash01(c, r, 20 + k * 7) * (ih - 8);
    // 扁椭圆水渍，略旋转
    const rx = 3 + cellHash01(c, r, 30 + k * 7) * Math.min(iw, ih) * 0.28;
    const ry = rx * (0.45 + cellHash01(c, r, 40 + k * 7) * 0.55);
    const ang = cellHash01(c, r, 50 + k * 7) * Math.PI;
    const a = 0.07 + cellHash01(c, r, 60 + k * 7) * 0.1; // 稍加重一点
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.scale(1, Math.max(0.35, ry / rx));
    const g = ctx.createRadialGradient(0, 0, rx * 0.15, 0, 0, rx);
    g.addColorStop(0, `rgba(135,128,115,${a})`);
    g.addColorStop(0.55, `rgba(145,138,125,${a * 0.55})`);
    g.addColorStop(1, 'rgba(150,142,130,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 再撒几滴更小的浅渍
  const m = 1 + Math.floor(cellHash01(c, r, 70) * 3);
  for (let k = 0; k < m; k++) {
    const px = ix + 5 + cellHash01(c, r, 80 + k * 5) * (iw - 10);
    const py = iy + 5 + cellHash01(c, r, 90 + k * 5) * (ih - 10);
    const rad = 1.2 + cellHash01(c, r, 100 + k * 5) * 2.8;
    const a = 0.05 + cellHash01(c, r, 110 + k * 5) * 0.07;
    const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, `rgba(130,124,112,${a})`);
    g.addColorStop(1, 'rgba(130,124,112,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(90,82,70,0.16)';
  roundRect(ctx, ix, iy, iw, ih, 2);
  ctx.stroke();
}

// 统一的右上角阶数：无底色，仅描边 + 金字，避免压住立绘/字牌
function drawTierBadge(ctx: CanvasRenderingContext2D, nx: number, ny: number, tier: number, fontPx: number) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${fontPx}px "PingFang SC", sans-serif`;
  ctx.lineWidth = Math.max(2.5, fontPx * 0.2);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(20,14,6,0.95)';
  ctx.strokeText(String(tier), nx, ny);
  ctx.fillStyle = '#ffe6a2';
  ctx.fillText(String(tier), nx, ny);
  ctx.restore();
}

/** 状态芯片：深色圆底 + 彩色描边 + 图标，去掉立绘底色后仍清晰可读 */
function drawStatusChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  icon: string,
  color: string,
  r = 9,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12,10,8,0.88)';
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = color;
  ctx.stroke();
  // 内侧淡色晕，增强对比
  ctx.beginPath();
  ctx.arc(x, y, r - 1.2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,245,220,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = `${Math.round(r * 1.15)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff8e8';
  ctx.fillText(icon, x, y + 0.5);
  ctx.restore();
}

/** 横向排列多个状态芯片（右对齐锚点） */
function drawStatusRow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  items: { icon: string; color: string }[],
  r = 9,
) {
  if (items.length === 0) return;
  const gap = r * 2 + 3;
  const total = gap * (items.length - 1);
  const startX = cx - total / 2;
  items.forEach((it, i) => drawStatusChip(ctx, startX + i * gap, cy, it.icon, it.color, r));
}

function unitStatusItems(u: {
  stunT: number;
  slowT: number;
  weakenT: number;
  rangeCutT: number;
  knockdownT: number;
}): { icon: string; color: string }[] {
  const order: UnitStatusId[] = ['knockdown', 'stun', 'slow', 'weaken', 'webbind'];
  const on: Record<UnitStatusId, boolean> = {
    knockdown: u.knockdownT > 0,
    stun: u.stunT > 0,
    slow: u.slowT > 0,
    weaken: u.weakenT > 0,
    webbind: u.rangeCutT > 0,
  };
  return order.filter((id) => on[id]).map((id) => UNIT_STATUS_META[id]);
}

function monsterStatusItems(m: {
  stunT: number;
  slowT: number;
  hasteT: number;
  healFlash: number;
}): { icon: string; color: string; name: string }[] {
  const order: MonsterStatusId[] = ['stun', 'slow', 'haste', 'heal'];
  const on: Record<MonsterStatusId, boolean> = {
    stun: m.stunT > 0,
    slow: m.slowT > 0,
    haste: m.hasteT > 0,
    heal: m.healFlash > 0.05,
  };
  return order.filter((id) => on[id]).map((id) => MONSTER_STATUS_META[id]);
}

function drawUnit(ctx: CanvasRenderingContext2D, type: UnitType, tier: number, x: number, y: number, size: number, faceLeft = false, badge?: { x: number; y: number; s: number }, fallen = false) {
  const s = size;
  // 不再画类型色底座：棋盘格与托盘都直接用透明立绘，无背景色
  const spr = sprite(unitAsset(type));
  if (spr) {
    // 立绘按 contain 缩放居中，铺满整格；各类型内容留白不同，按系数微调视觉大小
    const typeScale = type === 'monkey' ? 1 : type === 'archer' ? 1.08 : type === 'spear' ? 1.07 : 1; // 刀×1 / 射手×1.08 / 矛×1.07 / 骑手×1
    const box = s;
    const scale = Math.min(box / spr.width, box / spr.height) * typeScale;
    const dw = spr.width * scale;
    const dh = spr.height * scale;
    ctx.save();
    if (fallen) {
      // 倒下：横躺 + 略压扁，与「无法攻击」状态对应
      ctx.translate(x, y + s * 0.08);
      ctx.rotate(Math.PI / 2);
      ctx.scale(1, 0.72);
      if (faceLeft) { ctx.scale(-1, 1); }
      ctx.drawImage(spr, -dw / 2, -dh / 2, dw, dh);
    } else {
      // 刀/枪/弓/骑：朝左攻击时水平翻转立绘
      if (faceLeft) { ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0); }
      ctx.drawImage(spr, x - dw / 2, y - dh / 2, dw, dh);
    }
    ctx.restore();
  } else {
    ctx.save();
    if (fallen) {
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#1a1208';
      ctx.font = `bold ${Math.round(s * 0.42)}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(UNIT_LABEL[type], 0, 0);
    } else {
      ctx.fillStyle = '#1a1208';
      ctx.font = `bold ${Math.round(s * 0.42)}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(UNIT_LABEL[type], x, y - s * 0.06);
    }
    ctx.restore();
  }

  // 阶数：右上角小数字 1-5（统一徽标样式，非加粗）；锚定在固定的格中心/尺寸(badge)，不随立绘 bob/开火脉冲抖动
  const ax = badge ? badge.x : x, ay = badge ? badge.y : y, as = badge ? badge.s : s;
  drawTierBadge(ctx, ax + as * 0.44, ay - as * 0.36, tier, Math.round(as * 0.3));
}

// 「攻击瞬间形变为兵器」叠加层：在单位格上，沿 dir 朝目标出招，pulse(1→0) 驱动幅度/透明度/旋转。
// 参考竞品——棋盘上的字在开火时实时化为刀/枪/骑/弓兵器，并显示朝向箭头。
function drawUnitWeapon(ctx: CanvasRenderingContext2D, type: UnitType, tier: number, x: number, y: number, dir: number, pulse: number, combo: number) {
  if (pulse <= 0.02) return;
  const s = CELL * 0.52 * (1 + tier * 0.05);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir); // 旋转后 +x 轴指向目标
  ctx.globalAlpha = Math.min(1, pulse * 1.25);
  ctx.lineJoin = 'round';
  drawWeaponGlyph(ctx, type, s, pulse, combo, tier);
  // 朝向箭头（刀/骑不出箭头，避免抢戏）
  if (type !== 'monkey' && type !== 'cavalry') {
    ctx.globalAlpha = Math.min(0.85, pulse * 1.1);
    ctx.strokeStyle = '#2a2018';
    ctx.lineWidth = 2;
    const ax = s * 0.74;
    ctx.beginPath();
    ctx.moveTo(ax - 6, -5); ctx.lineTo(ax, 0); ctx.lineTo(ax - 6, 5);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** 鞭扫残影：环形扇区渐变填充（与鞭体同为 35%～85% 半径） */
function drawWhipSweepFill(
  ctx: CanvasRenderingContext2D,
  fromAng: number,
  toAng: number,
  reach: number,
  alpha: number,
) {
  let sweep = toAng - fromAng;
  while (sweep <= 0) sweep += Math.PI * 2;
  if (sweep < 0.05 || alpha <= 0.02) return;
  const r0 = reach * 0.35;
  const r1 = reach * 0.85;
  const slices = Math.max(8, Math.ceil(sweep / 0.2));
  for (let i = 0; i < slices; i++) {
    const t0 = i / slices;
    const t1 = (i + 1) / slices;
    const a0 = fromAng + sweep * t0;
    const a1 = fromAng + sweep * t1;
    const along = (t0 + t1) * 0.5;
    ctx.globalAlpha = alpha * (0.1 + 0.32 * along);
    const grad = ctx.createRadialGradient(0, 0, r0, 0, 0, r1);
    grad.addColorStop(0, 'rgba(145,120,90,0)');
    grad.addColorStop(0.5, 'rgba(130,105,78,0.4)');
    grad.addColorStop(1, 'rgba(110,88,64,0.14)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r1, a0, a1);
    ctx.arc(0, 0, r0, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  }
}

// 弯曲鞭梢：虚线、粗→细、只画外段；tier 越高越粗
function drawCurvedWhip(
  ctx: CanvasRenderingContext2D,
  ang: number,
  reach: number,
  alpha: number,
  side = 1,
  flex = 1,
  tier = 1,
) {
  if (alpha <= 0.02 || reach < 4) return;
  const r0 = reach * 0.35;
  const r1 = reach * 0.85;
  const n = 16;
  const lag = 0.85 * side * (0.65 + 0.5 * flex);
  const belly = 0.45 * side * flex;
  const pts: { x: number; y: number; t: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ease = t * t * (3 - 2 * t);
    const r = r0 + (r1 - r0) * ease;
    const a = ang - lag * t * t + Math.sin(t * Math.PI) * belly * (1 - t * 0.2);
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, t });
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const wScale = Math.max(0.75, reach / (CELL * 1.85));
  const thickMul = 1 + (tier - 1) * 0.22;
  const midW = (2.4 * 0.5 + 0.6) * wScale * thickMul;
  ctx.save();
  // 更虚：短实线 + 长空隙
  ctx.setLineDash([Math.max(2.5, midW * 1.2), Math.max(7, midW * 4.2)]);
  ctx.lineDashOffset = 0;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i <= n; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.globalAlpha = alpha * 0.28;
  ctx.strokeStyle = 'rgba(70,52,38,0.45)';
  ctx.lineWidth = midW * 1.25;
  ctx.stroke();
  for (let i = 0; i < n; i++) {
    const tMid = (pts[i]!.t + pts[i + 1]!.t) / 2;
    const w = (2.4 * (1 - tMid) + 0.6) * wScale * thickMul;
    const shade = 78 + Math.round(tMid * 36);
    ctx.globalAlpha = alpha * (0.5 + 0.28 * (1 - tMid));
    ctx.strokeStyle = `rgb(${shade + 18},${shade + 4},${shade - 6})`;
    ctx.lineWidth = w;
    ctx.setLineDash([Math.max(2.2, w * 1.3), Math.max(6.5, w * 4.5)]);
    ctx.beginPath();
    ctx.moveTo(pts[i]!.x, pts[i]!.y);
    ctx.lineTo(pts[i + 1]!.x, pts[i + 1]!.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/** 弯刀：白刃 + 金护手 + 黑柄 + 金球；沿 +x 出尖、柄在 -x；外凸锋刃在 +y（配合 scale(1,hand) 对齐劈砍前进侧） */
function drawCurvedDao(ctx: CanvasRenderingContext2D, s: number, alpha: number) {
  if (alpha <= 0.02) return;
  const tipX = s * 1.02;
  const guardX = s * 0.1;
  const handleEnd = -s * 0.26;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 白刃：细长略弯；肚子比极细版稍鼓一点；+y 侧外凸锋刃，-y 侧刀背
  ctx.beginPath();
  ctx.moveTo(guardX, -s * 0.032);
  ctx.bezierCurveTo(s * 0.36, -s * 0.045, s * 0.7, -s * 0.055, tipX - s * 0.03, -s * 0.022);
  ctx.quadraticCurveTo(tipX + s * 0.012, 0, tipX - s * 0.01, s * 0.02);
  ctx.bezierCurveTo(s * 0.68, s * 0.145, s * 0.36, s * 0.12, guardX, s * 0.028);
  ctx.closePath();
  ctx.fillStyle = '#f5f7fb';
  ctx.fill();
  ctx.strokeStyle = '#1a1208';
  ctx.lineWidth = Math.max(1.5, s * 0.04);
  ctx.stroke();
  // 刃口高光（锋刃一侧）
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1.0, s * 0.022);
  ctx.beginPath();
  ctx.moveTo(guardX + s * 0.04, s * 0.014);
  ctx.bezierCurveTo(s * 0.4, s * 0.08, s * 0.7, s * 0.09, tipX - s * 0.08, s * 0.025);
  ctx.stroke();

  // 金护手
  ctx.fillStyle = '#e8b84a';
  ctx.strokeStyle = '#8a5a12';
  ctx.lineWidth = 1.2;
  const gw = s * 0.07, gh = s * 0.2;
  roundRect(ctx, guardX - gw * 0.55, -gh / 2, gw, gh, 2);
  ctx.fill();
  ctx.stroke();

  // 黑柄
  ctx.fillStyle = '#1a1208';
  ctx.beginPath();
  ctx.moveTo(handleEnd + s * 0.02, -s * 0.038);
  ctx.lineTo(guardX - gw * 0.35, -s * 0.038);
  ctx.lineTo(guardX - gw * 0.35, s * 0.038);
  ctx.lineTo(handleEnd + s * 0.02, s * 0.038);
  ctx.closePath();
  ctx.fill();
  // 柄缠线
  ctx.strokeStyle = 'rgba(80,60,40,0.7)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const hx = handleEnd + s * 0.07 + i * s * 0.05;
    ctx.beginPath();
    ctx.moveTo(hx, -s * 0.032);
    ctx.lineTo(hx - s * 0.015, s * 0.032);
    ctx.stroke();
  }

  // 金球柄头
  ctx.fillStyle = '#e8b84a';
  ctx.strokeStyle = '#8a5a12';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(handleEnd, 0, s * 0.055, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// 在已 translate 到单位中心、rotate 到 dir 的坐标系里，绘制单个兵器（沿 +x 出招）
function drawWeaponGlyph(ctx: CanvasRenderingContext2D, type: UnitType, s: number, pulse: number, combo: number, tier = 1) {
  ctx.lineCap = 'round';
  switch (type) {
    case 'spear': { // 枪：向前突刺（杆+红缨+枪头）；连击时只收回约 1/4 再刺出，更显连贯有力
      // 普通：reach 在 0.25..0.85 间随 pulse 伸缩（每刺完整收回）
      // 连击(combo>0)：抬高收回下限到 0.70，只回 1/4 就再刺出，配合更快衰减营造密集连刺威力感
      const rest = combo > 0 ? 0.70 : 0.25;
      const reach = s * (rest + (0.85 - rest) * pulse);
      ctx.strokeStyle = '#8a5a2b';
      ctx.lineWidth = Math.max(2, s * 0.07);
      ctx.beginPath(); ctx.moveTo(-s * 0.18, 0); ctx.lineTo(reach, 0); ctx.stroke();
      ctx.strokeStyle = '#c8392b'; // 红缨
      ctx.lineWidth = Math.max(2, s * 0.05);
      ctx.beginPath();
      ctx.moveTo(reach * 0.6, 0); ctx.lineTo(reach * 0.42, -s * 0.1);
      ctx.moveTo(reach * 0.6, 0); ctx.lineTo(reach * 0.42, s * 0.1);
      ctx.stroke();
      ctx.fillStyle = '#d9dde3'; // 枪头
      ctx.beginPath();
      ctx.moveTo(reach + s * 0.12, 0); ctx.lineTo(reach - s * 0.06, -s * 0.08); ctx.lineTo(reach - s * 0.06, s * 0.08);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'cavalry': { // 骑：虚线弯鞭 + 扇区残影；转速由 firePulse 衰减控制（阶越高越快）
      const phase = 1 - pulse;
      const reach = (UNITS.cavalry.rge + TUNING.rangeTolerance) * CELL;
      const fromAng = -Math.PI;
      const tipAng = fromAng + phase * Math.PI * 2;
      const flex = Math.sin(phase * Math.PI);
      const alpha = Math.min(1, pulse * 1.15);
      drawWhipSweepFill(ctx, fromAng, tipAng, reach, alpha * 0.9);
      drawCurvedWhip(ctx, tipAng, reach, alpha, 1, flex, tier);
      break;
    }
    case 'archer': { // 弓：拉弓放箭
      const pull = s * (0.12 + 0.12 * pulse);
      ctx.strokeStyle = '#6a3d1f';
      ctx.lineWidth = Math.max(2, s * 0.055);
      ctx.beginPath(); ctx.arc(-s * 0.06, 0, s * 0.3, -Math.PI * 0.6, Math.PI * 0.6); ctx.stroke();
      const ex = -s * 0.06 + Math.cos(Math.PI * 0.6) * s * 0.3;
      const ey = Math.sin(Math.PI * 0.6) * s * 0.3;
      ctx.strokeStyle = '#e8e0c8';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(ex, -ey); ctx.lineTo(-pull, 0); ctx.lineTo(ex, ey); ctx.stroke();
      const ax = s * (0.2 + 0.5 * pulse); // 箭随 pulse 向前
      ctx.strokeStyle = '#a5773f';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-pull, 0); ctx.lineTo(ax, 0); ctx.stroke();
      ctx.fillStyle = '#d9dde3';
      ctx.beginPath(); ctx.moveTo(ax + s * 0.06, 0); ctx.lineTo(ax - s * 0.04, -s * 0.05); ctx.lineTo(ax - s * 0.04, s * 0.05); ctx.closePath(); ctx.fill();
      break;
    }
    default: { // 刀兵：立绘出招不画刀，弯刀砍击只画在怪物身上（drawFx）
      break;
    }
  }
}

export function draw(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState): void {
  // 背景：优先用当地图生成的场景大图(cover铺满)，叠一层同色系薄纱使网格清晰；无图时回退主题渐变
  const bgKey = `map-${b.map.id}` as Parameters<typeof sprite>[0];
  const bgImg = sprite(bgKey);
  if (bgImg) {
    const scale = Math.max(VIEW_W / bgImg.width, VIEW_H / bgImg.height);
    const dw = bgImg.width * scale;
    const dh = bgImg.height * scale;
    ctx.drawImage(bgImg, (VIEW_W - dw) / 2, (VIEW_H - dh) / 2, dw, dh);
    ctx.fillStyle = 'rgba(240,233,220,0.5)'; // 淡宣纸薄纱：把写实场景压成柔和氛围底，突出扁平格子
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  } else {
    ctx.fillStyle = themeBgGradient(ctx, b.map.theme.bg0, b.map.theme.bg1);
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  drawBoard(ctx, b, ui);
  drawSpawnGate(ctx, b);
  drawSpawnDirectionHints(ctx, b);
  drawTangseng(ctx, b);
  drawMonsters(ctx, b);
  if (b.endless) drawEndlessPanel(ctx, b);
  else drawAiSide(ctx, b);
  drawUnits(ctx, b, ui);
  drawGenerals(ctx, b, ui);
  drawPeachTrees(ctx, b, ui);
  drawFx(ctx, b);
  drawDigFx(ctx, b.digFx);
  drawDigFx(ctx, b.aiDigFx);
  drawBursts(ctx, b);
  drawPeachFloats(ctx, b);
  drawHeroUlt(ctx, b);
  drawAoeBurst(ctx, b);
  drawDanger(ctx, b);
  drawSelection(ctx, b, ui);
  drawHud(ctx, b);
  drawTray(ctx, b, ui);
  drawButtons(ctx, b);
  drawActiveIcons(ctx, b);
  drawPassiveRow(ctx, b);
  drawPauseBtn(ctx, b);
  drawPassivePopup(ctx, b, ui);
  drawActivePopup(ctx, b, ui);
  drawDragGhost(ctx, b, ui);
  drawBanner(ctx, b);
  if (ui.paused) drawPauseOverlay(ctx, b);
}

// —— 候选区（征兵产出，手工拖到棋盘）——
const TRAY_LEFT = 80; // 左侧留给"营"标（与候选槽拉开更大间距）
const TRAY_SLOT = 74; // 候选槽间距（可见槽 ≈ TRAY_SLOT-6 = 68，与地图格子同宽）
export function trayIndexAt(x: number, y: number): number | null {
  if (y < TRAY_Y || y > TRAY_Y + TRAY_H) return null;
  const i = Math.floor((x - TRAY_LEFT) / TRAY_SLOT);
  if (i < 0 || i >= TUNING.traySize) return null;
  return i;
}
function traySlotCenter(i: number): { x: number; y: number } {
  return { x: TRAY_LEFT + i * TRAY_SLOT + TRAY_SLOT / 2, y: TRAY_Y + TRAY_H / 2 };
}
function drawTrayToken(ctx: CanvasRenderingContext2D, token: TrayToken, x: number, y: number, s: number) {
  if (token.kind === 'shovel') {
    roundRect(ctx, x - s / 2, y - s / 2, s, s, 10);
    ctx.fillStyle = '#e0b24a';
    ctx.fill();
    const spr = sprite('item-shovel');
    if (spr) {
      // Seedream 生成的透明 PNG 铲子图标
      const box = s * 0.86;
      const scale = Math.min(box / spr.width, box / spr.height);
      ctx.drawImage(spr, x - (spr.width * scale) / 2, y - (spr.height * scale) / 2, spr.width * scale, spr.height * scale);
    } else {
      // 素材未加载完成时用汉字「铲」兜底
      ctx.fillStyle = '#5a3a08';
      ctx.font = `bold ${Math.round(s * 0.5)}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('铲', x, y);
    }
  } else if (token.kind === 'word') {
    drawWordTile(ctx, token.char, token.tier, x, y, s);
  } else {
    // 立绘尺寸与地图上单位保持一致(同用 CELL*0.72)，避免 tray 里显得更大
    drawUnit(ctx, token.type, token.tier, x, y, CELL * 0.72);
  }
}

// 武将字牌：未激活用金黄墨字；双字合成激活后按品质色填字，并随阶数加粗加大。
// qualityTier>0 表示已激活武将整体阶（白绿蓝紫橙），驱动颜色与笔画粗细。
function drawWordTile(
  ctx: CanvasRenderingContext2D,
  char: string,
  tier: number,
  x: number,
  y: number,
  s: number,
  showTier = true,
  qualityTier = 0,
) {
  const active = qualityTier > 0;
  const q = active ? Math.max(1, Math.min(MAX_TIER, qualityTier)) : 1;
  // 激活后随阶略放大字号；描边加粗让字形「越升越沉」
  const fontScale = active ? 0.58 + (q - 1) * 0.04 : 0.62;
  const strokeW = active
    ? Math.max(2.8, s * (0.065 + (q - 1) * 0.022))
    : Math.max(2.5, s * 0.07);
  ctx.font = `bold ${Math.round(s * fontScale)}px "PingFang SC", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = strokeW;
  ctx.lineJoin = 'round';
  const ty = y + s * 0.02;
  if (active) {
    // 深描边保可读；填充用品质色（白/绿/蓝/紫/橙）
    ctx.strokeStyle = '#2a2014';
    ctx.strokeText(char, x, ty);
    // 高阶再叠一层略偏外的描边，视觉更「粗」
    if (q >= 3) {
      ctx.lineWidth = strokeW * 0.45;
      ctx.strokeStyle = qualityColor(q);
      ctx.globalAlpha = 0.35;
      ctx.strokeText(char, x, ty);
      ctx.globalAlpha = 1;
      ctx.lineWidth = strokeW;
    }
    ctx.fillStyle = qualityColor(q);
    ctx.fillText(char, x, ty);
  } else {
    // 未激活：金黄字 + 深棕描边
    ctx.strokeStyle = '#5a3a08';
    ctx.strokeText(char, x, ty);
    ctx.fillStyle = '#f2b414';
    ctx.fillText(char, x, ty);
  }
  // 阶数徽标（合成为激活武将时由 showTier=false 隐藏，改由武将整体阶数在右上角显示）
  if (showTier) {
    drawTierBadge(ctx, x + s * 0.42, y - s * 0.36, tier, Math.round(s * 0.3));
  }
}
// 营帐屋顶开合角度(弧度，0=闭合)：征兵时(summonAnimT 从 0 起)先逆时针掀开到 90°(竖起)，保持至丝带飞完，再顺时针合上。
function campRoofAngle(t: number): number {
  // 与下方丝带左→右错开伸出对齐：末槽约 0.26s 才满长，屋顶稍晚再合
  const OPEN_END = 0.05, HOLD_END = 0.32, CLOSE_END = 0.4, MAX = Math.PI / 2;
  if (t >= CLOSE_END) return 0; // 已合上(含 idle t=999)
  if (t < OPEN_END) return MAX * (t / OPEN_END); // 开：0→90°
  if (t < HOLD_END) return MAX; // 全开保持(令牌丝带飞入)
  return MAX * (1 - (t - HOLD_END) / (CLOSE_END - HOLD_END)); // 合：90°→0
}
function drawTray(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  // 营帐：棕色屋身(带「营」字) + 红色屋顶(左侧铰链，征兵时逆时针掀开至90°再合上)。手绘，无底板 bar。
  const campX = 12, campY = TRAY_Y + 4, campW = 48, campH = TRAY_H - 8;
  const roofH = 16; // 屋顶高
  const BODY_SHRINK = 6; // 棕色屋身减矮量
  const bodyH0 = campH - roofH - BODY_SHRINK;
  const bodyH = bodyH0 * 0.75; // 棕色高度再调低 1/4
  // 屋身+屋顶整体在营帐框内垂直居中（屋顶叠在屋身顶沿上方）
  const stackH = bodyH + roofH;
  const stackTop = campY + (campH - stackH) / 2;
  const bodyY = stackTop + roofH; // 屋身顶沿 = 屋顶铰链；屋顶向上画 roofH
  // —— 屋身（棕色木屋身 + 「营」字）——
  const wood = ctx.createLinearGradient(0, bodyY, 0, bodyY + bodyH);
  wood.addColorStop(0, '#8a5626');
  wood.addColorStop(1, '#6d431d');
  ctx.fillStyle = wood;
  roundRect(ctx, campX, bodyY, campW, bodyH, 5);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#4f3115';
  ctx.stroke();
  ctx.fillStyle = '#fff2d8';
  ctx.font = 'bold 22px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('营', campX + campW / 2, bodyY + bodyH / 2 + 1);
  // —— 屋顶（手绘红顶，以底左角为铰链，逆时针=负角）——
  const roofAng = campRoofAngle(b.summonAnimT);
  ctx.save();
  ctx.translate(campX, bodyY);
  ctx.rotate(-roofAng);
  // 梯形屋顶：檐口(底)最宽并向两侧外挑(比屋身宽)，屋脊(顶)略内收
  const EAVE = 6; // 屋檐外挑量(比屋身两侧各宽出)
  const RIDGE_INSET = 6; // 屋脊比檐口内收
  ctx.beginPath();
  ctx.moveTo(-EAVE, 0);
  ctx.lineTo(campW + EAVE, 0);
  ctx.lineTo(campW - RIDGE_INSET, -roofH);
  ctx.lineTo(RIDGE_INSET, -roofH);
  ctx.closePath();
  const roofGrad = ctx.createLinearGradient(0, -roofH, 0, 0);
  roofGrad.addColorStop(0, '#c0402f');
  roofGrad.addColorStop(1, '#9a2f22');
  ctx.fillStyle = roofGrad;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#6f1f16';
  ctx.stroke();
  // 瓦垄：几条竖向瓦线(屋脊→檐口)
  ctx.strokeStyle = 'rgba(90,20,15,0.5)';
  ctx.lineWidth = 1;
  const TILES = 5;
  for (let k = 1; k < TILES; k++) {
    const f = k / TILES;
    const topX = RIDGE_INSET + (campW - 2 * RIDGE_INSET) * f;
    const botX = -EAVE + (campW + 2 * EAVE) * f;
    ctx.beginPath();
    ctx.moveTo(topX, -roofH + 2);
    ctx.lineTo(botX, -1);
    ctx.stroke();
  }
  // 屋脊高光
  ctx.strokeStyle = 'rgba(255,220,180,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(RIDGE_INSET, -roofH + 2); ctx.lineTo(campW - RIDGE_INSET, -roofH + 2);
  ctx.stroke();
  ctx.restore();
  // 5 个候选槽：丝带从「营」左→右错开伸出，短暂满长后从营端收回，再出图标
  const EXTEND_STAGGER = 0.045; // 相邻槽伸出起点延迟（左→右）
  const EXTEND_DUR = 0.08;
  const HOLD = 0.03;
  const RETRACT_DUR = 0.09;
  for (let i = 0; i < TUNING.traySize; i++) {
    const cx = TRAY_LEFT + i * TRAY_SLOT;
    // 木框凹槽（内凹口袋）：上暗下亮内凹渐变 + 深色描边 + 顶部内阴影
    const sx = cx + 3, sy = TRAY_Y + 5, sw = TRAY_SLOT - 6, sh = TRAY_H - 10;
    const slot = ctx.createLinearGradient(0, sy, 0, sy + sh);
    slot.addColorStop(0, '#c3ac80');
    slot.addColorStop(0.5, '#d3c096');
    slot.addColorStop(1, '#ddcfac');
    ctx.fillStyle = slot;
    roundRect(ctx, sx, sy, sw, sh, 8);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#9a7c4c';
    ctx.stroke();
    // 顶部内阴影(凹陷感)
    ctx.save();
    roundRect(ctx, sx, sy, sw, sh, 8);
    ctx.clip();
    ctx.strokeStyle = 'rgba(90,60,25,0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx + 2, sy + 2); ctx.lineTo(sx + sw - 2, sy + 2);
    ctx.stroke();
    ctx.restore();
    // 空槽虚线提示「待放置」
    if (!b.tray[i]) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(120,95,55,0.45)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, sx + 6, sy + 6, sw - 12, sh - 12, 6);
      ctx.stroke();
      ctx.restore();
    }
    const token = b.tray[i];
    if (token && ui.dragTrayIndex !== i) {
      const c = traySlotCenter(i);
      const extendAt = i * EXTEND_STAGGER;
      const fullAt = extendAt + EXTEND_DUR;
      const retractAt = fullAt + HOLD;
      const t = b.summonAnimT;
      if (t < extendAt) {
        // 尚未轮到本槽：不画丝带
      } else if (t < fullAt) {
        const u = (t - extendAt) / EXTEND_DUR; // 0→1 从营伸出
        const ease = 1 - (1 - u) * (1 - u);
        drawSummonRibbon(ctx, token, 0, Math.max(0.04, ease), 0.35 + 0.65 * ease, c, i);
      } else if (t < retractAt) {
        drawSummonRibbon(ctx, token, 0, 1, 1, c, i);
      } else if (t < retractAt + RETRACT_DUR) {
        const u = (t - retractAt) / RETRACT_DUR; // 0→1 从营收向槽
        drawSummonRibbon(ctx, token, u, 1, 1 - u * 0.85, c, i);
      } else {
        const tokenSize = token.kind === 'word' ? CELL * 0.78 : TRAY_H - 16;
        drawTrayToken(ctx, token, c.x, c.y, tokenSize);
      }
    }
  }
}

/** 单条平滑丝带（填充多边形，不是多段描边）：
 * 营端细 → 槽位端粗；透明白 / 英雄淡黄白；弧高按槽位错开。
 * start/end∈[0,1] 为路径裁剪；widthScale 整体变细。
 */
function drawSummonRibbon(
  ctx: CanvasRenderingContext2D,
  token: TrayToken,
  start: number,
  end: number,
  widthScale: number,
  dest: { x: number; y: number },
  slotIndex: number,
) {
  const s0 = Math.max(0, Math.min(0.98, start));
  const s1 = Math.max(s0 + 0.03, Math.min(1, end));
  const srcX = 34;
  const srcY = TRAY_Y + TRAY_H / 2;
  const isHero = token.kind === 'word';
  // 字牌用明显的金黄丝带（与普通兵的透明白区分）；普通兵保持淡白
  const fill = isHero ? 'rgba(255, 200, 48, 0.42)' : 'rgba(255, 255, 255, 0.16)';

  const arcH = 50 + slotIndex * 30 + Math.abs(dest.x - srcX) * 0.05;
  const ease = (t: number) => {
    const apex = 0.5;
    return t < apex ? (t / apex) * 0.42 : 0.42 + ((t - apex) / (1 - apex)) * 0.58;
  };
  const posAt = (t: number) => {
    const tt = Math.max(0, Math.min(1, t));
    const ph = ease(tt);
    return {
      x: srcX + (dest.x - srcX) * tt,
      y: srcY + (dest.y - srcY) * ph - 4 * ph * (1 - ph) * arcH,
    };
  };
  // 半宽：营端极细，槽位端更粗
  const halfW = (t: number) => (1.2 + 9 * Math.pow(t, 1.3)) * Math.max(0.08, widthScale);

  const n = Math.max(10, Math.floor(36 * (s1 - s0)));
  const center: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    center.push(posAt(s0 + (i / n) * (s1 - s0)));
  }

  // 左右轮廓：沿切线法向偏移，拼成一条丝带多边形
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i < center.length; i++) {
    const p = center[i]!;
    const prev = center[Math.max(0, i - 1)]!;
    const next = center[Math.min(center.length - 1, i + 1)]!;
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const nx = -ty;
    const ny = tx;
    const t = s0 + (i / n) * (s1 - s0);
    const w = halfW(t);
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  }

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left[0]!.x, left[0]!.y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i]!.x, left[i]!.y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i]!.x, right[i]!.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  // 描边：字牌用较明显的金边强化"黄色丝带"观感；普通兵保持极淡白边
  ctx.strokeStyle = isHero ? 'rgba(255,198,60,0.38)' : 'rgba(255,255,255,0.07)';
  ctx.lineWidth = isHero ? 1.5 : 1;
  ctx.stroke();
  ctx.restore();
}

function drawBoard(ctx: CanvasRenderingContext2D, b: Battle, _ui: UiState) {
  const unlocked = new Set(b.unlockedCells().map((c) => `${c.c},${c.r}`));
  const aiUnlocked = b.aiUnlocked;
  const th = b.map.theme;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = BOARD_X + c * CELL;
      const y = BOARD_Y + r * CELL;
      // 玩家路径 ∪ AI 镜像路径（白骨岭台阶路跨半场时也能画全）
      const onPath = isEitherPathCell(b.map, c, r);
      const inPlayer = isPlayerCell(b.map, c, r);
      const cellOpen = inPlayer ? unlocked.has(`${c},${r}`) : !onPath && aiUnlocked.has(`${c},${r}`);
      const ix = x, iy = y, iw = CELL, ih = CELL; // 紧凑：格子铺满、相邻边贴合无空白
      if (onPath) {
        // 路径格：半透明浅色走道——透出下方背景图，仍明显比未开垦深色地更亮
        roundRect(ctx, ix, iy, iw, ih, 2);
        ctx.save();
        ctx.globalAlpha = 0.5; // 路面半透明，透出背景
        ctx.fillStyle = th.cellUnlocked;
        ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = th.path;
        ctx.fill();
        ctx.restore();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(90,72,42,0.4)';
        ctx.stroke();
      } else if (cellOpen) {
        drawUnlockedCellFace(ctx, ix, iy, iw, ih, c, r, th.cellUnlocked);
      } else {
        // 不可放置格（未开垦）：主题深色调 + 强压深棕 → 全图最暗档，与浅色路径拉开对比
        roundRect(ctx, ix, iy, iw, ih, 2);
        ctx.fillStyle = th.cellLocked;
        ctx.fill();
        ctx.fillStyle = 'rgba(28,20,10,0.34)';
        ctx.fill();
        // 内边阴影
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(40,45,35,0.28)';
        ctx.lineWidth = 3;
        roundRect(ctx, ix + 1, iy + 1, iw - 2, ih - 2, 2); ctx.stroke();
        // 细点纹理（确定性散点，随格坐标变化）
        ctx.fillStyle = 'rgba(50,55,42,0.28)';
        for (let k = 0; k < 5; k++) {
          const px = ix + 8 + ((c * 37 + r * 53 + k * 29) % (iw - 16));
          const py = iy + 8 + ((c * 17 + r * 71 + k * 41) % (ih - 16));
          ctx.beginPath(); ctx.arc(px, py, 1.3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(40,36,30,0.3)';
        roundRect(ctx, ix, iy, iw, ih, 2); ctx.stroke();
      }
    }
  }
  drawPathDiggableBorders(ctx, b);
  drawBoardOuterBorder(ctx);
  drawBorderMotif(ctx, b);
  drawFence(ctx, b);
}

// 棋盘最外缘黑色加粗框，把整图包起来
function drawBoardOuterBorder(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.strokeStyle = 'rgba(20,18,14,0.92)';
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.strokeRect(BOARD_X, BOARD_Y, COLS * CELL, ROWS * CELL);
  ctx.restore();
}

// 「路径格 ↔ 可挖格」交界画黑色加粗线（含未解锁的可挖格；不含路径彼此之间）
function drawPathDiggableBorders(ctx: CanvasRenderingContext2D, b: Battle) {
  // 可挖：非路径的棋盘格（我方半场未开格子 + AI 半场对应格）
  const isDiggable = (c: number, r: number): boolean => {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    return !isEitherPathCell(b.map, c, r);
  };
  const edges = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const key = `${Math.min(x0, x1)},${Math.min(y0, y1)},${Math.max(x0, x1)},${Math.max(y0, y1)}`;
    edges.set(key, { x0, y0, x1, y1 });
  };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isEitherPathCell(b.map, c, r)) continue;
      if (isDiggable(c, r - 1)) {
        const y = BOARD_Y + r * CELL;
        add(BOARD_X + c * CELL, y, BOARD_X + (c + 1) * CELL, y);
      }
      if (isDiggable(c + 1, r)) {
        const x = BOARD_X + (c + 1) * CELL;
        add(x, BOARD_Y + r * CELL, x, BOARD_Y + (r + 1) * CELL);
      }
      if (isDiggable(c, r + 1)) {
        const y = BOARD_Y + (r + 1) * CELL;
        add(BOARD_X + c * CELL, y, BOARD_X + (c + 1) * CELL, y);
      }
      if (isDiggable(c - 1, r)) {
        const x = BOARD_X + c * CELL;
        add(x, BOARD_Y + r * CELL, x, BOARD_Y + (r + 1) * CELL);
      }
    }
  }
  if (edges.size === 0) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(20,18,14,0.92)';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  for (const e of edges.values()) {
    ctx.beginPath();
    ctx.moveTo(e.x0, e.y0);
    ctx.lineTo(e.x1, e.y1);
    ctx.stroke();
  }
  ctx.restore();
}

// 棋盘四周的地图专属边界装饰（不同地图不同风格）
function drawBorderMotif(ctx: CanvasRenderingContext2D, b: Battle) {
  const left = BOARD_X, right = BOARD_X + CELL * COLS, top = BOARD_Y, bot = BOARD_Y + CELL * ROWS;
  ctx.save();
  const id = b.map.id;
  // 单元装饰：在 (cx,cy) 处按边法线方向 nx,ny 画一枚地图专属图元
  const motif = (cx: number, cy: number, nx: number, ny: number) => {
    const s = CELL * 0.34;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(ny, nx) + Math.PI / 2);
    if (id === 'huoyanshan') {
      // 火焰尖
      ctx.fillStyle = 'rgba(150,54,30,0.6)';
      ctx.beginPath(); ctx.moveTo(-s * 0.6, 0); ctx.quadraticCurveTo(-s * 0.1, -s, 0, -s * 1.3); ctx.quadraticCurveTo(s * 0.1, -s, s * 0.6, 0); ctx.closePath(); ctx.fill();
    } else if (id === 'liushahe') {
      // 沙丘
      ctx.fillStyle = 'rgba(150,120,60,0.5)';
      ctx.beginPath(); ctx.moveTo(-s, 0); ctx.quadraticCurveTo(-s * 0.3, -s * 0.8, s * 0.2, -s * 0.4); ctx.quadraticCurveTo(s * 0.6, -s * 0.1, s, 0); ctx.closePath(); ctx.fill();
    } else if (id === 'baiguling') {
      // 枯骨尖刺
      ctx.fillStyle = 'rgba(90,96,80,0.6)';
      ctx.beginPath(); ctx.moveTo(-s * 0.4, 0); ctx.lineTo(0, -s * 1.2); ctx.lineTo(s * 0.4, 0); ctx.closePath(); ctx.fill();
    } else {
      // 盘丝洞：云/蛛丝弧
      ctx.strokeStyle = 'rgba(150,90,130,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.7, Math.PI, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -s * 0.2, s * 0.4, Math.PI, 0); ctx.stroke();
    }
    ctx.restore();
  };
  for (let c = 0; c < COLS; c++) {
    const x = BOARD_X + c * CELL + CELL / 2;
    motif(x, top - 2, 0, -1);
    motif(x, bot + 2, 0, 1);
  }
  for (let r = 0; r < ROWS; r++) {
    const y = BOARD_Y + r * CELL + CELL / 2;
    motif(left - 2, y, -1, 0);
    motif(right + 2, y, 1, 0);
  }
  ctx.restore();
}

// 出怪口：地图专属"闸门/云朵"随出怪开合。gateT 0.5→0 期间做 开→合 动画。
function drawSpawnGate(ctx: CanvasRenderingContext2D, b: Battle) {
  const entrance = (path: { c: number; r: number }[]) => {
    for (const p of path) if (p.c >= 0 && p.c < COLS && p.r >= 0 && p.r < ROWS) return p;
    return path[0]!;
  };
  drawGateAt(ctx, entrance(b.map.path), b.spawnGateT, b.map.id);
  // 无尽模式无 AI 对手，AI 半场不出怪，跳过其出怪口（不做张合/不绘制）
  if (!b.aiDefeated && !b.endless) drawGateAt(ctx, entrance(b.aiPath), b.aiSpawnGateT, b.map.id);
}

function drawGateAt(ctx: CanvasRenderingContext2D, cell: { c: number; r: number }, gateT: number, id: string) {
  const { x, y } = cellCenterPx(cell.c, cell.r);
  const open = gateT > 0 ? Math.sin(Math.PI * (1 - gateT / 0.5)) : 0; // 0→1→0
  const off = open * CELL * 0.34;
  ctx.save();
  if (id === 'pansidong') {
    // 盘丝洞：两扇蛛网；gateT=0 时合拢成整网，出怪时左右拉开
    drawPansidongWebGate(ctx, x - off, y, -1);
    drawPansidongWebGate(ctx, x + off, y, 1);
  } else if (id === 'baiguling') {
    // 白骨岭：两座白骨门柱左右开合（骨节堆 + 顶颅）
    drawBaigulingGateLeaf(ctx, x - off - CELL * 0.22, y, -1);
    drawBaigulingGateLeaf(ctx, x + off + CELL * 0.22, y, 1);
  } else if (id === 'huoyanshan') {
    // 火焰山：两柱火焰门，默认合拢，出怪时左右分开
    drawHuoyanshanFlameGate(ctx, x - off, y, -1);
    drawHuoyanshanFlameGate(ctx, x + off, y, 1);
  } else if (id === 'liushahe') {
    // 流沙河：砂石闸门贴图左右半扇开合
    drawLiushaheSandGate(ctx, x, y, off);
  } else {
    // 兜底：两扇素色闸门
    const w = CELL * 0.4, h = CELL * 0.52;
    const leaf = (lx: number) => {
      roundRect(ctx, lx, y - h / 2, w, h, 5);
      ctx.fillStyle = 'rgba(150,124,70,0.85)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(30,26,20,0.7)';
      ctx.stroke();
    };
    leaf(x - off - w);
    leaf(x + off);
  }
  ctx.restore();
}

/** 流沙河出怪口：Seedream 砂石闸门左右对开 */
function drawLiushaheSandGate(ctx: CanvasRenderingContext2D, x: number, y: number, off: number) {
  const spr = sprite('gate-liushahe');
  const h = CELL * 0.72;
  const w = CELL * 0.78;
  if (!spr || !spr.width) {
    const lw = CELL * 0.42, lh = CELL * 0.55;
    const leaf = (lx: number) => {
      roundRect(ctx, lx, y - lh / 2, lw, lh, 5);
      ctx.fillStyle = 'rgba(196,158,92,0.9)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(90,60,30,0.75)';
      ctx.stroke();
    };
    leaf(x - off - lw);
    leaf(x + off);
    return;
  }
  const half = w / 2;
  // 左半扇 / 右半扇：从贴图中线切开，随 off 左右拉开
  ctx.drawImage(spr, 0, 0, spr.width / 2, spr.height, x - half - off, y - h / 2, half, h);
  ctx.drawImage(spr, spr.width / 2, 0, spr.width / 2, spr.height, x + off, y - h / 2, half, h);
}

/** 出怪指引：从路径「出口后第 2 个在网格内的点」起画，避免与闸门重叠 */
function pathEntranceDir(path: { c: number; r: number }[]): { c: number; r: number; dc: number; dr: number } | null {
  let firstInGrid = -1;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (p.c >= 0 && p.c < COLS && p.r >= 0 && p.r < ROWS) {
      firstInGrid = i;
      break;
    }
  }
  if (firstInGrid < 0) return null;
  // 第 2 格：出口下一格；若路径过短则退回出口格
  const startIdx = firstInGrid + 1 < path.length ? firstInGrid + 1 : firstInGrid;
  const p = path[startIdx]!;
  const next = path[startIdx + 1];
  if (!next) {
    // 已是末点：用「上一格→本格」方向兜底
    const prev = path[startIdx - 1];
    if (!prev) return { c: p.c, r: p.r, dc: 1, dr: 0 };
    const len = Math.hypot(p.c - prev.c, p.r - prev.r) || 1;
    return { c: p.c, r: p.r, dc: (p.c - prev.c) / len, dr: (p.r - prev.r) / len };
  }
  const len = Math.hypot(next.c - p.c, next.r - p.r) || 1;
  return { c: p.c, r: p.r, dc: (next.c - p.c) / len, dr: (next.r - p.r) / len };
}

// 开局唐僧归位前：三箭头接力循环——半透明自格边出现 → 前移变实 → 下一箭在起点接力
function drawSpawnDirectionHints(ctx: CanvasRenderingContext2D, b: Battle) {
  if (b.introDone) return;
  if (b.status !== 'ready' && b.status !== 'playing') return;
  const drawOn = (path: { c: number; r: number }[]) => {
    const info = pathEntranceDir(path);
    if (!info) return;
    const { x: cx, y: cy } = cellCenterPx(info.c, info.r);
    // 起点：第 2 格朝向出口的那条边（中心沿反方向退半格），避免压闸门
    const sx = cx - info.dc * CELL * 0.5;
    const sy = cy - info.dr * CELL * 0.5;
    const travel = CELL * 1.7; // 单箭行程（约两格），三箭相位差 1/3 形成接力
    const period = 2.5; // 秒：一箭从出现到淡出
    const t = performance.now() / 1000 / period;
    const size = CELL * 0.48;
    ctx.save();
    for (let i = 0; i < 3; i++) {
      // i=0 领先；每隔 1/3 周期下一箭在起点半透明出现
      const phase = ((t - i / 3) % 1 + 1) % 1;
      const along = phase * travel;
      const ax = sx + info.dc * along;
      const ay = sy + info.dr * along;
      // 半透明出场 → 前移变实 → 末端淡出，循环无缝
      let alpha: number;
      if (phase < 0.28) alpha = 0.4 + (phase / 0.28) * 0.55;
      else if (phase < 0.72) alpha = 0.95;
      else alpha = 0.95 * (1 - (phase - 0.72) / 0.28);
      if (alpha < 0.04) continue;
      ctx.globalAlpha = alpha;
      drawPathChevron(ctx, ax, ay, Math.atan2(info.dr, info.dc), size, alpha > 0.7);
    }
    ctx.restore();
  };
  drawOn(b.map.path);
  if (!b.aiDefeated && !b.endless) drawOn(b.aiPath);
}

/** 半格大小的空心箭头（> 形），沿 ang 朝向；lit 时加亮描边与光晕 */
function drawPathChevron(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, size: number, lit: boolean) {
  const arm = size * 0.42;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = lit ? '#ffe27a' : '#e8c878';
  ctx.lineWidth = lit ? 4.5 : 3.2;
  ctx.shadowColor = lit ? 'rgba(255, 210, 80, 0.85)' : 'transparent';
  ctx.shadowBlur = lit ? 8 : 0;
  ctx.beginPath();
  ctx.moveTo(-arm * 0.35, -arm);
  ctx.lineTo(arm * 0.55, 0);
  ctx.lineTo(-arm * 0.35, arm);
  ctx.stroke();
  ctx.restore();
}

// 火焰山出怪口：半边火焰门柱（合拢时拼成火门，出怪时分开）
function drawHuoyanshanFlameGate(ctx: CanvasRenderingContext2D, cx: number, cy: number, side: -1 | 1) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(side, 1);
  const h = CELL * 0.55;
  const w = CELL * 0.28;
  // 炽热门框
  ctx.fillStyle = 'rgba(80,30,18,0.85)';
  ctx.strokeStyle = 'rgba(40,16,10,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(w, -h / 2 + 4);
  ctx.lineTo(w * 0.85, h / 2);
  ctx.lineTo(0, h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 外焰
  const flame = (ox: number, baseY: number, fh: number, fw: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ox, baseY);
    ctx.quadraticCurveTo(ox + fw * 0.15, baseY - fh * 0.45, ox + fw * 0.05, baseY - fh);
    ctx.quadraticCurveTo(ox + fw * 0.55, baseY - fh * 0.55, ox + fw, baseY - fh * 0.15);
    ctx.quadraticCurveTo(ox + fw * 0.45, baseY - fh * 0.05, ox, baseY);
    ctx.closePath();
    ctx.fill();
  };
  flame(2, h * 0.15, h * 0.85, w * 0.9, 'rgba(220,70,30,0.92)');
  flame(4, h * 0.2, h * 0.65, w * 0.55, 'rgba(255,150,40,0.95)');
  flame(6, h * 0.22, h * 0.42, w * 0.32, 'rgba(255,230,120,0.98)');
  ctx.restore();
}

// 盘丝洞出怪口：半圆形蛛网扇叶（开合时左右分开）
function drawPansidongWebGate(ctx: CanvasRenderingContext2D, cx: number, cy: number, side: -1 | 1) {
  const R = CELL * 0.38;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(side, 1);
  // 半圆底
  ctx.fillStyle = 'rgba(80,45,75,0.35)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  // 放射丝
  ctx.strokeStyle = 'rgba(245,225,240,0.95)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 4) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    ctx.stroke();
  }
  // 同心弧网
  ctx.strokeStyle = 'rgba(220,180,210,0.9)';
  ctx.lineWidth = 1.6;
  for (const rr of [R * 0.35, R * 0.6, R * 0.85]) {
    ctx.beginPath();
    ctx.arc(0, 0, rr, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  }
  // 外框加粗，更易辨认
  ctx.strokeStyle = 'rgba(160,90,150,0.95)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  // 蛛丝锚点
  ctx.fillStyle = 'rgba(245,230,240,0.95)';
  ctx.strokeStyle = 'rgba(120,60,110,0.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// 白骨岭出怪闸口的一侧门柱：交错骨节立柱 + 顶上小颅骨
function drawBaigulingGateLeaf(ctx: CanvasRenderingContext2D, cx: number, cy: number, side: -1 | 1) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#efe6d8';
  ctx.strokeStyle = 'rgba(40,36,30,0.85)';
  ctx.lineWidth = 1.7;
  const bone = (bx: number, by: number, w: number, h: number, rot: number) => {
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-w * 0.85, 0, h * 0.95, 0, Math.PI * 2);
    ctx.arc(w * 0.85, 0, h * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  // 立柱：竖向叠骨
  bone(side * 2, CELL * 0.14, CELL * 0.14, CELL * 0.04, Math.PI / 2 + side * 0.08);
  bone(side * -1, CELL * 0.02, CELL * 0.13, CELL * 0.038, Math.PI / 2 - side * 0.12);
  bone(side * 3, -CELL * 0.1, CELL * 0.12, CELL * 0.036, Math.PI / 2 + side * 0.05);
  // 斜撑交叉骨
  bone(side * 4, CELL * 0.06, CELL * 0.11, CELL * 0.032, side * 0.7);
  bone(side * -3, -CELL * 0.02, CELL * 0.1, CELL * 0.03, -side * 0.65);
  // 顶颅
  ctx.beginPath();
  ctx.arc(0, -CELL * 0.22, CELL * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(40,36,30,0.85)';
  ctx.beginPath();
  ctx.arc(-CELL * 0.035, -CELL * 0.23, CELL * 0.022, 0, Math.PI * 2);
  ctx.arc(CELL * 0.035, -CELL * 0.23, CELL * 0.022, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 中间栅栏：默认水平木栅栏（fenceGaps 开口）；白骨岭白骨堆；流沙河/盘丝洞用可平铺贴图
function drawFence(ctx: CanvasRenderingContext2D, b: Battle) {
  if (b.map.id === 'baiguling') {
    drawBaigulingBoneFence(ctx);
    return;
  }
  if (b.map.id === 'pansidong') {
    drawPansidongSilkFence(ctx, b);
    return;
  }
  if (b.map.id === 'liushahe') {
    drawLiushaheWaterFence(ctx, b);
    return;
  }
  const y = BOARD_Y + FENCE_ROW * CELL; // 玩家半场顶边 = 栅栏线
  const gaps = new Set(b.map.fenceGaps);
  ctx.save();
  for (let c = 0; c < COLS; c++) {
    if (gaps.has(c)) continue; // 开口
    const x = BOARD_X + c * CELL;
    // 木栅栏段
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(x + 3, y - 5, CELL - 6, 10);
    ctx.fillStyle = '#6f5228';
    ctx.fillRect(x + 3, y - 5, CELL - 6, 3);
    // 立柱
    ctx.fillStyle = '#5f4520';
    ctx.fillRect(x + CELL / 2 - 3, y - 12, 6, 24);
  }
  ctx.restore();
}

// 流沙河：Seedream 河沙水带横向无缝平铺，严格隔断上下半场
function drawLiushaheWaterFence(ctx: CanvasRenderingContext2D, _b: Battle) {
  const y = BOARD_Y + FENCE_ROW * CELL;
  drawTiledHFence(ctx, 'fence-liushahe', y, CELL * 0.26, () => {
    ctx.fillStyle = 'rgba(180,150,70,0.9)';
    ctx.fillRect(BOARD_X, y - CELL * 0.08, COLS * CELL, CELL * 0.16);
  });
}

// 盘丝洞：Seedream 蛛丝篱笆横向无缝平铺
function drawPansidongSilkFence(ctx: CanvasRenderingContext2D, b: Battle) {
  const y = BOARD_Y + FENCE_ROW * CELL;
  drawTiledHFence(ctx, 'fence-pansidong', y, CELL * 0.24, () => {
    // 素材未就绪时回退：丝线篱笆矢量
    const x0 = BOARD_X;
    const x1 = BOARD_X + COLS * CELL;
    const accent = b.map.theme.accent;
    ctx.save();
    ctx.strokeStyle = 'rgba(120,70,110,0.35)';
    ctx.lineWidth = CELL * 0.28;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    for (const dy of [-3, 0, 3]) {
      ctx.strokeStyle = dy === 0 ? 'rgba(240,220,235,0.9)' : 'rgba(200,160,190,0.55)';
      ctx.lineWidth = dy === 0 ? 2.2 : 1.2;
      ctx.beginPath();
      for (let i = 0; i <= COLS * 4; i++) {
        const t = i / (COLS * 4);
        const x = x0 + (x1 - x0) * t;
        const wave = Math.sin(t * Math.PI * 8 + dy) * 2.2;
        if (i === 0) ctx.moveTo(x, y + dy + wave);
        else ctx.lineTo(x, y + dy + wave);
      }
      ctx.stroke();
    }
    for (let c = 0; c < COLS; c++) {
      const cx = BOARD_X + c * CELL + CELL / 2;
      ctx.strokeStyle = 'rgba(230,200,220,0.75)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - 10, y - 9);
      ctx.lineTo(cx + 10, y + 9);
      ctx.moveTo(cx + 10, y - 9);
      ctx.lineTo(cx - 10, y + 9);
      ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, y, 4.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  });
}

/** 横向栅栏条：优先整条拉伸铺满（宽幅 Seedream 条更稳），必要时再循环平铺 */
function drawTiledHFence(
  ctx: CanvasRenderingContext2D,
  key: 'fence-liushahe' | 'fence-pansidong',
  y: number,
  drawH: number,
  fallback: () => void,
) {
  const spr = sprite(key);
  if (!spr || !spr.width) {
    fallback();
    return;
  }
  const boardW = COLS * CELL;
  const naturalW = drawH * (spr.width / spr.height);
  ctx.save();
  // 一张就能盖住大半棋盘宽 → 整条拉伸，避免端饰重复
  if (naturalW >= boardW * 0.75) {
    ctx.drawImage(spr, BOARD_X, y - drawH / 2, boardW, drawH);
  } else {
    let x = BOARD_X;
    while (x < BOARD_X + boardW - 0.25) {
      const remain = BOARD_X + boardW - x;
      const w = Math.min(naturalW, remain);
      const srcW = spr.width * (w / naturalW);
      ctx.drawImage(spr, 0, 0, srcW, spr.height, x, y - drawH / 2, w, drawH);
      x += naturalW;
    }
  }
  ctx.restore();
}

// 白骨岭：白骨堆画在台阶分界格线上（左 r=5|6、竖 c=3|4、右 r=3|4），连续无开口
function drawBaigulingBoneFence(ctx: CanvasRenderingContext2D) {
  const yLeft = BOARD_Y + 6 * CELL;
  const yRight = BOARD_Y + 4 * CELL;
  const xStep = BOARD_X + 4 * CELL;
  const x0 = BOARD_X;
  const x1 = BOARD_X + COLS * CELL;
  ctx.save();
  ctx.strokeStyle = 'rgba(45, 42, 36, 0.55)';
  ctx.lineWidth = CELL * 0.38;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, yLeft);
  ctx.lineTo(xStep, yLeft);
  ctx.lineTo(xStep, yRight);
  ctx.lineTo(x1, yRight);
  ctx.stroke();
  const step = CELL * 0.32;
  const segs: { x0: number; y0: number; x1: number; y1: number }[] = [
    { x0, y0: yLeft, x1: xStep, y1: yLeft },
    { x0: xStep, y0: yLeft, x1: xStep, y1: yRight },
    { x0: xStep, y0: yRight, x1, y1: yRight },
  ];
  for (const s of segs) {
    const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    const n = Math.max(2, Math.ceil(len / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      drawBonePileOnLine(
        ctx,
        s.x0 + (s.x1 - s.x0) * t,
        s.y0 + (s.y1 - s.y0) * t,
        Math.atan2(s.y1 - s.y0, s.x1 - s.x0),
        i,
      );
    }
  }
  ctx.restore();
}

// 单簇白骨堆：矢量骨节密叠成墙；精灵仅作偶发点缀（整段图标会不像栅栏）
function drawBonePileOnLine(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, seed: number) {
  const jitter = ((seed * 17) % 7) - 3;
  const nx = Math.cos(ang + Math.PI / 2);
  const ny = Math.sin(ang + Math.PI / 2);
  const px = x + nx * jitter * 0.35;
  const py = y + ny * jitter * 0.35;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(ang);
  ctx.fillStyle = seed % 2 === 0 ? '#f3ebe0' : '#e8dfd0';
  ctx.strokeStyle = 'rgba(40,36,30,0.82)';
  ctx.lineWidth = 1.5;
  const bone = (bx: number, by: number, w: number, h: number, rot: number) => {
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-w * 0.85, 0, h * 0.95, 0, Math.PI * 2);
    ctx.arc(w * 0.85, 0, h * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  // 沿栅栏切向叠 2～3 根骨头 + 顶部小颅，形成矮墙截面
  bone(-CELL * 0.12, 2, CELL * 0.16, CELL * 0.045, -0.2);
  bone(CELL * 0.1, -1, CELL * 0.14, CELL * 0.04, 0.28);
  bone(0, CELL * 0.06, CELL * 0.13, CELL * 0.038, 0.02);
  ctx.beginPath();
  ctx.arc(CELL * 0.02, -CELL * 0.08, CELL * 0.075, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const spr = sprite('fence-baiguling');
  if (spr && seed % 4 === 0) {
    const size = CELL * 0.36;
    const scale = Math.min(size / spr.width, size / spr.height);
    const dw = spr.width * scale;
    const dh = spr.height * scale;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(spr, -dw / 2, -dh * 0.85, dw, dh);
  }
  ctx.restore();
}

function drawPath(ctx: CanvasRenderingContext2D, b: Battle) {
  ctx.save();
  ctx.strokeStyle = b.map.theme.path;
  ctx.lineWidth = CELL * 0.72;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  b.map.path.forEach((p, i) => {
    const { x, y } = cellCenterPx(p.c, p.r);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  // 路面中线（虚线）
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 12]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawTangsengHearts(
  ctx: CanvasRenderingContext2D,
  cx: number,
  headTop: number,
  hp: number,
  defeated = false,
) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (defeated) {
    ctx.fillStyle = '#9a9a9a';
    ctx.font = 'bold 13px "PingFang SC", sans-serif';
    ctx.fillText('已败', cx, headTop - 6);
    return;
  }
  const n = Math.max(0, Math.floor(hp));
  if (n <= 0) return;
  const perRow = 3;
  const fontPx = Math.round(CELL * 0.28 * 0.75); // 再缩小 1/4
  const rowGap = fontPx * 0.95;
  const colGap = fontPx * 0.95;
  ctx.font = `${fontPx}px sans-serif`;
  ctx.fillStyle = '#e03030';
  // 自头顶向上堆叠：先排最靠近头顶的一行（最多 3 心）
  let remaining = n;
  let row = 0;
  while (remaining > 0) {
    const count = Math.min(perRow, remaining);
    const rowY = headTop - 4 - row * rowGap;
    const totalW = (count - 1) * colGap;
    const startX = cx - totalW / 2;
    for (let i = 0; i < count; i++) {
      ctx.fillText('❤', startX + i * colGap, rowY);
    }
    remaining -= count;
    row++;
  }
}

/** 唐僧立绘：无圆形底座；相对原尺寸缩小 1/5；脚底椭圆阴影；头顶按心数画 ❤（每行最多 3） */
function drawTangsengFigure(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  hp: number,
  opts?: { rad?: number; defeated?: boolean },
) {
  const rad = (opts?.rad ?? CELL * 0.46) * 0.8; // 缩小 1/5
  const defeated = opts?.defeated ?? false;
  drawGroundShadow(ctx, x, y + rad * 0.22, rad * 0.72, defeated ? 0.16 : 0.26);
  const spr = sprite('tangseng');
  let headTop = y - rad;
  if (spr) {
    const box = rad * 2;
    const scale = Math.min(box / spr.width, box / spr.height);
    const dw = spr.width * scale;
    const dh = spr.height * scale;
    ctx.drawImage(spr, x - dw / 2, y - dh / 2, dw, dh);
    headTop = y - dh / 2;
  } else {
    ctx.fillStyle = '#5a3a08';
    ctx.font = 'bold 22px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('唐', x, y);
  }
  drawTangsengHearts(ctx, x, headTop, hp, defeated);
}

function drawTangseng(ctx: CanvasRenderingContext2D, b: Battle) {
  const pos = b.tangsengRenderPos();
  const { x, y } = cellCenterPx(pos.c, pos.r);
  drawGroundShadow(ctx, x, y, CELL * 0.28, 0.26);
  drawTangsengFigure(ctx, x, y, b.tangsengHP);
}

// 入场缩放：由小变大略带回弹(easeOutBack)，营造"崩出来"感
function emergeScale(t: number): number {
  const d = 0.38;
  if (t >= d) return 1;
  const p = t / d;
  const c1 = 1.70158, c3 = c1 + 1;
  const ease = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  return 0.2 + 0.8 * ease;
}

// 地面椭圆阴影（怪物/武器/字牌共用：贴脚底、略扁）
function drawGroundShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rad: number,
  alpha = 0.28,
) {
  const shW = Math.max(1, rad * 1.3);
  ctx.save();
  ctx.fillStyle = `rgba(20,16,12,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y + rad * 0.82, shW, rad * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 单个怪物渲染（图标/圆形兜底 + 墨风血条 + 受击闪白 + 技能环 + 入场缩放 + 行走摆动 + 地面阴影）
function drawMonsterAt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rad0: number,
  m: {
    dist: number;
    hp: number;
    maxHp: number;
    isBoss: boolean;
    isMiniBoss?: boolean;
    miniBossKind?: MiniBossKind | null;
    isCavalry?: boolean;
    hitFlash: number;
    skill: unknown;
    castFlash: number;
    spawnT: number;
    stunT?: number;
    slowT?: number;
    hasteT?: number;
    healFlash?: number;
  },
  mapId: string,
  trailDir = 1,
) {
  const rad = rad0 * emergeScale(m.spawnT);
  // 行走摆动：以沿路进度为相位，上下小幅弹跳(踏步感)
  const phase = m.dist * 5.2;
  const bob = Math.abs(Math.sin(phase)) * rad0 * 0.16;
  const cy = y - bob; // 身体上抬
  // 地面阴影（跳起时变小变淡）
  const shW = Math.max(1, rad0 * 1.3 * (1 - bob / (rad0 * 0.5) * 0.35));
  const shA = 0.3 * (1 - bob / (rad0 * 0.5) * 0.5);
  ctx.save();
  ctx.fillStyle = `rgba(20,16,12,${Math.max(0.08, shA)})`;
  ctx.beginPath();
  ctx.ellipse(x, y + rad0 * 0.82, shW, rad0 * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 小 Boss 用 boss 立绘（体型介于精英与妖王之间）；无专属图时回退 minion
  const spr = monsterSprite(mapId, m.isBoss || !!m.isMiniBoss);
  // 骑兵视觉区分：身后拖出青蓝速度线（快速冲锋感）。拖尾始终在移动的反方向：
  // trailDir=+1 表示向右移动→拖尾在左侧；trailDir=-1 表示向左移动→拖尾在右侧。
  if (m.isCavalry) {
    ctx.save();
    ctx.strokeStyle = 'rgba(91,209,255,0.75)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    const side = -trailDir; // 拖尾偏移方向（与移动方向相反）
    const streak = rad0 * (1.4 + 0.4 * Math.abs(Math.sin(phase)));
    for (let i = -1; i <= 1; i++) {
      const ly = cy + i * rad0 * 0.45;
      ctx.globalAlpha = 0.7 - Math.abs(i) * 0.2;
      ctx.beginPath();
      ctx.moveTo(x + side * rad0 * 0.6, ly);
      ctx.lineTo(x + side * (rad0 * 0.6 + streak), ly);
      ctx.stroke();
    }
    ctx.restore();
  }
  // 疾风加速：青绿拖尾（非骑兵）
  if ((m.hasteT ?? 0) > 0 && !m.isCavalry) {
    ctx.save();
    ctx.strokeStyle = 'rgba(125,255,176,0.7)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    const side = -trailDir;
    for (let i = -1; i <= 1; i++) {
      const ly = cy + i * rad0 * 0.35;
      ctx.globalAlpha = 0.55 - Math.abs(i) * 0.15;
      ctx.beginPath();
      ctx.moveTo(x + side * rad0 * 0.5, ly);
      ctx.lineTo(x + side * rad0 * 1.5, ly);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (spr) {
    const box = rad * 2.3;
    const scale = Math.min(box / spr.width, box / spr.height);
    ctx.drawImage(spr, x - (spr.width * scale) / 2, cy - (spr.height * scale) / 2, spr.width * scale, spr.height * scale);
  } else {
    ctx.beginPath();
    ctx.arc(x, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = m.isBoss ? '#b02a5b' : m.isMiniBoss ? '#b05a2a' : '#7a2b2b';
    ctx.fill();
  }
  // 墨风血条：深墨底条 + 朱红填充
  const bw = rad0 * 2;
  const hpPct = Math.max(0, m.hp / m.maxHp);
  const by = y - rad0 - 10;
  ctx.save();
  ctx.strokeStyle = 'rgba(28,24,20,0.85)';
  ctx.lineCap = 'round';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(x - bw / 2, by); ctx.lineTo(x + bw / 2, by); ctx.stroke(); // 墨底
  if (hpPct > 0) {
    ctx.strokeStyle = hpPct > 0.4 ? '#c8402e' : '#8a2418'; // 朱红→暗红
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x - bw / 2 + 1, by); ctx.lineTo(x - bw / 2 + 1 + (bw - 2) * hpPct, by); ctx.stroke();
  }
  ctx.restore();
  // 受击闪白
  if (m.hitFlash > 0) {
    ctx.globalAlpha = Math.min(0.8, m.hitFlash / 0.12);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 治疗绿闪
  if ((m.healFlash ?? 0) > 0) {
    ctx.globalAlpha = Math.min(0.55, (m.healFlash ?? 0) * 0.55);
    ctx.fillStyle = '#7dff8a';
    ctx.beginPath();
    ctx.arc(x, cy, rad + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 精英/BOSS/小 Boss 技能标识：彩色环 + 状态芯片；施法瞬间脉冲光圈
  const miniMeta = m.isMiniBoss && m.miniBossKind ? MINI_BOSS_META[m.miniBossKind] : null;
  const skillMeta = m.skill ? SKILL_META[m.skill as keyof typeof SKILL_META] : null;
  const ringMeta = miniMeta ?? skillMeta;
  if (ringMeta) {
    ctx.save();
    ctx.strokeStyle = ringMeta.color;
    ctx.lineWidth = m.isMiniBoss ? 3 : 2.5;
    ctx.beginPath();
    ctx.arc(x, cy, rad + 3, 0, Math.PI * 2);
    ctx.stroke();
    if (m.isMiniBoss) {
      // 小 Boss 外圈虚线，与妖王实环区分
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(x, cy, rad + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (m.castFlash > 0) {
      ctx.globalAlpha = m.castFlash;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, cy, rad + 3 + (1 - m.castFlash) * 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    drawStatusChip(ctx, x, y - rad - 14, ringMeta.icon, ringMeta.color, Math.max(8, rad * 0.55));
    ctx.restore();
  }
  // 妖怪身上的控制/增益状态（定身/减速/疾风/回春）
  const mStatuses = monsterStatusItems({
    stunT: m.stunT ?? 0,
    slowT: m.slowT ?? 0,
    hasteT: m.hasteT ?? 0,
    healFlash: m.healFlash ?? 0,
  });
  if (mStatuses.length > 0) {
    drawStatusRow(ctx, x, y + rad0 + 8, mStatuses, 7);
  }
}

function drawMonsters(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const m of b.monsters) {
    const p = posAtDistance(b.map, m.dist);
    const { x, y } = cellCenterPx(p.c, p.r);
    // 采样前方一小段求水平朝向（骑兵拖尾方向用）：向右移=+1，向左移=-1
    const np = posAtDistance(b.map, m.dist + 0.05);
    const trailDir = cellCenterPx(np.c, np.r).x - x >= 0 ? 1 : -1;
    const rad0 = m.isBoss ? CELL * 0.42 : m.isMiniBoss ? CELL * 0.36 : CELL * 0.28;
    drawMonsterAt(ctx, x, y, rad0, m, b.map.id, trailDir);
  }
}

// 爆发特效：命中冲击环 / 击杀爆散 / 合成星爆
function drawDigFx(ctx: CanvasRenderingContext2D, fxList: { c: number; r: number; t: number }[]) {
  const spr = sprite('item-shovel');
  for (const d of fxList) {
    const { x, y } = cellCenterPx(d.c, d.r);
    const phase = Math.min(1, d.t / DIG_DUR); // 0→1
    const chop = Math.abs(Math.sin(phase * Math.PI * 2 * 2)); // 两个周期=来回挖两下
    const tilt = Math.sin(phase * Math.PI * 2 * 2) * 0.5; // 随挖左右摆
    const s = CELL * 0.6;
    ctx.save();
    ctx.globalAlpha = 1 - phase * 0.15;
    // 泥坑底色
    ctx.fillStyle = 'rgba(60,40,20,0.32)';
    ctx.beginPath();
    ctx.ellipse(x, y + CELL * 0.18, CELL * 0.28, CELL * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    // 铲子：随 chop 下压 + tilt 倾斜
    ctx.translate(x, y - CELL * 0.12 + chop * CELL * 0.22);
    ctx.rotate(tilt);
    if (spr) {
      ctx.drawImage(spr, -s / 2, -s / 2, s, s);
    } else {
      ctx.font = `${Math.round(s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🥄', 0, 0);
    }
    ctx.restore();
  }
}

function drawBursts(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const bt of b.bursts) {
    const { x, y } = cellCenterPx(bt.c, bt.r);
    const t = 1 - bt.ttl / bt.maxTtl; // 0→1
    ctx.save();
    if (bt.kind === 'hit') {
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = bt.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 6 + t * 22, 0, Math.PI * 2);
      ctx.stroke();
    } else if (bt.kind === 'death') {
      const R = (bt.big ? 40 : 24) * (0.4 + t);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = bt.color;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * R, y + Math.sin(a) * R, 4 * (1 - t) + 1, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // merge 星爆
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = bt.color;
      ctx.lineWidth = 3;
      const R = 8 + t * 26;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + t * 0.6;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * (R * 0.4), y + Math.sin(a) * (R * 0.4));
        ctx.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

// 缓动：ease-out（两端→中段），大招动画统一手感
function easeOut(p: number): number { return 1 - Math.pow(1 - p, 3); }

// 武将大招专属动画：switch(heroId) 分派，风格对齐 drawFx
function drawHeroUlt(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const f of b.heroUltFx) {
    const { x, y } = cellCenterPx(f.c, f.r);
    const prog = 1 - f.ttl / f.maxTtl; // 0→1
    const fade = 1 - prog;             // 1→0
    const R = f.rge * CELL;            // 群攻范围半径(px)
    ctx.save();
    switch (f.heroId) {
      // —— 暴击（哪吒/二郎）——
      case 'nezha': drawUltNezha(ctx, x, y, prog, fade, f.tier); break;
      case 'erlang': drawUltErlang(ctx, x, y, prog, fade, f.tier); break;
      // —— 群攻 ——
      case 'wukong': drawUltWukong(ctx, x, y, prog, fade, f.tier, R); break;
      case 'honghaier': drawUltHonghaier(ctx, x, y, prog, fade, f.tier, R); break;
      case 'bajie': drawUltBajie(ctx, x, y, prog, fade, f.tier, R); break;
      case 'tieshan': drawUltTieshan(ctx, x, y, prog, fade, f.tier, R); break;
      case 'shaseng': drawUltShaseng(ctx, x, y, prog, fade, f.tier, R); break;
      case 'niumowang': drawUltNiumowang(ctx, x, y, prog, fade, f.tier, R); break;
      case 'guanyin': drawUltGuanyin(ctx, x, y, prog, fade, f.tier, R); break;
      case 'baigujing': drawUltBaigujing(ctx, x, y, prog, fade, f.tier, R); break;
      case 'tangseng': drawUltTangseng(ctx, x, y, prog, fade, f.tier, R); break;
    }
    ctx.restore();
    // 暴击飘字：红字上飘 + 放大
    if (f.crit && f.critDmg != null) {
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#ff5a3c';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3;
      ctx.font = `bold ${Math.round(18 + prog * 10)}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ty = y - 18 - prog * 26;
      ctx.strokeText(`暴击! ${Math.round(f.critDmg)}`, x, ty);
      ctx.fillText(`暴击! ${Math.round(f.critDmg)}`, x, ty);
      ctx.restore();
    }
  }
}

// —— 暴击英雄 ——
// 哪吒 火尖枪·万火齐发：多支火枪自上方倾泻聚点 + 落地烈焰爆点
function drawUltNezha(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number) {
  const n = 5 + tier;
  const drop = easeOut(Math.min(1, p / 0.6));
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i - (n - 1) / 2) * 0.22;
    const startD = CELL * 2.4;
    const d = startD * (1 - drop);
    const sx = x + Math.cos(ang) * d, sy = y + Math.sin(ang) * d - CELL * 0.4;
    ctx.globalAlpha = fade;
    ctx.strokeStyle = '#ffcf5a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - Math.cos(ang) * CELL * 0.5, sy - Math.sin(ang) * CELL * 0.5); ctx.stroke();
    ctx.fillStyle = '#ff7a2c';
    ctx.beginPath(); ctx.arc(sx, sy, 3 + tier * 0.5, 0, Math.PI * 2); ctx.fill();
  }
  if (p > 0.5) {
    const bp = (p - 0.5) / 0.5;
    ctx.globalAlpha = (1 - bp) * fade * 1.2;
    const rad = CELL * (0.4 + tier * 0.12) * (0.5 + bp);
    const grad = ctx.createRadialGradient(x, y, 2, x, y, rad);
    grad.addColorStop(0, 'rgba(255,240,180,0.9)');
    grad.addColorStop(0.6, 'rgba(255,120,44,0.5)');
    grad.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
}

// 二郎 天眼诛邪：竖向贯穿光束 + 睁开的天眼
function drawUltErlang(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number) {
  const beamW = (6 + tier * 2) * (0.4 + easeOut(Math.min(1, p / 0.5)) * 0.6);
  const h = CELL * 2.6;
  ctx.globalAlpha = fade;
  const grad = ctx.createLinearGradient(x, y - h, x, y + CELL * 0.6);
  grad.addColorStop(0, 'rgba(180,235,255,0)');
  grad.addColorStop(0.7, 'rgba(150,216,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = grad;
  ctx.fillRect(x - beamW / 2, y - h, beamW, h + CELL * 0.6);
  const open = easeOut(Math.min(1, p / 0.4));
  ctx.strokeStyle = '#bfe9ff';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(x, y - CELL * 1.4, CELL * 0.32, CELL * 0.5 * open, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#3a6ea5';
  ctx.beginPath(); ctx.arc(x, y - CELL * 1.4, CELL * 0.12 * open, 0, Math.PI * 2); ctx.fill();
}

// —— 输出群攻 ——
// 悟空 金箍棒大范围横扫：原棍兵旋转残影特效放大版 + 扇形扫掠
function drawUltWukong(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const sweep = easeOut(p);
  const a0 = -Math.PI * 0.9, a1 = a0 + Math.PI * 1.8 * sweep;
  const rad = R * 0.9;
  ctx.globalAlpha = fade;
  // 扇形扫掠底
  const grad = ctx.createRadialGradient(x, y, rad * 0.2, x, y, rad);
  grad.addColorStop(0, 'rgba(255,243,196,0.05)');
  grad.addColorStop(1, 'rgba(240,185,60,0.35)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, rad, a0, a1); ctx.closePath(); ctx.fill();
  // 金箍棒旋转残影（自棍兵迁来）：中段化为残影盘，两端清晰
  const turns = 2.2 + tier * 0.35;
  const eio = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const spin = turns * Math.PI * 2 * eio;
  const blur = Math.pow(Math.sin(Math.PI * p), 3);
  const len = rad * (0.72 + tier * 0.04);
  const lw = 5 + tier;
  ctx.save();
  ctx.translate(x, y);
  if (blur > 0.05) {
    const disk = ctx.createRadialGradient(0, 0, len * 0.15, 0, 0, len);
    disk.addColorStop(0, 'rgba(232,161,28,0.04)');
    disk.addColorStop(0.65, `rgba(232,161,28,${0.18 * blur})`);
    disk.addColorStop(1, `rgba(255,226,122,${0.45 * blur})`);
    ctx.fillStyle = disk;
    ctx.beginPath(); ctx.arc(0, 0, len, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = fade * blur * 0.9;
    ctx.strokeStyle = '#fff3c4';
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(0, 0, len, spin - 0.7, spin + 0.2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, len, spin + Math.PI - 0.7, spin + Math.PI + 0.2); ctx.stroke();
  }
  ctx.globalAlpha = fade * (1 - 0.7 * blur);
  ctx.rotate(spin);
  ctx.strokeStyle = '#e8a11c';
  ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0); ctx.stroke();
  ctx.strokeStyle = '#fff3c4';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0); ctx.stroke();
  ctx.fillStyle = '#ffe27a';
  ctx.beginPath(); ctx.arc(len, 0, 3 + tier, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-len, 0, 3 + tier, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 扫掠前缘指示线
  ctx.globalAlpha = fade;
  ctx.strokeStyle = '#e8a11c'; ctx.lineWidth = 4 + tier;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a1) * rad, y + Math.sin(a1) * rad); ctx.stroke();
}

// 红孩 三昧真火扩散火花花瓣
function drawUltHonghaier(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const rad = easeOut(p) * R * 0.85;
  const petals = 8 + tier * 2;
  ctx.globalAlpha = fade;
  const grad = ctx.createRadialGradient(x, y, 2, x, y, rad);
  grad.addColorStop(0, 'rgba(255,240,180,0.9)');
  grad.addColorStop(0.5, 'rgba(255,120,44,0.45)');
  grad.addColorStop(1, 'rgba(255,60,20,0)');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 + p * 0.8;
    const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
    ctx.fillStyle = '#ff8a3c';
    ctx.beginPath(); ctx.arc(px, py, 3 + tier * 0.6, 0, Math.PI * 2); ctx.fill();
  }
}

// —— 控制群攻 ——
// 八戒 钉耙震地·同心裂纹冲击波
function drawUltBajie(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  ctx.globalAlpha = fade;
  for (let k = 0; k < 3; k++) {
    const pk = Math.max(0, Math.min(1, p - k * 0.15));
    const rad = easeOut(pk) * R * 0.9;
    ctx.strokeStyle = k === 0 ? '#ffd34d' : 'rgba(255,211,77,0.55)';
    ctx.lineWidth = 5 - k * 1.2;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
  }
  const cracks = 6 + tier;
  ctx.strokeStyle = 'rgba(120,80,30,0.6)'; ctx.lineWidth = 2;
  for (let i = 0; i < cracks; i++) {
    const a = (i / cracks) * Math.PI * 2;
    const rr = easeOut(p) * R * 0.7;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); ctx.stroke();
  }
}

// 铁扇 芭蕉扇狂风·叶片旋涡
function drawUltTieshan(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  ctx.globalAlpha = fade;
  const arms = 3;
  const leaves = 5 + tier;
  for (let arm = 0; arm < arms; arm++) {
    for (let i = 1; i <= leaves; i++) {
      const t = i / leaves;
      const rad = easeOut(p) * R * 0.9 * t;
      const a = arm * (Math.PI * 2 / arms) + p * 5 + t * 2.2;
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      ctx.save();
      ctx.translate(px, py); ctx.rotate(a);
      ctx.fillStyle = 'rgba(142,230,192,0.75)';
      ctx.beginPath(); ctx.ellipse(0, 0, 6 + tier, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
}

// —— 击退群攻 ——
// 沙僧 宝杖横扫 + 击退拖影
function drawUltShaseng(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  ctx.globalAlpha = fade;
  const rad = R * 0.9;
  const sweepA = -Math.PI * 0.5 + easeOut(p) * Math.PI;
  ctx.strokeStyle = 'rgba(154,208,255,0.5)'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(x, y, rad, -Math.PI * 0.5, sweepA); ctx.stroke();
  ctx.strokeStyle = '#cfe6ff'; ctx.lineWidth = 4 + tier * 0.6;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(sweepA) * rad, y + Math.sin(sweepA) * rad); ctx.stroke();
  for (let i = 0; i < 4 + tier; i++) {
    const a = -Math.PI * 0.5 + (i / (4 + tier)) * Math.PI;
    if (a > sweepA) continue;
    ctx.strokeStyle = 'rgba(200,230,255,0.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * rad * 0.7, y + Math.sin(a) * rad * 0.7);
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); ctx.stroke();
  }
}

// 牛魔 蛮牛冲撞·直线尘土拖尾
function drawUltNiumowang(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  ctx.globalAlpha = fade;
  const len = R * 1.1;
  const headD = easeOut(p) * len;
  const dirX = 0, dirY = -1;
  const hx = x + dirX * headD, hy = y + dirY * headD;
  ctx.strokeStyle = 'rgba(201,162,106,0.8)'; ctx.lineWidth = 8 + tier;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx, hy); ctx.stroke();
  for (let i = 0; i < 8 + tier; i++) {
    const t = i / (8 + tier);
    const px = x + dirX * headD * t + (Math.random() - 0.5) * 6;
    const py = y + dirY * headD * t + (Math.random() - 0.5) * 6;
    ctx.fillStyle = `rgba(180,150,110,${0.5 * (1 - t)})`;
    ctx.beginPath(); ctx.arc(px, py, 4 + tier * 0.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#8a6a3a';
  ctx.beginPath(); ctx.arc(hx, hy, 5 + tier, 0, Math.PI * 2); ctx.fill();
}

// —— 辅助/过渡 ——
// 观音 净瓶甘露下落 + 光环
function drawUltGuanyin(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  ctx.globalAlpha = fade;
  const drops = 8 + tier * 2;
  for (let i = 0; i < drops; i++) {
    const a = (i / drops) * Math.PI * 2;
    const spread = R * 0.7 * (0.4 + (i % 3) * 0.2);
    const dx = x + Math.cos(a) * spread;
    const fall = ((p * 1.6 + i * 0.13) % 1);
    const dy = y - CELL * 1.2 + fall * CELL * 1.6;
    ctx.fillStyle = 'rgba(191,230,255,0.85)';
    ctx.beginPath(); ctx.ellipse(dx, dy, 2.5, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,246,210,0.6)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(x, y, easeOut(p) * R * 0.6, 0, Math.PI * 2); ctx.stroke();
}

// 白骨 骨雾灰白扩散云
function drawUltBaigujing(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  ctx.globalAlpha = fade * 0.9;
  const rad = easeOut(p) * R * 0.8;
  for (let i = 0; i < 6 + tier; i++) {
    const a = (i / (6 + tier)) * Math.PI * 2 + p;
    const rr = rad * (0.4 + (i % 3) * 0.25);
    const cx = x + Math.cos(a) * rr * 0.6, cy = y + Math.sin(a) * rr * 0.6;
    const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, rr * 0.6);
    grad.addColorStop(0, 'rgba(230,226,216,0.5)');
    grad.addColorStop(1, 'rgba(210,205,195,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, rr * 0.6, 0, Math.PI * 2); ctx.fill();
  }
}

// 御弟 诵经·金色经文字环逐层扩散
function drawUltTangseng(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  ctx.globalAlpha = fade;
  const chars = '唵嘛呢叭咪吽';
  for (let ring = 0; ring < 2; ring++) {
    const pk = Math.max(0, Math.min(1, p - ring * 0.2));
    const rad = easeOut(pk) * R * (0.5 + ring * 0.35);
    const n = 6 + tier;
    ctx.fillStyle = ring === 0 ? '#ffe08a' : 'rgba(255,224,138,0.6)';
    ctx.font = `${Math.round(CELL * 0.28)}px "PingFang SC", serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + p * (ring ? -1.2 : 1.2);
      ctx.fillText(chars[i % chars.length]!, x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
  }
}

// 击杀蟠桃飘字：头上 🍑+N（+N 字号更小），升空不透明，过顶后按下落进度淡出
function drawPeachFloats(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const p of b.peachFloats) {
    const { x, y: cy } = cellCenterPx(p.c, p.r);
    const y = cy + p.y * CELL;
    const fallProgress = p.y >= p.peakY ? (p.y - p.peakY) / PEACH_FLOAT_FALL : 0;
    const alpha = 1 - Math.min(1, Math.max(0, fallProgress));
    const peach = '🍑';
    const num = `+${p.amount}`;
    const peachPx = Math.round(CELL * 0.42);
    const numPx = Math.round(CELL * 0.28);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${peachPx}px "PingFang SC", sans-serif`;
    const peachW = ctx.measureText(peach).width;
    ctx.font = `bold ${numPx}px "PingFang SC", sans-serif`;
    const numW = ctx.measureText(num).width;
    const totalW = peachW + numW;
    const left = x - totalW / 2;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20,16,12,0.85)';
    ctx.fillStyle = '#fffef6';
    ctx.textAlign = 'left';
    ctx.font = `bold ${peachPx}px "PingFang SC", sans-serif`;
    ctx.strokeText(peach, left, y);
    ctx.fillText(peach, left, y);
    ctx.font = `bold ${numPx}px "PingFang SC", sans-serif`;
    ctx.strokeText(num, left + peachW, y);
    ctx.fillText(num, left + peachW, y);
    ctx.restore();
  }
}

function drawUnits(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  const t = performance.now() / 1000;
  for (const u of b.units.values()) {
    if (ui.dragFrom && ui.dragFrom.c === u.cell.c && ui.dragFrom.r === u.cell.r) continue; // 拖拽中隐藏原位
    const { x, y } = cellCenterPx(u.cell.c, u.cell.r);
    const fallen = u.knockdownT > 0;
    // 地面阴影（贴格底，不随 bob/开火上跳，与怪物同风格）
    drawGroundShadow(ctx, x, y, CELL * 0.28, fallen ? 0.18 : 0.28);
    // 待机微动：轻微起伏，按格错相位避免整齐划一，让在场武器"活"起来（倒下时停 bob）
    const bob = fallen ? 0 : Math.sin(t * 2 + (u.cell.c * 0.9 + u.cell.r * 1.7)) * 1.3;
    // 开火脉冲：放大 + 上跳
    const pulse = fallen ? 0 : u.firePulse;
    const uy = y - pulse * 4 + bob;
    drawUnit(
      ctx,
      u.type,
      u.tier,
      x,
      uy,
      CELL * 0.72 * (1 + pulse * 0.16),
      u.fireDir != null && Math.cos(u.fireDir) < 0,
      { x, y, s: CELL * 0.72 },
      fallen,
    );
    // 攻击瞬间：字→兵器形变，朝目标出招（倒下时不画）
    if (!fallen) drawUnitWeapon(ctx, u.type, u.tier, x, uy, u.fireDir ?? -Math.PI / 2, pulse, u.combo);
    // 减益标识：深色芯片（去掉立绘底色后仍清晰）
    const statuses = unitStatusItems(u);
    if (statuses.length > 0) {
      ctx.save();
      if (u.stunT > 0 && !fallen) {
        // 眩晕：整格泛黄闪烁
        ctx.globalAlpha = 0.3 + 0.2 * Math.sin(u.stunT * 12);
        roundRect(ctx, x - CELL * 0.36, y - CELL * 0.36, CELL * 0.72, CELL * 0.72, 8);
        ctx.fillStyle = SKILL_META.stun.color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (fallen) {
        // 倒下：地面尘土感
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(u.knockdownT * 8);
        ctx.fillStyle = UNIT_STATUS_META.knockdown.color;
        ctx.beginPath();
        ctx.ellipse(x, y + CELL * 0.28, CELL * 0.32, CELL * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      drawStatusRow(ctx, x, y - CELL * 0.42, statuses, 8);
      ctx.restore();
    }
  }
}

// 选中单位：攻击范围高亮 + 信息面板（点击某武器才显示，参考竞品单位面板）
// 点击字牌：高亮该字牌；若已激活则双字同时选中，并画攻击范围与武将信息面板
// panelHalf: tips 放哪半场（选中玩家单位→ai 半场；选中 AI 单位→player 半场，避免挡范围环）
// fromAi: 读 AI 侧激活武将与基础数值（AI 无玩家神兵/功德加成）
function drawWordSelection(
  ctx: CanvasRenderingContext2D,
  b: Battle,
  w: { char: string; general: string; tier: number; cell: { c: number; r: number } },
  panelHalf: 'ai' | 'player' = 'ai',
  fromAi = false,
) {
  const def = generalById(w.general);
  if (!def) return;
  const active = (fromAi ? b.aiActiveGenerals() : b.activeGenerals()).find((g) =>
    g.cells.some((cc) => cc.c === w.cell.c && cc.r === w.cell.r),
  );
  ctx.save();
  // 选中格金边：已激活则左右两字同时描边
  const selCells = active ? active.cells : [w.cell];
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffe08a';
  for (const c of selCells) {
    const gx = BOARD_X + c.c * CELL;
    const gy = BOARD_Y + c.r * CELL;
    roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
    ctx.stroke();
  }
  // 激活则画范围环（圆心取双格中点）
  if (active) {
    const ax = (active.cells[0].c + active.cells[1].c) / 2;
    const ay = (active.cells[0].r + active.cells[1].r) / 2;
    const { x, y } = cellCenterPx(ax, ay);
    const rge = fromAi ? generalStat(def, active.tier).rge : b.generalRge(active);
    ctx.beginPath();
    // 半径含半格(rge+0.5)，与命中判定「圆与方格相交」及兵种范围环显示一致
    ctx.arc(x, y, (rge + TUNING.rangeTolerance) * CELL, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(240,185,60,0.12)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(240,185,60,0.8)';
    ctx.setLineDash([7, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // 信息面板：放在另一半场中央，避免遮住攻击范围环
  const pw = 194;
  const ph = active ? 150 : 146;
  const px = BOARD_X + (COLS * CELL) / 2 - pw / 2;
  const py = infoPanelTop(ph, panelHalf);
  ctx.save();
  // 整体放大信息面板（含底板与文字），围绕面板中心缩放、保持居中
  const K = 1.4, pcx = px + pw / 2, pcy = py + ph / 2;
  ctx.translate(pcx, pcy); ctx.scale(K, K); ctx.translate(-pcx, -pcy);
  roundRect(ctx, px, py, pw, ph, 10);
  ctx.fillStyle = 'rgba(28,22,14,0.94)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = active ? '#f0b93c' : qualityColor(w.tier);
  ctx.stroke();
  // 标题：武将名 + 品质阶
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffe6b0';
  ctx.font = 'bold 17px "PingFang SC", sans-serif';
  ctx.fillText(def.name, px + 12, py + 18);
  ctx.textAlign = 'right';
  ctx.fillStyle = qualityColor(w.tier);
  ctx.font = 'bold 13px "PingFang SC", sans-serif';
  ctx.fillText(`${qualityName(w.tier)}阶·${def.rank}·${def.role}`, px + pw - 12, py + 18);
  // 技能（未激活时置灰）
  ctx.textAlign = 'left';
  ctx.fillStyle = active ? '#9ad8ff' : 'rgba(154,216,255,0.4)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(`技能「${def.skillName}」`, px + 12, py + 40);
  ctx.fillStyle = active ? 'rgba(255,240,210,0.7)' : 'rgba(255,240,210,0.32)';
  ctx.fillText(def.skillDesc, px + 12, py + 56);
  // 属性（激活时计入等级/神兵；AI 侧用基础数值）
  const rows: [string, string][] = active
    ? fromAi
      ? (() => {
          const st = generalStat(def, active.tier);
          return [
            ['攻击力', damage(st.atk).toFixed(2)],
            ['攻速', `${st.frq.toFixed(2)}/s`],
            ['范围', st.rge.toFixed(1)],
            ['等级', `Lv.${active.state.level}`],
          ];
        })()
      : [
          ['攻击力', damage(b.generalAtk(active)).toFixed(2)],
          ['攻速', `${b.generalFrq(active).toFixed(2)}/s`],
          ['范围', b.generalRge(active).toFixed(1)],
          ['等级', `Lv.${active.state.level}`],
        ]
    : [
        ['基础攻击', def.atk.toFixed(1)],
        ['攻速', `${def.frq.toFixed(1)}/s`],
        ['范围', def.rge.toFixed(1)],
      ];
  ctx.font = '13px "PingFang SC", sans-serif';
  let ry = py + 78;
  for (const [k, v] of rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,240,210,0.7)';
    ctx.fillText(k, px + 12, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff6e6';
    ctx.fillText(v, px + pw - 12, ry);
    ry += 16;
  }
  // 底部状态提示
  ctx.textAlign = 'left';
  if (!active) {
    const other = def.chars.find((c) => c !== w.char) ?? '';
    ctx.fillStyle = '#ff9a6a';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText(`未激活：需「${other}」左右紧邻`, px + 12, py + ph - 12);
  }
  ctx.restore();
}


function drawRangeRing(ctx: CanvasRenderingContext2D, x: number, y: number, rangeCells: number) {
  ctx.save();
  ctx.beginPath();
  // 显示半径 = (基础射程 + 命中宽容) * CELL，与战斗判定 (d <= rge + rangeTolerance) 完全一致。
  // 否则 rge=1 的近战只画到相邻格中心(半格)，实际能打到相邻格(含斜角≈1.414)，显示会偏小。
  ctx.arc(x, y, (rangeCells + TUNING.rangeTolerance) * CELL, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(90,150,70,0.16)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(120,200,90,0.85)';
  ctx.setLineDash([7, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/** 点击是否命中我方唐僧（归位格或入场途中当前格） */
export function isPlayerTangsengCell(b: Battle, cell: Cell): boolean {
  const home = b.map.tangseng;
  if (home.c === cell.c && home.r === cell.r) return true;
  const pos = b.tangsengRenderPos();
  return pos.c === cell.c && pos.r === cell.r;
}

/** 点击是否命中 AI 唐僧（无尽模式无对手） */
export function isAiTangsengCell(b: Battle, cell: Cell): boolean {
  if (b.endless) return false;
  const home = b.aiTangseng;
  if (home.c === cell.c && home.r === cell.r) return true;
  const pos = b.aiTangsengRenderPos();
  return pos.c === cell.c && pos.r === cell.r;
}

/** 妖怪点击命中半径（略大于立绘，便于点选） */
function monsterHitRad(m: Monster): number {
  const base = m.isBoss ? CELL * 0.42 : m.isMiniBoss ? CELL * 0.36 : CELL * 0.28;
  return base * 1.35;
}

/** 像素命中双方妖怪：取最近者；无尽模式无 AI 怪 */
export function hitMonsterAt(b: Battle, x: number, y: number): { side: 'player' | 'ai'; id: number } | null {
  let bestId = -1;
  let bestSide: 'player' | 'ai' = 'player';
  let bestD2 = Infinity;
  const consider = (m: Monster, side: 'player' | 'ai') => {
    const p = side === 'player' ? posAtDistance(b.map, m.dist) : b.aiMonsterPos(m);
    const { x: mx, y: my } = cellCenterPx(p.c, p.r);
    const rad = monsterHitRad(m);
    const d2 = (x - mx) * (x - mx) + (y - my) * (y - my);
    if (d2 > rad * rad || d2 >= bestD2) return;
    bestD2 = d2;
    bestId = m.id;
    bestSide = side;
  };
  for (const m of b.monsters) consider(m, 'player');
  if (!b.endless) for (const m of b.aiMonsters) consider(m, 'ai');
  if (bestId < 0) return null;
  return { side: bestSide, id: bestId };
}

function monsterKindLabel(m: Monster): string {
  if (m.isBoss) return '妖王';
  if (m.isMiniBoss && m.miniBossKind) return MINI_BOSS_META[m.miniBossKind].name;
  if (m.isCavalry) return '骑兵妖';
  if (m.skill) return '精英妖';
  return '小妖';
}

function drawSelection(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (ui.selectedMonster) {
    drawMonsterSelection(ctx, b, ui.selectedMonster);
    return;
  }
  if (!ui.selected) return;
  // 唐僧优先：路径终点格上可能无单位，但仍可查看 tips
  if (isPlayerTangsengCell(b, ui.selected)) { drawTangsengSelection(ctx, b, 'player'); return; }
  if (isAiTangsengCell(b, ui.selected)) { drawTangsengSelection(ctx, b, 'ai'); return; }
  const tree = b.trees.get(`${ui.selected.c},${ui.selected.r}`);
  if (tree) { drawTreeSelection(ctx, b, tree); return; }
  const w = b.words.get(`${ui.selected.c},${ui.selected.r}`);
  if (w) { drawWordSelection(ctx, b, w, 'ai'); return; }
  const u = b.units.get(`${ui.selected.c},${ui.selected.r}`);
  if (u) {
    const { x, y } = cellCenterPx(u.cell.c, u.cell.r);
    const stat = getUnitStat(u.type, u.tier);
    drawRangeRing(ctx, x, y, stat.rge);
    ctx.save();
    const gx = BOARD_X + u.cell.c * CELL;
    const gy = BOARD_Y + u.cell.r * CELL;
    roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffe08a';
    ctx.stroke();
    ctx.restore();
    // 玩家单位：面板放 AI 半场，避免挡自己的范围环
    drawUnitInfoPanel(ctx, u.type, u.tier, 'ai');
    return;
  }
  // AI 侧单位 / 字牌
  const aiU = b.aiUnits.find((x) => x.cell.c === ui.selected!.c && x.cell.r === ui.selected!.r);
  if (aiU) {
    const { x, y } = cellCenterPx(aiU.cell.c, aiU.cell.r);
    const stat = getUnitStat(aiU.type, aiU.tier);
    drawRangeRing(ctx, x, y, stat.rge);
    ctx.save();
    const gx = BOARD_X + aiU.cell.c * CELL;
    const gy = BOARD_Y + aiU.cell.r * CELL;
    roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffe08a';
    ctx.stroke();
    ctx.restore();
    // AI 单位：面板放玩家半场，避免挡 AI 侧范围环
    drawUnitInfoPanel(ctx, aiU.type, aiU.tier, 'player');
    return;
  }
  const aiW = b.aiWords.get(`${ui.selected.c},${ui.selected.r}`);
  if (aiW) { drawWordSelection(ctx, b, aiW, 'player', true); return; }
}

/** 选中妖怪：金色描边环 + tips（血量/种类/技能/状态） */
function drawMonsterSelection(
  ctx: CanvasRenderingContext2D,
  b: Battle,
  sel: { side: 'player' | 'ai'; id: number },
) {
  const list = sel.side === 'player' ? b.monsters : b.aiMonsters;
  const m = list.find((x) => x.id === sel.id);
  if (!m) return;
  const p = sel.side === 'player' ? posAtDistance(b.map, m.dist) : b.aiMonsterPos(m);
  const { x, y } = cellCenterPx(p.c, p.r);
  const rad = monsterHitRad(m) / 1.35;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, rad + 6, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffe08a';
  ctx.stroke();
  ctx.restore();

  const mini = m.isMiniBoss && m.miniBossKind ? MINI_BOSS_META[m.miniBossKind] : null;
  const skill = m.skill ? SKILL_META[m.skill] : null;
  const statuses = monsterStatusItems(m);
  const panelHalf: 'ai' | 'player' = sel.side === 'player' ? 'ai' : 'player';
  const pw = 200;
  const ph = mini || skill || statuses.length > 0 ? 148 : 118;
  const px = BOARD_X + (COLS * CELL) / 2 - pw / 2;
  const py = infoPanelTop(ph, panelHalf);
  ctx.save();
  const K = 1.4, pcx = px + pw / 2, pcy = py + ph / 2;
  ctx.translate(pcx, pcy); ctx.scale(K, K); ctx.translate(-pcx, -pcy);
  roundRect(ctx, px, py, pw, ph, 10);
  ctx.fillStyle = 'rgba(28,22,14,0.94)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = m.isBoss ? '#ff5a8a' : mini ? mini.color : skill ? skill.color : '#c8792b';
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffe6b0';
  ctx.font = 'bold 17px "PingFang SC", sans-serif';
  ctx.fillText(monsterKindLabel(m), px + 12, py + 18);
  ctx.textAlign = 'right';
  ctx.fillStyle = sel.side === 'player' ? '#9ad8ff' : '#ff9a6a';
  ctx.font = 'bold 13px "PingFang SC", sans-serif';
  ctx.fillText(sel.side === 'player' ? '我方路' : '对方路', px + pw - 12, py + 18);

  const rows: [string, string][] = [
    ['生命', `${Math.ceil(m.hp)} / ${Math.ceil(m.maxHp)}`],
    ['移速', `${m.spd.toFixed(2)} 格/s`],
  ];
  if (mini) {
    rows.push(['光环', `${mini.skillName}·${mini.desc}`]);
  } else if (skill) {
    rows.push(['技能', `${skill.icon}${skill.name}`]);
  } else {
    rows.push(['技能', '无']);
  }
  if (m.isCavalry) rows.push(['特性', '骑兵·移速翻倍']);
  if (statuses.length > 0) {
    rows.push(['状态', statuses.map((s) => `${s.icon}${s.name}`).join(' ')]);
  }
  ctx.font = '13px "PingFang SC", sans-serif';
  let ry = py + 42;
  for (const [k, v] of rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,240,210,0.7)';
    ctx.fillText(k, px + 12, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff6e6';
    // 长文案略缩，避免溢出面板
    const shown = v.length > 14 ? `${v.slice(0, 13)}…` : v;
    ctx.fillText(shown, px + pw - 12, ry);
    ry += 17;
  }
  ctx.restore();
}

/** 选中唐僧：高亮当前所在格 + tips（无攻击范围） */
function drawTangsengSelection(ctx: CanvasRenderingContext2D, b: Battle, side: 'player' | 'ai') {
  const pos = side === 'player' ? b.tangsengRenderPos() : b.aiTangsengRenderPos();
  const hp = side === 'player' ? b.tangsengHP : b.aiTangsengHP;
  const defeated = side === 'ai' && b.aiDefeated;
  const panelHalf: 'ai' | 'player' = side === 'player' ? 'ai' : 'player';

  ctx.save();
  const gx = BOARD_X + pos.c * CELL;
  const gy = BOARD_Y + pos.r * CELL;
  roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffe08a';
  ctx.stroke();
  ctx.restore();

  const pw = 194;
  const ph = 118;
  const px = BOARD_X + (COLS * CELL) / 2 - pw / 2;
  const py = infoPanelTop(ph, panelHalf);
  ctx.save();
  const K = 1.4, pcx = px + pw / 2, pcy = py + ph / 2;
  ctx.translate(pcx, pcy); ctx.scale(K, K); ctx.translate(-pcx, -pcy);
  roundRect(ctx, px, py, pw, ph, 10);
  ctx.fillStyle = 'rgba(28,22,14,0.94)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#f0b93c';
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffe6b0';
  ctx.font = 'bold 17px "PingFang SC", sans-serif';
  ctx.fillText('唐僧', px + 12, py + 18);
  ctx.textAlign = 'right';
  ctx.fillStyle = side === 'player' ? '#9ad8ff' : '#ff9a6a';
  ctx.font = 'bold 13px "PingFang SC", sans-serif';
  ctx.fillText(side === 'player' ? '我方' : '对方', px + pw - 12, py + 18);
  const rows: [string, string][] = [
    ['生命', defeated ? '已败' : side === 'player' ? `❤ ${hp} / ${b.tangsengMaxHP}` : `❤ ${hp}`],
    ['身份', '取经目标'],
    ['规则', '妖怪抵达扣 1 心'],
  ];
  ctx.font = '13px "PingFang SC", sans-serif';
  let ry = py + 44;
  for (const [k, v] of rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,240,210,0.7)';
    ctx.fillText(k, px + 12, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff6e6';
    ctx.fillText(v, px + pw - 12, ry);
    ry += 18;
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,240,210,0.55)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(side === 'player' ? '心尽则取经失败' : '对方心尽则我方获胜', px + 12, py + ph - 14);
  ctx.restore();
}

/** tips 面板顶边：AI 半场中央 / 玩家半场中央，避免挡对应侧的范围环 */
function infoPanelTop(ph: number, panelHalf: 'ai' | 'player'): number {
  if (panelHalf === 'ai') {
    return BOARD_Y + (FENCE_ROW * CELL) / 2 - ph / 2;
  }
  return BOARD_Y + ((FENCE_ROW + ROWS) * CELL) / 2 - ph / 2;
}

// 单位信息面板：默认 AI 半场中央；选中 AI 单位时改放玩家半场。
// 供选中棋盘单位、以及 tray 按住武器令牌时复用。
function drawUnitInfoPanel(
  ctx: CanvasRenderingContext2D,
  type: UnitType,
  tier: number,
  panelHalf: 'ai' | 'player' = 'ai',
) {
  const cfg = UNITS[type];
  const stat = getUnitStat(type, tier);
  const pw = 176;
  const ph = 120;
  const px = BOARD_X + (COLS * CELL) / 2 - pw / 2;
  const py = infoPanelTop(ph, panelHalf);
  ctx.save();
  // 整体放大信息面板（含底板与文字），围绕面板中心缩放、保持居中
  const K = 1.4, pcx = px + pw / 2, pcy = py + ph / 2;
  ctx.translate(pcx, pcy); ctx.scale(K, K); ctx.translate(-pcx, -pcy);
  roundRect(ctx, px, py, pw, ph, 10);
  ctx.fillStyle = 'rgba(28,22,14,0.92)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#c8792b';
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // 标题行：名称 + Lv
  ctx.fillStyle = '#ffe6b0';
  ctx.font = 'bold 17px "PingFang SC", sans-serif';
  ctx.fillText(`${cfg.name}`, px + 12, py + 18);
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 14px "PingFang SC", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`Lv.${tier}`, px + pw - 12, py + 18);
  // 属性行
  const rows: [string, string][] = [
    ['攻击力', damage(stat.atk).toFixed(2)],
    ['攻速', `${stat.frq.toFixed(2)}/s`],
    ['攻击范围', stat.rge.toFixed(1)],
    ['目标数', stat.targets.toFixed(1)],
    ['法宝', cfg.origin],
  ];
  ctx.font = '13px "PingFang SC", sans-serif';
  let ry = py + 40;
  for (const [k, v] of rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,240,210,0.7)';
    ctx.fillText(k, px + 12, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff6e6';
    ctx.fillText(v, px + pw - 12, ry);
    ry += 16;
  }
  ctx.restore();
}

// 蟠桃园桃树：画在未开垦格上（树干+树冠+按等级数量的桃子+等级角标）；选中/拖拽态描边或隐藏
function drawPeachTrees(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  for (const t of b.trees.values()) {
    if (ui.dragFrom && ui.dragFrom.c === t.cell.c && ui.dragFrom.r === t.cell.r) continue; // 拖拽中隐藏源
    const { x, y } = cellCenterPx(t.cell.c, t.cell.r);
    drawPeachTree(ctx, x, y, CELL * 0.7, t.level);
    if (ui.selected && ui.selected.c === t.cell.c && ui.selected.r === t.cell.r) {
      const gx = BOARD_X + t.cell.c * CELL;
      const gy = BOARD_Y + t.cell.r * CELL;
      ctx.save();
      roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffe08a';
      ctx.stroke();
      ctx.restore();
    }
  }
}

// 单棵桃树矢量图标（自包含，无需外部图片素材）：越高级树冠越大、桃子越多、颜色越艳
function drawPeachTree(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, level: number) {
  const s = size;
  ctx.save();
  ctx.lineJoin = 'round';
  // 树干
  ctx.fillStyle = '#7a4a24';
  ctx.fillRect(x - s * 0.05, y + s * 0.04, s * 0.1, s * 0.3);
  // 树冠：三团叠加的圆，随等级略增大
  const r = s * (0.24 + level * 0.02);
  const canopy: [number, number][] = [[-r * 0.7, 0], [r * 0.7, 0], [0, -r * 0.75]];
  ctx.fillStyle = '#2f7a34';
  for (const [dx, dy] of canopy) { ctx.beginPath(); ctx.arc(x + dx, y + dy - s * 0.02, r, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#49a24e'; // 高光团
  ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.35 - s * 0.02, r * 0.7, 0, Math.PI * 2); ctx.fill();
  // 桃子：数量 = 等级（1..5），粉色带小尖
  const peachN = Math.min(level, PEACH_TREE_MAX_LEVEL);
  const pr = s * 0.075;
  for (let i = 0; i < peachN; i++) {
    const a = -Math.PI / 2 + (i - (peachN - 1) / 2) * 0.7;
    const px = x + Math.cos(a) * r * 0.8;
    const py = y + Math.sin(a) * r * 0.8 - s * 0.04;
    ctx.fillStyle = '#ff8fa8';
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e0577a';
    ctx.beginPath(); ctx.arc(px + pr * 0.35, py, pr * 0.55, 0, Math.PI * 2); ctx.fill();
  }
  // 等级角标
  ctx.fillStyle = 'rgba(20,16,10,0.7)';
  roundRect(ctx, x + s * 0.18, y + s * 0.14, s * 0.24, s * 0.2, 4);
  ctx.fill();
  ctx.fillStyle = '#ffe6b0';
  ctx.font = `bold ${Math.round(s * 0.18)}px "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${level}`, x + s * 0.3, y + s * 0.245);
  ctx.restore();
}

// 选中桃树：信息面板（名称/等级/产桃间隔 + 「还差 Xs 产桃」进度条），固定 AI 半场中央
function drawTreeSelection(ctx: CanvasRenderingContext2D, b: Battle, t: PeachTree) {
  const iv = PEACH_TREE_INTERVALS[Math.min(t.level, PEACH_TREE_MAX_LEVEL) - 1]!;
  const remain = b.treeCountdown(t);
  const ratio = Math.max(0, Math.min(1, 1 - remain / iv));
  const pw = 196;
  const ph = 118;
  const px = BOARD_X + (COLS * CELL) / 2 - pw / 2;
  const py = BOARD_Y + (FENCE_ROW * CELL) / 2 - ph / 2;
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 10);
  ctx.fillStyle = 'rgba(28,22,14,0.94)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#7ec46a';
  ctx.stroke();
  // 标题
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#c9f0b0';
  ctx.font = 'bold 17px "PingFang SC", sans-serif';
  ctx.fillText('蟠桃园·桃树', px + 12, py + 18);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 14px "PingFang SC", sans-serif';
  ctx.fillText(`Lv.${t.level}`, px + pw - 12, py + 18);
  // 说明
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,240,210,0.75)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(`每 ${iv}s 产 1 蟠桃 · 同级拖动可合并升级(≤${PEACH_TREE_MAX_LEVEL})`, px + 12, py + 44);
  // 产桃进度条
  const bx = px + 12, by = py + 66, bw = pw - 24, bh = 14;
  roundRect(ctx, bx, by, bw, bh, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fill();
  ctx.save();
  roundRect(ctx, bx, by, bw, bh, 7);
  ctx.clip();
  ctx.fillStyle = '#7ec46a';
  ctx.fillRect(bx, by, bw * ratio, bh);
  ctx.restore();
  // 倒计时文字
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff6e6';
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillText(`还差 ${remain.toFixed(1)}s 产下一颗桃`, px + pw / 2, py + ph - 16);
  ctx.restore();
}

// 棋盘上的武将字牌（各占一格）+ 已激活武将的金色边框与名号
function drawGenerals(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  // 已激活武将占用的格 → 抹掉单字阶数上标（只保留金框上方整体 Lv）；并记下整体阶供字色/加粗
  const activeTier = new Map<string, number>();
  for (const g of b.activeGenerals()) {
    for (const c of g.cells) activeTier.set(`${c.c},${c.r}`, g.tier);
  }
  // 先画所有字牌（拖拽中的源格隐藏）
  for (const w of b.words.values()) {
    if (ui.dragFrom && ui.dragFrom.c === w.cell.c && ui.dragFrom.r === w.cell.r) continue;
    const { x, y } = cellCenterPx(w.cell.c, w.cell.r);
    drawGroundShadow(ctx, x, y, CELL * 0.32, 0.26);
    const key = `${w.cell.c},${w.cell.r}`;
    const qTier = activeTier.get(key) ?? 0;
    drawWordTile(ctx, w.char, w.tier, x, y, CELL * 0.78, qTier === 0, qTier);
  }
  // 再给「左右紧邻同将」的激活武将套金框（框色随品质阶微变，仍偏金以示激活）
  for (const g of b.activeGenerals()) {
    const a = cellCenterPx(g.cells[0].c, g.cells[0].r);
    const z = cellCenterPx(g.cells[1].c, g.cells[1].r);
    const x = Math.min(a.x, z.x) - CELL / 2 + 2;
    const y = Math.min(a.y, z.y) - CELL / 2 + 2;
    const w = Math.abs(z.x - a.x) + CELL - 4;
    const h = CELL - 4;
    ctx.save();
    // 激活框 + 释放技能时更亮；高阶用品质色描边
    const glow = 0.65 + 0.35 * Math.sin(performance.now() / 220) + g.state.skillFlash * 0.5;
    ctx.globalAlpha = Math.min(1, glow);
    ctx.strokeStyle = g.tier >= 2 ? qualityColor(g.tier) : '#f0b93c';
    ctx.lineWidth = 3 + Math.min(2, (g.tier - 1) * 0.5);
    roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 武将整体阶数：统一徽标显示在组合右上角（右字牌那格）
    const sTile = CELL * 0.78;
    drawTierBadge(ctx, z.x + sTile * 0.42, z.y - sTile * 0.36, g.tier, Math.round(sTile * 0.3));
    ctx.restore();
  }
}

function drawFx(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const f of b.fx) {
    const a = cellCenterPx(f.from.c, f.from.r);
    const t = cellCenterPx(f.to.c, f.to.r);
    const prog = 1 - Math.max(0, Math.min(1, f.ttl / f.maxTtl)); // 0→1 飞行进度
    const x = a.x + (t.x - a.x) * prog;
    const y = a.y + (t.y - a.y) * prog;
    const ang = Math.atan2(t.y - a.y, t.x - a.x);
    ctx.save();
    ctx.strokeStyle = f.color;
    ctx.fillStyle = f.color;
    ctx.lineCap = 'round';
    const tier = f.tier ?? 1; // 特效随阶数加大：圈数/范围/长度/粗细
    switch (f.wtype) {
      case 'staff': {
        // 英雄悟空金箍棒（原棍兵特效）：起转清晰→加速残影盘→减速重现
        const turns = 2 + tier;
        const eio = prog < 0.5 ? 2 * prog * prog : 1 - Math.pow(-2 * prog + 2, 2) / 2;
        const spin = turns * Math.PI * 2 * eio;
        const blur = Math.pow(Math.sin(Math.PI * prog), 3);
        const len = CELL * (0.24 + tier * 0.10);
        const baseA = Math.min(1, 1.4 - prog);
        const lw = 4 + tier * 1.1;
        ctx.translate(t.x, t.y);
        ctx.lineCap = 'round';
        if (blur > 0.05) {
          const grad = ctx.createRadialGradient(0, 0, len * 0.15, 0, 0, len);
          grad.addColorStop(0, 'rgba(232,161,28,0.03)');
          grad.addColorStop(0.65, `rgba(232,161,28,${0.14 * blur})`);
          grad.addColorStop(1, `rgba(255,226,122,${0.4 * blur})`);
          ctx.globalAlpha = baseA;
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(0, 0, len, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = baseA * blur * 0.85;
          ctx.strokeStyle = '#fff3c4';
          ctx.lineWidth = lw;
          ctx.beginPath(); ctx.arc(0, 0, len, spin - 0.6, spin + 0.15); ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, len, spin + Math.PI - 0.6, spin + Math.PI + 0.15); ctx.stroke();
        }
        ctx.globalAlpha = baseA * (1 - 0.75 * blur);
        ctx.save();
        ctx.rotate(spin);
        ctx.strokeStyle = '#e8a11c';
        ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0); ctx.stroke();
        ctx.strokeStyle = '#fff3c4';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0); ctx.stroke();
        ctx.fillStyle = '#ffe27a';
        ctx.beginPath(); ctx.arc(len, 0, 2 + tier * 0.8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(-len, 0, 2 + tier * 0.8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'monkey': {
        // 柄在攻击者一侧，尖朝怪挥砍；只看左右，不看上下
        const seed = ((f.from.c * 13 + f.from.r * 29) ^ (tier * 7)) | 0;
        const lane = (seed % 5) - 2;
        const dx = a.x - t.x;
        // +1 人在右 → 柄在右、尖往左砍；-1 人在左 → 柄在左、尖往右砍
        const side = Math.abs(dx) > 0.5 ? (dx > 0 ? 1 : -1) : (seed % 2 === 0 ? 1 : -1);
        const daoS = CELL * (0.55 + tier * 0.05) * 0.9; // 相对初版缩小后再放大 1/8
        // 前 22% 内完成挥砍，加速曲线更陡 → 看起来更利落
        const snap = Math.min(1, prog / 0.22);
        const ease = 1 - Math.pow(1 - snap, 3.4);
        // 尖从「偏攻击者一侧举起」扫向另一侧（穿过怪）；柄始终更靠攻击者一侧
        const lean = 0.7;
        const sweep = Math.PI * 0.65;
        const startAng = -Math.PI / 2 + side * lean; // 尖朝上并偏向人
        const sweepSign = -side; // 人在右则逆时针往左砍，人在左则顺时针往右砍
        const chopAng = startAng + sweepSign * sweep * ease;
        const fade =
          prog < 0.35 ? Math.min(1, 0.45 + snap * 0.65) : Math.max(0, 1 - (prog - 0.35) / 0.45);
        // 握点偏向攻击者，柄在人那一侧
        const gripX = t.x + side * CELL * 0.16 + lane * CELL * 0.08;
        const gripY = t.y + CELL * 0.18;
        ctx.translate(gripX, gripY);
        const ccw = sweepSign < 0;
        if (ease > 0.06 && fade > 0.05) {
          const trailR = daoS * 0.92;
          ctx.save();
          ctx.globalAlpha = fade * 0.4 * ease;
          ctx.strokeStyle = 'rgba(255,220,140,0.7)';
          ctx.lineWidth = Math.max(2.2, daoS * 0.07);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(0, 0, trailR, startAng, chopAng, ccw);
          ctx.stroke();
          ctx.globalAlpha = fade * 0.22 * ease;
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = Math.max(1.2, daoS * 0.035);
          const tipFrom = chopAng - sweepSign * sweep * 0.22;
          ctx.beginPath();
          ctx.arc(0, 0, trailR, tipFrom, chopAng, ccw);
          ctx.stroke();
          ctx.restore();
        }
        if (ease > 0.72 && ease < 0.98 && fade > 0.2) {
          const hitA = (ease - 0.72) / 0.26;
          ctx.save();
          ctx.globalAlpha = fade * (1 - hitA) * 0.75;
          ctx.strokeStyle = '#fff6d0';
          ctx.lineWidth = Math.max(2, daoS * 0.05);
          ctx.lineCap = 'round';
          const hx = Math.cos(chopAng) * daoS * 0.55;
          const hy = Math.sin(chopAng) * daoS * 0.55;
          ctx.beginPath();
          ctx.moveTo(hx - Math.cos(chopAng) * daoS * 0.2, hy - Math.sin(chopAng) * daoS * 0.2);
          ctx.lineTo(hx + Math.cos(chopAng) * daoS * 0.35, hy + Math.sin(chopAng) * daoS * 0.35);
          ctx.stroke();
          ctx.restore();
        }
        ctx.save();
        ctx.rotate(chopAng);
        // 锋刃(+y)对齐角速度前进侧，避免刀背砍
        ctx.scale(1, sweepSign);
        // 柄在 -x：尖朝怪时柄落在人一侧
        ctx.translate(-daoS * 0.08, 0);
        drawCurvedDao(ctx, daoS, fade);
        ctx.restore();
        break;
      }
      case 'spear': {
        // 枪：一次迅捷短促突刺（快出快回，收回后平滑淡出，避免静止停顿/突然消失）
        const dist = Math.hypot(t.x - a.x, t.y - a.y);
        const jabP = Math.min(1, prog / 0.55); // 前 55% 内完成整次突刺
        const ext = Math.sin(jabP * Math.PI);  // 0→1→0
        const tipD = dist * (0.18 + 0.82 * ext); // 收回到贴近兵身
        const shaftLen = CELL * (0.5 + tier * 0.12); // 初级更短，随阶明显变长
        ctx.globalAlpha = prog < 0.55 ? 1 : Math.max(0, 1 - (prog - 0.55) / 0.45); // 收回后淡出
        ctx.translate(a.x, a.y);
        ctx.rotate(ang);
        // 枪杆
        ctx.strokeStyle = '#9a6f3a';
        ctx.lineWidth = 2 + tier * 0.5;
        ctx.beginPath(); ctx.moveTo(tipD - shaftLen, 0); ctx.lineTo(tipD - 8, 0); ctx.stroke();
        // 红缨
        ctx.fillStyle = '#c0392b';
        ctx.beginPath(); ctx.arc(tipD - 9, 0, 2 + tier * 0.5, 0, Math.PI * 2); ctx.fill();
        // 叶形枪头（偏小）
        const hl = 7 + tier * 1.8;
        const hw = 2 + tier * 0.6;
        ctx.fillStyle = '#dfe6ee';
        ctx.strokeStyle = '#8a97a6';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tipD, 0);
        ctx.lineTo(tipD - hl * 0.55, -hw);
        ctx.lineTo(tipD - hl, 0);
        ctx.lineTo(tipD - hl * 0.55, hw);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'cavalry': {
        // 骑：命中层只画扇区残影；鞭体只在单位出招 glyph 画一条，避免双鞭
        const reach = (UNITS.cavalry.rge + TUNING.rangeTolerance) * CELL;
        const ox = a.x + Math.cos(ang) * CELL * 0.08;
        const oy = a.y + Math.sin(ang) * CELL * 0.08;
        const eio = prog < 0.5 ? 2 * prog * prog : 1 - Math.pow(-2 * prog + 2, 2) / 2;
        const fromAng = ang - Math.PI;
        const tipAng = fromAng + eio * Math.PI * 2;
        const fade = Math.min(1, 1.1 - prog * 0.4);
        ctx.translate(ox, oy);
        drawWhipSweepFill(ctx, fromAng, tipAng, reach, fade * 0.95);
        break;
      }
      default: {
        // 弓：一支箭——木杆 + 钢制箭头 + 尾羽(用兵种色作点缀)，沿飞行方向。初级更细小，随阶明显放大。
        const sc = 0.6 + (tier - 1) * 0.2;
        ctx.globalAlpha = 1;
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.scale(sc, sc);
        ctx.lineCap = 'round';
        // 木质箭杆（细）
        ctx.strokeStyle = '#a5773f';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(7, 0); ctx.stroke();
        // 钢制箭头（小）
        ctx.fillStyle = '#d7dde4';
        ctx.strokeStyle = '#6b7480';
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(4, -3); ctx.lineTo(4, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
        // 尾羽（兵种色点缀）
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-14, 0); ctx.lineTo(-18, -3);
        ctx.moveTo(-14, 0); ctx.lineTo(-18, 3);
        ctx.moveTo(-11, 0); ctx.lineTo(-15, -3);
        ctx.moveTo(-11, 0); ctx.lineTo(-15, 3);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }
}

// 无尽模式上半场提示文案（轮播，每数秒切换一条）。
const ENDLESS_TIPS: string[] = [
  '骑兵波移速翻倍——优先合成高阶弓兵远程拦截',
  '每 5 波出 BOSS，攒好如来神掌应急',
  '后期怪成堆，靠范围技/陨石清场',
  '每 10 波一个难度台阶，提前囤高阶兵',
];

// 无尽历史最高波数：渲染路径每帧读 localStorage 偏重，节流缓存 ~1s（一局内该值不变）。
let endlessBestCache = 0;
let endlessBestCacheT = -Infinity;
function endlessBestWaveCached(): number {
  const t = performance.now();
  if (t - endlessBestCacheT > 1000) { endlessBestCache = getBestWave(); endlessBestCacheT = t; }
  return endlessBestCache;
}

// 伪竞技 AI 对手（上半场，对角唐僧）。路径用棋盘格背景表示，不再画描边线。
function drawAiSide(ctx: CanvasRenderingContext2D, b: Battle) {
  // AI 怪物：图标 + 血条（与玩家侧一致，尺寸略小）
  for (const m of b.aiMonsters) {
    const p = b.aiMonsterPos(m);
    const { x, y } = cellCenterPx(p.c, p.r);
    const np = b.aiMonsterPos({ ...m, dist: m.dist + 0.05 });
    const trailDir = cellCenterPx(np.c, np.r).x - x >= 0 ? 1 : -1;
    const rad0 = m.isBoss ? CELL * 0.42 : m.isMiniBoss ? CELL * 0.36 : CELL * 0.28;
    drawMonsterAt(ctx, x, y, rad0, m, b.map.id, trailDir);
  }
  // AI 单位（上半场自动部署）
  const t = performance.now() / 1000;
  for (const u of b.aiUnits) {
    const { x, y } = cellCenterPx(u.cell.c, u.cell.r);
    drawGroundShadow(ctx, x, y, CELL * 0.26, 0.26);
    const bob = Math.sin(t * 2 + (u.cell.c * 0.9 + u.cell.r * 1.7)) * 1.1;
    const uy = y - u.firePulse * 3 + bob;
    drawUnit(ctx, u.type, u.tier, x, uy, CELL * 0.66 * (1 + u.firePulse * 0.14), u.fireDir != null && Math.cos(u.fireDir) < 0, { x, y, s: CELL * 0.66 });
    drawUnitWeapon(ctx, u.type, u.tier, x, uy, u.fireDir ?? Math.PI / 2, u.firePulse, u.combo);
  }
  // AI 字牌 / 激活武将（与玩家侧 drawGenerals 同视觉，便于点击查看范围与 tips）
  drawAiGenerals(ctx, b);
  // 对手终点：唐僧立绘（无底座 + 头顶心数，与我方一致）
  const tp = b.aiTangsengRenderPos();
  const { x, y } = cellCenterPx(tp.c, tp.r);
  drawTangsengFigure(ctx, x, y, b.aiTangsengHP, {
    rad: CELL * 0.42,
    defeated: b.aiDefeated,
  });
}

/** AI 半场字牌与激活武将金框（镜像 drawGenerals，无拖拽隐藏） */
function drawAiGenerals(ctx: CanvasRenderingContext2D, b: Battle) {
  const activeTier = new Map<string, number>();
  for (const g of b.aiActiveGenerals()) {
    for (const c of g.cells) activeTier.set(`${c.c},${c.r}`, g.tier);
  }
  for (const w of b.aiWords.values()) {
    const { x, y } = cellCenterPx(w.cell.c, w.cell.r);
    drawGroundShadow(ctx, x, y, CELL * 0.32, 0.26);
    const key = `${w.cell.c},${w.cell.r}`;
    const qTier = activeTier.get(key) ?? 0;
    drawWordTile(ctx, w.char, w.tier, x, y, CELL * 0.78, qTier === 0, qTier);
  }
  for (const g of b.aiActiveGenerals()) {
    const a = cellCenterPx(g.cells[0].c, g.cells[0].r);
    const z = cellCenterPx(g.cells[1].c, g.cells[1].r);
    const x = Math.min(a.x, z.x) - CELL / 2 + 2;
    const y = Math.min(a.y, z.y) - CELL / 2 + 2;
    const w = Math.abs(z.x - a.x) + CELL - 4;
    const h = CELL - 4;
    ctx.save();
    const glow = 0.65 + 0.35 * Math.sin(performance.now() / 220) + g.state.skillFlash * 0.5;
    ctx.globalAlpha = Math.min(1, glow);
    ctx.strokeStyle = g.tier >= 2 ? qualityColor(g.tier) : '#f0b93c';
    ctx.lineWidth = 3 + Math.min(2, (g.tier - 1) * 0.5);
    roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const sTile = CELL * 0.78;
    drawTierBadge(ctx, z.x + sTile * 0.42, z.y - sTile * 0.36, g.tier, Math.round(sTile * 0.3));
    ctx.restore();
  }
}

// 无尽模式上半场信息面板：网格/路径已由 drawBoard 照常绘制作背景，
// 此处在上半场（行 0..FENCE_ROW）叠一层半透明面板，展示历史统计 + 玩法提示轮播。
function drawEndlessPanel(ctx: CanvasRenderingContext2D, b: Battle): void {
  const top = cellCenterPx(0, 0).y - CELL / 2;
  const bottom = cellCenterPx(0, FENCE_ROW).y - CELL / 2;
  const panelX = BOARD_X + CELL * 0.4;
  const panelW = COLS * CELL - CELL * 0.8;
  const panelY = top + CELL * 0.3;
  const panelH = (bottom - top) - CELL * 0.6;

  ctx.save();
  roundRect(ctx, panelX, panelY, panelW, panelH, 14);
  ctx.fillStyle = 'rgba(244,233,220,1)'; // 波次框背景不透明，文字更清晰
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(122,59,18,0.5)';
  ctx.stroke();

  const cx = panelX + panelW / 2;
  const midY = panelY + panelH / 2; // 垂直居中锚点，避免信息靠上显空
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#b5391f';
  ctx.font = 'bold 22px "PingFang SC", sans-serif';
  ctx.fillText('无尽 · 试炼', cx, midY - 40);

  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 30px "PingFang SC", sans-serif';
  ctx.fillText(`第 ${b.wave} 波`, cx, midY - 2);
  ctx.fillStyle = '#8a5a2b';
  ctx.font = '16px "PingFang SC", sans-serif';
  ctx.fillText(`历史最高：第 ${endlessBestWaveCached()} 波`, cx, midY + 28);

  const tip = ENDLESS_TIPS[Math.floor(performance.now() / 4000) % ENDLESS_TIPS.length]!;
  ctx.fillStyle = '#7a3b12';
  ctx.font = '15px "PingFang SC", sans-serif';
  ctx.fillText('💡 ' + tip, cx, panelY + panelH - 22);

  ctx.restore();
}

// 危险提示：怪物距唐僧≤4格时，唐僧格红色呼吸描边 + 在路径上(离唐僧1格、朝向来敌处)显示红色「危险」标签(大小呼吸+重影抖动，营造紧张感)
function drawDanger(ctx: CanvasRenderingContext2D, b: Battle) {
  const now = performance.now();
  const pulse = 0.5 + 0.5 * Math.sin(now / 140); // 0..1 呼吸
  // 目标格红色呼吸描边(高亮唐僧所在格)
  const markBox = (cx: number, cy: number) => {
    const gx = BOARD_X + cx * CELL;
    const gy = BOARD_Y + cy * CELL;
    ctx.save();
    ctx.globalAlpha = 0.3 + 0.35 * pulse;
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = 4;
    roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
    ctx.stroke();
    ctx.globalAlpha = 0.12 + 0.18 * pulse;
    ctx.fillStyle = '#ff3b3b';
    roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
    ctx.fill();
    ctx.restore();
  };
  // 路径上「危险」标签：红色、大小呼吸、重影抖动
  const markText = (px: number, py: number) => {
    const scale = 1 + 0.14 * Math.sin(now / 120); // 呼吸缩放
    const jitter = 1.6 * Math.sin(now / 45); // 高频错位(制造重影/抖动)
    const size = Math.round(23 * scale);
    ctx.save();
    ctx.translate(px, py);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 换字体：粗黑斜体，比正文更具冲击力
    ctx.font = `900 italic ${size}px "Hiragino Sans GB", "STHeiti", "PingFang SC", sans-serif`;
    ctx.lineJoin = 'round';
    // 重影层：错位的半透明红，呼吸闪动出残影
    ctx.globalAlpha = 0.35 + 0.3 * pulse;
    ctx.fillStyle = '#ff2a2a';
    ctx.fillText('危险', jitter, -jitter);
    ctx.fillText('危险', -jitter, jitter);
    // 主体层：深色描边保清晰 + 高饱和红
    ctx.globalAlpha = 1;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(60,0,0,0.85)';
    ctx.strokeText('危险', 0, 0);
    ctx.fillStyle = '#ff1a1a';
    ctx.fillText('危险', 0, 0);
    ctx.restore();
  };
  if (b.status === 'playing' && b.dangerNear()) {
    const t = b.map.tangseng;
    markBox(t.c, t.r);
    const p = posAlong(b.map.path, lenOf(b.map.path) - 1); // 路径上离唐僧1格处
    const { x, y } = cellCenterPx(p.c, p.r);
    markText(x, y);
  }
  if (b.status === 'playing' && !b.aiDefeated && b.aiDangerNear()) {
    markBox(b.aiTangseng.c, b.aiTangseng.r);
    const p = posAlong(b.aiPath, lenOf(b.aiPath) - 1);
    const { x, y } = cellCenterPx(p.c, p.r);
    markText(x, y);
  }
}

// AOE 技能爆发特效（紧箍咒/陨石共用）：金色扩散冲击波 + 放射光束
function drawAoeBurst(ctx: CanvasRenderingContext2D, b: Battle) {
  if (b.ultFlash <= 0 || !b.ultCenter) return;
  const { x, y } = cellCenterPx(b.ultCenter.c, b.ultCenter.r);
  const t = 1 - b.ultFlash / 0.6; // 0→1
  ctx.save();
  // 扩散冲击环
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = '#ffe27a';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(x, y, 10 + t * TUNING.aiClearRadius * CELL * 1.1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#fff3c4';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 4 + t * TUNING.aiClearRadius * CELL * 0.7, 0, Math.PI * 2);
  ctx.stroke();
  // 放射金棒光束
  ctx.strokeStyle = '#ffd23c';
  ctx.lineWidth = 4;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + t * 0.5;
    const r0 = 8;
    const r1 = 16 + (1 - t) * CELL * 1.4;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, b: Battle) {
  ctx.fillStyle = b.map.theme.hud;
  ctx.fillRect(0, 0, VIEW_W, HUD_H);
  ctx.fillStyle = 'rgba(90,70,40,0.3)';
  ctx.fillRect(0, HUD_H - 2, VIEW_W, 2);
  // 蟠桃在暂停钮右侧，避免与 ‖ 重叠
  const pauseR = pauseBtnRect();
  const peachX = pauseR.x + pauseR.w + 10;
  ctx.fillStyle = '#7a3b12';
  ctx.font = 'bold 24px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`🍑 ${b.peach}`, peachX, HUD_H / 2);
  // 中间两行：波次 + 境界
  ctx.textAlign = 'center';
  ctx.fillStyle = '#4a3a1a';
  ctx.fillText(`${b.map.name} · 第 ${b.wave} 波`, VIEW_W / 2, HUD_H / 2 - 12);
  if (hudRankLabel) {
    ctx.font = '14px "PingFang SC", sans-serif';
    ctx.fillStyle = '#8a5a2b';
    ctx.fillText(`境界·${hudRankLabel}`, VIEW_W / 2, HUD_H / 2 + 14);
  }
  ctx.font = 'bold 24px "PingFang SC", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#c23b3b';
  ctx.fillText(`唐僧 ❤ ${b.tangsengHP}`, VIEW_W - 20, HUD_H / 2);
}

// HUD 左上角（桃前）：播放器风格暂停按钮（两竖条）
function drawPauseBtn(ctx: CanvasRenderingContext2D, b: Battle) {
  if (b.status !== 'ready' && b.status !== 'playing') return;
  const r = pauseBtnRect();
  ctx.save();
  roundRect(ctx, r.x, r.y, r.w, r.h, 8);
  ctx.fillStyle = 'rgba(90, 58, 28, 0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(90, 58, 28, 0.75)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // ‖ 暂停图标
  const barW = 4.5;
  const barH = r.h * 0.42;
  const gap = 5;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  ctx.fillStyle = '#fff6e6';
  roundRect(ctx, cx - gap / 2 - barW, cy - barH / 2, barW, barH, 1.5);
  ctx.fill();
  roundRect(ctx, cx + gap / 2, cy - barH / 2, barW, barH, 1.5);
  ctx.fill();
  ctx.restore();
}

// 暂停遮罩 +「当前已暂停」提示 + 继续按钮
function drawPauseOverlay(ctx: CanvasRenderingContext2D, b: Battle) {
  ctx.save();
  ctx.fillStyle = 'rgba(12, 10, 8, 0.58)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const pw = 300, ph = 168;
  const px = (VIEW_W - pw) / 2, py = VIEW_H / 2 - ph / 2 - 10;
  roundRect(ctx, px, py, pw, ph, 14);
  ctx.fillStyle = 'rgba(36, 28, 20, 0.96)';
  ctx.fill();
  ctx.strokeStyle = b.map.theme.accent;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff6e6';
  ctx.font = 'bold 22px "PingFang SC", sans-serif';
  ctx.fillText('游戏已暂停', VIEW_W / 2, py + 48);
  ctx.fillStyle = 'rgba(255,246,230,0.65)';
  ctx.font = '14px "PingFang SC", sans-serif';
  ctx.fillText('当前暂停游戏中', VIEW_W / 2, py + 78);
  const btn = pauseContinueRect();
  roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 12);
  ctx.fillStyle = b.map.theme.accent;
  ctx.fill();
  ctx.fillStyle = '#fff8e8';
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.fillText('继续游戏', btn.x + btn.w / 2, btn.y + btn.h / 2);
  ctx.restore();
}

function drawButtons(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const btn of getButtons(b)) {
    // 主动技能图标(act*)与被动技能格(pas*)由 drawActiveIcons/drawPassiveRow 单独绘制，这里只出命中矩形
    if (btn.id.startsWith('act') || btn.id.startsWith('pas')) continue;
    roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 12);
    ctx.fillStyle = btn.enabled ? b.map.theme.accent : '#2a2218';
    ctx.fill();
    {
      // 征兵按钮：按当前蟠桃/成本填充进度条（参考竞品，桃攒够即满格可点）
      // 进度用固定琥珀金（不跟地图 accent），避免流沙河/白骨岭等 accent 与灰字糊成一团
      if (btn.id === 'summon') {
        const prog = Math.max(0, Math.min(1, b.peach / b.effectiveSummonCost()));
        if (!btn.enabled && prog > 0) {
          ctx.save();
          ctx.beginPath();
          roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 12);
          ctx.clip();
          ctx.fillStyle = '#d4a84a';
          ctx.globalAlpha = 0.9;
          ctx.fillRect(btn.x, btn.y, btn.w * prog, btn.h);
          ctx.restore();
        }
      }
      const tx = btn.x + btn.w / 2;
      const ty = btn.y + btn.h / 2;
      ctx.font = `bold ${btn.w < 140 ? 16 : 20}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 征兵/布阵：浅字 + 深描边，在进度填充与深底上都能读清（四图统一）
      if (btn.id === 'summon') {
        // 文字与桃子分开画：留间距；不可征兵时桃子变灰
        const peach = '🍑';
        const gap = 12;
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(20,14,8,0.92)';
        const textW = ctx.measureText(btn.label).width;
        const peachW = ctx.measureText(peach).width;
        const totalW = textW + gap + peachW;
        const textX = tx - totalW / 2 + textW / 2;
        const peachX = tx - totalW / 2 + textW + gap + peachW / 2;
        ctx.strokeText(btn.label, textX, ty);
        ctx.fillStyle = btn.enabled ? '#fff8e8' : '#fff3d6';
        ctx.fillText(btn.label, textX, ty);
        ctx.fillText(peach, peachX, ty);
      } else if (btn.id === 'autoplace') {
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(20,14,8,0.92)';
        ctx.strokeText(btn.label, tx, ty);
        ctx.fillStyle = btn.enabled ? '#fff8e8' : '#fff3d6';
        ctx.fillText(btn.label, tx, ty);
      } else {
        ctx.fillStyle = btn.enabled ? '#fff6e6' : '#7a7160';
        ctx.fillText(btn.label, tx, ty);
      }
      // 征兵闪光
      if (btn.id === 'summon' && b.summonFlash > 0) {
        ctx.save();
        ctx.globalAlpha = b.summonFlash;
        ctx.strokeStyle = '#ffe89a';
        ctx.lineWidth = 4;
        roundRect(ctx, btn.x - 2, btn.y - 2, btn.w + 4, btn.h + 4, 12);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
  // 提示信息
  ctx.fillStyle = 'rgba(70,50,20,0.8)';
  ctx.font = '14px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(b.message, VIEW_W / 2, MSG_Y);
}

// 两翼主动技能图标：图标 + 环形冷却扇形 + 就绪金边 + 触发白环
function drawActiveIcons(ctx: CanvasRenderingContext2D, b: Battle) {
  if (b.status !== 'playing' && b.status !== 'ready') return;
  for (const btn of getButtons(b)) {
    if (!btn.id.startsWith('act')) continue;
    const i = Number(btn.id.slice(3));
    const slot = b.activeSlots[i];
    if (!slot) continue;
    const def = activeById(slot.id);
    const cx = btn.x + btn.w / 2, cy = btn.y + btn.h / 2;
    const r = btn.w / 2;
    // 圆形底
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = slot.ready ? '#b5762a' : '#4a3f30';
    ctx.fill();
    // 图标字形
    ctx.fillStyle = slot.ready ? '#fff6e6' : '#c9bfae';
    ctx.font = `${Math.round(btn.w * 0.5)}px "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def?.icon ?? '?', cx, cy);
    if (!slot.ready) {
      // 剩余冷却扇形（从 12 点方向顺时针覆盖，比例=剩余CD），半径与圆一致
      const frac = slot.cdMax > 0 ? slot.cd / slot.cdMax : 0;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px "PingFang SC", sans-serif';
      ctx.fillText(String(Math.ceil(slot.cd)), cx, cy);
    } else {
      // 就绪：金色脉冲圆环
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(performance.now() / 130);
      ctx.strokeStyle = '#ffe27a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (slot.flash > 0) {
      // 触发瞬间白色圆环反馈
      ctx.save();
      ctx.globalAlpha = slot.flash;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// 被动/强化技能行：图标块（进度类附小进度条）
function drawPassiveRow(ctx: CanvasRenderingContext2D, b: Battle) {
  if (b.status !== 'playing' && b.status !== 'ready') return;
  for (const btn of getButtons(b)) {
    if (!btn.id.startsWith('pas')) continue;
    const i = Number(btn.id.slice(3));
    const def = passiveById(b.pickedItems[i] ?? '');
    if (!def) continue;
    roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 8);
    ctx.fillStyle = '#2c4a30';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#6ab07a';
    ctx.stroke();
    ctx.fillStyle = '#fff6e6';
    ctx.font = `${Math.round(btn.w * 0.5)}px "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.icon ?? def.name[0]!, btn.x + btn.w / 2, btn.y + btn.h / 2);
    const prog = b.passiveProgress(def.id);
    if (prog) {
      const by = btn.y + btn.h - 5;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(btn.x + 4, by, btn.w - 8, 3);
      ctx.fillStyle = '#ffd24d';
      ctx.fillRect(btn.x + 4, by, (btn.w - 8) * Math.max(0, Math.min(1, prog.ratio)), 3);
    }
  }
}

// 主动技能介绍弹窗：CD 中点击技能图标时展示（就绪时点击是释放，不弹），定时自动淡出
function drawActivePopup(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (ui.activePopup === null || performance.now() > ui.activePopupUntil) return;
  const slot = b.activeSlots[ui.activePopup];
  if (!slot) return;
  const def = activeById(slot.id);
  if (!def) return;
  const w = 264, h = 108;
  const x = (VIEW_W - w) / 2, y = BOARD_Y + 20;
  ctx.save();
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = 'rgba(30,24,18,0.94)';
  ctx.fill();
  ctx.strokeStyle = '#6ab0ff'; // 主动技能=蓝框
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff6e6';
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.fillText(`${def.icon ?? ''} ${def.name}`, x + 16, y + 12);
  ctx.fillStyle = '#8fd3ff';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(`冷却 ${def.cd}s · 冷却中 ${Math.ceil(slot.cd)}s`, x + 16, y + 40);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillText(def.desc, x + 16, y + 66);
  ctx.restore();
}

// 被动/强化道具详情弹窗（点击图标后显示；点任意处关闭）
function drawPassivePopup(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (ui.passivePopup === null) return;
  const def = passiveById(b.pickedItems[ui.passivePopup] ?? '');
  if (!def) return;
  const w = 264, h = 112;
  const x = (VIEW_W - w) / 2, y = BOARD_Y + 20;
  ctx.save();
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = 'rgba(30,24,18,0.94)';
  ctx.fill();
  ctx.strokeStyle = '#6ab07a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff6e6';
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.fillText(`${def.icon ?? ''} ${def.name}`, x + 16, y + 14);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillText(def.desc, x + 16, y + 62);
  const prog = b.passiveProgress(def.id);
  if (prog) {
    const by = y + h - 20, bw = w - 32;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x + 16, by, bw, 8);
    ctx.fillStyle = '#ffd24d';
    ctx.fillRect(x + 16, by, bw * Math.max(0, Math.min(1, prog.ratio)), 8);
    ctx.fillStyle = '#fff';
    ctx.font = '11px "PingFang SC", sans-serif';
    ctx.fillText(prog.text, x + 16, by - 13);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '11px "PingFang SC", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('点任意处关闭', x + w - 12, y + 16);
  ctx.restore();
}

// 竞品式落点瞄准：四角黄括号 + 可选淡黄底 + 空位中央「+」
function drawAimReticle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { plus: boolean; fill?: boolean },
) {
  const pad = 8; // 括号离格边留白
  const len = Math.max(7, Math.min(w, h) * 0.18);
  const lx = x + pad;
  const ty = y + pad;
  const rx = x + w - pad;
  const by = y + h - pad;
  ctx.save();
  if (opts.fill !== false) {
    ctx.fillStyle = 'rgba(255, 220, 90, 0.18)';
    ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
  }
  ctx.strokeStyle = '#f0c83a';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'square';
  // 左上
  ctx.beginPath();
  ctx.moveTo(lx, ty + len);
  ctx.lineTo(lx, ty);
  ctx.lineTo(lx + len, ty);
  ctx.stroke();
  // 右上
  ctx.beginPath();
  ctx.moveTo(rx - len, ty);
  ctx.lineTo(rx, ty);
  ctx.lineTo(rx, ty + len);
  ctx.stroke();
  // 左下
  ctx.beginPath();
  ctx.moveTo(lx, by - len);
  ctx.lineTo(lx, by);
  ctx.lineTo(lx + len, by);
  ctx.stroke();
  // 右下
  ctx.beginPath();
  ctx.moveTo(rx - len, by);
  ctx.lineTo(rx, by);
  ctx.lineTo(rx, by - len);
  ctx.stroke();
  if (opts.plus) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const arm = Math.min(w, h) * 0.08; // 约为原先一半
    ctx.strokeStyle = 'rgba(160, 130, 40, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.moveTo(cx, cy - arm);
    ctx.lineTo(cx, cy + arm);
    ctx.stroke();
  }
  ctx.restore();
}

/** 候选令牌拖到该棋盘格是否合法（与 placeFromTray 语义对齐） */
function trayTokenCanDropOnCell(b: Battle, token: TrayToken, cell: Cell): boolean {
  const key = `${cell.c},${cell.r}`;
  if (token.kind === 'shovel') {
    return b.lockedCells().some((c) => c.c === cell.c && c.r === cell.r);
  }
  if (!b.unlockedCells().some((c) => c.c === cell.c && c.r === cell.r)) return false;
  if (token.kind === 'word') {
    if (b.units.has(key)) return false;
    return true; // 空格放置 / 字牌合并或交换
  }
  // 兵种：不可压字牌；空格放置 / 合并 / 与兵交换
  if (b.words.has(key)) return false;
  return true;
}

/** 候选区内另一槽是否可作为合并目标 */
function trayTokenCanMergeSlot(a: TrayToken, b: TrayToken | undefined): boolean {
  if (!b) return false;
  if (a.kind === 'word' && b.kind === 'word') {
    return false; // 单字不可合并
  }
  if (a.kind === 'unit' && b.kind === 'unit') {
    return canMerge({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier });
  }
  return false;
}

// 托盘拖拽时：标出全部可落点（棋盘 + 可合并的候选槽）+ 源槽黑圈，对标竞品瞄准心
function drawTrayDropHints(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (ui.dragTrayIndex === null) return;
  const token = b.tray[ui.dragTrayIndex];
  if (!token) return;

  // 源槽：黑圈标选中
  {
    const cx = TRAY_LEFT + ui.dragTrayIndex * TRAY_SLOT;
    const x = cx + 3;
    const y = TRAY_Y + 5;
    const w = TRAY_SLOT - 6;
    const h = TRAY_H - 10;
    ctx.save();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.48, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 棋盘合法格
  const cells =
    token.kind === 'shovel'
      ? b.lockedCells()
      : b.unlockedCells().filter((c) => trayTokenCanDropOnCell(b, token, c));
  for (const cell of cells) {
    const key = `${cell.c},${cell.r}`;
    const empty = !b.units.has(key) && !b.words.has(key);
    drawAimReticle(ctx, BOARD_X + cell.c * CELL, BOARD_Y + cell.r * CELL, CELL, CELL, {
      plus: empty,
      fill: true,
    });
  }

  // 候选区其它已占槽：竞品会全部打黄框（合并目标更明确；不可合并时落子仍会失败提示）
  for (let i = 0; i < TUNING.traySize; i++) {
    if (i === ui.dragTrayIndex) continue;
    if (!b.tray[i]) continue;
    const cx = TRAY_LEFT + i * TRAY_SLOT;
    const mergeOk = trayTokenCanMergeSlot(token, b.tray[i]);
    drawAimReticle(ctx, cx + 3, TRAY_Y + 5, TRAY_SLOT - 6, TRAY_H - 10, {
      plus: false,
      fill: mergeOk, // 可合并的槽加淡黄底，仅框的是「有令牌」的槽
    });
  }
}

function drawDragGhost(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (!ui.dragPos) return;
  // 拖拽源中心（棋盘单位 或 候选区令牌）
  let src: { x: number; y: number } | null = null;
  let ghost: (() => void) | null = null;
  if (ui.dragFrom) {
    const u = b.units.get(`${ui.dragFrom.c},${ui.dragFrom.r}`);
    if (u) {
      src = cellCenterPx(ui.dragFrom.c, ui.dragFrom.r);
      ghost = () => drawUnit(ctx, u.type, u.tier, ui.dragPos!.x, ui.dragPos!.y, CELL * 0.72);
    } else {
      const w = b.words.get(`${ui.dragFrom.c},${ui.dragFrom.r}`);
      if (w) {
        src = cellCenterPx(ui.dragFrom.c, ui.dragFrom.r);
        // 拖拽中若仍属激活武将，保持品质色与加粗
        let qTier = 0;
        for (const g of b.activeGenerals()) {
          if (g.cells.some((c) => c.c === ui.dragFrom!.c && c.r === ui.dragFrom!.r)) {
            qTier = g.tier;
            break;
          }
        }
        ghost = () => drawWordTile(ctx, w.char, w.tier, ui.dragPos!.x, ui.dragPos!.y, CELL * 0.74, qTier === 0, qTier);
      } else {
        const t = b.trees.get(`${ui.dragFrom.c},${ui.dragFrom.r}`);
        if (t) {
          src = cellCenterPx(ui.dragFrom.c, ui.dragFrom.r);
          ghost = () => drawPeachTree(ctx, ui.dragPos!.x, ui.dragPos!.y, CELL * 0.72, t.level);
        }
      }
    }
  } else if (ui.dragTrayIndex !== null) {
    const token = b.tray[ui.dragTrayIndex];
    if (token) {
      src = traySlotCenter(ui.dragTrayIndex);
      const tokenSize = token.kind === 'word' ? CELL * 0.78 : TRAY_H - 16;
      ghost = () => drawTrayToken(ctx, token, ui.dragPos!.x, ui.dragPos!.y, tokenSize);
    }
  }
  if (!ghost) return;

  // 托盘拖拽：先画全部可落点瞄准标记（在 ghost 之下）
  if (ui.dragTrayIndex !== null) drawTrayDropHints(ctx, b, ui);

  // 当前悬停格加粗描边；兵种悬停合法格时实时预览攻击范围
  const target = pxToCell(ui.dragPos.x, ui.dragPos.y);
  if (target) {
    const x = BOARD_X + target.c * CELL;
    const y = BOARD_Y + target.r * CELL;
    roundRect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 8);
    ctx.strokeStyle = '#e8a13c';
    ctx.lineWidth = 3;
    ctx.stroke();

    if (ui.dragFrom) {
      // 棋盘内拖兵种时预览落点范围
      const u = b.units.get(`${ui.dragFrom.c},${ui.dragFrom.r}`);
      if (u && b.unlockedCells().some((c) => c.c === target.c && c.r === target.r)) {
        const center = cellCenterPx(target.c, target.r);
        const stat = getUnitStat(u.type, u.tier);
        drawRangeRing(ctx, center.x, center.y, stat.rge);
      }
    }
  }

  // tray 按住武器令牌：始终展示武器信息面板 + 攻击范围(悬停合法格→格中心，否则→ghost处随手跟随)
  if (ui.dragTrayIndex !== null) {
    const token = b.tray[ui.dragTrayIndex];
    if (token && token.kind === 'unit') {
      const onCell = target && trayTokenCanDropOnCell(b, token, target);
      const center = onCell ? cellCenterPx(target.c, target.r) : { x: ui.dragPos.x, y: ui.dragPos.y };
      const stat = getUnitStat(token.type, token.tier);
      drawRangeRing(ctx, center.x, center.y, stat.rge);
      drawUnitInfoPanel(ctx, token.type, token.tier);
    }
  }
  // 源→当前的虚线连接（参考原作）
  if (src) {
    ctx.save();
    ctx.strokeStyle = 'rgba(120,90,40,0.8)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(ui.dragPos.x, ui.dragPos.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  ctx.globalAlpha = 0.9;
  ghost();
  ctx.globalAlpha = 1;
}

function drawBanner(ctx: CanvasRenderingContext2D, b: Battle) {
  if (b.status !== 'won' && b.status !== 'lost') return;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, VIEW_H / 2 - 90, VIEW_W, 180);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 44px "PingFang SC", sans-serif';
  ctx.fillStyle = b.status === 'won' ? '#7dff8a' : '#ff6a6a';
  ctx.fillText(b.status === 'won' ? '取得真经！' : '取经失败', VIEW_W / 2, VIEW_H / 2 - 20);
  ctx.font = '18px "PingFang SC", sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(b.message, VIEW_W / 2, VIEW_H / 2 + 30);
}
