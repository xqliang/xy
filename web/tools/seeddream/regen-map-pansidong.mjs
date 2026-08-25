// 重新生成盘丝洞关卡背景 map-pansidong.jpg——强化木属性观感（幽绿森林/古木藤蔓/苔藓）。
// 旧图偏粉紫色调，与「木行地图」的五行定位不搭；本次重画走幽绿森调。
// 经验沿用 regen-map-liushahe.mjs：prompt 不能出现「棋盘/网格」字眼（模型会被诱导画方格纹），
// 中下部用正向描述（平坦苔藓林地），只字不提棋盘。
// 后处理同款：居中裁 824×1536（视口 560:1044）+ JPEG q0.72；生成后跑 tos-upload 更新 manifest。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');

const MAP_STYLE = '，中国风工笔游戏关卡背景插画，俯视视角，柔和低饱和配色，无任何文字，无人物角色，竖版构图，氛围感，画面中下部是大片平坦开阔的林间苔藓地，无格子，无瓷砖，无几何图案花纹，无重复平铺纹理';

// 木属性主视觉：上古密林/巨木藤蔓/垂落蛛丝/幽绿苔藓，整体森绿冷调（区别于旧版粉紫）
const PROMPT =
  '西游《盘丝洞》关卡：画面上半部是幽暗上古密林、参天古木与粗壮藤蔓交错缠绕、' +
  '枝叶间垂挂着缕缕半透明蛛丝、树干上覆满青苔、林间弥漫淡绿色雾气，' +
  '画面中下部渐渐过渡为开阔的林间苔藓地：嫩绿苔藓平铺、散布树根盘节、几株蘑菇与蕨草、零星落叶，' +
  '幽绿冷色调森林氛围' + MAP_STYLE;

const res = await fetch(API, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: MODEL, prompt: PROMPT, size: '1024x1536', n: 1, response_format: 'url', watermark: false }),
});
if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
const data = await res.json();
const img = await fetch(data.data[0].url);
const buf = Buffer.from(await img.arrayBuffer());
console.log(`原图 ${(buf.length / 1024).toFixed(0)}KB`);

// 居中裁到视口比例 824×1536 + 压 JPEG（与流沙河/黄风岭 map 后处理同款）
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const outB64 = await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res2, rej) => { img.onload = res2; img.onerror = rej; img.src = 'data:image/jpeg;base64,' + b64; });
    const W = 824, H = 1536; // 视口比例 560:1044
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, (img.naturalWidth - W) / 2, 0, W, H, 0, 0, W, H); // 居中裁两侧
    return cv.toDataURL('image/jpeg', 0.72).split(',')[1];
  }, buf.toString('base64'));
  const out = Buffer.from(outB64, 'base64');
  writeFileSync(path.join(OUT, 'map-pansidong.jpg'), out);
  console.log(`✅ map-pansidong.jpg 已重生成：${(out.length / 1024).toFixed(0)}KB（824×1536 q0.72）`);
  console.log('下一步：node tools/tos-upload.mjs → 色彩断言 → 提交');
} finally {
  await browser.close();
}
