// Canvas 渲染层。逻辑分辨率 560×920（竖屏，贴近微信小游戏）。
import {
  COLS,
  ROWS,
  FENCE_ROW,
  isPathCell,
  posAtDistance,
  mirrorCell,
  placeableCells,
  type Cell,
} from './board';
import { Battle, unitColorOf, TUNING, itemById } from './battle';
import { UNITS, getUnitStat, damage } from '@core';
import type { UnitType } from '@core';
import { sprite, unitAsset } from './assets';

export const VIEW_W = 560;
export const HUD_H = 72;
export const CELL = Math.floor((VIEW_W - 16) / COLS); // 8 列自适应 → 68
export const BOARD_X = Math.round((VIEW_W - CELL * COLS) / 2);
export const BOARD_Y = HUD_H + 12;
export const BOARD_H = CELL * ROWS;
export const TRAY_Y = BOARD_Y + BOARD_H + 8; // 候选区行
export const TRAY_H = 66;
export const CTRL_Y = TRAY_Y + TRAY_H + 8; // 控制按钮行
export const VIEW_H = CTRL_Y + 64 + 34;

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
  // 胜利后 3 选 1 道具商店
  if (b.pendingShop) {
    const cardW = 168;
    const cardH = 96;
    const cy = CTRL_Y - 24;
    return b.pendingShop.map((id, i) => ({
      id: `item${i}`,
      label: itemById(id)?.name ?? id,
      x: 20 + i * 176,
      y: cy,
      w: cardW,
      h: cardH,
      enabled: true,
    }));
  }
  const trayEmpty = b.tray.length === 0;
  const canSummon = trayEmpty && b.peach >= b.summonCost;
  const third =
    b.status === 'playing'
      ? { id: 'palm', label: '如来神掌 🖐', enabled: b.palmAvailable() }
      : { id: 'wave', label: '立即开战 ▶', enabled: b.status === 'ready' };
  return [
    { id: 'summon', label: `征兵 (${b.effectiveSummonCost()}🍑)`, x: 20, y, w: 168, h, enabled: canSummon },
    { id: 'autoplace', label: '一键布阵', x: 196, y, w: 168, h, enabled: !trayEmpty },
    { id: third.id, label: third.label, x: 372, y, w: 168, h, enabled: third.enabled },
  ];
}

export interface UiState {
  dragFrom: Cell | null; // 从棋盘拖动的单位源格
  dragTrayIndex: number | null; // 从候选区拖动的令牌下标
  dragPos: { x: number; y: number } | null;
  selected: Cell | null; // 点击选中的单位格（仅此时显示攻击范围+信息面板）
}

