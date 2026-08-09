// 神秘商人：每局战斗结算回到首页后自动弹出一次（水墨卷轴弹窗），关闭后无入口直至下局结束。
import { VIEW_W, VIEW_H } from './render';
import {
  roundRect,
  drawInkPopupFrame,
  drawInkActionButton,
  drawInkResourceBar,
  inkPopupCloseRect,
} from './menu-ui';
import { activeById, enabledActives, MAX_EQUIPPED_ACTIVES } from './actives';
import { passiveById, enabledPassives, MAX_EQUIPPED_PASSIVES } from './passives';
import {
  buyActive,
  buyPassive,
  equipActive,
  equipPassive,
  grantActive,
  grantPassive,
  isOwnedActive,
  isOwnedPassive,
  unequipActive,
  unequipPassive,
  type LoadoutState,
} from './loadout';
import type { MeritState } from './merit';
import { spendMerit } from './merit';

export type SkillKind = 'active' | 'passive';

export interface MerchantOffer {
  kind: SkillKind;
  id: string;
  /** 今日已购买、当前未装备 → 展示「装备」免费按钮 */
  owned: boolean;
}

export interface MerchantUiState {
  open: boolean;
  tab: 'shop' | 'lottery';
  offers: MerchantOffer[];
  lotteryPreview: Array<{ kind: SkillKind; id: string }>;
  toast: string;
}

export const LOTTERY_MERIT_COST = 45;
export const MERCHANT_OFFER_COUNT = 3;

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

