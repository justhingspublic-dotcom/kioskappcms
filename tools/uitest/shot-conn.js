/* 快照：側欄底部「機器連線資訊」卡片（light/dark、問號說明、收合 icon＋flyout、複製 toast）。
   用法：BASE=http://localhost:3177 node shot-conn.js */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'shots', 'conn');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.evaluate(() => localStorage.removeItem('adminSidebarCollapsed'));
  await page.type('#username', 'admin');
  await page.type('#password', 'kiosk#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#connCard:not([hidden])', { visible: true, timeout: 10000 });
  await sleep(500);

  // 卡片區域截圖（側欄下半）
  const cardClip = async () => {
    const r = await page.evaluate(() => { const b = document.querySelector('.sidebar').getBoundingClientRect(); return { x: b.x, y: b.bottom - 320, width: b.width + 260, height: 320 }; });
    return r;
  };
  await page.screenshot({ path: path.join(OUT, 'card-light.png'), clip: await cardClip() });

  // 問號說明（點擊釘住）
  await page.click('#connCard .page-help-btn');
  await sleep(350);
  await page.screenshot({ path: path.join(OUT, 'card-help.png'), clip: await cardClip() });
  const helpVis = await page.evaluate(() => {
    const p = document.querySelector('#connCard .b-pop-panel'); const r = p.getBoundingClientRect();
    return { visible: getComputedStyle(p).visibility, top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width) };
  });
  console.log('help panel:', helpVis);
  await page.keyboard.press('Escape');
  await sleep(300);

  // 複製金鑰 → toast
  await page.click('#connCard .conn-copy[data-copy="key"]');
  await sleep(400);
  const toast = await page.evaluate(() => (document.querySelector('.b-toast, [class*="toast"]') || {}).textContent || '');
  console.log('toast:', toast.trim());
  await sleep(2500);

  // 深色
  await page.click('.header-mode-btn');
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'card-dark.png'), clip: await cardClip() });

  // 收合：卡片藏、mini icon 出現；點 icon → flyout
  const vis = () => page.evaluate(() => { const g = (id) => { const c = getComputedStyle(document.getElementById(id)); return c.visibility + '/' + (+c.opacity).toFixed(2); }; return { card: g('connCard'), mini: g('connMini') }; });
  await page.click('.sidebar .toggle-btn');
  await sleep(90);
  await page.screenshot({ path: path.join(OUT, 'collapse-mid.png'), clip: { x: 0, y: 560, width: 300, height: 340 } });
  console.log('collapse mid:', await vis());
  await sleep(500);
  console.log('collapsed:', await vis(), '(expect card hidden/0, mini visible/1)');
  await page.click('#connMiniBtn');
  await sleep(400);
  const fly = await page.evaluate(() => { const f = document.querySelector('.conn-flyout'); if (!f) return null; const r = f.getBoundingClientRect(); const b = document.getElementById('connMiniBtn').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), btnBottom: Math.round(b.bottom), left: Math.round(r.left) }; });
  console.log('flyout:', fly);
  await page.click('.conn-flyout .conn-copy[data-copy="url"]');
  await sleep(300);
  console.log('flyout copy toast:', await page.evaluate(() => (document.querySelector('.b-toast, [class*="toast"]') || {}).textContent || ''));
  await page.screenshot({ path: path.join(OUT, 'collapsed-flyout-dark.png'), clip: { x: 0, y: 560, width: 420, height: 340 } });
  // （截圖會觸發 resize → flyout 自動關閉，所以複製要排在截圖前）
  await page.mouse.click(900, 500); // 點外面關
  await sleep(300);
  console.log('flyout closed:', await page.evaluate(() => !document.querySelector('.conn-flyout')));
  await page.click('.header-mode-btn'); await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'collapsed-light.png'), clip: { x: 0, y: 700, width: 120, height: 200 } });
  await page.click('.sidebar .toggle-btn'); // 還原
  await sleep(120);
  await page.screenshot({ path: path.join(OUT, 'expand-mid.png'), clip: { x: 0, y: 560, width: 300, height: 340 } });
  console.log('expand mid:', await vis());
  await sleep(500);
  console.log('expanded:', await vis(), '(expect card visible/1, mini hidden/0)');

  console.log('console errors:', errs.length ? errs : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
