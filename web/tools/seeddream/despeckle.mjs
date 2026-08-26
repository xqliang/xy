// 去孤岛 + bbox 裁剪：抠图后残留的绿幕棋盘格/斑点是与主体不相连的小连通块。
// 保留最大连通的非透明区域（主体），把其余「不透明孤岛」清成透明；羽化边（alpha<阈值）保留不动，
// 再按主体 bbox 裁剪。用法（web/）：node tools/seeddream/despeckle.mjs palace-title-plaque.png
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
const files = process.argv.slice(2).map((a) => (a.endsWith('.png') ? a : `${a}.png`));
const ALPHA_T = Number(process.env.ALPHA_T || 60); // 视作「实心」的 alpha 阈值（用于连通域）

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
for (const f of files) {
  const abs = path.join(DIR, f);
  const b64 = readFileSync(abs).toString('base64');
  const out = await page.evaluate(async (src, AT) => {
    const img = new Image();
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = src; });
    const W = img.naturalWidth, H = img.naturalHeight, N = W * H;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H); const a = d.data;
    const label = new Int32Array(N).fill(-1);
    const solid = (i) => a[i * 4 + 3] >= AT;
    let best = -1, bestSize = 0;
    const stack = [];
    for (let s = 0; s < N; s++) {
      if (!solid(s) || label[s] !== -1) continue;
      stack.length = 0; stack.push(s); label[s] = s; let size = 0;
      while (stack.length) {
        const p = stack.pop(); size++;
        const x = p % W, y = (p / W) | 0;
        if (x > 0 && solid(p - 1) && label[p - 1] === -1) { label[p - 1] = s; stack.push(p - 1); }
        if (x < W - 1 && solid(p + 1) && label[p + 1] === -1) { label[p + 1] = s; stack.push(p + 1); }
        if (y > 0 && solid(p - W) && label[p - W] === -1) { label[p - W] = s; stack.push(p - W); }
        if (y < H - 1 && solid(p + W) && label[p + W] === -1) { label[p + W] = s; stack.push(p + W); }
      }
      if (size > bestSize) { bestSize = size; best = s; }
    }
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let i = 0; i < N; i++) {
      if (label[i] === best) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      else { a[i * 4 + 3] = 0; } // 清掉一切非最大连通域像素（含半透明残斑），只留主体及其自身羽化边
    }
    ctx.putImageData(d, 0, 0);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const c2 = document.createElement('canvas'); c2.width = cw; c2.height = ch;
    c2.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);
    return { url: c2.toDataURL('image/png'), cw, ch, bestSize };
  }, `data:image/png;base64,${b64}`, ALPHA_T);
  writeFileSync(abs, Buffer.from(out.url.split(',')[1], 'base64'));
  console.log(`✅ ${f}: 保留最大连通域 ${out.bestSize}px，裁到 ${out.cw}x${out.ch}`);
}
await browser.close();
