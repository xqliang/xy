// 地图选择弹窗浏览器冒烟：面板加高后 5 图全可见、点第 5 张卡（黄风岭）可选中、拖拽不误选。
// 前置：worktree web/ 下 npx vite --port 5199 --strictPort
import puppeteer from 'puppeteer-core';

const URL = 'http://127.0.0.1:5199/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fail = (msg) => { console.error('❌ ' + msg); process.exitCode = 1; throw new Error(msg); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 560, height: 1010 });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(String(e)); process.exitCode = 1; });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game');

  // 打开地图选择弹窗：点首页「选择关卡」按钮（居中 x，y≈538-560）
  await page.mouse.click(280, 548);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: '/tmp/map-popup.png' });

  // 点第 5 张卡（黄风岭，第 3 行左列）。布局常量：面板 420x700 居中，卡片区 y=MAP_PY+112 起。
  // VIEW_H≈1044 → MAP_PY≈164；5 卡中心 ≈ (184, 670)
  const sel = await page.evaluate(() => localStorage.getItem('dasheng.map'));
  console.log('打开弹窗后选择态：', sel);
  await page.mouse.click(184, 670);
  await new Promise((r) => setTimeout(r, 400));
  const after = await page.evaluate(() => localStorage.getItem('dasheng.map'));
  console.log('点第 5 卡后选择态：', after);
  if (!after || !after.includes('huangfengling')) fail('点第 5 张卡未选中黄风岭：' + after);

  // 重开弹窗，验证拖拽（垂直拖 >6px）不会误选卡片
  await page.mouse.click(280, 548);
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => localStorage.setItem('dasheng.map', JSON.stringify({ mode: 'fixed', mapId: 'huoyanshan' })));
  await page.mouse.move(184, 670);
  await page.mouse.down();
  await page.mouse.move(184, 640, { steps: 8 }); // 上拖 30px（会 clamp 到 0，但不该触发选卡）
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  const afterDrag = await page.evaluate(() => localStorage.getItem('dasheng.map'));
  console.log('拖拽后选择态：', afterDrag);
  if (!afterDrag || !afterDrag.includes('huoyanshan')) fail('拖拽滚动误触了选卡：' + afterDrag);

  if (errors.length) fail('页面运行时异常：' + errors[0]);
  console.log('🎉 地图弹窗冒烟通过（截图 /tmp/map-popup.png）');
} finally {
  await browser.close();
}
