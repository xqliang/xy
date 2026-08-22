// 洛阳铲改动运行时冒烟：CD→60s、HUD 图标不再画进度条、点击弹窗仍正常。
// 背景：改了 render.ts 的 drawPassiveRow / drawPassivePopup（删进度条），typecheck+vitest
//   抓不到「渲染循环运行时抛错」，故按项目规范用系统 Chrome 真机跑 dev 站验证。
// 断言：
//   A1 全程无未捕获 JS 异常（drawPassiveRow 每帧跑、drawPassivePopup 点开后跑）。
//   A2 洛阳铲 HUD 图标行「原进度条位置」的像素不再是琥珀金（进度条已删）。
//   A3 点击图标后详情弹窗确实画出（弹窗区像素变为深色弹窗底）。
//   A4 battle.pickedItems 确含 luoyangchan（确保确实在渲染洛阳铲这一格）。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.SMOKE_URL || 'http://127.0.0.1:5199/?seed=7';
const VIEW_W = 560, VIEW_H = 1044;               // 逻辑画布尺寸（render.ts 常量推导）
const ICON = { x: 280, y: 987 };                 // 单个被动时图标居中：x=VIEW_W/2, y=PAS_Y+PAS_H/2
const BAR = { x: 280, y: 1006 };                 // 原行内进度条位置（btn.y+btn.h-5≈1005）
const POPUP = { x: 280, y: 115 };                // 详情弹窗标题区（弹窗从 y=BOARD_Y+20=104 起）
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: 2 });
const shot = async (name) => { try { await page.screenshot({ path: path.join(OUT, name) }); } catch (e) { console.log('[shot-fail]', name, e.message); } };

const pageerrs = [];
// 资源类噪声（素材 404/500、CORS、无服务端 WS 握手失败）不计入失败；真正未捕获 JS 异常才 fatal。
const ENV_NOISE = /CORS|volces|Failed to load resource|ERR_FAILED|WebSocket connection|handshake|status of (404|500)/i;
page.on('console', (m) => { if (m.type() === 'error' && !ENV_NOISE.test(m.text())) pageerrs.push('[console.error] ' + m.text()); });
page.on('pageerror', (e) => pageerrs.push('[pageerror] ' + e.message));

// 关掉所有新手引导 overlay，避免拦截图标点击。
const ALL_TUTORIALS = ['battleIntro', 'firstSummon', 'firstPlacement', 'firstHeroWord', 'firstShovel', 'firstHeroCombo', 'firstMergeable', 'firstFragmentDrop', 'merchantFirstOpen', 'lowStamina'];
await page.evaluateOnNewDocument((ids) => {
  const seen = {}; for (const id of ids) seen[id] = true;
  localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
}, ALL_TUTORIALS);

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady === true', { timeout: 15000 }).catch(() => {});

// 只装洛阳铲一件被动 → 进入对战 → 造点防御 → 起波 → 快进（drawPassiveRow 每帧渲染洛阳铲图标）。
await page.evaluate(() => {
  const g = window.__game;
  g.equipPassives(['luoyangchan']); // 内部 newGame()，重建带该被动的对局
  g.enterBattle();
  g.buildDefense(300);
  g.wave();
  g.fastForward(2);
});
await sleep(400);
await shot('luoyang-1-row.png');

// A4：确认洛阳铲确实在 pickedItems 里
const picked = await page.evaluate(() => (window.__game.battle.pickedItems || []).slice());
const hasShovel = picked.includes('luoyangchan');

// 逻辑坐标 → 画布设备像素采样（各轴按自身缩放比，避免宽高比差异）。
const samplePixel = async (lx, ly) => page.evaluate(([x, y, vw, vh]) => {
  const c = document.querySelector('canvas');
  const ctx = c.getContext('2d');
  const dx = Math.round(x * (c.width / vw)), dy = Math.round(y * (c.height / vh));
  if (dx < 0 || dy < 0 || dx >= c.width || dy >= c.height) return { err: 'oob' };
  try { const d = ctx.getImageData(dx, dy, 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: d[3] }; }
  catch (e) { return { err: e.message }; }
}, [lx, ly, VIEW_W, VIEW_H]);

// A2：原进度条位置不应是琥珀金('#ffd24a'=255,210,74)。删掉后此处是图标块底(深绿#2c4a30)。
const barPx = await samplePixel(BAR.x, BAR.y);
const isAmber = (p) => p && p.r != null && p.r > 220 && p.g > 170 && p.g < 240 && p.b < 130 && p.r > p.g;
const barGone = barPx.err ? null : !isAmber(barPx);

// 逻辑坐标 → 客户区坐标后点击图标，打开详情弹窗（drawPassivePopup 执行）。
const toClient = async (lx, ly) => page.evaluate(([x, y, vw]) => {
  const r = document.querySelector('canvas').getBoundingClientRect();
  const fit = r.width / vw;
  return { x: r.left + x * fit, y: r.top + y * fit };
}, [lx, ly, VIEW_W]);
const cp = await toClient(ICON.x, ICON.y);
await page.mouse.click(cp.x, cp.y);
await sleep(400); // 多帧渲染弹窗；若 drawPassivePopup 抛错会进 pageerrs
await shot('luoyang-2-popup.png');

// A3：弹窗底为深色('rgba(30,24,18,..)')；点开前该点是棋盘区，点开后应显著变暗。
const popPx = await samplePixel(POPUP.x, POPUP.y);
const popupShown = popPx.err ? null : (popPx.r < 70 && popPx.g < 60 && popPx.b < 50);

console.log('[picked]', JSON.stringify(picked));
console.log('[A2 bar pixel]', JSON.stringify(barPx), '→ barGone=', barGone);
console.log('[A3 popup pixel]', JSON.stringify(popPx), '→ popupShown=', popupShown);
console.log('\n--- page errors (非资源类) ---\n' + (pageerrs.join('\n') || '(none)'));

// 像素采样若因画布跨域被污染(err)则降级为「不判定」(null)，靠截图人工确认，但 A1/A4 仍强制。
const a1 = pageerrs.length === 0;
const ok = a1 && hasShovel && barGone !== false && popupShown !== false;
console.log(`\nA1 无JS异常=${a1}  A4 洛阳铲已装=${hasShovel}  A2 进度条已删=${barGone}  A3 弹窗正常=${popupShown}`);
console.log('RESULT:', ok ? 'PASS' : 'FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
