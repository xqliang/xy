// 流沙河水属性背景重画 + 五行锁定格底色柔化 浏览器冒烟。
// A. 流沙河：新背景（青蓝江水）加载成功且整体呈冷色调（蓝分量显著高于红），
//    旧版土黄沙岸图红>蓝，冷调断言可区分新旧。
// B. 锁定格柔化：黄风岭（土）与火焰山（火）各取一块未挖格中心采样，
//    期望值 = softenElementColor(el, cellLocked, 0.38) 再叠 rgba(28,20,10,0.2)。
// 前置：web/ 下 dev 服务 npx vite --port 5199 --strictPort。运行：node scripts/smoke-liushahe-soften.mjs
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const PORT = process.env.PORT || '5199';
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error('❌ 冒烟失败：' + msg); process.exitCode = 1; throw new Error(msg); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => { console.error('⚠️ 页面运行时异常：', e.message); errors.push(String(e)); process.exitCode = 1; });
  const bgReqs = [];
  page.on('response', (r) => { if (r.url().includes('map-liushahe')) bgReqs.push(r.status()); });

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game');

  // ── A：流沙河水属性背景 ──
  await page.evaluate(() => window.__game.restart(20260824, 1, 'liushahe', false));
  await page.evaluate(() => window.__game.enterBattle());
  await page.evaluate(() => window.__game.fastForward(7));
  await sleep(600); // 等背景图解码铺帧
  if (!bgReqs.some((s) => s === 200 || s === 206)) fail('流沙河背景图未加载（manifest 新哈希未生效？）：' + JSON.stringify(bgReqs));
  await page.screenshot({ path: '/tmp/liushahe-new-bg.png' });

  // 色彩断言直接对本地素材文件做（与 CDN 同内容哈希；游戏画布被格子大半覆盖且被跨域污染，
  // 全屏数色不稳）。期望：上半江水呈青蓝冷调（b>r 且 b≥140），下半沙滩呈中性浅色（|b-r| 小）。
  // 旧土黄版/黄风岭式暖棕图（r≫b）不满足。
  const statPage = await browser.newPage();
  const bgStat = await statPage.evaluate(async (dataUrl) => {
    const img = new Image();
    await new Promise((r, j) => { img.onload = r; img.onerror = () => j(new Error('fail')); img.src = dataUrl; });
    const W = img.naturalWidth, H = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const stat = (y0, y1) => {
      const d = ctx.getImageData(0, y0, W, y1 - y0).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    };
    return { top: stat(0, Math.floor(H / 2)), bottom: stat(Math.floor(H / 2), H) };
  }, 'data:image/jpeg;base64,' + readFileSync('src/game-assets/map-liushahe.jpg').toString('base64'));
  console.log('背景色彩统计：', JSON.stringify(bgStat), '（请求 ' + JSON.stringify(bgReqs) + '）');
  if (!(bgStat.top[2] > bgStat.top[0] && bgStat.top[2] >= 140)) {
    fail('背景上半不是青蓝江水（avg=' + JSON.stringify(bgStat.top) + '，生成不理想或仍旧图？）');
  }
  if (Math.abs(bgStat.bottom[2] - bgStat.bottom[0]) > 30) {
    fail('背景下半不是中性沙滩色（avg=' + JSON.stringify(bgStat.bottom) + '）');
  }
  console.log('✅ A 通过：流沙河新背景已加载——上半青蓝江水、下半浅色沙滩（截图 /tmp/liushahe-new-bg.png）');

  // ── B：锁定格柔化底色（黄风岭=土 / 火焰山=火）──
  // 期望值 = mix(ELEMENT_COLOR, cellLocked, 0.38) 后叠 rgba(28,20,10,0.2)：
  //   earth #a1743c × huangfengling #bda37a → (178,145,98) → 叠层 → (148,120,80)
  //   fire  #f4511e × huoyanshan   #bda284 → (210,131,93) → 叠层 → (174,109,76)
  // 采样方式：游戏画布被 CDN 立绘污染 → 截屏 PNG 塞进干净画布再取像素（与 smoke-wuxing 同法）
  const geo = await page.evaluate(async () => {
    const cv = document.querySelector('canvas');
    const r = cv.getBoundingClientRect();
    const m = await import('/src/render.ts');
    return { x: r.x, y: r.y, w: r.width, h: r.height, W: m.VIEW_W, H: m.VIEW_H, CELL: m.CELL, BOARD_X: m.BOARD_X, BOARD_Y: m.BOARD_Y };
  });
  const anaPage = await browser.newPage();
  const sample = async (fnSrc) => {
    const buf = await page.screenshot({ type: 'png' });
    return anaPage.evaluate(async (dataUrl, src) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('img load fail')); img.src = dataUrl; });
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const f = eval(src); // fnSrc 形如 (d,w,h)=>...：eval 得到函数后立即以图像数据调用
      return f(d, cv.width, cv.height);
    }, 'data:image/png;base64,' + Buffer.from(buf).toString('base64'), fnSrc);
  };
  const vRect = (vx, vy, vw, vh) => ({
    x: geo.x + vx * geo.w / geo.W, y: geo.y + vy * geo.h / geo.H,
    w: vw * geo.w / geo.W, h: vh * geo.h / geo.H,
  });
  const checkLocked = async (mapId, expected, label) => {
    await page.evaluate((m) => window.__game.restart(20260824, 1, m, false), mapId);
    await page.evaluate(() => window.__game.enterBattle());
    await page.evaluate(() => window.__game.fastForward(7));
    const cell = await page.evaluate(() => {
      const b = window.__game.battle;
      const locked = b.lockedCells();
      return locked.length ? locked[0] : null; // 取第一块未挖格采样
    });
    if (!cell) fail(label + '：没有未挖格可采样');
    // 格中心 view 坐标 → 页面坐标，采 5×5 窗均值（躲开细点纹理与内边阴影）
    const cx = geo.x + (geo.BOARD_X + (cell.c + 0.5) * geo.CELL) * geo.w / geo.W;
    const cy = geo.y + (geo.BOARD_Y + (cell.r + 0.5) * geo.CELL) * geo.h / geo.H;
    const win = { x: cx - 5, y: cy - 5, w: 10, h: 10 };
    const avg = await sample(`(d,w,h)=>{const c=${JSON.stringify(win)};let r=0,g=0,b=0,n=0;
      for(let y=Math.floor(c.y);y<c.y+c.h;y++)for(let x=Math.floor(c.x);x<c.x+c.w;x++){
        const i=(y*w+x)*4;r+=d[i];g+=d[i+1];b+=d[i+2];n++;}return [r/n,g/n,b/n].map(v=>Math.round(v));}`);
    const dev = avg.map((v, i) => Math.abs(v - expected[i]));
    console.log(label + '：格(' + cell.c + ',' + cell.r + ') 采样', JSON.stringify(avg), '期望', JSON.stringify(expected), '偏差', JSON.stringify(dev));
    if (dev[0] > 22 || dev[1] > 22 || dev[2] > 22) fail(label + '：锁定格颜色与柔化期望偏差过大');
    // 「确实柔化了」校验只对 fire 做：火原色 #f4511e 大面积平铺最突兀（r=244 vs 柔化 174，差异大）；
    // earth 原色本身柔和（与柔化色只差 ~26），无可区分度，跳过该校验只看期望色命中
    if (mapId === 'huoyanshan') {
      const raw = [244, 81, 30];
      const distRaw = Math.hypot(...avg.map((v, i) => v - raw[i]));
      if (distRaw < 60) fail(label + '：颜色仍接近纯五行原色（柔化未生效？）dist=' + distRaw.toFixed(0));
    }
  };
  await checkLocked('huangfengling', [148, 120, 80], '黄风岭锁定格（土·柔化）');
  await page.screenshot({ path: '/tmp/hfl-soft-locked.png' });
  await checkLocked('huoyanshan', [174, 109, 76], '火焰山锁定格（火·柔化）');
  await page.screenshot({ path: '/tmp/hys-soft-locked.png' });
  console.log('✅ B 通过：锁定格底色已柔化（五行色相仍可辨识、不再是大面积纯色块）');

  if (errors.length) fail('页面运行时异常共 ' + errors.length + ' 处');
  console.log('🎉 流沙河水属性背景 + 锁定格柔化冒烟全部通过');
} finally {
  await browser.close();
}
