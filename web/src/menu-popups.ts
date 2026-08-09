// 首页弹窗：设置、获取体力、选择关卡（水墨卷轴风，紧凑布局）。
import { VIEW_W, VIEW_H } from './render';
import { sprite } from './assets';
import { STAMINA_MAX } from './stamina';
import { MAPS } from './board';
import type { GameSettings } from './settings';
import type { MapSelection } from './map-select';
import {
  roundRect,
  drawInkPopupFrame,
  drawInkCheckbox,
  drawInkSlider,
  drawInkActionButton,
  inkPopupCloseRect,
} from './menu-ui';

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// —— 设置弹窗 —— //
const SET_PW = 400;
const SET_PH = 300;
const SET_PX = (VIEW_W - SET_PW) / 2;
const SET_PY = (VIEW_H - SET_PH) / 2 - 16;
const SET_CLOSE = inkPopupCloseRect(SET_PX, SET_PY);
const SET_BODY = SET_PY + 58;
const SET_CHECK = { x: SET_PX + 28, y: SET_BODY + 8, w: 20, h: 20 };
const SET_MUSIC_TRACK = { x: SET_PX + 28, y: SET_BODY + 88, w: SET_PW - 56, h: 10 };
const SET_MUSIC_KNOB = { w: 22, h: 22 };
const SET_SFX_TRACK = { x: SET_PX + 28, y: SET_BODY + 148, w: SET_PW - 56, h: 10 };
const SET_SFX_KNOB = { w: 22, h: 22 };

function sliderKnobX(track: { x: number; w: number }, value: number, knobW: number): number {
  return track.x + value * (track.w - knobW);
}

export function settingsMusicKnobRect(settings: GameSettings): { x: number; y: number; w: number; h: number } {
  const x = sliderKnobX(SET_MUSIC_TRACK, settings.musicVolume, SET_MUSIC_KNOB.w);
  return { x, y: SET_MUSIC_TRACK.y - 6, w: SET_MUSIC_KNOB.w, h: SET_MUSIC_KNOB.h };
}

export function settingsSfxKnobRect(settings: GameSettings): { x: number; y: number; w: number; h: number } {
  const x = sliderKnobX(SET_SFX_TRACK, settings.sfxVolume, SET_SFX_KNOB.w);
  return { x, y: SET_SFX_TRACK.y - 6, w: SET_SFX_KNOB.w, h: SET_SFX_KNOB.h };
}

export type SettingsHit =
  | { kind: 'close' }
  | { kind: 'toggleDamage' }
  | { kind: 'musicKnob' }
  | { kind: 'sfxKnob' }
  | null;

export function settingsHitAt(x: number, y: number, settings: GameSettings): SettingsHit {
  if (inRect(x, y, SET_CLOSE)) return { kind: 'close' };
  if (inRect(x, y, SET_CHECK) || inRect(x, y, { x: SET_CHECK.x, y: SET_CHECK.y, w: 140, h: 24 })) {
    return { kind: 'toggleDamage' };
  }
  if (inRect(x, y, settingsMusicKnobRect(settings)) || inRect(x, y, SET_MUSIC_TRACK)) {
    return { kind: 'musicKnob' };
  }
  if (inRect(x, y, settingsSfxKnobRect(settings)) || inRect(x, y, SET_SFX_TRACK)) {
    return { kind: 'sfxKnob' };
  }
  if (x >= SET_PX && x <= SET_PX + SET_PW && y >= SET_PY && y <= SET_PY + SET_PH) return null;
  return { kind: 'close' };
}

export function settingsVolumeFromX(trackX: number, trackW: number, knobW: number, px: number): number {
  return Math.max(0, Math.min(1, (px - trackX - knobW / 2) / (trackW - knobW)));
}

export function settingsMusicVolumeFromX(px: number): number {
  return settingsVolumeFromX(SET_MUSIC_TRACK.x, SET_MUSIC_TRACK.w, SET_MUSIC_KNOB.w, px);
}

export function settingsSfxVolumeFromX(px: number): number {
  return settingsVolumeFromX(SET_SFX_TRACK.x, SET_SFX_TRACK.w, SET_SFX_KNOB.w, px);
}

export function drawSettingsPopup(ctx: CanvasRenderingContext2D, settings: GameSettings): void {
  drawInkPopupFrame(ctx, SET_PX, SET_PY, SET_PW, SET_PH, '设置', SET_CLOSE);
  drawInkCheckbox(ctx, SET_CHECK, '显示伤害数字', settings.showDamageNumbers, 'none');
  drawInkSlider(
    ctx,
    SET_BODY + 68,
    '音乐音量',
    SET_MUSIC_TRACK,
    settingsMusicKnobRect(settings),
    settings.musicVolume,
  );
  drawInkSlider(
    ctx,
    SET_BODY + 128,
    '音效音量',
    SET_SFX_TRACK,
    settingsSfxKnobRect(settings),
    settings.sfxVolume,
  );
}

// —— 获取体力弹窗 —— //
const STA_PW = 400;
const STA_PH = 468;
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
const STA_AD = { x: STA_BTN_X, y: STA_SHARE.y - STA_BTN_GAP - STA_BTN_H, w: STA_BTN_W, h: STA_BTN_H };
const STA_HINT_Y = STA_AD.y - 30;
const STA_HERO_SIZE = 84;
const STA_HERO_CY = STA_HINT_Y - 22 - STA_HERO_SIZE / 2;
const STA_LABEL_Y = STA_BODY + 24;

