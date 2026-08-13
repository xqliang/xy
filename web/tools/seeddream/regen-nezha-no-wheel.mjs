// 哪吒立绘 no-wheel 版：彻底去掉风火轮。之前 WHEEL 反复强化仍画成轮胎，
// 索性不要——双脚自然收于身下、完全悬浮于幕布前，靠混天绫飘带与火尖枪保持
// 动态平衡。prompt / 管线 / 风格与 regen-portraits-round2.mjs 完全一致，
// 仅哪吒 job 原文删除风火轮子句，便于以后回退对比两版。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

// 国风：工笔淡彩 + 国潮插画，头身比接近正常（不要大头 Q 版娃娃）。
const STYLE =
  '，国风游戏立绘，工笔淡彩与国潮插画风格，衣袂飘逸、线条流畅、色彩雅致，半写实、头身比接近正常人物比例（不要大头Q版娃娃、不要过度萌化），细节精致、正面全身立姿居中、人物完整不裁切';
// 纯绿幕 + 强硬反阴影：角色悬浮、脚底离地、纯幕到底、绝无任何阴影。
const GREEN =
  '，【背景要求】整幅背景必须是单一高饱和荧光绿色块 RGB(0,255,0) 摄影棚绿幕，满幅纯色平涂，绝对不要国风水墨/雾气/渐变/花纹/云纹/光晕/暗角地面背景，只要一整块纯绿。角色必须完全悬浮于幕布前、双脚自然收于身下不接触地面，严禁任何阴影——包括 cast shadow、落地阴影、脚下投影、接触阴影、环境光阴影、漫反射阴影、软阴影、脚下任何灰/黑/白/棕/红的阴影色块，脚底下方必须是纯绿幕一直延伸到画面底边';
// 通用负面：反阴影 + 反现代物品。
const NEG =
  '，无文字无logo无边框，无地面投影，不要任何阴影，不要现代物品';

const jobs = [
  {
    id: 'hero-nezha',
    prompt:
      '哪吒三太子，双丸子发髻的英武少年，额点红印眉心红痣，红色战袍肚兜、腰间红色混天绫长绫随风飘扬，' +
      '赤露双臂，下身红色镶黄边灯笼裤，' +
      '双手紧握一杆【完整挺直的火尖枪】——长枪杆一整根不折不扣、枪尖朝上带橙红火焰；' +
      '双脚自然收于身下、完全悬浮于幕布前不接触地面，' +
      '【严禁风火轮】不要任何火焰圆环、不要任何脚踏物、不要轮子、不要轮胎橡胶、不要辐条、不要轮毂、不要车轴' +
      STYLE + GREEN + NEG + '，严禁风火轮、严禁脚踏物、严禁轮胎辐条',
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
  await writeFileSync(path.join(OUT, `${job.id}.jpg`), Buffer.from(await img.arrayBuffer()));
  console.log(`✅ 生成 ${job.id}`);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const todo = only.length ? jobs.filter((j) => only.includes(j.id)) : jobs;
for (const job of todo) {
  try { await gen(job); } catch (e) { console.error(`❌ ${job.id}: ${e.message}`); }
}

console.log('绿幕抠图（自动识别每张幕色）…');
process.env.ASSET_DIR = OUT;
let savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...todo.map((j) => `${j.id}.jpg`)];
await import('./bg-remove-chroma.mjs');
process.argv = savedArgv;

console.log('裁剪缩放显示尺寸…');
savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...todo.map((j) => `${j.id}.png`)];
await import('./resize-portraits.mjs');
process.argv = savedArgv;
