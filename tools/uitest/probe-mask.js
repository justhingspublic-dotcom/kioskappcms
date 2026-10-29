/* 拖曳中遮罩有沒有真的蓋上去（量 computed style 與位置）。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', 'joyeadmin'); await page.type('#password', 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await page.click('#sharedGroupToggle'); await sleep(300);
  await page.click('[data-view="sharedLayout"]'); await sleep(600);
  await page.evaluate(() => {
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const tree = { t: 'split', dir: 'Horizontal', ratio: 0.5, a: c({ content: 'Text', text: '餐廳', bgColor: 4285353025 }), b: c({ content: 'Text', text: '住宿', bgColor: 4279060385 }) };
    const L = { id: 9992, name: '遮罩', pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: tree }] }], screen: { w: 1080, h: 1920 }, spareSubs: [{ id: 1, name: '菜單', node: c(), layout: 'Kiosk', from: '' }] };
    (shared.layouts ||= []).push(L); enterSharedLayoutEditor(L); setSparePop(true);
  });
  await sleep(1000);
  const from = await page.evaluate(() => { const r = document.querySelector('#sparePop .spare-item').getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y - 20, { steps: 4 });
  await sleep(450);
  const to = await page.evaluate(() => { const el = [...document.querySelectorAll('.drop-board .cell')].find((c) => c.textContent.includes('住宿')); const r = el.getBoundingClientRect(); return { x: r.x + r.width * 0.3, y: r.y + r.height * 0.3 }; });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await sleep(400);
  const info = await page.evaluate(() => {
    const cell = [...document.querySelectorAll('.drop-board .cell')].find((c) => c.textContent.includes('住宿'));
    const m = cell.querySelector('.drop-mask');
    const cs = m && getComputedStyle(m);
    const r = m && m.getBoundingClientRect();
    return { cls: cell.className, hasMask: !!m, opacity: cs && cs.opacity, z: cs && cs.zIndex, pos: cs && cs.position, bg: cs && cs.backgroundColor, rect: r && [Math.round(r.width), Math.round(r.height)], children: [...cell.children].map((c) => c.className) };
  });
  console.log(JSON.stringify(info));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'spare', 'mask.png') });
  await page.mouse.up();
  await browser.close();
})();
