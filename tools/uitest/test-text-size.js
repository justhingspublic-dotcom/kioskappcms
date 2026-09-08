/* 驗證：文字內容有「字級」滑塊，拖動後預覽字級等比放大、資料寫進 cell.txtSize。
   用法：BASE=http://localhost:3177 USER_=joyeadmin PASS_=xxx node test-text-size.js */
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1440, height: 900 } });
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
    page().blocks = [{ id: 1, w: 1, node: { ...DEFAULT_CELL(), content: 'Text', text: '智慧導覽' } }];
    selected = { bi: 0, sub: null }; renderCanvas(); renderPanel();
  });
  await sleep(300);
  const read = () => page.evaluate(() => ({ txtSize: page().blocks[0].node.txtSize, fontPx: document.querySelector('#canvas .pv-text')?.style.fontSize,
    slider: document.querySelector('#cellPanel input[type=range]')?.value }));
  console.log('預設', JSON.stringify(await read()));
  await page.screenshot({ path: __dirname + '/shots/tsize-1-default.png' });
  await page.evaluate(() => { const r = document.querySelector('#cellPanel input[type=range]'); r.value = 200; r.dispatchEvent(new Event('input')); });
  await sleep(300);
  console.log('拉到200', JSON.stringify(await read()));
  await page.screenshot({ path: __dirname + '/shots/tsize-2-200.png' });
  console.log('errors', JSON.stringify(errs));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
