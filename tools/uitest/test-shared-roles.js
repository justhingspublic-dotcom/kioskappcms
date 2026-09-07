/* 驗證：共用設定全站一份＋角色限制（2026-09-07 定案）。
   會用 admin 建一個臨時一般帳號 uitest_tmp 測完即刪。BASE=http://localhost:3178 node test-shared-roles.js */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'shots', 'shared-roles');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + JSON.stringify(extra) : ''}`); };

async function api(token, method, url, body) {
  const res = await fetch(BASE + url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
async function login(u, p) {
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  return (await r.json()).token;
}

(async () => {
  const admin = await login('admin', 'kiosk#2026');
  check('admin login', !!admin);

  // ── API：全站一份、建立者蓋章 ──
  const g1 = await api(admin, 'GET', '/api/shared-settings');
  const layouts = g1.json.settings?.layouts || [];
  check('admin sees layouts', layouts.length > 0, { count: layouts.length });
  check('all layouts have createdBy', layouts.every((l) => l.createdBy), { sample: layouts.slice(0, 2).map((l) => l.createdBy) });

  // ── 臨時一般帳號 ──
  const TMP = 'uitest_tmp', TMP_PW = 'uitest#tmp';
  let created = await api(admin, 'POST', '/api/users', { username: TMP, password: TMP_PW, displayName: '測試一般', isAdmin: false });
  let tmpId = created.json.userId;
  if (!tmpId) { // 上次沒清乾淨：找出來刪掉重建
    const list = (await api(admin, 'GET', '/api/users')).json;
    const old = list.find((u) => u.Username === TMP);
    if (old) { await api(admin, 'DELETE', '/api/users/' + old.UserId); created = await api(admin, 'POST', '/api/users', { username: TMP, password: TMP_PW, displayName: '測試一般', isAdmin: false }); tmpId = created.json.userId; }
  }
  check('temp user created', !!tmpId);
  const user = await login(TMP, TMP_PW);
  check('temp user login', !!user);

  try {
    const g2 = await api(user, 'GET', '/api/shared-settings');
    check('general user sees the SAME layouts', (g2.json.settings?.layouts || []).length === layouts.length);

    // 一般帳號 PUT：只有 sleep 生效，layouts 被保留
    const sleepVal = { enabled: true, sameEveryDay: true, experimentalSystemSleep: false, periods: [{ start: 1300, end: 500 }] };
    const put1 = await api(user, 'PUT', '/api/shared-settings', { settings: { layouts: [], chatApi: { baseUrl: 'x', email: 'x', password: 'x' }, adminPin: '0000', sleep: sleepVal } });
    check('general PUT ok', put1.status === 200, put1);
    const g3 = await api(admin, 'GET', '/api/shared-settings');
    check('layouts NOT wiped by general user', (g3.json.settings.layouts || []).length === layouts.length);
    check('chatApi NOT changed by general user', g3.json.settings.chatApi?.baseUrl !== 'x');
    check('adminPin NOT changed by general user', g3.json.settings.adminPin !== '0000');
    check('sleep changed by general user', JSON.stringify(g3.json.settings.sleep) === JSON.stringify(sleepVal));
    // 還原 sleep
    await api(admin, 'PUT', '/api/shared-settings', { settings: { ...g3.json.settings, sleep: g1.json.settings.sleep } });
    const put2 = await api(user, 'PUT', '/api/shared-settings', { settings: { layouts: [] } });
    check('general PUT without sleep → 403', put2.status === 403, put2);
    // 一般帳號不能刪機器
    const del = await api(user, 'DELETE', '/api/devices/definitely-not-a-device');
    check('general DELETE device → 403', del.status === 403, del);

    // 一般帳號不能改單機的管理 PIN（伺服器剝掉 adminPin；用臨時機器 id 測完刪掉）
    const DEV = 'uitest-tmp-device';
    await api(admin, 'PUT', '/api/config/' + DEV, { config: { pages: [], adminPin: '1234' } });
    const p1 = await api(user, 'PUT', '/api/config/' + DEV, { config: { adminPin: '9999' } });
    const c1 = await api(admin, 'GET', '/api/config/' + DEV);
    check('general PUT adminPin ignored (kept 1234)', p1.status === 200 && c1.json.config?.adminPin === '1234', { status: p1.status, pin: c1.json.config?.adminPin });
    const p2 = await api(admin, 'PUT', '/api/config/' + DEV, { config: { adminPin: '5678' } });
    const c2 = await api(admin, 'GET', '/api/config/' + DEV);
    check('admin PUT adminPin works', p2.status === 200 && c2.json.config?.adminPin === '5678');
    await api(admin, 'DELETE', '/api/devices/' + DEV);

    // ── UI：一般帳號 ──
    const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1440, height: 900 } });
    const errs = [];
    const page = await browser.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    const uiLogin = async (u, p) => {
      await page.goto(BASE + '/#sharedLayout', { waitUntil: 'networkidle2' });
      await page.evaluate(() => sessionStorage.clear());
      await page.reload({ waitUntil: 'networkidle2' }); // 同網址只換 hash 不會重載，要明確 reload 才回登入頁
      await page.type('#username', u); await page.type('#password', p); await page.click('.btn-login');
      await page.waitForSelector('#sharedLayoutTable tbody tr', { visible: true, timeout: 10000 }); await sleep(500);
    };
    await uiLogin(TMP, TMP_PW);
    const ui1 = await page.evaluate(() => ({
      addHidden: document.getElementById('addSharedLayoutBtn').classList.contains('hidden'),
      headers: [...document.querySelectorAll('#sharedLayoutTable thead th')].map((t) => t.textContent),
      ops: [...document.querySelectorAll('#sharedLayoutTable tbody tr:first-child .device-ops button')].map((b) => b.textContent),
      creator: document.querySelector('#sharedLayoutTable tbody tr:first-child td:nth-child(3)')?.textContent,
    }));
    check('general: 新增版面 hidden', ui1.addHidden);
    check('general: header has 建立者', ui1.headers.includes('建立者'), ui1.headers);
    check('general: only 加入機器', ui1.ops.join() === '加入機器', ui1.ops);
    check('general: creator shown', !!ui1.creator && ui1.creator !== '—', ui1.creator);
    await page.screenshot({ path: path.join(OUT, 'general-layouts.png') });
    await page.click('.sidebar .nav-item[data-view="sharedSettings"]'); await sleep(600);
    const ui2 = await page.evaluate(() => [...document.querySelectorAll('#sharedBody .settings-card')].map((c) => ({
      title: c.querySelector('.b-card-title').textContent, locked: c.classList.contains('is-locked'),
      disabled: [...c.querySelectorAll('input')].every((i) => i.disabled),
    })));
    check('general: chat & pin locked, sleep open', ui2.filter((c) => c.locked).length === 2 && ui2.some((c) => !c.locked && !c.disabled), ui2);
    await page.screenshot({ path: path.join(OUT, 'general-settings.png') });
    // 單機工作區：機器設定頁籤只有「管理 PIN」卡被鎖
    await page.click('.sidebar .nav-item[data-view="devices"]'); await sleep(500);
    await page.waitForSelector('#deviceTable tbody tr .b-btn', { visible: true, timeout: 10000 });
    const manageBtn = await page.evaluateHandle(() => [...document.querySelectorAll('#deviceTable tbody tr button')].find((b) => b.textContent === '內容管理'));
    await manageBtn.click(); await sleep(800);
    await page.click('.ws-tabs .seg[data-wstab="settings"]'); await sleep(500);
    const ui5 = await page.evaluate(() => [...document.querySelectorAll('#settingsBody .settings-card')].map((c) => ({ title: c.querySelector('.b-card-title').textContent, locked: c.classList.contains('is-locked') })));
    check('general: device workspace locks only PIN', ui5.filter((c) => c.locked).map((c) => c.title).join() === '管理 PIN' && ui5.length >= 3, ui5);
    await page.screenshot({ path: path.join(OUT, 'general-device-settings.png') });
    await page.keyboard.press('Escape'); await sleep(400);

    // ── UI：admin ──
    await uiLogin('admin', 'kiosk#2026');
    const ui3 = await page.evaluate(() => ({
      addHidden: document.getElementById('addSharedLayoutBtn').classList.contains('hidden'),
      ops: [...document.querySelectorAll('#sharedLayoutTable tbody tr:first-child .device-ops button')].map((b) => b.textContent),
    }));
    check('admin: 新增版面 visible + full ops', !ui3.addHidden && ui3.ops.join() === '編輯,加入機器,更名,刪除', ui3);
    await page.screenshot({ path: path.join(OUT, 'admin-layouts.png') });
    await page.click('.sidebar .nav-item[data-view="sharedSettings"]'); await sleep(600);
    const ui4 = await page.evaluate(() => document.querySelectorAll('#sharedBody .settings-card.is-locked').length);
    check('admin: nothing locked', ui4 === 0, ui4);
    console.log('page errors:', errs.length ? errs : 'none');
    await browser.close();
  } finally {
    const d = await api(admin, 'DELETE', '/api/users/' + tmpId);
    check('temp user deleted', d.status === 200, d);
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
