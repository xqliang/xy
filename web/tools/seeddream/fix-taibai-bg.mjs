// 一次性修复 hero-taibai.png：模型没按纯蓝幕出图（画成了青色 RGB≈(6,178,190)），
// bg-remove-chroma 只软抠了一半（角落 alpha~150 的青色残留）。这里按「边缘采样背景色 +
// 洪泛 + 容差」彻底抠掉青底，再做轻度去边。白衣/金饰离青色很远，容差安全。
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = 'src/game-assets/hero-taibai.png';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const b64 = readFileSync(FILE).toString('base64');
  const out = await page.evaluate(async (src) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const p = data.data;

    // 背景色 = 四角均值（半透明像素先按「预乘还原」取色即可，青色主导稳定）
    let br = 0, bg = 0, bb = 0, bn = 0;
    const sample = (x, y) => { const i = (y * w + x) * 4; br += p[i]; bg += p[i + 1]; bb += p[i + 2]; bn++; };
    for (let x = 0; x < w; x += 4) { sample(x, 0); sample(x, h - 1); }
    for (let y = 0; y < h; y += 4) { sample(0, y); sample(w - 1, y); }
    br /= bn; bg /= bn; bb /= bn;

    // 与背景色的欧氏距离（不含 alpha——半透明青色也是青色）
    const dist = (i) => Math.hypot(p[i] - br, p[i + 1] - bg, p[i + 2] - bb);
    const isBg = (i) => dist(i) < 90; // 青底容差；白衣(255,255,255)距离≈300、金饰≈250+，安全

    const visited = new Uint8Array(w * h);
    const stack = [];
    const pushIf = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const idx = y * w + x;
      if (visited[idx]) return;
      visited[idx] = 1;
      if (isBg(idx * 4)) stack.push(idx);
    };
    for (let x = 0; x < w; x++) { pushIf(x, 0); pushIf(x, h - 1); }
    for (let y = 0; y < h; y++) { pushIf(0, y); pushIf(w - 1, y); }
    while (stack.length) {
      const idx = stack.pop();
      p[idx * 4 + 3] = 0;
      const x = idx % w, y = (idx / w) | 0;
      pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
    }

    // 去边：与已抠像素相邻、且自身仍偏青（蓝绿高于红 40+）→ 减淡并压青
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (p[i + 3] === 0) continue;
      const near = [(y * w + x + 1), (y * w + x - 1), ((y + 1) * w + x), ((y - 1) * w + x)];
      if (near.some((n) => p[n * 4 + 3] === 0)) {
        const cyan = Math.min(p[i + 1], p[i + 2]) - p[i]; // 蓝绿优势
        if (cyan > 30) { p[i + 3] = Math.round(p[i + 3] * 0.35); p[i + 1] = p[i]; p[i + 2] = p[i]; }
      }
    }
    ctx.putImageData(data, 0, 0);
    return cv.toDataURL('image/png').split(',')[1];
  }, `data:image/png;base64,${b64}`);
  writeFileSync(FILE, Buffer.from(out, 'base64'));

  // 复检透明占比
  const check = await page.evaluate(async (src) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let t = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 16) t++;
    const corner = (x, y) => d[(y * cv.width + x) * 4 + 3] < 16;
    return { transparentPct: (t / (cv.width * cv.height) * 100).toFixed(1),
      corners: [corner(2, 2), corner(cv.width - 3, 2), corner(2, cv.height - 3), corner(cv.width - 3, cv.height - 3)] };
  }, `data:image/png;base64,${out}`);
  console.log('抠图后复检：', JSON.stringify(check));
} finally { await browser.close(); }
