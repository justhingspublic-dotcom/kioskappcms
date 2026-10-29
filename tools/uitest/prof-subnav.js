/* 進子頁那一下各段花多少時間（CPU=4）：包住 render 裡的幾個函式量同步時間。 */
const puppeteer = require('puppeteer-core');
const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin'); await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await page.click('#sharedGroupToggle'); await sleep(300);
  await page.click('[data-view="sharedLayout"]'); await sleep(600);
  await page.evaluate((open) => {
    setSparePop(!!open, true);
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const kinds = [{ content: 'Marquee', text: '歡迎蒞臨' }, { content: 'Text', text: '園區導覽', txtSize: 150 }, { content: 'Weather', wAuto: false, wCounty: '苗栗縣' }, { content: 'Text', text: '餐廳\n營業中' }];
    const mk = (i) => c({ ...kinds[i % kinds.length], bgColor: [4283315246, 4279060385, 4285353025, 4281545523][i % 4] });
    const row = (i) => ({ t: 'split', dir: 'Vertical', ratio: 0.5, a: mk(i), b: mk(i + 1) });
    const col = (n, i) => (n === 1 ? row(i) : { t: 'split', dir: 'Horizontal', ratio: 1 / n, a: row(i), b: col(n - 1, i + 2) });
    const tree = col(6, 0);
    tree.a.a = c({ ...tree.a.a, tap: 'OpenSubPage', sub: { name: '餐廳介紹', layout: 'Kiosk', node: col(6, 1) } });
    const L = { id: 9995, name: '量測', pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: tree }] }], screen: { w: 1080, h: 1920 } };
    (shared.layouts ||= []).push(L); enterSharedLayoutEditor(L);
  }, process.env.OPEN === '1');
  await sleep(1200);
  const cdp = await page.target().createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (let k = 0; k < 3; k++) {
    const r = await page.evaluate(async () => {
      const acc = {};
      const wrap = (name) => { const f = window[name]; if (!f || f._w) return; const g = function (...a) { const t = performance.now(); try { return f.apply(this, a); } finally { acc[name] = (acc[name] || 0) + performance.now() - t; } }; g._w = true; window[name] = g; return f; };
      // 只能包得到全域函式宣告（function xxx）：先換掉，量完換回
      const names = ['renderTabs', 'renderCanvas', 'renderTrail', 'renderSpareTray', 'buildCanvas', 'fitPreview', 'updateShowPageBtn', 'renderPanel', 'normalizePage', 'allSubs'];
      const orig = {}; names.forEach((n) => { orig[n] = window[n]; wrap(n); });
      const t0 = performance.now();
      selected = { bi: 0, path: 'aa' }; enterSub('aa');
      const total = performance.now() - t0;
      names.forEach((n) => { window[n] = orig[n]; });
      await new Promise((r) => setTimeout(r, 700));
      document.querySelector('#pageHead .ph-lead').click();
      await new Promise((r) => setTimeout(r, 700));
      return { total: Math.round(total), ...Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, Math.round(v)])) };
    });
    console.log(JSON.stringify(r));
  }
  await browser.close();
})();
