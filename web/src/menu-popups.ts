// 首页弹窗：设置、获取体力、选择关卡（水墨卷轴风，紧凑布局）。
import { VIEW_W, VIEW_H } from './render';
import { sprite } from './assets';
import { STAMINA_MAX, STAMINA_REGEN_MS } from './stamina';
import { isWeChat } from './platform';
import {
  MAPS,
  COLS,
  ROWS,
  FENCE_ROW,
  mapById,
  isEitherPathCell,
  isPlayerCell,
  baigulingFenceRow,
  type GameMap,
} from './board';
import type { GameSettings } from './settings';
import type { MapSelection } from './map-select';
import { MAP_ELEMENT } from './battle';
import { drawElementBadge, softenElementColor } from './wuxing-ui';
import {
  roundRect,
  drawInkPopupFrame,
  drawInkCheckbox,
  drawInkActionButton,
  inkPopupCloseRect,
  drawUiIcon,
  STAMINA_ICON_PAGE_DISPLAY,
  STAMINA_ICON_DISPLAY,
} from './menu-ui';

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// —— 设置弹窗 —— //
const SET_PW = 400;
const SET_PAD = 28;
const SET_PH = 220;
const SET_DAMAGE_TOP = 10;
const SET_DAMAGE_H = 20;
const SET_AFTER_DAMAGE = 16;
const SET_AFTER_DIVIDER = 20;
const SET_ROW_GAP = 52;
const SET_ROW_LABEL_W = 40;
const SET_ENABLE_SIZE = 20;
const SET_ENABLE_GAP = 12;
const SET_TRACK_H = 16;
const SET_KNOB = { w: 22, h: 22 };

type SettingsLayout = {
  px: number;
  py: number;
  ph: number;
  close: ReturnType<typeof inkPopupCloseRect>;
  body: number;
  damageCheck: { x: number; y: number; w: number; h: number };
  dividerY: number;
  musicRowY: number;
  sfxRowY: number;
  musicTrack: { x: number; y: number; w: number; h: number };
  sfxTrack: { x: number; y: number; w: number; h: number };
  musicEnable: { x: number; y: number; w: number; h: number };
  sfxEnable: { x: number; y: number; w: number; h: number };
};

function settingsLayout(): SettingsLayout {
  const ph = SET_PH;
  const px = (VIEW_W - SET_PW) / 2;
  const py = (VIEW_H - ph) / 2 - 16;
  const body = py + 58;
  const labelX = px + SET_PAD;
  const enableX = px + SET_PW - SET_PAD - SET_ENABLE_SIZE;
  const trackX = labelX + SET_ROW_LABEL_W;
  const trackW = enableX - SET_ENABLE_GAP - trackX;
  const damageTop = body + SET_DAMAGE_TOP;
  const dividerY = damageTop + SET_DAMAGE_H + SET_AFTER_DAMAGE;
  const musicRowY = dividerY + SET_AFTER_DIVIDER + SET_TRACK_H / 2;
  const sfxRowY = musicRowY + SET_ROW_GAP;
  const trackAt = (rowY: number) => ({ x: trackX, y: rowY - SET_TRACK_H / 2, w: trackW, h: SET_TRACK_H });
  const enableAt = (rowY: number) => ({ x: enableX, y: rowY - SET_ENABLE_SIZE / 2, w: SET_ENABLE_SIZE, h: SET_ENABLE_SIZE });
  return {
    px,
    py,
    ph,
    close: inkPopupCloseRect(px, py),
    body,
    damageCheck: { x: labelX, y: damageTop, w: SET_DAMAGE_H, h: SET_DAMAGE_H },
    dividerY,
    musicRowY,
    sfxRowY,
    musicTrack: trackAt(musicRowY),
    sfxTrack: trackAt(sfxRowY),
    musicEnable: enableAt(musicRowY),
    sfxEnable: enableAt(sfxRowY),
  };
}

function sliderKnobX(track: { x: number; w: number }, value: number, knobW: number): number {
  return track.x + value * (track.w - knobW);
}

