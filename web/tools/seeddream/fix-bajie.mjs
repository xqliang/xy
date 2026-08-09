// 补抠 hero-bajie.png：多轮清除连通近白背景 + 底部地影 + 边缘去白边。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets/hero-bajie.png');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const b64 = readFileSync(FILE).toString('base64');

const result = await page.evaluate(async (src) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const p = data.data;

  const isStrictWhite = (i) => {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return mn >= 242 && mx - mn <= 12;
  };
  const isNearWhite = (i) => {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return mn >= 226 && mx - mn <= 18;
  };
  const isPink = (i) => {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    return r > g + 10 && r > b + 6;
  };

  const floodClear = (traversable) => {
    const visited = new Uint8Array(w * h);
    const stack = [];
    const pushIf = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const idx = y * w + x;
      if (visited[idx]) return;
      visited[idx] = 1;
      if (traversable(idx * 4)) stack.push(idx);
    };
    for (let x = 0; x < w; x++) { pushIf(x, 0); pushIf(x, h - 1); }
    for (let y = 0; y < h; y++) { pushIf(0, y); pushIf(w - 1, y); }
    let cleared = 0;
    while (stack.length) {
      const idx = stack.pop();
      const i = idx * 4;
      if (p[i + 3] !== 0) { p[i + 3] = 0; cleared++; }
      const x = idx % w, y = (idx / w) | 0;
      pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
    }
    return cleared;
  };

  let cleared = 0;
  cleared += floodClear((i) => p[i + 3] < 50 || isStrictWhite(i));
  cleared += floodClear((i) => p[i + 3] < 50 || isNearWhite(i));

  // 底部地影/白底残留：靠下区域里的浅灰块（非粉色皮肤）
  let bottom = 0;
  const y0 = Math.floor(h * 0.82);
  for (let y = y0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (p[i + 3] === 0 || isPink(i)) continue;
      const r = p[i], g = p[i + 1], b = p[i + 2];
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      if (mn >= 165 && mx - mn <= 28) { p[i + 3] = 0; bottom++; }
    }
  }

  // 边缘去白晕：贴透明边且偏白的像素降 alpha / 去色溢
  let feather = 0;
  for (let pass = 0; pass < 3; pass++) {
    const snap = new Uint8ClampedArray(p);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const i = idx * 4;
        if (snap[i + 3] === 0) continue;
        const nb = [idx + 1, idx - 1, idx + w, idx - w];
        const nearTrans = nb.some((n) => snap[n * 4 + 3] === 0);
        if (!nearTrans) continue;
        const mn = Math.min(snap[i], snap[i + 1], snap[i + 2]);
        if (mn >= 238) { p[i + 3] = 0; feather++; continue; }
        if (mn < 198) continue;
        if (isPink(i) && mn < 232) continue;
        let sr = 0, sg = 0, sb = 0, c = 0;
        for (const n of nb) {
          if (snap[n * 4 + 3] < 40) continue;
          const ni = n * 4;
          const nmn = Math.min(snap[ni], snap[ni + 1], snap[ni + 2]);
          if (nmn >= 232) continue;
          sr += snap[ni]; sg += snap[ni + 1]; sb += snap[ni + 2]; c++;
        }
        if (c > 0) {
          p[i] = Math.round(sr / c);
          p[i + 1] = Math.round(sg / c);
          p[i + 2] = Math.round(sb / c);
        }
        p[i + 3] = Math.round(snap[i + 3] * 0.2);
        feather++;
      }
    }
  }

  ctx.putImageData(data, 0, 0);
  return { png: cv.toDataURL('image/png').split(',')[1], cleared, bottom, feather };
}, `data:image/png;base64,${b64}`);

writeFileSync(FILE, Buffer.from(result.png, 'base64'));
console.log(`✅ hero-bajie: flood ${result.cleared}px, bottom ${result.bottom}px, feather ${result.feather}px`);
await browser.close();
