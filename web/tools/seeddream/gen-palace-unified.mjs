// 宫檐弹窗素材·画风统一轮：palace-roof-band / palace-title-plaque 原为「Q版水墨」，
// 与立绘(太上老君/文殊,国风工笔淡彩半写实)不一致 → 用同一对参考图重画成同画风。
// 结构约束逐条保留自 gen-palace-roofs.mjs / gen-plaque.mjs（三段式拉伸、匾面留空叠字依赖这些形状约定）。
// 用法（web/ 目录，需 .env 的 ARK_API_KEY）：node tools/seeddream/gen-palace-unified.mjs [id ...]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
const HERE = path.dirname(fileURLToPath(import.meta.url));

// 画风参考：蓝幕版(朱红+暖金素材不含蓝,蓝幕抠图零颜色冲突,治本避免绿幕吃掉金绿交界抗锯齿)
const REF_DIR = '/tmp/style-refs-blue';
const refs = ['hero-laojun', 'hero-wenshu'].map((n) => {
  const p = path.join(REF_DIR, `${n}.png`);
  if (!existsSync(p)) throw new Error(`缺蓝幕参考图 ${p}（先跑 python 预处理）`);
  return `data:image/png;base64,${readFileSync(p).toString('base64')}`;
});
const STYLE_REF =
  '，【画风要求】严格模仿两张参考图的画风、笔触与上色质感：国风工笔淡彩插画、色彩雅致温润、线条流畅；' +
  '造型走【圆润Q版】：边角圆润、造型敦厚可爱、憨萌讨喜，像可爱动画里的中国古建筑（不要写实建筑测绘感、不要水墨晕染写意、不要高饱和塑料感、不要生硬纯黑描边）。' +
  '参考图只提供画风，严禁把参考图中的人物、服饰画进来';
const BLUE = '，【背景要求】整幅背景是单一高饱和纯蓝色块 RGB(0,0,255) 摄影棚蓝幕满幅纯色平涂（明亮纯蓝,不是深蓝不是紫色），无阴影无投影无地面无文字无渐变';

const jobs = [
  {
    // 结构约定(勿改,menu-ui 三段式拉伸依赖):只画屋檐横带/无墙身/檐梁横贯全幅/底边=檐梁下沿/翘角各宽~5%
    id: 'palace-roof-band',
    size: '1920x512',
    prompt:
      'Q版可爱的中国宫殿屋檐横带正视图，圆润憨萌、左右对称，画面里只有屋檐横带本身、没有墙身没有屋身没有柱子，' +
      '两端是圆润上翘的金色飞檐翘角（圆头圆脑、憨态可掬），翘角外缘只比下方檐梁略宽一点点（各宽约百分之五）、上翘但不夸张，' +
      // 修复：旧图把葫芦宝顶画反了（上球比下球大、头重脚轻）。这里强制标准葫芦比例：下大上小、中间束腰。
      '正中央端庄地立着一颗金色葫芦宝顶：标准葫芦形、由上下两颗圆球叠成、【下面那颗球明显更大、上面那颗球明显更小】、两球之间束腰收细（严禁上大下小、严禁头重脚轻、严禁两球等大），宝顶稳稳坐在圆鼓的正脊正中央，' +
      '下方是平直的朱红琉璃瓦坡面与一条深红檐梁、几乎横贯整幅画面、两端接近画面左右边缘，图像最底边就是檐梁的下沿、底边干净不要墨点下滴，' +
      '朱红与暖金为主、工笔淡彩、笔触细腻雅致' +
      STYLE_REF + BLUE,
  },
  {
    // 结构约定(勿改,drawTitlePlaque 中央留空叠字):横长方形≈3:1/深红木底/金雕花边框/中央大面留空
    id: 'palace-title-plaque',
    size: '1920x640',
    prompt:
      'Q版可爱的中国传统横向牌匾/匾额正视图，圆润憨萌，横长方形较敦厚（长宽比约 3:1）、圆角，' +
      '深红木底色，四周金色雕花边框，边框上有对称的金色盘龙与卷云纹样，四角金色云头纹，' +
      '匾额中央一整片平整干净的深红木底面、大面积留空（不放任何图案与文字，供后期叠字，约容六个汉字），' +
      '朱红与暖金为主、工笔淡彩、笔触细腻雅致、不要过度写实的立体高光' +
      STYLE_REF + BLUE,
  },
];

const only = process.argv.slice(2);
for (const job of jobs) {
  if (only.length && !only.includes(job.id)) continue;
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, image: refs, size: job.size, n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) throw new Error(`${job.id} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  const buf = Buffer.from(await img.arrayBuffer());
  writeFileSync(path.join(OUT, `${job.id}.jpg`), buf);
  console.log(`✅ 生成 ${job.id}.jpg`);
}

// 抠图 → 洪泛清残 → 裁透明边并缩放(band 长边 1600 / plaque 长边 1600,×3 显示分辨率)
console.log('绿幕抠图…');
process.env.ASSET_DIR = OUT;
const savedArgv = process.argv;
process.argv = [process.argv[0], process.argv[1], ...jobs.filter((j) => !only.length || only.includes(j.id)).map((j) => `${j.id}.jpg`)];
await import('./bg-remove-chroma.mjs');
process.argv = savedArgv;

console.log('绿残洪泛清理…');
spawnSync('python3', [
  path.join(HERE, 'defringe-floodfill.py'),
  ...jobs.filter((j) => !only.length || only.includes(j.id)).map((j) => path.join(OUT, `${j.id}.png`)),
], { stdio: 'inherit' });

console.log('裁透明边 + 缩放…');
for (const job of jobs) {
  if (only.length && !only.includes(job.id)) continue;
  spawnSync('python3', ['-c', `
from PIL import Image
p = '${path.join(OUT, job.id + '.png')}'
im = Image.open(p).convert('RGBA')
W, H = im.size
px = im.load()
xs, ys = [], []
for y in range(H):
    for x in range(W):
        if px[x, y][3] > 40:
            xs.append(x); ys.append(y)
if not xs:
    raise SystemExit('空图: ' + p)
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
im = im.crop((x0, y0, x1 + 1, y1 + 1))
scale = 1600 / max(im.size)
im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
im.save(p)
print('  ${job.id}:', im.size)
`], { stdio: 'inherit' });
}
console.log('完成。下一步：tos-upload 上传 + 确认 menu-ui 绘制参数');
