/* 截圖：子頁標頭「移到未使用」的小提示（滑過 0.7 秒），不存檔。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828, deviceScaleFactor: 2 } });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => (req.method() === 'PUT' ? req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) : req.continue()));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin');
  await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await page.evaluate(async () => { const list = await api('GET', '/api/devices'); await enterWorkspace(list.find((x) => /^1\.6/.test(x.LastAppVersion || '')) || list[0]); });
  await sleep(1200);
  await page.evaluate(() => {
    wsAppVer = '1.60';
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const l = leavesOf(page().blocks[0].node)[0];
    l.cell.tap = 'OpenSubPage'; l.cell.sub = { name: '餐廳介紹', node: c({ content: 'Text', text: '菜色' }), layout: 'Kiosk' };
    subStack = [l.path]; selected = null; render();
  });
  await sleep(800);
  const r = await page.evaluate(() => { const b = document.querySelector('#pageHead .ph-body:not(.is-leaving) button[aria-label="移到未使用"]'); const x = b.getBoundingClientRect(); return { x: x.x + x.width / 2, y: x.y + x.height / 2, ok: !!b }; });
  await page.mouse.move(r.x, r.y); await sleep(700);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'spare', 'head-tip.png'), clip: { x: r.x - 240, y: r.y - 50, width: 300, height: 120 } });
  console.log('found', r.ok);
  await browser.close();
})();
