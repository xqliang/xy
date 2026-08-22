// 立绘修复第二轮：唐僧和哪吒底部有雾气/地面残留，加强 prompt 再生成。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');

const STYLE =
  '，国风游戏立绘，工笔淡彩与国潮插画风格，衣袂飘逸、线条流畅、色彩雅致，半写实、头身比接近正常人物比例（不要大头Q版娃娃、不要过度萌化），细节精致、正面全身立姿居中、人物完整不裁切';

// 超强硬反阴影+反雾气+反地面：角色完全悬空，纯幕延伸到画面底边
const GREEN =
  '，【背景要求】整幅背景必须是单一高饱和荧光绿色块 RGB(0,255,0) 摄影棚绿幕，满幅纯色平涂，绝对不要国风水墨/雾气/渐变/花纹/云纹/光晕/暗角地面背景，只要一整块纯绿。' +
  '【严禁】角色脚下和周围不要有任何雾气、烟雾、云朵、尘埃、微粒、薄雾、浓雾、水汽、烟尘——这些都不是背景是画面脏点，' +
  '严禁任何地面元素——不要地面、不要泥土、不要岩石、不要草地、不要平台、不要台阶、不要任何支撑物，' +
  '角色必须完全悬浮于幕布前、双脚（或赤足）离地不接触任何东西，' +
  '严禁任何阴影——包括 cast shadow、落地阴影、脚下投影、接触阴影、环境光阴影、漫反射阴影、软阴影、脚下任何灰/黑/白/棕/红的阴影色块，' +
  '脚底下方和画面底部必须是纯绿幕一直延伸到画面底边';

const NEG =
  '，无文字无logo无边框，无地面投影，不要任何阴影，不要现代物品，不要雾气不要烟雾不要云朵';

const jobs = [
  {
    id: 'hero-tangseng-hero',
    prompt:
      '唐僧，唐朝取经高僧，慈眉善目的白净少年僧人，头戴毗卢帽（五佛冠），' +
      '身披红底金绣锦襕袈裟，颈挂佛珠，右手持九环锡杖，左手捻佛珠，端正庄严，' +
      '双足赤裸赤脚不穿鞋，脚底完全悬空离地不接触任何东西' +
      STYLE + GREEN + NEG +
      '，严禁背景出现黄色/棕色/任何非绿色块，严禁脚下雾气/烟雾/尘埃/地面',
  },
  {
    id: 'hero-nezha',
    prompt:
      '哪吒三太子，双丸子发髻的英武少年，额点红印眉心红痣，红色战袍肚兜、腰间红色混天绫长绫随风飘扬，' +
      '赤露双臂，下身红色镶黄边灯笼裤，赤脚，' +
      '双手紧握一杆【完整挺直的火尖枪】——长枪杆一整根不折不缩、枪尖朝上带橙红火焰；' +
      '双脚自然收于身下、完全悬浮于幕布前不接触地面，脚底完全悬空，' +
      '【严禁风火轮】不要任何火焰圆环、不要任何脚踏物、不要轮子、不要轮胎橡胶、不要辐条、不要轮毂、不要车轴' +
      STYLE + GREEN + NEG +
      '，严禁风火轮、严禁脚踏物、严禁轮胎辐条、严禁脚下雾气/烟雾/云朵/地面效果',
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
let savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...jobs.map((j) => `${j.id}.jpg`)];
await import('./bg-remove-chroma.mjs');
process.argv = savedArgv;

console.log('\n裁剪缩放...');
process.argv = [process.argv[0], process.argv[1], ...jobs.map((j) => `${j.id}.png`)];
await import('./resize-portraits.mjs');

console.log('\n✅ 全部完成！');
