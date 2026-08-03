// 端到端截图自测：用系统 Chrome 驱动 window.__game，抓关键场景并打印数值快照。
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const GAME_URL = 'http://127.0.0.1:5180/?seed=7';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, name) });
};
const snap = (page) => page.evaluate(() => window.__game.snapshot());

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--force-device-scale-factor=2'],
});
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 920, deviceScaleFactor: 2 });
const logs = [];
page.on('console', (m) => logs.push(`[console] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(GAME_URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');

// 1) 初始界面
await shot(page, '01-initial.png');
console.log('01 initial:', JSON.stringify(await snap(page)));

// 2) 真实布阵：给足蟠桃、开阵位、填满、反复合成（贴路阵位）
await page.evaluate(() => window.__game.buildDefense(10, 2000));
await shot(page, '02-defense.png');
console.log('02 defense:', JSON.stringify(await snap(page)));

// 3) 第 1 波战斗中（推进 4 秒）：应看到攻击连线 + 击杀产桃
await page.evaluate(() => { window.__game.wave(); window.__game.fastForward(4); });
await shot(page, '03-combat.png');
console.log('03 combat :', JSON.stringify(await snap(page)));

// 4) 连打多波：每波清完自动进下一波，直到通关或阵亡
const progress = await page.evaluate(() => {
  const g = window.__game;
  const log = [];
  for (let w = 0; w < 12; w++) {
    if (g.battle.status === 'won' || g.battle.status === 'lost') break;
    g.wave();
    // 补桃续召唤，模拟玩家运营
    g.grantPeach(300);
    g.buildDefense(2, 0);
    g.fastForward(40);
    log.push(g.snapshot());
  }
  return { final: g.snapshot(), waves: log.map((s) => ({ wave: s.wave, peach: s.peach, hp: s.tangsengHP, status: s.status })) };
});
await shot(page, '04-multiwave.png');
console.log('04 multi  :', JSON.stringify(progress.final));
console.log('   波次轨迹:', JSON.stringify(progress.waves));

// 5) 失败横幅：新开一局、不布阵、直接开波推进直到唐僧血尽
await page.evaluate(() => {
  const g = window.__game;
  g.restart(7);
  for (let w = 0; w < 4; w++) { g.wave(); g.fastForward(60); }
});
await shot(page, '05-lose.png');
console.log('05 lose   :', JSON.stringify(await snap(page)));

console.log('\n--- page logs ---\n' + (logs.join('\n') || '(none)'));
await browser.close();
