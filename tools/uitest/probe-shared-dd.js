/* 共用設定 › 機器設定的下拉（閒置返回）：點開後選單在哪、能不能選。只看不存（攔 PUT／POST 設定）。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.setRequestInterception(true);
  page.on('request', (req) => (['PUT', 'PATCH'].includes(req.method()) ? req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) : req.continue()));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin'); await page.type('#password', process.env.PASS_ || 'joye#2026'); await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await page.evaluate(() => switchView('sharedSettings')); await sleep(1500);
  const info = () => page.evaluate(() => {
    const d = document.querySelector('#sharedBody .b-dd');
    if (!d) return { none: true, html: document.getElementById('sharedBody').innerHTML.slice(0, 300) };
    const t = d.querySelector('.b-dd-trigger'), m = d.querySelector('.b-dd-menu');
    const anc = []; for (let e = m.parentElement; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.transform !== 'none' || cs.filter !== 'none' || cs.contain !== 'none' || cs.willChange !== 'auto' || cs.backdropFilter !== 'none' || cs.containerType !== 'normal') anc.push(`${e.tagName}.${e.className} t=${cs.transform} f=${cs.filter} c=${cs.contain} w=${cs.willChange} ct=${cs.containerType}`); }
    return { open: d.classList.contains('open'), hidden: m.hidden, shown: m.classList.contains('is-shown'), t: t.getBoundingClientRect().toJSON(), m: m.getBoundingClientRect().toJSON(), style: m.getAttribute('style'), opacity: getComputedStyle(m).opacity, anc, value: d.querySelector('.b-dd-value').textContent, top: document.elementFromPoint(t.getBoundingClientRect().left + 20, t.getBoundingClientRect().top + 10)?.className };
  });
  console.log('before', JSON.stringify(await info()));
  const r = await page.$eval('#sharedBody .b-dd-trigger', (t) => { t.scrollIntoView({ block: 'center' }); const b = t.getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; });
  await sleep(200);
  await page.mouse.click(r.x, r.y); await sleep(500);
  console.log('after click', JSON.stringify(await info()));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'shared-dd.png') });
  // 強迫祖先帶 transform（模擬其他過場殘留）：選單仍要貼齊觸發鈕
  await page.keyboard.press('Escape'); await sleep(400);
  await page.evaluate(() => { document.querySelector('.main-content').style.transform = 'translate(0px, 0px)'; });
  await page.mouse.click(r.x, r.y); await sleep(500);
  console.log('forced transform', JSON.stringify(await info()));
  console.log('errs', errs);
  await browser.close();
})();
