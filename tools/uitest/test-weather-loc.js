/* 驗證：一般天氣的縣市／區是下拉（與 App 同清單）、舊「臺」字資料對得上、切園區測站自動帶入測站 API。
   用法：BASE=http://localhost:3177 USER_=joyeadmin PASS_=xxx node test-weather-loc.js */
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findDD = (label) => `[...document.querySelectorAll('#cellPanel .b-dd')].find((d) => d.querySelector('.b-dd-value')?.textContent.trim() === ${JSON.stringify(label)})`;
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', process.env.USER_ || 'admin'); await page.type('#password', process.env.PASS_ || 'kiosk#2026'); await page.click('.btn-login');
  await page.waitForSelector('#mainView:not(.hidden)', { timeout: 10000 });
  await page.evaluate(() => window.setColorMode('light', false));
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '內容管理'), { timeout: 10000 });
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '內容管理').click(); });
  await page.waitForFunction(() => document.getElementById('wsModal').classList.contains('is-visible'), { timeout: 8000 });
  await sleep(600);
  // 舊資料：手打「臺北市」＋區「大安區」
  await page.evaluate(() => {
    page().blocks = [{ id: 1, w: 1, node: { ...DEFAULT_CELL(), content: 'Weather', wSrc: 'Standard', wAuto: false, wCounty: '臺北市', wDistrict: '大安區' } }];
    selected = { bi: 0, sub: null }; renderCanvas(); renderPanel();
  });
  await sleep(300);
  const st1 = await page.evaluate(() => ({ county: page().blocks[0].node.wCounty, district: page().blocks[0].node.wDistrict,
    dds: [...document.querySelectorAll('#cellPanel .b-dd .b-dd-value')].map((e) => e.textContent.trim()) }));
  console.log('舊資料對應', JSON.stringify(st1));
  await page.screenshot({ path: __dirname + '/shots/wloc-1-taipei.png' });
  // 換縣市 → 區清單跟著換、區清空
  await page.evaluate(() => { const s = [...document.querySelectorAll('#cellPanel select')].find((x) => x.value === '台北市'); s.value = '苗栗縣'; s.dispatchEvent(new Event('change')); });
  await sleep(300);
  const st2 = await page.evaluate(() => ({ county: page().blocks[0].node.wCounty, district: page().blocks[0].node.wDistrict,
    distOpts: [...[...document.querySelectorAll('#cellPanel select')].find((x) => x.value === '').options].map((o) => o.textContent).slice(0, 5) }));
  console.log('換苗栗縣', JSON.stringify(st2));
  await page.evaluate(`${findDD('全苗栗縣')}.querySelector('.b-dd-trigger').click()`); await sleep(300);
  await page.screenshot({ path: __dirname + '/shots/wloc-2-miaoli-open.png' });
  await page.evaluate(`${findDD('全苗栗縣')}.querySelector('.b-dd-trigger').click()`); await sleep(200);
  // 切園區測站 → 測站 API 自動帶入
  await page.evaluate(() => { [...document.querySelectorAll('#cellPanel button')].find((b) => b.textContent.trim() === '園區測站').click(); });
  await sleep(1500);
  const st3 = await page.evaluate(() => ({ src: page().blocks[0].node.wSrc, url: page().blocks[0].node.wStUrl,
    urlInput: document.querySelector('#cellPanel input[type=url]')?.value }));
  console.log('園區測站', JSON.stringify(st3));
  await page.screenshot({ path: __dirname + '/shots/wloc-3-station.png' });
  console.log('errors', JSON.stringify(errs));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
