// 绿幕/蓝幕抠图：模型直出纯绿或纯蓝背景，这里按「屏幕色通道优势度」做软抠 + 去溢色 + 羽化。
// 相比白底洪泛，不会误伤角色的白/银/浅色（银甲、白衣、白毛），专治「不该扣的被扣掉」。
//
// 用法（web/ 目录）：node tools/seeddream/bg-remove-chroma.mjs hero-erlang.jpg hero-guanyin.jpg
// 屏幕颜色自动识别（采样四边，绿优势→绿幕，蓝优势→蓝幕）；也可 --screen green|blue 强制。
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = process.env.ASSET_DIR
  ? path.resolve(process.env.ASSET_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');

const argv = process.argv.slice(2);
let forceScreen = null;
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--screen') { forceScreen = argv[++i]; continue; }
  files.push(argv[i].endsWith('.jpg') || argv[i].endsWith('.png') ? argv[i] : `${argv[i]}.jpg`);
}
const targets = files.length
  ? files
  : readdirSync(DIR).filter((f) => f.endsWith('.jpg') && !f.startsWith('map-'));
if (targets.length === 0) { console.log('没有待处理文件'); process.exit(0); }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();

for (const f of targets) {
  const src = path.join(DIR, f);
  if (!existsSync(src)) { console.log(`skip ${f} (missing)`); continue; }
  const ext = path.extname(f).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  const b64 = readFileSync(src).toString('base64');

  const result = await page.evaluate(async (dataUrl, force) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const p = data.data;

    // 采样四边判定屏幕色
    let sumGdom = 0, sumBdom = 0, n = 0;
    const sample = (x, y) => {
      const i = (y * w + x) * 4;
      sumGdom += p[i + 1] - Math.max(p[i], p[i + 2]);
      sumBdom += p[i + 2] - Math.max(p[i], p[i + 1]);
      n++;
    };
    for (let x = 0; x < w; x += 3) { sample(x, 0); sample(x, h - 1); }
    for (let y = 0; y < h; y += 3) { sample(0, y); sample(w - 1, y); }
    const screen = force || (sumGdom / n >= sumBdom / n ? 'green' : 'blue');

    // 屏幕通道优势度 d：绿幕=g-max(r,b)，蓝幕=b-max(r,g)。d 越大越像背景。
    const dom = (i) => screen === 'green'
      ? p[i + 1] - Math.max(p[i], p[i + 2])
      : p[i + 2] - Math.max(p[i], p[i + 1]);
    const other = (i) => screen === 'green'
      ? Math.max(p[i], p[i + 2])
      : Math.max(p[i], p[i + 1]);

    // 绿幕对青绿披风更保守（LOW 高些）；蓝幕主体一般无强蓝。
    const LOW = screen === 'green' ? 42 : 30;
    const HIGH = screen === 'green' ? 96 : 82;

    // 1) 软 alpha：按优势度线性过渡
    for (let k = 0; k < w * h; k++) {
      const i = k * 4;
      const d = dom(i);
      let a = 1;
      if (d >= HIGH) a = 0;
      else if (d > LOW) a = 1 - (d - LOW) / (HIGH - LOW);
      p[i + 3] = Math.round(p[i + 3] * a);
    }

    // 2) 去溢色：保留像素里把屏幕通道压到不超过另两通道最大值 + 少量余量，消掉绿/蓝色边。
    const SPILL = 12;
    for (let k = 0; k < w * h; k++) {
      const i = k * 4;
      if (p[i + 3] === 0) continue;
      const ch = screen === 'green' ? i + 1 : i + 2;
      const cap = other(i) + SPILL;
      if (p[ch] > cap) p[ch] = cap;
    }

    // 3) 羽化：按到透明区邻域比例 smoothstep 柔化边（半径2）。
    const a0 = new Uint8Array(w * h);
    for (let k = 0; k < w * h; k++) a0[k] = p[k * 4 + 3];
    const R = 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (a0[idx] === 0) continue;
        let transp = 0, total = 0;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = x + dx, ny = y + dy;
            total++;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || a0[ny * w + nx] === 0) transp++;
          }
        }
        if (transp === 0) continue;
        let a = 1 - transp / total;
        a = a * a * (3 - 2 * a);
        p[idx * 4 + 3] = Math.round(p[idx * 4 + 3] * a);
      }
    }

    ctx.putImageData(data, 0, 0);
    return { png: cv.toDataURL('image/png').split(',')[1], screen };
  }, `data:${mime};base64,${b64}`, forceScreen);

  const outName = f.replace(/\.(jpg|png)$/i, '.png');
  writeFileSync(path.join(DIR, outName), Buffer.from(result.png, 'base64'));
  if (ext === '.jpg') unlinkSync(src);
  console.log(`✅ ${f} -> ${outName} (${result.screen}幕)`);
}

await browser.close();
console.log('绿/蓝幕抠图完成。');
