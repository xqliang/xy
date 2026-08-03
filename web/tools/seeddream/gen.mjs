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

const STYLE = '，Q版卡通，厚涂手绘，圆润可爱，全身立绘，居中构图，纯白色背景，无阴影，无文字，游戏角色图标，高清';
const jobs = [
  { id: 'tangseng', prompt: '唐僧，慈眉善目圆脸，金红色锦襕袈裟，戴毗卢帽，双手合十' + STYLE },
  { id: 'unit-monkey', prompt: '孙悟空猴兵，金色毛发火眼金睛，虎皮裙，手持金箍棒，威风凛凛' + STYLE },
  { id: 'unit-spear', prompt: '天庭天兵，银白铠甲红缨，手持长枪，英武' + STYLE },
  { id: 'unit-cavalry', prompt: '天将骑白色天马，金甲红披风，冲锋姿态' + STYLE },
  { id: 'unit-archer', prompt: '神箭手，青绿劲装，手持长弓拉满弓弦，冷峻' + STYLE },
  { id: 'monster-minion', prompt: '西游小妖怪，青绿皮肤獠牙，破旧铠甲，手持钉耙，凶恶滑稽' + STYLE },
  { id: 'monster-boss', prompt: '牛魔王大妖王，赤红肌肉，巨大牛角，黑色铠甲，霸气怒目' + STYLE },
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