function settingsKnobRect(track: { x: number; y: number; w: number; h: number }, value: number): { x: number; y: number; w: number; h: number } {
  return {
    x: sliderKnobX(track, value, SET_KNOB.w),
    y: track.y + (track.h - SET_KNOB.h) / 2,
    w: SET_KNOB.w,
    h: SET_KNOB.h,
  };
}

export function settingsMusicKnobRect(settings: GameSettings): { x: number; y: number; w: number; h: number } {
  const layout = settingsLayout();
  return settingsKnobRect(layout.musicTrack, settings.musicVolume);
}

export function settingsSfxKnobRect(settings: GameSettings): { x: number; y: number; w: number; h: number } {
  const layout = settingsLayout();
  return settingsKnobRect(layout.sfxTrack, settings.sfxVolume);
}

export type SettingsHit =
  | { kind: 'close' }
  | { kind: 'toggleDamage' }
  | { kind: 'toggleMusic' }
  | { kind: 'toggleSfx' }
  | { kind: 'musicKnob' }
  | { kind: 'sfxKnob' }
  | null;

function settingsEnableHit(box: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  return { x: box.x - 6, y: box.y - 6, w: box.w + 12, h: box.h + 12 };
}

function settingsTrackHit(track: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  return { x: track.x, y: track.y - 10, w: track.w, h: track.h + 20 };
}

function drawSettingsDivider(ctx: CanvasRenderingContext2D, layout: SettingsLayout): void {
  const x0 = layout.px + SET_PAD;
  const x1 = layout.px + SET_PW - SET_PAD;
  ctx.strokeStyle = 'rgba(90,60,30,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, layout.dividerY);
  ctx.lineTo(x1, layout.dividerY);
  ctx.stroke();
}

function drawSettingsVolumeRow(
  ctx: CanvasRenderingContext2D,
  layout: SettingsLayout,
  rowY: number,
  label: string,
  enabled: boolean,
  track: { x: number; y: number; w: number; h: number },
  knob: { x: number; y: number; w: number; h: number },
  value: number,
  enableBox: { x: number; y: number; w: number; h: number },
): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5a3a12';
  ctx.font = '15px "PingFang SC", serif';
  ctx.fillText(`${label}：`, layout.px + SET_PAD, rowY);

  roundRect(ctx, track.x, track.y, track.w, track.h, track.h / 2);
  ctx.fillStyle = 'rgba(48,28,12,0.35)';
  ctx.fill();
  if (value > 0) {
    roundRect(ctx, track.x, track.y, Math.max(track.h, track.w * value), track.h, track.h / 2);
    const fg = ctx.createLinearGradient(track.x, track.y, track.x + track.w * value, track.y);
    fg.addColorStop(0, '#b5381f');
    fg.addColorStop(1, '#8a4020');
    ctx.fillStyle = fg;
    ctx.fill();
  }
  roundRect(ctx, knob.x, knob.y, knob.w, knob.h, knob.h / 2);
  ctx.fillStyle = '#d4c4a0';
  ctx.fill();
  ctx.strokeStyle = '#8a6020';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  drawInkCheckbox(ctx, enableBox, '', enabled, 'none');
}

export function settingsHitAt(x: number, y: number, settings: GameSettings): SettingsHit {
  const layout = settingsLayout();
  if (inRect(x, y, layout.close)) return { kind: 'close' };
  if (inRect(x, y, layout.damageCheck) || inRect(x, y, { x: layout.damageCheck.x, y: layout.damageCheck.y, w: 140, h: 24 })) {
    return { kind: 'toggleDamage' };
  }
  if (inRect(x, y, settingsMusicKnobRect(settings)) || inRect(x, y, settingsTrackHit(layout.musicTrack))) {
    return { kind: 'musicKnob' };
  }
  if (inRect(x, y, settingsSfxKnobRect(settings)) || inRect(x, y, settingsTrackHit(layout.sfxTrack))) {
    return { kind: 'sfxKnob' };
  }
  if (inRect(x, y, settingsEnableHit(layout.musicEnable))) return { kind: 'toggleMusic' };
  if (inRect(x, y, settingsEnableHit(layout.sfxEnable))) return { kind: 'toggleSfx' };
  if (x >= layout.px && x <= layout.px + SET_PW && y >= layout.py && y <= layout.py + layout.ph) return null;
  return { kind: 'close' };
}

