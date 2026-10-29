/* 頂欄（2026-10-29 user）：通知、帳號回到原本（浮在鈕下方 8px）；頂欄選單同時只開一個；
   字體大小＝按 AA 在頂欄原地往左展開成膠囊（中／大／特大，平面：同全站分段切換），右邊的按鈕不動、選了馬上套用、膠囊不收。
   用法：node test-hdr-pop.js（BASE 預設本機 3177；USER_／PASS_ 換帳號；MODE=dark 看深色） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const OUT = path.join(__dirname, 'shots', 'hdr-pop');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };
const MODE = process.env.MODE || 'light';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', defaultViewport: { width: 1512, height: 828, deviceScaleFactor: 2 },
  });
  const errs = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('#username', { visible: true });
  await page.type('#username', process.env.USER_ || 'joyeadmin');
  await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await page.evaluate((m) => window.setColorMode(m, false), MODE);
  await page.evaluate(() => { document.documentElement.removeAttribute('data-fs'); try { localStorage.removeItem('adminFontSize'); } catch (e) { /* 無痕 */ } });
  await sleep(600);
  const shot = (name, clip) => page.screenshot({ path: path.join(OUT, `${MODE}-${name}.png`), captureBeyondViewport: false, clip });
  const open = () => page.evaluate(() => ({
    notif: !document.getElementById('notifPanel').hidden,
    user: !document.querySelector('.header-user-menu').hidden,
    fs: document.querySelector('.fs-pill').classList.contains('is-open'),
  }));
  const rect = (sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
  const others = () => page.evaluate(() => [...document.querySelectorAll('.header-right > *')].filter((el) => el.offsetParent).map((el) => Math.round(el.getBoundingClientRect().right)));

  console.log('1. 通知、帳號回到原本：浮在鈕下方 8px');
  for (const [name, btn, panel] of [['通知', '#notifBtn', '#notifPanel'], ['帳號', '.header-user-btn', '.header-user-menu']]) {
    await page.click(btn); await sleep(300);
    const b = await rect(btn), p = await rect(panel);
    ok(Math.abs(p.top - (b.bottom + 8)) < 1, `  ${name}：面板在鈕下方 ${(p.top - b.bottom).toFixed(0)}px`);
    ok(await page.evaluate(() => !document.querySelector('.hdr-morph, .hdr-tab')), `  ${name}：沒有殼或頁籤`);
    await shot(name, { x: p.left - 30, y: 0, width: p.width + 60, height: Math.min(828, p.bottom + 30) });
    await page.mouse.click(700, 600); await sleep(300);
  }

  console.log('2. 頂欄選單同時只開一個');
  await page.click('#notifBtn'); await sleep(300);
  await page.click('.header-user-btn'); await sleep(400);
  let s = await open();
  ok(s.user && !s.notif, `開著通知再按帳號：只剩帳號（${JSON.stringify(s)}）`);
  await page.click('#notifBtn'); await sleep(400);
  s = await open();
  ok(s.notif && !s.user, `開著帳號再按通知：只剩通知（${JSON.stringify(s)}）`);
  await page.click('.header-fs-wrap .header-icon-btn'); await sleep(400);
  s = await open();
  ok(s.fs && !s.notif, `開著通知再按字體大小：只剩膠囊（${JSON.stringify(s)}）`);
  await page.click('.header-user-btn'); await sleep(450);
  s = await open();
  ok(s.user && !s.fs, `開著膠囊再按帳號：膠囊收起（${JSON.stringify(s)}）`);
  await page.mouse.click(700, 600); await sleep(400);

  console.log('3. 字體大小＝在頂欄原地展開成膠囊');
  const btn0 = await rect('.header-fs-wrap .header-icon-btn'), pill0 = await rect('.fs-pill'), o0 = await others();
  await page.click('.header-fs-wrap .header-icon-btn'); await sleep(120);
  const pillMid = await rect('.fs-pill');
  await shot('字體大小-途中', { x: btn0.right - 260, y: 0, width: 300, height: 70 });
  await sleep(500);
  const pill = await rect('.fs-pill'), btn = await rect('.header-fs-wrap .header-icon-btn'), o1 = await others();
  const st = await page.evaluate(() => {
    const ind = document.querySelector('.fs-seg-ind').getBoundingClientRect(), on = document.querySelector('.fs-seg-opt.on');
    return { mat: getComputedStyle(document.querySelector('.fs-pill'), '::before').opacity, seg: getComputedStyle(document.querySelector('.fs-seg')).opacity,
      opts: [...document.querySelectorAll('.fs-seg-opt')].map((o) => o.textContent), on: on.textContent, ind: ind.toJSON(), onR: on.getBoundingClientRect().toJSON(),
      exp: document.querySelector('.header-fs-wrap .header-icon-btn').getAttribute('aria-expanded') };
  });
  ok(Math.abs(pill0.width - 36) < 1 && pill.width > 140 && pillMid.width > pill0.width && pillMid.width < pill.width, `膠囊從 36 長到 ${pill.width.toFixed(0)}（途中 ${pillMid.width.toFixed(0)}）`);
  ok(Math.abs(btn.left - btn0.left) < 1 && Math.abs(pill.right - pill0.right) < 1, 'AA 鈕不動、膠囊往左長');
  ok(JSON.stringify(o1.slice(1)) === JSON.stringify(o0.slice(1)), '右邊的按鈕都沒動');
  ok(st.mat === '1' && st.seg === '1' && st.opts.join() === '中,大,特大' && st.exp === 'true', '打開＝膠囊的底與框淡入、中／大／特大出現');
  ok(st.on === '大' && Math.abs(st.ind.left - st.onR.left) < 1 && Math.abs(st.ind.width - st.onR.width) < 1, `選中那格（${st.on}）底下有主題色那格`);
  await shot('字體大小', { x: pill.left - 30, y: 0, width: pill.width + 60 + 120, height: 70 });
  // 選「特大」：小卡片滑過去、整頁換字級、膠囊不收
  const lg = await page.evaluate(() => { const b = [...document.querySelectorAll('.fs-seg-opt')].find((o) => o.textContent === '特大').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.click(lg.x, lg.y); await sleep(900);
  const after = await page.evaluate(() => {
    const ind = document.querySelector('.fs-seg-ind').getBoundingClientRect(), on = document.querySelector('.fs-seg-opt.on');
    return { fs: document.documentElement.getAttribute('data-fs'), on: on.textContent, ind: ind.left, onL: on.getBoundingClientRect().left, open: document.querySelector('.fs-pill').classList.contains('is-open') };
  });
  ok(after.fs === 'lg' && after.on === '特大' && Math.abs(after.ind - after.onL) < 1 && after.open, `選特大：整頁換大字、小卡片滑到特大、膠囊不收（${JSON.stringify(after)}）`);
  await shot('字體大小-特大', { x: pill.left - 30, y: 0, width: pill.width + 60 + 120, height: 70 });
  // 滑過其他選項：不加底色、字亮起來
  const mid = await page.evaluate(() => { const o = [...document.querySelectorAll('.fs-seg-opt')].find((x) => x.textContent === '中'); const b = o.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, c: getComputedStyle(o).color }; });
  await page.mouse.move(mid.x, mid.y); await sleep(300);
  const midH = await page.evaluate(() => { const o = [...document.querySelectorAll('.fs-seg-opt')].find((x) => x.textContent === '中'); return { c: getComputedStyle(o).color, bg: getComputedStyle(o).backgroundColor }; });
  ok(midH.bg === 'rgba(0, 0, 0, 0)' && midH.c !== mid.c, `滑過「中」：沒有底色、字色 ${mid.c} → ${midH.c}`);
  // 改回「大」，Esc 收起
  const md = await page.evaluate(() => { const b = [...document.querySelectorAll('.fs-seg-opt')].find((o) => o.textContent === '大').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.click(md.x, md.y); await sleep(800);
  ok(await page.evaluate(() => !document.documentElement.hasAttribute('data-fs')), '改回「大」＝預設字級');
  await page.keyboard.press('Escape'); await sleep(450);
  const pillEnd = await rect('.fs-pill');
  ok(!(await open()).fs && Math.abs(pillEnd.width - 36) < 1, 'Esc＝收回 AA 圓鈕');
  // 收起時選項不能用 Tab 選到
  ok(await page.evaluate(() => [...document.querySelectorAll('.fs-seg-opt')].every((o) => o.tabIndex === -1)), '收起時選項不會被 Tab 選到');

  console.log('errors', JSON.stringify(errs));
  console.log(`\n${pass} 通過、${fail} 失敗`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
