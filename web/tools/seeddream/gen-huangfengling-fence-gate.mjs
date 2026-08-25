// 生成黄风岭中线栅栏（可平铺沙岩带）+ 出怪口闸门扇叶（风蚀岩门）：
//   白底 JPG → bg-remove.mjs 洪泛抠透明 → 裁透明边并缩到成品尺寸（对齐既有 fence 512 宽 / gate ~256 高）→ pngquant。
// 之后接线 render.ts（drawFence/drawGateAt 的 huangfengling 分支）+ tos-upload。
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

// 与 gen-map-fences.mjs 同款贴图风格（白底洪泛抠图安全：沙岩无纯白部位）
const TILE =
  '，Q版卡通扁平插画游戏贴图（非像素风、非8bit），柔和赛璐璐上色、细描边、边缘柔和，' +
  '造型简洁、细节精简、正面居中，纯白色背景，无阴影，无文字，无人物';
const SEAMLESS =
  '，左右两端无缝循环平铺（seamless horizontal tile，左端与右端可首尾相接连续），' +
  '禁止像素块、禁止两端大卷浪/书挡式装饰、禁止左右不对称的独特造型、中间花纹均匀可重复';

const jobs = [
  {
    id: 'fence-huangfengling',
    size: '2048x512',
    prompt:
      '西游黄风岭中线栅栏：极扁的横向风沙岩壁分隔条（适合游戏里约四分之一格高的细条显示），' +
      '土黄风蚀砂岩纹理，均匀散布细沙砾与几缕飘沙，禁止绿色植物、禁止两端立柱/岩石书挡，' +
      '整条左右无缝循环平铺，缩小后仍要一眼能认出是黄土风沙带' + TILE + SEAMLESS,
  },
  {
    id: 'gate-huangfengling',
    size: '1024x1024',
    prompt:
      '西游黄风岭出怪口的一扇闸门扇叶：竖立的风蚀砂岩门扇，门面有黄土沙纹与旋风刻痕装饰，' +
      '土黄色调，Q版扁平游戏图标，造型简洁、单侧门扇（不是整对门）、可左右镜像开合，' +
      '正面居中，纯白色背景，无阴影，无文字，高辨识度',
  },
];

for (const job of jobs) {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: job.size, n: 1, response_format: 'url', watermark: false }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const data = await res.json();
    const url = data.data?.[0]?.url;
    if (!url) throw new Error('无 url');
    const img = await fetch(url);
    const buf = Buffer.from(await img.arrayBuffer());
    writeFileSync(path.join(OUT, `${job.id}.jpg`), buf);
    console.log(`✅ ${job.id}.jpg ${(buf.length / 1024).toFixed(0)}KB`);
  } catch (e) { console.error(`❌ ${job.id}: ${e.message}`); process.exitCode = 1; }
}

// 抠背景（白底洪泛，同 gen-map-fences 的收尾）
console.log('抠背景转透明 PNG…');
await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ['bg-remove.mjs', ...jobs.map((j) => `${j.id}.jpg`)], {
    cwd: HERE, env: { ...process.env, ASSET_DIR: OUT }, stdio: 'inherit',
  });
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`bg-remove exit ${code}`))));
});

// 裁透明边 + 缩到成品尺寸：栅栏定宽 512（对齐 fence-liushahe/pansidong），闸门定高 256（对齐 gate-liushahe）
console.log('裁边缩放到成品尺寸…');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
try {
  for (const job of jobs) {
    const file = path.join(OUT, `${job.id}.png`);
    const b64 = (await import('node:fs')).readFileSync(file).toString('base64');
    const target = job.id.startsWith('fence-') ? 512 : 256; // 栅栏目标宽 / 闸门目标高
    const axis = job.id.startsWith('fence-') ? 'w' : 'h';
    const outB64 = await page.evaluate(async (src, target, axis) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('load fail')); img.src = src; });
      const cv0 = document.createElement('canvas'); cv0.width = img.naturalWidth; cv0.height = img.naturalHeight;
      const c0 = cv0.getContext('2d', { willReadFrequently: true });
      c0.drawImage(img, 0, 0);
      const d = c0.getImageData(0, 0, cv0.width, cv0.height).data;
      // 透明边界裁剪
      let x0 = cv0.width, y0 = cv0.height, x1 = 0, y1 = 0;
      for (let y = 0; y < cv0.height; y++) for (let x = 0; x < cv0.width; x++) {
        if (d[(y * cv0.width + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < x0) { x0 = 0; y0 = 0; x1 = cv0.width - 1; y1 = cv0.height - 1; }
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      const scale = axis === 'w' ? target / cw : target / ch;
      const cv = document.createElement('canvas'); cv.width = Math.round(cw * scale); cv.height = Math.round(ch * scale);
      cv.getContext('2d').drawImage(cv0, x0, y0, cw, ch, 0, 0, cv.width, cv.height);
      return { b64: cv.toDataURL('image/png').split(',')[1], w: cv.width, h: cv.height };
    }, `data:image/png;base64,${b64}`, target, axis);
    writeFileSync(file, Buffer.from(outB64.b64, 'base64'));
    console.log(`✅ ${job.id}.png ${outB64.w}x${outB64.h}`);
  }
} finally { await browser.close(); }
console.log('下一步：pngquant → render.ts 接线 → tos-upload');
