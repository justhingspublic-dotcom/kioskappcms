/* 機器總覽頁 tiri 對齊調整：baseline 截圖（light/dark/空狀態/側欄/字級面板/表格細節）。
   對象由 BASE 環境變數指定（預設 mock :3100；DB 恢復後可改打 :3000 真後台）。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = process.env.OUT || path.join(__dirname, 'shots', 'devices-baseline');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name); };

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('#username', { visible: true });
  await page.type('#username', 'admin');
  await page.type('#password', 'kiosk#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await sleep(400);

  // 1) 機器總覽 light 全頁
  await shot('01-devices-light');

  // 2) 表格細節（2 倍縮放：字重/圓點/按鈕 icon 看得清楚）
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(300);
  const tbl = await page.$('.b-tbl-scroll');
  if (tbl) { await tbl.screenshot({ path: path.join(OUT, '02-table-detail-2x.png') }); console.log('shot 02-table-detail-2x'); }
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(200);

  // 3) dark 全頁
  await page.click('.header-mode-btn');
  await sleep(400);
  await shot('03-devices-dark');
  await page.click('.header-mode-btn');
  await sleep(300);

  // 4) M17：展開共用設定 → 去版面設定 → 點回機器總覽（tiri 會收合群組、我們不會）
  await page.click('#sharedGroupToggle');
  await sleep(400);
  await page.click('[data-view="sharedLayout"]');
  await sleep(400);
  await page.click('[data-view="devices"]');
  await sleep(400);
  await shot('04-m17-group-stays-open');

  // 5) M18：群組收合＋活躍頁在裡面 → 母項 pill（light 對 dark）
  await page.click('[data-view="sharedLayout"]');
  await sleep(300);
  await page.click('#sharedGroupToggle'); // 收合，活躍頁在群組內 → 母項應亮
  await sleep(400);
  const side = await page.$('.sidebar');
  await side.screenshot({ path: path.join(OUT, '05-m18-closed-pill-light.png') });
  await page.click('.header-mode-btn');
  await sleep(400);
  await side.screenshot({ path: path.join(OUT, '06-m18-closed-pill-dark.png') });
  await page.click('.header-mode-btn');
  await sleep(300);

  // 6) M21：空清單 → b-empty 空狀態
  await page.evaluate(() => fetch('/mock/empty', { method: 'POST', body: '{"on":true}' }));
  await sleep(200);
  await page.click('[data-view="devices"]');
  await sleep(500);
  await shot('07-devices-empty');
  await page.evaluate(() => fetch('/mock/empty', { method: 'POST', body: '{"on":false}' }));

  // 7) M11：窄幕開字級面板（面板 200px 錨定 Aa 左緣 → 右緣裁切）
  await page.setViewport({ width: 400, height: 800 });
  await sleep(400);
  await page.click('.header-fs-wrap .header-icon-btn');
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, '08-m11-fs-panel-400w.png') });
  console.log('shot 08-m11-fs-panel-400w');

  console.log('\nconsole errors:', errs.length ? errs : '(none)');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
