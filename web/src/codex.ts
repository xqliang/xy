// 图鉴：兵器 / 英雄 / 妖怪 / 技能 / 境界 五 Tab。从主菜单进入，返回主菜单。
import { VIEW_W, VIEW_H } from './render';
import { UNITS, getUnitStat, towerPOW, MAX_TIER, monsterPOW, type UnitType, type Element } from '@core';
import { sprite, unitAsset, miniBossSprite, type AssetKey } from './assets';
import { MAPS, type GameMap } from './board';
import { GENERALS, generalStat, generalPOW, type GeneralDef } from './generals';
import { TUNING, Battle, SKILL_META, MAP_SKILL, MINI_BOSS_META, MINI_BOSS_KINDS, MAP_ELEMENT, type MiniBossKind, type MonsterSkill } from './battle';
import { enabledActives, MAX_EQUIPPED_ACTIVES } from './actives';
import { enabledPassives, MAX_EQUIPPED_PASSIVES } from './passives';
import { skillRarityColor } from './merchant';
import { drawInkActionButton, drawRankStarsAnimated, roundRect } from './menu-ui';
import { drawSkillGlyph } from './skill-icon';
import { drawElementBadge } from './wuxing-ui';
import { wuxingEnabled } from './dev-flags';
import { STARS_PER_TIER, LADDER_LEN, rankName, type RankState } from './rank';
import {
  isEquipped,
  isOwnedActive,
  isOwnedPassive,
  isPassiveEquipped,
  type LoadoutState,
} from './loadout';
import { HERO_LORE, UNIT_LORE, ACTIVE_LORE, PASSIVE_LORE, MONSTER_TYPE_LORE, MINIBOSS_LORE, BOSS_LORE } from './codex-lore';

// 风味介绍统一样式：淡金斜体，与机制文案（正体）区分。
const LORE_FONT = 'italic 11px "PingFang SC", serif';
const LORE_COLOR = 'rgba(255,236,196,0.58)';

export type CodexTab = 'unit' | 'hero' | 'monster' | 'skill' | 'rank' | 'versus';

const BACK = { x: 24, y: 40, w: 92, h: 44 };
const CONTENT_TOP = 136;
const CONTENT_H = VIEW_H - CONTENT_TOP;
const TAB_W = 82;
const TAB_H = 36;
const TAB_GAP = 6;
const TAB_Y = 92;
const TAB_X0 = (VIEW_W - (TAB_W * 6 + TAB_GAP * 5)) / 2;
const TAB_UNIT = { x: TAB_X0, y: TAB_Y, w: TAB_W, h: TAB_H };
const TAB_HERO = { x: TAB_X0 + TAB_W + TAB_GAP, y: TAB_Y, w: TAB_W, h: TAB_H };
const TAB_MONSTER = { x: TAB_X0 + (TAB_W + TAB_GAP) * 2, y: TAB_Y, w: TAB_W, h: TAB_H };
const TAB_SKILL = { x: TAB_X0 + (TAB_W + TAB_GAP) * 3, y: TAB_Y, w: TAB_W, h: TAB_H };
const TAB_RANK = { x: TAB_X0 + (TAB_W + TAB_GAP) * 4, y: TAB_Y, w: TAB_W, h: TAB_H };
const TAB_VERSUS = { x: TAB_X0 + (TAB_W + TAB_GAP) * 5, y: TAB_Y, w: TAB_W, h: TAB_H };

const UNIT_ORDER: UnitType[] = ['dao', 'spear', 'cavalry', 'archer'];
const UNIT_COLOR: Record<UnitType, string> = { dao: '#ff9a3c', spear: '#5bd1ff', cavalry: '#7dff8a', archer: '#c79bff' };
const RANK_COLOR: Record<GeneralDef['rank'], string> = { T0: '#ffd76a', T1: '#7ec46a', T2: '#a8a090' };

const CARD_W = 250;
const UNIT_CARD_H = 194; // 172 + 22：底部加一行风味介绍
const UNIT_GAP = 14;
const HERO_CARD_H = 176; // 152 + 24：底部加一行风味介绍
const HERO_GAP = 12;
const TYPE_CARD_H = 88;
const TYPE_CARD_GAP = 8;
const MTYPE_CARD_H = 106;    // 妖怪「种类」卡：88 + 18 风味行（与境界 Tab 复用的 TYPE_CARD_H 解耦，后者不加高）
const MINIBOSS_CARD_H = 116; // 小 Boss 卡：96 + 20 风味行
const BOSS_CARD_H = 130;     // 妖王卡：110 + 20 风味行
const MAP_ROW_H = 118;
const MAP_NAME_W = 72;
const EXAMPLE_WAVE = 5;
const GRID_LEFT = (VIEW_W - (CARD_W * 2 + UNIT_GAP)) / 2;
const GRID_W = CARD_W * 2 + UNIT_GAP;
const SKILL_CARD_H = 126; // 108 + 18：底部加一行风味介绍
const SKILL_CARD_GAP = 6;
const SKILL_ACTIVE_COLOR = '#6ab0ff';
const SKILL_PASSIVE_COLOR = '#7ec46a';
const SKILL_ACTION_W = 76;
const SKILL_ACTION_H = 32;
const SKILL_HINT_H = 44;
const SKILL_SECTION_H = 22;

const SKILL_DESC: Record<MonsterSkill, string> = {
  stun: '定身范围内兵器，暂停攻击',
  slow: '迟滞范围内兵器，出手变慢',
  weaken: '弱身范围内兵器，伤害降低',
  webbind: '缠丝范围内兵器，攻击距离缩短',
};

type MonsterTypeCard = {
  name: string;
  color: string;
  lines: string[];
  lore?: string; // 风味介绍（仅妖怪种类卡有；境界 Tab 复用本卡样式时不设）
};

function waveMinionHp(wave: number): number {
  return TUNING.monsterHpBase + TUNING.monsterHpStep * wave;
}

