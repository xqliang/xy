// 国风重绘 第2 轮：修复底部阴影 + 哪吒风火轮像轮胎的问题。
// 比 regen-portraits-chroma.mjs 强化两点：
//   1) 背景 GREEN 指令强硬要求「角色悬浮、双脚/马蹄离地、纯幕布延伸到画面底边、严禁任何阴影」——
//      AI 默认给 cast shadow，而 chroma 只扣屏幕色，灰色投影会漏过去。regeneration 阶段压掉是根本解。
//   2) 哪吒 WHEEL 子句把风火轮明确描述为「纯火焰圆环、无任何实体（轮胎/辐条/轮毂/车轴/实心体）」，反复强调
//      是神话火轮不是黑色橡胶车胎——第 1 轮模型仍画了轮胎，这里用更直白的描述强制。
// 管线 gen → bg-remove-chroma → resize-portraits，与 round1 完全一致。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

// 国风：工笔淡彩 + 国潮插画，头身比接近正常（不要大头 Q 版娃娃），衣袂飘逸线条流畅。
const STYLE =
  '，国风游戏立绘，工笔淡彩与国潮插画风格，衣袂飘逸、线条流畅、色彩雅致，半写实、头身比接近正常人物比例（不要大头Q版娃娃、不要过度萌化），细节精致、正面全身立姿居中、人物完整不裁切';
// 纯绿幕 + 强硬反阴影：角色悬浮、脚底离地、纯幕到底、绝无任何阴影。
const GREEN =
  '，【背景要求】整幅背景必须是单一高饱和荧光绿色块 RGB(0,255,0) 摄影棚绿幕，满幅纯色平涂，绝对不要国风水墨/雾气/渐变/花纹/云纹/光晕/暗角地面背景，只要一整块纯绿。角色必须完全悬浮于幕布前、双脚（或马蹄）离地不接触地面，严禁任何阴影——包括 cast shadow、落地阴影、脚下投影、接触阴影、环境光阴影、漫反射阴影、软阴影、脚下任何灰/黑/白/棕/红的阴影色块，脚底下方必须是纯绿幕一直延伸到画面底边';
// 通用负面：反阴影 + 反现代物品。
const NEG =
  '，无文字无logo无边框，无地面投影，不要任何阴影，不要现代物品';

// 风火轮专用强化说明（哪吒用）：纯火焰构成、无任何实体结构。
const WHEEL =
  '双脚各踩着一团【纯火焰风火轮】——两团高速旋转的金红色烈焰漩涡，绝对没有任何实体结构：不是轮子、没有轮胎橡胶、没有金属辐条、没有轮毂、没有车轴、没有实心轮体、没有骨架、没有夹层、没有内外圈之分，就是两圈由内向外（深红→橙红→橙黄）翻涌的环形火焰，脚踏之处只见翻腾的火焰与飘散火星、不见任何固体，严禁轮胎、橡胶、辐条、轮毂、金属、车轴、车辆机械部件、任何现代工业制品';

const jobs = [
  {
    id: 'hero-shaseng',
    prompt:
      '沙悟净，天庭卷帘大将，光头络腮黑须的威猛和尚、浓眉方脸神色刚毅，' +
      '身披土黄棕色僧袍、腰扎深色系带，手持一杆九环禅杖，项戴一串骷髅头念珠，魁梧挺拔' +
      STYLE + GREEN + NEG,
  },
  {
    id: 'hero-mile',
    prompt:
      '弥勒佛，笑口常开的欢喜佛，光头大耳，面露喜色开怀大笑，' +
      '身披金色袈裟、坦腹露怀，右手持一串佛珠，左手提一只土黄色布袋，身形浑圆福态' +
      STYLE + GREEN + NEG,
  },
  {
    id: 'hero-tangseng-hero',
    prompt:
      '唐僧，唐朝取经高僧，慈眉善目的白净少年僧人，头戴毗卢帽（五佛冠），' +
      '身披红底金绣锦襕袈裟，颈挂佛珠，右手持九环锡杖，左手捻佛珠，端正庄严' +
      STYLE + GREEN + NEG,
  },
  {
    id: 'loading-tangseng',
    prompt:
      '唐僧骑马，慈眉善目的白净僧人，头戴毗卢帽五佛冠，身披红底金绣锦襕袈裟，' +
      '骑在一匹昂首行进的白色骏马上，手持九环锡杖，马匹四蹄腾空悬浮不接触地面' +
      STYLE + GREEN + NEG + '，白马要纯白无杂色，不要鞍鞯镫具体具复杂化',
  },
  {
    id: 'hero-nezha',
    prompt:
      '哪吒三太子，双丸子发髻的英武少年，额点红印眉心红痣，红色战袍肚兜、腰间红色混天绫长绫随风飘扬，' +
      '赤露双臂，下身红色镶黄边灯笼裤，' +
      '双手紧握一杆【完整挺直的火尖枪】——长枪杆一整根不折不扣、枪尖朝上带橙红火焰；' +
      WHEEL +
      STYLE + GREEN + NEG + '，风火轮必须纯火焰无实体、严禁轮胎辐条',
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
