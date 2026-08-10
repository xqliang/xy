// 「神秘商人」功德商店界面：展示功德余额与可升级项 + 主动技能（每日重置）购买，点击卡片购买，返回主菜单。
import { VIEW_W, VIEW_H } from './render';
import { UPGRADES, levelOf, upgradeById, RARITY_COLOR, type MeritState } from './merit';
import { MAX_EQUIPPED_ACTIVES, activeById, enabledActives } from './actives';
import { MAX_EQUIPPED_PASSIVES, passiveById, enabledPassives } from './passives';
import {
  isEquipped,
  isPassiveEquipped,
  isOwnedActive,
  isOwnedPassive,
  type LoadoutState,
} from './loadout';
import { drawUiIcon, MERIT_ICON_PAGE_DISPLAY } from './menu-ui';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const COLS_N = 2;
const CARD_W = 250;
const CARD_H = 150;
const GAP = 12;
const GRID_TOP = 110;
const GRID_LEFT = (VIEW_W - (CARD_W * COLS_N + GAP)) / 2;

export interface ShopHit {
  kind: 'buy' | 'buyActive' | 'buyPassive' | 'back';
  id?: string;
}

function cardRect(i: number): { x: number; y: number } {
  const col = i % COLS_N;
  const row = Math.floor(i / COLS_N);
  return { x: GRID_LEFT + col * (CARD_W + GAP), y: GRID_TOP + row * (CARD_H + GAP) };
}

// 分区标题行（标题 + 描述）高度；卡片从其后开始排
const ACT_CARD_H = 90;
const SEC_HEAD_H = 54;
const SEC_GAP = 28;

function upgradesBlockH(): number {
  if (UPGRADES.length === 0) return 0;
  const rows = Math.ceil(UPGRADES.length / COLS_N);
  return rows * (CARD_H + GAP) - GAP + SEC_GAP;
}

/** 主动技能区：标题行顶边（滚动内容坐标） */
function activeSectionTop(): number {
  return GRID_TOP + upgradesBlockH();
}
function activeCardsTop(): number {
  return activeSectionTop() + SEC_HEAD_H;
}
function activeCardRect(i: number): { x: number; y: number } {
  const col = i % COLS_N;
  const row = Math.floor(i / COLS_N);
  return { x: GRID_LEFT + col * (CARD_W + GAP), y: activeCardsTop() + row * (ACT_CARD_H + GAP) };
}

/** 被动技能区：标题行顶边 */
function passiveSectionTop(): number {
  const rows = Math.max(1, Math.ceil(enabledActives().length / COLS_N));
  return activeCardsTop() + rows * (ACT_CARD_H + GAP) - GAP + SEC_GAP;
}
function passiveCardsTop(): number {
  return passiveSectionTop() + SEC_HEAD_H;
}
function passiveCardRect(i: number): { x: number; y: number } {
  const col = i % COLS_N;
  const row = Math.floor(i / COLS_N);
  return { x: GRID_LEFT + col * (CARD_W + GAP), y: passiveCardsTop() + row * (ACT_CARD_H + GAP) };
}

/** 画分区标题 + 一行说明（不挡卡片） */
function drawSectionHeader(ctx: CanvasRenderingContext2D, top: number, title: string, desc: string): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 20px "PingFang SC", sans-serif';
  ctx.fillText(title, GRID_LEFT, top);
  ctx.fillStyle = 'rgba(224,200,255,0.85)';
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillText(desc, GRID_LEFT, top + 26);
}

const BACK = { x: 24, y: 40, w: 92, h: 44 };

// 商城可滚动内容的总高度（最后一个被动卡片底部 + 底部留白）
export function shopContentHeight(): number {
  const pass = enabledPassives();
  const cardsTop = passiveCardsTop();
  const passiveRows = Math.max(1, Math.ceil(pass.length / COLS_N));
  const lastBottom = cardsTop + (passiveRows - 1) * (ACT_CARD_H + GAP) + ACT_CARD_H;
  return lastBottom + 24; // 底部留白
}
export const SHOP_MAX_SCROLL = () => Math.max(0, shopContentHeight() - VIEW_H);

