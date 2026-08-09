// 用火山方舟 Ark · Seedream 4.0 生成神秘商人弹窗 UI 素材（西游卷轴 + 行脚商人头像）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

const UI_STYLE = '，Q版扁平游戏UI素材，造型简洁、粗黑描边、高饱和对比色、纯白色背景，无阴影，无文字，高辨识度';
const jobs = [
  {
    id: 'merchant-scroll',
    prompt: '竖版古风游戏弹窗卷轴面板，西游记宣纸质感，金黄纸面、深褐木轴上下卷边、朱红祥云暗纹边框，居中留白给UI' + UI_STYLE,
    size: '1024x1536',
  },
  {
    id: 'merchant-peddler',
    prompt: '西游记行脚神秘商人头像，戴斗笠穿灰褐长袍、挑货担、慈眉笑眼，主色褐黄' + UI_STYLE,
    size: '1024x1024',
  },
];

async function gen(job) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: job.prompt,
      size: job.size,
      n: 1,
      response_format: 'url',
      watermark: false,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const img = await fetch(data.data[0].url);
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
console.log('抠背景转透明 PNG…');
process.env.ASSET_DIR = OUT;
await import('./bg-remove.mjs');
