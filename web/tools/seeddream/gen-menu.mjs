// 用火山方舟 Ark · Seedream 4.0 生成首页竖版背景（水墨淡彩，与 map-* 关卡底图同规格）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

// 与 gen-maps.mjs 同一套水墨工笔规格
const STYLE = '，中国风工笔游戏关卡背景插画，柔和低饱和配色，水墨淡彩晕染，画面中部留白平坦便于叠加UI，四周有古朴石雕边框装饰，无任何文字，无网格线，无人物角色，竖版构图，氛围感';
const job = {
  id: 'menu-home',
  prompt: [
    '手游《大圣与唐僧》主菜单水墨背景，与关卡 map 底图同规格同气质：',
    '淡墨层峦、薄雾与留白，暗示齐天大圣护送唐僧西行的神话旅途；',
    '可用金箍棒轮廓、经卷、袈裟暖色、莲瓣或祥云等抽象符号点染氛围，',
    '不要具体地标或名场面（不要南天门、花果山、流沙河、灵山塔等），',
    '不要出现人物、猴子或和尚形象；中部留大片平坦暖黄宣纸区便于叠 UI',
  ].join('') + STYLE,
  size: '1024x1536',
};

const res = await fetch(API, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: job.size, n: 1, response_format: 'url', watermark: false }),
});
if (!res.ok) { console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(1); }
const data = await res.json();
const img = await fetch(data.data[0].url);
const buf = Buffer.from(await img.arrayBuffer());
writeFileSync(path.join(OUT, `${job.id}.jpg`), buf);
console.log(`✅ ${job.id}  ${(buf.length / 1024).toFixed(0)}KB  -> ${path.join(OUT, `${job.id}.jpg`)}`);
