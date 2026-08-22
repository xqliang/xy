// T9.5 运行时冒烟：真人「暂停改退出」——PvP 退出弹窗不暂停仿真；单人暂停回归不变。
// 用系统 Chrome 驱动 preview 站(5180)。断言靠 battle.monsters[0].dist（仿真步进信号）：
//   - PvP 点退出按钮后 dist 继续涨（仿真照跑），单人点暂停后 dist 冻结。
// 视觉上用截图确认弹窗确实画出。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://127.0.0.1:5181/?seed=7';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 截图容错：目录/写盘异常不应中断断言流程。
const shot = async (name) => { try { await page.screenshot({ path: path.join(OUT, name) }); } catch (e) { logs.push('[shot-fail] ' + name + ' ' + e.message); } };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = [];
const pageerrs = [];
// 资源加载类报错（TOS bgm CORS、preview 无 /api 代理致 WS 握手失败、素材 404/500）属环境噪声，不计入失败；
// 真正的未捕获 JS 异常(pageerror)或其它 console.error 才 fatal。
const ENV_NOISE = /CORS|volces|Failed to load resource|ERR_FAILED|WebSocket connection|handshake|status of (404|500)/i;
page.on('console', (m) => {
  if (m.type() === 'error') {
    if (ENV_NOISE.test(m.text())) logs.push('[env] ' + m.text());
    else pageerrs.push('[console.error] ' + m.text());
  }
});
page.on('pageerror', (e) => pageerrs.push('[pageerror] ' + e.message));

// 预置：把所有新手引导标成「已看过」，避免局内 tutorial overlay 拦截暂停/退出按钮点击（干扰本测试）。
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

// 逻辑坐标 → 客户区坐标（读画布实际 rect，避免硬编码偏移）。
const toClient = async (lx, ly) => page.evaluate(([x, y]) => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  const fit = r.width / 560; // VIEW_W=560
  return { x: r.left + x * fit, y: r.top + y * fit };
}, [lx, ly]);
const click = async (lx, ly) => { const p = await toClient(lx, ly); await page.mouse.click(p.x, p.y); };
const dist0 = () => page.evaluate(() => { const b = window.__game.battle; const m = b.monsters[0]; return m ? m.dist : null; });

// —— 调试：画布几何 + 点击落点 + 钩子可用性 —— //
const dbg = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  return { rect: { l: r.left, t: r.top, w: r.width, h: r.height }, fit: r.width / 560, hasEnterPvp: typeof window.__game.enterPvp, keys: Object.keys(window.__game).filter(k => /pause|pvp|enter/i.test(k)) };
});
console.log('[dbg]', JSON.stringify(dbg));
const p1 = await toClient(26, 36);
const p2 = await toClient(280, 549);
console.log('[dbg] click pts:', JSON.stringify({ pause: p1, cont: p2 }));
const st = () => page.evaluate(() => window.__game.pauseState());

// —— 单人回归：点暂停 → 仿真冻结；点继续 → 恢复 —— //
await page.evaluate(() => { const g = window.__game; g.restart(7, 1); g.enterBattle(); g.buildDefense(300); g.wave(); g.fastForward(1.5); });
await sleep(120);
const spStatus0 = await page.evaluate(() => window.__game.battle.status);
const spD0 = await dist0();
console.log('[SP-dbg] before click status=', spStatus0, 'd0=', spD0?.toFixed(2));
const topEl = await page.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y);
  const stack = document.elementsFromPoint(x, y).map(e => e.tagName + (e.id ? '#'+e.id : '') + (e.className && typeof e.className==='string' ? '.'+e.className.split(' ').join('.') : ''));
  return { top: el ? el.tagName : null, stack };
}, [p1.x, p1.y]);
console.log('[SP-dbg] elementsFromPoint at pause click:', JSON.stringify(topEl));
await click(26, 36); // 暂停按钮中心（logical pauseBtnRect 中心）
await sleep(60);
const spStImm = await st();
console.log('[SP-dbg] immediately after click:', JSON.stringify(spStImm));
await sleep(440);
const spD1 = await dist0();
const spSt = await st();
// 冻结判定用容差：仿真真冻结时 dist 恒定，但浮点读数/怪物[0]切换可能有极小抖动，允许 <0.02。
const spFrozen = (spD1 != null && spD0 != null && Math.abs(spD1 - spD0) < 0.02);
const spPausedState = (spSt.paused === true && spSt.pvpExitPopup === false);
await shot('t95-sp-pause.png');
await click(280, 549); // 弹窗「继续游戏」中心
await sleep(400);
const spD2 = await dist0();
const spSt2 = await st();
const spResumed = (spSt2.paused === false && spD2 !== spD1);
console.log(`[SP] status0=${spStatus0} pause 冻结=${spFrozen} 态paused=${spSt.paused}/pvpExit=${spSt.pvpExitPopup} (d0=${spD0?.toFixed(2)} d1=${spD1?.toFixed(2)})  继续恢复=${spResumed} (d2=${spD2?.toFixed(2)})`);

// —— PvP：点「退出」按钮 → 弹窗但仿真照跑 —— //
await page.evaluate(() => { window.__game.enterPvp(7); });
await sleep(150);
await page.evaluate(() => { const g = window.__game; if (g.battle.status !== 'playing') { g.buildDefense(200); g.wave(); } });
await sleep(120);
const isPvp = await page.evaluate(() => window.__game.battle.isPvp);
const pvpD0 = await dist0();
await click(26, 36); // PvP 下=「退出」按钮
await sleep(120);
const pvpSt = await st();
await sleep(400);     // 仿真应照常步进（pauseState 应显示 pvpExitPopup=true、paused=false）
const pvpD1 = await dist0();
const pvpPopupState = (pvpSt.paused === false && pvpSt.pvpExitPopup === true);
// PvP 退出弹窗开着时仿真照跑：dist 明显前进（>0.05，排除读数抖动）。
const pvpRunning = (pvpD1 != null && pvpD0 != null && (pvpD1 - pvpD0) > 0.05);
await shot('t95-pvp-exit.png');
console.log(`[PvP] isPvp=${isPvp} 弹窗态 paused=${pvpSt.paused}/pvpExit=${pvpSt.pvpExitPopup}  退出弹窗开着时仿真照跑=${pvpRunning} (d0=${pvpD0?.toFixed(2)} d1=${pvpD1?.toFixed(2)})`);

// 关弹窗（点「继续游戏」），确认可正常关闭
await click(280, 549);
await sleep(60);
const pvpStClose = await st();
console.log('[PvP-dbg] immediately after continue click:', JSON.stringify(pvpStClose));
await sleep(150);
const pvpSt2 = await st();
const pvpClosed = (pvpSt2.pvpExitPopup === false && pvpSt2.paused === false);
console.log('[PvP] 点继续后态=', JSON.stringify(pvpSt2), ' closed=', pvpClosed);

console.log('\n--- page errors (非资源加载类) ---\n' + (pageerrs.join('\n') || '(none)'));
const ok = spPausedState && spFrozen && spResumed && isPvp && pvpPopupState && pvpRunning && pvpClosed && pageerrs.length === 0;
console.log('\nRESULT:', ok ? 'PASS' : 'FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
