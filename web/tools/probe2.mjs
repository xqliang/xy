import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5180/?t='+Date.now(),{waitUntil:'networkidle0'});
await page.waitForFunction('window.__game');
const keys = await page.evaluate(()=>Object.keys(window.__game));
console.log('keys:', keys.join(','));
await browser.close();
