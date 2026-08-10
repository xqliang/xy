// 功德 / 体力 UI 图标：白底 Q 版物件 → 抠透明 PNG → 按显示尺寸×3 缩小。
// 用法：
//   ARK_API_KEY=xxx node web/tools/seeddream/gen-merit-stamina-icons.mjs
//   ARK_API_KEY=xxx node web/tools/seeddream/gen-merit-stamina-icons.mjs --skip-existing
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const skipExisting = process.argv.includes('--skip-existing');

const STYLE =
  '，Q版扁平游戏UI图标，单个物件居中占画布70%，粗黑墨线描边、强剪影、高饱和对比色、细节精简、纯白色背景，无阴影，无文字，无UI边框，高辨识度，适合小尺寸仍清晰';

// 显示尺寸见 menu.ts / shop.ts / menu-popups.ts；生成后 resize 到 display×3
const jobs = [
  {
    id: 'icon-merit',
    prompt: '一枚金黄莲花宝珠货币图标，圆形金珠带淡粉莲瓣点缀，西游功德币意象' + STYLE,
  },
  {
    id: 'icon-stamina',
    prompt: '一枚青绿闪电灵力气珠，体力能量意象，圆形宝珠带金色电光' + STYLE,
  },
];

const selected = only.length
  ? jobs.filter((j) => only.some((o) => j.id === o || j.id.replace('icon-', '') === o))
  : jobs;

if (selected.length === 0) {
  console.error('没有匹配的任务');
  process.exit(1);
}

async function gen(job) {
  const pngPath = path.join(OUT, `${job.id}.png`);
  if (skipExisting && existsSync(pngPath)) {
    console.log(`⏭  ${job.id} 已存在，跳过`);
    return false;
  }
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: job.prompt,
      size: '1024x1024',
      n: 1,
      response_format: 'url',
      watermark: false,
    }),
  });
  if (!res.ok) {
    console.error(`❌ ${job.id} HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`);
    return false;
  }
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  const buf = Buffer.from(await img.arrayBuffer());
  writeFileSync(path.join(OUT, `${job.id}.jpg`), buf);
  console.log(`✅ ${job.id}  ${Math.round(buf.length / 1024)}KB`);
  return true;
}

let ok = 0;
for (const job of selected) {
  if (await gen(job)) ok += 1;
  await new Promise((r) => setTimeout(r, 400));
}

console.log(`生成完成 ${ok}/${selected.length}，开始抠透明…`);
const rem = spawnSync(process.execPath, ['bg-remove.mjs'], {
  cwd: path.dirname(fileURLToPath(import.meta.url)),
  env: { ...process.env, ASSET_DIR: OUT },
  stdio: 'inherit',
});
if ((rem.status ?? 1) !== 0) process.exit(rem.status ?? 1);

console.log('裁剪缩放到显示尺寸×3…');
const pngArgs = selected.map((j) => `${j.id}.png`);
const resize = spawnSync(process.execPath, ['resize-portraits.mjs', ...pngArgs], {
  cwd: path.dirname(fileURLToPath(import.meta.url)),
  env: { ...process.env, ASSET_DIR: OUT },
  stdio: 'inherit',
});
process.exit(resize.status ?? 1);
