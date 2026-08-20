// 生成哮天犬立绘（二郎神大招冲出咬怪的猎犬）。Q版厚描边冲锋态、绿幕背景便于抠图。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

const STYLE = '，Q版扁平游戏图标，造型简洁、粗黑描边、强剪影、高饱和对比色、细节精简、单一主色调、侧面全身冲锋姿态朝右，'
  + '纯高饱和荧光绿 RGB(0,255,0) 绿幕背景满幅平涂，无水墨/渐变/花纹/云纹/光晕/地面，'
  + '四蹄下方一直到画面底边全是纯绿幕、无任何阴影/投影/接触阴影，无文字，高辨识度';

const prompt = '哮天犬，中国神话中二郎神的哮天犬，矫健的黑色细腰猎犬、周身缠绕淡淡金色灵光、项戴红色项圈、獠牙外露怒吼、四蹄腾空朝右猛冲，神骏威猛，主色玄黑配金红' + STYLE;

const res = await fetch(API, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: MODEL, prompt, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
});
if (!res.ok) { console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
const data = await res.json();
const img = await fetch(data.data[0].url);
writeFileSync(path.join(OUT, 'hero-ttg.jpg'), Buffer.from(await img.arrayBuffer()));
console.log('OK hero-ttg.jpg  下一步: bg-remove-chroma → resize(200) → 接线 → 上传');
