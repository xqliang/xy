// tools/bomb-reticle-smoke.mjs —— 轰天雷拖拽部署的可落格标识冒烟。
// 需求：可埋路径格 = 四角框 + 中央「+」（与兵器部署同款）；此前只有四角框。
// 走真实拖拽：装备 act_bomb → 在技能槽上按下 → 拖到棋盘上方悬停 → 截图人工核对「+」。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.evaluateOnNewDocument(() => {
  const ids = ['battleIntro','firstSummon','firstPlacement','firstHeroWord','firstShovel','firstHeroCombo','firstMergeable','firstFragmentDrop','merchantFirstOpen','lowStamina'];
  localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen: Object.fromEntries(ids.map((i) => [i, true])) }));
  localStorage.setItem('dasheng.playedOnce', '1');
});
await page.goto('http://127.0.0.1:5181/?seed=5', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
// 装备轰天雷并进入战斗（走真实菜单开始路径，与 game-start-hint 冒烟一致）
await page.evaluate(() => window.__game.equipActives(['act_bomb']));
const startBtn = await page.evaluate(async () => (await import('/src/menu.ts')).menuButtons().find((b) => b.id === 'start'));
await page.mouse.click(startBtn.x + startBtn.w / 2, startBtn.y + startBtn.h / 2);
await new Promise((r) => setTimeout(r, 600));
const slot = await page.evaluate(async () => (await import('/src/render.ts')).activeSlotCenter ? null : null);
// activeSlotCenter 未导出 → 用常量推算：CTRL_Y 见 render.ts；直接从页面取 CTRL_Y
const CTRL_Y = await page.evaluate(async () => (await import('/src/render.ts')).CTRL_Y);
const act = { x: 180 - 20 - 60 + 30, y: CTRL_Y + (78 - 60) / 2 + 30 };
console.log('技能槽中心:', JSON.stringify(act));
// 真实拖拽：按下技能槽 → 移到棋盘中段悬停（drawPillDropHints 在 dragActiveSlot 非空时绘制）
await page.mouse.move(act.x, act.y);
await page.mouse.down();
await page.mouse.move(280, 420, { steps: 8 });
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({ path: path.join(OUT, 'bomb-reticle.png') });
await page.mouse.up();
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
