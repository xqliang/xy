// 分享好友改造运行时冒烟：验证改了 main.ts(imports/handleShareShovel/staminaSharesLeft)、
// render.ts(draw() 每帧新增 drawShareShovelBtn)、menu-popups(drawStaminaPopup 新签名/平台分支) 后，
// web 站「加载菜单 → 打开体力弹窗 → 进战斗起波快进」全程无运行时异常。
// (tsc+vitest 抓不到渲染循环/模块初始化抛错，按项目规范 verify-web-in-browser 用系统 Chrome 跑 dev 站。)
// 断言：
//   A1 全程无未捕获 JS 异常（菜单 init → drawStaminaPopup → 战斗 drawShareShovelBtn 每帧）。
//   A2 __game 就绪、菜单→战斗切换、fastForward 后 battle.wave 推进（渲染循环真跑过）。
// web 端 isWeChat=false → 铲子按钮短路不画、体力弹窗只画看广告（截图 share-2/3 供人工确认）。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.SMOKE_URL || 'http://127.0.0.1:5199/?seed=7';
const VIEW_W = 560, VIEW_H = 1044;
const STAMINA_BAR_CENTER = { x: 175, y: 77 }; // menu.ts: BAR_X=100,w=150→cx=175; y=TOP+BAR_H+BAR_GAP=60,h=34→cy=77
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: 2 });
const shot = async (name) => { try { await page.screenshot({ path: path.join(OUT, name) }); } catch (e) { console.log('[shot-fail]', name, e.message); } };

const pageerrs = [];
const ENV_NOISE = /CORS|volces|Failed to load resource|ERR_FAILED|WebSocket connection|handshake|status of (404|500)/i;
page.on('console', (m) => { if (m.type() === 'error' && !ENV_NOISE.test(m.text())) pageerrs.push('[console.error] ' + m.text()); });
page.on('pageerror', (e) => pageerrs.push('[pageerror] ' + e.message));

const ALL_TUTORIALS = ['battleIntro', 'firstSummon', 'firstPlacement', 'firstHeroWord', 'firstShovel', 'firstHeroCombo', 'firstMergeable', 'firstFragmentDrop', 'merchantFirstOpen', 'lowStamina'];
await page.evaluateOnNewDocument((ids) => {
  const seen = {}; for (const id of ids) seen[id] = true;
  localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
}, ALL_TUTORIALS);

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady === true', { timeout: 15000 }).catch(() => {});
await sleep(300);
await shot('share-1-menu.png');
const screen0 = await page.evaluate(() => window.__game.curScreen());

// 打开体力弹窗(点体力条中心) → 触发 drawStaminaPopup(新签名 sharesLeft + 平台分支)。首开会动态 import menu-popups。
const toClient = async (lx, ly) => page.evaluate(([x, y, vw]) => {
  const r = document.querySelector('canvas').getBoundingClientRect();
  const fit = r.width / vw;
  return { x: r.left + x * fit, y: r.top + y * fit };
}, [lx, ly, VIEW_W]);
const cp = await toClient(STAMINA_BAR_CENTER.x, STAMINA_BAR_CENTER.y);
await page.mouse.click(cp.x, cp.y);
await sleep(500);
await shot('share-2-stamina-popup.png');

// 进战斗 → 起波 → 快进：drawShareShovelBtn 每帧执行(web 端 isWeChat=false 短路不画，但函数被调用)。
await page.evaluate(() => { const g = window.__game; g.enterBattle(); g.buildDefense(300); g.wave(); g.fastForward(4); });
await sleep(500);
await shot('share-3-battle.png');
const screen1 = await page.evaluate(() => window.__game.curScreen());
const wave = await page.evaluate(() => window.__game.battle.wave);

console.log('[screen0]', screen0, '[screen1]', screen1, '[wave]', wave);
console.log('\n--- page errors (非资源类) ---\n' + (pageerrs.join('\n') || '(none)'));
const a1 = pageerrs.length === 0;
const a2 = screen1 !== screen0 && wave >= 1;
const ok = a1 && a2;
console.log(`\nA1 无JS异常=${a1}  A2 菜单→战斗渲染循环正常(screen ${screen0}→${screen1}, wave=${wave})=${a2}`);
console.log('RESULT:', ok ? 'PASS' : 'FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