export function shopHitAt(x: number, y: number, scrollY = 0): ShopHit | null {
  if (x >= BACK.x && x <= BACK.x + BACK.w && y >= BACK.y && y <= BACK.y + BACK.h) return { kind: 'back' };
  const cy0 = y + scrollY; // 卡片随内容上移，屏幕 y 映射到内容坐标需加回 scrollY
  for (let i = 0; i < UPGRADES.length; i++) {
    const { x: cx, y: cy } = cardRect(i);
    if (x >= cx && x <= cx + CARD_W && cy0 >= cy && cy0 <= cy + CARD_H) return { kind: 'buy', id: UPGRADES[i]!.id };
  }
  const acts = enabledActives();
  for (let i = 0; i < acts.length; i++) {
    const { x: cx, y: cy } = activeCardRect(i);
    if (x >= cx && x <= cx + CARD_W && cy0 >= cy && cy0 <= cy + ACT_CARD_H) return { kind: 'buyActive', id: acts[i]!.id };
  }
  const pass = enabledPassives();
  for (let i = 0; i < pass.length; i++) {
    const { x: cx, y: cy } = passiveCardRect(i);
    if (x >= cx && x <= cx + CARD_W && cy0 >= cy && cy0 <= cy + ACT_CARD_H) return { kind: 'buyPassive', id: pass[i]!.id };
  }
  return null;
}

