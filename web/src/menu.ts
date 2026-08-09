// 主菜单渲染 + 按钮命中。
import { VIEW_W, VIEW_H } from './render';
import { sprite } from './assets';
import { STAMINA_MAX, STAMINA_COST } from './stamina';
import { STARS_PER_TIER } from './rank';
import {
  roundRect,
  drawInkResourceBar,
  drawInkPlusButton,
  drawInkCheckbox,
  drawRankStars,
  drawMenuSpriteButton,
  inkCheckboxCenteredLayout,
  menuInteract,
  applyMenuInteract,
} from './menu-ui';

export interface MenuButton {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MenuInfo {
  rankStars: number;
  rankName: string;
  stamina: number;
  merit: number;
  mapName: string;
  mapDaily: boolean;
  toast: string;
  endlessOn: boolean;
  pressedId: string | null;
  hoverId: string | null;
}

const TOP = 18;
const BAR_H = 34;
const BAR_GAP = 8;
const HEADER_BLOCK_H = BAR_H * 2 + BAR_GAP;
const AVATAR_SIZE = 70;
const AVATAR = { x: 16, y: TOP + (HEADER_BLOCK_H - AVATAR_SIZE) / 2, w: AVATAR_SIZE, h: AVATAR_SIZE };
const BAR_X = AVATAR.x + AVATAR_SIZE + 10;
const BAR_W = 228;
const MERIT_BAR = { x: BAR_X, y: TOP, w: BAR_W, h: BAR_H };
const STAMINA_BAR = { x: BAR_X, y: TOP + BAR_H + BAR_GAP, w: BAR_W, h: BAR_H };
const PLUS_INSET = 4;
const PLUS = BAR_H - PLUS_INSET * 2;
export const STAMINA_PLUS_BTN = {
  x: STAMINA_BAR.x + STAMINA_BAR.w - PLUS - PLUS_INSET,
  y: STAMINA_BAR.y + PLUS_INSET,
  w: PLUS,
  h: PLUS,
};
const MAP_PICK_W = 264;
const MAP_PICK_H = 40;
export const MAP_PICK_BTN = {
  x: VIEW_W / 2 - MAP_PICK_W / 2,
  y: 528,
  w: MAP_PICK_W,
  h: MAP_PICK_H,
};

const SIDE = 96;
const SIDE_X = 16;
const SIDE_Y0 = 108;
const SIDE_GAP = 8;
const SIDE_BTN = { x: SIDE_X, w: SIDE, h: SIDE };
const START_W = 372;
const START_H = 94;
const START_Y = 620;
export const MENU_START_BTN_Y = START_Y;
/** 首页飘字起点：开始按钮上缘再往上 20px */
export function menuStartToastAnchorY(): number {
  return START_Y - 20;
}
const START_BTN = { x: (VIEW_W - START_W) / 2, y: START_Y, w: START_W, h: START_H };
const ENDLESS_GAP = 10;

/** 与 menu-home 底图一致的宣纸暖色（资源未加载时的 fallback） */
const MENU_PAPER_TOP = '#f0e4c8';
const MENU_PAPER_MID = '#dec18e';
const MENU_PAPER_LOW = '#d4b878';
const MENU_PAPER_BOTTOM = '#c8a068';
const MENU_PAPER_WASH = 'rgba(240,233,220,0.5)';

function drawMenuPaperFallback(ctx: CanvasRenderingContext2D): void {
  const paper = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  paper.addColorStop(0, MENU_PAPER_TOP);
  paper.addColorStop(0.38, MENU_PAPER_MID);
  paper.addColorStop(0.72, MENU_PAPER_LOW);
  paper.addColorStop(1, MENU_PAPER_BOTTOM);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const side = ctx.createLinearGradient(0, 0, VIEW_W, 0);
  side.addColorStop(0, 'rgba(120,110,98,0.22)');
  side.addColorStop(0.1, 'rgba(120,110,98,0)');
  side.addColorStop(0.9, 'rgba(120,110,98,0)');
  side.addColorStop(1, 'rgba(120,110,98,0.22)');
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}
const ENDLESS_LABEL = '无尽模式';
const ENDLESS_ROW_Y = START_Y + START_H + ENDLESS_GAP;
const ENDLESS_HIT = { x: VIEW_W / 2 - 72, y: ENDLESS_ROW_Y - 8, w: 144, h: 34 };
const BOTTOM_H = 98;
const BOTTOM_W = 262;
const BOTTOM_Y = 866;
const BAG_SIZE = 92;
const RANK_BTN = { x: 16, y: BOTTOM_Y, w: BOTTOM_W, h: BOTTOM_H };
const BAG_BTN = {
  x: RANK_BTN.x + RANK_BTN.w + 16 + 60,
  y: BOTTOM_Y + (BOTTOM_H - BAG_SIZE) / 2 + 10,
  w: BAG_SIZE,
  h: BAG_SIZE,
};

export function menuButtons(): MenuButton[] {
  return [
    { id: 'settings', ...SIDE_BTN, y: SIDE_Y0 },
    { id: 'codex', ...SIDE_BTN, y: SIDE_Y0 + SIDE + SIDE_GAP },
    { id: 'staminaPlus', ...STAMINA_PLUS_BTN },
    { id: 'mapPick', ...MAP_PICK_BTN },
    { id: 'endless', ...ENDLESS_HIT },
    { id: 'start', ...START_BTN },
    { id: 'rank', ...RANK_BTN },
    { id: 'bag', ...BAG_BTN },
  ];
}

export function menuButtonAt(x: number, y: number): string | null {
  for (const b of menuButtons()) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
  }
  return null;
}

