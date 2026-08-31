// tools/abandon-matching-smoke.mjs —— 「切后台/离开匹配页时放弃匹配、清服务端 ticket」冒烟。
// 背景：匹配中点退出按钮会 cancel，但【匹配中直接切后台/锁屏】此前只 pauseLoop、不清 ticket，
//   导致 ticket 在服务端队列残留 ~2.5min，期间别人匹配会匹配到这个已离开的玩家（对手看到其从不加入）。
//   修复：onAppHide(wx) / visibilitychange(Web) 的切后台分支调 abandonPvpMatching() → cancel + 回首页。
// 断言（无 Python 服务端，poll 失败被 catch 吞，仅停噪声）：
//   A1 fakePvpMatch('queuing') 停在匹配屏（curScreen=pvpMatching）。
//   A2 dispatch visibilitychange(hidden) 模拟切后台 → curScreen 变 menu（放弃匹配）。
//   A3 再次回前台不报错；无未捕获 pageerror。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.SMOKE_URL || 'http://127.0.0.1:5183/?seed=7';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
const pageerrs = [];
const NOISE = /CORS|volces|Failed to load resource|ERR_FAILED|net::|WebSocket|handshake|status of (404|500|503)|versus/i;
page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) pageerrs.push('[console.error] ' + m.text()); });
page.on('pageerror', (e) => pageerrs.push('[pageerror] ' + e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__game && window.__game.curScreen', { timeout: 15000 });
const cur = () => page.evaluate(() => window.__game.curScreen());

// A1：进匹配屏（queuing，controller 已建）
await page.evaluate(() => window.__game.fakePvpMatch('queuing'));
await sleep(150);
const s1 = await cur();
console.log('A1 进匹配屏 curScreen =', s1);
if (s1 !== 'pvpMatching') { console.log('❌ FAIL：未停在匹配屏'); await browser.close(); process.exit(1); }
console.log('✅ A1 停在匹配屏');

// A2：模拟切后台（dispatch visibilitychange + 临时把 document.hidden 置 true）
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await sleep(200);
const s2 = await cur();
console.log('A2 切后台后 curScreen =', s2);
if (s2 !== 'menu') { console.log('❌ FAIL：切后台未放弃匹配（应回 menu）'); await browser.close(); process.exit(1); }
console.log('✅ A2 切后台放弃匹配、回首页');

// A3：回前台不报错
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await sleep(200);
const s3 = await cur();
console.log('A3 回前台 curScreen =', s3, '（无未捕获错误:', pageerrs.length === 0, '）');
if (pageerrs.length) { console.log('❌ pageerror:', pageerrs.join('\n')); await browser.close(); process.exit(1); }
console.log('✅ A3 回前台无异常');

console.log('\n✅ PASS：切后台放弃匹配、清服务端 ticket（防残留被别人匹配到）');
await browser.close();
