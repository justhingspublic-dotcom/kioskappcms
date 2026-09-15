const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://localhost:3177';
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  page.on('console', (m) => console.log('[console]', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle2', timeout: 20000 });
  await page.type('#username', 'admin');
  await page.type('#password', 'kiosk#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#devicesView:not(.hidden)', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1500));
  const info = await page.evaluate(() => {
    const b = document.getElementById('themeBtn');
    const cs = b && getComputedStyle(b);
    return {
      exists: !!b, hidden: b && b.hidden, attr: b && b.getAttribute('hidden'), display: cs && cs.display, w: b && b.offsetWidth,
      meIsAdmin: typeof meIsAdmin !== 'undefined' ? meIsAdmin : 'undef', hasThemeColor: typeof KioskThemeColor,
      whoami: document.getElementById('whoamiSub').textContent,
      html: b && b.outerHTML.slice(0, 200),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
