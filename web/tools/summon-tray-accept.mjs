/**
 * Task 4 acceptance: summon tray rules via window.__game + puppeteer-core.
 * Checklist items 1–5; pointerup board-first verified separately by code review.
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.ACCEPT_URL || 'http://127.0.0.1:5180/?seed=7';

const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(e.message));

try {
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction('window.__game && window.__game.snapshot', { timeout: 15000 });

  // —— 1. Leftover tray cleared on re-summon —— //
  const clearResult = await page.evaluate(() => {
    const g = window.__game;
    g.restart(42);
    g.enterBattle();
    g.grantPeach(1000);
    g.summon();
    const afterFirst = g.battle.tray.length;
    // Simulate leftover history tokens
    g.battle.tray.push({ kind: 'shovel' }, { kind: 'shovel' });
    const beforeSecond = g.battle.tray.length;
    g.summon();
    const afterSecond = g.battle.tray.map((t) => ({ ...t }));
    return { afterFirst, beforeSecond, afterSecondLen: afterSecond.length, afterSecond };
  });
  check(
    '1. Leftover tray cleared on re-summon (exactly 5 new tokens)',
    clearResult.afterFirst === 5 &&
      clearResult.beforeSecond === 7 &&
      clearResult.afterSecondLen === 5,
    `first=${clearResult.afterFirst} stuffed=${clearResult.beforeSecond} second=${clearResult.afterSecondLen}`,
  );

  // —— 2. First summon ≥4 units —— //
  const firstUnits = await page.evaluate(() => {
    const g = window.__game;
    const out = [];
    for (let seed = 1; seed <= 50; seed++) {
      g.restart(seed);
      g.enterBattle();
      g.grantPeach(100);
      g.summon();
      out.push(g.battle.tray.filter((t) => t.kind === 'unit').length);
    }
    return out;
  });
  const minUnits = Math.min(...firstUnits);
  check(
    '2. First summon ≥4 units (50 seeds)',
    firstUnits.every((n) => n >= 4),
    `min=${minUnits}`,
  );

  // —— 3. Multi-summon: no key count >3 —— //
  const maxKey = await page.evaluate(() => {
    const g = window.__game;
    g.restart(99);
    g.enterBattle();
    g.grantPeach(5000);
    let worst = 0;
    for (let i = 0; i < 20; i++) {
      g.summon();
      const m = new Map();
      for (const t of g.battle.tray) {
        const k = t.kind === 'shovel' ? 'shovel' : `unit:${t.type}`;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      for (const n of m.values()) worst = Math.max(worst, n);
    }
    return worst;
  });
  check('3. Multi-summon: no key count >3 in tray', maxKey <= 3, `maxKey=${maxKey}`);

  // —— 4. placeFromTray swap different types —— //
  const swap = await page.evaluate(() => {
    const g = window.__game;
    g.restart(1);
    g.enterBattle();
    const cell = g.battle.unlockedCells()[0];
    g.battle.units.set(`${cell.c},${cell.r}`, {
      type: 'monkey',
      tier: 1,
      cell: { c: cell.c, r: cell.r },
      cooldown: 0,
      firePulse: 0,
      combo: 0,
      stunT: 0,
      slowT: 0,
      weakenT: 0,
      rangeCutT: 0,
      knockdownT: 0,
    });
    g.battle.tray = [{ kind: 'unit', type: 'spear', tier: 1 }];
    const ok = g.placeFromTray(0, cell);
    const onBoard = g.battle.units.get(`${cell.c},${cell.r}`);
    const inTray = g.battle.tray[0];
    return {
      ok,
      boardType: onBoard?.type,
      trayType: inTray?.type,
      trayTier: inTray?.tier,
    };
  });
  check(
    '4. placeFromTray swap different types',
    swap.ok && swap.boardType === 'spear' && swap.trayType === 'monkey',
    JSON.stringify(swap),
  );

  // —— 5. placeFromTray merge same type/tier —— //
  const merge = await page.evaluate(() => {
    const g = window.__game;
    g.restart(1);
    g.enterBattle();
    const cell = g.battle.unlockedCells()[0];
    g.battle.units.set(`${cell.c},${cell.r}`, {
      type: 'monkey',
      tier: 1,
      cell: { c: cell.c, r: cell.r },
      cooldown: 0,
      firePulse: 0,
      combo: 0,
      stunT: 0,
      slowT: 0,
      weakenT: 0,
      rangeCutT: 0,
      knockdownT: 0,
    });
    g.battle.tray = [{ kind: 'unit', type: 'monkey', tier: 1 }];
    const ok = g.placeFromTray(0, cell);
    const onBoard = g.battle.units.get(`${cell.c},${cell.r}`);
    return {
      ok,
      tier: onBoard?.tier,
      trayLen: g.battle.tray.length,
    };
  });
  check(
    '5. placeFromTray merge same type/tier',
    merge.ok && merge.tier === 2 && merge.trayLen === 0,
    JSON.stringify(merge),
  );

  check('page errors', logs.length === 0, logs.join('; ') || '(none)');
} catch (err) {
  check('puppeteer run', false, String(err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log('---');
console.log(`SUMMARY: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
