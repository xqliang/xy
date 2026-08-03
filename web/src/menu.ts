// 主菜单渲染 + 按钮命中。参考原作首页：标题/军衔星级/体力/开始游戏/排行榜/武器背包。
import { VIEW_W, VIEW_H } from './render';
import { sprite } from './assets';
import { STAMINA_MAX } from './stamina';

export interface MenuButton {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MenuInfo {
  rankLevel: number;
  rankName: string;
  stamina: number;
  mapName: string;
  toast: string;
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

export function menuButtons(): MenuButton[] {
  const cx = VIEW_W / 2;
  return [
    { id: 'start', x: cx - 150, y: 612, w: 300, h: 74 },
    { id: 'ad', x: cx - 150, y: 700, w: 145, h: 50 },
    { id: 'share', x: cx + 5, y: 700, w: 145, h: 50 },
    { id: 'shop', x: cx - 150, y: 762, w: 300, h: 50 },
    { id: 'mapPrev', x: cx - 150, y: 566, w: 44, h: 38 },
    { id: 'mapNext', x: cx + 106, y: 566, w: 44, h: 38 },
    { id: 'codex', x: 40, y: 880, w: 140, h: 78 },
    { id: 'rank', x: VIEW_W / 2 - 70, y: 880, w: 140, h: 78 },
    { id: 'bag', x: VIEW_W - 180, y: 880, w: 140, h: 78 },
  ];
}

export function menuButtonAt(x: number, y: number): string | null {
  for (const b of menuButtons()) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
  }
  return null;
}

export function drawMenu(ctx: CanvasRenderingContext2D, info: MenuInfo): void {
  // 背景（宣纸）
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, '#efe6cf');
  bg.addColorStop(1, '#d8c9a6');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 顶栏：功德/体力
  ctx.fillStyle = '#7a3b12';
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`⚡ 体力 ${info.stamina}/${STAMINA_MAX}`, 24, 34);
  ctx.textAlign = 'right';
  ctx.fillText(`今日·${info.mapName}`, VIEW_W - 24, 34);

  // 标题
  ctx.textAlign = 'center';
  ctx.fillStyle = '#b5391f';
  ctx.font = 'bold 46px "PingFang SC", sans-serif';
  ctx.fillText('大圣与唐僧', VIEW_W / 2, 120);
  ctx.fillStyle = '#8a5a2b';
  ctx.font = '18px "PingFang SC", sans-serif';
  ctx.fillText(`境界 · ${info.rankName}`, VIEW_W / 2, 158);

  // 军衔星级
  const stars = Math.min(5, info.rankLevel);
  ctx.font = '28px sans-serif';
  ctx.fillStyle = '#e0a020';
  let starStr = '★'.repeat(stars) + '☆'.repeat(5 - stars);
  ctx.fillText(starStr, VIEW_W / 2, 196);

  // 主角立绘
  const spr = sprite('hero-wukong');
  if (spr) {
    const size = 260;
    const scale = Math.min(size / spr.width, size / spr.height);
    ctx.drawImage(spr, VIEW_W / 2 - (spr.width * scale) / 2, 250, spr.width * scale, spr.height * scale);
  }

  // 按钮
  for (const b of menuButtons()) {
    if (b.id === 'mapPrev' || b.id === 'mapNext') {
      // 地图切换箭头（调试用）
      roundRect(ctx, b.x, b.y, b.w, b.h, 10);
      ctx.fillStyle = '#8a6a3a';
      ctx.fill();
      ctx.fillStyle = '#fff4e0';
      ctx.font = 'bold 22px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.id === 'mapPrev' ? '‹' : '›', b.x + b.w / 2, b.y + b.h / 2);
      continue;
    }
    const isStart = b.id === 'start';
    roundRect(ctx, b.x, b.y, b.w, b.h, 12);
    ctx.fillStyle =
      isStart ? '#b5391f' :
      b.id === 'ad' ? '#c8792b' :
      b.id === 'share' ? '#4a8a4a' :
      b.id === 'shop' ? '#7a4aa0' : '#8a6a3a';
    ctx.fill();
    ctx.fillStyle = '#fff4e0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label =
      b.id === 'start' ? '开始游戏 ⚡1' :
      b.id === 'ad' ? '📺 体力+10' :
      b.id === 'share' ? '↗ 分享+5' :
      b.id === 'shop' ? '🛒 神秘商人' :
      b.id === 'codex' ? '图鉴' :
      b.id === 'rank' ? '排行榜' : '武器背包';
    ctx.font = isStart ? 'bold 26px "PingFang SC", sans-serif' : '16px "PingFang SC", sans-serif';
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2);
  }

  // 当前地图名（夹在切换箭头之间，调试用）
  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 20px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(info.mapName, VIEW_W / 2, 585);

  // 提示
  if (info.toast) {
    ctx.fillStyle = '#b5391f';
    ctx.font = '16px "PingFang SC", sans-serif';
    ctx.fillText(info.toast, VIEW_W / 2, 840);
  }
}
