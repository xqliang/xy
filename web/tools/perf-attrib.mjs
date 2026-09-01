// Canvas API 热点归因：对 ctx.save / createRadialGradient 等打调用栈采样（每 N 次抽 1 次），
// 按发起函数聚合出 Top-N——定位「每帧 249 save / 157 径向渐变」到底是谁画的。
// 用法：node tools/perf-attrib.mjs（需 dev server 5180 或 PERF_URL）
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.PERF_URL || 'http://127.0.0.1:5180/?seed=7';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

await page.evaluateOnNewDocument(() => {
  try {
    const ids = ['battleIntro', 'firstSummon', 'firstPlacement', 'firstHeroWord', 'firstShovel',
      'firstActiveReady', 'firstHeroCombo', 'firstMergeable', 'firstFragmentDrop', 'merchantFirstOpen', 'wuxingMap'];
    const seen = {}; for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
    localStorage.setItem('dasheng.playedOnce', '1');
  } catch { /* 非 web 环境忽略 */ }
  window.__attr = { t0: 0, samples: {} }; // samples[apiName][fnKey] = 次数
});
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// 打点：包装目标 API，每 8 次调用采 1 次调用栈（采样开销可控，统计等比放大）
await page.evaluate(() => {
  const proto = CanvasRenderingContext2D.prototype;
  const c = window.__attr;
  const SAMPLE_EVERY = 8;
  const wrap = (name, orig) => {
    let n = 0;
    proto[name] = function (...a) {
      if (c.t0 > 0) {
        n++;
        if (n % SAMPLE_EVERY === 0) {
          // 取调用栈里第一个 src 文件内的函数（跳过 wrap 自身）
          const stack = new Error().stack || '';
          const lines = stack.split('\n').slice(2, 12).join('\n');
          c.samples[name] = c.samples[name] || {};
          c.samples[name][lines] = (c.samples[name][lines] || 0) + 1;
        }
      }
      return orig.apply(this, a);
    };
  };
  wrap('save', proto.save);
  wrap('createRadialGradient', proto.createRadialGradient);
  wrap('fillText', proto.fillText);
  wrap('strokeText', proto.strokeText);
  wrap('drawImage', proto.drawImage);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 场景1：空场基线（intro·无怪·tray 空）——归因 249 个 save
await page.evaluate(() => { const g = window.__game; g.restart(7, 1); g.enterBattle(); });
await sleep(800);
await page.evaluate(() => { window.__attr.t0 = performance.now(); window.__attr.samples = {}; });
await sleep(3000);
console.log('=== 场景1 空场基线（intro·无怪·tray 空）===');
console.log(await page.evaluate(() => {
  const c = window.__attr; c.t0 = 0;
  return Object.entries(c.samples).map(([api, byStack]) => {
    const total = Object.values(byStack).reduce((s, v) => s + v, 0);
    const top = Object.entries(byStack).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([stack, n]) => {
        // 栈里挑出含 src 文件名的帧，压缩成「函数@文件:行」
        const frames = stack.split('\n').map((l) => (l.match(/at (\S+) \((.*?:\d+:\d+)\)/) || l.match(/at (.*?:\d+:\d+)/) || [])[0])
          .filter((l) => l && /[a-z]+\.ts|render|main|battle/.test(l)).slice(0, 2).join(' <- ');
        return `      ${(n * 8).toFixed(0)}次/帧~ ${(100 * n / total).toFixed(0)}%  ${frames}`;
      });
    return `${api}: 采样总数×8≈${(total * 8 / 180).toFixed(0)}/帧\n${top.join('\n')}`;
  }).join('\n');
}));

// 场景2：战斗中——归因 157 个径向渐变
await page.evaluate(() => {
  const g = window.__game;
  for (let k = 0; k < 10; k++) { g.summon(); g.autoPlace(); }
  if (g.battle.status === 'ready') g.wave();
});
await sleep(2500);
await page.evaluate(() => { window.__attr.t0 = performance.now(); window.__attr.samples = {}; });
await sleep(3000);
console.log('\n=== 场景2 战斗中（有怪·tray 空）===');
console.log(await page.evaluate(() => {
  const c = window.__attr; c.t0 = 0;
  return Object.entries(c.samples).map(([api, byStack]) => {
    const total = Object.values(byStack).reduce((s, v) => s + v, 0);
    const top = Object.entries(byStack).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([stack, n]) => {
        const frames = stack.split('\n').map((l) => (l.match(/at (\S+) \((.*?:\d+:\d+)\)/) || l.match(/at (.*?:\d+:\d+)/) || [])[0])
          .filter((l) => l && /[a-z]+\.ts|render|main|battle/.test(l)).slice(0, 2).join(' <- ');
        return `      ${(n * 8).toFixed(0)}次/帧~ ${(100 * n / total).toFixed(0)}%  ${frames}`;
      });
    return `${api}: 采样总数×8≈${(total * 8 / 180).toFixed(0)}/帧\n${top.join('\n')}`;
  }).join('\n');
}));

await browser.close();
