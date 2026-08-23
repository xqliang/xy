// 重生成 hero-mile（提灯老头/弥勒佛头像立绘）：v3 版绿幕不纯+腿部白色雾气残留。
// 采用 fix-portraits-v4 的硬化绿幕 + 反雾气 prompt（该方案已成功修复唐僧）。
// 流程：Seedream 生成 → 绿幕软抠 → 裁剪缩放（resize-portraits 的 TARGET：780）。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');

const STYLE =
  '，国风游戏立绘，工笔淡彩与国潮插画风格，衣袂飘逸、线条流畅、色彩雅致，半写实、头身比接近正常人物比例（不要大头Q版娃娃、不要过度萌化），细节精致、正面全身立姿居中、人物完整不裁切';

// 超强硬反阴影+反雾气+反地面（v4 方案，唐僧已验证有效）：纯绿幕延伸到底边，无任何雾气白块
const GREEN =
  '，【背景要求】整幅背景必须是单一高饱和荧光绿色块 RGB(0,255,0) 摄影棚绿幕，满幅纯色平涂，绝对不要国风水墨/雾气/渐变/花纹/云纹/光晕/暗角地面背景，只要一整块纯绿。' +
  '【严禁】角色脚下和周围不要有任何雾气、烟雾、云朵、尘埃、微粒、薄雾、浓雾、水汽、烟尘、白色光晕、白色雾块、灰白色区域——这些都不是背景是画面脏点，' +
  '严禁任何地面元素——不要地面、不要泥土、不要岩石、不要草地、不要平台、不要台阶、不要任何支撑物，' +
  '角色必须完全悬浮于幕布前、双脚（或赤足）离地不接触任何东西，' +
  '严禁任何阴影——包括 cast shadow、落地阴影、脚下投影、接触阴影、环境光阴影、漫反射阴影、软阴影、脚下任何灰/黑/白/棕/红的阴影色块，' +
  '脚底下方和画面底部必须是纯绿幕一直延伸到画面底边';

const NEG =
  '，无文字无logo无边框，无地面投影，不要任何阴影，不要现代物品，不要雾气不要烟雾不要云朵不要白色光晕';

const jobs = [
  {
    id: 'hero-mile',
    prompt:
      '弥勒佛，笑口常开的欢喜佛，光头大耳，面露喜色开怀大笑，' +
      '身披金色袈裟、坦腹露怀，右手持一串佛珠，左手提一只土黄色布袋，身形浑圆福态，' +
      '双足赤脚赤裸不穿任何鞋履，露出脚趾和脚背，' +
      '身上衣物与布袋均为饱和的金黄棕暖色，严禁任何白色或灰白色衣物、饰物、光效' +
      STYLE + GREEN + NEG +
      '，严禁穿鞋、严禁人字拖、严禁拖鞋、严禁任何鞋类，必须赤脚，严禁白色雾气/白色块/灰白残留',
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

console.log('\n绿幕抠图...');
process.env.ASSET_DIR = OUT;
const savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...jobs.map((j) => `${j.id}.jpg`)];
await import('./bg-remove-chroma.mjs');
process.argv = savedArgv;

console.log('\n裁剪缩放...');
process.argv = [process.argv[0], process.argv[1], ...jobs.map((j) => `${j.id}.png`)];
await import('./resize-portraits.mjs');
process.argv = savedArgv;

console.log('\n✅ hero-mile 重生成完成');
