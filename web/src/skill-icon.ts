// 技能图标绘制：优先 Seedream 小图，失败/未加载则回退汉字字形。
import { sprite } from './assets';

/** 技能 id（act_palm / zhuwang）→ 资源 key（skill-act-palm） */
export function skillAssetKey(skillId: string): string {
  return `skill-${skillId.replace(/_/g, '-')}`;
}

/** 在圆形徽章上绘制技能图标（有图用图，否则汉字） */
export function drawSkillGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  icon: string,
  accent: string,
  ready = true,
  skillId?: string,
): void {
  const img = skillId ? sprite(skillAssetKey(skillId)) : undefined;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (img) {
    ctx.save();
    ctx.clip();
    // 浅底托住透明 PNG
    ctx.fillStyle = ready ? 'rgba(255,244,224,0.92)' : 'rgba(160,150,140,0.55)';
    ctx.fill();
    const pad = r * 0.18;
    const size = (r - pad) * 2;
    ctx.globalAlpha = ready ? 1 : 0.55;
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = ready ? 'rgba(255,232,180,0.75)' : 'rgba(200,190,170,0.4)';
    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.stroke();
    return;
  }

  // fallback：高对比汉字
  const g = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.1, cx, cy, r);
  if (ready) {
    g.addColorStop(0, '#fff4e0');
    g.addColorStop(0.55, accent);
    g.addColorStop(1, '#3a2810');
  } else {
    g.addColorStop(0, '#b0a898');
    g.addColorStop(1, '#4a3f30');
  }
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = ready ? 'rgba(255,232,180,0.75)' : 'rgba(200,190,170,0.4)';
  ctx.lineWidth = Math.max(1.5, r * 0.08);
  ctx.stroke();

  const glyph = icon.trim().slice(0, 2) || '?';
  ctx.fillStyle = ready ? '#2a1808' : '#5a5048';
  ctx.font = `bold ${Math.round(r * (glyph.length > 1 ? 0.85 : 1.15))}px "PingFang SC", "Songti SC", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = ready ? 'rgba(255,248,230,0.55)' : 'rgba(255,255,255,0.15)';
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.strokeText(glyph, cx, cy + 0.5);
  ctx.fillText(glyph, cx, cy + 0.5);
}