/** 在限定宽度内折行，末行过长则省略号截断 */
function fitTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines: number,
): string[] {
  if (maxLines <= 1) return [fitText(ctx, text, maxW)];
  const lines: string[] = [];
  let rest = text;
  for (let n = 0; n < maxLines && rest.length > 0; n++) {
    if (n === maxLines - 1) {
      lines.push(fitText(ctx, rest, maxW));
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

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

type SkillRef = { kind: SkillKind; id: string };

function allSkills(): SkillRef[] {
  const out: SkillRef[] = [];
  for (const a of enabledActives()) out.push({ kind: 'active', id: a.id });
  for (const p of enabledPassives()) out.push({ kind: 'passive', id: p.id });
  return out;
}

function isEquipped(loadout: LoadoutState, ref: SkillRef): boolean {
  return ref.kind === 'active'
    ? loadout.equipped.includes(ref.id)
    : loadout.passives.includes(ref.id);
}

/** 随机池：排除当前已装备；已拥有未装备可再次出现 */
export function rollMerchantOffers(loadout: LoadoutState): MerchantOffer[] {
  const pool = allSkills().filter((s) => !isEquipped(loadout, s));
  const picked = shuffle(pool).slice(0, MERCHANT_OFFER_COUNT);
  return picked.map((s) => ({
    kind: s.kind,
    id: s.id,
    owned: s.kind === 'active' ? isOwnedActive(loadout, s.id) : isOwnedPassive(loadout, s.id),
  }));
}

export function rollLotteryPreview(): Array<{ kind: SkillKind; id: string }> {
  return shuffle(allSkills()).slice(0, 8);
}

export function merchantClosed(): MerchantUiState {
  return { open: false, tab: 'shop', offers: [], lotteryPreview: [], toast: '' };
}

/** 战斗结算回首页时调用：弹出并重 roll 商品 */
export function openMerchant(loadout: LoadoutState): MerchantUiState {
  return {
    open: true,
    tab: 'shop',
    offers: rollMerchantOffers(loadout),
    lotteryPreview: rollLotteryPreview(),
    toast: '',
  };
}

export function closeMerchant(m: MerchantUiState): MerchantUiState {
  return { ...m, open: false, toast: '' };
}

function skillCost(kind: SkillKind, id: string): number {
  const def = kind === 'active' ? activeById(id) : passiveById(id);
  return def?.cost ?? 0;
}

function pickLotterySkill(loadout: LoadoutState): SkillRef | null {
  const pool = allSkills().filter((s) => !isEquipped(loadout, s));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export interface MerchantActionResult {
  merchant: MerchantUiState;
  loadout: LoadoutState;
  merit: MeritState;
}

export function applyMerchantHit(
  hit: Exclude<MerchantHit, null>,
  merchant: MerchantUiState,
  loadout: LoadoutState,
  merit: MeritState,
): MerchantActionResult {
  let m = merchant;
  let lo = loadout;
  let me = merit;

  switch (hit.kind) {
    case 'close':
    case 'continue':
      return { merchant: closeMerchant(m), loadout: lo, merit: me };
    case 'tab':
      return { merchant: { ...m, tab: hit.tab, toast: '' }, loadout: lo, merit: me };
    case 'unequipActive':
      lo = unequipActive(lo, hit.id);
      m = { ...m, offers: rollMerchantOffers(lo), toast: '已卸下' };
      return { merchant: m, loadout: lo, merit: me };
    case 'unequipPassive':
      lo = unequipPassive(lo, hit.id);
      m = { ...m, offers: rollMerchantOffers(lo), toast: '已卸下' };
      return { merchant: m, loadout: lo, merit: me };
    case 'offer': {
      const offer = m.offers[hit.index];
      if (!offer) return { merchant: m, loadout: lo, merit: me };
      if (offer.owned) {
        const res = offer.kind === 'active' ? equipActive(lo, offer.id) : equipPassive(lo, offer.id);
        lo = res.loadout;
        m = {
          ...m,
          offers: rollMerchantOffers(lo),
          toast: res.ok ? '已装备' : res.reason ?? '无法装备',
        };
      } else if (offer.kind === 'active') {
        const res = buyActive(lo, me, offer.id);
        lo = res.loadout;
        me = res.merit;
        m = {
          ...m,
          offers: rollMerchantOffers(lo),
          toast: res.ok
            ? (lo.equipped.includes(offer.id) ? '已购买并装备' : '已购买（槽满，卸下后可装备）')
            : res.reason ?? '无法购买',
        };
      } else {
        const res = buyPassive(lo, me, offer.id);
        lo = res.loadout;
        me = res.merit;
        m = {
          ...m,
          offers: rollMerchantOffers(lo),
          toast: res.ok
            ? (lo.passives.includes(offer.id) ? '已购买并装备' : '已购买（槽满，卸下后可装备）')
            : res.reason ?? '无法购买',
        };
      }
      return { merchant: m, loadout: lo, merit: me };
    }
    case 'lottery':
      return merchantLottery(m, lo, me);
    default: {
      const _exhaustive: never = hit;
      return _exhaustive;
    }
  }
}

/** 抽奖：扣固定功德，随机未装备技能；未拥有则 grant+装备，已拥有则免费装备 */
function merchantLottery(
  merchant: MerchantUiState,
  loadout: LoadoutState,
  merit: MeritState,
): MerchantActionResult {
  if (merit.merit < LOTTERY_MERIT_COST) {
    return { merchant: { ...merchant, toast: '功德不足' }, loadout, merit };
  }
  const pick = pickLotterySkill(loadout);
  if (!pick) {
    return { merchant: { ...merchant, toast: '无可抽技能' }, loadout, merit };
  }
  const name = (pick.kind === 'active' ? activeById(pick.id) : passiveById(pick.id))?.name ?? pick.id;
  let lo = loadout;
  let me = spendMerit(merit, LOTTERY_MERIT_COST);

  if (pick.kind === 'active') {
    if (isOwnedActive(lo, pick.id)) {
      const res = equipActive(lo, pick.id);
      lo = res.loadout;
    } else {
      lo = grantActive(lo, pick.id);
    }
    const equipped = lo.equipped.includes(pick.id);
    return {
      merchant: {
        ...merchant,
        offers: rollMerchantOffers(lo),
        lotteryPreview: rollLotteryPreview(),
        toast: equipped ? `抽中「${name}」并已装备` : `抽中「${name}」（请先卸下腾位）`,
      },
      loadout: lo,
      merit: me,
    };
  }

  if (isOwnedPassive(lo, pick.id)) {
    const res = equipPassive(lo, pick.id);
    lo = res.loadout;
    const equipped = lo.passives.includes(pick.id);
    return {
      merchant: {
        ...merchant,
        offers: rollMerchantOffers(lo),
        lotteryPreview: rollLotteryPreview(),
        toast: equipped ? `抽中「${name}」并已装备` : res.reason ?? '槽位已满',
      },
      loadout: lo,
      merit: me,
    };
  }
  lo = grantPassive(lo, pick.id);
  const equipped = lo.passives.includes(pick.id);
  return {
    merchant: {
      ...merchant,
      offers: rollMerchantOffers(lo),
      lotteryPreview: rollLotteryPreview(),
      toast: equipped ? `抽中「${name}」并已装备` : `抽中「${name}」（请先卸下腾位）`,
    },
    loadout: lo,
    merit: me,
  };
}

export function applyMerchantHitFull(
  hit: Exclude<MerchantHit, null>,
  merchant: MerchantUiState,
  loadout: LoadoutState,
  merit: MeritState,
): MerchantActionResult {
  return applyMerchantHit(hit, merchant, loadout, merit);
}

/** 技能稀有度（水墨低饱和，仍可读） */
export function skillRarityColor(cost: number): { label: string; color: string; ink: string } {
  if (cost >= 75) return { label: '传说', color: '#a87838', ink: 'rgba(168,120,56,0.35)' };
  if (cost >= 65) return { label: '史诗', color: '#7a5888', ink: 'rgba(122,88,136,0.32)' };
  if (cost >= 55) return { label: '精良', color: '#5a7088', ink: 'rgba(90,112,136,0.3)' };
  return { label: '稀有', color: '#6a8050', ink: 'rgba(106,128,80,0.3)' };
}

// —— 弹窗几何（与 menu-popups 同套 drawInkPopupFrame） —— //
const PW = 504;
const PH = 868;
const PX = (VIEW_W - PW) / 2;
const PY = (VIEW_H - PH) / 2 - 8;
const CLOSE_R = inkPopupCloseRect(PX, PY);
const BODY = PY + 58;
const TAB_SHOP = { x: PX + 18, y: BODY + 6, w: 228, h: 34 };
const TAB_LOTTERY = { x: PX + 258, y: BODY + 6, w: 228, h: 34 };
const MERIT_BAR = { x: PX + 18, y: BODY + 48, w: 148, h: 26 };
const CONTENT_TOP = BODY + 92;
const CONTINUE_H = 40;
const CONTINUE_PAD = 14;
const CONTINUE_R = { x: PX + 32, y: PY + PH - CONTINUE_H - CONTINUE_PAD, w: PW - 64, h: CONTINUE_H };
const EQUIP_PANEL_SIDE = 14;
const EQUIP_LABEL_COL = 34;
const EQUIP_GRID_X0 = PX + EQUIP_PANEL_SIDE + EQUIP_LABEL_COL;
const EQUIP_HEADER_H = 42;
const ACT_SLOT = 52;
const PAS_SLOT = 44;
const EQUIP_ROW_GAP = 14;
const EQUIP_PANEL_H = EQUIP_HEADER_H + ACT_SLOT + EQUIP_ROW_GAP + PAS_SLOT + 12;
const EQUIP_TOP = CONTINUE_R.y - 32 - EQUIP_PANEL_H;
const ACT_ROW_Y = EQUIP_TOP + EQUIP_HEADER_H;
const PAS_ROW_Y = ACT_ROW_Y + ACT_SLOT + EQUIP_ROW_GAP;

const CONTENT_H = EQUIP_TOP - CONTENT_TOP - 12;

const OFFER_H = 124;
const OFFER_GAP = 6;
const OFFER_BTN_W = 88;
const OFFER_BTN_H = 34;
const OFFER_TEXT_X = 68;
function offerRect(i: number): { x: number; y: number; w: number; h: number } {
  return { x: PX + 16, y: CONTENT_TOP + i * (OFFER_H + OFFER_GAP), w: PW - 32, h: OFFER_H };
}

const LOT_CELL = 88;
const LOT_GAP = 8;
const LOT_GRID_W = LOT_CELL * 3 + LOT_GAP * 2;
const LOT_OX = PX + (PW - LOT_GRID_W) / 2;
const LOT_OY = CONTENT_TOP + 24;
function lotCellRect(row: number, col: number): { x: number; y: number; w: number; h: number } {
  return {
    x: LOT_OX + col * (LOT_CELL + LOT_GAP),
    y: LOT_OY + row * (LOT_CELL + LOT_GAP),
    w: LOT_CELL,
    h: LOT_CELL,
  };
}
const LOTTERY_BTN = lotCellRect(1, 1);

function lotPreviewIndex(row: number, col: number): number | null {
  if (row === 1 && col === 1) return null;
  if (row === 0) return col;
  if (row === 1) return col === 0 ? 3 : 4;
  return 5 + col;
}

type EquipSlotRect = { x: number; y: number; w: number; h: number; id: string | null };

function equipGridStartX(slotCount: number, slotW: number, pitch: number): number {
  const gridW = slotCount * pitch - (pitch - slotW);
  const avail = PW - EQUIP_PANEL_SIDE * 2 - EQUIP_LABEL_COL;
  return EQUIP_GRID_X0 + Math.max(0, (avail - gridW) / 2);
}

function activeSlotRects(loadout: LoadoutState): EquipSlotRect[] {
  const pitch = ACT_SLOT + 10;
  const startX = equipGridStartX(MAX_EQUIPPED_ACTIVES, ACT_SLOT, pitch);
  return Array.from({ length: MAX_EQUIPPED_ACTIVES }, (_, i) => ({
    x: startX + i * pitch,
    y: ACT_ROW_Y,
    w: ACT_SLOT,
    h: ACT_SLOT,
    id: loadout.equipped[i] ?? null,
  }));
}

function passiveSlotRects(loadout: LoadoutState): EquipSlotRect[] {
  const pitch = PAS_SLOT + 6;
  const startX = equipGridStartX(MAX_EQUIPPED_PASSIVES, PAS_SLOT, pitch);
  return Array.from({ length: MAX_EQUIPPED_PASSIVES }, (_, i) => ({
    x: startX + i * pitch,
    y: PAS_ROW_Y,
    w: PAS_SLOT,
    h: PAS_SLOT,
    id: loadout.passives[i] ?? null,
  }));
}

function unequipBtnRect(slot: { x: number; y: number; w: number; h: number }) {
  return { x: slot.x + slot.w - 15, y: slot.y + 3, w: 15, h: 15 };
}

function drawEmptyEquipSlot(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  radius: number,
  stroke: string,
): void {
  roundRect(ctx, r.x, r.y, r.w, r.h, radius);
  ctx.fillStyle = 'rgba(48,28,12,0.22)';
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawFilledEquipSlot(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  icon: string,
  radius: number,
  stroke: string,
): void {
  roundRect(ctx, r.x, r.y, r.w, r.h, radius);
  ctx.fillStyle = 'rgba(48,28,12,0.55)';
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#fff4e0';
  ctx.font = `${Math.round(r.w * 0.48)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, r.x + r.w / 2, r.y + r.h / 2);
  drawUnequipX(ctx, unequipBtnRect(r));
}

export type MerchantHit =
  | { kind: 'close' }
  | { kind: 'tab'; tab: 'shop' | 'lottery' }
  | { kind: 'offer'; index: number }
  | { kind: 'lottery' }
  | { kind: 'unequipActive'; id: string }
  | { kind: 'unequipPassive'; id: string }
  | { kind: 'continue' }
  | null;

export function merchantHitAt(x: number, y: number, m: MerchantUiState, loadout: LoadoutState): MerchantHit {
  if (!m.open) return null;
  if (inRect(x, y, CLOSE_R)) return { kind: 'close' };
  if (inRect(x, y, TAB_SHOP)) return { kind: 'tab', tab: 'shop' };
  if (inRect(x, y, TAB_LOTTERY)) return { kind: 'tab', tab: 'lottery' };
  if (inRect(x, y, CONTINUE_R)) return { kind: 'continue' };

  for (const r of activeSlotRects(loadout)) {
    if (r.id && inRect(x, y, unequipBtnRect(r))) return { kind: 'unequipActive', id: r.id };
  }
  for (const r of passiveSlotRects(loadout)) {
    if (r.id && inRect(x, y, unequipBtnRect(r))) return { kind: 'unequipPassive', id: r.id };
  }

  if (m.tab === 'shop') {
    for (let i = 0; i < m.offers.length; i++) {
      if (inRect(x, y, offerRect(i))) return { kind: 'offer', index: i };
    }
  } else if (inRect(x, y, LOTTERY_BTN)) {
    return { kind: 'lottery' };
  }

  // 面板内非按钮区吞掉；遮罩空白不关闭（须点 × 或「关闭」）
  if (x >= PX && x <= PX + PW && y >= PY && y <= PY + PH) return null;
  return null;
}

function drawInkTab(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  label: string,
  active: boolean,
): void {
  drawInkActionButton(ctx, rect, label, false, active ? 'primary' : 'secondary');
}

function drawOfferCard(
  ctx: CanvasRenderingContext2D,
  m: MerchantUiState,
  merit: MeritState,
  index: number,
): void {
  const offer = m.offers[index];
  if (!offer) return;
  const r = offerRect(index);
  const def = offer.kind === 'active' ? activeById(offer.id) : passiveById(offer.id);
  if (!def) return;
  const rarity = skillRarityColor(def.cost);
  const cost = skillCost(offer.kind, offer.id);
  const canAfford = merit.merit >= cost;

  roundRect(ctx, r.x, r.y, r.w, r.h, 10);
  const card = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
  card.addColorStop(0, 'rgba(248,236,210,0.95)');
  card.addColorStop(1, 'rgba(228,205,168,0.92)');
  ctx.fillStyle = card;
  ctx.fill();
  ctx.strokeStyle = rarity.color;
  ctx.lineWidth = 2;
  ctx.stroke();
  roundRect(ctx, r.x + 4, r.y + 4, r.w - 8, r.h - 8, 8);
  ctx.fillStyle = rarity.ink;
  ctx.fill();

  ctx.fillStyle = rarity.color;
  ctx.font = 'bold 11px "PingFang SC", "STKaiti", serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(rarity.label, r.x + 12, r.y + 10);

  const iconR = 22;
  const iconCx = r.x + 36;
  const iconCy = r.y + r.h / 2;
  ctx.beginPath();
  ctx.arc(iconCx, iconCy, iconR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(48,28,12,0.12)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,60,30,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#3a2208';
  ctx.font = '26px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(def.icon, iconCx, iconCy);

  const bx = r.x + r.w - OFFER_BTN_W - 10;
  const by = r.y + (r.h - OFFER_BTN_H) / 2;
  const textMaxW = bx - (r.x + OFFER_TEXT_X) - 10;
  const desc = offer.kind === 'active'
    ? `${def.desc} · CD${activeById(offer.id)!.cd}s`
    : def.desc;
  const descLines = fitTextLines(ctx, desc, textMaxW, 2);
  const nameH = 18;
  const descBlockH = descLines.length * 16;
  const textBlockH = nameH + 4 + descBlockH;
  const textY = r.y + Math.max(26, (r.h - textBlockH) / 2);

  ctx.fillStyle = '#4a2808';
  ctx.font = 'bold 16px "PingFang SC", "STKaiti", serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(def.name, r.x + OFFER_TEXT_X, textY);
  ctx.fillStyle = 'rgba(70,45,15,0.82)';
  ctx.font = '12px "PingFang SC", serif';
  for (let li = 0; li < descLines.length; li++) {
    ctx.fillText(descLines[li]!, r.x + OFFER_TEXT_X, textY + nameH + 4 + li * 16);
  }

  if (offer.owned) {
    drawInkActionButton(ctx, { x: bx, y: by, w: OFFER_BTN_W, h: OFFER_BTN_H }, '装备', false, 'accent');
  } else {
    drawInkActionButton(
      ctx,
      { x: bx, y: by, w: OFFER_BTN_W, h: OFFER_BTN_H },
      `${cost} 功德`,
      false,
      canAfford ? 'primary' : 'secondary',
    );
  }
}

function drawLotteryGrid(ctx: CanvasRenderingContext2D, m: MerchantUiState): void {
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cell = lotCellRect(row, col);
      const isCenter = row === 1 && col === 1;
      if (isCenter) {
        drawInkActionButton(ctx, cell, `抽奖\n${LOTTERY_MERIT_COST} 功德`, false, 'primary');
        continue;
      }
      const idx = lotPreviewIndex(row, col);
      const preview = idx !== null ? m.lotteryPreview[idx] : undefined;
      roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 8);
      ctx.fillStyle = 'rgba(248,236,210,0.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,60,30,0.42)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (preview) {
        const def = preview.kind === 'active' ? activeById(preview.id) : passiveById(preview.id);
        if (def) {
          ctx.font = '26px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#000';
          ctx.fillText(def.icon, cell.x + cell.w / 2, cell.y + cell.h / 2 - 10);
          ctx.fillStyle = '#4a2808';
          ctx.font = 'bold 11px "PingFang SC", "STKaiti", serif';
          ctx.textBaseline = 'bottom';
          ctx.fillText(fitText(ctx, def.name, cell.w - 10), cell.x + cell.w / 2, cell.y + cell.h - 8);
        }
      }
    }
  }
  const legends = [
    { label: '稀有', color: '#6a8050' },
    { label: '精良', color: '#5a7088' },
    { label: '史诗', color: '#7a5888' },
    { label: '传说', color: '#a87838' },
  ];
  const ly = CONTENT_TOP + CONTENT_H - 24;
  const pitch = 112;
  const lx0 = PX + (PW - legends.length * pitch) / 2 + 16;
  ctx.font = '12px "PingFang SC", serif';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < legends.length; i++) {
    const lg = legends[i]!;
    roundRect(ctx, lx0 + i * pitch, ly - 7, 14, 14, 3);
    ctx.fillStyle = lg.color;
    ctx.fill();
    ctx.fillStyle = '#5a3a12';
    ctx.textAlign = 'left';
    ctx.fillText(lg.label, lx0 + i * pitch + 20, ly);
  }
}

function drawEquipRowLabel(
  ctx: CanvasRenderingContext2D,
  rowY: number,
  rowH: number,
  chars: [string, string],
  count: number,
  max: number,
): void {
  const cx = PX + EQUIP_PANEL_SIDE + EQUIP_LABEL_COL / 2;
  const cy = rowY + rowH / 2;
  const lines = [chars[0], chars[1], `${count}/${max}`];
  const lineStep = 13;
  const blockTop = cy - ((lines.length - 1) * lineStep) / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,240,210,0.85)';
  ctx.font = '12px "PingFang SC", serif';
  ctx.fillText(lines[0]!, cx, blockTop);
  ctx.fillText(lines[1]!, cx, blockTop + lineStep);
  ctx.font = '10px "PingFang SC", serif';
  ctx.fillStyle = 'rgba(255,240,210,0.55)';
  ctx.fillText(lines[2]!, cx, blockTop + lineStep * 2);
  ctx.restore();
}

function drawEquippedSection(ctx: CanvasRenderingContext2D, loadout: LoadoutState): void {
  roundRect(ctx, PX + EQUIP_PANEL_SIDE, EQUIP_TOP, PW - EQUIP_PANEL_SIDE * 2, EQUIP_PANEL_H, 10);
  const panel = ctx.createLinearGradient(PX, EQUIP_TOP, PX, EQUIP_TOP + EQUIP_PANEL_H);
  panel.addColorStop(0, 'rgba(55,32,14,0.38)');
  panel.addColorStop(1, 'rgba(45,28,12,0.48)');
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,160,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const actSlots = activeSlotRects(loadout);
  const pasSlots = passiveSlotRects(loadout);
  const titleX = PX + EQUIP_PANEL_SIDE + 6;

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff4e0';
  ctx.font = 'bold 15px "PingFang SC", "STKaiti", serif';
  ctx.fillText('我的道具', titleX, EQUIP_TOP + 8);
  ctx.font = '11px "PingFang SC", serif';
  ctx.fillStyle = 'rgba(255,240,210,0.6)';
  ctx.fillText('道具仅当天有效 · 点击 × 卸下', titleX, EQUIP_TOP + 26);

  drawEquipRowLabel(ctx, ACT_ROW_Y, ACT_SLOT, ['主', '动'], loadout.equipped.length, MAX_EQUIPPED_ACTIVES);
  drawEquipRowLabel(ctx, PAS_ROW_Y, PAS_SLOT, ['被', '动'], loadout.passives.length, MAX_EQUIPPED_PASSIVES);

  for (const r of actSlots) {
    if (r.id) {
      drawFilledEquipSlot(ctx, r, activeById(r.id)?.icon ?? '?', 8, '#5a7088');
    } else {
      drawEmptyEquipSlot(ctx, r, 8, 'rgba(90,112,136,0.55)');
    }
  }

  for (const r of pasSlots) {
    if (r.id) {
      drawFilledEquipSlot(ctx, r, passiveById(r.id)?.icon ?? '?', 7, '#6a8050');
    } else {
      drawEmptyEquipSlot(ctx, r, 7, 'rgba(106,128,80,0.55)');
    }
  }
}

function drawUnequipX(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }): void {
  roundRect(ctx, r.x, r.y, r.w, r.h, 4);
  ctx.fillStyle = 'rgba(48,28,12,0.65)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,160,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#ffe8c0';
  ctx.font = 'bold 11px "PingFang SC", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('×', r.x + r.w / 2, r.y + r.h / 2);
}

/** 水墨卷轴弹窗（叠在首页之上） */
export function drawMerchant(
  ctx: CanvasRenderingContext2D,
  m: MerchantUiState,
  loadout: LoadoutState,
  merit: MeritState,
): void {
  if (!m.open) return;

  drawInkPopupFrame(ctx, PX, PY, PW, PH, '神秘商人', CLOSE_R);

  drawInkTab(ctx, TAB_SHOP, '商店', m.tab === 'shop');
  drawInkTab(ctx, TAB_LOTTERY, '抽奖', m.tab === 'lottery');

  drawInkResourceBar(ctx, MERIT_BAR, '功德', String(merit.merit));

  if (m.tab === 'shop') {
    for (let i = 0; i < m.offers.length; i++) drawOfferCard(ctx, m, merit, i);
  } else {
    drawLotteryGrid(ctx, m);
  }

  drawEquippedSection(ctx, loadout);
  drawInkActionButton(ctx, CONTINUE_R, '关闭', false, 'secondary');

  if (m.toast) {
    ctx.fillStyle = '#8a3010';
    ctx.font = '14px "PingFang SC", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(m.toast, VIEW_W / 2, PY + PH + 14);
  }
}
