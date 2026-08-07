// 用火山方舟 Ark · Seedream 4.0 生成地图中线栅栏 / 出怪口扇叶贴图。
// 产出白底 JPG → bg-remove 抠透明 PNG → src/game-assets/。
// 栅栏图强调「左右无缝循环平铺」，闸门图为单扇可左右对称开合。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

const TILE =
  '，Q版卡通扁平插画游戏贴图（非像素风、非8bit），柔和赛璐璐上色、细描边、边缘柔和、' +
  '造型简洁、细节精简、正面居中，纯白色背景，无阴影，无文字，无人物';
const SEAMLESS =
  '，左右两端无缝循环平铺（seamless horizontal tile，左端与右端可首尾相接连续），' +
  '禁止像素块、禁止两端大卷浪/书挡式装饰、禁止左右不对称的独特造型、中间花纹均匀可重复';

const jobs = [
  {
    id: 'fence-liushahe',
    size: '2048x768',
    prompt:
      '西游流沙河中线栅栏用的一条横向砂石带：暖黄流沙沙丘纹理，均匀散布卵石与细碎砂砾，' +
      '禁止河水、水波、浪花、泡沫、水色，只做干燥沙石分隔条，像可拼接的游戏地面分隔条' +
      TILE + SEAMLESS,
  },
  {
    id: 'gate-liushahe',
    size: '1024x1024',
    prompt:
      '西游流沙河出怪口的一扇闸门扇叶：竖立的砂岩石柱门扇，门面有流沙纹理与细水纹装饰，' +
      'Q版扁平游戏图标，造型简洁、单侧门扇（不是整对门）、可左右镜像开合，' +
      '正面居中，纯白色背景，无阴影，无文字，高辨识度',
  },
  {
    id: 'fence-pansidong',
    size: '2048x768',
    prompt:
      '西游盘丝洞中线栅栏用的一条横向连续蛛丝网带：淡紫粉与乳白蛛丝编织成均匀网纹篱笆，' +
      '网结与小茧沿整条均匀散布，禁止两端立柱/树干/岩石书挡，整条花纹可左右无缝循环，' +
      '像可拼接的游戏地面分隔条' +
      TILE + SEAMLESS,
  },
];

async function gen(job) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: job.prompt,
      size: job.size,
      n: 1,
      response_format: 'url',
      watermark: false,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const url = data.data?.[0]?.url;
  if (!url) throw new Error(`无 url: ${JSON.stringify(data).slice(0, 300)}`);
  const img = await fetch(url);
  const buf = Buffer.from(await img.arrayBuffer());
  const file = path.join(OUT, `${job.id}.jpg`);
  writeFileSync(file, buf);
  console.log(`✅ ${job.id}  ${(buf.length / 1024).toFixed(0)}KB  -> ${file}`);
}

for (const job of jobs) {
  try {
    await gen(job);
  } catch (e) {
    console.error(`❌ ${job.id}: ${e.message}`);
    process.exitCode = 1;
  }
}

const jpgs = jobs.map((j) => `${j.id}.jpg`);
console.log('开始抠背景转透明 PNG…');
await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ['bg-remove.mjs', ...jpgs], {
    cwd: HERE,
    env: { ...process.env, ASSET_DIR: OUT },
    stdio: 'inherit',
  });
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`bg-remove exit ${code}`))));
});
console.log('地图栅栏/闸门素材生成完成');