export function settingsVolumeFromX(trackX: number, trackW: number, knobW: number, px: number): number {
  return Math.max(0, Math.min(1, (px - trackX - knobW / 2) / (trackW - knobW)));
}

export function settingsMusicVolumeFromX(px: number): number {
  const layout = settingsLayout();
  return settingsVolumeFromX(layout.musicTrack.x, layout.musicTrack.w, SET_KNOB.w, px);
}

export function settingsSfxVolumeFromX(px: number): number {
  const layout = settingsLayout();
  return settingsVolumeFromX(layout.sfxTrack.x, layout.sfxTrack.w, SET_KNOB.w, px);
}

export function drawSettingsPopup(ctx: CanvasRenderingContext2D, settings: GameSettings): void {
  const layout = settingsLayout();
  drawInkPopupFrame(ctx, layout.px, layout.py, SET_PW, layout.ph, '设置', layout.close);
  drawInkCheckbox(ctx, layout.damageCheck, '显示伤害数字', settings.showDamageNumbers, 'none');
  drawSettingsDivider(ctx, layout);
  drawSettingsVolumeRow(
    ctx,
    layout,
    layout.musicRowY,
    '音乐',
    settings.musicEnabled,
    layout.musicTrack,
    settingsMusicKnobRect(settings),
    settings.musicVolume,
    layout.musicEnable,
  );
  drawSettingsVolumeRow(
    ctx,
    layout,
    layout.sfxRowY,
    '音效',
    settings.sfxEnabled,
    layout.sfxTrack,
    settingsSfxKnobRect(settings),
    settings.sfxVolume,
    layout.sfxEnable,
  );
}

// —— 获取体力弹窗 —— //
const STA_PW = 400;
const STA_PH = 492;
const STA_PX = (VIEW_W - STA_PW) / 2;
const STA_PY = (VIEW_H - STA_PH) / 2 - 16;
const STA_CLOSE = inkPopupCloseRect(STA_PX, STA_PY);
const STA_BODY = STA_PY + 58;
const STA_BTN_W = STA_PW - 64;
const STA_BTN_H = 56;
const STA_BTN_GAP = 16;
const STA_BTN_X = STA_PX + 32;
const STA_BOTTOM = STA_PY + STA_PH - 28;
const STA_SHARE = { x: STA_BTN_X, y: STA_BOTTOM - STA_BTN_H, w: STA_BTN_W, h: STA_BTN_H };
const STA_REGEN_Y = STA_SHARE.y - STA_BTN_GAP - STA_BTN_H - 22;
const STA_HINT_Y = STA_REGEN_Y - 22;
const STA_HERO_SIZE = 84;
const STA_HERO_CY = STA_HINT_Y - 22 - STA_HERO_SIZE / 2;
const STA_LABEL_Y = STA_BODY + 24;
const STA_REGEN_MIN = Math.round(STAMINA_REGEN_MS / 60_000);

export type StaminaPopupHit =
  | { kind: 'close' }
  | { kind: 'ad' }
  | { kind: 'share' }
  | null;

export function staminaPopupHitAt(x: number, y: number): StaminaPopupHit {
  if (inRect(x, y, STA_CLOSE)) return { kind: 'close' };
  // 单按钮：微信端=分享好友(真分享)、web 端=看广告；都画在底部 STA_SHARE 位。
  if (inRect(x, y, STA_SHARE)) return isWeChat ? { kind: 'share' } : { kind: 'ad' };
  if (x >= STA_PX && x <= STA_PX + STA_PW && y >= STA_PY && y <= STA_PY + STA_PH) return null;
  return { kind: 'close' };
}

