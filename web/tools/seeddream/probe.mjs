// 探测火山方舟 Ark 图像生成可用的 model id。
const KEY = process.env.ARK_API_KEY;
const URL = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const candidates = [
  'doubao-seedream-4-0-250828',
  'doubao-seedream-3-0-t2i-250415',
  'doubao-seedream-3-5-t2i',
  'seedream-4-0',
];
const prompt = '测试：一只Q版卡通小猴子，白色背景';

for (const model of candidates) {
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size: '1024x1024', n: 1, response_format: 'url', watermark: false }),
    });
    const text = await res.text();
    console.log(`\n=== model=${model} -> HTTP ${res.status} ===`);
    console.log(text.slice(0, 600));
    if (res.status === 200) {
      console.log(`\n✅ WORKING MODEL: ${model}`);
      break;
    }
  } catch (e) {
    console.log(`model=${model} error:`, e.message);
  }
}
