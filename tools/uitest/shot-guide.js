/* 使用說明 modal 檢查：開啟 → 各章節點擊（scroll-spy active）→ 截圖 light/dark、Esc 關閉。
   用法：node shot-guide.js；輸出 shots/guide/。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'shots', 'guide');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`); }

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
  await page.evaluate(() => window.setColorMode('light', false));
  await sleep(500);

  await page.click('#manualLink');
  await sleep(500);
  check('開啟：overlay is-visible', await page.evaluate(() => document.getElementById('guideModal').classList.contains('is-visible')));
  check('開啟：body 鎖捲動', await page.evaluate(() => document.body.classList.contains('b-modal-lock')));
  check('開啟：第一章 active', await page.evaluate(() => document.querySelector('.gd-nav button.active')?.dataset.gdSec === 'start'));
  await page.screenshot({ path: path.join(OUT, '01-open.png') });
  const m = await page.$('#guideModal .b-modal');
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(200);
  await m.screenshot({ path: path.join(OUT, '02-modal-2x.png') });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(200);

  for (const key of ['justai', 'kiosk', 'faq']) {
    await page.click(`.gd-nav button[data-gd-sec="${key}"]`);
    await sleep(900);
    const active = await page.evaluate(() => document.querySelector('.gd-nav button.active')?.dataset.gdSec);
    check(`章節 ${key}：點擊後 active`, active === key, active);
    await page.screenshot({ path: path.join(OUT, `03-sec-${key}.png`) });
  }
  // 手動捲回頂端 → scroll-spy 應回第一章
  await page.evaluate(() => { const c = document.getElementById('gd-scroll'); c.style.scrollBehavior = 'auto'; c.scrollTop = 0; c.style.scrollBehavior = ''; });
  await sleep(800);
  check('捲回頂端：scroll-spy 回 start', await page.evaluate(() => document.querySelector('.gd-nav button.active')?.dataset.gdSec === 'start'));

  await page.evaluate(() => window.setColorMode('dark', false));
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, '04-dark.png') });
  await page.evaluate(() => window.setColorMode('light', false));

  await page.keyboard.press('Escape');
  await sleep(400);
  check('Esc 關閉', await page.evaluate(() => !document.getElementById('guideModal').classList.contains('is-visible')));
  check('關閉後解鎖', await page.evaluate(() => !document.body.classList.contains('b-modal-lock')));

  // 註：工作區 modal 開著時頂欄被遮罩蓋住（tiri 同），說明鈕本來就點不到，不測疊開。
  const hdr = await page.$('.top-header');
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(200);
  if (hdr) await hdr.screenshot({ path: path.join(OUT, '06-header-2x.png') });

  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  console.log('console errors:', errs.length ? errs : '(none)');
  await browser.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
