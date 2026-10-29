/* 截圖：機器工作區的收納匣鈕＋收納列（滑過一個子頁），不存檔。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const OUT = process.env.OUT || path.join(__dirname, 'shots', 'spare');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin');
  await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await sleep(500);
  const ver = await page.evaluate(async () => {
    const list = await api('GET', '/api/devices');
    const d = list.find((x) => /^1\.6/.test(x.LastAppVersion || '')) || list[0];
    await enterWorkspace(d);
    return d.LastAppVersion;
  });
  await sleep(1200);
  await page.evaluate(() => {
    wsAppVer = '1.60';
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    state.config.spareSubs = [
      { id: 1, name: '餐廳介紹', node: { t: 'split', dir: 'Horizontal', ratio: 0.6, a: c({ bgColor: 4283321390, content: 'Text', text: '藍染餐廳' }), b: c({ bgColor: 4280693304 }) }, layout: 'Kiosk', from: '原本在「首頁」的「餐廳」格' },
      { id: 2, name: '菜單', node: c({ bgColor: 4284367411 }), layout: 'Kiosk', from: '' },
    ]; render(); setSparePop(true);
  });
  await sleep(800);
  const r = await page.evaluate(() => { const b = document.querySelector('#sparePop .spare-item').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await page.mouse.move(r.x, r.y);
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'device-tray.png') });
  console.log('device ver', ver, 'errors', errs);
  await browser.close();
})();
