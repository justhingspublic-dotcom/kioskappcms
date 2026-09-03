/* 三頁的標題旁小問號說明：hover 展開實測＋截圖（機器總覽／版面設定／機器設定）。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'shots', 'help-all');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, extra) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`);
}

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
  await page.click('#sharedGroupToggle'); // 展開共用設定群組
  await sleep(400);

  const views = [
    { key: 'devices', nav: '[data-view="devices"]', root: '#devicesView', name: '機器總覽' },
    { key: 'sharedLayout', nav: '[data-view="sharedLayout"]', root: '#sharedLayoutView', name: '版面設定' },
    { key: 'sharedSettings', nav: '[data-view="sharedSettings"]', root: '#sharedSettingsView', name: '機器設定' },
  ];
  for (const v of views) {
    await page.click(v.nav);
    await sleep(500);
    const btnSel = `${v.root} .page-help-btn`;
    const panelSel = `${v.root} .page-help .b-pop-panel`;
    check(`${v.name}：問號鈕存在`, await page.evaluate((s) => {
      const b = document.querySelector(s);
      return !!(b && b.getBoundingClientRect().width > 0);
    }, btnSel));
    check(`${v.name}：無殘留 table-note`, await page.evaluate((s) => !document.querySelector(`${s} .table-note`), v.root));
    await page.hover(btnSel);
    await sleep(300);
    const open = await page.evaluate((s) => {
      const p = document.querySelector(s);
      const cs = getComputedStyle(p);
      return cs.visibility === 'visible' && parseFloat(cs.opacity) > .9;
    }, panelSel);
    check(`${v.name}：hover 展開`, open);
    await page.screenshot({ path: path.join(OUT, `${v.key}-open.png`) });
    await page.mouse.move(720, 640, { steps: 6 }); // 收合再換頁
    await sleep(300);
  }

  console.log('\nconsole errors:', errs.length ? errs : '(none)');
  const pass = results.filter(Boolean).length;
  console.log(`${pass}/${results.length} passed`);
  await browser.close();
  process.exit(pass === results.length && !errs.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
