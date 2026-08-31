// 武将热路径微基准：验证 G（updateGenerals 每帧目标选取的池化复用）。
// 直接 words.set 摆 3 组激活武将（绕过征兵随机性），逐波推进保持场面活跃，
// 测 GC 频率（堆锯齿）与每帧 JS 耗时。用法：PERF_URL=... node tools/perf-generals.mjs
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.PERF_URL || 'http://127.0.0.1:5180/?seed=7';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--enable-precise-memory-info'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const client = await page.createCDPSession();
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

await page.evaluateOnNewDocument(() => {
  // 教程全已见（否则 battleIntro modal 冻结仿真）
  try {
    const ids = ['battleIntro','firstSummon','firstPlacement','firstHeroWord','firstShovel','firstActiveReady','firstHeroCombo','firstMergeable','firstFragmentDrop','merchantFirstOpen','wuxingMap'];
    const seen = {}; for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
    localStorage.setItem('dasheng.finishedGame', '1');
  } catch {}
  window.__prof = { durs: [], heap: [], t0: 0 };
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => orig((t) => {
    const s = performance.now();
    try { cb(t); } finally { if (window.__prof.t0 > 0) window.__prof.durs.push(performance.now() - s); }
  });
  setInterval(() => {
    if (performance.memory && window.__prof.t0 > 0) window.__prof.heap.push(performance.memory.usedJSHeapSize);
  }, 200);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// 布阵：3 组二郎字牌（words.set 直摆，同 tests/general-combat-tier.test.ts 的做法）+ 开波
const setup = () => page.evaluate(() => {
  const g = window.__game;
  g.markNotFirstGame();
  g.restart(7, 1); g.enterBattle();
  const b = g.battle;
  const cells = b.unlockedCells();
  const row0 = cells.filter((c) => c.r === cells[0].r).sort((a, c) => a.c - c.c);
  const a1 = row0[0], r1 = row0.find((c) => c.c === a1.c + 1);
  b.unlocked.add(`${r1.c},${r1.r}`);
  // 第二行（可能未解锁，直接 add）
  const r2c = a1.r + 1, a2 = { c: a1.c, r: r2c }, r2 = { c: a1.c + 1, r: r2c };
  b.unlocked.add(`${a2.c},${a2.r}`); b.unlocked.add(`${r2.c},${r2.r}`);
  const r3c = a1.r + 2, a3 = { c: a1.c, r: r3c }, r3 = { c: a1.c + 1, r: r3c };
  b.unlocked.add(`${a3.c},${a3.r}`); b.unlocked.add(`${r3.c},${r3.r}`);
  const put = (l, r) => {
    b.words.set(`${l.c},${l.r}`, { char: '二', general: 'erlang', tier: 3, cell: l });
    b.words.set(`${r.c},${r.r}`, { char: '郎', general: 'erlang', tier: 3, cell: r });
  };
  put(a1, r1); put(a2, r2); put(a3, r3); const r4c = a1.r + 3, a4 = { c: a1.c, r: r4c }, r4 = { c: a1.c + 1, r: r4c }; b.unlocked.add(`${a4.c},${a4.r}`); b.unlocked.add(`${r4.c},${r4.r}`); put(a4, r4); const r5c = a1.r + 4, a5 = { c: a1.c, r: r5c }, r5 = { c: a1.c + 1, r: r5c }; b.unlocked.add(`${a5.c},${a5.r}`); b.unlocked.add(`${r5.c},${r5.r}`); put(a5, r5);
  if (b.status === 'ready') g.wave();
  return { generals: b.activeGenerals().length, unlocked: b.unlocked.size };
});
console.log('setup:', JSON.stringify(await setup()));
await sleep(2000);

// 20s 测量窗：每 2s 检查，波清空就开下一波（保持怪物持续出、武将持续索敌）
await page.evaluate(() => { window.__prof.durs = []; window.__prof.heap = []; window.__prof.t0 = performance.now(); });
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  await sleep(2000);
  await page.evaluate(() => {
    const b = window.__game.battle;
    if (b.status === 'ready') window.__game.wave();
  }).catch(() => {});
}
console.log(JSON.stringify(await page.evaluate(() => {
  const p = window.__prof;
  p.t0 = 0;
  const q = (a, x) => a[Math.min(a.length - 1, Math.floor(a.length * x))];
  const sorted = [...p.durs].sort((a, b) => a - b);
  const heapMB = p.heap.map((x) => x / 1048576);
  const gcDrops = [];
  for (let i = 1; i < heapMB.length; i++) if (heapMB[i - 1] - heapMB[i] > 0.5) gcDrops.push(heapMB[i - 1] - heapMB[i]);
  const b = window.__game.battle;
  return {
    frameJs: sorted.length ? `n=${sorted.length} p50=${q(sorted,.5).toFixed(2)} p90=${q(sorted,.9).toFixed(2)} p99=${q(sorted,.99).toFixed(2)} max=${Math.max(...sorted).toFixed(1)}` : 'n=0',
    gc: `drops=${gcDrops.length} in 60s (${(gcDrops.length / 60).toFixed(1)}/s), heap ${Math.min(...heapMB).toFixed(1)}→${Math.max(...heapMB).toFixed(1)}MB`,
    state: { generals: b.activeGenerals().length, monsters: b.monsters.length, wave: b.wave, status: b.status },
  };
}), null, 1));
await browser.close();