function drawMenuBackground(ctx: CanvasRenderingContext2D): void {
  drawMenuPaperFallback(ctx);
  const bg = sprite('menu-home');
  if (bg) {
    const scale = Math.max(VIEW_W / bg.width, VIEW_H / bg.height);
    const dw = bg.width * scale;
    const dh = bg.height * scale;
    ctx.drawImage(bg, (VIEW_W - dw) / 2, (VIEW_H - dh) / 2, dw, dh);
    ctx.fillStyle = MENU_PAPER_WASH;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

/** 首页主标题：深色描边 + 金字渐变，避免水墨背景上发飘 */
function drawMenuTitle(ctx: CanvasRenderingContext2D, text: string, cx: number, baselineY: number): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 46px "Songti SC", "SimSun", "STSong", "PingFang SC", serif';
  const textW = ctx.measureText(text).width;

  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = 'rgba(38,22,8,0.82)';
  ctx.lineWidth = 5;
  ctx.strokeText(text, cx, baselineY);
  ctx.strokeStyle = 'rgba(255,232,180,0.45)';
  ctx.lineWidth = 2;
  ctx.strokeText(text, cx, baselineY);

  const grad = ctx.createLinearGradient(cx - textW / 2, baselineY - 36, cx + textW / 2, baselineY);
  grad.addColorStop(0, '#fff2c8');
  grad.addColorStop(0.45, '#ffd76a');
  grad.addColorStop(1, '#b86a28');
  ctx.fillStyle = grad;
  ctx.fillText(text, cx, baselineY);
  ctx.restore();
}

export function drawMenu(ctx: CanvasRenderingContext2D, info: MenuInfo): void {
  drawMenuBackground(ctx);

  roundRect(ctx, AVATAR.x, AVATAR.y, AVATAR.w, AVATAR.h, 12);
  ctx.fillStyle = 'rgba(40,25,10,0.5)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,160,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  const av = sprite('hero-wukong');
  if (av) {
    const s = AVATAR.w - 8;
    const scale = Math.min(s / av.width, s / av.height);
    ctx.drawImage(av, AVATAR.x + 4, AVATAR.y + 4, av.width * scale, av.height * scale);
  }

  drawInkResourceBar(ctx, MERIT_BAR, '功德', String(info.merit));
  drawInkResourceBar(
    ctx,
    STAMINA_BAR,
    '体力',
    `${info.stamina}/${STAMINA_MAX}`,
    STAMINA_PLUS_BTN.w + PLUS_INSET + 6,
  );
  drawInkPlusButton(ctx, STAMINA_PLUS_BTN, menuInteract(info.pressedId, info.hoverId, 'staminaPlus'), 'inset');

  const titleY = 153;
  const rankBlockDy = 15;
  const rankTitleGap = 8;
  const rankY = 182 + rankBlockDy + rankTitleGap;
  const starsY = rankY + 30;

  drawMenuTitle(ctx, '大圣与唐僧', VIEW_W / 2, titleY);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 18px "PingFang SC", serif';
  ctx.fillText(`境界 · ${info.rankName}`, VIEW_W / 2, rankY);
  drawRankStars(ctx, VIEW_W / 2, starsY, Math.min(STARS_PER_TIER, info.rankStars));

  const platY = 350 + rankBlockDy;
  const bob = Math.sin(performance.now() / 1000 * 2.1) * 5;
  const heroSpr = sprite('hero-wukong');
  let heroFootY = platY + 118;
  if (heroSpr) {
    const size = 240;
    const scale = Math.min(size / heroSpr.width, size / heroSpr.height);
    const dw = heroSpr.width * scale;
    const dh = heroSpr.height * scale;
    const drawY = platY - dh / 2 + bob;
    heroFootY = drawY + dh * 0.92;
    ctx.fillStyle = 'rgba(55,38,22,0.36)';
    ctx.beginPath();
    ctx.ellipse(VIEW_W / 2, heroFootY + 5, 100, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(heroSpr, VIEW_W / 2 - dw / 2, drawY, dw, dh);
  } else {
    ctx.fillStyle = 'rgba(55,38,22,0.36)';
    ctx.beginPath();
    ctx.ellipse(VIEW_W / 2, heroFootY + 5, 100, 18, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const mapInteract = menuInteract(info.pressedId, info.hoverId, 'mapPick');
  ctx.save();
  applyMenuInteract(ctx, MAP_PICK_BTN, mapInteract);
  const mapR = MAP_PICK_BTN.h / 2;
  roundRect(ctx, MAP_PICK_BTN.x, MAP_PICK_BTN.y, MAP_PICK_BTN.w, MAP_PICK_BTN.h, mapR);
  ctx.fillStyle =
    mapInteract === 'pressed' ? 'rgba(48,28,12,0.42)' : mapInteract === 'hover' ? 'rgba(48,28,12,0.3)' : 'rgba(48,28,12,0.2)';
  ctx.fill();
  ctx.strokeStyle = mapInteract === 'hover' ? 'rgba(255,220,160,0.5)' : 'rgba(255,220,160,0.32)';
  ctx.lineWidth = mapInteract === 'hover' ? 2 : 1.5;
  ctx.stroke();
  const mapLabel = info.mapDaily ? `今日关卡 · ${info.mapName}` : `关卡 · ${info.mapName}`;
  const mapCx = MAP_PICK_BTN.x + MAP_PICK_BTN.w / 2;
  const mapCy = MAP_PICK_BTN.y + MAP_PICK_BTN.h / 2;
  ctx.font = 'bold 16px "PingFang SC", "STKaiti", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(40,25,10,0.9)';
  ctx.lineWidth = 4;
  ctx.strokeText(`${mapLabel}  ›`, mapCx, mapCy);
  ctx.fillStyle = '#fff8ee';
  ctx.fillText(`${mapLabel}  ›`, mapCx, mapCy);
  ctx.restore();

  for (const b of menuButtons()) {
    const interact = menuInteract(info.pressedId, info.hoverId, b.id);
    if (b.id === 'staminaPlus' || b.id === 'mapPick') continue;
    if (b.id === 'settings') {
      drawMenuSpriteButton(ctx, sprite('menu-btn-settings'), b, interact, 'none', '设置', 'secondary', 'cover');
      continue;
    }
    if (b.id === 'codex') {
      drawMenuSpriteButton(ctx, sprite('menu-btn-codex'), b, interact, 'none', '图鉴', 'secondary', 'cover');
      continue;
    }
    if (b.id === 'rank') {
      drawMenuSpriteButton(ctx, sprite('menu-btn-rank'), b, interact, 'none', '排行榜', 'secondary', 'cover');
      continue;
    }
    if (b.id === 'bag') {
      drawMenuSpriteButton(ctx, sprite('menu-btn-bag'), b, interact, 'none', undefined, 'secondary', 'contain', true);
      continue;
    }
    if (b.id === 'start') {
      drawMenuSpriteButton(
        ctx,
        sprite('menu-btn-start'),
        b,
        interact,
        'cta',
        `开始游戏 · ${STAMINA_COST}体力`,
        'primary',
        'cover',
      );
      continue;
    }
    if (b.id === 'endless') {
      const endless = inkCheckboxCenteredLayout(ctx, VIEW_W / 2, ENDLESS_ROW_Y, ENDLESS_LABEL);
      drawInkCheckbox(ctx, endless.box, ENDLESS_LABEL, info.endlessOn, interact);
    }
  }

  if (info.toast) {
    ctx.fillStyle = '#8a3010';
    ctx.font = '15px "PingFang SC", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(info.toast, VIEW_W / 2, VIEW_H - 20);
  }
}
