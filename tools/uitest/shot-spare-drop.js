/* 截圖：收納匣直式下拉的特寫（鈕與清單的接合、淺色／深色、6 個子頁要捲動、展開途中一格），2 倍解析度，不存檔。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const OUT = process.env.OUT || path.join(__dirname, 'shots', 'spare');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828, deviceScaleFactor: 2 } });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin');
  await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await sleep(500);
  await page.evaluate(async () => { const list = await api('GET', '/api/devices'); await enterWorkspace(list.find((x) => /^1\.6/.test(x.LastAppVersion || '')) || list[0]); });
  await sleep(1200);
  await page.evaluate(() => {
    wsAppVer = '1.60';
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const names = ['餐廳介紹', '菜單', '交通接駁', '住宿方案', '夏季活動報名', '停車場'];
    const colors = [4283321390, 4284367411, 4280693304, 4285290667, 4283215696, 4286141768];
    state.config.spareSubs = names.map((name, i) => ({ id: i + 1, name, node: c({ bgColor: colors[i] }), layout: 'Kiosk', from: '' }));
    render();
  });
  await sleep(300);
  const clip = await page.evaluate(() => { const b = document.getElementById('spareBtn').getBoundingClientRect(); return { x: b.left - 40, y: b.top - 24, width: b.width + 80, height: 420 }; });
  // 展開途中
  await page.evaluate(() => setSparePop(true));
  await sleep(110);
  await page.screenshot({ path: path.join(OUT, 'drop-mid.png'), clip });
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'drop-light.png'), clip });
  await page.evaluate(() => { document.documentElement.setAttribute('data-color-mode', 'dark'); });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'drop-dark.png'), clip });
  console.log('errors', errs);
  await browser.close();
})();
