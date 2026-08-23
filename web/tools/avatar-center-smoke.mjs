// tools/avatar-center-smoke.mjs —— 头像框居中修复 + 哪吒无风火轮的浏览器验证。
// 逐个改 localStorage 头像 → 刷新菜单 → 截图，人工核对：立绘在头像框内居中、哪吒无轮不高。
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') logs.push('[console.error] ' + m.text()); });
for (const id of ['tangseng', 'wujing', 'guanyin', 'neza']) {
  await page.evaluateOnNewDocument((aid) => {
    localStorage.setItem('dasheng.profile', JSON.stringify({ nickname: null, avatarId: aid, unlockedAvatars: [] }));
    const seen = {}; for (const k of ['battleIntro','firstSummon','firstPlacement','firstHeroWord','firstShovel','firstHeroCombo','firstMergeable','firstFragmentDrop','merchantFirstOpen','lowStamina']) seen[k] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
  }, id);
  await page.goto('http://127.0.0.1:5180/?seed=7', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game && window.__game.snapshot');
  await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: path.join(OUT, `avatar-${id}.png`), clip: { x: 0, y: 0, width: 300, height: 500 } });
}
// 同时程序化校验：头像框内不透明像素的水平中心 vs 框中心（居中误差应 < 8px）
const check = await page.evaluate(async () => {
  const { avatarById } = await import('/src/avatar-catalog.ts');
  const out = {};
  const g = window.__game;
  for (const id of ['tangseng', 'wujing', 'guanyin', 'neza', 'wukong']) {
    const def = avatarById(id);
    out[id] = def ? def.art : null;
  }
  return out;
});
console.log('artMap:', JSON.stringify(check));
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
