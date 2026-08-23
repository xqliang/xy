// tools/tongxin-smoke.mjs —— 同心咒跨侧修复的运行时冒烟（隔离渲染，无需真服务器）。
// 复刻在线 PvP 的真实数据流：对手 Battle（权威 sim，装备 tongxin）→ pvpOwnSnapshot 生成快照
// → 我方 Battle.ingestOppSnapshot + bridgeOpponentFromSnap（多帧，模拟每帧桥接）。
// 断言：
//   1) 我方 tangsengMaxHP/HP 各 +2（+2 落到我方权威 sim，随本方快照回流给对手显示）；
//   2) 多帧重复桥接不叠加（去重只加一次）；
//   3) 无 tongxin 的对手不给我加血；
//   4) 整个过程无未捕获异常（真实渲染循环同路径）。
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') logs.push('[console.error] ' + m.text()); });
await page.goto('http://127.0.0.1:5180/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');

const res = await page.evaluate(async () => {
  const { Battle, NO_META } = await import('/src/battle.ts');
  const { MAPS } = await import('/src/board.ts');
  const { PvpOppView } = await import('/src/pvp-snap.ts');
  const mk = (passives) =>
    new Battle(1, 1, MAPS[0], NO_META, {}, [], passives, false, undefined, 1, undefined, { enabled: true });

  // 对手（权威 sim）：装备同心咒 → 快照 pickedItems 含 'tongxin'
  const opp = mk(['tongxin']);
  const snap = opp.pvpOwnSnapshot();
  const hasTongxin = snap.pickedItems.includes('tongxin');

  // 我方：初始 3/3，收对手快照 → 桥接多帧（真实节奏：每帧 bridge，快照 100ms 一换）
  const me = mk([]);
  const base = { hp: me.tangsengHP, max: me.tangsengMaxHP };
  const view = new PvpOppView();
  view.ingest(snap);
  for (let t = 0; t <= 1000; t += 16) me.bridgeOpponentFromSnap(view.interpAt(0)); // 多帧重复桥接
  const after = { hp: me.tangsengHP, max: me.tangsengMaxHP };

  // 对照：无 tongxin 对手 → 不加血
  const plainOpp = mk([]);
  const me2 = mk([]);
  const view2 = new PvpOppView();
  view2.ingest(plainOpp.pvpOwnSnapshot(0));
  me2.bridgeOpponentFromSnap(view2.interpAt(0));
  const noBonus = me2.tangsengHP === base.hp && me2.tangsengMaxHP === base.max;

  return { hasTongxin, base, after, noBonus };
});
console.log('result:', JSON.stringify(res, null, 2));
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