function monsterTypeCards(): MonsterTypeCard[] {
  const hp5 = waveMinionHp(EXAMPLE_WAVE);
  const spd = TUNING.monsterSpd;
  const miniBossSkills = MINI_BOSS_KINDS.map((k) => MINI_BOSS_META[k].skillName).join(' / ');
  return [
    {
      name: '小妖',
      color: '#c8792b',
      lore: MONSTER_TYPE_LORE.minion,
      lines: [
        `血量 24 + 16×波次（第${EXAMPLE_WAVE}波 ≈ ${hp5}）`,
        `移速 ${spd.toFixed(2)} 格/s · 战力 ${monsterPOW(hp5, spd).toFixed(0)}`,
        '技能：无',
      ],
    },
    {
      name: '精英妖',
      color: SKILL_META.weaken.color,
      lore: MONSTER_TYPE_LORE.elite,
      lines: [
        `血量 ×${TUNING.eliteHpMul}（第${EXAMPLE_WAVE}波 ≈ ${Math.round(hp5 * TUNING.eliteHpMul)}）`,
        `移速同小妖 · 第${TUNING.eliteFromWave}波起随机出现`,
        '技能：携带本地图专属减益（见下方）',
      ],
    },
    {
      name: '骑兵妖',
      color: '#7dff8a',
      lore: MONSTER_TYPE_LORE.cavalry,
      lines: [
        `血量 ×${TUNING.cavalryHpMul.toFixed(2)}（第${EXAMPLE_WAVE}波 ≈ ${Math.round(hp5 * TUNING.cavalryHpMul)}）`,
        `移速 ×${TUNING.cavalrySpdMul}（≈ ${(spd * TUNING.cavalrySpdMul).toFixed(2)} 格/s，快血薄）`,
        `无技能 · 第${TUNING.cavalryFromWave}波起骑兵波随机混入`,
      ],
    },
    {
      name: '小 Boss',
      color: '#7ec8ff',
      lore: MONSTER_TYPE_LORE.miniboss,
      lines: [
        `血量 ×${TUNING.miniBossHpMul}（第${EXAMPLE_WAVE}波 ≈ ${Math.round(hp5 * TUNING.miniBossHpMul)}）`,
        `移速 ×${TUNING.miniBossSpdMul} · 第${TUNING.miniBossFromWave}波起随机出现`,
        `光环：${miniBossSkills}`,
      ],
    },
    {
      name: '妖王',
      color: '#ff5a8a',
      lore: MONSTER_TYPE_LORE.boss,
      lines: [
        `血量 ×${TUNING.bossHpMulEarly}~×${TUNING.bossHpMul}（第${EXAMPLE_WAVE}波 ≈ ${Math.round(hp5 * TUNING.bossHpMulEarly)}+）`,
        `移速 ×${TUNING.bossSpdMul} · 出场带 ${TUNING.bossEscortMin}~${TUNING.bossEscortMax} 名护卫`,
        '技能：本地图专属减益 + 护卫分血',
      ],
    },
  ];
}

let codexTab: CodexTab = 'unit';
let codexScrollY = 0;
let codexPointerActive = false;
let codexDownY = 0;
let codexDownX = 0;
let codexDownScroll = 0;
let codexDragged = false;
let codexToast = '';
let codexToastUntil = 0;

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function fitTextLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  if (maxLines <= 1) return [truncate(ctx, text, maxW)];
  const lines: string[] = [];
  let rest = text;
  for (let n = 0; n < maxLines && rest.length > 0; n++) {
    if (n === maxLines - 1) {
      lines.push(truncate(ctx, rest, maxW));
      break;
    }
    let line = '';
    for (const ch of rest) {
      const next = line + ch;
      if (line.length > 0 && ctx.measureText(next).width > maxW) break;
      line = next;
    }
    if (line.length === 0) line = rest[0]!;
    lines.push(line);
    rest = rest.slice(line.length).trimStart();
  }
  return lines;
}

function unitContentHeight(): number {
  return 2 * (UNIT_CARD_H + UNIT_GAP) + 8;
}

function heroContentHeight(): number {
  const rows = Math.ceil(GENERALS.length / 2);
  return rows * (HERO_CARD_H + HERO_GAP) + 8;
}

function monsterContentHeight(): number {
  const types = monsterTypeCards().length;
  const bossRows = Math.ceil(MAPS.length / 2); // 妖王两列排布
  const bossCardH = BOSS_CARD_H, bossGap = 10;
  const bossH = 26 + bossRows * bossCardH + (bossRows - 1) * bossGap;
  return (
    28 + 22 + types * (MTYPE_CARD_H + TYPE_CARD_GAP) // 种类区
    + 18 + 22 + MAPS.length * (MAP_ROW_H + 10) // 各地图行
    + 6 + miniBossSectionH() // 小 Boss 区（紧贴地图行）
    + 20 // 小 Boss 与妖王区间距
    + bossH // 妖王区
  );
}

function skillContentHeight(): number {
  const actives = enabledActives();
  const passives = enabledPassives();
  return (
    SKILL_HINT_H
    + SKILL_SECTION_H + actives.length * (SKILL_CARD_H + SKILL_CARD_GAP)
    + 14 + SKILL_SECTION_H + passives.length * (SKILL_CARD_H + SKILL_CARD_GAP)
    + 8
  );
}

// —— 境界 Tab 布局常量 ——
const RANK_CUR_CARD_H = 118; // 当前境界卡（名称+星+难度系数）
const RANK_ROW_H = 42;       // 阶梯每档一行
const RANK_ROW_GAP = 6;
const RANK_SECTION_H = 22;   // 区标题行高（与怪物 Tab 一致）
const RANK_ACCENT = '#ffd76a';

function rankContentHeight(): number {
  return (
    RANK_CUR_CARD_H + 14
    + RANK_SECTION_H + LADDER_LEN * (RANK_ROW_H + RANK_ROW_GAP) // 境界阶梯
    + 10 + RANK_SECTION_H + 3 * (TYPE_CARD_H + TYPE_CARD_GAP)   // 三张规则卡（复用怪物 Tab 卡样式）
    + 8
  );
}

