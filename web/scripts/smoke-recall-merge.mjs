// 棋盘→候选区同型同级合并（浏览器冒烟）：模拟真实 pointer 拖拽
//   A. 棋盘 dao·2阶 拖到 tray[0]（dao·2阶）→ 合并成 3 阶、棋盘清空、message 提示
//   B. 拖拽过程中 tray 合并目标槽有淡黄高亮（截图人工复核）
//   C. 棋盘 dao·2阶 拖到 tray[0]（spear·1阶）→ 仍走交换
// 前置：worktree 的 web/ 下起 dev 服务：npx vite --port 5199 --strictPort
// 运行：node scripts/smoke-recall-merge.mjs（可 PORT / CHROME_PATH 覆盖）
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT || '5199';
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error('❌ 冒烟失败：' + msg); process.exitCode = 1; throw new Error(msg); };

const TUTORIAL_IDS = ['spawnGate', 'tangseng', 'aiOpponent', 'pause', 'peach', 'goSummon', 'battleIntro',
  'firstSummon', 'unitTypes', 'dragToBoard', 'autoplace', 'firstPlacement', 'attackRange', 'firstHeroWord',
  'heroWord', 'firstShovel', 'shovelUse', 'shovelWhere', 'firstActiveReady', 'activeReady', 'firstHeroCombo',
  'heroCombo', 'firstMergeable', 'mergeUpgrade', 'firstFragmentDrop', 'fragmentInfo', 'weaponUpgrade',
  'merchantFirstOpen', 'activeSkill', 'passiveSkill', 'lowStamina', 'staminaPlus'];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => { console.error('⚠️ 页面运行时异常：', e.message); errors.push(String(e)); process.exitCode = 1; });
  await page.evaluateOnNewDocument((ids) => {
    const seen = {};
    for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
  }, TUTORIAL_IDS);
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game');
  await page.evaluate(() => { window.__game.restart(20260824, 1, 'pansidong', false); window.__game.enterBattle(); });
  await page.waitForFunction('window.__game.assetsReady?.() === true', { timeout: 20000 }).catch(() => {});
  await sleep(600);

  // 棋盘放 dao·2阶；tray[0] 放 dao·2阶（合并目标）、tray[1] 放 spear·1阶（交换对照）
  await page.evaluate(() => {
    const b = window.__game.battle;
    const cell = b.unlockedCells()[0];
    b.units.set(`${cell.c},${cell.r}`, {
      type: 'dao', tier: 2, cell, cooldown: 0, firePulse: 0, combo: 0,
      stunT: 0, slowT: 0, weakenT: 0, rangeCutT: 0, knockdownT: 0,
      stunImmuneT: 0, slowImmuneT: 0, weakenImmuneT: 0, rangeCutImmuneT: 0, knockdownImmuneT: 0,
    });
    b.tray = [
      { kind: 'unit', type: 'dao', tier: 2 },
      { kind: 'unit', type: 'spear', tier: 1 },
    ];
    return { cell: `${cell.c},${cell.r}` };
  }).then((r) => console.log('布景：棋盘', r.cell, '= dao·2；tray[0]=dao·2, tray[1]=spear·1'));

  // view 坐标 → 页面 CSS 坐标（canvas letterbox 等比缩放）
  const toPage = (vx, vy) => page.evaluate(async (x, y) => {
    const r = await import('/src/render.ts');
    const rect = document.querySelector('canvas').getBoundingClientRect();
    const s = Math.min(rect.width / r.VIEW_W, rect.height / r.VIEW_H);
    const ox = rect.left + (rect.width - r.VIEW_W * s) / 2;
    const oy = rect.top + (rect.height - r.VIEW_H * s) / 2;
    return { x: ox + x * s, y: oy + y * s };
  }, vx, vy);

  // 棋盘源格中心与 tray 槽中心（view 坐标，常量从渲染模块取）
  const pts = await page.evaluate(async () => {
    const r = await import('/src/render.ts');
    const b = window.__game.battle;
    const cell = b.unlockedCells()[0];
    const cellCx = r.BOARD_X + (cell.c + 0.5) * r.CELL;
    const cellCy = r.BOARD_Y + (cell.r + 0.5) * r.CELL;
    const tray0 = { x: r.TRAY_LEFT + 0 * r.TRAY_SLOT + r.TRAY_SLOT / 2, y: r.TRAY_Y + r.TRAY_H / 2 };
    const tray1 = { x: r.TRAY_LEFT + 1 * r.TRAY_SLOT + r.TRAY_SLOT / 2, y: r.TRAY_Y + r.TRAY_H / 2 };
    return { cell: { x: cellCx, y: cellCy }, tray0, tray1 };
  });
  console.log('坐标：', JSON.stringify(pts));

  // ── A：拖棋盘 dao·2 → tray[0]（dao·2）应合并 ──
  const from = await toPage(pts.cell.x, pts.cell.y);
  const mid = await toPage((pts.cell.x + pts.tray0.x) / 2, (pts.cell.y + pts.tray0.y) / 2);
  const to = await toPage(pts.tray0.x, pts.tray0.y);
  await page.bringToFront();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await sleep(120);
  await page.mouse.move(mid.x, mid.y, { steps: 8 });
  await sleep(80);
  // B：拖拽途中截图（合并目标槽应有淡黄高亮）
  await page.screenshot({ path: '/tmp/recall-merge-hint.png' });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await sleep(80);
  await page.mouse.up();
  await sleep(300);
  const resA = await page.evaluate(() => {
    const b = window.__game.battle;
    return {
      tray0: b.tray[0], tray1: b.tray[1],
      boardUnits: [...b.units.keys()],
      message: b.message,
    };
  });
  console.log('A 合并结果：', JSON.stringify(resA));
  if (resA.tray0?.kind !== 'unit' || resA.tray0.tier !== 3) fail('tray[0] 应合并为 dao·3');
  if (resA.boardUnits.length !== 0) fail('棋盘源格应清空，实际 ' + JSON.stringify(resA.boardUnits));
  if (!String(resA.message).includes('3 阶')) fail('应有合成提示，实际：' + resA.message);

  // ── C：重摆 dao·2 拖到 spear·1 槽应交换 ──
  await page.evaluate(() => {
    const b = window.__game.battle;
    const cell = b.unlockedCells()[0];
    b.units.set(`${cell.c},${cell.r}`, {
      type: 'dao', tier: 2, cell, cooldown: 0, firePulse: 0, combo: 0,
      stunT: 0, slowT: 0, weakenT: 0, rangeCutT: 0, knockdownT: 0,
      stunImmuneT: 0, slowImmuneT: 0, weakenImmuneT: 0, rangeCutImmuneT: 0, knockdownImmuneT: 0,
    });
  });
  const to1 = await toPage(pts.tray1.x, pts.tray1.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await sleep(120);
  await page.mouse.move(to1.x, to1.y, { steps: 10 });
  await sleep(80);
  await page.mouse.up();
  await sleep(300);
  const resC = await page.evaluate(() => {
    const b = window.__game.battle;
    return { tray1: b.tray[1], boardUnits: [...b.units.entries()].map(([k, u]) => `${k}:${u.type}${u.tier}`), message: b.message };
  });
  console.log('C 交换结果：', JSON.stringify(resC));
  if (resC.tray1?.kind !== 'unit' || resC.tray1.type !== 'dao' || resC.tray1.tier !== 2) fail('异型应交换：tray[1] 应为 dao·2');
  if (!resC.boardUnits.some((s) => s.endsWith('spear1'))) fail('棋盘应落 spear·1，实际 ' + JSON.stringify(resC.boardUnits));

  if (errors.length) fail('存在页面运行时异常');
  console.log('✅ 冒烟通过：同型同级拖回合并升阶、异型仍交换；拖拽提示截图见 /tmp/recall-merge-hint.png');
} finally {
  await browser.close();
}
