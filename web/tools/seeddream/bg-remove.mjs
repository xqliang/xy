// 把 public/assets 下的白底 JPG 抠成透明 PNG：从四边 flood-fill near-white 背景 → alpha0，
// 保留角色内部白色。用系统 Chrome（puppeteer）在离屏 canvas 完成，导出 PNG，删除原 jpg。
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// 默认处理 public/assets；可用 ASSET_DIR 指向别处（如 src/game-assets）。
const DIR = process.env.ASSET_DIR
  ? path.resolve(process.env.ASSET_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets');

// 注意：map-*.jpg 是关卡大背景（本就不透明），不参与抠图，避免被误转成透明 PNG 并删除原图。
// 可选：node bg-remove.mjs fence-baiguling.jpg — 只处理指定文件（仍排除 map-*.jpg）。
const only = process.argv.slice(2);
const jpgs = readdirSync(DIR).filter((f) => f.endsWith('.jpg') && !f.startsWith('map-') && (only.length === 0 || only.includes(f)));
if (jpgs.length === 0) {
  console.log('没有 jpg 待处理');
  process.exit(0);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();

for (const f of jpgs) {
  const b64 = readFileSync(path.join(DIR, f)).toString('base64');
  const dataUrl = `data:image/jpeg;base64,${b64}`;
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
    const isBg = (i) => {
      const r = p[i], g = p[i + 1], b = p[i + 2];
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      return mn >= 236 && mx - mn <= 14;
    };
    const visited = new Uint8Array(w * h);
    const stack = [];
    const pushIf = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const idx = y * w + x;
      if (visited[idx]) return;
      visited[idx] = 1;
      if (isBg(idx * 4)) stack.push(idx);
    };
    // 从四边入栈
    for (let x = 0; x < w; x++) { pushIf(x, 0); pushIf(x, h - 1); }
    for (let y = 0; y < h; y++) { pushIf(0, y); pushIf(w - 1, y); }
    while (stack.length) {
      const idx = stack.pop();
      p[idx * 4 + 3] = 0; // 透明
      const x = idx % w, y = (idx / w) | 0;
      pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
    }
    // 边缘平滑：按到透明区的邻域比例做多级羽化（半径3）+ smoothstep 柔化，近白毛边额外压低 → 抗锯齿柔边
    const a0 = new Uint8Array(w * h);
    for (let k = 0; k < w * h; k++) a0[k] = p[k * 4 + 3];
    const R = 3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (a0[idx] === 0) continue;
        let transp = 0, total = 0;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) { total++; transp++; continue; }
            total++;
            if (a0[ny * w + nx] === 0) transp++;
          }
        }
        if (transp === 0) continue;
        const i = idx * 4;
        let a = 1 - transp / total; // 不透明邻居占比
        a = a * a * (3 - 2 * a); // smoothstep 柔化过渡带
        const mn = Math.min(p[i], p[i + 1], p[i + 2]);
        // 近白毛边淡化，但保留实心白刃：仅当邻域大半已透明（真毛边）才强压
        if (mn >= 228 && transp / total > 0.35) a *= 0.4;
        else if (mn >= 228) a = Math.max(a, 0.85);
        p[i + 3] = Math.round(p[i + 3] * a);
      }
    }
    ctx.putImageData(data, 0, 0);
    return cv.toDataURL('image/png').split(',')[1];
  }, dataUrl);

  const outName = f.replace(/\.jpg$/, '.png');
  writeFileSync(path.join(DIR, outName), Buffer.from(pngB64, 'base64'));
  unlinkSync(path.join(DIR, f));
  console.log(`✅ ${f} -> ${outName}`);
}

await browser.close();
console.log('抠图完成。');