function codexContentHeight(tab: CodexTab): number {
  switch (tab) {
    case 'unit':
      return unitContentHeight();
    case 'hero':
      return heroContentHeight();
    case 'monster':
      return monsterContentHeight();
    case 'skill':
      return skillContentHeight();
    case 'rank':
      return rankContentHeight();
    case 'versus':
      return versusContentHeight();
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

export function codexMaxScroll(): number {
  return Math.max(0, codexContentHeight(codexTab) - CONTENT_H);
}

export function resetCodex(tab: CodexTab = 'unit'): void {
  codexTab = tab;
  codexScrollY = 0;
  codexPointerActive = false;
  codexDragged = false;
  codexToast = '';
  codexToastUntil = 0;
}

export function setCodexToast(msg: string, ms = 2200): void {
  codexToast = msg;
  codexToastUntil = performance.now() + ms;
}

export function codexNeedsAnim(): boolean {
  return !!codexToast && performance.now() < codexToastUntil;
}

export function codexHitBack(x: number, y: number): boolean {
  return inRect(x, y, BACK);
}

function codexTabAt(x: number, y: number): CodexTab | null {
  if (inRect(x, y, TAB_UNIT)) return 'unit';
  if (inRect(x, y, TAB_HERO)) return 'hero';
  if (inRect(x, y, TAB_MONSTER)) return 'monster';
  if (inRect(x, y, TAB_SKILL)) return 'skill';
  if (inRect(x, y, TAB_RANK)) return 'rank';
  if (inRect(x, y, TAB_VERSUS)) return 'versus';
  return null;
}

export type CodexSkillAction =
  | { kind: 'equip'; skillKind: 'active' | 'passive'; id: string }
  | { kind: 'unequip'; skillKind: 'active' | 'passive'; id: string };

type SkillCardAction = 'equip' | 'unequip' | 'none';

type SkillCardLayout = {
  skillKind: 'active' | 'passive';
  id: string;
  cardY: number; // content-space y (unscrolled)
  action: SkillCardAction;
  actionRect: { x: number; y: number; w: number; h: number }; // content-space
};

function skillActionFor(
  loadout: LoadoutState,
  skillKind: 'active' | 'passive',
  id: string,
): SkillCardAction {
  if (skillKind === 'active') {
    if (isEquipped(loadout, id)) return 'unequip';
    if (isOwnedActive(loadout, id)) return 'equip';
    return 'none';
  }
  if (isPassiveEquipped(loadout, id)) return 'unequip';
  if (isOwnedPassive(loadout, id)) return 'equip';
  return 'none';
}

function buildSkillLayouts(loadout: LoadoutState): SkillCardLayout[] {
  const layouts: SkillCardLayout[] = [];
  let y = SKILL_HINT_H + SKILL_SECTION_H;
  for (const skill of enabledActives()) {
    const action = skillActionFor(loadout, 'active', skill.id);
    layouts.push({
      skillKind: 'active',
      id: skill.id,
      cardY: y,
      action,
      actionRect: {
        x: GRID_LEFT + GRID_W - SKILL_ACTION_W - 12,
        y: y + (SKILL_CARD_H - SKILL_ACTION_H) / 2,
        w: SKILL_ACTION_W,
        h: SKILL_ACTION_H,
      },
    });
    y += SKILL_CARD_H + SKILL_CARD_GAP;
  }
  y += 14 + SKILL_SECTION_H;
  for (const skill of enabledPassives()) {
    const action = skillActionFor(loadout, 'passive', skill.id);
    layouts.push({
      skillKind: 'passive',
      id: skill.id,
      cardY: y,
      action,
      actionRect: {
        x: GRID_LEFT + GRID_W - SKILL_ACTION_W - 12,
        y: y + (SKILL_CARD_H - SKILL_ACTION_H) / 2,
        w: SKILL_ACTION_W,
        h: SKILL_ACTION_H,
      },
    });
    y += SKILL_CARD_H + SKILL_CARD_GAP;
  }
  return layouts;
}

/** 屏幕坐标 → 技能操作（仅技能 Tab；content 区） */
export function codexSkillActionAt(
  x: number,
  y: number,
  loadout: LoadoutState,
): CodexSkillAction | null {
  if (codexTab !== 'skill') return null;
  if (y < CONTENT_TOP || y > CONTENT_TOP + CONTENT_H) return null;
  const contentY = y - CONTENT_TOP + codexScrollY;
  for (const layout of buildSkillLayouts(loadout)) {
    if (layout.action === 'none') continue;
    const r = layout.actionRect;
    if (x >= r.x && x <= r.x + r.w && contentY >= r.y && contentY <= r.y + r.h) {
      return { kind: layout.action, skillKind: layout.skillKind, id: layout.id };
    }
  }
  return null;
}

export function codexPointerDown(x: number, y: number): boolean {
  const tab = codexTabAt(x, y);
  if (tab) {
    if (tab !== codexTab) {
      codexTab = tab;
      codexScrollY = 0;
    }
    return true;
  }
  if (y < CONTENT_TOP) return false;
  codexPointerActive = true;
  codexDragged = false;
  codexDownX = x;
  codexDownY = y;
  codexDownScroll = codexScrollY;
  return true;
}

export function codexPointerMove(x: number, y: number): void {
  void x;
  if (!codexPointerActive) return;
  const dy = y - codexDownY;
  if (Math.abs(dy) > 6) codexDragged = true;
  codexScrollY = Math.max(0, Math.min(codexMaxScroll(), codexDownScroll - dy));
}

/** 若未拖动且点在技能按钮上，返回装备操作；否则 null */
export function codexPointerUp(x?: number, y?: number, loadout?: LoadoutState): CodexSkillAction | null {
  const dragged = codexDragged;
  const downX = codexDownX;
  const downY = codexDownY;
  codexPointerActive = false;
  codexDragged = false;
  if (dragged || x === undefined || y === undefined || !loadout) return null;
  // 用抬起点；若偏离按下过远也视为未点中按钮
  if (Math.hypot(x - downX, y - downY) > 12) return null;
  return codexSkillActionAt(x, y, loadout);
}

export function codexWheel(deltaY: number): void {
  codexScrollY = Math.max(0, Math.min(codexMaxScroll(), codexScrollY + deltaY));
}

function drawCodexTabs(ctx: CanvasRenderingContext2D): void {
  drawInkActionButton(ctx, TAB_UNIT, '兵器', false, codexTab === 'unit' ? 'primary' : 'secondary');
  drawInkActionButton(ctx, TAB_HERO, '神将', false, codexTab === 'hero' ? 'primary' : 'secondary');
  drawInkActionButton(ctx, TAB_MONSTER, '妖怪', false, codexTab === 'monster' ? 'primary' : 'secondary');
  drawInkActionButton(ctx, TAB_SKILL, '技能', false, codexTab === 'skill' ? 'primary' : 'secondary');
  drawInkActionButton(ctx, TAB_RANK, '境界', false, codexTab === 'rank' ? 'primary' : 'secondary');
  drawInkActionButton(ctx, TAB_VERSUS, '对战', false, codexTab === 'versus' ? 'primary' : 'secondary');
}

function drawScrollFade(ctx: CanvasRenderingContext2D): void {
  const max = codexMaxScroll();
  if (max <= 0) return;
  const barH = Math.max(28, (CONTENT_H / codexContentHeight(codexTab)) * CONTENT_H);
  const trackX = VIEW_W - 10;
  const trackY = CONTENT_TOP + 8;
  const trackH = CONTENT_H - 16;
  const thumbY = trackY + (codexScrollY / max) * (trackH - barH);
  roundRect(ctx, trackX - 3, trackY, 6, trackH, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  roundRect(ctx, trackX - 3, thumbY, 6, barH, 3);
  ctx.fillStyle = 'rgba(255,215,106,0.45)';
  ctx.fill();
}

function drawUnitCard(ctx: CanvasRenderingContext2D, type: UnitType, x: number, y: number, w: number, h: number): void {
  const cfg = UNITS[type];
  const color = UNIT_COLOR[type];
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = '#241f16';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();

  const spr = sprite(unitAsset(type));
  const box = 54;
  if (spr) {
    const s = Math.min(box / spr.width, box / spr.height);
    ctx.drawImage(spr, x + 12, y + 12, spr.width * s, spr.height * s);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff6e6';
  ctx.font = 'bold 20px "PingFang SC", sans-serif';
  ctx.fillText(cfg.name, x + 74, y + 14);
  ctx.fillStyle = color;
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillText(`法宝「${cfg.origin}」· ${cfg.role}`, x + 74, y + 40);
  ctx.fillStyle = 'rgba(255,240,210,0.75)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(`范围 ${cfg.rge}　目标 ${cfg.targets}`, x + 74, y + 60);

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '11px "PingFang SC", sans-serif';
  ctx.fillText('阶', x + 14, y + 84);
  ctx.fillText('攻击', x + 60, y + 84);
  ctx.fillText('攻速', x + 120, y + 84);
  ctx.fillText('战力', x + 186, y + 84);
  for (let t = 1; t <= MAX_TIER; t++) {
    const st = getUnitStat(type, t);
    const yy = y + 100 + (t - 1) * 14;
    ctx.fillStyle = '#e8dcc0';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText(`${t}阶`, x + 14, yy);
    ctx.fillText(st.atk.toFixed(2), x + 60, yy);
    ctx.fillText(st.frq.toFixed(2), x + 120, yy);
    ctx.fillStyle = color;
    ctx.fillText(towerPOW(type, t).toFixed(1), x + 186, yy);
  }

  const lore = UNIT_LORE[type];
  if (lore) {
    ctx.fillStyle = LORE_COLOR;
    ctx.font = LORE_FONT;
    ctx.fillText(truncate(ctx, lore, w - 28), x + 14, y + 174);
  }
}

function drawMonsterTypeCard(ctx: CanvasRenderingContext2D, card: MonsterTypeCard, x: number, y: number, w: number, h: number): void {
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = '#241f16';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = card.color;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = card.color;
  ctx.font = 'bold 16px "PingFang SC", sans-serif';
  ctx.fillText(card.name, x + 12, y + 10);
  ctx.fillStyle = 'rgba(255,240,210,0.78)';
  ctx.font = '12px "PingFang SC", sans-serif';
  card.lines.forEach((line, i) => {
    ctx.fillText(truncate(ctx, line, w - 24), x + 12, y + 34 + i * 16);
  });
  if (card.lore) {
    ctx.fillStyle = LORE_COLOR;
    ctx.font = LORE_FONT;
    ctx.fillText(truncate(ctx, card.lore, w - 24), x + 12, y + h - 20);
  }
}

function drawMonsterSprite(
  ctx: CanvasRenderingContext2D,
  mapId: string,
  role: 'minion' | 'boss' | 'cavalry',
  cx: number,
  cy: number,
  box: number,
  label: string,
  labelColor = '#fff6e6',
): void {
  const key = `monster-${role}-${mapId}` as AssetKey;
  const spr = sprite(key) ?? sprite(`monster-${role}` as AssetKey);
  if (spr) {
    const s = Math.min(box / spr.width, box / spr.height);
    ctx.drawImage(spr, cx, cy, spr.width * s, spr.height * s);
  }
  ctx.fillStyle = labelColor;
  ctx.font = 'bold 11px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(label, cx + box / 2, cy + box + 2);
}

/** 地图行小 Boss 立绘：小 Boss 跨地图通用，这里给每张图选一个「代表」kind 作展示（仅区分立绘、非该图专属；6 种详见小 Boss 栏目）。 */
const MAP_MINIBOSS_REP: Record<string, MiniBossKind> = {
  huoyanshan: 'lion', // 火焰山：黄狮（暖金）
  liushahe: 'frost', // 流沙河：霜魄（水寒）
  baiguling: 'blight', // 白骨岭：蚀甲（腐朽）
  pansidong: 'gale', // 盘丝洞：疾风
  huangfengling: 'quake', // 黄风岭：撼地（土系）
};
function drawMiniBossRowSprite(ctx: CanvasRenderingContext2D, mapId: string, kind: MiniBossKind, cx: number, cy: number, box: number): void {
  const spr = miniBossSprite(kind, mapId);
  if (spr) {
    const s = Math.min(box / spr.width, box / spr.height);
    ctx.drawImage(spr, cx, cy + (box - spr.height * s) / 2, spr.width * s, spr.height * s);
  }
  ctx.fillStyle = '#7ec8ff';
  ctx.font = 'bold 11px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('小Boss', cx + box / 2, cy + box + 2);
}

function drawMapMonsterRow(ctx: CanvasRenderingContext2D, mapId: string, mapName: string, x: number, y: number, w: number, miniBossKind: MiniBossKind): void {
  roundRect(ctx, x, y, w, MAP_ROW_H, 10);
  ctx.fillStyle = '#241f16';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(162,74,106,0.55)';
  ctx.stroke();

  const skillId = MAP_SKILL[mapId];
  const skillMeta = skillId ? SKILL_META[skillId] : null;
  const skillDesc = skillId ? SKILL_DESC[skillId] : '';

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ff9ab0';
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText(mapName, x + 12, y + 12);
  // 地图行右上角五行徽章（避开左侧地图名，贴行顶右缘；MAP_ELEMENT 未收录的图不画；
  // DevTools 五行总开关关闭时整体隐藏）
  if (wuxingEnabled()) drawElementBadge(ctx, x + w - 16, y + 15, 8, MAP_ELEMENT[mapId] ?? null);

  ctx.strokeStyle = 'rgba(162,74,106,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + MAP_NAME_W, y + 10);
  ctx.lineTo(x + MAP_NAME_W, y + MAP_ROW_H - 10);
  ctx.stroke();

  const textX = x + MAP_NAME_W + 10;
  const textW = w * 0.38;
  if (skillMeta) {
    ctx.fillStyle = skillMeta.color;
    ctx.font = 'bold 13px "PingFang SC", sans-serif';
    ctx.fillText(`精英/妖王：${skillMeta.name}`, textX, y + 14);
    ctx.fillStyle = 'rgba(255,240,210,0.72)';
    ctx.font = '11px "PingFang SC", sans-serif';
    ctx.fillText(truncate(ctx, skillDesc, textW), textX, y + 34);
    ctx.fillText('小 Boss 为跨地图通用光环', textX, y + 50);
  }

  const spriteBox = 34;
  const spriteY = y + 24;
  const step = 48; // 34 立绘 + 14 间距：四格（小妖/骑兵/小Boss/妖王）不压左侧文字区
  const bossX = x + w - 68;          // 妖王（最右）
  const miniBossX = bossX - step;    // 小 Boss
  const cavalryX = miniBossX - step; // 骑兵
  const minionX = cavalryX - step;   // 小妖
  drawMonsterSprite(ctx, mapId, 'minion', minionX, spriteY, spriteBox, '小妖');
  drawMonsterSprite(ctx, mapId, 'cavalry', cavalryX, spriteY, spriteBox, '骑兵', '#7dff8a');
  drawMiniBossRowSprite(ctx, mapId, miniBossKind, miniBossX, spriteY, spriteBox);
  drawMonsterSprite(ctx, mapId, 'boss', bossX, spriteY, spriteBox, '妖王', '#ff9ab0');
}

function drawUnitTab(ctx: CanvasRenderingContext2D, scrollY: number): void {
  const y0 = CONTENT_TOP - scrollY;
  UNIT_ORDER.forEach((type, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = GRID_LEFT + col * (CARD_W + UNIT_GAP);
    const y = y0 + row * (UNIT_CARD_H + UNIT_GAP);
    drawUnitCard(ctx, type, x, y, CARD_W, UNIT_CARD_H);
  });
}

// 小 Boss 区在怪物 Tab 中占据的垂直高度（与 drawMiniBossCodexSection 布局一致，供滚动上限与下区定位）
function miniBossSectionH(): number {
  const rows = Math.ceil(MINI_BOSS_KINDS.length / 2);
  return 26 + rows * MINIBOSS_CARD_H + (rows - 1) * 10;
}

function drawMonsterTab(ctx: CanvasRenderingContext2D, scrollY: number): void {
  const y0 = CONTENT_TOP - scrollY;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,240,210,0.65)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText('抵达唐僧扣 1 心 · 威胁 = 血量 × 移速（POW）', GRID_LEFT, y0 + 4);

  let y = y0 + 28;
  ctx.fillStyle = '#ff9ab0';
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText('种类', GRID_LEFT, y);
  y += 22;

  for (const card of monsterTypeCards()) {
    drawMonsterTypeCard(ctx, card, GRID_LEFT, y, GRID_W, MTYPE_CARD_H);
    y += MTYPE_CARD_H + TYPE_CARD_GAP;
  }

  y += 10;
  ctx.fillStyle = '#ff9ab0';
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText('各地图', GRID_LEFT, y);
  y += 22;

  MAPS.forEach((map, i) => {
    const mbKind = MAP_MINIBOSS_REP[map.id] ?? MINI_BOSS_KINDS[i % MINI_BOSS_KINDS.length]!;
    drawMapMonsterRow(ctx, map.id, map.name, GRID_LEFT, y, GRID_W, mbKind);
    y += MAP_ROW_H + 10;
  });

  drawMiniBossCodexSection(ctx, y + 6);
  drawBossCodexSection(ctx, y + 6 + miniBossSectionH() + 20);
}

// 小 Boss 独立栏目：5 种各一张立绘 + 血量/移速/技能说明（跨地图通用，立绘取 pansidong 作代表）
function drawMiniBossCodexSection(ctx: CanvasRenderingContext2D, y0: number): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ff9ab0';
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText('小 Boss（跨地图光环）', GRID_LEFT, y0);
  ctx.fillStyle = 'rgba(255,240,210,0.6)';
  ctx.font = '11px "PingFang SC", sans-serif';
  ctx.fillText('血量=普通怪×' + TUNING.miniBossHpMul + ' · 移速按种类（霜魄/撼地慢、疾风快）', GRID_LEFT + 168, y0 + 3);

  const CARD_GAP = 10;
  const cardW = (GRID_W - CARD_GAP) / 2;
  const cardH = MINIBOSS_CARD_H;
  const refMap = 'pansidong'; // 小 Boss 立绘与地图无关，取一张作展示
  let y = y0 + 26;
  MINI_BOSS_KINDS.forEach((kind, i) => {
    const col = i % 2;
    if (col === 0 && i > 0) y += cardH + CARD_GAP;
    const x = GRID_LEFT + col * (cardW + CARD_GAP);
    drawMiniBossCard(ctx, kind, x, y, cardW, cardH, refMap);
  });
}

function drawMiniBossCard(
  ctx: CanvasRenderingContext2D,
  kind: MiniBossKind,
  x: number,
  y: number,
  w: number,
  h: number,
  mapId: string,
): void {
  const meta = MINI_BOSS_META[kind];
  const spd = Battle.miniBossSpawnSpdMul(kind, TUNING);
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = '#241f16';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = meta.color;
  ctx.stroke();

  // 立绘
  const box = 56;
  const spr = miniBossSprite(kind, mapId);
  if (spr) {
    const s = Math.min(box / spr.width, box / spr.height);
    ctx.drawImage(spr, x + 8, y + (h - spr.height * s) / 2, spr.width * s, spr.height * s);
  } else {
    ctx.fillStyle = meta.color;
    ctx.font = 'bold 22px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.icon, x + 8 + box / 2, y + h / 2);
  }

  const tx = x + box + 18;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = meta.color;
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText(meta.name, tx, y + 8);
  ctx.fillStyle = '#ffe08a';
  ctx.font = 'bold 12px "PingFang SC", sans-serif';
  ctx.fillText(`技能「${meta.skillName}」`, tx, y + 28);
  ctx.fillStyle = 'rgba(255,240,210,0.78)';
  ctx.font = '11px "PingFang SC", sans-serif';
  ctx.fillText(truncate(ctx, meta.desc, w - box - 30), tx, y + 46);
  ctx.fillStyle = 'rgba(255,240,210,0.7)';
  ctx.fillText(`血量：普通怪×${TUNING.miniBossHpMul}`, tx, y + 64);
  ctx.fillText(`移速：×${spd.toFixed(2)}`, tx, y + 78);

  const lore = MINIBOSS_LORE[kind];
  if (lore) {
    ctx.fillStyle = LORE_COLOR;
    ctx.font = LORE_FONT;
    ctx.fillText(truncate(ctx, lore, w - 20), x + 10, y + 96);
  }
}

// 妖王独立栏目：每张图一只妖王，展示立绘 + 血量/移速/技能/护卫（地图专属减益）
function drawBossCodexSection(ctx: CanvasRenderingContext2D, y0: number): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ff9ab0';
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText('妖王（每图专属）', GRID_LEFT, y0);
  ctx.fillStyle = 'rgba(255,240,210,0.6)';
  ctx.font = '11px "PingFang SC", sans-serif';
  ctx.fillText(
    `血量 普通怪×${TUNING.bossHpMulEarly}~×${TUNING.bossHpMul} · 移速×${TUNING.bossSpdMul}（慢血厚）· 出场带护卫`,
    GRID_LEFT + 120,
    y0 + 3,
  );

  const CARD_GAP = 10;
  const cardW = (GRID_W - CARD_GAP) / 2;
  const cardH = BOSS_CARD_H;
  let y = y0 + 26;
  MAPS.forEach((map, i) => {
    const col = i % 2;
    if (col === 0 && i > 0) y += cardH + CARD_GAP;
    const x = GRID_LEFT + col * (cardW + CARD_GAP);
    drawBossCard(ctx, map, x, y, cardW, cardH);
  });
}

function drawBossCard(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const skillId = MAP_SKILL[map.id];
  const meta = skillId ? SKILL_META[skillId] : null;
  const desc = skillId ? SKILL_DESC[skillId] : '';
  const spd = TUNING.monsterSpd * TUNING.bossSpdMul;
  const color = meta ? meta.color : '#ff5a8a';
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = '#241f16';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();

  // 立绘（每图专属妖王）
  const box = 56;
  const spr = sprite(`monster-boss-${map.id}` as AssetKey);
  if (spr) {
    const s = Math.min(box / spr.width, box / spr.height);
    ctx.drawImage(spr, x + 8, y + (h - spr.height * s) / 2, spr.width * s, spr.height * s);
  } else {
    ctx.fillStyle = color;
    ctx.font = 'bold 22px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta ? meta.icon : '王', x + 8 + box / 2, y + h / 2);
  }

  const tx = x + box + 18;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText(`${map.name}妖王`, tx, y + 8);
  ctx.fillStyle = '#ffe08a';
  ctx.font = 'bold 12px "PingFang SC", sans-serif';
  ctx.fillText(meta ? `技能「${meta.name}」` : '技能：本地图专属', tx, y + 26);
  ctx.fillStyle = 'rgba(255,240,210,0.78)';
  ctx.font = '11px "PingFang SC", sans-serif';
  ctx.fillText(truncate(ctx, desc, w - box - 30), tx, y + 42);
  ctx.fillStyle = 'rgba(255,240,210,0.7)';
  ctx.fillText(`血量：普通怪×${TUNING.bossHpMulEarly}~×${TUNING.bossHpMul}`, tx, y + 60);
  ctx.fillText(`移速：×${TUNING.bossSpdMul}（≈ ${spd.toFixed(2)} 格/s，慢血厚）`, tx, y + 76);
  ctx.fillText(`护卫：${TUNING.bossEscortMin}~${TUNING.bossEscortMax} 名 · 分血`, tx, y + 92);

  const lore = BOSS_LORE[map.id];
  if (lore) {
    ctx.fillStyle = LORE_COLOR;
    ctx.font = LORE_FONT;
    ctx.fillText(truncate(ctx, lore, w - 20), x + 10, y + 110);
  }
}

function drawHeroCard(ctx: CanvasRenderingContext2D, g: GeneralDef, x: number, y: number, w: number, h: number): void {
  const rankColor = RANK_COLOR[g.rank];
  const maxTierColor = g.maxTier === 5 ? '#e8912c' : '#7a9ab8';
  const stat1 = generalStat(g, 1);
  const statMax = generalStat(g, g.maxTier);
  const powMax = generalPOW(g, g.maxTier);

  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = '#241f16';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rankColor;
  ctx.stroke();

  const heroSpr = sprite(g.asset as AssetKey);
  const box = 52;
  if (heroSpr) {
    const s = Math.min(box / heroSpr.width, box / heroSpr.height);
    ctx.drawImage(heroSpr, x + 10, y + 10, heroSpr.width * s, heroSpr.height * s);
  }
  // 武将卡左上角五行徽章（武将必有属性，直接画；五行总开关关闭时隐藏）
  if (wuxingEnabled()) drawElementBadge(ctx, x + 16, y + 16, 8, g.element);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const nameX = x + 72;
  const nameY = y + 10;
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  const nameW = ctx.measureText(g.name).width;
  ctx.fillStyle = '#fff6e6';
  ctx.fillText(g.name, nameX, nameY);
  ctx.fillStyle = rankColor;
  ctx.font = 'bold 12px "PingFang SC", sans-serif';
  ctx.fillText(g.rank, nameX + nameW + 8, nameY + 3);
  ctx.fillStyle = 'rgba(255,240,210,0.8)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(`「${g.chars[0]}」「${g.chars[1]}」· ${g.role} · ${g.atkStyle}`, x + 72, y + 32);
  ctx.fillStyle = maxTierColor;
  ctx.fillText(`满${g.maxTier}`, x + 72, y + 48);

  // 技能名（一行）+ 大招描述（含定身时长/击退格数/灼烧/增益倍率等具体数值，
  // 自动折行至多 2 行，落在卡片内不越界）。描述位于头像下方，用整卡宽度。
  ctx.fillStyle = '#e8c86a';
  ctx.font = 'bold 12px "PingFang SC", sans-serif';
  ctx.fillText(truncate(ctx, `技能「${g.skillName}」`, w - 24), x + 12, y + 66);
  ctx.fillStyle = '#c8b890';
  ctx.font = '11px "PingFang SC", sans-serif';
  fitTextLines(ctx, g.skillDesc, w - 24, 2).forEach((ln, i) => ctx.fillText(ln, x + 12, y + 84 + i * 15));

  // 数值行（固定 y，保证各卡对齐、不越界）
  ctx.fillStyle = 'rgba(255,240,210,0.72)';
  const cdText = g.skillCd > 0 ? `　技能 ${g.skillCd}s` : '';
  ctx.fillText(
    `白阶 攻${stat1.atk.toFixed(1)} 速${stat1.frq.toFixed(1)} 距${stat1.rge} 目${g.targets}${cdText}`,
    x + 12,
    y + 120,
  );
  ctx.fillStyle = rankColor;
  ctx.fillText(
    `${g.maxTier}阶 攻${statMax.atk.toFixed(1)} 战力${powMax.toFixed(0)}`,
    x + 12,
    y + 136,
  );

  const lore = HERO_LORE[g.id];
  if (lore) {
    ctx.fillStyle = LORE_COLOR;
    ctx.font = LORE_FONT;
    ctx.fillText(truncate(ctx, lore, w - 24), x + 12, y + 156);
  }
}

function drawHeroTab(ctx: CanvasRenderingContext2D, scrollY: number): void {
  const y0 = CONTENT_TOP - scrollY;
  GENERALS.forEach((g, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = GRID_LEFT + col * (CARD_W + HERO_GAP);
    const y = y0 + row * (HERO_CARD_H + HERO_GAP);
    drawHeroCard(ctx, g, x, y, CARD_W, HERO_CARD_H);
  });
}

function drawSkillCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  skillId: string,
  icon: string,
  name: string,
  sub: string,
  desc: string,
  accent: string,
  cost: number,
  action: SkillCardAction,
  statusLabel: string,
  lore: string,
): void {
  const rarity = skillRarityColor(cost);
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = '#241f16';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = action === 'unequip' ? '#ffd76a' : accent;
  ctx.stroke();
  roundRect(ctx, x + 4, y + 4, w - 8, h - 8, 8);
  ctx.fillStyle = rarity.ink;
  ctx.fill();

  const iconCx = x + 36;
  const iconCy = y + h / 2;
  drawSkillGlyph(ctx, iconCx, iconCy, 22, icon, accent, true, skillId);

  const textX = x + 68;
  const hasBtn = action === 'equip' || action === 'unequip';
  const textW = w - 80 - (hasBtn ? SKILL_ACTION_W + 8 : 0);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = rarity.color;
  ctx.font = 'bold 11px "PingFang SC", serif';
  ctx.fillText(
    statusLabel ? `${rarity.label} · ${statusLabel}` : rarity.label,
    textX,
    y + 10,
  );
  ctx.fillStyle = '#fff6e6';
  ctx.font = 'bold 16px "PingFang SC", sans-serif';
  ctx.fillText(name, textX, y + 26);
  ctx.fillStyle = accent;
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(truncate(ctx, sub, textW), textX, y + 48);
  ctx.fillStyle = 'rgba(255,240,210,0.78)';
  ctx.font = '12px "PingFang SC", sans-serif';
  const descLines = fitTextLines(ctx, desc, textW, 2);
  const descY = y + 66;
  descLines.forEach((line, i) => {
    ctx.fillText(line, textX, descY + i * 15);
  });
  if (lore) {
    ctx.fillStyle = LORE_COLOR;
    ctx.font = LORE_FONT;
    ctx.fillText(truncate(ctx, lore, textW), textX, y + 100);
  }

  if (!hasBtn) return;

  const btn = {
    x: x + w - SKILL_ACTION_W - 12,
    y: y + (h - SKILL_ACTION_H) / 2,
    w: SKILL_ACTION_W,
    h: SKILL_ACTION_H,
  };
  if (action === 'unequip') {
    drawInkActionButton(ctx, btn, '卸下', false, 'secondary');
  } else {
    drawInkActionButton(ctx, btn, '装备', false, 'primary');
  }
}

