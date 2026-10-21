/* 園區測站資訊卡（2026-10-20）：後台「共用設定 › 園區測站」（機器設定同款設定卡、內滾、按「儲存」才存、地圖位置不開放調整）
   填照片／說明／連結 → 上傳全程一則進度 toast → 儲存 → /version 帶 parkInfo；
   播放頁攔 API 餵 parkInfo，點測站從上方滑下資訊卡（不壓縮地圖）、遮罩／← （卡開著時變 ✕）／往上滑收起、查看更多開網頁再返回。
   ⚠️ 會改本機開發 DB（KioskAdminDev）的共用設定 parkInfo，跑完會還原成原本的值。
   用法：node test-parkinfo.js（BASE 預設本機 3177） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/$/, '');
const PARK_API = process.env.PARK_API || 'https://joye.justhings.com.tw/api/telemetry/current';
const OUT = path.join(__dirname, 'shots', 'parkinfo');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
// 16×9 PNG：上傳用的測試圖
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAGUlEQVR4nGP4z8Dwn4GBgYGJAQoYGBgYGAAAPAEC5Kwz9QAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1512, height: 828 } });
  const errs = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.USER_ || 'joyeadmin'); await page.type('#password', process.env.PASS_ || 'joye#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true });
  await sleep(500);
  const token = await page.evaluate(() => token);
  const authed = (method, p, body) => page.evaluate(async (m, u, b, t) => (await fetch(u, { method: m, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json(), method, BASE + p, body, token);
  const before = (await authed('GET', '/api/shared-settings')).settings || {};
  const original = before.parkInfo;
  // 測試從乾淨的 D3 開始（上一次中途失敗留下的資料不算），結束時還原成 original
  { // D3 只留名稱與地圖位置（介紹清空）；資料來源與地圖照舊
    const st = { ...((original && original.stations) || {}) };
    const d3 = st.D3 || {};
    st.D3 = { name: d3.name || '不差的花園', x: d3.x ?? 47, y: d3.y ?? 39.2 };
    await authed('PUT', '/api/shared-settings', { settings: { ...before, parkInfo: { ...(original || {}), stations: st } } });
  }
  await page.reload({ waitUntil: 'networkidle2' }); await sleep(800);
  const savedD3 = async () => (await authed('GET', '/api/shared-settings')).settings.parkInfo?.stations?.D3;
  const caretEnd = () => page.evaluate(() => { const ed = document.getElementById('parkDesc'); ed.focus(); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });

  console.log('後台');
  ok(await page.evaluate(() => !document.getElementById('parkNav').classList.contains('hidden')), '側欄有「園區測站」');
  await page.click('#sharedGroupToggle'); await sleep(300);
  await page.click('[data-view="parkInfo"]'); await sleep(1500);
  // 2026-10-20 晚重排：一張卡＝上排測站頁籤（有滑動指示塊）、左介紹右地圖、右下角儲存
  const tabIds = await page.$$eval('#parkBody .park-st-tabs .seg', (b) => b.map((x) => x.dataset.id));
  ok(tabIds.join() === 'D1,D2,D3,D4,D5', `上排頁籤一站一個（${tabIds.join('、')}）`);
  ok(!(await page.$('#parkInfoView .park-tabs')) && !(await page.$('#parkBody .park-card .b-card-head')), '頁首不再分兩種設定、卡片沒有另外的標題（頁籤就是標題）');
  const lay = await page.evaluate(() => { const f = document.querySelector('.park-form').getBoundingClientRect(), m = document.querySelector('.park-map-pane').getBoundingClientRect(); return { right: m.left >= f.right - 1, top: Math.round(m.top - f.top) }; });
  ok(lay.right && Math.abs(lay.top) <= 1, `左介紹、右地圖（${JSON.stringify(lay)}）`);
  ok(await page.$eval('#parkSaveBtn', (b) => !!b.closest('.park-card > .settings-foot') && b.disabled), '儲存鈕在卡片右下角、沒修改時不能按');
  ok(await page.$eval('#parkBody .park-pin.is-sel', (p) => p.dataset.id) === 'D1', '目前這一站（D1）的點亮起');
  await page.click('#parkBody .park-st-tabs .seg[data-id="D3"]'); await sleep(150);
  const ind = await page.evaluate(() => { const i = document.querySelector('.park-st-tabs .seg-ind'), a = document.querySelector('.park-st-tabs .seg[data-id="D3"]'); return { op: getComputedStyle(i).opacity, dx: Math.round(i.getBoundingClientRect().left - a.getBoundingClientRect().left) }; });
  await sleep(500);
  ok(ind.op === '1' && await page.$eval('#parkBody .park-st-tabs .seg.active', (b) => b.dataset.id) === 'D3' && await page.$eval('#parkBody .park-pin.is-sel', (p) => p.dataset.id) === 'D3', `換到 D3：頁籤底色滑過去、地圖上 D3 亮起（${JSON.stringify(ind)}）`);

  // 上傳兩張照片：全程只有一則 toast，進度填滿後變綠勾
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('#parkBody .park-photo-add')]);
  const tmp1 = path.join(OUT, 'test1.png'), tmp2 = path.join(OUT, 'test2.png');
  fs.writeFileSync(tmp1, PNG); fs.writeFileSync(tmp2, PNG);
  await chooser.accept([tmp1, tmp2]);
  await sleep(150);
  const during = await page.evaluate(() => ({ n: document.querySelectorAll('.b-toast').length, prog: document.querySelectorAll('.b-toast-progress').length, icon: !!document.querySelector('.b-toast-progress .b-toast-icon svg') }));
  ok(during.n === 1 && during.prog === 1 && during.icon, `上傳中只有一則進度 toast（${JSON.stringify(during)}）`);
  await sleep(300);
  const mid = await page.evaluate(() => { const t = document.querySelector('.b-toast-progress'); const p = t.querySelector('.b-toast-pct'); const ti = t.querySelector('.b-toast-msg'); const m = /scaleX\(([\d.]+)\)/.exec(t.querySelector('.b-toast-fill').style.transform); return { fill: m ? +(+m[1]).toFixed(2) : -1, done: t.classList.contains('is-success'), pct: p.textContent, row1: Math.abs(p.getBoundingClientRect().top - ti.getBoundingClientRect().top) <= 2 && !p.hidden, desc: !t.querySelector('.b-toast-desc').hidden }; });
  { const r = await page.$eval('.b-toast-progress', (t) => { const b = t.getBoundingClientRect(); return { x: b.x - 8, y: b.y - 8, width: b.width + 16, height: b.height + 16 }; }); await page.screenshot({ path: path.join(OUT, '01a-upload-toast-mid.png'), clip: r }); }
  ok(mid.fill > 0 && mid.fill < 1 && !mid.done,`填色看得到：上傳很快也會慢慢填（${JSON.stringify(mid)}）`);
  ok(mid.row1 && /^\d+%$/.test(mid.pct) && !mid.desc, '百分比在第一排右邊、沒有第二排');
  ok(await page.$$eval('#parkBody .park-photo img', (i) => i.length) === 0, '進度條還沒跑完：照片還沒出現');
  const box0 = await page.$eval('.b-toast-progress', (t) => { const b = t.getBoundingClientRect(); return `${Math.round(b.width)}×${Math.round(b.height)}`; });
  await sleep(1500);
  const after = await page.evaluate(() => { const t = document.querySelector('.b-toast-progress'); const b = t && t.getBoundingClientRect(); return t && { n: document.querySelectorAll('.b-toast').length, ok: t.classList.contains('is-success'), fill: t.querySelector('.b-toast-fill').style.transform, text: t.querySelector('.b-toast-msg').textContent, desc: !t.querySelector('.b-toast-desc').hidden, box: `${Math.round(b.width)}×${Math.round(b.height)}`, morph: !!t.querySelector('.b-toast-icon svg.lucide-morph') }; });
  ok(after && after.n === 1 && after.ok && after.fill === 'scaleX(1)' && /已上傳 2 張照片/.test(after.text), `完成：同一則 toast 填滿、變成功（${JSON.stringify(after)}）`);
  ok(after && !after.desc && after.box === box0, `完成後只有一行、大小不變（${box0} → ${after && after.box}）`);
  ok(after && after.morph, '圖示用變形（上傳 → 勾）');
  await page.screenshot({ path: path.join(OUT, '01-upload-toast.png') });
  ok(await page.$$eval('#parkBody .park-photo img', (i) => i.length) === 2, '兩張縮圖');
  ok((!(await savedD3()) || !((await savedD3()).photos || []).length), '還沒按儲存：伺服器上的 D3 還沒有介紹');
  ok(await page.$eval('#parkSaveBtn', (b) => !b.disabled) && await page.$eval('#parkDirtyNote', (n) => n.classList.contains('is-on')), '有修改：儲存鈕可按、「尚有修改未儲存」');

  await caretEnd(); await page.keyboard.type('花期四月到六月，步道約十分鐘。');
  await page.click('#parkLink'); await page.keyboard.type('ftp://bad');
  ok(await page.$eval('#parkBody .park-err', (e) => !e.hidden), '連結格式不對會提示');
  await page.click('#parkSaveBtn'); await sleep(600);
  ok((!(await savedD3()) || !((await savedD3()).photos || []).length) && await page.evaluate(() => [...document.querySelectorAll('.b-toast-danger .b-toast-msg')].some((m) => /無法儲存/.test(m.textContent))), '連結不對：不存、跳提示');
  await page.$eval('#parkLink', (i) => { i.value = ''; i.dispatchEvent(new Event('input')); });
  await page.click('#parkLink'); await page.keyboard.type('https://example.com/garden');
  ok(await page.$eval('#parkBody .park-err', (e) => e.hidden), '改對後提示消失');
  // 內滾：文件層不捲，設定卡欄位區自己捲
  const scroll = await page.evaluate(() => ({ doc: document.scrollingElement.scrollHeight <= innerHeight + 1, fields: getComputedStyle(document.querySelector('.park-form')).overflowY }));
  ok(scroll.doc && scroll.fields === 'auto', `內滾（${JSON.stringify(scroll)}）`);
  await page.screenshot({ path: path.join(OUT, '02-admin-dirty.png') });
  await page.click('#parkSaveBtn'); await sleep(1200);
  const s1 = await savedD3();
  ok(s1 && s1.photos.length === 2 && s1.desc.startsWith('花期') && s1.link === 'https://example.com/garden', `按儲存才存（${JSON.stringify(s1)}）`);
  ok(await page.$eval('#parkSaveBtn', (b) => b.disabled) && await page.$eval('#parkDirtyNote', (n) => !n.classList.contains('is-on')), '存完：儲存鈕變灰、提示消失');
  const devs = await authed('GET', '/api/devices');
  if (devs.length) {
    const v = await authed('GET', `/api/config/${encodeURIComponent(devs[0].DeviceId)}/version`);
    ok(v.parkInfo && v.parkInfo.stations && v.parkInfo.stations.D3, '/version 帶 parkInfo 給機器');
  }
  ok((await savedD3()).x != null, '存介紹不會動到地圖位置');

  // Ctrl+S 存
  await caretEnd(); await page.keyboard.type('X');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyS'); await page.keyboard.up('Control'); await sleep(1200);
  ok((await savedD3()).desc.endsWith('X'), 'Ctrl+S 儲存');

  // 沒存就換站：先問；取消留在這一站
  await caretEnd(); await page.keyboard.type('Z');
  await page.click('#parkBody .park-st-tabs .seg[data-id="D4"]'); await sleep(600);
  ok(await page.evaluate(() => [...document.querySelectorAll('button')].some((x) => x.offsetParent && x.textContent.trim() === '捨棄')), '沒存就換站：先問');
  await page.keyboard.press('Escape'); await sleep(500);
  ok(await page.$eval('#parkBody .park-st-tabs .seg.active', (b) => b.dataset.id) === 'D3' && await page.$eval('#parkDesc', (t) => t.innerText.trim().endsWith('Z')), '取消：還在 D3（頁籤跳回來）、修改還在');
  await caretEnd(); await page.keyboard.press('Backspace'); await sleep(100);
  ok(await page.$eval('#parkSaveBtn', (b) => b.disabled), '改回原樣：儲存鈕又變灰');
  // 沒存就離開：先問；取消留在原頁，捨棄才換頁、草稿丟掉
  await caretEnd(); await page.keyboard.type('Y');
  await page.click('[data-view="sharedSettings"]'); await sleep(500);
  ok(await page.evaluate(() => !!document.querySelector('.b-modal-overlay.is-open, .bm-overlay.is-open, [role="dialog"][aria-modal="true"]')), '沒存就離開：先問');
  await page.screenshot({ path: path.join(OUT, '03-leave-confirm.png') });
  await page.keyboard.press('Escape'); await sleep(500);
  ok(await page.evaluate(() => !document.getElementById('parkInfoView').classList.contains('hidden')), '取消：留在園區測站');
  await page.click('[data-view="sharedSettings"]'); await sleep(500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && x.textContent.trim() === '捨棄'); b && b.click(); }); await sleep(600);
  ok(await page.evaluate(() => !document.getElementById('sharedSettingsView').classList.contains('hidden')), '捨棄：換到機器設定');
  await sleep(600);
  const foot = await page.evaluate(() => { const c = document.querySelector('#sharedBody .settings-card'); const f = c.querySelector('.settings-foot'); return Math.round(c.getBoundingClientRect().bottom - f.getBoundingClientRect().bottom); });
  ok(foot <= 2, `機器設定：申請帳號／測試連線貼卡片底部（差 ${foot}px）`);
  await page.screenshot({ path: path.join(OUT, '03b-shared-settings.png') });
  await page.click('[data-view="parkInfo"]'); await sleep(800);
  ok(await page.$eval('#parkBody .park-st-tabs .seg.active', (b) => b.dataset.id) === 'D3' && await page.$eval('#parkDesc', (t) => t.innerText.trim().endsWith('X')), '回來：還在 D3、是已儲存的內容（捨棄的沒留下）');

  // 上傳失敗：同一則 toast 轉紅
  await page.setRequestInterception(true);
  const failUpload = (req) => { if (req.url().endsWith('/api/upload')) req.respond({ status: 500, contentType: 'application/json', body: '{}' }); else req.continue(); };
  page.on('request', failUpload);
  const [ch2] = await Promise.all([page.waitForFileChooser(), page.click('#parkBody .park-photo-add')]);
  await ch2.accept([tmp1]); await sleep(1200);
  const bad = await page.evaluate(() => { const t = [...document.querySelectorAll('.b-toast-progress')].pop(); return t && { danger: t.classList.contains('is-danger'), text: t.querySelector('.b-toast-msg').textContent }; });
  ok(bad && bad.danger && /無法上傳/.test(bad.text), `上傳失敗：轉紅（${JSON.stringify(bad)}）`);
  await page.screenshot({ path: path.join(OUT, '04-upload-fail.png') });
  page.off('request', failUpload); await page.setRequestInterception(false);
  await page.evaluate(() => window.setColorMode('dark', false)); await sleep(400);
  await page.screenshot({ path: path.join(OUT, '05-admin-dark.png') });
  await page.evaluate(() => window.setColorMode('light', false));

  // ---------- 頁籤：資料來源、園區地圖（2026-10-20 一套多場域用）----------
  const seeded = (await authed('GET', '/api/shared-settings')).settings.parkInfo;
  ok(seeded && /^https?:/.test(seeded.api) && seeded.map && seeded.map.src && seeded.stations.D1 && seeded.stations.D1.x != null && seeded.stations.D1.name, '卓也舊設定自動搬進共用設定（資料來源、地圖、D1–D5 位置與名稱）');
  ok(await page.$$eval('#parkInfoView .page-actions button', (b) => b.map((x) => x.textContent).join()) === '更換地圖,資料來源', '頁首＝〔更換地圖〕〔資料來源〕（更換地圖在左邊）');
  const mapBtn = (text) => page.evaluate((t) => { const b = [...document.querySelectorAll('#parkBody .park-map-bar button')].find((x) => x.textContent === t || x.getAttribute('aria-label') === t); if (b) b.click(); return !!b; }, text);
  const srcOpen = () => page.evaluate(() => document.getElementById('parkSourceModal').classList.contains('is-visible'));
  const toastHas = async (re, ms = 10000) => { await page.waitForFunction((src) => [...document.querySelectorAll('.b-toast')].some((t) => new RegExp(src).test(t.textContent)), { timeout: ms }, re.source).catch(() => {}); return page.evaluate((src) => [...document.querySelectorAll('.b-toast')].map((t) => t.textContent).find((t) => new RegExp(src).test(t)) || '', re.source); };
  const hh = await page.evaluate(() => { const ss = getComputedStyle(document.getElementById('parkSourceBtn')); return { h: Math.round(document.getElementById('parkSourceBtn').getBoundingClientRect().height), pad: ss.paddingLeft, bg: ss.backgroundColor, color: ss.color }; });
  ok(hh.h === 32 && hh.pad === '18px' && hh.color === 'rgb(255, 255, 255)' && hh.bg !== 'rgba(0, 0, 0, 0)', `「資料來源」＝機器總覽頁首按鈕同高同內距、主題色白字（${JSON.stringify(hh)}）`);
  await page.screenshot({ path: path.join(OUT, '05b-admin-header.png'), clip: { x: 1000, y: 70, width: 512, height: 80 } });
  await page.click('#parkSourceBtn'); await sleep(800);
  ok(await srcOpen(), '資料來源：按頁首按鈕開 modal');
  ok(!(await page.$('#parkSourceModal .park-src-hint, #parkConnDot')), '沒有說明文字、沒有圓點');
  ok(await page.$eval('#parkApiInput', (i) => i.value) === seeded.api && await page.$eval('#parkApiSaveBtn', (b) => b.disabled), '資料來源：顯示目前的網址、沒改不能存');
  await page.click('#parkApiTestBtn');
  const tOk = await toastHas(/連線成功/);
  ok(/讀取到 \d+ 個測站/.test(tOk), `測試連線：結果用 toast（${tOk}）`);
  await page.hover('#parkConnPop .page-help-btn'); await sleep(500);
  const conn = await page.evaluate(() => {
    const p = document.querySelector('#parkConnPop .b-pop-panel'), cs = getComputedStyle(p), r = p.getBoundingClientRect();
    const b = document.querySelector('#parkConnPop .page-help-btn').getBoundingClientRect();
    const lefts = [...p.querySelectorAll('.park-conn-list li')].map((l) => Math.round(l.getBoundingClientRect().left));
    return { vis: cs.visibility === 'visible' && +cs.opacity > 0.5, n: lefts.length, vertical: lefts.length > 1 && new Set(lefts).size === 1, right: Math.round(r.right - b.right), tone: document.getElementById('parkConnPop').dataset.tone, color: getComputedStyle(document.querySelector('#parkConnPop .page-help-btn')).color };
  });
  ok(conn.vis && conn.n >= 5 && conn.vertical && Math.abs(conn.right) <= 1 && /ok|warn/.test(conn.tone), `連線狀態：右上角按鈕 hover 展開、一站一行（${JSON.stringify(conn)}）`);
  await page.screenshot({ path: path.join(OUT, '06-admin-source.png') });
  await page.mouse.move(700, 700); await sleep(400);
  await page.$eval('#parkApiInput', (i) => { i.value = 'https://example.invalid/api/telemetry/current'; i.dispatchEvent(new Event('input')); });
  ok(await page.$eval('#parkApiSaveBtn', (b) => !b.disabled), '改了網址：儲存可以按');
  await page.click('#parkApiTestBtn');
  const tBad = await toastHas(/無法連線到測站資料來源/, 20000);
  ok(!!tBad && await page.$eval('#parkConnPop', (d) => d.dataset.tone === 'err'), `連不上：紅色 toast、連線狀態圖示變紅（${tBad}）`);
  await page.screenshot({ path: path.join(OUT, '06b-admin-source-fail.png') });
  // 讀不到測站的網址：按儲存先問，取消就不存
  await page.click('#parkApiSaveBtn'); await sleep(600);
  ok(await page.evaluate(() => [...document.querySelectorAll('.b-alert-title')].some((t) => t.offsetParent && /無法從這個網址讀取測站資料/.test(t.textContent))), '存讀不到測站的網址：先問');
  await page.screenshot({ path: path.join(OUT, '06d-admin-source-confirm.png') });
  await page.evaluate(() => [...document.querySelectorAll('.b-alert-foot button')].find((x) => x.offsetParent && x.textContent.trim() === '取消').click()); await sleep(600);
  ok(await srcOpen() && (await authed('GET', '/api/shared-settings')).settings.parkInfo.api === seeded.api, '取消：不存、modal 還開著');
  await page.click('#parkSourceClose'); await sleep(500);
  ok(await page.evaluate(() => [...document.querySelectorAll('button')].some((x) => x.offsetParent && x.textContent.trim() === '捨棄')), '改了沒存就關：先問');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.offsetParent && x.textContent.trim() === '捨棄').click()); await sleep(700);
  ok(!(await srcOpen()) && (await authed('GET', '/api/shared-settings')).settings.parkInfo.api === seeded.api, '捨棄：modal 關掉、網址沒被改');
  // 右邊的園區地圖：平常鎖住；按「編輯位置」只能動這一站（D3）的點，點地圖＝把 D3 移過去，跟介紹一起按儲存
  ok(await page.$$eval('#parkBody .park-pin', (p) => p.length) >= 5 && !(await page.$('#parkBody .park-map-edit.is-editing')), '地圖：測站點都在、平常鎖住');
  await page.screenshot({ path: path.join(OUT, '07-admin-map.png') });
  const boxOf = () => page.evaluate(() => { const r = document.querySelector('.park-map-edit').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top)].join(); });
  const mbox0 = await boxOf();
  await mapBtn('編輯位置'); await sleep(60);
  const fxIn = await page.evaluate(() => { const bar = document.querySelector('.park-map-bar'); const row = bar.querySelector('.park-bar-row:not(.park-bar-ghost)'), g = bar.querySelector('.park-bar-ghost'); return { cls: bar.classList.contains('roll-up'), ghost: !!g && /編輯位置$/.test(g.textContent), anim: row.getAnimations().length > 0 && g.getAnimations().length > 0 }; });
  ok(fxIn.cls && fxIn.ghost && fxIn.anim, `編輯位置：整行往上捲（「編輯位置」那一行捲走、新的一行捲上來）${JSON.stringify(fxIn)}`);
  await sleep(450);
  ok(!!(await page.$('#parkBody .park-map-edit.is-editing')) && await page.$eval('#parkPlaceBtn', (b) => b.textContent === '完成') && !(await page.$('.park-bar-ghost')), '按「編輯位置」才能動（捲完只剩新的一行）');
  ok(await page.evaluate(() => { const b = document.querySelector('.park-map-bar').getBoundingClientRect(), m = document.querySelector('.park-map-edit').getBoundingClientRect(); return b.bottom <= m.top; }), '按鈕列在地圖上方');
  const mbox1 = await boxOf();
  ok(mbox1 === mbox0, `進入編輯位置：地圖大小與位置不變（${mbox0} → ${mbox1}）`);
  const mb = await page.$eval('#parkBody .park-map-edit', (m) => { const r = m.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const pinAt = (id) => page.$eval(`#parkBody .park-pin[data-id="${id}"]`, (p) => [parseFloat(p.style.left), parseFloat(p.style.top)]);
  const d1Before = await pinAt('D1');
  await page.mouse.click(mb.x + mb.w * 0.6, mb.y + mb.h * 0.3); await sleep(500);
  const d3New = await pinAt('D3'), d1After = await pinAt('D1');
  ok(await page.$eval('#parkSaveBtn', (b) => !b.disabled) && Math.abs(d3New[0] - 60) < 2 && Math.abs(d3New[1] - 30) < 2 && d1After.join() === d1Before.join(), `點地圖：只移動這一站 D3（${d3New}），別站不動`);
  await page.screenshot({ path: path.join(OUT, '08-admin-map-edit.png') });
  await page.click('#parkSaveBtn'); await sleep(1200);
  const d3pos = (await authed('GET', '/api/shared-settings')).settings.parkInfo.stations.D3;
  ok(d3pos && Math.abs(d3pos.x - 60) < 2 && Math.abs(d3pos.y - 30) < 2 && d3pos.desc.endsWith('X') && !(await page.$('#parkBody .park-map-edit.is-editing')), `儲存：位置跟介紹一起存（D3 → ${d3pos && d3pos.x}, ${d3pos && d3pos.y}）、存完回到鎖住`);
  // 沒有修改時進出「編輯位置」：儲存鈕不會閃（以前每次重畫都先建成可按再變灰，顏色漸變看得到）
  await page.evaluate(() => { window.__saveRuns = 0; document.addEventListener('transitionrun', (e) => { if (e.target && e.target.id === 'parkSaveBtn') window.__saveRuns++; }, true); });
  await mapBtn('編輯位置'); await sleep(500); await mapBtn('完成'); await sleep(500);
  await mapBtn('編輯位置'); await sleep(500); await mapBtn('取消'); await sleep(500);
  ok(await page.evaluate(() => window.__saveRuns) === 0 && await page.$eval('#parkSaveBtn', (b) => b.disabled), '沒有修改時按編輯位置→完成／取消：儲存鈕不閃、維持灰色');
  // 完成：先倒著播（取消收回、「完成」變回「編輯位置」）才鎖回去
  await mapBtn('編輯位置'); await sleep(500);
  await mapBtn('完成'); await sleep(60);
  const fxOut = await page.evaluate(() => ({ cls: !!document.querySelector('.park-map-bar.roll-down .park-bar-ghost'), still: !!document.querySelector('.park-map-edit.is-editing') }));
  await sleep(450);
  ok(fxOut.cls && fxOut.still && !(await page.$('#parkBody .park-map-edit.is-editing')) && await page.$eval('#parkPlaceBtn', (b) => b.textContent === '編輯位置'), `完成：先整行往下捲再鎖回去（${JSON.stringify(fxOut)}）`);
  // 更換地圖：已經有站放在地圖上／填了介紹＝先跳警示框；取消＝不開選檔視窗
  await page.click('#parkMapBtn'); await sleep(500);
  const mapDlg = await page.evaluate(() => { const t = [...document.querySelectorAll('.b-alert-title')].find((x) => x.offsetParent); return t ? t.closest('.b-modal').textContent : ''; });
  ok(/要更換園區地圖嗎/.test(mapDlg) && /5 個測站已放在地圖上/.test(mapDlg) && /已填寫介紹/.test(mapDlg) && /套用新地圖/.test(mapDlg) && !/儲存/.test(mapDlg), `更換地圖：先跳警示框（${mapDlg.slice(0, 60)}…）`);
  await page.screenshot({ path: path.join(OUT, '08c-admin-change-map-confirm.png') });
  let chooserOpened = false;
  const watchChooser = page.waitForFileChooser({ timeout: 800 }).then(() => { chooserOpened = true; }).catch(() => {});
  await page.evaluate(() => [...document.querySelectorAll('.b-alert-foot button')].find((x) => x.offsetParent && x.textContent.trim() === '取消').click());
  await watchChooser;
  ok(!chooserOpened, '警示框按取消：不會開選檔視窗');
  const [mapChooser] = await Promise.all([page.waitForFileChooser({ timeout: 3000 }), (async () => { await page.click('#parkMapBtn'); await sleep(400); await page.evaluate(() => [...document.querySelectorAll('.b-alert-foot button')].find((x) => x.offsetParent && x.textContent.trim() === '選擇新地圖').click()); })()]);
  ok(!!mapChooser, '警示框按「選擇新地圖」：才開選檔視窗');
  await mapChooser.cancel();
  // 回到預設位置（卓也原本的 D3＝47, 39.2）→ 地圖下方「取消」退回這次編輯前（60, 30）
  await mapBtn('編輯位置'); await sleep(400);
  ok(await page.$eval('#parkHomeBtn', (b) => !b.disabled), '編輯位置：D3 不在預設位置時「回到預設位置」可以按');
  const barLay = await page.evaluate(() => {
    const bar = document.querySelector('.park-map-bar'), tools = bar.querySelector('.park-bar-tools');
    const texts = [...bar.querySelectorAll('.park-bar-row:not(.park-bar-ghost) > .b-btn')].map((b) => b.textContent);
    const icons = [...tools.querySelectorAll('.park-icon-btn')].map((b) => b.getAttribute('aria-label'));
    const rows = new Set([...bar.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().top))).size;
    return { texts, icons, rows, leftIcons: tools.getBoundingClientRect().left - bar.getBoundingClientRect().left < 2 };
  });
  ok(barLay.texts.join() === '取消,完成' && barLay.icons.join() === '回到預設位置,從地圖移除' && barLay.rows === 1 && barLay.leftIcons, `編輯位置的按鈕：左邊圖示、右邊取消／完成、一排（${JSON.stringify(barLay)}）`);
  await page.hover('#parkHomeBtn'); await sleep(300);
  ok(await page.evaluate(() => { const t = document.querySelector('.b-tip.is-mini.is-on'); return !!t && t.textContent === '回到預設位置'; }), '滑過圖示：出現名稱小標籤');
  await page.screenshot({ path: path.join(OUT, '08b-admin-map-bar.png') });
  await mapBtn('回到預設位置'); await sleep(400);
  ok(!(await page.$('.b-tip.is-mini')), '按了圖示：小標籤收掉、不會殘留');
  const d3Home = await pinAt('D3');
  ok(Math.abs(d3Home[0] - 47) < 0.2 && Math.abs(d3Home[1] - 39.2) < 0.2 && await page.$eval('#parkHomeBtn', (b) => b.disabled) && await page.$eval('#parkSaveBtn', (b) => !b.disabled), `回到預設位置：D3 回到卓也原本的位置（${d3Home}）`);
  await mapBtn('取消'); await sleep(400);
  const d3Back = await pinAt('D3');
  ok(Math.abs(d3Back[0] - 60) < 2 && Math.abs(d3Back[1] - 30) < 2 && !(await page.$('#parkBody .park-map-edit.is-editing')) && await page.$eval('#parkSaveBtn', (b) => b.disabled), `地圖的「取消」：退回這次編輯前的位置、鎖回去（${d3Back}）`);
  // 卡片右下角「取消」：位置與文字一起退回已儲存的樣子
  ok(await page.$eval('#parkCancelBtn', (b) => b.hidden), '沒有修改：右下角的「取消」不出現');
  await mapBtn('編輯位置'); await sleep(300);
  await page.mouse.click(mb.x + mb.w * 0.4, mb.y + mb.h * 0.6); await sleep(400);
  await caretEnd(); await page.keyboard.type('Q');
  ok(await page.$eval('#parkCancelBtn', (b) => !b.hidden), '有修改：右下角出現「取消」');
  await page.click('#parkCancelBtn'); await sleep(500);
  const d3Undo = await pinAt('D3');
  ok(Math.abs(d3Undo[0] - 60) < 2 && await page.$eval('#parkDesc', (t) => !t.innerText.trim().endsWith('Q')) && await page.$eval('#parkCancelBtn', (b) => b.hidden) && !(await page.$('#parkBody .park-map-edit.is-editing')), '卡片的「取消」：位置與說明都退回已儲存的樣子');
  // 編輯中沒存就點地圖上別站的點（＝換到那一站）：先問，捨棄才換
  await mapBtn('編輯位置'); await sleep(400);
  await page.mouse.click(mb.x + mb.w * 0.4, mb.y + mb.h * 0.6); await sleep(400);
  await page.click('#parkBody .park-pin[data-id="D1"]'); await sleep(600);
  ok(await page.evaluate(() => [...document.querySelectorAll('button')].some((x) => x.offsetParent && x.textContent.trim() === '捨棄')), '位置沒存就點別站的點：先問');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.offsetParent && x.textContent.trim() === '捨棄').click()); await sleep(800);
  ok(await page.$eval('#parkBody .park-st-tabs .seg.active', (b) => b.dataset.id) === 'D1' && await page.$eval('#parkBody .park-pin.is-sel', (p) => p.dataset.id) === 'D1' && Math.abs((await authed('GET', '/api/shared-settings')).settings.parkInfo.stations.D3.x - 60) < 2, '捨棄：換到 D1、D3 的位置沒被改');
  // 清空資料來源：測站介紹改成「還沒設定測站資料來源」；從空狀態的按鈕再填回去
  await page.click('#parkSourceBtn'); await sleep(600);
  await page.$eval('#parkApiInput', (i) => { i.value = ''; i.dispatchEvent(new Event('input')); });
  await page.click('#parkApiSaveBtn'); await sleep(1200);
  ok((await authed('GET', '/api/shared-settings')).settings.parkInfo.api === '' && !(await srcOpen()), '清空資料來源並儲存（modal 關掉）');
  ok(await page.evaluate(() => /尚未設定測站資料來源/.test(document.getElementById('parkBody').textContent)), '沒有資料來源：測站介紹提示先去設定');
  await page.screenshot({ path: path.join(OUT, '06c-admin-no-source.png') });
  await page.evaluate(() => [...document.querySelectorAll('#parkBody .park-empty button')].find((b) => b.textContent === '設定資料來源').click()); await sleep(600);
  ok(await srcOpen(), '空狀態的「設定資料來源」：開 modal');
  await page.click('#parkApiInput'); await page.keyboard.type(seeded.api);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyS'); await page.keyboard.up('Control'); await sleep(1200); // ⌘S／Ctrl+S 也能存
  ok((await authed('GET', '/api/shared-settings')).settings.parkInfo.api === seeded.api && !(await srcOpen()), '填回資料來源（Ctrl+S）');
  // 更換地圖（user 2026-10-21：全部放好才套用）：上傳新圖 → 新地圖只在後台、所有站要重放；換站不會不見；
  // 原本在地圖上的站都放好（或「從地圖移除」）才能按「套用新地圖」，一次存進去（測試最後會還原）
  await sleep(800);
  const savedBefore = (await authed('GET', '/api/shared-settings')).settings.parkInfo;
  const [newMap] = await Promise.all([page.waitForFileChooser({ timeout: 3000 }), (async () => { await page.click('#parkMapBtn'); await sleep(400); await page.evaluate(() => [...document.querySelectorAll('.b-alert-foot button')].find((x) => x.offsetParent && x.textContent.trim() === '選擇新地圖').click()); })()]);
  await newMap.accept([tmp1]); await sleep(2600);
  const todoIds = () => page.$$eval('#parkBody .park-st-tabs .seg.is-todo', (b) => b.map((x) => x.dataset.id));
  const swapState = () => page.evaluate(() => ({ pins: document.querySelectorAll('#parkBody .park-pin').length, editing: !!document.querySelector('.park-map-edit.is-editing'),
    tip: (document.querySelector('.park-map-tip:not(.is-count)') || {}).textContent || '', count: (document.querySelector('.park-map-tip.is-count') || {}).textContent || '',
    apply: (() => { const b = document.getElementById('parkSwapApplyBtn'); return b ? { text: b.textContent, disabled: b.disabled } : null; })(),
    note: (document.getElementById('parkDirtyNote') || {}).textContent || '', tabs: !!document.querySelector('#parkBody .park-pane-tabs') }));
  const t0 = await todoIds();
  let sw0 = await swapState();
  const dbSame = (await authed('GET', '/api/shared-settings')).settings.parkInfo.map.src === savedBefore.map.src;
  ok(sw0.pins === 0 && sw0.editing && /按一下地圖以放置/.test(sw0.tip) && t0.length >= 2 && sw0.count === `還有 ${t0.length} 個測站尚未放置` && sw0.apply && sw0.apply.text === '套用新地圖' && sw0.apply.disabled && sw0.note === '新地圖尚未套用' && !sw0.tabs && dbSame,
    `換了地圖：新地圖只在後台（機器沒換）、所有站等著重放、頁籤標出 ${t0.join('、')}、「套用新地圖」還不能按（${JSON.stringify(sw0)}）`);
  await page.screenshot({ path: path.join(OUT, '08d-admin-swap-map.png') });
  // 一站一站放：換站後新地圖與放好的位置都還在；最後一站按「從地圖移除」＝不放在新地圖上
  const clickMap = async (fx, fy) => { const mb = await page.$eval('#parkBody .park-map-edit', (m) => { const r = m.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); await page.mouse.click(mb.x + mb.w * fx, mb.y + mb.h * fy); };
  for (const [i, sid] of t0.entries()) {
    await page.click(`#parkBody .park-st-tabs .seg[data-id="${sid}"]`); await sleep(600);
    if (i === t0.length - 1) { await page.click('#parkBody .park-icon-btn[aria-label="從地圖移除"]'); await sleep(400); }
    else { await clickMap(0.2 + 0.12 * i, 0.3 + 0.1 * i); await sleep(400); }
    if (i === 1) {
      const mid = await swapState();
      ok(mid.editing && mid.pins === 2 && mid.count === `還有 ${t0.length - 2} 個測站尚未放置` && mid.apply.disabled, `換站後新地圖還在、放好的 ${t0[0]} 也還在（${JSON.stringify(mid)}）`);
    }
  }
  const sw1 = await swapState();
  ok(sw1.count === '所有測站都已處理' && !sw1.apply.disabled && (await todoIds()).length === 0 && /不放在新地圖上/.test(sw1.tip), `都處理完：「套用新地圖」可以按（${JSON.stringify(sw1)}）`);
  await page.click('#parkSwapApplyBtn'); await sleep(1600);
  const afterSwap = (await authed('GET', '/api/shared-settings')).settings.parkInfo;
  const withPos = Object.entries(afterSwap.stations).filter(([, e]) => e.x != null).map(([k]) => k).sort();
  const wantPos = t0.slice(0, -1).sort();
  ok(afterSwap.map.src !== savedBefore.map.src && withPos.join() === wantPos.join() && !(await page.$('#parkBody .park-map-edit.is-editing')) && await page.$eval('#parkPlaceBtn', (b) => b.textContent === '編輯位置'),
    `套用新地圖：地圖換成新的、放好的 ${wantPos.join('、')} 在新地圖上、${t0[t0.length - 1]} 不在（${withPos.join() || '無'}）`);

  // ---------- 播放頁 ----------
  // 分區＋簡易格式（2026-10-21）：工具列做小標題／粗體／條列／連結 → 存成 descRich＋純文字 desc；右邊〔資訊卡預覽〕即時照格式畫
  ok(await page.$$eval('#parkBody .park-sec-title', (h) => h.map((x) => x.textContent).join()) === '照片,介紹,看更多連結', '左邊分成三區：照片／介紹／看更多連結');
  await page.click('#parkBody .park-st-tabs .seg[data-id="D2"]'); await sleep(700);
  await caretEnd();
  await page.click('.park-rich-bar [data-cmd="heading"]'); await page.keyboard.type('花期');
  await page.keyboard.press('Enter'); await page.keyboard.type('四月到六月，');
  await page.click('.park-rich-bar [data-cmd="bold"]'); await page.keyboard.type('清晨'); await page.click('.park-rich-bar [data-cmd="bold"]'); await page.keyboard.type('最美。');
  await page.keyboard.press('Enter');
  await page.click('.park-rich-bar [data-cmd="list"]'); await page.keyboard.type('步道約 10 分鐘');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.type('官網');
  await page.keyboard.down('Shift'); await page.keyboard.press('Home'); await page.keyboard.up('Shift');
  await page.click('.park-rich-bar [data-cmd="link"]'); await sleep(400);
  await page.keyboard.type('https://example.com/x');
  await page.evaluate(() => [...document.querySelectorAll('.b-alert-foot button')].find((x) => x.offsetParent && x.textContent.trim() === '加入').click()); await sleep(400);
  const wantMd = '### 花期\n四月到六月，**清晨**最美。\n- 步道約 10 分鐘\n[官網](https://example.com/x)';
  const md = await page.evaluate(() => ParkRich.fromEditor(document.getElementById('parkDesc')));
  ok(md === wantMd, `工具列：小標題、粗體（再按一次取消）、條列、連結（${JSON.stringify(md)}）`);
  const drop = await page.evaluate(async () => {
    const map = document.querySelector('.park-pane-stage .park-map-edit'); map.dataset.mark = '1';
    [...document.querySelectorAll('.park-pane-tabs .seg')].find((x) => x.textContent === '資訊卡預覽').click();
    await new Promise((r) => setTimeout(r, 40));
    const layer = map.querySelector('.park-pv-layer');
    return { same: document.querySelector('.park-pane-stage .park-map-edit') === map, layer: !!layer, anim: layer ? [...layer.querySelectorAll('.park-pv-sheet, .park-pv-scrim')].map((x) => x.getAnimations().map((a) => a.animationName).join('')).join(',') : '', edit: document.querySelector('.park-bar-act').hidden };
  });
  ok(drop.same && drop.layer && /park-pv-drop/.test(drop.anim) && /park-pv-fade-in/.test(drop.anim) && drop.edit, `換到資訊卡預覽：同一張地圖，資訊卡從上方掉下來、遮罩淡入、「編輯位置」收起（${JSON.stringify(drop)}）`);
  await sleep(700);
  ok(await page.evaluate(() => !!document.querySelector('.park-map-edit .park-pv-layer .park-pv-scrim') && !!document.querySelector('.park-map-edit > img')), '預覽：資訊卡蓋在這張地圖上（遮罩在中間）');
  const pv = await page.evaluate(() => { const s = document.querySelector('.park-pv-sheet'); const d = s && s.querySelector('.park-pv-desc'); return s && { title: s.dataset.name, noTitle: !s.querySelector('.park-pv-title, .park-pv-close'), more: s.querySelector('.park-pv-more')?.textContent, h4: d && d.querySelector('h4')?.textContent, b: d && d.querySelector('b')?.textContent, li: d ? d.querySelectorAll('li').length : 0, a: d && d.querySelector('a')?.getAttribute('href'), ps: +s.style.getPropertyValue('--ps') }; });
  ok(pv && pv.title === '廣場中庭' && pv.noTitle && pv.h4 === '花期' && pv.b === '清晨' && pv.li === 1 && pv.a === 'https://example.com/x' && pv.ps > 0.15, `資訊卡預覽：照展示機的版型與格式畫（${JSON.stringify(pv)}）`);
  await page.screenshot({ path: path.join(OUT, '09-admin-rich-preview.png') });
  await caretEnd(); await page.keyboard.type('!'); await sleep(200);
  ok(await page.evaluate(() => /官網!/.test(document.querySelector('.park-pv-desc').textContent)), '預覽開著時繼續打字：預覽即時更新');
  await caretEnd(); await page.keyboard.press('Backspace');
  await page.click('#parkSaveBtn'); await sleep(1200);
  const d2 = (await authed('GET', '/api/shared-settings')).settings.parkInfo.stations.D2;
  ok(d2 && d2.descRich === wantMd && d2.desc === '花期\n四月到六月，清晨最美。\n・步道約 10 分鐘\n官網', `存檔：descRich＝簡易格式、desc＝純文字版（${JSON.stringify(d2 && { descRich: d2.descRich, desc: d2.desc })}）`);
  // 400 字硬上限（user 2026-10-21）：注音選字（composition，瀏覽器擋不住）打超過，超出的字打完就刪掉，不用等到儲存才提示
  const cdp = await page.target().createCDPSession();
  await page.evaluate((n) => { const ed = document.getElementById('parkDesc'); ed.innerHTML = '<div>' + '字'.repeat(n) + '</div>'; ed.dispatchEvent(new Event('input', { bubbles: true })); }, 398);
  await caretEnd();
  await cdp.send('Input.imeSetComposition', { text: 'ㄘㄜˋ', selectionStart: 3, selectionEnd: 3 });
  await cdp.send('Input.insertText', { text: '測試文字' }); await sleep(300);
  const lim = await page.evaluate(() => { const ed = document.getElementById('parkDesc'); const c = document.querySelector('#parkBody .park-count'); return { n: ParkRich.toPlain(ParkRich.fromEditor(ed)).length, kept: ed.textContent.startsWith('字'.repeat(398)), count: c.textContent, over: c.classList.contains('is-over') }; });
  ok(lim.n === 400 && lim.kept && lim.count === '400 / 400' && !lim.over, /* CDP 模擬選字在後台頁面會多留一個注音（跟字數限制無關，拿掉編輯器的處理也一樣），只驗字數 */ `注音選字打超過：超出的字直接刪掉，剛好 400 字（${JSON.stringify(lim)}）`);
  await page.keyboard.type('多'); await sleep(200);
  ok(await page.evaluate(() => ParkRich.toPlain(ParkRich.fromEditor(document.getElementById('parkDesc'))).length === 400), '滿 400 字再打：打不進去');
  await page.click('#parkCancelBtn'); await sleep(500);
  // 點遮罩／地圖沒有作用，預覽照樣開著；只能用上方的〔地圖｜資訊卡預覽〕收起
  await page.evaluate(() => { document.querySelector('.park-pv-scrim').click(); document.querySelector('.park-map-edit').click(); }); await sleep(400);
  ok(!!(await page.$('.park-pv-layer:not(.is-leaving)')) && await page.$eval('.park-pane-tabs .seg.active', (b) => b.textContent === '資訊卡預覽'), '點遮罩、點地圖：預覽照樣開著');
  await page.evaluate(() => [...document.querySelectorAll('.park-pane-tabs .seg')].find((x) => x.textContent === '地圖').click()); await sleep(60);
  const lift = await page.evaluate(() => { const l = document.querySelector('.park-pv-layer'); return { leaving: !!l && l.classList.contains('is-leaving'), anim: l ? l.querySelector('.park-pv-sheet').getAnimations().map((a) => a.animationName).join('') : '' }; });
  await sleep(400);
  ok(lift.leaving && lift.anim === 'park-pv-lift' && !(await page.$('.park-pv-layer')) && await page.$eval('.park-bar-act', (a) => !a.hidden), `按〔地圖〕：資訊卡往上收回去、「編輯位置」回來（${JSON.stringify(lift)}）`);

  console.log('播放頁');
  const long = Array.from({ length: 48 }, (_, i) => `第 ${i + 1} 行：步道沿途的植物介紹。`).join('\n'); // 一行一行很多行：超過 78% 要在 sheet 裡捲
  // 新版：地圖、測站位置、資料來源都照後台設定（格子不帶 wStUrl）；D3 故意放在跟內建不一樣的位置
  let parkInfo = { api: PARK_API, map: { src: seeded.map.src, w: seeded.map.w, h: seeded.map.h }, stations: {
    D3: { name: '不差的花園', x: 60, y: 30, photos: [s1.photos[0], s1.photos[1]], desc: '花期四月到六月，步道約十分鐘。\n第二行說明。', link: 'https://example.com/garden' },
    D1: { name: '遊園入口', x: 9.5, y: 50.7, photos: [], desc: '遊園入口，服務台在左手邊。', descRich: '### 服務台\n遊園入口，服務台在**左手邊**。\n- 寄物\n- 輪椅借用', link: '' },
    D2: { name: '廣場中庭', x: 34, y: 54.2, photos: [], desc: '', link: '' },
    D4: { name: '藍染長廊', x: 90, y: 82.7, photos: [s1.photos[0]], desc: long, link: 'https://example.com/long' },
  } };
  const cfg = { activePage: 0, idleReturnSec: 60, pages: [{ id: 1, name: '首頁', blocks: [{ id: 1, w: 1, node: { t: 'cell', bg: 'Solid', bgColor: 4279060385, content: 'Text', text: '園區', tap: 'OpenParkInfo', parkHere: 'D2' } }] }] };
  const pp = await browser.newPage();
  pp.on('pageerror', (e) => errs.push('PLAY PAGEERROR: ' + e.message));
  await pp.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await pp.setViewport({ width: +process.env.PLAY_W || 540, height: +process.env.PLAY_H || 960 }); // PLAY_W=1080 PLAY_H=1920＝實際直式機器大小
  await pp.setRequestInterception(true);
  pp.on('request', async (req) => {
    const u = req.url();
    const json = (o, delay = 0) => setTimeout(() => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(o) }).catch(() => {}), delay);
    if (/\/api\/station\/current/.test(u)) { try { const r = await fetch(PARK_API); return req.respond({ status: 200, contentType: 'application/json', body: await r.text() }); } catch { return json({ stations: [] }); } }
    if (/\/api\/config\/[^/]+\/version/.test(u)) return json({ version: 5, parkInfo });
    if (/\/api\/config\/[^/]+\/wait/.test(u)) return json({ version: 5, parkInfo }, 30000);
    if (/\/api\/config\/[^/?]+$/.test(u) && req.method() === 'GET') return json({ config: cfg, themeColor: '#0051A8', parkInfo });
    if (/\/api\/config\//.test(u)) return json({ version: 5 });
    if (/\/api\/devices\/.+\/events/.test(u)) return json({ ok: true });
    if (u.startsWith('https://example.com/')) return req.respond({ status: 200, contentType: 'text/html', body: '<h1>garden</h1>' });
    return req.continue();
  });
  await pp.goto(BASE + '/play/?device=parktest&key=test&id=web-parktest', { waitUntil: 'domcontentloaded' });
  await pp.waitForSelector('.page.in .cell', { timeout: 15000 });
  await sleep(500);
  await pp.click('.page.in .cell'); await sleep(2500);
  const sheet = () => pp.evaluate(() => {
    const s = document.querySelector('.park-sheet-layer:not([style*="pointer-events"]) .park-sheet');
    if (!s) return null;
    const b = document.getElementById('ovBody').getBoundingClientRect(), r = s.getBoundingClientRect();
    const ph = s.querySelector('.park-card-photo'), sc = s.querySelector('.park-sheet-scroll'), cs = getComputedStyle(sc);
    const more = s.querySelector('.park-card-more');
    return { title: s.getAttribute('aria-label'), noTitle: !s.querySelector('.park-card-title, .park-card-close'), more: !!more, moreText: more ? more.textContent.replace('chevron_right', '') : '',
      moreFull: more ? Math.abs(more.getBoundingClientRect().width - (sc.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))) < 1.5 : null,
      photoFull: ph ? Math.abs(ph.getBoundingClientRect().width - (sc.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))) < 1.5 : null,
      // 查看更多固定在底部（不在捲動區裡）、離 sheet 底 24·ps；sheet 下緣圓角＝膠囊半徑＋24（同心）
      morePinned: more ? !more.closest('.park-sheet-scroll') && Math.abs(s.getBoundingClientRect().bottom - more.getBoundingClientRect().bottom - 24 * +getComputedStyle(s.closest('.park-sheet-layer')).getPropertyValue('--ps')) < 1.5 : null,
      concentric: more ? Math.abs(parseFloat(getComputedStyle(s).borderBottomLeftRadius) - (more.getBoundingClientRect().height / 2 + 24 * +getComputedStyle(s.closest('.park-sheet-layer')).getPropertyValue('--ps'))) < 1.5 : null,
      back: document.querySelector('#ovBack .material-icons').dataset.to || document.querySelector('#ovBack .material-icons').textContent,
      photos: s.querySelectorAll('.park-card-photo img').length,
      top: Math.round(r.top - b.top), hPct: Math.round((r.height / b.height) * 100), scrollable: s.querySelector('.park-sheet-scroll').classList.contains('is-scrollable') };
  });
  const mapBox = () => pp.$eval('.park-map', (m) => { const r = m.getBoundingClientRect(); return `${Math.round(r.top)}/${Math.round(r.height)}`; });
  ok(!(await sheet()), '一進來不自動開資訊卡');
  const geo = await pp.evaluate(() => {
    const m = document.querySelector('.park-map'), img = m.querySelector('img'), d3 = m.querySelector('.park-marker[data-id="D3"]');
    const r = img.getBoundingClientRect(), p = d3.getBoundingClientRect();
    return { src: img.getAttribute('src'), n: m.querySelectorAll('.park-marker').length, x: Math.round(((p.left + p.width / 2 - r.left) / r.width) * 100), y: Math.round(((p.top + p.height / 2 - r.top) / r.height) * 100) };
  });
  ok(/\/files\//.test(geo.src) && geo.n === 4 && Math.abs(geo.x - 60) <= 1 && Math.abs(geo.y - 30) <= 1, `地圖與測站位置照後台設定（${JSON.stringify(geo)}）`);
  const map0 = await mapBox();
  await pp.click('.park-marker[data-id="D3"]'); await sleep(500);
  let c = await sheet();
  ok(c && /不差的花園/.test(c.title) && c.photos === 2 && c.more && c.top === 0, `點 D3：資訊卡從頂欄下方滑下（${JSON.stringify(c)}）`);
  ok(c.noTitle && c.photoFull && c.moreFull && c.moreText === '查看更多' && c.back === 'close', `卡裡沒有站名與 ✕、照片與「查看更多」滿寬、左上角變 ✕（${JSON.stringify(c)}）`);
  // 資訊卡大小跟著版面（user 2026-10-21）：KIOSK＝跟頂欄一樣放大（0.45 × 寬度倍率 × 1.6，文字再 × 1.45），手機操作模式＝一般大小（0.45）
  const sizeOf = () => pp.evaluate(() => { const l = document.querySelector('.park-sheet-layer'); const d = l && l.querySelector('.park-card-desc'); return l && { ps: +l.style.getPropertyValue('--ps'), pt: +l.style.getPropertyValue('--pt'), font: d ? parseFloat(getComputedStyle(d).fontSize) : 0 }; });
  const kioskSize = await sizeOf();
  ok(kioskSize && Math.abs(kioskSize.ps - 0.72) < 0.01 && Math.abs(kioskSize.pt / kioskSize.ps - 1.45) < 0.01, `KIOSK 版面：資訊卡跟頂欄一樣放大（${JSON.stringify(kioskSize)}）`);
  ok(c.morePinned && c.concentric, `「查看更多」固定在 sheet 底部、下緣圓角跟膠囊同心（${JSON.stringify({ morePinned: c.morePinned, concentric: c.concentric })}）`);
  ok((await mapBox()) === map0, `地圖沒被壓縮（${map0}）`);
  ok(await pp.evaluate(() => !!document.querySelector('.park-scrim')), '下面有半透明遮罩');
  await pp.screenshot({ path: path.join(OUT, '06-play-sheet.png') });
  await pp.click('.park-card-more'); await sleep(60);
  const navIn = await pp.evaluate(() => { const w = document.querySelector('.park-web'); return w ? w.getAnimations().map((a) => a.animationName).join() : ''; });
  await sleep(840);
  ok(await pp.evaluate(() => !!document.querySelector('.park-web:not([hidden]) iframe')) && navIn === 'navSlideIn', `查看更多：網頁從右側推進來（${navIn}）`);
  await pp.click('#ovBack'); await sleep(60);
  const navOut = await pp.evaluate(() => { const w = document.querySelector('.park-web'); return w ? w.getAnimations().map((a) => a.animationName).join() : ''; });
  ok(navOut === 'navSlideOut', `返回：網頁往右滑出去（${navOut}）`);
  await sleep(640);
  ok(await pp.evaluate(() => !document.querySelector('.park-web')) && !!(await sheet()), '← 先關網頁：回到資訊卡');
  await sleep(400);
  ok(await pp.$eval('#ovBack', (b) => b.querySelector('.material-icons').textContent === 'close' && b.getAttribute('aria-label') === '收起資訊卡'), '回到資訊卡：左上角又是 ✕');
  await pp.click('#ovBack'); await sleep(600);
  ok(!(await sheet()) && await pp.evaluate(() => !document.getElementById('overlay').hidden), '再按 ✕：收卡、還在園區資訊');
  ok(await pp.$eval('#ovBack', (b) => b.querySelector('.material-icons').textContent === 'arrow_back' && b.getAttribute('aria-label') === '上一頁'), '收卡後：左上角變回 ←');
  // 點遮罩收起
  await pp.click('.park-marker[data-id="D1"]'); await sleep(500);
  c = await sheet();
  ok(c && /遊園入口/.test(c.title) && c.photos === 0 && !c.more, '點 D1：沒照片、沒連結的卡');
  const rich = await pp.evaluate(() => { const d = document.querySelector('.park-sheet .park-card-desc'); return d && { rich: d.classList.contains('is-rich'), h4: d.querySelector('h4')?.textContent, b: d.querySelector('b')?.textContent, li: d.querySelectorAll('li').length }; });
  ok(rich && rich.rich && rich.h4 === '服務台' && rich.b === '左手邊' && rich.li === 2, `播放頁：介紹照簡易格式畫（${JSON.stringify(rich)}）`);
  await pp.mouse.click(10, (+process.env.PLAY_H || 960) - 60); await sleep(600);
  ok(!(await sheet()), '點遮罩收起');
  await pp.click('.park-marker[data-id="D2"]'); await sleep(500);
  ok(!(await sheet()), '點沒有資料的 D2：不開卡');
  // 很長的說明：sheet 最高 78%，內容在 sheet 裡捲
  await pp.click('.park-marker[data-id="D4"]'); await sleep(600);
  c = await sheet();
  ok(c && c.scrollable && c.hPct <= 79, `長說明：sheet 裡捲（${JSON.stringify(c)}）`);
  const pin = await pp.evaluate(async () => { const sc = document.querySelector('.park-sheet .park-sheet-scroll'), m = document.querySelector('.park-sheet .park-card-more'); const y0 = m.getBoundingClientRect().top; sc.scrollTop = 9999; await new Promise((r) => setTimeout(r, 100)); return { scrolled: sc.scrollTop > 0, still: Math.abs(m.getBoundingClientRect().top - y0) < 0.5 }; });
  ok(pin.scrolled && pin.still, `長說明捲到底：「查看更多」不跟著捲（${JSON.stringify(pin)}）`);
  await pp.screenshot({ path: path.join(OUT, '07-play-sheet-long.png') });
  // 往上滑（從抓手）收起
  // 底部拖曳的那一條：有「查看更多」＝固定在底部那一條（拉它下面的留白），沒有＝空白拖曳區
  const dragStrip = () => pp.evaluate(() => { const f = document.querySelector('.park-sheet-foot:not([hidden])'); const g = f || document.querySelector('.park-sheet-grip'); const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: f ? r.bottom - 4 : r.y + r.height / 2 }; });
  const grip = await dragStrip();
  await pp.mouse.move(grip.x, grip.y); await pp.mouse.down();
  await pp.mouse.move(grip.x, grip.y - 300, { steps: 8 }); await pp.mouse.up(); await sleep(600);
  ok(!(await sheet()), '從抓手往上滑：收起');
  // 拉一點點放開：彈回
  await pp.click('.park-marker[data-id="D3"]'); await sleep(600);
  const g2 = await dragStrip();
  await pp.mouse.move(g2.x, g2.y); await pp.mouse.down();
  await pp.mouse.move(g2.x, g2.y - 30, { steps: 4 }); await pp.mouse.up(); await sleep(500);
  ok(!!(await sheet()), '拉一點點放開：彈回');
  await pp.click('#ovBack'); await sleep(600);
  ok(!(await sheet()) && await pp.evaluate(() => !document.getElementById('overlay').hidden), '左上角 ✕ 收起（還在園區資訊）');
  cfg.pages[0].blocks[0].node = { ...cfg.pages[0].blocks[0].node, parkInfoLayout: 'Mobile' };
  await pp.reload({ waitUntil: 'domcontentloaded' });
  await pp.waitForSelector('.page.in .cell', { timeout: 15000 }); await sleep(800);
  await pp.click('.page.in .cell'); await sleep(2500);
  await pp.click('.park-marker[data-id="D3"]'); await sleep(600);
  const mobileSize = await sizeOf();
  ok(mobileSize && Math.abs(mobileSize.ps - 0.45) < 0.01 && mobileSize.pt === mobileSize.ps && mobileSize.font < kioskSize.font * 0.5, `手機操作模式：資訊卡一般大小，比 KIOSK 小（${JSON.stringify({ kiosk: kioskSize, mobile: mobileSize })}）`);
  cfg.pages[0].blocks[0].node = { ...cfg.pages[0].blocks[0].node, parkInfoLayout: undefined };
  // 場域清掉了測站資料來源：「園區資訊」格子不能點、不顯示按鈕；格子裡留著的舊網址不拿來用
  parkInfo = { ...parkInfo, api: '' };
  cfg.pages[0].blocks[0].node = { ...cfg.pages[0].blocks[0].node, wStUrl: PARK_API, tapHint: 'Button' };
  await pp.reload({ waitUntil: 'domcontentloaded' });
  await pp.waitForSelector('.page.in .cell', { timeout: 15000 }); await sleep(800);
  const off = await pp.evaluate(() => { const c = document.querySelector('.page.in .cell'); return { tappable: c.classList.contains('tappable'), btn: !!c.querySelector('.pv-park-btn') }; });
  ok(!off.tappable && !off.btn, `沒有資料來源：園區資訊格子不能點、沒有按鈕（${JSON.stringify(off)}）`);
  await pp.click('.page.in .cell'); await sleep(800);
  ok(await pp.evaluate(() => document.getElementById('overlay').hidden), '點了也不會打開園區資訊');

  // 還原本機開發 DB 的 parkInfo
  const cur = (await authed('GET', '/api/shared-settings')).settings;
  if (original === undefined) cur.parkInfo = { stations: {} }; else cur.parkInfo = original;
  await authed('PUT', '/api/shared-settings', { settings: cur });
  await browser.close();
  console.log(errs.length ? errs : '沒有頁面錯誤');
  console.log(`\n${pass} 通過，${fail} 失敗`);
  process.exit(fail || errs.length ? 1 : 0);
})();