export function drawShop(ctx: CanvasRenderingContext2D, merit: MeritState, loadout: LoadoutState, toast: string, scrollY = 0): void {
  // 背景（固定，铺满整个画布）
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, '#2a2140');
  bg.addColorStop(1, '#3a2c53');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // —— 随内容竖向滚动的三段卡片（升级 / 主动 / 被动）——
  ctx.save();
  ctx.translate(0, -scrollY);

  // 卡片
  for (let i = 0; i < UPGRADES.length; i++) {
    const up = UPGRADES[i]!;
    const lv = levelOf(merit, up.id);
    const maxed = lv >= up.maxLevel;
    const cost = up.cost(lv);
    const afford = merit.merit >= cost;
    const { x, y } = cardRect(i);
    roundRect(ctx, x, y, CARD_W, CARD_H, 12);
    ctx.fillStyle = '#241d38';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = RARITY_COLOR[up.rarity];
    ctx.stroke();
    // 图标 + 名称
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '30px sans-serif';
    ctx.fillText(up.icon, x + 14, y + 12);
    ctx.fillStyle = '#fff6e6';
    ctx.font = 'bold 19px "PingFang SC", sans-serif';
    ctx.fillText(up.name, x + 54, y + 16);
    // 稀有度 + 等级
    ctx.fillStyle = RARITY_COLOR[up.rarity];
    ctx.font = '13px "PingFang SC", sans-serif';
    ctx.fillText(`${up.rarity} · Lv.${lv}/${up.maxLevel}`, x + 54, y + 42);
    // 下一级效果
    ctx.fillStyle = 'rgba(255,240,210,0.85)';
    ctx.font = '15px "PingFang SC", sans-serif';
    ctx.fillText(maxed ? '已满级' : up.desc(lv), x + 14, y + 74);
    // 等级点
    const dotY = y + 102;
    for (let k = 0; k < up.maxLevel; k++) {
      ctx.beginPath();
      ctx.arc(x + 20 + k * 16, dotY, 5, 0, Math.PI * 2);
      ctx.fillStyle = k < lv ? RARITY_COLOR[up.rarity] : 'rgba(255,255,255,0.18)';
      ctx.fill();
    }
    // 购买条
    const bw = CARD_W - 28;
    const by = y + CARD_H - 34;
    roundRect(ctx, x + 14, by, bw, 24, 8);
    ctx.fillStyle = maxed ? '#3a3350' : afford ? '#c8792b' : '#4a3a30';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = maxed ? '#8a86a0' : afford ? '#fff6e6' : '#9a8a7a';
    ctx.font = 'bold 15px "PingFang SC", sans-serif';
    ctx.fillText(maxed ? '——' : `购买 · ${cost} 功德`, x + 14 + bw / 2, by + 12);
  }

  // —— 主动技能区（标题 + 描述；已 disabled 的不展示）——
  const shopActives = enabledActives();
  drawSectionHeader(
    ctx,
    activeSectionTop(),
    '主动技能',
    `当日购买一次即可，可随时卸下/再装备；最多同时装备 ${MAX_EQUIPPED_ACTIVES} 个`,
  );
  const actFull = loadout.equipped.length >= MAX_EQUIPPED_ACTIVES;
  for (let i = 0; i < shopActives.length; i++) {
    const act = shopActives[i]!;
    const equipped = isEquipped(loadout, act.id);
    const owned = isOwnedActive(loadout, act.id);
    const afford = merit.merit >= act.cost;
    const { x, y } = activeCardRect(i);
    roundRect(ctx, x, y, CARD_W, ACT_CARD_H, 12);
    ctx.fillStyle = '#241d38';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = equipped ? '#6ab0ff' : owned ? '#7a9ad0' : '#5a4a7a';
    ctx.stroke();
    // 图标 + 名称
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '28px "PingFang SC", sans-serif';
    ctx.fillStyle = '#fff6e6';
    ctx.fillText(act.icon, x + 12, y + 12);
    ctx.font = 'bold 18px "PingFang SC", sans-serif';
    ctx.fillText(act.name, x + 52, y + 14);
    ctx.fillStyle = 'rgba(255,240,210,0.8)';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText(fitText(ctx, act.desc, CARD_W - 64), x + 52, y + 40);
    // 购买 / 装备 / 卸下 / 槽满
    const bw = CARD_W - 24;
    const by = y + ACT_CARD_H - 30;
    roundRect(ctx, x + 12, by, bw, 22, 7);
    const barOk = equipped || (owned ? !actFull : afford);
    ctx.fillStyle = equipped ? '#2f5a3a' : owned && !actFull ? '#3a5a7a' : barOk ? '#c8792b' : '#4a3a30';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = equipped || (owned && !actFull) ? '#9bffb0' : barOk ? '#fff6e6' : '#9a8a7a';
    ctx.font = 'bold 13px "PingFang SC", sans-serif';
    const barText = equipped
      ? '✓ 已装备 · 点击卸下'
      : owned
        ? (actFull ? '已满，请先卸下' : '已购买 · 点击装备')
        : `购买 · ${act.cost} 功德 · CD${act.cd}s`;
    ctx.fillText(barText, x + 12 + bw / 2, by + 11);
  }

  // —— 被动技能区（标题 + 描述；已 disabled 的不展示）——
  const shopPassives = enabledPassives();
  drawSectionHeader(
    ctx,
    passiveSectionTop(),
    '被动技能',
    `当日购买一次即可，可随时卸下/再装备；最多同时装备 ${MAX_EQUIPPED_PASSIVES} 个`,
  );
  const pasFull = loadout.passives.length >= MAX_EQUIPPED_PASSIVES;
  for (let i = 0; i < shopPassives.length; i++) {
    const pas = shopPassives[i]!;
    const equipped = isPassiveEquipped(loadout, pas.id);
    const owned = isOwnedPassive(loadout, pas.id);
    const afford = merit.merit >= pas.cost;
    const { x, y } = passiveCardRect(i);
    roundRect(ctx, x, y, CARD_W, ACT_CARD_H, 12);
    ctx.fillStyle = '#241d38';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = equipped ? '#7ec46a' : owned ? '#6a9a6a' : '#5a4a7a';
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '28px "PingFang SC", sans-serif';
    ctx.fillStyle = '#fff6e6';
    ctx.fillText(pas.icon, x + 12, y + 12);
    ctx.font = 'bold 18px "PingFang SC", sans-serif';
    ctx.fillText(pas.name, x + 52, y + 14);
    ctx.fillStyle = 'rgba(255,240,210,0.8)';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText(fitText(ctx, pas.desc, CARD_W - 64), x + 52, y + 40);
    const bw = CARD_W - 24;
    const by = y + ACT_CARD_H - 30;
    roundRect(ctx, x + 12, by, bw, 22, 7);
    const barOk = equipped || (owned ? !pasFull : afford);
    ctx.fillStyle = equipped ? '#2f5a3a' : owned && !pasFull ? '#3a5a4a' : barOk ? '#c8792b' : '#4a3a30';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = equipped || (owned && !pasFull) ? '#9bffb0' : barOk ? '#fff6e6' : '#9a8a7a';
    ctx.font = 'bold 13px "PingFang SC", sans-serif';
    const barText = equipped
      ? '✓ 已装备 · 点击卸下'
      : owned
        ? (pasFull ? '已满，请先卸下' : '已购买 · 点击装备')
        : `购买 · ${pas.cost} 功德`;
    ctx.fillText(barText, x + 12 + bw / 2, by + 11);
  }

  // —— 结束滚动内容 ——
  ctx.restore();

  // —— 固定顶部栏（不随滚动）：不透明色带遮住上滑卡片，再画返回/标题/余额 ——
  ctx.fillStyle = '#2a2140';
  ctx.fillRect(0, 0, VIEW_W, 104);

  // 返回按钮
  roundRect(ctx, BACK.x, BACK.y, BACK.w, BACK.h, 10);
  ctx.fillStyle = '#5a4a7a';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('‹ 返回', BACK.x + BACK.w / 2, BACK.y + BACK.h / 2);

  // 标题 + 功德余额（图标 + 数字）
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 30px "PingFang SC", sans-serif';
  ctx.fillText('神秘商人', VIEW_W / 2, 56);
  const meritLabel = String(merit.merit);
  ctx.font = 'bold 20px "PingFang SC", sans-serif';
  const numW = ctx.measureText(meritLabel).width;
  const iconS = MERIT_ICON_PAGE_DISPLAY;
  const gap = 8;
  const totalW = iconS + gap + numW;
  const left = VIEW_W / 2 - totalW / 2;
  const meritY = 92;
  drawUiIcon(ctx, 'icon-merit', left + iconS / 2, meritY, iconS);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e0c8ff';
  ctx.fillText(meritLabel, left + iconS + gap, meritY);

  // 提示（贴底显示，避免遮住被动技能卡片）
  if (toast) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffd76a';
    ctx.font = '14px "PingFang SC", sans-serif';
    ctx.fillText(toast, VIEW_W / 2, VIEW_H - 8);
  }
}

