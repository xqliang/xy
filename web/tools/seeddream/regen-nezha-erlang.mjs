// 重绘 哪吒 / 二郎神 立绘：修掉「风火轮像轮胎」「哮天犬像现代萌宠」两个硬伤，
// 沿用现有半立体 Q 版立绘画风。生成白底 JPG → 链式 bg-remove（jpg→透明png）→ resize。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

// 与现有首页立绘同套：半立体 Q 版、柔和体积光影、精致但不繁杂、正面居中、纯白底无影无字。
const STYLE =
  '，半立体Q版游戏立绘，大头身、柔和体积光影、精致渲染、造型清晰高辨识度、正面全身居中，纯白色背景，无地面阴影，无投影，无文字，无边框';
const NEG =
  '，严禁现代物品，严禁橡胶轮胎，严禁写实照片，严禁灰色地面投影，严禁白色描边光晕';

const jobs = [
  {
    id: 'hero-nezha',
    prompt:
      '哪吒三太子，双丸子发髻的英气孩童，红色战裙肚兜、腰系随风飘扬的红色混天绫长绫、手持金红火尖枪；' +
      '脚下踩着两只【燃烧的风火轮】——金红色法轮边缘熊熊喷吐橙红火焰、轮内有火焰纹与金环，是神话火轮绝不是黑色橡胶车胎；' +
      '整体英武灵动' + STYLE + NEG + '，风火轮务必是燃烧的火焰法轮而非轮胎',
  },
  {
    id: 'hero-erlang',
    prompt:
      '二郎神杨戬，额心睁开第三只竖眼、白银战甲配淡青披风、手持三尖两刃神刀，威武英挺；' +
      '身旁伴随【哮天犬】——一只威猛的神话战犬，身形精瘦矫健修长如猎犬与狼、银白短毛、獠牙微露、神情凶悍机警、目光锐利，' +
      '绝不是圆滚滚的现代萌宠柴犬或柯基，不要短腿肥身不要憨萌表情' + STYLE + NEG + '，哮天犬要凶猛神兽感不要可爱',
  },
];

async function gen(job) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  writeFileSync(path.join(OUT, `${job.id}.jpg`), Buffer.from(await img.arrayBuffer()));
  console.log(`✅ 生成 ${job.id}`);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const todo = only.length ? jobs.filter((j) => only.includes(j.id)) : jobs;
for (const job of todo) {
  try { await gen(job); } catch (e) { console.error(`❌ ${job.id}: ${e.message}`); }
}

console.log('抠背景（jpg→透明png）…');
process.env.ASSET_DIR = OUT;
let savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...todo.map((j) => `${j.id}.jpg`)];
await import('./bg-remove.mjs');
process.argv = savedArgv;

console.log('额外清理地影/白边…');
savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...todo.map((j) => `${j.id}.png`)];
await import('./fix-nezha-erlang.mjs');
process.argv = savedArgv;

console.log('裁剪缩放到显示尺寸…');
savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...todo.map((j) => `${j.id}.png`)];
await import('./resize-portraits.mjs');
process.argv = savedArgv;
