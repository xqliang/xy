// 国风重绘·画风统一轮：把旧「Q版扁平」批次的 8 张立绘（悟空/唐僧/沙僧/哪吒/二郎/观音/八戒/小妖）
// 重画成与 太上老君(hero-laojun)/文殊(hero-wenshu) 相同的国风工笔淡彩风格与构图。
// 关键手段：Seedream 4.0 多参考图——把老君/文殊（拼白底）作为画风参考传入，
// 提示词强约束「只学画风与构图范式，禁止画出参考图中的人物/服饰/道具」。
// 管线与 regen-portraits-round2 一致：gen(绿幕) → bg-remove-chroma → resize-portraits(780)。
//
// 用法（web/ 目录，需 .env 的 ARK_API_KEY）：
//   node tools/seeddream/regen-portraits-unified.mjs                # 全部
//   node tools/seeddream/regen-portraits-unified.mjs hero-wukong    # 指定
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 与 tos-upload 同源：优先环境变量，其次仓库根 .env
function loadKey() {
  if (process.env.ARK_API_KEY) return process.env.ARK_API_KEY;
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
  const m = /^ARK_API_KEY=(.+)$/m.exec(readFileSync(envPath, 'utf-8'));
  return m ? m[1].trim() : undefined;
}
const KEY = loadKey();
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
mkdirSync(OUT, { recursive: true });

// 画风参考图（提前用 python 拼白底到 /tmp/style-refs）：老君 + 文殊
const REF_DIR = '/tmp/style-refs';
const refs = ['hero-laojun', 'hero-wenshu'].map((n) =>
  `data:image/png;base64,${readFileSync(path.join(REF_DIR, `${n}.png`)).toString('base64')}`,
);

// 画风约束：严格模仿参考图画风（工笔淡彩国风）与构图范式，但禁止复现参考图人物。
const STYLE_REF =
  '，【画风与比例要求】严格模仿两张参考图的画风、笔触、上色质感与人物比例：国风工笔淡彩插画风格，色彩雅致温润、线条流畅，' +
  '人物比例必须是参考图那种【宽矮敦实的大头Q版】：头大身圆、四肢短小、约三头身，人物整体宽度约为身高的三分之二，' +
  '站姿重心低、圆润憨萌、矮矮胖胖很可爱（严禁修长写实的成人比例、严禁瘦高身形、严禁大头细长腿；不要扁平卡通图标风、不要粗黑描边、不要过度写实），' +
  '构图与参考图一致：正面全身立姿、人物居中完整不裁切。' +
  '参考图只提供画风与比例范式，严禁把参考图中的人物、服饰、道具、场景画进来';
// 纯绿幕 + 强硬反阴影（chroma 抠图依赖）：与 round2 相同。
// 注意：参考图本身已拼在荧光绿底上（/tmp/style-refs 由 python 预处理），
// 避免白底参考与绿幕要求互相拉扯导致模型画出橄榄绿/脏黄底。
const GREEN =
  '，【背景要求】整幅背景必须是单一高饱和荧光绿色块 RGB(0,255,0) 摄影棚绿幕（像参考图那样的明亮荧光绿，不是橄榄绿、不是暗黄绿、不是芥末绿），满幅纯色平涂，绝对不要国风水墨/雾气/渐变/花纹/云纹/光晕/暗角地面背景，只要一整块纯绿。角色必须完全悬浮于幕布前、双脚离地不接触地面，严禁任何阴影——包括 cast shadow、落地阴影、脚下投影、接触阴影、环境光阴影、漫反射阴影、软阴影、脚下任何灰/黑/白/棕/红的阴影色块，脚底下方必须是纯绿幕一直延伸到画面底边';
const NEG = '，无文字无logo无边框，无地面投影，不要任何阴影，不要现代物品';

// 风火轮专用强化说明（哪吒用）：纯火焰构成、无任何实体结构（round2 经验：模型爱画成轮胎）。
const WHEEL =
  '双脚各踩着一团【纯火焰风火轮】——两团高速旋转的金红色烈焰漩涡，绝对没有任何实体结构：不是轮子、没有轮胎橡胶、没有金属辐条、没有轮毂、没有车轴、没有实心轮体、没有骨架、没有夹层、没有内外圈之分，就是两圈由内向外（深红→橙红→橙黄）翻涌的环形火焰，脚踏之处只见翻腾的火焰与飘散火星、不见任何固体，严禁轮胎、橡胶、辐条、轮毂、金属、车轴、车辆机械部件、任何现代工业制品';

