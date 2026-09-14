const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 949 } });
  const page = await browser.newPage();
  await page.goto('http://localhost:3177/', { waitUntil: 'networkidle2' });
  await page.type('#username', 'joyeadmin'); await page.type('#password', 'joye#2026'); await page.click('.btn-login');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '內容管理'), { timeout: 10000 });
  await sleep(500);
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '內容管理').click(); });
  await page.waitForFunction(() => document.getElementById('wsModal').classList.contains('is-visible'));
  await sleep(500);
  await page.evaluate(() => document.querySelector('.ws-tabs [data-wstab="settings"]').click());
  await sleep(600);
  for (const fs of ['', 'boost']) {
    if (fs) { await page.evaluate(() => document.documentElement.setAttribute('data-fs', 'lg')); await sleep(300); }
    const r = await page.evaluate(() => {
      const out = {};
      out.htmlFs = document.documentElement.getAttribute('data-fs');
      for (const sel of ['#wsModal .b-modal', '#wsModal .b-modal-body', '#wsModal .ws-body', '#settingsTab', '#settingsBody']) {
        const el = document.querySelector(sel); if (!el) { out[sel] = null; continue; }
        const cs = getComputedStyle(el);
        out[sel] = { sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth, ov: cs.overflowY + '/' + cs.overflowX, canScroll: el.scrollHeight > el.clientHeight };
      }
      const body = document.querySelector('#wsModal .b-modal-body');
      const br = body.getBoundingClientRect();
      const limit = br.top + body.clientHeight - parseFloat(getComputedStyle(body).paddingBottom);
      const offenders = [];
      for (const el of body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect(); if (!r.height && !r.width) continue;
        if (r.bottom > br.top + body.clientHeight) offenders.push({ tag: el.tagName, cls: el.className && String(el.className).slice(0, 60), bottom: Math.round(r.bottom), bodyBottom: Math.round(br.top + body.clientHeight) });
      }
      out.offenders = offenders.slice(0, 10);
      return out;
    });
    console.log(fs || 'normal', JSON.stringify(r, null, 1));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
