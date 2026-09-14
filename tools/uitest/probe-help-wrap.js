const puppeteer = require('puppeteer-core');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const page = await browser.newPage();
  await page.goto('http://localhost:3177/', { waitUntil: 'networkidle2' });
  await page.type('#username', 'joyeadmin'); await page.type('#password', 'joye#2026'); await page.click('.btn-login');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '內容管理'), { timeout: 10000 });
  await sleep(500);
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '內容管理').click(); });
  await page.waitForFunction(() => document.getElementById('wsModal').classList.contains('is-visible'));
  await sleep(500);
  await page.evaluate(() => document.querySelector('.ws-tabs [data-wstab="settings"]').click());
  await sleep(600);
  for (const [name, sel] of [['idle', '#settingsBody > .settings-card:nth-child(4) .page-help-btn'], ['pin', '#settingsBody > .settings-card:nth-child(3) .page-help-btn']]) {
    await page.hover(sel); await sleep(400);
    console.log(name, JSON.stringify(await page.evaluate((sel) => {
      const p = document.querySelector(sel).parentElement.querySelector('.b-pop-panel');
      const r = p.getBoundingClientRect();
      return { panelW: Math.round(r.width), right: Math.round(r.right), textOverflow: p.scrollWidth - p.clientWidth, ws: getComputedStyle(p).whiteSpace, inView: r.right <= innerWidth && r.bottom <= innerHeight };
    }, sel)));
    await page.screenshot({ path: path.join(__dirname, 'shots', 'settings-fit', 'wrap-' + name + '.png'), clip: { x: 700, y: 480, width: 800, height: 340 } });
    await page.mouse.move(5, 5); await sleep(300);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
