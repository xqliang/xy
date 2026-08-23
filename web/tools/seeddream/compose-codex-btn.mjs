// 生成新版 menu-btn-codex：以 menu-btn-settings 为底版合成。
// 背景：Seedream 烘焙「图鉴」文字两次都把「鉴」画错；整按钮重生成 4 次也总在底部画杂墨。
// 方案：① Seedream 只生成「孤立竹简卷轴图标」（孤立图标是它的强项，rank 星星即此法）；
//       ② 白幕洪泛抠透明 → 按「明度→alpha」把卷轴重着色为深墨单色（与设置按钮齿轮同款墨色）；
//       ③ 复制 menu-btn-settings.png，把齿轮+设置文字区域按行插值填充为底色（保留上下渐变与墨线边框）；
//       ④ 把卷轴贴到齿轮原位（高度约 42%）；「图鉴」文字由 menu.ts 程序化叠加。
// 用法：node tools/seeddream/compose-codex-btn.mjs [--reuse-scroll]  # 后者跳过 API，复用已抠好的卷轴 PNG
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const KEY = process.env.ARK_API_KEY;
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const reuseScroll = process.argv.includes('--reuse-scroll');

const PROMPT =
  '孤立图标：一卷竖向展开的竹简卷轴，中国古代竹简书卷，多根细竹简横向编联成一册、上下两端卷轴杆微微卷起，' +
  '手绘水墨Q版，仅灰赭墨色线稿与淡墨晕染，无红无金无蓝无绿无紫无霓虹无彩色，无画框无金边，' +
  '纯白色背景，无阴影，平涂无高光，竹简卷轴竖向占画布高度70%，无文字无汉字无符号';

// 1) 生成孤立卷轴图标（白底 jpg）→ 白幕洪泛抠透明 → 存 tools/seeddream/menu-icon-scroll.png
//    （中间产物放本目录而非 game-assets，避免被 tos-upload 上传到 CDN）
const scrollPng = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'menu-icon-scroll.png');
if (!reuseScroll || !existsSync(scrollPng)) {
  if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
  console.log('生成卷轴图标...');
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: PROMPT, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  writeFileSync(path.join(OUT, 'menu-icon-scroll.jpg'), Buffer.from(await img.arrayBuffer()));
  console.log('✅ menu-icon-scroll.jpg');

  const browser0 = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page0 = await browser0.newPage();
  const pngB64 = await page0.evaluate(async (src) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const p = data.data;
    const isBg = (i) => { const mn = Math.min(p[i], p[i+1], p[i+2]), mx = Math.max(p[i], p[i+1], p[i+2]); return mn >= 236 && mx - mn <= 14; };
    const visited = new Uint8Array(w * h); const stack = [];
    const pushIf = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const idx = y * w + x; if (visited[idx]) return; visited[idx] = 1;
      if (isBg(idx * 4)) stack.push(idx);
    };
    for (let x = 0; x < w; x++) { pushIf(x, 0); pushIf(x, h - 1); }
    for (let y = 0; y < h; y++) { pushIf(0, y); pushIf(w - 1, y); }
    while (stack.length) { const idx = stack.pop(); p[idx * 4 + 3] = 0; const x = idx % w, y = (idx / w) | 0; pushIf(x+1, y); pushIf(x-1, y); pushIf(x, y+1); pushIf(x, y-1); }
    ctx.putImageData(data, 0, 0);
    return cv.toDataURL('image/png').split(',')[1];
  }, `data:image/jpeg;base64,${readFileSync(path.join(OUT, 'menu-icon-scroll.jpg')).toString('base64')}`);
  writeFileSync(scrollPng, Buffer.from(pngB64, 'base64'));
  unlinkSync(path.join(OUT, 'menu-icon-scroll.jpg'));
  await browser0.close();
  console.log('✅ menu-icon-scroll.png（白幕已抠）');
} else {
  console.log('复用已有 menu-icon-scroll.png');
}

// 2) 卷轴墨色化 + 3) 底版擦除 + 4) 合成（都在 Chrome canvas 完成）
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const load = (file) => {
  const abs = path.isAbsolute(file) ? file : path.join(OUT, file);
  return `data:image/${abs.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${readFileSync(abs).toString('base64')}`;
};

