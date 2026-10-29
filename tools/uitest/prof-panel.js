/* 右側面板重建花多少時間（CPU=4）：選一格文字格，量 renderPanel 與裡面幾個大項。 */
const puppeteer = require('puppeteer-core');
const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const page = await browser.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', 'joyeadmin'); await page.type('#password', 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await page.click('#sharedGroupToggle'); await sleep(300);
  await page.click('[data-view="sharedLayout"]'); await sleep(600);
  await page.evaluate(() => {
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const tree = { t: 'split', dir: 'Horizontal', ratio: 0.5, a: c({ content: 'Text', text: '餐廳', tap: 'OpenSubPage', sub: { name: 'x', node: c(), layout: 'Kiosk' } }), b: c({ content: 'Weather' }) };
    const L = { id: 9994, name: '面板', pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: tree }] }], screen: { w: 1080, h: 1920 } };
    (shared.layouts ||= []).push(L); enterSharedLayoutEditor(L);
  });
  await sleep(1000);
  const cdp = await page.target().createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (let k = 0; k < 3; k++) {
    console.log(JSON.stringify(await page.evaluate(() => {
      const acc = {};
      const wrapObj = (obj, key, label) => { const f = obj[key]; obj[key] = function (...a) { const t = performance.now(); try { return f.apply(this, a); } finally { acc[label] = (acc[label] || 0) + performance.now() - t; } }; return () => { obj[key] = f; }; };
      const un = [wrapObj(window.BDropdown, 'init', 'BDropdown.init'), wrapObj(window.lucide, 'createIcons', 'lucide')];
      ['segRow', 'selInput', 'swatchRow', 'colorRow', 'hint'].forEach((n) => { if (typeof window[n] === 'function') un.push(wrapObj(window, n, n)); });
      selected = { bi: 0, path: 'a' };
      const t = performance.now(); renderPanel(); const total = performance.now() - t;
      const t2 = performance.now(); document.body.offsetHeight; const layout = performance.now() - t2;
      un.forEach((u) => u());
      return { total: Math.round(total), layout: Math.round(layout), ...Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, Math.round(v)])) };
    })));
    await sleep(300);
  }
  await browser.close();
})();