function drawSkillTab(ctx: CanvasRenderingContext2D, scrollY: number, loadout: LoadoutState): void {
  const y0 = CONTENT_TOP - scrollY;
  const equippedA = loadout.equipped.length;
  const equippedP = loadout.passives.length;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,240,210,0.72)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText('每日重置 · 本页可卸下/重装今日已购技能', GRID_LEFT, y0 + 4);
  ctx.fillText('购买仅神秘商人出现时可用（本页不能买）', GRID_LEFT, y0 + 22);

  let y = y0 + SKILL_HINT_H;
  ctx.fillStyle = SKILL_ACTIVE_COLOR;
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText(`主动技能（已装 ${equippedA}/${MAX_EQUIPPED_ACTIVES}）`, GRID_LEFT, y);
  y += SKILL_SECTION_H;

  for (const skill of enabledActives()) {
    const action = skillActionFor(loadout, 'active', skill.id);
    const status =
      action === 'unequip' ? '已装备' : action === 'equip' ? '今日已购' : '';
    drawSkillCard(
      ctx,
      GRID_LEFT,
      y,
      GRID_W,
      SKILL_CARD_H,
      skill.id,
      skill.icon,
      skill.name,
      `CD ${skill.cd}s · ${skill.cost} 功德 · 战斗中手动释放`,
      skill.desc,
      SKILL_ACTIVE_COLOR,
      skill.cost,
      action,
      status,
      ACTIVE_LORE[skill.id] ?? '',
    );
    y += SKILL_CARD_H + SKILL_CARD_GAP;
  }

  y += 14;
  ctx.fillStyle = SKILL_PASSIVE_COLOR;
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText(`被动技能（已装 ${equippedP}/${MAX_EQUIPPED_PASSIVES}）`, GRID_LEFT, y);
  y += SKILL_SECTION_H;

  for (const skill of enabledPassives()) {
    const action = skillActionFor(loadout, 'passive', skill.id);
    const status =
      action === 'unequip' ? '已装备' : action === 'equip' ? '今日已购' : '';
    drawSkillCard(
      ctx,
      GRID_LEFT,
      y,
      GRID_W,
      SKILL_CARD_H,
      skill.id,
      skill.icon,
      skill.name,
      `${skill.cost} 功德 · 开局自动注入本局`,
      skill.desc,
      SKILL_PASSIVE_COLOR,
      skill.cost,
      action,
      status,
      PASSIVE_LORE[skill.id] ?? '',
    );
    y += SKILL_CARD_H + SKILL_CARD_GAP;
  }
}

