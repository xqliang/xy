// 生成太白金星武将立绘（白骨→太白改名，重新生成）：白衣白须仙官 → 蓝幕直出避免误抠白衣。
// 流程：蓝幕 1024×1024 → bg-remove-chroma 软抠 → resize-portraits（780px）→ pngquant → tos-upload。
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

// 国风工笔范式（同 regen-portraits-chroma.mjs）：头身比正常，不要大头Q版
const STYLE =
  '，国风游戏立绘，工笔淡彩与国潮插画风格，衣袂飘逸、线条流畅、色彩雅致，半写实、头身比接近正常人物比例（不要大头Q版娃娃、不要过度萌化），细节精致、正面全身立姿居中、人物完整不裁切';
const BLUE = '，【背景要求】整幅背景必须是单一高饱和宝蓝色块 RGB(0,60,200) 摄影棚蓝幕，满幅纯色平涂，绝对不要国风水墨/雾气/渐变/花纹/云纹/光晕/暗角背景，只要一整块纯蓝';
const NEG = '，无文字无logo无边框，无地面投影，不要现代物品';

const jobs = [
  {
    id: 'hero-taibai',
    prompt:
      '太白金星，西天长庚星君，鹤发童颜的白须老仙官，头戴金色星冠、身披素白仙鹤纹道袍、' +
      '腰束玉带，一手执一柄白色拂尘（尘丝柔顺垂落）、一手托一颗金色星辰，面容慈和睿智、' +
      '目光含笑，仙风道骨气度雍容' +
      STYLE + BLUE + NEG + '，白袍与白须务必完整保留不可被背景吞没',
  },
];

for (const job of jobs) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) { console.error(`❌ ${job.id} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  const buf = Buffer.from(await img.arrayBuffer());
  writeFileSync(path.join(OUT, `${job.id}.jpg`), buf);
  console.log(`✅ ${job.id}.jpg ${(buf.length / 1024).toFixed(0)}KB`);
}
console.log('下一步：node tools/seeddream/bg-remove-chroma.mjs hero-taibai.jpg --screen blue → resize-portraits hero-taibai → pngquant → tos-upload');
