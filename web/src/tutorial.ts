// 新手引导：高亮锚点 + 动态箭头 + tips 卷轴卡片，全屏昏暗遮罩弱化其余区域，展示期间局内暂停。
// 纯引擎：不感知 Battle/UI，触发时机与锚点计算全部由调用方（main.ts）以闭包传入。
import { VIEW_W, VIEW_H } from './render';
import { roundRect, drawInkActionButton } from './menu-ui';
import { storeGet, storeSet, parseStoredJson } from './storage';

export interface TutorialRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TutorialStep {
  /** 步骤内唯一 id（仅用于调试/排查，不参与持久化） */
  id: string;
  title: string;
  text: string;
  /** 返回高亮矩形；null = 无锚点，仅居中弹卡片说明 */
  getAnchor: () => TutorialRect | null;
}

export interface TutorialSequence {
  /** 持久化 key：同一 id 的引导只会展示一次（完成或跳过后都记为已展示） */
  id: string;
  steps: TutorialStep[];
}

export interface TutorialOverlay {
  sequenceId: string;
  steps: TutorialStep[];
  stepIndex: number;
}

export interface TutorialState {
  seen: Record<string, boolean>;
}

const STORAGE_KEY = 'dasheng.tutorial';

function normalizeTutorialState(raw: unknown): TutorialState | null {
  if (!raw || typeof raw !== 'object') return { seen: {} };
  const seenRaw = (raw as { seen?: unknown }).seen;
  if (!seenRaw || typeof seenRaw !== 'object') return { seen: {} };
  const seen: Record<string, boolean> = {};
  for (const key of Object.keys(seenRaw)) {
    if ((seenRaw as Record<string, unknown>)[key] === true) seen[key] = true;
  }
  return { seen };
}

export function loadTutorialState(): TutorialState {
  return parseStoredJson(storeGet(STORAGE_KEY), normalizeTutorialState, { seen: {} });
}

