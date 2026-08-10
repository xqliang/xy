// 批量生成技能小图标（主动+被动）：Q 版扁平物件剪影，白底 → 抠透明 PNG。
// 用法：
//   ARK_API_KEY=xxx node web/tools/seeddream/gen-skill-icons.mjs
//   ARK_API_KEY=xxx node web/tools/seeddream/gen-skill-icons.mjs --skip-existing
//   ARK_API_KEY=xxx node web/tools/seeddream/gen-skill-icons.mjs act-palm pas-zhuwang
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const skipExisting = process.argv.includes('--skip-existing');

// 小图标：粗描边强剪影，少细节，禁文字（程序侧汉字 fallback）
const STYLE =
  '，Q版扁平游戏技能图标，单个物件居中占画布70%，粗黑墨线描边、强剪影、高饱和对比色、细节精简、纯白色背景，无阴影，无文字，无UI边框，高辨识度，适合32像素缩小仍清晰';

/** id 对应资源文件名 skill-{id}.png；skillId 用下划线（如 act_palm）时文件为 skill-act-palm */
const jobs = [
  // —— 主动 ——
  { id: 'skill-act-palm', prompt: '一只金色巨大手掌从上方拍下，西游如来神掌意象，掌心金色光芒' + STYLE },
  { id: 'skill-act-meteor', prompt: '一颗燃烧的陨石从天空坠落，橙红火尾，摇滚状石核' + STYLE },
  { id: 'skill-act-atk', prompt: '一颗鲜红发光的仙丹药丸，圆形丹药带金边符文' + STYLE },
  { id: 'skill-act-frq', prompt: '一对燃烧的风火轮，双环火焰金轮并排' + STYLE },
  { id: 'skill-act-freeze', prompt: '一块晶莹蓝色冰晶雪花结晶体，锋利冰棱' + STYLE },
  { id: 'skill-act-jinggu', prompt: '一个金色紧箍咒圆环，金属箍带符文闪光' + STYLE },
  // —— 被动 ——
  { id: 'skill-pas-pantao', prompt: '一颗熟透的仙桃，粉红果皮绿叶，蟠桃意象' + STYLE },
  { id: 'skill-pas-xiandan', prompt: '一颗青色仙丹符药丸，胶囊状丹药带符纸' + STYLE },
  { id: 'skill-pas-fenghuolun', prompt: '一个旋转的蓝色风火气轮符，圆环气流' + STYLE },
  { id: 'skill-pas-fabaofu', prompt: '一张金边法宝符箓卷轴，竖立展开' + STYLE },
  { id: 'skill-pas-zhaoxian', prompt: '一张古代招贤榜告示木牌，悬挂卷轴' + STYLE },
  { id: 'skill-pas-mojin', prompt: '一把古式洛阳摸金铲，金铲头短木柄' + STYLE },
  { id: 'skill-pas-luoyangchan', prompt: '一把精致洛阳铲考古铲，银铲头木柄' + STYLE },
  { id: 'skill-pas-yunshi', prompt: '一小块坠落的紫色陨石碎片，岩块裂纹发光' + STYLE },
  { id: 'skill-pas-yuni', prompt: '一滩褐色淤泥沼泽水洼，泥浆溅起' + STYLE },
  { id: 'skill-pas-xianyuan', prompt: '一面彩色仙缘幡旗，三角锦幡飘带' + STYLE },
  { id: 'skill-pas-jubaopen', prompt: '一个金色聚宝盆溢出铜钱，圆盆宝物' + STYLE },
  { id: 'skill-pas-hushen', prompt: '一面金色护身盾牌，圆形金光盾' + STYLE },
  { id: 'skill-pas-zhuwang', prompt: '一张紫色蜘蛛网，放射状蛛网剪影' + STYLE },
  { id: 'skill-pas-tongxin', prompt: '一颗红色同心结爱心符，双心交缠' + STYLE },
  { id: 'skill-pas-dinghai', prompt: '一根金色定海神针短柱，竖立金针' + STYLE },
];

const selected = only.length
  ? jobs.filter((j) => only.some((o) => j.id === o || j.id === `skill-${o}` || j.id.endsWith(o)))
  : jobs;

if (selected.length === 0) {
  console.error('没有匹配的任务');
  process.exit(1);
}

async function gen(job) {
  const pngPath = path.join(OUT, `${job.id}.png`);
  if (skipExisting && existsSync(pngPath)) {
    console.log(`⏭  ${job.id} 已存在，跳过`);
    return false;
  }
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
    console.error(`❌ ${job.id} HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`);
    return false;
  }
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) {
    console.error(`❌ ${job.id} 无图片 URL`);
    return false;
  }
  const img = await fetch(url);
  const buf = Buffer.from(await img.arrayBuffer());
  writeFileSync(path.join(OUT, `${job.id}.jpg`), buf);
  console.log(`✅ ${job.id}  ${(buf.length / 1024).toFixed(0)}KB`);
  return true;
}

let ok = 0;
for (const job of selected) {
  if (await gen(job)) ok += 1;
  // 轻微限速，避免接口限流
  await new Promise((r) => setTimeout(r, 400));
}

console.log(`生成完成 ${ok}/${selected.length}，开始抠透明…`);
const rem = spawnSync(process.execPath, ['bg-remove.mjs'], {
  cwd: path.dirname(fileURLToPath(import.meta.url)),
  env: { ...process.env, ASSET_DIR: OUT },
  stdio: 'inherit',
});
if ((rem.status ?? 1) !== 0) process.exit(rem.status ?? 1);

console.log('裁剪缩放到显示尺寸×3…');
const pngArgs = selected.map((j) => `${j.id}.png`);
const resize = spawnSync(process.execPath, ['resize-portraits.mjs', ...pngArgs], {
  cwd: path.dirname(fileURLToPath(import.meta.url)),
  env: { ...process.env, ASSET_DIR: OUT },
  stdio: 'inherit',
});
process.exit(resize.status ?? 1);