// 境界 Tab：当前境界卡 + 8 档境界阶梯 + 升星/难度/无尽与PvP 三张规则卡。
// 数值全部取自 rank.ts 的真实规则（星级进退、难度自适应系数），不另写死文案数值。
function drawRankTab(ctx: CanvasRenderingContext2D, scrollY: number, rank: RankState): void {
  const y0 = CONTENT_TOP - scrollY;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // —— 当前境界卡 ——
  roundRect(ctx, GRID_LEFT, y0, GRID_W, RANK_CUR_CARD_H, 12);
  ctx.fillStyle = '#241f16';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = RANK_ACCENT;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,240,210,0.65)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText('当前境界', GRID_LEFT + 16, y0 + 12);
  ctx.fillStyle = '#ffe08a';
  ctx.font = 'bold 26px "PingFang SC", sans-serif';
  ctx.fillText(rankName(rank.level), GRID_LEFT + 16, y0 + 30);
  const curFills = Array.from({ length: STARS_PER_TIER }, (_, i) => (i < rank.stars ? 1 : 0));
  drawRankStarsAnimated(ctx, GRID_LEFT + 16 + (STARS_PER_TIER - 1) * 14, y0 + 88, curFills, {
    total: STARS_PER_TIER,
    gap: 28,
    size: 22,
  });

  const rx = GRID_LEFT + 236;
  ctx.fillStyle = 'rgba(255,240,210,0.7)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(`难度系数 ${rank.difficulty.toFixed(2)}（怪物强度）`, rx, y0 + 14);
  ctx.fillText('每胜 ×1.06 · 每败 ×0.88', rx, y0 + 36);
  ctx.fillText('下限 0.60 · 长期胜率约 70%', rx, y0 + 58);
  ctx.fillStyle = 'rgba(255,240,210,0.5)';
  ctx.fillText('境界跨局保存（本机存档）', rx, y0 + 80);

  // —— 境界阶梯 ——
  let y = y0 + RANK_CUR_CARD_H + 14;
  ctx.fillStyle = RANK_ACCENT;
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText('境界阶梯（共 8 境 · 每境 5★）', GRID_LEFT, y);
  y += RANK_SECTION_H;
  for (let lv = 0; lv < LADDER_LEN; lv++) {
    const isCur = lv === rank.level;
    const passed = lv < rank.level;
    roundRect(ctx, GRID_LEFT, y, GRID_W, RANK_ROW_H, 10);
    ctx.fillStyle = '#241f16';
    ctx.fill();
    ctx.lineWidth = isCur ? 2 : 1.5;
    ctx.strokeStyle = isCur
      ? RANK_ACCENT
      : passed
        ? 'rgba(138,154,184,0.5)'
        : 'rgba(255,215,106,0.22)';
    ctx.stroke();

    ctx.font = 'bold 15px "PingFang SC", sans-serif';
    ctx.fillStyle = isCur ? '#ffe08a' : passed ? '#8a9ab8' : 'rgba(255,240,210,0.5)';
    ctx.fillText(`${lv + 1}. ${rankName(lv)}`, GRID_LEFT + 14, y + 12);

    // 小星星：已过境全满、当前境按实际星数、未至为空
    const rowFills = Array.from(
      { length: STARS_PER_TIER },
      (_, i) => (passed || (isCur && i < rank.stars) ? 1 : 0),
    );
    drawRankStarsAnimated(ctx, GRID_LEFT + 320, y + RANK_ROW_H / 2, rowFills, {
      total: STARS_PER_TIER,
      gap: 16,
      size: 13,
    });

    ctx.font = 'bold 12px "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    if (isCur) {
      ctx.fillStyle = RANK_ACCENT;
      ctx.fillText('当前', GRID_LEFT + GRID_W - 14, y + 13);
    } else if (passed) {
      ctx.fillStyle = 'rgba(138,154,184,0.8)';
      ctx.fillText('已达', GRID_LEFT + GRID_W - 14, y + 13);
    } else if (lv === rank.level + 1) {
      ctx.fillStyle = 'rgba(255,240,210,0.4)';
      ctx.fillText('下一境', GRID_LEFT + GRID_W - 14, y + 13);
    }
    ctx.textAlign = 'left';
    y += RANK_ROW_H + RANK_ROW_GAP;
  }

  // —— 提升与规则（复用怪物 Tab 的说明卡样式） ——
  y += 10;
  ctx.fillStyle = RANK_ACCENT;
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText('提升与规则', GRID_LEFT, y);
  y += RANK_SECTION_H;
  const ruleCards: MonsterTypeCard[] = [
    {
      name: '升星与晋级',
      color: '#ffd76a',
      lines: [
        `胜利 +1★；集满 ${STARS_PER_TIER}★ 晋级下一境界，★清零`,
        `失败 -1★；零星再败降回上一境界（回 ${STARS_PER_TIER - 1}★）`,
        '凡人 0★ 为下限 · 齐天大圣满星为上限',
      ],
    },
    {
      name: '难度自适应',
      color: '#7ec8ff',
      lines: [
        '每胜怪物强度 ×1.06、每败 ×0.88（下限 0.60）',
        '强度只随单人胜负调节，自动贴合你的水平',
        '连败卡级会越打越轻松，长期胜率约 70%',
      ],
    },
    {
      name: '无尽与对战',
      color: '#7ec46a',
      lines: [
        '无尽模式：不涨降星，只记最高波数',
        'PvP：胜负照常结算★，但不影响难度系数',
        'PvP 匹配按双方境界就近',
      ],
    },
  ];
  for (const card of ruleCards) {
    drawMonsterTypeCard(ctx, card, GRID_LEFT, y, GRID_W, TYPE_CARD_H);
    y += TYPE_CARD_H + TYPE_CARD_GAP;
  }
}

