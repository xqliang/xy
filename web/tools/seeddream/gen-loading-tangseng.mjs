// 生成加载页专用素材：唐僧骑白龙马·侧身向右缓步行走（Q版扁平，透明背景）。
// 与其他立绘不同，这里要"侧面全身、面向右"，用于加载页横向行走动画，故单独写 prompt（不套用正面 STYLE）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets');
mkdirSync(OUT, { recursive: true });

const PROMPT =
  '唐僧师父骑着一匹白色骏马（白龙马），侧身朝向右方、缓步向前行走；' +
  '唐僧圆脸慈眉、头戴金色毗卢帽、身穿金红色锦襕袈裟、端坐马背双手持缰；' +
  '白马四蹄迈步的行走姿态、马身洁白、鬃毛与马尾飘逸；' +
  'Q版扁平游戏美术，造型简洁、粗黑描边、强剪影、高饱和对比色、细节精简，' +
  '主色金红配白马，侧面全身完整居中，纯白色背景，无地面、无脚下灰色投影、无底部白色光晕、无阴影、无文字，高辨识度';

const res = await fetch(API, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: MODEL, prompt: PROMPT, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
});
if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
const data = await res.json();
const url = data.data[0].url;
const img = await fetch(url);
const buf = Buffer.from(await img.arrayBuffer());
const file = path.join(OUT, 'loading-tangseng.jpg');
writeFileSync(file, buf);
console.log(`✅ loading-tangseng  ${(buf.length / 1024).toFixed(0)}KB  -> ${file}`);
console.log('下一步：node tools/seeddream/bg-remove.mjs loading-tangseng.jpg  然后 resize-portraits');
