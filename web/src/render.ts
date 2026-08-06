// Canvas 渲染层。逻辑分辨率 560×920（竖屏，贴近微信小游戏）。
import {
  COLS,
  ROWS,
  FENCE_ROW,
  isEitherPathCell,
  isPlayerCell,
  posAtDistance,
  mirrorCell,
  placeableCells,
  type Cell,
} from './board';
import { Battle, TUNING, SKILL_META, PEACH_TREE_INTERVALS, PEACH_TREE_MAX_LEVEL, PEACH_FLOAT_FALL, type TrayToken, type PeachTree, type HeroUltFx } from './battle';
import { passiveById } from './passives';
import { activeById } from './actives';
import { generalById, qualityColor, qualityName } from './generals';
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
export const TRAY_H = 66;
export const CTRL_Y = TRAY_Y + TRAY_H + 26; // 控制按钮行（与候选区拉开间距，避免从「营」拖令牌部署时误点征兵）
export const CTRL_H = 80; // 行高预留：容纳更大的征兵按钮，下方 PAS 行据此下移不重叠
export const PAS_Y = CTRL_Y + CTRL_H + 8; // 被动/强化技能图标行
export const PAS_H = 46;
export const MSG_Y = PAS_Y + PAS_H + 16; // 提示文字行
export const VIEW_H = MSG_Y + 18;

