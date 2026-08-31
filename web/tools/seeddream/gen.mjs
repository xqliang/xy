// 用火山方舟 Ark · Seedream 4.0 批量生成《大圣与唐僧》Q版西游素材并下载。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
// 素材现统一落在 src/game-assets（旧 public/assets 目录已废弃、不再存在）。
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

const STYLE = '，Q版扁平游戏图标，造型简洁、粗黑描边、强剪影、高饱和对比色、细节精简、每个角色单一主色调、正面全身居中，纯白色背景，无地面、无脚下灰色投影、无底部白色光晕、无阴影，无文字，高辨识度';
const jobs = [
  { id: 'tangseng', prompt: '唐僧（年轻俊朗的僧人玄奘，二十多岁的青年和尚），干净白皙圆润的娃娃脸、光洁的下巴、清秀年轻的五官、慈眉善目，' +
    '严格无任何胡须：没有胡子、没有八字胡、没有山羊胡、没有络腮胡、嘴唇上方与下巴完全干净无毛，绝对不要老人脸、不要皱纹、不要显老，' +
    '金红色袈裟、毗卢帽、双手合十，主色金红' + STYLE },
  { id: 'unit-monkey', prompt: '天庭普通人类刀兵短发人脸（非猴非悟空），橙色哑光布甲软皮护甲（少金属高光），侧身向右，右手单手正握高举一把白色弯刀（柄在下方、白刃黑描边），左手空手禁止双刀，主色橙黄' + STYLE },
  { id: 'unit-spear', prompt: '天兵长枪手人类士兵，侧身打斗姿势面向右、双手握长枪向前突刺，亮青蓝铠甲、鲜红大枪缨与朱红腰带，主色青蓝+朱红' + STYLE },
  // 修复：旧图「主色绿色+单一主色调」把绿色泼到白马尾巴上、且脸糊成棕色团。
  // 这里明确：坐骑与马尾始终纯白、绿色只用于骑士披风战袍、露出正常肤色的清晰人脸。
  { id: 'unit-cavalry', prompt: '天将骑一匹纯白色骏马向右冲锋，坐骑通体纯白、白色马鬃、白色马尾（马的尾巴必须是纯白色，绝对不能是绿色或其它颜色），' +
    '骑士身披绿色披风、绿色战袍轻甲，露出清晰的人脸五官、正常自然的浅肤色（面色红润、眉眼清晰可辨，不要棕色脸、不要黑脸、不要糊成一团），' +
    '主色调绿色仅用于骑士的披风与战袍，白马与白色马尾始终保持纯白、不受主色影响' + STYLE },
  { id: 'unit-archer', prompt: '神箭手，紫色劲装、手持弓箭拉满，主色紫色' + STYLE },
  { id: 'monster-minion', prompt: '西游小妖卒，青绿皮肤獠牙、手持木棍，主色青绿色' + STYLE },
  { id: 'monster-boss', prompt: '牛魔王妖王，赤红肌肉、大牛角、黑铠甲，主色红色' + STYLE },
];

async function gen(job) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const url = data.data[0].url;
  const img = await fetch(url);
  const buf = Buffer.from(await img.arrayBuffer());
  const file = path.join(OUT, `${job.id}.jpg`);
  writeFileSync(file, buf);
  console.log(`✅ ${job.id}  ${(buf.length / 1024).toFixed(0)}KB  -> ${file}`);
}

// 可指定要生成的 id（如 `node gen.mjs unit-cavalry`）；不带参数则全量重生成。
const only = process.argv.slice(2);
const todo = jobs.filter((j) => only.length === 0 || only.includes(j.id));
if (todo.length === 0) { console.error(`没有匹配的 id：${only.join(', ')}`); process.exit(1); }
for (const job of todo) {
  try {
    await gen(job);
  } catch (e) {
    console.error(`❌ ${job.id}: ${e.message}`);
  }
}
console.log('生成完成，开始抠背景转透明 PNG…');
// 链式抠图：把刚下载的白底 jpg 转成透明 png（满足"素材须为透明PNG"的要求）
process.env.ASSET_DIR = OUT;
const savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...todo.map((j) => `${j.id}.jpg`)];
await import('./bg-remove.mjs');
// 再按显示尺寸裁透明边+缩放（并同步到 wechat/assets）
process.argv = [process.argv[0], process.argv[1], ...todo.map((j) => `${j.id}.png`)];
await import('./resize-portraits.mjs');
process.argv = savedArgv;

