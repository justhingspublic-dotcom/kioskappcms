/* 主題色 modal（2026-09-14）實測：nav 調色盤鈕 → 選色即時預覽 → 取消還原 → 儲存寫進共用設定、/version 帶新色 → 還原原色。
   用法：node tools/uitest/test-theme.js [base=http://localhost:3177] */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:3177';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const errors = [];
const check = (name, ok, extra) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`); };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--window-size=1440,900'], defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const accentOf = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase());
  const styleText = () => page.evaluate(() => document.getElementById('siteTheme').textContent);

  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle2', timeout: 20000 });
  check('頁面內嵌 <style id=siteTheme>', (await styleText()).includes('--accent:'));
  const original = await accentOf();
  console.log('目前主題色', original);

  await page.type('#username', process.env.USER_ || 'joyeadmin');
  await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForFunction(() => document.getElementById('whoami').textContent.trim() !== '—', { timeout: 10000 });
  await sleep(500);
  check('管理員看得到 nav 主題色鈕', await page.evaluate(() => { const b = document.getElementById('themeBtn'); return b && !b.hidden && b.offsetWidth > 0; }));

  await page.click('#themeBtn');
  await page.waitForSelector('#themeModal.is-visible', { timeout: 5000 });
  await sleep(500);
  await shot('theme-modal-open');
  const swatchCount = await page.evaluate(() => document.querySelectorAll('#themeSwatches .swatch:not(.custom)').length);
  check('色票 9 格（最前面公司橘）', swatchCount === 9 && (await page.evaluate(() => getComputedStyle(document.querySelector('#themeSwatches .swatch')).backgroundColor)) === 'rgb(224, 120, 0)', String(swatchCount));
  check('儲存鈕未改色時停用', await page.evaluate(() => document.getElementById('th-save').disabled));

  // 選第 3 格（藍綠 #00606D）→ 只有樣本列預覽，整站不變
  await page.click('#themeSwatches .swatch:not(.custom):nth-of-type(3)');
  await sleep(300);
  check('選色後整站 --accent 不變', (await accentOf()) === original, await accentOf());
  const sampleAccent = await page.evaluate(() => getComputedStyle(document.querySelector('#themeModal .theme-sample')).getPropertyValue('--accent').trim().toUpperCase());
  check('樣本列預覽新色', sampleAccent === '#00606D', sampleAccent);
  check('樣本列變數有寫入', (await page.evaluate(() => document.getElementById('themePreview').textContent)).includes('#00606D'));
  check('儲存鈕啟用', await page.evaluate(() => !document.getElementById('th-save').disabled));
  await shot('theme-modal-orange-preview');

  // 關閉（✕）→ 沒存，整站原色
  await page.click('#th-close');
  await sleep(600);
  check('關閉後 modal 收起', await page.evaluate(() => !document.getElementById('themeModal').classList.contains('is-visible')));
  check('關閉後整站仍原色', (await accentOf()) === original, await accentOf());

  // 再開、選第 4 格（#2E6F40）、儲存
  await page.click('#themeBtn');
  await page.waitForSelector('#themeModal.is-visible', { timeout: 5000 });
  await sleep(400);
  await page.click('#themeSwatches .swatch:not(.custom):nth-of-type(4)');
  await sleep(200);
  await page.click('#th-save');
  await sleep(1200);
  check('儲存後 modal 關閉', await page.evaluate(() => !document.getElementById('themeModal').classList.contains('is-visible')));
  check('儲存後頁面留在新色', (await accentOf()) === '#2E6F40', await accentOf());
  await shot('theme-saved');

  const token = await page.evaluate(() => sessionStorage.getItem('token'));
  const shared = await page.evaluate(async (b, t) => (await fetch(b + '/api/shared-settings', { headers: { Authorization: 'Bearer ' + t } })).json(), BASE, token);
  check('共用設定 themeColor 已寫入', shared.settings && shared.settings.themeColor === '#2E6F40', shared.settings && shared.settings.themeColor);

  // 重新整理：伺服器出的頁面就是新色
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(500);
  check('重新載入後伺服器內嵌新色', (await accentOf()) === '#2E6F40', await accentOf());

  // 還原成原本的顏色
  await page.evaluate(async (b, t, s, c) => {
    s.themeColor = c;
    await fetch(b + '/api/shared-settings', { method: 'PUT', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: s }) });
  }, BASE, token, shared.settings, original);
  const after = await page.evaluate(async (b, t) => (await fetch(b + '/api/shared-settings', { headers: { Authorization: 'Bearer ' + t } })).json(), BASE, token);
  check('已還原原色', after.settings.themeColor === original, after.settings.themeColor);

  await browser.close();
  check('無 console 錯誤', errors.length === 0, errors.join(' | ').slice(0, 300));
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
