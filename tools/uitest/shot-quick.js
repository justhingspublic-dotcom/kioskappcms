/* 快照工具：登入 → 機器總覽 → 全頁＋表格特寫（light/dark）。
   用法：node shot-quick.js [名字]；BASE 環境變數換目標（預設 :3000 真後台）。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:3000';
const TAG = process.argv[2] || 'quick';
const OUT = path.join(__dirname, 'shots', TAG);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', 'admin');
  await page.type('#password', 'kiosk#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await sleep(500);

  await page.screenshot({ path: path.join(OUT, 'devices-light.png') });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(300);
  const tbl = await page.$('.b-tbl-scroll');
  if (tbl) await tbl.screenshot({ path: path.join(OUT, 'table-detail-2x.png') });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(200);
  await page.click('.header-mode-btn');
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'devices-dark.png') });

  console.log('shots →', OUT);
  console.log('console errors:', errs.length ? errs : '(none)');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
