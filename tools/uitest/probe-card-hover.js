/* 收納匣小卡片滑過的放大有沒有過場：滑上去後每 40ms 量一次 scale 與陰影。 */
const puppeteer = require('puppeteer-core');
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
    const L = { id: 9990, name: '滑過', pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: DEFAULT_CELL() }] }], screen: { w: 1080, h: 1920 }, spareSubs: [{ id: 1, name: '菜單', node: DEFAULT_CELL(), layout: 'Kiosk', from: '' }] };
    (shared.layouts ||= []).push(L); enterSharedLayoutEditor(L); setSparePop(true);
  });
  await sleep(1000);
  const p = await page.evaluate(() => { const r = document.querySelector('#sparePop .spare-item').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(p.x, p.y);
  const samples = await page.evaluate(async () => {
    const el = document.querySelector('#sparePop .spare-item');
    const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 420) { out.push(`${Math.round(performance.now() - t0)}:${getComputedStyle(el).scale}`); await new Promise((r) => setTimeout(r, 40)); }
    return out;
  });
  console.log(samples.join('  '));
  await browser.close();
})();
