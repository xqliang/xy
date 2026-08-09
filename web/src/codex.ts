// 图鉴：兵器 / 英雄 / 妖怪 / 技能 四 Tab。从主菜单进入，返回主菜单。
import { VIEW_W, VIEW_H } from './render';
import { UNITS, getUnitStat, towerPOW, MAX_TIER, monsterPOW, type UnitType } from '@core';
import { sprite, unitAsset, type AssetKey } from './assets';
import { MAPS } from './board';
import { GENERALS, generalStat, generalPOW, type GeneralDef } from './generals';
import { TUNING, SKILL_META, MAP_SKILL, MINI_BOSS_META, MINI_BOSS_KINDS, type MonsterSkill } from './battle';
import { enabledActives, MAX_EQUIPPED_ACTIVES } from './actives';
import { enabledPassives, MAX_EQUIPPED_PASSIVES } from './passives';
import { skillRarityColor } from './merchant';
import { drawInkActionButton, roundRect } from './menu-ui';

export type CodexTab = 'unit' | 'hero' | 'monster' | 'skill';

const BACK = { x: 24, y: 40, w: 92, h: 44 };
const CONTENT_TOP = 136;
const CONTENT_H = VIEW_H - CONTENT_TOP;
const TAB_W = 82;
const TAB_H = 36;
const TAB_GAP = 6;
const TAB_Y = 92;
const TAB_X0 = (VIEW_W - (TAB_W * 4 + TAB_GAP * 3)) / 2;
const TAB_UNIT = { x: TAB_X0, y: TAB_Y, w: TAB_W, h: TAB_H };
const TAB_HERO = { x: TAB_X0 + TAB_W + TAB_GAP, y: TAB_Y, w: TAB_W, h: TAB_H };
const TAB_MONSTER = { x: TAB_X0 + (TAB_W + TAB_GAP) * 2, y: TAB_Y, w: TAB_W, h: TAB_H };
const TAB_SKILL = { x: TAB_X0 + (TAB_W + TAB_GAP) * 3, y: TAB_Y, w: TAB_W, h: TAB_H };

const UNIT_ORDER: UnitType[] = ['dao', 'spear', 'cavalry', 'archer'];
const UNIT_COLOR: Record<UnitType, string> = { dao: '#ff9a3c', spear: '#5bd1ff', cavalry: '#7dff8a', archer: '#c79bff' };
const RANK_COLOR: Record<GeneralDef['rank'], string> = { T0: '#ffd76a', T1: '#7ec46a', T2: '#a8a090' };

const CARD_W = 250;
const UNIT_CARD_H = 172;
const UNIT_GAP = 14;
const HERO_CARD_H = 132;
const HERO_GAP = 12;
const TYPE_CARD_H = 88;
const TYPE_CARD_GAP = 8;
const MAP_ROW_H = 118;
const MAP_NAME_W = 72;
const EXAMPLE_WAVE = 5;
const GRID_LEFT = (VIEW_W - (CARD_W * 2 + UNIT_GAP)) / 2;
const GRID_W = CARD_W * 2 + UNIT_GAP;
const SKILL_CARD_H = 94;
const SKILL_CARD_GAP = 6;
const SKILL_ACTIVE_COLOR = '#6ab0ff';
const SKILL_PASSIVE_COLOR = '#7ec46a';

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
      lines: [
        `血量 24 + 16×波次（第${EXAMPLE_WAVE}波 ≈ ${hp5}）`,
        `移速 ${spd.toFixed(2)} 格/s · 战力 ${monsterPOW(hp5, spd).toFixed(0)}`,
        '技能：无',
      ],
    },
    {
      name: '精英妖',
      color: SKILL_META.weaken.color,
      lines: [
        `血量 ×${TUNING.eliteHpMul}（第${EXAMPLE_WAVE}波 ≈ ${Math.round(hp5 * TUNING.eliteHpMul)}）`,
        `移速同小妖 · 第${TUNING.eliteFromWave}波起随机出现`,
        '技能：携带本地图专属减益（见下方）',
      ],
    },
    {
      name: '骑兵妖',
      color: '#7dff8a',
      lines: [
        `血量 ×${TUNING.cavalryHpMul.toFixed(2)}（第${EXAMPLE_WAVE}波 ≈ ${Math.round(hp5 * TUNING.cavalryHpMul)}）`,
        `移速 ×${TUNING.cavalrySpdMul}（≈ ${(spd * TUNING.cavalrySpdMul).toFixed(2)} 格/s，快血薄）`,
        `无技能 · 第${TUNING.cavalryFromWave}波起骑兵波随机混入`,
      ],
    },
    {
      name: '小 Boss',
      color: '#7ec8ff',
      lines: [
        `血量 ×${TUNING.miniBossHpMul}（第${EXAMPLE_WAVE}波 ≈ ${Math.round(hp5 * TUNING.miniBossHpMul)}）`,
        `移速 ×${TUNING.miniBossSpdMul} · 第${TUNING.miniBossFromWave}波起随机出现`,
        `光环：${miniBossSkills}`,
      ],
    },
    {
      name: '妖王',
      color: '#ff5a8a',
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
let codexDownScroll = 0;
let codexDragged = false;

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
  return 28 + 22 + types * (TYPE_CARD_H + TYPE_CARD_GAP) + 18 + 22 + MAPS.length * (MAP_ROW_H + 10) + 8;
}

