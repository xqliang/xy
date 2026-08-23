// 黄狮精「卷走」闪烁特效冒烟验证：真机浏览器注入狮子+兵器，
// 采样闪烁期内多帧截图，验证 ①幽灵残影按方波亮暗交替（看得清是谁）
// ②金色警示框持续在场 ③闪烁期满才爆金色 death 粒子环。
// 用法：node tools/stealfx.mjs（需 dev server 在 5180）
import puppeteer from 'puppeteer-core';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
// 分析用临时目录（vite 会静态服务 public/；截图 base64 直接传 evaluate 会超 CDP 参数上限被截断）
const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/_stealfx');
rmSync(PUB, { recursive: true, force: true });
mkdirSync(PUB, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.setCacheEnabled(false);
await page.goto('http://127.0.0.1:5180/?seed=7&t=' + Date.now(), { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// 注入：进入战斗 → 在路径格旁放一把 tier3 刀兵 → 放一只 spd=0/skillCd=0 的黄狮精（下一帧即施法）
const setup = await page.evaluate(() => {
  const g = window.__game;
  g.enterBattle();
  const b = g.battle;
  const path = b.map.path;
  const distAt = (i) => {
    let d = 0;
    for (let k = 1; k <= i; k++) {
      const a = path[k - 1], c = path[k];
      d += Math.hypot(c.c - a.c, c.r - a.r);
    }
    return d;
  };
  // 找一个「路径格 + 相邻空格」组合（空格不在路径上、无占用）
  let chosen = null;
  outer:
  for (let i = 2; i < path.length - 1; i++) {
    const p = path[i];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = p.c + dc, r = p.r + dr;
      const k = `${c},${r}`;
      if (c < 0 || c >= 8 || r < 0 || r >= 12) continue;
      if (b.units.has(k) || b.words.has(k) || b.trees.has(k)) continue;
      if (path.some((q) => q.c === c && q.r === r)) continue;
      chosen = { pc: p, unit: { c, r }, dist: distAt(i) };
      break outer;
    }
  }
  if (!chosen) return { ok: false };
  b.units.set(`${chosen.unit.c},${chosen.unit.r}`, {
    type: 'dao', tier: 3, cell: chosen.unit, cooldown: 0, firePulse: 0, combo: 0,
    fireDir: undefined, stunT: 0, slowT: 0, weakenT: 0, rangeCutT: 0, knockdownT: 0,
    stunImmuneT: 0, slowImmuneT: 0, weakenImmuneT: 0, rangeCutImmuneT: 0, knockdownImmuneT: 0,
  });
  b.monsters.push({
    id: 4242, dist: chosen.dist, hp: 9999, maxHp: 9999, spd: 0,
    isBoss: false, isMiniBoss: true, miniBossKind: 'lion', isCavalry: false,
    hitFlash: 0, skill: null, skillCd: 0, castFlash: 0, spawnT: 1,
    stunT: 0, slowT: 0, hasteT: 0, healFlash: 0, burnT: 0, burnDps: 0, miniBossCasted: false,
  });
  b.status = 'playing'; // 小 Boss 施法只在 playing 态推进（与 lion-steal.test 同法）；否则停在 ready 波间态
  return { ok: true, target: chosen.unit, message: b.message };
});
if (!setup.ok) throw new Error('没找到可用的路径格+相邻空格');
console.log('注入完成，目标格:', setup.target.c, setup.target.r);

// 等施法发生（游戏循环每帧 step，skillCd=0 → 下一帧卷走）
await page.waitForFunction('window.__game.battle.stealFx.length === 1', { timeout: 5000 });

// 目标格的 CSS 像素坐标（clip 用 CSS 坐标；截图实际分辨率 = CSS × deviceScaleFactor）
const geo = await page.evaluate((cell) => {
  const cv = document.querySelector('canvas');
  const rect = cv.getBoundingClientRect();
  const scale = rect.width / 560; // 游戏逻辑坐标 → CSS 像素
  const CELL = 68, BOARD_X = 8, BOARD_Y = 84;
  const cx = (BOARD_X + cell.c * CELL + CELL / 2) * scale;
  const cy = (BOARD_Y + cell.r * CELL + CELL / 2) * scale;
  return { cx, cy, half: (CELL / 2) * scale };
}, setup.target);

// 闪烁期采样：每 ~170ms 一帧共 8 帧（覆盖 1.05s 闪烁窗口 + 到期粒子）
const shots = [];
for (let i = 0; i < 8; i++) {
  const buf = await page.screenshot({ type: 'png', clip: { x: geo.cx - geo.half, y: geo.cy - geo.half, width: geo.half * 2, height: geo.half * 2 } });
  writeFileSync(path.join(PUB, `shot-${i}.png`), buf);
  const fxState = await page.evaluate(() => ({
    stealN: window.__game.battle.stealFx.length,
    ttl: window.__game.battle.stealFx[0]?.ttl ?? 0,
    burst: !!window.__game.battle.bursts.find((x) => x.kind === 'death'),
  }));
  shots.push({ i, fxState });
  await new Promise((r) => setTimeout(r, 170));
}
const finalMsg = await page.evaluate(() => window.__game.battle.message);
await browser.close();

// ---- 像素分析：每帧统计被偷格内「深墨残影」与「金色」占比 ----
// 截图太大不能直接传 evaluate：落盘到 public/_stealfx/ 经 dev server 取回（同源，canvas 不污染）
const browser2 = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page2 = await browser2.newPage();
await page2.goto('http://127.0.0.1:5180/', { waitUntil: 'domcontentloaded' });
const analysis = [];
for (const s of shots) {
  const r = await page2.evaluate(async (idx) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error(`shot-${idx} 加载失败`)); img.src = `/_stealfx/shot-${idx}.png?t=` + idx; });
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const p = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let dark = 0, gold = 0, total = 0;
    for (let i = 0; i < p.length; i += 4) {
      total++;
      const [R, G, B] = [p[i], p[i + 1], p[i + 2]];
      const lum = Math.max(R, G, B);
      if (lum < 130) dark++; // 兵器立绘的深墨笔画
      // 金色 #e8c24a：R 高、G 次之、B 低（警示框+粒子环）
      if (R > 170 && G > 130 && B < 130 && R > B + 60) gold++;
    }
    return { dark: +(dark / total * 100).toFixed(2), gold: +(gold / total * 100).toFixed(2) };
  }, s.i);
  analysis.push({ ...r, ...s.fxState });
}
await browser2.close();
rmSync(PUB, { recursive: true, force: true }); // 清掉临时截图目录

