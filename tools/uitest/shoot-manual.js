/* 操作手冊用截圖（2026-09-23 改版）：不連資料庫、不動任何站台的資料。
   做法＝用 Chrome 開本機後台的網頁，把所有 /api/… 請求攔下來改餵 manual-demo.js 的示範資料，
   /files/ 圖片則餵 manual-assets/ 的示範海報。畫面是真的後台程式畫的，資料是假的。
   （舊版是直接登入某個站台拍真實資料，改掉的原因：手冊不該出現客戶內容，示範資料也比較整齊。）
   用法：node shoot-manual.js（本機後台要在跑，預設 http://localhost:3177，只拿它的網頁與靜態檔）
   輸出：public/img/manual/*.png（2x）。modal 本身的檢查截圖見 shot-guide.js。 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const demo = require('./manual-demo');

const BASE = process.env.BASE || 'http://localhost:3177';
const OUT = path.join(__dirname, '..', '..', 'public', 'img', 'manual');
const ASSETS = path.join(__dirname, 'manual-assets');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 假 API ----------
const json = (body) => ({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
const deviceOf = (id) => demo.devices.find((d) => d.DeviceId === decodeURIComponent(id));
const listRow = ({ config, ...row }) => row; // 清單不帶整份 config

/** 測站即時資料（園區資訊頁用）：形狀同客戶感測器 API。 */
const stations = () => ({
  stations: [
    ['D1', '遊園入口', 27.4, 68, 12, 0], ['D2', '廣場中庭', 28.1, 65, 14, 0],
    ['D3', '不差的花園', 26.8, 72, 9, 1.5], ['D4', '藍染長廊', 26.2, 74, 8, 1.5], ['D5', '卓也書園子', 25.9, 70, 10, 0],
  ].map(([id, name, t, h, pm, rain]) => ({
    station_id: id, name, online: true,
    values: { temperature: t, humidity: h, pm25: pm, daily_rainfall: rain, heat_index: t + 2.5 },
    received_at_local: new Date().toISOString(),
  })),
});

function fakeApi(urlPath, method) {
  const p = urlPath.replace(/\?.*$/, '');
  if (p === '/api/login' && method === 'POST') return json({ token: 'demo-token', user: demo.me });
  if (p === '/api/me') return json(demo.me);
  if (p === '/api/connection-info') return json(demo.connectionInfo);
  if (p === '/api/devices') return json(demo.devices.map(listRow));
  if (p === '/api/users') {
    return json(demo.users.map((u, i) => ({
      UserId: u.UserId, Username: u.Username, DisplayName: u.DisplayName, IsAdmin: u.IsAdmin,
      CreatedAt: new Date(Date.now() - (i + 1) * 30 * 864e5).toISOString(),
      IsPrimary: u.Username === 'joyeadmin', IsMe: u.Username === demo.me.username, Devices: u.Devices,
    })));
  }
  if (p === '/api/shared-settings') return json({ settings: demo.shared, updatedAt: new Date().toISOString() });
  if (p === '/api/justai/agents') {
    return json([
      { id: demo.AGENT.id, name: demo.AGENT.name, description: '園區導覽與常見問題' },
      { id: 'demo-agent-0002', name: '訂房客服', description: '住宿與訂位' },
    ]);
  }
  if (p === '/api/station/current') return json(stations());
  const m = p.match(/^\/api\/config\/([^/]+)(\/version|\/wait)?$/);
  if (m) {
    const d = deviceOf(m[1]) || demo.devices[0];
    if (m[2] === '/version') return json({ version: d.Version });
    if (m[2] === '/wait') return null;                       // 長輪詢：掛著不回應，畫面才不會一直重載
    if (method === 'PUT') return json({ version: d.Version + 1 });
    return json({ version: d.Version, updatedAt: d.UpdatedAt, config: d.config, themeColor: demo.shared.themeColor });
  }
  if (/^\/api\/devices\/[^/]+\/events$/.test(p)) return json({ ok: true });
  return json({});                                           // 其餘給空物件，畫面不會卡在錯誤上
}

