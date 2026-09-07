/* 驗證：機器總覽點「內容管理」→ 正常時開工作區；API 連不上時只 toast、不開 modal。
   用法：BASE=http://localhost:3177 node test-ws-open.js */
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const modalOpen = (page) => page.evaluate(() => document.getElementById('wsModal').classList.contains('is-visible'));
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.b-toast, [class*="toast"]')].map((t) => t.textContent.trim()).filter(Boolean));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', 'admin');
  await page.type('#password', 'kiosk#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#mainView:not(.hidden)', { timeout: 10000 });
  await sleep(800);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '內容管理'), { timeout: 10000 });
  const clickManage = () => page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '內容管理').click(); });

  // 1) 正常：開得起來
  await clickManage();
  await page.waitForFunction(() => document.getElementById('wsModal').classList.contains('is-visible'), { timeout: 8000 });
  await sleep(400);
  const editorShown = await page.evaluate(() => !document.getElementById('editor').classList.contains('hidden'));
  console.log('case1 modal open:', await modalOpen(page), 'editor shown:', editorShown);
  await page.evaluate(() => document.getElementById('wsCloseBtn').click());
  await sleep(500);
  console.log('closed:', !(await modalOpen(page)));

  // 2) 斷線：攔掉 /api/config → 只 toast、不開 modal
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.url().includes('/api/config/') ? r.abort('connectionrefused') : r.continue()));
  await clickManage();
  await sleep(1200);
  console.log('case2 modal open:', await modalOpen(page), 'body lock:', await page.evaluate(() => document.body.classList.contains('b-modal-lock')));
  console.log('toasts:', JSON.stringify(await toasts(page)));
  await page.screenshot({ path: __dirname + '/shots/ws-open-fail.png' });
  console.log('page errors:', JSON.stringify(errs));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
