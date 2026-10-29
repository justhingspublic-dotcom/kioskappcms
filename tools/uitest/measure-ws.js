/* 量工作區 modal 各區塊高度（1512×828，機器模式、子頁收納匣收起）。 */
const puppeteer = require('puppeteer-core');
const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: Number(process.env.W || 1512), height: Number(process.env.H || 828) } });
  const page = await browser.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin'); await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await sleep(400);
  await page.evaluate(async () => { const list = await api('GET', '/api/devices'); await enterWorkspace(list[0]); });
  await sleep(1200);
  await page.evaluate(() => { wsAppVer = '1.60'; render(); });
  await sleep(500);
  const r = await page.evaluate(() => {
    const h = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
    return {
      modal: h('#wsModal .b-modal.is-ws'), head: h('#wsModal .b-modal-head'), body: h('#wsModal .ws-body'), tabsRow: h('#layoutTab .page-tabs-row'),
      pageHead: h('#pageHead'), frame: h('#editor .canvas-frame'), canvas: h('#canvas'), tray: h('#spareBox'), actions: h('#editor .canvas-actions'), footer: h('#wsFooter'), panel: h('#cellPanel'),
    };
  });
  console.log(JSON.stringify(r));
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await browser.close();
})();
