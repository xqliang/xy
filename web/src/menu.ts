// 主菜单渲染 + 按钮命中。
import { VIEW_W, VIEW_H } from './render';
import { sprite } from './assets';
import { isWeChat } from './platform';
import { STAMINA_MAX, STAMINA_COST } from './stamina';
import { MERIT_MAX } from './merit';
import { STARS_PER_TIER } from './rank';
import { APP_VERSION } from './version';
import {
  roundRect,
  drawInkActionButton,
  drawInkResourceBar,
  drawInkPlusButton,
  drawInkCheckbox,
  drawRankStars,
  drawMenuSpriteButton,
  inkCheckboxCenteredLayout,
  menuInteract,
  applyMenuInteract,
  type MenuInteract,
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
  /** sprite key for profile avatar */
  avatarArt?: string;
}

const TOP = 18;
const BAR_H = 34;
const BAR_GAP = 8;
const HEADER_BLOCK_H = BAR_H * 2 + BAR_GAP;
const AVATAR_SIZE = 70;
const AVATAR = { x: 20, y: TOP + (HEADER_BLOCK_H - AVATAR_SIZE) / 2, w: AVATAR_SIZE, h: AVATAR_SIZE }; // x:16→20 右移与设置按钮左对齐
const BAR_X = AVATAR.x + AVATAR_SIZE + 10;
const BAR_W = 150; // 功德/体力条宽度（原 228）
const MERIT_BAR = { x: BAR_X, y: TOP, w: BAR_W, h: BAR_H };
const STAMINA_BAR = { x: BAR_X, y: TOP + BAR_H + BAR_GAP, w: BAR_W, h: BAR_H };
const STAMINA_PLUS_SIZE = 32;
const STAMINA_PLUS_INSET = 2;
export const STAMINA_PLUS_BTN = {
  x: STAMINA_BAR.x + STAMINA_BAR.w - STAMINA_PLUS_SIZE - STAMINA_PLUS_INSET,
  y: STAMINA_BAR.y + (STAMINA_BAR.h - STAMINA_PLUS_SIZE) / 2,
  w: STAMINA_PLUS_SIZE,
  h: STAMINA_PLUS_SIZE,
};
const MAP_PICK_W = 264;
const MAP_PICK_H = 40;
export const MAP_PICK_BTN = {
  x: VIEW_W / 2 - MAP_PICK_W / 2,
  y: 538,
  w: MAP_PICK_W,
  h: MAP_PICK_H,
};

const SIDE = 96;
const SIDE_X = 16;
const SIDE_Y0 = 123;
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
  x: RANK_BTN.x + RANK_BTN.w + 16 + 60 + 15,
  y: BOTTOM_Y + (BOTTOM_H - BAG_SIZE) / 2 + 10,
  w: BAG_SIZE,
  h: BAG_SIZE,
};
// PvP 入口：无尽行下方、底部栏上方的空档，左右并排（与开始按钮同总宽居中）
const PVP_ROW_Y = 772;
const PVP_BTN_H = 64;
const PVP_GAP = 12;
// 两个按钮总宽 = START_W - 中间间隔；与「开始」按钮同总宽，保持左右栏对齐
const PVP_BTN_W = (START_W - PVP_GAP) / 2;
const PVP_ROW_X = (VIEW_W - START_W) / 2;
const PVP_MATCH_BTN = { x: PVP_ROW_X, y: PVP_ROW_Y, w: PVP_BTN_W, h: PVP_BTN_H };
const PVP_INVITE_BTN = { x: PVP_ROW_X + PVP_BTN_W + PVP_GAP, y: PVP_ROW_Y, w: PVP_BTN_W, h: PVP_BTN_H };

