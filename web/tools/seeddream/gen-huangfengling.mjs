// 生成黄风岭全套素材（第 5 图，土行）：
//   map-huangfengling.jpg  竖版关卡背景 —— 生成后直接裁到视口比例(560×1044→824×1536)并压 JPEG(q0.72)，
//                           只保留 cover 铺满时真正可见的部分，避免像旧 4 图那样一张 ~800KB。
//   monster-{minion,boss,cavalry}-huangfengling.jpg  Q 版立绘 —— 纯绿幕直出，
//                           后续走 bg-remove-chroma.mjs → resize-portraits.mjs → pngquant → tos-upload。
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

// 竖版底图风格：与 gen-maps.mjs 保持一致（低饱和留白便于叠加网格，无文字/网格/人物）
const MAP_STYLE = '，中国风工笔游戏关卡背景插画，俯视视角，柔和低饱和配色，画面中部留白平坦便于叠加棋盘网格，四周有古朴石雕边框装饰，无任何文字，无网格线，无人物角色，无棋盘格子，竖版构图，氛围感';
// 怪物 Q 版风格：与 gen-cavalry-miniboss.mjs 一致（绿幕直出便于软抠）
const MON_STYLE = '，Q版扁平游戏图标，造型简洁、粗黑描边、强剪影、高饱和对比色、细节精简、单一主色调、正面全身居中，'
  + '纯高饱和荧光绿 RGB(0,255,0) 绿幕背景满幅平涂，无水墨/渐变/花纹/云纹/光晕/地面，'
  + '脚(或坐骑蹄/足)下方一直到画面底边全是纯绿幕、无任何阴影/投影/接触阴影，无文字，高辨识度';

const jobs = [
  {
    id: 'map-huangfengling', size: '1024x1536', post: 'map',
    prompt: '西游《黄风岭》关卡：漫天黄土风沙、嶙峋黄土山岭与风蚀岩壁、沙尘旋涡盘绕、稀疏枯草、暗金土黄色调' + MAP_STYLE,
  },
  {
    id: 'monster-minion-huangfengling', size: '1024x1024', post: 'monster',
    prompt: '黄风岭风沙小妖，土黄沙妖小卒、尖耳獠牙、身裹黄沙小旋风、手持风蚀石斧，主色土黄色' + MON_STYLE,
  },
  {
    id: 'monster-boss-huangfengling', size: '1024x1024', post: 'monster',
    prompt: '黄风岭妖王黄风怪，土黄巨貂妖王、黄袍金甲、鼓腮吹出黄色狂风、獠牙怒目、威严凶悍，主色土黄色' + MON_STYLE,
  },
  {
    id: 'monster-cavalry-huangfengling', size: '1024x1024', post: 'monster',
    prompt: '黄风岭沙妖骑兵，土黄沙妖骑手骑着一头巨型岩甲沙蜥为坐骑、周身沙尘缠绕、手持弯月石斧，主色土黄色' + MON_STYLE,
  },
];

async function gen(job) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: job.size, n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  return Buffer.from(await img.arrayBuffer());
}

// 地图背景后处理：居中裁到视口比例 824×1536（VIEW 560×1044 ≈ 0.536；cover 铺满本就裁掉两侧）
// 再压 JPEG q0.72 —— 旧 4 图未做这步，单张 ~800KB；新图目标 <250KB。
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
try {
  for (const job of jobs) {
    try {
      const buf = await gen(job);
      if (job.post === 'monster') {
        writeFileSync(path.join(OUT, `${job.id}.jpg`), buf);
        console.log(`✅ ${job.id}.jpg ${(buf.length / 1024).toFixed(0)}KB（绿幕原图，待抠图）`);
      } else {
        const outB64 = await page.evaluate(async (b64) => {
          const img = new Image();
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/jpeg;base64,' + b64; });
          const W = 824, H = 1536; // 视口比例 560:1044
          const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, (img.naturalWidth - W) / 2, 0, W, H, 0, 0, W, H); // 居中裁两侧
          return cv.toDataURL('image/jpeg', 0.72).split(',')[1];
        }, buf.toString('base64'));
        const out = Buffer.from(outB64, 'base64');
        writeFileSync(path.join(OUT, `${job.id}.jpg`), out);
        console.log(`✅ ${job.id}.jpg ${(buf.length / 1024).toFixed(0)}KB → 裁剪压缩后 ${(out.length / 1024).toFixed(0)}KB`);
      }
    } catch (e) { console.error(`❌ ${job.id}: ${e.message}`); }
  }
} finally {
  await browser.close();
}
console.log('下一步：node tools/seeddream/bg-remove-chroma.mjs monster-*-huangfengling.jpg → resize-portraits → pngquant → tos-upload');
