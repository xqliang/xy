// 重新生成 menu-btn-codex，让文字大小与 menu-btn-settings 一致
// 问题：codex 卷轴图标占比过大，导致「图鉴」文字比「设置」小
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');

// 与设置按钮完全一致的风格，只换图标和文字
const SIDE_STYLE =
  '，手绘水墨Q版，淡赭石宣纸底、细墨线勾边，单色灰赭墨线，无金边无朱红无蓝无绿无彩色边框无彩色装饰，低饱和，纯白色背景，无阴影，平涂无高光，严禁玻璃高光霓虹渐变';

const jobs = [
  {
    id: 'menu-btn-codex',
    prompt:
      '简约水墨侧栏方形小按钮，正方形按钮主体占满整个画布，与设置按钮完全相同的正方形按钮大小，' +
      '淡赭石宣纸底、细墨线勾边，' +
      '中央仅小型竹简卷轴符号（卷轴尺寸约为按钮的35%，不要过大），' +
      '下方清晰大字「图鉴」（文字大小与设置按钮的"设置"文字完全一致，约占按钮高度的25%），' +
      '不要人物，不要小纸片不要碎角不要左上角方框不要画中画不要角落缩略图，' +
      '整图单色水墨无彩色，平涂无高光' +
      SIDE_STYLE,
  },
];

async function gen(job) {
  console.log(`生成 ${job.id}...`);
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  const buf = Buffer.from(await img.arrayBuffer());
  writeFileSync(path.join(OUT, `${job.id}.jpg`), buf);
  console.log(`✅ ${job.id}.jpg (${(buf.length / 1024).toFixed(0)}KB)`);
}

for (const job of jobs) {
  try { await gen(job); } catch (e) { console.error(`❌ ${job.id}: ${e.message}`); }
}

console.log('\n白幕抠图...');
process.env.ASSET_DIR = OUT;
let savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...jobs.map((j) => `${j.id}.jpg`)];
await import('./bg-remove.mjs');
process.argv = savedArgv;

console.log('\n裁剪缩放...');
process.argv = [process.argv[0], process.argv[1], ...jobs.map((j) => `${j.id}.png`)];
await import('./resize-portraits.mjs');

console.log('\n上传 CDN...');
const { execSync } = await import('node:child_process');
execSync('node tools/tos-upload.mjs', { stdio: 'inherit' });

console.log('\n✅ 全部完成！');
