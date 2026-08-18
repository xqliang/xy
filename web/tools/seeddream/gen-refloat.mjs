// 重生成 4 张"飘浮"头像立绘：唐僧/沙僧/哪吒/提灯老头(弥勒)。
// 关键修正:原立绘为避免阴影而让角色"悬浮离地"→看起来飘。改为【双脚着地站立】+【脚下绿幕延伸到底边、无任何阴影】。
// 风格沿用国风工笔(非大头Q版,见 memory asset-hero-portrait-guofeng)。沙僧换非锡杖的降妖宝杖(月牙铲)。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets');
mkdirSync(OUT, { recursive: true });

const STYLE = '，国风游戏立绘，工笔淡彩与国潮插画风格，衣袂飘逸、线条流畅、色彩雅致，半写实、头身比接近正常人物比例（不要大头Q版娃娃、不要过度萌化），细节精致、正面全身立姿居中、人物完整不裁切';
// 绿幕 + 双脚着地(不悬浮) + 严禁阴影
const GREEN = '，【背景】整幅纯高饱和荧光绿绿幕 RGB(0,255,0)满幅平涂，无水墨/雾气/渐变/花纹/云纹/光晕/暗角/地面。'
  + '角色双脚稳稳站在画面下方、脚踏实地站立(全身完整、脚不裁切)，脚下方一直到画面最底边都是纯绿幕；'
  + '严禁任何阴影——cast shadow、落地阴影、脚下投影、接触阴影、软阴影、任何灰/黑/棕/红色块，脚底正下方必须是纯绿幕，不画地面不画影子';
const NEG = '，无文字无logo无边框，不要任何阴影，不要地面，不要现代物品，绝对不要漂浮/悬空/盘腿/跳跃姿势';

const JOBS = [
  { id: 'hero-tangseng-hero', prompt: '唐僧法相，金红锦襕袈裟、头戴毗卢帽、双手持九环锡杖竖立于身侧、庄严慈悲，双脚踏实站立' + STYLE + GREEN + NEG },
  { id: 'hero-shaseng', prompt: '沙悟净沙僧，络腮胡、青灰僧袍、脖挂骷髅念珠串、单手握一柄粗重的降妖宝杖（杖头是弯月铲刃配红缨，是月牙铲/宝杖，绝不是僧人的金环锡杖），沉稳威武，双脚踏实站立' + STYLE + GREEN + NEG },
  { id: 'hero-nezha', prompt: '哪吒三太子，红肚兜、手持火尖枪、身缠混天绫、英气少年，双脚踏实站在地面（风火轮收在身侧不踩脚下）' + STYLE + GREEN + NEG },
  { id: 'hero-mile', prompt: '弥勒佛老者，大肚便便憨笑、金黄僧袍敞怀、一手拎布袋一手捻念珠，喜庆福相，双脚踏实端正站立（不要盘腿、不要漂浮）' + STYLE + GREEN + NEG },
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
  const buf = Buffer.from(await img.arrayBuffer());
  writeFileSync(path.join(OUT, `${job.id}.jpg`), buf);
  console.log(`OK ${job.id} ${(buf.length / 1024).toFixed(0)}KB`);
}
console.log('下一步: 抠绿幕→resize→上传');
