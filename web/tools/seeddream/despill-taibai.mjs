// 太白立绘二遍去青：fix-taibai-bg 的洪泛已抠净背景，但主体边缘还有一层半透明青边
// （cyanPct≈6.9%）。这里迭代 3 轮「邻透明 + 偏青 → 压暗去青」，逐层吃掉边缘残留。
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
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode fail')); img.src = src; });
    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const p = data.data;
    const alpha = () => { const a = new Uint8Array(w * h); for (let i = 0; i < a.length; i++) a[i] = p[i * 4 + 3]; return a; };
    // 迭代去边：每轮以「当前透明图」为参照，把与其相邻的偏青像素压掉
    for (let round = 0; round < 3; round++) {
      const a = alpha();
      const hits = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        if (a[idx] < 16) continue;
        const near = a[idx + 1] < 16 || a[idx - 1] < 16 || a[idx + w] < 16 || a[idx - w] < 16;
        if (!near) continue;
        const i = idx * 4;
        const cyan = Math.min(p[i + 1], p[i + 2]) - p[i];
        if (cyan > 18) hits.push([i, cyan]);
      }
      for (const [i, cyan] of hits) {
        // 青污染越重压得越狠：把绿蓝拉回红通道水平、alpha 按污染度减淡
        const t = Math.min(1, (cyan - 18) / 60);
        p[i + 1] = Math.round(p[i + 1] * (1 - t) + p[i] * t);
        p[i + 2] = Math.round(p[i + 2] * (1 - t) + p[i] * t);
        p[i + 3] = Math.round(p[i + 3] * (1 - t * 0.7));
      }
    }
    ctx.putImageData(data, 0, 0);
    return cv.toDataURL('image/png').split(',')[1];
  }, `data:image/png;base64,${b64}`);
  writeFileSync(FILE, Buffer.from(out, 'base64'));

  const check = await page.evaluate(async (src) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode fail')); img.src = src; });
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0, cyanN = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 16) continue;
      n++;
      if (Math.min(d[i + 1], d[i + 2]) - d[i] > 30) cyanN++;
    }
    return { cyanPct: (cyanN / n * 100).toFixed(2) };
  }, `data:image/png;base64,${out}`);
  console.log('去边后复检：', JSON.stringify(check));
} finally { await browser.close(); }