// HUD 显示的境界名（由 main 设置）
let hudRankLabel = '';
export function setHudRank(label: string): void {
  hudRankLabel = label;
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
  // 底座：类型色圆角背景 + 描边，保证辨识度
  roundRect(ctx, x - s / 2, y - s / 2, s, s, 10);
  const grad = ctx.createLinearGradient(x, y - s / 2, x, y + s / 2);
  grad.addColorStop(0, shade(color, 0.05));
  grad.addColorStop(1, shade(color, -0.5));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = shade(color, 0.2);
  ctx.stroke();

  const spr = sprite(unitAsset(type));
  if (spr) {
    // 立绘按 contain 缩放居中
    const pad = s * 0.05;
    const box = s - pad * 2;
    const scale = Math.min(box / spr.width, box / spr.height);
    const dw = spr.width * scale;
    const dh = spr.height * scale;
    ctx.drawImage(spr, x - dw / 2, y - dh / 2, dw, dh);
  } else {
    ctx.fillStyle = '#1a1208';
    ctx.font = `bold ${Math.round(s * 0.42)}px "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(UNIT_LABEL[type], x, y - s * 0.06);
  }

  // 阶数星点（底部）
  ctx.fillStyle = '#fff4d6';
  const pipR = 3;
  const gap = 9;
  const startX = x - ((tier - 1) * gap) / 2;
  for (let i = 0; i < tier; i++) {
    ctx.beginPath();
    ctx.arc(startX + i * gap, y + s * 0.4, pipR, 0, Math.PI * 2);
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
  // 背景：地图主题色
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, b.map.theme.bg0);
  bg.addColorStop(1, b.map.theme.bg1);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  drawBoard(ctx, b, ui);
  drawTangseng(ctx, b);
  drawMonsters(ctx, b);
  drawAiSide(ctx, b);
  drawUnits(ctx, b, ui);
  drawFx(ctx, b);
  drawBursts(ctx, b);
  drawSelection(ctx, b, ui);
  drawHud(ctx, b);
  drawTray(ctx, b, ui);
  drawButtons(ctx, b);
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
function drawTrayToken(ctx: CanvasRenderingContext2D, token: { kind: 'unit'; type: UnitType; tier: number } | { kind: 'shovel' }, x: number, y: number, s: number) {
  if (token.kind === 'shovel') {
    roundRect(ctx, x - s / 2, y - s / 2, s, s, 10);
    ctx.fillStyle = '#e0b24a';
    ctx.fill();
    ctx.fillStyle = '#5a3a08';
    ctx.font = `${Math.round(s * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🪏', x, y);
  } else {
    drawUnit(ctx, token.type, token.tier, x, y, s);
  }
}
function drawTray(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  // 底板
  ctx.fillStyle = '#efe6d2';
  roundRect(ctx, 8, TRAY_Y, VIEW_W - 16, TRAY_H, 10);
  ctx.fill();
  // "营" 标
  ctx.fillStyle = '#8a5a2b';
  roundRect(ctx, 12, TRAY_Y + 6, 44, TRAY_H - 12, 8);
  ctx.fill();
  ctx.fillStyle = '#fff2d8';
  ctx.font = 'bold 22px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('营', 34, TRAY_Y + TRAY_H / 2);
  // 5 个候选槽
  for (let i = 0; i < TUNING.traySize; i++) {
    const cx = TRAY_LEFT + i * TRAY_SLOT;
    roundRect(ctx, cx + 3, TRAY_Y + 5, TRAY_SLOT - 6, TRAY_H - 10, 8);
    ctx.fillStyle = '#dcccae';
    ctx.fill();
    const token = b.tray[i];
    if (token && ui.dragTrayIndex !== i) {
      const c = traySlotCenter(i);
      drawTrayToken(ctx, token, c.x, c.y, TRAY_H - 16);
    }
  }
}

function drawBoard(ctx: CanvasRenderingContext2D, b: Battle, _ui: UiState) {
  const unlocked = new Set(b.unlockedCells().map((c) => `${c.c},${c.r}`));
  const th = b.map.theme;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = BOARD_X + c * CELL;
      const y = BOARD_Y + r * CELL;
      const inPlayer = r >= FENCE_ROW;
      const src = inPlayer ? { c, r } : mirrorCell({ c, r }); // AI 半场取镜像源判定类型
      const onPath = isPathCell(b.map, src.c, src.r);
      roundRect(ctx, x + 1.5, y + 1.5, CELL - 3, CELL - 3, 5);
      if (inPlayer) {
        if (onPath) {
          ctx.fillStyle = th.path; // 路径也是格子，仅背景色不同
        } else {
          ctx.fillStyle = unlocked.has(`${c},${r}`) ? th.cellUnlocked : th.cellLocked;
        }
      } else {
        ctx.fillStyle = onPath ? 'rgba(150,120,160,0.35)' : 'rgba(150,130,170,0.2)'; // AI 半场淡紫
      }
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(80,70,55,0.28)';
      ctx.stroke();
      if (inPlayer && !onPath && !unlocked.has(`${c},${r}`)) {
        ctx.fillStyle = 'rgba(70,60,40,0.4)';
        ctx.font = '18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔒', x + CELL / 2, y + CELL / 2);
      }
    }
  }
  drawFence(ctx, b);
}

