// 段位星级结算页：胜/败后播放加星或减星动画，让玩家感知段位变化。
// 由 main.ts 在 screen==='settle' 时按帧调用 drawSettle，动画进度由「进入结算页的毫秒数」驱动。
import { VIEW_W, VIEW_H } from './render';
import { rankName, STARS_PER_TIER, type RankChange } from './rank';

// 动画时间线（毫秒）：先按变化前星态停顿，再播放加/减星，最后停在终态。
const HOLD_MS = 480; // 展示"变化前"星态的停顿
const ANIM_MS = 620; // 加星/减星过程
export const SETTLE_ANIM_MS = HOLD_MS + ANIM_MS;

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

// 画一颗五角星。fill=0 暗星，fill=1 亮金星；填充过程带缩放弹入。
function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, fill: number) {
  const spikes = 5;
  const outer = radius;
  const inner = radius * 0.44;
  const path = () => {
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (Math.PI / spikes) * i - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  // 暗底星（始终画）
  ctx.save();
  path();
  ctx.fillStyle = '#4a3d28';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.stroke();
  ctx.restore();

  if (fill <= 0.001) return;
  // 金星覆盖：透明度随 fill；正在点亮的星（0<fill<1）轻微放大 + 外发光
  const f = Math.min(1, fill);
  ctx.save();
  ctx.globalAlpha = f;
  const growing = fill > 0.02 && fill < 0.995;
  if (growing) {
    const scale = 1 + 0.18 * Math.sin(Math.min(1, fill) * Math.PI); // 中途最大、收尾回落
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    ctx.shadowColor = 'rgba(255,210,63,0.9)';
    ctx.shadowBlur = 16;
  }
  path();
  const g = ctx.createLinearGradient(cx, cy - outer, cx, cy + outer);
  g.addColorStop(0, '#ffe58a');
  g.addColorStop(1, '#f5b400');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#7a5a12';
  ctx.stroke();
  ctx.restore();
}

// 结算页主绘制。tMs = 进入结算页后的毫秒数。
export function drawSettle(ctx: CanvasRenderingContext2D, c: RankChange, tMs: number) {
  const progress = Math.max(0, Math.min(1, (tMs - HOLD_MS) / ANIM_MS));
  const eased = progress; // computeStars 内部对加星用了 easeOutBack，减星用线性

  // 背景遮罩
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const cx = VIEW_W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 结果标题
  ctx.font = 'bold 42px "PingFang SC", sans-serif';
  ctx.fillStyle = c.won ? '#7dff8a' : '#ff6a6a';
  ctx.fillText(c.won ? '取得真经！' : '取经失败', cx, VIEW_H * 0.3);

  // 段位名（晋级/降档在动画收尾时切到新名字，否则一直显示展示档名）
  const { tier, fills } = computeStars(c, eased);
  const animDone = progress >= 1;
  const showTier = c.won && c.promoted && animDone ? c.state.level
    : (!c.won && c.demoted ? c.state.level : tier);
  ctx.font = 'bold 30px "PingFang SC", sans-serif';
  ctx.fillStyle = '#ffe6b0';
  ctx.fillText(rankName(showTier), cx, VIEW_H * 0.42);

  // 一排 5 颗星
  const r = 26;
  const gap = 16;
  const total = STARS_PER_TIER * (r * 2) + (STARS_PER_TIER - 1) * gap;
  let sx = cx - total / 2 + r;
  const sy = VIEW_H * 0.52;
  // 晋级动画放完后，星排展示新档（0 星）；此前展示补满过程
  const drawFills = c.won && c.promoted && animDone ? new Array<number>(STARS_PER_TIER).fill(0) : fills;
  for (let i = 0; i < STARS_PER_TIER; i++) {
    drawStar(ctx, sx, sy, r, drawFills[i]!);
    sx += r * 2 + gap;
  }

  // 晋级 / 降档提示（动画收尾时飘出）
  if (animDone && (c.promoted || c.demoted)) {
    ctx.font = 'bold 22px "PingFang SC", sans-serif';
    ctx.fillStyle = c.promoted ? '#ffd23f' : '#ff9a6a';
    ctx.fillText(c.promoted ? '★ 晋级！ ★' : '段位下降', cx, VIEW_H * 0.62);
  }

  // 底部操作提示
  ctx.font = '16px "PingFang SC", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  const hint = animDone ? '点击任意处继续' : '点击跳过';
  ctx.fillText(hint, cx, VIEW_H * 0.72);

  ctx.restore();
}
