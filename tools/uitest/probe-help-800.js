/* 驗證 modal 內問號面板：hover 最下面 Danger Zone 的 ? 後，內容區不該變成可捲、面板要在視窗內。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 800 } });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:3177/', { waitUntil: 'networkidle2' });
  await page.type('#username', 'joyeadmin'); await page.type('#password', 'joye#2026'); await page.click('.btn-login');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '內容管理'), { timeout: 10000 });
  await sleep(500);
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '內容管理').click(); });
  await page.waitForFunction(() => document.getElementById('wsModal').classList.contains('is-visible'));
  await sleep(500);
  await page.evaluate(() => document.querySelector('.ws-tabs [data-wstab="settings"]').click());
  await sleep(600);
  const m = async (label) => console.log(label, JSON.stringify(await page.evaluate(() => {
    const body = document.querySelector('#wsModal .b-modal-body');
    const p = [...document.querySelectorAll('#wsModal .page-help .b-pop-panel')].find((x) => getComputedStyle(x).visibility === 'visible');
    const r = p && p.getBoundingClientRect();
    return { overflow: body.scrollHeight - body.clientHeight, scrollTop: body.scrollTop, panel: r ? [Math.round(r.top), Math.round(r.bottom), Math.round(r.left), Math.round(r.right), getComputedStyle(p).position] : null, up: p ? p.parentElement.classList.contains('is-up') : null };
  })));
  await m('before');
  for (const [name, sel] of [['dz', '.danger-zone .page-help-btn'], ['sleep', '#settingsBody > .settings-card:nth-child(2) .page-help-btn'], ['idle', '#settingsBody > .settings-card:nth-child(4) .page-help-btn']]) {
    await page.hover(sel); await sleep(400); await m(name);
    await page.screenshot({ path: path.join(__dirname, 'shots', 'settings-fit', 'help800-' + name + '.png') });
    await page.mouse.move(5, 5); await sleep(300);
  }
  await m('after');
  console.log('errors', errs);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