export function menuButtons(): MenuButton[] {
  return [
    { id: 'avatar', ...AVATAR },
    { id: 'settings', ...SIDE_BTN, y: SIDE_Y0 },
    { id: 'codex', ...SIDE_BTN, y: SIDE_Y0 + SIDE + SIDE_GAP },
    { id: 'help', ...SIDE_BTN, y: SIDE_Y0 + (SIDE + SIDE_GAP) * 2 },
    { id: 'staminaPlus', ...STAMINA_PLUS_BTN },
    { id: 'mapPick', ...MAP_PICK_BTN },
    { id: 'endless', ...ENDLESS_HIT },
    { id: 'start', ...START_BTN },
    { id: 'pvpMatch', ...PVP_MATCH_BTN },
    { id: 'pvpInvite', ...PVP_INVITE_BTN },
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

/** 首页「说明」侧栏按钮：无底板，仅问号徽记 */
function drawHelpMenuButton(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  interact: MenuInteract,
): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  ctx.save();
  applyMenuInteract(ctx, rect, interact);

  const badgeR = 22;
  ctx.beginPath();
  ctx.arc(cx, cy, badgeR, 0, Math.PI * 2);
  ctx.fillStyle =
    interact === 'pressed' ? 'rgba(160,70,50,0.95)' : interact === 'hover' ? 'rgba(190,100,75,0.95)' : 'rgba(180,90,70,0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,48,20,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#fff8ee';
  ctx.font = 'bold 26px "Songti SC", "STSong", "PingFang SC", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', cx, cy + 1);
  ctx.restore();
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
export function drawMenuTitle(ctx: CanvasRenderingContext2D, text: string, cx: number, baselineY: number): void {
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
  // 小游戏下首页背景改由 drawScreenBackdrop 铺满整屏(含黑边)，此处跳过，避免 VIEW 内外两套缩放接缝/双重底。
  if (!isWeChat) drawMenuBackground(ctx);

  roundRect(ctx, AVATAR.x, AVATAR.y, AVATAR.w, AVATAR.h, 12);
  // 暖玉色底板，贴合首页宣纸/金色调（避免冷灰）
  const avBg = ctx.createLinearGradient(AVATAR.x, AVATAR.y, AVATAR.x, AVATAR.y + AVATAR.h);
  avBg.addColorStop(0, 'rgba(255,236,196,0.92)');
  avBg.addColorStop(1, 'rgba(220,170,100,0.88)');
  ctx.fillStyle = avBg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(170,110,40,0.65)';
  ctx.lineWidth = 2;
  ctx.stroke();
  const av = sprite(info.avatarArt || 'hero-wukong');
  if (av) {
    const s = AVATAR.w - 8;
    const scale = Math.min(s / av.width, s / av.height);
    const dw = av.width * scale;
    const dh = av.height * scale;
    // 长宽比非 1:1 的立绘（唐僧 0.72 / 观音 0.67 / 沙僧 0.85 等）按短边缩放后仍有余量，
    // 必须双轴居中——此前固定画在 (x+4, y+4) 左上角，瘦高立绘在头像框里全部偏左。
    ctx.drawImage(av, AVATAR.x + 4 + (s - dw) / 2, AVATAR.y + 4 + (s - dh) / 2, dw, dh);
  }

  drawInkResourceBar(ctx, MERIT_BAR, '功德', `${info.merit}/${MERIT_MAX}`, 0, 'icon-merit');
  drawInkResourceBar(
    ctx,
    STAMINA_BAR,
    '体力',
    `${info.stamina}/${STAMINA_MAX}`,
    STAMINA_PLUS_BTN.w + STAMINA_PLUS_INSET + 6,
    'icon-stamina',
  );
  drawInkPlusButton(ctx, STAMINA_PLUS_BTN, menuInteract(info.pressedId, info.hoverId, 'staminaPlus'), 'inset');

  const titleY = 168; // 153→168 标题下移 15px
  const rankBlockDy = 15;
  const rankTitleGap = 8;
  const rankY = 182 + rankBlockDy + rankTitleGap + 10; // 境界再下移 10px（星星随 starsY 同步下移）
  const starsY = rankY + 30;

  drawMenuTitle(ctx, '妖怪来袭', VIEW_W / 2, titleY);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 18px "PingFang SC", serif';
  ctx.fillText(`境界 · ${info.rankName}`, VIEW_W / 2, rankY);
  drawRankStars(ctx, VIEW_W / 2, starsY, Math.min(STARS_PER_TIER, info.rankStars));

  const platY = 350 + rankBlockDy + 20; // 中间头像再下移 20px
  const bob = Math.sin(performance.now() / 1000 * 2.1) * 5;
  const heroSpr = sprite(info.avatarArt || 'hero-wukong');
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
      const codexSpr = sprite('menu-btn-codex');
      drawMenuSpriteButton(ctx, codexSpr, b, interact, 'none', '图鉴', 'secondary', 'cover');
      // 「图鉴」文字程序化叠加：图鉴按钮图不再烘焙文字（Seedream 曾把「鉴」画错），
      // 位置/大小对齐 menu-btn-settings 烘焙「设置」的墨迹区（y 约 67%~85%，字号约按钮高 21%）。
      if (codexSpr) {
        ctx.save();
        // 不加粗、字号比设置按钮小一号（用户反馈），细描边补笔画清晰度
        ctx.font = `${Math.round(b.h * 0.2)}px "PingFang SC", "STKaiti", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(35,28,20,0.92)';
        ctx.strokeText('图鉴', b.x + b.w / 2, b.y + b.h * 0.76);
        ctx.fillStyle = 'rgba(35,28,20,0.92)';
        ctx.fillText('图鉴', b.x + b.w / 2, b.y + b.h * 0.76);
        ctx.restore();
      }
      continue;
    }
    if (b.id === 'help') {
      drawHelpMenuButton(ctx, b, interact);
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
    // PvP 入口：水墨按钮。真人对战为主操作（primary）、邀请好友为次操作（secondary）
    if (b.id === 'pvpMatch') {
      drawInkActionButton(ctx, b, '真人对战', info.pressedId === 'pvpMatch', 'primary');
      continue;
    }
    if (b.id === 'pvpInvite') {
      drawInkActionButton(ctx, b, '邀请好友', info.pressedId === 'pvpInvite', 'secondary');
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

  // 右下角版本号（发版脚本写入 APP_VERSION）
  ctx.fillStyle = 'rgba(70,48,24,0.42)';
  ctx.font = '11px "PingFang SC", sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`v${APP_VERSION}`, VIEW_W - 14, VIEW_H - 12);
}

/** 右下角版本号点击区（神秘商人隐藏测试入口） */
export const VERSION_HIT = { x: VIEW_W - 80, y: VIEW_H - 30, w: 80, h: 30 };

export function menuVersionHitAt(x: number, y: number): boolean {
  return x >= VERSION_HIT.x && x <= VERSION_HIT.x + VERSION_HIT.w && y >= VERSION_HIT.y && y <= VERSION_HIT.y + VERSION_HIT.h;
}
