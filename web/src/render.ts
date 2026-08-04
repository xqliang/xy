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
import { Battle, unitColorOf, TUNING, itemById, SKILL_META, type TrayToken } from './battle';
import { generalById, qualityColor, qualityName } from './generals';
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
  const canSummon = b.peach >= b.summonCost; // 桃够即可征兵(不看候选槽；点后清空残余)
  // 对战中：4 键（征兵/布阵/绝招/神掌）；备战中：3 键（征兵/布阵/立即开战）
  if (b.status === 'playing') {
    const w4 = 124;
    const ultLabel = b.ultReady() ? '绝招 就绪🔥' : `绝招 ${Math.ceil(b.ultCooldownRemaining())}s`;
    return [
      { id: 'summon', label: `征兵${b.effectiveSummonCost()}🍑`, x: 20, y, w: w4, h, enabled: canSummon },
      { id: 'autoplace', label: '布阵', x: 152, y, w: w4, h, enabled: !trayEmpty },
      { id: 'ult', label: ultLabel, x: 284, y, w: w4, h, enabled: b.ultReady() },
      { id: 'palm', label: '神掌🖐', x: 416, y, w: w4, h, enabled: b.palmAvailable() },
    ];
  }
  return [
    { id: 'summon', label: `征兵 (${b.effectiveSummonCost()}🍑)`, x: 20, y, w: 168, h, enabled: canSummon },
    { id: 'autoplace', label: '一键布阵', x: 196, y, w: 168, h, enabled: !trayEmpty },
    { id: 'wave', label: '立即开战 ▶', x: 372, y, w: 168, h, enabled: b.status === 'ready' },
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
    const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    bg.addColorStop(0, b.map.theme.bg0);
    bg.addColorStop(1, b.map.theme.bg1);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  drawBoard(ctx, b, ui);
  drawSpawnGate(ctx, b);
  drawTangseng(ctx, b);
  drawMonsters(ctx, b);
  drawAiSide(ctx, b);
  drawUnits(ctx, b, ui);
  drawGenerals(ctx, b);
  drawFx(ctx, b);
  drawBursts(ctx, b);
  drawHeroUlt(ctx, b);
  drawDanger(ctx, b);
  drawSelection(ctx, b, ui);
  drawHud(ctx, b);
  drawHeroEnergy(ctx, b);
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
function drawTrayToken(ctx: CanvasRenderingContext2D, token: TrayToken, x: number, y: number, s: number) {
  if (token.kind === 'shovel') {
    roundRect(ctx, x - s / 2, y - s / 2, s, s, 10);
    ctx.fillStyle = '#e0b24a';
    ctx.fill();
    ctx.fillStyle = '#5a3a08';
    ctx.font = `${Math.round(s * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🪏', x, y);
  } else if (token.kind === 'word') {
    drawWordTile(ctx, token.char, token.tier, x, y, s);
  } else {
    drawUnit(ctx, token.type, token.tier, x, y, s);
  }
}

// 武将字牌：宣纸底 + 墨字 + 右上角阶数上标
function drawWordTile(ctx: CanvasRenderingContext2D, char: string, tier: number, x: number, y: number, s: number) {
  roundRect(ctx, x - s / 2, y - s / 2, s, s, 7);
  ctx.fillStyle = '#f8f4e6';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = qualityColor(tier);
  ctx.stroke();
  ctx.fillStyle = '#241d14';
  ctx.font = `bold ${Math.round(s * 0.58)}px "PingFang SC", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, x, y + s * 0.02);
  // 阶数上标
  ctx.fillStyle = qualityColor(tier);
  ctx.font = `bold ${Math.round(s * 0.24)}px "PingFang SC", sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(String(tier), x + s / 2 - 3, y - s / 2 + 2);
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
  const aiUnlocked = b.aiUnlocked;
  const th = b.map.theme;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = BOARD_X + c * CELL;
      const y = BOARD_Y + r * CELL;
      const inPlayer = r >= FENCE_ROW;
      const src = inPlayer ? { c, r } : mirrorCell({ c, r }); // AI 半场取镜像源判定类型
      const onPath = isPathCell(b.map, src.c, src.r);
      const cellOpen = inPlayer ? unlocked.has(`${c},${r}`) : aiUnlocked.has(`${c},${r}`);
      const ix = x + 1.5, iy = y + 1.5, iw = CELL - 3, ih = CELL - 3;
      if (onPath) {
        // 路径格：道路色 + 黑色描边与其他块分隔（水墨勾线）
        roundRect(ctx, ix, iy, iw, ih, 4);
        ctx.fillStyle = th.path;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(30,26,20,0.7)';
        ctx.stroke();
      } else if (cellOpen) {
        // 可放置格：米白 + 内斜角高光 + 柔和投影
        ctx.save();
        ctx.shadowColor = 'rgba(60,50,35,0.28)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        roundRect(ctx, ix, iy, iw, ih, 5);
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
        roundRect(ctx, ix, iy, iw, ih, 5); ctx.stroke();
      } else {
        // 不可放置格：同色系中间调 + 细点纹理 + 内边阴影
        roundRect(ctx, ix, iy, iw, ih, 4);
        ctx.fillStyle = th.cellLocked;
        ctx.fill();
        // 内边阴影
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(40,45,35,0.28)';
        ctx.lineWidth = 3;
        roundRect(ctx, ix + 1, iy + 1, iw - 2, ih - 2, 4); ctx.stroke();
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
        roundRect(ctx, ix, iy, iw, ih, 4); ctx.stroke();
      }
    }
  }
  drawBorderMotif(ctx, b);
  drawFence(ctx, b);
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
  if (!b.aiDefeated) drawGateAt(ctx, entrance(b.aiPath), b.aiSpawnGateT, b.map.id);
}

function drawGateAt(ctx: CanvasRenderingContext2D, cell: { c: number; r: number }, gateT: number, id: string) {
  const { x, y } = cellCenterPx(cell.c, cell.r);
  const open = gateT > 0 ? Math.sin(Math.PI * (1 - gateT / 0.5)) : 0; // 0→1→0
  const off = open * CELL * 0.34;
  ctx.save();
  if (id === 'pansidong') {
    // 盘丝洞：两团云/丝絮分开又合拢
    const puff = (px: number) => {
      ctx.beginPath();
      ctx.arc(px, y - 6, CELL * 0.16, 0, Math.PI * 2);
      ctx.arc(px + (px < x ? 6 : -6), y + 4, CELL * 0.13, 0, Math.PI * 2);
      ctx.fill();
    };
    ctx.fillStyle = 'rgba(150,110,150,0.75)';
    puff(x - off - CELL * 0.14);
    puff(x + off + CELL * 0.14);
  } else {
    // 火焰山/流沙河/白骨岭：两扇闸门开合
    const w = CELL * 0.4, h = CELL * 0.52;
    const leaf = (lx: number) => {
      roundRect(ctx, lx, y - h / 2, w, h, 5);
      ctx.fillStyle = id === 'baiguling' ? 'rgba(110,116,98,0.85)' : id === 'liushahe' ? 'rgba(150,124,70,0.85)' : 'rgba(120,60,40,0.85)';
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

// 入场缩放：由小变大略带回弹(easeOutBack)，营造"崩出来"感
function emergeScale(t: number): number {
  const d = 0.38;
  if (t >= d) return 1;
  const p = t / d;
  const c1 = 1.70158, c3 = c1 + 1;
  const ease = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  return 0.2 + 0.8 * ease;
}

// 单个怪物渲染（图标/圆形兜底 + 墨风血条 + 受击闪白 + 技能环 + 入场缩放）——玩家侧与 AI 侧共用
function drawMonsterAt(ctx: CanvasRenderingContext2D, x: number, y: number, rad0: number, m: { hp: number; maxHp: number; isBoss: boolean; hitFlash: number; skill: unknown; castFlash: number; spawnT: number }) {
  const rad = rad0 * emergeScale(m.spawnT);
  const spr = sprite(m.isBoss ? 'monster-boss' : 'monster-minion');
  if (spr) {
    const box = rad * 2.3;
    const scale = Math.min(box / spr.width, box / spr.height);
    ctx.drawImage(spr, x - (spr.width * scale) / 2, y - (spr.height * scale) / 2, spr.width * scale, spr.height * scale);
  } else {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = m.isBoss ? '#b02a5b' : '#7a2b2b';
    ctx.fill();
  }
  // 墨风血条：深墨底条(略带毛糙) + 朱红填充
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
    ctx.arc(x, y, rad, 0, Math.PI * 2);
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
    ctx.arc(x, y, rad + 3, 0, Math.PI * 2);
    ctx.stroke();
    if (m.castFlash > 0) {
      ctx.globalAlpha = m.castFlash;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, rad + 3 + (1 - m.castFlash) * 20, 0, Math.PI * 2);
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
    drawMonsterAt(ctx, x, y, m.isBoss ? CELL * 0.42 : CELL * 0.28, m);
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
    // 减益标识：被怪物技能命中时显示图标（定身/迟滞/弱身）
    const debuff: string | null = u.stunT > 0 ? SKILL_META.stun.icon : u.slowT > 0 ? SKILL_META.slow.icon : u.weakenT > 0 ? SKILL_META.weaken.icon : null;
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

// 棋盘上的武将字牌（各占一格）+ 已激活武将的金色边框与名号
function drawGenerals(ctx: CanvasRenderingContext2D, b: Battle) {
  // 先画所有字牌
  for (const w of b.words.values()) {
    const { x, y } = cellCenterPx(w.cell.c, w.cell.r);
    drawWordTile(ctx, w.char, w.tier, x, y, CELL * 0.78);
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
    // 名号 + 等级（框上方小标）
    ctx.fillStyle = '#7a4a10';
    ctx.font = `bold 11px "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${g.def.name}·Lv${g.state.level}`, x + w / 2, y - 1);
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

// 伪竞技 AI 对手（上半场，对角唐僧）。路径用棋盘格背景表示，不再画描边线。
function drawAiSide(ctx: CanvasRenderingContext2D, b: Battle) {
  // AI 怪物：图标 + 血条（与玩家侧一致，尺寸略小）
  for (const m of b.aiMonsters) {
    const p = b.aiMonsterPos(m);
    const { x, y } = cellCenterPx(p.c, p.r);
    drawMonsterAt(ctx, x, y, m.isBoss ? CELL * 0.34 : CELL * 0.24, m);
  }
  // AI 单位（上半场自动部署）
  for (const u of b.aiUnits) {
    const { x, y } = cellCenterPx(u.cell.c, u.cell.r);
    drawUnit(ctx, u.type, u.tier, x, y - u.firePulse * 3, CELL * 0.66 * (1 + u.firePulse * 0.14));
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

// 英雄绝招爆发：金色扩散冲击波 + 放射光束
function drawHeroUlt(ctx: CanvasRenderingContext2D, b: Battle) {
  if (b.ultFlash <= 0 || !b.ultCenter) return;
  const { x, y } = cellCenterPx(b.ultCenter.c, b.ultCenter.r);
  const t = 1 - b.ultFlash / 0.6; // 0→1
  ctx.save();
  // 扩散冲击环
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = '#ffe27a';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(x, y, 10 + t * TUNING.ultRadius * CELL * 1.1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#fff3c4';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 4 + t * TUNING.ultRadius * CELL * 0.7, 0, Math.PI * 2);
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

// 英雄绝招能量条（HUD 与棋盘之间的细条）+ 头像
function drawHeroEnergy(ctx: CanvasRenderingContext2D, b: Battle) {
  const y = HUD_H + 3;
  const h = 6;
  const x0 = BOARD_X + 22;
  const w = CELL * COLS - 22;
  ctx.save();
  // 底槽
  roundRect(ctx, x0, y, w, h, 3);
  ctx.fillStyle = 'rgba(60,45,25,0.35)';
  ctx.fill();
  // 充能
  const pct = Math.max(0, Math.min(1, b.heroEnergy));
  const full = pct >= 1;
  roundRect(ctx, x0, y, Math.max(2, w * pct), h, 3);
  ctx.fillStyle = full ? '#ffe27a' : '#e0a83c';
  ctx.fill();
  if (full) {
    ctx.globalAlpha = 0.5 + 0.4 * Math.sin(performance.now() / 120);
    ctx.strokeStyle = '#fff3c4';
    ctx.lineWidth = 2;
    roundRect(ctx, x0 - 1, y - 1, w + 2, h + 2, 4);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // 头像圆（左端）
  const cx = BOARD_X + 12;
  const cy = y + h / 2;
  const rad = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fillStyle = full ? '#ffcf4d' : '#b98a3a';
  ctx.fill();
  const spr = sprite(b.heroKey as Parameters<typeof sprite>[0]);
  if (spr) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad - 1, 0, Math.PI * 2);
    ctx.clip();
    const scale = Math.max((rad * 2) / spr.width, (rad * 2) / spr.height);
    ctx.drawImage(spr, cx - (spr.width * scale) / 2, cy - (spr.height * scale) / 2 - rad * 0.2, spr.width * scale, spr.height * scale);
    ctx.restore();
  }
  // 绝招 CD 倒计时 / 就绪 文字（叠在能量条右侧）
  ctx.fillStyle = full ? '#5a3a08' : 'rgba(90,60,20,0.85)';
  ctx.font = `bold 11px "PingFang SC", sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const label = b.status === 'playing'
    ? (full ? '绝招就绪·点下方按钮' : `绝招 ${Math.ceil(b.ultCooldownRemaining())}s`)
    : '绝招蓄力';
  ctx.fillText(label, x0 + w - 4, cy);
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
    ctx.fillStyle = btn.enabled ? (isItem ? '#3a2c53' : b.map.theme.accent) : '#3a3128';
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
      ctx.font = `bold ${btn.w < 140 ? 16 : 20}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2);
      // 绝招就绪高亮描边
      if (btn.id === 'ult' && btn.enabled) {
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(performance.now() / 130);
        ctx.strokeStyle = '#ffe27a';
        ctx.lineWidth = 3;
        roundRect(ctx, btn.x - 2, btn.y - 2, btn.w + 4, btn.h + 4, 12);
        ctx.stroke();
        ctx.restore();
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
