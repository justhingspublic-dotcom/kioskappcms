/* 驗證：切到某頁後重新整理，仍停在該頁（含共用設定群組展開）。BASE=http://localhost:3177 node test-view-restore.js */
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.type('#username', 'admin'); await page.type('#password', 'kiosk#2026'); await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  const state = () => page.evaluate(() => ({
    hash: location.hash,
    active: document.querySelector('.sidebar .nav-item.active')?.dataset.view,
    visible: ['devicesView', 'sharedLayoutView', 'sharedSettingsView', 'usersView'].filter((id) => !document.getElementById(id).classList.contains('hidden')),
    groupOpen: document.getElementById('sharedSubmenu').classList.contains('show'),
  }));
  console.log('after login:', await state());
  for (const view of ['users', 'sharedSettings', 'sharedLayout']) {
    if (view.startsWith('shared') && !(await state()).groupOpen) await page.click('#sharedGroupToggle');
    await page.click(`.sidebar .nav-item[data-view="${view}"]`); await sleep(300);
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(600);
    const s = await state();
    console.log(`${s.active === view && s.visible.join() === view + 'View' ? 'PASS' : 'FAIL'} reload on ${view}:`, s);
  }
  // 直接開根網址（無 hash）→ 機器總覽
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' }); await sleep(600);
  console.log('no hash:', await state());
  console.log('page errors:', errs.length ? errs : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
