// 生成每张地图专属的「小怪 + Boss」共 8 张 Q 版素材（火山方舟 Seedream 4.0），并抠成透明 PNG。
// 输出直接落到 web/src/game-assets/（manifest 从这里 glob）。只处理本脚本生成的 8 个文件，
// 不碰 game-assets 里已有的 map-*.jpg 背景图。
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');

const STYLE =
  '，Q版扁平游戏图标，造型简洁、粗黑描边、强剪影、高饱和对比色、细节精简、每个角色单一主色调、正面全身居中，' +
  '纯白色背景，无地面、无脚下灰色投影、无底部白色光晕、无阴影、无文字，角色脚底干净贴边，高辨识度';
const jobs = [
  // 火焰山：烈焰主题（Boss 沿用牛魔王）
  { id: 'monster-minion-huoyanshan', prompt: '火焰山小妖卒，通体火红、头顶跳动火苗、獠牙短角、手持烧红铁棍，主色橙红色，脚底干净无投影' + STYLE },
  { id: 'monster-boss-huoyanshan', prompt: '牛魔王妖王，赤红肌肉、巨大黑牛角、黑金铠甲、怒目獠牙，主色红色，脚底干净无投影' + STYLE },
  // 流沙河：水/河妖主题
  { id: 'monster-minion-liushahe', prompt: '流沙河河妖小卒，青灰鱼头水鬼、蹼状手掌、湿滑鳞片、滴水，主色青灰蓝色，脚底干净无投影' + STYLE },
  { id: 'monster-boss-liushahe', prompt: '流沙河巨型河妖卷帘水怪，青蓝鳞甲、须发飘荡、獠牙、手持降妖宝杖，主色墨蓝色，脚底干净无投影' + STYLE },
  // 白骨岭：骸骨主题
  { id: 'monster-minion-baiguling', prompt: '白骨岭骷髅小卒，白骨骷髅兵、空洞眼窝、手持锈蚀弯刀、破碎腰甲，主色骨白色，脚底干净无投影' + STYLE },
  { id: 'monster-boss-baiguling', prompt: '白骨精妖女，惨白骷髅妖女、白骨裙裾、幽绿鬼火缠绕、阴森妖艳，主色惨白色，脚底干净无投影' + STYLE },
  // 盘丝洞：蜘蛛主题
  { id: 'monster-minion-pansidong', prompt: '盘丝洞蜘蛛小妖，紫黑色八爪小蜘蛛、独眼獠牙、身缠蛛丝，主色紫黑色，脚底干净无投影' + STYLE },
  { id: 'monster-boss-pansidong', prompt: '盘丝洞蜘蛛精，紫衣蛛女、多足蛛身、身后盘丝大网、妖艳诡异，主色紫色，脚底干净无投影' + STYLE },
];

async function gen(job) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  writeFileSync(path.join(OUT, `${job.id}.jpg`), Buffer.from(await img.arrayBuffer()));
  console.log(`✅ 生成 ${job.id}`);
}

for (const job of jobs) {
  try { await gen(job); } catch (e) { console.error(`❌ ${job.id}: ${e.message}`); }
}

// —— 抠背景转透明 PNG（只处理本次生成的 8 个文件）——
console.log('抠背景转透明 PNG…');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
for (const job of jobs) {
  const jpg = path.join(OUT, `${job.id}.jpg`);
  let b64;
  try { b64 = readFileSync(jpg).toString('base64'); } catch { continue; } // 生成失败则跳过
  const pngB64 = await page.evaluate(async (src) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h); const p = data.data;
    const isBg = (i) => { const r = p[i], g = p[i + 1], b = p[i + 2]; const mn = Math.min(r, g, b), mx = Math.max(r, g, b); return mn >= 236 && mx - mn <= 14; };
    const visited = new Uint8Array(w * h); const stack = [];
    const pushIf = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const idx = y * w + x; if (visited[idx]) return; visited[idx] = 1; if (isBg(idx * 4)) stack.push(idx); };
    for (let x = 0; x < w; x++) { pushIf(x, 0); pushIf(x, h - 1); }
    for (let y = 0; y < h; y++) { pushIf(0, y); pushIf(w - 1, y); }
    while (stack.length) { const idx = stack.pop(); p[idx * 4 + 3] = 0; const x = idx % w, y = (idx / w) | 0; pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1); }
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4; if (p[i + 3] === 0) continue;
      const near = [(y * w + x + 1), (y * w + x - 1), ((y + 1) * w + x), ((y - 1) * w + x)];
      if (near.some((n) => p[n * 4 + 3] === 0)) { const mn = Math.min(p[i], p[i + 1], p[i + 2]); if (mn >= 228) p[i + 3] = Math.round(p[i + 3] * 0.4); }
    }
    ctx.putImageData(data, 0, 0);
    return cv.toDataURL('image/png').split(',')[1];
  }, `data:image/jpeg;base64,${b64}`);
  writeFileSync(path.join(OUT, `${job.id}.png`), Buffer.from(pngB64, 'base64'));
  unlinkSync(jpg);
  console.log(`✅ 抠图 ${job.id}.png`);
}
await browser.close();
console.log('完成。');
