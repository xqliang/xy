// Canvas 渲染层。逻辑分辨率 560×920（竖屏，贴近微信小游戏）。
import {
  COLS,
  ROWS,
  PATH,
  TANGSENG_CELL,
  isPathCell,
  posAtDistance,
  type Cell,
} from './board';
import { Battle, unitColorOf, TUNING } from './battle';
import { UNITS, getUnitStat } from '@core';
import type { UnitType } from '@core';

export const VIEW_W = 560;
export const VIEW_H = 920;
export const HUD_H = 72;
export const CELL = 74;
export const BOARD_X = Math.round((VIEW_W - CELL * COLS) / 2);
export const BOARD_Y = HUD_H + 12;
export const BOARD_H = CELL * ROWS;
export const CTRL_Y = BOARD_Y + BOARD_H + 10;

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
  const canSummon = b.peach >= b.summonCost;
  const canOpen = b.peach >= TUNING.openSlotCost;
  const canWave = b.status === 'ready';
  return [
    { id: 'summon', label: `召唤 (${b.summonCost}桃)`, x: 20, y, w: 168, h, enabled: canSummon },
    { id: 'open', label: `开辟阵位 (${TUNING.openSlotCost}桃)`, x: 196, y, w: 168, h, enabled: canOpen },
    { id: 'wave', label: canWave ? '下一波 ▶' : '战斗中…', x: 372, y, w: 168, h, enabled: canWave },
  ];
}

