/* 子頁頂欄、園區資訊頂欄在 1080×1920 直立機上的樣子（KIOSK 標題放大 1.45 倍後排不排得下）。
   播放頁攔 API 餵假設定；測站資料直接抓 PARK_API（預設卓也）。用法：node shot-topbars.js（BASE 預設本機 3177） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const PARK_API = process.env.PARK_API || 'https://joye.justhings.com.tw/api/telemetry/current';
const OUT = path.join(__dirname, 'shots', 'topbars');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cfg = {
  activePage: 0, idleReturnSec: 60,
  pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: {
    t: 'split', dir: 'Horizontal', ratio: 0.5,
    a: { t: 'cell', bg: 'Solid', bgColor: 4285353025, content: 'Text', text: '餐廳', tap: 'OpenSubPage', sub: { name: '餐廳介紹', layout: 'Kiosk', node: { t: 'cell', bg: 'Solid', bgColor: 4283315246, content: 'Text', text: '藍染餐廳' } } },
    b: { t: 'cell', bg: 'Solid', bgColor: 4279060385, content: 'Text', text: '園區', tap: 'OpenParkInfo', wStUrl: PARK_API, parkHere: 'D2' },
  } }] }],
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const pp = await browser.newPage();
  const errs = [];
  pp.on('pageerror', (e) => errs.push(e.message));
  await pp.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 0.5 });
  await pp.setRequestInterception(true);
  pp.on('request', async (req) => {
    const u = req.url();
    const json = (o, delay = 0) => setTimeout(() => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(o) }).catch(() => {}), delay);
    if (/\/api\/station\/current/.test(u)) {
      try { const r = await fetch(PARK_API); return req.respond({ status: 200, contentType: 'application/json', body: await r.text() }); } catch { return json({ stations: [] }); }
    }
    if (/\/api\/config\/[^/]+\/version/.test(u)) return json({ version: 5 });
    if (/\/api\/config\/[^/]+\/wait/.test(u)) return json({ version: 5 }, 30000);
    if (/\/api\/config\/[^/?]+$/.test(u) && req.method() === 'GET') return json({ config: cfg, themeColor: '#0051A8' });
    if (/\/api\/config\//.test(u)) return json({ version: 5 });
    if (/\/api\/devices\/.+\/events/.test(u)) return json({ ok: true });
    return req.continue();
  });
  await pp.goto(BASE + '/play/?device=bars&key=test&id=web-bars', { waitUntil: 'domcontentloaded' });
  await pp.waitForSelector('.page.in .cell', { timeout: 15000 });
  await sleep(800);
  const tap = (t) => pp.evaluate((x) => [...document.querySelectorAll('.page.in .cell')].find((c) => c.textContent.includes(x)).click(), t);
  const bar = (sel) => pp.evaluate((s) => {
    const l = document.querySelector(s); const b = l.querySelector('.topbar'); const t = l.querySelector('.topbar-title');
    return { h: Math.round(b.getBoundingClientRect().height), title: t.textContent, fs: getComputedStyle(t).fontSize, overflow: t.scrollWidth > t.clientWidth };
  }, sel);
  await tap('餐廳'); await sleep(900);
  console.log('子頁', JSON.stringify(await bar('.sub-layer')));
  await pp.screenshot({ path: path.join(OUT, 'sub-kiosk-1080.png') });
  await pp.click('.sub-layer .sub-home'); await sleep(900);
  await tap('園區'); await sleep(4000);
  console.log('園區資訊', JSON.stringify(await bar('#overlay')));
  await pp.screenshot({ path: path.join(OUT, 'park-kiosk-1080.png') });
  await browser.close();
  console.log(errs.length ? errs : '沒有頁面錯誤');
})();
