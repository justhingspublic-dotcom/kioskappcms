const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  page.on('console', (m) => console.log('[console]', m.type(), m.text()));
  page.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure() && r.failure().errorText));
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', 'admin');
  await page.type('#password', 'kiosk#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#devicesView:not(.hidden)', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 800));
  const info = await page.evaluate(() => {
    const wrap = document.querySelector('#devicesView .page-title-wrap');
    const btn = document.querySelector('#devicesView .page-help-btn');
    const r = btn && btn.getBoundingClientRect();
    return {
      wrapHTML: wrap ? wrap.outerHTML.slice(0, 600) : '(no .page-title-wrap)',
      btnRect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
      lucideLoaded: typeof window.lucide,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
