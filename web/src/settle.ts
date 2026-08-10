// 段位星级结算弹层：胜/败后叠在战斗页上播放加星或减星动画。
// 由 main.ts 在战斗页 isSettleOpen 时按帧调用，动画进度由「打开弹层的毫秒数」驱动。
import { VIEW_W, VIEW_H } from './render';
import { rankName, STARS_PER_TIER, type RankChange } from './rank';
import { drawRankStarsAnimated, roundRect } from './menu-ui';

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
  if (tone === 'win') ctx.fillStyle = 'rgba(28, 36, 22, 0.52)';
  else if (tone === 'lose') ctx.fillStyle = 'rgba(36, 18, 16, 0.55)';
  else ctx.fillStyle = 'rgba(28, 22, 14, 0.52)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

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
  // 投影
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  roundRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = '#e8d9b8';
  ctx.fill();
  ctx.restore();

  // 宣纸渐变
  roundRect(ctx, x, y, w, h, 16);
  const body = ctx.createLinearGradient(x, y, x, y + h);
  body.addColorStop(0, '#f3e8d0');
  body.addColorStop(0.55, '#e6d4b0');
  body.addColorStop(1, '#d8c294');
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,60,30,0.55)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 内金线
  roundRect(ctx, x + 7, y + 7, w - 14, h - 14, 12);
  ctx.strokeStyle = 'rgba(180,140,90,0.4)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 标题条
  const headH = 56;
  roundRect(ctx, x, y, w, headH, 16);
  const head = ctx.createLinearGradient(x, y, x, y + headH);
  if (headTone === 'win') {
    head.addColorStop(0, '#2f6a38');
    head.addColorStop(1, '#1d4524');
  } else if (headTone === 'lose') {
    head.addColorStop(0, '#8a4020');
    head.addColorStop(1, '#5a2810');
  } else {
    head.addColorStop(0, '#8a6820');
    head.addColorStop(1, '#5a4210');
  }
  ctx.fillStyle = head;
  ctx.fill();
  // 盖住标题条下沿圆角，与面板齐平
  ctx.fillRect(x, y + headH - 16, w, 16);

  ctx.fillStyle = '#fff4e0';
  ctx.font = 'bold 28px "PingFang SC", "STKaiti", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  ctx.fillText(title, x + w / 2, y + headH / 2);
  ctx.shadowBlur = 0;

  // 标题条底金线
  ctx.strokeStyle = 'rgba(255,220,160,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 18, y + headH - 1);
  ctx.lineTo(x + w - 18, y + headH - 1);
  ctx.stroke();

  return y + headH + 22;
}

function drawSettleHint(ctx: CanvasRenderingContext2D, text: string, y: number): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '15px "PingFang SC", serif';
  ctx.fillStyle = 'rgba(70,48,24,0.55)';
  ctx.fillText(text, VIEW_W / 2, y);
}

// 结算页主绘制。tMs = 进入结算页后的毫秒数。
export function drawSettle(ctx: CanvasRenderingContext2D, c: RankChange, tMs: number) {
  const progress = Math.max(0, Math.min(1, (tMs - HOLD_MS) / ANIM_MS));
  const eased = progress; // computeStars 内部对加星用了 easeOutBack，减星用线性

  ctx.save();
  drawSettleAtmosphere(ctx, c.won ? 'win' : 'lose');

  const panelH = 340;
  const panelX = (VIEW_W - PANEL_W) / 2;
  const panelY = VIEW_H * 0.22;
  const title = c.won ? '取得真经！' : '取经失败';
  const contentTop = drawSettlePanel(ctx, panelX, panelY, PANEL_W, panelH, c.won ? 'win' : 'lose', title);

  const cx = VIEW_W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 段位名（晋级/降档在动画收尾时切到新名字，否则一直显示展示档名）
  const { tier, fills } = computeStars(c, eased);
  const animDone = progress >= 1;
  const showTier = c.won && c.promoted && animDone ? c.state.level
    : (!c.won && c.demoted ? c.state.level : tier);

  ctx.font = 'bold 20px "PingFang SC", "STKaiti", serif';
  ctx.fillStyle = '#5a3a12';
  ctx.fillText(`境界 · ${rankName(showTier)}`, cx, contentTop + 18);

  // 水墨星星排（透明底立绘，fills 驱动空↔满叠化）
  const sy = contentTop + 88;
  const drawFills = c.won && c.promoted && animDone ? new Array<number>(STARS_PER_TIER).fill(0) : fills;
  // 星下淡金光晕，衬托无底板的星星
  ctx.save();
  const glow = ctx.createRadialGradient(cx, sy, 10, cx, sy, 140);
  glow.addColorStop(0, 'rgba(210,160,60,0.18)');
  glow.addColorStop(1, 'rgba(210,160,60,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 160, sy - 50, 320, 100);
  ctx.restore();
  drawRankStarsAnimated(ctx, cx, sy, drawFills, { gap: 58, size: 46 });

  // 晋级 / 降档提示（动画收尾时飘出）
  if (animDone && (c.promoted || c.demoted)) {
    ctx.font = 'bold 22px "PingFang SC", serif';
    ctx.fillStyle = c.promoted ? '#b87818' : '#a04828';
    ctx.fillText(c.promoted ? '★ 晋级！ ★' : '段位下降', cx, sy + 58);
  }

  const hint = animDone ? '点击任意处继续' : '点击跳过';
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
