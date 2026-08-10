// 启动资源加载页：纸色底 + 品牌标题 + 进度条，避免素材未就绪时首页「空洞/错位」。
import { VIEW_W, VIEW_H } from './render';
import { sprite, type AssetLoadProgress } from './assets';
import { roundRect } from './menu-ui';
import { drawMenuTitle } from './menu';

const PAPER_TOP = '#f0e4c8';
const PAPER_MID = '#dec18e';
const PAPER_LOW = '#d4b878';
const PAPER_BOTTOM = '#c8a068';

function drawPaper(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, PAPER_TOP);
  g.addColorStop(0.38, PAPER_MID);
  g.addColorStop(0.72, PAPER_LOW);
  g.addColorStop(1, PAPER_BOTTOM);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

/** 延迟期内占位：同色纸底，无标题/进度，避免缓存命中时闪进度页 */
export function drawLoadingBackdrop(ctx: CanvasRenderingContext2D): void {
  drawPaper(ctx);
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

  // 若首页背景已到位，淡淡铺一层，减少「纯色→正式首页」跳变
  const home = sprite('menu-home');
  if (home) {
    ctx.save();
    ctx.globalAlpha = 0.42;
    const scale = Math.max(VIEW_W / home.width, VIEW_H / home.height);
    const dw = home.width * scale;
    const dh = home.height * scale;
    ctx.drawImage(home, (VIEW_W - dw) / 2, (VIEW_H - dh) / 2, dw, dh);
    ctx.restore();
    ctx.fillStyle = 'rgba(240, 228, 200, 0.38)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

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
  const barY = VIEW_H * 0.62;
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

  ctx.fillStyle = 'rgba(72, 42, 14, 0.4)';
  ctx.font = '12px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('取经路漫漫，正在收拾行囊…', VIEW_W / 2, VIEW_H * 0.82);
}
