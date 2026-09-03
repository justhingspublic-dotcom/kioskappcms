/* 表格頁固定高模型實測：整頁不捲、表格內滾、thead 釘住、內滾無捲軌；
   機器設定（卡片頁）維持整頁捲。預設打 mock :3100（12 台機器才能觸發內滾）。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = path.join(__dirname, 'shots', 'fixed-h');
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
    headless: 'new', defaultViewport: { width: 1440, height: 700 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', 'admin');
  await page.type('#password', 'kiosk#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await sleep(500);

  // 機器總覽：整頁不捲、表格內滾
  check('文件層不捲（html overflow hidden）', await page.evaluate(() =>
    getComputedStyle(document.documentElement).overflow === 'hidden'));
  check('頁面無垂直捲動量', await page.evaluate(() =>
    document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1));
  const tbl = await page.evaluate(() => {
    const el = document.querySelector('#devicesView .b-tbl-scroll');
    const cs = getComputedStyle(el);
    const borders = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    return {
      innerScroll: el.scrollHeight > el.clientHeight,
      barSpace: el.offsetWidth - borders - el.clientWidth,
      bottomInView: el.getBoundingClientRect().bottom <= window.innerHeight + 1,
    };
  });
  check('表格觸發內滾', tbl.innerScroll);
  check('內滾無捲軌占位', tbl.barSpace === 0, 'barSpace=' + tbl.barSpace);
  check('表格框收在視窗內', tbl.bottomInView);
  await page.screenshot({ path: path.join(OUT, '01-devices-top.png') });

  // thead sticky：內滾 300px 後表頭仍在容器頂
  const sticky = await page.evaluate(() => {
    const el = document.querySelector('#devicesView .b-tbl-scroll');
    el.scrollTop = 300;
    const th = el.querySelector('thead th');
    return { scrolled: el.scrollTop, thTop: Math.round(th.getBoundingClientRect().y - el.getBoundingClientRect().y) };
  });
  await sleep(200);
  check('內滾後 thead 釘在容器頂', sticky.scrolled > 0 && sticky.thTop <= 2, JSON.stringify(sticky)); // 1px＝容器邊框
  await page.screenshot({ path: path.join(OUT, '02-devices-innerscrolled.png') });

  // 版面設定＋帳號管理：固定高模型也生效
  await page.click('#sharedGroupToggle');
  await sleep(350);
  await page.click('[data-view="sharedLayout"]');
  await sleep(500);
  check('版面設定：文件層不捲', await page.evaluate(() =>
    getComputedStyle(document.documentElement).overflow === 'hidden'));
  await page.click('[data-view="users"]');
  await sleep(500);
  check('帳號管理：文件層不捲', await page.evaluate(() =>
    getComputedStyle(document.documentElement).overflow === 'hidden'));
  check('帳號管理：新增帳號卡可見（表格內滾不吃掉它）', await page.evaluate(() => {
    const r = document.querySelector('.adduser-card').getBoundingClientRect();
    return r.bottom <= window.innerHeight + 1 && r.height > 0;
  }));
  await page.screenshot({ path: path.join(OUT, '03-users.png') });

  // 機器設定：卡片頁維持整頁捲（不套固定高）
  await page.click('[data-view="sharedSettings"]');
  await sleep(500);
  check('機器設定：文件層可捲（不套固定高）', await page.evaluate(() =>
    getComputedStyle(document.documentElement).overflow !== 'hidden'));

  console.log('\nconsole errors:', errs.length ? errs : '(none)');
  const pass = results.filter(Boolean).length;
  console.log(`${pass}/${results.length} passed`);
  await browser.close();
  process.exit(pass === results.length && !errs.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
