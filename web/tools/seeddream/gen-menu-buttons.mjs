// 首页入口按钮：竞品同款哑光手绘水墨 Q 版（gen-menu.mjs 同套），生成后抠透明 PNG。
import { mkdirSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const skipExisting = process.argv.includes('--skip-existing');

// 竞品主界面按钮：哑光木牌/宣纸平涂、墨线勾边，不要现代手游玻璃按钮
const REF =
  '参考竞品《赵云与阿斗》类主界面UI按钮：手绘水墨Q版，粗黑墨线不规则描边，哑光木质或宣纸平涂，柔和淡彩晕染，';
const NEG =
  '，纯白色背景，无阴影，无界面外框，严禁玻璃高光、镜面反射、顶部白色高光条、塑料质感、3D立体光泽、金属电镀、霓虹渐变';

const STYLE = REF + '朱红赭石檀木色系、淡金卷草纹边框' + NEG;

// 侧栏小钮：简约水墨，不要金边朱红等彩色装饰
const SIDE_STYLE =
  '，手绘水墨Q版，淡赭石宣纸底、细墨线勾边，单色灰赭墨线，无金边无朱红无蓝无绿无彩色边框无彩色装饰，低饱和，纯白色背景，无阴影，平涂无高光，严禁玻璃高光霓虹渐变';

// 孤立图标：单色水墨，不要任何彩色
const ICON_STYLE =
  '，手绘水墨Q版，仅灰赭墨色线稿与淡墨晕染，无红无金无蓝无绿无紫无霓虹无彩色，无画框无金边，纯白色背景，无阴影，平涂无高光';

const jobs = [
  {
    id: 'menu-btn-settings',
    size: '1024x1024',
    prompt:
      '简约水墨侧栏方形小按钮，正方形按钮主体占满整个画布，淡赭石宣纸底、细墨线勾边，中央仅简化齿轮符号，下方清晰大字「设置」，不要人物，平涂无高光' +
      SIDE_STYLE,
  },
  {
    id: 'menu-btn-codex',
    size: '1024x1024',
    prompt:
      '简约水墨侧栏方形小按钮，与设置按钮完全相同的正方形按钮大小，单一按钮占满整个画布无其他元素，淡赭石宣纸底、细墨线勾边，中央仅竹简卷轴符号，下方清晰大字「图鉴」，不要人物，不要小纸片不要碎角不要左上角方框不要画中画不要角落缩略图，整图单色水墨无彩色，平涂无高光' +
      SIDE_STYLE,
  },
  {
    id: 'menu-btn-rank',
    size: '1536x1024',
    prompt:
      '竞品式底部宽木牌按钮，哑光檀木底，中央Q版水墨奖杯与祥云手绘，清晰汉字「排行榜」，扁宽比例，平涂无高光' + STYLE,
  },
  {
    id: 'menu-btn-bag',
    size: '1024x1024',
    prompt:
      '单个灰黑水墨线稿行囊背包，铅笔素描，仅黑白灰墨线无褐色无红色无金色无彩色扣带，无画框无边框装饰无宣纸方块底，无木牌无文字，背包主体占满画布70%，仅背包轮廓' +
      ICON_STYLE +
      '，严禁彩色扣带严禁褐色填充',
  },
  {
    id: 'menu-btn-start',
    size: '1536x1024',
    prompt:
      '横向超大主行动按钮，简约水墨风：淡赭石宣纸底、一笔朱红淡彩晕染、细墨线勾边无厚重木框，中央「开始游戏」墨字略白描，角落小型淡黄闪电体力符，留白多、线条简练，不要人物不要角色，平涂无高光' +
      STYLE,
  },
  {
    id: 'menu-btn-stamina-plus',
    size: '1024x1024',
    prompt: '小圆形按钮，中央清晰大号白色加号，淡绿赭石墨线细圆框，无仙桃无金边无装饰' + SIDE_STYLE,
  },
  {
    id: 'menu-btn-map',
    size: '1536x1024',
    prompt:
      '竞品式扁宽木牌选关按钮，哑光淡赭石底，中央Q版水墨地图卷轴与路标手绘，无汉字（留给程序叠字），平涂无高光' + STYLE,
  },
  {
    id: 'menu-btn-stamina-ad',
    size: '1536x1024',
    prompt:
      '竞品式中等木牌按钮，哑光淡绿赭石平涂，Q版水墨八戒看宝镜手绘，清晰汉字「看广告 +10」，平涂无高光' + STYLE,
  },
  {
    id: 'menu-btn-stamina-share',
    size: '1536x1024',
    prompt:
      '竞品式中等木牌按钮，哑光淡赭石平涂，Q版水墨祥云分享符手绘，清晰汉字「分享好友 +5」，平涂无高光' + STYLE,
  },
  {
    id: 'rank-star-on',
    size: '1024x1024',
    prompt:
      '单个游戏段位点亮星UI图标，仅一颗正五角星居中，禁止横条禁止横幅禁止画框禁止四周墨迹喷溅，手绘水墨Q版，淡金赭石哑光填色，星角微小祥云卷纹，中心极淡金箍圆环，无人物无文字无其他元素，星体占画布65%，平涂无高光' +
      REF +
      '淡金赭石色系、细墨线勾边' +
      NEG,
  },
  {
    id: 'rank-star-off',
    size: '1024x1024',
    prompt:
      '单个游戏段位未点亮空星UI图标，仅一颗正五角星居中，禁止横条禁止画框，手绘水墨Q版，灰褐墨线勾边，内部极淡灰白留白无金色，星角微小卷云纹，无人物无文字，星体占画布65%，平涂无高光' +
      SIDE_STYLE,
  },
];

async function gen(job) {
  const pngPath = path.join(OUT, `${job.id}.png`);
  if (skipExisting && existsSync(pngPath)) {
    console.log(`⏭ ${job.id} (已有 PNG)`);
    return;
  }
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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  writeFileSync(path.join(OUT, `${job.id}.jpg`), Buffer.from(await img.arrayBuffer()));
  console.log(`✅ ${job.id}`);
}

const todo = only.length ? jobs.filter((j) => only.includes(j.id)) : jobs;
if (todo.length === 0) {
  console.error('无匹配任务，可选 id:', jobs.map((j) => j.id).join(', '));
  process.exit(1);
}

for (const job of todo) {
  try {
    await gen(job);
  } catch (e) {
    console.error(`❌ ${job.id}: ${e.message}`);
  }
}

for (const f of readdirSync(OUT)) {
  if (f.startsWith('menu-btn-share')) {
    try { unlinkSync(path.join(OUT, f)); } catch { /* ignore */ }
  }
}

console.log('抠背景…');
process.env.ASSET_DIR = OUT;
const jpgOnly = only.length > 0 ? only.map((id) => `${id}.jpg`) : [];
let savedArgv = process.argv;
if (jpgOnly.length > 0) process.argv = [process.argv[0], process.argv[1], ...jpgOnly];
await import('./bg-remove.mjs');
process.argv = savedArgv;

console.log('裁剪缩放到显示尺寸×3…');
const pngOnly = todo.map((j) => `${j.id}.png`);
savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...pngOnly];
await import('./resize-portraits.mjs');
process.argv = savedArgv;
