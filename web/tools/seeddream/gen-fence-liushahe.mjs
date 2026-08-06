// 用火山方舟 Ark · Seedream 生成流沙河栅栏用的"一片浪花条"贴图（平铺成分隔栅栏）。
// 生成白底 JPG → bg-remove 抠成透明 PNG，直接落到 src/game-assets/fence-liushahe.png。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
// 直接输出到 web 构建实际读取的素材目录
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

const job = {
  id: 'fence-liushahe',
  prompt:
    '流沙河河面的浪花水条，向右单向翻卷的浪花，一排朝同一个方向卷起的青白色浪尖泡沫配青蓝色水波，' +
    'Q版扁平游戏贴图，造型简洁、细节精简、不要粗黑描边、边缘柔和、正面，' +
    '左右两端能无缝循环平铺、可重复叠接（左端与右端衔接连续），纯白色背景，无阴影，无文字，高辨识度',
};

const res = await fetch(API, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: MODEL,
    prompt: job.prompt,
    size: '1024x1024',
    n: 1,
    response_format: 'url',
    watermark: false,
  }),
});
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const data = await res.json();
const url = data.data[0].url;
const img = await fetch(url);
const buf = Buffer.from(await img.arrayBuffer());
const file = path.join(OUT, `${job.id}.jpg`);
writeFileSync(file, buf);
console.log(`✅ ${job.id}  ${(buf.length / 1024).toFixed(0)}KB  -> ${file}`);
console.log('开始抠背景转透明 PNG…');
const { spawn } = await import('node:child_process');
await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ['bg-remove.mjs', 'fence-liushahe.jpg'], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    env: { ...process.env, ASSET_DIR: OUT },
    stdio: 'inherit',
  });
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`bg-remove exit ${code}`))));
});
