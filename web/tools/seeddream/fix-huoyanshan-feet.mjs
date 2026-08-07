// 修复火焰山小怪/Boss 脚底：灰色投影 + 底部白晕 → 透明（不动上半身白角/白牙/白眼）。
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = '/Users/jyxc-dz-0100360/work/fun/xy/web/src/game-assets';
const FILES = ['monster-minion-huoyanshan.png', 'monster-boss-huoyanshan.png'];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();

for (const file of FILES) {
  const b64 = readFileSync(path.join(DIR, file)).toString('base64');
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
    const whiteish = (x, y) => {
      const i = (y * w + x) * 4;
      const r = p[i], g = p[i + 1], b = p[i + 2];
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      return A(x, y) > 40 && mn >= 190 && mx - mn <= 40;
    };

    // 1) 脚底大面积白/近白晕（仅下 1/3，避开头顶白角/白牙）
    const y0 = Math.floor(h * 0.68);
    const clearMask = new Uint8Array(w * h);
    const R = 3, area = (2 * R + 1) * (2 * R + 1);
    for (let y = y0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!whiteish(x, y)) continue;
        let cnt = 0;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && whiteish(nx, ny)) cnt++;
        }
        if (cnt / area >= 0.45) clearMask[y * w + x] = 1;
      }
    }
    const dil = clearMask.slice();
    for (let y = y0; y < h; y++) for (let x = 0; x < w; x++) {
      if (clearMask[y * w + x]) continue;
      if (!whiteish(x, y)) continue;
      if (
        clearMask[y * w + Math.min(w - 1, x + 1)] ||
        clearMask[y * w + Math.max(0, x - 1)] ||
        clearMask[Math.min(h - 1, y + 1) * w + x] ||
        clearMask[Math.max(0, y - 1) * w + x]
      ) dil[y * w + x] = 1;
    }
    let cleared = 0;
    for (let k = 0; k < w * h; k++) if (dil[k]) { p[k * 4 + 3] = 0; cleared++; }

    // 2) 脚下灰色投影（含偏暗灰晕；排除纯黑描边与身体高饱和色）
    let shadow = 0;
    for (let y = Math.floor(h * 0.72); y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (p[i + 3] === 0) continue;
        const r = p[i], g = p[i + 1], b = p[i + 2], a = p[i + 3];
        const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
        const avg = (r + g + b) / 3;
        const isGray = mx - mn <= 28 && avg >= 45 && avg < 250;
        const isSoftGray = a < 230 && mx - mn <= 40 && avg >= 40 && avg < 220 && (r - Math.min(g, b)) < 25;
        if (isGray || isSoftGray) { p[i + 3] = 0; shadow++; }
      }
    }
    // 3) 脚底残留半透明浅色边缘（抠图白边）
    let fringe = 0;
    for (let y = Math.floor(h * 0.75); y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const a = p[i + 3];
        if (a === 0) continue;
        const r = p[i], g = p[i + 1], b = p[i + 2];
        const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
        const avg = (r + g + b) / 3;
        if (a < 250 && mx - mn <= 40 && avg >= 100 && avg < 255) {
          p[i + 3] = 0;
          fringe++;
        } else if (a < 220 && avg >= 80 && mx - mn <= 50 && y >= Math.floor(h * 0.82)) {
          p[i + 3] = 0;
          fringe++;
        }
      }
    }
    ctx.putImageData(data, 0, 0);
    return JSON.stringify({ png: cv.toDataURL('image/png').split(',')[1], cleared, shadow, fringe });
  }, `data:image/png;base64,${b64}`);
  const { png, cleared, shadow, fringe } = JSON.parse(res);
  writeFileSync(path.join(DIR, file), Buffer.from(png, 'base64'));
  console.log(`✅ ${file}: 白晕 ${cleared}px；灰影 ${shadow}px；半透明边 ${fringe}px`);
}

await browser.close();
console.log('完成。');
