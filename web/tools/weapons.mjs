import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox','--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width:560, height:1010, deviceScaleFactor:2 });
const logs=[]; page.on('pageerror',e=>logs.push('[pageerror] '+e.message));
await page.goto('http://127.0.0.1:5180/?seed=5',{waitUntil:'networkidle0'});
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true',{timeout:15000}).catch(()=>{});
const res = await page.evaluate(async ()=>{
  const g=window.__game; const r={};
  localStorage.removeItem('dasheng.bag');
  // 掉落：跑完整局，看 droppedWeapons
  g.restart(5,1); g.enterBattle(); let b=g.battle;
  const manage=()=>{for(let k=0;k<30;k++){if(!g.summon()){g.autoPlace();if(!g.summon())break;}g.autoPlace();}};
  for(let w=0;w<9;w++){ if(b.status==='won'||b.status==='lost')break; if(b.pendingShop)g.chooseItem(0); g.grantPeach(600); manage(); if(b.status==='ready')g.wave(); let t=0; while(b.status==='playing'&&t<80){g.step(0.1);t+=0.1; g.triggerActive(0);g.triggerActive(1);} }
  r.dropsInRun = b.droppedWeapons.length; r.status=b.status;
  // 背包：授予同一件2次 → 应升到2阶；装备上限3
  g.grantWeapon('jingubang'); g.grantWeapon('jingubang');
  g.grantWeapon('huojianqiang'); g.grantWeapon('jiuchidingba'); g.grantWeapon('bajiaoshan');
  const bag=JSON.parse(localStorage.getItem('dasheng.bag'));
  r.jingubangTier = bag.owned['jingubang']; r.equippedCount = bag.equipped.length; r.owned = Object.keys(bag.owned).length;
  // 加成生效：装备如意金箍棒(范围)后，悟空范围应变大
  g.restart(5,1); g.enterBattle(); b=g.battle;
  const cells=b.unlockedCells(); const a=cells[0], nb={c:a.c+1,r:a.r};
  b.words.set(`${a.c},${a.r}`,{char:'悟',general:'wukong',tier:1,cell:a});
  b.words.set(`${nb.c},${nb.r}`,{char:'空',general:'wukong',tier:1,cell:nb});
  const ag=b.activeGenerals()[0];
  r.weaponBonusesInjected = JSON.stringify(b.weaponBonuses.wukong||null);
  r.rgeWithWeapon = +b.generalRge(ag).toFixed(3);
  return r;
});
await page.evaluate(()=>window.__game.openBag());
await new Promise(r=>setTimeout(r,120));
await page.screenshot({ path: path.join(OUT,'bag.png') });
console.log(JSON.stringify(res,null,1));
console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
