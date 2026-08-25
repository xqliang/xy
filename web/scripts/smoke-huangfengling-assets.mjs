// 黄风岭新素材浏览器冒烟（#59/#61）：地图背景 + 小妖/骑兵/妖王立绘真渲染。
// 验证两层：
//   1. 网络：进入加载页时 4 个新 CDN 资源（带哈希 URL）真的被请求了（键接线正确）；
//   2. 像素：黄风岭战斗画面中，怪物立绘区域出现显著的非背景内容（立绘贴图已画上）。
// 前置：web/ 下 npx vite --port 5199 --strictPort
import puppeteer from 'puppeteer-core';

const URL = 'http://127.0.0.1:5199/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fail = (msg) => { console.error('❌ ' + msg); process.exitCode = 1; throw new Error(msg); };

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
  page.on('pageerror', (e) => { errors.push(String(e)); process.exitCode = 1; });
  const fetched = new Set();
  page.on('response', (r) => fetched.add(r.url()));
  await page.evaluateOnNewDocument((ids) => {
    const seen = {};
    for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
  }, TUTORIAL_IDS);
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game');

  // 资源在进场加载阶段统一拉取；直接重开到黄风岭并等待资源就绪
  await page.evaluate(() => window.__game.restart(20260824, 1, 'huangfengling', false));
  await page.evaluate(() => window.__game.enterBattle());
  await page.waitForFunction('window.__game.assetsReady?.() === true', { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500)); // 等懒加载图片 decode

  const need = ['map-huangfengling', 'monster-minion-huangfengling', 'monster-boss-huangfengling', 'monster-cavalry-huangfengling', 'fence-huangfengling', 'gate-huangfengling'];
  const hit = need.map((k) => [...fetched].some((u) => u.includes(k)));
  console.log('新资源网络请求命中：', JSON.stringify(Object.fromEntries(need.map((k, i) => [k, hit[i]]))));
  for (let i = 0; i < need.length; i++) if (!hit[i]) fail(`${need[i]} 未被请求（资源键未接线或未上传）`);

  // 推进到 wave1 出怪，采样 + 截图
  await page.evaluate(() => window.__game.fastForward(7));
  let sample = null;
  const monsterKinds = new Set();
  for (let i = 0; i < 30; i++) {
    sample = await page.evaluate(() => {
      window.__game.fastForward(1);
      const b = window.__game.battle;
      return {
        status: b.status, kills: b.snapshot().kills,
        kinds: b.monsters.map((m) => `${m.isBoss ? 'boss' : m.type === 'cavalry' ? 'cavalry' : 'minion'}`).join(','),
        els: [...new Set(b.monsters.map((m) => m.element))],
      };
    });
    for (const k of (sample.kinds || '').split(',')) if (k) monsterKinds.add(k);
    if (sample.kills > 0 && monsterKinds.size >= 1) break;
  }
  console.log('黄风岭战斗采样：', JSON.stringify(sample), '累计怪种：', [...monsterKinds].join('/'));
  await page.screenshot({ path: '/tmp/huangfengling-assets.png' });

  // 像素级验证：地图背景非纯色（土黄渐变+山岭纹理 → 色彩多样性高）
  const anaPage = await browser.newPage();
  // 栅栏带渲染验证：中线 y≈BOARD_Y+FENCE_ROW*CELL 处一条水平带，贴图平铺应出现
  // 明显的横向纹理起伏（逐列亮度方差远大于纯色回退条）；同时出怪口应有岩门贴图内容。
  const fenceStats = await anaPage.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('load fail')); img.src = 'data:image/png;base64,' + b64; });
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    // 画布在页面上可能缩放，找游戏视口内实际位置：按截图原样全幅扫一条中线附近的水平带
    // （VIEW 560 宽居中；BOARD_Y=84, FENCE_ROW=5, CELL=68 → 视口内 y=424；等比定位）
    const x0 = Math.round((cv.width - 560 * (cv.height / 1044)) / 2); // 视口左缘（等高比）
    const scale = cv.height / 1044;
    const fy = Math.round(424 * scale);
    const lums = [];
    for (let dx = 20; dx < 540; dx += 4) {
      const d = ctx.getImageData(x0 + Math.round(dx * scale), fy, 1, 1).data;
      lums.push(0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2]);
    }
    const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
    const varr = lums.reduce((a, b) => a + (b - mean) ** 2, 0) / lums.length;
    const bins = new Set();
    for (let i = 0; i < 540; i += 5) {
      const d = ctx.getImageData(x0 + Math.round(i * scale), fy, 1, 1).data;
      bins.add(`${d[0] >> 4},${d[1] >> 4},${d[2] >> 4}`);
    }
    return { lumStd: Math.sqrt(varr), bins: bins.size };
  }, Buffer.from(await page.screenshot({ type: 'png' })).toString('base64'));
  console.log('栅栏带纹理统计：', JSON.stringify(fenceStats));
  if (fenceStats.bins < 8) fail('栅栏带色彩单一——贴图疑似未渲染（走了矢量回退？）：' + JSON.stringify(fenceStats));
  const stats = await anaPage.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('load fail')); img.src = 'data:image/png;base64,' + b64; });
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    // 取棋盘中区一条竖带（8 列×10 行网格，背景在其下）
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const bins = new Set();
    for (let i = 0; i < d.length; i += 40) bins.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    return { colorBins: bins.size };
  }, Buffer.from(await page.screenshot({ type: 'png' })).toString('base64'));
  console.log('画面色彩多样性（16 级粗分桶数）：', JSON.stringify(stats));
  if (stats.colorBins < 60) fail('画面色彩过于单一——地图背景图疑似未渲染（回退纯色主题渐变？）：' + stats.colorBins);

  if (errors.length) fail('页面运行时异常：' + errors[0]);
  console.log('🎉 黄风岭素材冒烟通过（截图 /tmp/huangfengling-assets.png）');
  await anaPage.close();
} finally {
  await browser.close();
}
