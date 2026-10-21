/* 下拉選單狀態小標（2026-10-20）：灰掉的選項帶小標，點選項或小標選單都不能被關掉；小標在最右邊、淺灰無邊框膠囊。
   只在頁面上建暫時的共用版面、把 PARK_API 清掉（不存）。用法：node test-dd-badge.js（BASE 預設本機 3177） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const OUT = path.join(__dirname, 'shots', 'parkinfo');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const errs = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin'); await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await sleep(800);
  await page.click('#sharedGroupToggle'); await sleep(300);
  await page.click('[data-view="sharedLayout"]'); await sleep(600);
  await page.evaluate(() => {
    PARK_API = '';
    const c = (o) => Object.assign(DEFAULT_CELL(), o);
    const tree = { t: 'split', dir: 'Horizontal', ratio: 0.5, a: c({ content: 'Text', text: 'A' }), b: c({ content: 'Text', text: '園區', tap: 'OpenParkInfo', parkHere: 'D2' }) };
    const L = { id: 9996, name: '小標測試', pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: tree }] }], screen: { w: 1080, h: 1920 }, updatedAt: new Date().toISOString() };
    (shared.layouts ||= []).push(L);
    enterSharedLayoutEditor(L);
  });
  await sleep(900);
  await page.click('#canvas .cell[data-path="a"]'); await sleep(700);
  // 點擊動作下拉（最後一個 .ins-full 的下拉）：打開 → 點灰掉的「園區資訊」的小標
  const trig = await page.evaluateHandle(() => [...document.querySelectorAll('#cellPanel .b-dd')].find((d) => [...d.querySelectorAll('option')].some((o) => o.value === 'OpenParkInfo')).querySelector('.b-dd-trigger'));
  await trig.evaluate((t) => t.scrollIntoView({ block: 'center' })); await sleep(300);
  await trig.click(); await sleep(400);
  const item = await page.evaluate(() => {
    const it = document.querySelector('.b-dd.open .b-dd-item[data-value="OpenParkInfo"]');
    const b = it && it.querySelector('.b-dd-badge');
    if (!b) return null;
    const ir = it.getBoundingClientRect(), br = b.getBoundingClientRect(), cs = getComputedStyle(b);
    return { right: Math.round(ir.right - br.right), border: cs.borderTopWidth, bg: cs.backgroundColor, color: cs.color, text: b.textContent, x: br.x + br.width / 2, y: br.y + br.height / 2, ix: ir.x + 30, iy: ir.y + ir.height / 2 };
  });
  ok(item && item.text === '未設定', `選單裡的小標寫「未設定」（${item && item.text}）`);
  ok(item && item.right <= 16 && item.border === '0px', `小標在最右邊、沒有邊框（${JSON.stringify(item)}）`);
  await page.screenshot({ path: path.join(OUT, '30-dd-badge-menu.png') });
  await page.mouse.click(item.x, item.y); await sleep(400);
  ok(await page.evaluate(() => !!document.querySelector('.b-dd.open')), '點小標：選單不會被關掉');
  await page.mouse.click(item.ix, item.iy); await sleep(400);
  ok(await page.evaluate(() => !!document.querySelector('.b-dd.open')), '點灰掉的選項文字：選單不會被關掉');
  await page.evaluate(() => document.getElementById('cellPanel').click()); await sleep(300);
  // 觸發鈕上的小標（選著「園區資訊」的格子）：最右邊、箭頭左邊
  await page.click('#canvas .cell[data-path="b"]'); await sleep(700);
  const tb = await page.evaluate(() => {
    const t = document.querySelector('#cellPanel .b-dd-trigger .b-dd-badge');
    if (!t) return null;
    const trig = t.closest('.b-dd-trigger'), caret = trig.querySelector('.b-dd-caret');
    return { text: t.textContent, gapToCaret: Math.round(caret.getBoundingClientRect().left - t.getBoundingClientRect().right) };
  });
  ok(tb && tb.text === '未設定' && tb.gapToCaret >= 0 && tb.gapToCaret <= 12, `選著的觸發鈕：小標貼在箭頭左邊（${JSON.stringify(tb)}）`);
  // 選著的選項（可以按）上的小標：點小標不算選、選單不關
  await page.evaluate(() => document.querySelector('#cellPanel .b-dd-trigger .b-dd-badge').closest('.b-dd-trigger').scrollIntoView({ block: 'center' })); await sleep(300);
  await page.evaluate(() => document.querySelector('#cellPanel .b-dd-trigger .b-dd-badge').closest('.b-dd-trigger').click()); await sleep(400);
  const cur = await page.evaluate(() => { const b = document.querySelector('.b-dd.open .b-dd-item.active .b-dd-badge'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  ok(!!cur, '選單裡選著的「園區資訊」也帶小標');
  if (cur) { await page.mouse.click(cur.x, cur.y); await sleep(400); }
  ok(await page.evaluate(() => !!document.querySelector('.b-dd.open')), '點選著的選項上的小標：選單不會被關掉');
  await page.evaluate(() => document.getElementById('cellPanel').click()); await sleep(300);
  await page.evaluate(() => document.querySelector('#cellPanel .b-dd-trigger .b-dd-badge').scrollIntoView({ block: 'center' })); await sleep(300);
  await page.screenshot({ path: path.join(OUT, '31-dd-badge-trigger.png') });
  await browser.close();
  console.log(errs.length ? errs : '沒有頁面錯誤');
  console.log(`\n${pass} 通過，${fail} 失敗`);
  process.exit(fail || errs.length ? 1 : 0);
})();
