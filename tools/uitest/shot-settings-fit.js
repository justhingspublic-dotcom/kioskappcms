/* 機器設定頁籤在工作區 modal 內不該捲：量 .ws-body scrollHeight vs clientHeight（2026-09-14）。
   用法：BASE=http://localhost:3177 node shot-settings-fit.js */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3177/';
const OUT = path.join(__dirname, 'shots', 'settings-fit');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--window-size=1512,949'], defaultViewport: { width: 1512, height: 949 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('#username', { visible: true });
  await page.type('#username', 'joyeadmin'); await page.type('#password', 'joye#2026');
  await page.click('.btn-login');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '內容管理'), { timeout: 10000 });
  await sleep(500);
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '內容管理').click(); });
  await page.waitForFunction(() => document.getElementById('wsModal').classList.contains('is-visible'), { timeout: 8000 });
  await sleep(500);
  await page.evaluate(() => document.querySelector('.ws-tabs [data-wstab="settings"]').click());
  await sleep(500);
  const m = await page.evaluate(() => {
    const body = document.querySelector('#wsModal .ws-body');
    const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; };
    return { scrollH: body.scrollHeight, clientH: body.clientHeight, overflow: body.scrollHeight - body.clientHeight,
      pin: box("#settingsBody > .settings-card:nth-child(3)"), idle: box("#settingsBody > .settings-card:nth-child(4)"), dz: box('.danger-zone-sec') };
  });
  console.log(JSON.stringify(m));
  await page.screenshot({ path: path.join(OUT, '01-settings.png') });
  const hb = await page.$('.danger-zone .page-help-btn'); if (hb) { await hb.hover(); await sleep(400); await page.screenshot({ path: path.join(OUT, '02-dz-help.png'), clip: { x: 280, y: 600, width: 960, height: 300 } }); }
  console.log(errs);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