function skillContentHeight(): number {
  const actives = enabledActives();
  const passives = enabledPassives();
  return (
    28
    + 22 + actives.length * (SKILL_CARD_H + SKILL_CARD_GAP)
    + 18 + 22 + passives.length * (SKILL_CARD_H + SKILL_CARD_GAP)
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
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

export function codexMaxScroll(): number {
  return Math.max(0, codexContentHeight(codexTab) - CONTENT_H);
}

export function resetCodex(): void {
  codexTab = 'unit';
  codexScrollY = 0;
  codexPointerActive = false;
  codexDragged = false;
}

export function codexHitBack(x: number, y: number): boolean {
  return inRect(x, y, BACK);
}

function codexTabAt(x: number, y: number): CodexTab | null {
  if (inRect(x, y, TAB_UNIT)) return 'unit';
  if (inRect(x, y, TAB_HERO)) return 'hero';
  if (inRect(x, y, TAB_MONSTER)) return 'monster';
  if (inRect(x, y, TAB_SKILL)) return 'skill';
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

export function codexPointerUp(): void {
  codexPointerActive = false;
}

export function codexWheel(deltaY: number): void {
  codexScrollY = Math.max(0, Math.min(codexMaxScroll(), codexScrollY + deltaY));
}

function drawCodexTabs(ctx: CanvasRenderingContext2D): void {
  drawInkActionButton(ctx, TAB_UNIT, '兵器', false, codexTab === 'unit' ? 'primary' : 'secondary');
  drawInkActionButton(ctx, TAB_HERO, '英雄', false, codexTab === 'hero' ? 'primary' : 'secondary');
  drawInkActionButton(ctx, TAB_MONSTER, '妖怪', false, codexTab === 'monster' ? 'primary' : 'secondary');
  drawInkActionButton(ctx, TAB_SKILL, '技能', false, codexTab === 'skill' ? 'primary' : 'secondary');
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
}

function drawMonsterSprite(
  ctx: CanvasRenderingContext2D,
  mapId: string,
  role: 'minion' | 'boss',
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

function drawMapMonsterRow(ctx: CanvasRenderingContext2D, mapId: string, mapName: string, x: number, y: number, w: number): void {
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

  const spriteBox = 40;
  const spriteY = y + 24;
  const minionX = x + w - 210;
  const cavalryX = x + w - 142;
  const bossX = x + w - 74;
  drawMonsterSprite(ctx, mapId, 'minion', minionX, spriteY, spriteBox, '小妖');
  drawMonsterSprite(ctx, mapId, 'minion', cavalryX, spriteY, spriteBox, '骑兵', '#7dff8a');
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
    drawMonsterTypeCard(ctx, card, GRID_LEFT, y, GRID_W, TYPE_CARD_H);
    y += TYPE_CARD_H + TYPE_CARD_GAP;
  }

  y += 10;
  ctx.fillStyle = '#ff9ab0';
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText('各地图', GRID_LEFT, y);
  y += 22;

  MAPS.forEach((map) => {
    drawMapMonsterRow(ctx, map.id, map.name, GRID_LEFT, y, GRID_W);
    y += MAP_ROW_H + 10;
  });
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

  ctx.fillStyle = '#c8b890';
  ctx.font = '12px "PingFang SC", sans-serif';
  const skillLine = `${g.skillName}：${g.skillDesc}`;
  ctx.fillText(truncate(ctx, skillLine, w - 84), x + 72, y + 66);

  ctx.fillStyle = 'rgba(255,240,210,0.72)';
  ctx.font = '11px "PingFang SC", sans-serif';
  const cdText = g.skillCd > 0 ? `　技能 ${g.skillCd}s` : '';
  ctx.fillText(
    `白阶 攻${stat1.atk.toFixed(1)} 速${stat1.frq.toFixed(1)} 距${stat1.rge}${cdText}`,
    x + 72,
    y + 84,
  );
  ctx.fillStyle = rankColor;
  ctx.fillText(
    `${g.maxTier}阶 攻${statMax.atk.toFixed(1)} 战力${powMax.toFixed(0)}`,
    x + 72,
    y + 100,
  );
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
  icon: string,
  name: string,
  sub: string,
  desc: string,
  accent: string,
  cost: number,
): void {
  const rarity = skillRarityColor(cost);
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = '#241f16';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent;
  ctx.stroke();
  roundRect(ctx, x + 4, y + 4, w - 8, h - 8, 8);
  ctx.fillStyle = rarity.ink;
  ctx.fill();

  const iconCx = x + 36;
  const iconCy = y + h / 2;
  ctx.beginPath();
  ctx.arc(iconCx, iconCy, 22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(48,28,12,0.12)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,60,30,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#3a2208';
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, iconCx, iconCy);

  const textX = x + 68;
  const textW = w - 80;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = rarity.color;
  ctx.font = 'bold 11px "PingFang SC", serif';
  ctx.fillText(rarity.label, textX, y + 10);
  ctx.fillStyle = '#fff6e6';
  ctx.font = 'bold 16px "PingFang SC", sans-serif';
  ctx.fillText(name, textX, y + 24);
  ctx.fillStyle = accent;
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(truncate(ctx, sub, textW), textX, y + 44);
  ctx.fillStyle = 'rgba(255,240,210,0.78)';
  ctx.font = '12px "PingFang SC", sans-serif';
  const descLines = fitTextLines(ctx, desc, textW, 2);
  const descY = y + 58;
  descLines.forEach((line, i) => {
    ctx.fillText(line, textX, descY + i * 15);
  });
}

function drawSkillTab(ctx: CanvasRenderingContext2D, scrollY: number): void {
  const y0 = CONTENT_TOP - scrollY;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,240,210,0.65)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText('神秘商人 / 功德商店购买 · 道具仅当天有效', GRID_LEFT, y0 + 4);

  let y = y0 + 28;
  ctx.fillStyle = SKILL_ACTIVE_COLOR;
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText(`主动技能（最多装备 ${MAX_EQUIPPED_ACTIVES} 个）`, GRID_LEFT, y);
  y += 22;

  for (const skill of enabledActives()) {
    drawSkillCard(
      ctx,
      GRID_LEFT,
      y,
      GRID_W,
      SKILL_CARD_H,
      skill.icon,
      skill.name,
      `CD ${skill.cd}s · ${skill.cost} 功德 · 战斗中手动释放`,
      skill.desc,
      SKILL_ACTIVE_COLOR,
      skill.cost,
    );
    y += SKILL_CARD_H + SKILL_CARD_GAP;
  }

  y += 12;
  ctx.fillStyle = SKILL_PASSIVE_COLOR;
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText(`被动技能（最多生效 ${MAX_EQUIPPED_PASSIVES} 个）`, GRID_LEFT, y);
  y += 22;

  for (const skill of enabledPassives()) {
    drawSkillCard(
      ctx,
      GRID_LEFT,
      y,
      GRID_W,
      SKILL_CARD_H,
      skill.icon,
      skill.name,
      `${skill.cost} 功德 · 开局自动注入本局`,
      skill.desc,
      SKILL_PASSIVE_COLOR,
      skill.cost,
    );
    y += SKILL_CARD_H + SKILL_CARD_GAP;
  }
}

function drawCodexContent(ctx: CanvasRenderingContext2D, scrollY: number): void {
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
      drawSkillTab(ctx, scrollY);
      break;
    default: {
      const _exhaustive: never = codexTab;
      return _exhaustive;
    }
  }
}

export function drawCodex(ctx: CanvasRenderingContext2D): void {
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
  drawCodexContent(ctx, codexScrollY);
  ctx.restore();

  ctx.fillStyle = 'rgba(42,36,24,0.92)';
  ctx.fillRect(0, CONTENT_TOP - 1, VIEW_W, 1);
  drawScrollFade(ctx);
}
