// 生成宫檐标题牌匾（palace-title-plaque）：水墨弹窗标题栏「戴」在宫檐上的横向匾额。
//   红木/花梨木底 + 金漆雕花边框，中央大片平整留空（供 canvas 叠字，约容 6 个汉字）。
//   绿幕直出 → bg-remove-chroma.mjs 抠图 → resize 裁透明边+缩放 → PNG → tos-upload。
// 注意：无文字（文字后期 canvas 叠）、无投影、无地面（见 GREEN）。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');

const GREEN = '纯高饱和荧光绿 RGB(0,255,0) 绿幕背景满幅平涂，无阴影，无投影，无地面，无文字';

const jobs = [
  {
    id: 'palace-title-plaque', size: '1920x640',
    prompt: '中国传统横向牌匾/匾额正视图，横长方形，'
      + '深红木（红木、花梨木）底色，四周环绕金漆雕花边框，边框上有对称的金色云龙纹与卷云浮雕、四角金色雕饰，'
      + '匾额中央是一整片平整干净的深红木底面、大面积留空（不放任何图案与文字，供后期叠字，宽度约可容纳六个汉字），'
      + '古朴庄重、雍容大气，中国宫廷牌匾风格，扁平插画风格，细节精致，'
      + '牌匾完整居中、横贯画面左右、四周留出透明边距，' + GREEN,
  },
];

const only = process.argv.slice(2);
for (const job of jobs) {
  if (only.length && !only.includes(job.id)) continue;
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: job.size, n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) throw new Error(`${job.id} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  const buf = Buffer.from(await img.arrayBuffer());
  writeFileSync(path.join(OUT, `${job.id}.jpg`), buf);
  console.log(`✅ ${job.id}.jpg（绿幕原图 ${(buf.length / 1024).toFixed(0)}KB）`);
}
console.log('下一步：bg-remove-chroma.mjs palace-title-plaque.jpg → resize 裁边缩放 → 注册 + tos-upload');