function saveTutorialState(state: TutorialState): void {
  try {
    storeSet(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function hasSeenTutorial(state: TutorialState, sequenceId: string): boolean {
  return state.seen[sequenceId] === true;
}

export function markTutorialSeen(state: TutorialState, sequenceId: string): TutorialState {
  if (state.seen[sequenceId]) return state;
  const next: TutorialState = { seen: { ...state.seen, [sequenceId]: true } };
  saveTutorialState(next);
  return next;
}

/** DevTools：清空/写入引导进度 */
export function writeTutorialState(state: TutorialState): TutorialState {
  const next = normalizeTutorialState(state) ?? { seen: {} };
  saveTutorialState(next);
  return next;
}

/** 若当前无引导展示中且该序列未展示过，则开始展示；否则原样返回 active（不打断正在展示的引导）。 */
export function maybeStartTutorial(
  state: TutorialState,
  active: TutorialOverlay | null,
  sequence: TutorialSequence,
): TutorialOverlay | null {
  if (active) return active;
  if (sequence.steps.length === 0) return active;
  if (hasSeenTutorial(state, sequence.id)) return active;
  return { sequenceId: sequence.id, steps: sequence.steps, stepIndex: 0 };
}

export interface TutorialAdvanceResult {
  overlay: TutorialOverlay | null;
  state: TutorialState;
}

/** 点「下一步」/点空白处：进入下一步；最后一步则关闭并记为已展示。 */
export function advanceTutorial(overlay: TutorialOverlay, state: TutorialState): TutorialAdvanceResult {
  const nextIndex = overlay.stepIndex + 1;
  if (nextIndex >= overlay.steps.length) {
    return { overlay: null, state: markTutorialSeen(state, overlay.sequenceId) };
  }
  return { overlay: { ...overlay, stepIndex: nextIndex }, state };
}

/** 点「跳过引导」：立即关闭并记为已展示（整段序列，不会再弹）。 */
export function skipTutorial(overlay: TutorialOverlay, state: TutorialState): TutorialAdvanceResult {
  return { overlay: null, state: markTutorialSeen(state, overlay.sequenceId) };
}

// —— 布局（draw 与 hit-test 共用，保证按钮位置一致） —— //

const CARD_W = 300;
const CARD_PAD = 16;
const CARD_MIN_H = 128;
const LINE_H = 21;
const TITLE_GAP = 26;
const NEXT_BTN_H = 40;
const SKIP_BTN = { w: 76, h: 28 };
const HOLE_PAD = 8;
const HOLE_RADIUS = 10;
const GAP_CARD_TO_HOLE = 26;

function inRect(x: number, y: number, r: TutorialRect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    const next = line + ch;
    if (line.length > 0 && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = ch;
    } else {
      line = next;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

interface TutorialLayout {
  card: TutorialRect;
  skipBtn: TutorialRect;
  nextBtn: TutorialRect;
  lines: string[];
  hole: TutorialRect | null;
  arrowFrom: { x: number; y: number } | null;
  arrowTo: { x: number; y: number } | null;
}

function padHole(anchor: TutorialRect): TutorialRect {
  return {
    x: anchor.x - HOLE_PAD,
    y: anchor.y - HOLE_PAD,
    w: anchor.w + HOLE_PAD * 2,
    h: anchor.h + HOLE_PAD * 2,
  };
}

function clampX(x: number): number {
  return Math.min(Math.max(8, x), VIEW_W - CARD_W - 8);
}

function layoutTutorialStep(ctx: CanvasRenderingContext2D, step: TutorialStep): TutorialLayout {
  const anchor = step.getAnchor();
  const hole = anchor ? padHole(anchor) : null;

  ctx.font = '14px "PingFang SC", serif';
  const lines = wrapLines(ctx, step.text, CARD_W - CARD_PAD * 2);
  const bodyH = lines.length * LINE_H;
  const cardH = Math.max(CARD_MIN_H, CARD_PAD * 2 + TITLE_GAP + bodyH + NEXT_BTN_H + 14);

  let cardX = clampX((VIEW_W - CARD_W) / 2);
  let cardY: number;
  let arrowFrom: { x: number; y: number } | null = null;
  let arrowTo: { x: number; y: number } | null = null;

  if (hole) {
    cardX = clampX(hole.x + hole.w / 2 - CARD_W / 2);
    const spaceBelow = VIEW_H - (hole.y + hole.h);
    const spaceAbove = hole.y;
    if (spaceBelow >= cardH + GAP_CARD_TO_HOLE || spaceBelow >= spaceAbove) {
      cardY = Math.min(hole.y + hole.h + GAP_CARD_TO_HOLE, VIEW_H - cardH - 10);
      arrowTo = { x: hole.x + hole.w / 2, y: hole.y + hole.h + 2 };
      arrowFrom = { x: cardX + CARD_W / 2, y: cardY - 4 };
    } else {
      cardY = Math.max(10, hole.y - cardH - GAP_CARD_TO_HOLE);
      arrowTo = { x: hole.x + hole.w / 2, y: hole.y - 2 };
      arrowFrom = { x: cardX + CARD_W / 2, y: cardY + cardH + 4 };
    }
  } else {
    cardY = (VIEW_H - cardH) / 2;
  }

  const skipBtn: TutorialRect = { x: cardX + CARD_W - SKIP_BTN.w - 10, y: cardY + 10, w: SKIP_BTN.w, h: SKIP_BTN.h };
  const nextBtn: TutorialRect = {
    x: cardX + CARD_PAD,
    y: cardY + cardH - NEXT_BTN_H - CARD_PAD,
    w: CARD_W - CARD_PAD * 2,
    h: NEXT_BTN_H,
  };

  return { card: { x: cardX, y: cardY, w: CARD_W, h: cardH }, skipBtn, nextBtn, lines, hole, arrowFrom, arrowTo };
}

export type TutorialHit = { kind: 'skip' } | { kind: 'advance' };

/** 引导展示期间拦截所有点击：命中「跳过引导」则跳过，其余任意处点击都前进到下一步。 */
export function tutorialHitAt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  overlay: TutorialOverlay,
): TutorialHit {
  const step = overlay.steps[overlay.stepIndex];
  if (!step) return { kind: 'advance' };
  const layout = layoutTutorialStep(ctx, step);
  if (inRect(x, y, layout.skipBtn)) return { kind: 'skip' };
  return { kind: 'advance' };
}

function drawBounceArrow(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  now: number,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bounce = Math.sin(now / 180) * 5;
  const sx = from.x + ux * 4;
  const sy = from.y + uy * 4;
  const ex = to.x - ux * (10 + bounce);
  const ey = to.y - uy * (10 + bounce);

  ctx.save();
  ctx.strokeStyle = '#ffd76a';
  ctx.fillStyle = '#ffd76a';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(20,14,4,0.55)';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  const headLen = 12;
  const angle = Math.atan2(ey - sy, ex - sx);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSkipButton(ctx: CanvasRenderingContext2D, rect: TutorialRect): void {
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.h / 2);
  ctx.fillStyle = 'rgba(48,28,12,0.5)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,160,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ffe8c0';
  ctx.font = '13px "PingFang SC", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('跳过引导', rect.x + rect.w / 2, rect.y + rect.h / 2);
}

function drawTutorialCard(
  ctx: CanvasRenderingContext2D,
  layout: TutorialLayout,
  step: TutorialStep,
  stepIndex: number,
  total: number,
): void {
  const { card } = layout;
  roundRect(ctx, card.x, card.y, card.w, card.h, 14);
  const body = ctx.createLinearGradient(card.x, card.y, card.x, card.y + card.h);
  body.addColorStop(0, '#fff6e6');
  body.addColorStop(1, '#f0dfb8');
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,80,30,0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#5a2810';
  ctx.font = 'bold 16px "PingFang SC", "STKaiti", serif';
  ctx.fillText(step.title, card.x + CARD_PAD, card.y + CARD_PAD);

  if (total > 1) {
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(90,58,18,0.65)';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText(`${stepIndex + 1}/${total}`, card.x + card.w - CARD_PAD - SKIP_BTN.w - 8, card.y + CARD_PAD + 6);
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#5a3a12';
  ctx.font = '14px "PingFang SC", serif';
  const textTop = card.y + CARD_PAD + TITLE_GAP;
  for (let i = 0; i < layout.lines.length; i++) {
    ctx.fillText(layout.lines[i]!, card.x + CARD_PAD, textTop + i * LINE_H);
  }

  drawInkActionButton(ctx, layout.nextBtn, stepIndex + 1 >= total ? '知道了' : '下一步', false, 'primary');
  drawSkipButton(ctx, layout.skipBtn);
}

/** 绘制新手引导整层：全屏昏暗遮罩 + 高亮镂空光环 + 跳动箭头 + 说明卡片。 */
export function drawTutorialOverlay(ctx: CanvasRenderingContext2D, overlay: TutorialOverlay, now: number): void {
  const step = overlay.steps[overlay.stepIndex];
  if (!step) return;
  const layout = layoutTutorialStep(ctx, step);

  ctx.fillStyle = 'rgba(10,8,4,0.62)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  if (layout.hole) {
    const h = layout.hole;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000'; // 必须不透明：destination-out 按源 alpha 抠除遮罩，沿用 0.62 只抠掉 62% → 高亮区仍发暗
    roundRect(ctx, h.x, h.y, h.w, h.h, HOLE_RADIUS);
    ctx.fill();
    ctx.restore();

    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    ctx.save();
    roundRect(ctx, h.x, h.y, h.w, h.h, HOLE_RADIUS);
    ctx.lineWidth = 2.5 + pulse * 1.5;
    ctx.strokeStyle = `rgba(255,210,90,${0.55 + pulse * 0.35})`;
    ctx.shadowColor = 'rgba(255,200,80,0.8)';
    ctx.shadowBlur = 8 + pulse * 10;
    ctx.stroke();
    ctx.restore();
  }

  if (layout.arrowFrom && layout.arrowTo) drawBounceArrow(ctx, layout.arrowFrom, layout.arrowTo, now);

  drawTutorialCard(ctx, layout, step, overlay.stepIndex, overlay.steps.length);
}
