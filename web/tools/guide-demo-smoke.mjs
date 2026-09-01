// 首引拖拽/施放演示动画冒烟：构造两个场景循环截图，人工核对手型/ghost/虚线高亮。
// 场景1（布阵演示）：首局（不预置教程）→ 真点征兵按钮（走 UI 路径置 playerSummonedThisGame）
//   → guidePhase=deploy → 手型从 tray 拖令牌到推荐空格循环演示。
// 场景2（技能施放演示）：正常对局 → 伪造 ready 的仙丹槽 + 场上有兵器 → 手型从技能槽拖到兵器格。
// 用法：node tools/guide-demo-smoke.mjs（需 worktree dev server 5182 或 GUIDE_URL）
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.GUIDE_URL || 'http://127.0.0.1:5182/?seed=7';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
const errs = [];
const NOISE = /favicon|\/api\/|CORS|Failed to load resource/i;
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// —— 场景 1：首局布阵演示 —— //
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
// 不预置教程/playedOnce = 首局；进战斗后真点征兵按钮（UI 路径置 playerSummonedThisGame → guidePhase 切 deploy）
await page.evaluate(() => { const g = window.__game; g.restart(7, 1); g.enterBattle(); });
await sleep(1200);
const clicked = await page.evaluate(() => {
  const g = window.__game;
  return { canvasH: document.querySelector('canvas').clientHeight, canvasW: document.querySelector('canvas').clientWidth };
});
console.log('canvas css 尺寸:', JSON.stringify(clicked));
// 征兵按钮中心（x=280）：在按钮行可能的 y 区间自上而下探针点击，summonCount>0 即成功
let summonOk = false;
for (const y of [clicked.canvasH - 60, clicked.canvasH - 80, clicked.canvasH - 100, clicked.canvasH - 45, clicked.canvasH - 120]) {
  await page.mouse.click(280, y);
  await sleep(300);
  summonOk = await page.evaluate(() => window.__game.battle.summonCount > 0);
  if (summonOk) break;
}
console.log('真实点击征兵:', summonOk);
// 等丝带落位 + guidePhase 切 deploy（下一帧 updateFirstGameGuide 推进）
await sleep(1200);
const guideState = await page.evaluate(() => ({
  tray: window.__game.battle.tray.filter(Boolean).length,
  summonCount: window.__game.battle.summonCount,
}));
console.log('征兵后状态:', JSON.stringify(guideState));
// 连拍 8 张（每 400ms）覆盖 2.5 个演示周期，人工核对手型/ghost/虚线各相位
for (let i = 0; i < 8; i++) {
  await page.screenshot({ path: `shots/guide-deploy-${i}.png` });
  await sleep(400);
}
console.log('场景1 截图完成（guide-deploy-0..7.png）');

// —— 场景 2：技能施放演示（仙丹 → 兵器格）—— //
await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1); g.enterBattle();
  // 部署一个兵器到场上（仙丹的投放目标）
  for (let k = 0; k < 10; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  // 伪造 ready 的仙丹槽（触发技能就绪演示；无需真实 CD 流转）
  g.battle.activeSlots[0] = { id: 'act_atk', cd: 0, cdMax: 80, ready: true, flash: 0 };
  if (g.battle.status === 'ready') g.wave();
});
await sleep(1500);
for (let i = 0; i < 8; i++) {
  await page.screenshot({ path: `shots/guide-skill-${i}.png` });
  await sleep(400);
}
console.log('场景2 截图完成（guide-skill-0..7.png）');

console.log(errs.length ? 'FAIL(页面报错): ' + errs.slice(0, 3).join(' | ') : 'PASS: 两场景零报错');
await browser.close();
process.exit(errs.length ? 1 : 0);
