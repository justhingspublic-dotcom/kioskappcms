/* 進出子頁轉場的順暢度：按下「編輯子頁」與標頭 ← 之後 600ms 內每一格畫面的間隔（理想 16.7ms；headless 上限約 31ms），
   滑動期間與滑完之後分開印最長一格。版面用 12 格（文字＋天氣＋跑馬燈）模擬真實頁面。
   用法：node perf-subnav.js（BASE 預設本機 3177；CPU=4 模擬慢 4 倍的電腦） */
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
  await page.evaluate(() => {
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const kinds = [{ content: 'Marquee', text: '歡迎蒞臨　今日開園 09:00 – 17:30' }, { content: 'Text', text: '園區導覽', txtSize: 150 }, { content: 'Weather', wAuto: false, wCounty: '苗栗縣' }, { content: 'Text', text: '餐廳\n營業中' }];
    const mk = (i) => c({ ...kinds[i % kinds.length], bgColor: [4283315246, 4279060385, 4285353025, 4281545523][i % 4] });
    const row = (i) => ({ t: 'split', dir: 'Vertical', ratio: 0.5, a: mk(i), b: mk(i + 1) });
    const col = (n, i) => (n === 1 ? row(i) : { t: 'split', dir: 'Horizontal', ratio: 1 / n, a: row(i), b: col(n - 1, i + 2) });
    const tree = col(6, 0);
    const sub = { name: '餐廳介紹', layout: 'Kiosk', node: col(6, 1) };
    tree.a.a = c({ ...tree.a.a, tap: 'OpenSubPage', sub });
    const L = { id: 9996, name: '轉場量測', pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: tree }] }], screen: { w: 1080, h: 1920 } };
    (shared.layouts ||= []).push(L); enterSharedLayoutEditor(L);
  });
  await sleep(1200);
  const cdp = await page.target().createCDPSession();
  if (process.env.CPU) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU) });
  const measure = (label, action) => page.evaluate(async (act) => {
    const ts = [];
    let on = true;
    const tick = (t) => { ts.push(t); if (on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    await new Promise((r) => setTimeout(r, 50));
    const t0 = performance.now();
    if (act === 'enter') { selected = { bi: 0, path: 'aa' }; enterSub('aa'); } else { document.querySelector('#pageHead .ph-lead').click(); }
    const t1 = performance.now();
    await new Promise((r) => setTimeout(r, 600));
    on = false;
    const after = ts.filter((t) => t >= t0 - 1);
    const gaps = after.slice(1).map((t, i) => t - after[i]);
    // 滑動期間（按下後 ~430ms）跟滑完之後分開算：滑完才重建面板，那一格慢不影響滑動
    const during = after.slice(1).map((t, i) => [after[i], t - after[i]]).filter(([s]) => s < t0 + 430).map(([, g]) => g);
    const later = gaps.slice(during.length);
    return { sync: Math.round(t1 - t0), slideMax: Math.round(Math.max(...during)), slideOver50: during.filter((g) => g > 50).length, afterMax: Math.round(Math.max(0, ...later)), first3: gaps.slice(0, 3).map(Math.round) };
  }, action).then((r) => console.log(label, JSON.stringify(r)));
  for (let i = 0; i < 3; i++) { await measure('進子頁', 'enter'); await sleep(400); await measure('回主頁', 'leave'); await sleep(400); }
  await browser.close();
})();
