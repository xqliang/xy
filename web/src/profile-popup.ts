// 设置头像弹层：横向卷轴选头像 + 可选昵称。
import { VIEW_W, VIEW_H } from './render';
import { sprite } from './assets';
import { AVATARS, unlockHint, type AvatarDef } from './avatar-catalog';
import { loadProfile } from './profile';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const PANEL = { x: 40, y: 160, w: VIEW_W - 80, h: 560 };
const CLOSE = { x: PANEL.x + 16, y: PANEL.y + 14, w: 44, h: 44 };
const CONFIRM = { x: VIEW_W / 2 - 70, y: PANEL.y + PANEL.h - 72, w: 140, h: 48 };
/** 横向滚动视口 */
const SCROLL = { x: PANEL.x + 24, y: PANEL.y + 88, w: PANEL.w - 48, h: 196 };
/** 卡片：上图下文，避免立绘压字 */
const CELL_W = 108;
const CELL_H = 168;
const GAP = 14;
const NAME_H = 28;
const IMG_PAD = 8;

export interface ProfilePopupState {
  selectedId: string;
  nicknameDraft: string;
  scrollX: number;
  unlocked: Set<string>;
}

export interface ProfileScrollDrag {
  x: number;
  scroll: number;
  moved: boolean;
  /** 按下时命中的头像；松手且未拖动才选中 */
  avatarId: string | null;
}

export function createProfilePopupState(): ProfilePopupState {
  const p = loadProfile();
  const selectedId = p.avatarId || 'wukong';
  const unlocked = new Set(
    p.unlockedAvatars.length
      ? p.unlockedAvatars
      : AVATARS.filter((a) => a.unlockType === 'default').map((a) => a.id),
  );
  const st: ProfilePopupState = {
    selectedId,
    nicknameDraft: p.nickname || '',
    scrollX: 0,
    unlocked,
  };
  // 打开时把当前头像滚到可视区中间
  const idx = Math.max(0, AVATARS.findIndex((a) => a.id === selectedId));
  const cellLeft = idx * (CELL_W + GAP);
  st.scrollX = cellLeft - (SCROLL.w - CELL_W) / 2;
  clampProfileScroll(st);
  return st;
}

export type ProfilePopupHit =
  | { kind: 'close' }
  | { kind: 'confirm' }
  | { kind: 'avatar'; id: string }
  | { kind: 'nickname' }
  | { kind: 'scroll' }
  | null;

function contentWidth(): number {
  return AVATARS.length * (CELL_W + GAP) - GAP;
}

export function profilePopupHitAt(x: number, y: number, st: ProfilePopupState): ProfilePopupHit {
  if (x < PANEL.x || x > PANEL.x + PANEL.w || y < PANEL.y || y > PANEL.y + PANEL.h) return { kind: 'close' };
  if (x >= CLOSE.x && x <= CLOSE.x + CLOSE.w && y >= CLOSE.y && y <= CLOSE.y + CLOSE.h) return { kind: 'close' };
  if (x >= CONFIRM.x && x <= CONFIRM.x + CONFIRM.w && y >= CONFIRM.y && y <= CONFIRM.y + CONFIRM.h) {
    return { kind: 'confirm' };
  }
  const nickY = SCROLL.y + SCROLL.h + 52;
  if (y >= nickY && y <= nickY + 44 && x >= SCROLL.x && x <= SCROLL.x + SCROLL.w) {
    return { kind: 'nickname' };
  }
  if (x >= SCROLL.x && x <= SCROLL.x + SCROLL.w && y >= SCROLL.y && y <= SCROLL.y + SCROLL.h) {
    const local = x - SCROLL.x + st.scrollX;
    const idx = Math.floor(local / (CELL_W + GAP));
    if (idx >= 0 && idx < AVATARS.length) {
      const cellX = idx * (CELL_W + GAP);
      if (local >= cellX && local <= cellX + CELL_W) return { kind: 'avatar', id: AVATARS[idx]!.id };
    }
    return { kind: 'scroll' };
  }
  return null;
}

export function clampProfileScroll(st: ProfilePopupState): void {
  const max = Math.max(0, contentWidth() - SCROLL.w);
  st.scrollX = Math.max(0, Math.min(max, st.scrollX));
}

/** 横向拖动中更新滚动；位移超过阈值则记为 moved（松手不切换选中） */
export function applyProfileScrollDrag(st: ProfilePopupState, drag: ProfileScrollDrag, x: number): void {
  const dx = x - drag.x;
  if (Math.abs(dx) > 6) drag.moved = true;
  st.scrollX = drag.scroll - dx;
  clampProfileScroll(st);
}

