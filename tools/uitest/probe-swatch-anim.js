/* 色票選取放大／縮回過場（2026-09-14）：主題色 modal 點另一格，在動畫中途取樣 transform，
   新選取格應介於 1～1.15、舊選取格應從 1.15 往回縮。 */
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://localhost:3177';
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle2', timeout: 20000 });
  await page.type('#username', process.env.USER_ || 'joyeadmin');
  await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForFunction(() => document.getElementById('whoami').textContent.trim() !== '—', { timeout: 10000 });
  await page.click('#themeBtn');
  await page.waitForSelector('#themeModal.is-visible', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 500));
  const res = await page.evaluate(async () => {
    const sc = (el) => { const m = getComputedStyle(el).transform; if (m === 'none') return 1; return Number(m.match(/matrix\(([^,]+)/)[1]); };
    const row = () => document.querySelectorAll('#themeSwatches .swatch:not(.custom)');
    const before = sc(row()[1]);
    row()[3].click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 70));
    const midNew = sc(row()[3]), midOld = sc(row()[1]);
    await new Promise((r) => setTimeout(r, 400));
    const endNew = sc(row()[3]), endOld = sc(row()[1]);
    return { before, midNew, midOld, endNew, endOld, active: Array.from(row()).map((b) => b.classList.contains('active')) };
  });
  console.log(JSON.stringify(res));
  const ok = res.before > 1.1 && res.midNew > 1 && res.midNew < 1.15 && res.midOld > 1 && res.midOld < 1.15 && Math.abs(res.endNew - 1.15) < 0.01 && res.endOld === 1;
  console.log(ok ? 'PASS 選取放大與縮回都有過場' : 'FAIL 過場取樣不符', 'errors', errors.length);
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