const result = await page.evaluate(async (scrollSrc, settingsSrc) => {
  const loadImg = (src) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = rej; img.src = src;
  });

  // --- 卷轴：明度→alpha 重着色为深墨单色（与设置按钮齿轮同款墨） ---
  const scrollImg = await loadImg(scrollSrc);
  const sw = scrollImg.naturalWidth, sh = scrollImg.naturalHeight;
  const scrollCv = document.createElement('canvas'); scrollCv.width = sw; scrollCv.height = sh;
  const sctx = scrollCv.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(scrollImg, 0, 0);
  const sd = sctx.getImageData(0, 0, sw, sh);
  const sp = sd.data;
  // 设置按钮齿轮/文字的墨色（采样自 menu-btn-settings.png 的深墨笔画）约 rgb(30~60,25~50,20~45)。
  // 取偏暖深墨 rgb(52,44,34)；淡墨晕染区按明度给半透明 alpha，浅底（卷轴纸面）近全透。
  const INK = [52, 44, 34];
  for (let k = 0; k < sw * sh; k++) {
    const i = k * 4;
    if (sp[i + 3] === 0) continue;
    const lum = Math.max(sp[i], sp[i + 1], sp[i + 2]);
    // 分段曲线：深笔画（≤130）→ 实心墨（与齿轮同款干脆）；中间调（130~245 淡墨晕染面）→ 线性半透明
    // 保留明暗层次（纯阈值化会把整个卷轴压成黑块）；纸面（≥245）→ 全透露出按钮底色。
    let a;
    if (lum <= 130) a = 1;
    else if (lum >= 245) a = 0;
    else a = (245 - lum) / 115;
    a = Math.max(0, Math.min(1, a));
    sp[i] = INK[0]; sp[i + 1] = INK[1]; sp[i + 2] = INK[2];
    sp[i + 3] = Math.round(sp[i + 3] * a);
  }
  // 裁掉全透明边
  let sx0 = sw, sy0 = sh, sx1 = -1, sy1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (sp[(y * sw + x) * 4 + 3] > 30) { sx0 = Math.min(sx0, x); sx1 = Math.max(sx1, x); sy0 = Math.min(sy0, y); sy1 = Math.max(sy1, y); }
  const scrollW = sx1 - sx0 + 1, scrollH = sy1 - sy0 + 1;
  const scrollCut = document.createElement('canvas'); scrollCut.width = scrollW; scrollCut.height = scrollH;
  scrollCut.getContext('2d').putImageData(sd, -sx0, -sy0);

  // --- 底版：settings 擦齿轮+文字 ---
  const btnImg = await loadImg(settingsSrc);
  const bw = btnImg.naturalWidth, bh = btnImg.naturalHeight;
  const bcv = document.createElement('canvas'); bcv.width = bw; bcv.height = bh;
  const bctx = bcv.getContext('2d', { willReadFrequently: true });
  bctx.drawImage(btnImg, 0, 0);
  const bd = bctx.getImageData(0, 0, bw, bh);
  const bp = bd.data;
  // 擦除区（按钮内部、含齿轮+文字的 bbox，不碰四周墨线边框）：
  // x 12%~88%，y 12%~88%。每行用 x=10% 与 x=90% 两个干净底色采样做线性插值，保留纵向渐变。
  const eX0 = Math.round(bw * 0.12), eX1 = Math.round(bw * 0.88);
  const eY0 = Math.round(bh * 0.12), eY1 = Math.round(bh * 0.88);
  const lX = Math.round(bw * 0.10), rX = Math.round(bw * 0.90);
  for (let y = eY0; y <= eY1; y++) {
    const li = (y * bw + lX) * 4, ri = (y * bw + rX) * 4;
    for (let x = eX0; x <= eX1; x++) {
      const t = (x - eX0) / Math.max(1, eX1 - eX0);
      const i = (y * bw + x) * 4;
      for (let c = 0; c < 3; c++) bp[i + c] = Math.round(bp[li + c] * (1 - t) + bp[ri + c] * t);
      bp[i + 3] = 255;
    }
  }
  bctx.putImageData(bd, 0, 0);

  // --- 贴卷轴：目标高度 = 按钮高度 42%，中心 (50%, 39%)（齿轮原位视觉中心） ---
  const targetH = bh * 0.42;
  const scale = targetH / scrollH;
  const drawW = scrollW * scale, drawH = targetH;
  const cx = bw * 0.5, cy = bh * 0.39;
  bctx.drawImage(scrollCut, cx - drawW / 2, cy - drawH / 2, drawW, drawH);

  return {
    png: bcv.toDataURL('image/png').split(',')[1],
    scrollW, scrollH,
    aspect: (scrollW / scrollH).toFixed(2),
    drawW: Math.round(drawW), drawH: Math.round(drawH),
  };
}, load(scrollPng), load('menu-btn-settings.png'));

writeFileSync(path.join(OUT, 'menu-btn-codex.png'), Buffer.from(result.png, 'base64'));
await browser.close();

console.log(`✅ menu-btn-codex.png 合成完成（卷轴源 ${result.scrollW}x${result.scrollH} 宽高比 ${result.aspect}，贴入 ${result.drawW}x${result.drawH}）`);
