// 生成 4 张骑兵(每图一套,不同坐骑) + 5 张小Boss 立绘。怪物 Q 版厚描边风(对齐现有小妖/妖王),绿幕背景便于抠图。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

const STYLE = '，Q版扁平游戏图标，造型简洁、粗黑描边、强剪影、高饱和对比色、细节精简、单一主色调、正面全身居中，'
  + '纯高饱和荧光绿 RGB(0,255,0) 绿幕背景满幅平涂，无水墨/渐变/花纹/云纹/光晕/地面，'
  + '脚(或坐骑蹄/足)下方一直到画面底边全是纯绿幕、无任何阴影/投影/接触阴影，无文字，高辨识度';

const JOBS = [
  // 骑兵：每图一套,不同坐骑(火翼火马/水兽/骷髅马/巨蛛)
  { id: 'monster-cavalry-huoyanshan', prompt: '火焰山火妖骑兵，赤红火妖骑手骑着一匹生有蝙蝠火翼的火焰战马、马蹄与鬃毛燃烧橙红烈焰、骑手持烧红长枪，主色橙红色' + STYLE },
  { id: 'monster-cavalry-liushahe', prompt: '流沙河河妖骑兵，青灰水鬼骑手骑乘一头巨型鲶鱼水兽为坐骑、湿滑鳞甲滴水、手持鱼骨长矛，主色青蓝色' + STYLE },
  { id: 'monster-cavalry-baiguling', prompt: '白骨岭骷髅骑兵，白骨骷髅骑士骑着一匹森森白骨骷髅战马、破碎腰甲、手持锈蚀骨矛，主色骨白色' + STYLE },
  { id: 'monster-cavalry-pansidong', prompt: '盘丝洞蛛妖骑兵，紫黑蛛妖骑手骑乘一只八爪巨型毒蜘蛛为坐骑、身缠蛛丝、手持毒刺长枪，主色紫黑色' + STYLE },
  // 小Boss：5 种属性(霜/蚀/震/风/血),体型比小妖大、比妖王小
  { id: 'monster-miniboss-frost', prompt: '霜魄妖小首领，冰霜妖魔、通体冰蓝、身覆冰晶尖刺、口吐寒气、周身飘雪，威猛，主色冰蓝白色' + STYLE },
  { id: 'monster-miniboss-blight', prompt: '蚀甲妖小首领，蚀甲毒妖、紫黑带毒绿、周身滴淌腐蚀毒液、锈蚀甲片剥落、獠牙吐毒气，狰狞，主色毒紫绿色' + STYLE },
  { id: 'monster-miniboss-quake', prompt: '撼地妖小首领，撼地岩妖、土黄褐色、健硕如岩石的巨汉、双拳如巨岩、粗壮四肢，威猛，主色土黄褐色' + STYLE },
  { id: 'monster-miniboss-gale', prompt: '疾风妖小首领，疾风妖魔、青绿轻捷、身形迅疾、飘带与旋风环绕、尖耳利爪，敏捷，主色青绿色' + STYLE },
  { id: 'monster-miniboss-blood', prompt: '血泉妖小首领，血泉妖魔、暗血红色、周身滴淌鲜血、血雾缠绕、狰狞獠牙利爪，凶恶，主色血红色' + STYLE },
];

for (const job of JOBS) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) { console.error(`${job.id} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); continue; }
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  writeFileSync(path.join(OUT, `${job.id}.jpg`), Buffer.from(await img.arrayBuffer()));
  console.log(`OK ${job.id}`);
}
console.log('下一步: bg-remove-chroma → resize → 接线 → 上传');