// ———————————————————————————————————————————————————————————
// 商品详情 / 购买二次确认弹窗
// 交互流程：点击任意商品卡片 → 打开 detail 弹窗（完整使用说明 + 花费）→
// 点「购买」→ 切到 confirm 阶段显示「确认扣除 N 功德」→ 点「确认」才真正扣费。
// ———————————————————————————————————————————————————————————

export type ShopKind = 'buy' | 'buyActive' | 'buyPassive';
export interface ShopPopupState {
  kind: ShopKind;
  id: string;
  phase: 'detail' | 'confirm';
}
// 弹窗点击命中结果：action=点购买(detail→confirm)；confirm=确认扣费；cancel=取消回退；
// close=关闭；outside=点弹窗外空白(关闭)；null=点在弹窗内的非按钮区(吞掉本次点击)
export type ShopPopupHit = 'action' | 'confirm' | 'cancel' | 'close' | 'outside' | null;

// 弹窗几何（屏幕居中，固定尺寸；不随商城滚动）
const PW = 400;
const PH = 300;
const PX = (VIEW_W - PW) / 2;
const PY = (VIEW_H - PH) / 2;
const PAD = 22;
const CLOSE_R = { x: PX + PW - 40, y: PY + 14, w: 26, h: 26 };
const ACTION_R = { x: PX + PAD, y: PY + PH - 62, w: PW - PAD * 2, h: 44 }; // detail 阶段整条购买按钮
const CANCEL_R = { x: PX + PAD, y: PY + PH - 62, w: (PW - PAD * 2 - 12) / 2, h: 44 }; // confirm 阶段左：取消
const CONFIRM_R = { x: PX + PW / 2 + 6, y: PY + PH - 62, w: (PW - PAD * 2 - 12) / 2, h: 44 }; // confirm 阶段右：确认

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// 单行截断到最大宽度，超出用省略号（卡片内简介用；完整说明看详情弹窗）
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

