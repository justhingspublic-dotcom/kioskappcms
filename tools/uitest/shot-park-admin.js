/* 園區測站後台頁截圖（2026-10-20）：重新整理停在 #parkInfo 也畫得出清單、空狀態撐滿、兩張卡同高、機器設定動作列貼底。
   用法：node shot-park-admin.js（BASE 預設本機 3177；W／H 視窗大小，預設 1512×828） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const W = +process.env.W || 1512, H = +process.env.H || 828;
const OUT = path.join(__dirname, 'shots', 'parkinfo');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: W, height: H } });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin'); await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await page.goto(BASE + '/#parkInfo', { waitUntil: 'networkidle2' });
  await sleep(1500);
  ok(await page.$$eval('#parkBody .park-st-tabs .seg', (r) => r.length) === 5, '重新整理停在園區測站：測站頁籤畫得出來（不會卡在「沒有園區測站」）');
  const fit = await page.evaluate(() => { const c = document.querySelector('#parkBody .park-card').getBoundingClientRect(), m = document.querySelector('.park-map-edit').getBoundingClientRect(); return { cardBottom: Math.round(innerHeight - c.bottom), mapH: Math.round(m.height), doc: document.scrollingElement.scrollHeight <= innerHeight + 1 }; });
  ok(fit.cardBottom < 60 && fit.mapH > 300 && fit.doc, `一張卡撐滿畫面、地圖用滿右半邊、頁面不捲（${JSON.stringify(fit)}）`);
  const pad = await page.evaluate(() => {
    const p = document.querySelector('.park-map-pane').getBoundingClientRect(), m = document.querySelector('.park-map-edit').getBoundingClientRect(), b = document.querySelector('.park-map-bar').getBoundingClientRect();
    return { left: Math.round(m.left - p.left - 1), right: Math.round(p.right - m.right), top: Math.round(b.top - p.top), bottom: Math.round(p.bottom - m.bottom) }; // 左邊扣掉 1px 分隔線；按鈕列在地圖上方
  });
  ok(Math.abs(pad.left - pad.top) <= 2 && Math.abs(pad.right - pad.top) <= 2 && Math.abs(pad.bottom - pad.top) <= 2, `地圖區寬度跟著圖片：四周留白一樣（${JSON.stringify(pad)}）`);
  const misc = await page.evaluate(() => {
    const f = getComputedStyle(document.querySelector('.park-card > .settings-foot')), d = getComputedStyle(document.getElementById('parkDesc'));
    return { line: f.borderTopWidth + ' ' + f.borderTopStyle, resize: d.resize, scroll: d.overflowY };
  });
  ok(misc.line === '1px solid' && misc.resize === 'none' && misc.scroll === 'auto', `儲存那一列上面有分隔線、說明不能拉伸改內捲（${JSON.stringify(misc)}）`);
  await page.screenshot({ path: path.join(OUT, `10-admin-${W}.png`) });
  // 空狀態（沒有測站來源的站台，例如揚昇）
  await page.evaluate(() => { shared.parkInfo = { ...shared.parkInfo, api: '' }; renderParkInfoView(); }); // 只改頁面上的副本，不存
  await sleep(500);
  const e = await page.evaluate(() => { const c = document.querySelector('#parkBody > .park-empty'); const b = document.getElementById('parkBody').getBoundingClientRect(); const r = c && c.getBoundingClientRect(); return r && { w: Math.round(r.width - b.width), bottom: Math.round(innerHeight - r.bottom) }; });
  ok(e && Math.abs(e.w) <= 1 && e.bottom < 60, `空狀態撐滿寬高（${JSON.stringify(e)}）`);
  await page.screenshot({ path: path.join(OUT, `11-admin-empty-${W}.png`) });
  // 資料來源連不上：照目前的連線狀態顯示空狀態，不列存過的站（只改頁面上的變數，不存）
  await page.evaluate(() => { shared.parkInfo = { ...shared.parkInfo, api: 'https://example.invalid/x' }; parkStations = []; parkStationsErr = '找不到這個網址。請確認網址是否正確。'; renderParkInfoView(); });
  await sleep(1400);
  const cf = await page.evaluate(() => {
    const e = document.querySelector('#parkBody > .park-empty');
    const btn = e && e.querySelector('button'), icon = e && e.querySelector('.b-empty-icon');
    return { tabs: !!document.querySelector('#parkBody .park-st-tabs'), map: !!document.querySelector('#parkBody .park-map-edit'), text: e ? e.textContent : '', red: !!(e && e.classList.contains('is-danger')),
      iconColor: icon && getComputedStyle(icon).color, btnRed: !!(btn && btn.classList.contains('b-btn-text-danger')), halves: !!(icon && icon.querySelector('g.unplug-plug') && icon.querySelector('g.unplug-socket')) };
  });
  ok(!cf.tabs && !cf.map && /無法連線到測站資料來源/.test(cf.text) && !/找不到這個網址/.test(cf.text) && /設定資料來源/.test(cf.text), `連線失敗＝空狀態、不列存過的站、不放原因說明（${cf.text}）`);
  ok(cf.red && cf.btnRed && cf.halves, `連線失敗：紅色圖示（插頭拔開動畫）＋紅色「設定資料來源」（${JSON.stringify(cf)}）`);
  await page.screenshot({ path: path.join(OUT, `13-admin-connfail-${W}.png`) });
  await page.evaluate(() => { shared.parkInfo = { ...shared.parkInfo, api: '' }; renderParkInfoView(); }); await sleep(300);
  ok(await page.evaluate(() => { const e = document.querySelector('#parkBody > .park-empty'); return !!e && !e.querySelector('.b-empty-sub') && /尚未設定測站資料來源/.test(e.textContent); }), '沒設資料來源的空狀態：不放「先按右上角…」那段說明');
  await page.goto(BASE + '/#sharedSettings', { waitUntil: 'networkidle2' });
  await sleep(1500);
  const foot = await page.evaluate(() => { const c = document.querySelector('#sharedBody .settings-card'); const f = c.querySelector('.settings-foot'); return Math.round(c.getBoundingClientRect().bottom - f.getBoundingClientRect().bottom); });
  ok(foot <= 2, `機器設定：申請帳號／測試連線貼卡片底部（差 ${foot}px）`);
  await page.screenshot({ path: path.join(OUT, `12-shared-settings-${W}.png`) });
  await browser.close();
  console.log(errs.length ? errs : '沒有頁面錯誤');
  console.log(`\n${pass} 通過，${fail} 失敗`);
  process.exit(fail || errs.length ? 1 : 0);
})();
