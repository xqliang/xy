// 启动资源加载页：纸色底 + 矢量山水远景 + 唐僧骑马沿路缓步行走（动画）+ 品牌标题 + 进度条。
// 山水为纯 canvas 矢量绘制（0 额外资源）；唐僧骑马用离线生成的透明 PNG 'loading-tangseng'（~33KB，
// 由 loadAssets 优先加载，进度页一出现即可播放行走动画；未就绪时只画山水，不报错）。
import { VIEW_W, VIEW_H } from './render';
import { sprite, type AssetLoadProgress } from './assets';
import { roundRect } from './menu-ui';
import { drawMenuTitle } from './menu';

const PAPER_TOP = '#f0e4c8';
const PAPER_MID = '#dec18e';
const PAPER_LOW = '#d4b878';
const PAPER_BOTTOM = '#c8a068';

// 场景关键高度（相对 VIEW_H 的比例）：远山落在地平线上，唐僧沿更靠下的「取经路」行走。
const HORIZON_Y = VIEW_H * 0.66; // 远山山脚 / 地平线
const ROAD_Y = VIEW_H * 0.76; // 唐僧骑马落脚的路面基准线

function drawPaper(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, PAPER_TOP);
  g.addColorStop(0.38, PAPER_MID);
  g.addColorStop(0.72, PAPER_LOW);
  g.addColorStop(1, PAPER_BOTTOM);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

/** 画一条起伏的山脊剪影：以 baseY 为山脚，用若干正弦叠加成简洁的连绵山形。 */
function drawMountainRange(
  ctx: CanvasRenderingContext2D,
  baseY: number,
  height: number,
  color: string,
  phase: number,
  waves: number,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  const step = 8;
  for (let x = 0; x <= VIEW_W; x += step) {
    // 两个不同频率的正弦叠加，山形更自然、不呆板
    const t = x / VIEW_W;
    const y =
      baseY -
      height *
        (0.55 + 0.45 * Math.sin(t * Math.PI * waves + phase)) *
        (0.7 + 0.3 * Math.sin(t * Math.PI * (waves * 2.3) + phase * 1.7));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(VIEW_W, baseY);
  ctx.closePath();
  ctx.fill();
}

/** 画一朵简洁的云：几个交叠圆形。 */
function drawCloud(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.6, 0, Math.PI * 2);
  ctx.arc(cx + s * 0.7, cy + s * 0.1, s * 0.5, 0, Math.PI * 2);
  ctx.arc(cx - s * 0.7, cy + s * 0.12, s * 0.45, 0, Math.PI * 2);
  ctx.arc(cx + s * 0.1, cy + s * 0.28, s * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

/** 画一丛草：从根部向上散开几根短线。 */
function drawGrass(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  ctx.strokeStyle = 'rgba(104,140,66,0.7)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + i * h * 0.35, y - h * 0.6, x + i * h * 0.7, y - h);
    ctx.stroke();
  }
}

/** 画一朵小花：花心 + 花瓣点。 */
function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * 2.4, y + Math.sin(a) * 2.4, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#f6d24a';
  ctx.beginPath();
  ctx.arc(x, y, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

// 草丛与花的固定位置（沿路面散布，两侧留白避开进度文字区）。x 为绝对坐标。
const GRASS_SPOTS = [30, 78, 120, 300, 366, 430, 500, 536];
const FLOWER_SPOTS: { x: number; dy: number; color: string }[] = [
  { x: 56, dy: 4, color: '#e2657a' },
  { x: 108, dy: -2, color: '#c77dff' },
  { x: 344, dy: 2, color: '#f2a0b4' },
  { x: 470, dy: -3, color: '#e2657a' },
  { x: 524, dy: 3, color: '#c77dff' },
];

/** 矢量山水远景：太阳 + 云 + 两层远山 + 地面色带 + 草花。now 用于云的缓慢漂移。 */
function drawScenery(ctx: CanvasRenderingContext2D, now: number): void {
  ctx.save();

  // 暖阳：右上角一团柔和光晕
  const sunX = VIEW_W * 0.74;
  const sunY = VIEW_H * 0.18;
  const sun = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 70);
  sun.addColorStop(0, 'rgba(255,240,190,0.85)');
  sun.addColorStop(1, 'rgba(255,240,190,0)');
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 70, 0, Math.PI * 2);
  ctx.fill();

  // 缓慢漂移的云（横向循环）
  ctx.fillStyle = 'rgba(255,252,240,0.5)';
  const drift = (now / 90) % (VIEW_W + 160);
  drawCloud(ctx, ((drift + 60) % (VIEW_W + 160)) - 80, VIEW_H * 0.13, 26);
  drawCloud(ctx, ((drift + 340) % (VIEW_W + 160)) - 80, VIEW_H * 0.22, 20);

  // 两层远山：远浅近深，冷调水墨与暖纸底形成经典山水对比
  drawMountainRange(ctx, HORIZON_Y, VIEW_H * 0.16, 'rgba(126,150,150,0.30)', 1.1, 3);
  drawMountainRange(ctx, HORIZON_Y + 6, VIEW_H * 0.11, 'rgba(96,126,120,0.42)', 2.4, 4);

  // 地平线以下轻微压暗，暗示大地/草坡
  const ground = ctx.createLinearGradient(0, HORIZON_Y, 0, VIEW_H);
  ground.addColorStop(0, 'rgba(120,110,70,0.05)');
  ground.addColorStop(1, 'rgba(110,90,50,0.16)');
  ctx.fillStyle = ground;
  ctx.fillRect(0, HORIZON_Y, VIEW_W, VIEW_H - HORIZON_Y);

  // 取经路：路面基准线附近一条柔和的浅色土路带
  ctx.fillStyle = 'rgba(206,168,110,0.35)';
  ctx.fillRect(0, ROAD_Y - 4, VIEW_W, 16);

  // 沿路草花点缀
  for (const gx of GRASS_SPOTS) drawGrass(ctx, gx, ROAD_Y + 10, 12);
  for (const f of FLOWER_SPOTS) drawFlower(ctx, f.x, ROAD_Y + 8 + f.dy, f.color);

  ctx.restore();
}

