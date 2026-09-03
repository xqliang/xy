// 段位星级结算弹层：胜/败后叠在战斗页上播放加星或减星动画。
// 由 main.ts 在战斗页 isSettleOpen 时按帧调用，动画进度由「打开弹层的毫秒数」驱动。
import { VIEW_W, VIEW_H, fillViewScrim } from './render';
import { rankName, STARS_PER_TIER, type RankChange } from './rank';
import { drawRankStarsAnimated, roundRect, drawInkPopupRoof, drawInkPopupBody, drawInkActionButton, INK_POPUP_HEAD_H } from './menu-ui';
import { avatarById } from './avatar-catalog';
import { sprite } from './assets';

// 动画时间线（毫秒）：先按变化前星态停顿，再播放加/减星，最后停在终态。
const HOLD_MS = 480; // 展示"变化前"星态的停顿
const ANIM_MS = 620; // 加星/减星过程
export const SETTLE_ANIM_MS = HOLD_MS + ANIM_MS;

const PANEL_W = 420;

// 动画（加/减星）是否已放完（放完后点击才回主菜单；未完点击则跳到终态）。
export function isSettleAnimDone(tMs: number): boolean {
  return tMs >= SETTLE_ANIM_MS;
}

// 缓动：easeOutBack（末尾轻微过冲，星星弹入更有"手感"）。
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// 计算「展示用的档位」与每颗星的填充比例（0=暗，1=亮）。
// 说明：晋级时在"旧档"上补满第 5 颗星，降档时在"新档"上从满星减到 4 星——
// 这样加/减星动画始终发生在同一排 5 颗星上，视觉连贯。
function computeStars(c: RankChange, progress: number): { tier: number; fills: number[] } {
  const fills = new Array<number>(STARS_PER_TIER).fill(0);

  if (c.starDelta === 0) {
    // 封顶继续赢 / 地板继续输：无加减星，直接按终态点亮。
    const tier = c.state.level;
    const lit = c.won ? STARS_PER_TIER : 0; // 封顶=满星；地板=0 星
    for (let i = 0; i < lit; i++) fills[i] = 1;
    return { tier, fills };
  }

  if (c.won) {
    // 加星：晋级时展示旧档并补满第 5 颗；普通胜则在当前档补第 (before.stars) 颗。
    const tier = c.promoted ? c.before.level : c.state.level;
    const animIndex = c.before.stars; // 正在点亮的星下标（晋级时 = STARS_PER_TIER-1）
    for (let i = 0; i < STARS_PER_TIER; i++) {
      if (i < animIndex) fills[i] = 1;
      else if (i === animIndex) fills[i] = easeOutBack(progress);
      else fills[i] = 0;
    }
    return { tier, fills };
  }

  // 减星：降档时展示新档（满星）并熄灭第 5 颗；普通败则熄灭当前档最后一颗亮星。
  const tier = c.state.level;
  // 变化前该档应显示的亮星数：降档时视作满星（5），普通败为 before.stars。
  const litBefore = c.demoted ? STARS_PER_TIER : c.before.stars;
  const animIndex = litBefore - 1; // 正在熄灭的星下标
  for (let i = 0; i < STARS_PER_TIER; i++) {
    if (i < animIndex) fills[i] = 1;
    else if (i === animIndex) fills[i] = 1 - progress;
    else fills[i] = 0;
  }
  return { tier, fills };
}

