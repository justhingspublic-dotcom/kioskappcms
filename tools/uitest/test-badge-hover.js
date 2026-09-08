/* 驗證：畫布格子的角標平常隱藏、hover 才顯示。用法：BASE=http://localhost:3177 USER_=joyeadmin PASS_=xxx node test-badge-hover.js */
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', process.env.USER_ || 'admin'); await page.type('#password', process.env.PASS_ || 'kiosk#2026'); await page.click('.btn-login');
  await page.waitForSelector('#mainView:not(.hidden)', { timeout: 10000 });
  await page.evaluate(() => window.setColorMode('light', false));
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '內容管理'), { timeout: 10000 });
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '內容管理').click(); });
  await page.waitForFunction(() => document.getElementById('wsModal').classList.contains('is-visible'), { timeout: 8000 });
  await sleep(600);
  await page.evaluate(() => {
    page().blocks = [
      { id: 1, w: 1, node: { ...DEFAULT_CELL(), content: 'Marquee', text: '卓也小屋(測試中)' } },
      { id: 2, w: 1, node: { t: 'split', dir: 'Horizontal', ratio: 0.5, a: { ...DEFAULT_CELL(), content: 'Weather', wAuto: false, wCounty: '苗栗縣' }, b: { ...DEFAULT_CELL(), content: 'Text', text: '文字', tap: 'OpenWeb' } } },
    ];
    selected = { bi: 0, sub: null }; renderCanvas(); renderPanel();
  });
  await sleep(400);
  const op = () => page.evaluate(() => [...document.querySelectorAll('#canvas .pv-size-badge')].map((b) => getComputedStyle(b).opacity));
  console.log('未 hover', JSON.stringify(await op()));
  await page.screenshot({ path: __dirname + '/shots/badge-1-idle.png', clip: { x: 258, y: 200, width: 220, height: 300 } });
  const r = await page.evaluate(() => { const c = document.querySelectorAll('#canvas .cell')[1].getBoundingClientRect(); return { x: c.x + c.width / 2, y: c.y + c.height / 2 }; });
  await page.mouse.move(r.x, r.y); await sleep(300);
  console.log('hover 第二格', JSON.stringify(await op()));
  await page.screenshot({ path: __dirname + '/shots/badge-2-hover.png', clip: { x: 258, y: 200, width: 220, height: 300 } });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