const UNIT_LABEL: Record<UnitType, string> = {
  monkey: '棍',
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
  const btns: Button[] = [
    { id: 'autoplace', label: '布阵', x: 12, y, w: 56, h, enabled: !trayEmpty },
    // 征兵：主 CTA，加大(200×78)且比两翼按钮更靠下，配合上移的行间距，避免部署令牌时误点
    { id: 'summon', label: `征兵${b.effectiveSummonCost()}🍑`, x: 180, y, w: 200, h: 78, enabled: canSummon },
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
  // 被动/强化技能行：每个已携带道具一格，可点击查看详情/进度
  for (let i = 0; i < b.pickedItems.length; i++) {
    btns.push({ id: `pas${i}`, label: '', x: 12 + i * (PAS_H + 6), y: PAS_Y, w: PAS_H, h: PAS_H, enabled: true });
  }
  return btns;
}

export interface UiState {
  dragFrom: Cell | null; // 从棋盘拖动的单位源格
  dragTrayIndex: number | null; // 从候选区拖动的令牌下标
  dragPos: { x: number; y: number } | null;
  selected: Cell | null; // 点击选中的单位格（仅此时显示攻击范围+信息面板）
  passivePopup: number | null; // 点击的被动/强化道具下标（显示详情/进度弹窗）
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

// 统一的右上角阶数徽标：非加粗金字 + 深描边，单位/字牌/激活武将共用，保证清晰一致
function drawTierBadge(ctx: CanvasRenderingContext2D, nx: number, ny: number, tier: number, fontPx: number) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${fontPx}px "PingFang SC", sans-serif`;
  ctx.lineWidth = Math.max(2, fontPx * 0.18);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(20,14,6,0.9)';
  ctx.strokeText(String(tier), nx, ny);
  ctx.fillStyle = '#ffe6a2';
  ctx.fillText(String(tier), nx, ny);
  ctx.restore();
}

function drawUnit(ctx: CanvasRenderingContext2D, type: UnitType, tier: number, x: number, y: number, size: number, faceLeft = false, badge?: { x: number; y: number; s: number }) {
  const s = size;
  // 不再画类型色底座：棋盘格与托盘都直接用透明立绘，无背景色
  const spr = sprite(unitAsset(type));
  if (spr) {
    // 立绘按 contain 缩放居中，铺满整格；各类型内容留白不同，按系数微调视觉大小
    const typeScale = type === 'monkey' ? 1.18 : type === 'archer' ? 1.1 : type === 'spear' ? 1.05 : 1; // 棍×1.18 / 射手×1.1 / 矛×1.05 / 骑手×1
    const box = s;
    const scale = Math.min(box / spr.width, box / spr.height) * typeScale;
    const dw = spr.width * scale;
    const dh = spr.height * scale;
    ctx.save();
    // 仅射手/骑手朝左攻击时水平翻转立绘（矛/棍不翻转）
    if (faceLeft && (type === 'archer' || type === 'cavalry')) { ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0); }
    ctx.drawImage(spr, x - dw / 2, y - dh / 2, dw, dh);
    ctx.restore();
  } else {
    ctx.fillStyle = '#1a1208';
    ctx.font = `bold ${Math.round(s * 0.42)}px "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(UNIT_LABEL[type], x, y - s * 0.06);
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
  drawWeaponGlyph(ctx, type, s, pulse, combo);
  // 朝向箭头（出招时格上显示方向，呼应截图里的 →）
  if (type !== 'monkey') {
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

// 在已 translate 到单位中心、rotate 到 dir 的坐标系里，绘制单个兵器（沿 +x 出招）
function drawWeaponGlyph(ctx: CanvasRenderingContext2D, type: UnitType, s: number, pulse: number, combo: number) {
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
    case 'cavalry': { // 骑：向前冲锋（双箭头 + 速度线 + 尘）
      ctx.strokeStyle = '#2c6a34';
      ctx.lineWidth = Math.max(2, s * 0.06);
      for (let i = 0; i < 2; i++) {
        const cx = s * (0.12 + i * 0.22 + pulse * 0.16);
        ctx.beginPath();
        ctx.moveTo(cx, -s * 0.14); ctx.lineTo(cx + s * 0.14, 0); ctx.lineTo(cx, s * 0.14);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(70,100,60,0.5)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const yy = (i - 1) * s * 0.13;
        ctx.beginPath(); ctx.moveTo(-s * 0.24, yy); ctx.lineTo(-s * 0.02, yy); ctx.stroke();
      }
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
    default: { // knife=棍猴：金箍棒从槽位旋转着探出(变大)再收回(变小)
      const phase = 1 - pulse; // 0→1 出招进度
      const env = Math.sin(phase * Math.PI); // 0→1→0：发出时慢慢变大，收回时慢慢变小
      ctx.save();
      ctx.translate(s * 0.55 * env, 0); // 朝目标(+x)探出，再收回槽位
      const sc = 0.5 + 0.7 * env; // 整体缩放随出/收变大变小
      ctx.scale(sc, sc);
      ctx.rotate(phase * Math.PI * 1.6); // 出招期间转约 3/4 圈（保留金箍棒旋转招牌感）
      const len = s * 0.624; // 棒长在原基础上缩短 1/5（0.78→0.624）
      const w = Math.max(3, s * 0.1);
      const grad = ctx.createLinearGradient(-len / 2, 0, len / 2, 0);
      grad.addColorStop(0, '#8a6a1e'); grad.addColorStop(0.5, '#f4d466'); grad.addColorStop(1, '#8a6a1e');
      ctx.strokeStyle = grad; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
      ctx.strokeStyle = '#5a3a10'; ctx.lineWidth = w * 0.42; // 两端金箍
      ctx.beginPath();
      ctx.moveTo(len * 0.34, 0); ctx.lineTo(len * 0.46, 0);
      ctx.moveTo(-len * 0.34, 0); ctx.lineTo(-len * 0.46, 0);
      ctx.stroke();
      ctx.restore();
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
  drawTangseng(ctx, b);
  drawMonsters(ctx, b);
  if (b.endless) drawEndlessPanel(ctx, b);
  else drawAiSide(ctx, b);
  drawUnits(ctx, b, ui);
  drawGenerals(ctx, b, ui);
  drawPeachTrees(ctx, b, ui);
  drawFx(ctx, b);
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
  drawPassivePopup(ctx, b, ui);
  drawDragGhost(ctx, b, ui);
  drawBanner(ctx, b);
}

// —— 候选区（征兵产出，手工拖到棋盘）——
const TRAY_LEFT = 64; // 左侧留给"营"标
const TRAY_SLOT = 66;
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
    drawUnit(ctx, token.type, token.tier, x, y, s);
  }
}

// 武将字牌：去掉宣纸底/边框，直接画金黄墨字（深棕描边保证清晰）+ 右上角统一阶数徽标
function drawWordTile(ctx: CanvasRenderingContext2D, char: string, tier: number, x: number, y: number, s: number, showTier = true) {
  ctx.font = `bold ${Math.round(s * 0.62)}px "PingFang SC", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 金黄字：先描深棕边再填金，无底框也能在各种格底上清晰可读
  ctx.lineWidth = Math.max(2.5, s * 0.07);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#5a3a08';
  ctx.strokeText(char, x, y + s * 0.02);
  ctx.fillStyle = '#f2b414';
  ctx.fillText(char, x, y + s * 0.02);
  // 阶数徽标（合成为激活武将时由 showTier=false 隐藏，改由武将整体阶数在右上角显示）
  if (showTier) {
    drawTierBadge(ctx, x + s * 0.42, y - s * 0.36, tier, Math.round(s * 0.3));
  }
}
function drawTray(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  // 底板：木质竖向渐变 + 描边
  const base = ctx.createLinearGradient(0, TRAY_Y, 0, TRAY_Y + TRAY_H);
  base.addColorStop(0, '#efe3c6');
  base.addColorStop(1, '#d9c39a');
  ctx.fillStyle = base;
  roundRect(ctx, 8, TRAY_Y, VIEW_W - 16, TRAY_H, 10);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#8a6a3a';
  ctx.stroke();
  // 立体倒角：顶部亮边、底部暗边
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,248,225,0.55)';
  ctx.beginPath();
  ctx.moveTo(14, TRAY_Y + 2); ctx.lineTo(VIEW_W - 14, TRAY_Y + 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(90,60,25,0.35)';
  ctx.beginPath();
  ctx.moveTo(14, TRAY_Y + TRAY_H - 2); ctx.lineTo(VIEW_W - 14, TRAY_Y + TRAY_H - 2);
  ctx.stroke();
  // 「营」招牌：优先用 Seedream 素材(camp)，未加载则画木牌+文字兜底
  const campSpr = sprite('camp');
  const campX = 12, campY = TRAY_Y + 5, campW = 46, campH = TRAY_H - 10;
  if (campSpr) {
    const s = Math.min(campW / campSpr.width, campH / campSpr.height); // 等比 contain
    const dw = campSpr.width * s, dh = campSpr.height * s;
    ctx.drawImage(campSpr, campX + (campW - dw) / 2, campY + (campH - dh) / 2, dw, dh);
  } else {
    const wood = ctx.createLinearGradient(0, campY, 0, campY + campH);
    wood.addColorStop(0, '#a06a34');
    wood.addColorStop(1, '#7d4f24');
    ctx.fillStyle = wood;
    roundRect(ctx, campX, campY, campW, campH, 8);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#5f3c1b';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,230,180,0.5)'; // 顶部高光条
    roundRect(ctx, campX + 3, campY + 3, campW - 6, 6, 3);
    ctx.fill();
    ctx.fillStyle = '#fff2d8';
    ctx.font = 'bold 24px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('营', campX + campW / 2, campY + campH / 2 + 1);
  }
  // 5 个候选槽：征兵丝带瞬间出现，再从「营」端缩短变细，消于槽位后出图标
  const HOLD = 0.01;
  const RETRACT_STAGGER = 0.08;
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
      const retractAt = HOLD + i * RETRACT_STAGGER;
      const t = b.summonAnimT;
      if (t < retractAt) {
        drawSummonRibbon(ctx, token, 0, 1, 1, c, i);
      } else if (t < retractAt + RETRACT_DUR) {
        const u = (t - retractAt) / RETRACT_DUR; // 0→1 从营收向槽
        // 长度从营端吃掉，同时整体变细（丝带慢慢变小）
        drawSummonRibbon(ctx, token, u, 1, 1 - u * 0.85, c, i);
      } else {
        drawTrayToken(ctx, token, c.x, c.y, TRAY_H - 16);
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
        // 可放置格：米白 + 内斜角高光 + 柔和投影
        ctx.save();
        ctx.shadowColor = 'rgba(60,50,35,0.28)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        roundRect(ctx, ix, iy, iw, ih, 2);
        ctx.fillStyle = th.cellUnlocked;
        ctx.fill();
        ctx.restore();
        // 顶部高光 + 底部内阴影（斜角立体感）
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ix + 4, iy + 2); ctx.lineTo(ix + iw - 4, iy + 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(120,105,80,0.35)';
        ctx.beginPath(); ctx.moveTo(ix + 4, iy + ih - 1.5); ctx.lineTo(ix + iw - 4, iy + ih - 1.5); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(70,60,45,0.35)';
        roundRect(ctx, ix, iy, iw, ih, 2); ctx.stroke();
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
  } else {
    // 流沙河：两扇闸门开合
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

// 中间栅栏：默认水平木栅栏（fenceGaps 开口）；白骨岭白骨堆；盘丝洞蛛丝网
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

// 流沙河：用 Seedream 生成的"浪花条"贴图一片一片平铺满整条中线栅栏，严格隔断上下半场
function drawLiushaheWaterFence(ctx: CanvasRenderingContext2D, _b: Battle) {
  const y = BOARD_Y + FENCE_ROW * CELL; // 栅栏线
  const spr = sprite('fence-liushahe');
  if (!spr || !spr.width) {
    // 素材未就绪时回退：一条纯色水带，避免出现空栅栏（不留缺口）
    ctx.save();
    ctx.fillStyle = 'rgba(60,120,140,0.92)';
    ctx.fillRect(BOARD_X, y - CELL * 0.22, COLS * CELL, CELL * 0.44);
    ctx.restore();
    return;
  }
  const boardW = COLS * CELL;
  // 单向浪花条：整条横铺满栅栏（同朝向、不翻转），严格隔断上下半场、不留缺口
  const drawH = CELL * 1.5; // 河带高度（略压扁，避免过高）
  ctx.save();
  ctx.drawImage(spr, BOARD_X, y - drawH / 2, boardW, drawH);
  ctx.restore();
}

// 盘丝洞：中线蛛丝篱笆（丝线 + 蛛网结 + 小茧），无开口
function drawPansidongSilkFence(ctx: CanvasRenderingContext2D, b: Battle) {
  const y = BOARD_Y + FENCE_ROW * CELL;
  const x0 = BOARD_X;
  const x1 = BOARD_X + COLS * CELL;
  const accent = b.map.theme.accent;
  ctx.save();
  // 底衬丝带
  ctx.strokeStyle = 'rgba(120,70,110,0.35)';
  ctx.lineWidth = CELL * 0.28;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  // 主丝线（多股微起伏）
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
  // 每隔一段一个蛛网结 / 小茧
  for (let c = 0; c < COLS; c++) {
    const cx = BOARD_X + c * CELL + CELL / 2;
    // 斜向交叉丝
    ctx.strokeStyle = 'rgba(230,200,220,0.75)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - 10, y - 9);
    ctx.lineTo(cx + 10, y + 9);
    ctx.moveTo(cx + 10, y - 9);
    ctx.lineTo(cx - 10, y + 9);
    ctx.stroke();
    // 网心小环
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, y, 4.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 小茧（偶发）
    if (c % 2 === 0) {
      ctx.fillStyle = 'rgba(245,230,240,0.92)';
      ctx.strokeStyle = 'rgba(130,80,120,0.7)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(cx, y - 8, 5.5, 7.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // 茧上细丝
      ctx.beginPath();
      ctx.moveTo(cx - 3, y - 12);
      ctx.quadraticCurveTo(cx, y - 8, cx + 3, y - 4);
      ctx.stroke();
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

function drawTangseng(ctx: CanvasRenderingContext2D, b: Battle) {
  const pos = b.tangsengRenderPos();
  const { x, y } = cellCenterPx(pos.c, pos.r);
  const rad = CELL * 0.46;
  // 金色光晕底座
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(x, y - 8, 4, x, y, rad);
  g.addColorStop(0, '#ffe9a8');
  g.addColorStop(1, '#d99a2b');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#8a5a12';
  ctx.stroke();

  const spr = sprite('tangseng');
  if (spr) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, rad - 2, 0, Math.PI * 2);
    ctx.clip();
    // cover 缩放填满圆
    const scale = Math.max((rad * 2) / spr.width, (rad * 2) / spr.height);
    const dw = spr.width * scale;
    const dh = spr.height * scale;
    ctx.drawImage(spr, x - dw / 2, y - dh / 2 - rad * 0.1, dw, dh);
    ctx.restore();
  } else {
    ctx.fillStyle = '#5a3a08';
    ctx.font = 'bold 26px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('唐', x, y);
  }
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

// 单个怪物渲染（图标/圆形兜底 + 墨风血条 + 受击闪白 + 技能环 + 入场缩放 + 行走摆动 + 地面阴影）
function drawMonsterAt(ctx: CanvasRenderingContext2D, x: number, y: number, rad0: number, m: { dist: number; hp: number; maxHp: number; isBoss: boolean; isCavalry?: boolean; hitFlash: number; skill: unknown; castFlash: number; spawnT: number }, mapId: string, trailDir = 1) {
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
  const spr = monsterSprite(mapId, m.isBoss);
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
  if (spr) {
    const box = rad * 2.3;
    const scale = Math.min(box / spr.width, box / spr.height);
    ctx.drawImage(spr, x - (spr.width * scale) / 2, cy - (spr.height * scale) / 2, spr.width * scale, spr.height * scale);
  } else {
    ctx.beginPath();
    ctx.arc(x, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = m.isBoss ? '#b02a5b' : '#7a2b2b';
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
  // 精英/BOSS 技能标识：彩色环 + 图标；施法瞬间脉冲光圈
  if (m.skill) {
    const meta = SKILL_META[m.skill as keyof typeof SKILL_META];
    ctx.save();
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, cy, rad + 3, 0, Math.PI * 2);
    ctx.stroke();
    if (m.castFlash > 0) {
      ctx.globalAlpha = m.castFlash;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, cy, rad + 3 + (1 - m.castFlash) * 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.font = `${Math.round(rad)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.icon, x, y - rad - 12);
    ctx.restore();
  }
}

function drawMonsters(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const m of b.monsters) {
    const p = posAtDistance(b.map, m.dist);
    const { x, y } = cellCenterPx(p.c, p.r);
    // 采样前方一小段求水平朝向（骑兵拖尾方向用）：向右移=+1，向左移=-1
    const np = posAtDistance(b.map, m.dist + 0.05);
    const trailDir = cellCenterPx(np.c, np.r).x - x >= 0 ? 1 : -1;
    drawMonsterAt(ctx, x, y, m.isBoss ? CELL * 0.42 : CELL * 0.28, m, b.map.id, trailDir);
  }
}

// 爆发特效：命中冲击环 / 击杀爆散 / 合成星爆
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
// 悟空 金箍棒大范围横扫金弧
function drawUltWukong(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const sweep = easeOut(p);
  const a0 = -Math.PI * 0.9, a1 = a0 + Math.PI * 1.8 * sweep;
  const rad = R * 0.9;
  ctx.globalAlpha = fade;
  const grad = ctx.createRadialGradient(x, y, rad * 0.2, x, y, rad);
  grad.addColorStop(0, 'rgba(255,243,196,0.05)');
  grad.addColorStop(1, 'rgba(240,185,60,0.35)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, rad, a0, a1); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#e8a11c'; ctx.lineWidth = 5 + tier;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a1) * rad, y + Math.sin(a1) * rad); ctx.stroke();
  ctx.strokeStyle = '#fff3c4'; ctx.lineWidth = 2;
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
    // 待机微动：轻微起伏，按格错相位避免整齐划一，让在场武器"活"起来
    const bob = Math.sin(t * 2 + (u.cell.c * 0.9 + u.cell.r * 1.7)) * 1.3;
    // 开火脉冲：放大 + 上跳
    const pulse = u.firePulse;
    const uy = y - pulse * 4 + bob;
    drawUnit(ctx, u.type, u.tier, x, uy, CELL * 0.72 * (1 + pulse * 0.16), u.fireDir != null && Math.cos(u.fireDir) < 0, { x, y, s: CELL * 0.72 });
    // 攻击瞬间：字→兵器形变，朝目标出招
    drawUnitWeapon(ctx, u.type, u.tier, x, uy, u.fireDir ?? -Math.PI / 2, pulse, u.combo);
    // 减益标识：被怪物技能命中时显示图标（定身/迟滞/弱身/缠丝）
    const debuff: string | null = u.stunT > 0 ? SKILL_META.stun.icon : u.slowT > 0 ? SKILL_META.slow.icon : u.weakenT > 0 ? SKILL_META.weaken.icon : u.rangeCutT > 0 ? SKILL_META.webbind.icon : null;
    if (debuff) {
      ctx.save();
      if (u.stunT > 0) {
        // 眩晕：整格泛黄闪烁
        ctx.globalAlpha = 0.3 + 0.2 * Math.sin(u.stunT * 12);
        roundRect(ctx, x - CELL * 0.36, y - CELL * 0.36, CELL * 0.72, CELL * 0.72, 8);
        ctx.fillStyle = SKILL_META.stun.color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(debuff, x + CELL * 0.28, y - CELL * 0.3);
      ctx.restore();
    }
  }
}

