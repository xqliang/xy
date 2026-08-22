// 生成黄狮精小 Boss 立绘。黄毛狮精，绿幕背景便于软抠（避免洪泛滥扣黄色）。
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
  + '脚下方一直到画面底边全是纯绿幕、无任何阴影/投影/接触阴影，无文字，高辨识度';

const JOBS = [
  { id: 'monster-miniboss-lion', prompt: '黄狮精小首领，西游记玉华州偷兵器的黄毛狮子精妖王、壮硕黄鬃狮头妖怪、獠牙利爪、身披简陋黄褐盗甲、眼神狡黠、体型比小妖大比妖王小，威猛，主色金黄色' + STYLE },
];

for (const job of JOBS) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) { console.error(`${job.id} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); continue; }
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  writeFileSync(path.join(OUT, `${job.id}.jpg`), Buffer.from(await img.arrayBuffer()));
  console.log(`OK ${job.id}`);
}
console.log('下一步: bg-remove-chroma → resize → 接线 → 上传');
