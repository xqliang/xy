// 用火山方舟 Ark · Seedream 生成白骨岭栅栏用的 Q 版白骨堆图标。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets');
mkdirSync(OUT, { recursive: true });

const job = {
  id: 'fence-baiguling',
  prompt:
    '白骨岭栅栏用的小白骨堆，几根白骨和圆颅骨堆成一小簇，Q版扁平游戏图标，造型简洁、粗黑描边、强剪影、浅灰白色主调、细节精简、正面居中，纯白色背景，无阴影，无文字，高辨识度',
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
  const p = spawn(process.execPath, ['bg-remove.mjs', 'fence-baiguling.jpg'], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    stdio: 'inherit',
  });
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`bg-remove exit ${code}`))));
});
