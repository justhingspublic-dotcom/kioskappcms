/* 開工作區 → 點格子出面板 → 驗證 modal 內各捲動區沒有捲軌（截圖＋量測）。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'shots', 'modal-noscrollbar');
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
  await sleep(400);
  await page.click('#deviceTable .device-ops button');   // 入口＝內容管理鈕（整列點擊已移除）
  await sleep(800);

  // 點第一個格子 → 面板長內容
  await page.click('#canvas .cell');
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, '01-panel-open.png') });

  // 面板捲到中段再拍（捲軸如果存在會露餡）
  await page.evaluate(() => { const p = document.querySelector('#cellPanel'); p.scrollTop = 200; });
  await sleep(200);
  await page.screenshot({ path: path.join(OUT, '02-panel-scrolled.png') });

  // 量測：clientWidth 應等於 offsetWidth - 邊框（捲軌占位寬 = 0 才對）
  const m = await page.evaluate(() => {
    const out = {};
    const probe = (name, el) => {
      if (!el) { out[name] = 'missing'; return; }
      const cs = getComputedStyle(el);
      const borders = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
      out[name] = {
        scrollable: el.scrollHeight > el.clientHeight,
        barSpace: el.offsetWidth - borders - el.clientWidth, // >0 = 有捲軌占位
        scrollTop: el.scrollTop,
      };
    };
    probe('modalBody', document.querySelector('#wsModal .b-modal-body'));
    probe('cellPanel', document.querySelector('#cellPanel'));
    return out;
  });
  console.log(JSON.stringify(m, null, 2));
  console.log('console errors:', errs.length ? errs : '(none)');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