export function drawProfilePopup(ctx: CanvasRenderingContext2D, st: ProfilePopupState): void {
  ctx.fillStyle = 'rgba(20,14,8,0.55)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  roundRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 16);
  const bg = ctx.createLinearGradient(PANEL.x, PANEL.y, PANEL.x, PANEL.y + PANEL.h);
  bg.addColorStop(0, '#f3e6c8');
  bg.addColorStop(1, '#e2c894');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = '#6b4420';
  ctx.lineWidth = 3;
  ctx.stroke();

  // header bar
  roundRect(ctx, PANEL.x, PANEL.y, PANEL.w, 64, 16);
  ctx.fillStyle = '#6b4420';
  ctx.fill();
  ctx.fillStyle = '#f8ecd0';
  ctx.font = 'bold 26px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('设置头像', PANEL.x + PANEL.w / 2, PANEL.y + 32);

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('✕', CLOSE.x + CLOSE.w / 2, CLOSE.y + CLOSE.h / 2);

  // 卷轴纸底
  roundRect(ctx, SCROLL.x - 8, SCROLL.y - 8, SCROLL.w + 16, SCROLL.h + 16, 12);
  ctx.fillStyle = 'rgba(255,248,230,0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,80,30,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // scroll area（裁剪）
  ctx.save();
  ctx.beginPath();
  ctx.rect(SCROLL.x, SCROLL.y, SCROLL.w, SCROLL.h);
  ctx.clip();
  const rowY = SCROLL.y + (SCROLL.h - CELL_H) / 2;
  AVATARS.forEach((a, i) => {
    const x = SCROLL.x - st.scrollX + i * (CELL_W + GAP);
    drawAvatarCell(ctx, a, x, rowY, st.selectedId === a.id, st.unlocked.has(a.id));
  });
  ctx.restore();

  // 左右渐隐 + 箭头，提示可横滑
  const fadeW = 28;
  const leftFade = ctx.createLinearGradient(SCROLL.x, 0, SCROLL.x + fadeW, 0);
  leftFade.addColorStop(0, 'rgba(243,230,200,0.95)');
  leftFade.addColorStop(1, 'rgba(243,230,200,0)');
  ctx.fillStyle = leftFade;
  ctx.fillRect(SCROLL.x, SCROLL.y, fadeW, SCROLL.h);
  const rightFade = ctx.createLinearGradient(SCROLL.x + SCROLL.w - fadeW, 0, SCROLL.x + SCROLL.w, 0);
  rightFade.addColorStop(0, 'rgba(243,230,200,0)');
  rightFade.addColorStop(1, 'rgba(243,230,200,0.95)');
  ctx.fillStyle = rightFade;
  ctx.fillRect(SCROLL.x + SCROLL.w - fadeW, SCROLL.y, fadeW, SCROLL.h);

  const maxScroll = Math.max(0, contentWidth() - SCROLL.w);
  ctx.fillStyle = 'rgba(80,50,20,0.55)';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (st.scrollX > 2) ctx.fillText('‹', SCROLL.x + 10, SCROLL.y + SCROLL.h / 2);
  if (st.scrollX < maxScroll - 2) ctx.fillText('›', SCROLL.x + SCROLL.w - 10, SCROLL.y + SCROLL.h / 2);

  ctx.fillStyle = '#8a6a40';
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillText('左右滑动查看更多', VIEW_W / 2, SCROLL.y + SCROLL.h + 18);

  const sel = AVATARS.find((a) => a.id === st.selectedId);
  ctx.fillStyle = '#4a3218';
  ctx.font = '16px "PingFang SC", sans-serif';
  if (sel) {
    const locked = !st.unlocked.has(sel.id);
    ctx.fillText(locked ? unlockHint(sel) : '已解锁', VIEW_W / 2, SCROLL.y + SCROLL.h + 38);
  }

  // nickname field
  const nickY = SCROLL.y + SCROLL.h + 52;
  roundRect(ctx, SCROLL.x, nickY, SCROLL.w, 44, 10);
  ctx.fillStyle = '#fff8e8';
  ctx.fill();
  ctx.strokeStyle = '#a07840';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = st.nicknameDraft ? '#3a2810' : '#9a8660';
  ctx.font = '18px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(st.nicknameDraft || '昵称（可选，点此输入）', SCROLL.x + 14, nickY + 22);

  roundRect(ctx, CONFIRM.x, CONFIRM.y, CONFIRM.w, CONFIRM.h, 12);
  ctx.fillStyle = '#6b4420';
  ctx.fill();
  ctx.fillStyle = '#7dcea0';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('✓', CONFIRM.x + CONFIRM.w / 2, CONFIRM.y + CONFIRM.h / 2);
}

function drawAvatarCell(
  ctx: CanvasRenderingContext2D,
  a: AvatarDef,
  x: number,
  y: number,
  selected: boolean,
  unlocked: boolean,
): void {
  roundRect(ctx, x, y, CELL_W, CELL_H, 10);
  ctx.fillStyle = '#f7efe0';
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(100,70,30,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 立绘区（底部留给名字）
  const imgX = x + IMG_PAD;
  const imgY = y + IMG_PAD;
  const imgW = CELL_W - IMG_PAD * 2;
  const imgH = CELL_H - NAME_H - IMG_PAD * 2;
  const spr = sprite(a.art);
  ctx.save();
  ctx.beginPath();
  ctx.rect(imgX, imgY, imgW, imgH);
  ctx.clip();
  if (!unlocked) ctx.globalAlpha = 0.35;
  if (spr) {
    const sc = Math.min(imgW / spr.width, imgH / spr.height);
    const dw = spr.width * sc;
    const dh = spr.height * sc;
    // 底部对齐：头像脚部落在名字上方，少裁脸
    ctx.drawImage(spr, imgX + (imgW - dw) / 2, imgY + imgH - dh, dw, dh);
  }
  ctx.restore();

  // 名字条
  ctx.fillStyle = unlocked ? '#4a3218' : '#7a6040';
  ctx.font = 'bold 13px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(a.name, x + CELL_W / 2, y + CELL_H - NAME_H / 2);

  if (!unlocked) {
    ctx.fillStyle = '#e6b422';
    ctx.font = '22px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔒', x + CELL_W / 2, imgY + imgH / 2);
  }
}

export function promptNickname(current: string): string | null {
  if (typeof window === 'undefined' || typeof window.prompt !== 'function') return current;
  const v = window.prompt('设置昵称（可留空）', current);
  if (v === null) return null;
  return v.trim().slice(0, 32);
}
