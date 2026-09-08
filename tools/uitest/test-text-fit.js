/* 驗證：(1) 文字格字級太大時自動縮到放得進格子；(2) 圖片背景＋模糊的格子文字看得到、沒有白邊。
   用法：BASE=http://localhost:3177 USER_=joyeadmin PASS_=xxx node test-text-fit.js */
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 } });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', process.env.USER_ || 'admin'); await page.type('#password', process.env.PASS_ || 'kiosk#2026'); await page.click('.btn-login');
  await page.waitForSelector('#mainView:not(.hidden)', { timeout: 10000 });
  await page.evaluate(() => window.setColorMode('light', false));
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '內容管理'), { timeout: 10000 });
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '內容管理').click(); });
  await page.waitForFunction(() => document.getElementById('wsModal').classList.contains('is-visible'), { timeout: 8000 });
  await sleep(600);
  await page.evaluate(() => {
    const img = '/files/4da991e2118e40fda60fe992f0616368.png';
    page().blocks = [
      { id: 1, w: 188, node: { ...DEFAULT_CELL(), content: 'Marquee', text: '歡迎蒞臨 卓也小屋(測試中)', bgColor: 0xFF5D4037 } },
      { id: 2, w: 153, node: { t: 'split', dir: 'Horizontal', ratio: 0.5,
        a: { ...DEFAULT_CELL(), content: 'Weather', wAuto: false, wCounty: '苗栗縣', wDynBg: true },
        b: { ...DEFAULT_CELL(), bg: 'Image', bgImgs: [img], bgBlur: 60, bgColor: 0xFFFFFFFF, content: 'Text', text: '智慧導覽', txtSize: 300, tap: 'OpenAssistant' } } },
      { id: 3, w: 1579, node: { ...DEFAULT_CELL(), bg: 'Image', bgImgs: [img], content: 'Text', text: '智慧導覽', txtSize: 300 } },
    ];
    selected = { bi: 1, sub: 'b' }; renderCanvas(); renderPanel();
  });
  await sleep(1500);
  const info = await page.evaluate(() => [...document.querySelectorAll('#canvas .pv-text')].map((t) => { const c = t.parentElement; const layer = c.querySelector('.pv-img-layer');
    return { cellH: c.offsetHeight, font: t.style.fontSize, textH: t.scrollHeight, fits: t.scrollHeight <= c.offsetHeight && t.scrollWidth <= c.offsetWidth, layerInset: layer && layer.style.inset, zText: getComputedStyle(t).zIndex, posText: getComputedStyle(t).position }; }));
  console.log(JSON.stringify(info));
  await page.screenshot({ path: __dirname + '/shots/tfit-1.png', clip: { x: 258, y: 200, width: 220, height: 500 } });
  console.log('errors', JSON.stringify(errs));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
