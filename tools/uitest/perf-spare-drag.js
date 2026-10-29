/* 從子頁收納匣拖縮圖滑過畫布格子的順暢度（CPU=4 模擬慢 4 倍的電腦）：拖曳期間每一格畫面的間隔。
   用法：node perf-spare-drag.js（BASE 預設本機 3177） */
const puppeteer = require('puppeteer-core');
const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const page = await browser.newPage();
  // PHOTO=1：格子改成照片背景＋模糊＋呼吸光（接近真實頁面），照片用使用說明的示範圖（攔 /files/demo-*.png）
  const path = require('path'), fs = require('fs');
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const m = req.url().match(/\/files\/(demo-[\w-]+\.png)/);
    const f = m && path.join(__dirname, 'manual-assets', m[1]);
    if (f && fs.existsSync(f)) return req.respond({ status: 200, contentType: 'image/png', body: fs.readFileSync(f) });
    return req.continue();
  });
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin'); await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await page.click('#sharedGroupToggle'); await sleep(300);
  await page.click('[data-view="sharedLayout"]'); await sleep(600);
  await page.evaluate((photo) => {
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const kinds = [{ content: 'Marquee', text: '歡迎蒞臨' }, { content: 'Text', text: '園區導覽', txtSize: 150 }, { content: 'Weather', wAuto: false, wCounty: '苗栗縣' }, { content: 'Text', text: '餐廳\n營業中' }];
    const imgs = ['/files/demo-indigo.png', '/files/demo-garden.png', '/files/demo-food.png', '/files/demo-event.png'];
    const mk = (i) => c({ ...kinds[i % kinds.length], bgColor: [4283315246, 4279060385, 4285353025, 4281545523][i % 4], ...(photo ? { bg: 'Image', bgImgs: [imgs[i % 4]], bgBlur: i % 3 === 0 ? 20 : 0, tap: 'OpenWeb', tapUrl: 'https://example.com', tapHint: 'Glow' } : {}) });
    const row = (i) => ({ t: 'split', dir: 'Vertical', ratio: 0.5, a: mk(i), b: mk(i + 1) });
    const col = (n, i) => (n === 1 ? row(i) : { t: 'split', dir: 'Horizontal', ratio: 1 / n, a: row(i), b: col(n - 1, i + 2) });
    const L = {
      id: 9993, name: '拖曳量測', pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: col(6, 0) }] }], screen: { w: 1080, h: 1920 },
      spareSubs: [{ id: 1, name: '餐廳介紹', node: col(3, 1), layout: 'Kiosk', from: '' }],
    };
    (shared.layouts ||= []).push(L); enterSharedLayoutEditor(L); setSparePop(true);
  }, !!Number(process.env.PHOTO || 0));
  await sleep(2500);
  const cdp = await page.target().createCDPSession();
  if (process.env.CPU) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU) });
  const p = await page.evaluate(() => { const r = document.querySelector('#sparePop .spare-item').getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
  const cv = await page.evaluate(() => { const r = document.querySelector('#canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.evaluate(() => {
    window.__ts = []; window.__on = true;
    const tick = (t) => { window.__ts.push(t); if (window.__on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + 10, p.y - 10, { steps: 3 });
  // 在畫布上來回畫 Z 字，跨過很多格
  for (let k = 0; k < 4; k++) {
    await page.mouse.move(cv.x + cv.w * 0.2, cv.y + cv.h * (0.1 + k * 0.2), { steps: 15 });
    await page.mouse.move(cv.x + cv.w * 0.8, cv.y + cv.h * (0.2 + k * 0.2), { steps: 15 });
  }
  const r = await page.evaluate(() => {
    window.__on = false;
    const ts = window.__ts;
    const gaps = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
    const pct = (q) => Math.round(gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))]);
    return { frames: ts.length, p50: pct(0.5), p90: pct(0.9), max: Math.round(gaps[gaps.length - 1]), over50: gaps.filter((g) => g > 50).length };
  });
  await page.mouse.up();
  console.log(JSON.stringify(r));
  await browser.close();
})();
