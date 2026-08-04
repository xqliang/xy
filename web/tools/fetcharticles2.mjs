// 重试抓取被限流的 a1/a3：Googlebot UA + 独立上下文 + 多次重试 + 从 js-initialData 兜底取正文。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/refs');

const URLS = [
  ['a1', 'https://zhuanlan.zhihu.com/p/2060413012826142438'],
  ['a3', 'https://zhuanlan.zhihu.com/p/2055606850872251800'],
];
const UAS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
];

async function tryFetch(url, ua) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent(ua);
  let out = null;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 3000));
    out = await page.evaluate(() => {
      const rich = document.querySelector('.Post-RichText, .RichText, article');
      let body = rich ? rich.innerText : '';
      let title = document.querySelector('h1')?.innerText ?? '';
      // 兜底：从 SSR 初始数据里取
      if (!body || body.length < 300) {
        const s = document.querySelector('#js-initialData');
        if (s) {
          try {
            const j = JSON.parse(s.textContent);
            const articles = j?.initialState?.entities?.articles || {};
            const first = Object.values(articles)[0];
            if (first?.content) {
              const tmp = document.createElement('div');
              tmp.innerHTML = first.content;
              body = tmp.innerText;
              title = first.title || title;
            }
          } catch { /* ignore */ }
        }
      }
      return { title, body, raw: document.body.innerText.slice(0, 200) };
    });
  } catch (e) {
    out = { error: e.message };
  }
  await browser.close();
  return out;
}

for (const [tag, url] of URLS) {
  let done = false;
  for (const ua of UAS) {
    for (let attempt = 1; attempt <= 2 && !done; attempt++) {
      const r = await tryFetch(url, ua);
      if (r?.body && r.body.length > 300) {
        fs.writeFileSync(path.join(OUT, `${tag}.txt`), `# ${r.title}\n源: ${url}\n\n${r.body}`);
        console.log(`[${tag}] ok ua=${ua.slice(0, 20)} chars=${r.body.length}`);
        done = true;
      } else {
        console.log(`[${tag}] retry ua=${ua.slice(0, 20)} attempt=${attempt} got="${(r?.raw || r?.error || '').slice(0, 80)}"`);
        await new Promise((res) => setTimeout(res, 6000));
      }
    }
  }
  if (!done) console.log(`[${tag}] STILL FAILED`);
}
