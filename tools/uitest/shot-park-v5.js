/* 園區測站新版排版截圖（2026-10-20 晚）：上排測站頁籤＋左介紹右地圖、編輯位置、連線失敗空狀態（插頭拔開）。
   只看畫面不改資料（連線失敗用頁面變數模擬）。用法：node shot-park-v5.js（BASE 預設本機 3177） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const W = +process.env.W || 1512, H = +process.env.H || 828;
const OUT = path.join(__dirname, 'shots', 'parkinfo');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: W, height: H } });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin'); await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await page.goto(BASE + '/#parkInfo', { waitUntil: 'networkidle2' });
  await sleep(1800);
  await page.screenshot({ path: path.join(OUT, `40-v5-${W}.png`) });
  await page.click('#parkBody .park-st-tabs .seg[data-id="D3"]'); await sleep(900);
  await page.screenshot({ path: path.join(OUT, `41-v5-d3-${W}.png`) });
  await page.evaluate(() => [...document.querySelectorAll('.park-map-bar button')].find((b) => b.textContent === '編輯位置')?.click()); await sleep(500);
  await page.screenshot({ path: path.join(OUT, `42-v5-placing-${W}.png`) });
  // 連線失敗（只改頁面上的變數）：插頭拔開動畫，截動畫中與結束
  await page.evaluate(() => { parkPlacing = false; shared.parkInfo = { ...shared.parkInfo, api: 'https://example.invalid/x' }; parkStations = []; parkStationsErr = '找不到這個網址。'; renderParkInfoView(); });
  await sleep(450);
  await page.screenshot({ path: path.join(OUT, `43-v5-connfail-mid.png`), clip: { x: 700, y: 330, width: 400, height: 260 } });
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, `44-v5-connfail-${W}.png`) });
  await browser.close();
  console.log(errs.length ? errs : '沒有頁面錯誤');
})();
