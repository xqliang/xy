// 临时冒烟：验证本轮渲染改动（骑兵朝向 / 被动陨石特效 / 红袍大招 / 被动斜光）+ 捕获 pageerror
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=1'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') logs.push('[console.error] ' + m.text()); });
await page.goto('http://127.0.0.1:5180/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

const r = async (fn) => page.evaluate(fn);

// —— 1. 骑兵朝向：强制骑兵波，快进让骑兵沿路生成（含左/右两方向） ——
await r(() => { const g = window.__game; g.restart(7, 1); g.enterBattle(); const b = g.battle; b.cavalryWave = true; b.cavalryWaveRatio = 1.0; });
await r(() => window.__game.fastForward(5));
await sleep(60);
await page.screenshot({ path: path.join(OUT, 'fx-cavalry.png') });

// —— 2. 被动陨石特效 ——
await r(() => {
  const g = window.__game; g.restart(7, 1); g.enterBattle(); const b = g.battle;
  b.mods.meteor = true; b.pickedItems = ['yunshi'];
  b.meteorPending = true;
  // 放一只怪到足够远（passiveMeteorReady 需走过 ≥ meteorRadius=2）
  const spd = b.normalMonsterSpeed();
  b.monsters.push({ id: 999, dist: b.entranceDist + 3.5, hp: 1e9, maxHp: 1e9, spd, isBoss: false, isMiniBoss: false, miniBossKind: null, isCavalry: false, hitFlash: 0, skill: null, skillCd: 0, castFlash: 0, spawnT: 0, stunT: 0, slowT: 0, hasteT: 0, healFlash: 0, burnT: 0, burnDps: 0 });
});
await r(() => window.__game.step(0.05)); // 触发 castMeteor → setSkillFx('meteor')
await sleep(40);
await page.screenshot({ path: path.join(OUT, 'fx-meteor.png') });

// —— 3. 红袍大招（天火从天而降） ——
await r(() => {
  const g = window.__game; g.restart(7, 1); g.enterBattle(); const b = g.battle;
  b.heroUltFx.push({ heroId: 'hongpao', c: 3, r: 5, ttl: 0.15, maxTtl: 0.6, tier: 3, rge: 2, crit: false });
});
await sleep(40);
await page.screenshot({ path: path.join(OUT, 'fx-hongpao.png') });

// —— 4. 被动斜光：给陨石图标设 flash，截底部 HUD ——
await r(() => {
  const g = window.__game; g.restart(7, 1); g.enterBattle(); const b = g.battle;
  b.pickedItems = ['yunshi']; b.passiveFlash.set('yunshi', 0.4);
});
await sleep(40);
await page.screenshot({ path: path.join(OUT, 'fx-slash.png') });

console.log('page errors:', logs.length ? logs : 'none');
await browser.close();