// 对战 Tab：上半场对手玩法说明——分「AI 对战（默认）」与「真人对战」两节（复用妖怪种类卡样式，纯图文）。
function versusAiCards(): MonsterTypeCard[] {
  return [
    {
      name: '和 AI 同场',
      color: '#7dff8a',
      lines: ['点「开始游戏」，上半场即 AI 对手', 'AI 会自动征兵、布阵、合成、放技能', '对方唐僧先被妖怪吃你赢，你的先倒你负'],
    },
    {
      name: '难度自适应',
      color: '#ffd76a',
      lines: ['AI 与出怪强度随境界、胜负动态调节', '连胜转强、连败转松，长期约七成胜率', '无尽模式不判对手胜负，只拼波数'],
    },
  ];
}

function versusPvpCards(): MonsterTypeCard[] {
  return [
    {
      name: '真人 1v1',
      color: '#ff9a3c',
      lines: ['「真人对战」把上半场 AI 换成真实玩家', '随机匹配，或「邀请好友」生成口令同房', '匹配成功后双方同时开战'],
    },
    {
      name: '实时同步',
      color: '#5bd1ff',
      lines: ['对手的出招 / 掉血 / 加桃实时映到上半场', '你看到的上半场即对手真实战况', '断线过久判负，留意网络'],
    },
    {
      name: '结算与段位',
      color: '#ffd76a',
      lines: ['按胜负升降境界 ★（与单人共用段位）', '但不影响单人 / 无尽的难度系数', '切磋为主，输赢不伤单人进度'],
    },
  ];
}

