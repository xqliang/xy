// 用火山方舟 Ark · Seedream 4.0 单独生成「铲子」道具图标并下载 → 抠成透明 PNG。
// （5.0 模型当前 API key 无权限，沿用与其他素材一致的 4.0。）
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets');
mkdirSync(OUT, { recursive: true });

// 道具图标风格（区别于角色立绘：无全身/正面要求，强调物件剪影）
const STYLE = '，Q版扁平游戏道具图标，造型简洁、粗黑描边、强剪影、高饱和对比色、细节精简、居中大图、纯白色背景，无阴影，无文字，高辨识度';
const job = { id: 'item-shovel', prompt: '一把西游探险风格的铲子（洛阳铲/工兵铲），金黄色金属铲头 + 褐色木柄，斜放，主色金黄与褐色' + STYLE };

const res = await fetch(API, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
});
if (!res.ok) { console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(1); }
const data = await res.json();
const img = await fetch(data.data[0].url);
const buf = Buffer.from(await img.arrayBuffer());
writeFileSync(path.join(OUT, `${job.id}.jpg`), buf);
console.log(`✅ ${job.id}  ${(buf.length / 1024).toFixed(0)}KB`);
console.log('抠背景转透明 PNG…');
await import('./bg-remove.mjs');
