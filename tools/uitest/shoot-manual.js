/* 操作手冊用截圖：登入後依序拍各頁／工作區／面板／共用設定／帳號管理，加上 JustAI 登入頁，
   2x 輸出到 public/img/manual/（手冊頁 <img> 直接引用）。用法：node shoot-manual.js；BASE 換目標。
   modal 本身的檢查截圖見 shot-guide.js。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', '..', 'public', 'img', 'manual');
const CHECK = path.join(__dirname, 'shots', 'manual');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CHECK, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const shot = async (name, el) => {
    const target = el ? await page.$(el) : page;
    if (!target) { console.log('MISSING', name, el); return; }
    await target.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('shot', name);
  };

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', 'admin');
  await page.type('#password', 'kiosk#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await page.evaluate(() => window.setColorMode('light', false));
  await sleep(500);

  // 快速開始：側欄連線資訊卡
  await shot('conn-info', '#connCard');
  // 機器總覽
  await shot('devices');

  // 工作區（版面）→ 點格子出面板 → 機器設定頁籤
  await page.click('#deviceTable .device-ops button');
  await sleep(900);
  await shot('workspace');
  const cell = await page.$('#canvas .cell');
  if (cell) {
    await cell.click();
    await sleep(500);
    await shot('cell-panel', '#cellPanel');
  }
  const segs = await page.$$('.ws-tabs .seg');
  if (segs[1]) {
    await segs[1].click();
    await sleep(600);
    await shot('settings-tab');
    // 智能客服 API 卡（第一張設定卡）
    await shot('chat-api-card', '#settingsBody .settings-card');
  }
  await page.click('#wsCloseBtn');
  await sleep(600);
  // 離開工作區可能跳確認框（沒改東西就不會）
  const confirmBtn = await page.$('.b-dialog .b-btn-primary, .b-dialog [data-dialog-ok]');
  if (confirmBtn) { await confirmBtn.click(); await sleep(400); }

  // 共用設定兩頁
  await page.click('#sharedGroupToggle');
  await sleep(400);
  await page.click('[data-view="sharedLayout"]');
  await sleep(600);
  await shot('shared-layout');
  await page.click('[data-view="sharedSettings"]');
  await sleep(700);
  await shot('shared-settings');

  // 帳號管理
  await page.click('[data-view="users"]');
  await sleep(600);
  await shot('users');

  // JustAI 官網與登入頁（公開頁；1x 就好，2x 的官網照片檔會到 3MB）
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  try {
    await page.goto('https://chat.justhings.ai/login', { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(1200);
    // 只截中間的登入卡（整頁 1440 寬縮進手冊會小到看不見表單）
    await page.screenshot({ path: path.join(OUT, 'justai-login.png'), clip: { x: 430, y: 140, width: 580, height: 620 } });
    console.log('shot justai-login');
  } catch (e) { console.log('JustAI 截圖略過：', e.message); }

  // 使用說明 modal 本身的檢查圖走 shot-guide.js
  console.log('console errors:', errs.length ? errs : '(none)');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