function versusContentHeight(): number {
  const ai = versusAiCards().length;
  const pvp = versusPvpCards().length;
  return (
    28
    + 22 + ai * (TYPE_CARD_H + TYPE_CARD_GAP)
    + 12 + 22 + pvp * (TYPE_CARD_H + TYPE_CARD_GAP)
    + 8
  );
}

function drawVersusTab(ctx: CanvasRenderingContext2D, scrollY: number): void {
  const y0 = CONTENT_TOP - scrollY;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,240,210,0.72)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText('对战 = 与上半场对手同图比拼，谁的唐僧先被妖怪吃谁负', GRID_LEFT, y0 + 4);

  const section = (title: string, yy: number): number => {
    ctx.fillStyle = '#ffe08a';
    ctx.font = 'bold 15px "PingFang SC", sans-serif';
    ctx.fillText(title, GRID_LEFT, yy);
    return yy + 22;
  };
  const drawCards = (cards: MonsterTypeCard[], yy: number): number => {
    for (const card of cards) {
      drawMonsterTypeCard(ctx, card, GRID_LEFT, yy, GRID_W, TYPE_CARD_H);
      yy += TYPE_CARD_H + TYPE_CARD_GAP;
    }
    return yy;
  };

  let y = y0 + 28;
  y = section('AI 对战 · 默认', y);
  y = drawCards(versusAiCards(), y);
  y += 12;
  y = section('真人对战', y);
  drawCards(versusPvpCards(), y);
}

