/* 空狀態驗證：攔截 API 回空清單，截機器總覽／版面設定的空狀態（無表頭、撐滿高度）。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3177/';
const OUT = process.env.OUT || path.join(__dirname, 'shots', 'empty');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--window-size=1440,900'], defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('response', async (r) => { if (/login/.test(r.url())) console.log('login', r.status(), (await r.text()).slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (req.method() === 'GET' && /\/api\/devices(\?|$)/.test(u)) return req.respond({ status: 200, contentType: 'application/json', body: '[]' });
    if (req.method() === 'GET' && /\/api\/shared(\?|$)/.test(u)) {
      return req.continue({}); // 先照常，之後在頁面端清空
    }
    req.continue();
  });
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name); };
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('#username', { visible: true });
  await page.type('#username', process.env.U || 'joyeadmin');
  await page.type('#password', process.env.P || 'joye#2026');
  await page.click('.btn-login');
  try { await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 8000 }); } catch (e) { await shot('00-fail'); console.log(page.url(), errs); throw e; }
  await sleep(500);
  await shot('01-devices-empty');
  await page.click('#sharedGroupToggle'); await sleep(300);
  await page.click('[data-view="sharedLayout"]'); await sleep(600);
  // 清空版面清單再重畫
  await page.evaluate(async () => { shared.layouts = []; await renderSharedLayoutView(); });
  await sleep(400);
  await shot('02-shared-layout-empty');
  const m = await page.evaluate(() => {
    const s = document.querySelector('#sharedLayoutView .b-tbl-scroll').getBoundingClientRect();
    const t = document.querySelector('#sharedLayoutTable').getBoundingClientRect();
    const th = getComputedStyle(document.querySelector('#sharedLayoutTable thead')).display;
    return { scroll: [s.top, s.bottom], table: [t.top, t.bottom], thead: th, vh: innerHeight };
  });
  console.log(JSON.stringify(m), errs);
  const dbg = await page.evaluate(() => ({ has: !!document.querySelector('.b-tbl:has(> tbody > tr > td > .b-empty)'), html: document.querySelector('#sharedLayoutTable').outerHTML.slice(0, 400), css: [...document.styleSheets].some((ss) => { try { return [...ss.cssRules].some((r) => /b-empty\) thead/.test(r.selectorText || '')); } catch (e) { return false; } }) }));
  console.log(JSON.stringify(dbg));
  await browser.close();
})();
