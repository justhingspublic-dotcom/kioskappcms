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
  const IDLE_RETURN_MS = 90_000;                                      // 下一頁沒人碰多久回展示（App IDLE_RETURN_MS）
  const RETRY_MS = 15_000;
  const STATION_ROTATE_MS = 10_000;
  const DEFAULT_PARK_API = 'https://joye.justhings.com.tw/api/telemetry/current'; // 園區資訊留白時 App 也用這個
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

  // ---------- 網址參數與機器身分 ----------
  const params = new URLSearchParams(location.search);
  // 機器名：網址 ?device= ＞ 這台瀏覽器記住的 ＞ 站台預設（.env PLAY_DEFAULT_DEVICE）。
  // 所有螢幕開同一個網址＝同一台機器、同一畫面（user 2026-09-10：網頁版不需要每面螢幕不同網址）；
  // 要讓某面螢幕顯示不同內容，第一次開時帶 ?device=名字，之後裸網址也記得。
  const LS_DEV = 'play.device:' + BASE;
  let deviceName = (params.get('device') || '').trim().slice(0, 64);
  try {
    if (deviceName) localStorage.setItem(LS_DEV, deviceName);
    else deviceName = localStorage.getItem(LS_DEV) || '';
  } catch { /* 無痕模式等 */ }
  if (!deviceName) deviceName = (document.body.dataset.defaultDevice || '').trim().slice(0, 64);
  const fresh = params.get('fresh') === '1';
  const LS_KEY = 'play.deviceKey:' + BASE;
  let deviceKey = (params.get('key') || '').trim();
  try {
    if (deviceKey) localStorage.setItem(LS_KEY, deviceKey);
    else deviceKey = localStorage.getItem(LS_KEY) || '';
  } catch { /* 無痕模式等 */ }
  const deviceId = (params.get('id') || '').trim().slice(0, 64) || (deviceName ? 'web-' + slug(deviceName) : '');
  const encId = encodeURIComponent(deviceId);
  const LS_VER = `play.lastVersion:${BASE}:${deviceId}`;

  // ---------- 狀態 ----------
  let lastVersion = 0;
  try { lastVersion = Number(localStorage.getItem(LS_VER)) || 0; } catch { /* ignore */ }
  let config = null;        // 最近一次套用的整份設定
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
  function showNotice(title, html) { $('noticeTitle').textContent = title; $('noticeBody').innerHTML = html; $('notice').hidden = false; hideBoot(); }
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
    showNotice('這台機器已從後台移除', `後台已刪除「${esc(deviceName || deviceId)}」，畫面已停止更新。<br>要重新登錄，請在網址加上 <code>&amp;fresh=1</code> 後重新載入。`);
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
          showNotice('連線金鑰不正確', `後台沒有接受這把金鑰。請到後台側欄「機器連線資訊」複製金鑰，網址改成<br><code>?device=${esc(deviceName)}&amp;key=金鑰</code> 後重新載入。`);
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
    const { version } = await api('GET', `/api/config/${encId}/version`);
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
    logEvent('sync.push', `已上傳初始設定（第 ${version} 版，網頁播放器）`);
    await pull(version);
  }

  async function pull(version) {
    const root = await api('GET', `/api/config/${encId}`);
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
  function screenSize() { return { w: window.innerWidth, h: window.innerHeight }; }
  async function reportScreenIfChanged() {
    if (screenReported) return;
    const s = config?.screen;
    const now = screenSize();
    if (!s || s.w !== now.w || s.h !== now.h) await report({});
    screenReported = true;
  }

  // ---------- 渲染 ----------
  const stage = $('stage');
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
    const next = el('div', 'page');
    const blocks = page.blocks || [];
    const SW = stage.clientWidth, SH = stage.clientHeight;
    const totalW = blocks.reduce((s, b) => s + (b.w || 1), 0) || 1;
    const splitChildPx = (px, node, second) => {
      const ratio = clamp(Number(node.ratio) || 0.5, 0.1, 0.9);
      const frac = second ? 1 - ratio : ratio;
      return node.dir === 'Horizontal' ? { w: px.w, h: Math.round(px.h * frac) } : { w: Math.round(px.w * frac), h: px.h };
    };
    if (!blocks.length) next.append(placeholder('尚未新增任何區塊'));
    blocks.forEach((block) => {
      const blockPx = { w: SW, h: Math.round((SH * (block.w || 1)) / totalW) };
      const b = el('div', 'block');
      b.style.flex = String((block.w || 1) / totalW);
      const node = block.node || { t: 'cell' };
      if (node.t === 'split') {
        const ratio = clamp(Number(node.ratio) || 0.5, 0.1, 0.9);
        b.style.flexDirection = node.dir === 'Vertical' ? 'row' : 'column';
        b.append(cellEl(node.a || {}, ratio, splitChildPx(blockPx, node, false)));
        b.append(cellEl(node.b || {}, 1 - ratio, splitChildPx(blockPx, node, true)));
      } else {
        b.append(cellEl(node, 1, blockPx));
      }
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
    // 園區資訊：標題＋「點我查看」（App ParkCellOverlay 同形）
    if (cell.content === 'ParkInfo' || cell.tap === 'OpenParkInfo') renderParkOverlay(c, cell, sizePx, fg);

    // ---- 點擊動作 ----
    if (cell.tap && cell.tap !== 'None') {
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
    root.querySelectorAll('.cell').forEach((c) => {
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
    const stationMode = cell.wSrc === 'Station';
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
      } else if (!cell.wStUrl) {
        renderHint('尚未填寫測站 API 網址');
      } else {
        const snap = getStations(cell.wStUrl);
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

  // ---------- 園區資訊格（App ParkCellOverlay／app.js renderParkOverlay 同一套規則，尺寸用真實像素） ----------
  function renderParkOverlay(c, cell, sizePx, fg) {
    const wrap = el('div', 'pv-park');
    const cta = cell.tap === 'OpenParkInfo';
    wrap._fit = () => {
      const w = c.offsetWidth || (sizePx && sizePx.w) || 1080;
      const h = c.offsetHeight || (sizePx && sizePx.h) || 200;
      const vertical = cta && (cell.parkLayout === 'Vertical' || (cell.parkLayout !== 'Horizontal' && w / h < 2.0));
      const s = vertical ? Math.max(0.5, Math.min(w / 300, h / 220, 1)) : Math.max(0.4, Math.min(w / 600, h / 90, 1));
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
        html += `<div class="pv-park-btn fx-${esc(cell.parkFx || 'Sweep')}" style="font-size:${u(28)};padding:${u(16)} ${u(20)} ${u(16)} ${u(28)};margin:${margin}">點我查看<span class="material-icons" style="font-size:${u(34)}">chevron_right</span></div>`;
      }
      wrap.innerHTML = html;
    };
    wrap._fit();
    c.append(wrap);
  }

  // ---------- 點擊動作與「下一頁」 ----------
  function onCellTap(cell) {
    if (cell.tap === 'OpenWeb') {
      const url = normalizeUrl(cell.tapUrl);
      if (!url) { toast('這一格還沒有設定要開啟的網址。'); return; }
      openWeb(url);
    } else if (cell.tap === 'OpenParkInfo') {
      openPark((cell.wStUrl || '').trim() || DEFAULT_PARK_API);
    } else if (cell.tap === 'OpenAssistant') {
      // TODO（第二階段）：AI 智能客服的網頁版；App 端是 AssistantScreen（JustAI 聊天）
      toast('AI 智能客服的網頁版即將推出。');
    }
  }

  let overlayIdle = 0;
  let overlayKind = '';
  function armIdle() {
    clearTimeout(overlayIdle);
    overlayIdle = setTimeout(() => closeOverlay(), IDLE_RETURN_MS);
  }
  document.addEventListener('pointerdown', () => { if (overlayKind) armIdle(); }, { capture: true, passive: true });
  function openOverlay(kind, title) {
    overlayKind = kind;
    $('ovTitle').textContent = title;
    $('ovBody').innerHTML = '';
    $('overlay').hidden = false;
    armIdle();
    logEvent('page.open', kind === 'web' ? `開啟網頁：${title}` : '開啟園區資訊');
  }
  function closeOverlay(silent) {
    if (!overlayKind) return;
    clearTimeout(overlayIdle);
    const kind = overlayKind; overlayKind = '';
    $('overlay').hidden = true;
    $('ovBody').innerHTML = '';
    if (parkTimer) { clearInterval(parkTimer); parkTimer = 0; }
    if (!silent) logEvent('page.close', kind === 'web' ? '關閉網頁，回到展示' : '關閉園區資訊，回到展示');
  }
  $('ovBack').addEventListener('click', () => {
    // 網頁：能退就退一頁（跨網域的 iframe 無法得知歷史，退不了就回展示）；園區資訊：直接回展示
    const f = $('ovBody').querySelector('iframe');
    if (overlayKind === 'web' && f && f._navigated) { try { f.contentWindow.history.back(); } catch { closeOverlay(); } f._navigated = false; return; }
    closeOverlay();
  });
  $('ovHome').addEventListener('click', () => closeOverlay());

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
  function openPark(apiUrl) {
    openOverlay('park', '園區資訊');
    const body = $('ovBody');
    const map = el('div', 'park-map');
    const img = document.createElement('img'); img.src = PARK_PRESET.map; img.alt = `${PARK_PRESET.name}園區導覽圖`;
    map.append(img);
    const panel = el('div', 'park-panel');
    body.append(map, panel);
    parkState = { apiUrl, selectedId: PARK_PRESET.nodes[0]?.id || '', map, panel };
    // 地圖：寬填滿、高依比例；超過可用高度的六成就改以高度定
    const avail = body.clientHeight;
    let mh = Math.round(body.clientWidth / PARK_PRESET.aspect);
    if (mh > avail * 0.62) mh = Math.round(avail * 0.62);
    map.style.height = `${mh}px`;
    PARK_PRESET.nodes.forEach((n) => {
      const m = el('div', 'park-marker');
      m.dataset.id = n.id;
      m.innerHTML = `<div class="halo"></div><div class="dot">${esc(n.id)}</div>`;
      m.addEventListener('click', () => { parkState.selectedId = n.id; refreshPark(); });
      map.append(m);
    });
    const place = () => {
      const W = map.clientWidth, H = map.clientHeight;
      let dw, dh;
      if (W / H > PARK_PRESET.aspect) { dh = H; dw = H * PARK_PRESET.aspect; } else { dw = W; dh = W / PARK_PRESET.aspect; }
      const left = (W - dw) / 2, top = (H - dh) / 2;
      map.querySelectorAll('.park-marker').forEach((m) => {
        const n = PARK_PRESET.nodes.find((x) => x.id === m.dataset.id);
        m.style.left = `${left + dw * n.x / 100}px`; m.style.top = `${top + dh * n.y / 100}px`;
      });
    };
    place();
    refreshPark();
    parkTimer = setInterval(refreshPark, 30_000);
  }
  function refreshPark() {
    if (!parkState || overlayKind !== 'park') return;
    const { apiUrl, selectedId, map, panel } = parkState;
    const snap = apiUrl ? getStations(apiUrl) : null;
    const readings = new Map((snap && !snap.error ? snap.stations : []).map((s) => [s.id, s]));
    map.querySelectorAll('.park-marker').forEach((m) => {
      const r = readings.get(m.dataset.id);
      const ring = r && r.online ? '#2E7D32' : '#9E9E9E';
      m.style.setProperty('--ring', ring);
      m.querySelector('.halo').style.background = ring;
      m.classList.toggle('selected', m.dataset.id === selectedId);
    });
    const node = PARK_PRESET.nodes.find((n) => n.id === selectedId);
    const r = node ? readings.get(node.id) : null;
    let hint = null;
    if (!apiUrl) hint = '尚未設定測站 API，地圖僅供導覽。';
    else if (!snap) hint = '取得測站資料中…';
    else if (snap.error) hint = '測站資料暫時無法取得。';
    else if (!r) hint = '這一站目前沒有回傳資料。';
    else if (!r.online) hint = '這一站目前離線。';
    const chip = r ? `<span class="park-chip" style="color:${r.online ? '#2E7D32' : '#9E9E9E'};border-color:${r.online ? 'rgba(46,125,50,.4)' : 'rgba(158,158,158,.4)'};background:${r.online ? 'rgba(46,125,50,.12)' : 'rgba(158,158,158,.12)'}"><span class="dot"></span>${r.online ? '在線' : '離線'}</span>` : '';
    let html = `<div class="park-panel-head"><div class="park-panel-title">${node ? `${esc(node.id)} ${esc(node.name)}` : '園區測站'}</div>${chip}</div>`;
    if (hint) html += `<div class="park-hint">${esc(hint)}</div>`;
    else {
      const m = (k, d, suf) => (k in r.values ? r.values[k].toFixed(d) + suf : '–');
      html += `<div class="park-metrics">` +
        `<div class="park-metric"><div class="v">${m('temperature', 1, '°')}</div><div class="k">溫度</div></div>` +
        `<div class="park-metric"><div class="v">${m('humidity', 0, '%')}</div><div class="k">濕度</div></div>` +
        `<div class="park-metric"><div class="v">${m('pm25', 0, '')}</div><div class="k">PM2.5</div></div>` +
        `<div class="park-metric"><div class="v">${m('daily_rainfall', 1, ' mm')}</div><div class="k">今日雨量</div></div></div>`;
      const t = String(r.receivedAt || ''); const i = t.indexOf('T');
      const clock = i >= 0 && t.length >= i + 6 ? t.slice(i + 1, i + 6) : t;
      if (clock) html += `<div class="park-updated">更新時間 ${esc(clock)}</div>`;
    }
    panel.innerHTML = html;
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
      if (on) closeOverlay(true);
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
    if (!deviceName && !deviceId) {
      showNotice('請在網址指定這面螢幕的機器名', `例如：<code>${esc(location.origin + BASE)}/play/?device=大廳&amp;key=連線金鑰</code><br>機器名會出現在後台「機器總覽」，這台瀏覽器之後會記住；金鑰在後台側欄「機器連線資訊」。<br>伺服器 .env 設了 PLAY_DEFAULT_DEVICE 的話，網址可以不帶機器名。`);
      return;
    }
    if (!deviceKey) {
      showNotice('請在網址帶上連線金鑰', `第一次開啟要帶 <code>&amp;key=連線金鑰</code>（後台側欄「機器連線資訊」可複製），之後瀏覽器會記住。<br>例如：<code>${esc(location.origin + BASE)}/play/?device=${esc(deviceName)}&amp;key=…</code>`);
      return;
    }
    showBoot(`「${deviceName || deviceId}」連線中…`, SERVER_URL);
    logEvent('app.start', `網頁播放器啟動（${APP_VERSION}，${navigator.userAgent.slice(0, 80)}，${window.innerWidth}×${window.innerHeight}）`);
    syncLoop();
  }
  boot();
})();