function drawCodexContent(ctx: CanvasRenderingContext2D, scrollY: number, loadout: LoadoutState, rankState: RankState): void {
  switch (codexTab) {
    case 'unit':
      drawUnitTab(ctx, scrollY);
      break;
    case 'hero':
      drawHeroTab(ctx, scrollY);
      break;
    case 'monster':
      drawMonsterTab(ctx, scrollY);
      break;
    case 'skill':
      drawSkillTab(ctx, scrollY, loadout);
      break;
    case 'rank':
      drawRankTab(ctx, scrollY, rankState);
      break;
    case 'versus':
      drawVersusTab(ctx, scrollY);
      break;
    default: {
      const _exhaustive: never = codexTab;
      return _exhaustive;
    }
  }
}

export function drawCodex(ctx: CanvasRenderingContext2D, loadout: LoadoutState, rankState?: RankState): void {
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, '#2a2418');
  bg.addColorStop(1, '#3a3222');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  roundRect(ctx, BACK.x, BACK.y, BACK.w, BACK.h, 10);
  ctx.fillStyle = '#6a5a3a';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('‹ 返回', BACK.x + BACK.w / 2, BACK.y + BACK.h / 2);

  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 30px "PingFang SC", sans-serif';
  ctx.fillText('图鉴', VIEW_W / 2, 56);

  drawCodexTabs(ctx);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, CONTENT_TOP, VIEW_W, CONTENT_H);
  ctx.clip();
  // 境界 Tab 需要当前段位/星/难度：未传时按初始态渲染（凡人 0★）
  drawCodexContent(ctx, codexScrollY, loadout, rankState ?? { level: 0, stars: 0, difficulty: 1 });
  ctx.restore();

  ctx.fillStyle = 'rgba(42,36,24,0.92)';
  ctx.fillRect(0, CONTENT_TOP - 1, VIEW_W, 1);
  drawScrollFade(ctx);

  if (codexToast && performance.now() < codexToastUntil) {
    ctx.fillStyle = 'rgba(28,22,16,0.82)';
    roundRect(ctx, 40, VIEW_H - 56, VIEW_W - 80, 36, 10);
    ctx.fill();
    ctx.fillStyle = '#ffe8c0';
    ctx.font = '14px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(codexToast, VIEW_W / 2, VIEW_H - 38);
  }
}
