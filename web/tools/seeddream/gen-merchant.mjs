// 神秘商人弹窗素材：与首页 gen-menu 同套哑光手绘水墨 Q 版。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

const REF =
  '参考竞品《赵云与阿斗》类弹窗UI：手绘水墨Q版，粗黑墨线不规则描边，哑光宣纸平涂，柔和淡彩晕染，';
const NEG =
  '，纯白色背景，无阴影，无界面外框，严禁玻璃高光、镜面反射、塑料质感、3D立体光泽、霓虹渐变';

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const jobs = [
  {
    id: 'merchant-peddler',
    size: '1024x1024',
    prompt:
      '西游记行脚神秘商人半身像，戴斗笠挑货担、灰褐长袍、慈眉笑眼，水墨Q版，占画布70%，无文字无边框' +
      REF +
      '灰赭檀木色系' +
      NEG,
  },
];

const todo = only.length ? jobs.filter((j) => only.includes(j.id)) : jobs;

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
  writeFileSync(path.join(OUT, `${job.id}.jpg`), Buffer.from(await img.arrayBuffer()));
  console.log(`✅ ${job.id}`);
}

for (const job of todo) {
  try {
    await gen(job);
  } catch (e) {
    console.error(`❌ ${job.id}: ${e.message}`);
  }
}

console.log('抠背景…');
process.env.ASSET_DIR = OUT;
const jpgOnly = todo.map((j) => `${j.id}.jpg`);
const savedArgv = process.argv;
if (jpgOnly.length > 0) process.argv = [process.argv[0], process.argv[1], ...jpgOnly];
await import('./bg-remove.mjs');
process.argv = savedArgv;
