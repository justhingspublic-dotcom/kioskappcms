/* 工作區 modal 不該捲：共用版面模式與機器模式各量一次 body scrollHeight vs clientHeight。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3177/';
const OUT = process.env.OUT || path.join(__dirname, 'shots', 'ws-fit');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--window-size=1440,900'], defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name); };
  const measure = () => page.evaluate(() => {
    const body = document.querySelector('#wsModal .ws-body');
    const canvas = document.querySelector('#canvas').getBoundingClientRect();
    const acts = document.querySelector('.canvas-actions').getBoundingClientRect();
    const modal = document.querySelector('#wsModal .b-modal').getBoundingClientRect();
    return { scrollH: body.scrollHeight, clientH: body.clientHeight, overflow: body.scrollHeight - body.clientHeight,
      canvas: [Math.round(canvas.top), Math.round(canvas.bottom), Math.round(canvas.width)], actsBottom: Math.round(acts.bottom), modalBottom: Math.round(modal.bottom), mode: document.querySelector('#wsModal').className };
  });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('#username', { visible: true });
  await page.type('#username', 'joyeadmin'); await page.type('#password', 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await sleep(400);
  // 共用版面模式：不寫 DB，直接用記憶體版面開編輯器
  await page.click('#sharedGroupToggle'); await sleep(300);
  await page.click('[data-view="sharedLayout"]'); await sleep(600);
  await page.evaluate(() => enterSharedLayoutEditor({ id: 9999, name: '量測用', pages: [DEFAULT_LAYOUT_PAGE()], screen: { w: 1080, h: 1920 }, updatedAt: new Date().toISOString() }));
  await sleep(700);
  console.log('shared', JSON.stringify(await measure()));
  await shot('01-shared-editor');
  await browser.close();
  console.log(errs);
})();