/** 攔截器：站內 /api/ 餵假資料、/files/demo-*.png 餵示範海報，其餘照走。 */
function hookRoutes(pg) {
  pg.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(BASE)) return req.continue();          // 外站（JustAI 登入頁）照走
    const rest = url.slice(BASE.length);
    if (rest.startsWith('/api/')) {
      const res = fakeApi(rest, req.method());
      return res ? req.respond(res) : undefined;               // null＝故意不回應
    }
    const img = rest.match(/\/files\/(demo-[\w-]+\.png)/);
    if (img && fs.existsSync(path.join(ASSETS, img[1]))) {
      return req.respond({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(ASSETS, img[1])) });
    }
    return req.continue();
  });
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await page.setRequestInterception(true);
  hookRoutes(page);

  const shotOn = async (pg, name, el) => {
    const t = el ? await pg.$(el) : pg;
    if (!t) { console.log('MISSING', name, el); return; }
    await t.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('shot', name);
  };
  const shot = (name, el) => shotOn(page, name, el);

  /** 關掉開著的 modal／確認框（只看真的顯示中的那些；頁面裡有不少藏起來的 modal 殼）。 */
  const closeOverlays = async () => {
    for (let i = 0; i < 6; i++) {
      const done = await page.evaluate(() => {
        const shown = (el) => el.offsetParent !== null && getComputedStyle(el).opacity !== '0';
        const roots = [...document.querySelectorAll('.b-modal-overlay')].filter(shown);
        if (!roots.length) return 'closed';
        // 「要放棄嗎？」確認框（BDialog .is-alert）要先處理，而且要按確認鈕，不是取消
        const alert = roots.find((r) => r.querySelector('.b-modal.is-alert'));
        if (alert) {
          const btns = [...alert.querySelectorAll('.b-alert-foot button')].filter((b) => b.offsetParent !== null);
          if (btns.length) { btns[btns.length - 1].click(); return 'clicked'; }
        }
        const labels = ['取消', '關閉'];
        for (const r of roots) {
          for (const b of r.querySelectorAll('button, a')) {
            if (labels.includes((b.textContent || '').trim()) && b.offsetParent !== null) { b.click(); return 'clicked'; }
          }
        }
        return 'stuck';
      });
      if (done === 'closed') return;
      if (done === 'stuck') await page.keyboard.press('Escape');
      await sleep(500);
    }
    console.log('WARN 仍有視窗沒關掉');
  };

  // ---------- 後台 ----------
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle2', timeout: 20000 });
  await page.type('#username', 'joyeadmin');
  await page.type('#password', 'demo#2026');
  await page.click('.btn-login');
  await page.waitForSelector('#deviceTable tbody tr', { visible: true, timeout: 10000 });
  await page.evaluate(() => window.setColorMode('light', false));
  // 手冊一律用預設的公司橘（各站台自己的主題色由後台調，截圖不跟著某一站走）
  await page.evaluate((hex) => {
    const el = document.getElementById('siteTheme');
    if (el && window.KioskThemeColor) el.textContent = window.KioskThemeColor.css(hex);
  }, demo.shared.themeColor);
  await sleep(1400);
  await page.evaluate(() => document.querySelectorAll('.b-toast, .toast, #toast').forEach((t) => t.remove())); // 登入 toast 不入鏡

  await shot('conn-info', '#connCard');
  await shot('devices');

  // 工作區：版面 → 格子面板 → 機器設定
  await page.evaluate(() => document.querySelector('#deviceTable .device-ops button').click()); // 內容管理
  await page.waitForSelector('#canvas .cell', { visible: true, timeout: 10000 });
  await sleep(1200);
  await shot('workspace');
  // 點畫布上最大的一格（拖曳分隔線會蓋住格子邊緣，直接 element.click() 會被擋，改用座標）
  const spot = await page.evaluate(() => {
    let best = null, area = 0;
    document.querySelectorAll('#canvas .cell').forEach((c) => {
      const r = c.getBoundingClientRect();
      if (r.width * r.height > area) { area = r.width * r.height; best = r; }
    });
    return best ? { x: best.x + best.width / 2, y: best.y + best.height / 2 } : null;
  });
  if (spot) {
    await page.mouse.click(spot.x, spot.y);
    await sleep(700);
    // 面板比視窗高，會被切掉：暫時把視窗拉高再拍，並只取到內容結束的地方（不留一大片空白）
    await page.setViewport({ width: 1440, height: 1700, deviceScaleFactor: 2 });
    await sleep(900);
    const clip = await page.evaluate(() => {
      const el = document.getElementById('cellPanel');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const last = el.lastElementChild ? el.lastElementChild.getBoundingClientRect().bottom : r.bottom;
      return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, last - r.y + 20) };
    });
    if (clip) await page.screenshot({ path: path.join(OUT, 'cell-panel.png'), clip });
    console.log('shot cell-panel');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await sleep(600);
  }
  await page.evaluate(() => document.querySelector('.ws-tabs .seg[data-wstab="settings"]')?.click());
  await sleep(1000);
  await shot('settings-tab');
  await shot('chat-api-card', '#settingsBody .settings-card');
  await page.click('#wsCloseBtn');
  await sleep(800);
  await closeOverlays();

  // 共用設定兩頁＋帳號管理
  await page.click('#sharedGroupToggle');
  await sleep(500);
  await page.click('[data-view="sharedLayout"]');
  await sleep(1000);
  await shot('shared-layout');
  await page.click('[data-view="sharedSettings"]');
  await sleep(1000);
  await shot('shared-settings');
  await page.click('[data-view="users"]');
  await sleep(900);
  await shot('users');

  // 批量調整展示畫面（精靈式 modal）：放最後拍，關不乾淨也不影響前面的畫面
  await page.click('[data-view="devices"]');
  await sleep(900);
  await page.click('#showLayoutBtn');
  await sleep(1000);
  const picks = await page.$$('.b-modal-overlay.is-visible input[type="checkbox"]');
  for (const c of picks.slice(1, 3)) { await c.click(); await sleep(150); }
  await sleep(500);
  await shot('show-layout', '.b-modal-overlay.is-visible .b-modal');
  await closeOverlays();

  // ---------- 網頁螢幕（播放頁）----------
  const play = await browser.newPage();
  await play.setViewport({ width: 900, height: 950, deviceScaleFactor: 2 });
  await play.setRequestInterception(true);
  hookRoutes(play);
  await play.goto(BASE + '/play/?reset=1', { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1500);
  await shotOn(play, 'play-setup');

  await play.setViewport({ width: 900, height: 1300, deviceScaleFactor: 2 }); // 園區資訊頁用直式螢幕的比例
  await play.goto(`${BASE}/play/?device=${encodeURIComponent('大廳展示機')}&key=demo&id=farbar-lobby`, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(3000);
  const parkCell = await play.$('[data-tap="OpenParkInfo"], .cell.is-park, .park-cell');
  if (parkCell) await parkCell.click(); else await play.mouse.click(700, 760);
  await sleep(3000);
  await shotOn(play, 'park-info');

  // ---------- JustAI 官網登入頁（公開頁，1x）----------
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  try {
    await page.goto('https://chat.justhings.ai/login', { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, 'justai-login.png'), clip: { x: 430, y: 140, width: 580, height: 620 } });
    console.log('shot justai-login');
  } catch (e) { console.log('JustAI 截圖略過：', e.message); }

  console.log('console errors:', errs.length ? errs.slice(0, 6) : '(none)');
  await browser.close();

  // 太大的圖（照片類的園區地圖動輒 3MB）縮到手冊看得清楚就好，手冊頁才不會拖很久
  const sharp = require('../../node_modules/sharp');
  for (const f of fs.readdirSync(OUT).filter((n) => n.endsWith('.png'))) {
    const p = path.join(OUT, f);
    if (fs.statSync(p).size <= 800 * 1024) continue;
    const buf = await sharp(p).resize({ width: 1400, withoutEnlargement: true }).png({ compressionLevel: 9, palette: true, quality: 85 }).toBuffer();
    fs.writeFileSync(p, buf);
    console.log('壓縮', f, '→', (buf.length / 1024).toFixed(0) + ' KB');
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
