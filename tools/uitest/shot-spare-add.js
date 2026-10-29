/* 截圖：收納匣「新增子頁」跟標題鈕、卡片的字級比對（2026-10-29 user：新增鈕字級不協調），2 倍解析度，PUT 一律攔下不存檔。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const OUT = process.env.OUT || path.join(__dirname, 'shots', 'spare');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828, deviceScaleFactor: 2 } });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (r) => (['PUT', 'POST', 'DELETE'].includes(r.method()) && !/login/.test(r.url()) ? r.respond({ status: 200, contentType: 'application/json', body: '{}' }) : r.continue()));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin');
  await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await sleep(500);
  await page.evaluate(async () => { const list = await api('GET', '/api/devices'); await enterWorkspace(list.find((x) => /^1\.6/.test(x.LastAppVersion || '')) || list[0]); });
  await sleep(1200);
  await page.evaluate(() => {
    wsAppVer = '1.60';
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    state.config.spareSubs = ['餐廳介紹', '菜單', '交通接駁'].map((name, i) => ({ id: i + 1, name, node: c({ bgColor: [4283321390, 4284367411, 4280693304][i] }), layout: 'Kiosk', from: '' }));
    render();
  });
  if (process.env.CSS) await page.addStyleTag({ content: process.env.CSS }); // 試別的樣子用
  await sleep(300);
  await page.evaluate(() => setSparePop(true));
  await sleep(900);
  const info = await page.evaluate(() => {
    const f = (el) => { const s = getComputedStyle(el); return `${s.fontSize} ${s.fontWeight} h${Math.round(el.getBoundingClientRect().height)}`; };
    const add = document.getElementById('spareAddBtn');
    const r = (el) => el.getBoundingClientRect();
    const svg = r(add.querySelector('svg')), thumb = r(document.querySelector('#sparePop .spare-thumb'));
    return { title: f(document.getElementById('spareBtn')), add: f(add), addSvg: Math.round(svg.width), name: f(document.querySelector('#sparePop .spare-item-name')), where: f(document.querySelector('#sparePop .spare-item-where')), hint: f(document.querySelector('.spare-pop-hint')),
      // 對齊：＋的中心 vs 縮圖中心、字的左緣 vs 卡片名稱左緣
      plusVsThumb: (svg.left + svg.width / 2 - (thumb.left + thumb.width / 2)).toFixed(1), textVsName: (r(add.querySelector('span')).left - r(document.querySelector('#sparePop .spare-item-name')).left).toFixed(1) };
  });
  console.log(JSON.stringify(info));
  const clipOf = () => page.evaluate(() => { const b = document.getElementById('sparePop').getBoundingClientRect(); return { x: b.left - 20, y: b.top - 20, width: b.width + 40, height: b.height + 40 }; });
  const name = process.env.NAME || 'add.png';
  await page.screenshot({ path: path.join(OUT, name), clip: await clipOf() });
  if (process.env.ALL) {
    await page.hover('#spareAddBtn'); await sleep(250);
    await page.screenshot({ path: path.join(OUT, name.replace('.png', '-hover.png')), clip: await clipOf() });
    await page.mouse.move(5, 5);
    await page.evaluate(() => document.documentElement.setAttribute('data-color-mode', 'dark')); await sleep(400);
    await page.screenshot({ path: path.join(OUT, name.replace('.png', '-dark.png')), clip: await clipOf() });
    await page.evaluate(() => { document.documentElement.setAttribute('data-color-mode', 'light'); state.config.spareSubs = []; render(); }); await sleep(500);
    await page.screenshot({ path: path.join(OUT, name.replace('.png', '-empty.png')), clip: await clipOf() });
  }
  await browser.close();
})();
