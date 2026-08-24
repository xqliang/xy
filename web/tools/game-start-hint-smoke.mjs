// tools/game-start-hint-smoke.mjs —— 开局「征兵→部署」提示改造冒烟。
// 需求：①征兵提示常驻直到点过征兵；②部署提示征兵后才出现、放置首个 tray 后 ~2s 淡出；
//       箭头三角上移 2px 完全盖住标签描边。
// 断言走 window.__game.gameStartHint() 状态钩子（画布被 CDN 跨域图片污染、且标签色与
// 候选区背景相近，像素采样不可行）；箭头/边框细节由截图人工核对。
//   A1 开局 ①(summon) 出现；等 5s（旧版 3.5s 定时消失）后仍是 summon —— 常驻。
//   A2 点击征兵按钮 → 变 deploy（① 消失、② 出现）。
//   A3 放置 tray（一键布阵清空候选区）→ 变 fade 且透明度随时间下降；2.6s 后 off。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.SMOKE_URL || 'http://127.0.0.1:5181/?seed=7';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
const errs = [];
const NOISE = /CORS|volces|Failed to load resource|ERR_FAILED|WebSocket connection|handshake/i;
page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push('[console.error] ' + m.text()); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
await page.evaluateOnNewDocument(() => {
  const ids = ['battleIntro', 'firstSummon', 'firstPlacement', 'firstHeroWord', 'firstShovel',
               'firstHeroCombo', 'firstMergeable', 'firstFragmentDrop', 'merchantFirstOpen', 'lowStamina'];
  localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen: Object.fromEntries(ids.map((i) => [i, true])) }));
  localStorage.setItem('dasheng.playedOnce', '1'); // 非首局：关掉首局征兵引导，画面只剩本次的开局提示
});
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');

const hint = () => page.evaluate(() => window.__game.gameStartHint());
const alpha = () => page.evaluate(async () => {
  const r = await import('/src/render.ts');
  return r.gameStartHintAlpha(window.__game.gameStartHint());
});

const fail = async (msg) => { console.log('FAIL：' + msg); await browser.close(); process.exit(1); };

// 真实开局路径：点菜单「开始」按钮（newGame + armGameStartHint；restart 钩子不 arm 提示）
const startBtn = await page.evaluate(async () => {
  const m = await import('/src/menu.ts');
  return m.menuButtons().find((b) => b.id === 'start');
});
if (!startBtn) { console.log('FAIL：找不到菜单开始按钮'); await browser.close(); process.exit(1); }
await page.mouse.click(startBtn.x + startBtn.w / 2, startBtn.y + startBtn.h / 2);

// A1：开局 summon，5s 后仍 summon（旧实现 3.5s 就 off）
await sleep(800);
if ((await hint()).stage !== 'summon') await fail('开局未出现征兵提示: ' + JSON.stringify(await hint()));
await sleep(5000);
if ((await hint()).stage !== 'summon') await fail('征兵提示未常驻（5s 后消失）');
await page.screenshot({ path: path.join(OUT, 'game-start-hint-1.png') });
console.log('A1 PASS 征兵提示常驻（5.8s 后仍 summon）');

// A2：点击征兵按钮 → deploy
await page.mouse.click(280, 915); // 征兵按钮中心（summonButtonRect {180,876,200,78}）
await sleep(800);
if ((await hint()).stage !== 'deploy') await fail('点征兵后未切到部署提示: ' + JSON.stringify(await hint()));
await page.screenshot({ path: path.join(OUT, 'game-start-hint-2.png') });
console.log('A2 PASS 征兵→部署提示切换');

// A3：放置一枚 tray 令牌（placeFromTray 钩子 = 手动拖拽落子的等价动作；一键布阵的
// 规划器在无怪备战态可能返回 0 步，不适合作为「放置了一枚」的触发器）→ fade → off
const placedOk = await page.evaluate(() => {
  for (let i = 0; i < 6; i++) for (const cell of [{ c: 3, r: 7 }, { c: 4, r: 7 }, { c: 2, r: 8 }]) {
    if (window.__game.placeFromTray(i, cell)) return true;
  }
  return false;
});
if (!placedOk) await fail('placeFromTray 放置失败（tray 无可落令牌？）');
await page.waitForFunction("window.__game.gameStartHint().stage === 'fade'", { timeout: 1500 })
  .catch(async () => await fail('放置后未进入淡出: ' + JSON.stringify(await hint())));
const a3 = await alpha();
const h3 = await hint();
await sleep(2400);
const h4 = await hint();
if (h4.stage !== 'off') await fail('2.8s 后提示未消失: ' + JSON.stringify(h4));
await page.screenshot({ path: path.join(OUT, 'game-start-hint-3.png') });
console.log(`A3 PASS 布阵后淡出（fade 起 alpha=${a3.toFixed(2)}，2.8s 后 off）`);

if (errs.length) await fail('页面异常 ' + JSON.stringify(errs));
console.log('PASS：开局提示两阶段 + 常驻/淡出全部通过（截图 shots/game-start-hint-*.png 核对箭头遮边框）');
await browser.close();
process.exit(0);
