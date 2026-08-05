// 补抠 hero-wukong.png：图已是透明 PNG，但角色四周仍残留一圈与背景连通的近白像素（白边/白斑），
// 原四边 flood-fill 因链路上有半透明/略偏色像素而断链，导致这些近白块没被抠到。
// 做法：BFS 连通域从四边出发，可穿过「已透明(a<40) 或 近白」的像素；把途中遇到的近白不透明像素置 alpha0，
// 从而只清掉与背景连通的白，保留角色内部白色（眼睛/牙齿/祥云等）。最后对新暴露的边缘做羽化去白边。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets/hero-wukong.png');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const b64 = readFileSync(FILE).toString('base64');
const dataUrl = `data:image/png;base64,${b64}`;

const pngB64 = await page.evaluate(async (src) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const p = data.data;

  const isNearWhite = (i) => {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return mn >= 232 && mx - mn <= 16;
  };
  // 可作为背景穿行的像素：已透明 或 近白
  const traversable = (i) => p[i + 3] < 40 || isNearWhite(i);

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
    if (p[i + 3] !== 0) { p[i + 3] = 0; cleared++; } // 近白背景 → 透明
    const x = idx % w, y = (idx / w) | 0;
    pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
  }
  // 边缘羽化：仍不透明但邻接透明且偏白的像素，降 alpha，去掉白边光晕
  let feather = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (p[i + 3] === 0) continue;
      const near = [(y * w + x + 1), (y * w + x - 1), ((y + 1) * w + x), ((y - 1) * w + x)];
      if (near.some((n) => p[n * 4 + 3] === 0)) {
        const mn = Math.min(p[i], p[i + 1], p[i + 2]);
        if (mn >= 225) { p[i + 3] = Math.round(p[i + 3] * 0.35); feather++; }
      }
    }
  }
  ctx.putImageData(data, 0, 0);
  return { png: cv.toDataURL('image/png').split(',')[1], cleared, feather };
}, dataUrl);

writeFileSync(FILE, Buffer.from(pngB64.png, 'base64'));
console.log(`✅ hero-wukong: 清除近白背景 ${pngB64.cleared} px，羽化边缘 ${pngB64.feather} px`);
await browser.close();