export function drawStaminaPopup(ctx: CanvasRenderingContext2D, stamina: number, toast: string, sharesLeft: number): void {
  drawInkPopupFrame(ctx, STA_PX, STA_PY, STA_PW, STA_PH, '获取体力', STA_CLOSE);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = `${stamina} / ${STAMINA_MAX}`;
  ctx.font = 'bold 18px "PingFang SC", serif';
  const numW = ctx.measureText(label).width;
  const tip = '当前体力';
  ctx.font = 'bold 16px "PingFang SC", serif';
  const tipW = ctx.measureText(tip).width;
  const iconS = STAMINA_ICON_DISPLAY + 4;
  const gap = 8;
  const rowW = tipW + gap + iconS + gap + numW;
  const rowLeft = STA_PX + STA_PW / 2 - rowW / 2;
  ctx.fillStyle = '#5a3a12';
  ctx.textAlign = 'left';
  ctx.fillText(tip, rowLeft, STA_LABEL_Y);
  drawUiIcon(ctx, 'icon-stamina', rowLeft + tipW + gap + iconS / 2, STA_LABEL_Y, iconS);
  ctx.font = 'bold 18px "PingFang SC", serif';
  ctx.fillText(label, rowLeft + tipW + gap + iconS + gap, STA_LABEL_Y);

  const cx = STA_PX + STA_PW / 2;
  const pageIcon = STAMINA_ICON_PAGE_DISPLAY;
  if (!drawUiIcon(ctx, 'icon-stamina', cx, STA_HERO_CY, pageIcon)) {
    const spr = sprite('hero-bajie');
    if (spr) {
      const s = STA_HERO_SIZE;
      const scale = Math.min(s / spr.width, s / spr.height);
      ctx.drawImage(
        spr,
        cx - (spr.width * scale) / 2,
        STA_HERO_CY - s / 2,
        spr.width * scale,
        spr.height * scale,
      );
    }
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = stamina >= STAMINA_MAX ? '#8a6020' : '#8a3010';
  ctx.font = '15px "PingFang SC", serif';
  ctx.fillText(stamina >= STAMINA_MAX ? '体力已满' : '体力不足，请选择补充方式', cx, STA_HINT_Y);
  ctx.fillStyle = 'rgba(90,60,30,0.62)';
  ctx.font = '13px "PingFang SC", serif';
  ctx.fillText(`未满时每 ${STA_REGEN_MIN} 分钟自动恢复 1 点`, cx, STA_REGEN_Y);

  // 单按钮：微信端「分享好友 +5」(真分享，受每日额度/体力上限影响置灰)；web 端「看广告 +10」(不变)。
  if (isWeChat) {
    const full = stamina >= STAMINA_MAX;
    const noQuota = sharesLeft <= 0;
    const btnLabel = noQuota ? '今日分享已达上限' : full ? '体力已满' : '分享好友 +5';
    drawInkActionButton(ctx, STA_SHARE, btnLabel, full || noQuota, 'secondary');
  } else {
    drawInkActionButton(ctx, STA_SHARE, '看广告 +10', false, 'accent');
  }

  if (toast) {
    ctx.fillStyle = '#8a3010';
    ctx.font = '14px "PingFang SC", serif';
    ctx.fillText(toast, cx, STA_PY + STA_PH + 14);
  }
}

// —— 选择关卡弹窗 —— //
const MAP_PW = 420;
// 面板加高：5 图 2 列 = 3 行卡片（112 顶栏 + 3×160-12 = 596），560 放不下第 3 行；
// 加高到 700 默认全可见，行数更多时卡片区可拖拽滚动（见 mapMaxScroll/mapScrollArea）。
const MAP_PH = 700;
const MAP_PX = (VIEW_W - MAP_PW) / 2;
const MAP_PY = (VIEW_H - MAP_PH) / 2 - 8;
const MAP_CLOSE = inkPopupCloseRect(MAP_PX, MAP_PY);
const MAP_DAILY = { x: MAP_PX + 24, y: MAP_PY + 58, w: MAP_PW - 48, h: 44 };
const MAP_CARD_W = (MAP_PW - 60) / 2;
const MAP_CARD_H = 148;
const MAP_CARD_GAP = 12;
const MAP_GRID_TOP = MAP_PY + 112;
const MAP_LABEL_H = 24;
// 卡片滚动视区：网格内容超出面板时在此区域内拖拽滚动（同帮助弹窗范式）
const MAP_SCROLL_PAD = 8; // 视区上下各留的呼吸边
const MAP_SCROLL = {
  x: MAP_PX + 24 - MAP_SCROLL_PAD,
  y: MAP_GRID_TOP - MAP_SCROLL_PAD,
  w: MAP_PW - 48 + MAP_SCROLL_PAD * 2,
  h: MAP_PH - 112 - 16 + MAP_SCROLL_PAD, // 面板底距 16
};

/** 网格内容总高（2 列 × N 行卡片，含行间距） */
export function mapGridContentHeight(): number {
  const rows = Math.ceil(MAPS.length / 2);
  return rows * (MAP_CARD_H + MAP_CARD_GAP) - MAP_CARD_GAP;
}

/** 卡片区最大滚动量：内容不超高时为 0（当前 5 图 3 行默认全可见，滚动为更多图预留） */
export function mapMaxScroll(): number {
  return Math.max(0, mapGridContentHeight() - MAP_SCROLL.h);
}

/** 卡片区滚动视区（拖拽滚动命中判定用） */
export function mapScrollArea(): { x: number; y: number; w: number; h: number } {
  return MAP_SCROLL;
}

/** 第 index 张地图卡的矩形（scrollY 为卡片区滚动偏移）。导出供布局测试断言。 */
export function mapCardRect(index: number, scrollY = 0): { x: number; y: number; w: number; h: number } {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: MAP_PX + 24 + col * (MAP_CARD_W + MAP_CARD_GAP),
    y: MAP_GRID_TOP - scrollY + row * (MAP_CARD_H + MAP_CARD_GAP),
    w: MAP_CARD_W,
    h: MAP_CARD_H,
  };
}

