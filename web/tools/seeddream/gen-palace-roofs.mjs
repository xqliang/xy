// 生成 PvP 匹配 UI 素材（真人对战/好友匹配页共用）：
//   palace-roof-band  弹窗标题栏厚重宫檐横带（重生成：老版太单薄，用户要求更厚重、替换整个老 title band）
//                     16:9 生成后抠图裁 bbox，绘制时三段式拉伸——左右翘角段不变形、中间瓦面段拉伸
//   pvp-bg            匹配页背景（竖版 824×1536 视口）：云海仙山对峙的对战氛围、中央大块留白放匹配环
// 全部绿幕直出 → bg-remove-chroma.mjs 抠图（band）→ 裁 bbox → 缩到显示尺寸×3 → PNG；
// 背景图直接 JPEG（无透明需求，与地图背景同规格：居中裁 824×1536 + q0.72）。
// 注意：无棋盘/网格字眼（会诱导模型画方格纹）；无文字无投影。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');

const GREEN = '纯高饱和荧光绿 RGB(0,255,0) 绿幕背景满幅平涂，无阴影，无投影，无地面，无文字';

const jobs = [
  {
    // 厚重版：双层檐结构、瓦面厚、正脊高耸——整条横带比老版高很多（生成 1536x768，显示高 ~44px）
    id: 'palace-roof-band', size: '1536x768',
    prompt: '中国古代宫殿屋檐横带正视图，非常厚重大气，左右对称，'
      + '上层是高耸的正脊与两端高高上翘的金色飞檐翘角、正中央金色葫芦宝顶，'
      + '下层是宽厚的朱红色琉璃瓦坡面（瓦垄一排排清晰可见）、金色瓦当与深红檐梁在底部横贯整条画面，'
      + '屋檐整体厚重饱满如同宫门门楼，中国传统宫阙建筑，细节精致，扁平插画风格，'
      + '横带完整横贯画面左右两边缘、上下居中' + GREEN,
  },
  {
    // 匹配页背景：竖版，云海两侧仙山宫殿对峙（对战感），中央上下大块柔和留白放匹配环/对阵卡
    id: 'pvp-bg', size: '1024x2048', raw: true,
    prompt: '中国神话风格竖版手机游戏匹配等待页背景，上部与下部是柔和的青灰与米金色云海，'
      + '画面上部左右两角各露出一段朱红宫阙飞檐与金色宝顶（对称对峙，暗示双方对战），'
      + '远景淡青色仙山与飘渺云雾，中央大片干净的浅米金渐变留白（供 UI 放置），'
      + '水墨淡彩插画风格，色调宁静仙气，无角色，无格子，无瓷砖，无几何图案花纹，无文字',
  },
  {
    // 征兵「宫」屋身：与 palace-camp-roof 屋顶配套的棕木屋身（无字，canvas 叠「宫」）。
    // 显示约 58×30（×3 生成后裁 bbox）。横向圆角、瓦顶下承重墙质感、中央留空叠字。
    id: 'palace-camp-body', size: '1280x720',
    prompt: '中国古代宫殿建筑的屋身正视图（只有墙体部分，不含屋顶不含屋檐），横向圆角矩形，'
      + '深棕色木质结构，暖棕木纹墙面配深红木柱与横梁框架，'
      + '底部一条深红色门槛横贯，中央大面积干净的深棕木面留空（供叠字），'
      + '中国传统宫阙建筑风格，细节精致，扁平插画风格，'
      + '屋身完整横贯画面左右两边缘、上下居中' + GREEN,
  },
];

// 用法：node gen-palace-roofs.mjs [id ...]——只重生成指定 id（缺省全部；避免无谓重生成已定稿素材）
const only = process.argv.slice(2);
for (const job of jobs) {
  if (only.length && !only.includes(job.id)) continue;
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
  console.log(`✅ ${job.id}.jpg（绿幕/原图 ${(buf.length / 1024).toFixed(0)}KB）`);
}
console.log('下一步：bg-remove-chroma.mjs palace-roof-band.jpg，再后处理裁剪缩放；pvp-bg 走居中裁 824×1536');
