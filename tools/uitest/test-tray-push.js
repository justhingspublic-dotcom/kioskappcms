/* 收納匣收起＝正方形、打開往左長把頁籤推開（2026-10-29 user）：推開／收回的整段過程頁籤不能位移、箭頭不能一進一出；
   每一格畫面量一次頁籤位置。只改本機畫面、不存檔（攔 PUT）。用法：node test-tray-push.js（BASE 預設本機 3177） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.method() === 'PUT' ? r.respond({ status: 200, contentType: 'application/json', body: '{}' }) : r.continue()));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin');
  await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await sleep(400);
  await page.evaluate(async () => { const l = await api('GET', '/api/devices'); await enterWorkspace(l.find((x) => /^1\.6/.test(x.LastAppVersion || '')) || l[0]); });
  await sleep(1000);
  const setup = (names, scrollEnd) => page.evaluate((ns, end) => {
    wsAppVer = '1.60';
    state.config.pages = ns.map((name, i) => ({ id: i + 1, name, blocks: [{ id: 1, w: 1, node: DEFAULT_CELL() }] }));
    state.config.spareSubs = [{ id: 1, name: '餐廳介紹', node: DEFAULT_CELL(), layout: 'Kiosk', from: '' }];
    pageIndex = ns.length - 1; subStack = []; spareEdit = 0; render();
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const tr = document.querySelector('.page-tabs-track');
      if (end) tr.scrollLeft = tr.scrollWidth;
      r();
    })));
  }, names, scrollEnd);
  // 按一下鈕，接下來 600ms 每一格量：每個頁籤的左緣、箭頭有沒有出現、鈕寬
  const run = () => page.evaluate(() => new Promise((resolve) => {
    const frames = [];
    const t0 = performance.now();
    const snap = () => ({
      tabs: [...document.querySelectorAll('#pageTabs .tab')].map((t) => Math.round(t.getBoundingClientRect().left * 2) / 2),
      over: document.getElementById('pageTabs').classList.contains('is-overflow'),
      btn: Math.round(document.getElementById('spareBtn').getBoundingClientRect().width),
    });
    frames.push(snap());
    document.getElementById('spareBtn').click();
    const tick = () => { frames.push(snap()); if (performance.now() - t0 < 600) requestAnimationFrame(tick); else resolve(frames); };
    requestAnimationFrame(tick);
  }));
  const still = (fr) => fr.every((f) => f.over === fr[0].over && f.tabs.every((x, i) => Math.abs(x - fr[0].tabs[i]) < 0.6));

  for (const [label, names, end] of [
    ['頁籤不多（不會超出）', ['頁面 1', '手機', '卓也小屋22'], false],
    ['頁籤很多、捲到最後一個', ['頁面 1', '手機', '卓也小屋22', '宜蘭傳藝', '頁面 5', '頁面 6', '頁面 7'], true],
    ['八個長名稱、收起時就超出、捲到最後', ['卓也小屋主頁一', '卓也小屋主頁二', '卓也小屋主頁三', '卓也小屋主頁四', '卓也小屋主頁五', '卓也小屋主頁六', '卓也小屋主頁七', '卓也小屋主頁八'], true],
    ['頁籤剛好塞滿（推開才會超出）', ['頁面 1', '手機', '卓也小屋22', '宜蘭傳藝', '頁面 5'], false],
  ]) {
    console.log(label);
    await setup(names, end);
    await sleep(300);
    const open = await run();
    const last = open[open.length - 1];
    ok(open[0].btn === 48 && last.btn === 220, `鈕 ${open[0].btn} → ${last.btn}`);
    ok(still(open), `打開：頁籤不位移、箭頭不變（${open.length} 格畫面，箭頭 ${open[0].over ? '有' : '無'}）`);
    await sleep(200);
    const close = await run();
    ok(close[close.length - 1].btn === 48, '收起：回到正方形');
    ok(still(close), `收起：頁籤不位移、箭頭不變（${close.length} 格畫面）`);
  }
  ok(!errs.length, '沒有 JS 錯誤' + (errs.length ? '：' + errs.join(' | ') : ''));
  console.log(`\n${pass} 通過、${fail} 失敗`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
