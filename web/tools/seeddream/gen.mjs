// 用火山方舟 Ark · Seedream 4.0 批量生成《大圣与唐僧》Q版西游素材并下载。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets');
mkdirSync(OUT, { recursive: true });

const STYLE = '，Q版扁平游戏图标，造型简洁、粗黑描边、强剪影、高饱和对比色、细节精简、每个角色单一主色调、正面全身居中，纯白色背景，无阴影，无文字，高辨识度';
const jobs = [
  { id: 'tangseng', prompt: '唐僧，圆脸慈眉、金红色袈裟、毗卢帽、双手合十，主色金红' + STYLE },
  { id: 'unit-monkey', prompt: '孙悟空猴兵，金黄毛发、手持金箍棒，主色橙金色' + STYLE },
  { id: 'unit-spear', prompt: '天兵长枪手，蓝色铠甲、手持一杆长枪，主色蓝色' + STYLE },
  { id: 'unit-cavalry', prompt: '天将骑白色天马冲锋，绿色披风，主色绿色' + STYLE },
  { id: 'unit-archer', prompt: '神箭手，紫色劲装、手持弓箭拉满，主色紫色' + STYLE },
  { id: 'monster-minion', prompt: '西游小妖卒，青绿皮肤獠牙、手持木棍，主色青绿色' + STYLE },
  { id: 'monster-boss', prompt: '牛魔王妖王，赤红肌肉、大牛角、黑铠甲，主色红色' + STYLE },
];

async function gen(job) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const url = data.data[0].url;
  const img = await fetch(url);
  const buf = Buffer.from(await img.arrayBuffer());
  const file = path.join(OUT, `${job.id}.jpg`);
  writeFileSync(file, buf);
  console.log(`✅ ${job.id}  ${(buf.length / 1024).toFixed(0)}KB  -> ${file}`);
}

for (const job of jobs) {
  try {
    await gen(job);
  } catch (e) {
    console.error(`❌ ${job.id}: ${e.message}`);
  }
}
console.log('生成完成，开始抠背景转透明 PNG…');
// 链式抠图：把刚下载的白底 jpg 转成透明 png（满足"素材须为透明PNG"的要求）
await import('./bg-remove.mjs');