const jobs = [
  {
    id: 'hero-wukong',
    prompt:
      '齐天大圣孙悟空，火眼金睛的猴王面容，额前贴着额头缠一圈金色紧箍（紧箍咒发带，紧贴在额头头发上，不是悬浮在头顶上空的圆环），' +
      '【头部禁令】头上没有发冠、没有帽子、没有翅膀、没有羽翼、没有任何翼状装饰，头顶上空没有任何悬浮的圆环、金圈、光环、佛光或圈状物，' +
      '身披锁子黄金甲、腰围虎皮战裙、脚踏藕丝步云履，' +
      '【姿势】经典站姿：站姿端正、面朝正前方，左手叉腰，右手自然握住立在身体右侧的金箍棒（棒身垂直、两头各有金色箍环），' +
      '神态自信威风，比例端正、构图干净，不要扭曲夸张的动势、不要腾空翻跃' +
      STYLE_REF + GREEN + NEG + '，背景里严禁出现任何黑色/墨色/深灰色云雾、水墨晕染或暗色块，背景只能是纯绿幕',
  },
  {
    id: 'hero-tangseng-hero',
    prompt:
      '唐僧，唐朝取经高僧，慈眉善目的白净僧人，头戴毗卢帽（五佛冠），' +
      '身披红底金绣锦襕袈裟，颈挂佛珠，右手持九环锡杖，左手捻佛珠，端正庄严' +
      STYLE_REF + GREEN + NEG,
  },
  {
    id: 'hero-shaseng',
    prompt:
      '沙悟净，天庭卷帘大将，光头络腮黑须的威猛和尚、浓眉方脸神色刚毅，' +
      '身披土黄棕色僧袍、腰扎深色系带，手持一杆降妖宝杖，项戴一串骷髅头念珠，敦实憨壮' +
      STYLE_REF + GREEN + NEG,
  },
  {
    id: 'hero-nezha',
    prompt:
      '哪吒三太子，双丸子发髻的英武少年，额点红印眉心红痣，红色战袍肚兜、腰间红色混天绫长绫随风飘扬，' +
      '赤露双臂，下身红色镶黄边灯笼裤，' +
      '双手紧握一杆【完整挺直的火尖枪】——长枪杆一整根不折不扣、枪尖朝上带橙红火焰；' +
      WHEEL +
      STYLE_REF + GREEN + NEG + '，风火轮必须纯火焰无实体、严禁轮胎辐条',
  },
  {
    id: 'hero-erlang',
    prompt:
      '二郎神杨戬，额生竖立第三只天眼的英武战神，剑眉星目神色冷峻，' +
      '【头部禁令】头上没有翅膀、没有羽翼、没有任何翼状装饰，没有头顶光环，' +
      '身披银白铠甲外罩淡青战袍、肩披战巾，手持三尖两刃长刀，' +
      '一只矫健的黑白细犬（哮天犬）依偎在其脚边一同悬浮，人犬俱全身完整' +
      STYLE_REF + GREEN + NEG,
  },
  {
    id: 'hero-guanyin',
    prompt:
      '观音菩萨，慈悲圣洁的白衣大士，头戴白色宝冠、身披洁白飘逸天衣、帛带绕臂随风，' +
      '左手托玉净瓶（瓶中插一枝杨柳），右手执杨柳枝轻拂，神情安详悲悯，衣纹如水' +
      STYLE_REF + GREEN + NEG,
  },
  {
    id: 'hero-bajie',
    prompt:
      '猪八戒，长嘴大耳的憨态猪妖和尚，体态肥胖圆润但站姿沉稳，' +
      '身披土黄僧袍、腰系皂色布带、肩搭汗巾，肩扛一柄九齿钉耙，咧嘴憨笑' +
      STYLE_REF + GREEN + NEG,
  },
  {
    id: 'monster-minion',
    prompt:
      '西游小妖兵，青蓝色皮肤的小妖怪（皮肤偏蓝的青色，不是绿色），尖耳獠牙、头顶一小撮乱发，眼神机灵猥琐，' +
      '身穿粗布短打坎肩、腰系草绳，双手拄一根粗木棒，身材矮小瘦削、探头探脑' +
      STYLE_REF + GREEN + NEG,
  },
];

async function gen(job) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    // Seedream 4.0：image 传参考图数组（base64 data URL），prompt 中说明只取画风
    body: JSON.stringify({
      model: MODEL,
      prompt: job.prompt,
      image: refs,
      size: '832x1248',
      n: 1,
      response_format: 'url',
      watermark: false,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  await writeFileSync(path.join(OUT, `${job.id}.jpg`), Buffer.from(await img.arrayBuffer()));
  console.log(`✅ 生成 ${job.id}`);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const todo = only.length ? jobs.filter((j) => only.includes(j.id)) : jobs;
if (todo.length === 0) { console.error('没有匹配的任务'); process.exit(1); }
for (const job of todo) {
  try { await gen(job); } catch (e) { console.error(`❌ ${job.id}: ${e.message}`); }
}

console.log('绿幕抠图（自动识别每张幕色）…');
process.env.ASSET_DIR = OUT;
let savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...todo.map((j) => `${j.id}.jpg`)];
await import('./bg-remove-chroma.mjs');
process.argv = savedArgv;

// 模型偶尔不画纯荧光绿(橄榄绿脏底),chroma 软抠只降 alpha 不净:再从画布边缘洪泛一次绿残
console.log('绿残洪泛清理…');
const { spawnSync } = await import('node:child_process');
const py = spawnSync('python3', [
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'defringe-floodfill.py'),
  ...todo.map((j) => path.join(OUT, `${j.id}.png`)),
], { stdio: 'inherit' });
if (py.status !== 0) console.error('⚠️ 洪泛清理失败(继续,不影响主流程)');

console.log('裁剪缩放显示尺寸…');
savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...todo.map((j) => `${j.id}.png`)];
await import('./resize-portraits.mjs');
process.argv = savedArgv;
