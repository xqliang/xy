// 重做 unit-monkey（刀兵）：人类脸、单手正握弯刀、手臂不过高、哑光布甲 → 抠图保白刃 → 只清底部
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
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
  '，Q版扁平游戏图标，造型简洁、粗黑描边、强剪影、高饱和对比色、扁平色块少高光、' +
  '侧身全身居中面向右、纯白色背景，无地面、无脚下灰色投影、无底部白色光晕、无阴影，无文字，高辨识度';

const prompt =
  '天庭普通人类刀兵，年轻男人短发顶髻人脸（人类面孔，绝不是猴子绝不是孙悟空），' +
  '橙色哑光布衣软甲与黄布裤棕靴（布料质感，禁止闪亮金属铠、禁止镜面高光），' +
  '侧身面向右，打斗姿势：右手在胸前至肩高持一把白色弯刀（手臂不要举过头顶、不要举得太高），' +
  '刀身斜向前上方，正握：刀刃从虎口拇指侧伸出，柄头在小指侧朝下，禁止反握，' +
  '左手空手，禁止双刀，全身只有这一把弯刀，白色刀刃清晰黑描边，左脚前迈，主色橙黄' +
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
  const jpg = path.join(OUT, 'unit-monkey.jpg');
  writeFileSync(jpg, buf);
  console.log(`✅ unit-monkey  ${(buf.length / 1024).toFixed(0)}KB  -> ${jpg}`);
}

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
  });
}

await gen();
await run('node', [path.join(HERE, 'bg-remove.mjs'), 'unit-monkey.jpg'], { ASSET_DIR: OUT });
const png = path.join(OUT, 'unit-monkey.png');
if (!existsSync(png)) throw new Error('抠图后未找到 unit-monkey.png');
await run('node', [path.join(HERE, 'resize-portraits.mjs')]);
await run('node', [path.join(HERE, 'fix-dao-edges.mjs')]);
try { unlinkSync(path.join(OUT, 'unit-monkey.jpg')); } catch { /* ignore */ }
console.log('完成:', png);
