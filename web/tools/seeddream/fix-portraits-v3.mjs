// 立绘修复脚本：处理四个素材问题
// 1) 唐僧 - 背景有黄色残留，需用更纯的绿幕重生成
// 2) 哪吒 - 风火轮像轮胎，完全去掉（双脚悬浮）
// 3) 弥勒佛 - 穿着人字拖，改为赤脚
// 4) 小妖 - 白色块没清理干净
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');

// 国风风格
const STYLE =
  '，国风游戏立绘，工笔淡彩与国潮插画风格，衣袂飘逸、线条流畅、色彩雅致，半写实、头身比接近正常人物比例（不要大头Q版娃娃、不要过度萌化），细节精致、正面全身立姿居中、人物完整不裁切';

// 绿幕+强硬反阴影
const GREEN =
  '，【背景要求】整幅背景必须是单一高饱和荧光绿色块 RGB(0,255,0) 摄影棚绿幕，满幅纯色平涂，绝对不要国风水墨/雾气/渐变/花纹/云纹/光晕/暗角地面背景，只要一整块纯绿。角色必须完全悬浮于幕布前、双脚（或马蹄）离地不接触地面，严禁任何阴影——包括 cast shadow、落地阴影、脚下投影、接触阴影、环境光阴影、漫反射阴影、软阴影、脚下任何灰/黑/白/棕/红的阴影色块，脚底下方必须是纯绿幕一直延伸到画面底边';

// 通用负面
const NEG =
  '，无文字无logo无边框，无地面投影，不要任何阴影，不要现代物品';

const jobs = [
  {
    id: 'hero-tangseng-hero',
    prompt:
      '唐僧，唐朝取经高僧，慈眉善目的白净少年僧人，头戴毗卢帽（五佛冠），' +
      '身披红底金绣锦襕袈裟，颈挂佛珠，右手持九环锡杖，左手捻佛珠，端正庄严' +
      STYLE + GREEN + NEG +
      '，严禁背景出现黄色/棕色/任何非绿色块',
  },
  {
    id: 'hero-nezha',
    prompt:
      '哪吒三太子，双丸子发髻的英武少年，额点红印眉心红痣，红色战袍肚兜、腰间红色混天绫长绫随风飘扬，' +
      '赤露双臂，下身红色镶黄边灯笼裤，' +
      '双手紧握一杆【完整挺直的火尖枪】——长枪杆一整根不折不缩、枪尖朝上带橙红火焰；' +
      '双脚自然收于身下、完全悬浮于幕布前不接触地面，' +
      '【严禁风火轮】不要任何火焰圆环、不要任何脚踏物、不要轮子、不要轮胎橡胶、不要辐条、不要轮毂、不要车轴' +
      STYLE + GREEN + NEG +
      '，严禁风火轮、严禁脚踏物、严禁轮胎辐条',
  },
  {
    id: 'hero-mile',
    prompt:
      '弥勒佛，笑口常开的欢喜佛，光头大耳，面露喜色开怀大笑，' +
      '身披金色袈裟、坦腹露怀，右手持一串佛珠，左手提一只土黄色布袋，身形浑圆福态，' +
      '双足赤脚赤裸不穿任何鞋履，露出脚趾和脚背' +
      STYLE + GREEN + NEG +
      '，严禁穿鞋、严禁人字拖、严禁拖鞋、严禁任何鞋类，必须赤脚',
  },
  {
    id: 'monster-minion',
    prompt:
      'Q版小妖怪，青绿色皮肤、獠牙外露、手持木棍，造型简洁粗犷，单色青绿' +
      '，Q版扁平游戏图标，造型简洁、粗黑描边、强剪影、高饱和对比色、细节精简、正面全身居中，纯白色背景，无地面、无脚下灰色投影、无底部白色光晕、无阴影，无文字，高辨识度' +
      '，背景必须纯白色RGB(255,255,255)，不要有任何杂色',
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
  const buf = Buffer.from(await img.arrayBuffer());
  const file = path.join(OUT, `${job.id}.jpg`);
  writeFileSync(file, buf);
  console.log(`✅ 生成 ${job.id}.jpg (${(buf.length / 1024).toFixed(0)}KB)`);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const todo = only.length ? jobs.filter((j) => only.includes(j.id)) : jobs;

console.log(`开始生成 ${todo.length} 个素材...`);
for (const job of todo) {
  try { await gen(job); } catch (e) { console.error(`❌ ${job.id}: ${e.message}`); }
}

console.log('\n开始绿幕/白幕抠图...');
process.env.ASSET_DIR = OUT;
let savedArgv = process.argv;

// 白底的处理方式不同（小妖用白底）
const jpgFiles = todo.map((j) => `${j.id}.jpg`);
process.argv = [process.argv[0], process.argv[1], ...jpgFiles];

// 对 hero 系列用绿幕抠图
const heroJpgs = todo.filter(j => j.id.startsWith('hero-')).map(j => `${j.id}.jpg`);
if (heroJpgs.length) {
  process.argv = [process.argv[0], process.argv[1], ...heroJpgs];
  await import('./bg-remove-chroma.mjs');
}

// 对小妖用白底抠图
const minionJpgs = todo.filter(j => j.id === 'monster-minion').map(j => `${j.id}.jpg`);
if (minionJpgs.length) {
  process.argv = [process.argv[0], process.argv[1], ...minionJpgs];
  await import('./bg-remove.mjs');
}

console.log('\n裁剪缩放...');
process.argv = [process.argv[0], process.argv[1], ...todo.map((j) => `${j.id}.png`)];
await import('./resize-portraits.mjs');

console.log('\n✅ 全部完成！');
