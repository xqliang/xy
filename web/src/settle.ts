// 段位星级结算弹层：胜/败后叠在战斗页上播放加星或减星动画。
// 由 main.ts 在战斗页 isSettleOpen 时按帧调用，动画进度由「打开弹层的毫秒数」驱动。
import { VIEW_W, VIEW_H, fillViewScrim } from './render';
import { rankName, STARS_PER_TIER, type RankChange } from './rank';
import { drawRankStarsAnimated, roundRect, drawInkPopupRoof, drawInkPopupBody, INK_POPUP_HEAD_H } from './menu-ui';
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

// PvP 结算屏：结果 + 对手信息 + 段位星级变化 + 功德+N（段位/功德已由 main.ts 结算落地）。
// 标题条色调沿用单人（win 绿 / lose 赭红 / draw 黄），复用卷轴骨架与单人同款加减星动画。
// 平局不动段位（rankChange=null）→ 只展示对手信息 + 参与功德，用矮面板。点击返回由 main.ts 在动画完成后处理。
export function drawPvpSettle(ctx: CanvasRenderingContext2D, r: PvpSettleResult, tMs: number): void {
  const tone: 'win' | 'lose' | 'endless' = r.outcome === 'win' ? 'win' : r.outcome === 'lose' ? 'lose' : 'endless';
  const rc = r.rankChange;
  const tierShift = !!rc && (rc.promoted || rc.demoted); // 晋级/降档要多留一行提示位
  ctx.save();
  drawSettleAtmosphere(ctx, tone);

  // 有段位变化时面板更高（容纳星排 + 功德）；平局/无变化用矮面板并下移居中
  const panelH = rc ? (tierShift ? 456 : 424) : 320;
  const panelX = (VIEW_W - PANEL_W) / 2;
  const panelY = VIEW_H * (rc ? 0.15 : 0.24);
  const title = pvpSettleTitle(r.outcome);
  const contentTop = drawSettlePanel(ctx, panelX, panelY, PANEL_W, panelH, tone, title);

  const cx = VIEW_W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // —— 对手头像（圆形裁剪 + 底部对齐，与 profile-popup 一致）——
  const a = avatarById(r.opponent.avatarId);
  const spr = a ? sprite(a.art) : undefined;
  const AV = 92; // 头像框边长（比旧版略小，给下方段位/功德让位）
  const avY = contentTop;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, avY + AV / 2, AV / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,248,230,0.9)';
  ctx.fill();
  ctx.clip();
  if (spr) {
    const sc = Math.min(AV / spr.width, AV / spr.height);
    ctx.drawImage(spr, cx - (spr.width * sc) / 2, avY + AV - spr.height * sc, spr.width * sc, spr.height * sc);
  } else {
    ctx.fillStyle = '#a07018';
    ctx.font = 'bold 36px serif';
    ctx.fillText('?', cx, avY + AV / 2);
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(120,90,40,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, avY + AV / 2, AV / 2, 0, Math.PI * 2);
  ctx.stroke();

  // 对手昵称 + 终局原因
  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 20px "PingFang SC", "STKaiti", serif';
  ctx.fillText(`对手：${r.opponent.nickname ?? '对手'}`, cx, avY + AV + 20);
  ctx.fillStyle = '#7a5230';
  ctx.font = '16px "PingFang SC", serif';
  ctx.fillText(pvpReasonText(r.reason), cx, avY + AV + 44);

  // —— 段位星级变化（平局不动段位→跳过星排）+ 功德+N ——
  let meritY = avY + AV + 84;
  if (rc) {
    const progress = Math.max(0, Math.min(1, (tMs - HOLD_MS) / ANIM_MS));
    const rankNameY = avY + AV + 78;
    const starsY = rankNameY + 46;
    drawRankChangeStars(ctx, rc, progress, cx, rankNameY, starsY, { gap: 50, size: 40 });
    meritY = starsY + (tierShift ? 86 : 54);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#a07018';
  ctx.font = 'bold 22px "PingFang SC", serif';
  ctx.fillText(`功德 +${r.merit}`, cx, meritY);

  drawSettleHint(ctx, isSettleAnimDone(tMs) ? '点击返回' : '点击跳过', panelY + panelH - 26);

  ctx.restore();
}
