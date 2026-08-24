// 弱网优化③冒烟：main.ts 新增事件接线（回前台 + 网络恢复 → pvpSock?.reconnectNow()）
//   与 pvp-ws.ts 重连退避改造。typecheck+vitest 抓不到「bundle 初始化/事件注册/真 WebSocket
//   断线重连循环」的运行时问题，故按项目规范用系统 Chrome 真机跑 dev 站验证。
// 断言：
//   A1 应用启动无未捕获 JS 异常（新增 onNetworkOnline import + 三处接线未打断 bundle 初始化）。
//   A2 enterPvp 起一局：dev 站无 WS 服务端 → 连接失败进 reconnecting 循环
//      （真实浏览器跑通改造后的退避路径），且本方权威 sim 照常步进（断线不影响本地半场）。
//   A3 dispatchEvent('online') / visibilitychange 往返注入不抛错，且 reconnecting 态下
//      online 触发后 state 仍在新一轮尝试里（不崩、不变成 closed）。
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.SMOKE_URL || 'http://127.0.0.1:5199/?seed=7';
const VIEW_W = 560, VIEW_H = 1044;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: VIEW_W, height: VIEW_H });
const pageerrs = [];
const ENV_NOISE = /CORS|volces|Failed to load resource|ERR_FAILED|WebSocket connection|handshake|status of (404|500)/i;
page.on('console', (m) => { if (m.type() === 'error' && !ENV_NOISE.test(m.text())) pageerrs.push('[console.error] ' + m.text()); });
page.on('pageerror', (e) => pageerrs.push('[pageerror] ' + e.message));

await page.evaluateOnNewDocument(() => {
  const ids = ['battleIntro', 'firstSummon', 'firstPlacement', 'firstHeroWord', 'firstShovel',
               'firstHeroCombo', 'firstMergeable', 'firstFragmentDrop', 'merchantFirstOpen', 'lowStamina'];
  localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen: Object.fromEntries(ids.map((i) => [i, true])) }));
});

// A1：启动零异常
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady === true', { timeout: 15000 }).catch(() => {});
console.log('A1 启动 OK，异常数:', pageerrs.length);

// A2：PvP 起局 → WS 连不上（vite 无该端点）→ reconnecting；本方 sim 照常步进
await page.evaluate(() => window.__game.enterPvp(7));
await sleep(2500);   // 覆盖首试 300ms + 1s 退避各至少一轮
const probe1 = await page.evaluate(() => window.__game.pvpProbe());
console.log('A2 probe:', JSON.stringify(probe1));
if (!probe1 || !probe1.active) { console.log('FAIL：PvP 未激活'); process.exit(1); }
if (probe1.sockState !== 'reconnecting') { console.log('FAIL：期望 reconnecting（无服务端），实际', probe1.sockState); process.exit(1); }
await sleep(1200);   // rAF 真实步进（PvP 固定步长由主循环驱动，fastForward 走单人体路径不适用）
const probe2 = await page.evaluate(() => window.__game.pvpProbe());
console.log('A2 本方 sim 步进:', probe1.localSimTick, '→', probe2.localSimTick);
if (probe2.localSimTick <= probe1.localSimTick) { console.log('FAIL：断线下本方 sim 未步进'); process.exit(1); }

// A3：注入 online / visibilitychange 往返（reconnecting 态 → reconnectNow 立即再试；回调无异常）
await page.evaluate(() => {
  window.dispatchEvent(new Event('online'));
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
});
await sleep(1500);
const probe3 = await page.evaluate(() => window.__game.pvpProbe());
console.log('A3 注入后 probe:', JSON.stringify(probe3));
if (!probe3 || !probe3.active) { console.log('FAIL：事件注入后 PvP 会话丢失'); process.exit(1); }
if (probe3.sockState !== 'reconnecting' && probe3.sockState !== 'connecting') {
  console.log('FAIL：注入后 sockState 异常：', probe3.sockState); process.exit(1);
}

if (pageerrs.length) {
  console.log('FAIL：出现异常');
  for (const e of pageerrs) console.log(' ', e);
  process.exit(1);
}
console.log('PASS：弱网接线冒烟全部通过');
await browser.close();
process.exit(0);
