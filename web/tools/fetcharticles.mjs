// 用系统 Chrome(headless) 抓取知乎专栏文章正文，保存为 txt 供研读。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/refs');
fs.mkdirSync(OUT, { recursive: true });

const URLS = [
  ['a1', 'https://zhuanlan.zhihu.com/p/2060413012826142438'],
  ['a2', 'https://zhuanlan.zhihu.com/p/2052469018175464032'],
  ['a3', 'https://zhuanlan.zhihu.com/p/2055606850872251800'],
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
for (const [tag, url] of URLS) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36');
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2500));
    const data = await page.evaluate(() => {
      const title = document.querySelector('h1')?.innerText ?? document.title;
      const rich = document.querySelector('.Post-RichText, .RichText, article');
      const body = rich ? rich.innerText : document.body.innerText;
      return { title, body };
    });
    const file = path.join(OUT, `${tag}.txt`);
    fs.writeFileSync(file, `# ${data.title}\n源: ${url}\n\n${data.body}`);
    console.log(`[${tag}] ok  title="${data.title}"  chars=${data.body.length}  -> ${file}`);
  } catch (e) {
    console.log(`[${tag}] FAIL ${e.message}`);
  }
  await page.close();
}
await browser.close();
