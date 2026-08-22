// T9.4 运行时冒烟：双方延迟 HUD（drawNetLatencyFlanks）在真实 PvP 帧里执行不抛异常。
// 用系统 Chrome 驱动本 worktree 的 preview(5182)。断言：
//   - 进入 PvP 对局后帧循环持续跑 draw()→drawHud→drawNetLatencyFlanks，无 pageerror / 非环境 console.error；
//   - 仿真仍在步进（monsters[0].dist 增长）证明帧循环活着、drawHud 每帧被调用；
//   - 截图留档，肉眼确认中块左右两侧出现「我 -- / 对 --」（首 pong 前 rtt=null）。
// 注：pvpSock 连不上真实服务端（fabricated matchId）→ rttMs 恒 null，故测的是 null 分支（"--"）；
//     非 null 分支仅标签字符串不同，layout/measureText 路径与 null 分支完全相同，单测已钉死公式。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://127.0.0.1:5182/?seed=7';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = [];
const pageerrs = [];
// 环境噪声（WS 握手失败/素材 CORS/404）不计入失败；真正的未捕获异常或非环境 console.error 才 fatal。
const ENV_NOISE = /CORS|volces|Failed to load resource|ERR_FAILED|WebSocket connection|handshake|status of (404|500)/i;
page.on('console', (m) => {
  if (m.type() === 'error') {
    if (ENV_NOISE.test(m.text())) logs.push('[env] ' + m.text());
    else pageerrs.push('[console.error] ' + m.text());
  }
});
page.on('pageerror', (e) => pageerrs.push('[pageerror] ' + e.message));

// 预置：新手引导全标「已看过」，避免 tutorial overlay 干扰。
const ALL_TUTORIALS = ['battleIntro', 'firstSummon', 'firstPlacement', 'firstHeroWord', 'firstShovel', 'firstHeroCombo', 'firstMergeable', 'firstFragmentDrop', 'merchantFirstOpen', 'lowStamina'];
await page.evaluateOnNewDocument((ids) => {
  const seen = {};
  for (const id of ids) seen[id] = true;
  localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
}, ALL_TUTORIALS);

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady === true', { timeout: 15000 }).catch(() => {});
await sleep(200);

// 起一局 PvP（fabricated matchId，WS 连不上但帧循环照跑），布防 + 开波让仿真步进。
await page.evaluate(() => { const g = window.__game; g.enterPvp(7); g.enterBattle(); g.buildDefense(300); g.wave(); });
await sleep(500);
// 验证：对局态 + 开波后进入 playing。
const probe = await page.evaluate(() => {
  const b = window.__game.battle;
  const m = b.monsters[0];
  return { status: b.status, dist: m ? m.dist : null, pvpSync: window.__game.pvpEndProbe().pvpSync, screen: window.__game.curScreen() };
});
console.log('[probe]', JSON.stringify(probe));

// 再等一会，确认 dist 继续涨（帧循环没因 drawNetLatencyFlanks 抛异常而停）。
const d0 = probe.dist;
await sleep(700);
const d1 = await page.evaluate(() => { const m = window.__game.battle.monsters[0]; return m ? m.dist : null; });
console.log('[sim] d0=', d0?.toFixed(2), 'd1=', d1?.toFixed(2));

await page.screenshot({ path: path.join(OUT, 't94-netlat-flanks.png') });
console.log('[shot] t94-netlat-flanks.png');

await browser.close();

// —— 判定 ——
let ok = true;
const fail = (m) => { ok = false; console.log('[FAIL] ' + m); };
if (probe.screen !== 'battle') fail('screen 非 battle: ' + probe.screen);
if (!probe.pvpSync) fail('pvpSync=false（未进入 PvP 对局态）');
if (d0 === null || d1 === null) fail('无怪物可测 dist');
else if (!(d1 > d0)) fail('仿真未步进（d1 不大于 d0）→ 帧循环可能停了');
if (pageerrs.length) fail('运行时异常: ' + JSON.stringify(pageerrs));
if (ok) console.log('[PASS] drawNetLatencyFlanks 在真实 PvP 帧执行无异常，仿真持续步进');
else console.log('[RESULT] FAIL');
process.exit(ok ? 0 : 1);