// 按最大宽度做逐字符换行（中英文混排友好），支持显式 \n
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
  return lines;
}

// 汇总某商品的展示信息（名称/图标/色/副标题/使用说明/花费/按钮动作）
interface PopupInfo {
  icon: string; name: string; color: string; sub: string;
  usage: string; cost: number;
  /** buy=购买确认；equip=免费装备；unequip=卸下；none=置灰不可点 */
  actionKind: 'buy' | 'equip' | 'unequip' | 'none';
  actionLabel: string;
}
function popupInfo(kind: ShopKind, id: string, merit: MeritState, loadout: LoadoutState): PopupInfo | null {
  if (kind === 'buy') {
    const up = upgradeById(id);
    if (!up) return null;
    const lv = levelOf(merit, id);
    const maxed = lv >= up.maxLevel;
    const cost = up.cost(lv);
    const usage = maxed
      ? '已达最高等级，无需继续购买。'
      : `永久成长：每局开局自动注入本局，可累计升级。\n下一级效果：${up.desc(lv)}`;
    const can = !maxed && merit.merit >= cost;
    return {
      icon: up.icon, name: up.name, color: RARITY_COLOR[up.rarity],
      sub: `${up.rarity} · Lv.${lv}/${up.maxLevel}`,
      usage, cost,
      actionKind: can ? 'buy' : 'none',
      actionLabel: can ? `购买 · ${cost} 功德` : maxed ? '已满级' : '功德不足',
    };
  }
  if (kind === 'buyActive') {
    const act = activeById(id);
    if (!act) return null;
    const equipped = isEquipped(loadout, id);
    const owned = isOwnedActive(loadout, id);
    const usage = `${act.desc}。\n战斗中点击技能图标手动释放，冷却 ${act.cd}s。当日购买一次后可随时卸下/再装备，最多同时装备 ${MAX_EQUIPPED_ACTIVES} 个。`;
    const down = !!act.disabled;
    const full = loadout.equipped.length >= MAX_EQUIPPED_ACTIVES;
    if (down) {
      return {
        icon: act.icon, name: act.name, color: '#6ab0ff',
        sub: `主动技能 · CD ${act.cd}s`,
        usage, cost: act.cost, actionKind: 'none', actionLabel: '已下架',
      };
    }
    if (equipped) {
      return {
        icon: act.icon, name: act.name, color: '#6ab0ff',
        sub: `主动技能 · CD ${act.cd}s · 已装备`,
        usage, cost: act.cost, actionKind: 'unequip', actionLabel: '卸下',
      };
    }
    if (owned) {
      return {
        icon: act.icon, name: act.name, color: '#6ab0ff',
        sub: `主动技能 · CD ${act.cd}s · 已购买`,
        usage, cost: act.cost,
        actionKind: full ? 'none' : 'equip',
        actionLabel: full ? '请先卸下才能装备' : '装备',
      };
    }
    const canBuy = merit.merit >= act.cost; // 槽满仍可购买（仅拥有、稍后装备）
    return {
      icon: act.icon, name: act.name, color: '#6ab0ff',
      sub: `主动技能 · CD ${act.cd}s`,
      usage, cost: act.cost,
      actionKind: canBuy ? 'buy' : 'none',
      actionLabel: canBuy ? `购买 · ${act.cost} 功德` : '功德不足',
    };
  }
  const pas = passiveById(id);
  if (!pas) return null;
  const equipped = isPassiveEquipped(loadout, id);
  const owned = isOwnedPassive(loadout, id);
  const usage = `${pas.desc}。\n被动技能：开局自动注入本局。当日购买一次后可随时卸下/再装备，最多同时装备 ${MAX_EQUIPPED_PASSIVES} 个。`;
  const down = !!pas.disabled;
  const full = loadout.passives.length >= MAX_EQUIPPED_PASSIVES;
  if (down) {
    return {
      icon: pas.icon, name: pas.name, color: '#7ec46a',
      sub: '被动技能 · 每日生效',
      usage, cost: pas.cost, actionKind: 'none', actionLabel: '已下架',
    };
  }
  if (equipped) {
    return {
      icon: pas.icon, name: pas.name, color: '#7ec46a',
      sub: '被动技能 · 已装备',
      usage, cost: pas.cost, actionKind: 'unequip', actionLabel: '卸下',
    };
  }
  if (owned) {
    return {
      icon: pas.icon, name: pas.name, color: '#7ec46a',
      sub: '被动技能 · 已购买',
      usage, cost: pas.cost,
      actionKind: full ? 'none' : 'equip',
      actionLabel: full ? '请先卸下才能装备' : '装备',
    };
  }
  const canBuy = merit.merit >= pas.cost;
  return {
    icon: pas.icon, name: pas.name, color: '#7ec46a',
    sub: '被动技能 · 每日生效',
    usage, cost: pas.cost,
    actionKind: canBuy ? 'buy' : 'none',
    actionLabel: canBuy ? `购买 · ${pas.cost} 功德` : '功德不足',
  };
}