/** 唐僧骑马：沿路面从左向右缓步行走，带轻微步态起伏；走出右侧后从左侧循环入场。 */
function drawWalkingMonk(ctx: CanvasRenderingContext2D, now: number): void {
  const img = sprite('loading-tangseng');
  if (!img || !img.width) return;

  const drawH = 104;
  const drawW = drawH * (img.width / img.height);
  const period = 11000; // 走完全程约 11s，缓慢从容
  const t = (now % period) / period;
  const startX = -drawW - 24;
  const endX = VIEW_W + 24;
  const x = startX + (endX - startX) * t;
  const bob = Math.sin(now / 160) * 3; // 步态上下起伏
  const footY = ROAD_Y;
  const topY = footY - drawH + bob;

  // 脚下淡影（随起伏轻微缩放）
  ctx.save();
  ctx.globalAlpha = 0.14 - bob * 0.01;
  ctx.fillStyle = '#3a2a12';
  ctx.beginPath();
  ctx.ellipse(x + drawW / 2, footY + 6, drawW * 0.32, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 当前素材（round2 版）马头朝右，行进方向也是从左到右（马头朝前），直接画即可；
  // 曾对「马头朝左」的旧素材做水平镜像，现素材已朝右，镜像会把它翻成朝左（像倒着走），故移除。
  ctx.drawImage(img, x, topY, drawW, drawH);
}

/** 延迟期内占位：纸底 + 静态山水（不画标题/进度），避免缓存命中时闪进度页。 */
export function drawLoadingBackdrop(ctx: CanvasRenderingContext2D): void {
  drawPaper(ctx);
  drawScenery(ctx, 0);
}

function phaseLabel(phase: AssetLoadProgress['phase']): string {
  switch (phase) {
    case 'images':
      return '加载立绘与地图…';
    case 'audio':
      return '准备背景音乐…';
    case 'done':
      return '即将进入';
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

/** 绘制启动加载页；progress.total=0 时画不确定进度。 */
export function drawLoadingScreen(
  ctx: CanvasRenderingContext2D,
  progress: AssetLoadProgress,
  now = performance.now(),
): void {
  drawPaper(ctx);
  drawScenery(ctx, now);

  // 与主界面同款标题：bold 46px 宋体 + 双描边金字渐变（alphabetic baseline）
  const titleY = VIEW_H * 0.28;
  drawMenuTitle(ctx, '大圣与唐僧', VIEW_W / 2, titleY);

  const pulse = 0.5 + 0.5 * Math.sin(now / 420);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(90, 58, 18, ${0.55 + pulse * 0.35})`;
  ctx.font = '16px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(phaseLabel(progress.phase), VIEW_W / 2, titleY + 52);

  const barW = Math.min(320, VIEW_W - 80);
  const barH = 12;
  const barX = (VIEW_W - barW) / 2;
  const barY = VIEW_H * 0.6;
  const ratio =
    progress.total > 0
      ? Math.max(0, Math.min(1, progress.loaded / progress.total))
      : (now / 1200) % 1;

  ctx.fillStyle = 'rgba(72, 42, 14, 0.18)';
  roundRect(ctx, barX, barY, barW, barH, 6);
  ctx.fill();

  if (progress.total > 0) {
    ctx.fillStyle = '#8b5a24';
    roundRect(ctx, barX, barY, Math.max(barH, barW * ratio), barH, 6);
    ctx.fill();
  } else {
    const sweep = barW * 0.28;
    const x = barX + (barW - sweep) * ratio;
    ctx.fillStyle = '#8b5a24';
    roundRect(ctx, x, barY, sweep, barH, 6);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(72, 42, 14, 0.72)';
  ctx.font = '14px "PingFang SC", "Microsoft YaHei", sans-serif';
  if (progress.total > 0 && progress.phase === 'images') {
    ctx.fillText(`${progress.loaded} / ${progress.total}`, VIEW_W / 2, barY + 28);
  } else if (progress.phase === 'audio') {
    ctx.fillText('音频解码中', VIEW_W / 2, barY + 28);
  }

  // 唐僧骑马行走动画（在山水之上、路面之下侧的前景）
  drawWalkingMonk(ctx, now);

  ctx.fillStyle = 'rgba(72, 42, 14, 0.5)';
  ctx.font = '12px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('取经路漫漫，正在收拾行囊…', VIEW_W / 2, VIEW_H * 0.86);
}
