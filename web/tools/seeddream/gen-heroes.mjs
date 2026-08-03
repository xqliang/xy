// 生成西游武将立绘（图鉴/牌库/武将系统共用），透明 PNG 直出（末尾链式抠图）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.ARK_API_KEY;
if (!KEY) { console.error('缺少 ARK_API_KEY'); process.exit(1); }
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = 'doubao-seedream-4-0-250828';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets');
mkdirSync(OUT, { recursive: true });

const STYLE = '，Q版扁平游戏图标，造型简洁、粗黑描边、强剪影、高饱和对比色、细节精简、每个角色单一主色调、正面全身居中，纯白色背景，无阴影，无文字，高辨识度';
// 12 位西游武将（对齐原作武将图鉴规模）
const heroes = [
  { id: 'hero-wukong', prompt: '齐天大圣孙悟空，紫金冠凤翅、锁子黄金甲、手持金箍棒，霸气' + STYLE },
  { id: 'hero-bajie', prompt: '猪八戒，肥胖憨态、僧袍、手持九齿钉耙，滑稽' + STYLE },
  { id: 'hero-shaseng', prompt: '沙僧沙悟净，络腮胡、僧袍、手持降妖宝杖、脖挂骷髅串，沉稳' + STYLE },
  { id: 'hero-guanyin', prompt: '观音菩萨，白衣、手持玉净瓶与杨柳枝、头戴宝冠，慈祥圣洁' + STYLE },
  { id: 'hero-nezha', prompt: '哪吒三太子，红肚兜、手持火尖枪、脚踏风火轮、身缠混天绫，英气' + STYLE },
  { id: 'hero-erlang', prompt: '二郎神杨戬，三只眼、银甲、手持三尖两刃刀、身旁哮天犬，威武' + STYLE },
  { id: 'hero-tangseng-hero', prompt: '唐僧法相，金红锦襕袈裟、毗卢帽、手持九环锡杖，庄严' + STYLE },
  { id: 'hero-honghaier', prompt: '红孩儿，红肚兜孩童、周身火焰、手持火尖枪，顽劣' + STYLE },
  { id: 'hero-tieshan', prompt: '铁扇公主罗刹女，华丽衣裙、手持巨大芭蕉扇，妩媚强势' + STYLE },
  { id: 'hero-baigujing', prompt: '白骨精，白衣女妖、苍白面容、隐约骷髅感，妖艳阴森' + STYLE },
  { id: 'hero-niumowang', prompt: '牛魔王，赤红肌肉、巨大牛角、黑铠甲，霸气怒目' + STYLE },
  { id: 'hero-mile', prompt: '弥勒佛，大肚憨笑、金黄僧袍、手持布袋，喜庆福相' + STYLE },
];

async function gen(job) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const img = await fetch(data.data[0].url);
  writeFileSync(path.join(OUT, `${job.id}.jpg`), Buffer.from(await img.arrayBuffer()));
  console.log(`✅ ${job.id}`);
}

for (const job of heroes) {
  try { await gen(job); } catch (e) { console.error(`❌ ${job.id}: ${e.message}`); }
}
console.log('武将生成完成，抠背景转透明 PNG…');
await import('./bg-remove.mjs');