// 选中单位：攻击范围高亮 + 信息面板（点击某武器才显示，参考竞品单位面板）
// 点击字牌：高亮该字牌，若已激活则连同搭档格与攻击范围，并弹出武将信息面板
function drawWordSelection(ctx: CanvasRenderingContext2D, b: Battle, w: { char: string; general: string; tier: number; cell: { c: number; r: number } }) {
  const def = generalById(w.general);
  if (!def) return;
  const active = b.activeGenerals().find((g) => g.cells.some((cc) => cc.c === w.cell.c && cc.r === w.cell.r));
  const gx = BOARD_X + w.cell.c * CELL;
  const gy = BOARD_Y + w.cell.r * CELL;
  ctx.save();
  // 选中格金边
  roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffe08a';
  ctx.stroke();
  // 激活则画范围环 + 搭档格
  if (active) {
    const ax = (active.cells[0].c + active.cells[1].c) / 2;
    const ay = (active.cells[0].r + active.cells[1].r) / 2;
    const { x, y } = cellCenterPx(ax, ay);
    ctx.beginPath();
    ctx.arc(x, y, b.generalRge(active) * CELL, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(240,185,60,0.12)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(240,185,60,0.8)';
    ctx.setLineDash([7, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // 信息面板：固定显示在 AI 半场（行 0..FENCE_ROW）中央，避免遮住攻击范围环
  const pw = 194;
  const ph = active ? 150 : 134;
  const px = BOARD_X + (COLS * CELL) / 2 - pw / 2;
  const py = BOARD_Y + (FENCE_ROW * CELL) / 2 - ph / 2;
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
  // 技能（未激活时置灰并标注不生效）
  ctx.textAlign = 'left';
  ctx.fillStyle = active ? '#9ad8ff' : 'rgba(154,216,255,0.4)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(`技能「${def.skillName}」`, px + 12, py + 40);
  if (!active) {
    ctx.fillStyle = 'rgba(255,154,106,0.85)';
    ctx.font = '10px "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('未激活·不生效', px + pw - 12, py + 40);
    ctx.textAlign = 'left';
    ctx.font = '12px "PingFang SC", sans-serif';
  }
  ctx.fillStyle = active ? 'rgba(255,240,210,0.7)' : 'rgba(255,240,210,0.32)';
  ctx.fillText(def.skillDesc, px + 12, py + 56);
  // 属性（激活时计入等级/神兵）
  const rows: [string, string][] = active
    ? [
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
  if (active) {
    ctx.fillStyle = '#7ec46a';
    ctx.font = 'bold 12px "PingFang SC", sans-serif';
    ctx.fillText('✓ 已激活（金框生效）', px + 12, py + ph - 12);
  } else {
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
  ctx.arc(x, y, rangeCells * CELL, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(90,150,70,0.16)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(120,200,90,0.85)';
  ctx.setLineDash([7, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawSelection(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (!ui.selected) return;
  const tree = b.trees.get(`${ui.selected.c},${ui.selected.r}`);
  if (tree) { drawTreeSelection(ctx, b, tree); return; }
  const w = b.words.get(`${ui.selected.c},${ui.selected.r}`);
  if (w) { drawWordSelection(ctx, b, w); return; }
  const u = b.units.get(`${ui.selected.c},${ui.selected.r}`);
  if (!u) return;
  const { x, y } = cellCenterPx(u.cell.c, u.cell.r);
  const stat = getUnitStat(u.type, u.tier);
  // 攻击范围环
  drawRangeRing(ctx, x, y, stat.rge);
  ctx.save();
  // 选中格描边
  const gx = BOARD_X + u.cell.c * CELL;
  const gy = BOARD_Y + u.cell.r * CELL;
  roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffe08a';
  ctx.stroke();
  ctx.restore();

  // 信息面板：名称/等级 + 攻击力/攻速/范围/目标/法宝
  const cfg = UNITS[u.type];
  const pw = 176;
  const ph = 120;
  // 固定显示在 AI 半场（行 0..FENCE_ROW）中央，避免遮住玩家半场部署单位的攻击范围环
  const px = BOARD_X + (COLS * CELL) / 2 - pw / 2;
  const py = BOARD_Y + (FENCE_ROW * CELL) / 2 - ph / 2;
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
  ctx.fillText(`Lv.${u.tier}`, px + pw - 12, py + 18);
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
  // 已激活武将占用的格 → 抹掉单字阶数上标（只保留金框上方整体 Lv）
  const activeCells = new Set<string>();
  for (const g of b.activeGenerals()) for (const c of g.cells) activeCells.add(`${c.c},${c.r}`);
  // 先画所有字牌（拖拽中的源格隐藏）
  for (const w of b.words.values()) {
    if (ui.dragFrom && ui.dragFrom.c === w.cell.c && ui.dragFrom.r === w.cell.r) continue;
    const { x, y } = cellCenterPx(w.cell.c, w.cell.r);
    drawWordTile(ctx, w.char, w.tier, x, y, CELL * 0.78, !activeCells.has(`${w.cell.c},${w.cell.r}`));
  }
  // 再给「左右紧邻同将」的激活武将套金框
  for (const g of b.activeGenerals()) {
    const a = cellCenterPx(g.cells[0].c, g.cells[0].r);
    const z = cellCenterPx(g.cells[1].c, g.cells[1].r);
    const x = Math.min(a.x, z.x) - CELL / 2 + 2;
    const y = Math.min(a.y, z.y) - CELL / 2 + 2;
    const w = Math.abs(z.x - a.x) + CELL - 4;
    const h = CELL - 4;
    ctx.save();
    // 金框（激活标识）+ 释放技能时更亮
    const glow = 0.65 + 0.35 * Math.sin(performance.now() / 220) + g.state.skillFlash * 0.5;
    ctx.globalAlpha = Math.min(1, glow);
    ctx.strokeStyle = '#f0b93c';
    ctx.lineWidth = 3.5;
    roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 名号（框上方小标，去掉 Lv 等级样式）
    ctx.fillStyle = '#7a4a10';
    ctx.font = `bold 11px "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${g.def.name}`, x + w / 2, y - 1);
    // 武将整体阶数：统一徽标显示在组合右上角（右字牌那格）
    const sTile = CELL * 0.78;
    drawTierBadge(ctx, z.x + sTile * 0.42, z.y - sTile * 0.36, g.tier, Math.round(sTile * 0.3));
    // 经验条
    const need = 10 * g.state.level;
    const pct = Math.max(0, Math.min(1, g.state.exp / need));
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 4, y + h - 4, w - 8, 3);
    ctx.fillStyle = '#7ec46a';
    ctx.fillRect(x + 4, y + h - 4, (w - 8) * pct, 3);
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
      case 'monkey': {
        // 棍猴：金箍棒 起转(清晰)→加速(化为残影盘)→减速(重现清晰) 的一次挥舞
        const turns = 2 + tier;
        const eio = prog < 0.5 ? 2 * prog * prog : 1 - Math.pow(-2 * prog + 2, 2) / 2; // ease-in-out：两端慢中间快
        const spin = turns * Math.PI * 2 * eio;
        const blur = Math.pow(Math.sin(Math.PI * prog), 3); // 残影只在中段短暂出现，两端留足清晰加/减速
        const len = CELL * (0.24 + tier * 0.10); // 初级更短小，随阶明显变长（1阶≈0.34 / 5阶≈0.74）
        const baseA = Math.min(1, 1.4 - prog);
        const lw = 4 + tier * 1.1;
        ctx.translate(t.x, t.y);
        ctx.lineCap = 'round';
        // 高速段的残影盘（发光渐变 + 两段扫动亮弧），随 blur 淡入淡出
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
        // 实心棒：两端慢时清晰(alpha 高)，高速中段淡出让位给残影盘
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
        // 骑：疾冲速度线 + 冲锋楔形头 + 命中处新月扫击 & 尘土冲击环(AOE 感)
        const dirX = Math.cos(ang), dirY = Math.sin(ang);
        const perpX = -Math.sin(ang), perpY = Math.cos(ang);
        // 速度线（几条平行拖尾，表现冲刺）；初级拖尾更短，随阶明显拉长
        ctx.globalAlpha = 0.55 * (f.ttl / f.maxTtl);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        const trail = 9 + tier * 4.5;
        for (const k of [-1, 0, 1]) {
          const off = k * (3 + tier * 1.2);
          ctx.beginPath();
          ctx.moveTo(x - dirX * trail + perpX * off, y - dirY * trail + perpY * off);
          ctx.lineTo(x + perpX * off, y + perpY * off);
          ctx.stroke();
        }
        // 冲锋楔形头 ">"
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2.5 + tier * 0.6;
        const hs = 5 + tier * 1.2;
        ctx.beginPath();
        ctx.moveTo(x - dirX * hs + perpX * hs, y - dirY * hs + perpY * hs);
        ctx.lineTo(x, y);
        ctx.lineTo(x - dirX * hs - perpX * hs, y - dirY * hs - perpY * hs);
        ctx.stroke();
        // 命中：新月扫击 + 尘土冲击环
        if (prog > 0.5) {
          const k = (prog - 0.5) / 0.5;
          ctx.globalAlpha = 1 - k;
          // 新月扫击弧
          ctx.strokeStyle = '#fff3d0';
          ctx.lineWidth = 3 + tier * 1.1;
          ctx.beginPath();
          ctx.arc(t.x, t.y, CELL * (0.24 + tier * 0.075), ang - 1.2, ang + 1.2);
          ctx.stroke();
          // 尘土冲击环
          ctx.strokeStyle = 'rgba(180,150,110,0.8)';
          ctx.lineWidth = 2.5 + tier * 0.5;
          ctx.beginPath();
          ctx.arc(t.x, t.y, 6 + k * (24 + tier * 24), 0, Math.PI * 2);
          ctx.stroke();
        }
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
    drawMonsterAt(ctx, x, y, m.isBoss ? CELL * 0.42 : CELL * 0.28, m, b.map.id, trailDir);
  }
  // AI 单位（上半场自动部署）
  const t = performance.now() / 1000;
  for (const u of b.aiUnits) {
    const { x, y } = cellCenterPx(u.cell.c, u.cell.r);
    const bob = Math.sin(t * 2 + (u.cell.c * 0.9 + u.cell.r * 1.7)) * 1.1;
    const uy = y - u.firePulse * 3 + bob;
    drawUnit(ctx, u.type, u.tier, x, uy, CELL * 0.66 * (1 + u.firePulse * 0.14), u.fireDir != null && Math.cos(u.fireDir) < 0, { x, y, s: CELL * 0.66 });
    drawUnitWeapon(ctx, u.type, u.tier, x, uy, u.fireDir ?? Math.PI / 2, u.firePulse, u.combo);
  }
  // 对手终点：唐僧立绘（不再用「斗」字）
  const tp = b.aiTangsengRenderPos();
  const { x, y } = cellCenterPx(tp.c, tp.r);
  const rad = CELL * 0.42;
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(x, y - 8, 4, x, y, rad);
  g.addColorStop(0, '#cfd0ee');
  g.addColorStop(1, '#8a86c0'); // 对手唐僧用冷色调区分敌我
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#5a5a8a';
  ctx.stroke();
  const spr = sprite('tangseng');
  if (spr) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, rad - 2, 0, Math.PI * 2);
    ctx.clip();
    const scale = Math.max((rad * 2) / spr.width, (rad * 2) / spr.height);
    ctx.drawImage(spr, x - (spr.width * scale) / 2, y - (spr.height * scale) / 2 - rad * 0.1, spr.width * scale, spr.height * scale);
    ctx.restore();
  } else {
    ctx.fillStyle = '#3a3a6a';
    ctx.font = 'bold 22px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('唐', x, y);
  }
  ctx.fillStyle = b.aiDefeated ? '#9a9a9a' : '#7a5aa0';
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(b.aiDefeated ? '对手已败' : `对手唐僧 ❤${b.aiTangsengHP}`, x, y - rad - 12);
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
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#b5391f';
  ctx.font = 'bold 22px "PingFang SC", sans-serif';
  ctx.fillText('无尽 · 试炼', cx, panelY + 26);

  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 30px "PingFang SC", sans-serif';
  ctx.fillText(`第 ${b.wave} 波`, cx, panelY + 62);
  ctx.fillStyle = '#8a5a2b';
  ctx.font = '16px "PingFang SC", sans-serif';
  ctx.fillText(`历史最高：第 ${endlessBestWaveCached()} 波`, cx, panelY + 90);

  const tip = ENDLESS_TIPS[Math.floor(performance.now() / 4000) % ENDLESS_TIPS.length]!;
  ctx.fillStyle = '#7a3b12';
  ctx.font = '15px "PingFang SC", sans-serif';
  ctx.fillText('💡 ' + tip, cx, panelY + panelH - 22);

  ctx.restore();
}

// 危险提示：怪物距唐僧≤3格时，在唐僧所在格叠加红色呼吸描边 + "危险"标签（玩家/AI 两侧）
function drawDanger(ctx: CanvasRenderingContext2D, b: Battle) {
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 140);
  const mark = (cx: number, cy: number) => {
    const gx = BOARD_X + cx * CELL;
    const gy = BOARD_Y + cy * CELL;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.4 * pulse;
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = 4;
    roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
    ctx.stroke();
    ctx.globalAlpha = 0.15 + 0.2 * pulse;
    ctx.fillStyle = '#ff3b3b';
    roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
    ctx.fill();
    ctx.globalAlpha = 0.7 + 0.3 * pulse;
    ctx.fillStyle = '#ffe0e0';
    ctx.font = 'bold 13px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('危险', gx + CELL / 2, gy + CELL / 2);
    ctx.restore();
  };
  if (b.status === 'playing' && b.dangerNear()) {
    const t = b.map.tangseng;
    mark(t.c, t.r);
  }
  if (b.status === 'playing' && !b.aiDefeated && b.aiDangerNear()) {
    mark(b.aiTangseng.c, b.aiTangseng.r);
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
  ctx.fillStyle = '#7a3b12';
  ctx.font = 'bold 24px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`🍑 ${b.peach}`, 20, HUD_H / 2);
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

function drawButtons(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const btn of getButtons(b)) {
    // 主动技能图标(act*)与被动技能格(pas*)由 drawActiveIcons/drawPassiveRow 单独绘制，这里只出命中矩形
    if (btn.id.startsWith('act') || btn.id.startsWith('pas')) continue;
    roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 12);
    ctx.fillStyle = btn.enabled ? b.map.theme.accent : '#3a3128';
    ctx.fill();
    {
      // 征兵按钮：按当前蟠桃/成本填充进度条（参考竞品，桃攒够即满格可点）
      if (btn.id === 'summon') {
        const prog = Math.max(0, Math.min(1, b.peach / b.effectiveSummonCost()));
        if (!btn.enabled && prog > 0) {
          ctx.save();
          ctx.beginPath();
          roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 12);
          ctx.clip();
          ctx.fillStyle = b.map.theme.accent;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(btn.x, btn.y, btn.w * prog, btn.h);
          ctx.restore();
        }
      }
      ctx.fillStyle = btn.enabled ? '#fff6e6' : '#7a7160';
      ctx.font = `bold ${btn.w < 140 ? 16 : 20}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2);
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
    return a.char === b.char && a.tier === b.tier && b.tier < MAX_TIER;
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
        ghost = () => drawWordTile(ctx, w.char, w.tier, ui.dragPos!.x, ui.dragPos!.y, CELL * 0.74);
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
      ghost = () => drawTrayToken(ctx, token, ui.dragPos!.x, ui.dragPos!.y, CELL * 0.7);
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

    if (ui.dragTrayIndex !== null) {
      const token = b.tray[ui.dragTrayIndex];
      if (token && token.kind === 'unit' && trayTokenCanDropOnCell(b, token, target)) {
        const center = cellCenterPx(target.c, target.r);
        const stat = getUnitStat(token.type, token.tier);
        drawRangeRing(ctx, center.x, center.y, stat.rge);
      }
    } else if (ui.dragFrom) {
      // 棋盘内拖兵种时同样预览落点范围
      const u = b.units.get(`${ui.dragFrom.c},${ui.dragFrom.r}`);
      if (u && b.unlockedCells().some((c) => c.c === target.c && c.r === target.r)) {
        const center = cellCenterPx(target.c, target.r);
        const stat = getUnitStat(u.type, u.tier);
        drawRangeRing(ctx, center.x, center.y, stat.rge);
      }
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
