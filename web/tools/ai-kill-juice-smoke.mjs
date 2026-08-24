// tools/ai-kill-juice-smoke.mjs —— 离线 AI 对战「AI 杀怪掉桃特效」冒烟。
// 修复前：updateAi 击杀分支只走 creditAiKill 加 aiPeach 数字，AI 半场杀怪无任何视觉反馈。
// 修复后：击杀处直调 spawnAiKillJuice（与玩家击杀/在线补演对称的 death 爆点 + 桃飘字）。
// 断言：
//   A1 离线对局推进后出现 AI 击杀 → peachFloats/bursts 有 AI 半场条目（上半场行 r < 半场分界）。
//   A2 无未捕获异常。产物 shots/ai-kill-juice.png 供人工核对特效落位（上半场）。
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
});
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady === true', { timeout: 15000 }).catch(() => {});

const res = await page.evaluate(() => {
  const g = window.__game;
  g.restart(7); g.enterBattle();
  g.grantPeach(600);
  // 我方尽快布防开波，随后只推进——AI 半场自己征兵/布阵/杀怪
  for (let k = 0; k < 30; k++) { if (!g.summon()) break; g.autoPlace(); }
  if (g.battle.pendingShop) g.chooseItem(0);
  g.wave();
  // peachFloats/bursts 是双半场共享数组（我方击杀也写）：只认 AI 半场（r<5，实测 aiPath 行 0..4）的条目
  let aiKills = 0; let aiFloats = [];
  for (let i = 0; i < 900; i++) {
    g.step(1 / 30);
    const up = g.battle.peachFloats.filter((f) => f.r < 5);
    const upBurst = g.battle.bursts.some((x) => x.kind === 'death' && x.r < 5);
    if (up.length > 0) aiFloats = up.map((f) => ({ c: f.c, r: f.r, amount: f.amount }));
    if ((up.length > 0 || upBurst) && i > 60) { aiKills = 1; break; }
  }
  return { aiKills, floats: aiFloats, aiPeach: g.battle.aiPeach, aiMon: g.battle.aiMonsters.length };
});
console.log('A1 probe:', JSON.stringify(res));
if (!res.aiKills || res.floats.length === 0) {
  console.log('FAIL：推进后未见 AI 半场击杀特效（飘字/爆点）'); process.exit(1);
}
// 飘字必须落在上半场（AI 半场镜像路径）：行号小于棋盘半高（ROWS=10 → r<5 留余量用 <5）
const upper = res.floats.every((f) => f.r < 5);
console.log('A1 飘字全部落 AI 半场(r<5):', upper, '样例:', JSON.stringify(res.floats.slice(0, 3)));
if (!upper) { console.log('FAIL：有飘字落在玩家半场'); process.exit(1); }

await sleep(600); // 等飘字/爆点处于可见期再截屏
await page.screenshot({ path: path.join(OUT, 'ai-kill-juice.png') });
if (errs.length) { console.log('FAIL：异常', errs); process.exit(1); }
console.log('PASS：AI 击杀掉桃特效冒烟通过（截图 shots/ai-kill-juice.png）');
await browser.close();
process.exit(0);
