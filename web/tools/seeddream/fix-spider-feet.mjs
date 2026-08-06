// 修复 monster-minion-pansidong.png（三件事，均不动眼睛/牙/身体紫黑）：
//  1) 保留白色蛛丝细线：用「腐蚀」判定——只清除大面积白色内部（下腹填充），细线邻域白占比低 → 保留。
//  2) 下腹/脚间白色填充 → 透明。
//  3) 脚下及两侧灰色投影块（低饱和灰、下部）→ 透明。
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = '/Users/jyxc-dz-0100360/work/fun/xy/web/src/game-assets';
const file = 'monster-minion-pansidong.png';
const b64 = readFileSync(path.join(DIR, file)).toString('base64');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const res = await page.evaluate(async (src) => {
  const img = new Image();
  await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = src; });
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const p = data.data;
  const A = (x, y) => p[(y * w + x) * 4 + 3];
  const white = (x, y) => {
    const i = (y * w + x) * 4;
    const r = p[i], g = p[i + 1], b = p[i + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return A(x, y) > 150 && mn >= 200 && mx - mn <= 34;
  };
  // 1)+2) 下腹白色填充腐蚀清除（保留细蛛丝线）
  const x0 = Math.floor(w * 0.24), x1 = Math.floor(w * 0.72);
  const y0 = Math.floor(h * 0.64), y1 = Math.floor(h * 0.95);
  const clearMask = new Uint8Array(w * h);
  const R = 3, area = (2 * R + 1) * (2 * R + 1);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!white(x, y)) continue;
      let cnt = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && white(nx, ny)) cnt++;
      }
      if (cnt / area >= 0.66) clearMask[y * w + x] = 1; // 大面积白内部 → 属于填充块
    }
  }
  // 膨胀 1px：把填充块紧邻的白边也带走，避免残留白环（但不会波及远处细线）
  const dil = clearMask.slice();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (clearMask[y * w + x]) continue;
    if (!white(x, y)) continue;
    if (clearMask[y * w + x + 1] || clearMask[y * w + x - 1] || clearMask[(y + 1) * w + x] || clearMask[(y - 1) * w + x]) dil[y * w + x] = 1;
  }
  let cleared = 0;
  for (let k = 0; k < w * h; k++) if (dil[k]) { p[k * 4 + 3] = 0; cleared++; }

  // 3) 灰色投影块（下部、低饱和灰、非纯白细线、非深色身体）→ 透明
  let shadow = 0;
  for (let y = Math.floor(h * 0.78); y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (p[i + 3] === 0) continue;
      const r = p[i], g = p[i + 1], b = p[i + 2];
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      // 灰：低饱和；亮度中高但不是纯白蛛丝(>=244)；排除深色身体(<120)
      const avg = (r + g + b) / 3;
      if (mx - mn <= 24 && avg >= 120 && avg < 244) { p[i + 3] = 0; shadow++; }
    }
  }
  ctx.putImageData(data, 0, 0);
  return JSON.stringify({ png: cv.toDataURL('image/png').split(',')[1], cleared, shadow });
}, `data:image/png;base64,${b64}`);
await browser.close();
const { png, cleared, shadow } = JSON.parse(res);
writeFileSync(path.join(DIR, file), Buffer.from(png, 'base64'));
console.log(`✅ ${file}: 下腹白填充 -> 透明 ${cleared}px；灰色投影 -> 透明 ${shadow}px；蛛丝细线保留`);
