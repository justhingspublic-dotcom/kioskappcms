/* 驗證：底色白＋圖片背景（含模糊）的格子，放大預覽與畫布都不會露出一圈白邊。 */
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 } });
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
    const img = '/files/4da991e2118e40fda60fe992f0616368.png';
    page().blocks = [
      { id: 1, w: 188, node: { ...DEFAULT_CELL(), content: 'Marquee', text: '歡迎蒞臨 卓也小屋(測試中)', bgColor: 0xFF5D4037 } },
      { id: 2, w: 153, node: { t: 'split', dir: 'Vertical', ratio: 0.5,
        a: { ...DEFAULT_CELL(), content: 'Weather', wAuto: false, wCounty: '苗栗縣', wDynBg: true },
        b: { ...DEFAULT_CELL(), bg: 'Image', bgImgs: [img], bgBlur: 60, bgColor: 0xFFFFFFFF, content: 'Text', text: '智慧導覽', txtSize: 100 } } },
      { id: 3, w: 1579, node: { ...DEFAULT_CELL(), bg: 'Image', bgImgs: [img], bgColor: 0xFFFFFFFF, content: 'None' } },
    ];
    selected = null; renderCanvas(); renderPanel();
  });
  await sleep(1200);
  const r = await page.evaluate(() => { const c = document.querySelectorAll('#canvas .cell')[2].getBoundingClientRect(); return { x: c.x - 6, y: c.y - 6, width: c.width + 12, height: c.height + 12 }; });
  await page.screenshot({ path: __dirname + '/shots/wedge-canvas.png', clip: r });
  // 讀圖片格邊框那圈的實際顏色：用 elementFromPoint 看邊框位置是誰在畫
  const probe = await page.evaluate(() => { const cell = document.querySelectorAll('#canvas .cell')[2]; const b = cell.getBoundingClientRect();
    const layer = cell.querySelector('.pv-img-layer'); const lb = layer.getBoundingClientRect();
    return { cellTop: b.top, layerTop: lb.top, cellLeft: b.left, layerLeft: lb.left, covers: lb.top <= b.top && lb.left <= b.left && lb.right >= b.right && lb.bottom >= b.bottom, inset: getComputedStyle(layer).inset }; });
  console.log(JSON.stringify(probe));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