// 中间栅栏：每张地图开口不同（fenceGaps）
function drawFence(ctx: CanvasRenderingContext2D, b: Battle) {
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

function drawMonsters(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const m of b.monsters) {
    const p = posAtDistance(b.map, m.dist);
    const { x, y } = cellCenterPx(p.c, p.r);
    const rad = m.isBoss ? CELL * 0.42 : CELL * 0.28;
    const spr = sprite(m.isBoss ? 'monster-boss' : 'monster-minion');
    if (spr) {
      const box = rad * 2.3;
      const scale = Math.min(box / spr.width, box / spr.height);
      const dw = spr.width * scale;
      const dh = spr.height * scale;
      ctx.drawImage(spr, x - dw / 2, y - dh / 2, dw, dh);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = m.isBoss ? '#b02a5b' : '#7a2b2b';
      ctx.fill();
    }
    // 血条
    const bw = rad * 2;
    const hpPct = Math.max(0, m.hp / m.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - bw / 2, y - rad - 9, bw, 5);
    ctx.fillStyle = hpPct > 0.4 ? '#7dff8a' : '#ff6a6a';
    ctx.fillRect(x - bw / 2, y - rad - 9, bw * hpPct, 5);
    // 受击闪白
    if (m.hitFlash > 0) {
      ctx.globalAlpha = Math.min(0.8, m.hitFlash / 0.12);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
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

function drawUnits(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  for (const u of b.units.values()) {
    if (ui.dragFrom && ui.dragFrom.c === u.cell.c && ui.dragFrom.r === u.cell.r) continue; // 拖拽中隐藏原位
    const { x, y } = cellCenterPx(u.cell.c, u.cell.r);
    // 开火脉冲：放大 + 上跳
    const pulse = u.firePulse;
    drawUnit(ctx, u.type, u.tier, x, y - pulse * 4, CELL * 0.72 * (1 + pulse * 0.16));
  }
}

// 选中单位：攻击范围高亮 + 信息面板（点击某武器才显示，参考竞品单位面板）
function drawSelection(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (!ui.selected) return;
  const u = b.units.get(`${ui.selected.c},${ui.selected.r}`);
  if (!u) return;
  const { x, y } = cellCenterPx(u.cell.c, u.cell.r);
  const stat = getUnitStat(u.type, u.tier);
  // 攻击范围环
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, stat.rge * CELL, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(90,150,70,0.16)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(120,200,90,0.85)';
  ctx.setLineDash([7, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
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
  let px = x - pw / 2;
  let py = gy - ph - 8; // 默认显示在单位上方
  if (py < BOARD_Y) py = gy + CELL + 8; // 顶部空间不足则显示在下方
  px = Math.max(8, Math.min(VIEW_W - pw - 8, px));
  ctx.save();
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

function drawFx(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const f of b.fx) {
    const a = cellCenterPx(f.from.c, f.from.r);
    const t = cellCenterPx(f.to.c, f.to.r);
    const prog = 1 - Math.max(0, Math.min(1, f.ttl / f.maxTtl)); // 0→1 飞行进度
    const x = a.x + (t.x - a.x) * prog;
    const y = a.y + (t.y - a.y) * prog;
    // 拖尾
    ctx.strokeStyle = f.color;
    ctx.globalAlpha = 0.35 * (f.ttl / f.maxTtl);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    // 弹丸光点
    ctx.globalAlpha = 1;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// 伪竞技 AI 对手（上半场，对角唐僧）
function drawAiSide(ctx: CanvasRenderingContext2D, b: Battle) {
  ctx.save();
  ctx.strokeStyle = 'rgba(110,90,120,0.28)';
  ctx.lineWidth = CELL * 0.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  b.aiPath.forEach((p, i) => {
    const { x, y } = cellCenterPx(p.c, p.r);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
  for (const m of b.aiMonsters) {
    const p = b.aiMonsterPos(m);
    const { x, y } = cellCenterPx(p.c, p.r);
    const rad = m.isBoss ? CELL * 0.3 : CELL * 0.2;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = m.isBoss ? '#a24a6a' : '#8a5a5a';
    ctx.fill();
  }
  // AI 单位（上半场自动部署）
  for (const u of b.aiUnits) {
    const { x, y } = cellCenterPx(u.cell.c, u.cell.r);
    drawUnit(ctx, u.type, u.tier, x, y - u.firePulse * 3, CELL * 0.66 * (1 + u.firePulse * 0.14));
  }
  const tp = b.aiTangsengRenderPos();
  const { x, y } = cellCenterPx(tp.c, tp.r);
  const rad = CELL * 0.4;
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(x, y - 6, 3, x, y, rad);
  g.addColorStop(0, '#d2d0f0');
  g.addColorStop(1, '#8a86c0');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#5a5a8a';
  ctx.stroke();
  ctx.fillStyle = '#3a3a6a';
  ctx.font = 'bold 22px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('斗', x, y);
  ctx.fillStyle = b.aiDefeated ? '#9a9a9a' : '#7a5aa0';
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText(b.aiDefeated ? '对手已败' : `对手 ❤${b.aiTangsengHP}`, x, y - rad - 12);
}

function drawHud(ctx: CanvasRenderingContext2D, b: Battle) {
  // 主题色 HUD 条
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
  // 商店标题
  if (b.pendingShop) {
    ctx.fillStyle = '#ffe08a';
    ctx.font = 'bold 20px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('胜利！选择一件道具（每日重置）', VIEW_W / 2, CTRL_Y - 44);
  }
  for (const btn of getButtons(b)) {
    const isItem = btn.id.startsWith('item');
    roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 12);
    ctx.fillStyle = btn.enabled ? (isItem ? '#3a2c53' : '#c8792b') : '#3a3128';
    ctx.fill();
    if (isItem) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#a98bff';
      ctx.stroke();
      const def = itemById(b.pendingShop![Number(btn.id.slice(4))]!);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff6e6';
      ctx.font = 'bold 18px "PingFang SC", sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(def?.name ?? btn.label, btn.x + btn.w / 2, btn.y + 12);
      ctx.fillStyle = def?.kind === '主动' ? '#ffb86c' : '#9bffb0';
      ctx.font = '12px "PingFang SC", sans-serif';
      ctx.fillText(`[${def?.kind ?? ''}]`, btn.x + btn.w / 2, btn.y + 38);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '13px "PingFang SC", sans-serif';
      ctx.fillText(def?.desc ?? '', btn.x + btn.w / 2, btn.y + 60);
    } else {
      ctx.fillStyle = btn.enabled ? '#fff6e6' : '#7a7160';
      ctx.font = 'bold 20px "PingFang SC", sans-serif';
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
  ctx.fillText(b.message, VIEW_W / 2, CTRL_Y + 64 + 20);
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
    }
  } else if (ui.dragTrayIndex !== null) {
    const token = b.tray[ui.dragTrayIndex];
    if (token) {
      src = traySlotCenter(ui.dragTrayIndex);
      ghost = () => drawTrayToken(ctx, token, ui.dragPos!.x, ui.dragPos!.y, CELL * 0.7);
    }
  }
  if (!ghost) return;
  // 目标格高亮
  const target = pxToCell(ui.dragPos.x, ui.dragPos.y);
  if (target) {
    const x = BOARD_X + target.c * CELL;
    const y = BOARD_Y + target.r * CELL;
    roundRect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 8);
    ctx.strokeStyle = '#e8a13c';
    ctx.lineWidth = 3;
    ctx.stroke();
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
