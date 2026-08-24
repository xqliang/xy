// 个人信息弹层：横向卷轴选头像 + 昵称 + UID。
import { VIEW_W, VIEW_H, fillViewScrim } from './render';
import { sprite } from './assets';
import { AVATARS, unlockHint, type AvatarDef } from './avatar-catalog';
import { loadProfile } from './profile';
import { drawInkActionButton, roundRect } from './menu-ui';
import { loadUserId } from './user-id';
import { clampNickname } from './nickname';

const PANEL = { x: 40, y: 120, w: VIEW_W - 80, h: 500 };
const CLOSE = { x: PANEL.x + 16, y: PANEL.y + 14, w: 44, h: 44 };
/** 横向滚动视口 */
const SCROLL = { x: PANEL.x + 24, y: PANEL.y + 80, w: PANEL.w - 48, h: 196 };
/** 卡片：上图下文，避免立绘压字 */
const CELL_W = 108;
const CELL_H = 168;
const GAP = 14;
const NAME_H = 28;
const IMG_PAD = 8;
const COPY_BTN = { w: 56, h: 30 };

/** 卷轴下方留出「左右滑动 / 已解锁」两行，避免被昵称框盖住 */
function nickFieldY(): number {
  return SCROLL.y + SCROLL.h + 56;
}

function uidRowY(): number {
  return nickFieldY() + 44 + 18;
}

function confirmRect(): { x: number; y: number; w: number; h: number } {
  return { x: VIEW_W / 2 - 70, y: uidRowY() + 36, w: 140, h: 48 };
}

/** 保存失败等飘字 / 保存资料飘字：确认按钮上方 */
export function profileConfirmToastAnchorY(): number {
  return confirmRect().y - 12;
}

let lastCopyUidRect: { x: number; y: number; w: number; h: number } | null = null;

/** 复制成功飘字起点：复制按钮上缘再往上一点 */
export function profileCopyToastAnchorY(): number {
  if (lastCopyUidRect) return lastCopyUidRect.y - 8;
  return uidRowY() - 20;
}

function isDisplayUid(uid: string | null | undefined): uid is string {
  return typeof uid === 'string' && uid.length > 0 && uid !== 'undefined' && /^\d{8,20}$/.test(uid);
}

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
    nicknameDraft: clampNickname(p.nickname || ''),
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
  | { kind: 'copyUid' }
  | { kind: 'scroll' }
  | null;

function contentWidth(): number {
  return AVATARS.length * (CELL_W + GAP) - GAP;
}

export function profilePopupHitAt(x: number, y: number, st: ProfilePopupState): ProfilePopupHit {
  if (x < PANEL.x || x > PANEL.x + PANEL.w || y < PANEL.y || y > PANEL.y + PANEL.h) return { kind: 'close' };
  if (x >= CLOSE.x && x <= CLOSE.x + CLOSE.w && y >= CLOSE.y && y <= CLOSE.y + CLOSE.h) return { kind: 'close' };
  const confirm = confirmRect();
  if (x >= confirm.x && x <= confirm.x + confirm.w && y >= confirm.y && y <= confirm.y + confirm.h) {
    return { kind: 'confirm' };
  }
  if (lastCopyUidRect && x >= lastCopyUidRect.x && x <= lastCopyUidRect.x + lastCopyUidRect.w
    && y >= lastCopyUidRect.y && y <= lastCopyUidRect.y + lastCopyUidRect.h) {
    return { kind: 'copyUid' };
  }
  const nickY = nickFieldY();
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
  fillViewScrim(ctx, 'rgba(20,14,8,0.55)');

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
  ctx.fillText('个人信息', PANEL.x + PANEL.w / 2, PANEL.y + 32);

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
  ctx.fillText('左右滑动查看更多', VIEW_W / 2, SCROLL.y + SCROLL.h + 16);

  const sel = AVATARS.find((a) => a.id === st.selectedId);
  ctx.fillStyle = '#4a3218';
  ctx.font = '15px "PingFang SC", sans-serif';
  if (sel) {
    const locked = !st.unlocked.has(sel.id);
    ctx.fillText(locked ? unlockHint(sel) : '已解锁', VIEW_W / 2, SCROLL.y + SCROLL.h + 36);
  }

  // nickname field
  const nickY = nickFieldY();
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
  ctx.fillText(st.nicknameDraft || '昵称（可选，点此修改）', SCROLL.x + 14, nickY + 22);

  // UID row（无分割线）
  const uid = loadUserId();
  if (isDisplayUid(uid)) {
    const uy = uidRowY();
    const x0 = SCROLL.x;
    const x1 = SCROLL.x + SCROLL.w;

    const copyRect = {
      x: x1 - COPY_BTN.w,
      y: uy - COPY_BTN.h / 2,
      w: COPY_BTN.w,
      h: COPY_BTN.h,
    };
    lastCopyUidRect = copyRect;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5a3a12';
    ctx.font = '14px "PingFang SC", sans-serif';
    const uidLabel = `UID：${uid}`;
    const maxLabelW = Math.max(40, copyRect.x - x0 - 14);
    let drawLabel = uidLabel;
    if (ctx.measureText(drawLabel).width > maxLabelW) {
      while (drawLabel.length > 4 && ctx.measureText(`${drawLabel}…`).width > maxLabelW) {
        drawLabel = drawLabel.slice(0, -1);
      }
      drawLabel = `${drawLabel}…`;
    }
    ctx.fillText(drawLabel, x0, uy);
    drawInkActionButton(ctx, copyRect, '复制', false, 'secondary');
  } else {
    lastCopyUidRect = null;
  }

  const confirm = confirmRect();
  roundRect(ctx, confirm.x, confirm.y, confirm.w, confirm.h, 12);
  ctx.fillStyle = '#6b4420';
  ctx.fill();
  ctx.fillStyle = '#7dcea0';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('✓', confirm.x + confirm.w / 2, confirm.y + confirm.h / 2);
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
