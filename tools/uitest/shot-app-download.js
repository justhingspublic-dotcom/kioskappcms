/* 「下載 App」視窗截圖（2026-10-13 寬版）：登入本機後台，攔下 /api/app/releases/latest 改餵指定的版本資訊（不碰更新頻道）。
   用法：BASE=http://localhost:3177 RELEASE=<release.json> node shot-app-download.js → shots/app-download/{1512x828,1100x760,600x900}.png */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3177/';
const OUT = path.join(__dirname, 'shots', 'app-download');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const release = JSON.parse(fs.readFileSync(process.env.RELEASE, 'utf8'));

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const errs = [];
  for (const [w, h] of [[1512, 828], [1100, 760], [600, 900]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes('/api/app/releases/latest')) return req.respond({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(release) });
      req.continue();
    });
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
    if (await page.$('#username')) {
      await page.type('#username', 'joyeadmin'); await page.type('#password', 'joye#2026');
      await page.click('.btn-login');
      await page.waitForSelector('#appDownloadBtn', { visible: true, timeout: 10000 });
    }
    await sleep(800);
    await page.evaluate(() => document.querySelectorAll('.b-toast').forEach((t) => t.remove()));
    await page.click('#appDownloadBtn');
    await page.waitForSelector('#appDownloadDetails:not([hidden])', { timeout: 8000 });
    await sleep(500);
    const m = await page.evaluate(() => {
      const r = document.querySelector('#appDownloadModal .b-modal').getBoundingClientRect(), b = document.querySelector('#appReleaseNotes');
      return { w: Math.round(r.width), h: Math.round(r.height), scrolls: b.scrollHeight > b.clientHeight + 1, titles: [...document.querySelectorAll('.app-note-title')].map((t) => t.textContent) };
    });
    console.log(`${w}x${h}`, JSON.stringify(m));
    await page.screenshot({ path: path.join(OUT, `${w}x${h}.png`) });
    await page.evaluate(() => { const n = document.getElementById('appReleaseNotes'); n.scrollTop = (n.scrollHeight - n.clientHeight) / 2; }); await sleep(200);
    await page.screenshot({ path: path.join(OUT, `${w}x${h}-scrolled.png`) });
    await page.close();
  }
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await browser.close();
})();
