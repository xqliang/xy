// DevTools 验证：连点版本号7次开面板 → 切「出怪承压」→ 读「血量/波次」组键序，
// 断言 cycleStrengthMul(=1.6) 后紧跟 wavesPerCycle。另截整面板图。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = []; page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:5180/?seed=7&map=baiguling', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');

// 连点右下角版本号 7 次（间隔 300ms < 2500ms 窗口）
for (let i = 0; i < 7; i++) {
  await page.mouse.click(520, 995);
  await new Promise(r => setTimeout(r, 300));
}
// 等 DevTools 根节点出现
await page.waitForFunction('!!document.querySelector("[id^=xy-devtools]") || !!document.querySelector(".xy-dt-tabs")', { timeout: 5000 }).catch(() => {});
await new Promise(r => setTimeout(r, 300));

// 切「出怪承压」tab
const tabOk = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.xy-dt-tab')];
  const t = tabs.find((el) => el.textContent === '出怪承压');
  if (!t) return false;
  t.click();
  return true;
});
if (!tabOk) { console.log('FAIL: 找不到「出怪承压」tab'); await browser.close(); process.exit(1); }
await new Promise(r => setTimeout(r, 300));

// 读「出怪承压」tab 全部行键序（血量/波次组是该 tab 第一组，cycleStrengthMul 应紧跟 wavesPerCycle 在其前）
const info = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.xy-dt-row')];
  const keys = rows.map((el) => el.querySelector('.xy-dt-key')?.textContent).filter(Boolean);
  const csm = rows.find((el) => el.querySelector('.xy-dt-key')?.textContent === 'cycleStrengthMul');
  const csmVal = csm ? (csm.querySelector('input')?.value ?? null) : null;
  return { keys, csmVal };
});
console.log('键序:', info ? JSON.stringify(info.keys) : '(未找到 section)');
console.log('cycleStrengthMul 值:', info?.csmVal);
if (info) {
  const i = info.keys.indexOf('cycleStrengthMul');
  console.log('cycleStrengthMul 位置:', i, '→ 下一个键:', info.keys[i + 1]);
  console.log(i >= 0 && info.keys[i + 1] === 'wavesPerCycle' ? 'PASS: wavesPerCycle 紧跟其后' : 'FAIL: 未紧跟');
  console.log(info.csmVal === '1.6' ? 'PASS: 值=1.6' : 'FAIL: 值≠1.6 (' + info.csmVal + ')');
} else {
  console.log('FAIL: 未读到键序');
}
await page.screenshot({ path: path.join(OUT, 'devtools-monster-order.png') });
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
