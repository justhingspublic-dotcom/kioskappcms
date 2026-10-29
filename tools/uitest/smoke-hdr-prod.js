/* 正式站冒煙測試（只看不改）：登入後沒有頁面錯誤、帳號名稱有填、帳號選單與字體大小打得開（頁籤式）、共用設定的下拉貼齊欄位。
   不點通知（打開會把未讀標成已讀）。用法：BASE=https://justdisplay.justhings.com.tw/joye/admin USER_=… PASS_=… node smoke-hdr-prod.js */
const puppeteer = require('puppeteer-core');
const BASE = (process.env.BASE || 'https://justdisplay.justhings.com.tw/joye/admin').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (req) => (['PUT', 'PATCH', 'DELETE'].includes(req.method()) ? req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) : req.continue()));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_); await page.type('#password', process.env.PASS_); await page.click('.btn-login');
  await page.waitForSelector('#mainView:not(.hidden)', { timeout: 15000 }); await sleep(1500);
  const who = await page.evaluate(() => [document.getElementById('whoami').textContent, document.getElementById('whoamiMenu').textContent, typeof bHdrOpened]);
  console.log('帳號名稱', who);
  await page.click('.header-user-btn'); await sleep(500);
  const u = await page.evaluate(() => { const p = document.querySelector('.header-user-menu'); return { open: !p.hidden, top: p.getBoundingClientRect().top }; });
  console.log('帳號選單', JSON.stringify(u));
  await page.keyboard.press('Escape'); await sleep(400);
  await page.click('.header-fs-wrap .header-icon-btn'); await sleep(500);
  console.log('字體大小膠囊', await page.evaluate(() => [document.querySelector('.fs-pill').classList.contains('is-open'), document.querySelector('.fs-pill').getBoundingClientRect().width]));
  await page.keyboard.press('Escape'); await sleep(400);
  await page.evaluate(() => switchView('sharedSettings')); await sleep(2000);
  const r = await page.$eval('#sharedBody .b-dd-trigger', (t) => { t.scrollIntoView({ block: 'center' }); const b = t.getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2, left: b.left }; });
  await sleep(200); await page.mouse.click(r.x, r.y); await sleep(500);
  const m = await page.$eval('#sharedBody .b-dd-menu', (m) => m.getBoundingClientRect().left);
  console.log('共用設定下拉', Math.abs(m - r.left) < 1 ? '貼齊' : `偏了 ${m - r.left}`);
  console.log('頁面錯誤', JSON.stringify(errs));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