export interface UiState {
  dragFrom: Cell | null;
  dragPos: { x: number; y: number } | null;
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

function drawUnit(ctx: CanvasRenderingContext2D, type: UnitType, tier: number, x: number, y: number, size: number) {
  const s = size;
  const color = unitColorOf(type);
  roundRect(ctx, x - s / 2, y - s / 2, s, s, 10);
  const grad = ctx.createLinearGradient(x, y - s / 2, x, y + s / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(1, shade(color, -0.35));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.stroke();
  // 文字标识
  ctx.fillStyle = '#1a1208';
  ctx.font = `bold ${Math.round(s * 0.42)}px "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(UNIT_LABEL[type], x, y - s * 0.06);
  // 阶数星点
  ctx.fillStyle = '#fff4d6';
  const pipR = 3;
  const gap = 9;
  const startX = x - ((tier - 1) * gap) / 2;
  for (let i = 0; i < tier; i++) {
    ctx.beginPath();
    ctx.arc(startX + i * gap, y + s * 0.32, pipR, 0, Math.PI * 2);
    ctx.fill();
  }
}

function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * (1 + amt))));
  g = Math.max(0, Math.min(255, Math.round(g * (1 + amt))));
  b = Math.max(0, Math.min(255, Math.round(b * (1 + amt))));
  return `rgb(${r},${g},${b})`;
}

export function draw(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState): void {
  // 背景
  ctx.fillStyle = '#17110b';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  drawBoard(ctx, b, ui);
  drawPath(ctx);
  drawTangseng(ctx, b);
  drawMonsters(ctx, b);
  drawUnits(ctx, b, ui);
  drawFx(ctx, b);
  drawHud(ctx, b);
  drawButtons(ctx, b);
  drawDragGhost(ctx, b, ui);
  drawBanner(ctx, b);
}

function drawBoard(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  const unlocked = new Set(b.unlockedCells().map((c) => `${c.c},${c.r}`));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = BOARD_X + c * CELL;
      const y = BOARD_Y + r * CELL;
      if (isPathCell(c, r)) continue;
      const isUnlocked = unlocked.has(`${c},${r}`);
      roundRect(ctx, x + 3, y + 3, CELL - 6, CELL - 6, 8);
      ctx.fillStyle = isUnlocked ? '#2d2417' : '#201a12';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = isUnlocked ? 'rgba(255,200,120,0.25)' : 'rgba(255,255,255,0.05)';
      ctx.stroke();
      if (!isUnlocked) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔒', x + CELL / 2, y + CELL / 2);
      }
    }
  }
  // 拖拽高亮目标格
  if (ui.dragFrom && ui.dragPos) {
    // 高亮在 drawDragGhost 里
  }
}

function drawPath(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.strokeStyle = '#5a4326';
  ctx.lineWidth = CELL * 0.66;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  PATH.forEach((p, i) => {
    const { x, y } = cellCenterPx(p.c, p.r);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  // 路面中线
  ctx.strokeStyle = 'rgba(255,220,150,0.18)';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 12]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawTangseng(ctx: CanvasRenderingContext2D, _b: Battle) {
  const { x, y } = cellCenterPx(TANGSENG_CELL.c, TANGSENG_CELL.r);
  ctx.beginPath();
  ctx.arc(x, y, CELL * 0.42, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(x, y - 8, 4, x, y, CELL * 0.42);
  g.addColorStop(0, '#ffe9a8');
  g.addColorStop(1, '#d99a2b');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#8a5a12';
  ctx.stroke();
  ctx.fillStyle = '#5a3a08';
  ctx.font = 'bold 26px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('唐', x, y);
}

function drawMonsters(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const m of b.monsters) {
    const p = posAtDistance(m.dist);
    const { x, y } = cellCenterPx(p.c, p.r);
    const rad = m.isBoss ? CELL * 0.4 : CELL * 0.26;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = m.isBoss ? '#b02a5b' : '#7a2b2b';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = m.isBoss ? '#ff7ab0' : '#c25a5a';
    ctx.stroke();
    ctx.fillStyle = '#ffd9d9';
    ctx.font = `${m.isBoss ? 20 : 14}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(m.isBoss ? '妖' : '卒', x, y);
    // 血条
    const bw = rad * 2;
    const hpPct = Math.max(0, m.hp / m.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - bw / 2, y - rad - 8, bw, 4);
    ctx.fillStyle = hpPct > 0.4 ? '#7dff8a' : '#ff6a6a';
    ctx.fillRect(x - bw / 2, y - rad - 8, bw * hpPct, 4);
  }
}

function drawUnits(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  for (const u of b.units.values()) {
    if (ui.dragFrom && ui.dragFrom.c === u.cell.c && ui.dragFrom.r === u.cell.r) continue; // 拖拽中隐藏原位
    const { x, y } = cellCenterPx(u.cell.c, u.cell.r);
    // 攻击范围淡圈
    const stat = getUnitStat(u.type, u.tier);
    ctx.beginPath();
    ctx.arc(x, y, stat.rge * CELL, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fill();
    drawUnit(ctx, u.type, u.tier, x, y, CELL * 0.72);
  }
}

function drawFx(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const f of b.fx) {
    const a = cellCenterPx(f.from.c, f.from.r);
    const t = cellCenterPx(f.to.c, f.to.r);
    ctx.strokeStyle = f.color;
    ctx.globalAlpha = Math.max(0, Math.min(1, f.ttl / 0.12));
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawHud(ctx: CanvasRenderingContext2D, b: Battle) {
  ctx.fillStyle = '#241a10';
  ctx.fillRect(0, 0, VIEW_W, HUD_H);
  ctx.fillStyle = '#ffcf7a';
  ctx.font = 'bold 24px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`🍑 ${b.peach}`, 20, HUD_H / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText(`第 ${b.wave} 波`, VIEW_W / 2, HUD_H / 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ff8a8a';
  ctx.fillText(`唐僧 ❤ ${b.tangsengHP}`, VIEW_W - 20, HUD_H / 2);
}

function drawButtons(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const btn of getButtons(b)) {
    roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 12);
    ctx.fillStyle = btn.enabled ? '#c8792b' : '#3a3128';
    ctx.fill();
    ctx.fillStyle = btn.enabled ? '#fff6e6' : '#7a7160';
    ctx.font = 'bold 20px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2);
  }
  // 提示信息
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '14px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(b.message, VIEW_W / 2, CTRL_Y + 64 + 20);
}

function drawDragGhost(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (!ui.dragFrom || !ui.dragPos) return;
  const u = b.units.get(`${ui.dragFrom.c},${ui.dragFrom.r}`);
  if (!u) return;
  // 高亮目标格
  const target = pxToCell(ui.dragPos.x, ui.dragPos.y);
  if (target) {
    const x = BOARD_X + target.c * CELL;
    const y = BOARD_Y + target.r * CELL;
    roundRect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 8);
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.globalAlpha = 0.85;
  drawUnit(ctx, u.type, u.tier, ui.dragPos.x, ui.dragPos.y, CELL * 0.72);
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
