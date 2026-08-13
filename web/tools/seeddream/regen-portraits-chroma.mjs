// 国风重绘 哪吒/二郎神/观音：模型直出「绿幕/蓝幕」纯色背景 → 绿蓝幕软抠，避免误伤白/银。
// 风格：降低大头Q版比例，走国风工笔淡彩 + 国潮插画。生成后 chroma-key 抠图 → resize。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

// 国风：工笔淡彩 + 国潮插画，头身比接近正常（不要大头娃娃），衣袂飘逸线条流畅。
const STYLE =
  '，国风游戏立绘，工笔淡彩与国潮插画风格，衣袂飘逸、线条流畅、色彩雅致，半写实、头身比接近正常人物比例（不要大头Q版娃娃、不要过度萌化），细节精致、正面全身立姿居中、人物完整不裁切';
// 纯色幕背景 + 通用负面
const GREEN = '，【背景要求】整幅背景必须是单一高饱和荧光绿色块 RGB(0,255,0) 摄影棚绿幕，满幅纯色平涂，绝对不要国风水墨/雾气/渐变/花纹/云纹/光晕/暗角背景，只要一整块纯绿';
const BLUE = '，【背景要求】整幅背景必须是单一高饱和宝蓝色块 RGB(0,60,200) 摄影棚蓝幕，满幅纯色平涂，绝对不要国风水墨/雾气/渐变/花纹/云纹/光晕/暗角背景，只要一整块纯蓝';
const NEG = '，无文字无logo无边框，无地面投影，不要现代物品';

const jobs = [
  {
    id: 'hero-nezha',
    prompt:
      '哪吒三太子，双丸子发髻的英武少年，红色战袍肚兜、腰间红色混天绫长绫随风飘扬，' +
      '手中握着一杆【完整笔直的火尖枪】——长枪杆一整根不折断不断裂、枪尖朝上带火焰；' +
      '脚踏两只【燃烧的风火轮】——金红色法轮喷吐橙红火焰，是神话火轮不是黑色橡胶车胎；灵动飒爽' +
      STYLE + GREEN + NEG + '，长枪必须完整贯通不可断成两截',
  },
  {
    id: 'hero-erlang',
    prompt:
      '二郎神杨戬，额心睁开第三只竖眼、白银战甲配青色披风、手持三尖两刃神刀，英武挺拔；' +
      '身旁一只【哮天犬】神犬——身形精瘦矫健修长如猎犬与狼、银白短毛、獠牙微露、目光锐利凶悍机警，' +
      '绝不是圆滚滚短腿的现代萌宠柴犬柯基、不要憨萌表情' +
      STYLE + BLUE + NEG + '，哮天犬要神兽的凶猛威严不要可爱',
  },
  {
    id: 'hero-guanyin',
    prompt:
      '观音菩萨，头戴化佛宝冠、身披素白天衣长裙、佩璎珞项圈，一手托青瓷玉净瓶、一手拈杨柳枝，' +
      '面容慈悲庄严、双目微阖、宝相端丽' +
      STYLE + BLUE + NEG + '，白衣与净瓶务必完整保留不可被背景吞没',
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

console.log('绿/蓝幕抠图（自动识别每张幕色）…');
process.env.ASSET_DIR = OUT;
let savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...todo.map((j) => `${j.id}.jpg`)];
await import('./bg-remove-chroma.mjs');
process.argv = savedArgv;

console.log('裁剪缩放到显示尺寸…');
savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...todo.map((j) => `${j.id}.png`)];
await import('./resize-portraits.mjs');
process.argv = savedArgv;
