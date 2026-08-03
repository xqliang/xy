// 用火山方舟 Ark · Seedream 4.0 生成 4 张地图的竖版大背景（关卡场景插画，非透明）。
// 背景为整屏底图，网格与单位由代码绘制其上，故要求低饱和/留白、无网格/无文字/无人物。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets');
mkdirSync(OUT, { recursive: true });

// 竖版底图风格：俯视关卡、低饱和留白、四周古朴边框、无网格/文字/人物，便于UI叠加
const STYLE = '，中国风工笔游戏关卡背景插画，俯视视角，柔和低饱和配色，画面中部留白平坦便于叠加棋盘网格，四周有古朴石雕边框装饰，无任何文字，无网格线，无人物角色，无棋盘格子，竖版构图，氛围感';
const jobs = [
  { id: 'map-huoyanshan', prompt: '西游《火焰山》关卡：赤红火山岩大地、熔岩裂纹与远处炽红火焰山脉、暖橙红色调' + STYLE },
  { id: 'map-liushahe',  prompt: '西游《流沙河》关卡：黄沙河岸与流沙漩涡、岸边芦苇、暖黄土色调' + STYLE },
  { id: 'map-baiguling', prompt: '西游《白骨岭》关卡：灰白枯骨荒岭、嶙峋怪石与枯树、阴森冷灰绿色调' + STYLE },
  { id: 'map-pansidong', prompt: '西游《盘丝洞》关卡：幽紫洞窟岩壁与蛛网、朦胧紫粉色调' + STYLE },
];

async function gen(job) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: '1024x1536', n: 1, response_format: 'url', watermark: false }),
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
  try { await gen(job); } catch (e) { console.error(`❌ ${job.id}: ${e.message}`); }
}
console.log('地图背景生成完成');
