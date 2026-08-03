import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:5180/?seed=3', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
const r = await page.evaluate(() => {
  const g = window.__game; g.restart(3); g.enterBattle();
  const b = g.battle;
  const cells = b.unlockedCells();
  for (const c of cells) b.units.set(`${c.c},${c.r}`, { type:'monkey', tier:1, cell:c, cooldown:0, firePulse:0, stunT:0, slowT:0, weakenT:0 });
  g.wave();
  let hitObserved = 0;
  for (let i=0;i<600;i++){ g.step(1/30); for(const m of b.monsters){ if(m.hitFlash>0){hitObserved++; break;} } if(hitObserved>0) break; }
  return { hitObserved, monkeys: [...b.units.values()].filter(u=>u.type==='monkey').length };
});
console.log('monkey test:', JSON.stringify(r));
console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
