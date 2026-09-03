/* 機器總覽「標題旁小問號說明」實測：hover 展開、hover 橋不斷線、移開收合、
   點擊釘住、Esc 關、深色模式。BASE 預設打真後台 :3000。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'shots', 'help-pop');
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
    headless: 'new',
    args: ['--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const panelVisible = () => page.evaluate(() => {
    const p = document.querySelector('#devicesView .page-help .b-pop-panel');
    if (!p) return false;
    const s = getComputedStyle(p);
    return s.visibility === 'visible' && parseFloat(s.opacity) > .9;
  });

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('#username', { visible: true });
  await page.type('#username', 'admin');
  await page.type('#password', 'kiosk#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#devicesView:not(.hidden)', { timeout: 10000 });
  await sleep(600);

  check('問號鈕渲染在標題旁', await page.evaluate(() => {
    const b = document.querySelector('#devicesView .page-help-btn');
    return !!(b && b.querySelector('svg') && b.getBoundingClientRect().width > 0);
  }));
  check('預設面板收起', !(await panelVisible()));
  check('舊 table-note 已移除', await page.evaluate(() => !document.querySelector('#devicesView .table-note')));
  await shot('01-default');

  // hover → 展開
  await page.hover('#devicesView .page-help-btn');
  await sleep(300);
  check('hover 問號 → 面板展開', await panelVisible());
  await shot('02-hover-open');

  // hover 橋：滑鼠移進面板本體，途中不斷線
  const box = await page.evaluate(() => {
    const r = document.querySelector('#devicesView .page-help .b-pop-panel').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + Math.min(60, r.height / 2) };
  });
  await page.mouse.move(box.x, box.y, { steps: 12 });
  await sleep(250);
  check('滑進面板途中不收合（hover 橋）', await panelVisible());

  // 移開 → 收合
  await page.mouse.move(700, 600, { steps: 8 });
  await sleep(350);
  check('滑走 → 面板收合', !(await panelVisible()));

  // 點擊釘住（kit data-pop）→ 外點關閉
  await page.click('#devicesView .page-help-btn');
  await sleep(250);
  const pinned = await page.evaluate(() => document.querySelector('#devicesView .page-help').classList.contains('is-open'));
  check('點擊釘住（is-open）', pinned && (await panelVisible()));
  await page.mouse.move(700, 600, { steps: 6 });
  await sleep(300);
  check('釘住後滑走仍展開', await panelVisible());
  await shot('03-pinned');
  await page.mouse.click(700, 600);
  await sleep(250);
  check('點外面 → 關閉', !(await panelVisible()));

  // Esc 關（先釘住再按）
  await page.click('#devicesView .page-help-btn');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.mouse.move(700, 600); // 移開 hover 才能驗證
  await sleep(250);
  check('Esc 關閉', !(await panelVisible()));

  // 深色模式外觀
  await page.click('.header-mode-btn');
  await sleep(300);
  await page.hover('#devicesView .page-help-btn');
  await sleep(300);
  await shot('04-dark-open');
  check('深色模式 hover 展開', await panelVisible());

  console.log('\nconsole errors:', errs.length ? errs : '(none)');
  const pass = results.filter(Boolean).length;
  console.log(`${pass}/${results.length} passed`);
  await browser.close();
  process.exit(pass === results.length && !errs.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
