// 帮助弹窗随 dev 开关过滤条目（浏览器冒烟）：
//   A. 默认（布阵按钮关、五行开）→ visibleHelpBlocks 不含「布阵」条目、含「五行相克」整节
//   B. 布阵按钮开 + 五行关（localStorage 预置后刷新）→ 含「布阵」条目、不含「五行相克」节
//   C. 点开首页「操作说明」弹窗正常渲染（无 pageerror，截图供人工复核）
// 前置：worktree 的 web/ 下起 dev 服务：npx vite --port 5199 --strictPort
// 运行：node scripts/smoke-help-flags.mjs（可 PORT / CHROME_PATH 覆盖）
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

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

  // 页面内探针：动态 import menu-help，取过滤后条目与排版高度（Vite dev 支持浏览器侧 import 源码模块）
  const probe = () => page.evaluate(async () => {
    const m = await import('/src/menu-help.ts');
    const blocks = m.visibleHelpBlocks();
    const cv = document.createElement('canvas').getContext('2d');
    return {
      hasAutoplace: blocks.some((b) => b.kind === 'body' && b.text.includes('「布阵」')),
      hasWuxing: blocks.filter((b) => b.kind === 'title').map((t) => t.text).includes('五行相克'),
      height: Math.round(m.helpContentHeight(cv)),
    };
  });

  // ── A：默认配置（布阵按钮关、五行开） ──
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game');
  const def = await probe();
  console.log('A 默认：', JSON.stringify(def));
  if (def.hasAutoplace) fail('默认（布阵按钮关）不应出现「布阵」条目');
  if (!def.hasWuxing) fail('默认（五行开）应保留「五行相克」一节');

  // ── B：布阵开 + 五行关（预置 localStorage 后整页刷新，避免 dev-flags 模块级缓存读到旧值） ──
  await page.evaluate(() => {
    localStorage.setItem('dasheng.dev.showAutoplaceBtn', '1');
    localStorage.setItem('dasheng.dev.wuxing', '0');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game');
  const flipped = await probe();
  console.log('B 布阵开+五行关：', JSON.stringify(flipped));
  if (!flipped.hasAutoplace) fail('布阵按钮开后应出现「布阵」条目');
  if (flipped.hasWuxing) fail('五行关闭后「五行相克」一节应隐藏');

  // ── C：点开首页「操作说明」弹窗（侧边第 3 个方钮：view 坐标 x16..112 / y331..427） ──
  // view 坐标 → 页面 CSS 坐标：web 端 canvas letterbox 等比缩放居中，从渲染模块取真实 VIEW_W/H 反算
  await page.bringToFront();
  const pt = await page.evaluate(async () => {
    const r = await import('/src/render.ts');
    const rect = document.querySelector('canvas').getBoundingClientRect();
    const s = Math.min(rect.width / r.VIEW_W, rect.height / r.VIEW_H);
    const ox = rect.left + (rect.width - r.VIEW_W * s) / 2;
    const oy = rect.top + (rect.height - r.VIEW_H * s) / 2;
    return { x: ox + (16 + 48) * s, y: oy + (331 + 48) * s };
  });
  await page.mouse.click(pt.x, pt.y);
  await sleep(700); // 等 menuHelpLazy.ensure 异步加载 + 首帧绘制
  await page.screenshot({ path: '/tmp/help-flipped.png' });

  // 像素复核：弹窗为 440×640 水墨卷轴居中——弹窗中央行应有远多于纯背景的文字像素（暗色笔画）
  const darkPx = await page.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = 1280; cv.height = 800;
    const c2 = cv.getContext('2d');
    c2.drawImage(document.querySelector('canvas'), 0, 0, 1280, 800);
    try {
      const d = c2.getImageData(0, 0, 1280, 800).data;
      let n = 0;
      for (let y = 300; y < 500; y += 2) {
        for (let x = 420; x < 860; x += 2) {
          const i = (1280 * y + x) << 2;
          if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) n++; // 文字笔画（近黑）
        }
      }
      return n;
    } catch {
      return -1; // 画布被跨域污染时降级为人工复核截图
    }
  });
  console.log('C 弹窗中央暗色文字像素：', darkPx, '（-1=画布污染，需人工复核 /tmp/help-flipped.png）');
  if (darkPx === 0) fail('帮助弹窗未见文字像素（弹窗没打开？）');
  if (errors.length) fail('存在页面运行时异常');

  // ── D：还原现场（不留脏 localStorage 影响后续手工验证） ──
  await page.evaluate(() => {
    localStorage.removeItem('dasheng.dev.showAutoplaceBtn');
    localStorage.removeItem('dasheng.dev.wuxing');
  });
  if (fs.existsSync('/tmp/help-flipped.png')) console.log('截图留存：/tmp/help-flipped.png');
  console.log('✅ 冒烟通过：布阵条目与五行一节随 dev 开关显隐，弹窗可正常打开渲染');
} finally {
  await browser.close();
}
