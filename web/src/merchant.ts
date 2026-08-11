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
  isEquipped as isActiveEquipped,
  isOwnedActive,
  isOwnedPassive,
  isPassiveEquipped,
  unequipActive,
  unequipPassive,
  ACTIVE_FULL_HINT,
  PASSIVE_FULL_HINT,
  type LoadoutState,
} from './loadout';
import type { MeritState } from './merit';
import { spendMerit } from './merit';
import { clearMerchantFloatToasts, pushMerchantFloatToast } from './merchant-toast';
import { drawSkillGlyph } from './skill-icon';

export type SkillKind = 'active' | 'passive';

export interface MerchantOffer {
  kind: SkillKind;
  id: string;
  /** 今日已购买 → 展示「装备」/「卸下」免费按钮 */
  owned: boolean;
}

export interface MerchantUiState {
  open: boolean;
  tab: 'shop' | 'lottery';
  offers: MerchantOffer[];
  lotteryPreview: Array<{ kind: SkillKind; id: string }>;
  toast: string;
  /** 商店 Tab 购买二次确认：待确认的商品下标 */
  confirmOffer: number | null;
  /** 卸下二次确认：待确认卸下的技能（卸下后需等该道具重新刷出才能再装备，故需二次确认） */
  confirmUnequip: { kind: SkillKind; id: string } | null;
  /** 技能详情弹窗：点击已装配技能或抽奖预览道具时展示描述 + 当前功德 */
  skillInfo: { kind: SkillKind; id: string } | null;
  /** 首页隐藏入口：展示全部技能并可滚动切换 */
  testMode: boolean;
  scrollY: number;
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

function buildTestOffers(): MerchantOffer[] {
  return allSkills().map((s) => ({ kind: s.kind, id: s.id, owned: true }));
}

type SkillRef = { kind: SkillKind; id: string };

function allSkills(): SkillRef[] {
  const out: SkillRef[] = [];
  for (const a of enabledActives()) out.push({ kind: 'active', id: a.id });
  for (const p of enabledPassives()) out.push({ kind: 'passive', id: p.id });
  return out;
}

function isSkillRefEquipped(loadout: LoadoutState, ref: SkillRef): boolean {
  return ref.kind === 'active'
    ? loadout.equipped.includes(ref.id)
    : loadout.passives.includes(ref.id);
}

function isKindSlotsFull(loadout: LoadoutState, kind: SkillKind): boolean {
  return kind === 'active'
    ? loadout.equipped.length >= MAX_EQUIPPED_ACTIVES
    : loadout.passives.length >= MAX_EQUIPPED_PASSIVES;
}

function slotFullHint(kind: SkillKind): string {
  return kind === 'active' ? ACTIVE_FULL_HINT : PASSIVE_FULL_HINT;
}

/** 随机池：排除当前已装备；已拥有未装备可再次出现 */
export function rollMerchantOffers(loadout: LoadoutState): MerchantOffer[] {
  const pool = allSkills().filter((s) => !isSkillRefEquipped(loadout, s));
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

function withToast(m: MerchantUiState, text: string): MerchantUiState {
  if (text) pushMerchantFloatToast(text);
  return { ...m, toast: '' };
}

export function merchantClosed(): MerchantUiState {
  return {
    open: false,
    tab: 'shop',
    offers: [],
    lotteryPreview: [],
    toast: '',
    confirmOffer: null,
    confirmUnequip: null,
    skillInfo: null,
    testMode: false,
    scrollY: 0,
  };
}

/** 战斗结算回首页时调用：弹出并重 roll 商品 */
export function openMerchant(loadout: LoadoutState): MerchantUiState {
  clearMerchantFloatToasts();
  return {
    open: true,
    tab: 'shop',
    offers: rollMerchantOffers(loadout),
    lotteryPreview: rollLotteryPreview(),
    toast: '',
    confirmOffer: null,
    confirmUnequip: null,
    skillInfo: null,
    testMode: false,
    scrollY: 0,
  };
}

/** 首页隐藏测试入口：全部技能列表 + 滚动 */
export function openMerchantTest(loadout: LoadoutState): MerchantUiState {
  clearMerchantFloatToasts();
  return {
    open: true,
    tab: 'shop',
    offers: buildTestOffers(),
    lotteryPreview: rollLotteryPreview(),
    toast: '',
    confirmOffer: null,
    confirmUnequip: null,
    skillInfo: null,
    testMode: true,
    scrollY: 0,
  };
}

export function closeMerchant(m: MerchantUiState): MerchantUiState {
  clearMerchantFloatToasts();
  return { ...m, open: false, toast: '', confirmOffer: null, confirmUnequip: null, skillInfo: null };
}

function updateOfferOwned(offers: MerchantOffer[], index: number, owned: boolean): MerchantOffer[] {
  return offers.map((o, i) => (i === index ? { ...o, owned } : o));
}

function skillCost(kind: SkillKind, id: string): number {
  const def = kind === 'active' ? activeById(id) : passiveById(id);
  return def?.cost ?? 0;
}

function pickLotterySkill(loadout: LoadoutState): SkillRef | null {
  const pool = allSkills().filter((s) => !isSkillRefEquipped(loadout, s));
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
      return { merchant: { ...m, tab: hit.tab, toast: '', confirmOffer: null }, loadout: lo, merit: me };
    case 'cancelOfferBuy':
      return { merchant: { ...m, confirmOffer: null, toast: '' }, loadout: lo, merit: me };
    case 'confirmOfferBuy': {
      const idx = m.confirmOffer;
      if (idx === null) return { merchant: m, loadout: lo, merit: me };
      const offer = m.offers[idx];
      if (!offer || offer.owned) {
        return { merchant: { ...m, confirmOffer: null }, loadout: lo, merit: me };
      }
      if (isKindSlotsFull(lo, offer.kind)) {
        return {
          merchant: { ...withToast(m, slotFullHint(offer.kind)), confirmOffer: null },
          loadout: lo,
          merit: me,
        };
      }
      if (offer.kind === 'active') {
        const res = buyActive(lo, me, offer.id);
        lo = res.loadout;
        me = res.merit;
        m = {
          ...withToast(
            m,
            res.ok
              ? (lo.equipped.includes(offer.id) ? '已购买并装备' : '已购买（槽满，卸下后可装备）')
              : res.reason ?? '无法购买',
          ),
          confirmOffer: null,
          offers: res.ok ? updateOfferOwned(m.offers, idx, true) : m.offers,
        };
      } else {
        const res = buyPassive(lo, me, offer.id);
        lo = res.loadout;
        me = res.merit;
        m = {
          ...withToast(
            m,
            res.ok
              ? (lo.passives.includes(offer.id) ? '已购买并装备' : '已购买（槽满，卸下后可装备）')
              : res.reason ?? '无法购买',
          ),
          confirmOffer: null,
          offers: res.ok ? updateOfferOwned(m.offers, idx, true) : m.offers,
        };
      }
      return { merchant: m, loadout: lo, merit: me };
    }
    case 'unequipActive':
      return { merchant: { ...m, confirmUnequip: { kind: 'active', id: hit.id }, toast: '' }, loadout: lo, merit: me };
    case 'unequipPassive':
      return { merchant: { ...m, confirmUnequip: { kind: 'passive', id: hit.id }, toast: '' }, loadout: lo, merit: me };
    case 'confirmUnequip': {
      const req = m.confirmUnequip;
      if (!req) return { merchant: m, loadout: lo, merit: me };
      lo = req.kind === 'active' ? unequipActive(lo, req.id) : unequipPassive(lo, req.id);
      m = withToast({ ...m, confirmUnequip: null }, '已卸下');
      return { merchant: m, loadout: lo, merit: me };
    }
    case 'cancelUnequip':
      return { merchant: { ...m, confirmUnequip: null }, loadout: lo, merit: me };
    case 'skillInfo':
      return { merchant: { ...m, skillInfo: { kind: hit.skillKind, id: hit.id } }, loadout: lo, merit: me };
    case 'closeSkillInfo':
      return { merchant: { ...m, skillInfo: null }, loadout: lo, merit: me };
    case 'offer': {
      const offer = m.offers[hit.index];
      if (!offer) return { merchant: m, loadout: lo, merit: me };
      let justGranted = false;
      if (m.testMode) {
        if (offer.kind === 'active' && !isOwnedActive(lo, offer.id)) {
          lo = grantActive(lo, offer.id);
          justGranted = true;
        }
        if (offer.kind === 'passive' && !isOwnedPassive(lo, offer.id)) {
          lo = grantPassive(lo, offer.id);
          justGranted = true;
        }
      }
      if (justGranted) {
        m = withToast(m, '已装备');
        return { merchant: m, loadout: lo, merit: me };
      }
      if (offer.owned || m.testMode) {
        const equipped = isOfferEquipped(lo, offer);
        if (equipped) {
          m = { ...m, confirmUnequip: { kind: offer.kind, id: offer.id }, toast: '' };
        } else if (isKindSlotsFull(lo, offer.kind)) {
          m = withToast(m, slotFullHint(offer.kind));
        } else {
          const res = offer.kind === 'active' ? equipActive(lo, offer.id) : equipPassive(lo, offer.id);
          lo = res.loadout;
          m = withToast(m, res.ok ? '已装备' : res.reason ?? '无法装备');
        }
      } else if (isKindSlotsFull(lo, offer.kind)) {
        m = withToast(m, slotFullHint(offer.kind));
      } else {
        const cost = skillCost(offer.kind, offer.id);
        if (me.merit < cost) {
          m = withToast(m, '功德不足');
        } else {
          m = { ...m, confirmOffer: hit.index, toast: '' };
        }
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
    return { merchant: withToast(merchant, '功德不足'), loadout, merit };
  }
  const pick = pickLotterySkill(loadout);
  if (!pick) {
    return { merchant: withToast(merchant, '无可抽技能'), loadout, merit };
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
      merchant: withToast(
        merchant,
        equipped ? `抽中「${name}」并已装备` : `抽中「${name}」（请先卸下腾位）`,
      ),
      loadout: lo,
      merit: me,
    };
  }

  if (isOwnedPassive(lo, pick.id)) {
    const res = equipPassive(lo, pick.id);
    lo = res.loadout;
    const equipped = lo.passives.includes(pick.id);
    return {
      merchant: withToast(
        merchant,
        equipped ? `抽中「${name}」并已装备` : res.reason ?? '槽位已满',
      ),
      loadout: lo,
      merit: me,
    };
  }
  lo = grantPassive(lo, pick.id);
  const equipped = lo.passives.includes(pick.id);
  return {
    merchant: withToast(
      merchant,
      equipped ? `抽中「${name}」并已装备` : `抽中「${name}」（请先卸下腾位）`,
    ),
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

export function merchantScrollViewport(): { x: number; y: number; w: number; h: number } {
  return { x: PX + 14, y: CONTENT_TOP, w: PW - 28, h: CONTENT_H };
}

export function merchantMaxScroll(m: MerchantUiState): number {
  const rowH = OFFER_H + OFFER_GAP;
  const contentH = Math.max(0, m.offers.length * rowH - OFFER_GAP);
  return Math.max(0, contentH - CONTENT_H);
}

export function merchantScrollViewportContains(x: number, y: number): boolean {
  return inRect(x, y, merchantScrollViewport());
}

/** 测试模式可滚动的中间区域（含滚动条，不含底部装备栏） */
export function merchantTestScrollAreaContains(x: number, y: number): boolean {
  return x >= PX && x <= PX + PW && y >= CONTENT_TOP && y < EQUIP_TOP;
}

export function merchantApplyWheel(m: MerchantUiState, deltaY: number): MerchantUiState {
  const max = merchantMaxScroll(m);
  return { ...m, scrollY: Math.max(0, Math.min(max, m.scrollY + deltaY)) };
}

const OFFER_H = 128;
const OFFER_GAP = 6;
const OFFER_BTN_W = 88;
const OFFER_BTN_H = 34;
const OFFER_TEXT_X = 68;
function offerRect(i: number, scrollY = 0): { x: number; y: number; w: number; h: number } {
  return { x: PX + 16, y: CONTENT_TOP + i * (OFFER_H + OFFER_GAP) - scrollY, w: PW - 32, h: OFFER_H };
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

const CONF_PW = 360;
const CONF_PH = 220;
const CONF_PX = (VIEW_W - CONF_PW) / 2;
const CONF_PY = (VIEW_H - CONF_PH) / 2;
const CONF_CANCEL = { x: CONF_PX + 18, y: CONF_PY + CONF_PH - 56, w: (CONF_PW - 36 - 12) / 2, h: 40 };
const CONF_OK = { x: CONF_PX + CONF_PW / 2 + 6, y: CONF_PY + CONF_PH - 56, w: (CONF_PW - 36 - 12) / 2, h: 40 };

// —— 技能详情弹窗（点击已装配技能 / 抽奖预览道具触发） —— //
const INFO_PW = 400;
const INFO_PH = 300;
const INFO_PX = (VIEW_W - INFO_PW) / 2;
const INFO_PY = (VIEW_H - INFO_PH) / 2;
const INFO_CLOSE_BTN = { x: INFO_PX + 32, y: INFO_PY + INFO_PH - 56, w: INFO_PW - 64, h: 40 };

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

/** 「主动」装备行整体范围（新手引导高亮用，坐标固定，不依赖 loadout） */
export function merchantActiveRowRect(): { x: number; y: number; w: number; h: number } {
  const pitch = ACT_SLOT + 10;
  const startX = equipGridStartX(MAX_EQUIPPED_ACTIVES, ACT_SLOT, pitch);
  return { x: startX, y: ACT_ROW_Y, w: MAX_EQUIPPED_ACTIVES * pitch - (pitch - ACT_SLOT), h: ACT_SLOT };
}

/** 「被动」装备行整体范围（新手引导高亮用，坐标固定，不依赖 loadout） */
export function merchantPassiveRowRect(): { x: number; y: number; w: number; h: number } {
  const pitch = PAS_SLOT + 6;
  const startX = equipGridStartX(MAX_EQUIPPED_PASSIVES, PAS_SLOT, pitch);
  return { x: startX, y: PAS_ROW_Y, w: MAX_EQUIPPED_PASSIVES * pitch - (pitch - PAS_SLOT), h: PAS_SLOT };
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
  skillId: string,
  showUnequip = true,
): void {
  roundRect(ctx, r.x, r.y, r.w, r.h, radius);
  ctx.fillStyle = 'rgba(48,28,12,0.55)';
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const glyphR = Math.min(r.w, r.h) * 0.42;
  drawSkillGlyph(ctx, r.x + r.w / 2, r.y + r.h / 2, glyphR, icon, stroke, true, skillId);
  if (showUnequip) drawUnequipX(ctx, unequipBtnRect(r));
}

export type MerchantHit =
  | { kind: 'close' }
  | { kind: 'tab'; tab: 'shop' | 'lottery' }
  | { kind: 'offer'; index: number }
  | { kind: 'lottery' }
  | { kind: 'unequipActive'; id: string }
  | { kind: 'unequipPassive'; id: string }
  | { kind: 'confirmUnequip' }
  | { kind: 'cancelUnequip' }
  | { kind: 'skillInfo'; skillKind: SkillKind; id: string }
  | { kind: 'closeSkillInfo' }
  | { kind: 'continue' }
  | { kind: 'confirmOfferBuy' }
  | { kind: 'cancelOfferBuy' }
  | null;

function merchantConfirmHitAt(x: number, y: number): MerchantHit {
  if (inRect(x, y, CONF_CANCEL)) return { kind: 'cancelOfferBuy' };
  if (inRect(x, y, CONF_OK)) return { kind: 'confirmOfferBuy' };
  if (x >= CONF_PX && x <= CONF_PX + CONF_PW && y >= CONF_PY && y <= CONF_PY + CONF_PH) return null;
  return { kind: 'cancelOfferBuy' };
}

function merchantUnequipConfirmHitAt(x: number, y: number): MerchantHit {
  if (inRect(x, y, CONF_CANCEL)) return { kind: 'cancelUnequip' };
  if (inRect(x, y, CONF_OK)) return { kind: 'confirmUnequip' };
  if (x >= CONF_PX && x <= CONF_PX + CONF_PW && y >= CONF_PY && y <= CONF_PY + CONF_PH) return null;
  return { kind: 'cancelUnequip' };
}

function merchantSkillInfoHitAt(x: number, y: number): MerchantHit {
  if (inRect(x, y, INFO_CLOSE_BTN)) return { kind: 'closeSkillInfo' };
  if (x >= INFO_PX && x <= INFO_PX + INFO_PW && y >= INFO_PY && y <= INFO_PY + INFO_PH) return null;
  return { kind: 'closeSkillInfo' };
}

export function merchantHitAt(x: number, y: number, m: MerchantUiState, loadout: LoadoutState): MerchantHit {
  if (!m.open) return null;
  if (m.confirmUnequip) return merchantUnequipConfirmHitAt(x, y);
  if (m.confirmOffer !== null) return merchantConfirmHitAt(x, y);
  if (m.skillInfo) return merchantSkillInfoHitAt(x, y);
  if (inRect(x, y, CLOSE_R)) return { kind: 'close' };
  if (!m.testMode) {
    if (inRect(x, y, TAB_SHOP)) return { kind: 'tab', tab: 'shop' };
    if (inRect(x, y, TAB_LOTTERY)) return { kind: 'tab', tab: 'lottery' };
  }
  if (inRect(x, y, CONTINUE_R)) return { kind: 'continue' };

  for (const r of activeSlotRects(loadout)) {
    if (!r.id) continue;
    if (inRect(x, y, unequipBtnRect(r))) return { kind: 'unequipActive', id: r.id };
    if (inRect(x, y, r)) return { kind: 'skillInfo', skillKind: 'active', id: r.id };
  }
  for (const r of passiveSlotRects(loadout)) {
    if (!r.id) continue;
    if (inRect(x, y, unequipBtnRect(r))) return { kind: 'unequipPassive', id: r.id };
    if (inRect(x, y, r)) return { kind: 'skillInfo', skillKind: 'passive', id: r.id };
  }

  if (m.tab === 'shop') {
    const scrollY = m.testMode ? m.scrollY : 0;
    for (let i = 0; i < m.offers.length; i++) {
      if (inRect(x, y, offerRect(i, scrollY))) return { kind: 'offer', index: i };
    }
  } else {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const cell = lotCellRect(row, col);
        if (!inRect(x, y, cell)) continue;
        if (row === 1 && col === 1) return { kind: 'lottery' };
        const idx = lotPreviewIndex(row, col);
        const preview = idx !== null ? m.lotteryPreview[idx] : undefined;
        if (preview) return { kind: 'skillInfo', skillKind: preview.kind, id: preview.id };
        return null;
      }
    }
  }

  // 面板内非按钮区：测试模式中间列表可滚动
  if (x >= PX && x <= PX + PW && y >= PY && y <= PY + PH) {
    if (m.testMode && merchantTestScrollAreaContains(x, y)) return null;
    return null;
  }
  return null;
}

function skillKindMeta(kind: SkillKind): { label: string; color: string; ink: string } {
  return kind === 'active'
    ? { label: '主动', color: '#5a7088', ink: 'rgba(90,112,136,0.32)' }
    : { label: '被动', color: '#6a8050', ink: 'rgba(106,128,80,0.32)' };
}

function drawSkillKindTag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: SkillKind,
): number {
  const meta = skillKindMeta(kind);
  ctx.font = 'bold 11px "PingFang SC", "STKaiti", serif';
  const w = ctx.measureText(meta.label).width + 10;
  roundRect(ctx, x, y, w, 16, 4);
  ctx.fillStyle = meta.ink;
  ctx.fill();
  ctx.strokeStyle = meta.color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = meta.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(meta.label, x + 5, y + 8);
  return w;
}

function drawInkTab(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  label: string,
  active: boolean,
): void {
  drawInkActionButton(ctx, rect, label, false, active ? 'primary' : 'secondary');
}

function isOfferEquipped(loadout: LoadoutState, offer: MerchantOffer): boolean {
  return offer.kind === 'active'
    ? isActiveEquipped(loadout, offer.id)
    : isPassiveEquipped(loadout, offer.id);
}

function offerActionLabel(
  loadout: LoadoutState,
  offer: MerchantOffer,
  cost: number,
  canAfford: boolean,
  testMode: boolean,
): { label: string; variant: 'primary' | 'secondary' | 'accent' } {
  if (testMode || offer.owned) {
    if (isOfferEquipped(loadout, offer)) {
      return { label: '卸下', variant: 'secondary' };
    }
    if (isKindSlotsFull(loadout, offer.kind)) {
      return { label: '装备', variant: 'secondary' };
    }
    return { label: '装备', variant: 'accent' };
  }
  if (!canAfford) {
    return { label: `${cost} 功德`, variant: 'secondary' };
  }
  return { label: `${cost} 功德`, variant: 'primary' };
}

function drawOfferCard(
  ctx: CanvasRenderingContext2D,
  m: MerchantUiState,
  loadout: LoadoutState,
  merit: MeritState,
  index: number,
  scrollY: number,
): void {
  const offer = m.offers[index];
  if (!offer) return;
  const r = offerRect(index, scrollY);
  if (r.y + r.h < CONTENT_TOP || r.y > CONTENT_TOP + CONTENT_H) return;
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
  const rarityW = ctx.measureText(rarity.label).width;
  drawSkillKindTag(ctx, r.x + 12 + rarityW + 8, r.y + 8, offer.kind);

  const bx = r.x + r.w - OFFER_BTN_W - 10;
  const textX = r.x + OFFER_TEXT_X;
  const textColW = bx - textX - 8;
  const desc = offer.kind === 'active'
    ? `${def.desc} · CD${activeById(offer.id)!.cd}s`
    : def.desc;
  ctx.font = '12px "PingFang SC", serif';
  const descLines = fitTextLines(ctx, desc, textColW, 3);
  const nameH = 18;
  const descLineH = 16;
  const textBlockH = nameH + 4 + descLines.length * descLineH;
  const blockH = Math.max(OFFER_BTN_H, textBlockH);
  const innerTop = r.y + 26;
  const innerH = r.h - 30;
  const blockTop = innerTop + Math.max(0, (innerH - blockH) / 2);

  const iconR = 22;
  const iconCx = r.x + 36;
  const iconCy = blockTop + blockH / 2;
  drawSkillGlyph(ctx, iconCx, iconCy, iconR, def.icon, rarity.color, true, offer.id);

  const textY = blockTop;
  const by = blockTop + (blockH - OFFER_BTN_H) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(textX, blockTop, textColW, blockH);
  ctx.clip();
  ctx.fillStyle = '#4a2808';
  ctx.font = 'bold 16px "PingFang SC", "STKaiti", serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(fitText(ctx, def.name, textColW), textX, textY);
  ctx.fillStyle = 'rgba(70,45,15,0.82)';
  ctx.font = '12px "PingFang SC", serif';
  for (let li = 0; li < descLines.length; li++) {
    ctx.fillText(descLines[li]!, textX, textY + nameH + 4 + li * descLineH);
  }
  ctx.restore();

  const { label, variant } = offerActionLabel(loadout, offer, cost, canAfford, m.testMode);
  drawInkActionButton(
    ctx,
    { x: bx, y: by, w: OFFER_BTN_W, h: OFFER_BTN_H },
    label,
    false,
    variant,
  );
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
          const kindMeta = skillKindMeta(preview.kind);
          drawSkillGlyph(ctx, cell.x + cell.w / 2, cell.y + cell.h / 2 - 14, 18, def.icon, kindMeta.color, true, preview.id);
          ctx.fillStyle = kindMeta.color;
          ctx.font = 'bold 10px "PingFang SC", "STKaiti", serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(kindMeta.label, cell.x + cell.w / 2, cell.y + cell.h - 22);
          ctx.fillStyle = '#4a2808';
          ctx.font = 'bold 11px "PingFang SC", "STKaiti", serif';
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

function tutorialPreviewPool(kind: SkillKind, offers: MerchantOffer[]): string[] {
  const fromOffers = offers.filter((o) => o.kind === kind).map((o) => o.id);
  const fallback = kind === 'active'
    ? enabledActives().map((a) => a.id)
    : enabledPassives().map((p) => p.id);
  const pool: string[] = [];
  for (const id of [...fromOffers, ...fallback]) {
    if (!pool.includes(id)) pool.push(id);
  }
  return pool;
}

/** 引导期「我的道具」展示用：空槽填入示例技能（不写 loadout，引导结束即消失） */
function displayEquipSlots(
  loadout: LoadoutState,
  offers: MerchantOffer[],
  tutorialPreview: boolean,
): { actives: (string | null)[]; passives: (string | null)[]; previewIds: Set<string> } {
  const actives: (string | null)[] = Array.from(
    { length: MAX_EQUIPPED_ACTIVES },
    (_, i) => loadout.equipped[i] ?? null,
  );
  const passives: (string | null)[] = Array.from(
    { length: MAX_EQUIPPED_PASSIVES },
    (_, i) => loadout.passives[i] ?? null,
  );
  const previewIds = new Set<string>();
  if (!tutorialPreview) return { actives, passives, previewIds };

  const actPool = tutorialPreviewPool('active', offers);
  const pasPool = tutorialPreviewPool('passive', offers);
  let ai = 0;
  let pi = 0;
  for (let i = 0; i < MAX_EQUIPPED_ACTIVES; i++) {
    if (actives[i]) continue;
    const id = actPool[ai++ % Math.max(1, actPool.length)];
    if (!id) break;
    actives[i] = id;
    previewIds.add(id);
  }
  // 被动行展示 3 个示例即可，避免满屏占位
  const pasPreviewCap = 3;
  let filled = 0;
  for (let i = 0; i < MAX_EQUIPPED_PASSIVES && filled < pasPreviewCap; i++) {
    if (passives[i]) continue;
    const id = pasPool[pi++ % Math.max(1, pasPool.length)];
    if (!id) break;
    passives[i] = id;
    previewIds.add(id);
    filled += 1;
  }
  return { actives, passives, previewIds };
}

function drawEquippedSection(
  ctx: CanvasRenderingContext2D,
  loadout: LoadoutState,
  offers: MerchantOffer[],
  tutorialPreview: boolean,
): void {
  roundRect(ctx, PX + EQUIP_PANEL_SIDE, EQUIP_TOP, PW - EQUIP_PANEL_SIDE * 2, EQUIP_PANEL_H, 10);
  const panel = ctx.createLinearGradient(PX, EQUIP_TOP, PX, EQUIP_TOP + EQUIP_PANEL_H);
  panel.addColorStop(0, 'rgba(55,32,14,0.38)');
  panel.addColorStop(1, 'rgba(45,28,12,0.48)');
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,160,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const { actives, passives, previewIds } = displayEquipSlots(loadout, offers, tutorialPreview);
  const actSlots = activeSlotRects(loadout).map((r, i) => ({ ...r, id: actives[i] ?? null }));
  const pasSlots = passiveSlotRects(loadout).map((r, i) => ({ ...r, id: passives[i] ?? null }));
  const titleX = PX + EQUIP_PANEL_SIDE + 6;

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff4e0';
  ctx.font = 'bold 15px "PingFang SC", "STKaiti", serif';
  ctx.fillText('我的道具', titleX, EQUIP_TOP + 8);
  ctx.font = '11px "PingFang SC", serif';
  ctx.fillStyle = 'rgba(255,240,210,0.6)';
  ctx.fillText('道具仅当天有效 · 点击 × 卸下', titleX, EQUIP_TOP + 26);

  const actCount = tutorialPreview ? actives.filter(Boolean).length : loadout.equipped.length;
  const pasCount = tutorialPreview ? passives.filter(Boolean).length : loadout.passives.length;
  drawEquipRowLabel(ctx, ACT_ROW_Y, ACT_SLOT, ['主', '动'], actCount, MAX_EQUIPPED_ACTIVES);
  drawEquipRowLabel(ctx, PAS_ROW_Y, PAS_SLOT, ['被', '动'], pasCount, MAX_EQUIPPED_PASSIVES);

  for (const r of actSlots) {
    if (r.id) {
      drawFilledEquipSlot(
        ctx,
        r,
        activeById(r.id)?.icon ?? '?',
        8,
        '#5a7088',
        r.id,
        !previewIds.has(r.id),
      );
    } else {
      drawEmptyEquipSlot(ctx, r, 8, 'rgba(90,112,136,0.55)');
    }
  }

  for (const r of pasSlots) {
    if (r.id) {
      drawFilledEquipSlot(
        ctx,
        r,
        passiveById(r.id)?.icon ?? '?',
        7,
        '#6a8050',
        r.id,
        !previewIds.has(r.id),
      );
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

function drawOfferConfirmPopup(
  ctx: CanvasRenderingContext2D,
  m: MerchantUiState,
  merit: MeritState,
): void {
  const idx = m.confirmOffer;
  if (idx === null) return;
  const offer = m.offers[idx];
  if (!offer) return;
  const def = offer.kind === 'active' ? activeById(offer.id) : passiveById(offer.id);
  if (!def) return;
  const cost = skillCost(offer.kind, offer.id);
  const rarity = skillRarityColor(def.cost);

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  roundRect(ctx, CONF_PX, CONF_PY, CONF_PW, CONF_PH, 12);
  ctx.fillStyle = '#f8ecd2';
  ctx.fill();
  ctx.strokeStyle = rarity.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#4a2808';
  ctx.font = 'bold 18px "PingFang SC", "STKaiti", serif';
  ctx.fillText(def.name, CONF_PX + 18, CONF_PY + 16);
  const kindMeta = skillKindMeta(offer.kind);
  ctx.fillStyle = kindMeta.color;
  ctx.font = 'bold 12px "PingFang SC", "STKaiti", serif';
  ctx.fillText(`${kindMeta.label}技能`, CONF_PX + 18, CONF_PY + 40);
  ctx.fillStyle = 'rgba(70,45,15,0.82)';
  ctx.font = '13px "PingFang SC", serif';
  ctx.fillText(`将扣除 ${cost} 功德（当前 ${merit.merit}）`, CONF_PX + 18, CONF_PY + 62);
  ctx.fillText('道具仅当天有效，下局结束后刷新商品。', CONF_PX + 18, CONF_PY + 86);

  drawInkActionButton(ctx, CONF_CANCEL, '取消', false, 'secondary');
  drawInkActionButton(ctx, CONF_OK, '确认购买', false, merit.merit >= cost ? 'primary' : 'secondary');
}

function drawUnequipConfirmPopup(
  ctx: CanvasRenderingContext2D,
  req: { kind: SkillKind; id: string },
): void {
  const def = req.kind === 'active' ? activeById(req.id) : passiveById(req.id);
  if (!def) return;
  const rarity = skillRarityColor(def.cost);

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  roundRect(ctx, CONF_PX, CONF_PY, CONF_PW, CONF_PH, 12);
  ctx.fillStyle = '#f8ecd2';
  ctx.fill();
  ctx.strokeStyle = rarity.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#4a2808';
  ctx.font = 'bold 18px "PingFang SC", "STKaiti", serif';
  ctx.fillText(`卸下「${def.name}」？`, CONF_PX + 18, CONF_PY + 16);

  ctx.fillStyle = 'rgba(70,45,15,0.82)';
  ctx.font = '13px "PingFang SC", serif';
  const hint = '卸下后需等该道具在【商店】重新刷出（本次列表中若仍有它可直接再装备，否则要等下次神秘商人到访）才能重新装备。';
  const lines = fitTextLines(ctx, hint, CONF_PW - 36, 4);
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, CONF_PX + 18, CONF_PY + 46 + i * 20);
  }

  drawInkActionButton(ctx, CONF_CANCEL, '取消', false, 'secondary');
  drawInkActionButton(ctx, CONF_OK, '确认卸下', false, 'primary');
}

function drawSkillInfoPopup(
  ctx: CanvasRenderingContext2D,
  info: { kind: SkillKind; id: string },
  merit: MeritState,
): void {
  const def = info.kind === 'active' ? activeById(info.id) : passiveById(info.id);
  if (!def) return;
  const rarity = skillRarityColor(def.cost);

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  roundRect(ctx, INFO_PX, INFO_PY, INFO_PW, INFO_PH, 12);
  ctx.fillStyle = '#f8ecd2';
  ctx.fill();
  ctx.strokeStyle = rarity.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  const iconR = 26;
  const iconCx = INFO_PX + 44;
  const iconCy = INFO_PY + 48;
  drawSkillGlyph(ctx, iconCx, iconCy, iconR, def.icon, rarity.color, true, info.id);

  const textX = INFO_PX + 80;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#4a2808';
  ctx.font = 'bold 18px "PingFang SC", "STKaiti", serif';
  ctx.fillText(fitText(ctx, def.name, INFO_PX + INFO_PW - 18 - textX), textX, INFO_PY + 22);

  let tagX = textX;
  const tagY = INFO_PY + 50;
  ctx.font = 'bold 11px "PingFang SC", "STKaiti", serif';
  tagX += drawSkillKindTag(ctx, tagX, tagY, info.kind) + 8;
  ctx.fillStyle = rarity.color;
  ctx.font = 'bold 11px "PingFang SC", "STKaiti", serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(rarity.label, tagX, tagY + 8);

  ctx.fillStyle = 'rgba(70,45,15,0.88)';
  ctx.font = '13px "PingFang SC", serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const desc = info.kind === 'active' ? `${def.desc} · CD${activeById(info.id)!.cd}s` : def.desc;
  const descTop = INFO_PY + 92;
  const descMaxW = INFO_PW - 36;
  const descLines = fitTextLines(ctx, desc, descMaxW, 5);
  for (let i = 0; i < descLines.length; i++) {
    ctx.fillText(descLines[i]!, INFO_PX + 18, descTop + i * 20);
  }

  const footY = INFO_PY + INFO_PH - 100;
  ctx.fillStyle = 'rgba(70,45,15,0.7)';
  ctx.font = '12px "PingFang SC", serif';
  ctx.fillText(`商店价值 ${def.cost} 功德`, INFO_PX + 18, footY);
  ctx.fillText(`当前功德 ${merit.merit}`, INFO_PX + 18, footY + 20);

  drawInkActionButton(ctx, INFO_CLOSE_BTN, '关闭', false, 'secondary');
}

function drawMerchantScrollBar(ctx: CanvasRenderingContext2D, m: MerchantUiState): void {
  const max = merchantMaxScroll(m);
  if (max <= 0) return;
  const vp = merchantScrollViewport();
  const trackX = PX + PW - 12;
  const trackY = vp.y + 4;
  const trackH = vp.h - 8;
  const frac = max > 0 ? m.scrollY / max : 0;
  const thumbH = Math.max(28, trackH * (CONTENT_H / Math.max(CONTENT_H, m.offers.length * (OFFER_H + OFFER_GAP))));
  const thumbY = trackY + frac * (trackH - thumbH);
  ctx.save();
  roundRect(ctx, trackX, trackY, 6, trackH, 3);
  ctx.fillStyle = 'rgba(48,28,12,0.25)';
  ctx.fill();
  roundRect(ctx, trackX, thumbY, 6, thumbH, 3);
  ctx.fillStyle = 'rgba(168,120,56,0.75)';
  ctx.fill();
  ctx.restore();
}

function drawTestModeSkillList(ctx: CanvasRenderingContext2D, m: MerchantUiState, loadout: LoadoutState, merit: MeritState): void {
  const vp = merchantScrollViewport();
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, vp.x - 2, vp.y, vp.w + 4, vp.h, 8);
  ctx.clip();
  ctx.fillStyle = 'rgba(48,28,12,0.08)';
  ctx.fillRect(vp.x, vp.y, vp.w, vp.h);
  for (let i = 0; i < m.offers.length; i++) {
    drawOfferCard(ctx, m, loadout, merit, i, m.scrollY);
  }
  ctx.restore();
  drawMerchantScrollBar(ctx, m);
  ctx.fillStyle = 'rgba(90,58,28,0.72)';
  ctx.font = '12px "PingFang SC", serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`全部技能 ${m.offers.length} 项 · 上下滑动浏览`, PX + 18, CONTENT_TOP - 18);
}

/** 水墨卷轴弹窗（叠在首页之上） */
export function drawMerchant(
  ctx: CanvasRenderingContext2D,
  m: MerchantUiState,
  loadout: LoadoutState,
  merit: MeritState,
  opts?: { equipTutorialPreview?: boolean },
): void {
  if (!m.open) return;

  const title = m.testMode ? '神秘商人 · 测试' : '神秘商人';
  drawInkPopupFrame(ctx, PX, PY, PW, PH, title, CLOSE_R);

  if (!m.testMode) {
    drawInkTab(ctx, TAB_SHOP, '商店', m.tab === 'shop');
    drawInkTab(ctx, TAB_LOTTERY, '抽奖', m.tab === 'lottery');
  } else {
    roundRect(ctx, PX + 18, TAB_SHOP.y, PW - 36, TAB_SHOP.h, 8);
    ctx.fillStyle = 'rgba(168,120,56,0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(168,120,56,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#6a4018';
    ctx.font = 'bold 14px "PingFang SC", "STKaiti", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('测试模式 · 全部技能（滚动切换）', PX + PW / 2, TAB_SHOP.y + TAB_SHOP.h / 2);
  }

  drawInkResourceBar(ctx, MERIT_BAR, '功德', String(merit.merit), 0, 'icon-merit');

  if (m.testMode) {
    drawTestModeSkillList(ctx, m, loadout, merit);
  } else if (m.tab === 'shop') {
    for (let i = 0; i < m.offers.length; i++) drawOfferCard(ctx, m, loadout, merit, i, 0);
  } else {
    drawLotteryGrid(ctx, m);
  }

  drawEquippedSection(ctx, loadout, m.offers, opts?.equipTutorialPreview === true);
  drawInkActionButton(ctx, CONTINUE_R, '关闭', false, 'secondary');

  if (m.confirmOffer !== null) drawOfferConfirmPopup(ctx, m, merit);
  if (m.confirmUnequip) drawUnequipConfirmPopup(ctx, m.confirmUnequip);
  if (m.skillInfo) drawSkillInfoPopup(ctx, m.skillInfo, merit);
}
