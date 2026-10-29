/* 子頁收納匣小卡片特寫（淺色／深色、滑過一張），2 倍解析度。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const OUT = path.join(__dirname, 'shots', 'spare');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828, deviceScaleFactor: 2 } });
  const page = await browser.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', 'joyeadmin'); await page.type('#password', 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await page.click('#sharedGroupToggle'); await sleep(300);
  await page.click('[data-view="sharedLayout"]'); await sleep(600);
  await page.evaluate(() => {
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const sub = (name, color) => ({ name, node: c({ content: 'Text', text: name, bgColor: color }), layout: 'Kiosk' });
    const tree = { t: 'split', dir: 'Horizontal', ratio: 0.5, a: c({ content: 'Text', text: '餐廳', bgColor: 4285353025, tap: 'OpenSubPage', sub: sub('餐廳介紹', 4283315246) }), b: c({ content: 'Text', text: '住宿', bgColor: 4279060385 }) };
    const L = { id: 9991, name: '卡片', pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: tree }] }], screen: { w: 1080, h: 1920 },
      spareSubs: [{ id: 1, name: '菜單', node: c({ content: 'Text', text: '菜單', bgColor: 4278223759 }), layout: 'Kiosk', from: '' }] };
    (shared.layouts ||= []).push(L); enterSharedLayoutEditor(L); setSparePop(true);
  });
  await sleep(1200);
  const clip = await page.evaluate(() => { const r = document.querySelector('#sparePop').getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 }; });
  await page.screenshot({ path: path.join(OUT, 'cards-light.png'), clip });
  const p = await page.evaluate(() => { const r = document.querySelectorAll('#sparePop .spare-item')[0].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(p.x, p.y); await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'cards-hover.png'), clip });
  await page.mouse.move(5, 5);
  await page.evaluate(() => window.setColorMode('dark', false)); await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'cards-dark.png'), clip });
  await browser.close();
})();