export type MapPopupHit =
  | { kind: 'close' }
  | { kind: 'daily' }
  | { kind: 'scroll' } // 卡片滚动视区：按下进入拖拽滚动状态（未拖动抬起=点选卡片）
  | { kind: 'map'; mapId: string }
  | null;

export function mapPopupHitAt(x: number, y: number, scrollY = 0): MapPopupHit {
  if (inRect(x, y, MAP_CLOSE)) return { kind: 'close' };
  if (inRect(x, y, MAP_DAILY)) return { kind: 'daily' };
  for (let i = 0; i < MAPS.length; i++) {
    const r = mapCardRect(i, scrollY);
    if (inRect(x, y, r)) return { kind: 'map', mapId: MAPS[i]!.id };
  }
  if (inRect(x, y, MAP_SCROLL)) return { kind: 'scroll' };
  if (x >= MAP_PX && x <= MAP_PX + MAP_PW && y >= MAP_PY && y <= MAP_PY + MAP_PH) return null;
  return { kind: 'close' };
}

/** 关卡卡预览：风景图铺满整卡 + 迷你棋盘（路径/半场/唐僧位），底部半透明色条放地图名+五行徽章 */
function drawMapThumb(ctx: CanvasRenderingContext2D, mapId: string, r: { x: number; y: number; w: number; h: number }): void {
  const map = mapById(mapId);
  roundRect(ctx, r.x, r.y, r.w, r.h, 8);
  ctx.save();
  ctx.clip();

  // 主题底色渐变兜底（图未加载时）
  const th = map.theme;
  const bg = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
  bg.addColorStop(0, th.bg0);
  bg.addColorStop(1, th.bg1);
  ctx.fillStyle = bg;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  // 风景图 cover 铺满整卡（含底部标签区——名字压在半透明色条上读得清）；
  // 半透明 + 轻微米色罩，保留图辨识度同时给迷你棋盘让出可读性
  const img = sprite(`map-${mapId}` as Parameters<typeof sprite>[0]);
  if (img) {
    const scale = Math.max(r.w / img.width, r.h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.globalAlpha = 0.8;
    ctx.drawImage(img, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(245,236,220,0.18)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  // 迷你棋盘画在标签条以上的区域
  const thumbH = r.h - MAP_LABEL_H;
  drawMiniMapBoard(ctx, map, r.x + 8, r.y + 6, r.w - 16, thumbH - 12);

  // 底部半透明色条：压在风景图上，放地图名与五行徽章（调用方绘制文字）
  ctx.fillStyle = 'rgba(35,25,14,0.52)';
  ctx.fillRect(r.x, r.y + thumbH, r.w, MAP_LABEL_H);
  ctx.restore();
}

function drawMiniMapBoard(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const cell = Math.min(w / COLS, h / ROWS);
  const bw = cell * COLS;
  const bh = cell * ROWS;
  const ox = x + (w - bw) / 2;
  const oy = y + (h - bh) / 2;
  const th = map.theme;
  const initial = new Set((map.initialBlock ?? []).map((c) => `${c.c},${c.r}`));
  // 未挖（锁定）格底色改用地图对应五行色——与战斗棋盘同口径：向主题锁定色混合 0.38（保留色相但不刺眼）
  const mapEl = MAP_ELEMENT[map.id] ?? null;
  const lockedColor = mapEl ? softenElementColor(mapEl, th.cellLocked) : th.cellLocked;

  // 棋盘底
  roundRect(ctx, ox - 1, oy - 1, bw + 2, bh + 2, 3);
  ctx.fillStyle = 'rgba(40,28,14,0.18)';
  ctx.fill();

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cx = ox + col * cell;
      const cy = oy + row * cell;
      const onPath = isEitherPathCell(map, col, row);
      const player = isPlayerCell(map, col, row);
      roundRect(ctx, cx + 0.4, cy + 0.4, cell - 0.8, cell - 0.8, 1.2);
      if (onPath) {
        ctx.fillStyle = th.path;
        ctx.fill();
        ctx.fillStyle = 'rgba(255,248,230,0.28)';
        ctx.fill();
      } else if (player && initial.has(`${col},${row}`)) {
        ctx.fillStyle = th.cellUnlocked;
        ctx.fill();
        ctx.strokeStyle = 'rgba(90,60,30,0.35)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      } else if (player) {
        ctx.fillStyle = lockedColor;
        ctx.fill();
        ctx.fillStyle = 'rgba(40,28,14,0.22)';
        ctx.fill();
      } else {
        // AI 半场：略深一档，便于分辨上下场
        ctx.fillStyle = lockedColor;
        ctx.fill();
        ctx.fillStyle = 'rgba(30,24,18,0.32)';
        ctx.fill();
      }
    }
  }

  // 半场分界（白骨岭：左低右高的直角台阶，与局内 drawBaigulingBoneFence 同形）
  ctx.strokeStyle = 'rgba(70,48,24,0.55)';
  ctx.lineWidth = Math.max(1, cell * 0.12);
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  if (map.id === 'baiguling') {
    const yLeft = oy + (baigulingFenceRow(0) + 1) * cell; // 左列栅栏下沿 r=6
    const yRight = oy + (baigulingFenceRow(COLS - 1) + 1) * cell; // 右列 r=4
    const xMid = ox + 4 * cell; // c=3|4 竖阶
    ctx.moveTo(ox, yLeft);
    ctx.lineTo(xMid, yLeft);
    ctx.lineTo(xMid, yRight);
    ctx.lineTo(ox + bw, yRight);
  } else {
    const fy = oy + FENCE_ROW * cell;
    ctx.moveTo(ox, fy);
    ctx.lineTo(ox + bw, fy);
  }
  ctx.stroke();

  // 路径中线（把蛇形走道连起来）
  const pathPts = map.path.filter((p) => p.c >= 0 && p.c < COLS && p.r >= 0 && p.r < ROWS);
  if (pathPts.length > 1) {
    ctx.strokeStyle = 'rgba(255,245,220,0.65)';
    ctx.lineWidth = Math.max(1.2, cell * 0.22);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    pathPts.forEach((p, i) => {
      const px = ox + (p.c + 0.5) * cell;
      const py = oy + (p.r + 0.5) * cell;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  // 唐僧位小点
  const t = map.tangseng;
  const tx = ox + (t.c + 0.5) * cell;
  const ty = oy + (t.r + 0.5) * cell;
  ctx.fillStyle = '#c04030';
  ctx.beginPath();
  ctx.arc(tx, ty, Math.max(1.6, cell * 0.22), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,240,220,0.85)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 外框
  ctx.strokeStyle = 'rgba(40,28,14,0.55)';
  ctx.lineWidth = 1.4;
  roundRect(ctx, ox, oy, bw, bh, 2);
  ctx.stroke();
}

export function drawMapPopup(
  ctx: CanvasRenderingContext2D,
  selection: MapSelection,
  dailyMapName: string,
  scrollY = 0,
): void {
  drawInkPopupFrame(ctx, MAP_PX, MAP_PY, MAP_PW, MAP_PH, '选择关卡', MAP_CLOSE);

  const dailyOn = selection.mode === 'daily';
  roundRect(ctx, MAP_DAILY.x, MAP_DAILY.y, MAP_DAILY.w, MAP_DAILY.h, 10);
  ctx.fillStyle = dailyOn ? 'rgba(180,90,70,0.28)' : 'rgba(255,248,235,0.55)';
  ctx.fill();
  ctx.strokeStyle = dailyOn ? '#8a4020' : 'rgba(90,60,30,0.45)';
  ctx.lineWidth = dailyOn ? 2 : 1.5;
  ctx.stroke();
  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 15px "PingFang SC", serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('每日推荐', MAP_DAILY.x + 14, MAP_DAILY.y + MAP_DAILY.h / 2 - 8);
  ctx.font = '13px "PingFang SC", serif';
  ctx.fillStyle = '#7a5830';
  ctx.fillText(`今日：${dailyMapName}`, MAP_DAILY.x + 14, MAP_DAILY.y + MAP_DAILY.h / 2 + 10);

  // 卡片区裁剪到滚动视区内再画（行数超出面板时随 scrollY 上移，超出部分不外溢）
  const sy = Math.max(0, Math.min(mapMaxScroll(), scrollY));
  ctx.save();
  ctx.beginPath();
  ctx.rect(MAP_SCROLL.x, MAP_SCROLL.y, MAP_SCROLL.w, MAP_SCROLL.h);
  ctx.clip();
  for (let i = 0; i < MAPS.length; i++) {
    const map = MAPS[i]!;
    const r = mapCardRect(i, sy);
    const picked = selection.mode === 'fixed' && selection.mapId === map.id;
    drawMapThumb(ctx, map.id, r);
    roundRect(ctx, r.x, r.y, r.w, r.h, 8);
    ctx.lineWidth = picked ? 2.5 : 1.5;
    ctx.strokeStyle = picked ? '#8a4020' : 'rgba(90,60,30,0.45)';
    ctx.stroke();
    // 地图名（底部半透明色条上，米白字）+ 名后五行徽章；名字+徽章整体居中
    ctx.font = 'bold 14px "PingFang SC", serif';
    const badgeR = 8;
    const nameW = ctx.measureText(map.name).width;
    const startX = r.x + r.w / 2 - (nameW + 6 + badgeR * 2) / 2;
    const labelY = r.y + r.h - MAP_LABEL_H / 2 + 1;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff4e0';
    ctx.fillText(map.name, startX, labelY);
    drawElementBadge(ctx, startX + nameW + 6 + badgeR, labelY, badgeR, MAP_ELEMENT[map.id] ?? null);
  }
  ctx.restore();

  // 滚动条：内容不超高时不画（当前 5 图默认全可见，无滚动条）
  const max = mapMaxScroll();
  if (max > 0) {
    const trackH = MAP_SCROLL.h - 8;
    const thumbH = Math.max(24, (MAP_SCROLL.h / mapGridContentHeight()) * trackH);
    const thumbY = MAP_SCROLL.y + 4 + (sy / max) * (trackH - thumbH);
    ctx.fillStyle = 'rgba(90,60,30,0.22)';
    roundRect(ctx, MAP_SCROLL.x + MAP_SCROLL.w - 5, thumbY, 4, thumbH, 2);
    ctx.fill();
  }
}
