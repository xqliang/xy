// Canvas 渲染层。逻辑分辨率 560×920（竖屏，贴近微信小游戏）。
import {
  COLS,
  ROWS,
  FENCE_ROW,
  isEitherPathCell,
  isPlayerCell,
  aiHalfSafeRows,
  posAtDistance,
  posAlong,
  lenOf,
  mirrorCell,
  placeableCells,
  type Cell,
  type GameMap,
} from './board';
import { Battle, TUNING, MAP_ELEMENT, PALM_PUSH_FADE_DUR, SKILL_META, MINI_BOSS_META, UNIT_STATUS_META, MONSTER_STATUS_META, PEACH_TREE, PEACH_FLOAT_FALL, DAMAGE_FLOAT_FALL, PLACE_TIMING, placeDragEase, SKILL_FX_DUR, BUFF_SKILL_FX_DUR, type TrayToken, type PeachTree, type HeroUltFx, type ErlangDogFx, type HitFx, type ActiveGeneral, type UnitStatusId, type MonsterStatusId, type MiniBossKind, type Monster, type PlacedUnit, type SkillFx, type SkillFxKind, type Burst } from './battle';
import { passiveById, MAX_EQUIPPED_PASSIVES } from './passives';
import { activeById, isPillActiveEffect, isBombActiveEffect, MAX_EQUIPPED_ACTIVES } from './actives';
import { generalById, generalStat, primaryGeneralForChar, inactivePartnerHint, sortedPartnerChars, qualityColor, qualityName, BOND_NAME, GENERAL_TUNING, BOND_GENERAL, heroAttackFxTtl } from './generals';
import { UNITS, getUnitStat, damage, canMerge, MAX_TIER, ECONOMY, ELEMENT_COLOR } from '@core';
import type { UnitType } from '@core';
import { sprite, unitAsset, monsterSprite, cavalrySprite, miniBossSprite } from './assets';
import { getBestWave } from './endless';
import { getSettings } from './settings';
import { generalEquippedWeapon, weaponBonusLabel, weaponQualityColor, weaponQualityName } from './weapons';
import { drawSkillGlyph, skillAssetKey } from './skill-icon';
import { drawPeachIcon } from './peach-icon';
import { drawElementBadge, drawCounterBadge, counterRelation } from './wuxing-ui';
import { showAutoplaceBtn, wuxingEnabled } from './dev-flags';
import { isWeChat } from './platform';

/** 征兵按钮与 HUD 蟠桃图标显示边长（1.5× 基础后再 ×0.7） */
export const PEACH_UI_ICON_SIZE = Math.round(26 * 1.5 * 0.7);

export const VIEW_W = 560;
export const HUD_H = 72;
export const CELL = Math.floor((VIEW_W - 16) / COLS); // 8 列自适应 → 68
export const BOARD_X = Math.round((VIEW_W - CELL * COLS) / 2);
export const BOARD_Y = HUD_H + 12;
export const BOARD_H = CELL * ROWS;
export const TRAY_Y = BOARD_Y + BOARD_H + 8; // 候选区行
export const TRAY_H = 78; // 候选区行高（放大：候选槽≈地图格子大小）
export const CTRL_Y = TRAY_Y + TRAY_H + 26; // 控制按钮行（与候选区拉开间距，避免从「宫」拖令牌部署时误点征兵）
export const CTRL_H = 80; // 行高预留：容纳更大的征兵按钮，下方 PAS 行据此下移不重叠
export const PAS_Y = CTRL_Y + CTRL_H + 8; // 被动/强化技能图标行
export const PAS_H = 46;
export const MSG_Y = PAS_Y + PAS_H + 16; // 提示文字行
export const VIEW_H = MSG_Y + 18;

const UNIT_LABEL: Record<UnitType, string> = {
  dao: '刀',
  spear: '枪',
  cavalry: '骑',
  archer: '弓',
};

export function cellCenterPx(c: number, r: number): { x: number; y: number } {
  return { x: BOARD_X + c * CELL + CELL / 2, y: BOARD_Y + r * CELL + CELL / 2 };
}

/** 单格矩形（新手引导高亮出怪口/唐僧格等用） */
export function cellRect(c: number, r: number): { x: number; y: number; w: number; h: number } {
  return { x: BOARD_X + c * CELL, y: BOARD_Y + r * CELL, w: CELL, h: CELL };
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
  // 桃够且候选区飞入结束才可征兵（防连点；点后仍清空残余 tray）
  const peachOk = b.peach >= b.effectiveSummonCost();
  const canSummon = peachOk && summonAnimDone(b);
  // 备战(ready)与对战(playing)共用同一套底部布局：中央「征兵」，两翼已购主动技能图标(带CD)，候选区右端「布阵」，
  // 下方一排已购被动技能图标。主动/被动都仅在购买后显示；如来神掌等主动技能需在商店购买才出现。
  // 布阵：默认隐藏（DevTools 可开）——首局体验让「征兵→拖到战场」的部署流作为唯一布阵入口，
  // 避免布阵按钮与首局动态引导抢戏；隐藏时 draw/hit 共享同一列表一起消失。
  // trayRightX 供「布阵」按钮定位：该按钮右缘 VIEW_W-10、宽度 VIEW_W-trayRightX-10，故始终靠在 tray 右侧、紧贴右边界。
  const trayRightX = TRAY_LEFT + TUNING.traySize * TRAY_SLOT + 8; // 候选槽右侧
  const summonLabel = peachOk && !summonAnimDone(b) ? '征兵中' : `征兵${b.effectiveSummonCost()}`;
  const btns: Button[] = [];
  if (showAutoplaceBtn()) {
    btns.push({ id: 'autoplace', label: '布阵', x: trayRightX, y: TRAY_Y + 6, w: VIEW_W - trayRightX - 10, h: TRAY_H - 12, enabled: true });
  }
  // 征兵：主 CTA，加大(200×78)且比两翼按钮更靠下，配合上移的行间距，避免从「宫」拖令牌部署时误点
  btns.push({ id: 'summon', label: summonLabel, x: 180, y, w: 200, h: 78, enabled: canSummon });
  // 两翼主动技能圆形图标：紧贴「征兵」两侧、与之垂直居中（对齐竞品）。仅渲染已装备的槽。
  const ACT_D = 60; // 圆直径
  const ACT_GAP = 20; // 与「征兵」按钮的间隙（左右各留 20px）
  const SUMMON_X = 180, SUMMON_W = 200, SUMMON_H = 78; // 与上方征兵按钮保持一致
  const actX = [SUMMON_X - ACT_GAP - ACT_D, SUMMON_X + SUMMON_W + ACT_GAP]; // 征兵左侧/右侧
  const actY = y + (SUMMON_H - ACT_D) / 2; // 与征兵按钮垂直居中
  for (let i = 0; i < b.activeSlots.length && i < 2; i++) {
    btns.push({ id: `act${i}`, label: '', x: actX[i]!, y: actY, w: ACT_D, h: ACT_D, enabled: true });
  }
  // 被动/强化技能行：居中显示，每个已携带道具一格，可点击查看详情/进度
  const pasPitch = PAS_H + 6;
  const pasStartX = (VIEW_W - (b.pickedItems.length * pasPitch - 6)) / 2;
  for (let i = 0; i < b.pickedItems.length; i++) {
    btns.push({ id: `pas${i}`, label: '', x: pasStartX + i * pasPitch, y: PAS_Y, w: PAS_H, h: PAS_H, enabled: true });
  }
  return btns;
}

/** 主动技能槽圆心（与 getButtons 中 act0/act1 布局一致，供拖拽虚线用） */
function activeSlotCenter(i: 0 | 1): { x: number; y: number } {
  const ACT_D = 60;
  const ACT_GAP = 20;
  const SUMMON_X = 180;
  const SUMMON_W = 200;
  const SUMMON_H = 78;
  const actX = [SUMMON_X - ACT_GAP - ACT_D, SUMMON_X + SUMMON_W + ACT_GAP];
  const actY = CTRL_Y + (SUMMON_H - ACT_D) / 2;
  return { x: actX[i]! + ACT_D / 2, y: actY + ACT_D / 2 };
}

/** 主动技能槽的高亮矩形（引导锚点用）。 */
export function activeSlotRect(i: 0 | 1): { x: number; y: number; w: number; h: number } {
  const ACT_D = 60;
  const c = activeSlotCenter(i);
  return { x: c.x - ACT_D / 2, y: c.y - ACT_D / 2, w: ACT_D, h: ACT_D };
}

const SKILL_TITLE_COLOR = '#e8c22c'; // 与神兵金阶同色
const ACTIVE_CD_OVERLAY = 'rgba(0,0,0,0.30)'; // 主动技能冷却扇形遮罩（略透明以便看清图标）

export interface UiState {
  dragFrom: Cell | null; // 从棋盘拖动的单位源格
  dragTrayIndex: number | null; // 从候选区拖动的令牌下标
  dragPos: { x: number; y: number } | null;
  dragActiveSlot: number | null; // 从主动技能槽拖出仙丹/风火轮
  activeDragStart: { x: number; y: number } | null;
  trayDragStart: { x: number; y: number } | null; // 候选区按下起点（区分点击与拖拽）
  selected: Cell | null; // 点击选中的单位格（仅此时显示攻击范围+信息面板）
  selectedTrayIndex: number | null; // 点击选中的候选区字牌（查看武将信息）
  selectedMonster: { side: 'player' | 'ai'; id: number } | null; // 点击选中的妖怪（按 id，可跨格移动）
  passivePopup: number | null; // 点击的被动/强化道具下标（显示详情/进度弹窗）
  passivePopupUntil: number; // 被动技能弹窗展示截止时间(performance.now ms)
  activePopup: number | null; // 点击的主动技能槽下标（CD中点击显示介绍弹窗，定时自动淡出）
  activePopupUntil: number; // 主动技能弹窗展示截止时间(performance.now ms)
  aiItemPopup: number | null; // 点击 HUD 右上角 AI 道具图标（aiPickedItems 下标）
  peachPopup: boolean; // 点击我方 HUD 蟠桃：显示数量与获取途径
  bombPopup: { c: number; r: number; until: number } | null; // 点击路径上已埋地雷：显示该雷信息（until 自动淡出）
  paused: boolean; // 局内手动暂停（弹窗遮罩，step 停表）
}

/** HUD 左上角暂停按钮：蟠桃数字前方（不压地图，避免挡英雄操作） */
export const PAUSE_BTN = { x: 10, s: 32 };
export function pauseBtnRect(): { x: number; y: number; w: number; h: number } {
  return { x: PAUSE_BTN.x, y: (HUD_H - PAUSE_BTN.s) / 2, w: PAUSE_BTN.s, h: PAUSE_BTN.s };
}

export function hitPauseBtn(x: number, y: number): boolean {
  const r = pauseBtnRect();
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** HUD 蟠桃图标+数字的大致包围盒（暂停钮右侧），供新手引导高亮定位 / 点击弹窗 */
export function peachHudRect(): { x: number; y: number; w: number; h: number } {
  const pauseR = pauseBtnRect();
  const iconSize = PEACH_UI_ICON_SIZE;
  const x = pauseR.x + pauseR.w + 10;
  const y = HUD_H / 2 - iconSize / 2 - 4;
  return { x, y, w: iconSize + 6 + 56, h: iconSize + 8 };
}

export function hitPeachHud(x: number, y: number): boolean {
  const r = peachHudRect();
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// HUD 显示的境界名（由 main 设置）
let hudRankLabel = '';
export function setHudRank(label: string): void {
  hudRankLabel = label;
}

// —— Task 9.4：PvP 双方延迟 HUD 态 ——
// 背景：对局顶部中块画「波次 / 境界」，现要求把双方延迟分列其左右两侧（左=本侧「我」、右=对手「对」）。
// drawHud 本身不拿得到两侧 rtt（它在 render 渲染链路里，签名只有 ctx/b/ui），故采用与 hudRankLabel 同款
// 「main 每帧写入模块态、drawHud 读取」的倒置注入：main.ts 每帧 setPvpNetLatency，drawHud 据态画两侧。
// 单人（无对局）main 传 null → drawHud 不画，零影响（与旧 drawNetLatencyHud 的 pvpSock 门控等价）。
/** PvP 双方延迟 HUD 态：myRtt=本侧 pvpSock.rttMs；oppRtt=对手最新快照 rtt。null=非对局（不画）。 */
let pvpNetLat: { myRtt: number | null; oppRtt: number | null } | null = null;
/** 写入 PvP 双方延迟 HUD 态（每帧由 main.ts 调用）；传 null 表示非对局，drawHud 跳过两侧标注。 */
export function setPvpNetLatency(state: { myRtt: number | null; oppRtt: number | null } | null): void {
  pvpNetLat = state;
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

/** 按最大宽度逐字换行（中英文混排）；支持显式 \\n */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ch === '\n') { lines.push(line); line = ''; continue; }
    const test = line + ch;
    if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = ch; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** 确定性伪随机 0..1（开垦格纹理用，同格稳定） */
function cellHash01(c: number, r: number, salt: number): number {
  let x = (c * 374761393 + r * 668265263 + salt * 982451653) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x >>> 0) % 10000) / 10000;
}

/**
 * 已开垦白格：米白底 + 随机浅淡水斑（软边椭圆晕），轻薄不抢戏。
 */
function drawUnlockedCellFace(
  ctx: CanvasRenderingContext2D,
  ix: number,
  iy: number,
  iw: number,
  ih: number,
  c: number,
  r: number,
  baseColor: string,
) {
  ctx.save();
  roundRect(ctx, ix, iy, iw, ih, 2);
  ctx.clip();
  ctx.fillStyle = baseColor;
  ctx.fillRect(ix, iy, iw, ih);

  // 每格 2～5 块水斑，位置/大小/深浅都随机但同格稳定
  const n = 2 + Math.floor(cellHash01(c, r, 3) * 4);
  for (let k = 0; k < n; k++) {
    const px = ix + 4 + cellHash01(c, r, 10 + k * 7) * (iw - 8);
    const py = iy + 4 + cellHash01(c, r, 20 + k * 7) * (ih - 8);
    // 扁椭圆水渍，略旋转
    const rx = 3 + cellHash01(c, r, 30 + k * 7) * Math.min(iw, ih) * 0.28;
    const ry = rx * (0.45 + cellHash01(c, r, 40 + k * 7) * 0.55);
    const ang = cellHash01(c, r, 50 + k * 7) * Math.PI;
    const a = 0.11 + cellHash01(c, r, 60 + k * 7) * 0.14; // 灰斑略加重
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.scale(1, Math.max(0.35, ry / rx));
    const g = ctx.createRadialGradient(0, 0, rx * 0.15, 0, 0, rx);
    g.addColorStop(0, `rgba(135,128,115,${a})`);
    g.addColorStop(0.55, `rgba(145,138,125,${a * 0.55})`);
    g.addColorStop(1, 'rgba(150,142,130,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 再撒几滴更小的浅渍
  const m = 1 + Math.floor(cellHash01(c, r, 70) * 3);
  for (let k = 0; k < m; k++) {
    const px = ix + 5 + cellHash01(c, r, 80 + k * 5) * (iw - 10);
    const py = iy + 5 + cellHash01(c, r, 90 + k * 5) * (ih - 10);
    const rad = 1.2 + cellHash01(c, r, 100 + k * 5) * 2.8;
    const a = 0.08 + cellHash01(c, r, 110 + k * 5) * 0.1;
    const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, `rgba(130,124,112,${a})`);
    g.addColorStop(1, 'rgba(130,124,112,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(90,82,70,0.16)';
  roundRect(ctx, ix, iy, iw, ih, 2);
  ctx.stroke();
}

// 统一的右上角阶数：无底色，仅描边 + 金字，避免压住立绘/字牌
function drawTierBadge(ctx: CanvasRenderingContext2D, nx: number, ny: number, tier: number, fontPx: number) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${fontPx}px "PingFang SC", sans-serif`;
  ctx.lineWidth = Math.max(2.5, fontPx * 0.2);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(20,14,6,0.95)';
  ctx.strokeText(String(tier), nx, ny);
  ctx.fillStyle = '#ffe6a2';
  ctx.fillText(String(tier), nx, ny);
  ctx.restore();
}

/** 状态芯片：深色圆底 + 彩色描边 + 图标，去掉立绘底色后仍清晰可读 */
function drawStatusChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  icon: string,
  color: string,
  r = 9,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12,10,8,0.88)';
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = color;
  ctx.stroke();
  // 内侧淡色晕，增强对比
  ctx.beginPath();
  ctx.arc(x, y, r - 1.2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,245,220,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = `${Math.round(r * 1.15)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff8e8';
  ctx.fillText(icon, x, y + 0.5);
  ctx.restore();
}

/** 横向排列多个状态芯片（右对齐锚点） */
function drawStatusRow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  items: { icon: string; color: string }[],
  r = 9,
) {
  if (items.length === 0) return;
  const gap = r * 2 + 3;
  const total = gap * (items.length - 1);
  const startX = cx - total / 2;
  items.forEach((it, i) => drawStatusChip(ctx, startX + i * gap, cy, it.icon, it.color, r));
}

function unitStatusItems(u: {
  stunT: number;
  slowT: number;
  weakenT: number;
  rangeCutT: number;
  knockdownT: number;
  buffAtkT?: number;
  pillAtk?: boolean;
  pillFrq?: boolean;
}): { icon: string; color: string }[] {
  const items: { icon: string; color: string }[] = [];
  if ((u.buffAtkT ?? 0) > 0) items.push({ icon: '炼', color: '#e8a830' });
  if (u.pillAtk) items.push({ icon: '丹', color: '#ff6040' });
  if (u.pillFrq) items.push({ icon: '轮', color: '#ffb830' });
  const order: UnitStatusId[] = ['knockdown', 'stun', 'slow', 'weaken', 'webbind'];
  const on: Record<UnitStatusId, boolean> = {
    knockdown: u.knockdownT > 0,
    stun: u.stunT > 0,
    slow: u.slowT > 0,
    weaken: u.weakenT > 0,
    webbind: u.rangeCutT > 0,
  };
  items.push(...order.filter((id) => on[id]).map((id) => UNIT_STATUS_META[id]));
  return items;
}

function monsterStatusItems(m: {
  stunT: number;
  slowT: number;
  hasteT: number;
  healFlash: number;
  burnT: number;
}): { icon: string; color: string; name: string }[] {
  const order: MonsterStatusId[] = ['stun', 'slow', 'haste', 'heal', 'burn'];
  const on: Record<MonsterStatusId, boolean> = {
    stun: m.stunT > 0,
    slow: m.slowT > 0,
    haste: m.hasteT > 0,
    heal: m.healFlash > 0.05,
    burn: m.burnT > 0,
  };
  return order.filter((id) => on[id]).map((id) => MONSTER_STATUS_META[id]);
}

function formatRemainT(t: number): string {
  return t >= 10 ? `${Math.ceil(t)}s` : `${t.toFixed(1)}s`;
}

function bondAtkPctLabel(): string {
  return `+${Math.round(GENERAL_TUNING.BOND_ATK_BONUS * 100)}%`;
}

function bondBuffText(): string {
  return `🐵${BOND_NAME} 攻击${bondAtkPctLabel()}`;
}

function unitStatusEntries(u: {
  stunT: number;
  slowT: number;
  weakenT: number;
  rangeCutT: number;
  knockdownT: number;
}): { meta: (typeof UNIT_STATUS_META)[UnitStatusId]; remain: number }[] {
  const order: UnitStatusId[] = ['knockdown', 'stun', 'slow', 'weaken', 'webbind'];
  const timers: Record<UnitStatusId, number> = {
    knockdown: u.knockdownT,
    stun: u.stunT,
    slow: u.slowT,
    weaken: u.weakenT,
    webbind: u.rangeCutT,
  };
  return order
    .filter((id) => timers[id] > 0)
    .map((id) => ({ meta: UNIT_STATUS_META[id], remain: timers[id] }));
}

function monsterStatusEntries(m: {
  stunT: number;
  slowT: number;
  hasteT: number;
  healFlash: number;
  burnT: number;
}): { meta: (typeof MONSTER_STATUS_META)[MonsterStatusId]; remain: number }[] {
  const order: MonsterStatusId[] = ['stun', 'slow', 'haste', 'heal', 'burn'];
  const timers: Record<MonsterStatusId, number> = {
    stun: m.stunT,
    slow: m.slowT,
    haste: m.hasteT,
    heal: m.healFlash > 0.05 ? m.healFlash / 2.5 : 0,
    burn: m.burnT,
  };
  return order
    .filter((id) => timers[id] > 0)
    .map((id) => ({ meta: MONSTER_STATUS_META[id], remain: timers[id] }));
}

function formatStatusLine(
  entries: { meta: { icon: string; name: string }; remain: number }[],
): string {
  return entries.map((e) => `${e.meta.icon}${e.meta.name} ${formatRemainT(e.remain)}`).join(' · ');
}

function alchemyBuffLine(buffAtkT: number, buffAtkMul?: number): string | null {
  if (buffAtkT <= 0) return null;
  const mul = buffAtkMul ?? 1;
  return `⚗炼丹 攻击×${mul.toFixed(2)} ·${Math.ceil(buffAtkT)}s`;
}

/** 单体仙丹/风火轮：信息弹窗用图标条目（不再画在棋盘格角，避免挡等级） */
type PillBuffEntry = { icon: string; name: string; color: string; label: string };

function pillBuffEntries(target?: { unit?: PlacedUnit; general?: ActiveGeneral }): PillBuffEntry[] {
  const out: PillBuffEntry[] = [];
  if (target?.unit?.pillAtk || target?.general?.pillAtk) {
    out.push({
      icon: '丹',
      name: '仙丹',
      color: '#ff6040',
      label: `攻击+${Math.round((TUNING.atkBuffMul - 1) * 100)}%`,
    });
  }
  if (target?.unit?.pillFrq || target?.general?.pillFrq) {
    out.push({
      icon: '轮',
      name: '风火轮',
      color: '#ffb830',
      label: `攻速+${Math.round((TUNING.frqBuffMul - 1) * 100)}%`,
    });
  }
  return out;
}

/** 信息弹窗内画仙丹/风火轮增益行：左「增益」+ 右侧文案，最右图标芯片 */
function drawPillBuffRows(
  ctx: CanvasRenderingContext2D,
  px: number,
  pw: number,
  ry: number,
  pills: PillBuffEntry[],
): number {
  for (const p of pills) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#a0e8b0';
    ctx.font = '13px "PingFang SC", sans-serif';
    ctx.fillText('增益', px + 12, ry);
    const chipX = px + pw - 16;
    drawStatusChip(ctx, chipX, ry, p.icon, p.color, 8);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#c8ffd8';
    ctx.fillText(`${p.name}·${p.label}`, chipX - 14, ry);
    ry += 16;
  }
  return ry;
}

/** 全局主动/被动增益文案（用于信息弹窗；单体仙丹/风火轮见 pillBuffEntries） */
function battleBuffLines(
  b: Battle,
  ctx: 'unit' | 'general' | 'monster',
  monster?: Monster,
  monsterSide: 'player' | 'ai' = 'player',
  general?: ActiveGeneral,
  unit?: PlacedUnit,
): string[] {
  const lines: string[] = [];
  if (ctx !== 'monster') {
    if (b.bondActive()) lines.push(bondBuffText());
    if (b.mods.atkMul > 1.001) lines.push(`💊被动 攻击×${b.mods.atkMul.toFixed(2)}`);
    if (b.mods.frqMul > 1.001) lines.push(`💨被动 攻速×${b.mods.frqMul.toFixed(2)}`);
  }
  if (ctx === 'general' && general) {
    const line = alchemyBuffLine(general.state.buffAtkT ?? 0, general.state.buffAtkMul);
    if (line) lines.push(line);
  }
  if (ctx === 'unit' && unit) {
    const line = alchemyBuffLine(unit.buffAtkT ?? 0, unit.buffAtkMul);
    if (line) lines.push(line);
  }
  if (ctx === 'monster' && monsterSide === 'player') {
    if (b.mods.monsterSpdMul < 0.999) {
      lines.push(`🕸被动 移速×${b.mods.monsterSpdMul.toFixed(2)}`);
    }
    if (monster && b.monsterInMudZone(monster)) {
      lines.push(`🟤淤泥 移速×0.82`);
    }
  }
  return lines;
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  type: UnitType,
  tier: number,
  x: number,
  y: number,
  size: number,
  faceLeft = false,
  badge?: { x: number; y: number; s: number },
  fallen = false,
  side: 'player' | 'ai' = 'player',
) {
  const s = size;
  // 不再画类型色底座：棋盘格与托盘都直接用透明立绘，无背景色
  const spr = sprite(unitAsset(type));
  if (spr) {
    // 立绘按 contain 缩放居中，铺满整格；各类型内容留白不同，按系数微调视觉大小
    const typeScale = type === 'dao' ? 1.06 : type === 'archer' ? 1.1 : type === 'spear' ? 1.08 : 1; // 刀×1.06 / 射手×1.10 / 矛×1.08 / 骑手×1
    const box = s;
    const scale = Math.min(box / spr.width, box / spr.height) * typeScale;
    const dw = spr.width * scale;
    const dh = spr.height * scale;
    ctx.save();
    // 立绘水平翻转只看 faceLeft（朝左攻击时翻）。两侧同一套：因为 fireDir 现已是「屏幕正确」的
    // 本地朝向（玩家朝己方入口、对手经桥 faceDirToward 朝 AI 入口），standard faceLeft 对两侧都对。
    // （旧的 side==='ai' ? !faceLeft 是在补偿早期传输/镜像污染的 fireDir，现已随本地模拟移除。）
    const flip = faceLeft;
    if (fallen) {
      // 倒下：横躺 + 略压扁，与「无法攻击」状态对应
      ctx.translate(x, y + s * 0.08);
      ctx.rotate(Math.PI / 2);
      ctx.scale(1, 0.72);
      if (flip) { ctx.scale(-1, 1); }
      ctx.drawImage(spr, -dw / 2, -dh / 2, dw, dh);
    } else {
      // 刀/枪/弓/骑：朝左攻击时水平翻转立绘（AI 侧默认已翻转，攻击反向时翻回）
      if (flip) { ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0); }
      ctx.drawImage(spr, x - dw / 2, y - dh / 2, dw, dh);
    }
    ctx.restore();
  } else {
    ctx.save();
    if (fallen) {
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#1a1208';
      ctx.font = `bold ${Math.round(s * 0.42)}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(UNIT_LABEL[type], 0, 0);
    } else {
      ctx.fillStyle = '#1a1208';
      ctx.font = `bold ${Math.round(s * 0.42)}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(UNIT_LABEL[type], x, y - s * 0.06);
    }
    ctx.restore();
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
  drawWeaponGlyph(ctx, type, s, pulse, combo, tier);
  // 朝向箭头（刀/骑不出箭头，避免抢戏）
  if (type !== 'dao' && type !== 'cavalry') {
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

/** 鞭扫残影：环形扇区渐变填充（与鞭体同为 20%～85% 半径） */
function drawWhipSweepFill(
  ctx: CanvasRenderingContext2D,
  fromAng: number,
  toAng: number,
  reach: number,
  alpha: number,
) {
  let sweep = toAng - fromAng;
  while (sweep <= 0) sweep += Math.PI * 2;
  if (sweep < 0.05 || alpha <= 0.02) return;
  const r0 = reach * 0.20;
  const r1 = reach * 0.85;
  const slices = Math.max(8, Math.ceil(sweep / 0.2));
  for (let i = 0; i < slices; i++) {
    const t0 = i / slices;
    const t1 = (i + 1) / slices;
    const a0 = fromAng + sweep * t0;
    const a1 = fromAng + sweep * t1;
    const along = (t0 + t1) * 0.5;
    ctx.globalAlpha = alpha * (0.1 + 0.32 * along);
    const grad = ctx.createRadialGradient(0, 0, r0, 0, 0, r1);
    grad.addColorStop(0, 'rgba(145,120,90,0)');
    grad.addColorStop(0.5, 'rgba(130,105,78,0.4)');
    grad.addColorStop(1, 'rgba(110,88,64,0.14)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r1, a0, a1);
    ctx.arc(0, 0, r0, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  }
}

// 弯曲鞭梢：虚线、粗→细、只画外段；tier 越高越粗
function drawCurvedWhip(
  ctx: CanvasRenderingContext2D,
  ang: number,
  reach: number,
  alpha: number,
  side = 1,
  flex = 1,
  tier = 1,
) {
  if (alpha <= 0.02 || reach < 4) return;
  const r0 = reach * 0.20;
  const r1 = reach * 0.85;
  const n = 16;
  const lag = 0.85 * side * (0.65 + 0.5 * flex);
  const belly = 0.45 * side * flex;
  const pts: { x: number; y: number; t: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ease = t * t * (3 - 2 * t);
    const r = r0 + (r1 - r0) * ease;
    const a = ang - lag * t * t + Math.sin(t * Math.PI) * belly * (1 - t * 0.2);
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, t });
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const wScale = Math.max(0.75, reach / (CELL * 1.85));
  const thickMul = 1 + (tier - 1) * 0.22;
  const midW = (2.4 * 0.5 + 0.6) * wScale * thickMul;
  ctx.save();
  // 更虚：短实线 + 长空隙
  ctx.setLineDash([Math.max(2.5, midW * 1.2), Math.max(7, midW * 4.2)]);
  ctx.lineDashOffset = 0;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i <= n; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.globalAlpha = alpha * 0.28;
  ctx.strokeStyle = 'rgba(70,52,38,0.45)';
  ctx.lineWidth = midW * 1.25;
  ctx.stroke();
  for (let i = 0; i < n; i++) {
    const tMid = (pts[i]!.t + pts[i + 1]!.t) / 2;
    const w = (2.4 * (1 - tMid) + 0.6) * wScale * thickMul;
    const shade = 78 + Math.round(tMid * 36);
    ctx.globalAlpha = alpha * (0.5 + 0.28 * (1 - tMid));
    ctx.strokeStyle = `rgb(${shade + 18},${shade + 4},${shade - 6})`;
    ctx.lineWidth = w;
    ctx.setLineDash([Math.max(2.2, w * 1.3), Math.max(6.5, w * 4.5)]);
    ctx.beginPath();
    ctx.moveTo(pts[i]!.x, pts[i]!.y);
    ctx.lineTo(pts[i + 1]!.x, pts[i + 1]!.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/** 弯刀：白刃 + 金护手 + 黑柄 + 金球；沿 +x 出尖、柄在 -x；外凸锋刃在 +y（配合 scale(1,hand) 对齐劈砍前进侧） */
function drawCurvedDao(ctx: CanvasRenderingContext2D, s: number, alpha: number) {
  if (alpha <= 0.02) return;
  const tipX = s * 1.02;
  const guardX = s * 0.1;
  const handleEnd = -s * 0.26;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 白刃：细长略弯；肚子比极细版稍鼓一点；+y 侧外凸锋刃，-y 侧刀背
  ctx.beginPath();
  ctx.moveTo(guardX, -s * 0.032);
  ctx.bezierCurveTo(s * 0.36, -s * 0.045, s * 0.7, -s * 0.055, tipX - s * 0.03, -s * 0.022);
  ctx.quadraticCurveTo(tipX + s * 0.012, 0, tipX - s * 0.01, s * 0.02);
  ctx.bezierCurveTo(s * 0.68, s * 0.145, s * 0.36, s * 0.12, guardX, s * 0.028);
  ctx.closePath();
  ctx.fillStyle = '#f5f7fb';
  ctx.fill();
  ctx.strokeStyle = '#1a1208';
  ctx.lineWidth = Math.max(1.5, s * 0.04);
  ctx.stroke();
  // 刃口高光（锋刃一侧）
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1.0, s * 0.022);
  ctx.beginPath();
  ctx.moveTo(guardX + s * 0.04, s * 0.014);
  ctx.bezierCurveTo(s * 0.4, s * 0.08, s * 0.7, s * 0.09, tipX - s * 0.08, s * 0.025);
  ctx.stroke();

  // 金护手
  ctx.fillStyle = '#e8b84a';
  ctx.strokeStyle = '#8a5a12';
  ctx.lineWidth = 1.2;
  const gw = s * 0.07, gh = s * 0.2;
  roundRect(ctx, guardX - gw * 0.55, -gh / 2, gw, gh, 2);
  ctx.fill();
  ctx.stroke();

  // 黑柄
  ctx.fillStyle = '#1a1208';
  ctx.beginPath();
  ctx.moveTo(handleEnd + s * 0.02, -s * 0.038);
  ctx.lineTo(guardX - gw * 0.35, -s * 0.038);
  ctx.lineTo(guardX - gw * 0.35, s * 0.038);
  ctx.lineTo(handleEnd + s * 0.02, s * 0.038);
  ctx.closePath();
  ctx.fill();
  // 柄缠线
  ctx.strokeStyle = 'rgba(80,60,40,0.7)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const hx = handleEnd + s * 0.07 + i * s * 0.05;
    ctx.beginPath();
    ctx.moveTo(hx, -s * 0.032);
    ctx.lineTo(hx - s * 0.015, s * 0.032);
    ctx.stroke();
  }

  // 金球柄头
  ctx.fillStyle = '#e8b84a';
  ctx.strokeStyle = '#8a5a12';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(handleEnd, 0, s * 0.055, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// 在已 translate 到单位中心、rotate 到 dir 的坐标系里，绘制单个兵器（沿 +x 出招）
function drawWeaponGlyph(ctx: CanvasRenderingContext2D, type: UnitType, s: number, pulse: number, combo: number, tier = 1) {
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
    case 'cavalry': { // 骑：虚线弯鞭 + 扇区残影；转速由 firePulse 衰减控制（阶越高越快）
      const phase = 1 - pulse;
      const reach = (UNITS.cavalry.rge + TUNING.rangeTolerance) * CELL;
      const fromAng = -Math.PI;
      const tipAng = fromAng + phase * Math.PI * 2;
      const flex = Math.sin(phase * Math.PI);
      const alpha = Math.min(1, pulse * 1.15);
      drawWhipSweepFill(ctx, fromAng, tipAng, reach, alpha * 0.9);
      drawCurvedWhip(ctx, tipAng, reach, alpha, 1, flex, tier);
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
    default: { // 刀兵：立绘出招不画刀，弯刀砍击只画在怪物身上（drawFx）
      break;
    }
  }
}

/** 小游戏全屏无缝底：当前地图场景 cover 铺满整块画布(device 坐标)，作 letterbox 黑边的背景延伸。
 *  静态图（不随帧变），故不会像「采样 VIEW 边缘」那样跟着 HUD/候选区动画闪；由 main 帧首在 device 坐标调。 */
// 小游戏无缝全屏底：把「当前页自己的背景」铺满整块设备画布（含上下 letterbox 黑边区）。
// 约定：在 letterbox 变换(逻辑坐标)下调用，(x,y,w,h) 为覆盖整屏的扩展矩形(含黑边)。
// 渐变页锚定 VIEW(0..VIEW_H)→VIEW 区与各页 inline 背景逐像素一致，黑边落在 VIEW 外→canvas 渐变 clamp 到端点色，天然无缝。
// 图片页(首页/战斗)按扩展矩形 cover 铺满(其 inline 背景在 wx 下跳过，避免两套不同缩放的图在 VIEW 边界接缝)。
// 各页颜色需与对应模块 inline 背景保持一致：codex/leaderboard/bag 的渐变、pvp-screen 的米色、menu 的 menu-home+薄纱。
export function drawScreenBackdrop(
  ctx: CanvasRenderingContext2D, screen: string, b: Battle,
  x: number, y: number, w: number, h: number,
): void {
  const fillVGrad = (c0: string, c1: string) => {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H); // 锚定 VIEW，与各页 inline 渐变一致
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  };
  if (screen === 'codex') return fillVGrad('#2a2418', '#3a3222');
  if (screen === 'rank') return fillVGrad('#22283a', '#2e3550');
  if (screen === 'bag') return fillVGrad('#2b2418', '#3b3324');
  if (screen === 'pvpMatching') { ctx.fillStyle = '#efe3c6'; ctx.fillRect(x, y, w, h); return; }
  // 加载页：黑边续 loading-screen drawPaper 的纸色首尾（PAPER_TOP #f0e4c8 / PAPER_BOTTOM #c8a068）。
  // VIEW 区随后由 drawLoadingScreen 覆盖，故此处只需让上下黑边接上纸色即无缝（参考主页铺满做法）。
  if (screen === 'loading') return fillVGrad('#f0e4c8', '#c8a068');
  // 图片页：menu 用首页大图、其余(battle)用当前地图场景，均 cover 扩展矩形 + 宣纸薄纱
  const key = screen === 'menu' ? 'menu-home' : `map-${b.map.id}`;
  const bgImg = sprite(key as Parameters<typeof sprite>[0]);
  if (bgImg) {
    const scale = Math.max(w / bgImg.width, h / bgImg.height);
    const dw = bgImg.width * scale;
    const dh = bgImg.height * scale;
    ctx.drawImage(bgImg, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.fillStyle = 'rgba(240,233,220,0.5)'; // 宣纸薄纱：压成柔和底，突出扁平内容
    ctx.fillRect(x, y, w, h);
  } else if (screen === 'menu') {
    fillVGrad('#efe3c8', '#d8c39a'); // 首页大图缺失时的暖宣纸回退
  } else {
    ctx.fillStyle = themeBgGradient(ctx, b.map.theme.bg0, b.map.theme.bg1);
    ctx.fillRect(x, y, w, h);
  }
}

// —— 小游戏弹窗蒙层「补黑边」机制 —— //
// 弹窗蒙层只画在 VIEW 内(受帧级 VIEW 裁剪)，上下/左右 letterbox 黑边会露出未压暗的亮底。
// 各蒙层改用 fillViewScrim/markScrim 记录本帧最后一次全屏蒙层色，main.ts 帧尾在黑边区补一层同色，
// 使蒙层视觉上盖住整屏(黑边只有背景、无卡片，补一层同色即与 VIEW 内一致)。Web 无黑边，记录被忽略。
let pendingBarScrim: string | null = null;
/** 标记本帧全屏蒙层色（仅小游戏下记录，供 main.ts 帧尾给黑边补色）。用于无法直接改成 fillViewScrim 的蒙层(如引导镂空遮罩)。 */
export function markScrim(color: string): void {
  if (isWeChat) pendingBarScrim = color;
}
/** 画一层覆盖 VIEW 的半透明蒙层并记录其色（等价于原 fillStyle+fillRect(0,0,VIEW_W,VIEW_H)）。 */
export function fillViewScrim(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  markScrim(color);
}
/** 取出并清空本帧蒙层色（main.ts 帧尾调用；无蒙层时返回 null）。 */
export function takeScrim(): string | null {
  const c = pendingBarScrim;
  pendingBarScrim = null;
  return c;
}

export function draw(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState): void {
  // 背景：优先用当地图生成的场景大图(cover铺满)，叠一层同色系薄纱使网格清晰；无图时回退主题渐变。
  // 小游戏下背景改由 drawScreenBackdrop 铺满整屏(含黑边)，此处跳过，避免 VIEW 内外两套不同缩放的图接缝/双重底。
  if (!isWeChat) {
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
  }

  drawBoard(ctx, b, ui);
  drawSpawnGate(ctx, b);
  drawSpawnDirectionHints(ctx, b);
  drawBombs(ctx, b); // 埋在路径上的地雷（玩家+AI），画在怪物之下的地面层
  drawTangseng(ctx, b);
  drawMonsters(ctx, b);
  drawPalmPushFx(ctx, b);
  drawSkillFx(ctx, b.playerSkillFx);
  if (b.endless) drawEndlessPanel(ctx, b);
  else drawAiSide(ctx, b);
  drawAiPalmPushFx(ctx, b);
  drawSkillFx(ctx, b.aiSkillFx);
  drawUnits(ctx, b, ui);
  drawGenerals(ctx, b, ui);
  drawPlaceDropMergeIncoming(ctx, b);
  drawPeachTrees(ctx, b, ui);
  drawFx(ctx, b);
  drawStealFx(ctx, b); // 黄狮精卷走幽灵：被偷目标闪几下再消失（画在命中特效之上、粒子环之下）
  drawDigFx(ctx, b.digFx);
  drawDigFx(ctx, b.aiDigFx);
  drawBursts(ctx, b);
  drawBombFx(ctx, b); // 炸药引爆特效（冲击波+火球+碎片），画在爆点之上
  drawPeachFloats(ctx, b);
  drawDamageFloats(ctx, b);
  drawHeroUltFxList(ctx, b.heroUltFx, b.erlangDogFx);      // 玩家半场大招
  drawHeroUltFxList(ctx, b.aiHeroUltFx, b.aiErlangDogFx);  // 对手半场大招（PvP 桥重建；单机为空）
  drawAoeBurst(ctx, b);
  drawDanger(ctx, b);
  drawSelection(ctx, b, ui);
  drawHud(ctx, b, ui);
  drawTray(ctx, b, ui);
  drawButtons(ctx, b);
  drawActiveIcons(ctx, b);
  drawPassiveRow(ctx, b);
  drawPauseBtn(ctx, b);
  drawPassivePopup(ctx, b, ui);
  drawActivePopup(ctx, b, ui);
  drawBombPopup(ctx, b, ui); // 路径上已埋地雷的信息弹窗（点击地雷打开）
  drawAiItemPopup(ctx, b, ui);
  drawPeachPopup(ctx, b, ui);
  drawDragGhost(ctx, b, ui);
  drawAutoPlaceDrag(ctx, b);
  drawBanner(ctx, b);
}

// —— 候选区（征兵产出，手工拖到棋盘）——
const CAMP_SCALE = 1.2; // 营帐屋身+屋顶整体缩放
const CAMP_X = 12;
const CAMP_W = 48 * CAMP_SCALE;
const CAMP_RIBBON_SRC_X = CAMP_X + CAMP_W / 2;
export const TRAY_LEFT = 80; // 左侧留给"宫"标（与候选槽拉开更大间距）；导出供冒烟脚本换算槽位坐标
export const TRAY_SLOT = 74; // 候选槽间距（可见槽 ≈ TRAY_SLOT-6 = 68，与地图格子同宽）；导出供冒烟脚本换算槽位坐标
export function trayIndexAt(x: number, y: number): number | null {
  if (y < TRAY_Y || y > TRAY_Y + TRAY_H) return null;
  const i = Math.floor((x - TRAY_LEFT) / TRAY_SLOT);
  if (i < 0 || i >= TUNING.traySize) return null;
  return i;
}

/** 候选区第 i 槽的可视内框（新手引导高亮令牌用，与 drawTrayToken 的凹槽同尺寸） */
export function trayTokenRect(i: number): { x: number; y: number; w: number; h: number } {
  const cx = TRAY_LEFT + i * TRAY_SLOT;
  return { x: cx + 3, y: TRAY_Y + 5, w: TRAY_SLOT - 6, h: TRAY_H - 10 };
}

/** 候选区整行范围（新手引导高亮兵种介绍用） */
export function trayRowRect(): { x: number; y: number; w: number; h: number } {
  return { x: TRAY_LEFT, y: TRAY_Y, w: TUNING.traySize * TRAY_SLOT, h: TRAY_H };
}

// —— Task 10 首局动态引导：非模态脉冲箭头 + 提示胶囊 —— //
// 与 tutorial.ts 的「modal 高亮卡片」不同，这是**非模态**覆盖层：玩家仍可自由点征兵/拖拽/跳过，
// 只在箭头指向处给一个脉冲视觉提示。状态机（征兵→部署两阶段）在 main.ts 驱动，这里只负责
// 「给定目标矩形 + 提示文字 → 算出箭头几何并绘制」。箭头几何抽出成纯函数 guideArrowLayout
// 便于单测（canvas 视觉本身不测）。
const GUIDE_PILL_H = 32;          // 提示胶囊高
const GUIDE_GAP = 10;             // 胶囊底 → 目标顶 的间距
const GUIDE_PAD_X = 14;           // 胶囊左右内边距
const GUIDE_FONT = 'bold 15px "PingFang SC", "STKaiti", serif';

export interface GuideArrowGeom {
  pill: { x: number; y: number; w: number; h: number }; // 提示胶囊
  from: { x: number; y: number };                        // 箭头起点（胶囊底中）
  to: { x: number; y: number };                          // 箭头终点（目标顶中，含 bobbing）
  bob: number;                                           // 当前帧的上下抖动量（与绘制动画同步）
}

/**
 * 纯函数：给定目标矩形 + 提示文字测量宽度，算出箭头几何。
 * 胶囊默认置于目标上方（target.y 之上）；若上方放不下（<8px）则翻到目标下方、箭头反向朝上。
 * 水平居中于目标，clamp 到视口内 [8, VIEW_W-8]。返回供 drawGuideArrow 使用。
 * @param now performance.now() 毫秒，驱动 bobbing（与绘制动画周期一致）
 */
export function guideArrowLayout(
  target: { x: number; y: number; w: number; h: number },
  labelW: number,
  now: number,
  VIEW_W: number,
): GuideArrowGeom {
  const bob = Math.sin(now / 260) * 4; // 与 drawGuideArrow 的脉冲同周期（260ms）
  const pillW = Math.max(40, Math.min(labelW + GUIDE_PAD_X * 2, VIEW_W - 16));
  const tcx = target.x + target.w / 2;
  let pillX = Math.max(8, Math.min(VIEW_W - pillW - 8, tcx - pillW / 2));
  let above = true;
  let pillY = target.y - GUIDE_GAP - GUIDE_PILL_H;
  if (pillY < 8) { // 上方放不下 → 翻到下方
    above = false;
    pillY = target.y + target.h + GUIDE_GAP;
  }
  const from = { x: tcx, y: above ? pillY + GUIDE_PILL_H : pillY };
  const to = { x: tcx, y: (above ? target.y - 2 : target.y + target.h + 2) + bob };
  return { pill: { x: pillX, y: pillY, w: pillW, h: GUIDE_PILL_H }, from, to, bob };
}

/** 绘制首局引导箭头：脉冲胶囊（提示文字）+ 跳动金色箭头指向目标。纯 canvas，无内部状态。 */
export function drawGuideArrow(
  ctx: CanvasRenderingContext2D,
  target: { x: number; y: number; w: number; h: number },
  label: string,
  now: number,
): void {
  ctx.save();
  ctx.font = GUIDE_FONT;
  const labelW = ctx.measureText(label).width;
  const g = guideArrowLayout(target, labelW, now, VIEW_W);
  const pulse = 0.5 + 0.5 * Math.sin(now / 260);
  // 提示胶囊：暖白渐变 + 金边，脉冲透明度
  roundRect(ctx, g.pill.x, g.pill.y, g.pill.w, g.pill.h, g.pill.h / 2);
  const grad = ctx.createLinearGradient(g.pill.x, g.pill.y, g.pill.x, g.pill.y + g.pill.h);
  grad.addColorStop(0, '#fff6e6');
  grad.addColorStop(1, '#f0dfb8');
  ctx.fillStyle = grad;
  ctx.globalAlpha = 0.96;
  ctx.fill();
  ctx.globalAlpha = 0.55 + pulse * 0.4;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#c8902c';
  ctx.stroke();
  // 胶囊文字
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#5a2810';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, g.pill.x + g.pill.w / 2, g.pill.y + g.pill.h / 2);
  // 跳动箭头：金色，带阴影，端点随 bobbing 起伏
  ctx.strokeStyle = '#ffd76a';
  ctx.fillStyle = '#ffd76a';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(20,14,4,0.5)';
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.moveTo(g.from.x, g.from.y);
  ctx.lineTo(g.to.x, g.to.y);
  ctx.stroke();
  const ang = Math.atan2(g.to.y - g.from.y, g.to.x - g.from.x);
  const head = 11;
  ctx.beginPath();
  ctx.moveTo(g.to.x, g.to.y);
  ctx.lineTo(g.to.x - head * Math.cos(ang - Math.PI / 6), g.to.y - head * Math.sin(ang - Math.PI / 6));
  ctx.lineTo(g.to.x - head * Math.cos(ang + Math.PI / 6), g.to.y - head * Math.sin(ang + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 征兵按钮矩形（与 getButtons 的 summon 项一致：x=180, y=CTRL_Y, w=200, h=78） */
export function summonButtonRect(): { x: number; y: number; w: number; h: number } {
  return { x: 180, y: CTRL_Y, w: 200, h: 78 };
}

// —— 首局引导「跳过」小按钮（与箭头配套，非模态，玩家可随时点）——
const GUIDE_SKIP_W = 92;
const GUIDE_SKIP_Y = HUD_H + 10; // 紧贴 HUD 下方、棋盘顶部居中

/** 「跳过」按钮矩形（draw 与 hit 共用，保证命中与绘制一致） */
export function guideSkipRect(): { x: number; y: number; w: number; h: number } {
  return { x: (VIEW_W - GUIDE_SKIP_W) / 2, y: GUIDE_SKIP_Y, w: GUIDE_SKIP_W, h: GUIDE_PILL_H };
}

/** 每局开始的「征兵→部署」非阻塞提示：两阶段状态机（征兵常驻→征兵后部署→放置后淡出）。
 *  过了首次引导后每局显示一次；不暂停、不影响出怪时机。阶段推进是纯函数（stepGameStartHint），
 *  canvas 绘制本身不测（仓库惯例）。 */
export type GameStartHintStage = 'off' | 'summon' | 'deploy' | 'fade';
export interface GameStartHintState { stage: GameStartHintStage; fadeT: number }

/** 部署提示淡出时长（秒）：放置首个 tray 令牌后「慢慢消失」。 */
export const GAME_START_HINT_FADE_S = 2;

/**
 * 纯函数：每帧推进提示阶段。
 * - summon：征兵提示①常驻，直到玩家点过征兵（summoned = battle.summonCount>0）→ deploy
 * - deploy：部署提示②显示，直到放置了一枚 tray 令牌（trayPlaced = tray 长度较上帧下降）→ fade
 * - fade：按 dt 累计计时淡出，到 GAME_START_HINT_FADE_S 后 off
 * - off：本局不再出现
 */
export function stepGameStartHint(
  prev: GameStartHintState,
  summoned: boolean,
  trayPlaced: boolean,
  dt: number,
): GameStartHintState {
  if (prev.stage === 'off') return prev;
  if (prev.stage === 'summon') {
    return summoned ? { stage: 'deploy', fadeT: 0 } : prev;
  }
  if (prev.stage === 'deploy') {
    return trayPlaced ? { stage: 'fade', fadeT: 0 } : prev;
  }
  const fadeT = prev.fadeT + dt;
  return fadeT >= GAME_START_HINT_FADE_S ? { stage: 'off', fadeT: 0 } : { stage: 'fade', fadeT };
}

/** 当前提示整体透明度：summon/deploy 恒 1；fade 线性降到 0；off 为 0（不绘制）。 */
export function gameStartHintAlpha(s: GameStartHintState): number {
  if (s.stage === 'off') return 0;
  if (s.stage === 'fade') return Math.max(0, 1 - s.fadeT / GAME_START_HINT_FADE_S);
  return 1;
}

/** 绘制开局提示：summon 阶段画①（征兵按钮上方），deploy/fade 阶段画②（候选区上方）。 */
export function drawGameStartHint(ctx: CanvasRenderingContext2D, s: GameStartHintState): void {
  const alpha = gameStartHintAlpha(s);
  if (alpha <= 0) return;
  const tag = (rect: { x: number; y: number; w: number; h: number }, text: string) => {
    ctx.font = 'bold 15px "PingFang SC", sans-serif';
    const cx = rect.x + rect.w / 2;
    const bw = ctx.measureText(text).width + 24;
    const bh = 30;
    const bx = cx - bw / 2;
    const by = rect.y - bh - 12; // 悬在目标上方，下箭头指向目标
    roundRect(ctx, bx, by, bw, bh, 8);
    ctx.fillStyle = 'rgba(40,28,14,0.92)';
    ctx.fill();
    ctx.strokeStyle = '#e8c22c';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 三角底边上移 2px 压过描边（stroke 以 by+bh 为中心向两侧各渗 ~0.75px，底边贴线会露出
    // 上半条金边，看起来箭头没盖住边框）；下移一点即完全遮住，成完整气泡尾巴。
    ctx.beginPath();
    ctx.moveTo(cx - 6, by + bh - 2);
    ctx.lineTo(cx + 6, by + bh - 2);
    ctx.lineTo(cx, by + bh + 8);
    ctx.closePath();
    ctx.fillStyle = 'rgba(40,28,14,0.92)';
    ctx.fill();
    ctx.fillStyle = '#ffe27a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, by + bh / 2);
  };
  ctx.save();
  ctx.globalAlpha = alpha;
  if (s.stage === 'summon') tag(summonButtonRect(), '① 点击征兵抽兵');
  else tag(trayRowRect(), '② 拖到棋盘部署'); // deploy | fade
  ctx.restore();
}

/** 绘制「跳过」胶囊（半透明深底 + 浅字，区别于主线箭头的暖白高亮，表明它是次要操作） */
export function drawGuideSkip(ctx: CanvasRenderingContext2D): void {
  const r = guideSkipRect();
  ctx.save();
  ctx.globalAlpha = 0.82;
  roundRect(ctx, r.x, r.y, r.w, r.h, r.h / 2);
  ctx.fillStyle = 'rgba(28,20,14,0.6)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,160,0.4)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffe8c0';
  ctx.font = GUIDE_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('跳过引导', r.x + r.w / 2, r.y + r.h / 2);
  ctx.restore();
}

function traySlotCenter(i: number): { x: number; y: number } {
  return { x: TRAY_LEFT + i * TRAY_SLOT + TRAY_SLOT / 2, y: TRAY_Y + TRAY_H / 2 };
}
function drawTrayToken(ctx: CanvasRenderingContext2D, token: TrayToken, x: number, y: number, s: number) {
  if (token.kind === 'shovel') {
    const spr = sprite('item-shovel');
    if (spr) {
      // Seedream 生成的透明 PNG 铲子图标（无底色）
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
  } else if (token.kind === 'tree') {
    drawPeachTree(ctx, x, y, CELL * 0.72, token.level);
  } else {
    // 立绘尺寸与地图上单位保持一致(同用 CELL*0.72)，避免 tray 里显得更大
    drawUnit(ctx, token.type, token.tier, x, y, CELL * 0.72);
    if (token.displaced) {
      ctx.save();
      ctx.strokeStyle = '#d87818';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, s * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#d87818';
      ctx.font = `bold ${Math.round(s * 0.2)}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('待', x, y + s * 0.22);
      ctx.restore();
    }
  }
}

// 武将字牌：未激活用金黄墨字；双字合成激活后按品质色填字，并随阶数加粗加大。
// qualityTier>0 表示已激活武将整体阶（白绿蓝紫橙），驱动颜色与笔画粗细。
function drawWordTile(
  ctx: CanvasRenderingContext2D,
  char: string,
  tier: number,
  x: number,
  y: number,
  s: number,
  showTier = true,
  qualityTier = 0,
) {
  const active = qualityTier > 0;
  const q = active ? Math.max(1, Math.min(MAX_TIER, qualityTier)) : 1;
  // 激活后随阶略放大字号；描边加粗让字形「越升越沉」
  const fontScale = active ? 0.58 + (q - 1) * 0.04 : 0.62;
  const strokeW = active
    ? Math.max(2.8, s * (0.065 + (q - 1) * 0.022))
    : Math.max(2.5, s * 0.07);
  ctx.font = `bold ${Math.round(s * fontScale)}px "PingFang SC", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = strokeW;
  ctx.lineJoin = 'round';
  const ty = y + s * 0.02;
  if (active) {
    // 深描边保可读；填充用品质色（白/绿/蓝/紫/橙）
    ctx.strokeStyle = '#2a2014';
    ctx.strokeText(char, x, ty);
    // 高阶再叠一层略偏外的描边，视觉更「粗」
    if (q >= 3) {
      ctx.lineWidth = strokeW * 0.45;
      ctx.strokeStyle = qualityColor(q);
      ctx.globalAlpha = 0.35;
      ctx.strokeText(char, x, ty);
      ctx.globalAlpha = 1;
      ctx.lineWidth = strokeW;
    }
    ctx.fillStyle = qualityColor(q);
    ctx.fillText(char, x, ty);
  } else {
    // 未激活：金黄字 + 深棕描边
    ctx.strokeStyle = '#5a3a08';
    ctx.strokeText(char, x, ty);
    ctx.fillStyle = '#f2b414';
    ctx.fillText(char, x, ty);
  }
  // 阶数徽标（合成为激活武将时由 showTier=false 隐藏，改由武将整体阶数在右上角显示）
  if (showTier) {
    drawTierBadge(ctx, x + s * 0.42, y - s * 0.36, tier, Math.round(s * 0.3));
  }
}

/** 未激活单字武将：右上角循环飘起的「Z」睡眠感 */
function drawSleepingZ(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  nowMs: number,
) {
  const cycleS = 2.1;
  const t = nowMs / 1000;
  ctx.save();
  ctx.font = `bold ${Math.round(s * 0.24)}px "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 3; i++) {
    const phase = (t / cycleS + i * 0.38) % 1;
    const alpha = phase < 0.12 ? phase / 0.12 : phase > 0.88 ? (1 - phase) / 0.12 : 1;
    if (alpha <= 0.02) continue;
    const ox = s * 0.34 + phase * s * 0.1 + i * s * 0.06;
    const oy = -s * 0.38 - phase * s * 0.42 - i * s * 0.05;
    const sc = 0.55 + phase * 0.55;
    ctx.save();
    ctx.translate(x + ox, y + oy);
    ctx.scale(sc, sc);
    ctx.globalAlpha = alpha * 0.9;
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = '#4a5878';
    ctx.fillStyle = '#b8c8e8';
    ctx.strokeText('Z', 0, 0);
    ctx.fillText('Z', 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
// 营帐屋顶开合角度(弧度，0=闭合)：征兵时(summonAnimT 从 0 起)先逆时针掀开到 90°(竖起)，保持至丝带飞完，再顺时针合上。
function campRoofAngle(t: number): number {
  // 与下方丝带左→右错开伸出对齐：末槽约 0.26s 才满长，屋顶稍晚再合
  const OPEN_END = 0.05, HOLD_END = 0.32, CLOSE_END = 0.4, MAX = Math.PI / 2;
  if (t >= CLOSE_END) return 0; // 已合上(含 idle t=999)
  if (t < OPEN_END) return MAX * (t / OPEN_END); // 开：0→90°
  if (t < HOLD_END) return MAX; // 全开保持(令牌丝带飞入)
  return MAX * (1 - (t - HOLD_END) / (CLOSE_END - HOLD_END)); // 合：90°→0
}
// 候选槽丝带飞入动画时序常量（drawTray 与 summonAnimDone 共用，确保「令牌真正落槽」判定与实际渲染一致）
const SUMMON_EXTEND_STAGGER = 0.045; // 相邻槽伸出起点延迟（左→右）
const SUMMON_EXTEND_DUR = 0.08;
const SUMMON_HOLD = 0.03;
const SUMMON_RETRACT_DUR = 0.09;
/** 指定候选槽的令牌是否已飞入落位（与 drawTray 丝带时序一致）。 */
export function traySlotAnimDone(b: Battle, slotIndex: number): boolean {
  const extendAt = slotIndex * SUMMON_EXTEND_STAGGER;
  const settleAt = extendAt + SUMMON_EXTEND_DUR + SUMMON_HOLD + SUMMON_RETRACT_DUR;
  return b.summonAnimT >= settleAt;
}

/** 征兵后，候选区令牌是否已全部飞入落位（可据此延后弹出引导，避免指向还在飞行中的令牌）。 */
export function summonAnimDone(b: Battle): boolean {
  return traySlotAnimDone(b, Math.max(0, TUNING.traySize - 1));
}
function drawTray(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  // 营帐：棕色屋身(带「宫」字) + 红色屋顶(左侧铰链，征兵时逆时针掀开至90°再合上)。手绘，无底板 bar。
  const campX = CAMP_X, campY = TRAY_Y + 4, campW = CAMP_W, campH = TRAY_H - 8;
  const roofH = 16 * CAMP_SCALE; // 屋顶高
  const BODY_SHRINK = 6 * CAMP_SCALE; // 棕色屋身减矮量
  const bodyH0 = campH - roofH - BODY_SHRINK;
  const bodyH = bodyH0 * 0.75 * 1.2 * 1.2; // 屋身高度（相对初版再 ×1.2×1.2）
  // 屋身+屋顶整体在营帐框内垂直居中（屋顶叠在屋身顶沿上方）
  const stackH = bodyH + roofH;
  const stackTop = campY + (campH - stackH) / 2;
  const bodyY = stackTop + roofH; // 屋身顶沿 = 屋顶铰链；屋顶向上画 roofH
  // —— 屋身（棕色木屋身 + 「宫」字）——
  const wood = ctx.createLinearGradient(0, bodyY, 0, bodyY + bodyH);
  wood.addColorStop(0, '#8a5626');
  wood.addColorStop(1, '#6d431d');
  ctx.fillStyle = wood;
  roundRect(ctx, campX, bodyY, campW, bodyH, 5 * CAMP_SCALE);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#4f3115';
  ctx.stroke();
  ctx.fillStyle = '#fff2d8';
  ctx.font = `bold ${Math.round(22 * CAMP_SCALE)}px "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('宫', campX + campW / 2, bodyY + bodyH / 2 + 1);
  // —— 屋顶（手绘红顶，以底左角为铰链，逆时针=负角）——
  const roofAng = campRoofAngle(b.summonAnimT);
  ctx.save();
  ctx.translate(campX, bodyY);
  ctx.rotate(-roofAng);
  // 梯形屋顶：檐口(底)最宽并向两侧外挑(比屋身宽)，屋脊(顶)略内收
  const EAVE = 6 * CAMP_SCALE; // 屋檐外挑量(比屋身两侧各宽出)
  const RIDGE_INSET = 6 * CAMP_SCALE; // 屋脊比檐口内收
  ctx.beginPath();
  ctx.moveTo(-EAVE, 0);
  ctx.lineTo(campW + EAVE, 0);
  ctx.lineTo(campW - RIDGE_INSET, -roofH);
  ctx.lineTo(RIDGE_INSET, -roofH);
  ctx.closePath();
  const roofGrad = ctx.createLinearGradient(0, -roofH, 0, 0);
  roofGrad.addColorStop(0, '#c0402f');
  roofGrad.addColorStop(1, '#9a2f22');
  ctx.fillStyle = roofGrad;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#6f1f16';
  ctx.stroke();
  // 瓦垄：几条竖向瓦线(屋脊→檐口)
  ctx.strokeStyle = 'rgba(90,20,15,0.5)';
  ctx.lineWidth = 1;
  const TILES = 5;
  for (let k = 1; k < TILES; k++) {
    const f = k / TILES;
    const topX = RIDGE_INSET + (campW - 2 * RIDGE_INSET) * f;
    const botX = -EAVE + (campW + 2 * EAVE) * f;
    ctx.beginPath();
    ctx.moveTo(topX, -roofH + 2);
    ctx.lineTo(botX, -1);
    ctx.stroke();
  }
  // 屋脊高光
  ctx.strokeStyle = 'rgba(255,220,180,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(RIDGE_INSET, -roofH + 2); ctx.lineTo(campW - RIDGE_INSET, -roofH + 2);
  ctx.stroke();
  ctx.restore();
  // 5 个候选槽：丝带从「宫」左→右错开伸出，短暂满长后从营端收回，再出图标
  const EXTEND_STAGGER = SUMMON_EXTEND_STAGGER; // 相邻槽伸出起点延迟（左→右）
  const EXTEND_DUR = SUMMON_EXTEND_DUR;
  const HOLD = SUMMON_HOLD;
  const RETRACT_DUR = SUMMON_RETRACT_DUR;
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
    const autoDragTray = b.autoPlaceDragFx[0]?.trayIndex ?? null;
    if (token && ui.dragTrayIndex !== i && autoDragTray !== i) {
      const c = traySlotCenter(i);
      const extendAt = i * EXTEND_STAGGER;
      const fullAt = extendAt + EXTEND_DUR;
      const retractAt = fullAt + HOLD;
      const t = b.summonAnimT;
      if (t < extendAt) {
        // 尚未轮到本槽：不画丝带
      } else if (t < fullAt) {
        const u = (t - extendAt) / EXTEND_DUR; // 0→1 从营伸出
        const ease = 1 - (1 - u) * (1 - u);
        drawSummonRibbon(ctx, token, 0, Math.max(0.04, ease), 0.35 + 0.65 * ease, c, i);
      } else if (t < retractAt) {
        drawSummonRibbon(ctx, token, 0, 1, 1, c, i);
      } else if (t < retractAt + RETRACT_DUR) {
        const u = (t - retractAt) / RETRACT_DUR; // 0→1 从营收向槽
        drawSummonRibbon(ctx, token, u, 1, 1 - u * 0.85, c, i);
      } else {
        const tokenSize = token.kind === 'word'
          ? CELL * 0.78
          : token.kind === 'tree'
            ? CELL * 0.72
            : TRAY_H - 16;
        drawTrayToken(ctx, token, c.x, c.y, tokenSize);
      }
    }
    if ((ui.selectedTrayIndex === i || autoDragTray === i) && token) {
      ctx.save();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffe08a';
      roundRect(ctx, sx + 1, sy + 1, sw - 2, sh - 2, 8);
      ctx.stroke();
      ctx.restore();
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
  const srcX = CAMP_RIBBON_SRC_X;
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
        drawUnlockedCellFace(ctx, ix, iy, iw, ih, c, r, th.cellUnlocked);
      } else {
        // 不可放置格（未开垦）：底色用地图五行主题色（与 HUD 徽章同色系，一眼看出本图属性行），
        // 再叠深棕压暗保持「未开垦」的暗档观感；五行关闭时回退原主题 cellLocked。
        const wuxingEl = wuxingEnabled() ? MAP_ELEMENT[b.map.id] : undefined;
        roundRect(ctx, ix, iy, iw, ih, 2);
        ctx.fillStyle = wuxingEl ? ELEMENT_COLOR[wuxingEl] : th.cellLocked;
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
    // 白骨岭：两扇骷髅门柱闭合时相邻（各距中心半宽，不重叠）；出怪时再随 off 拉开
    const half = CELL * 0.11;
    drawBaigulingGateLeaf(ctx, x - half - off, y, -1);
    drawBaigulingGateLeaf(ctx, x + half + off, y, 1);
  } else if (id === 'huoyanshan') {
    // 火焰山：两柱火焰门，默认合拢，出怪时左右分开
    drawHuoyanshanFlameGate(ctx, x - off, y, -1);
    drawHuoyanshanFlameGate(ctx, x + off, y, 1);
  } else if (id === 'liushahe') {
    // 流沙河：砂石闸门贴图左右半扇开合
    drawLiushaheSandGate(ctx, x, y, off);
  } else if (id === 'huangfengling') {
    // 黄风岭：风蚀岩闸门贴图左右半扇开合
    drawHuangfenglingRockGate(ctx, x, y, off);
  } else {
    // 兜底：两扇素色闸门
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

/** 贴图闸门（左右半扇对开）：流沙河砂石门 / 黄风岭风蚀岩门共用 */
function drawSpriteSplitGate(
  ctx: CanvasRenderingContext2D,
  key: 'gate-liushahe' | 'gate-huangfengling',
  x: number,
  y: number,
  off: number,
  fallbackFill: string,
  fallbackStroke: string,
) {
  const spr = sprite(key);
  const h = CELL * 0.72;
  const w = CELL * 0.78;
  if (!spr || !spr.width) {
    const lw = CELL * 0.42, lh = CELL * 0.55;
    const leaf = (lx: number) => {
      roundRect(ctx, lx, y - lh / 2, lw, lh, 5);
      ctx.fillStyle = fallbackFill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = fallbackStroke;
      ctx.stroke();
    };
    leaf(x - off - lw);
    leaf(x + off);
    return;
  }
  const half = w / 2;
  // 左半扇 / 右半扇：从贴图中线切开，随 off 左右拉开
  ctx.drawImage(spr, 0, 0, spr.width / 2, spr.height, x - half - off, y - h / 2, half, h);
  ctx.drawImage(spr, spr.width / 2, 0, spr.width / 2, spr.height, x + off, y - h / 2, half, h);
}

/** 流沙河出怪口：Seedream 砂石闸门左右对开 */
function drawLiushaheSandGate(ctx: CanvasRenderingContext2D, x: number, y: number, off: number) {
  drawSpriteSplitGate(ctx, 'gate-liushahe', x, y, off, 'rgba(196,158,92,0.9)', 'rgba(90,60,30,0.75)');
}

/** 黄风岭出怪口：Seedream 风蚀岩闸门左右对开 */
function drawHuangfenglingRockGate(ctx: CanvasRenderingContext2D, x: number, y: number, off: number) {
  drawSpriteSplitGate(ctx, 'gate-huangfengling', x, y, off, 'rgba(196,166,106,0.9)', 'rgba(110,84,40,0.75)');
}

/** 出怪指引：从路径「出口后第 2 个在网格内的点」起画，避免与闸门重叠；导出供单测校验朝向 */
export function pathEntranceDir(path: { c: number; r: number }[]): { c: number; r: number; dc: number; dr: number } | null {
  let firstInGrid = -1;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (p.c >= 0 && p.c < COLS && p.r >= 0 && p.r < ROWS) {
      firstInGrid = i;
      break;
    }
  }
  if (firstInGrid < 0) return null;
  // 第 2 格：出口下一格；若路径过短则退回出口格
  const startIdx = firstInGrid + 1 < path.length ? firstInGrid + 1 : firstInGrid;
  const p = path[startIdx]!;
  // 朝向 = 入场行进方向（上一格 → 本格），不能用「本格 → 下一格」：
  // 黄风岭这类入场后立刻拐弯的图，拐向会提前画在还没拐的格上，箭头看起来指错方向。
  // 其它图入场前 3 格共线，两种取法结果一致。
  const prev = path[startIdx - 1];
  if (!prev) return { c: p.c, r: p.r, dc: 1, dr: 0 };
  const len = Math.hypot(p.c - prev.c, p.r - prev.r) || 1;
  return { c: p.c, r: p.r, dc: (p.c - prev.c) / len, dr: (p.r - prev.r) / len };
}

/** 沿行程位置的透明度：入口淡入、出口淡出 */
function spawnHintAlphaAlong(along: number, zoneLen: number, fadeLen: number): number {
  if (along < 0 || along > zoneLen) return 0;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  if (along < fadeLen) return 0.3 + 0.65 * smooth(along / fadeLen);
  if (along > zoneLen - fadeLen) return 0.3 + 0.65 * smooth((zoneLen - along) / fadeLen);
  return 0.95;
}

// 出怪指引：第 2 格入口起固定 3 枚，沿路径朝场内滚动（前端出、后端进）
function drawSpawnDirectionHints(ctx: CanvasRenderingContext2D, b: Battle) {
  if (b.introDone) return;
  if (b.status !== 'ready' && b.status !== 'playing') return;
  const drawOn = (path: { c: number; r: number }[]) => {
    const info = pathEntranceDir(path);
    if (!info) return;
    const { x: cx, y: cy } = cellCenterPx(info.c, info.r);
    const sx = cx - info.dc * CELL * 0.5;
    const sy = cy - info.dr * CELL * 0.5;
    const arrowCount = 3;
    const spacing = CELL * 0.28;
    const zoneLen = spacing * (arrowCount - 1);
    const wrapSpan = zoneLen + spacing;
    const fadeLen = spacing * 0.42;
    const scroll = (performance.now() / 1000 * (spacing / 0.85)) % spacing;
    const size = CELL * 0.48;
    ctx.save();
    for (let i = 0; i < arrowCount; i++) {
      let along = i * spacing + scroll;
      while (along > zoneLen) along -= wrapSpan;
      let alpha: number;
      if (along < 0) {
        alpha = spawnHintAlphaAlong(0, zoneLen, fadeLen) * (1 + along / spacing);
      } else {
        alpha = spawnHintAlphaAlong(along, zoneLen, fadeLen);
      }
      if (alpha < 0.04) continue;
      const ax = sx + info.dc * along;
      const ay = sy + info.dr * along;
      ctx.globalAlpha = alpha;
      const litT = Math.max(0, Math.min(1, (alpha - 0.3) / 0.65));
      drawPathChevron(ctx, ax, ay, Math.atan2(info.dr, info.dc), size, litT);
    }
    ctx.restore();
  };
  drawOn(b.map.path);
  if (!b.aiDefeated && !b.endless) drawOn(b.aiPath);
}

/** 半格大小的空心箭头（> 形），沿 ang 朝向；litT∈[0,1] 连续控制描边与光晕 */
function drawPathChevron(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, size: number, litT: number) {
  const arm = size * 0.42;
  const t = Math.max(0, Math.min(1, litT));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const r0 = 232, g0 = 200, b0 = 120;
  const r1 = 255, g1 = 226, b1 = 122;
  ctx.strokeStyle = `rgb(${Math.round(r0 + (r1 - r0) * t)},${Math.round(g0 + (g1 - g0) * t)},${Math.round(b0 + (b1 - b0) * t)})`;
  ctx.lineWidth = 3.2 + 1.3 * t;
  ctx.shadowColor = `rgba(255, 210, 80, ${0.85 * t})`;
  ctx.shadowBlur = 8 * t;
  ctx.beginPath();
  ctx.moveTo(-arm * 0.35, -arm);
  ctx.lineTo(arm * 0.55, 0);
  ctx.lineTo(-arm * 0.35, arm);
  ctx.stroke();
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

// 中间栅栏：默认水平木栅栏（fenceGaps 开口）；白骨岭白骨堆；流沙河/盘丝洞用可平铺贴图
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
  if (b.map.id === 'huangfengling') {
    drawHuangfenglingSandFence(ctx, b);
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

// 流沙河：Seedream 河沙水带横向无缝平铺，严格隔断上下半场
function drawLiushaheWaterFence(ctx: CanvasRenderingContext2D, _b: Battle) {
  const y = BOARD_Y + FENCE_ROW * CELL;
  drawTiledHFence(ctx, 'fence-liushahe', y, CELL * 0.26, () => {
    ctx.fillStyle = 'rgba(180,150,70,0.9)';
    ctx.fillRect(BOARD_X, y - CELL * 0.08, COLS * CELL, CELL * 0.16);
  });
}

// 黄风岭：Seedream 风沙岩壁带横向无缝平铺，严格隔断上下半场
function drawHuangfenglingSandFence(ctx: CanvasRenderingContext2D, _b: Battle) {
  const y = BOARD_Y + FENCE_ROW * CELL;
  drawTiledHFence(ctx, 'fence-huangfengling', y, CELL * 0.26, () => {
    ctx.fillStyle = 'rgba(154,123,50,0.9)';
    ctx.fillRect(BOARD_X, y - CELL * 0.08, COLS * CELL, CELL * 0.16);
  });
}

// 盘丝洞：Seedream 蛛丝篱笆横向无缝平铺
function drawPansidongSilkFence(ctx: CanvasRenderingContext2D, b: Battle) {
  const y = BOARD_Y + FENCE_ROW * CELL;
  drawTiledHFence(ctx, 'fence-pansidong', y, CELL * 0.24, () => {
    // 素材未就绪时回退：丝线篱笆矢量
    const x0 = BOARD_X;
    const x1 = BOARD_X + COLS * CELL;
    const accent = b.map.theme.accent;
    ctx.save();
    ctx.strokeStyle = 'rgba(120,70,110,0.35)';
    ctx.lineWidth = CELL * 0.28;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
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
    for (let c = 0; c < COLS; c++) {
      const cx = BOARD_X + c * CELL + CELL / 2;
      ctx.strokeStyle = 'rgba(230,200,220,0.75)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - 10, y - 9);
      ctx.lineTo(cx + 10, y + 9);
      ctx.moveTo(cx + 10, y - 9);
      ctx.lineTo(cx - 10, y + 9);
      ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, y, 4.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  });
}

/** 横向栅栏条：优先整条拉伸铺满（宽幅 Seedream 条更稳），必要时再循环平铺 */
function drawTiledHFence(
  ctx: CanvasRenderingContext2D,
  key: 'fence-liushahe' | 'fence-pansidong' | 'fence-huangfengling',
  y: number,
  drawH: number,
  fallback: () => void,
) {
  const spr = sprite(key);
  if (!spr || !spr.width) {
    fallback();
    return;
  }
  const boardW = COLS * CELL;
  const naturalW = drawH * (spr.width / spr.height);
  ctx.save();
  // 一张就能盖住大半棋盘宽 → 整条拉伸，避免端饰重复
  if (naturalW >= boardW * 0.75) {
    ctx.drawImage(spr, BOARD_X, y - drawH / 2, boardW, drawH);
  } else {
    let x = BOARD_X;
    while (x < BOARD_X + boardW - 0.25) {
      const remain = BOARD_X + boardW - x;
      const w = Math.min(naturalW, remain);
      const srcW = spr.width * (w / naturalW);
      ctx.drawImage(spr, 0, 0, srcW, spr.height, x, y - drawH / 2, w, drawH);
      x += naturalW;
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

function drawTangsengHearts(
  ctx: CanvasRenderingContext2D,
  cx: number,
  headTop: number,
  hp: number,
  defeated = false,
  feetY?: number, // 唐僧脚底位置（canvas 坐标），用于判断头顶空间是否够堆叠
) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (defeated) {
    ctx.fillStyle = '#9a9a9a';
    ctx.font = 'bold 13px "PingFang SC", sans-serif';
    ctx.fillText('已败', cx, headTop - 1);
    return;
  }
  const n = Math.max(0, Math.floor(hp));
  if (n <= 0) return;
  const perRow = 3;
  const fontPx = Math.round(CELL * 0.28 * 0.75); // 再缩小 1/4
  const rowGap = fontPx * 0.95;
  const colGap = fontPx * 0.95;
  ctx.font = `${fontPx}px sans-serif`;
  ctx.fillStyle = '#e03030';
  // 判断是向上还是向下堆叠：
  // - 默认从头顶向上堆（头顶空间充裕时）
  // - 当唐僧在棋盘顶部，向上空间不够放所有心时，改为从头顶向下堆（但不超过脚底）
  const rows = Math.ceil(n / perRow);
  const totalUpSpace = headTop; // headTop 到画面顶部(0)的距离
  const needUpSpace = rows * rowGap;
  const stackDown = needUpSpace > totalUpSpace && feetY != null;
  let remaining = n;
  let row = 0;
  while (remaining > 0) {
    const count = Math.min(perRow, remaining);
    const rowY = stackDown
      ? headTop + 1 + row * rowGap // 向下堆，但要保证不超过脚底
      : headTop + 1 - row * rowGap; // 向上堆
    // 向下堆时限制不超过脚底上方一点
    if (stackDown && feetY != null && rowY > feetY - fontPx * 0.5) break;
    const totalW = (count - 1) * colGap;
    const startX = cx - totalW / 2;
    for (let i = 0; i < count; i++) {
      ctx.fillText('❤', startX + i * colGap, rowY);
    }
    remaining -= count;
    row++;
  }
}

/** 唐僧立绘：无圆形底座；相对原尺寸缩小 1/5；脚底椭圆阴影；头顶按心数画 ❤（每行最多 3） */
function drawTangsengFigure(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  hp: number,
  opts?: { rad?: number; defeated?: boolean },
) {
  const rad = (opts?.rad ?? CELL * 0.46) * 0.8; // 缩小 1/5
  const defeated = opts?.defeated ?? false;
  drawGroundShadow(ctx, x, y + rad * 0.22, rad * 0.72, defeated ? 0.16 : 0.26);
  const spr = sprite('tangseng');
  let headTop = y - rad;
  let feetY = y + rad * 0.8; // 脚底近似位置
  if (spr) {
    const box = rad * 2;
    const scale = Math.min(box / spr.width, box / spr.height);
    const dw = spr.width * scale;
    const dh = spr.height * scale;
    ctx.drawImage(spr, x - dw / 2, y - dh / 2, dw, dh);
    headTop = y - dh / 2;
    feetY = y + dh / 2; // 脚底 = 立绘底部
  } else {
    ctx.fillStyle = '#5a3a08';
    ctx.font = 'bold 22px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('唐', x, y);
  }
  // 传入脚底位置，便于在头顶空间不够时改为向下堆叠
  drawTangsengHearts(ctx, x, headTop, hp, defeated, feetY);
}

// —— 开局唐僧出场气泡（仅本方唐僧、入场途中冒泡；台词/是否冒泡由 Battle.rollIntroSpeech 掷定）——
const INTRO_SPEECH_START = 2.1; // 秒：出场行走约 1/3 处开始冒泡
const INTRO_SPEECH_DUR = 2.2;   // 秒：气泡停留时长
const INTRO_SPEECH_FADE = 0.3;  // 秒：两端淡入/淡出

/** 气泡透明度（0=不显示）：introT 落在 [START, START+DUR] 内，两端各 FADE 秒淡入淡出。 */
function introSpeechAlpha(introT: number): number {
  const t = introT - INTRO_SPEECH_START;
  if (t < 0 || t > INTRO_SPEECH_DUR) return 0;
  const inA = Math.min(1, t / INTRO_SPEECH_FADE);
  const outA = Math.min(1, (INTRO_SPEECH_DUR - t) / INTRO_SPEECH_FADE);
  return Math.max(0, Math.min(inA, outA));
}

/** 唐僧头顶话语气泡：圆角白底 + 下指小尾 + 深棕字，居中于 cx，尾尖落在 tipY。 */
function drawSpeechBubble(ctx: CanvasRenderingContext2D, cx: number, tipY: number, text: string, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '600 15px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const padX = 12, padY = 7, tail = 7, fontH = 15;
  const w = ctx.measureText(text).width + padX * 2;
  const h = fontH + padY * 2;
  const bx = cx - w / 2;
  const by = tipY - tail - h; // 气泡体顶
  roundRect(ctx, bx, by, w, h, 9);
  ctx.fillStyle = 'rgba(255,252,245,0.97)';
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(150,95,42,0.5)';
  ctx.stroke();
  // 下指小尾（指向唐僧头顶）
  ctx.beginPath();
  ctx.moveTo(cx - tail, by + h - 0.5);
  ctx.lineTo(cx + tail, by + h - 0.5);
  ctx.lineTo(cx, tipY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,252,245,0.97)';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#6a3a12';
  ctx.fillText(text, cx, by + h / 2 + 0.5);
  ctx.restore();
}

function drawTangseng(ctx: CanvasRenderingContext2D, b: Battle) {
  const pos = b.tangsengRenderPos();
  const { x, y } = cellCenterPx(pos.c, pos.r);
  drawTangsengFigure(ctx, x, y, b.tangsengHP);
  // 开局出场气泡（50% 概率已在 rollIntroSpeech 掷定；仅本方唐僧、入场未归位时冒泡）
  if (!b.introDone && b.introSpeech) {
    const a = introSpeechAlpha(b.introT);
    if (a > 0) drawSpeechBubble(ctx, x, y - CELL * 0.6, b.introSpeech, a);
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

// 落子掉落：从各自半场顶加速落入格心，着地时由 battle 播 sfx
function placeDropStartDy(side: 'player' | 'ai', r: number): number {
  const targetCy = BOARD_Y + r * CELL + CELL / 2;
  const halfTopCy = side === 'ai'
    ? BOARD_Y + CELL * 0.2
    : BOARD_Y + FENCE_ROW * CELL + CELL * 0.2;
  return halfTopCy - targetCy;
}

/** 棋盘落子动效：位移/缩放；合成时 holdTier 表示落地前仍显示合成前阶 */
function placeDropMotion(
  b: Battle,
  side: 'player' | 'ai',
  c: number,
  r: number,
): { dy: number; scale: number; visible: boolean; holdTier?: number } {
  const fx = b.placeDropFx.find((d) => d.side === side && d.c === c && d.r === r);
  if (!fx) return { dy: 0, scale: 1, visible: true };
  const startDy = placeDropStartDy(side, r);
  // 合成：state 已是高阶，但原单位留在格上不消失；落下物另画，近落地再变阶弹一下
  if (fx.isMerge) {
    const holdTier =
      fx.kind === 'unit' && fx.unitTier != null
        ? Math.max(1, fx.unitTier - 1)
        : fx.kind === 'word' && fx.wordTier != null
          ? Math.max(1, fx.wordTier - 1)
          : undefined;
    if (fx.delay > 0) return { dy: 0, scale: 1, visible: true, holdTier };
    const p = Math.min(1, fx.t / PLACE_TIMING.dropDur);
    if (p <= 0.72) return { dy: 0, scale: 1, visible: true, holdTier };
    const bounce = Math.sin(((p - 0.72) / 0.28) * Math.PI) * 0.07;
    return { dy: -bounce * CELL * 0.28, scale: 1 + bounce, visible: true };
  }
  if (fx.delay > 0) return { dy: startDy, scale: 0.76, visible: false };
  const p = Math.min(1, fx.t / PLACE_TIMING.dropDur);
  const eased = p ** 2.6; // 重力加速
  const dy = startDy * (1 - eased);
  const scale = 0.76 + 0.24 * eased;
  return { dy, scale, visible: true };
}

/** 合成落子：从上方掉落的「下一枚」同阶单位/字牌（棋盘原单位由 placeDropMotion 留住） */
function drawPlaceDropMergeIncoming(ctx: CanvasRenderingContext2D, b: Battle): void {
  for (const fx of b.placeDropFx) {
    if (!fx.isMerge || fx.delay > 0) continue;
    const p = Math.min(1, fx.t / PLACE_TIMING.dropDur);
    if (p > 0.72) continue;
    const startDy = placeDropStartDy(fx.side, fx.r);
    const eased = p ** 2.6;
    const dy = startDy * (1 - eased);
    const scale = 0.76 + 0.24 * eased;
    const { x, y } = cellCenterPx(fx.c, fx.r);
    if (fx.kind === 'unit' && fx.unitType != null && fx.unitTier != null) {
      const tier = Math.max(1, fx.unitTier - 1);
      const size = CELL * 0.72 * scale;
      drawGroundShadow(ctx, x, y + CELL * 0.06 + dy, CELL * 0.28, 0.22);
      drawUnit(ctx, fx.unitType, tier, x, y + dy, size, false, { x, y: y + dy, s: size });
    } else if (fx.kind === 'word' && fx.char != null && fx.wordTier != null) {
      const tier = Math.max(1, fx.wordTier - 1);
      drawGroundShadow(ctx, x, y + dy, CELL * 0.32, 0.22);
      drawWordTile(ctx, fx.char, tier, x, y + dy, CELL * 0.78 * scale, true, 0);
    }
  }
}

// 地面椭圆阴影（怪物/武器/字牌共用：贴脚底、略扁）
function drawGroundShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rad: number,
  alpha = 0.28,
) {
  const shW = Math.max(1, rad * 1.3);
  ctx.save();
  ctx.fillStyle = `rgba(20,16,12,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y + rad * 0.82, shW, rad * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 单个怪物渲染（图标/圆形兜底 + 墨风血条 + 受击闪白 + 技能环 + 入场缩放 + 行走摆动 + 地面阴影）
// —— 帧率自适应特效档位（0.3~1）：机器卡顿时由 main 的帧率监视器调低，渲染据此减少灼烧/冰冻等粒子密度。——
let fxQuality = 1;
/** 设置特效画质档位（clamp 到 0.3~1）。main 帧率监视器据平滑帧时调用。 */
export function setFxQuality(q: number): void {
  fxQuality = Math.max(0.3, Math.min(1, q));
}
/** 当前特效画质档位（供 main 迟滞判断 / 测试探针）。 */
export function getFxQuality(): number {
  return fxQuality;
}

// 单条火舌（灼烧专用）：底宽尖窄，随 phase 左右摇曳；外层暗橙红 + 内层亮黄，配合调用方 lighter 叠加出发光。
function drawBurnFlameTongue(ctx: CanvasRenderingContext2D, cx: number, baseY: number, h: number, w: number, phase: number): void {
  const sway = Math.sin(phase * 2.3) * w * 0.55;
  const tipX = cx + sway;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, baseY);
  ctx.quadraticCurveTo(cx - w * 0.5, baseY - h * 0.5, tipX, baseY - h);
  ctx.quadraticCurveTo(cx + w * 0.5, baseY - h * 0.5, cx + w / 2, baseY);
  ctx.quadraticCurveTo(cx, baseY + h * 0.06, cx - w / 2, baseY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(214,64,20,0.5)';
  ctx.fill();
  const iw = w * 0.52, ih = h * 0.62, itip = cx + sway * 0.6;
  ctx.beginPath();
  ctx.moveTo(cx - iw / 2, baseY);
  ctx.quadraticCurveTo(cx - iw * 0.5, baseY - ih * 0.5, itip, baseY - ih);
  ctx.quadraticCurveTo(cx + iw * 0.5, baseY - ih * 0.5, cx + iw / 2, baseY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,206,86,0.68)';
  ctx.fill();
}

// 灼烧火焰：burnT>0 时在妖怪身上画连续跳动的火焰（+上升火星），画在立绘之后、血条之前。
// 火舌/火星数量随 fxQuality 缩放（卡顿降档时更省帧）。淡入淡出与冰封同构（起 0.2s 入、末 0.5s 出）。
// 用 performance.now 驱动火焰跳动（纯渲染，不入 sim），每怪按 id 起相位错开。
function drawMonsterBurn(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rad0: number,
  m: { id?: number; burnT?: number; isBoss?: boolean; isMiniBoss?: boolean },
): void {
  const bT = m.burnT ?? 0;
  if (bT <= 0) return;
  const elapsed = TUNING.heroBurnDur - bT;
  const vis = Math.max(0, Math.min(1, Math.min(elapsed / 0.2, bT / 0.5)));
  if (vis <= 0) return;
  const now = performance.now() / 1000;
  const seed = (m.id ?? 0) * 1.7 + 3.1;
  const baseY = y + rad0 * 0.55;
  const baseN = m.isBoss ? 8 : m.isMiniBoss ? 6 : 5;
  const tongues = Math.max(3, Math.round(baseN * fxQuality));
  ctx.save();
  ctx.globalAlpha = vis;
  ctx.globalCompositeOperation = 'lighter'; // 叠加：交叠火舌互相提亮，像真火发光
  for (let i = 0; i < tongues; i++) {
    const a = tongues === 1 ? 0.5 : i / (tongues - 1); // 0..1 横铺满身
    const flick = 0.55 + 0.45 * Math.sin(now * (6 + (i % 4) * 1.3) + seed + i * 2.1);
    const center = Math.max(0.35, 1 - Math.abs(a - 0.5) * 1.3); // 中间高、两侧矮
    const h = rad0 * (0.9 + 0.7 * flick) * center;
    const w = rad0 * (0.36 + 0.12 * flick);
    const px = x + (a - 0.5) * rad0 * 1.7 + Math.sin(now * 3 + seed + i) * rad0 * 0.08;
    drawBurnFlameTongue(ctx, px, baseY, h, w, now + seed + i);
  }
  if (fxQuality > 0.55) { // 上升火星：低画质省略以省帧
    const embers = Math.round(5 * fxQuality);
    for (let i = 0; i < embers; i++) {
      const ph = (now * 0.9 + i / embers + seed) % 1; // 0..1 上升进度
      const ex = x + Math.sin(now * 2 + i * 2.7 + seed) * rad0 * 0.7;
      const ey = baseY - ph * rad0 * 2.2;
      const er = (1 - ph) * rad0 * 0.09 + 0.5;
      ctx.globalAlpha = vis * (1 - ph) * 0.9;
      ctx.fillStyle = 'rgba(255,180,80,0.95)';
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// 冰封定身：怪物脚下冒出一圈白色尖角冰晶（纯渲染视觉，状态由 battle 的 frozenT 驱动）。
// 淡入淡出：刚冻住 0.18s 内「长出」、解冻前 0.45s 「融化」；冰晶高低/朝向按怪物 id + dist 伪随机
// 打散（冻住期间 dist 不变 → 同一怪每帧渲染稳定不闪烁）。画在立绘之后 → 冰晶压住脚踝，像站在冰碴里。
function drawFrozenIceShards(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rad0: number,
  m: { id?: number; dist: number; frozenT?: number },
): void {
  const fT = m.frozenT ?? 0;
  if (fT <= 0) return;
  const elapsed = TUNING.freezeStunDur - fT; // 已冻结秒数
  const vis = Math.max(0, Math.min(1, Math.min(elapsed / 0.18, fT / 0.45)));
  if (vis <= 0) return;
  const baseY = y + rad0 * 0.6; // 脚踝位置（立绘底部）
  const seed = (m.id ?? 0) + Math.floor(m.dist * 10);
  ctx.save();
  ctx.globalAlpha = vis;
  // 冰面底盘：脚下半透明淡青椭圆，先压住「站在冰上」的底色
  const g = ctx.createRadialGradient(x, baseY, 0, x, baseY, rad0 * 1.2);
  g.addColorStop(0, 'rgba(226,247,255,0.8)');
  g.addColorStop(0.65, 'rgba(186,233,255,0.35)');
  g.addColorStop(1, 'rgba(186,233,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, baseY, rad0 * 1.2, rad0 * 0.52, 0, 0, Math.PI * 2);
  ctx.fill();
  // 尖角冰晶：绕脚前半圈（屏幕下方可见），身前高、两侧矮，高低再按 seed 起伏
  const N = Math.max(3, Math.round(7 * fxQuality)); // 卡顿降档时减少冰晶数
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const ang = Math.PI * (0.1 + 0.8 * t); // 0.1π..0.9π：椭圆下半圈参数角
    const px = x + Math.cos(ang) * rad0;
    const py = baseY + Math.sin(ang) * rad0 * 0.4;
    const rnd = Math.sin(seed * 97.31 + i * 41.73) * 0.5 + 0.5; // 0..1 稳定伪随机
    const h = rad0 * (0.3 + 0.45 * Math.sin(Math.PI * t) + 0.25 * rnd);
    const w = h * 0.42;
    const tilt = Math.cos(ang) * h * 0.3; // 尖端略向外倾，更像崩开的冰碴
    // 整块冰晶（白）+ 描边
    ctx.beginPath();
    ctx.moveTo(px - w / 2, py);
    ctx.lineTo(px + tilt, py - h);
    ctx.lineTo(px + w / 2, py);
    ctx.closePath();
    ctx.fillStyle = '#f2fbff';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120,195,250,0.8)';
    ctx.stroke();
    // 右半面淡青阴影，做出棱柱立体感
    ctx.beginPath();
    ctx.moveTo(px + tilt, py - h);
    ctx.lineTo(px + w / 2, py);
    ctx.lineTo(px + Math.max(0, tilt), py);
    ctx.closePath();
    ctx.fillStyle = 'rgba(150,215,255,0.55)';
    ctx.fill();
  }
  ctx.restore();
}

// 骑兵立绘默认约定「面朝右」；个别图的美术面朝左（如流沙河「鱼头」朝左），在此登记其 mapId，
// 翻转条件取反即可两半场朝向都对——等价于校正该立绘朝向，但无需改动 CDN 素材（web/小游戏同源生效）。
const CAVALRY_ART_FACES_LEFT = new Set<string>(['liushahe']);

function drawMonsterAt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rad0: number,
  m: {
    dist: number;
    id?: number;
    hp: number;
    maxHp: number;
    isBoss: boolean;
    isMiniBoss?: boolean;
    miniBossKind?: MiniBossKind | null;
    isCavalry?: boolean;
    hitFlash: number;
    skill: unknown;
    castFlash: number;
    spawnT: number;
    stunT?: number;
    frozenT?: number;
    slowT?: number;
    hasteT?: number;
    healFlash?: number;
    burnT?: number;
  },
  mapId: string,
  trailDir = 1,
) {
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
  // 骑兵→每图专属骑兵立绘；小 Boss→按种类专属立绘；其余按 minion/boss。缺图各自回退。
  const spr = m.isCavalry
    ? cavalrySprite(mapId)
    : (m.isMiniBoss && m.miniBossKind)
      ? miniBossSprite(m.miniBossKind, mapId)
      : monsterSprite(mapId, m.isBoss);
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
  // 疾风加速：青绿拖尾（非骑兵）
  if ((m.hasteT ?? 0) > 0 && !m.isCavalry) {
    ctx.save();
    ctx.strokeStyle = 'rgba(125,255,176,0.7)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    const side = -trailDir;
    for (let i = -1; i <= 1; i++) {
      const ly = cy + i * rad0 * 0.35;
      ctx.globalAlpha = 0.55 - Math.abs(i) * 0.15;
      ctx.beginPath();
      ctx.moveTo(x + side * rad0 * 0.5, ly);
      ctx.lineTo(x + side * rad0 * 1.5, ly);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (spr) {
    const box = rad * 2.3;
    const scale = Math.min(box / spr.width, box / spr.height);
    const dw = spr.width * scale;
    const dh = spr.height * scale;
    // 骑兵立绘默认面朝右，向左行(trailDir<0)时水平翻转折面即可。
    // 例外：美术面朝左的图(见 CAVALRY_ART_FACES_LEFT，如流沙河的鱼)翻转条件取反，两半场都朝正确方向。
    // 仅翻转骑兵本体（speed 拖尾在上方已按 trailDir 单独画，不受影响）。
    const artFacesLeft = CAVALRY_ART_FACES_LEFT.has(mapId);
    const flipCavalry = m.isCavalry && (artFacesLeft ? trailDir >= 0 : trailDir < 0);
    if (flipCavalry) {
      ctx.save();
      ctx.translate(x, 0);
      ctx.scale(-1, 1);
      ctx.translate(-x, 0);
      ctx.drawImage(spr, x - dw / 2, cy - dh / 2, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(spr, x - dw / 2, cy - dh / 2, dw, dh);
    }
  } else if (!m.isBoss && !m.isMiniBoss) {
    // 小妖立绘未加载时用汉字「妖」兜底（与铲子「铲」同口径）
    ctx.fillStyle = '#7a2b2b';
    ctx.font = `bold ${Math.round(rad * 1.6)}px "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('妖', x, cy);
  } else {
    ctx.beginPath();
    ctx.arc(x, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = m.isBoss ? '#b02a5b' : '#b05a2a';
    ctx.fill();
  }
  // 冰封定身：脚下白色尖角冰晶（画在立绘后压住脚踝；frozenT 只有冰冻技能写入，武将定身不出冰）
  drawFrozenIceShards(ctx, x, y, rad0, m);
  // 灼烧火焰：burnT>0 时身上连续火烧（主动技能/大招灼烧的持续视觉；卡顿时随 fxQuality 降密度）
  drawMonsterBurn(ctx, x, y, rad0, m);
  // 墨风血条：深墨底条 + 朱红填充
  const bw = rad0 * 2;
  const hpPct = Math.max(0, m.hp / m.maxHp);
  const by = y - rad0 - 5;
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
  // 治疗绿闪
  if ((m.healFlash ?? 0) > 0) {
    ctx.globalAlpha = Math.min(0.55, (m.healFlash ?? 0) * 0.55);
    ctx.fillStyle = '#7dff8a';
    ctx.beginPath();
    ctx.arc(x, cy, rad + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 精英/BOSS/小 Boss 技能标识：彩色环 + 状态芯片；施法瞬间脉冲光圈
  const miniMeta = m.isMiniBoss && m.miniBossKind ? MINI_BOSS_META[m.miniBossKind] : null;
  const skillMeta = m.skill ? SKILL_META[m.skill as keyof typeof SKILL_META] : null;
  const ringMeta = miniMeta ?? skillMeta;
  if (ringMeta) {
    ctx.save();
    ctx.strokeStyle = ringMeta.color;
    ctx.lineWidth = m.isMiniBoss ? 3 : 2.5;
    ctx.beginPath();
    ctx.arc(x, cy, rad + 3, 0, Math.PI * 2);
    ctx.stroke();
    if (m.isMiniBoss) {
      // 小 Boss 外圈虚线，与妖王实环区分
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(x, cy, rad + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (m.castFlash > 0) {
      ctx.globalAlpha = m.castFlash;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, cy, rad + 3 + (1 - m.castFlash) * 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    drawStatusChip(ctx, x, y - rad - 14, ringMeta.icon, ringMeta.color, Math.max(8, rad * 0.55));
    ctx.restore();
  }
  // 妖怪身上的控制/增益状态（定身/减速/疾风/回春/灼烧）
  const mStatuses = monsterStatusItems({
    stunT: m.stunT ?? 0,
    slowT: m.slowT ?? 0,
    hasteT: m.hasteT ?? 0,
    healFlash: m.healFlash ?? 0,
    burnT: m.burnT ?? 0,
  });
  if (mStatuses.length > 0) {
    drawStatusRow(ctx, x, y + rad0 + 8, mStatuses, 7);
  }
}

function drawMonsters(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const m of b.monsters) {
    const p = posAtDistance(b.map, m.dist);
    const { x, y } = cellCenterPx(p.c, p.r);
    // 采样前方一小段求水平朝向（骑兵拖尾方向用）：向右移=+1，向左移=-1
    const np = posAtDistance(b.map, m.dist + 0.05);
    const trailDir = cellCenterPx(np.c, np.r).x - x >= 0 ? 1 : -1;
    const rad0 = m.isBoss ? CELL * 0.42 : m.isMiniBoss ? CELL * 0.36 : CELL * 0.28;
    drawMonsterAt(ctx, x, y, rad0, m, b.map.id, trailDir);
    // 怪物不再逐个挂五行徽章：地图五行统一改到 HUD 地图名后一枚徽章表达（小怪与地图同属性，逐个挂是冗余噪音）
  }
}

// 如来神掌资源图默认「自上而下拍击」，+Y 为推出方向；rotate 后与沿路回推切线对齐
const PALM_PUSH_ICON_ROT_OFFSET = -Math.PI / 2;

/** 沿路 dist 处、朝向 dist 减小（回推）方向的切线角（像素坐标，任意路径） */
function pathPushBackAngleAlong(path: Cell[], dist: number): number {
  const eps = 0.12;
  const p0 = posAlong(path, dist);
  const p1 = posAlong(path, Math.max(0, dist - eps));
  const c0 = cellCenterPx(p0.c, p0.r);
  const c1 = cellCenterPx(p1.c, p1.r);
  const dx = c1.x - c0.x;
  const dy = c1.y - c0.y;
  if (dx * dx + dy * dy < 1e-4) return 0;
  return Math.atan2(dy, dx);
}

function drawRotatedPalmStampAlong(
  ctx: CanvasRenderingContext2D,
  path: Cell[],
  dist: number,
  size: number,
  alpha: number,
): void {
  const p = posAlong(path, dist);
  const { x, y } = cellCenterPx(p.c, p.r);
  const angle = pathPushBackAngleAlong(path, dist) + PALM_PUSH_ICON_ROT_OFFSET;
  const img = sprite(skillAssetKey('act_palm'));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  if (img) {
    ctx.shadowColor = 'rgba(255,210,80,0.55)';
    ctx.shadowBlur = size * 0.22;
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
  } else {
    drawSkillGlyph(ctx, 0, 0, size * 0.48, '掌', '#ffd54a', true, 'act_palm');
  }
  ctx.restore();
}

// 如来神掌：skill-act-palm 图标沿取经路逐格回推，掌缘朝向路径切线
const PALM_TRAIL_MAX = 2;
const PALM_TRAIL_STEP = 0.42; // 残影间距（格）

/** 波前 + 最多 2 枚渐变残影 + 推进弧光（玩家/AI 共用） */
function drawPalmPushWaveFx(
  ctx: CanvasRenderingContext2D,
  path: Cell[],
  waveDist: number,
  frontStartDist: number,
  prog: number,
  fadeT: number,
): void {
  const trailFade = fadeT > 0
    ? Math.max(0, 1 - fadeT / PALM_PUSH_FADE_DUR) ** 1.6
    : 1;

  // 残影在波前后方（已掠过路段），越远越淡越小；推到底后整体快速淡出
  for (let i = PALM_TRAIL_MAX; i >= 1; i--) {
    const d = waveDist + i * PALM_TRAIL_STEP;
    if (d > frontStartDist + 0.05) continue;
    const fade = (PALM_TRAIL_MAX - i + 1) / PALM_TRAIL_MAX;
    const alpha = (0.14 + fade * 0.36) * trailFade;
    if (alpha < 0.02) continue;
    const size = CELL * (0.28 + fade * 0.14);
    drawRotatedPalmStampAlong(ctx, path, d, size, alpha);
  }

  if (fadeT > 0) return;

  const wp = posAlong(path, waveDist);
  const { x, y } = cellCenterPx(wp.c, wp.r);
  const pushAngle = pathPushBackAngleAlong(path, waveDist);
  ctx.save();
  ctx.globalAlpha = 0.35 * (1 - prog * 0.4);
  ctx.strokeStyle = '#ffe27a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, 10 + prog * 16, pushAngle + Math.PI * 0.55, pushAngle + Math.PI * 1.45);
  ctx.stroke();
  ctx.restore();

  const mainSize = CELL * (0.5 + 0.08 * Math.sin(prog * Math.PI));
  drawRotatedPalmStampAlong(ctx, path, waveDist, mainSize, 0.96);
}

function drawPalmPushFx(ctx: CanvasRenderingContext2D, b: Battle) {
  const fx = b.palmPushFx;
  const waveDist = b.palmPushWaveDist();
  if (!fx || waveDist === null) return;
  const prog = Math.min(1, fx.t / fx.dur);
  drawPalmPushWaveFx(ctx, b.map.path, waveDist, fx.frontStartDist, prog, fx.fadeT);
}

// AI 半场如来神掌：沿 aiPath 逐格回推
function drawAiPalmPushFx(ctx: CanvasRenderingContext2D, b: Battle) {
  const fx = b.aiPalmPushFx;
  const waveDist = b.aiPalmPushWaveDist();
  if (!fx || waveDist === null) return;
  const prog = Math.min(1, fx.t / fx.dur);
  drawPalmPushWaveFx(ctx, b.aiPath, waveDist, fx.frontStartDist, prog, fx.fadeT);
}

function skillFxFade(prog: number): number {
  return prog < 0.15 ? prog / 0.15 : 1 - (prog - 0.15) / 0.85;
}

function drawSkillGlyphPulse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  char: string,
  prog: number,
  fade: number,
  fill: string,
  stroke: string,
) {
  ctx.globalAlpha = fade * 0.95;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.font = `bold ${Math.round(CELL * (0.38 + 0.08 * Math.sin(prog * Math.PI * 3)))}px "PingFang SC", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(char, x, y - 1);
  ctx.fillText(char, x, y - 1);
}

function drawJinguSkillFx(ctx: CanvasRenderingContext2D, x: number, y: number, prog: number, fade: number) {
  const maxR = TUNING.aiClearRadius * CELL * 1.05;
  const bloom = Math.min(1, prog / 0.55);
  ctx.globalAlpha = fade * 0.35;
  ctx.strokeStyle = '#ffe27a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x, y, maxR * (0.35 + prog * 0.85), 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const ringP = Math.min(1, prog * 1.25 + i * 0.08);
    const shrink = 1 - ringP * 0.72;
    const r = maxR * shrink;
    ctx.globalAlpha = fade * (0.55 - i * 0.1);
    ctx.strokeStyle = i % 2 === 0 ? '#ffd23c' : '#fff3c4';
    ctx.lineWidth = 3.5 - i * 0.4;
    ctx.setLineDash(i === 1 ? [6, 5] : []);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 金色卍字环（佛印紧缩）
  const manjiN = 6;
  const manjiR = maxR * (0.55 + (1 - bloom) * 0.28);
  const manjiSpin = prog * 1.6;
  const manjiPx = Math.round(CELL * (0.26 + 0.04 * Math.sin(prog * Math.PI * 2)));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${manjiPx}px "PingFang SC", "Songti SC", serif`;
  for (let i = 0; i < manjiN; i++) {
    const a = (i / manjiN) * Math.PI * 2 + manjiSpin;
    const mx = x + Math.cos(a) * manjiR;
    const my = y + Math.sin(a) * manjiR;
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(a + Math.PI / 2);
    ctx.globalAlpha = fade * (0.55 + bloom * 0.35);
    ctx.strokeStyle = '#fff6c8';
    ctx.lineWidth = 2;
    ctx.strokeText('卍', 0, 0);
    ctx.fillStyle = i % 2 === 0 ? '#ffd23c' : '#ffe27a';
    ctx.fillText('卍', 0, 0);
    ctx.restore();
  }
  // 内圈较小卍字
  const innerN = 4;
  const innerR = maxR * (0.22 + (1 - bloom) * 0.12);
  const innerPx = Math.round(CELL * 0.2);
  ctx.font = `bold ${innerPx}px "PingFang SC", "Songti SC", serif`;
  for (let i = 0; i < innerN; i++) {
    const a = (i / innerN) * Math.PI * 2 - manjiSpin * 1.2;
    ctx.globalAlpha = fade * 0.65 * bloom;
    ctx.fillStyle = '#fff3c4';
    ctx.fillText('卍', x + Math.cos(a) * innerR, y + Math.sin(a) * innerR);
  }

  drawSkillGlyphPulse(ctx, x, y, '咒', prog, fade, '#ffd54a', '#fff8dc');
  ctx.globalAlpha = fade * 0.55;
  ctx.strokeStyle = '#ffc830';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + prog * 1.2;
    const r0 = CELL * 0.14;
    const r1 = maxR * (0.22 + (1 - prog) * 0.45);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    ctx.stroke();
  }
}

/** 不规则伪随机 0..1（特效用，避免每帧闪烁） */
function fxHash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** 不规则陨石剪影 */
function drawMeteorRockGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  r: number,
  seed: number,
  alpha: number,
  rot: number,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  const verts = 7 + Math.floor(fxHash01(seed) * 3);
  ctx.beginPath();
  for (let i = 0; i < verts; i++) {
    const a = (i / verts) * Math.PI * 2;
    const jagged = 0.62 + fxHash01(seed * 3.1 + i * 1.7) * 0.55;
    const px = Math.cos(a) * r * jagged;
    const py = Math.sin(a) * r * jagged * (0.82 + fxHash01(seed + i) * 0.28);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r * 1.1);
  g.addColorStop(0, '#8a6a48');
  g.addColorStop(0.45, '#5a4030');
  g.addColorStop(1, '#2a1810');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#1a1008';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // 表面裂纹/亮面
  ctx.strokeStyle = 'rgba(200,170,130,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-r * 0.35, -r * 0.15);
  ctx.lineTo(r * 0.1, r * 0.05);
  ctx.lineTo(r * 0.35, -r * 0.25);
  ctx.stroke();
  ctx.fillStyle = 'rgba(40,25,15,0.55)';
  ctx.beginPath();
  ctx.arc(r * 0.15, r * 0.2, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 圆凹形陨石坑（坑圆、石不规则） */
function drawMeteorCrater(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  r: number,
  _seed: number,
  alpha: number,
  bloom: number,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = alpha;
  const rx = r * (0.95 + bloom * 0.12);
  const ry = r * 0.72 * (0.95 + bloom * 0.12);
  // 外缘焦土晕（椭圆）
  const rim = ctx.createRadialGradient(0, -ry * 0.1, rx * 0.15, 0, 0, rx);
  rim.addColorStop(0, `rgba(12,8,5,${0.95 * alpha})`);
  rim.addColorStop(0.35, `rgba(55,32,16,${0.75 * alpha})`);
  rim.addColorStop(0.7, `rgba(120,70,35,${0.4 * alpha})`);
  rim.addColorStop(1, 'rgba(80,45,20,0)');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // 坑底深凹（更小椭圆）
  const bowl = ctx.createRadialGradient(0, ry * 0.08, 1, 0, 0, rx * 0.55);
  bowl.addColorStop(0, `rgba(5,3,2,${0.98 * alpha})`);
  bowl.addColorStop(0.65, `rgba(28,16,8,${0.85 * alpha})`);
  bowl.addColorStop(1, `rgba(40,22,12,${0.35 * alpha})`);
  ctx.fillStyle = bowl;
  ctx.beginPath();
  ctx.ellipse(0, ry * 0.05, rx * 0.55, ry * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();
  // 坑缘高光（上沿一圈，增强凹感）
  ctx.strokeStyle = `rgba(220,150,70,${0.55 * alpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, -ry * 0.08, rx * 0.88, ry * 0.78, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.strokeStyle = `rgba(30,18,10,${0.5 * alpha})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, ry * 0.12, rx * 0.72, ry * 0.55, 0, 0.15, Math.PI - 0.15);
  ctx.stroke();
  // 少量放射裂纹（不破坏圆坑轮廓）
  ctx.strokeStyle = `rgba(140,85,40,${0.4 * alpha})`;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * rx * 0.4, Math.sin(a) * ry * 0.35);
    ctx.lineTo(Math.cos(a) * rx * 0.85 * bloom, Math.sin(a) * ry * 0.75 * bloom);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMeteorSkillFx(ctx: CanvasRenderingContext2D, x: number, y: number, prog: number, fade: number) {
  const maxR = TUNING.meteorRadius * CELL * 1.15;
  const life = Math.sin(Math.min(1, prog / 0.95) * Math.PI);
  const vis = Math.max(fade, life * 0.8);
  // 多颗斜向陨石：错落时间 + 不同入射角（更斜、更散）
  const rocks = [
    { seed: 11, delay: 0.00, ox: -CELL * 0.35, angle: 0.95, size: 1.05 },
    { seed: 29, delay: 0.07, ox: CELL * 0.1, angle: 1.15, size: 1.25 },
    { seed: 47, delay: 0.14, ox: CELL * 0.55, angle: 0.85, size: 0.88 },
    { seed: 63, delay: 0.10, ox: -CELL * 0.05, angle: 1.05, size: 0.72 },
    { seed: 81, delay: 0.18, ox: CELL * 0.35, angle: 1.25, size: 0.65 },
  ];
  const fallEnd = 0.5;

  for (const rock of rocks) {
    const local = Math.max(0, Math.min(1, (prog - rock.delay) / (fallEnd - rock.delay * 0.35)));
    if (local <= 0) continue;
    const fall = easeIn(local);
    const dist = CELL * (3.2 + rock.size * 0.7);
    // 从斜上方飞入落点附近（cos/sin：右上→落点，形成明显斜线）
    const sx = x + rock.ox - Math.cos(rock.angle) * dist;
    const sy = y - Math.sin(rock.angle) * dist;
    const ex = x + rock.ox * 0.4;
    const ey = y + CELL * 0.04 * ((rock.seed % 5) - 2);
    const rx = sx + (ex - sx) * fall;
    const ry = sy + (ey - sy) * fall;
    const rockR = CELL * (0.17 + rock.size * 0.09);
    const rot = rock.angle + fall * 3.2 + rock.seed * 0.08;

    // 火焰拖尾（沿飞行反方向）
    if (fall > 0.05 && fall < 0.98) {
      const trailLen = CELL * (0.7 + rock.size * 0.45) * Math.sin(local * Math.PI);
      const tx = rx - Math.cos(rock.angle) * trailLen;
      const ty = ry - Math.sin(rock.angle) * trailLen;
      ctx.globalAlpha = vis * (0.55 + rock.size * 0.2) * Math.sin(local * Math.PI);
      const tg = ctx.createLinearGradient(rx, ry, tx, ty);
      tg.addColorStop(0, 'rgba(255,240,160,0.95)');
      tg.addColorStop(0.35, 'rgba(255,140,40,0.7)');
      tg.addColorStop(1, 'rgba(255,40,10,0)');
      ctx.strokeStyle = tg;
      ctx.lineWidth = 3.5 + rock.size * 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      // 尾焰火星
      for (let k = 0; k < 3; k++) {
        const t = 0.3 + k * 0.22;
        const mx = rx + (tx - rx) * t + Math.sin(prog * 9 + k + rock.seed) * 3;
        const my = ry + (ty - ry) * t + Math.cos(prog * 7 + k) * 2;
        ctx.globalAlpha = vis * (0.5 - k * 0.12) * Math.sin(local * Math.PI);
        ctx.fillStyle = k === 0 ? '#fff3a0' : '#ff7a2c';
        ctx.beginPath();
        ctx.arc(mx, my, 1.5 + rock.size * 0.6 - k * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 下落中的陨石本体（近地淡出，留给坑）
    const rockFade = local < 0.88 ? 1 : Math.max(0, 1 - (local - 0.88) / 0.12);
    if (rockFade > 0.02) {
      drawMeteorRockGlyph(ctx, rx, ry, rockR, rock.seed, vis * rockFade * (0.55 + fall * 0.45), rot);
    }
  }

  // 撞击：陨石坑 + 火爆 + 碎石飞溅
  if (prog > 0.36) {
    const hitP = Math.min(1, (prog - 0.36) / 0.64);
    const bloom = easeOut(hitP);
    const peak = Math.sin(Math.min(1, hitP / 0.7) * Math.PI);

    // 主坑 + 两处侧坑（不规则）
    drawMeteorCrater(ctx, x, y, maxR * (0.55 + bloom * 0.2), 101, vis * (0.7 + peak * 0.3), bloom);
    drawMeteorCrater(ctx, x - CELL * 0.45, y + CELL * 0.12, maxR * 0.32 * bloom, 202, vis * peak * 0.7, bloom);
    drawMeteorCrater(ctx, x + CELL * 0.5, y - CELL * 0.08, maxR * 0.28 * bloom, 303, vis * peak * 0.65, bloom);

    // 火浪冲击
    ctx.globalAlpha = vis * (0.55 + peak * 0.45);
    const g = ctx.createRadialGradient(x, y, 0, x, y, maxR * (0.35 + bloom * 0.8));
    g.addColorStop(0, 'rgba(255,230,140,0.75)');
    g.addColorStop(0.4, 'rgba(255,110,30,0.45)');
    g.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, maxR * (0.35 + bloom * 0.8), 0, Math.PI * 2);
    ctx.fill();

    // 焦土冲击环（圆凹外缘）
    ctx.globalAlpha = vis * peak * 0.85;
    ctx.strokeStyle = '#ffb040';
    ctx.lineWidth = 3.5 - bloom * 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y, maxR * bloom, maxR * bloom * 0.82, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,200,100,0.45)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(x, y, maxR * bloom * 0.72, maxR * bloom * 0.58, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 碎石飞溅
    const shards = 12;
    for (let i = 0; i < shards; i++) {
      const a = (i / shards) * Math.PI * 2 + hitP * 0.8 + fxHash01(i * 3) * 0.4;
      const d = maxR * (0.35 + fxHash01(i * 5) * 0.55) * bloom;
      const sx = x + Math.cos(a) * d;
      const sy = y + Math.sin(a) * d * 0.85 - bloom * CELL * 0.12;
      const sr = 2 + fxHash01(i * 7) * 3.5;
      ctx.globalAlpha = vis * peak * (0.45 + fxHash01(i) * 0.4);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(a + hitP);
      ctx.fillStyle = i % 2 === 0 ? '#6a4a30' : '#3a2818';
      ctx.beginPath();
      ctx.moveTo(-sr, -sr * 0.4);
      ctx.lineTo(sr * 0.8, -sr * 0.6);
      ctx.lineTo(sr * 0.3, sr);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

/** 六瓣雪花：主枝 + 侧枝 + 尖端星点 */
function drawSnowflake(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  rot: number,
  alpha: number,
  color = '#e8f8ff',
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.1, size * 0.08);
  for (let arm = 0; arm < 6; arm++) {
    ctx.save();
    ctx.rotate((arm * Math.PI) / 3);
    // 主枝
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -size);
    ctx.stroke();
    // 两侧枝（中段、外段各一对）
    for (const [t, branchLen, ang] of [
      [0.42, size * 0.32, Math.PI / 3.2],
      [0.68, size * 0.22, Math.PI / 3.6],
    ] as const) {
      const by = -size * t;
      ctx.beginPath();
      ctx.moveTo(0, by);
      ctx.lineTo(Math.sin(ang) * branchLen, by - Math.cos(ang) * branchLen);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, by);
      ctx.lineTo(-Math.sin(ang) * branchLen, by - Math.cos(ang) * branchLen);
      ctx.stroke();
    }
    // 尖端小叉
    ctx.beginPath();
    ctx.moveTo(-size * 0.1, -size * 0.88);
    ctx.lineTo(0, -size);
    ctx.lineTo(size * 0.1, -size * 0.88);
    ctx.stroke();
    ctx.restore();
  }
  // 中心六角核
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 6;
    const r = size * 0.14;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFreezeSkillFx(ctx: CanvasRenderingContext2D, x: number, y: number, prog: number, fade: number) {
  const maxR = TUNING.aiClearRadius * CELL * 0.85;
  const bloom = easeOut(Math.min(1, prog / 0.55));
  const life = Math.sin(Math.min(1, prog / 0.95) * Math.PI);
  const vis = Math.max(fade, life * 0.7);

  // 淡青扩散环（底层氛围，不抢雪花）
  for (let i = 0; i < 2; i++) {
    const ringP = Math.min(1, bloom + i * 0.08);
    ctx.globalAlpha = vis * (0.22 - i * 0.08);
    ctx.strokeStyle = i === 0 ? '#dff8ff' : '#9fe8ff';
    ctx.lineWidth = 2 - i * 0.4;
    ctx.beginPath();
    ctx.arc(x, y, maxR * ringP * 0.92, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 中心大雪花
  const mainSize = CELL * (0.42 + bloom * 0.38);
  drawSnowflake(ctx, x, y, mainSize, prog * 0.35, vis * (0.7 + bloom * 0.25), '#f2fcff');

  // 外圈飘散小雪花
  const flakes = 8;
  for (let i = 0; i < flakes; i++) {
    const a = (i / flakes) * Math.PI * 2 + prog * 0.4;
    const dist = maxR * (0.28 + bloom * (0.45 + (i % 3) * 0.08));
    const fx = x + Math.cos(a) * dist;
    const fy = y + Math.sin(a) * dist - bloom * CELL * 0.06;
    const sz = CELL * (0.14 + (i % 3) * 0.05) * (0.55 + bloom * 0.55);
    const spin = a + prog * (1.2 + (i % 2) * 0.6);
    drawSnowflake(
      ctx,
      fx,
      fy,
      sz,
      spin,
      vis * (0.45 + (i % 2) * 0.2) * (0.6 + bloom * 0.4),
      i % 2 === 0 ? '#e0f6ff' : '#c8ecff',
    );
  }

  // 细碎冰晶点（点缀，不抢雪花轮廓）
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + prog * 1.1;
    const d = maxR * (0.2 + bloom * (0.55 + (i % 4) * 0.08));
    ctx.globalAlpha = vis * (0.25 + (i % 3) * 0.12) * bloom;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.2 + (i % 2), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAtkBuffSkillFx(ctx: CanvasRenderingContext2D, x: number, y: number, prog: number, fade: number) {
  const maxR = CELL * 3.2;
  const wave = 0.35 + prog * 0.95;
  const g = ctx.createRadialGradient(x, y, 0, x, y, maxR * wave);
  g.addColorStop(0, `rgba(255,120,80,${0.55 * fade})`);
  g.addColorStop(0.45, `rgba(255,60,40,${0.28 * fade})`);
  g.addColorStop(1, 'rgba(255,30,30,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, maxR * wave, 0, Math.PI * 2);
  ctx.fill();
  // 丹气粒子：自中心向外扩散
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + prog * Math.PI * 2;
    const dist = CELL * (0.4 + prog * 2.2);
    ctx.globalAlpha = fade * (1 - prog * 0.35);
    ctx.fillStyle = i % 2 === 0 ? '#ff9070' : '#ffd0c0';
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * dist, y + Math.sin(a) * dist, 3 + (1 - prog) * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = fade * 0.85;
  ctx.strokeStyle = '#ff6040';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(x, y, maxR * prog * 0.9, 0, Math.PI * 2);
  ctx.stroke();
  drawSkillGlyphPulse(ctx, x, y, '丹', prog, fade, '#ff7060', '#ffd0c8');
}

function drawFrqBuffSkillFx(ctx: CanvasRenderingContext2D, x: number, y: number, prog: number, fade: number) {
  const spin = prog * Math.PI * 5;
  for (let ring = 0; ring < 3; ring++) {
    const r = CELL * (0.5 + ring * 0.28 + prog * 0.35);
    ctx.globalAlpha = fade * (0.85 - ring * 0.18);
    ctx.strokeStyle = ring === 0 ? '#ffe060' : ring === 1 ? '#ffb830' : '#ff8c20';
    ctx.lineWidth = 5 - ring;
    ctx.beginPath();
    ctx.arc(x, y, r, spin + ring * 0.5, spin + Math.PI * 1.4 + ring * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r, spin + Math.PI + ring * 0.5, spin + Math.PI * 2.4 + ring * 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = fade * 0.45;
  const g = ctx.createRadialGradient(x, y, 0, x, y, CELL * 2.4);
  g.addColorStop(0, 'rgba(255,220,80,0.65)');
  g.addColorStop(0.55, 'rgba(255,140,30,0.25)');
  g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, CELL * 2.4, 0, Math.PI * 2);
  ctx.fill();
  // 火星尾迹
  for (let i = 0; i < 8; i++) {
    const a = spin * 1.2 + i * (Math.PI * 2 / 8);
    const dist = CELL * (0.8 + prog * 1.6);
    ctx.globalAlpha = fade * (0.7 - prog * 0.3);
    ctx.fillStyle = '#ffd850';
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * dist, y + Math.sin(a) * dist, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  drawSkillGlyphPulse(ctx, x, y, '轮', prog, fade, '#ffd050', '#fff0b0');
}

/** 主动技能爆发特效（紧箍咒 / 陨石 / 冰封 / 仙丹 / 风火轮） */
function drawSkillFx(ctx: CanvasRenderingContext2D, fx: SkillFx | null) {
  if (!fx) return;
  const prog = Math.min(1, fx.t / fx.dur);
  const { x, y } = cellCenterPx(fx.c, fx.r);
  const fade = skillFxFade(prog);
  ctx.save();
  switch (fx.kind) {
    case 'jinggu':
      drawJinguSkillFx(ctx, x, y, prog, fade);
      break;
    case 'meteor':
      drawMeteorSkillFx(ctx, x, y, prog, fade);
      break;
    case 'freeze':
      drawFreezeSkillFx(ctx, x, y, prog, fade);
      break;
    case 'atkBuff':
      drawAtkBuffSkillFx(ctx, x, y, prog, fade);
      break;
    case 'frqBuff':
      drawFrqBuffSkillFx(ctx, x, y, prog, fade);
      break;
    default: {
      const _exhaustive: never = fx.kind;
      void _exhaustive;
    }
  }
  ctx.restore();
}

// 爆发特效：命中冲击环 / 击杀爆散 / 合成星爆
function drawDigFx(ctx: CanvasRenderingContext2D, fxList: { c: number; r: number; t: number }[]) {
  const spr = sprite('item-shovel');
  const STROKES = 2; // 铲两下（与 digDur / 半程音效对齐）
  for (const d of fxList) {
    const { x, y } = cellCenterPx(d.c, d.r);
    const phase = Math.min(1, d.t / PLACE_TIMING.digDur); // 0→1
    const u = phase * STROKES;
    const stroke = Math.min(STROKES - 1, Math.floor(u));
    const local = u - stroke; // 单铲内 0→1：下压→抬起
    // 前半快落、后半抬起，峰值更像真实一铲
    const chop = local < 0.45
      ? (local / 0.45) ** 1.35
      : (1 - (local - 0.45) / 0.55) ** 1.1;
    const tilt = (stroke === 0 ? -1 : 1) * (0.28 + chop * 0.42);
    const s = CELL * 0.62;
    ctx.save();
    ctx.globalAlpha = 1 - phase * 0.12;
    // 泥坑：随两铲加深
    const pit = 0.22 + phase * 0.2;
    ctx.fillStyle = `rgba(60,40,20,${0.28 + phase * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(x, y + CELL * 0.18, CELL * pit, CELL * (pit * 0.45), 0, 0, Math.PI * 2);
    ctx.fill();
    // 下铲溅泥（峰值附近更明显）
    if (chop > 0.55) {
      const spit = (chop - 0.55) / 0.45;
      ctx.fillStyle = `rgba(90,62,32,${0.35 * spit})`;
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.ellipse(
          x + side * CELL * (0.16 + spit * 0.1),
          y + CELL * (0.06 - spit * 0.08),
          CELL * 0.05,
          CELL * 0.035,
          side * 0.4,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    // 铲子：随 chop 下压 + 两铲左右对挥
    ctx.translate(x, y - CELL * 0.14 + chop * CELL * 0.28);
    ctx.rotate(tilt);
    if (spr) {
      ctx.drawImage(spr, -s / 2, -s / 2, s, s);
    } else {
      ctx.font = `${Math.round(s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🥄', 0, 0);
    }
    ctx.restore();
  }
}

// 黄狮精「卷走」预演幽灵：目标已从逻辑盘面删除，但先在被偷格原地闪烁——
// 金色警示框持续脉冲提示位置，立绘/字块/桃树残影按方波亮暗交替（约 3.3 次/秒），
// 闪烁期满由 updateFx 爆金色粒子环真正消失。让玩家看清「是哪件被卷走了」。
function drawStealFx(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const s of b.stealFx) {
    const { x, y } = cellCenterPx(s.c, s.r);
    const elapsed = s.maxTtl - s.ttl;
    const blink = Math.sin(elapsed * Math.PI * 2 * 3.3); // -1..1，方波化后约 3.3 次/秒
    ctx.save();
    // 金色警示框：不随亮暗相位熄灭（它是「看这里」的锚点），强度随相位脉冲
    ctx.globalAlpha = 0.5 + 0.3 * Math.max(0, blink);
    ctx.lineWidth = 3;
    ctx.strokeStyle = MINI_BOSS_META.lion.color;
    roundRect(ctx, x - CELL * 0.38, y - CELL * 0.38, CELL * 0.76, CELL * 0.76, 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 暗相位隐藏残影，形成「闪动」；亮相位按被偷对象原样重画（兵器含阶数角标，便于辨认）
    if (blink < 0) {
      ctx.restore();
      continue;
    }
    if (s.kind === 'unit' && s.unitType != null) {
      drawUnit(ctx, s.unitType, s.unitTier ?? 1, x, y, CELL * 0.72, false, { x, y, s: CELL * 0.72 });
    } else if (s.kind === 'word' && s.char != null) {
      drawWordTile(ctx, s.char, s.wordTier ?? 1, x, y, CELL * 0.78, true, 0);
    } else if (s.kind === 'tree') {
      drawPeachTree(ctx, x, y, CELL * 0.7, s.treeLevel ?? 1);
    }
    ctx.restore();
  }
}

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

// 埋在路径上的炸药：优先用炸药立绘（act-bomb），未加载则回退矢量铁球 + 引信火花
function drawArmedBomb(ctx: CanvasRenderingContext2D, bomb: { c: number; r: number; t: number }) {
  const { x, y } = cellCenterPx(bomb.c, bomb.r);
  const r = CELL * 0.22;
  ctx.save();
  // 地面阴影
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.95, r * 1.05, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const img = sprite('skill-act-bomb');
  if (img && img.width) {
    // 立绘：按格子高度绘制，底部略微下沉贴地；引信火花用 t 叠一层辉光让"活"起来
    const h = CELL * 0.62;
    const w = h * (img.width / img.height);
    ctx.drawImage(img, x - w / 2, y - h * 0.62, w, h);
    const spark = 0.55 + 0.45 * Math.sin(performance.now() / 1000 * 12 + (bomb.c + bomb.r));
    // 火花辉光的锚点：立绘（skill-act-bomb）里的引信火苗略偏中心右下，
    // 故在原位基础上再往右下各微移 5px，让这层动态辉光正好压在立绘火苗上。
    const sx = x + w * 0.16 + 5; // +5 → 往右
    const sy = y - h * 0.52 + 5; // +5 → 往下（canvas 里 y 向下为正）
    const sr = r * 0.5 * spark + r * 0.25;
    const sg = ctx.createRadialGradient(sx, sy, 0.5, sx, sy, sr);
    sg.addColorStop(0, `rgba(255,250,210,${0.9 * spark})`);
    sg.addColorStop(0.5, `rgba(255,170,60,${0.6 * spark})`);
    sg.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // —— 回退：矢量铁球 ——
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
  g.addColorStop(0, '#5a5f68');
  g.addColorStop(0.6, '#2b2f36');
  g.addColorStop(1, '#15181c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // 高光点
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(x - r * 0.34, y - r * 0.36, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
  // 引信口 + 弯曲引信
  ctx.fillStyle = '#3a2a12';
  ctx.beginPath();
  ctx.arc(x, y - r * 0.9, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#9a774a';
  ctx.lineWidth = Math.max(1.4, r * 0.14);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.9);
  ctx.quadraticCurveTo(x + r * 0.55, y - r * 1.5, x + r * 0.22, y - r * 1.95);
  ctx.stroke();
  // 火花：随 t 闪烁跳动，红黄辉光
  const spark = 0.55 + 0.45 * Math.sin(bomb.t * 18);
  const sx = x + r * 0.22;
  const sy = y - r * 1.95;
  const sr = r * 0.65 * spark + r * 0.3;
  const sg = ctx.createRadialGradient(sx, sy, 0.5, sx, sy, sr);
  sg.addColorStop(0, `rgba(255,250,210,${0.95 * spark})`);
  sg.addColorStop(0.5, `rgba(255,170,60,${0.7 * spark})`);
  sg.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBombs(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const bomb of b.bombs) drawArmedBomb(ctx, bomb);
  for (const bomb of b.aiBombs) drawArmedBomb(ctx, bomb);
}

// 炸药引爆特效：冲击波环 + 火球核心 + 四散碎片射线
function drawBombFx(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const f of b.bombFx) {
    const { x, y } = cellCenterPx(f.c, f.r);
    const t = 1 - f.ttl / f.maxTtl; // 0→1
    const R = CELL * TUNING.bombExplodeRadius;
    ctx.save();
    // 冲击波环（快速外扩、变淡）
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.strokeStyle = 'rgba(255,220,150,0.9)';
    ctx.lineWidth = Math.max(2, CELL * 0.12 * (1 - t));
    ctx.beginPath();
    ctx.arc(x, y, R * (0.2 + t * 0.95), 0, Math.PI * 2);
    ctx.stroke();
    // 火球核心（前段最亮，迅速收束）
    const core = Math.max(0, 1 - t * 1.6);
    if (core > 0) {
      const rad = R * (0.3 + t * 0.5) * (0.5 + core);
      const g = ctx.createRadialGradient(x, y, 1, x, y, rad);
      g.addColorStop(0, `rgba(255,252,230,${core})`);
      g.addColorStop(0.35, `rgba(255,185,75,${0.85 * core})`);
      g.addColorStop(0.7, `rgba(255,95,40,${0.5 * core})`);
      g.addColorStop(1, 'rgba(120,40,20,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    // 碎片射线
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = '#ffd27a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const shards = 10;
    for (let i = 0; i < shards; i++) {
      const a = (i / shards) * Math.PI * 2 + f.c * 0.7;
      const r0 = R * 0.2 + t * R * 0.55;
      const r1 = r0 + CELL * 0.42 * (1 - t);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// 缓动：ease-out（两端→中段），大招动画统一手感
function easeOut(p: number): number { return 1 - Math.pow(1 - p, 3); }
function easeIn(p: number): number { return p * p * p; }

/** 金箍棒旋转绘制（普攻/大招共用）：len 为半长(px)，blur 控制残影盘强度 */
function drawStaffSpinGlyph(
  ctx: CanvasRenderingContext2D,
  spin: number,
  len: number,
  tier: number,
  alpha: number,
  blur: number,
) {
  const tierCap = Math.min(tier, 4);
  const lw = (4 + tierCap * 1.1) * Math.max(0.35, len / (CELL * 0.34));
  const glowR = Math.min(len, CELL * (0.72 + tierCap * 0.07));
  ctx.save();
  ctx.lineCap = 'round';
  if (blur > 0.05) {
    const grad = ctx.createRadialGradient(0, 0, glowR * 0.15, 0, 0, glowR);
    grad.addColorStop(0, 'rgba(232,161,28,0.03)');
    grad.addColorStop(0.65, `rgba(232,161,28,${0.14 * blur})`);
    grad.addColorStop(1, `rgba(255,226,122,${0.4 * blur})`);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, glowR, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = alpha * blur * 0.85;
    ctx.strokeStyle = '#fff3c4';
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(0, 0, glowR, spin - 0.6, spin + 0.15); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, glowR, spin + Math.PI - 0.6, spin + Math.PI + 0.15); ctx.stroke();
  }
  ctx.globalAlpha = alpha * (1 - 0.75 * blur);
  ctx.rotate(spin);
  ctx.strokeStyle = '#e8a11c';
  ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0); ctx.stroke();
  ctx.strokeStyle = '#fff3c4';
  ctx.lineWidth = Math.max(1.5, lw * 0.45);
  ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0); ctx.stroke();
  ctx.fillStyle = '#ffe27a';
  const cap = Math.max(1.5, (2 + tierCap * 0.8) * Math.max(0.35, len / (CELL * 0.34)));
  ctx.beginPath(); ctx.arc(len, 0, cap, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-len, 0, cap, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** 大圣金箍棒：从 from 飞到 to（变大），再飞回 from（变小隐藏） */
function drawStaffBoomerang(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number, toY: number,
  prog: number,
  tier: number,
  outFrac = 0.42,
) {
  const turns = 2 + Math.min(tier, 4);
  const lenBase = CELL * (0.24 + tier * 0.085) * 1.15; // 高阶略收敛，避免 5 阶满屏
  let cx: number, cy: number, scale: number, alpha: number, spin: number, blur: number;

  if (prog < outFrac) {
    const lp = prog / outFrac;
    const ease = easeOut(lp);
    cx = fromX + (toX - fromX) * ease;
    cy = fromY + (toY - fromY) * ease;
    scale = 0.18 + 0.82 * ease;
    alpha = 0.4 + 0.6 * ease;
    const eio = lp < 0.5 ? 2 * lp * lp : 1 - Math.pow(-2 * lp + 2, 2) / 2;
    spin = turns * Math.PI * 2 * eio * 0.65;
    blur = Math.pow(Math.sin(Math.PI * lp), 2.4) * 0.85;
    // 飞出尾迹
    ctx.save();
    ctx.globalAlpha = alpha * 0.35;
    ctx.strokeStyle = '#ffe27a';
    ctx.lineWidth = 3 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.restore();
  } else {
    const lp = (prog - outFrac) / (1 - outFrac);
    const ease = easeIn(lp);
    cx = toX + (fromX - toX) * ease;
    cy = toY + (fromY - toY) * ease;
    scale = Math.max(0.06, 1 - lp * 0.94);
    alpha = Math.max(0, 1 - lp * 0.96);
    spin = turns * Math.PI * 2 * (0.65 + lp * 0.35);
    blur = Math.pow(Math.sin(Math.PI * lp), 1.6) * 0.45 * (1 - lp * 0.7);
  }

  ctx.save();
  ctx.translate(cx, cy);
  drawStaffSpinGlyph(ctx, spin, lenBase * scale, tier, alpha, blur);
  ctx.restore();
}

// 武将大招专属动画：switch(heroId) 分派，风格对齐 drawFx。
// 玩家/AI 两半场共用：分别传 heroUltFx / erlangDogFx 与桥重建的 aiHeroUltFx / aiErlangDogFx
// （AI 侧格坐标已在桥内镜像，无需渲染侧再翻）。
function drawHeroUltFxList(
  ctx: CanvasRenderingContext2D,
  ultList: HeroUltFx[],
  dogList: ErlangDogFx[],
): void {
  for (const f of ultList) {
    const { x, y } = cellCenterPx(f.c, f.r);
    const prog = 1 - f.ttl / f.maxTtl; // 0→1
    const fade = 1 - prog;             // 1→0
    const R = f.rge * CELL;            // 群攻范围半径(px)
    ctx.save();
    switch (f.heroId) {
      // —— 暴击 ——
      case 'nezha': drawUltNezha(ctx, x, y, prog, fade, f.tier, R); break;
      case 'erlang': drawUltErlang(ctx, x, y, prog, fade, f.tier, f.fromC, f.fromR, f.biteC, f.biteR); break;
      case 'niulang': drawUltNiulang(ctx, x, y, prog, fade, f.tier, f.fromC, f.fromR); break;
      // —— 满5 群攻 ——
      case 'dasheng': drawUltDasheng(ctx, x, y, prog, fade, f.tier, R, f.fromC, f.fromR); break;
      case 'honghaier': drawUltHonghaier(ctx, x, y, prog, fade, f.tier, R); break;
      case 'bajie': drawUltBajie(ctx, x, y, prog, fade, f.tier, R); break;
      case 'tieshan': drawUltTieshan(ctx, x, y, prog, fade, f.tier, R); break;
      case 'shaseng': drawUltShaseng(ctx, x, y, prog, fade, f.tier, R); break;
      case 'niumowang': drawUltNiumowang(ctx, x, y, prog, fade, f.tier, R, f.fromC, f.fromR); break;
      case 'guanyin': drawUltGuanyin(ctx, x, y, prog, fade, f.tier, R); break;
      case 'laojun': drawUltLaojun(ctx, x, y, prog, fade, f.tier, R); break;
      case 'wenshu': drawUltWenshu(ctx, x, y, prog, fade, f.tier, R); break;
      case 'taibai': drawUltTaibai(ctx, x, y, prog, fade, f.tier, R); break;
      case 'tangseng': drawUltTangseng(ctx, x, y, prog, fade, f.tier, R); break;
      // —— 过渡满3 ——
      case 'damang': drawUltDamang(ctx, x, y, prog, fade, f.tier, R); break;
      case 'jinzha': drawUltJinzha(ctx, x, y, prog, fade, f.tier, R); break;
      case 'hongpao': drawUltHongpao(ctx, x, y, prog, fade, f.tier, R); break;
      case 'baxian': drawUltBaxian(ctx, x, y, prog, fade, f.tier, R); break;
      case 'qingniu': drawUltQingniu(ctx, x, y, prog, fade, f.tier, R); break;
      case 'tiebei': drawUltTiebei(ctx, x, y, prog, fade, f.tier, R); break;
      case 'liusha': drawUltLiusha(ctx, x, y, prog, fade, f.tier, R); break;
      case 'fanyin': drawUltFanyin(ctx, x, y, prog, fade, f.tier, R); break;
      case 'danjun': drawUltDanjun(ctx, x, y, prog, fade, f.tier, R); break;
      case 'huishu': drawUltHuishu(ctx, x, y, prog, fade, f.tier, R); break;
      case 'bailong': drawUltBailong(ctx, x, y, prog, fade, f.tier, R); break;
    }
    ctx.restore();
  }

  // 二郎哮天犬跟随特效：冲锋 0.5s → 咬住 2.5s（怪死亡则消失）
  for (const d of dogList) {
    const elapsed = d.maxTtl - d.ttl; // 已持续时间
    const chargeDur = 0.5; // 冲锋阶段时长
    const prog = 1 - d.ttl / d.maxTtl;
    const fade = Math.max(0.35, 1 - prog * 0.65); // 末段淡出
    const bx = BOARD_X + d.c * CELL + CELL / 2;
    const by = BOARD_Y + d.r * CELL + CELL / 2;
    const eyeX = BOARD_X + d.fromC * CELL + CELL / 2;
    const eyeY = BOARD_Y + d.fromR * CELL + CELL / 2;
    ctx.save();
    // 定身环（提示怪物被咬定住）
    const ringR = CELL * (0.35 + d.tier * 0.03);
    ctx.globalAlpha = fade * 0.5;
    ctx.strokeStyle = '#ffe9a0';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(bx, by, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // 冲锋阶段 drawErlangDog 播放奔跑+咬；之后切 latched 停在怪物位置
    if (elapsed < chargeDur) {
      const p = elapsed / chargeDur; // 0→1
      drawErlangDog(ctx, eyeX, eyeY, bx, by, d.ang, p, d.tier, fade, d.c, d.r, false);
    } else {
      drawErlangDog(ctx, bx, by, bx, by, d.ang, 1, d.tier, fade, d.c, d.r, true);
    }
    ctx.restore();
  }
}

function drawDamageFloats(ctx: CanvasRenderingContext2D, b: Battle) {
  if (!getSettings().showDamageNumbers) return;
  for (const d of b.damageFloats) {
    const { x, y: cy } = cellCenterPx(d.c, d.r);
    const px = x + d.x * CELL;
    const py = cy + d.y * CELL;
    const fallProgress = d.y >= d.peakY ? (d.y - d.peakY) / DAMAGE_FLOAT_FALL : 0;
    const alpha = 1 - Math.min(1, Math.max(0, fallProgress));
    const popT = Math.min(1, d.age / 0.1);
    const popScale = 1 + (1 - popT) * (d.crit ? 0.32 : d.wuxing === 'adv' ? 0.28 : 0.22);
    const text = d.crit ? `暴击! ${Math.round(d.amount)}` : `${d.wuxing === 'adv' ? '克 ' : ''}${Math.round(d.amount)}`;
    const basePx = d.crit ? 17 : d.wuxing === 'adv' ? 16 : 14;
    const fontPx = Math.round(basePx * popScale);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${fontPx}px "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.fillStyle = d.crit ? '#ff5a3c' : d.wuxing === 'adv' ? '#ffd84d' : d.wuxing === 'dis' ? '#9aa0a6' : '#fff8e8';
    ctx.strokeText(text, px, py);
    ctx.fillText(text, px, py);
    ctx.restore();
  }
}

// —— 暴击英雄 ——
// 哪吒火尖枪剪影：枪杆朝 tip 方向，尖端带火
function drawHuojianSpearGlyph(
  ctx: CanvasRenderingContext2D,
  tipX: number, tipY: number,
  ang: number,
  len: number,
  tier: number,
  alpha: number,
  trail = 0,
) {
  ctx.save();
  ctx.translate(tipX, tipY);
  ctx.rotate(ang);
  ctx.globalAlpha = alpha;
  // 火焰拖尾（沿枪身后侧）
  if (trail > 0.05) {
    const tg = ctx.createLinearGradient(-len * 0.15, 0, -len * (1.35 + trail * 1.1), 0);
    tg.addColorStop(0, `rgba(255,240,160,${0.95 * trail})`);
    tg.addColorStop(0.25, `rgba(255,160,50,${0.8 * trail})`);
    tg.addColorStop(0.6, `rgba(255,70,20,${0.45 * trail})`);
    tg.addColorStop(1, 'rgba(255,30,10,0)');
    ctx.fillStyle = tg;
    const tw = 3.2 + tier * 0.35;
    ctx.beginPath();
    ctx.moveTo(-len * 0.1, -tw);
    ctx.quadraticCurveTo(-len * (0.7 + trail * 0.3), -tw * 0.35, -len * (1.25 + trail), 0);
    ctx.quadraticCurveTo(-len * (0.7 + trail * 0.3), tw * 0.35, -len * 0.1, tw);
    ctx.closePath();
    ctx.fill();
    // 尾焰火星
    for (let k = 0; k < 3; k++) {
      const td = len * (0.55 + k * 0.28 + trail * 0.15);
      ctx.globalAlpha = alpha * trail * (0.55 - k * 0.12);
      ctx.fillStyle = k === 0 ? '#fff3a0' : '#ff9040';
      ctx.beginPath();
      ctx.arc(-td, (k - 1) * 1.8, 1.3 - k * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
  }
  // 枪杆
  ctx.strokeStyle = '#6a3a18';
  ctx.lineWidth = 2 + tier * 0.35;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-len, 0);
  ctx.lineTo(-6, 0);
  ctx.stroke();
  ctx.strokeStyle = '#c88840';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-len * 0.92, -0.8);
  ctx.lineTo(-8, -0.8);
  ctx.stroke();
  // 枪尾金属箍 + 金属镦
  const buttX = -len;
  const buttR = 2.1 + tier * 0.22;
  ctx.fillStyle = '#b8c0c8';
  ctx.strokeStyle = '#5a6270';
  ctx.lineWidth = 1;
  roundRect(ctx, buttX + 0.5, -1.7 - tier * 0.12, 5.2 + tier * 0.35, 3.4 + tier * 0.24, 1);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(buttX - 0.2, 0, buttR * 0.85, buttR, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.ellipse(buttX + 0.3, -0.55, 0.7, 1.0, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a929c';
  ctx.beginPath();
  ctx.arc(buttX - buttR * 0.55, 0, 0.9 + tier * 0.1, 0, Math.PI * 2);
  ctx.fill();
  // 枪头下红缨（衔接处下垂飘带）
  const hl = 7 + tier * 1.6;
  const tasselRoot = -hl * 0.12;
  ctx.fillStyle = '#9a2218';
  ctx.beginPath();
  ctx.arc(tasselRoot, 0, 1.35 + tier * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c8392b';
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const spread = (1.8 + i * 0.85 + tier * 0.2) * side;
    const back = 2.2 + i * 1.15;
    ctx.globalAlpha = alpha * (0.9 - i * 0.1);
    ctx.lineWidth = 1.55 - i * 0.12;
    ctx.beginPath();
    ctx.moveTo(tasselRoot, 0);
    ctx.quadraticCurveTo(tasselRoot - back * 0.35, spread * 0.55, tasselRoot - back, spread);
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;
  // 火尖
  ctx.fillStyle = '#ffe27a';
  ctx.strokeStyle = '#ff6a20';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(2, 0);
  ctx.lineTo(-hl * 0.45, -2.4 - tier * 0.3);
  ctx.lineTo(-hl, 0);
  ctx.lineTo(-hl * 0.45, 2.4 + tier * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 焰心
  ctx.fillStyle = 'rgba(255,120,40,0.9)';
  ctx.beginPath();
  ctx.arc(1, 0, 1.6 + tier * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 哪吒 火尖枪·万火齐发：满屏枪林弹雨——多波次、宽散落、震撼爆发
function drawUltNezha(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  // 全局可见度：中段最亮
  const life = Math.sin(Math.min(1, p / 0.92) * Math.PI);
  const vis = Math.max(fade, life * 0.88);

  // 枪数随阶数大幅增加：tier1=30, tier5=50
  const n = 28 + tier * 5;
  // 落点散布半径（px）：覆盖大半个棋盘，tier5 时超过视野
  const spreadR = R * (2.8 + tier * 0.35);
  const fallEnd = 0.7;

  // —— 第一段：英雄中心迸发强光 ——
  if (p < 0.2) {
    const fp = p / 0.2;
    const peak = Math.sin(Math.min(1, fp / 0.5) * Math.PI);
    const fr = CELL * (1.2 + tier * 0.18) * (0.4 + peak * 1.2);
    ctx.save();
    ctx.globalAlpha = vis * peak * 0.95;
    const fg = ctx.createRadialGradient(x, y, 1, x, y, fr);
    fg.addColorStop(0, 'rgba(255,255,245,0.98)');
    fg.addColorStop(0.25, 'rgba(255,210,100,0.8)');
    fg.addColorStop(0.6, 'rgba(255,90,20,0.35)');
    fg.addColorStop(1, 'rgba(255,40,10,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(x, y, fr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // —— 上空余烬云（满屏飘散） ——
  const emberN = 24 + tier * 5;
  for (let i = 0; i < emberN; i++) {
    const seed = (i * 17 + tier * 3) % 97;
    const delay = (seed % 13) * 0.012;
    const t = Math.max(0, Math.min(1, (p - delay) / 0.85));
    if (t <= 0) continue;
    const ox = ((seed % 23) - 11) * CELL * 0.18;
    const fall = easeIn(t);
    const ex = x + ox * (1 - fall * 0.55) + Math.sin(p * 5 + i * 1.7) * CELL * 0.06;
    const ey = y - CELL * (3.5 + (seed % 9) * 0.35) + fall * CELL * (3.8 + (seed % 5) * 0.4);
    ctx.globalAlpha = vis * (0.25 + (1 - fall) * 0.6) * Math.min(1, t * 3);
    ctx.fillStyle = i % 4 === 0 ? '#fff5b8' : i % 4 === 1 ? '#ffd060' : i % 4 === 2 ? '#ff8a30' : '#ff5010';
    const r = 1.3 + (seed % 3) * 0.55 + tier * 0.06;
    ctx.beginPath();
    ctx.arc(ex, ey, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // —— 枪林弹雨：多波次错落俯冲，散布满屏 ——
  for (let i = 0; i < n; i++) {
    const seed = (i * 37 + tier * 11) % 89;
    // 多波次延迟：让枪分 3 波倾泻，更有层次
    const wave = i % 3;
    const delay = wave * 0.08 + ((seed % 17) / 17) * 0.22;
    const local = Math.max(0, Math.min(1, (p - delay) / (fallEnd - delay * 0.15)));
    if (local <= 0) continue;
    const fall = easeIn(local);

    // 落点：以爆心为中心均匀散布到 spreadR，外加抖动
    const baseAng = (i / n) * Math.PI * 2 * 1.3 + seed * 0.21;
    const distFactor = 0.2 + (seed % 7) / 7 * 0.8; // 0.2~1.0
    const landDist = spreadR * distFactor * (0.7 + local * 0.3);
    const landC = x + Math.cos(baseAng) * landDist;
    const landR = y + Math.sin(baseAng) * landDist * 0.75; // 纵向略窄（棋盘纵横比）

    // 起点：上空偏高位置，横向随机偏移
    const startY = y - CELL * (3.2 + (seed % 9) * 0.3);
    const startX = x + (((seed % 19) - 9) / 9) * spreadR * 1.1;

    // 抛物线弧
    const crest = CELL * (1.8 + (seed % 6) * 0.4 + tier * 0.1);
    const arc = Math.sin(Math.min(1, local) * Math.PI) * crest;
    const sx = startX + (landC - startX) * fall;
    const sy = startY + (landR - startY) * fall - arc;

    // 枪尖朝向落点方向
    const dx = landC - sx, dy = landR - sy;
    const spearAng = Math.atan2(dy, dx);
    const trail = Math.sin(local * Math.PI) * 0.9;
    const len = CELL * (0.42 + tier * 0.035 + (seed % 3) * 0.025);
    const a = vis * (0.5 + local * 0.5) * (local < 0.92 ? 1 : Math.max(0, 1 - (local - 0.92) / 0.08));
    drawHuojianSpearGlyph(ctx, sx, sy, spearAng, len, tier, a, trail);
  }

  // —— 落地爆点：多点爆发，形成「万火焚原」 ——
  if (p > 0.3) {
    const bp = Math.min(1, (p - 0.3) / 0.55);
    const bloom = easeOut(bp);
    const peak = Math.sin(Math.min(1, bp / 0.6) * Math.PI);

    // 主爆心（原来的位置）
    const mainRad = CELL * (0.5 + tier * 0.13) * (0.6 + bloom * 1.3);
    ctx.globalAlpha = vis * (0.5 + peak * 0.6);
    const g0 = ctx.createRadialGradient(x, y, 1, x, y, mainRad);
    g0.addColorStop(0, 'rgba(255,252,220,0.98)');
    g0.addColorStop(0.2, 'rgba(255,190,70,0.88)');
    g0.addColorStop(0.5, 'rgba(255,90,25,0.5)');
    g0.addColorStop(1, 'rgba(255,30,10,0)');
    ctx.fillStyle = g0;
    ctx.beginPath(); ctx.arc(x, y, mainRad, 0, Math.PI * 2); ctx.fill();

    // 副爆点：沿散布圈多点小爆炸
    const subN = 5 + tier;
    for (let i = 0; i < subN; i++) {
      const seed = (i * 53 + tier * 7) % 71;
      const ang = (i / subN) * Math.PI * 2 + seed * 0.1;
      const sd = spreadR * (0.25 + (seed % 5) / 5 * 0.5) * (0.6 + bloom * 0.4);
      const sxp = x + Math.cos(ang) * sd;
      const syp = y + Math.sin(ang) * sd * 0.75;
      const subDelay = (seed % 5) * 0.04;
      const subP = Math.max(0, Math.min(1, bp - subDelay));
      if (subP <= 0) continue;
      const subPeak = Math.sin(Math.min(1, subP / 0.6) * Math.PI);
      const subRad = CELL * (0.18 + (seed % 3) * 0.06) * (0.5 + subPeak * 1.2);
      ctx.globalAlpha = vis * subPeak * (0.4 + (seed % 3) * 0.15);
      const sg = ctx.createRadialGradient(sxp, syp, 0.5, sxp, syp, subRad);
      sg.addColorStop(0, 'rgba(255,245,200,0.9)');
      sg.addColorStop(0.4, 'rgba(255,150,50,0.6)');
      sg.addColorStop(1, 'rgba(255,50,15,0)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(sxp, syp, subRad, 0, Math.PI * 2); ctx.fill();
    }

    // 冲击波环（主爆心向外扩张）
    if (p > 0.38) {
      const wp = Math.min(1, (p - 0.38) / 0.35);
      const wRad = mainRad * (0.6 + wp * 1.8);
      ctx.globalAlpha = vis * (1 - wp) * 0.7;
      ctx.strokeStyle = '#ffb050';
      ctx.lineWidth = 2.5 + tier * 0.3;
      ctx.beginPath(); ctx.arc(x, y, wRad, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,240,180,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, wRad * 0.75, 0, Math.PI * 2); ctx.stroke();
    }

    // 火星外溅（满屏飞散）
    const sparks = 22 + tier * 4;
    for (let i = 0; i < sparks; i++) {
      const a = (i / sparks) * Math.PI * 2 + bp * 2.2;
      const dist = spreadR * (0.15 + (i % 6) * 0.13) * bloom;
      const px = x + Math.cos(a) * dist;
      const py = y + Math.sin(a) * dist * 0.75 - bloom * CELL * 0.25;
      ctx.globalAlpha = vis * peak * (0.35 + (i % 3) * 0.25);
      ctx.fillStyle = i % 4 === 0 ? '#fff5b8' : i % 4 === 1 ? '#ffcc40' : '#ff7020';
      ctx.beginPath();
      ctx.arc(px, py, 1.6 + (i % 3) * 0.7 + bloom * 0.8, 0, Math.PI * 2);
      ctx.fill();
      if (i % 2 === 0) {
        ctx.strokeStyle = 'rgba(255,180,80,0.6)';
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * spreadR * 0.05, y + Math.sin(a) * spreadR * 0.05 * 0.75);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
    }
  }
}

/** 二郎天眼几何（普攻/大招共用：竖眼、同位置同大小；大招仅换配色） */
const ERLANG_EYE = {
  offsetY: 0.24, // 相对格心上移（CELL 倍率）
  rx: 0.13, // 竖眼半宽
  ry: 0.32, // 竖眼半高
  pupil: 0.1,
  highlight: 0.045,
} as const;

type ErlangEyePalette = {
  stroke: string;
  pupil: string;
  highlight: string;
  lineWidth: number;
};

const ERLANG_EYE_BASIC: ErlangEyePalette = {
  stroke: '#bfe9ff',
  pupil: '#3a6ea5',
  highlight: 'rgba(220,245,255,0.95)',
  lineWidth: 2.6,
};

const ERLANG_EYE_ULT: ErlangEyePalette = {
  stroke: '#ffe9a0',
  pupil: '#8a5a20',
  highlight: 'rgba(255,250,225,0.95)',
  lineWidth: 2.6,
};

function erlangEyePos(fromX: number, fromY: number): { x: number; y: number } {
  return { x: fromX, y: fromY - CELL * ERLANG_EYE.offsetY };
}

/** 竖天眼：普攻与大招同形，仅 palette 不同 */
function drawErlangSkyEye(
  ctx: CanvasRenderingContext2D,
  eyeX: number,
  eyeY: number,
  open: number,
  alpha: number,
  palette: ErlangEyePalette,
  tier = 1,
): void {
  const o = Math.max(0.08, open);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = palette.stroke;
  ctx.lineWidth = palette.lineWidth + tier * 0.3;
  ctx.beginPath();
  ctx.ellipse(eyeX, eyeY, CELL * ERLANG_EYE.rx * o, CELL * ERLANG_EYE.ry * Math.max(0.1, open), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = palette.pupil;
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, CELL * ERLANG_EYE.pupil * open, 0, Math.PI * 2);
  ctx.fill();
  if (open > 0.45) {
    ctx.fillStyle = palette.highlight;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, CELL * ERLANG_EYE.highlight * open, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 二郎天眼光束：自额心射向目标（普攻；天眼与大招同形，蓝系配色）
function drawErlangSkyEyeBeam(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number, toY: number,
  p: number, fade: number, tier: number,
  widthMul = 1,
) {
  const { x: eyeX, y: eyeY } = erlangEyePos(fromX, fromY);
  const dx = toX - eyeX;
  const dy = toY - eyeY;
  const dist = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);

  const open = easeOut(Math.min(1, p / 0.35));
  const beamReach = easeOut(Math.max(0, Math.min(1, (p - 0.12) / 0.55)));
  const reach = dist * beamReach;

  drawErlangSkyEye(ctx, eyeX, eyeY, open, fade, ERLANG_EYE_BASIC, tier);

  if (beamReach <= 0.01) return;

  const beamW = (5 + tier * 1.8) * widthMul * (0.45 + open * 0.55);
  const tipX = eyeX + Math.cos(ang) * reach;
  const tipY = eyeY + Math.sin(ang) * reach;

  ctx.save();
  ctx.translate(eyeX, eyeY);
  ctx.rotate(ang);
  ctx.globalAlpha = fade;
  // 普攻：断续的青白虚线（一节一节、不连贯），与大招的连贯光束区分开
  const dash = Math.max(5, beamW * 1.15);
  const gap = dash * 1.2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(150,216,255,0.85)';
  ctx.lineWidth = Math.max(1.6, beamW * 0.34);
  ctx.setLineDash([dash, gap]);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(reach, 0);
  ctx.stroke();
  // 更细的白色亮芯，虚线相位错开半格，强调「断开」质感
  ctx.strokeStyle = `rgba(255,255,255,${0.85 * fade})`;
  ctx.lineWidth = Math.max(1, beamW * 0.16);
  ctx.lineDashOffset = -dash * 0.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(reach, 0);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  if (beamReach > 0.65) {
    const bp = (beamReach - 0.65) / 0.35;
    const rad = CELL * (0.28 + tier * 0.08) * (0.55 + bp);
    ctx.globalAlpha = (1 - bp * 0.45) * fade;
    const g2 = ctx.createRadialGradient(tipX, tipY, 1, tipX, tipY, rad);
    g2.addColorStop(0, 'rgba(255,255,255,0.95)');
    g2.addColorStop(0.45, 'rgba(150,216,255,0.5)');
    g2.addColorStop(1, 'rgba(180,235,255,0)');
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(tipX, tipY, rad, 0, Math.PI * 2); ctx.fill();
  }
}

// 二郎 天眼诛邪：与普攻同形竖眼（金色）→ 金白粗光束 + 侧支闪电 → 诛邪符纹爆点
function drawUltErlang(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  p: number, fade: number, tier: number,
  fromC?: number, fromR?: number,
  biteC?: number, biteR?: number,
) {
  const life = Math.sin(Math.min(1, p / 0.92) * Math.PI);
  const vis = Math.max(fade, life * 0.85);
  const hasOrigin = fromC != null && fromR != null;
  const fromPx = hasOrigin ? cellCenterPx(fromC, fromR) : { x: x - CELL * 2.4, y };
  const { x: eyeX, y: eyeY } = erlangEyePos(fromPx.x, fromPx.y);
  const dx = x - eyeX;
  const dy = y - eyeY;
  const dist = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);

  const open = easeOut(Math.min(1, p / 0.3));
  const beamReach = easeOut(Math.max(0, Math.min(1, (p - 0.1) / 0.5)));
  const reach = dist * beamReach;

  // 金色灵光晕（开眼前奏）
  ctx.globalAlpha = vis * 0.5 * open;
  const haloR = CELL * (0.55 + tier * 0.05) * open;
  const halo = ctx.createRadialGradient(eyeX, eyeY, 1, eyeX, eyeY, haloR);
  halo.addColorStop(0, 'rgba(255,244,200,0.65)');
  halo.addColorStop(1, 'rgba(255,220,140,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, haloR, 0, Math.PI * 2);
  ctx.fill();

  drawErlangSkyEye(ctx, eyeX, eyeY, open, vis, ERLANG_EYE_ULT, tier);

  if (beamReach <= 0.01) return;

  // 大招保持连贯实心光束，并比普攻明显更粗（稍加粗一档）
  const beamW = (10 + tier * 2.6) * (0.5 + open * 0.5);
  const tipX = eyeX + Math.cos(ang) * reach;
  const tipY = eyeY + Math.sin(ang) * reach;

  ctx.save();
  ctx.translate(eyeX, eyeY);
  ctx.rotate(ang);
  ctx.globalAlpha = vis;
  const grad = ctx.createLinearGradient(0, 0, reach, 0);
  grad.addColorStop(0, 'rgba(255,250,225,0.98)');
  grad.addColorStop(0.18, 'rgba(255,225,140,0.9)');
  grad.addColorStop(0.55, 'rgba(190,225,255,0.7)');
  grad.addColorStop(1, 'rgba(180,235,255,0.1)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, -beamW * 0.3);
  ctx.lineTo(reach, -beamW * 0.6);
  ctx.lineTo(reach, beamW * 0.6);
  ctx.lineTo(0, beamW * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${0.8 * vis})`;
  ctx.fillRect(0, -beamW * 0.12, reach, beamW * 0.24);

  // 侧支闪电（普攻没有，专属于大招的贯穿气势）
  const forks = 3 + Math.min(2, tier);
  for (let i = 0; i < forks; i++) {
    const seed = (i * 37 + tier * 11) % 59;
    const t0 = 0.15 + (seed % 40) / 100;
    const fx0 = reach * t0;
    const dir = i % 2 === 0 ? 1 : -1;
    const flen = beamW * (1.6 + (seed % 3) * 0.5);
    ctx.globalAlpha = vis * 0.55 * (0.4 + open * 0.6);
    ctx.strokeStyle = 'rgba(255,240,190,0.85)';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fx0, dir * beamW * 0.3);
    ctx.lineTo(fx0 + flen * 0.4, dir * (beamW * 0.3 + flen * 0.5));
    ctx.lineTo(fx0 + flen * 0.7, dir * (beamW * 0.3 + flen * 0.3));
    ctx.stroke();
  }
  ctx.restore();

  // 冲锋撕咬由 erlangDogFx 跟随特效负责（drawHeroUlt），这里只画光束+天眼

  // 诛邪爆点 + 放射符纹（比普攻的柔光爆点更大更华丽）
  if (beamReach > 0.6) {
    const bp = (beamReach - 0.6) / 0.4;
    const rad = CELL * (0.4 + tier * 0.1) * (0.6 + bp);
    ctx.globalAlpha = (1 - bp * 0.4) * vis;
    const g2 = ctx.createRadialGradient(tipX, tipY, 1, tipX, tipY, rad);
    g2.addColorStop(0, 'rgba(255,250,225,0.98)');
    g2.addColorStop(0.4, 'rgba(255,210,130,0.6)');
    g2.addColorStop(1, 'rgba(180,235,255,0)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(tipX, tipY, rad, 0, Math.PI * 2);
    ctx.fill();

    const rays = 8 + tier;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + p * 2;
      const r0 = rad * 0.3;
      const r1 = rad * (0.9 + bp * 0.4);
      ctx.globalAlpha = (1 - bp * 0.5) * vis * 0.6;
      ctx.strokeStyle = '#ffe9a0';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tipX + Math.cos(a) * r0, tipY + Math.sin(a) * r0);
      ctx.lineTo(tipX + Math.cos(a) * r1, tipY + Math.sin(a) * r1);
      ctx.stroke();
    }
  }
}

// —— 输出群攻 ——
// 二郎神大招「哮天犬」：中段从 eye(施法者)沿光束冲向落点撕咬（被定身怪），带冲刺速度线与咬中爆点
function drawErlangDog(
  ctx: CanvasRenderingContext2D,
  eyeX: number, eyeY: number,
  tipX: number, tipY: number,
  ang: number,
  p: number, tier: number, vis: number,
  biteC?: number, biteR?: number,
  latched?: boolean, // true=咬住后定在怪物位置（3s 跟随），不冲锋
): void {
  // 咬点优先用被定身怪位置（castGeneralSkill 写入 biteTarget），否则回退光束落点
  const bx = biteC != null ? BOARD_X + biteC * CELL + CELL / 2 : tipX;
  const by = biteR != null ? BOARD_Y + biteR * CELL + CELL / 2 : tipY;
  const DOG_START = 0.2;
  const DOG_BITE = 0.5;
  const DOG_END = 0.78;

  let rx: number, ry: number, tp: number;
  if (latched) {
    // latched 模式：直接定在咬点，不冲锋
    rx = bx; ry = by; tp = 1;
  } else {
    if (p < DOG_START) return;
    tp = Math.max(0, Math.min(1, (p - DOG_START) / (DOG_END - DOG_START)));
    const ease = easeOut(tp);
    rx = eyeX + (bx - eyeX) * ease;
    ry = eyeY + (by - eyeY) * ease;
  }
  const biteT = !latched && tp >= (DOG_BITE - DOG_START) / (DOG_END - DOG_START);

  ctx.save();
  // 冲刺残影（沿移动反方向）— latched 模式不画残影
  if (!latched && tp < 0.96) {
    const trailLen = CELL * (0.5 + 0.5 * Math.sin(tp * Math.PI));
    const tx = rx - Math.cos(ang) * trailLen;
    const ty = ry - Math.sin(ang) * trailLen;
    ctx.globalAlpha = vis * 0.5 * Math.sin(tp * Math.PI);
    const tg = ctx.createLinearGradient(rx, ry, tx, ty);
    tg.addColorStop(0, 'rgba(255,235,150,0.85)');
    tg.addColorStop(1, 'rgba(255,170,40,0)');
    ctx.strokeStyle = tg;
    ctx.lineWidth = 3 + tier * 0.25;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }

  const size = CELL * (0.42 + tier * 0.035); // 哮天犬显示大小（×1）
  const spr = sprite('hero-ttg');
  // latched 模式 tp=1，不应触发冲锋末段淡出；非 latched 时 tp>0.94 渐隐
  ctx.globalAlpha = vis * (!latched && tp > 0.94 ? Math.max(0, 1 - (tp - 0.94) / 0.06) : 1);
  if (spr) {
    ctx.save();
    ctx.translate(rx, ry);
    // 朝左时水平翻转素材，避免旋转 ~180° 导致狗倒立
    if (Math.cos(ang) < 0) {
      ctx.scale(-1, 1);
      ctx.rotate(ang - Math.PI);
    } else {
      ctx.rotate(ang);
    }
    const s = (size * 2) / Math.max(spr.width, spr.height);
    ctx.drawImage(spr, (-spr.width * s) / 2, (-spr.height * s) / 2, spr.width * s, spr.height * s);
    ctx.restore();
  } else {
    // 无立绘兜底：金色三角冲锋剪影
    ctx.translate(rx, ry);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(255,220,120,0.92)';
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.6, -size * 0.5);
    ctx.lineTo(-size * 0.3, 0);
    ctx.lineTo(-size * 0.6, size * 0.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 咬中瞬间爆点 + 定身环
  if (biteT) {
    const bp = Math.min(1, (tp - (DOG_BITE - DOG_START) / (DOG_END - DOG_START)) / ((DOG_END - DOG_BITE) / (DOG_END - DOG_START)));
    const peak = Math.sin(Math.min(1, bp / 0.4) * Math.PI);
    const rad = CELL * (0.32 + tier * 0.03) * (0.7 + peak * 0.5);
    ctx.save();
    ctx.globalAlpha = vis * peak * 0.85;
    const g = ctx.createRadialGradient(tipX, tipY, 1, tipX, tipY, rad);
    g.addColorStop(0, 'rgba(255,255,220,0.95)');
    g.addColorStop(0.4, 'rgba(255,160,60,0.55)');
    g.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(tipX, tipY, rad, 0, Math.PI * 2);
    ctx.fill();
    // 定身环（青色减速/定身视觉）
    ctx.globalAlpha = vis * peak * 0.75;
    ctx.strokeStyle = 'rgba(140,225,255,0.9)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(tipX, tipY, rad * 1.1, rad * 0.75, ang, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// 悟空 金箍棒大范围横扫：从大圣飞出→目标处横扫→飞回缩小隐藏
// 大圣 七十二变·横扫：分身汇聚 + 多影扇形横扫 + 金光四散收束（区别于普攻单棍投掷回收）
function drawUltDasheng(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  p: number, fade: number,
  tier: number, R: number,
  fromC?: number, fromR?: number,
) {
  const OUT = 0.22;
  const SWEEP_END = 0.72;
  const hasOrigin = fromC != null && fromR != null;
  const fromPx = hasOrigin ? cellCenterPx(fromC, fromR) : null;

  // 分身临阵：多道金影从大圣散开合围而来，而非单棍直线平抛
  if (hasOrigin && fromPx && p < OUT) {
    const lp = p / OUT;
    const ease = easeOut(lp);
    const baseAng = Math.atan2(y - fromPx.y, x - fromPx.x);
    const dist = Math.hypot(x - fromPx.x, y - fromPx.y);
    const clones = 3 + Math.min(2, Math.floor(tier / 2));
    for (let i = 0; i < clones; i++) {
      const spread = (i - (clones - 1) / 2) * 0.42;
      const ang = baseAng + spread * (1 - ease * 0.7);
      const cx = fromPx.x + Math.cos(ang) * dist * ease;
      const cy = fromPx.y + Math.sin(ang) * dist * ease;
      const scale = 0.22 + 0.78 * ease;
      const layerFade = 1 - Math.abs(i - (clones - 1) / 2) / clones * 0.5;
      ctx.save();
      ctx.globalAlpha = fade * (0.3 + 0.6 * ease) * layerFade;
      ctx.strokeStyle = '#ffe27a';
      ctx.lineWidth = 2 * scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(fromPx.x, fromPx.y);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.translate(cx, cy);
      drawStaffSpinGlyph(ctx, ease * Math.PI * 5 + i * 1.3, CELL * (0.24 + tier * 0.05) * scale, tier, fade * layerFade, 0.6);
      ctx.restore();
    }
    return;
  }

  const sweepP = hasOrigin ? (p - OUT) / (SWEEP_END - OUT) : p;
  const sweep = easeOut(Math.max(0, Math.min(1, sweepP)));
  const a0 = -Math.PI * 0.9, a1 = a0 + Math.PI * 1.8 * sweep;
  // 扫掠半径随 rge 但封顶，避免 5 阶 + 金箍棒加射程时铺满屏
  const sweepRad = Math.min(R * 0.58, CELL * (1.55 + tier * 0.05));
  if (hasOrigin && fromPx && p <= SWEEP_END) {
    ctx.globalAlpha = fade;
    // 扇形扫掠底
    const grad = ctx.createRadialGradient(x, y, sweepRad * 0.2, x, y, sweepRad);
    grad.addColorStop(0, 'rgba(255,243,196,0.05)');
    grad.addColorStop(1, 'rgba(240,185,60,0.28)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, sweepRad, a0, a1); ctx.closePath(); ctx.fill();
    // 多影同挥：主棍 + 两道稍慢的分身残影，呼应「七十二变」
    const turns = 2.2 + Math.min(tier, 4) * 0.28;
    const eio = sweepP < 0.5 ? 2 * sweepP * sweepP : 1 - Math.pow(-2 * sweepP + 2, 2) / 2;
    const len = Math.min(CELL * (0.46 + tier * 0.1), sweepRad * 0.72);
    for (const lag of [0, 0.08, 0.16]) {
      const lagP = Math.max(0, sweepP - lag);
      const lagEio = lagP < 0.5 ? 2 * lagP * lagP : 1 - Math.pow(-2 * lagP + 2, 2) / 2;
      const spin = turns * Math.PI * 2 * lagEio;
      const blur = Math.pow(Math.sin(Math.PI * Math.max(0, Math.min(1, lagP))), 3) * (1 - tier * 0.04);
      ctx.save();
      ctx.translate(x, y);
      drawStaffSpinGlyph(ctx, spin, len * (lag === 0 ? 1 : 0.88), tier, fade * (lag === 0 ? 1 : 0.4), blur);
      ctx.restore();
    }
    // 扫掠前缘指示线
    ctx.globalAlpha = fade;
    ctx.strokeStyle = '#e8a11c'; ctx.lineWidth = 4 + tier;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a1) * sweepRad, y + Math.sin(a1) * sweepRad); ctx.stroke();
    // 横扫段仍显示一根从大圣连到爆心的淡金线，强化来源感
    ctx.save();
    ctx.globalAlpha = fade * 0.25;
    ctx.strokeStyle = '#ffe27a';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(fromPx.x, fromPx.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }
  if (!hasOrigin) {
    // 无来源坐标（预览等场景）：退化为原地扇形横扫
    ctx.globalAlpha = fade;
    const grad = ctx.createRadialGradient(x, y, sweepRad * 0.2, x, y, sweepRad);
    grad.addColorStop(0, 'rgba(255,243,196,0.05)');
    grad.addColorStop(1, 'rgba(240,185,60,0.28)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, sweepRad, a0, a1); ctx.closePath(); ctx.fill();
    const turns = 2.2 + Math.min(tier, 4) * 0.28;
    const eio = sweep < 0.5 ? 2 * sweep * sweep : 1 - Math.pow(-2 * sweep + 2, 2) / 2;
    const spin = turns * Math.PI * 2 * eio;
    const blur = Math.pow(Math.sin(Math.PI * sweep), 3) * (1 - tier * 0.04);
    const len = Math.min(CELL * (0.46 + tier * 0.1), sweepRad * 0.72);
    ctx.save();
    ctx.translate(x, y);
    drawStaffSpinGlyph(ctx, spin, len, tier, fade, blur);
    ctx.restore();
    return;
  }
  if (!fromPx) return;

  // 收势：金光化作满天分身四散炸开，再化作光点收回大圣，而非单棍直线缩小飞回
  const lp = Math.max(0, Math.min(1, (p - SWEEP_END) / (1 - SWEEP_END)));
  const scatter = easeOut(Math.min(1, lp / 0.5));
  const gather = easeIn(Math.max(0, (lp - 0.5) / 0.5));
  const motes = 8 + tier * 2;
  for (let i = 0; i < motes; i++) {
    const a = (i / motes) * Math.PI * 2 + i * 0.7;
    const outR = sweepRad * (0.15 + (i % 3) * 0.12) * scatter;
    const ox = x + Math.cos(a) * outR;
    const oy = y + Math.sin(a) * outR;
    const px = ox + (fromPx.x - ox) * gather;
    const py = oy + (fromPx.y - oy) * gather;
    const moteAlpha = fade * (1 - gather) * (0.5 + (i % 3) * 0.2);
    ctx.globalAlpha = moteAlpha;
    ctx.fillStyle = i % 2 === 0 ? '#fff3c0' : '#ffcf5a';
    ctx.beginPath();
    ctx.arc(px, py, 2 + (i % 3) * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // 中心残留一点收束的金光
  ctx.globalAlpha = fade * (1 - gather) * 0.6;
  const coreG = ctx.createRadialGradient(x, y, 1, x, y, sweepRad * 0.22);
  coreG.addColorStop(0, 'rgba(255,245,200,0.85)');
  coreG.addColorStop(1, 'rgba(240,185,60,0)');
  ctx.fillStyle = coreG;
  ctx.beginPath();
  ctx.arc(x, y, sweepRad * 0.22, 0, Math.PI * 2);
  ctx.fill();
}

// 红孩 三昧真火扩散火花花瓣
/** 单簇火舌（尖端上扬、根部宽） */
function drawFlameTongue(
  ctx: CanvasRenderingContext2D,
  h: number,
  w: number,
  alpha: number,
  outer: string,
  mid: string,
  core: string,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  // 外焰
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.moveTo(-w * 0.55, h * 0.15);
  ctx.quadraticCurveTo(-w * 0.85, -h * 0.25, -w * 0.2, -h * 0.75);
  ctx.quadraticCurveTo(0, -h * 1.05, w * 0.15, -h * 0.7);
  ctx.quadraticCurveTo(w * 0.75, -h * 0.2, w * 0.5, h * 0.15);
  ctx.quadraticCurveTo(0, h * 0.35, -w * 0.55, h * 0.15);
  ctx.closePath();
  ctx.fill();
  // 中焰
  ctx.fillStyle = mid;
  ctx.beginPath();
  ctx.moveTo(-w * 0.28, h * 0.08);
  ctx.quadraticCurveTo(-w * 0.4, -h * 0.2, -w * 0.08, -h * 0.55);
  ctx.quadraticCurveTo(0, -h * 0.78, w * 0.1, -h * 0.5);
  ctx.quadraticCurveTo(w * 0.38, -h * 0.15, w * 0.25, h * 0.08);
  ctx.quadraticCurveTo(0, h * 0.2, -w * 0.28, h * 0.08);
  ctx.closePath();
  ctx.fill();
  // 芯焰
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.moveTo(-w * 0.12, h * 0.02);
  ctx.quadraticCurveTo(-w * 0.1, -h * 0.25, 0, -h * 0.48);
  ctx.quadraticCurveTo(w * 0.12, -h * 0.2, w * 0.1, h * 0.02);
  ctx.quadraticCurveTo(0, h * 0.1, -w * 0.12, h * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 红孩 三昧真火：地涌火柱 + 环绕火舌 + 火星上窜
/** 红孩三昧真火：天火重砸落地 → 冲击爆闪 → 外溅火花 */
function drawUltHonghaier(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.95) * Math.PI);
  const vis = Math.max(fade, life * 0.88);
  // 0~0.38 下落；0.38~0.55 砸地；0.55~1 外溅
  const fall = easeIn(Math.min(1, p / 0.38));
  const impact = easeOut(Math.max(0, Math.min(1, (p - 0.38) / 0.17)));
  const splash = easeOut(Math.max(0, Math.min(1, (p - 0.52) / 0.45)));
  const skyY = y - R * 1.55 - CELL * 0.8;
  const fireY = skyY + (y - skyY) * fall;
  const inAir = p < 0.4;

  // 下落拖尾
  if (inAir || impact < 0.6) {
    const trailH = (y - skyY) * fall * 0.85;
    const trailG = ctx.createLinearGradient(x, fireY - trailH, x, fireY);
    trailG.addColorStop(0, 'rgba(255,80,20,0)');
    trailG.addColorStop(0.45, 'rgba(255,120,30,0.35)');
    trailG.addColorStop(1, 'rgba(255,220,120,0.75)');
    ctx.globalAlpha = vis * (inAir ? 0.85 : 1 - impact);
    ctx.fillStyle = trailG;
    ctx.beginPath();
    ctx.moveTo(x - CELL * 0.12, fireY);
    ctx.lineTo(x - CELL * 0.06, fireY - trailH);
    ctx.lineTo(x + CELL * 0.06, fireY - trailH);
    ctx.lineTo(x + CELL * 0.12, fireY);
    ctx.closePath();
    ctx.fill();
  }

  // 天火本体（从天重砸：下落中变大变亮，砸地瞬间略压扁）
  if (fall < 1 || impact < 0.85) {
    const scale = 0.7 + fall * 0.85 + impact * 0.2;
    const squash = 1 + impact * 0.55;
    const fw = CELL * (0.34 + tier * 0.035) * scale * squash;
    const fh = CELL * (0.72 + tier * 0.05) * scale / Math.sqrt(squash);
    ctx.save();
    ctx.translate(x, fireY);
    ctx.rotate(Math.sin(p * 10) * 0.08 * (1 - impact));
    drawFlameTongue(
      ctx,
      fh,
      fw,
      vis * (0.8 + fall * 0.2),
      'rgba(200,35,10,0.92)',
      'rgba(255,110,25,0.95)',
      'rgba(255,240,150,0.98)',
    );
    // 外包火晕
    const halo = ctx.createRadialGradient(0, -fh * 0.2, 1, 0, -fh * 0.2, fh * 0.9);
    halo.addColorStop(0, 'rgba(255,200,80,0.45)');
    halo.addColorStop(1, 'rgba(255,60,10,0)');
    ctx.globalAlpha = vis * 0.7;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, -fh * 0.15, fh * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 砸地冲击
  if (impact > 0) {
    ctx.globalAlpha = vis * (1 - impact * 0.35) * 0.9;
    const flash = ctx.createRadialGradient(x, y, 1, x, y, R * (0.35 + impact * 0.55));
    flash.addColorStop(0, 'rgba(255,245,200,0.95)');
    flash.addColorStop(0.35, 'rgba(255,140,40,0.55)');
    flash.addColorStop(1, 'rgba(180,30,0,0)');
    ctx.fillStyle = flash;
    ctx.beginPath();
    ctx.arc(x, y, R * (0.35 + impact * 0.55), 0, Math.PI * 2);
    ctx.fill();

    // 地面灼痕椭圆
    ctx.globalAlpha = vis * impact * 0.7;
    const scorch = ctx.createRadialGradient(x, y + CELL * 0.08, 1, x, y + CELL * 0.08, R * 0.75 * impact);
    scorch.addColorStop(0, 'rgba(255,180,60,0.65)');
    scorch.addColorStop(0.5, 'rgba(220,60,15,0.35)');
    scorch.addColorStop(1, 'rgba(120,20,0,0)');
    ctx.fillStyle = scorch;
    ctx.beginPath();
    ctx.ellipse(x, y + CELL * 0.1, R * 0.78 * impact, R * 0.3 * impact, 0, 0, Math.PI * 2);
    ctx.fill();

    // 冲击环
    for (let k = 0; k < 3; k++) {
      const pk = Math.max(0, Math.min(1, impact - k * 0.12));
      if (pk <= 0) continue;
      ctx.globalAlpha = vis * (1 - pk) * 0.75;
      ctx.strokeStyle = k === 0 ? 'rgba(255,220,120,0.95)' : 'rgba(255,100,30,0.55)';
      ctx.lineWidth = 4 - k * 0.9 + tier * 0.15;
      ctx.beginPath();
      ctx.arc(x, y, easeOut(pk) * R * (0.55 + k * 0.15), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 外溅火花 + 火舌
  if (splash > 0) {
    const tongues = 8 + tier;
    for (let i = 0; i < tongues; i++) {
      const a = (i / tongues) * Math.PI * 2 + p * 0.6;
      const d = R * splash * (0.4 + (i % 3) * 0.18);
      const tx = x + Math.cos(a) * d;
      const ty = y + Math.sin(a) * d * 0.65;
      const th = CELL * (0.22 + (i % 3) * 0.06 + tier * 0.015) * (0.55 + splash * 0.55);
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(a - Math.PI / 2 + Math.sin(p * 8 + i) * 0.15);
      drawFlameTongue(
        ctx,
        th,
        th * 0.36,
        vis * (0.4 + splash * 0.45) * (1 - splash * 0.25),
        'rgba(220,45,12,0.88)',
        'rgba(255,130,30,0.92)',
        'rgba(255,230,120,0.95)',
      );
      ctx.restore();
    }

    const sparks = 22 + tier * 4;
    for (let i = 0; i < sparks; i++) {
      const seed = (i * 17 + tier * 3) % 89;
      const a = (i / sparks) * Math.PI * 2 + seed * 0.02;
      const t = Math.min(1, splash * (0.7 + (seed % 5) * 0.08));
      const dist = R * t * (0.55 + (seed % 7) * 0.06);
      const sx = x + Math.cos(a) * dist;
      const sy = y + Math.sin(a) * dist * 0.75 - t * CELL * 0.25;
      ctx.globalAlpha = vis * (1 - t * 0.7) * 0.9;
      ctx.fillStyle = i % 3 === 0 ? '#fff3a0' : i % 3 === 1 ? '#ffb040' : '#ff5a18';
      ctx.beginPath();
      ctx.arc(sx, sy, 1.3 + (seed % 3) * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// 红袍 赤焰：改为与红孩儿一致——天火从天而降砸地溅射（不再地面旋转地火）。范围随 R 自动更小（过渡武将）。
function drawUltHongpao(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number): void {
  drawUltHonghaier(ctx, x, y, p, fade, tier, R);
}

// —— 控制群攻 ——
// 八戒 九齿钉耙·举耙下砸震地：耙头从上方砸落 → 落地闪光 → 同心裂纹冲击波
function drawUltBajie(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  // 耙头（扇形九齿）+ 木柄：全程可见，前段举高下砸，落地后钉在冲击波中心
  const slamP = Math.min(1, p / 0.4);
  const drop = easeIn(slamP);
  const rakeSize = R * (0.46 + tier * 0.03);
  const headY = y - R * 0.85 * (1 - drop);
  ctx.save();
  ctx.translate(x, headY);
  ctx.rotate((1 - drop) * 0.18); // 举起时略斜，砸下瞬间摆正
  ctx.globalAlpha = fade * (0.55 + drop * 0.45);
  const barY = -rakeSize * 0.55; // 横梁位置（耙头顶部）
  const barHalfW = rakeSize * 0.5;
  // 木柄：从上方一路接到横梁中点，不留断点
  ctx.strokeStyle = '#6a4a26';
  ctx.lineWidth = 4.5 + tier * 0.6;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -rakeSize * 1.9); ctx.lineTo(0, barY); ctx.stroke();
  // 耙头横梁：一条实木横杠（微弧，两端略上翘）
  ctx.strokeStyle = '#8a6a3a';
  ctx.lineWidth = 5 + tier * 0.6;
  ctx.beginPath();
  ctx.moveTo(-barHalfW, barY + rakeSize * 0.05);
  ctx.quadraticCurveTo(0, barY - rakeSize * 0.05, barHalfW, barY + rakeSize * 0.05);
  ctx.stroke();
  // 九齿：并排直齿，均垂直于横梁向下扎（钉耙的核心识别特征）
  const teeth = 7 + Math.min(4, tier);
  const tineLen = rakeSize * 0.95;
  ctx.strokeStyle = '#f0d99a';
  ctx.lineWidth = 2.3 + tier * 0.3;
  ctx.lineCap = 'round';
  for (let t = 0; t < teeth; t++) {
    const tx0 = -barHalfW + (barHalfW * 2) * (t + 0.5) / teeth;
    const by = barY + rakeSize * 0.05 * (1 - Math.pow((tx0 / barHalfW), 2)); // 贴合横梁弧度
    ctx.beginPath();
    ctx.moveTo(tx0, by);
    ctx.lineTo(tx0, by + tineLen);
    ctx.stroke();
  }
  // 齿尖高光点
  ctx.fillStyle = '#fff6d8';
  for (let t = 0; t < teeth; t++) {
    const tx0 = -barHalfW + (barHalfW * 2) * (t + 0.5) / teeth;
    const by = barY + rakeSize * 0.05 * (1 - Math.pow((tx0 / barHalfW), 2)) + tineLen;
    ctx.beginPath(); ctx.arc(tx0, by, 1.4 + tier * 0.15, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // 落地闪光：砸中瞬间的一次性亮爆
  if (slamP > 0.75) {
    const flash = 1 - (slamP - 0.75) / 0.25;
    ctx.globalAlpha = fade * flash * 0.8;
    const g = ctx.createRadialGradient(x, y, 1, x, y, rakeSize * 0.9);
    g.addColorStop(0, 'rgba(255,238,180,0.9)');
    g.addColorStop(1, 'rgba(255,211,77,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rakeSize * 0.9, 0, Math.PI * 2); ctx.fill();
  }
  // 冲击波同心圈
  ctx.globalAlpha = fade;
  for (let k = 0; k < 3; k++) {
    const pk = Math.max(0, Math.min(1, p - 0.35 - k * 0.15));
    const rad = easeOut(pk) * R * 0.9;
    ctx.strokeStyle = k === 0 ? '#ffd34d' : 'rgba(255,211,77,0.55)';
    ctx.lineWidth = 5 - k * 1.2;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
  }
  // 地裂纹
  const cracks = 6 + tier;
  ctx.strokeStyle = 'rgba(120,80,30,0.6)'; ctx.lineWidth = 2;
  for (let i = 0; i < cracks; i++) {
    const a = (i / cracks) * Math.PI * 2;
    const rr = easeOut(Math.max(0, p - 0.35)) * R * 0.7;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); ctx.stroke();
  }
}

/** 芭蕉扇剪影：扇柄 + 宽叶扇面 */
/** 芭蕉扇完整剪影：长柄 + 宽叶扇面（柄在下、叶向上展开，避免只剩半截） */
function drawBajiaoFanGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  tier: number,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 扇柄（加长到底，带柄首金环）
  ctx.strokeStyle = '#5a3a18';
  ctx.lineWidth = 2.8 + tier * 0.3;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.72);
  ctx.lineTo(0, size * 0.02);
  ctx.stroke();
  ctx.strokeStyle = '#d2b06a';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-1.2, size * 0.65);
  ctx.lineTo(-1.2, size * 0.08);
  ctx.stroke();
  // 柄首金箍
  ctx.fillStyle = 'rgba(230,190,90,0.9)';
  ctx.strokeStyle = 'rgba(120,80,30,0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, size * 0.08, size * 0.09, size * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, size * 0.68, size * 0.07, size * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();

  // 扇面：完整宽芭蕉叶（从柄顶铺满到叶尖）
  ctx.fillStyle = 'rgba(70,160,95,0.92)';
  ctx.strokeStyle = '#245a32';
  ctx.lineWidth = 1.7 + tier * 0.15;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.06);
  // 右叶缘外扩再收尖
  ctx.bezierCurveTo(size * 0.95, -size * 0.05, size * 0.9, -size * 0.55, size * 0.42, -size * 1.05);
  ctx.quadraticCurveTo(0, -size * 1.28, -size * 0.42, -size * 1.05);
  // 左叶缘对称
  ctx.bezierCurveTo(-size * 0.9, -size * 0.55, -size * 0.95, -size * 0.05, 0, size * 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 中脉
  ctx.strokeStyle = 'rgba(35,90,50,0.85)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.02);
  ctx.quadraticCurveTo(0, -size * 0.45, 0, -size * 1.12);
  ctx.stroke();
  // 侧脉（更密，叶面更完整）
  ctx.strokeStyle = 'rgba(40,100,55,0.7)';
  ctx.lineWidth = 1.15;
  for (const side of [-1, 1] as const) {
    for (const t of [0.18, 0.34, 0.5, 0.66, 0.82] as const) {
      const y0 = size * 0.02 - size * 1.1 * t;
      const reach = size * (0.38 + t * 0.22);
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.quadraticCurveTo(side * reach * 0.45, y0 - size * 0.08, side * reach, y0 - size * 0.16);
      ctx.stroke();
    }
  }
  // 叶缘高光（左右各一道，避免只剩一边）
  ctx.strokeStyle = 'rgba(190,245,200,0.55)';
  ctx.lineWidth = 1.2;
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(side * size * 0.12, -size * 0.02);
    ctx.bezierCurveTo(
      side * size * 0.7, -size * 0.2,
      side * size * 0.55, -size * 0.7,
      side * size * 0.22, -size * 1.05,
    );
    ctx.stroke();
  }
  // 叶尖亮点
  ctx.fillStyle = 'rgba(220,255,210,0.75)';
  ctx.beginPath();
  ctx.arc(0, -size * 1.14, 2.2 + tier * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 铁扇 芭蕉扇·狂风：宽幅风带螺旋 + 巨扇挥扫 + 地面尘浪击退（去掉亮圈/扇形填充）
function drawUltTieshan(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.92) * Math.PI);
  const vis = Math.max(fade, life * 0.85);
  const bloom = easeOut(Math.min(1, p / 0.55));
  const spin = p * Math.PI * 3.2;
  const RR = R * (1.05 + tier * 0.03);

  // 地面尘浪（压扁的椭圆，随大招铺开，给出重量感）
  ctx.globalAlpha = vis * 0.35 * bloom;
  const groundG = ctx.createRadialGradient(x, y + RR * 0.12, 1, x, y + RR * 0.12, RR * (0.5 + bloom * 0.5));
  groundG.addColorStop(0, 'rgba(180,150,90,0.5)');
  groundG.addColorStop(0.6, 'rgba(140,190,110,0.28)');
  groundG.addColorStop(1, 'rgba(120,180,100,0)');
  ctx.fillStyle = groundG;
  ctx.beginPath();
  ctx.ellipse(x, y + RR * 0.12, RR * (0.55 + bloom * 0.5), RR * (0.22 + bloom * 0.2), 0, 0, Math.PI * 2);
  ctx.fill();

  // 狂风螺旋带：填充式宽带，比细线更有质量感
  const arms = 4;
  for (let arm = 0; arm < arms; arm++) {
    const steps = 14;
    const pts: { x: number; y: number; w: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const rad = bloom * RR * (0.15 + t * 0.9);
      const a = arm * ((Math.PI * 2) / arms) + spin * (0.55 + t * 0.45) + t * 2.4;
      pts.push({ x: x + Math.cos(a) * rad, y: y + Math.sin(a) * rad, w: (3.2 + tier * 0.35) * (0.4 + t * 0.8) });
    }
    ctx.globalAlpha = vis * 0.55;
    ctx.fillStyle = arm % 2 === 0 ? 'rgba(190,255,225,0.55)' : 'rgba(110,195,155,0.45)';
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const nx = i < pts.length - 1 ? pts[i + 1].x - pts[i].x : pts[i].x - pts[i - 1].x;
      const ny = i < pts.length - 1 ? pts[i + 1].y - pts[i].y : pts[i].y - pts[i - 1].y;
      const nl = Math.hypot(nx, ny) || 1;
      const px = -ny / nl * pts[i].w;
      const py = nx / nl * pts[i].w;
      if (i === 0) ctx.moveTo(pts[i].x + px, pts[i].y + py);
      else ctx.lineTo(pts[i].x + px, pts[i].y + py);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const nx = i < pts.length - 1 ? pts[i + 1].x - pts[i].x : pts[i].x - pts[i - 1].x;
      const ny = i < pts.length - 1 ? pts[i + 1].y - pts[i].y : pts[i].y - pts[i - 1].y;
      const nl = Math.hypot(nx, ny) || 1;
      const px = -ny / nl * pts[i].w;
      const py = nx / nl * pts[i].w;
      ctx.lineTo(pts[i].x - px, pts[i].y - py);
    }
    ctx.closePath();
    ctx.fill();
  }

  // 飞叶碎屑（更多更大，沿涡外甩）
  const leaves = 14 + tier * 2;
  for (let i = 0; i < leaves; i++) {
    const t = (i / leaves);
    const rad = bloom * RR * (0.28 + t * 0.8);
    const a = spin * 1.1 + t * 4.5 + i * 0.7;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a + 0.6);
    ctx.globalAlpha = vis * (0.45 + (1 - t) * 0.45);
    ctx.fillStyle = i % 3 === 0 ? 'rgba(200,170,100,0.85)' : (i % 2 === 0 ? 'rgba(150,225,170,0.9)' : 'rgba(80,160,100,0.85)');
    ctx.beginPath();
    ctx.ellipse(0, 0, 6 + tier * 0.5 + (i % 3), 2.6 + (i % 2), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 中心巨扇挥扫（放大 + 残影，确保整扇可见）
  const fanSize = CELL * (0.85 + tier * 0.08) * (0.85 + bloom * 0.35);
  const swing = -1.15 + bloom * 2.35 + Math.sin(p * Math.PI * 2) * 0.12;
  // 扇身残影（挥扫轨迹）
  for (let g = 2; g >= 1; g--) {
    const ghostSwing = swing - g * 0.35 * bloom;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ghostSwing);
    drawBajiaoFanGlyph(ctx, fanSize * (1 - g * 0.06), tier, vis * bloom * (0.22 - g * 0.05));
    ctx.restore();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(swing);
  drawBajiaoFanGlyph(ctx, fanSize, tier, vis * (0.75 + bloom * 0.25));
  ctx.restore();

  // 击退气流条（外圈，更长更亮，卖出击退力度）
  if (bloom > 0.35) {
    const gustN = 10 + tier;
    for (let i = 0; i < gustN; i++) {
      const a = (i / gustN) * Math.PI * 2 + p * 2;
      const r0 = RR * (0.46 + bloom * 0.16);
      const r1 = RR * (0.78 + bloom * 0.32);
      ctx.globalAlpha = vis * 0.5 * bloom;
      ctx.strokeStyle = '#c8ffe0';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      ctx.stroke();
    }
  }
}

// —— 击退群攻 ——
// 沙僧大佛珠单颗：骨色珠 + 骷髅面（圆顶脑颅 + 收窄下颌，而非正圆）
function drawShasengBead(ctx: CanvasRenderingContext2D, bx: number, by: number, r: number, fade: number) {
  ctx.save();
  ctx.translate(bx, by);
  ctx.globalAlpha = fade;
  ctx.fillStyle = '#e8dcc8';
  ctx.strokeStyle = '#6a5038';
  ctx.lineWidth = 1.3;
  // 头骨轮廓：圆顶颅骨（上 2/3）收窄到下颌（下 1/3），下颌中央留浅凹（颌缝）
  ctx.beginPath();
  ctx.moveTo(-r * 0.78, -r * 0.06);
  ctx.quadraticCurveTo(-r * 0.86, -r * 0.78, 0, -r * 0.96);
  ctx.quadraticCurveTo(r * 0.86, -r * 0.78, r * 0.78, -r * 0.06);
  ctx.quadraticCurveTo(r * 0.72, r * 0.34, r * 0.34, r * 0.56);
  ctx.quadraticCurveTo(r * 0.16, r * 0.7, 0, r * 0.68);
  ctx.quadraticCurveTo(-r * 0.16, r * 0.7, -r * 0.34, r * 0.56);
  ctx.quadraticCurveTo(-r * 0.72, r * 0.34, -r * 0.78, -r * 0.06);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // 颧骨浅凹（两侧太阳穴，增加立体感）
  ctx.fillStyle = 'rgba(90,70,48,0.22)';
  ctx.beginPath(); ctx.ellipse(-r * 0.62, -r * 0.28, r * 0.14, r * 0.22, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(r * 0.62, -r * 0.28, r * 0.14, r * 0.22, 0.3, 0, Math.PI * 2); ctx.fill();
  // 眼窝（倒泪滴形，更像骷髅眼洞）
  ctx.fillStyle = '#2e261c';
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(side * r * 0.1, -r * 0.16);
    ctx.quadraticCurveTo(side * r * 0.4, -r * 0.3, side * r * 0.4, -r * 0.06);
    ctx.quadraticCurveTo(side * r * 0.38, r * 0.14, side * r * 0.2, r * 0.1);
    ctx.quadraticCurveTo(side * r * 0.08, r * 0.02, side * r * 0.1, -r * 0.16);
    ctx.closePath();
    ctx.fill();
  }
  // 鼻孔（倒心形凹口）
  ctx.beginPath();
  ctx.moveTo(0, r * 0.06);
  ctx.lineTo(-r * 0.12, r * 0.3);
  ctx.quadraticCurveTo(0, r * 0.38, r * 0.12, r * 0.3);
  ctx.closePath();
  ctx.fill();
  // 下颌牙缝：几条竖线切出牙齿
  ctx.strokeStyle = 'rgba(60,45,30,0.75)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-r * 0.3, r * 0.42); ctx.lineTo(r * 0.3, r * 0.42); ctx.stroke();
  for (let i = -2; i <= 2; i++) {
    const tx = i * r * 0.12;
    ctx.beginPath(); ctx.moveTo(tx, r * 0.42); ctx.lineTo(tx * 0.82, r * 0.6); ctx.stroke();
  }
  ctx.restore();
}

// 沙僧 大佛珠甩击：念珠环旋扩 + 珠粒外甩击退拖影
function drawUltShaseng(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const expand = easeOut(p);
  const rad = R * (0.18 + expand * 0.72);
  const n = 9; // 九颗骷髅佛珠
  const spin = p * Math.PI * 2.4;
  const beadR = CELL * (0.12 + tier * 0.018);

  // 串绳环
  ctx.globalAlpha = fade * 0.65;
  ctx.strokeStyle = 'rgba(90,70,48,0.7)';
  ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();

  // 内层淡金扫痕（旋甩感）
  ctx.globalAlpha = fade * 0.35;
  ctx.strokeStyle = 'rgba(220,190,130,0.55)';
  ctx.lineWidth = 5 + tier;
  ctx.beginPath();
  ctx.arc(x, y, rad * 0.92, spin, spin + Math.PI * 1.1);
  ctx.stroke();

  for (let i = 0; i < n; i++) {
    const a = spin + (i / n) * Math.PI * 2;
    const bx = x + Math.cos(a) * rad;
    const by = y + Math.sin(a) * rad;
    // 外甩拖影（击退方向）
    const trail = CELL * (0.2 + expand * 0.35);
    ctx.globalAlpha = fade * 0.4;
    ctx.strokeStyle = 'rgba(230,210,175,0.55)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx - Math.cos(a) * trail, by - Math.sin(a) * trail);
    ctx.lineTo(bx, by);
    ctx.stroke();
    drawShasengBead(ctx, bx, by, beadR * (i % 3 === 0 ? 1.15 : 1), fade);
  }

  // 中心绳结
  ctx.globalAlpha = fade;
  ctx.fillStyle = '#5a4030';
  ctx.beginPath(); ctx.arc(x, y, 3 + tier * 0.4, 0, Math.PI * 2); ctx.fill();
}

// 牛魔冲撞前端：朝冲撞方向的牛头剪影（角 + 楔形脸 + 尖鼻吻）
function drawBullHeadGlyph(ctx: CanvasRenderingContext2D, hx: number, hy: number, size: number, fade: number) {
  ctx.save();
  ctx.translate(hx, hy);
  ctx.globalAlpha = fade;
  const s = size;

  // 双角（外撇上弯，根部更宽）
  const drawHorn = (side: 1 | -1) => {
    ctx.beginPath();
    ctx.moveTo(side * s * 0.22, -s * 0.08);
    ctx.lineTo(side * s * 0.62, -s * 0.72);
    ctx.lineTo(side * s * 0.88, -s * 1.08);
    ctx.lineTo(side * s * 0.52, -s * 0.42);
    ctx.closePath();
    ctx.fillStyle = '#f0e6d0';
    ctx.strokeStyle = '#6a5030';
    ctx.lineWidth = 1.4;
    ctx.fill();
    ctx.stroke();
  };
  drawHorn(-1);
  drawHorn(1);

  // 头颅：楔形（上宽下尖，比圆额更像牛头）
  ctx.fillStyle = '#8a6a3a';
  ctx.strokeStyle = '#5a4020';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, s * 0.48);              // 鼻吻尖端
  ctx.lineTo(-s * 0.5, s * 0.08);       // 左颌
  ctx.lineTo(-s * 0.46, -s * 0.28);     // 左额
  ctx.lineTo(0, -s * 0.36);             // 额顶
  ctx.lineTo(s * 0.46, -s * 0.28);      // 右额
  ctx.lineTo(s * 0.5, s * 0.08);        // 右颌
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 耳（小三角）
  for (const side of [-1, 1] as const) {
    ctx.fillStyle = '#7a5a32';
    ctx.beginPath();
    ctx.moveTo(side * s * 0.44, -s * 0.02);
    ctx.lineTo(side * s * 0.58, s * 0.08);
    ctx.lineTo(side * s * 0.38, s * 0.12);
    ctx.closePath();
    ctx.fill();
  }

  // 鼻吻（三角尖）
  ctx.fillStyle = '#6a5030';
  ctx.beginPath();
  ctx.moveTo(0, s * 0.52);
  ctx.lineTo(-s * 0.16, s * 0.28);
  ctx.lineTo(s * 0.16, s * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3a2810';
  ctx.beginPath();
  ctx.moveTo(-s * 0.09, s * 0.34);
  ctx.lineTo(-s * 0.04, s * 0.26);
  ctx.lineTo(-s * 0.14, s * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(s * 0.09, s * 0.34);
  ctx.lineTo(s * 0.04, s * 0.26);
  ctx.lineTo(s * 0.14, s * 0.28);
  ctx.closePath();
  ctx.fill();

  // 眼（怒黄，略上挑）
  ctx.fillStyle = '#ffcc44';
  ctx.beginPath();
  ctx.moveTo(-s * 0.26, -s * 0.1);
  ctx.lineTo(-s * 0.14, -s * 0.02);
  ctx.lineTo(-s * 0.24, s * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(s * 0.26, -s * 0.1);
  ctx.lineTo(s * 0.14, -s * 0.02);
  ctx.lineTo(s * 0.24, s * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2a1810';
  ctx.beginPath(); ctx.arc(-s * 0.2, -s * 0.04, s * 0.035, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(s * 0.2, -s * 0.04, s * 0.035, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

// 牛魔 蛮牛冲撞：宽幅冲撞走廊 + 尘土拖尾 + 牛头冲击落地
function drawUltNiumowang(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  p: number, fade: number, tier: number, R: number,
  fromC?: number, fromR?: number,
) {
  const life = Math.sin(Math.min(1, p / 0.92) * Math.PI);
  const vis = Math.max(fade, life * 0.85);
  const hasOrigin = fromC != null && fromR != null;
  const fromPx = hasOrigin
    ? cellCenterPx(fromC, fromR)
    : { x, y: y + R * 0.85 };
  const dx = x - fromPx.x;
  const dy = y - fromPx.y;
  const dist = Math.max(R * 0.9, Math.hypot(dx, dy) || 1);
  const ang = Math.atan2(dy, dx);
  const dirX = Math.cos(ang);
  const dirY = Math.sin(ang);
  const perpX = -dirY;
  const perpY = dirX;
  const charge = easeOut(Math.min(1, p / 0.55));
  const hx = fromPx.x + dirX * dist * charge;
  const hy = fromPx.y + dirY * dist * charge;
  const corridorW = CELL * (0.52 + tier * 0.07);

  // 冲撞走廊（渐变宽带，告别细线）
  ctx.save();
  ctx.translate(fromPx.x, fromPx.y);
  ctx.rotate(ang);
  const reach = dist * charge;
  const body = ctx.createLinearGradient(0, 0, reach, 0);
  body.addColorStop(0, 'rgba(120,80,40,0)');
  body.addColorStop(0.2, `rgba(160,110,55,${0.55 * vis})`);
  body.addColorStop(0.65, `rgba(200,150,85,${0.75 * vis})`);
  body.addColorStop(1, `rgba(255,210,130,${0.45 * vis})`);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -corridorW * 0.4);
  ctx.lineTo(reach, -corridorW * 1.05);
  ctx.lineTo(reach, corridorW * 1.05);
  ctx.lineTo(0, corridorW * 0.4);
  ctx.closePath();
  ctx.fill();
  // 走廊描边增加分量
  ctx.globalAlpha = vis * 0.55;
  ctx.strokeStyle = 'rgba(90,55,25,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // 走廊中轴高光
  ctx.globalAlpha = vis * 0.75;
  ctx.strokeStyle = '#ffe2a0';
  ctx.lineWidth = 4.5 + tier * 0.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(reach * 0.06, 0);
  ctx.lineTo(reach, 0);
  ctx.stroke();
  ctx.globalAlpha = vis * 0.5;
  ctx.strokeStyle = '#fff8e0';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(reach * 0.15, 0);
  ctx.lineTo(reach * 0.95, 0);
  ctx.stroke();
  ctx.restore();

  // 多层尘土拖尾（密度随阶）
  const streakN = 14 + tier * 3;
  for (let i = 0; i < streakN; i++) {
    const fi = ((i * 17 + tier * 7) % 97) / 97;
    const fj = ((i * 29 + 13) % 89) / 89;
    const along = Math.max(0, charge - fi * 0.45);
    const lateral = (fj - 0.5) * corridorW * (1.1 + fi * 0.6);
    const sx = fromPx.x + dirX * dist * along + perpX * lateral;
    const sy = fromPx.y + dirY * dist * along + perpY * lateral;
    const streakLen = CELL * (0.22 + fi * 0.55) * charge;
    const wave = Math.sin(i * 1.7 + p * 8) * CELL * 0.04;
    ctx.globalAlpha = vis * (0.4 + fi * 0.5) * (1 - i / streakN * 0.15);
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(240,220,175,0.95)' : 'rgba(150,105,55,0.85)';
    ctx.lineWidth = 1.6 + fi * 2.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx + perpX * wave, sy + perpY * wave);
    ctx.lineTo(
      sx + dirX * streakLen + perpX * wave * 0.3,
      sy + dirY * streakLen + perpY * wave * 0.3,
    );
    ctx.stroke();
  }

  // 扬尘团（冲锋两侧）
  const dustN = 8 + tier * 2;
  for (let i = 0; i < dustN; i++) {
    const t = (i / dustN) * charge;
    const side = i % 2 === 0 ? 1 : -1;
    const px = fromPx.x + dirX * dist * t + perpX * side * corridorW * (0.55 + (i % 3) * 0.18);
    const py = fromPx.y + dirY * dist * t + perpY * side * corridorW * (0.55 + (i % 3) * 0.18);
    const dr = 3 + tier * 0.4 + (i % 3);
    ctx.globalAlpha = vis * (0.35 + (1 - t) * 0.35);
    const dg = ctx.createRadialGradient(px, py, 1, px, py, dr * 2.2);
    dg.addColorStop(0, 'rgba(210,180,130,0.7)');
    dg.addColorStop(1, 'rgba(160,120,70,0)');
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.arc(px, py, dr * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 双角撕扯残影（前锋两侧）
  if (charge > 0.2) {
    ctx.globalAlpha = vis * 0.45 * charge;
    ctx.strokeStyle = '#f0e0b8';
    ctx.lineWidth = 2.2 + tier * 0.3;
    ctx.lineCap = 'round';
    for (const side of [-1, 1] as const) {
      const ox = hx + perpX * side * CELL * 0.22;
      const oy = hy + perpY * side * CELL * 0.22;
      ctx.beginPath();
      ctx.moveTo(ox - dirX * CELL * 0.35, oy - dirY * CELL * 0.35);
      ctx.quadraticCurveTo(
        ox + perpX * side * CELL * 0.12,
        oy + perpY * side * CELL * 0.12,
        ox + dirX * CELL * 0.2,
        oy + dirY * CELL * 0.2,
      );
      ctx.stroke();
    }
  }

  // 牛头前锋（更大更醒目）
  const headSize = CELL * (0.4 + tier * 0.05) * (0.75 + charge * 0.45);
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(ang + Math.PI / 2);
  // 牛头前光晕
  ctx.globalAlpha = vis * 0.55 * charge;
  const hg = ctx.createRadialGradient(0, 0, 1, 0, 0, headSize * 1.6);
  hg.addColorStop(0, 'rgba(255,220,150,0.7)');
  hg.addColorStop(1, 'rgba(180,120,50,0)');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(0, 0, headSize * 1.6, 0, Math.PI * 2);
  ctx.fill();
  drawBullHeadGlyph(ctx, 0, 0, headSize, Math.min(1, vis * 1.15));
  ctx.restore();

  // 落地冲击：尘爆环 + 地裂
  if (p > 0.45) {
    const bp = Math.min(1, (p - 0.45) / 0.55);
    const bloom = easeOut(bp);
    const peak = Math.sin(Math.min(1, bp / 0.65) * Math.PI);
    const rad = R * (0.35 + tier * 0.04) * (0.45 + bloom * 0.85);
    ctx.globalAlpha = vis * (0.5 + peak * 0.5);
    const ig = ctx.createRadialGradient(x, y, 1, x, y, rad);
    ig.addColorStop(0, 'rgba(255,230,180,0.9)');
    ig.addColorStop(0.4, 'rgba(190,140,80,0.5)');
    ig.addColorStop(1, 'rgba(120,80,40,0)');
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = vis * peak * 0.85;
    ctx.strokeStyle = '#d4a86a';
    ctx.lineWidth = 3 + tier * 0.4;
    ctx.beginPath();
    ctx.arc(x, y, rad * (0.7 + bloom * 0.25), 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(230,200,140,0.7)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, rad * (0.45 + bloom * 0.15), 0, Math.PI * 2);
    ctx.stroke();

    const cracks = 6 + tier;
    for (let i = 0; i < cracks; i++) {
      const a = (i / cracks) * Math.PI * 2 + bp * 0.4;
      const len = rad * (0.55 + (i % 3) * 0.2) * bloom;
      ctx.globalAlpha = vis * peak * 0.55;
      ctx.strokeStyle = 'rgba(100,70,35,0.75)';
      ctx.lineWidth = 1.6 + tier * 0.15;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * rad * 0.12, y + Math.sin(a) * rad * 0.12);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }

    // 飞溅碎石
    const rocks = 8 + tier;
    for (let i = 0; i < rocks; i++) {
      const a = (i / rocks) * Math.PI * 2 + bp;
      const d = rad * (0.6 + (i % 3) * 0.18) * bloom;
      ctx.globalAlpha = vis * peak * (0.45 + (i % 2) * 0.3);
      ctx.fillStyle = i % 2 === 0 ? '#c4a878' : '#8a6a40';
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d - bloom * 4, 1.8 + (i % 3) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// —— 辅助/过渡 ——
// 观音 甘露·净瓶：起手金环 → 净瓶倾倒 → 莲台绽放 → 甘露雨幕 + 圣光环（明显强于梵音浅润）
function drawUltGuanyin(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.95) * Math.PI);
  const vis = Math.max(fade, life * 0.88);
  const rise = easeOut(Math.min(1, p / 0.28));
  const bloom = easeOut(Math.min(1, p / 0.5));
  const pour = easeOut(Math.max(0, Math.min(1, (p - 0.18) / 0.45)));
  const rain = easeOut(Math.max(0, Math.min(1, (p - 0.28) / 0.55)));
  const RR = R * (1.02 + tier * 0.02);

  // 地面圣光椭圆
  ctx.globalAlpha = vis * 0.55 * bloom;
  const ground = ctx.createRadialGradient(x, y + CELL * 0.1, 2, x, y + CELL * 0.1, RR * 0.85 * bloom);
  ground.addColorStop(0, 'rgba(255,245,200,0.55)');
  ground.addColorStop(0.45, 'rgba(170,220,255,0.28)');
  ground.addColorStop(1, 'rgba(120,180,255,0)');
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.ellipse(x, y + CELL * 0.1, RR * 0.82 * bloom, RR * 0.32 * bloom, 0, 0, Math.PI * 2);
  ctx.fill();

  // 起手金白冲击环
  const snap = easeOut(Math.min(1, p / 0.2));
  if (snap < 1) {
    ctx.globalAlpha = vis * (1 - snap) * 0.85;
    ctx.strokeStyle = 'rgba(255,240,180,0.95)';
    ctx.lineWidth = 4.5 + tier * 0.4;
    ctx.beginPath();
    ctx.arc(x, y, snap * RR * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 外扩圣光环（多层）
  for (let k = 0; k < 3; k++) {
    const pk = Math.max(0, Math.min(1, bloom - k * 0.12));
    if (pk <= 0) continue;
    const rad = easeOut(pk) * RR * (0.42 + k * 0.28);
    ctx.globalAlpha = vis * (0.65 - k * 0.15);
    ctx.strokeStyle = k === 0 ? 'rgba(255,240,190,0.95)' : k === 1 ? 'rgba(180,220,255,0.7)' : 'rgba(140,200,255,0.45)';
    ctx.lineWidth = 3.6 - k * 0.7 + tier * 0.15;
    ctx.setLineDash(k === 1 ? [6, 5] : []);
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 莲台（六瓣）
  const lotusR = CELL * (0.38 + tier * 0.02) * (0.55 + bloom * 0.55);
  const lotusY = y + CELL * 0.05;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + p * 0.15;
    ctx.save();
    ctx.translate(x, lotusY);
    ctx.rotate(a);
    ctx.globalAlpha = vis * (0.45 + bloom * 0.4);
    const petal = ctx.createLinearGradient(0, 0, 0, -lotusR);
    petal.addColorStop(0, 'rgba(255,230,200,0.9)');
    petal.addColorStop(0.55, 'rgba(220,180,255,0.55)');
    petal.addColorStop(1, 'rgba(160,200,255,0)');
    ctx.fillStyle = petal;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(lotusR * 0.38, -lotusR * 0.35, 0, -lotusR);
    ctx.quadraticCurveTo(-lotusR * 0.38, -lotusR * 0.35, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // 莲心
  ctx.globalAlpha = vis * 0.85 * bloom;
  const heart = ctx.createRadialGradient(x, lotusY, 1, x, lotusY, lotusR * 0.35);
  heart.addColorStop(0, 'rgba(255,250,220,0.95)');
  heart.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = heart;
  ctx.beginPath();
  ctx.arc(x, lotusY, lotusR * 0.32, 0, Math.PI * 2);
  ctx.fill();

  // 净瓶（倾斜倾倒）
  const bottleY = y - CELL * (0.55 + rise * 0.35);
  const tilt = -0.55 + pour * 0.95;
  ctx.save();
  ctx.translate(x + Math.sin(tilt) * CELL * 0.08, bottleY);
  ctx.rotate(tilt);
  const bw = CELL * (0.16 + tier * 0.012) * (0.75 + rise * 0.35);
  const bh = CELL * (0.32 + tier * 0.02) * (0.75 + rise * 0.35);
  // 瓶身
  ctx.globalAlpha = vis * (0.6 + rise * 0.35);
  const bodyG = ctx.createLinearGradient(-bw, 0, bw, 0);
  bodyG.addColorStop(0, 'rgba(140,190,230,0.75)');
  bodyG.addColorStop(0.5, 'rgba(220,245,255,0.95)');
  bodyG.addColorStop(1, 'rgba(150,200,240,0.75)');
  ctx.fillStyle = bodyG;
  ctx.strokeStyle = 'rgba(255,236,180,0.9)';
  ctx.lineWidth = 1.6 + tier * 0.15;
  ctx.beginPath();
  ctx.moveTo(-bw * 0.32, -bh * 1.15);
  ctx.lineTo(bw * 0.32, -bh * 1.15);
  ctx.lineTo(bw * 0.48, -bh * 0.85);
  ctx.quadraticCurveTo(bw * 0.9, -bh * 0.15, bw * 0.5, bh * 0.55);
  ctx.quadraticCurveTo(0, bh * 0.85, -bw * 0.5, bh * 0.55);
  ctx.quadraticCurveTo(-bw * 0.9, -bh * 0.15, -bw * 0.48, -bh * 0.85);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 瓶颈
  ctx.fillStyle = 'rgba(255,230,160,0.9)';
  ctx.fillRect(-bw * 0.22, -bh * 1.35, bw * 0.44, bh * 0.22);
  ctx.strokeRect(-bw * 0.22, -bh * 1.35, bw * 0.44, bh * 0.22);
  // 瓶口流光
  if (pour > 0.05) {
    ctx.globalAlpha = vis * pour * 0.9;
    const stream = ctx.createLinearGradient(0, -bh * 1.15, bw * 0.9, bh * 0.2);
    stream.addColorStop(0, 'rgba(255,250,220,0.95)');
    stream.addColorStop(0.45, 'rgba(180,230,255,0.75)');
    stream.addColorStop(1, 'rgba(140,200,255,0)');
    ctx.strokeStyle = stream;
    ctx.lineWidth = 3.2 + tier * 0.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -bh * 1.05);
    ctx.quadraticCurveTo(bw * 0.55, -bh * 0.2, bw * 0.85, bh * 0.55);
    ctx.stroke();
  }
  ctx.restore();

  // 甘露雨幕（多列下落）
  const drops = 16 + tier * 3;
  for (let i = 0; i < drops; i++) {
    const seed = (i * 19 + tier * 5) % 97;
    const a = (i / drops) * Math.PI * 2 + seed * 0.01;
    const spread = RR * rain * (0.2 + (seed % 5) * 0.14);
    const dx = x + Math.cos(a) * spread;
    const fall = ((p * 1.85 + i * 0.11) % 1);
    const dy = y - CELL * (0.85 + bloom * 0.2) + fall * CELL * (1.55 + bloom * 0.45);
    const sz = 2.1 + (seed % 4) * 0.55 + tier * 0.12;
    ctx.globalAlpha = vis * rain * (0.45 + (1 - fall) * 0.5);
    // 水滴拖尾
    const trail = ctx.createLinearGradient(dx, dy - sz * 2.2, dx, dy + sz);
    trail.addColorStop(0, 'rgba(200,235,255,0)');
    trail.addColorStop(0.55, i % 2 === 0 ? 'rgba(191,230,255,0.85)' : 'rgba(255,245,210,0.75)');
    trail.addColorStop(1, 'rgba(230,248,255,0.95)');
    ctx.fillStyle = trail;
    ctx.beginPath();
    ctx.ellipse(dx, dy, sz * 0.55, sz * 1.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 落地涟漪
  if (rain > 0.25) {
    for (let k = 0; k < 4; k++) {
      const pk = Math.max(0, Math.min(1, rain - 0.15 - k * 0.12));
      if (pk <= 0) continue;
      ctx.globalAlpha = vis * (1 - pk) * 0.55;
      ctx.strokeStyle = k % 2 === 0 ? 'rgba(200,235,255,0.85)' : 'rgba(255,235,180,0.65)';
      ctx.lineWidth = 2.2 - k * 0.3;
      ctx.beginPath();
      ctx.ellipse(x, y + CELL * 0.12, easeOut(pk) * RR * (0.35 + k * 0.12), easeOut(pk) * RR * (0.14 + k * 0.04), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 光粒子上浮（续命感）
  const motes = 10 + tier * 2;
  for (let i = 0; i < motes; i++) {
    const t = ((p * 0.9 + i * 0.09) % 1);
    const a = (i / motes) * Math.PI * 2 + p * 0.8;
    const rad = RR * (0.2 + (i % 3) * 0.12) * bloom;
    const mx = x + Math.cos(a) * rad;
    const my = y + CELL * 0.15 - t * CELL * (0.9 + bloom * 0.4);
    ctx.globalAlpha = vis * (1 - t) * 0.85 * bloom;
    ctx.fillStyle = i % 2 === 0 ? '#fff6c8' : '#c8e8ff';
    ctx.beginPath();
    ctx.arc(mx, my, 1.4 + (i % 3) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 老君：八卦炉升起 → 太极环转 → 金丹外溅 + 地火冲击（暖金） */
function drawUltLaojun(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.95) * Math.PI);
  const vis = Math.max(fade, life * 0.85);
  const rise = easeOut(Math.min(1, p / 0.35));
  const bloom = easeOut(Math.max(0, Math.min(1, (p - 0.15) / 0.45)));
  const burst = easeOut(Math.max(0, Math.min(1, (p - 0.4) / 0.45)));

  // 地面热浪底光
  const ground = ctx.createRadialGradient(x, y + CELL * 0.15, 2, x, y + CELL * 0.15, R * 0.85 * bloom);
  ground.addColorStop(0, 'rgba(255,160,40,0.35)');
  ground.addColorStop(0.55, 'rgba(255,100,20,0.12)');
  ground.addColorStop(1, 'rgba(180,60,0,0)');
  ctx.globalAlpha = vis * 0.9;
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.ellipse(x, y + CELL * 0.12, R * 0.75 * bloom, R * 0.28 * bloom, 0, 0, Math.PI * 2);
  ctx.fill();

  // 八卦炉剪影（鼎身 + 三足 + 双耳）
  const furnaceY = y - CELL * 0.15 * rise;
  const fw = CELL * (0.38 + tier * 0.02) * (0.75 + rise * 0.25);
  const fh = CELL * (0.42 + tier * 0.02) * rise;
  ctx.globalAlpha = vis * (0.55 + rise * 0.35);
  ctx.fillStyle = 'rgba(90,55,30,0.85)';
  ctx.strokeStyle = 'rgba(255,210,120,0.85)';
  ctx.lineWidth = 1.6 + tier * 0.15;
  // 鼎腹
  ctx.beginPath();
  ctx.moveTo(x - fw * 0.55, furnaceY - fh * 0.15);
  ctx.quadraticCurveTo(x - fw * 0.7, furnaceY + fh * 0.35, x - fw * 0.35, furnaceY + fh * 0.55);
  ctx.lineTo(x + fw * 0.35, furnaceY + fh * 0.55);
  ctx.quadraticCurveTo(x + fw * 0.7, furnaceY + fh * 0.35, x + fw * 0.55, furnaceY - fh * 0.15);
  ctx.quadraticCurveTo(x, furnaceY - fh * 0.55, x - fw * 0.55, furnaceY - fh * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 双耳
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(x + side * fw * 0.58, furnaceY - fh * 0.05, fw * 0.14, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 三足
  for (let i = 0; i < 3; i++) {
    const ox = (i - 1) * fw * 0.28;
    ctx.beginPath();
    ctx.moveTo(x + ox, furnaceY + fh * 0.52);
    ctx.lineTo(x + ox * 1.15, furnaceY + fh * 0.85);
    ctx.stroke();
  }
  // 炉内金焰
  const flameH = fh * (0.55 + Math.sin(p * Math.PI * 4) * 0.08) * rise;
  const flame = ctx.createLinearGradient(x, furnaceY + fh * 0.2, x, furnaceY - flameH);
  flame.addColorStop(0, 'rgba(255,120,30,0.2)');
  flame.addColorStop(0.4, 'rgba(255,180,50,0.75)');
  flame.addColorStop(1, 'rgba(255,245,200,0.95)');
  ctx.globalAlpha = vis * rise;
  ctx.fillStyle = flame;
  ctx.beginPath();
  ctx.moveTo(x - fw * 0.22, furnaceY + fh * 0.15);
  ctx.quadraticCurveTo(x - fw * 0.18, furnaceY - flameH * 0.4, x, furnaceY - flameH);
  ctx.quadraticCurveTo(x + fw * 0.18, furnaceY - flameH * 0.4, x + fw * 0.22, furnaceY + fh * 0.15);
  ctx.closePath();
  ctx.fill();

  // 太极环（阴阳点 + 八卦刻度）
  const taijiR = R * (0.42 + tier * 0.02) * bloom;
  ctx.save();
  ctx.translate(x, furnaceY - fh * 0.1);
  ctx.rotate(p * Math.PI * 1.6);
  ctx.globalAlpha = vis * bloom * 0.9;
  ctx.strokeStyle = 'rgba(255,220,100,0.9)';
  ctx.lineWidth = 2.2 + tier * 0.2;
  ctx.beginPath();
  ctx.arc(0, 0, taijiR, 0, Math.PI * 2);
  ctx.stroke();
  // 阴阳双鱼简笔
  ctx.fillStyle = 'rgba(255,235,160,0.75)';
  ctx.beginPath();
  ctx.arc(0, -taijiR * 0.28, taijiR * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(80,40,10,0.65)';
  ctx.beginPath();
  ctx.arc(0, taijiR * 0.28, taijiR * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(80,40,10,0.8)';
  ctx.beginPath();
  ctx.arc(0, -taijiR * 0.28, taijiR * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,235,160,0.9)';
  ctx.beginPath();
  ctx.arc(0, taijiR * 0.28, taijiR * 0.08, 0, Math.PI * 2);
  ctx.fill();
  // 八卦刻度
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const solid = i % 2 === 0;
    ctx.strokeStyle = solid ? 'rgba(255,200,80,0.95)' : 'rgba(255,160,40,0.7)';
    ctx.lineWidth = solid ? 2.4 : 1.4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (taijiR + 3), Math.sin(a) * (taijiR + 3));
    ctx.lineTo(Math.cos(a) * (taijiR + 10 + tier), Math.sin(a) * (taijiR + 10 + tier));
    ctx.stroke();
  }
  ctx.restore();

  // 冲击波
  for (let k = 0; k < 3; k++) {
    const pk = Math.max(0, Math.min(1, burst - k * 0.12));
    if (pk <= 0) continue;
    const rad = easeOut(pk) * R * (0.7 + k * 0.12);
    ctx.globalAlpha = vis * (1 - pk) * 0.7;
    ctx.strokeStyle = k === 0 ? 'rgba(255,210,90,0.9)' : 'rgba(255,150,40,0.5)';
    ctx.lineWidth = 3.5 - k * 0.8;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 金丹：先环绕再外溅
  const pills = 8 + tier * 2;
  for (let i = 0; i < pills; i++) {
    const spin = (i / pills) * Math.PI * 2 + p * 2.4;
    const orbit = R * (0.22 + (i % 3) * 0.06) * bloom;
    const fly = R * (0.35 + (i % 4) * 0.12) * burst;
    const dist = orbit * (1 - burst * 0.35) + fly;
    const dx = x + Math.cos(spin) * dist;
    const dy = y + Math.sin(spin) * dist - CELL * 0.12 * Math.sin(p * Math.PI + i);
    const pr = 2.2 + (i % 3) * 0.7 + tier * 0.15;
    const glow = ctx.createRadialGradient(dx, dy, 0.5, dx, dy, pr * 2.8);
    glow.addColorStop(0, 'rgba(255,245,200,0.95)');
    glow.addColorStop(0.5, 'rgba(255,180,60,0.55)');
    glow.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.globalAlpha = vis * (0.55 + (i % 2) * 0.25);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(dx, dy, pr * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = i % 2 === 0 ? '#ffe08a' : '#ffb040';
    ctx.beginPath();
    ctx.arc(dx, dy, pr, 0, Math.PI * 2);
    ctx.fill();
  }

  // 火星粒子上扬
  const sparks = 10 + tier * 2;
  for (let i = 0; i < sparks; i++) {
    const t = ((p * 1.8 + i * 0.11) % 1);
    const a = (i / sparks) * Math.PI * 2 + p;
    const sx = x + Math.cos(a) * R * 0.2 * bloom * (0.4 + (i % 3) * 0.2);
    const sy = y - t * CELL * (1.1 + bloom * 0.5) + Math.sin(a * 3) * 4;
    ctx.globalAlpha = vis * (1 - t) * 0.75;
    ctx.fillStyle = i % 2 === 0 ? '#ffe6a0' : '#ff9a40';
    ctx.beginPath();
    ctx.arc(sx, sy, 1.4 + (i % 3) * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 丹君：轻量炼丹（过渡，弱于老君） */
function drawUltDanjun(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.92) * Math.PI);
  const vis = Math.max(fade, life * 0.75);
  const bloom = easeOut(Math.min(1, p / 0.5));
  const burst = easeOut(Math.max(0, Math.min(1, (p - 0.35) / 0.5)));

  const core = ctx.createRadialGradient(x, y, 1, x, y, CELL * 0.55 * bloom);
  core.addColorStop(0, 'rgba(255,230,160,0.9)');
  core.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.globalAlpha = vis;
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, CELL * 0.55 * bloom, 0, Math.PI * 2);
  ctx.fill();

  // 小炉口
  ctx.globalAlpha = vis * 0.7;
  ctx.strokeStyle = 'rgba(255,200,90,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y + CELL * 0.05, CELL * 0.22 * bloom, CELL * 0.1 * bloom, 0, 0, Math.PI * 2);
  ctx.stroke();

  for (let k = 0; k < 2; k++) {
    const pk = Math.max(0, Math.min(1, burst - k * 0.15));
    if (pk <= 0) continue;
    ctx.globalAlpha = vis * (1 - pk) * 0.65;
    ctx.strokeStyle = 'rgba(255,180,70,0.7)';
    ctx.lineWidth = 2 - k * 0.4;
    ctx.beginPath();
    ctx.arc(x, y, R * (0.45 + k * 0.12) * easeOut(pk), 0, Math.PI * 2);
    ctx.stroke();
  }

  const n = 5 + tier;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + p * 1.6;
    const d = R * (0.25 + burst * 0.35) * bloom;
    const dx = x + Math.cos(a) * d;
    const dy = y + Math.sin(a) * d;
    ctx.globalAlpha = vis * 0.8;
    ctx.fillStyle = '#ffd070';
    ctx.beginPath();
    ctx.arc(dx, dy, 2.4 + (i % 2), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 文殊：青莲层层展开 → 慧剑环斩 → 光尘外散（青金/莲紫） */
function drawUltWenshu(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.95) * Math.PI);
  const vis = Math.max(fade, life * 0.85);
  const bloom = easeOut(Math.min(1, p / 0.4));
  const slash = easeOut(Math.max(0, Math.min(1, (p - 0.2) / 0.45)));
  const settle = easeOut(Math.max(0, Math.min(1, (p - 0.45) / 0.5)));

  // 莲心光核
  const coreR = CELL * (0.2 + tier * 0.015) * (0.7 + bloom * 0.4);
  const g = ctx.createRadialGradient(x, y, 1, x, y, coreR * 2.8);
  g.addColorStop(0, 'rgba(245,250,255,0.95)');
  g.addColorStop(0.35, 'rgba(170,210,255,0.55)');
  g.addColorStop(0.7, 'rgba(160,120,220,0.25)');
  g.addColorStop(1, 'rgba(100,60,180,0)');
  ctx.globalAlpha = vis;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, coreR * 2.8, 0, Math.PI * 2);
  ctx.fill();

  // 双层莲瓣（内外反向旋转）
  for (let layer = 0; layer < 2; layer++) {
    const petals = (layer === 0 ? 8 : 6) + Math.min(3, tier);
    const layerBloom = easeOut(Math.max(0, Math.min(1, (p - layer * 0.08) / 0.42)));
    const spin = p * (layer === 0 ? 0.9 : -1.2);
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 + spin;
      const len = R * (layer === 0 ? 0.42 : 0.62) * layerBloom;
      const px = x + Math.cos(a) * len * 0.62;
      const py = y + Math.sin(a) * len * 0.62;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      ctx.globalAlpha = vis * (0.35 + layerBloom * 0.45) * (layer === 0 ? 1 : 0.85);
      ctx.fillStyle = (i + layer) % 2 === 0 ? 'rgba(190,215,255,0.8)' : 'rgba(210,175,255,0.72)';
      ctx.strokeStyle = 'rgba(230,240,255,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, CELL * (0.2 + layer * 0.04), CELL * (0.09 + layer * 0.02), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // 慧剑：三道弧斩
  for (let s = 0; s < 3; s++) {
    const sp = Math.max(0, Math.min(1, slash - s * 0.1));
    if (sp <= 0) continue;
    const start = -Math.PI * 0.85 + s * 0.35 + p * 0.4;
    const sweep = Math.PI * 1.55 * easeOut(sp);
    const rad = R * (0.55 + s * 0.1) * (0.7 + bloom * 0.35);
    ctx.globalAlpha = vis * (1 - sp * 0.35) * (0.75 - s * 0.12);
    ctx.strokeStyle = s === 1 ? 'rgba(200,230,255,0.95)' : 'rgba(180,160,255,0.7)';
    ctx.lineWidth = 3.2 - s * 0.6 + tier * 0.15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, rad, start, start + sweep);
    ctx.stroke();
    // 剑尖闪光
    const tipA = start + sweep;
    const tipX = x + Math.cos(tipA) * rad;
    const tipY = y + Math.sin(tipA) * rad;
    const tipG = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, CELL * 0.22);
    tipG.addColorStop(0, 'rgba(255,255,255,0.9)');
    tipG.addColorStop(1, 'rgba(160,200,255,0)');
    ctx.fillStyle = tipG;
    ctx.beginPath();
    ctx.arc(tipX, tipY, CELL * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 外圈慧光环 + 刻度
  const ringR = R * 0.78 * bloom;
  ctx.globalAlpha = vis * 0.8;
  ctx.strokeStyle = 'rgba(170,210,255,0.75)';
  ctx.lineWidth = 2 + tier * 0.15;
  ctx.beginPath();
  ctx.arc(x, y, ringR, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + p * 1.8;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * (ringR - 5), y + Math.sin(a) * (ringR - 5));
    ctx.lineTo(x + Math.cos(a) * (ringR + 7), y + Math.sin(a) * (ringR + 7));
    ctx.stroke();
  }

  // 飘散光尘 / 花瓣
  const dust = 12 + tier * 2;
  for (let i = 0; i < dust; i++) {
    const t = ((p * 1.3 + i * 0.09) % 1);
    const a = (i / dust) * Math.PI * 2 + p * 0.8;
    const dist = R * (0.25 + settle * 0.55) * (0.5 + (i % 3) * 0.18);
    const dx = x + Math.cos(a) * dist;
    const dy = y + Math.sin(a) * dist - t * CELL * 0.35;
    ctx.globalAlpha = vis * (1 - t) * 0.7;
    if (i % 3 === 0) {
      ctx.fillStyle = 'rgba(210,190,255,0.85)';
      ctx.beginPath();
      ctx.ellipse(dx, dy, 3.2, 1.6, a, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = i % 2 === 0 ? '#d8e8ff' : '#f0e0ff';
      ctx.beginPath();
      ctx.arc(dx, dy, 1.5 + (i % 2) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** 慧殊：浅莲 + 单道慧光（过渡） */
function drawUltHuishu(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.92) * Math.PI);
  const vis = Math.max(fade, life * 0.75);
  const bloom = easeOut(Math.min(1, p / 0.5));
  const slash = easeOut(Math.max(0, Math.min(1, (p - 0.25) / 0.5)));

  const g = ctx.createRadialGradient(x, y, 1, x, y, CELL * 0.7 * bloom);
  g.addColorStop(0, 'rgba(230,235,255,0.85)');
  g.addColorStop(1, 'rgba(140,120,220,0)');
  ctx.globalAlpha = vis;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, CELL * 0.7 * bloom, 0, Math.PI * 2);
  ctx.fill();

  const petals = 5 + Math.min(2, tier);
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 + p * 0.7;
    ctx.save();
    ctx.translate(x + Math.cos(a) * R * 0.32 * bloom, y + Math.sin(a) * R * 0.32 * bloom);
    ctx.rotate(a);
    ctx.globalAlpha = vis * 0.65 * bloom;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(200,210,255,0.75)' : 'rgba(210,190,255,0.65)';
    ctx.beginPath();
    ctx.ellipse(0, 0, CELL * 0.16, CELL * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (slash > 0) {
    const start = -Math.PI * 0.7 + p * 0.3;
    const sweep = Math.PI * 1.3 * slash;
    ctx.globalAlpha = vis * (1 - slash * 0.3);
    ctx.strokeStyle = 'rgba(180,200,255,0.85)';
    ctx.lineWidth = 2.2 + tier * 0.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, R * 0.55 * bloom, start, start + sweep);
    ctx.stroke();
  }

  for (let i = 0; i < 2; i++) {
    const t = Math.max(0, Math.min(1, (p - i * 0.12) / (1 - i * 0.12)));
    ctx.globalAlpha = vis * (1 - t * 0.55) * 0.7;
    ctx.strokeStyle = i === 0 ? 'rgba(200,190,255,0.75)' : 'rgba(170,210,255,0.5)';
    ctx.lineWidth = 1.5 + tier * 0.15;
    ctx.beginPath();
    ctx.arc(x, y, R * 0.48 * easeOut(t), 0, Math.PI * 2);
    ctx.stroke();
  }
}

// 太白 金星拂尘·长庚星现：四层递进——①拂尘月牙扫击 ②长庚星爆（十字光芒）
// ③星环扩散 ④星尘余韵。过渡位英雄，整体亮度克制、以暖金白为主色。
function drawUltTaibai(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.95) * Math.PI); // 整体生命曲线：中段最亮
  const vis = Math.max(fade, life * 0.85);
  const sweep = easeOut(Math.min(1, p / 0.42)); // ①扫击：前 42% 完成
  const flare = easeOut(Math.max(0, Math.min(1, (p - 0.16) / 0.36))); // ②星爆：16%~52%
  const ringT = Math.max(0, Math.min(1, (p - 0.3) / 0.7)); // ③星环：30% 起
  const dustT = Math.max(0, (p - 0.5) / 0.5); // ④星尘：后半程余韵

  // ① 拂尘扫击：上下两道反向扫出的月牙弧光（粗弧带头、渐隐尾迹，像尘丝束甩过）
  for (let k = 0; k < 2; k++) {
    const dir = k === 0 ? 1 : -1;
    const base = -Math.PI / 2 + k * Math.PI; // 上弧从正上起、下弧从正下起
    const swung = base + dir * Math.PI * 0.85 * sweep; // 弧头扫过的角度
    const span = Math.PI * 0.5 * (1 - sweep * 0.4); // 弧身随扫出略收窄
    ctx.save();
    ctx.globalAlpha = vis * (1 - sweep * 0.55) * 0.9; // 扫出后淡出
    // 尾迹：3 段递减的细弧跟在弧头后面
    for (let t = 0; t < 3; t++) {
      ctx.globalAlpha = vis * (1 - sweep * 0.55) * (0.5 - t * 0.14);
      ctx.strokeStyle = t === 0 ? 'rgba(255,240,200,0.9)' : 'rgba(255,214,110,0.75)';
      ctx.lineWidth = (4.5 + tier * 0.5) * (1 - t * 0.26);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x, y, R * (0.5 + t * 0.05), swung - dir * span, swung);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ② 长庚星爆：白热核心 + 四角星 + 十字衍射光芒（横向长、竖向短，星体质感）
  if (flare > 0) {
    const coreR = CELL * 0.3 * flare;
    const g = ctx.createRadialGradient(x, y, 1, x, y, coreR * 2.2);
    g.addColorStop(0, 'rgba(255,252,238,0.95)');
    g.addColorStop(0.35, 'rgba(255,232,160,0.6)');
    g.addColorStop(1, 'rgba(255,214,110,0)');
    ctx.globalAlpha = vis;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, coreR * 2.2, 0, Math.PI * 2); ctx.fill();

    // 十字光芒：横竖两道细长菱形透镜（横向更长，模拟星体衍射）
    for (let ax = 0; ax < 2; ax++) {
      const long = R * (ax === 0 ? 0.85 : 0.6) * flare;
      const wide = (ax === 0 ? CELL * 0.07 : CELL * 0.05) * flare;
      ctx.save();
      ctx.translate(x, y);
      if (ax === 1) ctx.rotate(Math.PI / 2);
      ctx.globalAlpha = vis * 0.8 * (1 - ringT * 0.5);
      const lg = ctx.createLinearGradient(-long, 0, long, 0);
      lg.addColorStop(0, 'rgba(255,226,138,0)');
      lg.addColorStop(0.5, 'rgba(255,250,225,0.95)');
      lg.addColorStop(1, 'rgba(255,226,138,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(-long, 0); ctx.quadraticCurveTo(0, -wide, long, 0);
      ctx.quadraticCurveTo(0, wide, -long, 0);
      ctx.fill();
      ctx.restore();
    }

    // 四角星本体：星爆最亮的一瞬放大再缓收
    const starS = CELL * (0.2 + 0.08 * tier) * (0.6 + flare * 0.6) * (1 - ringT * 0.35);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p * 0.4);
    ctx.globalAlpha = vis * 0.95;
    ctx.fillStyle = '#fff8dc';
    ctx.shadowColor = 'rgba(255,214,110,0.9)';
    ctx.shadowBlur = 8 + tier * 2;
    ctx.beginPath(); // 四角星（凹边菱形）
    ctx.moveTo(0, -starS); ctx.quadraticCurveTo(starS * 0.16, -starS * 0.16, starS, 0);
    ctx.quadraticCurveTo(starS * 0.16, starS * 0.16, 0, starS);
    ctx.quadraticCurveTo(-starS * 0.16, starS * 0.16, -starS, 0);
    ctx.quadraticCurveTo(-starS * 0.16, -starS * 0.16, 0, -starS);
    ctx.fill();
    ctx.restore();
  }

  // ③ 星环扩散：1~2 圈金色圆环从星体荡开，外圈带缺口更有星轨感
  const rings = 1 + Math.min(1, Math.floor((tier - 1) / 2)); // T1 一圈、T3 两圈
  for (let ri = 0; ri < rings; ri++) {
    const rt = Math.max(0, Math.min(1, ringT - ri * 0.18));
    if (rt <= 0) continue;
    const rr = easeOut(rt) * R * (0.78 + ri * 0.22);
    ctx.globalAlpha = vis * (1 - rt) * 0.75;
    ctx.strokeStyle = ri === 0 ? 'rgba(255,232,160,0.9)' : 'rgba(255,214,110,0.65)';
    ctx.lineWidth = (2 + tier * 0.25) * (1 - rt * 0.5);
    ctx.beginPath();
    if (ri === 0) {
      ctx.arc(x, y, rr, 0, Math.PI * 2); // 内圈整环
    } else {
      const a0 = p * 1.6; // 外圈两段弧：像旋转的星轨
      ctx.arc(x, y, rr, a0, a0 + Math.PI * 0.72);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, rr, a0 + Math.PI, a0 + Math.PI * 1.72);
    }
    ctx.stroke();
  }

  // ④ 星尘余韵：数粒小星向外飘散、边飘边闪；亮度下限保证中后段仍清晰可辨（收尾才隐没）
  if (dustT > 0) {
    const n = 6 + tier;
    const dustVis = Math.max(0.35, vis) * Math.sin(Math.PI * Math.min(1, dustT)) * (1 - Math.max(0, dustT - 0.8) / 0.2); // 0.8 后收尾
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + i * 0.7; // 错开角度避免排成规整圆
      const dr = R * (0.35 + easeOut(dustT) * 0.75);
      const dx = x + Math.cos(a) * dr, dy = y + Math.sin(a) * dr * 0.82;
      const tw = 0.5 + 0.5 * Math.sin(p * Math.PI * 5 + i * 2.1); // 闪烁相位错开
      ctx.globalAlpha = Math.min(1, dustVis * (0.55 + tw * 0.55));
      const s = (CELL * 0.06 + tier * 0.45) * (0.7 + tw * 0.5);
      ctx.fillStyle = i % 3 === 0 ? '#fff3c4' : '#ffe28a';
      ctx.beginPath(); // 小四角星
      ctx.moveTo(dx, dy - s); ctx.quadraticCurveTo(dx + s * 0.2, dy - s * 0.2, dx + s, dy);
      ctx.quadraticCurveTo(dx + s * 0.2, dy + s * 0.2, dx, dy + s);
      ctx.quadraticCurveTo(dx - s * 0.2, dy + s * 0.2, dx - s, dy);
      ctx.quadraticCurveTo(dx - s * 0.2, dy - s * 0.2, dx, dy - s);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
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

// —— 过渡 / 白龙（相对满5更轻、更短）——
/** 九齿钉耙剪影（八戒普攻：木柄 + 横梁 + 并排直齿） */
function drawJiuchiRakeGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  tier: number,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const barY = -size * 0.22;
  const barHalfW = size * 0.52;
  const tineLen = size * 0.78;
  const teeth = 7 + Math.min(2, tier);
  // 木柄
  ctx.strokeStyle = '#5a3a18';
  ctx.lineWidth = 3.2 + tier * 0.4;
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.05);
  ctx.lineTo(0, barY);
  ctx.stroke();
  ctx.strokeStyle = '#a07840';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-1, -size * 0.95);
  ctx.lineTo(-1, barY + 1);
  ctx.stroke();
  // 横梁
  ctx.strokeStyle = '#8a6a3a';
  ctx.lineWidth = 4 + tier * 0.45;
  ctx.beginPath();
  ctx.moveTo(-barHalfW, barY + size * 0.05);
  ctx.quadraticCurveTo(0, barY - size * 0.06, barHalfW, barY + size * 0.05);
  ctx.stroke();
  // 九齿：并排垂直下扎
  ctx.strokeStyle = '#f0d99a';
  ctx.lineWidth = 2 + tier * 0.25;
  for (let t = 0; t < teeth; t++) {
    const tx0 = -barHalfW + (barHalfW * 2) * (t + 0.5) / teeth;
    const by = barY + size * 0.05 * (1 - (tx0 / Math.max(1, barHalfW)) ** 2);
    ctx.beginPath();
    ctx.moveTo(tx0, by);
    ctx.lineTo(tx0, by + tineLen);
    ctx.stroke();
    ctx.fillStyle = '#fff6d8';
    ctx.beginPath();
    ctx.arc(tx0, by + tineLen, 1.3 + tier * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 蟒鞭剪影（大蟒：青绿蛇身 + 金蛇首） */
function drawSnakeWhipGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  tier: number,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const len = size * 1.15;
  // 蛇身 S 形
  ctx.strokeStyle = '#2f8a48';
  ctx.lineWidth = 3.2 + tier * 0.35;
  ctx.beginPath();
  ctx.moveTo(-len * 0.55, 0);
  ctx.bezierCurveTo(-len * 0.2, -len * 0.28, len * 0.05, len * 0.3, len * 0.42, -len * 0.06);
  ctx.stroke();
  ctx.strokeStyle = '#7edc8a';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-len * 0.52, -0.8);
  ctx.bezierCurveTo(-len * 0.18, -len * 0.24, len * 0.08, len * 0.22, len * 0.38, -len * 0.08);
  ctx.stroke();
  // 鳞片点缀
  for (let i = 0; i < 4 + tier; i++) {
    const t = (i + 0.5) / (4 + tier);
    const x = -len * 0.5 + len * 0.9 * t;
    const y = Math.sin(t * Math.PI * 2) * len * 0.12;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(180,255,160,0.85)' : 'rgba(40,120,60,0.75)';
    ctx.beginPath();
    ctx.ellipse(x, y, 1.6 + tier * 0.1, 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 金蛇首
  const hx = len * 0.48;
  const hy = -len * 0.08;
  ctx.fillStyle = '#e8c45a';
  ctx.strokeStyle = '#a88420';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(hx, hy, 4.2 + tier * 0.35, 3.2 + tier * 0.25, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#3cff7a';
  ctx.beginPath();
  ctx.arc(hx + 1.2, hy - 0.6, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff6d0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx + 3.2, hy + 0.4);
  ctx.lineTo(hx + 6.5 + tier * 0.3, hy + 1.2);
  ctx.stroke();
  ctx.restore();
}

/** 砍妖刀剪影（金吒：短金刀 + 焰刃） */
function drawKanYaoDaoGlyph(
  ctx: CanvasRenderingContext2D,
  len: number,
  tier: number,
  alpha: number,
  flame = 0,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 刀柄
  ctx.strokeStyle = '#5a3018';
  ctx.lineWidth = 2.4 + tier * 0.3;
  ctx.beginPath();
  ctx.moveTo(-len * 0.55, 0);
  ctx.lineTo(-len * 0.08, 0);
  ctx.stroke();
  // 护手
  ctx.strokeStyle = '#d4a84a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-len * 0.1, -3.5 - tier * 0.3);
  ctx.lineTo(-len * 0.1, 3.5 + tier * 0.3);
  ctx.stroke();
  // 刀身（略弯的金刃）
  ctx.fillStyle = 'rgba(255,230,150,0.95)';
  ctx.strokeStyle = '#ffb020';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-len * 0.05, -1.2);
  ctx.quadraticCurveTo(len * 0.35, -2.8 - tier * 0.25, len * 0.72, 0);
  ctx.quadraticCurveTo(len * 0.35, 2.8 + tier * 0.25, -len * 0.05, 1.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 刃口高光
  ctx.strokeStyle = '#fff6d0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-len * 0.02, -0.4);
  ctx.quadraticCurveTo(len * 0.4, -1.6, len * 0.68, 0);
  ctx.stroke();
  // 焰刃
  if (flame > 0.05) {
    const fg = ctx.createLinearGradient(len * 0.1, 0, len * 0.95, 0);
    fg.addColorStop(0, `rgba(255,200,80,${0.15 * flame})`);
    fg.addColorStop(0.55, `rgba(255,120,30,${0.55 * flame})`);
    fg.addColorStop(1, `rgba(255,40,10,${0.15 * flame})`);
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(len * 0.15, -3.5 - tier * 0.3);
    ctx.quadraticCurveTo(len * 0.55, -5 - flame * 2, len * 0.9, 0);
    ctx.quadraticCurveTo(len * 0.55, 5 + flame * 2, len * 0.15, 3.5 + tier * 0.3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// 大蟒 蟒影横扫：青绿蛇影弧扫 + 毒鳞飞散（非钉耙）
function drawUltDamang(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.92) * Math.PI);
  const vis = Math.max(fade, life * 0.85);
  const sweep = easeOut(Math.min(1, p / 0.5));
  const rad = R * (0.68 + tier * 0.05);
  const a0 = -Math.PI * 0.8;
  const tipA = a0 + Math.PI * 0.95 * sweep;

  // 毒雾外晕 + 青绿蛇影主弧
  ctx.globalAlpha = vis * 0.28;
  ctx.strokeStyle = 'rgba(40,120,70,0.7)';
  ctx.lineWidth = 12 + tier;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, rad * 0.94, a0, tipA);
  ctx.stroke();
  ctx.globalAlpha = vis * 0.55;
  ctx.strokeStyle = 'rgba(90,230,130,0.85)';
  ctx.lineWidth = 3.8 + tier * 0.35;
  ctx.beginPath();
  ctx.arc(x, y, rad * 0.94, a0, tipA);
  ctx.stroke();

  // 并行细鳞纹（蛇身环带感）
  for (let t = 0; t < 3; t++) {
    const off = (t - 1) * CELL * 0.06;
    ctx.globalAlpha = vis * 0.35 * sweep;
    ctx.strokeStyle = t === 1 ? 'rgba(200,255,160,0.7)' : 'rgba(30,100,55,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, rad * 0.94 + off, a0, tipA);
    ctx.stroke();
  }

  // 沿弧毒鳞粒子
  const dustN = 12 + tier * 2;
  for (let i = 0; i < dustN; i++) {
    const t = i / dustN;
    const a = a0 + (tipA - a0) * t;
    if (a0 + (tipA - a0) * sweep < a) continue;
    const dr = rad * 0.94 + Math.sin(i * 2.7) * CELL * 0.07;
    ctx.globalAlpha = vis * (0.35 + (i % 3) * 0.15);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(160,255,140,0.8)' : 'rgba(60,160,90,0.75)';
    ctx.beginPath();
    ctx.ellipse(
      x + Math.cos(a) * dr,
      y + Math.sin(a) * dr,
      2 + (i % 3) * 0.5,
      1.2,
      a,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // 蟒鞭本体随扫掠
  const whipSize = CELL * (0.48 + tier * 0.07);
  ctx.save();
  ctx.translate(x + Math.cos(tipA - 0.12) * rad * 0.12, y + Math.sin(tipA - 0.12) * rad * 0.12);
  ctx.rotate(tipA - 0.12);
  drawSnakeWhipGlyph(ctx, whipSize * 0.88, tier, vis * 0.28 * sweep);
  ctx.restore();
  ctx.save();
  ctx.translate(x + Math.cos(tipA) * rad * 0.12, y + Math.sin(tipA) * rad * 0.12);
  ctx.rotate(tipA);
  drawSnakeWhipGlyph(ctx, whipSize, tier, vis * (0.55 + sweep * 0.4));
  ctx.restore();

  // 收尾：毒绿绽放 + 鳞片飞散
  if (sweep > 0.55) {
    const bp = (sweep - 0.55) / 0.45;
    const bloom = easeOut(bp);
    const hx = x + Math.cos(tipA) * rad;
    const hy = y + Math.sin(tipA) * rad;
    const br = CELL * (0.24 + tier * 0.05) * (0.6 + bloom * 0.8);

    ctx.globalAlpha = vis * (1 - bloom * 0.55);
    const g = ctx.createRadialGradient(hx, hy, 1, hx, hy, br);
    g.addColorStop(0, 'rgba(220,255,200,0.95)');
    g.addColorStop(0.45, 'rgba(80,210,120,0.55)');
    g.addColorStop(1, 'rgba(20,80,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hx, hy, br, 0, Math.PI * 2);
    ctx.fill();

    const debris = 8 + tier;
    for (let i = 0; i < debris; i++) {
      const a = tipA + (i - debris / 2) * 0.2;
      const d = br * (0.7 + (i % 2) * 0.35) * bloom;
      ctx.save();
      ctx.translate(hx + Math.cos(a) * d, hy + Math.sin(a) * d);
      ctx.rotate(a + i * 0.4);
      ctx.globalAlpha = vis * (1 - bloom * 0.55) * 0.85;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(120,230,140,0.9)' : 'rgba(40,130,70,0.8)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.2 + (i % 3) * 0.4, 1.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

/** 织云箭剪影：云絮箭杆 + 羽尾 */
function drawZhiiyunArrowGlyph(
  ctx: CanvasRenderingContext2D,
  len: number,
  tier: number,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 云絮箭杆
  ctx.strokeStyle = 'rgba(180,200,240,0.85)';
  ctx.lineWidth = 2.4 + tier * 0.25;
  ctx.beginPath();
  ctx.moveTo(-len * 0.55, 0);
  ctx.lineTo(len * 0.35, 0);
  ctx.stroke();
  ctx.strokeStyle = '#f0f6ff';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-len * 0.5, -1);
  ctx.lineTo(len * 0.3, -1);
  ctx.stroke();
  // 箭头（银白）
  ctx.fillStyle = '#e8f0ff';
  ctx.strokeStyle = '#8aa0d0';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(len * 0.55, 0);
  ctx.lineTo(len * 0.28, -len * 0.16);
  ctx.lineTo(len * 0.32, 0);
  ctx.lineTo(len * 0.28, len * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 云羽尾
  for (const side of [-1, 1] as const) {
    ctx.fillStyle = 'rgba(200,220,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(-len * 0.45, 0);
    ctx.quadraticCurveTo(-len * 0.7, side * len * 0.22, -len * 0.85, side * len * 0.08);
    ctx.quadraticCurveTo(-len * 0.62, side * len * 0.05, -len * 0.5, 0);
    ctx.closePath();
    ctx.fill();
  }
  // 杆上小云团
  for (const t of [-0.2, 0.05] as const) {
    ctx.fillStyle = 'rgba(230,240,255,0.7)';
    ctx.beginPath();
    ctx.ellipse(len * t, -len * 0.04, len * 0.1, len * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 牛郎 织云箭：云箭飞掠 + 云絮拖尾 + 命中织云爆散（明显强于普攻光点）
function drawUltNiulang(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  p: number, fade: number, tier: number,
  fromC?: number, fromR?: number,
) {
  const life = Math.sin(Math.min(1, p / 0.92) * Math.PI);
  const vis = Math.max(fade, life * 0.8);
  const hasOrigin = fromC != null && fromR != null;
  const fromPx = hasOrigin ? cellCenterPx(fromC, fromR) : { x: x - CELL * 2.2, y };
  const dx = x - fromPx.x;
  const dy = y - fromPx.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  const fly = easeOut(Math.min(1, p / 0.62));
  const px = fromPx.x + Math.cos(ang) * dist * fly;
  const py = fromPx.y + Math.sin(ang) * dist * fly;
  const perpX = -Math.sin(ang);
  const perpY = Math.cos(ang);

  // 织云光带（宽于普攻细线）
  ctx.save();
  ctx.translate(fromPx.x, fromPx.y);
  ctx.rotate(ang);
  const reach = dist * fly;
  const band = ctx.createLinearGradient(0, 0, reach, 0);
  band.addColorStop(0, 'rgba(140,170,230,0)');
  band.addColorStop(0.25, `rgba(170,195,245,${0.35 * vis})`);
  band.addColorStop(0.75, `rgba(220,235,255,${0.55 * vis})`);
  band.addColorStop(1, `rgba(255,250,230,${0.4 * vis})`);
  ctx.fillStyle = band;
  const hw = CELL * (0.12 + tier * 0.02);
  ctx.beginPath();
  ctx.moveTo(0, -hw * 0.4);
  ctx.lineTo(reach, -hw * 1.05);
  ctx.lineTo(reach, hw * 1.05);
  ctx.lineTo(0, hw * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 云絮拖尾团
  const puffs = 7 + tier;
  for (let i = 0; i < puffs; i++) {
    const t = (i / puffs) * fly;
    const side = (i % 2 === 0 ? 1 : -1) * (0.4 + (i % 3) * 0.25);
    const sx = fromPx.x + Math.cos(ang) * dist * t + perpX * side * CELL * 0.18;
    const sy = fromPx.y + Math.sin(ang) * dist * t + perpY * side * CELL * 0.18;
    const pr = CELL * (0.08 + (i % 3) * 0.03) * (0.6 + fly);
    ctx.globalAlpha = vis * (0.25 + (1 - t) * 0.4);
    const cg = ctx.createRadialGradient(sx, sy, 1, sx, sy, pr * 2);
    cg.addColorStop(0, 'rgba(240,245,255,0.85)');
    cg.addColorStop(0.5, 'rgba(180,200,240,0.4)');
    cg.addColorStop(1, 'rgba(140,170,220,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(sx, sy, pr * 1.6, pr * 0.9, ang, 0, Math.PI * 2);
    ctx.fill();
  }

  // 箭本体
  const arrowLen = CELL * (0.38 + tier * 0.04);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(ang);
  drawZhiiyunArrowGlyph(ctx, arrowLen, tier, vis * (0.55 + fly * 0.45));
  ctx.restore();

  // 箭尖柔光
  ctx.globalAlpha = vis * 0.7;
  const tipG = ctx.createRadialGradient(px, py, 1, px, py, CELL * 0.22);
  tipG.addColorStop(0, 'rgba(255,250,230,0.9)');
  tipG.addColorStop(0.45, 'rgba(190,210,255,0.45)');
  tipG.addColorStop(1, 'rgba(140,170,230,0)');
  ctx.fillStyle = tipG;
  ctx.beginPath();
  ctx.arc(px, py, CELL * 0.22, 0, Math.PI * 2);
  ctx.fill();

  // 命中：织云爆散（多层云瓣，非普攻小圆点）
  if (fly > 0.7) {
    const bp = (fly - 0.7) / 0.3;
    const burstR = CELL * (0.22 + bp * 0.35 + tier * 0.03);
    ctx.globalAlpha = (1 - bp) * vis * 0.85;
    const bg = ctx.createRadialGradient(x, y, 1, x, y, burstR);
    bg.addColorStop(0, 'rgba(255,250,235,0.95)');
    bg.addColorStop(0.4, 'rgba(200,220,255,0.55)');
    bg.addColorStop(1, 'rgba(150,180,240,0)');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(x, y, burstR, 0, Math.PI * 2);
    ctx.fill();
    // 云瓣外甩
    const petals = 6 + tier;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 + p;
      const d = burstR * (0.55 + bp * 0.55);
      const cx = x + Math.cos(a) * d;
      const cy = y + Math.sin(a) * d;
      ctx.globalAlpha = (1 - bp) * vis * 0.65;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(230,240,255,0.9)' : 'rgba(180,200,245,0.7)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, CELL * 0.1, CELL * 0.055, a, 0, Math.PI * 2);
      ctx.fill();
    }
    // 星点（鹊桥感）
    for (let i = 0; i < 5 + tier; i++) {
      const a = (i / (5 + tier)) * Math.PI * 2 + p * 2;
      const d = burstR * (0.3 + (i % 3) * 0.2);
      ctx.globalAlpha = (1 - bp) * vis * 0.8;
      ctx.fillStyle = '#fff8e0';
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.4 + (i % 2) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** 金吒斩痕：三层弧线斩击（外层暖光 + 主斩 + 刃尖亮弧），供大招交叉双斩复用 */
function drawJinzhaSlashArc(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  rad: number, a0: number, a1: number, ccw: boolean,
  vis: number, snap: number, tier: number,
) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalAlpha = vis * 0.35 * snap;
  ctx.strokeStyle = 'rgba(255,120,40,0.75)';
  ctx.lineWidth = 6.5 + tier * 0.6;
  ctx.beginPath();
  ctx.arc(x, y, rad, a0, a1, ccw);
  ctx.stroke();
  ctx.globalAlpha = vis * 0.65 * snap;
  ctx.strokeStyle = '#ffe08a';
  ctx.lineWidth = 3 + tier * 0.4;
  ctx.beginPath();
  ctx.arc(x, y, rad, a0, a1, ccw);
  ctx.stroke();
  if (snap > 0.15) {
    const tipFrom = a1 - (a1 - a0) * 0.22 * (ccw ? -1 : 1);
    ctx.globalAlpha = vis * 0.85 * snap;
    ctx.strokeStyle = '#fff6d8';
    ctx.lineWidth = 1.6 + tier * 0.2;
    ctx.beginPath();
    ctx.arc(x, y, rad, tipFrom, a1, ccw);
    ctx.stroke();
  }
  ctx.restore();
}

// 金吒 砍妖刀：金焰双斩交叉（十字斩）+ 刃口大爆焰，明显强于普攻单斩
function drawUltJinzha(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.92) * Math.PI);
  const vis = Math.max(fade, life * 0.85);
  const rad = R * (0.62 + tier * 0.055);
  const daoLen = CELL * (0.5 + tier * 0.07);

  // 第一斩：右上劈向左下
  const s1 = easeOut(Math.min(1, p / 0.3));
  const a0a = -Math.PI * 0.05;
  const a1a = a0a - Math.PI * 0.95 * s1;
  if (s1 > 0.02) {
    drawJinzhaSlashArc(ctx, x, y, rad, a0a, a1a, true, vis, s1, tier);
    const bx1 = x + Math.cos(a1a) * rad * 0.2;
    const by1 = y + Math.sin(a1a) * rad * 0.2;
    ctx.save();
    ctx.translate(bx1, by1);
    ctx.rotate(a1a);
    drawKanYaoDaoGlyph(ctx, daoLen, tier, vis * s1 * Math.max(0, 1 - Math.max(0, (p - 0.35) / 0.3)), 0.5 + s1 * 0.5);
    ctx.restore();
  }

  // 第二斩：左下反挑向右上，与第一斩交叉成「十」字
  const s2 = easeOut(Math.max(0, Math.min(1, (p - 0.26) / 0.3)));
  const a0b = Math.PI * 0.8;
  const a1b = a0b + Math.PI * 0.95 * s2;
  if (s2 > 0.02) {
    drawJinzhaSlashArc(ctx, x, y, rad * 1.04, a0b, a1b, false, vis, s2, tier);
    const bx2 = x + Math.cos(a1b) * rad * 1.04 * 0.2;
    const by2 = y + Math.sin(a1b) * rad * 1.04 * 0.2;
    ctx.save();
    ctx.translate(bx2, by2);
    ctx.rotate(a1b);
    drawKanYaoDaoGlyph(ctx, daoLen, tier, vis * s2, 0.6 + s2 * 0.4);
    ctx.restore();
  }

  // 十字交汇：大爆焰 + 冲击环 + 地面焦痕
  if (s2 > 0.45) {
    const bp = (s2 - 0.45) / 0.55;
    const bloom = easeOut(bp);

    // 冲击波圆环外扩
    ctx.globalAlpha = vis * (1 - bloom) * 0.6;
    ctx.strokeStyle = 'rgba(255,170,70,0.85)';
    ctx.lineWidth = 3 + tier * 0.3;
    ctx.beginPath();
    ctx.arc(x, y, CELL * (0.15 + bloom * 0.55), 0, Math.PI * 2);
    ctx.stroke();

    // 中心大爆焰
    const fr = CELL * (0.3 + tier * 0.07) * (0.6 + bloom * 0.75);
    ctx.globalAlpha = vis * (1 - bloom * 0.45);
    const g = ctx.createRadialGradient(x, y, 1, x, y, fr);
    g.addColorStop(0, 'rgba(255,248,190,0.98)');
    g.addColorStop(0.4, 'rgba(255,150,45,0.65)');
    g.addColorStop(0.75, 'rgba(255,70,20,0.35)');
    g.addColorStop(1, 'rgba(255,40,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, fr, 0, Math.PI * 2);
    ctx.fill();

    // 地面十字焦痕（呼应交叉双斩）
    ctx.save();
    ctx.globalAlpha = vis * (1 - bloom * 0.7) * 0.5;
    ctx.strokeStyle = 'rgba(255,120,40,0.8)';
    ctx.lineWidth = 2 + tier * 0.25;
    ctx.lineCap = 'round';
    const crackLen = fr * (0.9 + bloom * 0.4);
    for (const crackA of [a1a, a1b]) {
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(crackA) * crackLen, y - Math.sin(crackA) * crackLen);
      ctx.lineTo(x + Math.cos(crackA) * crackLen, y + Math.sin(crackA) * crackLen);
      ctx.stroke();
    }
    ctx.restore();

    // 迸溅火星向四周飞散
    const sparks = 8 + tier * 2;
    for (let i = 0; i < sparks; i++) {
      const a = (i / sparks) * Math.PI * 2 + p * 3;
      const d = fr * (0.65 + (i % 3) * 0.25) * (0.5 + bloom * 0.9);
      ctx.globalAlpha = vis * (1 - bloom * 0.6) * 0.8;
      ctx.fillStyle = i % 2 === 0 ? '#fff3a0' : '#ff7a2c';
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.5 + (i % 2) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// 八仙 仙缘定身：符箓环锁 + 仙云 + 「仙」印
/** 仙缘符箓剪影（竖符纸 + 朱文） */
function drawXianyuanTalismanGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  tier: number,
  alpha: number,
  rot = 0,
) {
  ctx.save();
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  const w = size * 0.42;
  const h = size * 0.95;
  // 符纸
  ctx.fillStyle = 'rgba(255,246,210,0.92)';
  ctx.strokeStyle = 'rgba(200,160,70,0.85)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h * 0.48);
  ctx.lineTo(w * 0.5, -h * 0.48);
  ctx.lineTo(w * 0.45, h * 0.48);
  ctx.lineTo(-w * 0.45, h * 0.48);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 朱砂竖纹
  ctx.strokeStyle = `rgba(200,60,40,${0.75 + tier * 0.05})`;
  ctx.lineWidth = 1.4 + tier * 0.15;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.35);
  ctx.lineTo(0, h * 0.28);
  ctx.stroke();
  // 横撇符纹
  for (const [yy, span] of [[-0.18, 0.28], [0.02, 0.34], [0.2, 0.22]] as const) {
    ctx.beginPath();
    ctx.moveTo(-w * span, h * yy);
    ctx.lineTo(w * span, h * yy);
    ctx.stroke();
  }
  // 顶部结绳
  ctx.strokeStyle = '#d4a84a';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.48);
  ctx.lineTo(0, -h * 0.62);
  ctx.stroke();
  ctx.fillStyle = '#e8c060';
  ctx.beginPath();
  ctx.arc(0, -h * 0.66, 2.2 + tier * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawUltBaxian(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.92) * Math.PI);
  const vis = Math.max(fade, life * 0.8);
  const bloom = easeOut(Math.min(1, p / 0.55));

  // 仙云底雾
  for (let i = 0; i < 5 + tier; i++) {
    const a = (i / (5 + tier)) * Math.PI * 2 + p * 0.6;
    const rr = bloom * R * (0.35 + (i % 3) * 0.18);
    const cx = x + Math.cos(a) * rr * 0.7;
    const cy = y + Math.sin(a) * rr * 0.45 - bloom * CELL * 0.08;
    const gr = CELL * (0.22 + (i % 3) * 0.08);
    ctx.globalAlpha = vis * 0.28;
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, gr);
    g.addColorStop(0, 'rgba(255,248,220,0.7)');
    g.addColorStop(1, 'rgba(255,230,160,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, gr * 1.3, gr * 0.7, a * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 双层金色锁环
  for (let k = 0; k < 2; k++) {
    const pk = Math.max(0, Math.min(1, bloom - k * 0.12));
    const rad = easeOut(pk) * R * (0.5 + k * 0.28);
    ctx.globalAlpha = vis * (0.7 - k * 0.2);
    ctx.strokeStyle = k === 0 ? '#ffe08a' : 'rgba(255,210,120,0.65)';
    ctx.lineWidth = 3.2 - k * 0.8;
    ctx.setLineDash(k === 1 ? [5, 4] : []);
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 环上符箓飞旋
  const n = 5 + Math.min(2, tier);
  const talR = bloom * R * 0.62;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + p * 1.8;
    const tx = x + Math.cos(a) * talR;
    const ty = y + Math.sin(a) * talR * 0.85;
    ctx.save();
    ctx.translate(tx, ty);
    drawXianyuanTalismanGlyph(
      ctx,
      CELL * (0.22 + tier * 0.02),
      tier,
      vis * (0.55 + bloom * 0.4),
      a + Math.PI / 2,
    );
    ctx.restore();
  }

  // 中心「仙」印
  ctx.globalAlpha = vis * (0.55 + bloom * 0.4);
  ctx.fillStyle = '#ffe27a';
  ctx.strokeStyle = '#fff8dc';
  ctx.lineWidth = 2;
  const px = Math.round(CELL * (0.32 + 0.06 * Math.sin(p * Math.PI * 2)));
  ctx.font = `bold ${px}px "PingFang SC", "Songti SC", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText('仙', x, y - 1);
  ctx.fillText('仙', x, y - 1);

  // 定身金线放射（短，不像普攻扇）
  if (bloom > 0.35) {
    ctx.globalAlpha = vis * 0.45 * bloom;
    ctx.strokeStyle = '#ffd87a';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + p;
      const r0 = R * 0.12;
      const r1 = R * (0.35 + bloom * 0.25);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      ctx.stroke();
    }
  }
}

// 青牛 牛角顶：青绿冲刺走廊 + 双角顶撞 + 轻冲击（过渡，弱于牛魔）
function drawUltQingniu(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.92) * Math.PI);
  const vis = Math.max(fade, life * 0.8);
  const charge = easeOut(Math.min(1, p / 0.55));
  const len = R * (0.95 + tier * 0.04);
  const fromY = y + len * 0.15;
  const hx = x;
  const hy = fromY - charge * len;
  const corridorW = CELL * (0.28 + tier * 0.04);

  // 冲刺走廊
  ctx.save();
  const body = ctx.createLinearGradient(x, fromY, hx, hy);
  body.addColorStop(0, 'rgba(80,120,70,0)');
  body.addColorStop(0.25, `rgba(100,150,90,${0.4 * vis})`);
  body.addColorStop(0.7, `rgba(150,210,130,${0.65 * vis})`);
  body.addColorStop(1, `rgba(210,245,180,${0.5 * vis})`);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(x - corridorW * 0.35, fromY);
  ctx.lineTo(hx - corridorW * 0.95, hy);
  ctx.lineTo(hx + corridorW * 0.95, hy);
  ctx.lineTo(x + corridorW * 0.35, fromY);
  ctx.closePath();
  ctx.fill();
  // 中轴高光
  ctx.globalAlpha = vis * 0.75;
  ctx.strokeStyle = '#d8f0c0';
  ctx.lineWidth = 3.2 + tier * 0.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, fromY - len * 0.05);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.globalAlpha = vis * 0.45;
  ctx.strokeStyle = '#f0ffe0';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x, fromY - len * 0.12);
  ctx.lineTo(hx, hy + 2);
  ctx.stroke();
  ctx.restore();

  // 两侧拖尾碎叶/尘点
  const streaks = 8 + tier * 2;
  for (let i = 0; i < streaks; i++) {
    const t = (i / streaks) * charge;
    const side = i % 2 === 0 ? 1 : -1;
    const sy = fromY - t * len;
    const sx = x + side * corridorW * (0.55 + (i % 3) * 0.2);
    const streakLen = CELL * (0.12 + (i % 3) * 0.08) * charge;
    ctx.globalAlpha = vis * (0.35 + (1 - t) * 0.35);
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(180,230,150,0.9)' : 'rgba(100,140,80,0.75)';
    ctx.lineWidth = 1.4 + (i % 3) * 0.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, sy + streakLen * 0.4);
    ctx.lineTo(sx + side * 2, sy - streakLen);
    ctx.stroke();
  }

  // 牛头剪影 + 更大双角
  const horn = CELL * (0.16 + tier * 0.03);
  ctx.globalAlpha = vis * (0.55 + charge * 0.45);
  // 头颅
  ctx.fillStyle = 'rgba(90,130,75,0.85)';
  ctx.strokeStyle = '#3a5a32';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(hx, hy + horn * 0.35, horn * 0.7, horn * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 双角
  for (const side of [-1, 1] as const) {
    ctx.fillStyle = '#c8e0b8';
    ctx.strokeStyle = '#4a6a40';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(hx + side * horn * 0.35, hy + horn * 0.15);
    ctx.quadraticCurveTo(
      hx + side * horn * 1.15,
      hy - horn * 0.35,
      hx + side * horn * 0.95,
      hy - horn * 1.25,
    );
    ctx.quadraticCurveTo(
      hx + side * horn * 0.7,
      hy - horn * 0.2,
      hx + side * horn * 0.15,
      hy + horn * 0.25,
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 角尖亮边
    ctx.strokeStyle = '#e8f8d8';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(hx + side * horn * 0.55, hy - horn * 0.15);
    ctx.quadraticCurveTo(
      hx + side * horn * 1.0,
      hy - horn * 0.45,
      hx + side * horn * 0.95,
      hy - horn * 1.25,
    );
    ctx.stroke();
  }

  // 命中冲击
  if (charge > 0.55) {
    const bp = (charge - 0.55) / 0.45;
    const ir = CELL * (0.2 + bp * 0.28 + tier * 0.03);
    ctx.globalAlpha = (1 - bp) * vis * 0.75;
    ctx.strokeStyle = '#d0f0b0';
    ctx.lineWidth = 2.4 + tier * 0.25;
    ctx.beginPath();
    ctx.arc(hx, hy - horn * 0.2, ir, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(200,240,170,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(hx, hy - horn * 0.2, ir * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    // 碎屑
    const chips = 5 + tier;
    for (let i = 0; i < chips; i++) {
      const a = (i / chips) * Math.PI * 2 + p;
      const d = ir * (0.7 + (i % 3) * 0.15);
      ctx.globalAlpha = (1 - bp) * vis * 0.55;
      ctx.fillStyle = i % 2 === 0 ? '#b8d890' : '#6a8a50';
      ctx.beginPath();
      ctx.arc(hx + Math.cos(a) * d, hy - horn * 0.2 + Math.sin(a) * d, 1.5 + (i % 2), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** 铁拳剪影：拳峰 + 指节棱线 */
function drawIronFistGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  tier: number,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 拳体
  ctx.fillStyle = 'rgba(120,130,140,0.92)';
  ctx.strokeStyle = 'rgba(60,68,76,0.9)';
  ctx.lineWidth = 1.4 + tier * 0.12;
  ctx.beginPath();
  ctx.moveTo(-size * 0.42, size * 0.5);
  ctx.quadraticCurveTo(-size * 0.55, size * 0.05, -size * 0.32, -size * 0.35);
  ctx.quadraticCurveTo(-size * 0.1, -size * 0.55, size * 0.14, -size * 0.42);
  ctx.quadraticCurveTo(size * 0.5, -size * 0.28, size * 0.48, size * 0.1);
  ctx.quadraticCurveTo(size * 0.44, size * 0.42, size * 0.1, size * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 指节棱线（横向三道）
  ctx.strokeStyle = 'rgba(200,210,220,0.7)';
  ctx.lineWidth = 1.1;
  for (const t of [-0.22, 0.02, 0.24] as const) {
    ctx.beginPath();
    ctx.moveTo(-size * 0.3, size * t);
    ctx.lineTo(size * 0.34, size * (t - 0.06));
    ctx.stroke();
  }
  // 高光
  ctx.strokeStyle = 'rgba(230,238,244,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-size * 0.2, -size * 0.3);
  ctx.quadraticCurveTo(size * 0.05, -size * 0.44, size * 0.28, -size * 0.3);
  ctx.stroke();
  ctx.restore();
}

// 铁背 开山：双拳砸地裂山 + 尘柱 + 碎石
function drawUltTiebei(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.92) * Math.PI);
  const vis = Math.max(fade, life * 0.85);
  const slamP = Math.min(1, p / 0.42);
  const drop = easeIn(slamP);
  const fistSize = CELL * (0.24 + tier * 0.02);

  // 双拳从两侧上方砸落（未落地前可见，落地后隐去）
  if (slamP < 1) {
    for (const side of [-1, 1] as const) {
      const fx = x + side * CELL * 0.32 * (1 - drop * 0.55);
      const fy = y - R * 0.9 * (1 - drop) - CELL * 0.05;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(side * 0.25 * (1 - drop));
      ctx.globalAlpha = vis * (0.6 + drop * 0.4);
      drawIronFistGlyph(ctx, fistSize, tier, 1);
      ctx.restore();
    }
  }

  if (slamP <= 0.05) return;

  const bloom = easeOut(Math.max(0, Math.min(1, (p - 0.4) / 0.55)));
  const flash = Math.max(0, 1 - (slamP - 0.75) / 0.25);

  // 落地闪光
  if (flash > 0) {
    ctx.globalAlpha = vis * flash * 0.85;
    const g = ctx.createRadialGradient(x, y, 1, x, y, R * 0.6);
    g.addColorStop(0, 'rgba(235,238,240,0.9)');
    g.addColorStop(1, 'rgba(200,205,210,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, R * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // 裂山地缝：不规则锯齿线自中心向外延伸
  const cracks = 6 + tier;
  for (let i = 0; i < cracks; i++) {
    const seed = (i * 29 + tier * 11) % 97;
    const a = (i / cracks) * Math.PI * 2 + (seed % 7) * 0.03;
    const len = R * (0.55 + (seed % 5) * 0.09) * bloom;
    ctx.globalAlpha = vis * (0.55 + bloom * 0.3);
    ctx.strokeStyle = 'rgba(90,80,70,0.8)';
    ctx.lineWidth = 2 + tier * 0.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    let px = x, py = y;
    ctx.moveTo(px, py);
    const segs = 3;
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      const jitter = (((seed * s) % 13) - 6) * 0.6;
      const nx = x + Math.cos(a) * len * t + Math.cos(a + Math.PI / 2) * jitter;
      const ny = y + Math.sin(a) * len * t * 0.6 + Math.sin(a + Math.PI / 2) * jitter * 0.5;
      ctx.lineTo(nx, ny);
      px = nx; py = ny;
    }
    ctx.stroke();
    // 缝隙亮边
    ctx.globalAlpha = vis * 0.3 * bloom;
    ctx.strokeStyle = '#e8e0d0';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // 冲击波环（双层）
  for (let k = 0; k < 2; k++) {
    const pk = Math.max(0, Math.min(1, bloom - k * 0.15));
    const rad = easeOut(pk) * R * (0.6 + k * 0.3);
    ctx.globalAlpha = vis * (0.5 - k * 0.15);
    ctx.strokeStyle = k === 0 ? 'rgba(200,205,210,0.7)' : 'rgba(160,165,172,0.45)';
    ctx.lineWidth = 3 - k;
    ctx.beginPath();
    ctx.ellipse(x, y + CELL * 0.06, rad, rad * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 尘柱（左右两道扬起）
  for (const side of [-1, 1] as const) {
    const dx = x + side * R * 0.42 * bloom;
    const dh = CELL * (0.6 + tier * 0.06) * bloom;
    ctx.save();
    ctx.globalAlpha = vis * 0.4 * bloom;
    const dg = ctx.createLinearGradient(dx, y, dx, y - dh);
    dg.addColorStop(0, 'rgba(180,170,150,0.55)');
    dg.addColorStop(1, 'rgba(180,170,150,0)');
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.ellipse(dx, y - dh * 0.4, CELL * 0.16, dh * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 飞溅碎石（带旋转的多边形，而非圆点）
  const rocks = 7 + tier;
  for (let i = 0; i < rocks; i++) {
    const seed = (i * 31 + tier * 13) % 89;
    const a = (i / rocks) * Math.PI * 2 + (seed % 11) * 0.05;
    const d = R * (0.35 + (seed % 5) * 0.11) * bloom;
    const rx = x + Math.cos(a) * d;
    const ry = y + Math.sin(a) * d * 0.55 - bloom * CELL * 0.08 * (1 - (i % 3) * 0.3);
    const rr = 2.2 + tier * 0.35 + (seed % 3);
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(a * 2 + p * 4);
    ctx.globalAlpha = vis * (0.5 + (seed % 3) * 0.12) * bloom;
    ctx.fillStyle = i % 2 === 0 ? '#9aa2aa' : '#5f666e';
    ctx.beginPath();
    const verts = 5;
    for (let v = 0; v < verts; v++) {
      const va = (v / verts) * Math.PI * 2;
      const vr = rr * (0.75 + ((seed + v) % 4) * 0.1);
      const vx = Math.cos(va) * vr, vy = Math.sin(va) * vr;
      if (v === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// 流沙 流沙涌：砂雾底盘 + 宽带螺旋沙带 + 扬沙碎屑 + 外甩击退砂柱（纯特效加强，不改数值）
function drawUltLiusha(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.92) * Math.PI);
  const vis = Math.max(fade, life * 0.88);
  const bloom = easeOut(Math.min(1, p / 0.55));
  const spin = p * Math.PI * 3.6;
  const RR = R * (1.08 + tier * 0.04);

  // 地面砂雾（更大更浓）
  ctx.globalAlpha = vis * 0.48 * bloom;
  const sandG = ctx.createRadialGradient(x, y + RR * 0.1, 1, x, y + RR * 0.1, RR * (0.55 + bloom * 0.45));
  sandG.addColorStop(0, 'rgba(240,210,140,0.65)');
  sandG.addColorStop(0.45, 'rgba(200,155,85,0.38)');
  sandG.addColorStop(1, 'rgba(140,100,50,0)');
  ctx.fillStyle = sandG;
  ctx.beginPath();
  ctx.ellipse(x, y + RR * 0.1, RR * (0.62 + bloom * 0.45), RR * (0.26 + bloom * 0.22), 0, 0, Math.PI * 2);
  ctx.fill();

  // 宽带螺旋沙带（5 臂，填充感）
  const arms = 5;
  for (let arm = 0; arm < arms; arm++) {
    const steps = 16;
    const pts: { x: number; y: number; w: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const rad = bloom * RR * (0.12 + t * 0.95);
      const a = arm * ((Math.PI * 2) / arms) + spin * (0.5 + t * 0.5) + t * 2.6;
      pts.push({
        x: x + Math.cos(a) * rad,
        y: y + Math.sin(a) * rad,
        w: (3.6 + tier * 0.4) * (0.35 + t * 0.9),
      });
    }
    ctx.globalAlpha = vis * 0.62;
    ctx.fillStyle = arm % 2 === 0 ? 'rgba(230,190,120,0.62)' : 'rgba(170,125,65,0.52)';
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const nx = i < pts.length - 1 ? pts[i + 1]!.x - pts[i]!.x : pts[i]!.x - pts[i - 1]!.x;
      const ny = i < pts.length - 1 ? pts[i + 1]!.y - pts[i]!.y : pts[i]!.y - pts[i - 1]!.y;
      const nl = Math.hypot(nx, ny) || 1;
      const px = (-ny / nl) * pts[i]!.w;
      const py = (nx / nl) * pts[i]!.w;
      if (i === 0) ctx.moveTo(pts[i]!.x + px, pts[i]!.y + py);
      else ctx.lineTo(pts[i]!.x + px, pts[i]!.y + py);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const nx = i < pts.length - 1 ? pts[i + 1]!.x - pts[i]!.x : pts[i]!.x - pts[i - 1]!.x;
      const ny = i < pts.length - 1 ? pts[i + 1]!.y - pts[i]!.y : pts[i]!.y - pts[i - 1]!.y;
      const nl = Math.hypot(nx, ny) || 1;
      const px = (-ny / nl) * pts[i]!.w;
      const py = (nx / nl) * pts[i]!.w;
      ctx.lineTo(pts[i]!.x - px, pts[i]!.y - py);
    }
    ctx.closePath();
    ctx.fill();
  }

  // 扬沙碎屑（沿涡外甩）
  const grains = 18 + tier * 3;
  for (let i = 0; i < grains; i++) {
    const t = i / grains;
    const rad = bloom * RR * (0.22 + t * 0.85);
    const a = spin * 1.15 + t * 5 + i * 0.55;
    ctx.save();
    ctx.translate(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    ctx.rotate(a + 0.5);
    ctx.globalAlpha = vis * (0.5 + (1 - t) * 0.4);
    ctx.fillStyle = i % 3 === 0 ? 'rgba(245,215,150,0.95)' : i % 2 === 0 ? 'rgba(200,155,90,0.9)' : 'rgba(150,110,55,0.85)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 5.5 + tier * 0.45 + (i % 3), 2.4 + (i % 2), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 外圈击退砂柱（卖出涌浪力度）
  if (bloom > 0.3) {
    const pillars = 12 + tier;
    for (let i = 0; i < pillars; i++) {
      const a = (i / pillars) * Math.PI * 2 + p * 1.8;
      const r0 = RR * (0.42 + bloom * 0.18);
      const r1 = RR * (0.78 + bloom * 0.35);
      ctx.globalAlpha = vis * 0.55 * bloom;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(235,195,120,0.9)' : 'rgba(180,135,70,0.75)';
      ctx.lineWidth = 2.2 + (i % 3) * 0.35;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      ctx.stroke();
    }
  }

  // 中心涌砂核
  ctx.globalAlpha = vis * (0.55 + bloom * 0.3);
  const core = ctx.createRadialGradient(x, y, 1, x, y, CELL * (0.28 + tier * 0.04) * (0.7 + bloom * 0.5));
  core.addColorStop(0, 'rgba(255,230,170,0.85)');
  core.addColorStop(0.5, 'rgba(210,160,90,0.45)');
  core.addColorStop(1, 'rgba(150,100,50,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, CELL * (0.28 + tier * 0.04) * (0.7 + bloom * 0.5), 0, Math.PI * 2);
  ctx.fill();
}

// 梵音 浅润：弱版观音主题——淡紫音环 + 小净瓶轻倾 + 稀疏甘露（规模/亮度均弱于观音）
function drawUltFanyin(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.94) * Math.PI);
  const vis = Math.max(fade, life * 0.82);
  const rise = easeOut(Math.min(1, p / 0.32));
  const bloom = easeOut(Math.min(1, p / 0.55));
  const pour = easeOut(Math.max(0, Math.min(1, (p - 0.22) / 0.45)));
  const rain = easeOut(Math.max(0, Math.min(1, (p - 0.3) / 0.5)));
  const RR = R * (0.85 + tier * 0.015);

  // 淡紫地面润光
  ctx.globalAlpha = vis * 0.4 * bloom;
  const ground = ctx.createRadialGradient(x, y + CELL * 0.08, 1, x, y + CELL * 0.08, RR * 0.7 * bloom);
  ground.addColorStop(0, 'rgba(230,210,255,0.45)');
  ground.addColorStop(0.55, 'rgba(180,170,255,0.18)');
  ground.addColorStop(1, 'rgba(140,140,220,0)');
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.ellipse(x, y + CELL * 0.08, RR * 0.68 * bloom, RR * 0.26 * bloom, 0, 0, Math.PI * 2);
  ctx.fill();

  // 起手淡紫环
  const snap = easeOut(Math.min(1, p / 0.22));
  if (snap < 1) {
    ctx.globalAlpha = vis * (1 - snap) * 0.7;
    ctx.strokeStyle = 'rgba(210,190,255,0.9)';
    ctx.lineWidth = 3.2 + tier * 0.25;
    ctx.beginPath();
    ctx.arc(x, y, snap * RR * 0.42, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 双层音环外扩
  for (let k = 0; k < 2; k++) {
    const pk = Math.max(0, Math.min(1, bloom - k * 0.18));
    if (pk <= 0) continue;
    const rad = easeOut(pk) * RR * (0.4 + k * 0.28);
    ctx.globalAlpha = vis * (0.55 - k * 0.15);
    ctx.strokeStyle = k === 0 ? 'rgba(220,200,255,0.85)' : 'rgba(170,160,240,0.5)';
    ctx.lineWidth = 2.8 - k * 0.5 + tier * 0.1;
    ctx.setLineDash(k === 1 ? [5, 5] : []);
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 小莲台（四瓣，弱于观音六瓣）
  const lotusR = CELL * (0.26 + tier * 0.015) * (0.5 + bloom * 0.5);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + p * 0.2;
    ctx.save();
    ctx.translate(x, y + CELL * 0.04);
    ctx.rotate(a);
    ctx.globalAlpha = vis * (0.35 + bloom * 0.35);
    ctx.fillStyle = 'rgba(210,190,255,0.7)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(lotusR * 0.32, -lotusR * 0.3, 0, -lotusR);
    ctx.quadraticCurveTo(-lotusR * 0.32, -lotusR * 0.3, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 小净瓶轻倾
  const bottleY = y - CELL * (0.4 + rise * 0.25);
  const tilt = -0.35 + pour * 0.7;
  ctx.save();
  ctx.translate(x + Math.sin(tilt) * CELL * 0.05, bottleY);
  ctx.rotate(tilt);
  const bw = CELL * (0.11 + tier * 0.01) * (0.7 + rise * 0.3);
  const bh = CELL * (0.22 + tier * 0.015) * (0.7 + rise * 0.3);
  ctx.globalAlpha = vis * (0.5 + rise * 0.35);
  ctx.fillStyle = 'rgba(190,180,240,0.8)';
  ctx.strokeStyle = 'rgba(230,210,255,0.85)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-bw * 0.3, -bh * 1.1);
  ctx.lineTo(bw * 0.3, -bh * 1.1);
  ctx.lineTo(bw * 0.45, -bh * 0.8);
  ctx.quadraticCurveTo(bw * 0.8, -bh * 0.1, bw * 0.45, bh * 0.5);
  ctx.quadraticCurveTo(0, bh * 0.75, -bw * 0.45, bh * 0.5);
  ctx.quadraticCurveTo(-bw * 0.8, -bh * 0.1, -bw * 0.45, -bh * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(220,200,255,0.85)';
  ctx.fillRect(-bw * 0.18, -bh * 1.28, bw * 0.36, bh * 0.2);
  if (pour > 0.08) {
    ctx.globalAlpha = vis * pour * 0.75;
    ctx.strokeStyle = 'rgba(210,200,255,0.85)';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -bh * 1.0);
    ctx.quadraticCurveTo(bw * 0.45, -bh * 0.15, bw * 0.7, bh * 0.45);
    ctx.stroke();
  }
  ctx.restore();

  // 稀疏淡紫甘露
  const drops = 8 + tier * 2;
  for (let i = 0; i < drops; i++) {
    const seed = (i * 13 + tier * 3) % 71;
    const a = (i / drops) * Math.PI * 2 + seed * 0.015;
    const spread = RR * rain * (0.22 + (seed % 4) * 0.12);
    const dx = x + Math.cos(a) * spread;
    const fall = ((p * 1.5 + i * 0.14) % 1);
    const dy = y - CELL * (0.65 + bloom * 0.15) + fall * CELL * (1.2 + bloom * 0.3);
    const sz = 1.8 + (seed % 3) * 0.45;
    ctx.globalAlpha = vis * rain * (0.4 + (1 - fall) * 0.45);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(210,200,255,0.9)' : 'rgba(230,220,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(dx, dy, sz * 0.5, sz * 1.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 轻涟漪
  if (rain > 0.3) {
    for (let k = 0; k < 2; k++) {
      const pk = Math.max(0, Math.min(1, rain - 0.2 - k * 0.15));
      if (pk <= 0) continue;
      ctx.globalAlpha = vis * (1 - pk) * 0.45;
      ctx.strokeStyle = 'rgba(200,190,255,0.7)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(x, y + CELL * 0.1, easeOut(pk) * RR * (0.3 + k * 0.12), easeOut(pk) * RR * 0.12, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/** 降妖宝杖剪影：前端大月牙铲 + 后端小月牙（开口朝外、凸背贴杆） */
function drawJiangyaoStaffGlyph(
  ctx: CanvasRenderingContext2D,
  len: number,
  tier: number,
  alpha: number,
) {
  const shaftW = 2.2 + tier * 0.35;
  const bladeR = len * 0.28;
  const moonR = bladeR * 0.58;
  const half = len * 0.92;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 木杆
  ctx.strokeStyle = '#6a4a28';
  ctx.lineWidth = shaftW;
  ctx.beginPath();
  ctx.moveTo(-half + moonR * 0.45, 0);
  ctx.lineTo(half - bladeR * 0.35, 0);
  ctx.stroke();
  // 杆身高光
  ctx.strokeStyle = '#c9a86a';
  ctx.lineWidth = Math.max(1, shaftW * 0.35);
  ctx.beginPath();
  ctx.moveTo(-half + moonR * 0.55, -shaftW * 0.15);
  ctx.lineTo(half - bladeR * 0.45, -shaftW * 0.15);
  ctx.stroke();

  // 前端：大月牙铲（开口朝外）
  ctx.save();
  ctx.translate(half - bladeR * 0.15, 0);
  ctx.strokeStyle = '#d8e0ea';
  ctx.fillStyle = 'rgba(190,205,220,0.85)';
  ctx.lineWidth = 1.6 + tier * 0.25;
  ctx.beginPath();
  ctx.arc(0, 0, bladeR, -Math.PI * 0.72, Math.PI * 0.72);
  ctx.arc(bladeR * 0.22, 0, bladeR * 0.62, Math.PI * 0.68, -Math.PI * 0.68, true);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#f2f6ff';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(0, 0, bladeR * 0.92, -Math.PI * 0.55, Math.PI * 0.55);
  ctx.stroke();
  ctx.restore();

  // 后端：扁月牙 `)` —— 开口朝外（左）、凸背贴杆（右）；锐角尖 + miter
  ctx.save();
  ctx.translate(-half + moonR * 0.18, 0);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 14;
  ctx.strokeStyle = '#d8e0ea';
  ctx.fillStyle = 'rgba(190,205,220,0.92)';
  ctx.lineWidth = 1.1 + tier * 0.15;
  const R = moonR * 1.02;
  const tipX = -R * 0.95;       // 尖在外侧（开口端）
  const tipY = R * 0.52;        // 扁：上下尖距短
  const backX = R * 0.38;       // 凸背靠杆
  // 内凹控制点须在 tip 右侧（更靠杆），否则凹口会翻到尖外
  const innerX = -R * 0.42;
  ctx.beginPath();
  ctx.moveTo(tipX, -tipY);                                            // 上尖
  ctx.lineTo(-R * 0.12, -R * 0.28);                                    // 上背肩
  ctx.quadraticCurveTo(backX, 0, -R * 0.12, R * 0.28);                 // 凸背朝杆
  ctx.lineTo(tipX, tipY);                                             // 下尖
  ctx.lineTo(-R * 0.62, R * 0.18);                                     // 下内肩（尖与背之间）
  ctx.quadraticCurveTo(innerX, 0, -R * 0.62, -R * 0.18);               // 凹口朝外
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 刃口高光贴凸背
  ctx.strokeStyle = '#f2f6ff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-R * 0.08, -R * 0.18);
  ctx.quadraticCurveTo(R * 0.18, 0, -R * 0.08, R * 0.18);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

/** 龙爪掌形：掌垫 + 三根内勾尖爪（白龙普攻/大招） */
function drawDragonClawGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  tier: number,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 掌垫（银白）
  ctx.fillStyle = 'rgba(210,225,245,0.55)';
  ctx.strokeStyle = 'rgba(170,195,230,0.7)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, size * 0.28, size * 0.48, size * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 三根内勾尖爪：根宽尖细、外撇再向内钩
  const claws: Array<{ bx: number; midX: number; midY: number; tipX: number; tipY: number; w: number }> = [
    { bx: -size * 0.32, midX: -size * 0.62, midY: -size * 0.35, tipX: -size * 0.28, tipY: -size * 1.05, w: size * 0.11 },
    { bx: 0, midX: size * 0.08, midY: -size * 0.48, tipX: size * 0.02, tipY: -size * 1.22, w: size * 0.13 },
    { bx: size * 0.32, midX: size * 0.62, midY: -size * 0.35, tipX: size * 0.28, tipY: -size * 1.05, w: size * 0.11 },
  ];
  for (const c of claws) {
    // 爪身填充
    ctx.fillStyle = 'rgba(235,245,255,0.95)';
    ctx.strokeStyle = 'rgba(140,170,210,0.85)';
    ctx.lineWidth = 1 + tier * 0.1;
    ctx.beginPath();
    ctx.moveTo(c.bx - c.w, size * 0.18);
    ctx.quadraticCurveTo(c.midX - c.w * 0.6, c.midY, c.tipX, c.tipY);
    ctx.quadraticCurveTo(c.midX + c.w * 0.6, c.midY, c.bx + c.w, size * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 爪尖高光
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.3 + tier * 0.1;
    ctx.beginPath();
    ctx.moveTo(c.bx * 0.4 + c.midX * 0.6, c.midY * 0.55);
    ctx.quadraticCurveTo(c.midX, c.midY, c.tipX, c.tipY);
    ctx.stroke();
  }
  // 小拇指爪（更短，增强掌感）
  ctx.fillStyle = 'rgba(220,235,250,0.8)';
  ctx.beginPath();
  ctx.moveTo(size * 0.42, size * 0.15);
  ctx.quadraticCurveTo(size * 0.72, size * 0.02, size * 0.55, -size * 0.35);
  ctx.quadraticCurveTo(size * 0.58, size * 0.05, size * 0.48, size * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 白龙 龙牙突进：大爪快速连抓两下（左下→右上，再右上→左下）
function drawUltBailong(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, fade: number, tier: number, R: number) {
  const life = Math.sin(Math.min(1, p / 0.95) * Math.PI);
  const vis = Math.max(fade, life * 0.85);

  // 两段抓击：0~0.38 第一下；0.38~0.48 收回；0.48~0.92 第二下
  const swipeLocal = (start: number, end: number) => {
    const t = Math.max(0, Math.min(1, (p - start) / Math.max(0.001, end - start)));
    // 前段加速抓入，后段略停顿
    return t < 0.7 ? easeIn(t / 0.7) : 1;
  };
  const s1 = swipeLocal(0.02, 0.36);
  const s2 = swipeLocal(0.46, 0.86);
  const retract = easeOut(Math.max(0, Math.min(1, (p - 0.34) / 0.12)));
  const inSecond = p >= 0.46;

  // 地面撕扯痕迹（两下叠加）
  const scarBloom = Math.max(s1, s2 * 0.9);
  if (scarBloom > 0.05) {
    ctx.globalAlpha = vis * 0.35 * scarBloom;
    const scar = ctx.createRadialGradient(x, y, 1, x, y, R * 0.55 * scarBloom);
    scar.addColorStop(0, 'rgba(210,230,255,0.45)');
    scar.addColorStop(1, 'rgba(150,180,220,0)');
    ctx.fillStyle = scar;
    ctx.beginPath();
    ctx.ellipse(x, y + CELL * 0.06, R * 0.55 * scarBloom, R * 0.22 * scarBloom, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const drawSwipe = (
    progress: number,
    dir: 1 | -1,
    sizeMul: number,
    alphaMul: number,
  ) => {
    if (progress <= 0.01) return;
    const swing = dir * (-0.85 + easeOut(progress) * 1.7);
    const claw = R * (0.48 + progress * 0.22) * sizeMul;
    ctx.save();
    ctx.translate(
      x + Math.sin(swing) * R * 0.22 * dir,
      y - R * 0.08 + (1 - progress) * CELL * 0.12,
    );
    ctx.rotate(swing * 0.42);
    ctx.scale(dir, 1);

    // 挥爪残影弧
    if (progress > 0.12) {
      ctx.globalAlpha = vis * 0.4 * progress * alphaMul;
      ctx.strokeStyle = 'rgba(200,225,255,0.85)';
      ctx.lineWidth = 3.2 + tier * 0.35;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, claw * 0.95, -Math.PI * 0.9, -Math.PI * 0.9 + progress * Math.PI * 0.85);
      ctx.stroke();
      // 第二道淡残影
      ctx.globalAlpha = vis * 0.2 * progress * alphaMul;
      ctx.lineWidth = 5 + tier * 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, claw * 1.05, -Math.PI * 0.95, -Math.PI * 0.95 + progress * Math.PI * 0.7);
      ctx.stroke();
    }

    drawDragonClawGlyph(ctx, claw, tier, vis * (0.55 + progress * 0.45) * alphaMul);

    // 抓中闪光
    if (progress > 0.55) {
      const bp = (progress - 0.55) / 0.45;
      ctx.globalAlpha = (1 - bp) * vis * 0.85 * alphaMul;
      const g = ctx.createRadialGradient(0, -claw * 0.65, 1, 0, -claw * 0.65, CELL * (0.28 + bp * 0.2));
      g.addColorStop(0, 'rgba(240,250,255,0.95)');
      g.addColorStop(0.5, 'rgba(180,210,245,0.45)');
      g.addColorStop(1, 'rgba(150,190,230,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -claw * 0.65, CELL * (0.28 + bp * 0.2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  // 第一爪：左侧扫入（略小略快）
  if (p < 0.48) {
    drawSwipe(s1 * (p < 0.36 ? 1 : Math.max(0.15, 1 - retract)), 1, 1.05, p < 0.36 ? 1 : 1 - retract * 0.6);
  }
  // 第二爪：反向回抓（更大更重）
  if (inSecond) {
    drawSwipe(s2, -1, 1.2, 1);
  }

  // 两下抓击的冲击环
  for (const [hitAt, strength] of [[0.32, 0.85], [0.72, 1]] as const) {
    const ht = Math.max(0, Math.min(1, (p - hitAt) / 0.18));
    if (ht <= 0 || ht >= 1) continue;
    ctx.globalAlpha = vis * (1 - ht) * 0.7 * strength;
    ctx.strokeStyle = 'rgba(220,240,255,0.9)';
    ctx.lineWidth = 3.5 * strength;
    ctx.beginPath();
    ctx.arc(x, y, easeOut(ht) * R * (0.35 + strength * 0.2), 0, Math.PI * 2);
    ctx.stroke();
  }

  // 爪痕飞屑
  const shred = Math.max(s1, s2);
  if (shred > 0.2) {
    const n = 8 + tier;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + p * 3;
      const t = Math.min(1, shred * (0.6 + (i % 3) * 0.15));
      const dist = R * t * (0.25 + (i % 4) * 0.08);
      ctx.globalAlpha = vis * (1 - t) * 0.7;
      ctx.fillStyle = i % 2 === 0 ? '#e8f2ff' : '#b8d0f0';
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * dist, y + Math.sin(a) * dist * 0.7, 1.4 + (i % 3) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// 击杀蟠桃飘字：头上 桃图+N（+N 字号更小），升空不透明，过顶后按下落进度淡出
function drawPeachFloats(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const p of b.peachFloats) {
    const { x, y: cy } = cellCenterPx(p.c, p.r);
    const y = cy + p.y * CELL;
    const fallProgress = p.y >= p.peakY ? (p.y - p.peakY) / PEACH_FLOAT_FALL : 0;
    const alpha = 1 - Math.min(1, Math.max(0, fallProgress));
    const num = `+${p.amount}`;
    const peachSize = Math.round(CELL * 0.42);
    const numPx = Math.round(CELL * 0.28);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${numPx}px "PingFang SC", sans-serif`;
    const numW = ctx.measureText(num).width;
    const gap = 2;
    const totalW = peachSize + gap + numW;
    const left = x - totalW / 2;
    drawPeachIcon(ctx, left + peachSize / 2, y, peachSize);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20,16,12,0.85)';
    ctx.fillStyle = '#fffef6';
    ctx.textAlign = 'left';
    ctx.font = `bold ${numPx}px "PingFang SC", sans-serif`;
    ctx.strokeText(num, left + peachSize + gap, y);
    ctx.fillText(num, left + peachSize + gap, y);
    ctx.restore();
  }
}

function drawUnits(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  const t = performance.now() / 1000;
  for (const u of b.units.values()) {
    if (ui.dragFrom && ui.dragFrom.c === u.cell.c && ui.dragFrom.r === u.cell.r) continue; // 拖拽中隐藏原位
    const { x, y } = cellCenterPx(u.cell.c, u.cell.r);
    const drop = placeDropMotion(b, 'player', u.cell.c, u.cell.r);
    if (!drop.visible) continue;
    const drawTier = drop.holdTier ?? u.tier;
    const fallen = u.knockdownT > 0;
    // 地面阴影（贴格底略偏前，不随 bob/开火上跳，与怪物同风格）
    drawGroundShadow(ctx, x, y + CELL * 0.06 + drop.dy, CELL * 0.28, fallen ? 0.18 : 0.28);
    // 待机微动：轻微起伏，按格错相位避免整齐划一，让在场武器"活"起来（倒下时停 bob）
    const bob = fallen ? 0 : Math.sin(t * 2 + (u.cell.c * 0.9 + u.cell.r * 1.7)) * 1.3;
    // 开火脉冲：放大 + 上跳
    const pulse = fallen ? 0 : u.firePulse;
    const uy = y + drop.dy - pulse * 4 + bob;
    const unitSize = CELL * 0.72 * (1 + pulse * 0.16) * drop.scale;
    drawUnit(
      ctx,
      u.type,
      drawTier,
      x,
      uy,
      unitSize,
      u.fireDir != null && Math.cos(u.fireDir) < 0,
      { x, y: y + drop.dy, s: CELL * 0.72 * drop.scale },
      fallen,
    );
    // 攻击瞬间：字→兵器形变，朝目标出招（倒下时不画）
    if (!fallen) drawUnitWeapon(ctx, u.type, drawTier, x, uy, u.fireDir ?? -Math.PI / 2, pulse, u.combo);
    // 减益标识：深色芯片（去掉立绘底色后仍清晰）
    const statuses = unitStatusItems(u);
    if (statuses.length > 0) {
      ctx.save();
      if (u.stunT > 0 && !fallen) {
        // 眩晕：整格泛黄闪烁
        ctx.globalAlpha = 0.3 + 0.2 * Math.sin(u.stunT * 12);
        roundRect(ctx, x - CELL * 0.36, y - CELL * 0.36, CELL * 0.72, CELL * 0.72, 8);
        ctx.fillStyle = SKILL_META.stun.color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (fallen) {
        // 倒下：地面尘土感
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(u.knockdownT * 8);
        ctx.fillStyle = UNIT_STATUS_META.knockdown.color;
        ctx.beginPath();
        ctx.ellipse(x, y + CELL * 0.28, CELL * 0.32, CELL * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      drawStatusRow(ctx, x, y - CELL * 0.42, statuses, 8);
      ctx.restore();
    }
  }
}

// —— 武将信息面板高度布局（纯函数，单测见 tests/general-panel-layout.test.ts）——
// 内容栈（相对面板顶 y）：标题18 / 副行34 / 技能名52 / 描述68+descExtra；羁绊详情占 84/98
// 两行、属性行起点 statTop 随之推后 24；神兵行再推后 16。高度必须盖住最后一行（芯片半高 8px）
// 并留出底边距——旧实现基础余量仅 ~3px、羁绊只给 ph 补 18（statTop 却 +24，净溢出 3px），
// 增益行（炼丹/仙丹/风火轮）一多底部就贴边甚至超出面板边框。
export const GENERAL_PANEL_STAT_TOP_BASE = 90;
export interface GeneralPanelOpts {
  active: boolean;
  /** 增益/羁绊文字行数（battleBuffLines） */
  buffCount?: number;
  /** 仙丹/风火轮芯片行数（pillBuffEntries） */
  pillCount?: number;
  /** 技能描述折行多出的高度（每多一行 15px） */
  descExtra?: number;
  showBondDetail?: boolean;
  equippedWeapon?: boolean;
  /** 未激活：可搭子数量（>1 时加宽面板放提示） */
  inactivePartners?: number;
  /** 未激活：底部提示文案所需最小面板宽 */
  hintMinW?: number;
}
export function generalPanelMetrics(o: GeneralPanelOpts): { pw: number; ph: number; statTop: number } {
  const pills = o.pillCount ?? 0;
  const buffs = o.buffCount ?? 0;
  const descExtra = o.descExtra ?? 0;
  const statTop = GENERAL_PANEL_STAT_TOP_BASE
    + (o.showBondDetail ? 24 : 0) + (o.equippedWeapon ? 16 : 0) + descExtra;
  const rowN = (o.active ? 7 : 5) + buffs + pills;
  const rowsEnd = statTop + rowN * 16;
  // 激活：底边距 10（保证末行芯片底距面板底 ≥18px）；未激活：底部还要画一行橙色提示，再多留一行高
  const ph = rowsEnd + (o.active ? 10 : 22);
  const pw = o.active
    ? (pills > 0 ? 210 : 194)
    : Math.max(194, (o.inactivePartners ?? 0) > 1 ? 248 : 194, o.hintMinW ?? 0);
  return { pw, ph, statTop };
}

// 选中单位：攻击范围高亮 + 信息面板（点击某武器才显示，参考竞品单位面板）
// 点击字牌：高亮该字牌；若已激活则双字同时选中，并画攻击范围与武将信息面板
// panelHalf: tips 放哪半场（选中玩家单位→ai 半场；选中 AI 单位→player 半场，避免挡范围环）
// fromAi: 读 AI 侧激活武将与基础数值（AI 无玩家神兵/功德加成）
function drawWordSelection(
  ctx: CanvasRenderingContext2D,
  b: Battle,
  w: { char: string; general: string; tier: number; cell: { c: number; r: number } },
  panelHalf: 'ai' | 'player' = 'ai',
  fromAi = false,
  fromTray = false,
) {
  const active = fromTray
    ? undefined
    : (fromAi ? b.aiActiveGenerals() : b.activeGenerals()).find((g) =>
      g.cells.some((cc) => cc.c === w.cell.c && cc.r === w.cell.r),
    );
  const def = active?.def ?? primaryGeneralForChar(w.char) ?? generalById(w.general);
  if (!def) return;
  ctx.save();
  if (!fromTray) {
    // 选中格金边：已激活则左右两字同时描边
    const selCells = active ? active.cells : [w.cell];
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffe08a';
    for (const c of selCells) {
      const gx = BOARD_X + c.c * CELL;
      const gy = BOARD_Y + c.r * CELL;
      roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
      ctx.stroke();
    }
    // 激活则画范围环（圆心取双格中点）
    if (active) {
      const ax = (active.cells[0].c + active.cells[1].c) / 2;
      const ay = (active.cells[0].r + active.cells[1].r) / 2;
      const { x, y } = cellCenterPx(ax, ay);
      const rge = fromAi ? generalStat(def, active.tier).rge : b.generalRge(active);
      ctx.beginPath();
      ctx.arc(x, y, (rge + TUNING.rangeTolerance) * CELL, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(240,185,60,0.12)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(240,185,60,0.8)';
      ctx.setLineDash([7, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.restore();

  // 信息面板：放在另一半场中央，避免遮住攻击范围环
  const showBondDetail = !fromAi && active && def.id === BOND_GENERAL && b.bondActive();
  const buffLines = !fromAi && active
    ? battleBuffLines(b, 'general', undefined, 'player', active)
      .filter((line) => !(showBondDetail && line.startsWith('🐵')))
    : [];
  const pills = active ? pillBuffEntries({ general: active }) : [];
  const equippedWeapon = !fromAi ? generalEquippedWeapon(def.id, b.weaponBonuses[def.id]) : null;
  const inactivePartners = !active ? sortedPartnerChars(w.char) : [];
  const inactiveHint = !active ? inactivePartnerHint(w.char, fromTray) : '';
  ctx.font = '12px "PingFang SC", sans-serif';
  const hintMinW = inactiveHint ? ctx.measureText(inactiveHint).width + 24 : 0;
  // 面板宽度先算（描述折行依赖可用宽），再算高度/属性行起点（见 generalPanelMetrics 注释）
  const { pw } = generalPanelMetrics({ active: !!active, pillCount: pills.length, inactivePartners: inactivePartners.length, hintMinW });
  // 技能描述按面板可用宽度自动换行（如文殊「缩短其他武将大招与兵器攻击剩余冷却」超一行），
  // 多出的行高 descExtra 要顺移下方所有行并计入面板高度 ph，避免溢出弹窗。
  const skillDescLines = wrapText(ctx, def.skillDesc, pw - 24);
  const descExtra = (skillDescLines.length - 1) * 15;
  // 激活多「大招」+「经验」；未激活也展示配置 CD
  const { ph, statTop } = generalPanelMetrics({
    active: !!active, pillCount: pills.length, buffCount: buffLines.length, descExtra,
    showBondDetail, equippedWeapon: !!equippedWeapon,
  });
  const px = BOARD_X + (COLS * CELL) / 2 - pw / 2;
  const py = infoPanelTop(ph, panelHalf);
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
  // 标题：左名右阶；次行攻击方式
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffe6b0';
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText(def.name, px + 12, py + 18);
  ctx.textAlign = 'right';
  ctx.fillStyle = qualityColor(w.tier);
  ctx.font = 'bold 12px "PingFang SC", sans-serif';
  ctx.fillText(`${qualityName(w.tier)}阶 · ${def.rank} · ${def.role}`, px + pw - 12, py + 18);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,230,176,0.82)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(`${def.atkStyle} · 满级${def.maxTier}`, px + 12, py + 34);
  // 技能（未激活时置灰）
  ctx.fillStyle = active ? '#9ad8ff' : 'rgba(154,216,255,0.4)';
  ctx.fillText(`技能「${def.skillName}」`, px + 12, py + 52);
  ctx.fillStyle = active ? 'rgba(255,240,210,0.7)' : 'rgba(255,240,210,0.32)';
  skillDescLines.forEach((ln, i) => ctx.fillText(ln, px + 12, py + 68 + i * 15));
  if (showBondDetail) {
    ctx.fillStyle = '#f0c860';
    ctx.fillText(`羁绊「${BOND_NAME}」`, px + 12, py + 84 + descExtra);
    ctx.fillStyle = 'rgba(255,240,210,0.75)';
    ctx.fillText(`大圣激活·全队攻击${bondAtkPctLabel()}`, px + 12, py + 98 + descExtra);
  }
  // 神兵行画在属性行起点上方 16px（有神兵时 statTop 已含这 16px，见 generalPanelMetrics）
  let weaponRowY = statTop - 16;
  if (equippedWeapon) {
    const { def: wdef, tier } = equippedWeapon;
    ctx.textAlign = 'left';
    ctx.fillStyle = weaponQualityColor(tier);
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText(`神兵「${wdef.name}」品质·${weaponQualityName(tier)}阶`, px + 12, weaponRowY);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,240,210,0.82)';
    ctx.fillText(weaponBonusLabel(wdef.stat, tier), px + pw - 12, weaponRowY);
    weaponRowY += 16;
  }
  // 属性（激活时计入等级/神兵；AI 侧用基础数值）
  // 「范围」= 普攻与对怪大招共用的射程环；「大招CD」= skillCd（激活时附剩余）
  // statTop 由 generalPanelMetrics 统一给出（含羁绊/神兵/描述折行的顺移）
  const skillCdText = (() => {
    if (def.skill === 'none' || def.skillCd <= 0) return '无';
    if (!active) return `${def.skillCd}s`;
    const rem = active.state.skillCd;
    if (rem <= 0) return `就绪 · ${def.skillCd}s`;
    return `${Math.ceil(rem)}s / ${def.skillCd}s`;
  })();
  const expText = (() => {
    if (!active) return '';
    if (active.tier >= def.maxTier) return '满级';
    const need = Battle.expToNext(active.state.level, def);
    const cur = Math.max(0, Math.min(need, active.state.exp));
    return `${cur.toFixed(1)} / ${need.toFixed(1)}`;
  })();
  const rows: [string, string][] = active
    ? fromAi
      ? (() => {
          const st = generalStat(def, active.tier);
          return [
            ['攻击力', damage(st.atk).toFixed(2)],
            ['攻速', `${st.frq.toFixed(2)}/s`],
            ['范围', st.rge.toFixed(1)],
            ['目标数', def.targets.toFixed(1)],
            ['大招', skillCdText],
            ['等级', `Lv.${active.state.level}`],
            ['经验', expText],
          ];
        })()
      : [
          ['攻击力', damage(b.generalAtk(active)).toFixed(2)],
          ['攻速', `${b.generalFrq(active).toFixed(2)}/s`],
          ['范围', b.generalRge(active).toFixed(1)],
          ['目标数', def.targets.toFixed(1)],
          ['大招', skillCdText],
          ['等级', `Lv.${active.state.level}`],
          ['经验', expText],
        ]
    : [
        ['基础攻击', def.atk.toFixed(1)],
        ['攻速', `${def.frq.toFixed(1)}/s`],
        ['范围', def.rge.toFixed(1)],
        ['目标数', def.targets.toFixed(1)],
        ['大招', skillCdText],
      ];
  ctx.font = '13px "PingFang SC", sans-serif';
  let ry = py + statTop;
  for (const [k, v] of rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,240,210,0.7)';
    ctx.fillText(k, px + 12, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff6e6';
    ctx.fillText(v, px + pw - 12, ry);
    ry += 16;
  }
  for (const line of buffLines) {
    const isBond = line.startsWith('🐵');
    ctx.textAlign = 'left';
    ctx.fillStyle = isBond ? '#f0c860' : '#a0e8b0';
    ctx.fillText(isBond ? '羁绊' : '增益', px + 12, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = isBond ? '#ffe8a0' : '#c8ffd8';
    ctx.fillText(line, px + pw - 12, ry);
    ry += 16;
  }
  ry = drawPillBuffRows(ctx, px, pw, ry, pills);
  // 底部状态提示
  ctx.textAlign = 'left';
  if (!active) {
    ctx.fillStyle = '#ff9a6a';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText(inactivePartnerHint(w.char, fromTray), px + 12, py + ph - 10);
  }
  ctx.restore();
}


function drawRangeRing(ctx: CanvasRenderingContext2D, x: number, y: number, rangeCells: number) {
  ctx.save();
  ctx.beginPath();
  // 显示半径 = (基础射程 + 命中宽容) * CELL，与战斗判定 (d <= rge + rangeTolerance) 完全一致。
  // 否则 rge=1 的近战只画到相邻格中心(半格)，实际能打到相邻格(含斜角≈1.414)，显示会偏小。
  ctx.arc(x, y, (rangeCells + TUNING.rangeTolerance) * CELL, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(90,150,70,0.16)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(120,200,90,0.85)';
  ctx.setLineDash([7, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/** 点击是否命中我方唐僧（归位格或入场途中当前格） */
export function isPlayerTangsengCell(b: Battle, cell: Cell): boolean {
  const home = b.map.tangseng;
  if (home.c === cell.c && home.r === cell.r) return true;
  const pos = b.tangsengRenderPos();
  return pos.c === cell.c && pos.r === cell.r;
}

/** 点击是否命中 AI 唐僧（无尽模式无对手） */
export function isAiTangsengCell(b: Battle, cell: Cell): boolean {
  if (b.endless) return false;
  const home = b.aiTangseng;
  if (home.c === cell.c && home.r === cell.r) return true;
  const pos = b.aiTangsengRenderPos();
  return pos.c === cell.c && pos.r === cell.r;
}

/** 妖怪点击命中半径（略大于立绘，便于点选） */
function monsterHitRad(m: Monster): number {
  const base = m.isBoss ? CELL * 0.42 : m.isMiniBoss ? CELL * 0.36 : CELL * 0.28;
  return base * 1.35;
}

/** 像素命中双方妖怪：取最近者；无尽模式无 AI 怪 */
export function hitMonsterAt(b: Battle, x: number, y: number): { side: 'player' | 'ai'; id: number } | null {
  let bestId = -1;
  let bestSide: 'player' | 'ai' = 'player';
  let bestD2 = Infinity;
  const consider = (m: Monster, side: 'player' | 'ai') => {
    const p = side === 'player' ? posAtDistance(b.map, m.dist) : b.aiMonsterPos(m);
    const { x: mx, y: my } = cellCenterPx(p.c, p.r);
    const rad = monsterHitRad(m);
    const d2 = (x - mx) * (x - mx) + (y - my) * (y - my);
    if (d2 > rad * rad || d2 >= bestD2) return;
    bestD2 = d2;
    bestId = m.id;
    bestSide = side;
  };
  for (const m of b.monsters) consider(m, 'player');
  if (!b.endless) for (const m of b.aiMonsters) consider(m, 'ai');
  if (bestId < 0) return null;
  return { side: bestSide, id: bestId };
}

function monsterKindLabel(m: Monster): string {
  if (m.isBoss) return '妖王';
  if (m.isMiniBoss && m.miniBossKind) return MINI_BOSS_META[m.miniBossKind].name;
  if (m.isCavalry) return '骑兵妖';
  if (m.skill) return '精英妖';
  return '小妖';
}

function drawSelection(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (ui.selectedMonster) {
    drawMonsterSelection(ctx, b, ui.selectedMonster);
    return;
  }
  if (ui.selectedTrayIndex !== null) {
    const token = b.tray[ui.selectedTrayIndex];
    if (token?.kind === 'word') {
      drawWordSelection(
        ctx,
        b,
        { char: token.char, general: token.general, tier: token.tier, cell: { c: -1, r: -1 } },
        'ai',
        false,
        true,
      );
      return;
    }
  }
  if (!ui.selected) return;
  // 唐僧优先：路径终点格上可能无单位，但仍可查看 tips
  if (isPlayerTangsengCell(b, ui.selected)) { drawTangsengSelection(ctx, b, 'player'); return; }
  if (isAiTangsengCell(b, ui.selected)) { drawTangsengSelection(ctx, b, 'ai'); return; }
  const tree = b.trees.get(`${ui.selected.c},${ui.selected.r}`);
  if (tree) { drawTreeSelection(ctx, b, tree); return; }
  const w = b.words.get(`${ui.selected.c},${ui.selected.r}`);
  if (w) { drawWordSelection(ctx, b, w, 'ai'); return; }
  const u = b.units.get(`${ui.selected.c},${ui.selected.r}`);
  if (u) {
    const { x, y } = cellCenterPx(u.cell.c, u.cell.r);
    const stat = getUnitStat(u.type, u.tier);
    drawRangeRing(ctx, x, y, stat.rge);
    ctx.save();
    const gx = BOARD_X + u.cell.c * CELL;
    const gy = BOARD_Y + u.cell.r * CELL;
    roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffe08a';
    ctx.stroke();
    ctx.restore();
    // 玩家单位：面板放 AI 半场，避免挡自己的范围环
    drawUnitInfoPanel(ctx, u.type, u.tier, 'ai', { unit: u, b });
    return;
  }
  // AI 侧单位 / 字牌
  const aiU = b.aiUnits.find((x) => x.cell.c === ui.selected!.c && x.cell.r === ui.selected!.r);
  if (aiU) {
    const { x, y } = cellCenterPx(aiU.cell.c, aiU.cell.r);
    const stat = getUnitStat(aiU.type, aiU.tier);
    drawRangeRing(ctx, x, y, stat.rge);
    ctx.save();
    const gx = BOARD_X + aiU.cell.c * CELL;
    const gy = BOARD_Y + aiU.cell.r * CELL;
    roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffe08a';
    ctx.stroke();
    ctx.restore();
    // AI 单位：面板放玩家半场，避免挡 AI 侧范围环
    drawUnitInfoPanel(ctx, aiU.type, aiU.tier, 'player', { unit: aiU, b });
    return;
  }
  const aiW = b.aiWords.get(`${ui.selected.c},${ui.selected.r}`);
  if (aiW) { drawWordSelection(ctx, b, aiW, 'player', true); return; }
}

/** 选中妖怪：金色描边环 + tips（血量/种类/技能/状态） */
function drawMonsterSelection(
  ctx: CanvasRenderingContext2D,
  b: Battle,
  sel: { side: 'player' | 'ai'; id: number },
) {
  const list = sel.side === 'player' ? b.monsters : b.aiMonsters;
  const m = list.find((x) => x.id === sel.id);
  if (!m) return;
  const p = sel.side === 'player' ? posAtDistance(b.map, m.dist) : b.aiMonsterPos(m);
  const { x, y } = cellCenterPx(p.c, p.r);
  const rad = monsterHitRad(m) / 1.35;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, rad + 6, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffe08a';
  ctx.stroke();
  ctx.restore();

  const mini = m.isMiniBoss && m.miniBossKind ? MINI_BOSS_META[m.miniBossKind] : null;
  const skill = m.skill ? SKILL_META[m.skill] : null;
  const statusEntries = monsterStatusEntries(m);
  const buffLines = battleBuffLines(b, 'monster', m, sel.side);
  const panelHalf: 'ai' | 'player' = sel.side === 'player' ? 'ai' : 'player';
  const pw = 200;
  const extraRows = (statusEntries.length > 0 ? 1 : 0) + buffLines.length;
  const ph = (mini || skill ? 148 : 118) + extraRows * 17;
  const px = BOARD_X + (COLS * CELL) / 2 - pw / 2;
  const py = infoPanelTop(ph, panelHalf);
  ctx.save();
  const K = 1.4, pcx = px + pw / 2, pcy = py + ph / 2;
  ctx.translate(pcx, pcy); ctx.scale(K, K); ctx.translate(-pcx, -pcy);
  roundRect(ctx, px, py, pw, ph, 10);
  ctx.fillStyle = 'rgba(28,22,14,0.94)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = m.isBoss ? '#ff5a8a' : mini ? mini.color : skill ? skill.color : '#c8792b';
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffe6b0';
  ctx.font = 'bold 17px "PingFang SC", sans-serif';
  ctx.fillText(monsterKindLabel(m), px + 12, py + 18);
  ctx.textAlign = 'right';
  ctx.fillStyle = sel.side === 'player' ? '#9ad8ff' : '#ff9a6a';
  ctx.font = 'bold 13px "PingFang SC", sans-serif';
  ctx.fillText(sel.side === 'player' ? '我方路' : '对方路', px + pw - 12, py + 18);

  const rows: [string, string][] = [
    ['生命', `${Math.ceil(m.hp)} / ${Math.ceil(m.maxHp)}`],
    ['移速', `${m.spd.toFixed(2)} 格/s`],
  ];
  if (mini) {
    rows.push(['光环', `${mini.skillName}·${mini.desc}`]);
  } else if (skill) {
    rows.push(['技能', `${skill.icon}${skill.name}`]);
  } else {
    rows.push(['技能', '无']);
  }
  if (m.isCavalry) rows.push(['特性', '骑兵·移速翻倍·薄血']);
  if (statusEntries.length > 0) {
    rows.push(['状态', formatStatusLine(statusEntries)]);
  }
  for (const line of buffLines) {
    rows.push(['增益', line]);
  }
  ctx.font = '13px "PingFang SC", sans-serif';
  let ry = py + 42;
  for (const [k, v] of rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = k === '状态' ? '#ffb0a0' : k === '增益' ? '#a0e8b0' : 'rgba(255,240,210,0.7)';
    ctx.fillText(k, px + 12, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = k === '状态' ? '#ffd0c0' : k === '增益' ? '#c8ffd8' : '#fff6e6';
    const shown = k === '状态' || k === '增益' ? v : v.length > 14 ? `${v.slice(0, 13)}…` : v;
    ctx.fillText(shown, px + pw - 12, ry);
    ry += 17;
  }
  ctx.restore();
}

/** 选中唐僧：高亮当前所在格 + tips（无攻击范围） */
function drawTangsengSelection(ctx: CanvasRenderingContext2D, b: Battle, side: 'player' | 'ai') {
  const pos = side === 'player' ? b.tangsengRenderPos() : b.aiTangsengRenderPos();
  const hp = side === 'player' ? b.tangsengHP : b.aiTangsengHP;
  const defeated = side === 'ai' && b.aiDefeated;
  const panelHalf: 'ai' | 'player' = side === 'player' ? 'ai' : 'player';

  ctx.save();
  const gx = BOARD_X + pos.c * CELL;
  const gy = BOARD_Y + pos.r * CELL;
  roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffe08a';
  ctx.stroke();
  ctx.restore();

  const pw = 194;
  const ph = 118;
  const px = BOARD_X + (COLS * CELL) / 2 - pw / 2;
  const py = infoPanelTop(ph, panelHalf);
  ctx.save();
  const K = 1.4, pcx = px + pw / 2, pcy = py + ph / 2;
  ctx.translate(pcx, pcy); ctx.scale(K, K); ctx.translate(-pcx, -pcy);
  roundRect(ctx, px, py, pw, ph, 10);
  ctx.fillStyle = 'rgba(28,22,14,0.94)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#f0b93c';
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffe6b0';
  ctx.font = 'bold 17px "PingFang SC", sans-serif';
  ctx.fillText('唐僧', px + 12, py + 18);
  ctx.textAlign = 'right';
  ctx.fillStyle = side === 'player' ? '#9ad8ff' : '#ff9a6a';
  ctx.font = 'bold 13px "PingFang SC", sans-serif';
  ctx.fillText(side === 'player' ? '我方' : '对方', px + pw - 12, py + 18);
  const rows: [string, string][] = [
    ['生命', defeated ? '已败' : side === 'player' ? `❤ ${hp} / ${b.tangsengMaxHP}` : `❤ ${hp}`],
    ['身份', '取经目标'],
    ['规则', '妖怪抵达扣 1 心'],
  ];
  ctx.font = '13px "PingFang SC", sans-serif';
  let ry = py + 44;
  for (const [k, v] of rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,240,210,0.7)';
    ctx.fillText(k, px + 12, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff6e6';
    ctx.fillText(v, px + pw - 12, ry);
    ry += 18;
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,240,210,0.55)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(side === 'player' ? '心尽则取经失败' : '对方心尽则我方获胜', px + 12, py + ph - 14);
  ctx.restore();
}

/** tips 面板顶边：AI 半场中央 / 玩家半场中央，避免挡对应侧的范围环 */
function infoPanelTop(ph: number, panelHalf: 'ai' | 'player'): number {
  if (panelHalf === 'ai') {
    return BOARD_Y + (FENCE_ROW * CELL) / 2 - ph / 2;
  }
  return BOARD_Y + ((FENCE_ROW + ROWS) * CELL) / 2 - ph / 2;
}

// 单位信息面板：默认 AI 半场中央；选中 AI 单位时改放玩家半场。
// 供选中棋盘单位、以及 tray 按住武器令牌时复用。
function drawUnitInfoPanel(
  ctx: CanvasRenderingContext2D,
  type: UnitType,
  tier: number,
  panelHalf: 'ai' | 'player' = 'ai',
  opts?: { unit?: PlacedUnit; b?: Battle },
) {
  const cfg = UNITS[type];
  const stat = getUnitStat(type, tier);
  const statusEntries = opts?.unit ? unitStatusEntries(opts.unit) : [];
  const buffLines = opts?.b && opts?.unit ? battleBuffLines(opts.b, 'unit', undefined, 'player', undefined, opts.unit) : [];
  const pills = opts?.unit ? pillBuffEntries({ unit: opts.unit }) : [];
  const extraRows = (statusEntries.length > 0 ? 1 : 0) + buffLines.length + pills.length;
  // 有仙丹/风火轮时略加宽，给「风火轮·攻速+40%」图标行留空；底边多留 6px 避免贴边
  const pw = pills.length > 0 ? 210 : 176;
  const ph = 120 + extraRows * 16 + (pills.length > 0 ? 6 : 0);
  const px = BOARD_X + (COLS * CELL) / 2 - pw / 2;
  const py = infoPanelTop(ph, panelHalf);
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
  ctx.fillText(`Lv.${tier}`, px + pw - 12, py + 18);
  // 属性行
  const rows: [string, string][] = [
    ['攻击力', opts?.b && opts?.unit ? damage(opts.b.unitAtk(opts.unit)).toFixed(2) : damage(stat.atk).toFixed(2)],
    ['攻速', `${stat.frq.toFixed(2)}/s`],
    ['攻击范围', stat.rge.toFixed(1)],
    ['目标数', stat.targets.toFixed(1)],
    ['法宝', cfg.origin],
  ];
  if (statusEntries.length > 0) {
    rows.push(['状态', formatStatusLine(statusEntries)]);
  }
  for (const line of buffLines) {
    rows.push([line.startsWith('🐵') ? '羁绊' : '增益', line]);
  }
  ctx.font = '13px "PingFang SC", sans-serif';
  let ry = py + 40;
  for (const [k, v] of rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = k === '状态' ? '#ffb0a0' : k === '羁绊' ? '#f0c860' : k === '增益' ? '#a0e8b0' : 'rgba(255,240,210,0.7)';
    ctx.fillText(k, px + 12, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = k === '状态' ? '#ffd0c0' : k === '羁绊' ? '#ffe8a0' : k === '增益' ? '#c8ffd8' : '#fff6e6';
    ctx.fillText(v, px + pw - 12, ry);
    ry += 16;
  }
  drawPillBuffRows(ctx, px, pw, ry, pills);
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

// 单棵桃树：树干+树冠矢量，桃子用生成的桃图；越高级树冠越大、桃子越多
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
  // 桃子：数量 = 等级（1..5），用生成的桃图
  const peachN = Math.min(level, PEACH_TREE.maxLevel);
  const pr = s * 0.16;
  for (let i = 0; i < peachN; i++) {
    const a = -Math.PI / 2 + (i - (peachN - 1) / 2) * 0.7;
    const px = x + Math.cos(a) * r * 0.8;
    const py = y + Math.sin(a) * r * 0.8 - s * 0.04;
    drawPeachIcon(ctx, px, py, pr * 2);
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
  const iv = PEACH_TREE.intervals[Math.min(t.level, PEACH_TREE.maxLevel) - 1]!;
  const remain = b.treeCountdown(t);
  const ratio = Math.max(0, Math.min(1, 1 - remain / iv));
  const pw = 220;
  const pad = 12;
  const desc = `每 ${iv}s 产 1 蟠桃 · 同级拖动可合并升级(≤${PEACH_TREE.maxLevel})`;
  ctx.save();
  ctx.font = '12px "PingFang SC", sans-serif';
  const descLines = wrapText(ctx, desc, pw - pad * 2);
  const lineH = 16;
  const ph = 52 + descLines.length * lineH + 44;
  const px = BOARD_X + (COLS * CELL) / 2 - pw / 2;
  const py = BOARD_Y + (FENCE_ROW * CELL) / 2 - ph / 2;
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
  ctx.fillText('蟠桃园·桃树', px + pad, py + 18);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 14px "PingFang SC", sans-serif';
  ctx.fillText(`Lv.${t.level}`, px + pw - pad, py + 18);
  // 说明（换行，避免超出面板）
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,240,210,0.75)';
  ctx.font = '12px "PingFang SC", sans-serif';
  let ty = py + 40;
  for (const ln of descLines) {
    ctx.fillText(ln, px + pad, ty);
    ty += lineH;
  }
  // 产桃进度条
  const bx = px + pad, by = ty + 6, bw = pw - pad * 2, bh = 14;
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

/** 激活武将整体绘制：开火脉冲放大+上跳（与兵器 firePulse 一致） */
function drawActiveGeneralGroup(
  ctx: CanvasRenderingContext2D,
  b: Battle,
  side: 'player' | 'ai',
  g: ActiveGeneral,
  getWord: (c: number, r: number) => { char: string; tier: number } | undefined,
  opts?: { showBondLabel?: boolean },
) {
  const a = cellCenterPx(g.cells[0].c, g.cells[0].r);
  const z = cellCenterPx(g.cells[1].c, g.cells[1].r);
  const cx = (a.x + z.x) / 2;
  const cy = (a.y + z.y) / 2;
  const pulse = g.state.firePulse;

  for (const c of g.cells) {
    const { x, y } = cellCenterPx(c.c, c.r);
    const drop = placeDropMotion(b, side, c.c, c.r);
    if (!drop.visible) continue;
    drawGroundShadow(ctx, x, y + CELL * 0.06 + drop.dy, CELL * 0.32, 0.26);
  }

  ctx.save();
  const jump = pulse * 4;
  const sc = 1 + pulse * 0.16;
  ctx.translate(cx, cy - jump);
  ctx.scale(sc, sc);
  ctx.translate(-cx, -cy);

  // 仅 PvP 对手半场需要：其数据按 180° 镜像重建，横向武将两字左右被对调（大圣→圣·大），
  // 故交换两格所画的字，让名字仍从左到右正常阅读。单机 AI 的字牌本就按显示顺序存放，不能交换
  // （否则反被转成「圣大」）；竖向武将也不处理。
  const mirrorName = side === 'ai' && b.isPvp && g.cells.length === 2 && g.cells[0].r === g.cells[1].r;
  for (let i = 0; i < g.cells.length; i++) {
    const c = g.cells[i];
    const src = mirrorName ? g.cells[g.cells.length - 1 - i] : c; // 取镜像伙伴格的字画在本格位置上
    const w = getWord(src.c, src.r);
    if (!w) continue;
    const { x, y } = cellCenterPx(c.c, c.r);
    const drop = placeDropMotion(b, side, c.c, c.r);
    if (!drop.visible) continue;
    drawWordTile(ctx, w.char, drop.holdTier ?? w.tier, x, y + drop.dy, CELL * 0.78 * drop.scale, false, g.tier);
  }

  const bx = Math.min(a.x, z.x) - CELL / 2 + 2;
  const by = Math.min(a.y, z.y) - CELL / 2 + 2;
  const bw = Math.abs(z.x - a.x) + CELL - 4;
  const bh = CELL - 4;
  ctx.globalAlpha = Math.min(1, 0.95 + g.state.skillFlash * 0.05);
  ctx.strokeStyle = qualityColor(g.tier);
  ctx.lineWidth = 3 + Math.min(2, (g.tier - 1) * 0.5);
  roundRect(ctx, bx, by, bw, bh, 8);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const sTile = CELL * 0.78;
  drawTierBadge(ctx, z.x + sTile * 0.42, z.y - sTile * 0.36, g.tier, Math.round(sTile * 0.3));
  if (opts?.showBondLabel && g.def.id === BOND_GENERAL) {
    const bondCy = Math.min(a.y, z.y) - CELL * 0.44;
    const bondPulse = 0.7 + 0.3 * Math.sin(performance.now() / 220);
    ctx.save();
    ctx.globalAlpha = bondPulse;
    ctx.font = 'bold 10px "PingFang SC", sans-serif';
    const label = BOND_NAME;
    const tw = ctx.measureText(label).width;
    const badgeW = tw + 10;
    roundRect(ctx, cx - badgeW / 2, bondCy - 7, badgeW, 14, 5);
    ctx.fillStyle = 'rgba(200,146,42,0.9)';
    ctx.fill();
    ctx.strokeStyle = '#ffe27a';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff8e8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, bondCy);
    ctx.restore();
  }
  // 武将增益状态图标：老君炼丹（炼）/ 仙丹（丹）/ 风火轮（轮），与兵器侧同一套图标，显示在名号中间上方
  const heroBuffs: { icon: string; color: string }[] = [];
  if ((g.state.buffAtkT ?? 0) > 0) heroBuffs.push({ icon: '炼', color: '#e8a830' });
  if (g.state.pillAtk) heroBuffs.push({ icon: '丹', color: '#ff6040' });
  if (g.state.pillFrq) heroBuffs.push({ icon: '轮', color: '#ffb830' });
  if (heroBuffs.length > 0) {
    // 羁绊武将顶部已有名号徽标，状态图标再上移一档避免遮挡
    const bondOffset = opts?.showBondLabel && g.def.id === BOND_GENERAL ? CELL * 0.2 : 0;
    drawStatusRow(ctx, cx, Math.min(a.y, z.y) - CELL * 0.42 - bondOffset, heroBuffs, 8);
  }
  drawHeroWordWeapon(ctx, g);
  ctx.restore();
  // 武将右下角挂「克/被」小徽章：直接表达与地图的克制关系（不再显示五行字面）。
  // 位置在右侧格右下、避开金框上方的整体 Lv 与顶部 buff 图标；同行/无属性（null）不画；
  // 五行总开关关闭时隐藏。
  if (wuxingEnabled()) {
    const rel = counterRelation(g.def.element, MAP_ELEMENT[b.map.id], TUNING.wuxingAdvMul, TUNING.wuxingDisMul);
    drawCounterBadge(ctx, z.x + CELL * 0.34, z.y + CELL * 0.32, CELL * 0.11, rel);
  }
}

// 棋盘上的武将字牌（各占一格）+ 已激活武将的金色边框与名号
function drawGenerals(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  // 已激活武将占用的格 → 抹掉单字阶数上标（只保留金框上方整体 Lv）；并记下整体阶供字色/加粗
  const activeTier = new Map<string, number>();
  for (const g of b.activeGenerals()) {
    for (const c of g.cells) activeTier.set(`${c.c},${c.r}`, g.tier);
  }
  // 先画未激活字牌（拖拽中的源格隐藏）
  for (const w of b.words.values()) {
    if (ui.dragFrom && ui.dragFrom.c === w.cell.c && ui.dragFrom.r === w.cell.r) continue;
    const key = `${w.cell.c},${w.cell.r}`;
    const qTier = activeTier.get(key) ?? 0;
    if (qTier > 0) continue;
    const { x, y } = cellCenterPx(w.cell.c, w.cell.r);
    const drop = placeDropMotion(b, 'player', w.cell.c, w.cell.r);
    if (!drop.visible) continue;
    drawGroundShadow(ctx, x, y + drop.dy, CELL * 0.32, 0.26);
    drawWordTile(ctx, w.char, drop.holdTier ?? w.tier, x, y + drop.dy, CELL * 0.78 * drop.scale, true, 0);
    drawSleepingZ(ctx, x, y + drop.dy, CELL * 0.78 * drop.scale, performance.now());
  }
  // 激活武将：双字+品质框随 firePulse 放大上跳
  for (const g of b.activeGenerals()) {
    drawActiveGeneralGroup(
      ctx,
      b,
      'player',
      g,
      (c, r) => b.words.get(`${c},${r}`),
      { showBondLabel: true },
    );
  }
}

/** 武将普攻规模：白阶偏小，满阶拉满（过渡将 maxTier=3 也归一化） */
function heroFxScale(tier: number, maxTier: number): number {
  return 0.58 + 0.42 * ((tier - 1) / Math.max(1, maxTier - 1));
}

/** 铁扇/流沙等：沿弹道移动的迷你旋涡 */
function drawHeroFxTornado(
  ctx: CanvasRenderingContext2D,
  ax: number, ay: number, tx: number, ty: number,
  prog: number, tier: number, sc: number, fade: number,
  palette: { stroke: string; debris: string; core: string },
) {
  const cx = ax + (tx - ax) * prog;
  const cy = ay + (ty - ay) * prog;
  const height = CELL * (0.5 + sc * 0.42);
  const arms = 2 + Math.min(2, tier - 1);
  const spins = prog * (4 + tier * 1.5);
  ctx.globalAlpha = fade * (0.45 + sc * 0.45);
  for (let arm = 0; arm < arms; arm++) {
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const yOff = -height * (1 - t);
      const wobble = Math.sin(t * Math.PI * 4 + spins + arm * 2.1) * CELL * (0.08 + sc * 0.06) * (1 - t * 0.5);
      const px = cx + wobble + Math.cos(spins + t * 6 + arm) * CELL * (0.05 + t * 0.12 * sc);
      const py = cy + yOff;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = palette.stroke;
    ctx.lineWidth = 1.5 + tier * 0.35;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  const n = 3 + tier;
  for (let i = 0; i < n; i++) {
    const a = spins * 2 + i * (Math.PI * 2 / n);
    const r = CELL * (0.12 + sc * 0.08);
    ctx.globalAlpha = fade * (0.55 + sc * 0.35);
    ctx.fillStyle = palette.debris;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r * 2, cy - height * 0.4 + Math.sin(a) * r, 2 + tier * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = fade * sc * 0.35;
  ctx.fillStyle = palette.core;
  ctx.beginPath();
  ctx.arc(cx, cy - height * 0.55, CELL * (0.06 + sc * 0.05), 0, Math.PI * 2);
  ctx.fill();
}

/** 铁扇普攻：疾风刃掠过（弯月气刃 + 风纹尾迹 + 飞叶），区别于流沙的沙旋涡 */
function drawHeroFxFanGust(
  ctx: CanvasRenderingContext2D,
  ax: number, ay: number, tx: number, ty: number,
  prog: number, tier: number, sc: number, fade: number,
) {
  const dx = tx - ax;
  const dy = ty - ay;
  const dist = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  const fly = easeOut(Math.min(1, prog / 0.55));
  const cx = ax + dx * fly;
  const cy = ay + dy * fly;
  const perpX = -Math.sin(ang);
  const perpY = Math.cos(ang);
  const gw = CELL * (0.16 + sc * 0.1);

  // 风纹尾迹：三道渐弱的弧形气流线
  for (let i = 0; i < 3; i++) {
    const t = Math.max(0, fly - i * 0.16);
    if (t <= 0) continue;
    const tcx = ax + dx * t;
    const tcy = ay + dy * t;
    ctx.globalAlpha = fade * (0.4 - i * 0.1) * (0.5 + sc * 0.4);
    ctx.strokeStyle = 'rgba(170,240,200,0.8)';
    ctx.lineWidth = 2.2 - i * 0.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tcx - perpX * gw * 1.3 - dx / dist * gw, tcy - perpY * gw * 1.3 - dy / dist * gw);
    ctx.quadraticCurveTo(tcx, tcy - gw * 0.4, tcx + perpX * gw * 1.3 + dx / dist * gw, tcy + perpY * gw * 1.3 + dy / dist * gw);
    ctx.stroke();
  }

  // 弯月形疾风刃
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.globalAlpha = fade * (0.55 + sc * 0.35);
  const grad = ctx.createLinearGradient(-gw * 1.2, 0, gw * 1.2, 0);
  grad.addColorStop(0, 'rgba(180,255,210,0)');
  grad.addColorStop(0.5, 'rgba(210,255,225,0.85)');
  grad.addColorStop(1, 'rgba(180,255,210,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-gw * 1.2, 0);
  ctx.quadraticCurveTo(0, -gw * 1.15, gw * 1.2, 0);
  ctx.quadraticCurveTo(0, -gw * 0.35, -gw * 1.2, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 飞叶随风飘散
  const leaves = 3 + Math.min(2, tier - 1);
  for (let i = 0; i < leaves; i++) {
    const t = Math.max(0, fly - 0.1 - i * 0.1);
    const lx = ax + dx * t + perpX * CELL * (0.12 + (i % 2) * 0.1) * (i % 2 === 0 ? 1 : -1);
    const ly = ay + dy * t + perpY * CELL * (0.12 + (i % 2) * 0.1) * (i % 2 === 0 ? 1 : -1);
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(ang + i);
    ctx.globalAlpha = fade * (0.35 + sc * 0.3) * t;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(140,220,160,0.85)' : 'rgba(90,170,110,0.75)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 3.5 + tier * 0.3, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 命中：小气旋炸开
  if (fly > 0.8) {
    const bp = (fly - 0.8) / 0.2;
    ctx.globalAlpha = fade * (1 - bp) * 0.7;
    const g = ctx.createRadialGradient(tx, ty, 1, tx, ty, CELL * (0.16 + sc * 0.1));
    g.addColorStop(0, 'rgba(220,255,230,0.9)');
    g.addColorStop(0.5, 'rgba(150,220,170,0.4)');
    g.addColorStop(1, 'rgba(120,200,150,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(tx, ty, CELL * (0.16 + sc * 0.1), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHeroAttackFx(
  ctx: CanvasRenderingContext2D,
  f: HitFx,
  ax: number, ay: number,
  tx: number, ty: number,
  prog: number,
  ang: number,
  tier: number,
  heroId: string,
  maxTier: number,
) {
  const sc = heroFxScale(tier, maxTier);
  const fade = prog < 0.72 ? 1 : Math.max(0, 1 - (prog - 0.72) / 0.28);
  ctx.save();
  switch (heroId) {
    case 'dasheng':
      drawStaffBoomerang(ctx, ax, ay, tx, ty, prog, tier);
      break;
    case 'damang': {
      // 蟒影横扫：蟒鞭飞掠 + 青绿蛇影尾迹
      const dash = easeOut(Math.min(1, prog / 0.48));
      const cx = ax + (tx - ax) * dash;
      const cy = ay + (ty - ay) * dash;
      const whipSize = CELL * (0.34 + sc * 0.18);
      const scale = 0.35 + 0.65 * dash;
      const side = ax > tx ? 1 : -1;
      const spin = ang + side * (Math.PI * 0.35 * (1 - dash) - Math.PI * 0.08);
      if (dash > 0.08) {
        ctx.save();
        ctx.globalAlpha = fade * 0.35 * dash;
        ctx.strokeStyle = '#5fdc78';
        ctx.lineWidth = 2 + tier * 0.25;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        const mx = (ax + cx) / 2 + side * CELL * 0.12;
        const my = (ay + cy) / 2 - CELL * 0.08;
        ctx.quadraticCurveTo(mx, my, cx, cy);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin);
      drawSnakeWhipGlyph(ctx, whipSize * scale, tier, fade * (0.55 + sc * 0.45));
      ctx.restore();
      if (dash > 0.7) {
        const bp = (dash - 0.7) / 0.3;
        ctx.globalAlpha = fade * (1 - bp) * 0.75;
        ctx.fillStyle = 'rgba(120,240,150,0.55)';
        ctx.beginPath();
        ctx.arc(tx, ty, CELL * (0.12 + sc * 0.08) * (0.6 + bp), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'erlang': {
      drawErlangSkyEyeBeam(ctx, ax, ay, tx, ty, prog, fade, tier, sc * 0.55);
      break;
    }
    case 'niulang': {
      const x = ax + (tx - ax) * prog;
      const y = ay + (ty - ay) * prog;
      const rad = CELL * (0.1 + sc * 0.08);
      ctx.globalAlpha = fade * sc * 0.55;
      ctx.strokeStyle = '#c8d8ff';
      ctx.lineWidth = 1.2 + tier * 0.3;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x, y); ctx.stroke();
      const g = ctx.createRadialGradient(x, y, 1, x, y, rad * 2);
      g.addColorStop(0, 'rgba(255,248,220,0.9)');
      g.addColorStop(0.5, 'rgba(180,200,255,0.5)');
      g.addColorStop(1, 'rgba(120,160,255,0)');
      ctx.globalAlpha = fade;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad * 1.6, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'nezha': {
      const jab = Math.sin(Math.min(1, prog / 0.5) * Math.PI);
      const dist = Math.hypot(tx - ax, ty - ay);
      const tipD = dist * (0.15 + 0.85 * jab);
      const shaft = CELL * (0.38 + sc * 0.22);
      const tipX = ax + Math.cos(ang) * tipD;
      const tipY = ay + Math.sin(ang) * tipD;
      if (jab > 0.2) {
        ctx.globalAlpha = fade * jab * sc * 0.45;
        ctx.strokeStyle = '#ff9040';
        ctx.lineWidth = 3 + tier * 0.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ax + Math.cos(ang) * (tipD - shaft * 0.3), ay + Math.sin(ang) * (tipD - shaft * 0.3));
        ctx.lineTo(tipX + Math.cos(ang) * 4, tipY + Math.sin(ang) * 4);
        ctx.stroke();
      }
      drawHuojianSpearGlyph(ctx, tipX, tipY, ang, shaft, tier, fade * (0.55 + sc * 0.45), 0);
      break;
    }
    case 'jinzha': {
      // 砍妖刀：金刀挥斩 + 焰刃，单道斩痕（不做大小双弧扇面）
      const snap = Math.min(1, prog / 0.4);
      const ease = 1 - Math.pow(1 - snap, 3.2);
      const side = ax > tx ? 1 : -1;
      const daoLen = CELL * (0.42 + sc * 0.2);
      const startAng = ang - side * 0.75;
      const chopAng = startAng + side * Math.PI * 0.9 * ease;
      // 单道金斩痕
      ctx.save();
      ctx.translate(tx, ty);
      ctx.globalAlpha = fade * 0.5 * ease;
      ctx.strokeStyle = '#ffd878';
      ctx.lineWidth = 2.4 + tier * 0.35;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, daoLen * 0.9, startAng, chopAng, side < 0);
      ctx.stroke();
      ctx.restore();
      // 刀本体在斩锋
      const tipX = tx + Math.cos(chopAng) * daoLen * 0.12;
      const tipY = ty + Math.sin(chopAng) * daoLen * 0.12;
      ctx.save();
      ctx.translate(tipX, tipY);
      ctx.rotate(chopAng);
      drawKanYaoDaoGlyph(ctx, daoLen * (0.6 + 0.4 * ease), tier, fade * (0.55 + sc * 0.45), 0.45 + ease * 0.55);
      ctx.restore();
      if (ease > 0.5) {
        const bp = (ease - 0.5) / 0.5;
        ctx.globalAlpha = fade * (1 - bp) * 0.8;
        const g = ctx.createRadialGradient(tx, ty, 1, tx, ty, CELL * (0.18 + sc * 0.1) * (0.7 + bp));
        g.addColorStop(0, 'rgba(255,240,180,0.95)');
        g.addColorStop(0.45, 'rgba(255,120,40,0.5)');
        g.addColorStop(1, 'rgba(255,40,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tx, ty, CELL * (0.18 + sc * 0.1) * (0.7 + bp), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'honghaier': {
      // 普攻火球：略放大 + 周缘火苗（仍明显小于大招天火）
      const x = ax + (tx - ax) * prog;
      const y = ay + (ty - ay) * prog;
      const ang = Math.atan2(ty - ay, tx - ax);
      const grow = 0.4 + 0.6 * Math.sin(prog * Math.PI);
      const rad = CELL * (0.11 + sc * 0.07) * grow;
      const outer = rad * (1.35 + tier * 0.1);
      // 尾焰拖曳
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang + Math.PI / 2);
      drawFlameTongue(
        ctx,
        rad * 1.85,
        rad * 0.7,
        fade * (0.45 + grow * 0.4),
        'rgba(220,40,10,0.75)',
        'rgba(255,110,25,0.85)',
        'rgba(255,230,120,0.9)',
      );
      ctx.restore();
      // 本体火晕
      const g = ctx.createRadialGradient(x, y, 0.5, x, y, outer);
      g.addColorStop(0, '#fff2b0');
      g.addColorStop(0.4, '#ff7028');
      g.addColorStop(1, 'rgba(255,40,10,0)');
      ctx.globalAlpha = fade * (0.6 + grow * 0.4);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, outer, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe080';
      ctx.beginPath(); ctx.arc(x, y, rad * 0.42, 0, Math.PI * 2); ctx.fill();
      // 周缘跳动火苗
      const tongues = 3 + Math.min(2, tier - 1);
      for (let i = 0; i < tongues; i++) {
        const a = ang + Math.PI + (i - (tongues - 1) / 2) * 0.55 + Math.sin(prog * 14 + i * 2) * 0.18;
        const dist = rad * (0.85 + (i % 2) * 0.2);
        ctx.save();
        ctx.translate(x + Math.cos(a) * dist * 0.35, y + Math.sin(a) * dist * 0.35);
        ctx.rotate(a + Math.PI / 2 + Math.sin(prog * 10 + i) * 0.25);
        drawFlameTongue(
          ctx,
          rad * (0.85 + (i % 3) * 0.15),
          rad * (0.32 + (i % 2) * 0.08),
          fade * (0.4 + grow * 0.35) * (0.75 + (i % 2) * 0.15),
          'rgba(230,50,12,0.8)',
          'rgba(255,130,30,0.88)',
          'rgba(255,235,130,0.92)',
        );
        ctx.restore();
      }
      break;
    }
    case 'hongpao': {
      const x = ax + (tx - ax) * prog;
      const y = ay + (ty - ay) * prog;
      const rad = CELL * (0.1 + sc * 0.06);
      ctx.globalAlpha = fade * sc * 0.5;
      ctx.strokeStyle = '#ff9060';
      ctx.lineWidth = 1.5 + tier * 0.35;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x, y); ctx.stroke();
      const g = ctx.createRadialGradient(x, y, 1, x, y, rad * 1.5);
      g.addColorStop(0, 'rgba(255,200,140,0.85)');
      g.addColorStop(1, 'rgba(255,80,30,0)');
      ctx.globalAlpha = fade;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad * 1.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'bajie': {
      // 九齿钉耙飞掠：横梁+并排直齿（与大招同形）
      const dash = easeOut(Math.min(1, prog / 0.5));
      const cx = ax + (tx - ax) * dash;
      const cy = ay + (ty - ay) * dash;
      const rakeSize = CELL * (0.42 + sc * 0.22);
      const scale = 0.32 + 0.68 * dash;
      const spin = dash * Math.PI * 0.55;
      if (dash > 0.06) {
        ctx.save();
        ctx.globalAlpha = fade * 0.3 * dash;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.5 + tier * 0.25;
        ctx.lineCap = 'round';
        ctx.setLineDash([5, 6]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.translate(cx, cy);
      // 剪影：柄在 -Y、齿在 +Y；旋转后让齿朝飞行方向、柄在后方
      ctx.rotate(ang - Math.PI / 2 + spin * 0.35);
      drawJiuchiRakeGlyph(ctx, rakeSize * scale, tier, fade * (0.55 + sc * 0.45));
      ctx.restore();
      if (dash > 0.72) {
        const bp = (dash - 0.72) / 0.28;
        ctx.globalAlpha = fade * (1 - bp) * 0.65;
        const g = ctx.createRadialGradient(tx, ty, 1, tx, ty, CELL * (0.14 + sc * 0.08));
        g.addColorStop(0, 'rgba(255,230,160,0.85)');
        g.addColorStop(1, 'rgba(255,200,80,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tx, ty, CELL * (0.14 + sc * 0.08) * (0.7 + bp), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'baxian': {
      // 仙缘符箓飞掠 + 命中锁环
      const dash = easeOut(Math.min(1, prog / 0.48));
      const cx = ax + (tx - ax) * dash;
      const cy = ay + (ty - ay) * dash;
      const talSize = CELL * (0.28 + sc * 0.12);
      if (dash > 0.08) {
        ctx.save();
        ctx.globalAlpha = fade * 0.35 * dash;
        ctx.strokeStyle = '#ffe08a';
        ctx.lineWidth = 1.6 + tier * 0.2;
        ctx.lineCap = 'round';
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang + Math.PI / 2 + (1 - dash) * 0.8);
      drawXianyuanTalismanGlyph(ctx, talSize * (0.55 + 0.45 * dash), tier, fade * (0.55 + sc * 0.4));
      ctx.restore();
      if (dash > 0.55) {
        const bp = (dash - 0.55) / 0.45;
        const rad = CELL * (0.16 + sc * 0.1) * (0.6 + bp);
        ctx.save();
        ctx.translate(tx, ty);
        ctx.globalAlpha = fade * (1 - bp) * 0.8;
        ctx.strokeStyle = '#ffe27a';
        ctx.lineWidth = 1.8 + tier * 0.25;
        ctx.beginPath();
        ctx.ellipse(0, CELL * 0.06, rad, rad * 0.4, 0, 0, Math.PI * 2);
        ctx.stroke();
        // 落点小「仙」印
        ctx.globalAlpha = fade * (1 - bp) * 0.7;
        ctx.fillStyle = '#ffd54a';
        ctx.font = `bold ${Math.round(CELL * 0.2)}px "PingFang SC", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('仙', 0, -CELL * 0.08);
        ctx.restore();
      }
      break;
    }
    case 'niumowang': {
      const dash = easeOut(Math.min(1, prog / 0.4));
      const x = ax + (tx - ax) * dash;
      const y = ay + (ty - ay) * dash;
      const totalDist = Math.hypot(tx - ax, ty - ay) || 1;
      const dirX = (tx - ax) / totalDist;
      const dirY = (ty - ay) / totalDist;
      const perpX = -dirY;
      const perpY = dirX;
      const seed = ((f.from.c * 17 + f.from.r * 31 + tier * 7) | 0);
      const streakN = 7 + tier * 2;
      for (let i = 0; i < streakN; i++) {
        const fi = ((seed + i * 13) % 97) / 97;
        const fj = ((seed + i * 29) % 89) / 89;
        const streakLen = CELL * (0.18 + fi * 0.62 + sc * 0.18) * dash;
        const lateral = (fj - 0.5) * CELL * (0.28 + fi * 0.22);
        const tailAlong = Math.max(0, dash - streakLen / totalDist);
        const sx = ax + (tx - ax) * tailAlong + perpX * lateral;
        const sy = ay + (ty - ay) * tailAlong + perpY * lateral;
        const wave = Math.sin(i * 1.9 + prog * 9) * CELL * 0.035;
        const ex = sx + dirX * streakLen * (0.82 + fi * 0.35);
        const ey = sy + dirY * streakLen * (0.82 + fi * 0.35);
        ctx.globalAlpha = fade * (0.28 + fi * 0.5) * (1 - i / streakN * 0.25);
        ctx.strokeStyle = i % 2 === 0 ? 'rgba(220,200,168,0.85)' : f.color;
        ctx.lineWidth = 0.6 + fi * 0.85;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx + perpX * wave, sy + perpY * wave);
        ctx.lineTo(ex + perpX * wave * 0.4, ey + perpY * wave * 0.4);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang + Math.PI / 2);
      drawBullHeadGlyph(ctx, 0, 0, CELL * (0.18 + sc * 0.14), fade);
      ctx.restore();
      break;
    }
    case 'qingniu': {
      // 牛角顶刺：青绿冲刺带 + 双角前顶 + 命中冲击（不再是细枪尖）
      const jab = Math.sin(Math.min(1, prog / 0.5) * Math.PI);
      const dash = easeOut(Math.min(1, prog / 0.48));
      const dist = Math.hypot(tx - ax, ty - ay) || 1;
      const tipD = dist * (0.18 + 0.82 * dash);
      const grow = 0.55 + jab * 0.55;
      const hornLen = CELL * (0.28 + sc * 0.14) * grow;
      const hornSpread = CELL * (0.1 + sc * 0.04);

      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(ang);

      // 冲刺青绿走廊
      ctx.globalAlpha = fade * (0.35 + jab * 0.4);
      const corridor = ctx.createLinearGradient(tipD - hornLen * 1.6, 0, tipD + hornLen * 0.2, 0);
      corridor.addColorStop(0, 'rgba(80,120,70,0)');
      corridor.addColorStop(0.45, 'rgba(120,180,100,0.45)');
      corridor.addColorStop(1, 'rgba(210,245,180,0.7)');
      ctx.fillStyle = corridor;
      ctx.beginPath();
      ctx.moveTo(tipD - hornLen * 1.5, -hornSpread * 0.55);
      ctx.lineTo(tipD + 2, -hornSpread * 1.15);
      ctx.lineTo(tipD + 2, hornSpread * 1.15);
      ctx.lineTo(tipD - hornLen * 1.5, hornSpread * 0.55);
      ctx.closePath();
      ctx.fill();

      // 中轴高光拖尾
      ctx.globalAlpha = fade * (0.5 + jab * 0.35);
      ctx.strokeStyle = '#d8f0c0';
      ctx.lineWidth = 3 + tier * 0.35;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tipD - hornLen * 1.35, 0);
      ctx.lineTo(tipD + 1, 0);
      ctx.stroke();

      // 两侧速度线
      for (let i = 0; i < 4; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const along = tipD - hornLen * (0.4 + (i % 2) * 0.35);
        const lat = side * hornSpread * (0.85 + (i % 2) * 0.35);
        ctx.globalAlpha = fade * jab * (0.35 + (i % 2) * 0.2);
        ctx.strokeStyle = i % 2 === 0 ? 'rgba(180,230,150,0.9)' : 'rgba(100,150,80,0.75)';
        ctx.lineWidth = 1.4 + (i % 2) * 0.4;
        ctx.beginPath();
        ctx.moveTo(along - hornLen * 0.35, lat);
        ctx.lineTo(along + hornLen * 0.25, lat * 0.7);
        ctx.stroke();
      }

      // 双角本体（前伸弯尖）
      for (const side of [-1, 1] as const) {
        const baseX = tipD - hornLen * 0.55;
        const baseY = side * hornSpread * 0.55;
        const tipX = tipD + hornLen * 0.55;
        const tipY = side * hornSpread * 0.15;
        const midX = tipD + hornLen * 0.05;
        const midY = side * hornSpread * 1.15;
        ctx.globalAlpha = fade * (0.65 + jab * 0.3);
        ctx.fillStyle = side < 0 ? '#c8e0b8' : '#b8d8a8';
        ctx.strokeStyle = '#3a5a32';
        ctx.lineWidth = 1.4 + tier * 0.1;
        ctx.beginPath();
        ctx.moveTo(baseX, baseY - side * 2.2);
        ctx.quadraticCurveTo(midX, midY, tipX, tipY);
        ctx.quadraticCurveTo(midX - hornLen * 0.05, midY * 0.55, baseX, baseY + side * 2.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // 角尖高光
        ctx.strokeStyle = '#f0ffe0';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(midX, midY * 0.65);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
      }

      // 额骨/鼻梁小块（双角根部连成一体，避免像两根小枪）
      ctx.globalAlpha = fade * (0.55 + jab * 0.3);
      ctx.fillStyle = 'rgba(90,130,75,0.9)';
      ctx.strokeStyle = '#3a5a32';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(tipD - hornLen * 0.45, 0, hornLen * 0.28, hornSpread * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.restore();

      // 命中青绿冲击
      if (dash > 0.7) {
        const bp = (dash - 0.7) / 0.3;
        ctx.globalAlpha = fade * (1 - bp) * 0.8;
        const g = ctx.createRadialGradient(tx, ty, 1, tx, ty, CELL * (0.2 + sc * 0.1));
        g.addColorStop(0, 'rgba(230,255,200,0.9)');
        g.addColorStop(0.45, 'rgba(140,200,110,0.45)');
        g.addColorStop(1, 'rgba(80,130,60,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tx, ty, CELL * (0.2 + sc * 0.1) * (0.65 + bp), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,240,160,0.85)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(tx, ty, CELL * (0.14 + sc * 0.06) * easeOut(bp), 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'tieshan':
      drawHeroFxFanGust(ctx, ax, ay, tx, ty, prog, tier, sc, fade);
      break;
    case 'tiebei': {
      // 铁背普攻：单体铁拳轻击（小闪光，不做扩散群攻环）
      const jab = Math.sin(Math.min(1, prog / 0.45) * Math.PI);
      const dist = Math.hypot(tx - ax, ty - ay) || 1;
      const tipD = dist * (0.25 + 0.7 * jab);
      ctx.globalAlpha = fade;
      ctx.translate(ax, ay);
      ctx.rotate(ang);
      // 短冲拳线
      ctx.strokeStyle = 'rgba(160,170,180,0.7)';
      ctx.lineWidth = 2 + tier * 0.3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tipD - CELL * 0.22, 0);
      ctx.lineTo(tipD + 2, 0);
      ctx.stroke();
      // 拳锋铁块
      const fs = CELL * (0.1 + sc * 0.04) * (0.7 + jab * 0.35);
      ctx.fillStyle = `rgba(140,150,160,${0.55 + sc * 0.3})`;
      ctx.strokeStyle = '#d0d8e0';
      ctx.lineWidth = 1.3;
      roundRect(ctx, tipD - fs * 0.3, -fs * 0.55, fs * 1.1, fs * 1.1, 2);
      ctx.fill();
      ctx.stroke();
      if (jab > 0.55) {
        const bp = (jab - 0.55) / 0.45;
        ctx.globalAlpha = fade * (1 - bp) * 0.55;
        ctx.strokeStyle = '#c8d0d8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(tipD + 2, 0, CELL * 0.1 * (0.6 + bp * 0.5), 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'shaseng': {
      // 降妖宝杖：双头月牙飞掠横扫
      const dash = easeOut(Math.min(1, prog / 0.5));
      const cx = ax + (tx - ax) * dash;
      const cy = ay + (ty - ay) * dash;
      const staffLen = CELL * (0.42 + sc * 0.26);
      const launchScale = 0.32 + 0.68 * dash;
      const side = ax > tx ? 1 : -1;
      const sweepAng = ang + side * (Math.PI * 0.55 * (1 - dash) - Math.PI * 0.08);
      if (dash > 0.08) {
        ctx.save();
        ctx.globalAlpha = fade * 0.28 * dash;
        ctx.strokeStyle = '#c9a86a';
        ctx.lineWidth = 2 + tier * 0.35;
        ctx.lineCap = 'round';
        const trailR = staffLen * launchScale * 0.95;
        ctx.beginPath();
        ctx.arc(cx, cy, trailR, sweepAng - side * 0.55, sweepAng + side * 0.15, side < 0);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(sweepAng);
      drawJiangyaoStaffGlyph(ctx, staffLen * launchScale, tier, fade * (0.55 + sc * 0.45));
      ctx.restore();
      break;
    }
    case 'liusha':
      drawHeroFxTornado(ctx, ax, ay, tx, ty, prog, tier, sc, fade, {
        stroke: `rgba(210,180,120,${0.4 + sc * 0.35})`,
        debris: 'rgba(230,200,140,0.65)',
        core: 'rgba(180,150,90,0.4)',
      });
      break;
    case 'bailong': {
      // 龙爪突进：掌垫+勾爪飞掠撕扯
      const dash = easeOut(Math.min(1, prog / 0.42));
      const x = ax + (tx - ax) * dash;
      const y = ay + (ty - ay) * dash;
      const claw = CELL * (0.34 + sc * 0.16);
      const swing = -0.4 + dash * 0.85;
      if (dash > 0.12) {
        ctx.save();
        ctx.globalAlpha = fade * 0.3 * dash;
        ctx.strokeStyle = '#c8e0ff';
        ctx.lineWidth = 1.6 + tier * 0.25;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(x, y, claw * 0.7, ang - 0.9 + swing, ang - 0.2 + swing);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang + Math.PI / 2 + swing * 0.4);
      const slash = 0.85 + Math.sin(dash * Math.PI) * 0.28;
      ctx.scale(slash, slash);
      drawDragonClawGlyph(ctx, claw, tier, fade * (0.55 + sc * 0.45));
      ctx.restore();
      break;
    }
    case 'taibai': {
      // 普攻弹道：金色星芒拖尾（拂尘掷出的星光）
      const x = ax + (tx - ax) * prog;
      const y = ay + (ty - ay) * prog;
      const n = 2 + tier;
      for (let i = 0; i < n; i++) {
        const a = ang + (i - (n - 1) / 2) * 0.35 + prog * 1.5;
        const r = CELL * (0.08 + sc * 0.06) * (1 + i * 0.15);
        ctx.globalAlpha = fade * (0.35 + sc * 0.35);
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,226,138,0.8)' : 'rgba(255,243,196,0.6)';
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * r * 3, y + Math.sin(a) * r * 3, r * 1.2, r * 0.6, a, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'guanyin': {
      const x = ax + (tx - ax) * prog;
      const y = ay + (ty - ay) * prog;
      const rad = CELL * (0.14 + sc * 0.12);
      const g = ctx.createRadialGradient(x, y, 1, x, y, rad * 2.2);
      g.addColorStop(0, 'rgba(220,255,230,0.95)');
      g.addColorStop(0.5, 'rgba(120,220,160,0.55)');
      g.addColorStop(1, 'rgba(80,180,140,0)');
      ctx.globalAlpha = fade;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad * 2, 0, Math.PI * 2); ctx.fill();
      const petals = 3 + Math.min(4, tier);
      ctx.globalAlpha = fade * sc * 0.65;
      ctx.fillStyle = '#b8f0c8';
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2 + prog * 2;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * rad * 1.4, y + Math.sin(a) * rad * 1.4, rad * 0.55, rad * 0.28, a, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'fanyin': {
      const x = ax + (tx - ax) * prog;
      const y = ay + (ty - ay) * prog;
      const rings = 1 + Math.min(2, tier - 1);
      for (let i = 0; i < rings; i++) {
        const t = Math.max(0, Math.min(1, (prog - i * 0.14) / (1 - i * 0.14)));
        const grow = easeOut(t);
        const rad = CELL * grow * (0.3 + sc * 0.38 + i * 0.06);
        ctx.globalAlpha = fade * (1 - grow * 0.5) * (0.55 + sc * 0.35);
        ctx.strokeStyle = '#ffe8a0';
        ctx.lineWidth = 1.5 + tier * 0.3;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
      }
      break;
    }
    case 'laojun': {
      // 金丹飞掠：暖金弹丸 + 尾焰
      const dash = easeOut(Math.min(1, prog / 0.55));
      const x = ax + (tx - ax) * dash;
      const y = ay + (ty - ay) * dash;
      ctx.globalAlpha = fade * 0.45;
      ctx.strokeStyle = 'rgba(255,180,60,0.75)';
      ctx.lineWidth = 2 + tier * 0.25;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ax + (tx - ax) * Math.max(0, dash - 0.28), ay + (ty - ay) * Math.max(0, dash - 0.28));
      ctx.lineTo(x, y);
      ctx.stroke();
      const rad = CELL * (0.1 + sc * 0.08);
      const g = ctx.createRadialGradient(x, y, 1, x, y, rad * 2.4);
      g.addColorStop(0, 'rgba(255,245,180,0.95)');
      g.addColorStop(0.45, 'rgba(255,170,50,0.65)');
      g.addColorStop(1, 'rgba(200,90,20,0)');
      ctx.globalAlpha = fade;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffe08a';
      ctx.beginPath();
      ctx.arc(x, y, rad * 0.55, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'danjun': {
      // 小还丹：轻量金丸
      const dash = easeOut(Math.min(1, prog / 0.5));
      const x = ax + (tx - ax) * dash;
      const y = ay + (ty - ay) * dash;
      ctx.globalAlpha = fade * 0.7;
      ctx.strokeStyle = 'rgba(255,200,90,0.65)';
      ctx.lineWidth = 1.4 + tier * 0.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ax + (tx - ax) * Math.max(0, dash - 0.22), ay + (ty - ay) * Math.max(0, dash - 0.22));
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = '#ffd070';
      ctx.beginPath();
      ctx.arc(x, y, CELL * (0.07 + sc * 0.05), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'wenshu': {
      // 慧剑轻斩：青金剑气飞掠 + 落点浅莲
      const dash = easeOut(Math.min(1, prog / 0.5));
      const x = ax + (tx - ax) * dash;
      const y = ay + (ty - ay) * dash;
      const len = CELL * (0.28 + sc * 0.18);
      ctx.save();
      ctx.globalAlpha = fade * 0.85;
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.strokeStyle = 'rgba(180,220,255,0.9)';
      ctx.lineWidth = 2 + tier * 0.3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-len * 0.7, 0);
      ctx.lineTo(len * 0.85, 0);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(200,180,255,0.7)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(len * 0.2, -len * 0.22);
      ctx.lineTo(len * 0.85, 0);
      ctx.lineTo(len * 0.2, len * 0.22);
      ctx.stroke();
      ctx.restore();
      const petals = 3 + Math.min(3, tier);
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2 + prog * 2.2;
        const pr = CELL * (0.1 + sc * 0.06);
        ctx.globalAlpha = fade * sc * 0.55;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(190,210,255,0.8)' : 'rgba(210,180,255,0.7)';
        ctx.beginPath();
        ctx.ellipse(
          x + Math.cos(a) * pr * 1.5,
          y + Math.sin(a) * pr * 1.5,
          pr * 0.5, pr * 0.22, a, 0, Math.PI * 2,
        );
        ctx.fill();
      }
      break;
    }
    case 'huishu': {
      // 慧光浅照：淡紫飞环
      const x = ax + (tx - ax) * prog;
      const y = ay + (ty - ay) * prog;
      const rings = 1 + Math.min(2, tier - 1);
      for (let i = 0; i < rings; i++) {
        const t = Math.max(0, Math.min(1, (prog - i * 0.12) / (1 - i * 0.12)));
        const grow = easeOut(t);
        const rad = CELL * grow * (0.28 + sc * 0.32 + i * 0.05);
        ctx.globalAlpha = fade * (1 - grow * 0.5) * (0.5 + sc * 0.35);
        ctx.strokeStyle = i === 0 ? 'rgba(200,190,255,0.85)' : 'rgba(170,210,255,0.6)';
        ctx.lineWidth = 1.4 + tier * 0.25;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    default: {
      const grow = easeOut(Math.min(1, prog / 0.45));
      const w = (2 + tier) * sc * grow;
      const h = CELL * (0.9 + sc * 0.6);
      ctx.globalAlpha = fade * 0.6;
      ctx.fillStyle = f.color;
      ctx.fillRect(tx - w / 2, ty - h, w, h);
      break;
    }
  }
  ctx.restore();
}

/** 激活武将字牌攻击瞬间：复用专属兵器特效，firePulse 驱动出招形变 */
function drawHeroWordWeapon(ctx: CanvasRenderingContext2D, g: ActiveGeneral) {
  const pulse = g.state.firePulse;
  if (pulse <= 0.02) return;
  const ax = (g.cells[0].c + g.cells[1].c) / 2;
  const ay = (g.cells[0].r + g.cells[1].r) / 2;
  const { x: hx, y: hy } = cellCenterPx(ax, ay);
  const dir = g.state.fireDir ?? -Math.PI / 2;
  const reach = CELL * 1.1;
  const tx = hx + Math.cos(dir) * reach;
  const ty = hy + Math.sin(dir) * reach;
  const prog = 1 - pulse;
  const fakeFx: HitFx = {
    from: { c: ax, r: ay },
    to: { c: ax + Math.cos(dir) * 2, r: ay + Math.sin(dir) * 2 },
    ttl: 1,
    maxTtl: 1,
    color: qualityColor(g.tier),
    tier: g.tier,
    heroId: g.def.id,
  };
  drawHeroAttackFx(ctx, fakeFx, hx, hy, tx, ty, prog, dir, g.tier, g.def.id, g.def.maxTier);
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
    if (f.heroId) {
      const def = generalById(f.heroId);
      if (def) {
        drawHeroAttackFx(ctx, f, a.x, a.y, t.x, t.y, prog, ang, tier, f.heroId, def.maxTier);
      }
    } else switch (f.wtype) {
      case 'staff': {
        // 大圣金箍棒：从大圣飞出变大，命中后飞回缩小隐藏
        drawStaffBoomerang(ctx, a.x, a.y, t.x, t.y, prog, tier);
        break;
      }
      case 'dao': {
        // 柄在攻击者一侧，尖朝怪挥砍；只看左右，不看上下
        const seed = ((f.from.c * 13 + f.from.r * 29) ^ (tier * 7)) | 0;
        const lane = (seed % 5) - 2;
        const dx = a.x - t.x;
        // +1 人在右 → 柄在右、尖往左砍；-1 人在左 → 柄在左、尖往右砍
        const side = Math.abs(dx) > 0.5 ? (dx > 0 ? 1 : -1) : (seed % 2 === 0 ? 1 : -1);
        const daoS = CELL * (0.62 + tier * 0.06); // 加大刀身与斩幅
        // 前 16% 内完成挥砍
        const snap = Math.min(1, prog / 0.16);
        const ease = 1 - Math.pow(1 - snap, 4.5);
        const lean = 0.75;
        const sweep = Math.PI * 0.72;
        const startAng = -Math.PI / 2 + side * lean;
        const sweepSign = -side;
        const chopAng = startAng + sweepSign * sweep * ease;
        const fade =
          prog < 0.28 ? Math.min(1, 0.55 + snap * 0.7) : Math.max(0, 1 - (prog - 0.28) / 0.4);
        const gripX = t.x + side * CELL * 0.16 + lane * CELL * 0.08;
        const gripY = t.y + CELL * 0.18;
        ctx.translate(gripX, gripY);
        const ccw = sweepSign < 0;
        if (ease > 0.05 && fade > 0.05) {
          const trailR = daoS * 0.95;
          ctx.save();
          // 外层暖金斩痕
          ctx.globalAlpha = fade * 0.5 * ease;
          ctx.strokeStyle = 'rgba(255,170,60,0.75)';
          ctx.lineWidth = Math.max(3.2, daoS * 0.1);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(0, 0, trailR, startAng, chopAng, ccw);
          ctx.stroke();
          // 主斩痕
          ctx.globalAlpha = fade * 0.55 * ease;
          ctx.strokeStyle = 'rgba(255,230,150,0.9)';
          ctx.lineWidth = Math.max(2.4, daoS * 0.065);
          ctx.beginPath();
          ctx.arc(0, 0, trailR, startAng, chopAng, ccw);
          ctx.stroke();
          // 刃尖亮弧
          ctx.globalAlpha = fade * 0.35 * ease;
          ctx.strokeStyle = 'rgba(255,255,255,0.95)';
          ctx.lineWidth = Math.max(1.4, daoS * 0.04);
          const tipFrom = chopAng - sweepSign * sweep * 0.28;
          ctx.beginPath();
          ctx.arc(0, 0, trailR, tipFrom, chopAng, ccw);
          ctx.stroke();
          ctx.restore();
        }
        // 命中闪光 + 火星
        if (ease > 0.65 && fade > 0.15) {
          const hitA = Math.min(1, (ease - 0.65) / 0.28);
          const hx = Math.cos(chopAng) * daoS * 0.55;
          const hy = Math.sin(chopAng) * daoS * 0.55;
          ctx.save();
          ctx.globalAlpha = fade * (1 - hitA * 0.85) * 0.9;
          const ig = ctx.createRadialGradient(hx, hy, 1, hx, hy, daoS * 0.35);
          ig.addColorStop(0, 'rgba(255,250,210,0.95)');
          ig.addColorStop(0.45, 'rgba(255,180,80,0.45)');
          ig.addColorStop(1, 'rgba(255,100,30,0)');
          ctx.fillStyle = ig;
          ctx.beginPath();
          ctx.arc(hx, hy, daoS * 0.35 * (0.7 + hitA * 0.4), 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#fff6d0';
          ctx.lineWidth = Math.max(2.2, daoS * 0.055);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(hx - Math.cos(chopAng) * daoS * 0.22, hy - Math.sin(chopAng) * daoS * 0.22);
          ctx.lineTo(hx + Math.cos(chopAng) * daoS * 0.4, hy + Math.sin(chopAng) * daoS * 0.4);
          ctx.stroke();
          // 火花
          for (let i = 0; i < 5; i++) {
            const sa = chopAng + (i - 2) * 0.35 + hitA;
            const sd = daoS * (0.2 + (i % 3) * 0.1) * (0.6 + hitA);
            ctx.globalAlpha = fade * (1 - hitA) * 0.7;
            ctx.fillStyle = i % 2 === 0 ? '#fff3a0' : '#ff9a3c';
            ctx.beginPath();
            ctx.arc(hx + Math.cos(sa) * sd, hy + Math.sin(sa) * sd, 1.4 + (i % 2), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
        ctx.save();
        ctx.rotate(chopAng);
        ctx.scale(1, sweepSign);
        ctx.translate(-daoS * 0.08, 0);
        drawCurvedDao(ctx, daoS, fade);
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
        // 骑：命中层只画扇区残影；鞭体只在单位出招 glyph 画一条，避免双鞭
        const reach = (UNITS.cavalry.rge + TUNING.rangeTolerance) * CELL;
        const ox = a.x + Math.cos(ang) * CELL * 0.08;
        const oy = a.y + Math.sin(ang) * CELL * 0.08;
        const eio = prog < 0.5 ? 2 * prog * prog : 1 - Math.pow(-2 * prog + 2, 2) / 2;
        const fromAng = ang - Math.PI;
        const tipAng = fromAng + eio * Math.PI * 2;
        const fade = Math.min(1, 1.1 - prog * 0.4);
        ctx.translate(ox, oy);
        drawWhipSweepFill(ctx, fromAng, tipAng, reach, fade * 0.95);
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

// 无尽模式上半场提示文案（轮播，每数秒切换一条）。文案需与 battle.ts TUNING 实际机制一致：
// 骑兵波只夹带部分快怪(cavalrySpdMul=1.25、非全员翻倍)；妖王波第5波起不定期出现(无「每5波固定」)。
const ENDLESS_TIPS: string[] = [
  '骑兵波夹带快怪——优先合成高阶弓兵远程拦截',
  '第5波起妖王不定期来袭——攒好如来神掌应急',
  '后期怪成堆，靠范围技/陨石清场',
  '每 10 波一个难度台阶，提前囤高阶兵',
  '打腻了？回首页「真人对战」可与好友/路人 1v1',
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
  // AI 怪物：图标 + 血条（与玩家侧同尺寸）
  for (const m of b.aiMonsters) {
    const p = b.aiMonsterPos(m);
    const { x, y } = cellCenterPx(p.c, p.r);
    const np = b.aiMonsterPos({ ...m, dist: m.dist + 0.05 });
    const trailDir = cellCenterPx(np.c, np.r).x - x >= 0 ? 1 : -1;
    const rad0 = m.isBoss ? CELL * 0.42 : m.isMiniBoss ? CELL * 0.36 : CELL * 0.28;
    drawMonsterAt(ctx, x, y, rad0, m, b.map.id, trailDir);
  }
  // AI 单位（上半场自动部署，立绘/阴影/微动与玩家侧一致）
  const t = performance.now() / 1000;
  for (const u of b.aiUnits) {
    const { x, y } = cellCenterPx(u.cell.c, u.cell.r);
    const drop = placeDropMotion(b, 'ai', u.cell.c, u.cell.r);
    if (!drop.visible) continue;
    const drawTier = drop.holdTier ?? u.tier;
    drawGroundShadow(ctx, x, y + CELL * 0.06 + drop.dy, CELL * 0.28, 0.28);
    const bob = Math.sin(t * 2 + (u.cell.c * 0.9 + u.cell.r * 1.7)) * 1.3;
    const pulse = u.firePulse;
    const uy = y + drop.dy - pulse * 4 + bob;
    const unitSize = CELL * 0.72 * (1 + pulse * 0.16) * drop.scale;
    drawUnit(
      ctx,
      u.type,
      drawTier,
      x,
      uy,
      unitSize,
      u.fireDir != null && Math.cos(u.fireDir) < 0,
      { x, y: y + drop.dy, s: CELL * 0.72 * drop.scale },
      false,
      'ai',
    );
    drawUnitWeapon(ctx, u.type, drawTier, x, uy, u.fireDir ?? Math.PI / 2, pulse, u.combo);
    const statuses = unitStatusItems(u);
    if (statuses.length > 0) drawStatusRow(ctx, x, y - CELL * 0.42, statuses, 8);
  }
  // AI 字牌 / 激活武将（与玩家侧 drawGenerals 同视觉，便于点击查看范围与 tips）
  drawAiGenerals(ctx, b);
  // 对手终点：唐僧立绘（无底座 + 头顶心数，与我方一致）
  const tp = b.aiTangsengRenderPos();
  const { x, y } = cellCenterPx(tp.c, tp.r);
  drawTangsengFigure(ctx, x, y, b.aiTangsengHP, {
    defeated: b.aiDefeated,
  });
}

/** AI 半场字牌与激活武将金框（镜像 drawGenerals，无拖拽隐藏） */
function drawAiGenerals(ctx: CanvasRenderingContext2D, b: Battle) {
  const activeTier = new Map<string, number>();
  for (const g of b.aiActiveGenerals()) {
    for (const c of g.cells) activeTier.set(`${c.c},${c.r}`, g.tier);
  }
  for (const w of b.aiWords.values()) {
    const key = `${w.cell.c},${w.cell.r}`;
    const qTier = activeTier.get(key) ?? 0;
    if (qTier > 0) continue;
    const { x, y } = cellCenterPx(w.cell.c, w.cell.r);
    const drop = placeDropMotion(b, 'ai', w.cell.c, w.cell.r);
    if (!drop.visible) continue;
    drawGroundShadow(ctx, x, y + drop.dy, CELL * 0.32, 0.26);
    drawWordTile(ctx, w.char, drop.holdTier ?? w.tier, x, y + drop.dy, CELL * 0.78 * drop.scale, true, 0);
    drawSleepingZ(ctx, x, y + drop.dy, CELL * 0.78 * drop.scale, performance.now());
  }
  for (const g of b.aiActiveGenerals()) {
    drawActiveGeneralGroup(ctx, b, 'ai', g, (c, r) => b.aiWords.get(`${c},${r}`));
  }
}

/** 无尽 AI 半场裁切路径（普通图矩形；白骨岭台阶）。 */
function clipAiHalfPath(ctx: CanvasRenderingContext2D, map: GameMap): void {
  ctx.beginPath();
  if (map.id === 'baiguling') {
    const x0 = BOARD_X;
    const xMid = BOARD_X + 4 * CELL;
    const x1 = BOARD_X + COLS * CELL;
    const y0 = BOARD_Y;
    const yRight = BOARD_Y + 4 * CELL; // 右列 r<=3
    const yLeft = BOARD_Y + 6 * CELL; // 左列 r<=5
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1, yRight);
    ctx.lineTo(xMid, yRight);
    ctx.lineTo(xMid, yLeft);
    ctx.lineTo(x0, yLeft);
    ctx.closePath();
  } else {
    ctx.rect(BOARD_X, BOARD_Y, COLS * CELL, FENCE_ROW * CELL);
  }
}

// 离屏缓冲：先拷贝 AI 区再模糊，避免 filter 直接糊主画布。
let endlessFrostScratch: HTMLCanvasElement | null = null;
function endlessFrostScratchCanvas(w: number, h: number): HTMLCanvasElement {
  if (!endlessFrostScratch) endlessFrostScratch = document.createElement('canvas');
  if (endlessFrostScratch.width !== w || endlessFrostScratch.height !== h) {
    endlessFrostScratch.width = w;
    endlessFrostScratch.height = h;
  }
  return endlessFrostScratch;
}

/** 无尽：按地图形状给整块 AI 半场铺毛玻璃蒙层。 */
function drawEndlessFrost(ctx: CanvasRenderingContext2D, map: GameMap): void {
  const w = COLS * CELL;
  const h = map.id === 'baiguling' ? 6 * CELL : FENCE_ROW * CELL;
  const scratch = endlessFrostScratchCanvas(w, h);
  const sctx = scratch.getContext('2d');
  if (!sctx) return;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  // 主画布带 dpr transform，从 bitmap 取样须用物理像素矩形
  const m = ctx.getTransform();
  const sx = BOARD_X * m.a + m.e;
  const sy = BOARD_Y * m.d + m.f;
  const sw = w * m.a;
  const sh = h * m.d;
  sctx.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, w, h);

  ctx.save();
  clipAiHalfPath(ctx, map);
  ctx.clip();
  // 毛玻璃：模糊底图 + 宣纸色薄纱
  ctx.filter = 'blur(5px)';
  ctx.drawImage(scratch, BOARD_X, BOARD_Y, w, h);
  ctx.filter = 'none';
  ctx.fillStyle = 'rgba(244,233,220,0.42)';
  ctx.fillRect(BOARD_X, BOARD_Y, w, h);
  ctx.restore();
}

// 无尽模式：AI 半场毛玻璃 + 居中 3 行高波次卡片（网格/路径已由 drawBoard 绘制）。
function drawEndlessPanel(ctx: CanvasRenderingContext2D, b: Battle): void {
  drawEndlessFrost(ctx, b.map);

  const safeH = aiHalfSafeRows(b.map) * CELL;
  const panelH = CELL * 3;
  const panelW = COLS * CELL - CELL * 0.8;
  const panelX = BOARD_X + CELL * 0.4;
  const panelY = BOARD_Y + (safeH - panelH) / 2;

  ctx.save();
  roundRect(ctx, panelX, panelY, panelW, panelH, 14);
  ctx.fillStyle = 'rgba(244,233,220,0.96)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(122,59,18,0.5)';
  ctx.stroke();

  const cx = panelX + panelW / 2;
  const midY = panelY + panelH / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#b5391f';
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.fillText('无尽 · 试炼', cx, midY - 36);

  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 26px "PingFang SC", sans-serif';
  ctx.fillText(`第 ${b.wave} 波`, cx, midY - 4);
  ctx.fillStyle = '#8a5a2b';
  ctx.font = '14px "PingFang SC", sans-serif';
  ctx.fillText(`历史最高：第 ${endlessBestWaveCached()} 波`, cx, midY + 26);

  const tip = ENDLESS_TIPS[Math.floor(performance.now() / 4000) % ENDLESS_TIPS.length]!;
  ctx.fillStyle = '#7a3b12';
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillText('💡 ' + tip, cx, panelY + panelH - 18);

  ctx.restore();
}

// 危险提示：怪物距唐僧≤5格时，唐僧格红色呼吸描边 + 在路径上(离唐僧1格、朝向来敌处)显示红色「危险」标签(大小呼吸+重影抖动，营造紧张感)
function drawDanger(ctx: CanvasRenderingContext2D, b: Battle) {
  const now = performance.now();
  const pulse = 0.5 + 0.5 * Math.sin(now / 140); // 0..1 呼吸
  // 目标格红色呼吸描边(高亮唐僧所在格)
  const markBox = (cx: number, cy: number) => {
    const gx = BOARD_X + cx * CELL;
    const gy = BOARD_Y + cy * CELL;
    ctx.save();
    ctx.globalAlpha = 0.3 + 0.35 * pulse;
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = 4;
    roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
    ctx.stroke();
    ctx.globalAlpha = 0.12 + 0.18 * pulse;
    ctx.fillStyle = '#ff3b3b';
    roundRect(ctx, gx + 2, gy + 2, CELL - 4, CELL - 4, 8);
    ctx.fill();
    ctx.restore();
  };
  // 路径上「危险」标签：红色、大小呼吸、重影抖动
  const markText = (px: number, py: number) => {
    const scale = 1 + 0.14 * Math.sin(now / 120); // 呼吸缩放
    const jitter = 1.6 * Math.sin(now / 45); // 高频错位(制造重影/抖动)
    const size = Math.round(23 * scale);
    ctx.save();
    ctx.translate(px, py);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 换字体：粗黑斜体，比正文更具冲击力
    ctx.font = `900 italic ${size}px "Hiragino Sans GB", "STHeiti", "PingFang SC", sans-serif`;
    ctx.lineJoin = 'round';
    // 重影层：错位的半透明红，呼吸闪动出残影
    ctx.globalAlpha = 0.35 + 0.3 * pulse;
    ctx.fillStyle = '#ff2a2a';
    ctx.fillText('危险', jitter, -jitter);
    ctx.fillText('危险', -jitter, jitter);
    // 主体层：深色描边保清晰 + 高饱和红
    ctx.globalAlpha = 1;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(60,0,0,0.85)';
    ctx.strokeText('危险', 0, 0);
    ctx.fillStyle = '#ff1a1a';
    ctx.fillText('危险', 0, 0);
    ctx.restore();
  };
  if (b.status === 'playing' && b.dangerNear()) {
    const t = b.map.tangseng;
    markBox(t.c, t.r);
    const p = posAlong(b.map.path, lenOf(b.map.path) - 1); // 路径上离唐僧1格处
    const { x, y } = cellCenterPx(p.c, p.r);
    markText(x, y);
  }
  if (b.status === 'playing' && !b.aiDefeated && b.aiDangerNear()) {
    markBox(b.aiTangseng.c, b.aiTangseng.r);
    const p = posAlong(b.aiPath, lenOf(b.aiPath) - 1);
    const { x, y } = cellCenterPx(p.c, p.r);
    markText(x, y);
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

function drawBondHudChip(ctx: CanvasRenderingContext2D, b: Battle) {
  if (!b.bondActive() || (b.status !== 'ready' && b.status !== 'playing')) return;
  const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 200);
  const label = `🐵 ${BOND_NAME} ${bondAtkPctLabel()}`;
  ctx.save();
  ctx.font = 'bold 11px "PingFang SC", sans-serif';
  const tw = ctx.measureText(label).width;
  const bw = tw + 14;
  const bx = VIEW_W / 2 - bw / 2;
  const by = HUD_H - 17;
  ctx.globalAlpha = pulse;
  roundRect(ctx, bx, by, bw, 15, 7);
  ctx.fillStyle = 'rgba(200,146,42,0.88)';
  ctx.fill();
  ctx.strokeStyle = '#ffe27a';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff8e8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, VIEW_W / 2, by + 7.5);
  ctx.restore();
}

type AiItemChip = {
  index: number;
  x: number;
  y: number;
  r: number;
  color: string;
  icon: string;
  id: string;
  kind: 'active' | 'passive';
  slot?: { cd: number; cdMax: number; ready: boolean; flash: number };
};

/** HUD 右上角 AI 道具：上行最多 2 个主动（大），下行最多 6 个被动（小） */
/** 两侧延迟标注与中块的安全间距(px)：两侧标签内缘到「中块半宽」的距离。 */
const NET_LAT_FLANK_GAP = 16;

/**
 * 对局 HUD「境界两侧延迟」的 x 锚点（T9.4）。纯函数、无 ctx 依赖，便于单测钉死布局公式。
 *
 * 中块两行（波次 bold24 / 境界 14px）均以 VIEW_W/2 居中，两侧标签必须避开中块最宽的一半，
 * 否则会盖住居中文字。取调用方测出的中块两行【最大半宽】centerHalf（保证任一行都不被侧标压到），
 * 再留 NET_LAT_FLANK_GAP 间距：
 *   leftX  = VIEW_W/2 - centerHalf - gap  → 左侧「我 Nms」用 textAlign='right'、右缘对齐此点；
 *   rightX = VIEW_W/2 + centerHalf + gap  → 右侧「对 Nms」用 textAlign='left'、左缘对齐此点。
 *
 * 为何取两行最大半宽而非仅一行：波次行（含地图名）通常更宽，境界行更窄；若只按窄行算半宽，
 * 宽行右半就会被左侧标签盖住——取 max 从根上杜绝任一行被压。
 */
export function netLatencyFlankXs(centerHalf: number, gap = NET_LAT_FLANK_GAP): { leftX: number; rightX: number } {
  return {
    leftX: VIEW_W / 2 - centerHalf - gap,
    rightX: VIEW_W / 2 + centerHalf + gap,
  };
}

/**
 * 延迟标注配色：与旧 drawNetLatencyHud 完全一致——无样本(null)→淡墨；>150ms→橙色警示；其余墨绿。
 * 复用给两侧（本侧/对手）延迟，阈值与色值逐字对齐旧实现，视觉零跳变。
 */
function latColor(rtt: number | null): string {
  if (rtt === null) return 'rgba(90,60,30,0.5)';
  if (rtt > 150) return '#d04520';
  return '#4a6a3a';
}

/**
 * 画对局 HUD 两侧延迟（T9.4）：左侧本侧「我 Nms」、右侧对手「对 Nms」。
 * 垂直对齐中块两行的视觉中心（HUD_H/2）；水平锚点由 netLatencyFlankXs 据中块两行最大半宽算出，
 * 保证两侧标签绝不盖住居中波次/境界文字。两侧各自按阈值/latColor 着色。
 *
 * 为何现场量中块半宽而非用常量：波次行含地图名（长度不定）、境界行可能缺失，宽窄随局变化；
 * 在 drawHud 内用同一 ctx（已设对应字体）measureText 即得精确半宽，是最稳的防重叠手段。
 */
// 延迟文本：≥1000ms 显示为「x.ys」（秒，最多一位小数、去掉末尾 .0），否则整数毫秒。
function formatRtt(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 100) / 10}s` : `${Math.round(ms)}ms`;
}

function drawNetLatencyFlanks(
  ctx: CanvasRenderingContext2D,
  myRtt: number | null,
  oppRtt: number | null,
  waveStr: string,
  rankStr: string | null,
): void {
  // ctx 现处于 drawHud 中块状态，save/restore 包住，避免现场改的字体/对齐/填色泄漏给后续 drawAiItemsHud 等。
  ctx.save();
  // 量中块两行半宽，取最大值作 centerHalf（任一行都不被侧标盖住）。字体须与 drawHud 中块逐字一致。
  ctx.font = 'bold 24px "PingFang SC", sans-serif';
  let centerHalf = ctx.measureText(waveStr).width / 2;
  if (rankStr) {
    ctx.font = '14px "PingFang SC", sans-serif';
    centerHalf = Math.max(centerHalf, ctx.measureText(rankStr).width / 2);
  }
  const { leftX, rightX } = netLatencyFlankXs(centerHalf);
  const y = HUD_H / 2; // 中块两行（HUD_H/2-12 / +14）的视觉中心，两侧标签对齐此处

  ctx.textBaseline = 'middle';
  ctx.font = '13px "PingFang SC", sans-serif';

  // 左侧：本侧延迟（我）。textAlign=right，右缘贴 leftX。
  ctx.textAlign = 'right';
  ctx.fillStyle = latColor(myRtt);
  ctx.fillText(myRtt === null ? '我 --' : `我 ${formatRtt(myRtt)}`, leftX, y);

  // 右侧：对手延迟（对）。textAlign=left，左缘贴 rightX。
  ctx.textAlign = 'left';
  ctx.fillStyle = latColor(oppRtt);
  ctx.fillText(oppRtt === null ? '对 --' : `对 ${formatRtt(oppRtt)}`, rightX, y);
  ctx.restore();
}

function aiItemChipLayout(b: Battle): AiItemChip[] {
  if (b.endless || b.aiPickedItems.length === 0) return [];
  if (b.status !== 'ready' && b.status !== 'playing') return [];
  const actR = 13;
  const pasR = 9;
  const actY = HUD_H / 2 - 16;
  const pasY = HUD_H / 2 + 16;
  const rightX = VIEW_W - 12;
  const actGap = actR * 2 + 5;
  const pasGap = pasR * 2 + 3;
  const out: AiItemChip[] = [];
  let actIdx = 0;
  let pasIdx = 0;
  for (let i = 0; i < b.aiPickedItems.length; i++) {
    const id = b.aiPickedItems[i]!;
    const act = activeById(id);
    if (act) {
      if (actIdx >= MAX_EQUIPPED_ACTIVES) continue;
      out.push({
        index: i,
        x: rightX - actR - actIdx * actGap,
        y: actY,
        r: actR,
        color: '#6ab0ff',
        icon: act.icon,
        id,
        kind: 'active',
        slot: b.aiActiveSlots.find((s) => s.id === id),
      });
      actIdx++;
      continue;
    }
    const pas = passiveById(id);
    if (pas) {
      if (pasIdx >= MAX_EQUIPPED_PASSIVES) continue;
      out.push({
        index: i,
        x: rightX - pasR - pasIdx * pasGap,
        y: pasY,
        r: pasR,
        color: '#6ab07a',
        icon: pas.icon,
        id,
        kind: 'passive',
      });
      pasIdx++;
    }
  }
  return out;
}

/** HUD 右上角 AI 对手道具图标命中（返回 aiPickedItems 下标） */
export function hitAiItemChip(x: number, y: number, b: Battle): number | null {
  for (const chip of aiItemChipLayout(b)) {
    if (Math.hypot(x - chip.x, y - chip.y) <= chip.r + 3) return chip.index;
  }
  return null;
}

function drawAiItemsHud(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  const chips = aiItemChipLayout(b);
  if (chips.length === 0) return;
  for (const it of chips) {
    const ready = it.kind === 'passive' || it.slot?.ready !== false;
    drawSkillGlyph(ctx, it.x, it.y, it.r - 1, it.icon, it.color, ready, it.id);
    ctx.save();
    ctx.strokeStyle = it.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(it.x, it.y, it.r + 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (it.kind === 'active' && it.slot && !it.slot.ready && it.slot.cdMax > 0) {
      const frac = it.slot.cd / it.slot.cdMax;
      ctx.save();
      ctx.fillStyle = ACTIVE_CD_OVERLAY;
      ctx.beginPath();
      ctx.moveTo(it.x, it.y);
      ctx.arc(it.x, it.y, it.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (it.kind === 'active' && it.slot?.ready) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 200);
      ctx.save();
      ctx.globalAlpha = 0.28 + pulse * 0.2;
      ctx.strokeStyle = '#6ab0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(it.x, it.y, it.r + 1 + pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (it.kind === 'active' && it.slot && it.slot.flash > 0) {
      ctx.save();
      ctx.globalAlpha = it.slot.flash;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(it.x, it.y, it.r + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // AI 被动生效斜光：与玩家侧一致，命中触发时一道斜光划过图标
    if (it.kind === 'passive') {
      const ft = b.aiPassiveFlash.get(it.id) ?? 0;
      if (ft > 0) drawPassiveSlash(ctx, it.x, it.y, it.r * 2, ft / 0.45);
    }
    if (ui.aiItemPopup === it.index) {
      ctx.save();
      ctx.strokeStyle = '#ffe27a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(it.x, it.y, it.r + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawHud(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  ctx.fillStyle = b.map.theme.hud;
  ctx.fillRect(0, 0, VIEW_W, HUD_H);
  ctx.fillStyle = 'rgba(90,70,40,0.3)';
  ctx.fillRect(0, HUD_H - 2, VIEW_W, 2);
  // 蟠桃在暂停钮右侧，避免与 ‖ 重叠
  const pauseR = pauseBtnRect();
  const peachIconSize = PEACH_UI_ICON_SIZE;
  const peachX = pauseR.x + pauseR.w + 10;
  const peachCy = HUD_H / 2;
  drawPeachIcon(ctx, peachX + peachIconSize / 2, peachCy, peachIconSize);
  ctx.fillStyle = '#7a3b12';
  ctx.font = 'bold 24px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(b.peach), peachX + peachIconSize + 6, peachCy);
  if (ui.peachPopup) {
    const pr = peachHudRect();
    ctx.save();
    ctx.strokeStyle = '#ffe27a';
    ctx.lineWidth = 2;
    roundRect(ctx, pr.x - 2, pr.y, pr.w + 4, pr.h, 8);
    ctx.stroke();
    ctx.restore();
  }
  // 中间两行：波次 + 境界
  ctx.textAlign = 'center';
  ctx.fillStyle = '#4a3a1a';
  const waveStr = `${b.map.name} · 第 ${b.wave} 波`; // 复用：下方两侧延迟布局要据此量中块半宽
  ctx.fillText(waveStr, VIEW_W / 2, HUD_H / 2 - 12);
  // 地图名后挂一枚地图五行徽章（替代原来逐个怪物头顶徽章：小怪与地图同属性，一枚即可表达）
  {
    const mapEl = MAP_ELEMENT[b.map.id];
    if (mapEl && wuxingEnabled()) {
      const waveW = ctx.measureText(waveStr).width;
      const nameW = ctx.measureText(b.map.name).width;
      const textL = VIEW_W / 2 - waveW / 2; // 居中文字左缘
      const gap = 6; // 与地图名拉开一点，别贴字
      drawElementBadge(ctx, textL + nameW + gap + 8, HUD_H / 2 - 12, 8, mapEl);
    }
  }
  const rankStr = hudRankLabel ? `境界·${hudRankLabel}` : null; // 复用：同上（无境界则 null）
  if (rankStr) {
    ctx.font = '14px "PingFang SC", sans-serif';
    ctx.fillStyle = '#8a5a2b';
    ctx.fillText(rankStr, VIEW_W / 2, HUD_H / 2 + 14);
  }
  // Task 9.4：PvP 双方延迟——画到中块左右两侧（左=本侧「我」、右=对手「对」）。
  // 态由 main.ts 每帧 setPvpNetLatency 写入；非对局(null)不画。水平锚点据中块两行最大半宽算，绝不压住居中文字。
  if (pvpNetLat) {
    drawNetLatencyFlanks(ctx, pvpNetLat.myRtt, pvpNetLat.oppRtt, waveStr, rankStr);
  }
  drawAiItemsHud(ctx, b, ui);
  drawBondHudChip(ctx, b);
}

// HUD 左上角（桃前）：播放器风格暂停按钮（两竖条）
function drawPauseBtn(ctx: CanvasRenderingContext2D, b: Battle) {
  if (b.status !== 'ready' && b.status !== 'playing') return;
  const r = pauseBtnRect();
  ctx.save();
  roundRect(ctx, r.x, r.y, r.w, r.h, 8);
  ctx.fillStyle = 'rgba(90, 58, 28, 0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(90, 58, 28, 0.75)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  if (b.isPvp) {
    // PvP：右上角按钮由「暂停」改为「退出」——出门框 + 向右箭头（通用离场图标），
    // 点击弹出对局弹窗但**不暂停**仿真。单人图标（两条竖杠）见 else 分支，保持原样。
    ctx.strokeStyle = '#fff6e6';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 门框：左侧竖线，开口朝右（表示「离开」方向）
    const frameX = cx - 6;
    ctx.beginPath();
    ctx.moveTo(frameX, cy - 8);
    ctx.lineTo(frameX, cy + 8);
    ctx.stroke();
    // 箭头：水平轴 + 三角箭头头，指向右（出框）
    const ax0 = cx - 2;
    const ax1 = cx + 9;
    ctx.beginPath();
    ctx.moveTo(ax0, cy);
    ctx.lineTo(ax1, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax1 - 5.5, cy - 4.5);
    ctx.lineTo(ax1, cy);
    ctx.lineTo(ax1 - 5.5, cy + 4.5);
    ctx.stroke();
  } else {
    // 单人：原暂停图标（两条竖杠）
    const barW = 4.5;
    const barH = r.h * 0.42;
    const gap = 5;
    ctx.fillStyle = '#fff6e6';
    roundRect(ctx, cx - gap / 2 - barW, cy - barH / 2, barW, barH, 1.5);
    ctx.fill();
    roundRect(ctx, cx + gap / 2, cy - barH / 2, barW, barH, 1.5);
    ctx.fill();
  }
  ctx.restore();
}

/** 蟠桃够征兵时：外圈光晕(halo) + 按钮内高光/描边(edge) */
function drawSummonReadyReminder(ctx: CanvasRenderingContext2D, btn: Button, phase: 'halo' | 'edge') {
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 200);
  if (phase === 'halo') {
    const expand = pulse * 4; // 呼吸外圈最大扩张（略增，让「可征兵」提示更醒目）
    ctx.save();
    ctx.globalAlpha = 0.40 + pulse * 0.30; // 外圈描边稍提亮
    ctx.strokeStyle = '#ffe27a';
    ctx.lineWidth = 3;
    roundRect(ctx, btn.x - expand, btn.y - expand, btn.w + expand * 2, btn.h + expand * 2, 14);
    ctx.stroke();
    ctx.globalAlpha = 0.18 + pulse * 0.12; // 外圈柔光更明显
    ctx.lineWidth = 8;
    roundRect(ctx, btn.x - expand - 2, btn.y - expand - 2, btn.w + (expand + 2) * 2, btn.h + (expand + 2) * 2, 16);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 12);
  ctx.clip();
  ctx.globalAlpha = 0.26 + pulse * 0.16; // 内高光略提亮
  const grad = ctx.createLinearGradient(btn.x, btn.y, btn.x, btn.y + btn.h * 0.55);
  grad.addColorStop(0, '#fff6c8');
  grad.addColorStop(1, 'rgba(255,246,200,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.72 + pulse * 0.26; // 内描边更醒目
  ctx.strokeStyle = '#fff0a8';
  ctx.lineWidth = 3;
  roundRect(ctx, btn.x + 1, btn.y + 1, btn.w - 2, btn.h - 2, 11);
  ctx.stroke();
  ctx.restore();
}

function drawButtons(ctx: CanvasRenderingContext2D, b: Battle) {
  for (const btn of getButtons(b)) {
    // 主动技能图标(act*)与被动技能格(pas*)由 drawActiveIcons/drawPassiveRow 单独绘制，这里只出命中矩形
    if (btn.id.startsWith('act') || btn.id.startsWith('pas')) continue;
    if (btn.id === 'summon' && btn.enabled) {
      drawSummonReadyReminder(ctx, btn, 'halo');
    }
    roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 12);
    ctx.fillStyle = btn.id === 'summon' && btn.enabled ? '#d4a030' : btn.enabled ? b.map.theme.accent : '#2a2218';
    ctx.fill();
    {
      // 征兵按钮：按当前蟠桃/成本填充进度条（参考竞品，桃攒够即满格可点）
      // 进度用固定琥珀金（不跟地图 accent），避免流沙河/白骨岭等 accent 与灰字糊成一团
      if (btn.id === 'summon') {
        const prog = Math.max(0, Math.min(1, b.peach / b.effectiveSummonCost()));
        if (!btn.enabled && prog > 0) {
          ctx.save();
          ctx.beginPath();
          roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 12);
          ctx.clip();
          ctx.fillStyle = '#d4a84a';
          ctx.globalAlpha = 0.9;
          ctx.fillRect(btn.x, btn.y, btn.w * prog, btn.h);
          ctx.restore();
        }
      }
      const tx = btn.x + btn.w / 2;
      const ty = btn.y + btn.h / 2;
      ctx.font = `bold ${btn.w < 140 ? 16 : 20}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 征兵/布阵：浅字 + 深描边，在进度填充与深底上都能读清（四图统一）
      if (btn.id === 'summon') {
        // 文字与桃子分开画：留间距；不可征兵时桃子变灰
        const peachSize = PEACH_UI_ICON_SIZE;
        const gap = 10;
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(20,14,8,0.92)';
        const textW = ctx.measureText(btn.label).width;
        const totalW = textW + gap + peachSize;
        const textX = tx - totalW / 2 + textW / 2;
        const peachX = tx - totalW / 2 + textW + gap + peachSize / 2;
        ctx.strokeText(btn.label, textX, ty);
        ctx.fillStyle = btn.enabled ? '#fff8e8' : '#fff3d6';
        ctx.fillText(btn.label, textX, ty);
        drawPeachIcon(ctx, peachX, ty, peachSize, { gray: !btn.enabled });
      } else if (btn.id === 'autoplace') {
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(20,14,8,0.92)';
        ctx.strokeText(btn.label, tx, ty);
        ctx.fillStyle = btn.enabled ? '#fff8e8' : '#fff3d6';
        ctx.fillText(btn.label, tx, ty);
      } else {
        ctx.fillStyle = btn.enabled ? '#fff6e6' : '#7a7160';
        ctx.fillText(btn.label, tx, ty);
      }
      if (btn.id === 'summon' && btn.enabled) {
        drawSummonReadyReminder(ctx, btn, 'edge');
      }
      // 征兵/布阵点击闪光
      if (btn.id === 'summon' && b.summonFlash > 0) {
        ctx.save();
        ctx.globalAlpha = b.summonFlash;
        ctx.strokeStyle = '#ffe89a';
        ctx.lineWidth = 4;
        roundRect(ctx, btn.x - 2, btn.y - 2, btn.w + 4, btn.h + 4, 12);
        ctx.stroke();
        ctx.restore();
      }
      if (btn.id === 'autoplace' && b.autoplaceFlash > 0) {
        ctx.save();
        ctx.globalAlpha = b.autoplaceFlash;
        ctx.strokeStyle = '#b8e8ff';
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
    drawSkillGlyph(ctx, cx, cy, r - 1, def?.icon ?? '?', '#b5762a', slot.ready, slot.id);
    if (!slot.ready) {
      // 剩余冷却扇形（从 12 点方向顺时针覆盖，比例=剩余CD），半径与圆一致
      const frac = slot.cdMax > 0 ? slot.cd / slot.cdMax : 0;
      ctx.save();
      ctx.fillStyle = ACTIVE_CD_OVERLAY;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      // 就绪：与征兵提示同色系、更慢更淡的金边脉冲
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 200);
      ctx.save();
      ctx.globalAlpha = 0.28 + pulse * 0.2;
      ctx.strokeStyle = '#ffe27a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 1 + pulse, 0, Math.PI * 2);
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
    if (isPillActiveEffect(def?.effect ?? 'palm')) {
      const roster = b.pillBuffRoster(def!.effect as 'atkBuff' | 'frqBuff');
      if (roster.length > 0) {
        ctx.fillStyle = '#fff6e6';
        ctx.font = 'bold 11px "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(roster.length), cx + r * 0.55, cy - r * 0.55);
      }
    }
  }
}

// 被动技能生效时的对角斜光：一道亮带斜划过图标，prog(0..1) 驱动淡出（用于陨石/洛阳铲/蟠桃园等触发瞬间反馈）
function drawPassiveSlash(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, prog: number): void {
  const a = Math.max(0, Math.min(1, prog));
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = a;
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4); // 左上→右下斜光
  const len = size * 1.5;
  const wid = size * 0.34;
  const g = ctx.createLinearGradient(-len / 2, 0, len / 2, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.42, 'rgba(255,248,210,0.85)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(0.58, 'rgba(255,248,210,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-len / 2, -wid / 2, len, wid);
  ctx.globalAlpha = a * 0.9; // 核心细高光
  ctx.fillStyle = '#fffce8';
  ctx.fillRect(-len / 2, -0.6, len, 1.2);
  ctx.restore();
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
    drawSkillGlyph(
      ctx,
      btn.x + btn.w / 2,
      btn.y + btn.h / 2,
      Math.min(btn.w, btn.h) * 0.38,
      def.icon ?? def.name[0]!,
      '#6ab07a',
      true,
      def.id,
    );
    // 被动生效斜光：flashPassive 设了剩余秒数时，一道斜光划过图标（斜光时长见 flashPassive dur，默认 0.45s）
    const flashT = b.passiveFlash.get(def.id) ?? 0;
    if (flashT > 0) drawPassiveSlash(ctx, btn.x + btn.w / 2, btn.y + btn.h / 2, btn.w, flashT / 0.45);
  }
}

// 主动技能介绍弹窗：点击图标查看说明与本局已增益单位
function drawActivePopup(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (ui.activePopup === null || performance.now() > ui.activePopupUntil) return;
  const slot = b.activeSlots[ui.activePopup];
  if (!slot) return;
  const def = activeById(slot.id);
  if (!def) return;
  const pill = isPillActiveEffect(def.effect);
  const roster = pill ? b.pillBuffRoster(def.effect) : [];
  const w = 300, pad = 16, lineH = 18;
  ctx.save();
  ctx.font = '13px "PingFang SC", sans-serif';
  const descLines = wrapText(ctx, def.desc, w - pad * 2);
  const statusLines: string[] = pill
    ? [roster.length > 0 ? `本局已增益：${roster.join('、')}` : '本局已增益：无']
    : [];
  const h = 66 + descLines.length * lineH + statusLines.length * lineH + 14;
  const x = (VIEW_W - w) / 2, y = BOARD_Y + 20;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = 'rgba(30,24,18,0.94)';
  ctx.fill();
  ctx.strokeStyle = '#6ab0ff'; // 主动技能=蓝框
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = SKILL_TITLE_COLOR;
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.fillText(def.name, x + pad, y + 12);
  ctx.fillStyle = '#8fd3ff';
  ctx.font = '12px "PingFang SC", sans-serif';
  const cdLine = slot.ready
    ? (pill ? '就绪 · 拖到兵器或武将' : isBombActiveEffect(def.effect) ? '就绪 · 拖到路径格埋雷' : '就绪')
    : `冷却 ${def.cd}s · 剩余 ${Math.ceil(slot.cd)}s`;
  ctx.fillText(cdLine, x + pad, y + 40);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '13px "PingFang SC", sans-serif';
  let ty = y + 62;
  for (const ln of descLines) {
    ctx.fillText(ln, x + pad, ty);
    ty += lineH;
  }
  for (const ln of statusLines) {
    ctx.fillStyle = '#a0e8b0';
    ctx.fillText(ln, x + pad, ty);
    ty += lineH;
  }
  ctx.restore();
}

// 路径上已埋地雷的信息弹窗（点击地雷打开）：显示归属、伤害、范围、触发方式、CD
// 与武器信息面板同款：放对方半场（玩家雷→AI半场、对手雷→玩家半场），水平居中，避免挡自己的棋盘。
function drawBombPopup(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState): void {
  if (!ui.bombPopup || performance.now() > ui.bombPopup.until) return;
  const { c, r } = ui.bombPopup;
  const isAi = b.aiBombs.some((bm) => bm.c === c && bm.r === r);
  const def = activeById('act_bomb');
  if (!def) return;
  const w = 248, pad = 14, lineH = 18;
  ctx.save();
  ctx.font = '13px "PingFang SC", sans-serif';
  const desc = wrapText(ctx, def.desc, w - pad * 2);
  const stats = [
    `归属：${isAi ? '对手埋设' : '我方埋设'}`,
    `伤害：波血×${TUNING.bombDmgMul}`,
    `范围：半径 ${TUNING.bombExplodeRadius} 格 · 踏入即爆`,
    `CD：${def.cd}s · 每格最多 1 颗`,
  ];
  const h = 52 + desc.length * lineH + stats.length * lineH;
  // 对方半场 + 水平居中（与 drawUnitInfoPanel 一致）：玩家雷放 AI 半场，对手雷放玩家半场
  const panelHalf = isAi ? 'player' : 'ai';
  const x = BOARD_X + (COLS * CELL) / 2 - w / 2;
  const y = infoPanelTop(h, panelHalf);
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = 'rgba(28,22,14,0.92)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#c8792b'; // 与其他信息面板统一的棕金描边
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // 标题（大号、统一金色）
  ctx.fillStyle = '#ffe6b0';
  ctx.font = 'bold 17px "PingFang SC", sans-serif';
  ctx.fillText(def.name, x + pad, y + 18);
  let ty = y + 42;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.textBaseline = 'top';
  for (const ln of desc) { ctx.fillText(ln, x + pad, ty); ty += lineH; }
  ctx.fillStyle = '#ffd76a';
  for (const ln of stats) { ctx.fillText(ln, x + pad, ty); ty += lineH; }
  ctx.restore();
}

// 我方 HUD 蟠桃：当前数量 + 获取途径（点击桃子打开）
function drawPeachPopup(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (!ui.peachPopup) return;
  const w = 320, pad = 16, lineH = 18;
  const lines = [
    `当前蟠桃：${b.peach}`,
    `征兵费用：${b.effectiveSummonCost()}（用桃召募士兵与武将）`,
    '',
    '获取途径：',
    `· 开局赠送 ${ECONOMY.INITIAL_PEACH} 桃（功德可额外加成）`,
    `· 击杀妖怪：普通 +${ECONOMY.PEACH_PER_KILL} / 精英 +${ECONOMY.PEACH_PER_ELITE} / 小Boss +${ECONOMY.PEACH_PER_MINI_BOSS} / 妖王 +${ECONOMY.PEACH_PER_BOSS}`,
    `· 唐僧漏怪掉血：+${ECONOMY.PEACH_PER_BLEED}（舍身饲魔）`,
    '· 被动加成：蟠桃园产桃、聚宝盆击杀多桃、摸金校尉挖地加桃等',
  ];
  ctx.save();
  ctx.font = '13px "PingFang SC", sans-serif';
  const wrapped: string[] = [];
  for (const ln of lines) {
    if (!ln) { wrapped.push(''); continue; }
    wrapped.push(...wrapText(ctx, ln, w - pad * 2));
  }
  const h = 52 + wrapped.length * lineH + 12;
  const x = (VIEW_W - w) / 2, y = BOARD_Y + 20;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = 'rgba(30,24,18,0.94)';
  ctx.fill();
  ctx.strokeStyle = '#e8a060';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = SKILL_TITLE_COLOR;
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.fillText('蟠桃', x + pad, y + 14);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = '13px "PingFang SC", sans-serif';
  let ty = y + 44;
  for (const ln of wrapped) {
    if (ln === '') { ty += lineH * 0.45; continue; }
    ctx.fillText(ln, x + pad, ty);
    ty += lineH;
  }
  ctx.restore();
}

// 被动/强化道具详情弹窗（点击图标后展示，定时自动淡出）
function drawPassivePopup(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (ui.passivePopup === null || performance.now() > ui.passivePopupUntil) return;
  const def = passiveById(b.pickedItems[ui.passivePopup] ?? '');
  if (!def) return;
  const w = 300, pad = 16, lineH = 18;
  ctx.save();
  ctx.font = '13px "PingFang SC", sans-serif';
  const descLines = wrapText(ctx, def.desc, w - pad * 2);
  const h = 56 + descLines.length * lineH + 18;
  const x = (VIEW_W - w) / 2, y = BOARD_Y + 20;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = 'rgba(30,24,18,0.94)';
  ctx.fill();
  ctx.strokeStyle = '#6ab07a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = SKILL_TITLE_COLOR;
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.fillText(def.name, x + pad, y + 14);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '13px "PingFang SC", sans-serif';
  let ty = y + 48;
  for (const ln of descLines) {
    ctx.fillText(ln, x + pad, ty);
    ty += lineH;
  }
  ctx.restore();
}

// AI 对手道具详情（HUD 右上角图标点击）
function drawAiItemPopup(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (ui.aiItemPopup === null) return;
  const id = b.aiPickedItems[ui.aiItemPopup];
  if (!id) return;
  const act = activeById(id);
  const pas = passiveById(id);
  const def = act ?? pas;
  if (!def) return;

  const w = 300, pad = 16, lineH = 18;
  ctx.save();
  ctx.font = '13px "PingFang SC", sans-serif';
  const descLines = wrapText(ctx, def.desc, w - pad * 2);
  const slot = act ? b.aiActiveSlots.find((s) => s.id === id) : undefined;
  const extraLine = slot ? 1 : 0;
  const h = 72 + descLines.length * lineH + extraLine * lineH + 14;
  const x = (VIEW_W - w) / 2, y = BOARD_Y + 20;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = 'rgba(30,24,18,0.94)';
  ctx.fill();
  ctx.strokeStyle = act ? '#6ab0ff' : '#6ab07a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,230,200,0.75)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(`AI对手 · ${act ? '主动技能' : '被动技能'}`, x + pad, y + 12);
  ctx.fillStyle = SKILL_TITLE_COLOR;
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.fillText(def.name, x + pad, y + 30);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '13px "PingFang SC", sans-serif';
  let ty = y + 56;
  if (slot) {
    const cdText = slot.ready
      ? '状态：就绪（AI 自动释放）'
      : `冷却：${Math.ceil(slot.cd)}s / ${slot.cdMax}s`;
    ctx.fillStyle = slot.ready ? '#a0e8b0' : 'rgba(255,255,255,0.75)';
    ctx.fillText(cdText, x + pad, ty);
    ty += lineH;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
  }
  for (const ln of descLines) {
    ctx.fillText(ln, x + pad, ty);
    ty += lineH;
  }
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
  if (token.kind === 'shovel') {
    return b.lockedCells().some((c) => c.c === cell.c && c.r === cell.r)
      && !b.trees.has(`${cell.c},${cell.r}`);
  }
  if (token.kind === 'tree') {
    return b.lockedCells().some((c) => c.c === cell.c && c.r === cell.r);
  }
  if (!b.unlockedCells().some((c) => c.c === cell.c && c.r === cell.r)) return false;
  if (token.kind === 'word') {
    return true; // 空格放置 / 字牌交换 / 与兵交换
  }
  // 兵种：空格放置 / 合并 / 与兵或字牌交换
  return true;
}

/** 候选区内另一槽是否可作为合并或交换目标 */
function trayTokenCanMergeSlot(a: TrayToken, b: TrayToken | undefined): boolean {
  if (!b) return false;
  if (a.kind === 'word' && b.kind === 'word') {
    return false; // 单字不可合并
  }
  if (a.kind === 'unit' && b.kind === 'unit') {
    return canMerge({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier });
  }
  if (a.kind === 'tree' && b.kind === 'tree') {
    return a.level === b.level && a.level < PEACH_TREE.maxLevel;
  }
  return true; // 字/兵/铲/桃异类 → 交换
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

function drawPillDropHints(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (ui.dragActiveSlot === null || !ui.dragPos) return;
  const slot = b.activeSlots[ui.dragActiveSlot];
  const def = slot ? activeById(slot.id) : undefined;
  if (!def) return;
  // 炸药：参考兵器布置——先用黄色四角框标出所有「可埋」的路径格，再高亮鼠标所在格
  if (isBombActiveEffect(def.effect)) {
    // 所有可埋路径格打黄色四角框+中央「+」（与兵器部署的可落格标识同款；唐僧格 / 已埋格与
    // placeBomb 同口径自动排除）。「+」含义同为「空位可落」——路径格对炸药而言空格即可埋。
    for (const pc of b.map.path) {
      if (!b.canPlaceBomb(pc)) continue;
      drawAimReticle(ctx, BOARD_X + pc.c * CELL, BOARD_Y + pc.r * CELL, CELL, CELL, { plus: true, fill: false });
    }
    // 鼠标所在格：路径合法且未埋=橙，否则=红（精确落点反馈）
    const cell = pxToCell(ui.dragPos.x, ui.dragPos.y);
    if (cell) {
      const ok = b.canPlaceBomb(cell);
      const x = BOARD_X + cell.c * CELL;
      const y = BOARD_Y + cell.r * CELL;
      ctx.save();
      roundRect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 8);
      ctx.fillStyle = ok ? 'rgba(255,150,40,0.24)' : 'rgba(200,60,50,0.20)';
      ctx.fill();
      ctx.strokeStyle = ok ? '#ff9a30' : '#c8433a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    return;
  }
  if (!isPillActiveEffect(def.effect)) return;
  const effect = def.effect;
  const seen = new Set<string>();
  const mark = (c: Cell) => {
    const k = `${c.c},${c.r}`;
    if (seen.has(k) || !b.canApplyPill(c, effect)) return;
    seen.add(k);
    const x = BOARD_X + c.c * CELL;
    const y = BOARD_Y + c.r * CELL;
    ctx.save();
    roundRect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 8);
    ctx.fillStyle = effect === 'atkBuff' ? 'rgba(255,90,60,0.22)' : 'rgba(255,180,40,0.22)';
    ctx.fill();
    ctx.strokeStyle = effect === 'atkBuff' ? '#ff7050' : '#ffc040';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  };
  for (const u of b.units.values()) mark(u.cell);
  for (const g of b.activeGenerals()) for (const c of g.cells) mark(c);
}

function drawDragGhost(ctx: CanvasRenderingContext2D, b: Battle, ui: UiState) {
  if (!ui.dragPos) return;
  let src: { x: number; y: number } | null = null;
  let ghost: (() => void) | null = null;
  if (ui.dragActiveSlot !== null) {
    const slot = b.activeSlots[ui.dragActiveSlot];
    const def = slot ? activeById(slot.id) : undefined;
    if (def) {
      src = activeSlotCenter(ui.dragActiveSlot as 0 | 1);
      ghost = () => drawSkillGlyph(ctx, ui.dragPos!.x, ui.dragPos!.y, CELL * 0.28, def.icon, '#b5762a', true, def.id);
    }
  } else if (ui.dragFrom) {
    const u = b.units.get(`${ui.dragFrom.c},${ui.dragFrom.r}`);
    if (u) {
      src = cellCenterPx(ui.dragFrom.c, ui.dragFrom.r);
      ghost = () => drawUnit(ctx, u.type, u.tier, ui.dragPos!.x, ui.dragPos!.y, CELL * 0.72);
    } else {
      const w = b.words.get(`${ui.dragFrom.c},${ui.dragFrom.r}`);
      if (w) {
        src = cellCenterPx(ui.dragFrom.c, ui.dragFrom.r);
        // 拖拽中若仍属激活武将，保持品质色与加粗
        let qTier = 0;
        for (const g of b.activeGenerals()) {
          if (g.cells.some((c) => c.c === ui.dragFrom!.c && c.r === ui.dragFrom!.r)) {
            qTier = g.tier;
            break;
          }
        }
        ghost = () => drawWordTile(ctx, w.char, w.tier, ui.dragPos!.x, ui.dragPos!.y, CELL * 0.74, qTier === 0, qTier);
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
      const tokenSize = token.kind === 'word' ? CELL * 0.78 : TRAY_H - 16;
      ghost = () => drawTrayToken(ctx, token, ui.dragPos!.x, ui.dragPos!.y, tokenSize);
    }
  }
  if (!ghost) return;

  // 仙丹/风火轮：可投放格高亮（在 ghost 与虚线之下）
  if (ui.dragActiveSlot !== null) drawPillDropHints(ctx, b, ui);

  // 托盘拖拽：先画全部可落点瞄准标记（在 ghost 之下）
  if (ui.dragTrayIndex !== null) drawTrayDropHints(ctx, b, ui);

  // 棋盘拖回候选区：空槽标「+」；已占槽若与棋盘件同型同级（可合并升阶）标淡黄底（与托盘拖拽提示同款）
  if (ui.dragFrom && ui.dragTrayIndex === null) {
    // 合成候选件：优先单位，其次桃树（字牌单字不可合并，只走空槽/交换）
    const dragUnit = b.units.get(`${ui.dragFrom.c},${ui.dragFrom.r}`);
    const dragTree = b.trees.get(`${ui.dragFrom.c},${ui.dragFrom.r}`);
    for (let i = 0; i < TUNING.traySize; i++) {
      const cx = TRAY_LEFT + i * TRAY_SLOT;
      if (!b.tray[i]) {
        drawAimReticle(ctx, cx + 3, TRAY_Y + 5, TRAY_SLOT - 6, TRAY_H - 10, {
          plus: true,
          fill: true,
        });
        continue;
      }
      const occupy = b.tray[i]!;
      const mergeOk = dragUnit && occupy.kind === 'unit'
        ? canMerge({ type: dragUnit.type, tier: dragUnit.tier }, { type: occupy.type, tier: occupy.tier })
        : dragTree && occupy.kind === 'tree'
          ? occupy.level === dragTree.level && dragTree.level < PEACH_TREE.maxLevel
          : false;
      if (mergeOk) {
        drawAimReticle(ctx, cx + 3, TRAY_Y + 5, TRAY_SLOT - 6, TRAY_H - 10, {
          plus: false,
          fill: true,
        });
      }
    }
  }

  // 当前悬停格加粗描边
  const target = pxToCell(ui.dragPos.x, ui.dragPos.y);
  if (target) {
    const x = BOARD_X + target.c * CELL;
    const y = BOARD_Y + target.r * CELL;
    roundRect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 8);
    ctx.strokeStyle = '#e8a13c';
    ctx.lineWidth = 3;
    ctx.stroke();

    if (ui.dragFrom) {
      // 棋盘内拖兵种时预览落点范围
      const u = b.units.get(`${ui.dragFrom.c},${ui.dragFrom.r}`);
      if (u && b.unlockedCells().some((c) => c.c === target.c && c.r === target.r)) {
        const center = cellCenterPx(target.c, target.r);
        const stat = getUnitStat(u.type, u.tier);
        drawRangeRing(ctx, center.x, center.y, stat.rge);
      }
    }
  }

  // tray 按住武器令牌：始终展示武器信息面板 + 攻击范围(悬停合法格→格中心，否则→ghost处随手跟随)
  if (ui.dragTrayIndex !== null) {
    const token = b.tray[ui.dragTrayIndex];
    if (token && token.kind === 'unit') {
      const onCell = target && trayTokenCanDropOnCell(b, token, target);
      const center = onCell ? cellCenterPx(target.c, target.r) : { x: ui.dragPos.x, y: ui.dragPos.y };
      const stat = getUnitStat(token.type, token.tier);
      drawRangeRing(ctx, center.x, center.y, stat.rge);
      drawUnitInfoPanel(ctx, token.type, token.tier);
    }
  }
  // 源→当前的虚线连接（托盘令牌 / 棋盘单位 / 仙丹·风火轮 共用）
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

/** 玩家一键布阵：模拟选中候选槽 + 虚线拖向目标格（与手动拖拽视觉一致） */
function drawAutoPlaceDrag(ctx: CanvasRenderingContext2D, b: Battle) {
  const d = b.autoPlaceDragFx[0];
  if (!d) return;
  const p = d.t / PLACE_TIMING.dragDur;
  const eased = placeDragEase(p);
  const src = traySlotCenter(d.trayIndex);
  const dst = cellCenterPx(d.c, d.r);
  const gx = src.x + (dst.x - src.x) * eased;
  const gy = src.y + (dst.y - src.y) * eased;

  const tx = BOARD_X + d.c * CELL;
  const ty = BOARD_Y + d.r * CELL;
  drawAimReticle(ctx, tx, ty, CELL, CELL, {
    plus: d.commit === 'placeUnit' || d.commit === 'placeWord' || d.commit === 'digShovel',
    fill: true,
  });
  roundRect(ctx, tx + 2, ty + 2, CELL - 4, CELL - 4, 8);
  ctx.strokeStyle = '#e8a13c';
  ctx.lineWidth = 3;
  ctx.stroke();

  {
    const cx = TRAY_LEFT + d.trayIndex * TRAY_SLOT;
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

  ctx.save();
  ctx.strokeStyle = 'rgba(120,90,40,0.8)';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(src.x, src.y);
  ctx.lineTo(gx, gy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  const tokenSize = d.token.kind === 'word' ? CELL * 0.78 : TRAY_H - 16;
  ctx.globalAlpha = 0.9;
  drawTrayToken(ctx, d.token, gx, gy, tokenSize);
  ctx.globalAlpha = 1;

  if (d.token.kind === 'unit') {
    const stat = getUnitStat(d.token.type, d.token.tier);
    drawRangeRing(ctx, dst.x, dst.y, stat.rge);
  }
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

// —— DevTools 特效预览：在独立 canvas 上播放战斗 FX（复用局内绘制） ——
export type DevFxPreviewSpec =
  | { kind: 'heroAttack'; heroId: string; tier?: number }
  | { kind: 'heroUlt'; heroId: string; tier?: number }
  | { kind: 'unitAttack'; unit: UnitType; tier?: number }
  | { kind: 'activeSkill'; skill: SkillFxKind }
  | { kind: 'burst'; burst: 'hit' | 'death' | 'merge' }
  | { kind: 'dig' }
  | { kind: 'palm' };

interface FxPreviewPalm {
  path: Cell[];
  t: number;
  dur: number;
  fadeT: number;
  cells: number;
  frontStartDist: number;
}

interface FxPreviewStub {
  fx: HitFx[];
  heroUltFx: HeroUltFx[];
  erlangDogFx: ErlangDogFx[];
  playerSkillFx: SkillFx | null;
  bursts: Burst[];
  digFx: { c: number; r: number; t: number }[];
  palm: FxPreviewPalm | null;
}

let _devFxPreviewStop: (() => void) | null = null;

/** 在 canvas 上播放一次特效；返回 stop。再次调用会打断上一次。 */
export function playDevFxPreview(canvas: HTMLCanvasElement, spec: DevFxPreviewSpec): () => void {
  _devFxPreviewStop?.();
  // 预览用虚拟格坐标：落点居中，来源在左下，避免大招/技能画在边角被裁切
  const toC = 4;
  const toR = 9;
  const fromC = 2;
  const fromR = 11;
  const midC = toC;
  const midR = toR;
  const stub: FxPreviewStub = {
    fx: [],
    heroUltFx: [],
    erlangDogFx: [],
    playerSkillFx: null,
    bursts: [],
    digFx: [],
    palm: null,
  };

  let contentHalfW = CELL * 2.2;
  let contentHalfH = CELL * 1.8;
  let focusX = 0;
  let focusY = 0;

  if (spec.kind === 'heroAttack') {
    const def = generalById(spec.heroId);
    const tier = Math.max(1, Math.min(def?.maxTier ?? 5, spec.tier ?? def?.maxTier ?? 5));
    const ttl = def ? heroAttackFxTtl(def, tier) : 0.4;
    stub.fx.push({
      from: { c: fromC, r: fromR },
      to: { c: toC, r: toR },
      ttl,
      maxTtl: ttl,
      color: qualityColor(tier),
      tier,
      heroId: spec.heroId,
    });
    const a = cellCenterPx(fromC, fromR);
    const b = cellCenterPx(toC, toR);
    focusX = (a.x + b.x) / 2;
    focusY = (a.y + b.y) / 2;
    contentHalfW = Math.max(CELL * 2.4, Math.abs(b.x - a.x) * 0.65 + CELL * 1.2);
    contentHalfH = Math.max(CELL * 2.0, Math.abs(b.y - a.y) * 0.65 + CELL * 1.2);
  } else if (spec.kind === 'heroUlt') {
    const def = generalById(spec.heroId);
    const tier = Math.max(1, Math.min(def?.maxTier ?? 5, spec.tier ?? def?.maxTier ?? 5));
    const rge = def?.rge ?? 2.5;
    const crit = def ? (def.skill === 'ranged') : false;
    const ttl = spec.heroId === 'dasheng' ? 0.9 : 0.6;
    const needsOrigin =
      spec.heroId === 'dasheng'
      || spec.heroId === 'erlang'
      || spec.heroId === 'niulang'
      || spec.heroId === 'niumowang';
    stub.heroUltFx.push({
      heroId: spec.heroId,
      c: toC,
      r: toR,
      ttl,
      maxTtl: ttl,
      tier,
      rge,
      crit,
      ...(needsOrigin ? { fromC, fromR } : {}),
    });
    const to = cellCenterPx(toC, toR);
    if (needsOrigin) {
      const from = cellCenterPx(fromC, fromR);
      focusX = (from.x + to.x) / 2;
      focusY = (from.y + to.y) / 2;
      contentHalfW = Math.max(rge * CELL * 0.85, Math.abs(to.x - from.x) * 0.65 + CELL * 1.4);
      contentHalfH = Math.max(rge * CELL * 0.85, Math.abs(to.y - from.y) * 0.65 + CELL * 1.4);
    } else {
      // 青牛上冲 / 红孩天火 / 观音净瓶抬升：焦点略上移，避免裁切
      const upBias = spec.heroId === 'qingniu' || spec.heroId === 'honghaier' || spec.heroId === 'guanyin'
        ? CELL * rge * 0.35
        : spec.heroId === 'fanyin'
          ? CELL * rge * 0.22
          : 0;
      // 铁扇巨扇挥扫、大蟒裂纹残骸：更宽留边
      const wideMargin = spec.heroId === 'tieshan' || spec.heroId === 'damang' ? 1.55 : 1.05;
      focusX = to.x;
      focusY = to.y - upBias;
      contentHalfW = Math.max(CELL * 2.2, rge * CELL * wideMargin);
      contentHalfH = Math.max(CELL * 2.0, rge * CELL * (wideMargin + 0.1) + upBias);
    }
  } else if (spec.kind === 'unitAttack') {
    const tier = Math.max(1, Math.min(5, spec.tier ?? 3));
    const ttl = 0.28 + tier * 0.04;
    stub.fx.push({
      from: { c: fromC, r: fromR },
      to: { c: toC, r: toR },
      ttl,
      maxTtl: ttl,
      color: '#e8d090',
      wtype: spec.unit,
      tier,
    });
    const a = cellCenterPx(fromC, fromR);
    const b = cellCenterPx(toC, toR);
    focusX = (a.x + b.x) / 2;
    focusY = (a.y + b.y) / 2;
    contentHalfW = Math.max(CELL * 2.2, Math.abs(b.x - a.x) * 0.65 + CELL * 1.1);
    contentHalfH = Math.max(CELL * 1.8, Math.abs(b.y - a.y) * 0.65 + CELL * 1.1);
  } else if (spec.kind === 'activeSkill') {
    const dur = spec.skill === 'atkBuff' || spec.skill === 'frqBuff' ? BUFF_SKILL_FX_DUR : SKILL_FX_DUR;
    stub.playerSkillFx = { kind: spec.skill, t: 0, dur, c: midC, r: midR };
    const mid = cellCenterPx(midC, midR);
    focusX = mid.x;
    focusY = mid.y;
    // 紧箍/陨石/冰封按清场半径铺开
    const aoeR = spec.skill === 'meteor'
      ? TUNING.meteorRadius
      : (spec.skill === 'jinggu' || spec.skill === 'freeze')
        ? TUNING.aiClearRadius
        : 1.2;
    const aoe = aoeR * CELL * 1.15;
    contentHalfW = Math.max(CELL * 2.4, aoe);
    contentHalfH = Math.max(CELL * 2.2, aoe);
    if (spec.skill === 'meteor') {
      // 陨石从上方落下，焦点略上移并加高
      focusY -= CELL * 1.2;
      contentHalfH += CELL * 1.4;
    }
  } else if (spec.kind === 'dig') {
    stub.digFx.push({ c: toC, r: toR, t: 0 });
    const to = cellCenterPx(toC, toR);
    focusX = to.x;
    focusY = to.y;
    contentHalfW = CELL * 1.6;
    contentHalfH = CELL * 1.6;
  } else if (spec.kind === 'palm') {
    // 短水平路径：波前从右侧回推向左（复用局内掌印绘制）
    const palmPath: Cell[] = [];
    for (let i = 0; i <= 5; i++) palmPath.push({ c: 1 + i, r: midR });
    const frontStartDist = lenOf(palmPath) - 0.2;
    const pushCells = 3.2;
    stub.palm = {
      path: palmPath,
      t: 0,
      dur: SKILL_FX_DUR,
      fadeT: 0,
      cells: pushCells,
      frontStartDist,
    };
    const a = cellCenterPx(palmPath[0]!.c, palmPath[0]!.r);
    const b = cellCenterPx(palmPath[palmPath.length - 1]!.c, palmPath[palmPath.length - 1]!.r);
    focusX = (a.x + b.x) / 2;
    focusY = (a.y + b.y) / 2;
    contentHalfW = Math.max(CELL * 2.4, Math.abs(b.x - a.x) * 0.55 + CELL * 1.4);
    contentHalfH = CELL * 2.0;
  } else {
    const ttl = spec.burst === 'death' ? 0.55 : 0.4;
    stub.bursts.push({
      kind: spec.burst,
      c: toC,
      r: toR,
      ttl,
      maxTtl: ttl,
      big: spec.burst === 'death',
      color: spec.burst === 'merge' ? '#7ec46a' : '#ffcf5a',
    });
    const to = cellCenterPx(toC, toR);
    focusX = to.x;
    focusY = to.y;
    contentHalfW = CELL * 1.8;
    contentHalfH = CELL * 1.8;
  }

  let raf = 0;
  let last = performance.now();
  let alive = true;

  const stop = () => {
    alive = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (_devFxPreviewStop === stop) _devFxPreviewStop = null;
  };
  _devFxPreviewStop = stop;

  const tick = (now: number) => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const f of stub.fx) f.ttl -= dt;
    stub.fx = stub.fx.filter((f) => f.ttl > 0);
    for (const f of stub.heroUltFx) f.ttl -= dt;
    stub.heroUltFx = stub.heroUltFx.filter((f) => f.ttl > 0);
    for (const b of stub.bursts) b.ttl -= dt;
    stub.bursts = stub.bursts.filter((b) => b.ttl > 0);
    if (stub.playerSkillFx) {
      stub.playerSkillFx.t += dt;
      if (stub.playerSkillFx.t >= stub.playerSkillFx.dur) stub.playerSkillFx = null;
    }
    for (const d of stub.digFx) d.t += dt;
    stub.digFx = stub.digFx.filter((d) => d.t < PLACE_TIMING.digDur);
    if (stub.palm) {
      stub.palm.t += dt;
      if (stub.palm.t >= stub.palm.dur) {
        stub.palm.fadeT += dt;
        if (stub.palm.fadeT >= PALM_PUSH_FADE_DUR) stub.palm = null;
      }
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 360;
    const cssH = canvas.clientHeight || 280;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#1a1510';
      ctx.fillRect(0, 0, cssW, cssH);
      // 网格点缀
      ctx.strokeStyle = 'rgba(232,208,144,0.08)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo((cssW / 8) * i, 0);
        ctx.lineTo((cssW / 8) * i, cssH);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, (cssH / 6) * i);
        ctx.lineTo(cssW, (cssH / 6) * i);
        ctx.stroke();
      }
      // 按内容包围盒适配缩放，保证落在画布中央且尽量完整
      const pad = 0.88;
      const scale = Math.min(
        (cssW * pad) / (contentHalfW * 2),
        (cssH * pad) / (contentHalfH * 2),
        1.15,
      );
      ctx.save();
      ctx.translate(cssW / 2 - focusX * scale, cssH / 2 - focusY * scale);
      ctx.scale(scale, scale);
      const fake = stub as unknown as Battle;
      drawFx(ctx, fake);
      drawHeroUltFxList(ctx, fake.heroUltFx, fake.erlangDogFx);
      drawSkillFx(ctx, stub.playerSkillFx);
      drawDigFx(ctx, stub.digFx);
      if (stub.palm) {
        const p = Math.min(1, stub.palm.t / stub.palm.dur);
        const eased = 1 - (1 - p) ** 2;
        const waveDist = stub.palm.frontStartDist - stub.palm.cells * eased;
        drawPalmPushWaveFx(
          ctx,
          stub.palm.path,
          waveDist,
          stub.palm.frontStartDist,
          p,
          stub.palm.t >= stub.palm.dur ? stub.palm.fadeT : 0,
        );
      }
      drawBursts(ctx, fake);
      ctx.restore();
      ctx.fillStyle = 'rgba(248,239,216,0.55)';
      ctx.font = '11px "PingFang SC", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('特效预览', 10, 16);
    }

    const done = stub.fx.length === 0 && stub.heroUltFx.length === 0
      && !stub.playerSkillFx && stub.bursts.length === 0
      && stub.digFx.length === 0 && !stub.palm;
    if (done) {
      stop();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return stop;
}
