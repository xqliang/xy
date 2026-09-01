// 征兵后持续卡顿观测（用户报告：点征兵那一刻（丝带飞入）开始卡，持续一段时间后恢复）。
// 方法：CPU 6x 节流放大低端机信号；进战斗 intro 期由玩家征兵一次，随后 10s 逐帧记录
// {帧间隔, 帧内JS耗时} + battle 的 AI 侧状态（aiSummonCount/aiAutoPlacePlaying/aiUnits/aiMonsters），
// 按 0.5s 桶聚合看「征兵后哪一段帧时高、高的时候 AI 在干什么」。
// 对照组 MODE=endless（无尽模式无 AI 对手）——若 AI 联动是元凶，对照应无恶化段。
// 用法：node tools/perf-summon-jank.mjs            （普通对战，AI 联动嫌疑组）
//       MODE=endless node tools/perf-summon-jank.mjs（无尽，无 AI 对照组）
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.PERF_URL || 'http://127.0.0.1:5180/?seed=7';
const ENDLESS = process.env.MODE === 'endless';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
const client = await page.createCDPSession();
await client.send('Emulation.setCPUThrottlingRate', { rate: 6 }); // 6x≈低端机

await page.evaluateOnNewDocument(() => {
  try {
    const ids = ['battleIntro', 'firstSummon', 'firstPlacement', 'firstHeroWord', 'firstShovel',
      'firstActiveReady', 'firstHeroCombo', 'firstMergeable', 'firstFragmentDrop', 'merchantFirstOpen', 'wuxingMap'];
    const seen = {}; for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
    localStorage.setItem('dasheng.playedOnce', '1');
  } catch { /* 非 web 环境忽略 */ }
  window.__jank = { t0: 0, last: 0, rows: [] }; // rows: {at, gap, dur, aiS, aiPlay, aiU, aiM, u, tray}
  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => origRaf((t) => {
    const p = window.__jank;
    const gap = p.last > 0 && p.t0 > 0 ? t - p.last : 0;
    p.last = t;
    const s = performance.now();
    try { cb(t); } finally {
      if (p.t0 > 0 && gap > 0) {
        const b = window.__game?.battle;
        p.rows.push({
          at: +(t - p.t0).toFixed(0),
          gap: +gap.toFixed(1),
          dur: +(performance.now() - s).toFixed(1),
          aiS: b ? b.aiSummonCount : -1,
          aiPlay: b ? (b.aiAutoPlacePlaying ? 1 : 0) : -1,
          aiU: b ? b.aiUnits.size : -1,
          aiM: b ? b.aiMonsters.length : -1,
          u: b ? b.units.size : -1,
          tray: b ? b.tray.filter(Boolean).length : -1,
        });
      }
    }
  });
});
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 进战斗（endless 时无 AI 对手；intro 期无怪）
await page.evaluate((endless) => {
  const g = window.__game;
  g.restart(7, 1, undefined, endless); g.enterBattle();
}, ENDLESS);
await sleep(1000);

// t0 = 玩家征兵时刻，随后观测 10s
const summoned = await page.evaluate(() => {
  const g = window.__game;
  const ok = g.summon();
  window.__jank.t0 = performance.now();
  window.__jank.last = 0;
  window.__jank.rows = [];
  return { ok, tray: g.battle.tray.filter(Boolean).length, endless: g.battle.endless };
});
console.log(`模式: ${ENDLESS ? 'endless(无AI对照)' : '对战(AI联动嫌疑组)'}  征兵: ${JSON.stringify(summoned)}`);
await sleep(10000);

// 聚合输出：0.5s 桶 p50/p95 帧间隔 + 帧内JS耗时 + 状态快照（桶尾值）
const buckets = await page.evaluate(() => {
  const rows = window.__jank.rows;
  window.__jank.t0 = 0;
  const out = [];
  for (let b = 0; b < 20; b++) {
    const seg = rows.filter((r) => r.at >= b * 500 && r.at < (b + 1) * 500);
    if (!seg.length) continue;
    const gaps = seg.map((r) => r.gap).sort((a, z) => a - z);
    const durs = seg.map((r) => r.dur).sort((a, z) => a - z);
    const last = seg[seg.length - 1];
    out.push({
      t: `${(b * 0.5).toFixed(1)}s`,
      n: seg.length,
      gapP50: gaps[Math.floor(gaps.length * 0.5)] || 0,
      gapP95: gaps[Math.floor(gaps.length * 0.95)] || 0,
      durP50: durs[Math.floor(durs.length * 0.5)] || 0,
      durP95: durs[Math.floor(durs.length * 0.95)] || 0,
      maxGap: gaps[gaps.length - 1] || 0,
      aiS: last.aiS, aiPlay: last.aiPlay, aiU: last.aiU, aiM: last.aiM, u: last.u, tray: last.tray,
    });
  }
  return out;
});
console.log('  时间   | 帧数 | gapP50 | gapP95 | maxGap | durP50 | durP95 | ai征兵 ai回放 aiUnits ai怪 units tray');
for (const b of buckets) {
  console.log(`  ${b.t.padStart(5)} | ${String(b.n).padStart(4)} | ${String(b.gapP50).padStart(6)} | ${String(b.gapP95).padStart(6)} | ${String(b.maxGap).padStart(6)} | ${String(b.durP50).padStart(5)} | ${String(b.durP95).padStart(5)} |   ${b.aiS}     ${b.aiPlay}      ${b.aiU}     ${b.aiM}    ${b.u}   ${b.tray}`);
}
await browser.close();
