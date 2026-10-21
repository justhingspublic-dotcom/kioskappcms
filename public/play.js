/* ==========================================================================
   純顯示播放頁（2026-09-10，第二個場域 sunrise 起；Windows 機器用瀏覽器 kiosk 模式開）
   - 網址：/{site}/play/?device=機器名&key=金鑰[&id=自訂機器編號][&fresh=1]
     金鑰第一次帶過後記在 localStorage，之後網址可只帶 device。
   - 同步：與 Android App 的 CloudSyncManager 同一套流程——GET version → 0 就上傳初始設定、
     不同就整份拉回；之後掛在 /wait 長輪詢，後台一發布立刻更新；帶 X-Device-Key／X-Device-Server／
     X-App-Version 標頭讓機器總覽看得到在線狀態與版本。後台指定展示頁（activePageSource=web）就切頁並回報。
   - 畫法：與後台預覽（app.js buildCanvas／fitPreview）同一套規則，尺寸用真實像素（1px＝機器 1px）。
   - 沒有設定頁、沒有 PIN、不做離線快取（斷線＝右上角小標，畫面保持最後狀態，15 秒重試）。
   ========================================================================== */
(() => {
  'use strict';

  const APP_VERSION = 'web 1.0';
  const BASE = location.pathname.replace(/\/play\/?$/, '');          // '/sunrise' 或 ''
  const SERVER_URL = location.origin + BASE;                          // 自報給後台的伺服器位址（與機器填的一致）
  const DEFAULT_IDLE_RETURN_MS = 90_000;                              // 下一頁沒人碰多久回展示：後台「閒置回展示頁」沒設時的預設（同 App）
  const RETRY_MS = 15_000;
  const STATION_ROTATE_MS = 10_000;
  const DEFAULT_PARK_API = (document.body.dataset.parkApi || '').trim(); // 站台的園區測站 API（.env PARK_API_URL；沒設＝園區資訊頁只當導覽圖）
  // 舊版後台（parkInfo 沒有 api 欄位）才用的內建卓也地圖；新版一律照後台「共用設定 › 園區測站」的地圖與測站位置（2026-10-20）
  const PARK_PRESET = { // App ParkPresets.Joye：內建園區地圖與測站位置（百分比）
    name: '卓也小屋', map: '../admin/img/joye-map.jpg', aspect: 1600 / 2253,
    nodes: [
      { id: 'D1', name: '遊園入口', x: 9.5, y: 50.7 }, { id: 'D2', name: '廣場中庭', x: 34.0, y: 54.2 },
      { id: 'D3', name: '不差的花園', x: 47.0, y: 39.2 }, { id: 'D4', name: '藍染長廊', x: 90.0, y: 82.7 },
      { id: 'D5', name: '卓也書園子', x: 9.5, y: 35.5 },
    ],
  };

  // ---------- 小工具 ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const colorCss = (n) => '#' + (Number(n ?? 4280693304) >>> 0).toString(16).padStart(8, '0').slice(2);
  const isRemote = (uri) => /^https?:\/\//.test(uri) || String(uri).startsWith('/files/');
  const mediaSrc = (uri) => (typeof uri === 'string' && uri.startsWith('/files/') ? BASE + uri : uri);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function autoTextColor(bg) {
    const n = Number(bg ?? 4280693304) >>> 0;
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111111' : '#ffffff';
  }
  function slug(s) {
    return String(s).normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 48) || 'player';
  }

  // ---------- 機器身分 ----------
  const params = new URLSearchParams(location.search);
  // 所有機器開同一個網址（user 2026-09-10 定案）。機器名的優先序：
  //   網址 ?device= ＞ 這台瀏覽器記住的 ＞ 站台預設（.env PLAY_DEFAULT_DEVICE，＝所有螢幕同一台機器、同一畫面）＞ 螢幕上的填名畫面。
  // 金鑰：網址 ?key= ＞ 記住的 ＞ 填名畫面。?reset=1 清掉記住的重填；左上角連點 5 下可改名（記住的名字優先於站台預設，
  // 所以有預設機器名的站台也能讓某面螢幕有自己的名字）。
  const LS_DEV = 'play.device:' + BASE, LS_KEY = 'play.deviceKey:' + BASE, SS_FRESH = 'play.fresh:' + BASE;
  const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* 無痕模式等 */ } };
  if (params.get('reset') === '1') { lsSet(LS_DEV, ''); lsSet(LS_KEY, ''); }
  const storedName = lsGet(LS_DEV);
  let deviceName = ((params.get('device') || '').trim() || storedName || (document.body.dataset.defaultDevice || '').trim()).slice(0, 64);
  if (params.get('device')) lsSet(LS_DEV, deviceName);
  let deviceKey = (params.get('key') || '').trim() || lsGet(LS_KEY);
  if (params.get('key')) lsSet(LS_KEY, deviceKey);
  let fresh = params.get('fresh') === '1' || sessionStorage.getItem(SS_FRESH) === '1';
  const deviceId = (params.get('id') || '').trim().slice(0, 64) || (deviceName ? 'web-' + slug(deviceName) : '');
  const encId = encodeURIComponent(deviceId);
  const LS_VER = `play.lastVersion:${BASE}:${deviceId}`;

  // ---------- 狀態 ----------
  let lastVersion = 0;
  try { lastVersion = Number(localStorage.getItem(LS_VER)) || 0; } catch { /* ignore */ }
  let config = null;        // 最近一次套用的整份設定
  // 閒置回展示頁秒數（2026-09-14）：後台機器設定 idleReturnSec（10～3600），沒設／0＝預設 90 秒；-1＝開關關閉→回 0＝不計時（同 App IdleReturn）
  const idleReturnMs = () => { const s = Number(config && config.idleReturnSec); if (s === -1) return 0; return s >= 10 && s <= 3600 ? s * 1000 : DEFAULT_IDLE_RETURN_MS; };
  let pages = [];
  let activeIndex = 0;
  let sleepSchedule = null;
  let removed = false;
  let screenReported = false;
  const eventQueue = [];

  function setLastVersion(v) { lastVersion = v; try { localStorage.setItem(LS_VER, String(v)); } catch { /* ignore */ } }

  // ---------- HTTP ----------
  async function api(method, path, body, timeoutMs = 20_000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = {
        'X-Device-Key': deviceKey, 'X-Device-Server': SERVER_URL, 'X-App-Version': APP_VERSION, 'Cache-Control': 'no-cache',
      };
      if (fresh && lastVersion === 0) headers['X-Device-Fresh'] = '1'; // 帶 fresh 重新登錄：被後台移除過的編號才放行
      if (body) headers['Content-Type'] = 'application/json';
      const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal, cache: 'no-store' });
      if (r.status === 410) throw Object.assign(new Error('removed'), { removed: true });
      if (r.status === 401) throw Object.assign(new Error('unauthorized'), { unauthorized: true });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      return text ? JSON.parse(text) : null;
    } finally { clearTimeout(t); }
  }

  // ---------- 機器事件（後台「機器事件」用；失敗就留著下一輪再送） ----------
  function logEvent(kind, message, level = 'info', detail = null) {
    eventQueue.push({ at: Date.now(), level, kind, message, detail, appVersion: APP_VERSION });
    if (eventQueue.length > 200) eventQueue.splice(0, eventQueue.length - 200);
  }
  async function flushEvents() {
    if (!eventQueue.length || !deviceId) return;
    const batch = eventQueue.slice(0, 50);
    try {
      await api('POST', `/api/devices/${encId}/events`, { events: batch });
      eventQueue.splice(0, batch.length);
    } catch (e) { if (e.removed) onRemoved(); }
  }

  // ---------- 畫面：狀態層 ----------
  function showBoot(title, sub) { $('bootTitle').textContent = title; $('bootSub').textContent = sub || ''; $('boot').hidden = false; }
  function hideBoot() { $('boot').hidden = true; }
  function showNotice(title, html, actions) {
    $('noticeTitle').textContent = title; $('noticeBody').innerHTML = html;
    const box = $('noticeActions'); box.innerHTML = '';
    (actions || []).forEach((a) => { const b = el('button', 'btn ' + (a.primary ? 'primary' : 'secondary'), a.label); b.type = 'button'; b.addEventListener('click', a.onClick); box.append(b); });
    $('notice').hidden = false; hideBoot();
  }
  /** 清掉這台記住的版本、下次請求帶 X-Device-Fresh 重新登錄，然後重新載入。 */
  function reRegister() {
    try { sessionStorage.setItem(SS_FRESH, '1'); localStorage.removeItem(LS_VER); } catch { /* ignore */ }
    location.replace(BASE + '/play/');
  }
  // ---------- 填名畫面 ----------
  function openSetup(allowCancel) {
    $('setupName').value = storedName || (params.get('device') || '').trim() || '';
    $('setupKey').value = deviceKey || '';
    $('setupKeyRow').hidden = !!deviceKey && !allowCancel; // 網址已帶金鑰：第一次只問名字
    $('setupTitle').textContent = deviceName ? '更改這面螢幕的名字' : '這面螢幕叫什麼名字？';
    $('setupCancel').hidden = !allowCancel;
    $('notice').hidden = true; $('setup').hidden = false; hideBoot();
    setTimeout(() => $('setupName').focus(), 50);
  }
  $('setupCancel').addEventListener('click', () => { $('setup').hidden = true; if (removed) $('notice').hidden = false; });
  $('setupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('setupName').value.trim().slice(0, 64);
    const key = $('setupKeyRow').hidden ? deviceKey : $('setupKey').value.trim();
    if (!name) { $('setupName').focus(); return; }
    if (!key) { $('setupKeyRow').hidden = false; $('setupKey').focus(); return; }
    lsSet(LS_DEV, name); lsSet(LS_KEY, key);
    location.replace(BASE + '/play/'); // 網址收乾淨（參數不留），用記住的值重新啟動
  });
  // 左上角連點 5 下（1.5 秒內）→ 改名（App 的隱藏角落同款）
  (function hiddenCorner() {
    let taps = 0, last = 0;
    document.addEventListener('pointerdown', (e) => {
      // 子頁／內頁開著時不算（左上角是返回鈕，連按返回不該跳出改名；同 App 只在主頁有隱藏角落）
      if (e.clientX > 160 || e.clientY > 160 || !$('setup').hidden || subStack.length || overlayKind) return;
      const now = Date.now();
      taps = now - last <= 1500 ? taps + 1 : 1; last = now;
      if (taps >= 5) { taps = 0; openSetup(true); }
    }, { passive: true });
  })();
  let offlineSince = 0;
  function setOffline(on, text) {
    if (on) { if (!offlineSince) offlineSince = Date.now(); $('offlineText').textContent = text || '連線中斷，重試中…'; $('offline').hidden = false; }
    else { offlineSince = 0; $('offline').hidden = true; }
  }
  let toastTimer = 0;
  function toast(msg, ms = 2200) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
  function onRemoved() {
    if (removed) return;
    removed = true;
    clearRendered();
    showNotice('這台機器已從後台移除', `後台已刪除「${esc(deviceName || deviceId)}」，畫面已停止更新。`, [
      { label: '更改機器名', onClick: () => openSetup(true) },
      { label: '用同一個名字重新登錄', primary: true, onClick: reRegister },
    ]);
  }

  // ---------- 同步主迴圈（同 App CloudSyncManager：對帳→掛 /wait→對帳…） ----------
  async function syncLoop() {
    for (;;) {
      if (removed) return;
      try {
        await tick();
        setOffline(false);
        await flushEvents();
        await api('GET', `/api/config/${encId}/wait?version=${lastVersion}`, null, 40_000);
      } catch (e) {
        if (e.removed) { onRemoved(); return; }
        if (e.unauthorized) {
          showNotice('連線金鑰不正確', '後台沒有接受這把金鑰。請到後台側欄「機器連線資訊」複製金鑰後重新輸入。', [
            { label: '重新輸入', primary: true, onClick: () => { lsSet(LS_KEY, ''); deviceKey = ''; openSetup(true); $('setupKeyRow').hidden = false; $('setupKey').value = ''; } },
          ]);
          return;
        }
        if (!offlineSince) logEvent('sync.fail', `同步失敗：${e.message || e}`, 'warn');
        setOffline(true, config ? '連線中斷，重試中…' : '連不上後台，重試中…');
        if (!config) showBoot('連不上後台', `正在重試… ${e.message || ''}\n${SERVER_URL}`);
        await sleep(RETRY_MS);
      }
    }
  }

  async function tick() {
    const { version, parkInfo: pi } = await api('GET', `/api/config/${encId}/version`);
    setParkInfo(pi); // 園區測站資訊卡（2026-10-20）：站台層級，不動設定版本，每輪對帳都看一次
    if (version === 0) { await pushInitial(); return; }
    if (version !== lastVersion || !config) await pull(version);
    else if (!screenReported) await reportScreenIfChanged();
  }

  /** 後台還沒有這台機器：上傳一份空的初始設定（一頁一格純色），和 App 第一次連線一樣。 */
  async function pushInitial() {
    const body = { config: {
      activePage: 0, deviceName, screen: screenSize(),
      pages: [{ id: 1, name: '', blocks: [{ id: 1, w: 1, node: { t: 'cell', bg: 'Solid', bgColor: 4280693304, content: 'None' } }] }],
    } };
    const { version } = await api('PUT', `/api/config/${encId}`, body);
    setLastVersion(version);
    screenReported = true;
    fresh = false; try { sessionStorage.removeItem(SS_FRESH); } catch { /* ignore */ }
    logEvent('sync.push', `已上傳初始設定（第 ${version} 版，網頁播放器）`);
    await pull(version);
  }

  let siteTheme = null; // 站台主題色（/api/config 回應的 themeColor，2026-09-14）：客服「自動」色用
  // 園區測站資訊卡（2026-10-20 user）：後台「共用設定 › 園區測站」填的每站照片／說明／看更多連結／地圖位置，
  // { stations: { 代號: { photos, desc, link, x?, y? } } }；跟 themeColor 一樣隨 /version、/config 回來（App ParkInfoScreen 同規則）
  let parkInfo = { stations: {} };
  function setParkInfo(pi) {
    if (!pi || typeof pi !== 'object') return;
    const changed = JSON.stringify(pi) !== JSON.stringify(parkInfo);
    const was = parkLiveKey();
    parkInfo = pi;
    if (changed && overlayKind === 'park') refreshPark(); // 資訊卡內容跟著更新（地圖上新放的點等下次打開）
    // 場域的測站資料來源設了／清了：天氣格與「園區資訊」格子要換樣子；訪客正在看別的畫面就等下次換頁再畫
    if (was !== parkLiveKey() && config && !overlayKind && !subStack.length && !window.KioskAssist?.isOpen()) renderActive(activeIndex);
  }
  const parkLiveKey = () => (!parkInfo || !('api' in parkInfo) ? 'legacy' : parkInfo.api ? 'on' : 'off');
  /** 場域清掉了測站資料來源（2026-10-20 user）：「園區資訊」格子不能點、不顯示提示；天氣格「園區測站」改顯示一般天氣（後台 liveHintOf、App 同規則） */
  const parkOff = () => parkLiveKey() === 'off';
  const tapOff = (cell) => cell.tap === 'OpenParkInfo' && parkOff();
  const parkSt = (id) => (parkInfo && parkInfo.stations && parkInfo.stations[id]) || null;
  const parkHasInfo = (id) => { const e = parkSt(id); return !!e && ((e.photos || []).length > 0 || !!String(e.desc || '').trim()); };
  /** 後台有新版園區測站設定（parkInfo 帶 api 欄位）＝地圖、測站位置、資料來源都照它；舊版後台才退回內建卓也地圖 */
  const parkSiteDriven = () => !!parkInfo && 'api' in parkInfo;
  /** 園區地圖：{ src, aspect }；後台還沒上傳地圖＝null */
  function parkMapOf() {
    if (!parkSiteDriven()) return { src: PARK_PRESET.map, aspect: PARK_PRESET.aspect };
    const m = parkInfo.map;
    return m && m.src && m.w > 0 && m.h > 0 ? { src: mediaSrc(m.src), aspect: m.w / m.h } : null;
  }
  /** 地圖上的點：後台放上地圖的測站（名稱＝後台存下來的，讀數回來再補）；舊版後台＝內建 D1–D5 */
  function parkNodes() {
    if (!parkSiteDriven()) return PARK_PRESET.nodes;
    const ok = (e) => e && e.x != null && e.y != null && Number.isFinite(Number(e.x)) && Number.isFinite(Number(e.y));
    return Object.entries(parkInfo.stations || {}).filter(([, e]) => ok(e))
      .map(([id, e]) => ({ id, name: e.name || '', x: Number(e.x), y: Number(e.y) }))
      .sort((a, b) => a.id.localeCompare(b.id, 'zh-Hant', { numeric: true }));
  }
  /** 格子實際用的測站 API：新版後台一律照場域設定（清空＝沒有測站，不再拿格子裡抄給舊版 App 的網址備援）；舊版後台才用格子自己的 */
  const parkApiOf = (cell) => (parkSiteDriven() ? parkInfo.api || '' : ((cell && cell.wStUrl) || '').trim() || DEFAULT_PARK_API);
  async function pull(version) {
    const root = await api('GET', `/api/config/${encId}`);
    if (typeof root.themeColor === 'string') siteTheme = root.themeColor;
    setParkInfo(root.parkInfo);
    const cfg = root.config || {};
    const nextPages = Array.isArray(cfg.pages) && cfg.pages.length ? cfg.pages : [];
    const cloudActive = clamp(Number(cfg.activePage) || 0, 0, Math.max(0, nextPages.length - 1));
    const webRequested = cfg.activePageSource === 'web';
    // 展示頁以本機為準（同 App）：只有第一次套用、或後台指定展示頁（activePageSource=web）才照雲端；
    // 其他情況用頁面 id 對回目前這一頁（後台刪頁／排序不會對錯頁）
    const currentId = pages[activeIndex]?.id;
    const byId = currentId != null ? nextPages.findIndex((p) => p.id === currentId) : -1;
    const idx = (lastVersion === 0 || !config || webRequested) ? cloudActive : (byId >= 0 ? byId : clamp(activeIndex, 0, Math.max(0, nextPages.length - 1)));
    const firstTime = !config;
    config = cfg; pages = nextPages;
    sleepSchedule = cfg.sleep || null;
    setLastVersion(version);
    renderActive(idx);
    updateSleep();
    hideBoot();
    logEvent('sync.pull', `已套用後台第 ${version} 版（${pages.length} 頁）` + (webRequested ? `，後台指定展示第 ${idx + 1} 頁` : ''));
    if (firstTime) logEvent('display.enter', '進入展示模式（網頁播放器）');
    // 本機沿用的頁與雲端不同、或後台指定了展示頁：回報一次，伺服器把來源翻回機器
    if (idx !== cloudActive || webRequested) await report({ activePage: idx });
    else await reportScreenIfChanged();
  }

  /** 部分更新（淺合併）：只送這次要改的欄位，其他由伺服器沿用。 */
  async function report(fields) {
    const body = { config: { ...fields, screen: screenSize() } };
    const { version } = await api('PUT', `/api/config/${encId}`, body);
    setLastVersion(version);
    screenReported = true;
  }
  // 一律直向（2026-09-10 user 指示：操作邏輯都是以直向定義的）：視窗是橫的就在中間放一個 9:16 的舞台，兩側留黑；
  // 上報給後台的螢幕尺寸＝舞台尺寸，後台畫布也就是直的。視窗本來就是直的則整個視窗都是舞台。
  // 解析度係數 K（2026-09-14）：後台畫布與內頁都以 1080 寬為設計基準；比 FHD 寬的螢幕（2K／4K 直式）
  // 寫死 px 的東西（內頁頂欄、徽章、園區資訊格、測站標記、客服）一律乘 K 等比放大。FHD 以下 K＝1、跟原本一樣。
  const kScale = () => Math.max(1, (stage.clientWidth || window.innerWidth) / 1080);
  function layoutStage() {
    const W = window.innerWidth, H = window.innerHeight;
    const s = stage.style, r = document.documentElement.style;
    if (W > H) {
      const w = Math.round(H * 9 / 16), left = Math.round((W - w) / 2);
      s.left = `${left}px`; s.top = '0'; s.width = `${w}px`; s.height = `${H}px`; s.right = 'auto'; s.bottom = 'auto';
      r.setProperty('--stage-left', `${left}px`); r.setProperty('--stage-w', `${w}px`); r.setProperty('--stage-h', `${H}px`);
    } else {
      s.left = '0'; s.top = '0'; s.width = '100%'; s.height = '100%'; s.right = 'auto'; s.bottom = 'auto';
      r.setProperty('--stage-left', '0px'); r.setProperty('--stage-w', '100%'); r.setProperty('--stage-h', '100%');
    }
    const stageWidth = stage.clientWidth || window.innerWidth;
    r.setProperty('--k', kScale().toFixed(4));
    // Same width scale and extra 1.6 top-bar scale as the web Assistant Kiosk presentation.
    const kioskWidthScale = Math.min(1080 / 820, Math.max(1, stageWidth / 820));
    r.setProperty('--park-tb', (kioskWidthScale * 1.6).toFixed(4));
  }
  function screenSize() { return { w: stage.clientWidth || window.innerWidth, h: stage.clientHeight || window.innerHeight }; }
  async function reportScreenIfChanged() {
    if (screenReported) return;
    const s = config?.screen;
    const now = screenSize();
    if (!s || s.w !== now.w || s.h !== now.h) await report({});
    screenReported = true;
  }

  // ---------- 渲染 ----------
  const stage = $('stage');
  layoutStage();
  let cellTimers = [];   // setInterval id 或 { stop() }
  function addTimer(t) { cellTimers.push(t); return t; }
  function clearRendered() {
    cellTimers.forEach((t) => (typeof t === 'number' ? clearInterval(t) : t.stop && t.stop()));
    cellTimers = [];
  }

  function renderActive(idx) {
    const prev = activeIndex;
    activeIndex = clamp(idx, 0, Math.max(0, pages.length - 1));
    const page = pages[activeIndex] || { blocks: [] };
    if (config && prev !== activeIndex && stage.querySelector('.page')) {
      const name = page.name ? `「${page.name}」` : '';
      logEvent('page.switch', `切到第 ${activeIndex + 1} 頁${name}`);
    }
    renderPage(page);
    updateBlankHint();
  }

  function renderPage(page) {
    clearRendered();
    closeOverlay(true);
    if (window.KioskAssist?.isOpen()) window.KioskAssist.close();
    closeSub(true);
    const next = el('div', 'page');
    const blocks = page.blocks || [];
    const SW = stage.clientWidth, SH = stage.clientHeight;
    const totalW = blocks.reduce((s, b) => s + (b.w || 1), 0) || 1;
    if (!blocks.length) next.append(placeholder('尚未新增任何區塊'));
    blocks.forEach((block) => {
      const blockPx = { w: SW, h: Math.round((SH * (block.w || 1)) / totalW) };
      const b = el('div', 'block');
      b.style.flex = String((block.w || 1) / totalW);
      b.append(nodeEl(block.node || { t: 'cell' }, 1, blockPx));
      next.append(b);
    });
    const old = stage.querySelector('.page');
    stage.append(next);
    fitAll(next);
    requestAnimationFrame(() => {
      next.classList.add('in');
      if (old) { old.classList.add('out'); setTimeout(() => old.remove(), 400); }
    });
    // 字型載完再量一次（跑馬燈字寬、文字縮放都靠量測）
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (next.isConnected) fitAll(next); });
  }

  // 格子可以一直切下去（2026-10-12 排版更自由）：分割一層一層往下畫，跟 App LayoutRenderer 一樣
  // （'Vertical'＝左右並排、'Horizontal'＝上下疊；a 在左／上，ratio＝a 佔的比例，夾在 0.1–0.9）。主頁與子頁共用
  function splitChildPx(px, node, second) {
    const ratio = clamp(Number(node.ratio) || 0.5, 0.1, 0.9);
    const frac = second ? 1 - ratio : ratio;
    return node.dir === 'Horizontal' ? { w: px.w, h: Math.round(px.h * frac) } : { w: Math.round(px.w * frac), h: px.h };
  }
  function nodeEl(node, flex, px) {
    if (!node || node.t !== 'split') return cellEl(node || {}, flex, px);
    const ratio = clamp(Number(node.ratio) || 0.5, 0.1, 0.9);
    const s = el('div', 'split');
    s.style.flex = String(flex);
    s.style.flexDirection = node.dir === 'Vertical' ? 'row' : 'column';
    s.append(nodeEl(node.a, ratio, splitChildPx(px, node, false)), nodeEl(node.b, 1 - ratio, splitChildPx(px, node, true)));
    return s;
  }

  function placeholder(text, error) {
    const p = el('div', 'pv-placeholder' + (error ? ' error' : ''));
    const i = el('span', 'material-icons', 'info');
    p.append(i, el('div', '', text));
    return p;
  }

  function cellEl(cell, flex, sizePx) {
    const c = el('div', 'cell');
    c.style.flex = String(flex);
    c.style.background = colorCss(cell.bgColor);

    // ---- 背景圖（同 app.js cellDiv／App ImageContent）----
    if (cell.bg === 'Image') {
      const imgs = (cell.bgImgs || []).filter(isRemote);
      if (imgs.length) buildImageLayers(c, cell, imgs);
      else c.append(placeholder('尚未選擇背景圖'));
    }

    // ---- 內容 ----
    const autoFg = cell.bg === 'Image' ? '#ffffff' : autoTextColor(cell.bgColor);
    const fg = cell.txtColor != null ? colorCss(cell.txtColor) : autoFg;
    const glowCss = () => {
      if (!cell.glow) return '';
      const g = cell.glowColor != null ? colorCss(cell.glowColor) : fg;
      return `0 0 0.12em ${g}, 0 0 0.35em ${g}, 0 0 0.8em ${g}`;
    };
    if (cell.content === 'Text' && cell.text) {
      const t = el('div', 'pv-text', cell.text);
      t.style.color = fg; t.style.textShadow = glowCss();
      t.dataset.size = cell.txtSize || 100;
      if (cell.txtPos && cell.txtPos !== 'Center') t.dataset.pos = cell.txtPos; // 九宮格位置（play.css）
      c.append(t);
    } else if (cell.content === 'Marquee' && cell.text) {
      const wrap = el('div', 'pv-marquee');
      const span = el('span', '', cell.text);
      span.style.color = fg; span.style.textShadow = glowCss();
      span.dataset.speed = cell.mqSpeed || 100;
      wrap.append(span); c.append(wrap);
    } else if (cell.content === 'Weather') {
      buildWeather(c, cell, fg);
    } else if (cell.content === 'Video') {
      if (!cell.video) c.append(placeholder('尚未選擇影片'));
      else {
        const v = document.createElement('video');
        v.className = 'pv-video'; v.src = mediaSrc(cell.video);
        v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true; v.setAttribute('playsinline', '');
        v.addEventListener('error', () => { v.replaceWith(placeholder('影片無法播放', true)); });
        c.append(v);
        v.play().catch(() => { /* 自動播放被擋：仍靜音等使用者互動 */ });
      }
    } else if (cell.content === 'Web') {
      const url = normalizeUrl(cell.web);
      if (!url) c.append(placeholder('尚未設定網址'));
      else {
        const f = document.createElement('iframe');
        f.className = 'pv-web'; f.src = url; f.setAttribute('allow', 'autoplay; fullscreen; geolocation');
        f.referrerPolicy = 'no-referrer-when-downgrade';
        c.append(f);
      }
    }
    // 園區資訊標題／按鈕式提示（App ParkCellOverlay 同形）；角落徽章式提示
    if (cell.content === 'ParkInfo' || hintOf(cell) === 'Button') renderParkOverlay(c, cell, sizePx, fg);
    if (hintOf(cell) === 'Badge') renderHintBadge(c, cell, sizePx);
    if (hintOf(cell) === 'Glow') renderHintGlow(c, cell);

    // ---- 點擊動作 ----
    if (cell.tap && cell.tap !== 'None' && !tapOff(cell)) {
      c.classList.add('tappable');
      c.addEventListener('click', () => onCellTap(cell));
    }
    return c;
  }

  function normalizeUrl(raw) {
    const t = String(raw || '').trim();
    if (!t) return null;
    return /^https?:\/\//i.test(t) ? t : 'https://' + t;
  }

  /** 圖片背景：多張輪播（每張停 dur 秒、600ms 淡入淡出）、填滿裁切／完整顯示、模糊＋暗幕、邊緣融合。 */
  function buildImageLayers(c, cell, imgs) {
    const fit = cell.scale === 'Fit';
    const blur = clamp(Number(cell.bgBlur) || 0, 0, 100) / 100;
    const blurPx = blur * 24;            // App：100% = 24dp；機器上 1px ≈ 1dp
    const fullPx = 24;
    const fitFront = (front, src) => {
      const im = new Image();
      im.onload = () => {
        const l = front.parentElement;
        if (!l || !im.naturalWidth || !im.naturalHeight) return;
        const W = l.clientWidth, H = l.clientHeight;
        if (!W || !H) return;
        const sc = Math.min(W / im.naturalWidth, H / im.naturalHeight);
        const w = im.naturalWidth * sc, h = im.naturalHeight * sc;
        front.style.inset = `${((H - h) / 2).toFixed(2)}px ${((W - w) / 2).toFixed(2)}px`;
        front.style.backgroundSize = '100% 100%';
        const fade = Math.min(w, h) * 0.25;
        const ramp = Array.from({ length: 9 }, (_, i) => { const t = i / 8; return t * t * (3 - 2 * t); });
        const grad = (dir) => `linear-gradient(${dir}, ` +
          ramp.map((a, i) => `rgba(0,0,0,${a.toFixed(3)}) ${(i / 8 * fade).toFixed(1)}px`).join(', ') + ', ' +
          ramp.map((a, i) => `rgba(0,0,0,${(1 - a).toFixed(3)}) calc(100% - ${((1 - i / 8) * fade).toFixed(1)}px)`).join(', ') + ')';
        const masks = [];
        if (W - w > 1) masks.push(grad('to right'));
        if (H - h > 1) masks.push(grad('to bottom'));
        front.style.webkitMaskImage = front.style.maskImage = masks.join(', ') || 'none';
        front.style.webkitMaskComposite = 'source-in';
        front.style.maskComposite = 'intersect';
      };
      im.src = mediaSrc(src);
    };
    const setSrc = (l, src) => {
      const url = `url("${mediaSrc(src)}")`;
      if (fit) {
        l.querySelectorAll('.pv-img-back, .pv-img-front').forEach((x) => { x.style.backgroundImage = url; });
        const front = l.querySelector('.pv-img-front');
        if (front && cell.edgeFade) fitFront(front, src);
      } else l.style.backgroundImage = url;
    };
    const mkLayer = (src) => {
      const l = el('div', 'pv-img-layer' + (fit ? ' fit' : ''));
      if (fit) {
        const back = el('div', 'pv-img-back');
        back.style.filter = `blur(${fullPx}px)`; back.style.inset = `-${fullPx * 2}px`;
        const scrim = el('div', 'pv-img-back-scrim');
        const front = el('div', 'pv-img-front');
        if (blur > 0) front.style.filter = `blur(${blurPx.toFixed(2)}px)`;
        l.append(back, scrim, front);
      } else {
        l.style.backgroundSize = 'cover';
        if (blur > 0) { l.style.filter = `blur(${blurPx.toFixed(2)}px)`; l.style.inset = `-${(blurPx * 2).toFixed(1)}px`; }
      }
      setSrc(l, src);
      return l;
    };
    const a = mkLayer(imgs[0]);
    c.append(a);
    if (imgs.length > 1) {
      const b = mkLayer(imgs[1]);
      b.style.opacity = '0';
      c.append(b);
      let idx = 0, front = a;
      // 下一張先預載，切換時才不會閃
      imgs.forEach((s) => { const im = new Image(); im.src = mediaSrc(s); });
      addTimer(setInterval(() => {
        idx = (idx + 1) % imgs.length;
        const back = front === a ? b : a;
        setSrc(back, imgs[idx]);
        back.style.opacity = '1';
        front.style.opacity = '0';
        front = back;
      }, Math.max(1, Number(cell.dur) || 8) * 1000));
    }
    if (blur > 0) {
      const scrim = el('div', 'pv-img-scrim');
      scrim.style.opacity = String(0.2 * blur);
      c.append(scrim);
    }
  }

  /** 依格子真實尺寸套字級與動畫（同 app.js fitPreview）。 */
  function fitAll(root) {
    const cw = stage.clientWidth;
    if (!cw) return;
    // root 本身就是格子時也要算進去（天氣格資料抓回來後只重排自己；之前 querySelectorAll 不含自己，天氣字級一直停在預設 16px）
    const cells = root.classList && root.classList.contains('cell') ? [root] : [...root.querySelectorAll('.cell')];
    cells.forEach((c) => {
      const h = c.offsetHeight, w = c.offsetWidth;
      const text = c.querySelector('.pv-text');
      if (text) {
        // 字級＝畫面寬 7% × 字級%，放不下就等比縮到剛好放得下（App autoSize 同）
        let fs = cw * 0.07 * (Number(text.dataset.size || 100) / 100);
        const apply = () => { text.style.fontSize = `${fs}px`; text.style.padding = `${fs * 4 / 7}px`; };
        apply();
        for (let i = 0; i < 16 && fs > 4 && (text.scrollHeight > h || text.scrollWidth > w); i++) { fs *= 0.88; apply(); }
      }
      const mq = c.querySelector('.pv-marquee span');
      if (mq) {
        mq.style.fontSize = `${h * 0.55}px`;
        const spanW = mq.offsetWidth;
        const pct = Math.max(Number(mq.dataset.speed || 100) / 100, 0.1);
        const speed = 90 * pct * (cw / 1080); // App 90dp/s（1080 寬的機器）；依畫面寬等比
        if (mq._anim) mq._anim.cancel();
        mq._anim = mq.animate(
          [{ transform: `translateX(${w}px)` }, { transform: `translateX(${-spanW}px)` }],
          { duration: ((w + spanW) / speed) * 1000, iterations: Infinity, easing: 'linear' },
        );
      }
      const wx = c.querySelector('.pv-weather2');
      if (wx) {
        const temp = Math.min(h * 0.45, w * 0.14);
        const loc = Math.min(h * 0.26, w * 0.085);
        wx.style.padding = `0 ${h * 0.1}px`;
        const set = (sel, px) => wx.querySelectorAll(sel).forEach((n) => { n.style.fontSize = `${px}px`; });
        set('.pvw-loc', loc); set('.pvw-info', loc * 0.55); set('.pvw-temp', temp);
        set('.pvw-icon', temp * 0.82); set('.pvw-drop', loc * 0.6); set('.pvw-hint', h * 0.18);
        const locEl = wx.querySelector('.pvw-loc');
        if (locEl) locEl.style.marginBottom = `${h * 0.055}px`;
      }
      const park = c.querySelector('.pv-park');
      if (park && park._fit) park._fit();
      const badge = c.querySelector('.pv-hint-badge');
      if (badge && badge._fit) badge._fit();
    });
  }

  // ---------- 天氣（同 app.js／App WeatherService：Open-Meteo，30 分鐘快取；測站經後台代抓，30 秒） ----------
  const weatherCache = new Map();
  const stationCache = new Map();
  function weatherKind(code) {
    if (code == null) return 'Unknown';
    if (code === 0) return 'Sunny';
    if (code === 1 || code === 2) return 'Partly';
    if (code === 3) return 'Cloudy';
    if (code === 45 || code === 48) return 'Fog';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'Rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow';
    if (code >= 95 && code <= 99) return 'Storm';
    return 'Cloudy';
  }
  const SKY = {
    Sunny: ['#3A8DDE', '#9FD0F2'], Partly: ['#5B94C8', '#AECBE2'], Cloudy: ['#66788A', '#A3B1BD'], Unknown: ['#66788A', '#A3B1BD'],
    Fog: ['#8795A0', '#C0C9CF'], Rain: ['#37475A', '#64758A'], Storm: ['#202935', '#45556A'], Snow: ['#75899C', '#C8D8E4'],
  };
  const COND_ICON = { Sunny: 'wb_sunny', Partly: 'wb_cloudy', Cloudy: 'cloud', Unknown: 'wb_cloudy', Fog: 'dehaze', Rain: 'umbrella', Storm: 'thunderstorm', Snow: 'ac_unit' };
  const COUNTY_COORDS = {
    台北市: [25.04, 121.56], 新北市: [25.01, 121.46], 桃園市: [24.99, 121.30], 台中市: [24.15, 120.67], 台南市: [23.00, 120.21],
    高雄市: [22.62, 120.31], 基隆市: [25.13, 121.74], 新竹市: [24.80, 120.97], 嘉義市: [23.48, 120.45], 新竹縣: [24.84, 121.01],
    苗栗縣: [24.56, 120.82], 彰化縣: [24.08, 120.54], 南投縣: [23.91, 120.69], 雲林縣: [23.71, 120.43], 嘉義縣: [23.45, 120.26],
    屏東縣: [22.55, 120.55], 宜蘭縣: [24.75, 121.75], 花蓮縣: [23.99, 121.60], 台東縣: [22.76, 121.14], 澎湖縣: [23.57, 119.58],
    金門縣: [24.44, 118.32], 連江縣: [26.15, 119.93],
  };
  async function jsonGet(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  async function fetchRealWeather(auto, county, district) {
    let lat, lon, label;
    if (auto) {
      const o = await jsonGet('https://ipapi.co/json/');
      lat = o.latitude; lon = o.longitude; label = o.city || '目前位置';
    } else {
      const norm = (s) => String(s || '').replace(/臺/g, '台');
      const base = COUNTY_COORDS[norm(county)];
      if (!base) throw new Error('unknown county');
      lat = base[0]; lon = base[1]; label = `${county}${district || ''}`;
      if (district) {
        try {
          const res = (await jsonGet(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(district)}&count=10&language=zh&format=json`)).results || [];
          const hit = res.find((r) => r.country_code === 'TW' && norm(r.admin1) === norm(county));
          if (hit) { lat = hit.latitude; lon = hit.longitude; }
        } catch { /* 縣市中心即可 */ }
      }
    }
    const o = await jsonGet(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&timezone=Asia%2FTaipei&forecast_days=1',
    );
    const d = new Date();
    const wk = '日一二三四五六'[d.getDay()];
    const daily = o.daily || {};
    const rnd = (v) => (v == null || Number.isNaN(Number(v)) ? '' : Math.round(v));
    const fmt = (v, unit) => (rnd(v) === '' ? '' : `${rnd(v)}${unit}`);
    return {
      location: label, date: `${d.getMonth() + 1}月${d.getDate()}日 週${wk}`,
      temp: fmt(o.current?.temperature_2m, '°'), high: fmt(daily.temperature_2m_max?.[0], '°'), low: fmt(daily.temperature_2m_min?.[0], '°'),
      rain: fmt(daily.precipitation_probability_max?.[0], '%'), code: o.current?.weather_code ?? null,
    };
  }
  /** 取快取的天氣；沒有就在背景抓，抓到重畫所有天氣格。null＝抓取中，{error}＝失敗。 */
  function getWeather(cell) {
    const auto = cell.wAuto !== false;
    const key = auto ? 'auto' : `${cell.wCounty}|${cell.wDistrict || ''}`;
    const hit = weatherCache.get(key);
    if (hit && hit.info && Date.now() - hit.ts < 30 * 60 * 1000) return hit.info;
    const mayRetry = !hit || (!hit.loading && Date.now() - (hit.lastTry || 0) > 60 * 1000);
    if (mayRetry) {
      weatherCache.set(key, { ...(hit || {}), loading: true, lastTry: Date.now() });
      fetchRealWeather(auto, cell.wCounty, cell.wDistrict)
        .then((info) => { weatherCache.set(key, { ts: Date.now(), info, loading: false, lastTry: Date.now() }); refreshWeatherCells(); })
        .catch(() => { weatherCache.set(key, { ...(hit || {}), info: hit?.info || null, loading: false, error: true, lastTry: Date.now() }); refreshWeatherCells(); });
    }
    if (hit?.info) return hit.info;
    if (hit?.error && !hit?.loading) return { error: true };
    return null;
  }
  function parseStations(root) {
    const arr = Array.isArray(root?.stations) ? root.stations : null;
    if (!arr) throw new Error('no stations');
    return arr.map((o) => {
      const id = String(o.station_id || o.id || '');
      if (!id) return null;
      const values = {};
      for (const [k, v] of Object.entries(o.values || {})) if (Number.isFinite(Number(v))) values[k] = Number(v);
      return { id, name: o.name || id, online: 'online' in o ? !!o.online : o.status === 'online', values, receivedAt: o.received_at_local || o.received_at || '' };
    }).filter(Boolean);
  }
  function getStations(url) {
    url = String(url || '').trim();
    if (!url) return null;
    if (!/^https?:\/\/[^\s/]+\.[^\s/]+/.test(url)) return { error: true };
    const hit = stationCache.get(url);
    if (hit && hit.snap && Date.now() - hit.ts < 30 * 1000) return hit.snap;
    const mayRetry = !hit || (!hit.loading && Date.now() - (hit.lastTry || 0) > 15 * 1000);
    if (mayRetry) {
      stationCache.set(url, { ...(hit || {}), loading: true, lastTry: Date.now() });
      api('GET', `/api/station/current?url=${encodeURIComponent(url)}`)
        .then((root) => { stationCache.set(url, { ts: Date.now(), snap: { stations: parseStations(root) }, loading: false, lastTry: Date.now() }); refreshWeatherCells(); refreshPark(); })
        .catch(() => { stationCache.set(url, { ...(hit || {}), snap: hit?.snap || null, loading: false, error: true, lastTry: Date.now() }); refreshWeatherCells(); refreshPark(); });
    }
    if (hit?.snap) return hit.snap;
    if (hit?.error && !hit?.loading) return { error: true };
    return null;
  }
  function stationInfo(s) {
    const fix = (k, d) => (k in s.values ? s.values[k].toFixed(d) : '');
    return {
      location: s.name, date: '',
      temp: fix('temperature', 1) === '' ? '' : `${fix('temperature', 1)}°`,
      humidity: fix('humidity', 0) === '' ? '' : `${fix('humidity', 0)}%`,
      pm25: fix('pm25', 0), rain: fix('daily_rainfall', 1) === '' ? '' : `${fix('daily_rainfall', 1)} mm`,
    };
  }
  function refreshWeatherCells() {
    document.querySelectorAll('.cell[data-weather]').forEach((c) => c._renderWeather && c._renderWeather());
  }
  let weatherTicker = 0;
  function ensureWeatherTicker() {
    if (weatherTicker) return;
    // 每 10 秒：測站輪播換站、快取過期就重抓（getWeather／getStations 自己判斷）
    weatherTicker = setInterval(refreshWeatherCells, STATION_ROTATE_MS);
  }

  function buildWeather(c, cell, fg) {
    c.dataset.weather = '1';
    const w = el('div', 'pv-weather2');
    const dyn = !!cell.wDynBg;
    const stationMode = cell.wSrc === 'Station' && !parkOff(); // 場域沒有測站資料來源＝顯示一般天氣
    const locationSet = !(cell.wAuto === false && !cell.wCounty);
    let sky = null;
    if (dyn) { sky = new Sky(c); addTimer(sky); }
    const renderBar = (info) => {
      const bits = info.date ? [`<span style="opacity:.72">${esc(info.date)}</span>`] : [];
      if (info.high || info.low) bits.push(`<span>${esc(info.high || '–')} / ${esc(info.low || '–')}</span>`);
      if (info.humidity) bits.push(`<span style="opacity:.72">濕度 </span><span>${esc(info.humidity)}</span>`);
      if (info.pm25) bits.push(`<span style="opacity:.72">PM2.5 </span><span>${esc(info.pm25)}</span>`);
      if (info.rain) bits.push(`<span class="material-icons pvw-drop" style="opacity:.72">water_drop</span><span>${esc(info.rain)}</span>`);
      w.innerHTML = `<div class="pvw-left"><div class="pvw-loc">${esc(info.location)}</div><div class="pvw-info">${bits.join('<span style="opacity:.72"> · </span>')}</div></div>` +
        `<div class="pvw-right"><span class="material-icons pvw-icon">${COND_ICON[weatherKind(info.code)]}</span><span class="pvw-temp">${esc(info.temp)}</span></div>`;
    };
    const renderHint = (t) => { w.innerHTML = `<div class="pvw-hint">${esc(t)}</div>`; };
    let rotate = 0;
    c._renderWeather = () => {
      const forecast = locationSet ? getWeather(cell) : null;
      const kind = weatherKind(forecast?.code);
      if (sky) sky.setKind(kind);
      w.style.color = dyn ? (kind === 'Fog' || kind === 'Snow' ? '#111111' : '#ffffff') : fg;
      if (!stationMode) {
        if (!locationSet) renderHint('尚未選擇天氣地區');
        else if (!forecast) renderHint('取得天氣資料中…');
        else if (forecast.error) renderHint('天氣資料暫時無法取得');
        else renderBar(forecast);
      } else if (!parkApiOf(cell)) {
        renderHint('尚未設定測站資料來源');
      } else {
        const snap = getStations(parkApiOf(cell));
        if (!snap) renderHint('取得測站資料中…');
        else if (snap.error) renderHint('測站資料暫時無法取得');
        else if (!snap.stations.length) renderHint('測站 API 沒有回傳任何測站');
        else {
          const s = cell.wStation ? snap.stations.find((x) => x.id === cell.wStation) : snap.stations[(rotate++) % snap.stations.length];
          if (!s) renderHint(`找不到測站 ${cell.wStation}`);
          else if (!s.online) renderHint(`${s.name} 測站離線`);
          else renderBar({ ...stationInfo(s), code: forecast?.code ?? null });
        }
      }
      fitAll(c.parentElement ? c : stage);
    };
    c.append(w);
    c._renderWeather();
    ensureWeatherTicker();
  }

  /** 動態天空（App WeatherBackground 同一套）：漸層＋雨／雪／雲／太陽光暈／霧／閃電，單一 canvas 9 秒一輪。 */
  class Sky {
    constructor(cell) {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'sky';
      cell.insertBefore(this.canvas, cell.firstChild);
      this.kind = 'Unknown'; this.particles = [];
      this.t0 = performance.now(); this.raf = 0;
      this.loop = this.loop.bind(this);
      this.raf = requestAnimationFrame(this.loop);
    }
    setKind(kind) { if (kind !== this.kind || !this.particles.length) { this.kind = kind; this.particles = this.gen(kind); } }
    gen(kind) {
      let seed = ['Sunny', 'Partly', 'Cloudy', 'Fog', 'Rain', 'Storm', 'Snow', 'Unknown'].indexOf(kind) * 131 + 17;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const count = { Rain: 64, Storm: 64, Snow: 44, Partly: 6, Cloudy: 6, Unknown: 6, Fog: 5, Sunny: 0 }[kind] ?? 0;
      return Array.from({ length: count }, () => ({ x: rnd(), y: rnd(), size: 0.5 + rnd(), speed: 0.5 + rnd(), phase: rnd(), alpha: 0.4 + rnd() * 0.6 }));
    }
    stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
    loop(now) {
      if (!this.canvas.isConnected) { this.stop(); return; }
      const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
      if (W && H) {
        if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
        this.draw(this.canvas.getContext('2d'), W, H, ((now - this.t0) % 9000) / 9000);
      }
      this.raf = requestAnimationFrame(this.loop);
    }
    draw(g, W, H, t) {
      const fract = (x) => x - Math.floor(x);
      const grad = g.createLinearGradient(0, 0, 0, H);
      const [c0, c1] = SKY[this.kind] || SKY.Unknown;
      grad.addColorStop(0, c0); grad.addColorStop(1, c1);
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
      const P = this.particles;
      const sun = () => {
        const pulse = 1 + 0.1 * Math.sin(t * 2 * Math.PI);
        const cx = W * 0.88, cy = H * 0.05, r = H * 1.35 * pulse;
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        rg.addColorStop(0, 'rgba(255,237,176,.55)'); rg.addColorStop(1, 'rgba(255,237,176,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      };
      const clouds = (list) => list.forEach((p) => {
        const x = (fract(p.x + t * 0.12 * p.speed) * 1.3 - 0.15) * W, y = (0.1 + p.y * 0.55) * H, r = H * 0.28 * p.size;
        g.fillStyle = `rgba(255,255,255,${0.12 * p.alpha})`;
        for (const [dx, dy, rr] of [[0, 0, r], [-r * 0.9, r * 0.25, r * 0.75], [r * 0.95, r * 0.2, r * 0.8]]) { g.beginPath(); g.arc(x + dx, y + dy, rr, 0, Math.PI * 2); g.fill(); }
      });
      const rain = () => { const stroke = Math.max(H * 0.008, 1.5); g.lineCap = 'round'; P.forEach((p) => {
        const yF = fract(p.phase + t * (3 + p.speed * 3)), len = H * 0.14 * p.size, x = p.x * W, y = yF * (H + len) - len;
        g.strokeStyle = `rgba(255,255,255,${0.30 * p.alpha})`; g.lineWidth = stroke * p.size;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - len * 0.18, y + len); g.stroke();
      }); };
      const snow = () => P.forEach((p) => {
        const yF = fract(p.phase + t * (0.7 + p.speed * 0.7)), sway = Math.sin((yF * 3 + p.phase) * 2 * Math.PI) * W * 0.015;
        g.fillStyle = `rgba(255,255,255,${0.7 * p.alpha})`; g.beginPath(); g.arc(p.x * W + sway, yF * H * 1.05 - H * 0.02, H * 0.014 * p.size, 0, Math.PI * 2); g.fill();
      });
      const fog = () => P.forEach((p) => {
        const x = (fract(p.x + t * 0.08 * p.speed) * 1.6 - 0.3) * W, y = p.y * H, r = H * 0.55 * p.size * 2.2;
        const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, `rgba(255,255,255,${0.10 * p.alpha})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      });
      const lightning = () => {
        const f = fract(t * 2);
        const flash = f < 0.05 ? 1 - f / 0.05 : Math.abs(f - 0.09) < 0.02 ? 0.6 * (1 - Math.abs(f - 0.09) / 0.02) : 0;
        if (flash > 0.01) { g.fillStyle = `rgba(255,255,255,${flash * 0.4})`; g.fillRect(0, 0, W, H); }
      };
      switch (this.kind) {
        case 'Sunny': sun(); break;
        case 'Partly': sun(); clouds(P); break;
        case 'Cloudy': case 'Unknown': clouds(P); break;
        case 'Fog': fog(); break;
        case 'Rain': clouds(P.slice(0, 3)); rain(); break;
        case 'Storm': clouds(P.slice(0, 3)); rain(); lightning(); break;
        case 'Snow': snow(); break;
        default: break;
      }
    }
  }

  // ---------- 可點提示：徽章／按鈕（app.js hintOf、App effectiveTapHint 同一套） ----------
  // 沒點擊動作＝無；有設就照設的；沒設＝園區資訊走按鈕（沿用舊版面），其他一律無（user 2026-09-10：預設無、自己選）
  const HINTS = ['None', 'Badge', 'Glow', 'Button'];
  function hintOf(cell) {
    if (!cell.tap || cell.tap === 'None' || tapOff(cell)) return 'None';
    if (HINTS.includes(cell.tapHint)) return cell.tapHint;
    return cell.tap === 'OpenParkInfo' ? 'Button' : 'None';
  }
  // 閃爍：格子內側邊框＋向內的光，淡入→停→淡出每 3 秒一次，顏色可選（預設白）；同頁閃爍格對齊同一時間軸
  const GLOW_CYCLE_MS = 3000;
  function renderHintGlow(c, cell) {
    c.classList.add('hint-glow');
    c.style.setProperty('--hint-color', colorCss(cell.tapHintColor ?? 0xFFFFFFFF));
    c.style.setProperty('--glow-delay', `-${Date.now() % GLOW_CYCLE_MS}ms`);
  }
  const ctaLabelOf = (cell) => (cell.tapLabel || '').trim() || '點我查看';
  // 角落徽章：右上角一顆小小的「輕觸」記號，純靜態（不放大、無陰影）
  function renderHintBadge(c, cell, sizePx) {
    const b = el('div', 'pv-hint-badge');
    b.innerHTML = '<span class="material-icons">touch_app</span>輕觸';
    b._fit = () => {
      const w = c.offsetWidth || (sizePx && sizePx.w) || 1080;
      const h = c.offsetHeight || (sizePx && sizePx.h) || 200;
      const s = clamp(Math.min(w / 520, h / 180), 0.55, kScale());
      b.style.fontSize = `${(20 * s).toFixed(2)}px`;
      b.style.padding = `${(8 * s).toFixed(2)}px ${(14 * s).toFixed(2)}px ${(8 * s).toFixed(2)}px ${(10 * s).toFixed(2)}px`;
      b.style.margin = `${(12 * s).toFixed(2)}px`;
      b.querySelector('.material-icons').style.fontSize = `${(24 * s).toFixed(2)}px`;
    };
    b._fit();
    c.classList.add('hint-badge');
    c.append(b);
  }

  // ---------- 園區資訊格（App ParkCellOverlay／app.js renderParkOverlay 同一套規則，尺寸用真實像素） ----------
  function renderParkOverlay(c, cell, sizePx, fg) {
    const wrap = el('div', 'pv-park');
    const cta = hintOf(cell) === 'Button';
    wrap._fit = () => {
      const w = c.offsetWidth || (sizePx && sizePx.w) || 1080;
      const h = c.offsetHeight || (sizePx && sizePx.h) || 200;
      const vertical = cta && (cell.parkLayout === 'Vertical' || (cell.parkLayout !== 'Horizontal' && w / h < 2.0));
      const K = kScale();
      const s = vertical ? Math.max(0.5, Math.min(w / 300, h / 220, K)) : Math.max(0.4, Math.min(w / 600, h / 90, K));
      const u = (px) => `${(px * s).toFixed(2)}px`;
      wrap.className = 'pv-park ' + (vertical ? 'v' : 'h');
      const pct = clamp(Number(cell.txtSize) || 100, 50, 300) / 100;
      const availH = vertical ? Math.max(40, h - (cta ? (28 + 32 + 16) * s : 0)) : h;
      const fitCap = Math.min((w / s - 58) / 5.3, (availH / s) / 1.3);
      const titleSize = Math.max(8, Math.min((vertical ? 40 : 28) * pct, fitCap));
      let html = '';
      if (cell.content === 'ParkInfo') {
        html += `<div class="pv-park-title" style="color:${fg};font-size:${u(titleSize)};padding:0 ${u(24)}"><span class="material-icons" style="font-size:${u(titleSize * 1.2)}">map</span>園區資訊</div>`;
      } else html += '<div class="pv-park-fill"></div>';
      if (cta) {
        const margin = vertical ? `0 ${u(16)} ${u(16)}` : `0 ${u(16)} 0 0`;
        html += `<div class="pv-park-btn fx-${esc(cell.parkFx || 'Sweep')}" style="font-size:${u(28)};padding:${u(16)} ${u(20)} ${u(16)} ${u(28)};margin:${margin}">${esc(ctaLabelOf(cell))}<span class="material-icons" style="font-size:${u(34)}">chevron_right</span></div>`;
      }
      wrap.innerHTML = html;
    };
    wrap._fit();
    c.append(wrap);
  }

  // ---------- 點擊動作與「下一頁」 ----------
  function onCellTap(cell) {
    if (cell.tap === 'OpenSubPage') {
      openSub(cell);
    } else if (cell.tap === 'OpenWeb') {
      const url = normalizeUrl(cell.tapUrl);
      if (!url) { toast('這一格還沒有設定要開啟的網址。'); return; }
      openWeb(url);
    } else if (cell.tap === 'OpenParkInfo') {
      openPark(parkApiOf(cell), (cell.parkHere || '').trim(), cell.parkInfoLayout !== 'Mobile');
    } else if (cell.tap === 'OpenAssistant') {
      // AI 智能客服（assist.js）：後台代理 /api/assist/…，用這台機器 config 裡的客服帳號；沒設帳號或沒選客服會顯示提示
      if (!window.KioskAssist) { toast('智能客服模組尚未載入。'); return; }
      const chat = config?.chatApi || {};
      window.KioskAssist.open({
        base: BASE, deviceId, deviceKey, agentId: cell.agentId || '', accent: cell.agentAccent ?? null, theme: siteTheme,
        idleMs: idleReturnMs(), layout: cell.assistantLayout || 'Kiosk', configured: !!(chat.email && chat.password && cell.agentId),
        speak: cell.agentSpeak !== false, speakRate: cell.agentSpeakRate, // 這一格的「語音朗讀」與「語速」
        upload: cell.agentUpload !== false, // 這一格的「允許上傳圖片」（2026-09-23）
        inputPos: cell.agentInputPos === 'Bottom' ? 'Bottom' : 'Top', // 這一格的「輸入區位置」（2026-10-12）：預設上方＝輸入框在頂欄、新問題釘在上面；沒設定過的格子也是上方
        onClose: () => logEvent('page.close', '關閉智能客服，回到展示'),
      });
      logEvent('page.open', `開啟智能客服${cell.agentName ? '：' + cell.agentName : ''}`);
    }
  }

  // ---- 內頁進出轉場（2026-09-14，同 App sharedAxisX）：內頁層滑入、展示畫面滑出；關閉時反向。
  //      靜默關閉（休眠、重載）不做動畫，直接把展示畫面復原。類別與時間定義在 play.css。 ----
  const NAV_MS = 450;
  const KioskNav = {
    enter(layer) {
      const st = $('stage');
      st.classList.remove('nav-in'); st.classList.add('nav-out');
      layer.classList.remove('nav-leave'); layer.classList.add('nav-enter');
    },
    leave(layer, done) {
      const st = $('stage');
      st.classList.remove('nav-out'); st.classList.add('nav-in');
      layer.classList.remove('nav-enter'); layer.classList.add('nav-leave');
      setTimeout(() => { layer.classList.remove('nav-leave'); if (done) done(); }, NAV_MS);
    },
    /** 不做動畫：展示畫面立刻復原（休眠／重載時用） */
    restore(layer) {
      $('stage').classList.remove('nav-out', 'nav-in');
      if (layer) layer.classList.remove('nav-enter', 'nav-leave');
    },
  };
  window.KioskNav = KioskNav;

  let overlayIdle = 0;
  let overlayKind = '';
  let overlayCloseTimer = 0;
  function armIdle() {
    clearTimeout(overlayIdle);
    const ms = idleReturnMs();
    if (ms > 0) overlayIdle = setTimeout(() => closeOverlay(), ms); // 0＝後台關閉自動返回，不計時
  }
  document.addEventListener('pointerdown', () => { if (overlayKind) armIdle(); }, { capture: true, passive: true });
  function openOverlay(kind, title) {
    overlayKind = kind;
    $('ovTitle').textContent = title;
    setBackIcon('arrow_back', '上一頁', false);
    const overlay = $('overlay');
    overlay.classList.toggle('park-page', kind === 'park');
    overlay.style.setProperty('--park-primary', siteTheme || '#E07800');
    $('ovMeta').className = 'topbar-meta';
    $('ovMeta').hidden = true; $('ovMeta').replaceChildren(); $('ovHome').hidden = false;
    $('ovBody').innerHTML = '';
    clearTimeout(overlayCloseTimer); overlayCloseTimer = 0;
    overlay.hidden = false;
    KioskNav.enter(overlay);
    armIdle();
    logEvent('page.open', kind === 'web' ? `開啟網頁：${title}` : '開啟園區資訊');
  }
  function closeOverlay(silent) {
    if (!overlayKind) return;
    clearTimeout(overlayIdle);
    const kind = overlayKind; overlayKind = '';
    if (parkTimer) { clearInterval(parkTimer); parkTimer = 0; }
    if (parkState && parkState.cardTimer) { clearInterval(parkState.cardTimer); parkState.cardTimer = 0; }
    if (parkState && parkState.ro) { parkState.ro.disconnect(); parkState.ro = null; }
    const ov = $('overlay');
    const hide = () => { ov.hidden = true; $('ovBody').innerHTML = ''; };
    if (silent) { KioskNav.restore(ov); hide(); }
    else {
      // 內容留著陪滑出，動畫結束才藏起來；期間若又開了新內頁，openOverlay 會取消這個計時器
      clearTimeout(overlayCloseTimer);
      KioskNav.leave(ov, () => {});
      overlayCloseTimer = setTimeout(() => { overlayCloseTimer = 0; if (!overlayKind) hide(); }, NAV_MS);
    }
    if (!silent) logEvent('page.close', kind === 'web' ? '關閉網頁，回到展示' : '關閉園區資訊，回到展示');
  }
  /** 左上角返回鈕換圖示（← ⇄ ✕）：舊的轉出去、新的轉進來（同後台的變形圖示）；animated=false 直接換 */
  function setBackIcon(name, label, animated = true) {
    const b = $('ovBack');
    const ic = b.querySelector('.material-icons');
    b.setAttribute('aria-label', label);
    if ((ic.dataset.to || ic.textContent) === name) return;
    ic.getAnimations().forEach((a) => a.cancel());
    ic.dataset.to = name;
    const done = () => { ic.textContent = name; delete ic.dataset.to; };
    if (!animated || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    ic.animate([{ transform: 'none', opacity: 1 }, { transform: 'rotate(90deg) scale(.5)', opacity: 0 }], { duration: 110, easing: 'cubic-bezier(.4, 0, 1, 1)' }).onfinish = () => {
      done();
      ic.animate([{ transform: 'rotate(-90deg) scale(.5)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 180, easing: 'cubic-bezier(.2, 0, 0, 1)' });
    };
  }
  /** 園區資訊頁：資訊卡開著（而且沒開「查看更多」網頁）＝✕ 收起資訊卡，其他時候＝← 上一頁（user 2026-10-21：叉叉跟返回共用） */
  function syncParkBack() {
    const close = overlayKind === 'park' && !!parkState && !!parkState.sheet && !parkState.web;
    setBackIcon(close ? 'close' : 'arrow_back', close ? '收起資訊卡' : '上一頁');
  }
  $('ovBack').addEventListener('click', () => {
    // 網頁：能退就退一頁（跨網域的 iframe 無法得知歷史，退不了就回展示）；園區資訊：直接回展示
    if (overlayKind === 'park' && parkState && parkState.web) { closeParkWeb(); return; } // 看更多開著：← 先回園區資訊、卡片還在
    if (overlayKind === 'park' && parkState && parkState.sheet) { closeParkSheet(true); return; } // 資訊卡開著：← 先收卡
    const f = $('ovBody').querySelector('iframe');
    if (overlayKind === 'web' && f && f._navigated) { try { f.contentWindow.history.back(); } catch { closeOverlay(); } f._navigated = false; return; }
    closeOverlay();
  });
  $('ovHome').addEventListener('click', () => { closeOverlay(); closeSub(); }); // 首頁＝回主頁（從子頁開的內頁也直接回最外層，同 App）

  // ---- 子頁（樹狀展示，2026-10-20 user）：格子點擊動作「進入子頁」→ 子頁滑進來，頂欄＝返回（上一層）／子頁名稱／首頁；
  //      子頁裡還能再進子頁（主頁算第 1 層，最多 3 層）。子頁層壓在展示畫面上、網頁／園區資訊／客服之下，
  //      從子頁開的內頁關掉會回到子頁。閒置秒數到了直接回主頁（同內頁的自動返回）。App KioskDisplayScreen 同規則。
  const MAX_SUB_DEPTH = 2; // 主頁之下最多 2 層子頁
  let subStack = [];       // 一路點進來的格子，最後一個＝目前顯示的子頁
  let subTimers = [];      // 子頁格子的輪播／天氣計時器（關子頁就停，不跟主頁的混在一起）
  let subIdle = 0;
  let subLayer = null;
  const stopTimers = (list) => list.forEach((t) => (typeof t === 'number' ? clearInterval(t) : t.stop && t.stop()));
  function subLayerEl() {
    if (subLayer) return subLayer;
    subLayer = el('div', 'overlay sub-layer');
    subLayer.hidden = true;
    subLayer.innerHTML = '<div class="topbar">'
      + '<button type="button" class="topbar-btn sub-back" aria-label="上一頁"><span class="material-icons">arrow_back</span></button>'
      + '<div class="topbar-title"></div>'
      + '<button type="button" class="topbar-btn sub-home" aria-label="回首頁"><span class="material-icons">home</span></button>'
      + '</div><div class="sub-body"></div>';
    subLayer.querySelector('.sub-back').addEventListener('click', () => popSub());
    subLayer.querySelector('.sub-home').addEventListener('click', () => closeSub());
    $('navClip').insertBefore(subLayer, $('overlay')); // 同一層 z-index，排在 #overlay 前面＝內頁蓋在子頁上
    return subLayer;
  }
  const subName = (cell) => ((cell.sub && cell.sub.name) || '').trim() || '子頁';
  function renderSub() {
    const layer = subLayerEl();
    const cell = subStack[subStack.length - 1];
    layer.querySelector('.topbar-title').textContent = subName(cell);
    // 頂欄同園區資訊（2026-10-20 user 選 A）：主題色圓形返回／首頁鈕＋大標題；KIOSK 放大、手機模式一般大小
    layer.style.setProperty('--park-primary', siteTheme || '#E07800');
    for (const v of ['--park-tb', '--park-fs']) { if (cell.sub && cell.sub.layout === 'Mobile') layer.style.setProperty(v, '1'); else layer.style.removeProperty(v); }
    stopTimers(subTimers); subTimers = [];
    const body = layer.querySelector('.sub-body');
    body.innerHTML = '';
    layer.hidden = false; // 先顯示才量得到內容區尺寸
    const px = { w: body.clientWidth || stage.clientWidth, h: body.clientHeight || stage.clientHeight };
    const before = cellTimers.length;
    const b = el('div', 'block');
    b.style.flex = '1';
    b.append(nodeEl((cell.sub && cell.sub.node) || { t: 'cell' }, 1, px));
    body.append(b);
    fitAll(body);
    subTimers = cellTimers.splice(before);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (body.isConnected) fitAll(body); });
  }
  function openSub(cell) {
    if (!cell.sub || subStack.length >= MAX_SUB_DEPTH) return;
    const first = !subStack.length;
    subStack.push(cell);
    renderSub();
    const layer = subLayerEl();
    if (first) KioskNav.enter(layer);
    else { layer.classList.remove('nav-enter'); void layer.offsetWidth; layer.classList.add('nav-enter'); } // 再往下一層：子頁層重新滑進來
    armSubIdle();
    logEvent('page.open', `開啟子頁：${subName(cell)}`);
  }
  function popSub() {
    if (subStack.length <= 1) { closeSub(); return; }
    subStack.pop();
    renderSub();
    armSubIdle();
  }
  function closeSub(silent) {
    clearTimeout(subIdle);
    if (!subStack.length) return;
    subStack = [];
    stopTimers(subTimers); subTimers = [];
    const layer = subLayer;
    const hide = () => { layer.hidden = true; layer.querySelector('.sub-body').innerHTML = ''; };
    if (silent) { KioskNav.restore(layer); hide(); }
    else {
      KioskNav.leave(layer, () => { if (!subStack.length) hide(); });
      logEvent('page.close', '關閉子頁，回到展示');
    }
  }
  function armSubIdle() {
    clearTimeout(subIdle);
    const ms = idleReturnMs();
    if (ms > 0) subIdle = setTimeout(() => { closeOverlay(); if (window.KioskAssist?.isOpen()) window.KioskAssist.close(); closeSub(); }, ms);
  }
  document.addEventListener('pointerdown', () => { if (subStack.length) armSubIdle(); }, { capture: true, passive: true });

  function openWeb(url) {
    let host = '';
    try { host = new URL(url).host; } catch { host = url; }
    openOverlay('web', host || '網頁瀏覽');
    const f = document.createElement('iframe');
    f.src = url; f.setAttribute('allow', 'autoplay; fullscreen; geolocation; microphone; camera');
    f.addEventListener('load', () => { if (f._loaded) f._navigated = true; f._loaded = true; });
    $('ovBody').append(f);
  }

  // 園區資訊頁（App ParkInfoScreen 同形）：地圖＋測站標記＋讀數面板，30 秒重抓
  let parkTimer = 0;
  let parkState = null;
  function openPark(apiUrl, hereId, kiosk = true) {
    openOverlay('park', '園區資訊');
    // 版面（2026-09-23 user）：手機操作模式不放大頂欄（--park-tb 在 applyStageVars 依舞台寬算，這裡覆蓋成 1）
    for (const v of ['--park-tb', '--park-fs']) { if (kiosk) $('overlay').style.removeProperty(v); else $('overlay').style.setProperty(v, '1'); }
    // 目前位置（2026-09-22）：後台指定這台機器站在哪個測站點；地圖上那一站多一個「目前位置」標籤，數值也預設先看那一站
    const nodes = parkNodes();
    const here = nodes.some((n) => n.id === hereId) ? hereId : '';
    const body = $('ovBody');
    const map = el('div', 'park-map');
    const img = document.createElement('img');
    const pmap = parkMapOf();
    const aspect = pmap ? pmap.aspect : 9 / 16;
    if (pmap) { img.src = pmap.src; img.alt = '園區導覽圖'; map.append(img); }
    else map.append(el('div', 'park-hint park-nomap', '這個場域還沒有園區地圖。'));
    const panel = el('div', 'park-panel');
    panel.setAttribute('aria-live', 'polite');
    panel.setAttribute('aria-atomic', 'true');
    // 2026-09-10 user 指示：儀表板在上、地圖在下；地圖先填滿（寬滿、依比例），面板拿剩下的高度、字級縮到放得下
    body.append(panel, map);
    $('ovHome').hidden = true; $('ovMeta').hidden = false; // 園區資訊頁：首頁鈕換成右上角的更新時間
    // sheet＝資訊卡（一進來不自動開，點有資料的站才從上方滑下）；web＝看更多開著的網頁層
    parkState = { apiUrl, here, nodes, kiosk, selectedId: here || nodes[0]?.id || '', sheet: null, web: null, cardTimer: 0, map, panel };
    const PANEL_MIN = 130; // 面板最少留這麼高（字級 0.45 時放得下標題＋數字）
    const fitLayout = () => {
      const W = body.clientWidth, H = body.clientHeight;
      let mh = Math.round(W / aspect);
      if (mh > H - PANEL_MIN) mh = Math.max(0, H - PANEL_MIN);
      map.style.height = `${mh}px`;
      const avail = H - mh;
      panel.style.height = `${avail}px`;
      // 以 1080 寬、面板 288 高為設計基準，先依寬高算比例，再實測縮到放得下（最小 0.45）
      let s = Math.max(0.45, Math.min(W / 1080, avail / 288)); // 比 FHD 寬的螢幕跟著放大（上限＝W/1080）
      panel.style.setProperty('--ps', s.toFixed(3));
      for (let i = 0; i < 4 && panel.scrollHeight > avail + 1 && s > 0.45; i++) {
        s = Math.max(0.45, s * (avail / panel.scrollHeight) * 0.98);
        panel.style.setProperty('--ps', s.toFixed(3));
      }
    };
    parkState.fitLayout = () => { fitLayout(); if (parkState.sheet) parkSheetScale(); };
    fitLayout();
    nodes.forEach((n) => {
      const m = el('button', 'park-marker');
      m.type = 'button';
      m.dataset.id = n.id;
      const isHere = n.id === here;
      if (isHere) m.classList.add('here');
      m.setAttribute('aria-label', `${isHere ? '目前位置，' : ''}查看 ${n.id} ${n.name} 的環境資訊`);
      m.innerHTML = (isHere ? '<div class="park-here"><span class="material-icons" aria-hidden="true">my_location</span>目前位置</div>' : '')
        + `<div class="halo"></div><div class="dot">${esc(n.id)}</div>`;
      // 點測站：讀數換成這一站；有資料（照片或說明）的站，資訊卡再從上方滑下來
      m.addEventListener('click', () => { parkState.selectedId = n.id; refreshPark(); if (parkHasInfo(n.id)) openParkSheet(n.id); });
      map.append(m);
    });
    const place = () => {
      const W = map.clientWidth, H = map.clientHeight;
      let dw, dh;
      if (W / H > aspect) { dh = H; dw = H * aspect; } else { dw = W; dh = W / aspect; }
      const left = (W - dw) / 2, top = (H - dh) / 2;
      const k = parseFloat(getComputedStyle(map).getPropertyValue('--k')) || 1;
      map.querySelectorAll('.park-marker').forEach((m) => {
        const n = parkState.nodes.find((x) => x.id === m.dataset.id);
        const cx = left + dw * n.x / 100;
        m.style.left = `${cx}px`; m.style.top = `${top + dh * n.y / 100}px`;
        // 「目前位置」標籤：不管圓點落在地圖哪裡都要完整看得到（不是只修某一站）——
        //   左右：標籤推到離畫面邊至少 24px，三角形留在標籤上、繼續指著圓點；
        //   上下：圓點上方放不下就翻到圓點下方（三角形跟著改成朝上）。
        const tag = m.querySelector('.park-here');
        if (!tag) return;
        const cy = top + dh * n.y / 100;
        const edge = 24 * k, gap = 8 * k, tri = 7 * k, half = 32 * k; // gap＝箭頭尖端與圓點之間留的空隙；half＝圓點標記的一半
        tag.style.setProperty('--shift', '0px');
        const cw = tag.offsetWidth, ch = tag.offsetHeight;
        const lo = edge + cw / 2, hi = W - edge - cw / 2;
        const shift = Math.round(clamp(cx, Math.min(lo, hi), Math.max(lo, hi)) - cx);
        tag.style.setProperty('--shift', `${shift}px`);
        tag.style.setProperty('--tri', `${clamp(cw / 2 - shift, 18 * k, cw - 18 * k)}px`);
        const roomAbove = cy - half - gap - ch >= edge;
        const roomBelow = cy + half + gap + ch + tri <= H - edge;
        tag.classList.toggle('below', !roomAbove && roomBelow);
      });
    };
    refreshPark();
    place();
    parkState.place = place;
    // 面板先矮後高（讀數進來、字級重算）會讓地圖縮短，之前只在開頁時算一次，所有圓點與標籤就整批偏掉；
    // 這裡盯著地圖尺寸，一變就重算（視窗 resize 另有處理）。
    if (window.ResizeObserver) {
      parkState.ro = new ResizeObserver(() => place());
      parkState.ro.observe(map);
    }
    parkTimer = setInterval(refreshPark, 30_000);
  }
  /** 資訊卡＝從頂欄下方滑下來的 sheet（2026-10-20 user：蓋在內容上、不壓縮頁面；App ParkInfoScreen 同規則）。
      下面半透明遮罩；點遮罩、✕、← 或往上滑都收起（收起後讀數就是這一站的）。內容：照片（多張每 5 秒淡入換下一張＋小圓點）、
      名稱＋✕、完整說明、看更多；最高 78% 內容區，再長就在 sheet 裡捲。 */
  const parkReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const parkRev = (id) => id + JSON.stringify(parkSt(id));
  function parkSheetScale() {
    const st = parkState && parkState.sheet;
    if (!st) return;
    // 資訊卡大小跟著版面（user 2026-10-21，同 App）：手機操作模式＝一般大小（基準 0.45），KIOSK＝跟頂欄一樣放大
    // （寬度倍率 × 1.6，文字再 × 1.45）；比 FHD 寬的舞台整體再等比放大（kScale）。--ps＝版面尺寸、--pt＝文字
    const ws = Math.min(1080 / 820, Math.max(1, (stage.clientWidth || window.innerWidth) / 820));
    const ps = 0.45 * (parkState.kiosk ? ws * 1.6 : 1) * kScale();
    st.layer.style.setProperty('--ps', ps.toFixed(3));
    st.layer.style.setProperty('--pt', (ps * (parkState.kiosk ? 1.45 : 1)).toFixed(3));
    requestAnimationFrame(() => st.scroll.classList.toggle('is-scrollable', st.scroll.scrollHeight > st.scroll.clientHeight + 1));
  }
  function openParkSheet(id) {
    if (!parkState) return;
    if (parkState.sheet) closeParkSheet(false);
    const layer = el('div', 'park-sheet-layer');
    const scrim = el('div', 'park-scrim');
    const sheet = el('div', 'park-sheet');
    sheet.setAttribute('role', 'dialog');
    const scroll = el('div', 'park-sheet-scroll');
    const foot = el('div', 'park-sheet-foot'); // 「查看更多」固定在底部、不跟內容捲（user 2026-10-21）；這一條也能往上拉收起
    foot.hidden = true;
    const grip = el('div', 'park-sheet-grip');
    grip.setAttribute('aria-hidden', 'true');
    sheet.append(scroll, foot, grip);
    layer.append(scrim, sheet);
    $('ovBody').append(layer);
    parkState.sheet = { id, layer, sheet, scroll, foot, rev: '' };
    fillParkSheet();
    syncParkBack();
    scrim.addEventListener('click', () => closeParkSheet(true));
    dragParkSheet(sheet, scroll);
    if (!parkReduced()) {
      sheet.animate([{ transform: 'translateY(-100%)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2, 0, 0, 1)' });
      scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320 });
    }
  }
  function fillParkSheet() {
    const st = parkState.sheet;
    const id = st.id;
    const e = parkSt(id) || {};
    const node = parkState.nodes.find((n) => n.id === id);
    const name = (node && node.name) || st.name || id;
    if (parkState.cardTimer) { clearInterval(parkState.cardTimer); parkState.cardTimer = 0; }
    st.rev = parkRev(id);
    st.scroll.replaceChildren();
    st.foot.replaceChildren();
    st.sheet.setAttribute('aria-label', `${id} ${name}`);
    const photos = (e.photos || []).filter((u) => typeof u === 'string' && u);
    if (photos.length) {
      // 照片滿寬（user 2026-10-21：以寬度為主）：框的比例跟第一張照片走（4:3～21:9，直式照片裁成 4:3 免得卡片太高），其他張照這個框裁切
      const ph = el('div', 'park-card-photo');
      const imgs = photos.map((u, i) => { const img = document.createElement('img'); img.src = mediaSrc(u); img.alt = ''; img.draggable = false; if (!i) img.classList.add('on'); ph.append(img); return img; });
      const fitRatio = () => {
        const im = imgs[0];
        if (!im.naturalWidth || !im.naturalHeight) return;
        ph.style.aspectRatio = String(clamp(im.naturalWidth / im.naturalHeight, 4 / 3, 21 / 9));
        parkSheetScale(); // 高度變了：重新判斷要不要在卡裡捲
      };
      if (imgs[0].complete) fitRatio(); else imgs[0].addEventListener('load', fitRatio, { once: true });
      if (photos.length > 1) {
        const dots = el('div', 'park-card-dots');
        const ds = photos.map((_, i) => { const d = el('span', i ? '' : 'on'); dots.append(d); return d; });
        ph.append(dots);
        let at = 0;
        parkState.cardTimer = setInterval(() => {
          imgs[at].classList.remove('on'); ds[at].classList.remove('on');
          at = (at + 1) % imgs.length;
          imgs[at].classList.add('on'); ds[at].classList.add('on');
        }, 5000);
      }
      st.scroll.append(ph);
    }
    // 站名已經在頂欄（user 2026-10-21：照片下面不再重複）；✕ 也改成頂欄的返回鈕（syncParkBack）
    // 介紹：後台有簡易格式（descRich，2026-10-21）就照格式畫（park-rich.js 先跳脫再套格式），裡面的連結在園區資訊頁裡開；沒有就是純文字
    if (String(e.descRich || '').trim() && window.ParkRich) {
      const d = el('div', 'park-card-desc is-rich');
      d.innerHTML = window.ParkRich.toHtml(e.descRich);
      d.addEventListener('click', (ev) => { const a = ev.target.closest('a[data-rich-link]'); if (!a) return; ev.preventDefault(); openParkWeb(a.getAttribute('href')); });
      st.scroll.append(d);
    } else if (String(e.desc || '').trim()) st.scroll.append(el('div', 'park-card-desc', e.desc));
    if (e.link) {
      const more = el('button', 'park-card-more');
      more.type = 'button';
      more.innerHTML = '查看更多<span class="material-icons" aria-hidden="true">chevron_right</span>';
      more.addEventListener('click', () => openParkWeb(e.link));
      st.foot.append(more);
    }
    // 有「查看更多」：固定在底部那一條，sheet 下緣圓角跟膠囊同心（.has-foot）；沒有就是原本的底部拖曳區
    st.foot.hidden = !e.link;
    st.sheet.classList.toggle('has-foot', !!e.link);
    parkSheetScale();
  }
  /** 收起資訊卡：往上滑出、遮罩淡出（fromY＝手指拉到的位置，從那裡接著滑走）。 */
  function closeParkSheet(animated, fromY = 0) {
    const st = parkState && parkState.sheet;
    if (!st) return;
    parkState.sheet = null;
    syncParkBack();
    if (parkState.cardTimer) { clearInterval(parkState.cardTimer); parkState.cardTimer = 0; }
    const { layer, sheet } = st;
    layer.style.pointerEvents = 'none';
    if (!animated || parkReduced()) { layer.remove(); return; }
    const scrim = layer.querySelector('.park-scrim');
    sheet.animate([{ transform: `translateY(${fromY}px)` }, { transform: 'translateY(-100%)' }], { duration: 220, easing: 'cubic-bezier(.3, 0, .8, .15)', fill: 'forwards' }).onfinish = () => layer.remove();
    scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
  }
  /** 往上滑收起：拉超過 sheet 高度的 1/4 或往上甩就收；不夠就彈回。往下拉完全不動（user 2026-10-20：不能跟頂欄分開）。
      內容長到能捲時，捲動區交給捲動，從底下的抓手才能拉。 */
  function dragParkSheet(sheet, scroll) {
    let g = null;
    const shown = (dy) => Math.min(0, dy);
    sheet.addEventListener('pointerdown', (e) => {
      sheet._dragged = false;
      if (e.button > 0) return;
      if (!e.target.closest('.park-sheet-grip, .park-sheet-foot') && scroll.classList.contains('is-scrollable')) return;
      g = { id: e.pointerId, y: e.clientY, dy: 0, moving: false, trail: [{ y: e.clientY, t: e.timeStamp }] };
    });
    sheet.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dy = e.clientY - g.y;
      if (!g.moving) {
        if (Math.abs(dy) < 6) return;
        g.moving = true;
        sheet._dragged = true;
        try { sheet.setPointerCapture(e.pointerId); } catch { /* 已經放開 */ }
      }
      g.dy = dy;
      sheet.style.transform = `translateY(${shown(dy)}px)`;
      g.trail.push({ y: e.clientY, t: e.timeStamp });
      if (g.trail.length > 5) g.trail.shift();
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const d = g; g = null;
      if (!d.moving) return;
      const a = d.trail[0], b = d.trail[d.trail.length - 1];
      const v = (b.y - a.y) / Math.max(1, b.t - a.t); // px/ms，負＝往上
      if (d.dy < -sheet.offsetHeight * 0.25 || (d.dy < 0 && v < -0.5)) { closeParkSheet(true, shown(d.dy)); return; }
      sheet.style.transform = '';
      if (!parkReduced()) sheet.animate([{ transform: `translateY(${shown(d.dy)}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2, 0, 0, 1)' });
    };
    sheet.addEventListener('pointerup', end);
    sheet.addEventListener('pointercancel', end);
    sheet.addEventListener('click', (e) => { if (sheet._dragged) { e.stopPropagation(); e.preventDefault(); sheet._dragged = false; } }, true); // 拉完放開不算按到 ✕／看更多
  }
  /** 看更多：在園區資訊頁裡疊一層網頁（頂欄標題換成網址），← 回園區資訊、卡片還開著；閒置一樣整個關掉。 */
  function openParkWeb(link) {
    const url = normalizeUrl(link);
    if (!url || !parkState) return;
    let host = '';
    try { host = new URL(url).host; } catch { host = url; }
    const w = el('div', 'park-web');
    const f = document.createElement('iframe');
    f.src = url; f.setAttribute('allow', 'autoplay; fullscreen; geolocation');
    w.append(f);
    $('ovBody').append(w);
    parkState.web = w;
    syncParkBack(); // 網頁開著：← 回園區資訊
    $('ovTitle').textContent = host || '網頁瀏覽';
    $('ovMeta').hidden = true;
    parkWebNav(w, true);
    logEvent('page.open', `開啟網頁：${host}`);
  }
  /** 「查看更多」網頁進出（user 2026-10-21：用換頁的方式，不要突然出現）：同內頁的推入式（KioskNav）——
   *  網頁從右側整頁滑進來、左緣帶陰影，底下的園區資訊稍微變暗；返回反向，滑出去才移除。 */
  function parkWebNav(w, entering) {
    const under = [...$('ovBody').children].filter((x) => x !== w && !x.classList.contains('park-web'));
    if (parkReduced()) { if (!entering) w.remove(); return; }
    w.classList.remove('nav-enter', 'nav-leave');
    void w.offsetWidth; // 重新觸發動畫
    w.classList.add(entering ? 'nav-enter' : 'nav-leave');
    for (const u of under) u.animate([{ opacity: entering ? 1 : 0.8 }, { opacity: entering ? 0.8 : 1 }], { duration: NAV_MS - 50, easing: 'cubic-bezier(.32, .72, 0, 1)', fill: entering ? 'forwards' : 'none' });
    if (!entering) {
      setTimeout(() => w.remove(), NAV_MS - 50);
      for (const u of under) u.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().fill === 'forwards').forEach((a) => a.cancel()); // 進場時留著的變暗拿掉（上面那段接著從 .8 回到 1）
    }
  }
  function closeParkWeb() {
    if (!parkState || !parkState.web) return;
    parkWebNav(parkState.web, false);
    parkState.web = null;
    syncParkBack(); // 回到資訊卡：又是 ✕
    refreshPark();
  }
  function refreshPark() {
    if (!parkState || overlayKind !== 'park' || parkState.web) return; // 看更多開著時頂欄是網頁的，回來再更新
    const { apiUrl, selectedId, map, panel } = parkState;
    const snap = apiUrl ? getStations(apiUrl) : null;
    const readings = new Map((snap && !snap.error ? snap.stations : []).map((s) => [s.id, s]));
    map.querySelectorAll('.park-marker').forEach((m) => {
      const r = readings.get(m.dataset.id);
      const ring = r && r.online ? '#2E7D32' : '#9E9E9E';
      m.style.setProperty('--ring', ring);
      m.querySelector('.halo').style.background = ring;
      m.classList.toggle('selected', m.dataset.id === selectedId);
      m.setAttribute('aria-pressed', m.dataset.id === selectedId ? 'true' : 'false');
    });
    const node = parkState.nodes.find((n) => n.id === selectedId);
    const nodeName = (n) => (n && (n.name || readings.get(n.id)?.name)) || '';
    const r = node ? readings.get(node.id) : null;
    let hint = null;
    if (!apiUrl) hint = '尚未設定測站 API，地圖僅供導覽。';
    else if (!snap) hint = '取得測站資料中…';
    else if (snap.error) hint = '測站資料暫時無法取得。';
    else if (!r) hint = '這一站目前沒有回傳資料。';
    else if (!r.online) hint = '這一站目前離線。';
    $('ovTitle').textContent = node ? `${node.id}  ${nodeName(node)}`.trim() : '園區資訊';
    const meta = $('ovMeta');
    meta.className = 'topbar-meta park-topbar-meta';
    meta.replaceChildren();
    if (r) {
      const status = el('span', `park-status-chip ${r.online ? 'online' : 'offline'}`);
      status.append(el('span', 'dot'), document.createTextNode(r.online ? '在線' : '離線'));
      meta.append(status);
      const t = String(r.receivedAt || ''); const i = t.indexOf('T');
      const clock = i >= 0 && t.length >= i + 6 ? t.slice(i + 1, i + 6) : t;
      if (clock) meta.append(el('span', 'park-updated', `更新時間 ${clock}`));
    }
    meta.hidden = !meta.childElementCount;

    let html = '';
    if (hint) html += `<div class="park-hint">${esc(hint)}</div>`;
    else {
      const metrics = window.ParkMetrics.build(r.values);
      html += `<div class="park-metrics">${metrics.map((metric) =>
        `<div class="park-metric" style="--metric:${metric.color}">` +
          `<div class="park-metric-head"><span class="material-icons" aria-hidden="true">${metric.icon}</span>` +
          `<span class="park-metric-label">${esc(metric.label)}</span><span class="park-metric-value">${esc(metric.value)}</span></div>` +
          `<div class="park-metric-status">${esc(metric.status)}</div></div>`,
      ).join('')}</div>`;
    }
    panel.innerHTML = html;
    // 資訊卡開著：後台改了這一站就原地重畫（照片輪播不會每 30 秒重來）；這一站沒資料了就收起
    const sh = parkState.sheet;
    if (sh) {
      sh.name = nodeName(parkState.nodes.find((n) => n.id === sh.id));
      if (!parkHasInfo(sh.id)) closeParkSheet(true);
      else if (sh.rev !== parkRev(sh.id)) fillParkSheet();
    }
    if (parkState.fitLayout) parkState.fitLayout();
    if (parkState.place) parkState.place();
  }

  // ---------- 休眠排程（App SleepScheduleController 同：跨午夜的時段歸起始那天） ----------
  let sleeping = false;
  function isSleepingAt(sch, now) {
    if (!sch || !sch.enabled || !Array.isArray(sch.periods) || !sch.periods.length) return false;
    const byDay = new Map(sch.periods.map((p) => [Number(p.day), p]));
    const minute = now.getHours() * 60 + now.getMinutes();
    const today = now.getDay() === 0 ? 7 : now.getDay(); // 週一=1…週日=7
    const tp = byDay.get(today);
    if (tp) {
      const s = Number(tp.start), e = Number(tp.end);
      if (s === e) return true;
      if (s < e && minute >= s && minute < e) return true;
      if (s > e && minute >= s) return true;
    }
    const yp = byDay.get(today === 1 ? 7 : today - 1);
    return !!yp && Number(yp.start) > Number(yp.end) && minute < Number(yp.end);
  }
  function updateSleep() {
    const on = isSleepingAt(sleepSchedule, new Date());
    if (on !== sleeping) {
      sleeping = on;
      $('sleep').hidden = !on;
      if (on) { closeOverlay(true); if (window.KioskAssist?.isOpen()) window.KioskAssist.close(); closeSub(true); }
      logEvent(on ? 'sleep.enter' : 'sleep.exit', on ? '依排程進入休眠畫面' : '休眠時段結束，恢復展示');
    }
  }
  (function sleepTicker() {
    const now = new Date();
    const wait = 60_000 - now.getSeconds() * 1000 - now.getMilliseconds() + 25;
    setTimeout(() => { updateSleep(); sleepTicker(); }, wait);
  })();

  // ---------- 後台還沒編輯：提示 ----------
  function isBlankLayout() {
    if (pages.length !== 1) return false;
    const blocks = pages[0].blocks || [];
    if (blocks.length !== 1) return false;
    const n = blocks[0].node || {};
    return n.t !== 'split' && (n.bg || 'Solid') === 'Solid' && (n.content || 'None') === 'None' && (!n.tap || n.tap === 'None');
  }
  function updateBlankHint() {
    const blank = isBlankLayout();
    $('blankHint').hidden = !blank;
    if (blank) $('blankHintText').innerHTML = `這台機器「${esc(deviceName || deviceId)}」已連上後台，還沒有展示內容。<br>請到後台「機器總覽」編輯這台機器並發布。`;
  }

  // ---------- 視窗尺寸改變：重畫並回報螢幕尺寸 ----------
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      layoutStage();
      if (parkState && overlayKind === 'park') { parkState.fitLayout?.(); parkState.place?.(); }
      if (!config) return;
      renderPage(pages[activeIndex] || { blocks: [] });
      screenReported = false;
      report({}).catch(() => { screenReported = false; });
    }, 400);
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- 啟動 ----------
  function boot() {
    document.title = (deviceName ? `${deviceName} · ` : '') + document.title;
    if (!deviceName || !deviceKey) { openSetup(false); return; }
    if (location.search) history.replaceState(null, '', BASE + '/play/'); // 參數已記住，網址收乾淨
    showBoot(`「${deviceName || deviceId}」連線中…`, SERVER_URL);
    logEvent('app.start', `網頁播放器啟動（${APP_VERSION}，${navigator.userAgent.slice(0, 80)}，${window.innerWidth}×${window.innerHeight}）`);
    syncLoop();
  }
  boot();
})();
