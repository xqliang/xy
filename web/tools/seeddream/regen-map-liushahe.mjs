// 重新生成流沙河关卡背景 map-liushahe.jpg——强化水属性观感（青蓝江水/漩涡/浪花/水雾）。
// 旧图偏土黄沙岸，与「水行地图」的五行定位不搭；本次重画走蓝青冷色调。
// 后处理与 gen-huangfengling.mjs 的 map 流程一致：居中裁 824×1536（视口 560:1044）+ JPEG q0.72。
// 生成后需跑 tools/tos-upload.mjs 重传并更新 manifest（见 asset-must-tos-upload-after-add 记忆）。
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

// 风格注意：不能出现「棋盘/网格」字眼——第一次生成时 prompt 里写「便于叠加棋盘网格，
// 无棋盘格子」，模型被「棋盘网格」诱导反而在画面里画出了方格纹。改为正向描述留白沙滩
// + 否定「无格子、无瓷砖、无几何图案」，只字不提棋盘。
const MAP_STYLE = '，中国风工笔游戏关卡背景插画，俯视视角，柔和低饱和配色，无任何文字，无人物角色，竖版构图，氛围感，画面中下部是大片平坦开阔的河岸沙滩，无格子，无瓷砖，无几何图案花纹，无重复平铺纹理';

// 水属性主视觉：大江湍流/漩涡/浪花/水雾芦苇 + 河岸沙滩碎石，整体蓝青冷色调
const PROMPT =
  '西游《流沙河》关卡：画面上半部是浩荡大江、青蓝色湍急江水、河心漩涡与白色浪花、水面氤氲水雾，' +
  '画面中下部渐渐过渡为宽阔的浅滩河岸：湿润的浅灰金沙沙滩上散布大大小小的青灰鹅卵石与碎石、' +
  '几丛稀疏芦苇、零星贝壳，蓝青冷色调水乡氛围' + MAP_STYLE;

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

// 居中裁到视口比例 824×1536 + 压 JPEG（与黄风岭 map 后处理同款）
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
  writeFileSync(path.join(OUT, 'map-liushahe.jpg'), out);
  console.log(`✅ map-liushahe.jpg 已重生成：${(out.length / 1024).toFixed(0)}KB（824×1536 q0.72）`);
  console.log('下一步：node tools/tos-upload.mjs（需 TOS 凭证）→ 浏览器验证 → 提交');
} finally {
  await browser.close();
}
