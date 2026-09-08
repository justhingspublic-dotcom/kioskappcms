/* 驗證：放大預覽裡滑過格子不會出現亮框。 */
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', process.env.USER_ || 'admin'); await page.type('#password', process.env.PASS_ || 'kiosk#2026'); await page.click('.btn-login');
  await page.waitForSelector('#mainView:not(.hidden)', { timeout: 10000 });
  await page.waitForSelector('.layout-thumb.is-zoomable', { timeout: 10000 });
  await sleep(800);
  await page.click('.layout-thumb.is-zoomable'); await sleep(600);
  const r = await page.evaluate(() => { const c = document.querySelector('.tp-canvas'); const cell = c && c.querySelector('.cell'); const b = cell.getBoundingClientRect(); return { readonly: c.classList.contains('is-readonly'), x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await page.mouse.move(r.x, r.y); await sleep(300);
  const bc = await page.evaluate(() => { const hov = [...document.querySelectorAll(':hover')].map((e) => e.className).slice(-3); const cell = document.querySelector('.tp-canvas .cell'); return { hov, border: getComputedStyle(cell).borderColor, cursor: getComputedStyle(cell).cursor }; });
  console.log(JSON.stringify({ readonly: r.readonly, hoverBorder: bc }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
