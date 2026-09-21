/* 客服格子的「語音朗讀」開關與「語速」滑塊（2026-09-21，user 指定放在格子設定而不是機器設定）。
   用法：BASE=http://localhost:3177 node test-speak-toggle.js */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3177/';
const OUT = path.join(__dirname, 'shots', 'speak-toggle');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`); };

/** 檢查器某一列（label 文字找列）。 */
const rowOf = `(label) => [...document.querySelectorAll('.ins-row')].find((r) => r.querySelector('.ins-label')?.textContent.trim() === label)`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--window-size=1512,828'], defaultViewport: { width: 1512, height: 828 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('#username', { visible: true });
  await page.type('#username', 'joyeadmin'); await page.type('#password', 'joye#2026');
  await page.click('.btn-login');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '內容管理'), { timeout: 10000 });
  await sleep(500);
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '內容管理').click(); });
  await page.waitForFunction(() => document.getElementById('wsModal').classList.contains('is-visible'), { timeout: 8000 });
  await sleep(800);

  // 版面頁籤 → 點畫布第一格 → 點擊動作設成 AI 智能客服
  await page.evaluate(() => document.querySelector('.ws-tabs [data-wstab="layout"]')?.click());
  await sleep(500);
  await page.evaluate(() => document.querySelector('#canvas .cell').click());
  await sleep(600);
  const picked = await page.evaluate(() => {
    // 點擊動作那一列沒有 label（區段標題＋整列控件），用選項值認這個下拉
    const sel = [...document.querySelectorAll('#insPanel select, .ins-ctrl select, select')]
      .find((el) => [...el.options].some((o) => o.value === 'OpenAssistant'));
    if (!sel) return false;
    sel.value = 'OpenAssistant';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  check('格子的點擊動作可設成客服', picked);
  await sleep(600);

  const m = await page.evaluate((finder) => {
    const find = eval(finder);
    const speak = find('語音朗讀');
    const rate = find('語速');
    const slider = rate && rate.querySelector('input[type="range"]');
    return {
      hasSpeak: !!speak,
      speakOn: speak ? speak.querySelector('input[type="checkbox"]').checked : null,
      afterAccent: !!(speak && speak.previousElementSibling && speak.previousElementSibling.textContent.includes('主題色')),
      hasRate: !!rate,
      rateValue: slider ? slider.value : null,
      rateLabel: rate ? rate.querySelector('b').textContent : null,
    };
  }, rowOf);

  check('客服格子有「語音朗讀」開關', m.hasSpeak);
  check('預設是開的', m.speakOn === true);
  check('排在主題色下面', m.afterAccent);
  check('開著時有「語速」滑塊、預設正常速', m.hasRate && m.rateValue === '1' && m.rateLabel === '正常', JSON.stringify(m));

  const dragged = await page.evaluate((finder) => {
    const el = eval(finder)('語速').querySelector('input[type="range"]');
    el.value = '1.5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return eval(finder)('語速').querySelector('b').textContent;
  }, rowOf);
  check('拉動滑塊會顯示倍數', dragged === '1.5×', dragged);

  await page.evaluate((finder) => eval(finder)('語音朗讀').scrollIntoView({ block: 'center' }), rowOf);
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, '01-cell-assistant.png') });

  // 關掉朗讀：語速列要跟著收起來
  await page.evaluate((finder) => eval(finder)('語音朗讀').querySelector('input[type="checkbox"]').click(), rowOf);
  await sleep(500);
  const off = await page.evaluate((finder) => {
    const find = eval(finder);
    return { speakOn: find('語音朗讀').querySelector('input[type="checkbox"]').checked, hasRate: !!find('語速') };
  }, rowOf);
  check('可以關掉，語速跟著收起來', off.speakOn === false && !off.hasRate, JSON.stringify(off));

  check('沒有 console 錯誤', errs.length === 0, errs.join(' | ').slice(0, 200));
  console.log(`\n${results.filter(Boolean).length}/${results.length} 通過`);
  await browser.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