console.log('帧序列 (dark%=残影笔画, gold%=金色框/粒子):');
for (const a of analysis) console.log(`  dark ${String(a.dark).padStart(5)}%  gold ${String(a.gold).padStart(5)}%  stealFx=${a.stealN} ttl=${a.ttl.toFixed(2)} deathBurst=${a.burst}`);
console.log('最终底部提示:', finalMsg);

// 断言：①闪烁期内残影有亮暗交替 ②金色始终在场 ③前几帧无 death 粒子、后期有
const flashFrames = analysis.filter((a) => a.stealN === 1);
const darkVals = flashFrames.map((a) => a.dark);
const maxDark = Math.max(...darkVals), minDark = Math.min(...darkVals);
const blinkOk = maxDark - minDark > 3; // 亮暗相位差应显著（立绘消失 vs 在场）
const goldOk = flashFrames.every((a) => a.gold > 0.5);
const burstTimingOk = analysis[0].burst === false && analysis.slice(-3).some((a) => a.burst === true);
console.log(`\n残影亮暗交替(最大差 ${maxDark - minDark}pp): ${blinkOk ? '✅' : '❌'} | 金色警示框常驻: ${goldOk ? '✅' : '❌'} | 粒子环在闪烁后才爆: ${burstTimingOk ? '✅' : '❌'}`);
console.log('pageerrors:', logs.join('\n') || '(none)');
process.exit(blinkOk && goldOk && burstTimingOk && logs.length === 0 ? 0 : 1);