/** 半透明遮罩：压暗战场，仍能透出对局画面。 */
function drawSettleAtmosphere(ctx: CanvasRenderingContext2D, tone: 'win' | 'lose' | 'endless'): void {
  const cx = VIEW_W / 2;
  const scrim = tone === 'win' ? 'rgba(28, 36, 22, 0.52)' : tone === 'lose' ? 'rgba(36, 18, 16, 0.55)' : 'rgba(28, 22, 14, 0.52)';
  fillViewScrim(ctx, scrim);

  // 中心略提亮，突出卷轴面板
  const glow = ctx.createRadialGradient(cx, VIEW_H * 0.42, 30, cx, VIEW_H * 0.45, VIEW_H * 0.55);
  glow.addColorStop(0, 'rgba(240, 220, 170, 0.10)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

/** 宣纸卷轴面板，返回内容区起点 y。 */
function drawSettlePanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  headTone: 'win' | 'lose' | 'endless',
  title: string,
): number {
  // 投影（结算大面板的落地感，保留；ink 弹窗自身无投影）
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  roundRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = '#e8d9b8';
  ctx.fill();
  ctx.restore();

  // body 边框改水墨弹窗同款朱红木框（2026-09-01 用户要求：与屋顶化的标题栏配套统一），
  // 替代原「宣纸渐变 + 棕描边 + 内金线」。
  drawInkPopupBody(ctx, x, y, w, h);

  // 标题栏改宫檐屋顶（2026-09-01 用户要求：结算弹窗与其它弹窗统一屋顶样式）：
  // 原色块标题条（win 绿 / lose 赭红）退役，胜负氛围继续由 drawSettleAtmosphere 背景承担；
  // headTone 参数保留（调用方语义不变，供日后氛围微调用）。
  drawInkPopupRoof(ctx, x, y, w, title);
  const headH = INK_POPUP_HEAD_H;

  return y + headH + 22;
}

function drawSettleHint(ctx: CanvasRenderingContext2D, text: string, y: number): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '15px "PingFang SC", serif';
  ctx.fillStyle = 'rgba(70,48,24,0.55)';
  ctx.fillText(text, VIEW_W / 2, y);
}