export type StaminaPopupHit =
  | { kind: 'close' }
  | { kind: 'ad' }
  | { kind: 'share' }
  | null;

export function staminaPopupHitAt(x: number, y: number): StaminaPopupHit {
  if (inRect(x, y, STA_CLOSE)) return { kind: 'close' };
  if (inRect(x, y, STA_AD)) return { kind: 'ad' };
  if (inRect(x, y, STA_SHARE)) return { kind: 'share' };
  if (x >= STA_PX && x <= STA_PX + STA_PW && y >= STA_PY && y <= STA_PY + STA_PH) return null;
  return { kind: 'close' };
}

export function drawStaminaPopup(ctx: CanvasRenderingContext2D, stamina: number, toast: string): void {
  drawInkPopupFrame(ctx, STA_PX, STA_PY, STA_PW, STA_PH, '获取体力', STA_CLOSE);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 18px "PingFang SC", serif';
  ctx.fillText(`当前体力  ${stamina} / ${STAMINA_MAX}`, STA_PX + STA_PW / 2, STA_LABEL_Y);

  const spr = sprite('hero-bajie');
  const cx = STA_PX + STA_PW / 2;
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

  ctx.fillStyle = stamina >= STAMINA_MAX ? '#8a6020' : '#8a3010';
  ctx.font = '15px "PingFang SC", serif';
  ctx.fillText(stamina >= STAMINA_MAX ? '体力已满' : '体力不足，请选择补充方式', cx, STA_HINT_Y);

  drawInkActionButton(ctx, STA_AD, '看广告 +10', false, 'accent');
  drawInkActionButton(ctx, STA_SHARE, '分享好友 +5', false, 'secondary');

  if (toast) {
    ctx.fillStyle = '#8a3010';
    ctx.font = '14px "PingFang SC", serif';
    ctx.fillText(toast, cx, STA_PY + STA_PH + 14);
  }
}

// —— 选择关卡弹窗 —— //
const MAP_PW = 420;
const MAP_PH = 480;
const MAP_PX = (VIEW_W - MAP_PW) / 2;
const MAP_PY = (VIEW_H - MAP_PH) / 2 - 8;
const MAP_CLOSE = inkPopupCloseRect(MAP_PX, MAP_PY);
const MAP_DAILY = { x: MAP_PX + 24, y: MAP_PY + 58, w: MAP_PW - 48, h: 44 };
const MAP_CARD_W = (MAP_PW - 60) / 2;
const MAP_CARD_H = 100;
const MAP_CARD_GAP = 12;
const MAP_GRID_TOP = MAP_PY + 112;

function mapCardRect(index: number): { x: number; y: number; w: number; h: number } {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: MAP_PX + 24 + col * (MAP_CARD_W + MAP_CARD_GAP),
    y: MAP_GRID_TOP + row * (MAP_CARD_H + MAP_CARD_GAP),
    w: MAP_CARD_W,
    h: MAP_CARD_H,
  };
}

export type MapPopupHit =
  | { kind: 'close' }
  | { kind: 'daily' }
  | { kind: 'map'; mapId: string }
  | null;

export function mapPopupHitAt(x: number, y: number): MapPopupHit {
  if (inRect(x, y, MAP_CLOSE)) return { kind: 'close' };
  if (inRect(x, y, MAP_DAILY)) return { kind: 'daily' };
  for (let i = 0; i < MAPS.length; i++) {
    const r = mapCardRect(i);
    if (inRect(x, y, r)) return { kind: 'map', mapId: MAPS[i]!.id };
  }
  if (x >= MAP_PX && x <= MAP_PX + MAP_PW && y >= MAP_PY && y <= MAP_PY + MAP_PH) return null;
  return { kind: 'close' };
}

function drawMapThumb(ctx: CanvasRenderingContext2D, mapId: string, r: { x: number; y: number; w: number; h: number }): void {
  const img = sprite(`map-${mapId}` as Parameters<typeof sprite>[0]);
  roundRect(ctx, r.x, r.y, r.w, r.h - 26, 8);
  ctx.save();
  ctx.clip();
  if (img) {
    const scale = Math.max(r.w / img.width, (r.h - 26) / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, r.x + (r.w - dw) / 2, r.y + (r.h - 26 - dh) / 2, dw, dh);
    ctx.fillStyle = 'rgba(240,233,220,0.4)';
    ctx.fillRect(r.x, r.y, r.w, r.h - 26);
  } else {
    ctx.fillStyle = '#d8ccb0';
    ctx.fillRect(r.x, r.y, r.w, r.h - 26);
  }
  ctx.restore();
}

export function drawMapPopup(
  ctx: CanvasRenderingContext2D,
  selection: MapSelection,
  dailyMapName: string,
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

  for (let i = 0; i < MAPS.length; i++) {
    const map = MAPS[i]!;
    const r = mapCardRect(i);
    const picked = selection.mode === 'fixed' && selection.mapId === map.id;
    drawMapThumb(ctx, map.id, r);
    roundRect(ctx, r.x, r.y, r.w, r.h, 8);
    ctx.lineWidth = picked ? 2.5 : 1.5;
    ctx.strokeStyle = picked ? '#8a4020' : 'rgba(90,60,30,0.45)';
    ctx.stroke();
    ctx.fillStyle = '#5a3a12';
    ctx.font = 'bold 14px "PingFang SC", serif';
    ctx.textAlign = 'center';
    ctx.fillText(map.name, r.x + r.w / 2, r.y + r.h - 10);
  }
}
