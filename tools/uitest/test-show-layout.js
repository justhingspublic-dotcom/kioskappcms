/* 機器總覽「展示版面」精靈（2026-09-09 批量展示）實測：按鈕 → 第 1 步勾機器（下一步要勾了才亮）→ 第 2 步單選版面
   （步驟條、狀況說明、完成要選了才亮）→ 逐台加入＋切換；上一步保留勾選；再開一次全部「展示中」；
   頁名備援（把 layoutId 洗掉仍認得出來）；離線機器不掛綠勾。
   前置：3177 的 KioskAdminDev 要有至少一台機器與一個共用版面（scratchpad mklayout.js 建「批量測試版面」）。
   用法：BASE=http://localhost:3177 node test-show-layout.js */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:3177';
const USER = process.env.USER_NAME || 'joyeadmin';
const PASS = process.env.PASS || 'joye#2026';
const OUT = path.join(__dirname, 'shots', 'show-layout');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, extra) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`);
}

async function apiLogin() {
  const r = await (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }) })).json();
  return { Authorization: 'Bearer ' + r.token, 'Content-Type': 'application/json' };
}
async function getConfig(H, id) { return (await (await fetch(`${BASE}/api/config/${encodeURIComponent(id)}`, { headers: H })).json()).config; }

const MODAL = '.b-modal.is-batch';
const NEXT = `${MODAL} .b-modal-foot .b-btn-text`;
const BACK = `${MODAL} .b-modal-foot .b-btn-quiet`;

(async () => {
  const H = await apiLogin();
  const devices = await (await fetch(BASE + '/api/devices', { headers: H })).json();
  const shared = (await (await fetch(BASE + '/api/shared-settings', { headers: H })).json()).settings || {};
  const layout = (shared.layouts || []).find((l) => l.name === '批量測試版面') || (shared.layouts || [])[0];
  if (!devices.length || !layout) { console.log('SKIP：需要至少一台機器與一個共用版面'); process.exit(2); }
  const lname = layout.name || '未命名版面';
  const devName = (d) => d.DeviceName || d.DeviceId;
  // 起始狀態：把之前測試加進去的那頁拿掉（依 layoutId 或頁名），讓每台都是「會先加入」
  for (const d of devices) {
    const cfg = await getConfig(H, d.DeviceId);
    const pages = (cfg.pages || []).filter((p) => p.layoutId !== layout.id && (p.name || '').trim() !== lname.trim());
    if (pages.length !== (cfg.pages || []).length) {
      await fetch(`${BASE}/api/config/${encodeURIComponent(d.DeviceId)}`, { method: 'PUT', headers: H, body: JSON.stringify({ config: { pages, activePage: 0 } }) });
    }
  }

  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const errs = [];
  // 「Failed to load resource」＝資料庫裡引用的圖檔不在 uploads（資料問題），不算這裡的錯
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const stepState = () => page.$$eval(`${MODAL} .wiz-step`, (els) => els.map((e) => (e.classList.contains('is-active') ? 'active' : e.classList.contains('is-done') ? 'done' : 'todo')).join(','));
  const openWizard = async () => {
    await page.click('#showLayoutBtn');
    await page.waitForSelector(MODAL, { visible: true, timeout: 8000 });
    await sleep(400);
  };
  const checkAllDevices = async () => {
    const boxes = await page.$$(`${MODAL} tbody input[type=checkbox]`);
    for (const b of boxes) if (!(await (await b.getProperty('checked')).jsonValue())) await b.click();
    await sleep(100);
  };
  const layoutNote = () => page.$$eval(`${MODAL} tbody .pick-row`, (els, nm) => els.find((e) => e.querySelector('.layout-pick-name').textContent === nm).querySelector('.layout-pick-note').textContent, lname);
  const modalH = () => page.$eval(MODAL, (m) => Math.round(m.getBoundingClientRect().height));
  const CONFIRM = '.b-modal-overlay:not(:has(.is-batch)) .b-modal.is-alert';
  const escConfirm = async (giveUp) => {
    await page.keyboard.press('Escape');
    await page.waitForSelector(CONFIRM, { visible: true, timeout: 5000 });
    await sleep(250);
    const title = await page.$eval(`${CONFIRM} .b-alert-title`, (e) => e.textContent);
    const btns = await page.$$(`${CONFIRM} .b-alert-foot .b-btn`);
    await btns[giveUp ? btns.length - 1 : 0].click();
    await sleep(400);
    return title;
  };

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.type('#username', USER);
  await page.type('#password', PASS);
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await sleep(400);

  // 0. 表格：沒有勾選欄；離線機器不掛綠勾
  check('表格沒有勾選欄', !(await page.$('#deviceTable .device-check-col')));
  check('「批量調整展示畫面」鈕字與可按', await page.$eval('#showLayoutBtn', (b) => !b.disabled && b.textContent === '批量調整展示畫面'));
  const okIcons = await page.$$eval('#deviceTable tbody tr', (rows) => rows.map((r) => ({ badge: r.querySelector('.b-badge').textContent.trim(), ok: !!r.querySelector('.conn-icon.ok') })));
  check('離線／尚未回報的機器不掛綠勾', okIcons.every((r) => r.badge === '在線' || !r.ok), JSON.stringify(okIcons));

  // 1. 第 1 步：勾機器
  await openWizard();
  await shot('01-step1');
  check('步驟條：第 1 步亮', (await stepState()) === 'active,todo', await stepState());
  const n = devices.length;
  check('機器表：每台一列、有編號/狀態欄、無縮圖無操作區', (await page.$$eval(`${MODAL} tbody input[type=checkbox]`, (cs) => cs.length)) === n && (await page.$$eval(`${MODAL} tbody .device-mono`, (x) => x.length)) === n && (await page.$$eval(`${MODAL} tbody .b-badge`, (x) => x.length)) === n && !(await page.$(`${MODAL} tbody .layout-thumb`)) && !(await page.$(`${MODAL} tbody .b-btn`)));
  const h1 = await modalH();
  check('未勾機器時「下一步」灰掉', await page.$eval(NEXT, (b) => b.disabled));
  await page.click(`${MODAL} thead input[type=checkbox]`);
  await sleep(100);
  check('表頭全選勾了每一台、「下一步」亮起', await page.$$eval(`${MODAL} tbody input[type=checkbox]`, (cs) => cs.every((c) => c.checked)) && await page.$eval(NEXT, (b) => !b.disabled));
  if (n > 1) {
    await page.click(`${MODAL} tbody tr.pick-row td.b-th`); // 點列＝切換
    await sleep(100);
    check('點列取消一台 → 全選框半勾、列不再高亮', await page.$eval(`${MODAL} thead input[type=checkbox]`, (c) => c.indeterminate) && !(await page.$eval(`${MODAL} tbody tr.pick-row`, (r) => r.classList.contains('is-selected'))));
    await page.click(`${MODAL} tbody tr.pick-row td.b-th`);
    await sleep(100);
    check('再點回 → 全選框打勾', await page.$eval(`${MODAL} thead input[type=checkbox]`, (c) => c.checked && !c.indeterminate));
  }

  // 2. 第 2 步：選版面
  await page.click(NEXT);
  await page.waitForSelector(`${MODAL} input[name=pick-layout]`, { visible: true, timeout: 8000 });
  await sleep(500);
  await shot('02-step2');
  check('換步驟 modal 高度不變', (await modalH()) === h1, `${h1} → ${await modalH()}`);
  check('步驟條：第 1 步打勾、第 2 步亮、連接線填色', (await stepState()) === 'done,active' && await page.$eval(`${MODAL} .wiz-bar`, (b) => b.classList.contains('is-done')), await stepState());
  const subT = await page.$eval(`${MODAL} .b-modal-sub`, (e) => e.textContent);
  check('副標只留一句步驟提示', subT === `第 2 步：選擇要在這 ${n} 台機器上展示的共用版面。`, subT);
  check('標題旁有 ? 使用說明', !!(await page.$(`${MODAL} .page-help .b-pop-panel`)));
  const items = await page.$$eval(`${MODAL} tbody .pick-row`, (els) => els.map((el) => ({
    name: el.querySelector('.layout-pick-name')?.textContent, note: el.querySelector('.layout-pick-note')?.textContent,
    disabled: el.querySelector('input').disabled, thumb: !!el.querySelector('.layout-thumb'), cells: el.querySelectorAll('td').length,
  })));
  const it = items.find((i) => i.name === lname);
  check('版面表：有縮圖、建立者/更新時間/狀況欄、無操作區', !!it && it.thumb && it.cells === 6 && !(await page.$(`${MODAL} tbody .b-btn`)), JSON.stringify(items));
  check('每台都是「會先加入」', !!it && it.note.includes('會先加入') && devices.every((d) => it.note.includes(devName(d))), it && it.note);
  check('未選版面時「完成」灰掉', await page.$eval(NEXT, (b) => b.disabled));
  check('左鈕變「上一步」', (await page.$eval(BACK, (b) => b.textContent)) === '上一步');

  // 上一步 → 勾選保留 → 再下一步
  await page.click(BACK);
  await sleep(300);
  check('上一步回到第 1 步且勾選保留', (await stepState()) === 'active,todo' && await page.$$eval(`${MODAL} tbody input[type=checkbox]`, (cs) => cs.every((c) => c.checked)));
  await page.click(NEXT);
  await page.waitForSelector(`${MODAL} input[name=pick-layout]`, { visible: true, timeout: 8000 });
  await sleep(300);
  const radios = await page.$$(`${MODAL} input[name=pick-layout]`);
  await radios[items.findIndex((i) => i.name === lname)].click();
  await sleep(100);
  check('選了版面「完成」亮起', await page.$eval(NEXT, (b) => !b.disabled));

  // 3. 完成 → 每台加入一頁（帶 layoutId）並切到那頁、來源蓋章 web
  await page.click(NEXT);
  await sleep(1500);
  await shot('03-after-show');
  const toast = await page.evaluate(() => { const t = [...document.querySelectorAll('.b-toast-msg')].pop(); return t ? t.textContent.trim() : ''; });
  check('toast 指名機器與版面', toast.includes(`正在切換到「${lname}」`) && devices.every((d) => toast.includes(devName(d))), toast);
  for (const d of devices) {
    const cfg = await getConfig(H, d.DeviceId);
    const pages = cfg.pages || [];
    const last = pages[pages.length - 1];
    check(`${devName(d)}：最後一頁＝版面（layoutId、頁名）`, last && last.layoutId === layout.id && last.name === lname, JSON.stringify({ layoutId: last && last.layoutId, name: last && last.name }));
    check(`${devName(d)}：activePage 指到那頁、來源 web`, cfg.activePage === pages.length - 1 && cfg.activePageSource === 'web', `${cfg.activePage}/${pages.length} ${cfg.activePageSource}`);
  }
  check('對話框已關', !(await page.$(MODAL)));

  // 4. 再開一次：全部「展示中」；Esc 關閉
  await openWizard();
  await checkAllDevices();
  await page.click(NEXT);
  await page.waitForSelector(`${MODAL} input[name=pick-layout]`, { visible: true, timeout: 8000 });
  await sleep(400);
  let note = await layoutNote();
  check('再開：每台「展示中」', note.includes('展示中') && !note.includes('會先加入'), note);
  await shot('04-showing');
  let ct = await escConfirm(false);
  check('動過再 Esc → 先問要不要放棄；取消留在精靈', ct === '要放棄這次批量調整嗎？' && !!(await page.$(MODAL)) && (await stepState()) === 'done,active', ct);
  await shot('04b-confirm-cancel');
  ct = await escConfirm(true);
  check('確認放棄 → 精靈關閉', !(await page.$(MODAL)));

  // 4b. 版面在後台改過 → 再批量套用：預設「會更新成目前版面內容」；取消勾選只切頁；完成後機器那一頁＝版面內容
  const canon = (v) => JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val)) ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]])) : val);
  {
    const sh = (await (await fetch(BASE + '/api/shared-settings', { headers: H })).json()).settings;
    const L = sh.layouts.find((l) => l.id === layout.id);
    L.pages[0].blocks[0].node.text = 'v2 ' + Date.now(); // 改一格文字＝版面內容變了
    L.updatedAt = new Date().toISOString();
    await fetch(BASE + '/api/shared-settings', { method: 'PUT', headers: H, body: JSON.stringify({ settings: sh }) });
    layout.pages = L.pages;
  }
  await page.reload({ waitUntil: 'networkidle2' }); // 前端的 shared 快取要重抓
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await sleep(400);
  await openWizard();
  await checkAllDevices();
  await page.click(NEXT);
  await page.waitForSelector(`${MODAL} input[name=pick-layout]`, { visible: true, timeout: 8000 });
  await sleep(400);
  check('第 2 步沒有「更新」開關（一律更新）', !(await page.$(`${MODAL} .batch-opt`)));
  note = await layoutNote();
  check('版面改過 → 狀況＝展示中，會更新成目前版面內容', note.includes('展示中，會更新成目前版面內容') && devices.every((d) => note.includes(devName(d))), note);
  await shot('04c-stale-update');
  const radios2 = await page.$$(`${MODAL} input[name=pick-layout]`);
  await radios2[items.findIndex((i) => i.name === lname)].click();
  await sleep(100);
  await page.click(NEXT);
  await sleep(1500);
  for (const d of devices) {
    const cfg = await getConfig(H, d.DeviceId);
    const pg = cfg.pages.find((p) => p.layoutId === layout.id);
    check(`${devName(d)}：那一頁內容已更新成版面內容、仍在展示`, !!pg && canon(pg.blocks) === canon(layout.pages[0].blocks) && cfg.activePage === cfg.pages.indexOf(pg), pg ? pg.blocks[0].node.text : 'no page');
  }
  await openWizard();
  await checkAllDevices();
  await page.click(NEXT);
  await page.waitForSelector(`${MODAL} input[name=pick-layout]`, { visible: true, timeout: 8000 });
  await sleep(400);
  note = await layoutNote();
  check('更新後再開：單純「展示中」', note.includes('展示中') && !note.includes('內容') && !note.includes('更新'), note);
  await escConfirm(true);
  await openWizard();
  await page.keyboard.press('Escape');
  await sleep(400);
  check('沒動過直接 Esc → 不問就關', !(await page.$(MODAL)) && !(await page.$(CONFIRM)));

  // 5. 頁名備援：模擬舊版 App 上報把 layoutId 洗掉，並把展示頁切回第一頁 → 仍靠頁名認出、狀態「會切換」
  const d0 = devices[0];
  {
    const cfg = await getConfig(H, d0.DeviceId);
    const pages = cfg.pages.map(({ layoutId, ...p }) => p);
    await fetch(`${BASE}/api/config/${encodeURIComponent(d0.DeviceId)}`, { method: 'PUT', headers: H, body: JSON.stringify({ config: { pages, activePage: 0 } }) });
  }
  await openWizard();
  await checkAllDevices();
  await page.click(NEXT);
  await page.waitForSelector(`${MODAL} input[name=pick-layout]`, { visible: true, timeout: 8000 });
  await sleep(400);
  note = await layoutNote();
  check('洗掉 layoutId 後靠頁名認出 →「會切換」而非「會先加入」', note.includes(`${devName(d0)} 會切換`) && !note.includes('會先加入'), note);
  await shot('05-name-fallback');
  await escConfirm(true);

  check('無 console/page error', errs.length === 0, errs.join(' | '));
  await browser.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
