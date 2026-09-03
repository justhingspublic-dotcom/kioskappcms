/* 工作區 modal：固定尺寸（切頁籤不跳）＋標題列釘頂實測。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'shots', 'modal-fixed');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, extra) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const modalRect = () => page.evaluate(() => {
    const r = document.querySelector('#wsModal .b-modal').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  const headRect = () => page.evaluate(() => {
    const r = document.querySelector('#wsModal .b-modal-head').getBoundingClientRect();
    return { y: Math.round(r.y), h: Math.round(r.height) };
  });

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', 'admin');
  await page.type('#password', 'kiosk#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await sleep(400);

  // 列＝純資訊：hover 無變色、游標非 pointer、點列不開 modal
  const rowSel = '#deviceTable tbody tr';
  const bgBefore = await page.evaluate((s) => getComputedStyle(document.querySelector(s + ' td')).backgroundColor, rowSel);
  await page.hover(rowSel + ' td');
  await sleep(250);
  const bgHover = await page.evaluate((s) => getComputedStyle(document.querySelector(s + ' td')).backgroundColor, rowSel);
  check('hover 列不變色', bgBefore === bgHover, `${bgBefore} → ${bgHover}`);
  check('列游標非 pointer', await page.evaluate((s) => getComputedStyle(document.querySelector(s)).cursor !== 'pointer', rowSel));
  await page.click(rowSel + ' td');   // 點名稱格
  await sleep(500);
  check('點列不開 modal', await page.evaluate(() => !$('wsModal').classList.contains('is-visible')));

  // 進工作區：唯一入口＝內容管理鈕
  await page.click('#deviceTable .device-ops button');
  await sleep(800);
  check('內容管理鈕開 modal', await page.evaluate(() => $('wsModal').classList.contains('is-visible')));
  const r1 = await modalRect();
  await shot('01-layout-tab');

  // 切機器設定 → 尺寸必須一模一樣
  await page.click('.ws-tabs [data-wstab="settings"]');
  await sleep(500);
  const r2 = await modalRect();
  check('切機器設定後尺寸不變', r1.w === r2.w && r1.h === r2.h && r1.y === r2.y,
    `layout=${JSON.stringify(r1)} settings=${JSON.stringify(r2)}`);
  await shot('02-settings-tab');

  // 切回版面
  await page.click('.ws-tabs [data-wstab="layout"]');
  await sleep(400);
  const r3 = await modalRect();
  check('切回版面尺寸不變', r1.w === r3.w && r1.h === r3.h, JSON.stringify(r3));

  // 捲動 body → 標題列位置不動、內容真的在捲
  const h1 = await headRect();
  const scrolled = await page.evaluate(() => {
    const b = document.querySelector('#wsModal .b-modal-body');
    b.scrollTop = 400;
    return b.scrollTop;
  });
  await sleep(300);
  const h2 = await headRect();
  check('body 可捲動', scrolled > 0, 'scrollTop=' + scrolled);
  check('捲動後標題列釘在原位', h1.y === h2.y && h1.h === h2.h, `before=${JSON.stringify(h1)} after=${JSON.stringify(h2)}`);
  check('儲存鈕捲動後仍可見', await page.evaluate(() => {
    const r = document.querySelector('#saveBtn').getBoundingClientRect();
    return r.y > 0 && r.y < 200 && r.width > 0;
  }));
  await shot('03-scrolled-head-pinned');

  // 收尾：Esc 關
  await page.keyboard.press('Escape');
  await sleep(400);
  check('Esc 關 modal', await page.evaluate(() => !$('wsModal').classList.contains('is-visible')));

  console.log('\nconsole errors:', errs.length ? errs : '(none)');
  const pass = results.filter(Boolean).length;
  console.log(`${pass}/${results.length} passed`);
  await browser.close();
  process.exit(pass === results.length && !errs.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
