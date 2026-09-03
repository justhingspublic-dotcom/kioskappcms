/* KioskAdmin UI 實測：headless Chrome 逐項點擊驗證，收集 console 錯誤與斷言結果。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const consoleErrors = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra: extra || '' });
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
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

  const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
  const visible = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }, sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 15000 });

    // ── 登入 ──
    await page.waitForSelector('#username', { visible: true, timeout: 8000 });
    await shot('01-login');
    await page.type('#username', 'admin');
    await page.type('#password', 'kiosk#2026');
    await page.click('.btn-login');
    await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 })
      .then(() => check('登入後進機器總覽、列表有資料', true))
      .catch(() => check('登入後進機器總覽、列表有資料', false));
    await shot('02-devices');

    // ── 側欄：共用設定手風琴 ──
    await page.click('#sharedGroupToggle');
    await sleep(400);
    const submenuOpen = await page.evaluate(() => document.querySelector('#sharedSubmenu').classList.contains('show'));
    check('點「共用設定」展開子選單', submenuOpen);
    const subVisible = await visible('[data-view="sharedLayout"]');
    check('子項「版面設定」可見', subVisible);
    await shot('03-submenu-open');

    // 再點一次收合、再展開（手風琴 toggle 正常）
    await page.click('#sharedGroupToggle');
    await sleep(350);
    const closedAgain = await page.evaluate(() => !document.querySelector('#sharedSubmenu').classList.contains('show'));
    check('再點一次收合', closedAgain);
    await page.click('#sharedGroupToggle');
    await sleep(350);

    // ── 版面設定子頁 ──
    await page.click('[data-view="sharedLayout"]');
    await sleep(300);
    check('版面設定頁顯示', await visible('#sharedLayoutView'));
    check('子項 active 樣式', await page.evaluate(() => document.querySelector('[data-view="sharedLayout"]').classList.contains('active')));
    await shot('04-shared-layout');

    // 編輯共用版面 → modal（shared 模式）
    await page.click('#editSharedLayoutBtn');
    await sleep(500);
    check('共用版面編輯 modal 開啟', await page.evaluate(() => document.querySelector('#wsModal').classList.contains('is-visible')));
    check('shared 模式藏頁籤', !(await visible('.ws-tabs')));
    check('shared 模式藏「展示此頁」', !(await visible('#showPageBtn')));
    const saveLabel = await page.evaluate(() => document.querySelector('#saveBtn').textContent.trim());
    check('儲存鈕文案＝儲存共用版面', saveLabel.includes('共用版面'), saveLabel);
    check('畫布渲染', await visible('#canvas .cell'));
    await shot('05-shared-editor');

    // 點格子 → 面板出現
    await page.click('#canvas .cell');
    await sleep(300);
    check('點格子出現右側面板', await page.evaluate(() => !!document.querySelector('#cellPanel .panel-head')));
    await shot('06-shared-editor-panel');

    // 關閉（✕）
    await page.click('#wsCloseBtn');
    await sleep(500);
    check('✕ 關閉 modal', await page.evaluate(() => !document.querySelector('#wsModal').classList.contains('is-visible')));

    // ── 機器設定子頁 ──
    await page.click('[data-view="sharedSettings"]');
    await sleep(300);
    check('機器設定頁顯示', await visible('#sharedSettingsView'));
    check('客服/休眠卡片渲染', await page.evaluate(() => document.querySelectorAll('#sharedBody .settings-card').length === 2));
    await shot('07-shared-settings');

    // 改個欄位 → 儲存鈕亮起
    await page.type('#sharedBody input[type=text]', 'test@example.com');
    await sleep(200);
    check('編輯後儲存鈕啟用', await page.evaluate(() => !document.querySelector('#sharedSaveBtn').disabled));

    // ── 回機器總覽 → 開機器工作區 modal ──
    await page.click('[data-view="devices"]');
    await sleep(400);
    await page.click('#deviceTable tbody tr');
    await sleep(700);
    check('點列開機器工作區 modal', await page.evaluate(() => document.querySelector('#wsModal').classList.contains('is-visible')));
    check('device 模式頁籤可見', await visible('.ws-tabs'));
    const devSaveLabel = await page.evaluate(() => document.querySelector('#saveBtn').textContent.trim());
    check('儲存鈕文案＝儲存並發布', devSaveLabel.includes('發布'), devSaveLabel);
    await shot('08-device-workspace');

    // 切機器設定頁籤
    await page.click('.ws-tabs [data-wstab="settings"]');
    await sleep(300);
    check('機器設定頁籤切換', await visible('#settingsTab'));
    check('機器設定卡片渲染', await page.evaluate(() => document.querySelectorAll('#settingsBody .settings-card').length === 2));
    await shot('09-device-settings-tab');

    // 複製版面（只有一台 → 應跳「沒有其他機器」alert）
    await page.click('.ws-tabs [data-wstab="layout"]');
    await sleep(200);
    await page.click('#copyLayoutBtn');
    await sleep(500);
    const alertShown = await page.evaluate(() => !!document.querySelector('.b-modal-overlay[data-modal-vue] .b-alert-title'));
    check('複製版面對話框/提示出現', alertShown);
    await shot('10-copy-dialog');
    if (alertShown) {
      await page.evaluate(() => { const btns = document.querySelectorAll('.b-modal-overlay[data-modal-vue] .b-alert-foot button'); btns[btns.length - 1].click(); });
      await sleep(300);
    }

    // Esc 關 modal（有 dirty 時會跳確認 → 這裡未改動應直接關）
    await page.keyboard.press('Escape');
    await sleep(500);
    check('Esc 關閉工作區', await page.evaluate(() => !document.querySelector('#wsModal').classList.contains('is-visible')));

    // ── 深色模式切一下 ──
    await page.click('.header-mode-btn');
    await sleep(400);
    await shot('11-dark-devices');
    await page.click('.header-mode-btn');
    await sleep(200);

    // ── 收合側欄（flyout 行為） ──
    await page.click('.sidebar .toggle-btn');
    await sleep(400);
    await page.click('#sharedGroupToggle');
    await sleep(400);
    const flyout = await page.evaluate(() => !!document.querySelector('.cms-flyout'));
    check('收合側欄後點群組出 flyout 浮窗', flyout);
    const flyItems = await page.evaluate(() => document.querySelectorAll('.cms-flyout-item').length);
    check('flyout 列出兩個子項', flyItems === 2, 'items=' + flyItems);
    await shot('12-collapsed-flyout');
    await page.evaluate(() => document.querySelectorAll('.cms-flyout-item')[0].click());
    await sleep(400);
    check('flyout 點「版面設定」切換視圖', await visible('#sharedLayoutView'));
    check('flyout 點擊後自動關閉', await page.evaluate(() => !document.querySelector('.cms-flyout')));
    await shot('13-flyout-clicked');
    await page.click('.sidebar .toggle-btn'); // 還原
    await sleep(300);
  } catch (e) {
    check('腳本執行', false, e.message);
    await shot('99-error');
  }

  console.log('\n== console errors ==');
  consoleErrors.forEach((e) => console.log('ERR:', e));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed, ${consoleErrors.length} console errors`);
  await browser.close();
})();
