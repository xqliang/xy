// 生成 PvP 入口按钮底图（真人对战 / 邀请好友）：菜单首页无尽行下方的左右并排按钮（180×64 显示，×3=540×192）。
// 文字不生成（Seedream 文字失败率高，见 asset-bake-text-failures 经验）——生成无字底图，canvas 叠「真人对战/邀请好友」。
// 绿幕直出 + 抠图得到透明圆角 PNG；底图纹样刻意淡化（浮雕云纹/暗纹），给中央文字让出可读性。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');

const GREEN = '纯高饱和荧光绿 RGB(0,255,0) 绿幕背景满幅平涂，无阴影，无投影，无地面，无文字，无任何文字符号';
const COMMON = '横幅圆角长条按钮底图，圆角圆润饱满，横向构图，中国水墨淡彩游戏 UI 风格，';

const jobs = [
  {
    id: 'menu-btn-pvp', size: '1280x720',
    prompt: COMMON + '朱红色为主色调，深红渐变底面配金色描边，'
      + '底面上有若隐若现的暗金祥云浮雕纹理（低对比、不抢眼），左右两端各一小簇淡金色云纹装饰，'
      + '中央大面积干净留空（供叠字），整体大气醒目如主操作按钮' + GREEN,
  },
  {
    id: 'menu-btn-pvp-invite', size: '1280x720',
    prompt: COMMON + '青灰色为主色调，淡雅水墨米灰底面配暗金描边，'
      + '底面上有若隐若现的淡青远山浮雕纹理（低对比、不抢眼），左右两端各一只极小的飞雁剪影装饰，'
      + '中央大面积干净留空（供叠字），整体素雅低调如次操作按钮' + GREEN,
  },
];

for (const job of jobs) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: job.size, n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) throw new Error(`${job.id} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  const buf = Buffer.from(await img.arrayBuffer());
  writeFileSync(path.join(OUT, `${job.id}.jpg`), buf);
  console.log(`✅ ${job.id}.jpg（绿幕原图 ${(buf.length / 1024).toFixed(0)}KB）`);
}
console.log('下一步：node tools/seeddream/bg-remove-chroma.mjs menu-btn-pvp.jpg menu-btn-pvp-invite.jpg，再裁 bbox 缩到 540 宽 + pngquant');
