// 重新生成轰天雷立绘：古典中式球形雷 + 点燃引信 + 火花（小尺寸图标也能识别）
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

const STYLE = '，Q版扁平游戏图标，造型简洁、粗黑描边、强剪影、高饱和对比色、细节精简、单一主色调、正面全身居中，'
  + '纯高饱和荧光绿 RGB(0,255,0) 绿幕背景满幅平涂，无水墨/渐变/花纹/云纹/光晕/地面，'
  + '底部一直到画面底边全是纯绿幕、无任何阴影/投影/接触阴影，无文字，高辨识度';

const prompt = '一颗古典中式球形轰天雷（地雷炸弹），深色铸铁球形雷身、表面有凸起的雷纹铆钉、顶部插一根弯曲引信、引信末端火花迸发燃烧橙红火焰，整体呈圆球状不遮挡主体，神威霸气，主色玄黑配橙红火花' + STYLE;

const res = await fetch(API, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: MODEL, prompt, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
});
if (!res.ok) { console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
const data = await res.json();
const img = await fetch(data.data[0].url);
writeFileSync(path.join(OUT, 'skill-act-bomb.jpg'), Buffer.from(await img.arrayBuffer()));
console.log('OK skill-act-bomb.jpg  下一步: bg-remove-chroma → resize(180) → 上传');
