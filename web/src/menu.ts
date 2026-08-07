// 主菜单渲染 + 按钮命中。参考原作首页：标题/军衔星级/体力/开始游戏/排行榜/武器背包。
import { VIEW_W, VIEW_H } from './render';
import { sprite } from './assets';
import { STAMINA_MAX, STAMINA_COST } from './stamina';

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
  muted: boolean;
  musicOn: boolean;
  endlessOn: boolean;
  /** 当前按下的按钮 id（手指仍压在该按钮上时有按下态视觉） */
  pressedId: string | null;
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
    { id: 'endless', x: cx - 150, y: 520, w: 300, h: 34 },
    { id: 'start', x: cx - 150, y: 612, w: 300, h: 74 },
    { id: 'ad', x: cx - 150, y: 700, w: 145, h: 50 },
    { id: 'share', x: cx + 5, y: 700, w: 145, h: 50 },
    { id: 'shop', x: cx - 150, y: 762, w: 300, h: 50 },
    { id: 'mute', x: VIEW_W - 52, y: 16, w: 36, h: 36 },
    { id: 'music', x: VIEW_W - 96, y: 16, w: 36, h: 36 },
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
  // 右对齐到音效/音乐按钮左侧（按钮在 VIEW_W-96 起），留 12px 间距，避免与图标重叠
  ctx.fillText(`今日·${info.mapName}`, VIEW_W - 108, 34);

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

  // 按钮（pressedId 时轻微下压 + 变暗，让点击有反馈）
  for (const b of menuButtons()) {
    const pressed = info.pressedId === b.id;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    if (pressed) {
      ctx.save();
      ctx.translate(cx, cy + 2);
      ctx.scale(0.96, 0.96);
      ctx.translate(-cx, -cy);
    }
    if (b.id === 'mute') {
      if (pressed) {
        ctx.beginPath();
        ctx.arc(cx, cy, 18, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(122,59,18,0.18)';
        ctx.fill();
      }
      ctx.font = '26px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.muted ? '🔇' : '🔊', cx, cy);
      if (pressed) ctx.restore();
      continue;
    }
    if (b.id === 'music') {
      // 背景音乐开关：开=音符，关=半透明音符+红色斜杠
      if (pressed) {
        ctx.beginPath();
        ctx.arc(cx, cy, 18, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(122,59,18,0.18)';
        ctx.fill();
      }
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = info.musicOn ? 1 : 0.35;
      ctx.fillText('🎵', cx, cy);
      ctx.globalAlpha = 1;
      if (!info.musicOn) {
        ctx.strokeStyle = '#c8392b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 13, cy + 13);
        ctx.lineTo(cx + 13, cy - 13);
        ctx.stroke();
      }
      if (pressed) ctx.restore();
      continue;
    }
    if (b.id === 'endless') {
      // 勾选框：左侧方框（选中态填色打勾）+ 右侧文案
      const boxSize = 24;
      const boxX = b.x + 40;
      const boxY = b.y + (b.h - boxSize) / 2;
      if (pressed) {
        roundRect(ctx, b.x + 20, b.y, b.w - 40, b.h, 8);
        ctx.fillStyle = 'rgba(122,59,18,0.12)';
        ctx.fill();
      }
      roundRect(ctx, boxX, boxY, boxSize, boxSize, 6);
      ctx.fillStyle = info.endlessOn ? '#b5391f' : 'rgba(255,244,224,0.65)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#7a3b12';
      ctx.stroke();
      if (info.endlessOn) {
        // 打勾
        ctx.strokeStyle = '#fff4e0';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(boxX + 5, boxY + 12);
        ctx.lineTo(boxX + 10, boxY + 18);
        ctx.lineTo(boxX + 19, boxY + 6);
        ctx.stroke();
      }
      ctx.fillStyle = '#5a3a12';
      ctx.font = 'bold 20px "PingFang SC", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('无尽模式', boxX + boxSize + 12, cy);
      if (pressed) ctx.restore();
      continue;
    }
    if (b.id === 'mapPrev' || b.id === 'mapNext') {
      // 地图切换箭头（调试用）
      roundRect(ctx, b.x, b.y, b.w, b.h, 10);
      ctx.fillStyle = pressed ? '#6a4a22' : '#8a6a3a';
      ctx.fill();
      ctx.fillStyle = '#fff4e0';
      ctx.font = 'bold 22px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.id === 'mapPrev' ? '‹' : '›', cx, cy);
      if (pressed) ctx.restore();
      continue;
    }
    const isStart = b.id === 'start';
    roundRect(ctx, b.x, b.y, b.w, b.h, 12);
    const base =
      isStart ? '#b5391f' :
      b.id === 'ad' ? '#c8792b' :
      b.id === 'share' ? '#4a8a4a' :
      b.id === 'shop' ? '#7a4aa0' : '#8a6a3a';
    const dim =
      isStart ? '#8a2a14' :
      b.id === 'ad' ? '#9a5a1a' :
      b.id === 'share' ? '#356a35' :
      b.id === 'shop' ? '#5a3078' : '#6a4a22';
    ctx.fillStyle = pressed ? dim : base;
    ctx.fill();
    if (pressed) {
      // 内阴影感：顶部压暗一条，强化「按进去」
      ctx.save();
      roundRect(ctx, b.x, b.y, b.w, b.h, 12);
      ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(b.x, b.y, b.w, 6);
      ctx.restore();
    }
    ctx.fillStyle = '#fff4e0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label =
      b.id === 'start' ? `开始游戏 ⚡${STAMINA_COST}` :
      b.id === 'ad' ? '📺 体力+10' :
      b.id === 'share' ? '↗ 分享+5' :
      b.id === 'shop' ? '🛒 神秘商人' :
      b.id === 'codex' ? '图鉴' :
      b.id === 'rank' ? '排行榜' : '武器背包';
    ctx.font = isStart ? 'bold 26px "PingFang SC", sans-serif' : '16px "PingFang SC", sans-serif';
    ctx.fillText(label, cx, cy);
    if (pressed) ctx.restore();
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
