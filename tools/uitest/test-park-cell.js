/* 格子不再問測站 API（2026-10-20 一套多場域用）：天氣格「園區測站」只選要看哪一站、點擊動作「園區資訊」只選目前位置與版面，
   目前位置的選項＝後台「共用設定 › 園區測站」放上地圖的站。只在頁面上建暫時的共用版面，不存。
   用法：node test-park-cell.js（BASE 預設本機 3177） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const OUT = path.join(__dirname, 'shots', 'parkinfo');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const errs = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin'); await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await sleep(800);
  await page.click('#sharedGroupToggle'); await sleep(300);
  await page.click('[data-view="sharedLayout"]'); await sleep(600);
  await page.evaluate(() => {
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const tree = { t: 'split', dir: 'Horizontal', ratio: 0.5, a: c({ content: 'Weather', wSrc: 'Station' }), b: c({ content: 'Text', text: '園區', tap: 'OpenParkInfo', parkHere: 'D2' }) };
    const L = { id: 9997, name: '測站格測試', pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: tree }] }], screen: { w: 1080, h: 1920 }, updatedAt: new Date().toISOString() };
    (shared.layouts ||= []).push(L);
    enterSharedLayoutEditor(L);
  });
  await sleep(900);
  const labels = () => page.$$eval('#cellPanel .sub-row, #cellPanel .row, #cellPanel label, #cellPanel .sub-label', (x) => x.map((e) => e.textContent.trim()).join('|'));
  await page.click('#canvas .cell[data-path="a"]'); await sleep(2500);
  const a = await page.evaluate(() => ({ text: document.getElementById('cellPanel').textContent, opts: [...document.querySelectorAll('#cellPanel select')].map((s) => [...s.options].map((o) => o.value)).find((v) => v.includes('D1')) || [] }));
  ok(!/測站 API/.test(a.text), '天氣格「園區測站」：沒有測站 API 欄位');
  ok(a.opts.includes('D3'), `天氣格：測站下拉讀得到這個場域的測站（${a.opts.join(',')}）`);
  await page.screenshot({ path: path.join(OUT, '20-cell-weather.png') });
  await page.click('#canvas .cell[data-path="b"]'); await sleep(600);
  const b = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('#cellPanel select')].find((s) => [...s.options].some((o) => o.textContent.startsWith('D1')));
    return { text: document.getElementById('cellPanel').textContent, here: sel ? [...sel.options].map((o) => o.textContent) : [] };
  });
  ok(!/測站 API/.test(b.text), '點擊動作「園區資訊」：沒有測站 API 欄位');
  ok(b.here.length === 6 && b.here[0] === '無' && b.here.includes('D3 不差的花園'), `目前位置＝地圖上的測站（${b.here.join('、')}）`);
  await page.screenshot({ path: path.join(OUT, '21-cell-parktap.png') });

  // 園區測站不能用（2026-10-20 user）：沒設資料來源／連不上 → 選項變灰；已經設了的那一塊變灰、寫原因、設定保留（只改頁面上的 PARK_API，不存）
  const realApi = await page.evaluate(() => PARK_API);
  const st = () => page.evaluate(() => {
    const p = document.getElementById('cellPanel');
    const seg = [...p.querySelectorAll('.seg')].find((b) => b.textContent === '園區測站');
    return {
      badges: [...p.querySelectorAll('.b-dd-trigger .b-dd-badge, .ins-ctrl > .park-src-badge')].map((b) => b.textContent).join('|'),
      long: p.querySelectorAll('.park-warn').length,
      grey: p.querySelectorAll('.ins-row.is-unavail').length,
      locked: [...p.querySelectorAll('.ins-row.is-unavail :is(select, input, textarea, .seg)')].every((x) => x.disabled),
      opts: [...p.querySelectorAll('select option')].filter((o) => /^園區資訊/.test(o.textContent)).map((o) => [o.textContent, o.disabled, o.dataset.badge || '']),
      seg: seg ? { off: seg.disabled, on: seg.classList.contains('active') } : null,
      here: (getCell(selected) || {}).parkHere,
    };
  });
  await page.evaluate(() => { PARK_API = ''; renderCanvas(); renderPanel(); }); await sleep(500);
  let s = await st();
  ok(s.grey >= 3 && s.locked && s.badges === '未設定' && !s.long && s.here === 'D2', `沒有資料來源：點擊動作「園區資訊」整塊變灰、下拉選單上掛小標、設定保留（${s.grey} 列、${s.badges}）`);
  ok(await page.$eval('#canvas .cell[data-path="b"]', (c) => !c.querySelector('.pv-park-btn')), '預覽：那一格不顯示「點我查看」（同展示機）');
  await page.evaluate(() => document.querySelector('#cellPanel .b-dd-trigger .b-dd-badge')?.closest('.ins-full, .ins-row')?.scrollIntoView({ block: 'center' })); await sleep(300);
  await page.screenshot({ path: path.join(OUT, '22-cell-parktap-unavail.png') });
  await page.click('#canvas .cell[data-path="a"]'); await sleep(600);
  s = await st();
  ok(s.seg && s.seg.on && !s.seg.off && s.grey >= 1 && s.badges === '未設定' && !s.long, `沒有資料來源：天氣格「園區測站」那一塊變灰、來源旁掛小標（${s.badges}）`);
  ok(s.opts.length === 2 && s.opts.every(([t, d, b]) => t === '園區資訊' && d && b === '未設定'), `沒有資料來源：內容／點擊動作的「園區資訊」變灰不能選、帶小標（${JSON.stringify(s.opts)}）`);
  await page.evaluate(() => document.querySelector('#cellPanel .ins-ctrl > .park-src-badge')?.closest('.ins-row')?.scrollIntoView({ block: 'center' })); await sleep(300);
  await page.screenshot({ path: path.join(OUT, '23-cell-weather-unavail.png') });
  await page.evaluate(() => { getCell(selected).wSrc = 'Standard'; renderPanel(); }); await sleep(400);
  s = await st();
  ok(s.seg && s.seg.off && !s.seg.on && s.grey === 0, '沒有資料來源：一般天氣的格子「園區測站」那一段變灰不能選');
  // 連不上：一樣變灰，原因不同
  await page.evaluate(() => { getCell(selected).wSrc = 'Station'; PARK_API = 'https://example.invalid/api/telemetry/current'; renderCanvas(); renderPanel(); });
  await page.waitForFunction(() => /連線失敗/.test([...document.querySelectorAll('#cellPanel .b-badge')].map((w) => w.textContent).join()), { timeout: 20000 }).catch(() => {});
  s = await st();
  ok(s.badges === '連線失敗' && s.grey >= 1 && s.opts.every(([, d, b]) => d && b === '連線失敗'), `連不上資料來源：一樣變灰、小標寫「連線失敗」（${s.badges}）`);
  await page.evaluate(() => document.querySelector('#cellPanel .ins-ctrl > .park-src-badge')?.closest('.ins-row')?.scrollIntoView({ block: 'center' })); await sleep(300);
  await page.screenshot({ path: path.join(OUT, '24-cell-unreachable.png') });
  await page.evaluate((u) => { PARK_API = u; renderCanvas(); renderPanel(); }, realApi); await sleep(1500);
  s = await st();
  ok(s.grey === 0 && !s.badges && s.opts.every(([, d, b]) => !d && !b), '資料來源恢復：恢復正常');
  await browser.close();
  console.log(errs.length ? errs : '沒有頁面錯誤');
  console.log(`\n${pass} 通過，${fail} 失敗`);
  process.exit(fail || errs.length ? 1 : 0);
})();
