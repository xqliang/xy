import type { VersusMatchResult, VersusSessionReport } from '../versus-user-agent';
import type { SimProgress } from './sim-runner';

/** 胜/负/超时饼图（简化环形） */
export function drawOutcomeChart(
  canvas: HTMLCanvasElement,
  wins: number,
  losses: number,
  timeouts: number,
): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 280;
  const cssH = canvas.clientHeight || 200;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(0, 0, cssW, cssH);

  const total = wins + losses + timeouts;
  const cx = cssW * 0.38;
  const cy = cssH / 2;
  const R = Math.min(cssW, cssH) * 0.32;
  if (total <= 0) {
    ctx.fillStyle = '#6a5a40';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText('暂无数据', 12, 24);
    return;
  }

  const slices: { n: number; color: string; label: string }[] = [
    { n: wins, color: '#3a8a48', label: `胜 ${wins}` },
    { n: losses, color: '#b84a3a', label: `负 ${losses}` },
    { n: timeouts, color: '#8a7a50', label: `超时 ${timeouts}` },
  ];
  let angle = -Math.PI / 2;
  for (const s of slices) {
    if (s.n <= 0) continue;
    const sweep = (s.n / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    angle += sweep;
  }
  // 中心挖空
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a2e1c';
  ctx.font = 'bold 13px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const wr = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) : '—';
  ctx.fillText(`${wr}%`, cx, cy);

  ctx.textAlign = 'left';
  ctx.font = '12px "PingFang SC", sans-serif';
  let ly = 28;
  for (const s of slices) {
    ctx.fillStyle = s.color;
    ctx.fillRect(cssW * 0.68, ly - 8, 10, 10);
    ctx.fillStyle = '#3a2e1c';
    ctx.fillText(s.label, cssW * 0.68 + 16, ly);
    ly += 22;
  }
}

/** 逐局累计胜率折线 + 目标线 */
export function drawWinRateSeries(
  canvas: HTMLCanvasElement,
  results: VersusMatchResult[],
  targetWinRate: number,
): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 400;
  const cssH = canvas.clientHeight || 200;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(0, 0, cssW, cssH);

  const padL = 36;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;

  // 网格
  ctx.strokeStyle = 'rgba(138,106,58,0.2)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillStyle = '#6a5a40';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${100 - i * 25}%`, padL - 4, y + 3);
  }

  // 目标线
  const ty = padT + plotH * (1 - targetWinRate);
  ctx.strokeStyle = '#c08020';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padL, ty);
  ctx.lineTo(padL + plotW, ty);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#c08020';
  ctx.font = '10px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`目标 ${(targetWinRate * 100).toFixed(0)}%`, padL + 4, ty - 4);

  if (results.length === 0) {
    ctx.fillStyle = '#6a5a40';
    ctx.fillText('等待模拟…', padL + 8, padT + 20);
    return;
  }

  let w = 0;
  let d = 0;
  const points: { x: number; y: number; rate: number }[] = [];
  for (let i = 0; i < results.length; i++) {
    const o = results[i]!.outcome;
    if (o === 'won') { w++; d++; }
    else if (o === 'lost') { d++; }
    const rate = d > 0 ? w / d : 0;
    const x = padL + (plotW * (i + 1)) / Math.max(1, results.length);
    const y = padT + plotH * (1 - rate);
    points.push({ x, y, rate });
  }

  ctx.strokeStyle = '#3a6b4a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();

  const last = points[points.length - 1]!;
  ctx.fillStyle = '#3a2e1c';
  ctx.font = '11px "PingFang SC", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`累计 ${(last.rate * 100).toFixed(1)}% · n=${results.length}`, cssW - padR, cssH - 8);
}

/** 波次直方图 */
export function drawWaveHistogram(canvas: HTMLCanvasElement, results: VersusMatchResult[]): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 400;
  const cssH = canvas.clientHeight || 180;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(0, 0, cssW, cssH);

  if (results.length === 0) {
    ctx.fillStyle = '#6a5a40';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText('暂无波次数据', 12, 24);
    return;
  }

  const hist = new Map<number, number>();
  for (const r of results) hist.set(r.wave, (hist.get(r.wave) ?? 0) + 1);
  const waves = [...hist.keys()].sort((a, b) => a - b);
  const maxN = Math.max(...hist.values(), 1);
  const padL = 28;
  const padR = 10;
  const padT = 12;
  const padB = 28;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;
  const barW = plotW / waves.length;

  waves.forEach((w, i) => {
    const n = hist.get(w)!;
    const h = (plotH * n) / maxN;
    const x = padL + i * barW;
    const y = padT + plotH - h;
    ctx.fillStyle = '#4a5a8a';
    ctx.fillRect(x + 2, y, Math.max(2, barW - 4), h);
    ctx.fillStyle = '#3a2e1c';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(w), x + barW / 2, cssH - 10);
    if (barW > 14) ctx.fillText(String(n), x + barW / 2, y - 2);
  });
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6a5a40';
  ctx.font = '11px "PingFang SC", sans-serif';
  ctx.fillText('终局波次分布', 8, 14);
}

/** AI skill 轨迹 */
export function drawAiSkillSeries(
  canvas: HTMLCanvasElement,
  results: VersusMatchResult[],
  skillStart: number,
): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 400;
  const cssH = canvas.clientHeight || 160;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(0, 0, cssW, cssH);

  const padL = 36;
  const padR = 12;
  const padT = 16;
  const padB = 24;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;
  const lo = 0.72;
  const hi = 1.8;

  ctx.strokeStyle = 'rgba(138,106,58,0.2)';
  for (let i = 0; i <= 3; i++) {
    const y = padT + (plotH * i) / 3;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    const v = hi - ((hi - lo) * i) / 3;
    ctx.fillStyle = '#6a5a40';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(v.toFixed(2), padL - 4, y + 3);
  }

  if (results.length === 0) return;

  // 用 match 后 skill 近似：逐局用 baseAiSkill 序列 + 终点；更直观画每局 matchAiSkill
  ctx.strokeStyle = '#6b4a22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  results.forEach((r, i) => {
    const x = padL + (plotW * (i + 1)) / results.length;
    const t = (r.matchAiSkill - lo) / (hi - lo);
    const y = padT + plotH * (1 - Math.max(0, Math.min(1, t)));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const sy = padT + plotH * (1 - (skillStart - lo) / (hi - lo));
  ctx.strokeStyle = '#c08020';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(padL, sy);
  ctx.lineTo(padL + plotW, sy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#6a5a40';
  ctx.font = '11px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('本局 effective AI skill', 8, 14);
}

export function summarizeProgress(p: SimProgress, target: number): string {
  return `进度 ${p.done}/${p.total} · 胜${p.wins}/负${p.losses}/超时${p.timeouts} · `
    + `胜率 ${(p.runningWinRate * 100).toFixed(1)}%（目标 ${(target * 100).toFixed(0)}%）· AI ${p.aiSkill.toFixed(3)}`;
}

export function summarizeReport(r: VersusSessionReport): string {
  return `完成 ${r.games} 局 · 胜率 ${(r.playerWinRate * 100).toFixed(1)}% · `
    + `AI ${r.aiSkillStart.toFixed(3)}→${r.aiSkillEnd.toFixed(3)} · `
    + `平衡 ${r.balanceOk ? '通过' : '未通过'}`;
}
