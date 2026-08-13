import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://127.0.0.1:5180/?seed=5';
const OUT = '/tmp/xy-verify';
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console.error] ' + m.text()); });
page.on('requestfailed', (r) => errors.push('[requestfailed] ' + r.url() + ' ' + (r.failure()?.errorText || '')));
page.on('response', (r) => { if (r.status() >= 400) errors.push('[http ' + r.status() + '] ' + r.url()); });

// 延迟 CDN 图片响应，让加载页停留可截图；并 mock 排行榜接口以验证「未上榜」底部卡片。
await page.setRequestInterception(true);
const mockDaily = {
  day: '2026-08-13',
  entries: Array.from({ length: 15 }, (_, i) => ({
    uid: 'p' + i, name: '取经人' + (i + 1), rankLevel: 60 - i * 3, avatarId: 'wukong',
  })),
  me: { uid: 'ME_UID_NOT_IN_LIST', name: '贫僧我', rankLevel: 7, avatarId: 'tangseng', place: undefined },
};
page.on('request', (req) => {
  const u = req.url();
  if (u.includes('/api/leaderboard/daily')) {
    req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(mockDaily) }).catch(() => {});
  } else if (/tos-cn-shanghai\.volces\.com\/dev\/xy\/.+\.(png|jpg)/.test(u) && !u.includes('loading-tangseng')) {
    setTimeout(() => req.continue().catch(() => {}), 300);
  } else {
    req.continue().catch(() => {});
  }
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
// 等加载 UI 出现并让唐僧图先到位
await new Promise((r) => setTimeout(r, 1400));
await page.screenshot({ path: OUT + '/1-loading.png' });
const loadingHasMonk = await page.evaluate(() => window.__assetsReady === true || !!(window.__game));
console.log('LOADING screenshot done; assetsReadyOrHook=', loadingHasMonk);

// 等资源全部就绪并真正进入首页（screen==='menu'），否则 boot 的 screen='menu' 会覆盖后续切屏
await page.waitForFunction('window.__game && window.__game.snapshot', { timeout: 20000 });
await page.waitForFunction("window.__game.curScreen && window.__game.curScreen()==='menu'", { timeout: 20000 });

// —— 排行榜（真实 openRank；mock 数据 15 名不含我 → 底部应出现「未上榜」卡片）——
await page.evaluate(() => window.__game.openRank());
await page.waitForFunction("window.__game.curScreen()==='rank'", { timeout: 8000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: OUT + '/2-leaderboard.png' });
console.log('LEADERBOARD screen=', await page.evaluate(() => window.__game.curScreen()));

// —— 武将技能弹窗（验证长描述换行不溢出）——
// 布阵自动排布被并行改动破坏，改为手动 placeFromTray 落一张「字牌」再选中它，
// 面板对未激活武将也会画技能名+描述（灰显），足以验证换行绘制不溢出/不崩。
const gen = await page.evaluate(() => {
  const g = window.__game;
  g.restart(5, 1);
  g.enterBattle();
  const b = g.battle;
  // 直接往 tray 注入一张「文殊」字牌（其技能描述最长、正是用户报告溢出的用例），确定性验证换行。
  b.tray.push({ kind: 'word', char: '文', general: 'wenshu', tier: 1 });
  const wordIdx = b.tray.findIndex((t) => t && t.kind === 'word' && t.general === 'wenshu');
  if (wordIdx < 0) return { err: 'inject failed' };
  const tok = b.tray[wordIdx];
  for (let c = 0; c < 8; c++) {
    for (let r = 0; r < 10; r++) {
      if (g.placeFromTray(wordIdx, { c, r })) {
        g.select({ c, r });
        return { placed: { c, r }, char: tok.char, general: tok.general };
      }
    }
  }
  return { err: 'no placeable cell', char: tok.char, general: tok.general };
});
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: OUT + '/3-general-popup.png' });
console.log('POPUP diag=', JSON.stringify(gen));

console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : '(none)');
await browser.close();
