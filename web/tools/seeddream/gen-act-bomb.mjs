// 生成「轰天雷」炸药立绘：国风黑铁圆球炸弹 + 引信火花，绿幕背景便于抠图。
// 参照素材规则：无阴影/地面/光晕，绿幕直出便于 chroma key。
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
  '一颗古典黑铁圆球炸弹（像西游记/国风里的「轰天雷」），球身乌黑发亮带金属高光与铆钉，' +
  '顶部有一小段燃烧的引信、迸出橙黄色火花与几点飞溅火星；' +
  'Q版扁平游戏美术，造型简洁、粗黑描边、强剪影、高饱和对比色、细节精简，' +
  '主色乌铁黑配橙红火花，物体完整居中、正面略俯视，' +
  '纯绿色幕布背景 chroma key green screen，无地面、无脚下投影、无光晕、无阴影、无文字，高辨识度';

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
const file = path.join(OUT, 'skill-act-bomb-raw.jpg');
writeFileSync(file, buf);
console.log(`OK skill-act-bomb-raw ${(buf.length / 1024).toFixed(0)}KB -> ${file}`);
