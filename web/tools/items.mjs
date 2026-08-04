import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox'] });
const page = await browser.newPage();
const logs=[]; page.on('pageerror',e=>logs.push('[pageerror] '+e.message));
await page.goto('http://127.0.0.1:5180/?seed=5',{waitUntil:'networkidle0'});
await page.waitForFunction('window.__game && window.__game.snapshot');
const res = await page.evaluate(()=>{
  const g=window.__game; g.restart(5,1); g.enterBattle(); const b=g.battle;
  const r={};
  // 主动上限=2：连给3个主动，第3个应被拒
  const act=['xiandan','fenghuolun','fabaofu'];
  const okA=[]; for(const id of act){ okA.push(b.canCarry(id)); if(b.canCarry(id)){ b.pendingShop=[id]; b.chooseItem(0);} }
  r.activeCanCarry=okA; r.activeCount=b.itemCount('主动'); r.thirdActiveBlocked=!b.canCarry('fabaofu');
  // 被动上限=6
  const pas=['pantaoyuan','zhaoxian','mojin','luoyangchan','yunshi','yuni','xianyuan'];
  const okP=[]; for(const id of pas){ okP.push(b.canCarry(id)); if(b.canCarry(id)){ b.pendingShop=[id]; b.chooseItem(0);} }
  r.passiveCanCarry=okP; r.passiveCount=b.itemCount('被动'); r.seventhPassiveBlocked=!b.canCarry('xianyuan');
  // 效果：蟠桃园产桃 / 洛阳铲产铲
  // 建好防线，保证对局持续(否则唐僧早亡、step 提前返回)
  g.grantPeach(3000); for(let k=0;k<12;k++){ g.summon(); g.autoPlace(); }
  const p0=b.peach, s0=b.shovels;
  g.wave(); let steps=0; for(let i=0;i<50*30;i++){ if(b.status!=='playing'&&b.status!=='ready') break; g.step(1/30); steps++; }
  r.steps=steps; r.status=b.status;
  r.p0=p0; r.peachNow=b.peach; r.s0=s0; r.shovelsNow=b.shovels; r.peachFarmWorked = b.peach > p0; r.autoShovelWorked = b.shovels > s0;
  r.mods={wordRateBonus:b.mods.wordRateBonus, shovelPeach:b.mods.shovelPeach, peachFarm:b.mods.peachFarm, autoShovel:b.mods.autoShovel, meteor:b.mods.meteor, mud:b.mods.mud};
  return r;
});
console.log(JSON.stringify(res,null,1));
console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