// 段位名 + 加/减星动画 + 晋级/降档提示。单人结算(drawSettle)与 PvP 结算(drawPvpSettle)共用，
// 保证「星级变化」观感一致。cx=水平中心；rankNameY=段位名基线 y；starsY=星排中心 y；progress=0..1。
function drawRankChangeStars(
  ctx: CanvasRenderingContext2D,
  c: RankChange,
  progress: number,
  cx: number,
  rankNameY: number,
  starsY: number,
  starOpts?: { gap?: number; size?: number },
): void {
  const { tier, fills } = computeStars(c, progress);
  const animDone = progress >= 1;
  // 晋级/降档在动画收尾时切到新档名字，否则一直显示「展示档」名
  const showTier = c.won && c.promoted && animDone ? c.state.level
    : (!c.won && c.demoted ? c.state.level : tier);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 20px "PingFang SC", "STKaiti", serif';
  ctx.fillStyle = '#5a3a12';
  ctx.fillText(`境界 · ${rankName(showTier)}`, cx, rankNameY);

  // 水墨星星排（透明底立绘，fills 驱动空↔满叠化）；晋级收尾时清零，让新档从 0 星起
  const drawFills = c.won && c.promoted && animDone ? new Array<number>(STARS_PER_TIER).fill(0) : fills;
  ctx.save();
  const glow = ctx.createRadialGradient(cx, starsY, 10, cx, starsY, 140);
  glow.addColorStop(0, 'rgba(210,160,60,0.18)');
  glow.addColorStop(1, 'rgba(210,160,60,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 160, starsY - 50, 320, 100);
  ctx.restore();
  drawRankStarsAnimated(ctx, cx, starsY, drawFills, { gap: starOpts?.gap ?? 58, size: starOpts?.size ?? 46 });

  // 晋级 / 降档提示（动画收尾时飘出）
  if (animDone && (c.promoted || c.demoted)) {
    ctx.font = 'bold 22px "PingFang SC", serif';
    ctx.fillStyle = c.promoted ? '#b87818' : '#a04828';
    ctx.fillText(c.promoted ? '★ 晋级！ ★' : '段位下降', cx, starsY + 58);
  }
}

// 结算页主绘制。tMs = 进入结算页后的毫秒数。
export function drawSettle(ctx: CanvasRenderingContext2D, c: RankChange, tMs: number) {
  const progress = Math.max(0, Math.min(1, (tMs - HOLD_MS) / ANIM_MS));

  ctx.save();
  drawSettleAtmosphere(ctx, c.won ? 'win' : 'lose');

  const panelH = 340;
  const panelX = (VIEW_W - PANEL_W) / 2;
  const panelY = VIEW_H * 0.22;
  const title = c.won ? '取得真经！' : '取经失败';
  const contentTop = drawSettlePanel(ctx, panelX, panelY, PANEL_W, panelH, c.won ? 'win' : 'lose', title);

  const cx = VIEW_W / 2;
  // 段位名 + 加/减星动画 + 晋级/降档提示（与 PvP 结算共用同一套绘制）
  drawRankChangeStars(ctx, c, progress, cx, contentTop + 18, contentTop + 88);

  const hint = progress >= 1 ? '点击任意处继续' : '点击跳过';
  drawSettleHint(ctx, hint, panelY + panelH - 28);

  ctx.restore();
}

// 无尽局结束展示数据（无星级变化，只展示波数/纪录/功德）。
export interface EndlessResult {
  wave: number;       // 本局抵达波数
  best: number;       // 历史最高波数（含本局）
  isNewRecord: boolean; // 本局是否破纪录
  merit: number;      // 本局获得功德
}

// 无尽结算屏：静态展示（不做加减星动画）。点击任意处即返回主菜单（由 main.ts 处理）。
export function drawEndlessSettle(ctx: CanvasRenderingContext2D, r: EndlessResult, _tMs: number): void {
  ctx.save();
  drawSettleAtmosphere(ctx, 'endless');

  const panelH = 360;
  const panelX = (VIEW_W - PANEL_W) / 2;
  const panelY = VIEW_H * 0.22;
  const contentTop = drawSettlePanel(ctx, panelX, panelY, PANEL_W, panelH, 'endless', '无尽 · 试炼结束');

  const cx = VIEW_W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 56px "PingFang SC", "STKaiti", serif';
  ctx.fillText(`第 ${r.wave} 波`, cx, contentTop + 48);

  if (r.isNewRecord) {
    ctx.fillStyle = '#c04820';
    ctx.font = 'bold 26px "PingFang SC", serif';
    ctx.fillText('★ 新纪录！★', cx, contentTop + 118);
  } else {
    ctx.fillStyle = '#7a6040';
    ctx.font = '20px "PingFang SC", serif';
    ctx.fillText(`历史最高：第 ${r.best} 波`, cx, contentTop + 118);
  }

  ctx.fillStyle = '#a07018';
  ctx.font = 'bold 22px "PingFang SC", serif';
  ctx.fillText(`功德 +${r.merit}`, cx, contentTop + 168);

  drawSettleHint(ctx, '点击任意处返回', panelY + panelH - 28);

  ctx.restore();
}

// —— PvP 在线对战结算（Task 11）——
// 与服务端 tick 下发 result.reason 契约串一一对应（见 pvp-client.ts 注释 + server/api_versus.py REASON 表）。
export interface PvpSettleResult {
  outcome: 'win' | 'lose' | 'draw';
  reason: string;
  opponent: { nickname: string | null; avatarId: string };
  /** 我方展示资料（main.ts 组装时带上；结算屏画「我 vs 对手」对阵卡——曾只有对手信息，
   *  「对手/你的」混排一眼分不清胜负，2026-09-03 改对阵式）。 */
  me?: { nickname: string | null; avatarId: string };
  // PvP 现也结算段位/功德（与单人一致的观感）：胜/负带 rankChange（复用加减星动画），平局为 null（不动段位）；
  // merit=本局获得功德，用于结算屏「功德+N」展示。实际写入/持久化/弹商人由 main.ts 落地。
  rankChange: RankChange | null;
  merit: number;
}

// Task 4 契约串（单点定义，防三处 magic string 漂移）：服务端在「我方唐僧死时对手正断线/未连」的
// 失败上下发此 reason；客户端据它免扣段位。此处与 main.ts 的 noPenalty 比较共用同一常量，
// 而下方 settle.pvp 单测钉住本串对应的中文文案 → 传递性地钉住 main.ts 分支比较的确切值（该分支无单测覆盖）。
export const REASON_SELF_TANGSENG_DEAD_OPP_GONE = 'selfTangsengDeadOppGone';

// reason 契约串 → 中文文案（纯函数，可单测）。解释「为什么结束」，与结算屏的段位/功德展示并列。
export function pvpReasonText(reason: string): string {
  switch (reason) {
    case 'opponentTangsengDead': return '对手唐僧被消灭';
    case 'selfTangsengDead': return '你的唐僧被消灭';
    // Task 4：我方唐僧死时对手正断线/未连 → 失败但不扣段位（对手跑路免扣）。
    case REASON_SELF_TANGSENG_DEAD_OPP_GONE: return '你的唐僧被消灭（对手掉线·不扣段位）';
    case 'opponentSurrender': return '对手认输';
    case 'selfSurrender': return '你已认输';
    case 'opponentDisconnectTimeout': return '对手掉线';
    case 'selfDisconnect': return '你已掉线';
    case 'draw': return '势均力敌';
    default: return '对局结束';
  }
}

// 标题：win/lose/draw 三态。
function pvpSettleTitle(outcome: PvpSettleResult['outcome']): string {
  if (outcome === 'win') return '胜利';
  if (outcome === 'lose') return '失败';
  return '平局';
}

// PvP 结算屏：**我 vs 对手对阵卡**（双方头像/昵称/胜负徽标并排，一眼看清谁赢谁输——
// 2026-09-03 用户反馈旧版只有对手信息、「对手/你的」混排分不清）+ 胜负原因行 + 段位星级
// 变化 + 功德 + 「返回首页」按钮（旧版小字「点击返回」不醒目）。复用卷轴骨架（屋顶+木框）
// 与单人同款加减星动画。按钮命中由 main.ts 按 pvpSettleReturnBtnRect 处理（仅按钮返回，
// 不再全屏任意点击——按钮更明确）。
export function drawPvpSettle(ctx: CanvasRenderingContext2D, r: PvpSettleResult, tMs: number): void {
  const tone: 'win' | 'lose' | 'endless' = r.outcome === 'win' ? 'win' : r.outcome === 'lose' ? 'lose' : 'endless';
  const rc = r.rankChange;
  const tierShift = !!rc && (rc.promoted || rc.demoted); // 晋级/降档要多留一行提示位
  ctx.save();
  drawSettleAtmosphere(ctx, tone);

  // 对阵区（头像+徽标）固定高；有段位变化面板更高（星排+晋级行），平局用矮面板
  const panelH = rc ? (tierShift ? 512 : 480) : 380;
  const panelX = (VIEW_W - PANEL_W) / 2;
  const panelY = VIEW_H * (rc ? 0.1 : 0.2);
  const title = pvpSettleTitle(r.outcome);
  const contentTop = drawSettlePanel(ctx, panelX, panelY, PANEL_W, panelH, tone, title);

  const cx = VIEW_W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // —— 对阵卡：左=我 / 右=对手，各带头像、昵称、胜负徽标 ——
  const me = r.me ?? { nickname: null, avatarId: '' };
  const vsY = contentTop + 8;
  const AV = 76; // 头像框边长
  const meX = cx - 108, oppX = cx + 108;
  const drawSide = (px: number, nickname: string | null, avatarId: string, badge: string, badgeColor: string, isMe: boolean) => {
    const a = avatarId ? avatarById(avatarId) : undefined;
    const spr = a ? sprite(a.art) : undefined;
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, vsY + AV / 2, AV / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,248,230,0.9)';
    ctx.fill();
    ctx.clip();
    if (spr) {
      const sc = Math.min(AV / spr.width, AV / spr.height);
      ctx.drawImage(spr, px - (spr.width * sc) / 2, vsY + AV - spr.height * sc, spr.width * sc, spr.height * sc);
    } else {
      ctx.fillStyle = '#a07018';
      ctx.font = 'bold 30px serif';
      ctx.fillText('?', px, vsY + AV / 2);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(120,90,40,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, vsY + AV / 2, AV / 2, 0, Math.PI * 2);
    ctx.stroke();
    // 昵称（我方缺省「你」；对手缺省「对手」——侧别由徽标与位置表达，不再前缀「对手：」）
    ctx.fillStyle = '#5a3a12';
    ctx.font = 'bold 18px "PingFang SC", "STKaiti", serif';
    ctx.fillText(nickname ?? (isMe ? '你' : '对手'), px, vsY + AV + 18);
    // 胜负徽标：绿「胜」/ 红「负」/ 黄「平」，大字一眼可辨
    const bw = 40, bh = 30;
    const bx = px - bw / 2, by = vsY + AV + 34;
    roundRect(ctx, bx, by, bw, bh, 7);
    ctx.fillStyle = badgeColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,248,230,0.75)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fff6e4';
    ctx.font = 'bold 17px "PingFang SC", "STKaiti", serif';
    ctx.fillText(badge, px, by + bh / 2 + 1);
  };
  const winColor = '#2f6a38', loseColor = '#8a3420', drawColor = '#8a6820';
  if (r.outcome === 'draw') {
    drawSide(meX, me.nickname, me.avatarId, '平', drawColor, true);
    drawSide(oppX, r.opponent.nickname, r.opponent.avatarId, '平', drawColor, false);
  } else {
    const iWon = r.outcome === 'win';
    drawSide(meX, me.nickname, me.avatarId, iWon ? '胜' : '负', iWon ? winColor : loseColor, true);
    drawSide(oppX, r.opponent.nickname, r.opponent.avatarId, iWon ? '负' : '胜', iWon ? loseColor : winColor, false);
  }
  // 中央 VS 分隔
  ctx.fillStyle = 'rgba(90,58,24,0.55)';
  ctx.font = 'bold 22px "PingFang SC", "STKaiti", serif';
  ctx.fillText('VS', cx, vsY + AV / 2);

  // —— 胜负原因（一行，主语明确：「对手掉线 / 你已掉线 / 对手唐僧被消灭…」）——
  const reasonY = vsY + 150;
  ctx.fillStyle = '#7a5230';
  ctx.font = '16px "PingFang SC", serif';
  ctx.fillText(`胜负判定：${pvpReasonText(r.reason)}`, cx, reasonY);

  // —— 段位星级变化（平局不动段位→跳过星排）+ 功德 +N ——
  let meritY = reasonY + 34;
  if (rc) {
    const progress = Math.max(0, Math.min(1, (tMs - HOLD_MS) / ANIM_MS));
    const rankNameY = reasonY + 38;
    const starsY = rankNameY + 46;
    drawRankChangeStars(ctx, rc, progress, cx, rankNameY, starsY, { gap: 50, size: 40 });
    meritY = starsY + (tierShift ? 86 : 54);
  }
  ctx.fillStyle = '#a07018';
  ctx.font = 'bold 22px "PingFang SC", serif';
  ctx.fillText(`功德 +${r.merit}`, cx, meritY);

  // —— 返回按钮（替代旧小字「点击返回」；命中见 pvpSettleReturnBtnRect）——
  drawInkActionButton(ctx, pvpSettleReturnBtnRect(r), '返回首页', false, 'primary');

  ctx.restore();
}

/** PvP 结算屏面板高度（绘制与命中共用，防两处布局常量漂移）。 */
export function pvpSettlePanelH(r: PvpSettleResult): number {
  const rc = r.rankChange;
  const tierShift = !!rc && (rc.promoted || rc.demoted);
  return rc ? (tierShift ? 512 : 480) : 380;
}

/** PvP 结算屏「返回首页」按钮矩形（命中测试与绘制共用，保证一致）。 */
export function pvpSettleReturnBtnRect(r: PvpSettleResult): { x: number; y: number; w: number; h: number } {
  const panelY = VIEW_H * (r.rankChange ? 0.1 : 0.2);
  const w = 200, h = 48;
  return { x: (VIEW_W - w) / 2, y: panelY + pvpSettlePanelH(r) - h - 20, w, h };
}
