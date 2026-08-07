// 重做 unit-spear：侧身战斗突刺姿势 + 青蓝铠/朱红缨强对比色 → 抠图 → game-assets
import { mkdirSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
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

const STYLE =
  '，Q版扁平游戏图标，造型简洁、粗黑描边、强剪影、高饱和对比色、细节精简、' +
  '侧身全身居中面向右、纯白色背景，无阴影，无文字，高辨识度';

const prompt =
  '天兵长枪手人类士兵（非猴子），侧身打斗姿势面向右、双脚前后开立、双手握一杆长枪向前突刺的战斗姿势，' +
  '亮青蓝色铠甲（鲜明 cyan 主色，不是深蓝也不是绿色），枪杆深褐、枪头银白叶形、枪颈系一大蓬鲜红朱红枪缨，' +
  '朱红腰带与护腕点缀形成冷暖强对比，区别于橙金刀兵/紫色弓手/绿色骑兵，主色青蓝+朱红' +
  STYLE;

async function gen() {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size: '1024x1024',
      n: 1,
      response_format: 'url',
      watermark: false,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const url = data.data[0].url;
  const img = await fetch(url);
  const buf = Buffer.from(await img.arrayBuffer());
  const jpg = path.join(OUT, 'unit-spear.jpg');
  writeFileSync(jpg, buf);
  console.log(`✅ unit-spear  ${(buf.length / 1024).toFixed(0)}KB  -> ${jpg}`);
}

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
  });
}

await gen();
await run('node', [path.join(HERE, 'bg-remove.mjs'), 'unit-spear.jpg'], { ASSET_DIR: OUT });
const png = path.join(OUT, 'unit-spear.png');
if (!existsSync(png)) throw new Error('抠图后未找到 unit-spear.png');
console.log('完成:', png);