export function shopPopupHitAt(x: number, y: number, popup: ShopPopupState): ShopPopupHit {
  if (inRect(x, y, CLOSE_R)) return 'close';
  if (popup.phase === 'detail') {
    if (inRect(x, y, ACTION_R)) return 'action';
  } else {
    if (inRect(x, y, CANCEL_R)) return 'cancel';
    if (inRect(x, y, CONFIRM_R)) return 'confirm';
  }
  // 点在弹窗框内的非按钮区：吞掉，不关闭；点框外空白：关闭
  if (x >= PX && x <= PX + PW && y >= PY && y <= PY + PH) return null;
  return 'outside';
}

export function drawShopPopup(
  ctx: CanvasRenderingContext2D,
  popup: ShopPopupState,
  merit: MeritState,
  loadout: LoadoutState,
): void {
  const info = popupInfo(popup.kind, popup.id, merit, loadout);
  if (!info) return;

  // 半透明遮罩（点击框外关闭）
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 弹窗底板
  roundRect(ctx, PX, PY, PW, PH, 14);
  ctx.fillStyle = '#241d38';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = info.color;
  ctx.stroke();

  // 标题：图标 + 名称 + 副标题
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '32px sans-serif';
  ctx.fillText(info.icon, PX + PAD, PY + 20);
  ctx.fillStyle = '#fff6e6';
  ctx.font = 'bold 22px "PingFang SC", sans-serif';
  ctx.fillText(info.name, PX + PAD + 44, PY + 22);
  ctx.fillStyle = info.color;
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillText(info.sub, PX + PAD + 44, PY + 50);

  // 关闭按钮（✕）
  roundRect(ctx, CLOSE_R.x, CLOSE_R.y, CLOSE_R.w, CLOSE_R.h, 7);
  ctx.fillStyle = '#3a3350';
  ctx.fill();
  ctx.fillStyle = '#d8c8f0';
  ctx.font = 'bold 16px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('✕', CLOSE_R.x + CLOSE_R.w / 2, CLOSE_R.y + CLOSE_R.h / 2);

  // 分隔线
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PX + PAD, PY + 76);
  ctx.lineTo(PX + PW - PAD, PY + 76);
  ctx.stroke();

  // 使用说明（换行）
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,240,210,0.9)';
  ctx.font = '15px "PingFang SC", sans-serif';
  const lines = wrapText(ctx, info.usage, PW - PAD * 2);
  let ty = PY + 90;
  for (const ln of lines) { ctx.fillText(ln, PX + PAD, ty); ty += 24; }

  // 花费 + 余额（仅待购买时展示；已购装备/卸下不扣费）
  if (popup.phase === 'detail' && info.actionKind === 'buy') {
    ctx.fillStyle = '#ffd76a';
    ctx.font = 'bold 15px "PingFang SC", sans-serif';
    ctx.fillText(`花费 ${info.cost} 功德`, PX + PAD, PY + PH - 96);
    ctx.fillStyle = 'rgba(224,200,255,0.85)';
    ctx.font = '13px "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`余额 ${merit.merit}`, PX + PW - PAD, PY + PH - 94);
  } else if (popup.phase === 'detail' && (info.actionKind === 'equip' || info.actionKind === 'unequip')) {
    ctx.fillStyle = 'rgba(224,200,255,0.85)';
    ctx.font = '13px "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(info.actionKind === 'equip' ? '今日已购买，装备不额外扣费' : '卸下后今日仍可再装备', PX + PAD, PY + PH - 96);
  }

  // 底部动作区
  if (popup.phase === 'detail') {
    // 购买 / 装备 / 卸下 / 置灰原因
    roundRect(ctx, ACTION_R.x, ACTION_R.y, ACTION_R.w, ACTION_R.h, 10);
    const interactive = info.actionKind === 'buy' || info.actionKind === 'equip' || info.actionKind === 'unequip';
    ctx.fillStyle = info.actionKind === 'unequip'
      ? '#5a3a2a'
      : info.actionKind === 'equip'
        ? '#3a5a7a'
        : interactive ? '#c8792b' : '#4a3a30';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = interactive ? '#fff6e6' : '#9a8a7a';
    const long = info.actionLabel.length > 14;
    ctx.font = `bold ${long ? 13 : 17}px "PingFang SC", sans-serif`;
    ctx.fillText(info.actionLabel, ACTION_R.x + ACTION_R.w / 2, ACTION_R.y + ACTION_R.h / 2);
  } else {
    // 确认阶段：问句（含花费与余额）+ 取消/确认
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff6e6';
    ctx.font = '15px "PingFang SC", sans-serif';
    ctx.fillText(`确认扣除 ${info.cost} 功德购买「${info.name}」？`, VIEW_W / 2, PY + PH - 92);
    ctx.fillStyle = 'rgba(224,200,255,0.8)';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText(`余额 ${merit.merit} → ${merit.merit - info.cost}`, VIEW_W / 2, PY + PH - 72);
    // 取消
    roundRect(ctx, CANCEL_R.x, CANCEL_R.y, CANCEL_R.w, CANCEL_R.h, 10);
    ctx.fillStyle = '#4a4460';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e0d8f0';
    ctx.font = 'bold 16px "PingFang SC", sans-serif';
    ctx.fillText('取消', CANCEL_R.x + CANCEL_R.w / 2, CANCEL_R.y + CANCEL_R.h / 2);
    // 确认
    roundRect(ctx, CONFIRM_R.x, CONFIRM_R.y, CONFIRM_R.w, CONFIRM_R.h, 10);
    ctx.fillStyle = '#c8792b';
    ctx.fill();
    ctx.fillStyle = '#fff6e6';
    ctx.font = 'bold 16px "PingFang SC", sans-serif';
    ctx.fillText('确认扣费', CONFIRM_R.x + CONFIRM_R.w / 2, CONFIRM_R.y + CONFIRM_R.h / 2);
  }
}
