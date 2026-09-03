/* Kiosk 管理後台前端 — 視覺化版面編輯器。
 * 操作邏輯與機器上的 App 一致：畫布顯示整個版面，拖分隔線調大小，
 * 點格子在右側面板逐格設定。JSON 格式與 App 端 LayoutTree.kt 完全相同。 */
'use strict';

const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('token') || '';
let deviceId = '';
let state = null;         // { version, config: { pages:[...], activePage } }
let pageIndex = 0;
let selected = null;      // { bi, sub: null|'a'|'b' }
let dirty = false;
let activePageTouched = false; // 只有按過「在機器上展示此頁」才隨儲存送出 activePage
let meIsAdmin = false;

const MAX_BLOCKS = 3, MAX_PAGES = 8, MAX_IMAGES = 12;
const CONTENT_NAMES = { None: '無', Marquee: '跑馬燈', Weather: '天氣', Text: '文字', Web: '網頁', Video: '影片' };
const BG_SWATCHES = ['FF263238','FF37474F','FF1B5E20','FF2E6A43','FF0D47A1','FF4A148C','FFB71C1C','FFF57F17','FF00838F','FF5D4037','FF000000','FFFFFFFF'].map(h => parseInt(h, 16));
const TXT_SWATCHES = ['FFFFFFFF','FF000000','FFFFEB3B','FFFF9800','FFFF5252','FF69F0AE','FF40C4FF','FFE040FB','FFFFC107','FF80CBC4'].map(h => parseInt(h, 16));
// App AccentSwatches 同一組（客服聊天頁主題色；null = 預設綠）
const ACCENT_SWATCHES = ['FF2E6A43','FF1565C0','FF00695C','FF6A1B9A','FFAD1457','FFC62828','FFEF6C00','FF37474F'].map(h => parseInt(h, 16));
const DEFAULT_CHAT_BASE = 'https://chat-api.justhings.ai'; // App ChatApiConfig.DEFAULT_BASE_URL

const DEFAULT_CELL = () => ({
  t: 'cell', bg: 'Solid', bgColor: 4280693304 /* 0xFF263238 */, bgImgs: [], scale: 'Crop', dur: 8,
  content: 'None', mqSpeed: 100, video: '', web: '', text: '',
  wAuto: true, wCounty: '', wDistrict: '', wDynBg: false,
  tap: 'None', tapUrl: '', agentId: '', agentName: '', assistantLayout: 'Kiosk',
});

// ---------- API ----------
async function api(method, url, body, isForm) {
  const headers = { Authorization: 'Bearer ' + token };
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { logout(); throw new Error('請重新登入'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

// ---------- 登入 ----------
function showLogin() { $('loginView').classList.remove('hidden'); $('mainView').classList.add('hidden'); }
function showMain() { $('loginView').classList.add('hidden'); $('mainView').classList.remove('hidden'); }
function logout() { token = ''; sessionStorage.removeItem('token'); showLogin(); }

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  // 登入鈕填色動畫（tiri 版）：送出=慢速填 55%、成功=快速補滿再進場、失敗=縮回
  const btn = e.target.querySelector('.btn-login');
  btn.classList.add('is-loading');
  try {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('username').value, password: $('password').value }),
    });
    if (!r.ok) throw new Error();
    token = (await r.json()).token;
    sessionStorage.setItem('token', token);
    $('loginError').classList.add('hidden');
    btn.classList.remove('is-loading');
    btn.classList.add('is-success');
    await new Promise((res) => setTimeout(res, 320));   // 等填滿（.3s）再切主畫面
    await enterMain();
    btn.classList.remove('is-success');                 // 還原，登出再進來是乾淨狀態
  } catch {
    btn.classList.remove('is-loading');
    $('loginError').classList.remove('hidden');
  }
});

$('logoutBtn').addEventListener('click', logout);
$('reloadBtn').addEventListener('click', async () => { if (await confirmDiscard()) loadConfig(); });
$('deviceSelect').addEventListener('change', async () => {
  if (!(await confirmDiscard())) {
    $('deviceSelect').value = deviceId;
    if (window.BDropdown) BDropdown.refresh($('deviceSelect'));
    return;
  }
  deviceId = $('deviceSelect').value;
  loadConfig();
});

async function confirmDiscard() {
  if (!dirty) return true;
  return BDialog.confirm({
    title: '有尚未儲存的修改', desc: '捨棄這些修改嗎？', variant: 'danger', confirmText: '捨棄',
  });
}
window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

// ---------- 載入 / 儲存 ----------
async function enterMain() {
  showMain();
  const me = await api('GET', '/api/me');
  $('whoami').textContent = me.username;
  $('whoamiMenu').textContent = me.username;
  $('whoamiSub').textContent = me.isAdmin ? '管理員' : '一般帳號';
  meIsAdmin = !!me.isAdmin;
  $('usersNav').classList.toggle('hidden', !meIsAdmin);
  const devices = await refreshDeviceSelect();
  if (!devices.length) {
    $('editor').classList.add('hidden');
    $('emptyState').classList.remove('hidden');
    return;
  }
  deviceId = devices[0].DeviceId;
  await loadConfig();
}

/** 重抓機器清單並重建下拉選單（顯示名稱，沒名稱顯示編號）；保留目前選擇。 */
async function refreshDeviceSelect() {
  const devices = await api('GET', '/api/devices');
  const sel = $('deviceSelect');
  sel.innerHTML = '';
  if (!devices.length) {
    sel.innerHTML = '<option>（尚無機器）</option>';
    return devices;
  }
  for (const d of devices) {
    const o = document.createElement('option');
    o.value = d.DeviceId;
    o.textContent = `${d.DeviceName || d.DeviceId}（第 ${d.Version} 版）`;
    sel.appendChild(o);
  }
  if (devices.some((d) => d.DeviceId === deviceId)) sel.value = deviceId;
  if (window.BDropdown) BDropdown.refresh(sel);
  return devices;
}

async function loadConfig() {
  try {
    state = await api('GET', `/api/config/${encodeURIComponent(deviceId)}`);
    pageIndex = Math.min(state.config.activePage || 0, state.config.pages.length - 1);
    selected = null;
    activePageTouched = false;
    setDirty(false);
    $('emptyState').classList.add('hidden');
    $('editor').classList.remove('hidden');
    render();
  } catch (e) {
    $('editor').classList.add('hidden');
    $('emptyState').classList.remove('hidden');
    setStatus(String(e.message), true);
  }
}

async function saveConfig() {
  try {
    $('saveBtn').disabled = true;
    $('saveBtn2').disabled = true;
    // 沒按過「展示此頁」就不送 activePage，機器維持目前顯示的頁面（伺服器沿用舊值）
    const payload = { ...state.config };
    if (!activePageTouched) delete payload.activePage;
    const r = await api('PUT', `/api/config/${encodeURIComponent(deviceId)}`, { config: payload });
    state.version = r.version;
    activePageTouched = false;
    setDirty(false);
    setStatus(`已發布第 ${r.version} 版，機器將在一分鐘內更新`);
  } catch (e) { setDirty(true); setStatus('儲存失敗：' + e.message, true); }
}
$('saveBtn').addEventListener('click', saveConfig);
$('saveBtn2').addEventListener('click', saveConfig);

function setDirty(v) { dirty = v; $('saveBtn').disabled = !v; $('saveBtn2').disabled = !v; }
function setStatus(msg, isErr) {
  if (window.BToast) (isErr ? BToast.danger : BToast.success)(msg);
}

// ---------- 共用 ----------
const page = () => state.config.pages[pageIndex];
const colorCss = (n) => '#' + (Number(n ?? 4280693304) >>> 0).toString(16).padStart(8, '0').slice(2);
const isRemote = (uri) => /^https?:\/\//.test(uri) || uri.startsWith('/files/');

function getCell(sel) {
  const node = page().blocks[sel.bi]?.node;
  if (!node) return null;
  if (sel.sub) return node.t === 'split' ? node[sel.sub] : null;
  return node.t === 'cell' ? node : null;
}

/** 與 App cellPixelSize 相同：這一格在機器實體螢幕上佔的像素。 */
function cellPixelSizeOf(sel) {
  const scr = state.config.screen;
  const SW = scr && scr.w > 0 ? scr.w : 1080;
  const SH = scr && scr.h > 0 ? scr.h : 1920;
  const blocks = page().blocks;
  const total = blocks.reduce((s, b) => s + (b.w || 1), 0);
  let px = { w: SW, h: Math.round((SH * (blocks[sel.bi]?.w || 1)) / total) };
  const node = blocks[sel.bi]?.node;
  if (sel.sub && node?.t === 'split') {
    const ratio = Math.min(0.9, Math.max(0.1, node.ratio));
    const frac = sel.sub === 'a' ? ratio : 1 - ratio;
    px = node.dir === 'Horizontal'
      ? { w: px.w, h: Math.round(px.h * frac) }
      : { w: Math.round(px.w * frac), h: px.h };
  }
  return px;
}

function cellLabel(sel) {
  const base = `區塊 ${sel.bi + 1}`;
  if (!sel.sub) return base;
  const dir = page().blocks[sel.bi].node.dir;
  const names = dir === 'Vertical' ? ['左', '右'] : ['上', '下'];
  return `${base} · ${sel.sub === 'a' ? names[0] : names[1]}`;
}

// ---------- 整體渲染 ----------
function render() {
  renderTabs(); renderCanvas(); renderPanel();
  if (!$('settingsView').classList.contains('hidden')) renderSettingsView();
}

// ---------- 頁面分頁籤 ----------
function renderTabs() {
  const nav = $('pageTabs');
  nav.innerHTML = '';
  state.config.pages.forEach((p, i) => {
    const tab = document.createElement('div');
    tab.className = 'tab' + (i === pageIndex ? ' active' : '');
    const name = document.createElement('span');
    name.textContent = p.name || `頁面 ${i + 1}`;
    tab.appendChild(name);
    if ((state.config.activePage || 0) === i) {
      const b = document.createElement('span');
      b.className = 'badge'; b.textContent = '展示中';
      tab.appendChild(b);
    }
    const ren = document.createElement('button');
    ren.textContent = '✎'; ren.title = '重新命名';
    ren.onclick = async (e) => {
      e.stopPropagation();
      const v = await BDialog.prompt({ title: '頁面名稱', value: p.name || '', placeholder: `頁面 ${i + 1}` });
      if (v !== null && v !== undefined) { p.name = String(v).trim(); setDirty(true); renderTabs(); }
    };
    tab.appendChild(ren);
    if (state.config.pages.length > 1) {
      const del = document.createElement('button');
      del.textContent = '✕'; del.title = '刪除此頁';
      del.onclick = async (e) => {
        e.stopPropagation();
        const ok = await BDialog.confirm({
          title: `刪除「${p.name || `頁面 ${i + 1}`}」？`, desc: '這一頁的版面會一併刪除。',
          variant: 'danger', confirmText: '刪除',
        });
        if (!ok) return;
        state.config.pages.splice(i, 1);
        if ((state.config.activePage || 0) >= state.config.pages.length) state.config.activePage = state.config.pages.length - 1;
        pageIndex = Math.min(pageIndex, state.config.pages.length - 1);
        selected = null; setDirty(true); render();
      };
      tab.appendChild(del);
    }
    tab.onclick = () => { pageIndex = i; selected = null; render(); };
    nav.appendChild(tab);
  });
  if (state.config.pages.length < MAX_PAGES) {
    const add = document.createElement('button');
    add.className = 'add-page'; add.textContent = '＋ 新增頁面';
    add.onclick = () => {
      const nextId = Math.max(0, ...state.config.pages.map((p) => p.id || 0)) + 1;
      state.config.pages.push({ id: nextId, name: '', blocks: [{ id: 1, w: 1, node: DEFAULT_CELL() }] });
      pageIndex = state.config.pages.length - 1;
      selected = null; setDirty(true); render();
    };
    nav.appendChild(add);
  }
}

$('showPageBtn').addEventListener('click', () => {
  state.config.activePage = pageIndex;
  activePageTouched = true;
  setDirty(true); renderTabs();
  setStatus('已設定此頁為展示頁（記得儲存並發布）');
});

$('addBlockBtn').addEventListener('click', () => {
  const blocks = page().blocks;
  if (blocks.length >= MAX_BLOCKS) return setStatus(`最多 ${MAX_BLOCKS} 個大區塊`, true);
  blocks.push({ id: Math.max(0, ...blocks.map((b) => b.id || 0)) + 1, w: 1, node: DEFAULT_CELL() });
  setDirty(true); render();
});

// ---------- 畫布 ----------
function renderCanvas() {
  const canvas = $('canvas');
  previewTimers.forEach(clearInterval);
  previewTimers = [];
  canvas.innerHTML = '';
  // 用機器上報的真實螢幕比例畫預覽（沒有就用 9:16 直式）
  const scr = state.config.screen;
  const SW = scr && scr.w > 0 ? scr.w : 1080;
  const SH = scr && scr.h > 0 ? scr.h : 1920;
  canvas.style.aspectRatio = `${SW} / ${SH}`;
  const blocks = page().blocks;
  const totalW = blocks.reduce((s, b) => s + (b.w || 1), 0);
  $('addBlockBtn').disabled = blocks.length >= MAX_BLOCKS;

  // 與 App cellPixelSize 相同：格子的「實際機器像素」尺寸，顯示在右上角標籤
  const splitChildPx = (px, node, second) => {
    const ratio = Math.min(0.9, Math.max(0.1, node.ratio));
    const frac = second ? 1 - ratio : ratio;
    return node.dir === 'Horizontal'
      ? { w: px.w, h: Math.round(px.h * frac) }
      : { w: Math.round(px.w * frac), h: px.h };
  };

  blocks.forEach((block, bi) => {
    const blockPx = { w: SW, h: Math.round((SH * (block.w || 1)) / totalW) };
    const el = document.createElement('div');
    el.className = 'block';
    el.style.flex = String((block.w || 1) / totalW);
    const node = block.node;
    if (node.t === 'split') {
      el.style.flexDirection = node.dir === 'Vertical' ? 'row' : 'column';
      el.appendChild(cellDiv(node.a, { bi, sub: 'a' }, node.ratio, splitChildPx(blockPx, node, false)));
      el.appendChild(splitDivider(bi, node));
      el.appendChild(cellDiv(node.b, { bi, sub: 'b' }, 1 - node.ratio, splitChildPx(blockPx, node, true)));
    } else {
      el.appendChild(cellDiv(node, { bi, sub: null }, 1, blockPx));
    }
    canvas.appendChild(el);
    if (bi < blocks.length - 1) canvas.appendChild(blockDivider(bi));
  });
  requestAnimationFrame(fitPreview);
}

/**
 * 依格子實際像素大小套用字級與動畫，規則與 App 相同：
 * 跑馬燈字高 = 格高 55%、等速滑動（≈90dp/s 換算）；天氣字級 = min(格高比, 格寬比)；
 * 文字內容字級相對整個畫面寬（App 用固定 headlineMedium）。
 */
function fitPreview() {
  const canvas = $('canvas');
  const cw = canvas.getBoundingClientRect().width;
  if (!cw) return;
  canvas.querySelectorAll('.cell').forEach((el) => {
    const r = el.getBoundingClientRect();
    const h = r.height, w = r.width;

    const text = el.querySelector('.pv-text');
    if (text) { text.style.fontSize = `${cw * 0.07}px`; text.style.padding = `${cw * 0.04}px`; }

    const mq = el.querySelector('.pv-marquee span');
    if (mq) {
      mq.style.fontSize = `${h * 0.55}px`;
      const spanW = mq.offsetWidth;
      const pct = Math.max(Number(mq.dataset.speed || 100) / 100, 0.1);
      const speed = cw * 0.19 * pct; // App 為 90dp/s，約等於螢幕寬的 19%/秒
      if (mq._anim) mq._anim.cancel();
      mq._anim = mq.animate(
        [{ transform: `translateX(${w}px)` }, { transform: `translateX(${-spanW}px)` }],
        { duration: ((w + spanW) / speed) * 1000, iterations: Infinity, easing: 'linear' },
      );
    }

    const wx = el.querySelector('.pv-weather2');
    if (wx) {
      const temp = Math.min(h * 0.45, w * 0.14);
      const loc = Math.min(h * 0.26, w * 0.085);
      wx.style.padding = `0 ${h * 0.1}px`;
      const set = (sel, px) => wx.querySelectorAll(sel).forEach((n) => { n.style.fontSize = `${px}px`; });
      set('.pvw-loc', loc);
      set('.pvw-info', loc * 0.55);
      set('.pvw-temp', temp);
      set('.pvw-icon', temp * 0.82);
      set('.pvw-drop', loc * 0.6);
      set('.pvw-hint', h * 0.18);
      const locEl = wx.querySelector('.pvw-loc');
      if (locEl) locEl.style.marginBottom = `${h * 0.055}px`;
    }

  });
}

// ---------- 真實天氣（與 App 的 WeatherService 同一套：Open-Meteo，免金鑰，30 分鐘快取） ----------
const weatherCache = new Map(); // key -> { ts, info, loading }

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
// App skyColors() 的同一組配色
const SKY = {
  Sunny: ['#3A8DDE', '#9FD0F2'], Partly: ['#5B94C8', '#AECBE2'],
  Cloudy: ['#66788A', '#A3B1BD'], Unknown: ['#66788A', '#A3B1BD'],
  Fog: ['#8795A0', '#C0C9CF'], Rain: ['#37475A', '#64758A'],
  Storm: ['#202935', '#45556A'], Snow: ['#75899C', '#C8D8E4'],
};
const COND_ICON = {
  Sunny: 'wb_sunny', Partly: 'wb_cloudy', Cloudy: 'cloud', Unknown: 'wb_cloudy',
  Fog: 'dehaze', Rain: 'umbrella', Storm: 'thunderstorm', Snow: 'ac_unit',
};

async function jsonGet(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// App TaiwanLocations 的縣市中心座標（縣市名查天氣直接用座標，地名搜尋只用於鄉鎮）
const COUNTY_COORDS = {
  台北市: [25.04, 121.56], 新北市: [25.01, 121.46], 桃園市: [24.99, 121.30],
  台中市: [24.15, 120.67], 台南市: [23.00, 120.21], 高雄市: [22.62, 120.31],
  基隆市: [25.13, 121.74], 新竹市: [24.80, 120.97], 嘉義市: [23.48, 120.45],
  新竹縣: [24.84, 121.01], 苗栗縣: [24.56, 120.82], 彰化縣: [24.08, 120.54],
  南投縣: [23.91, 120.69], 雲林縣: [23.71, 120.43], 嘉義縣: [23.45, 120.26],
  屏東縣: [22.55, 120.55], 宜蘭縣: [24.75, 121.75], 花蓮縣: [23.99, 121.60],
  台東縣: [22.76, 121.14], 澎湖縣: [23.57, 119.58], 金門縣: [24.44, 118.32],
  連江縣: [26.15, 119.93],
};

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
      // 鄉鎮才走地名搜尋精修座標；搜不到就用縣市中心（與 App 相同的 fallback）
      try {
        const q = encodeURIComponent(district);
        const res = (await jsonGet(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=10&language=zh&format=json`)).results || [];
        const hit = res.find((r) => r.country_code === 'TW' && norm(r.admin1) === norm(county));
        if (hit) { lat = hit.latitude; lon = hit.longitude; }
      } catch { /* 用縣市中心即可 */ }
    }
  }
  const o = await jsonGet(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,weather_code' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=Asia%2FTaipei&forecast_days=1',
  );
  const d = new Date();
  const wk = '日一二三四五六'[d.getDay()];
  const daily = o.daily || {};
  const rnd = (v) => (v == null || Number.isNaN(v) ? '' : Math.round(v));
  return {
    location: label,
    date: `${d.getMonth() + 1}月${d.getDate()}日 週${wk}`,
    temp: rnd(o.current?.temperature_2m) === '' ? '' : `${rnd(o.current.temperature_2m)}°`,
    high: rnd(daily.temperature_2m_max?.[0]) === '' ? '' : `${rnd(daily.temperature_2m_max[0])}°`,
    low: rnd(daily.temperature_2m_min?.[0]) === '' ? '' : `${rnd(daily.temperature_2m_min[0])}°`,
    rain: rnd(daily.precipitation_probability_max?.[0]) === '' ? '' : `${rnd(daily.precipitation_probability_max[0])}%`,
    code: o.current?.weather_code ?? null,
  };
}

/** 取快取的天氣；沒有就在背景抓，抓到後重畫畫布。回傳 null = 抓取中，{error} = 失敗。 */
function getWeather(cell) {
  const auto = cell.wAuto !== false;
  const key = auto ? 'auto' : `${cell.wCounty}|${cell.wDistrict || ''}`;
  const hit = weatherCache.get(key);
  if (hit && hit.info && Date.now() - hit.ts < 30 * 60 * 1000) return hit.info;
  const mayRetry = !hit || (!hit.loading && Date.now() - (hit.lastTry || 0) > 60 * 1000);
  if (mayRetry) {
    weatherCache.set(key, { ...(hit || {}), loading: true, lastTry: Date.now() });
    fetchRealWeather(auto, cell.wCounty, cell.wDistrict)
      .then((info) => { weatherCache.set(key, { ts: Date.now(), info, loading: false, lastTry: Date.now() }); renderCanvas(); })
      .catch(() => {
        weatherCache.set(key, { ...(hit || {}), info: hit?.info || null, loading: false, error: true, lastTry: Date.now() });
        renderCanvas();
      });
  }
  if (hit?.info) return hit.info; // 過期但先顯示舊資料，背景更新
  if (hit?.error && !hit?.loading) return { error: true };
  return null;
}

/** 依背景亮度自動選黑/白字（與 App 的 auto contrast 行為一致）。 */
function autoTextColor(bg) {
  const n = Number(bg ?? 4280693304) >>> 0;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111111' : '#ffffff';
}

let previewTimers = [];

function cellDiv(cell, sel, flex, sizePx) {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.bi = sel.bi;
  el.dataset.sub = sel.sub || '';
  if (selected && selected.bi === sel.bi && selected.sub === sel.sub) el.classList.add('selected');
  el.style.flex = String(flex);
  el.style.background = colorCss(cell.bgColor);
  if (cell.bg === 'Image') {
    // 跟 App 的 ImageContent 一樣：多張輪播、每張停留 dur 秒、600ms 淡入淡出
    const imgs = (cell.bgImgs || []).filter(isRemote);
    if (imgs.length) {
      const size = cell.scale === 'Fit' ? 'contain' : 'cover';
      const mkLayer = (src) => {
        const l = document.createElement('div');
        l.className = 'pv-img-layer';
        l.style.backgroundImage = `url(${src})`;
        l.style.backgroundSize = size;
        return l;
      };
      const a = mkLayer(imgs[0]);
      el.appendChild(a);
      if (imgs.length > 1) {
        const b = mkLayer(imgs[1]);
        b.style.opacity = '0';
        el.appendChild(b);
        let idx = 0, front = a;
        previewTimers.push(setInterval(() => {
          idx = (idx + 1) % imgs.length;
          const back = front === a ? b : a;
          back.style.backgroundImage = `url(${imgs[idx]})`;
          back.style.opacity = '1';
          front.style.opacity = '0';
          front = back;
        }, Math.max(3, cell.dur || 8) * 1000));
      }
    } else if ((cell.bgImgs || []).length) el.style.background = '#333';
  }

  // 內容的真實預覽（字級規則與 App 相同：跑馬燈 = 格高 55%，天氣依格子長寬混算）
  const autoFg = cell.bg === 'Image' ? '#ffffff' : autoTextColor(cell.bgColor);
  const fg = cell.txtColor != null ? colorCss(cell.txtColor) : autoFg;
  if (cell.content === 'Text' && cell.text) {
    const t = document.createElement('div');
    t.className = 'pv-text'; t.textContent = cell.text; t.style.color = fg;
    el.appendChild(t);
  } else if (cell.content === 'Marquee' && cell.text) {
    const wrap = document.createElement('div');
    wrap.className = 'pv-marquee';
    const span = document.createElement('span');
    span.textContent = cell.text; span.style.color = fg;
    span.dataset.speed = cell.mqSpeed || 100;
    wrap.appendChild(span);
    el.appendChild(wrap);
  } else if (cell.content === 'Weather') {
    const w = document.createElement('div');
    w.className = 'pv-weather2';
    const dyn = !!cell.wDynBg;
    if (cell.wAuto === false && !cell.wCounty) {
      if (dyn) el.style.background = `linear-gradient(${SKY.Unknown[0]}, ${SKY.Unknown[1]})`;
      w.style.color = dyn ? '#ffffff' : fg;
      w.innerHTML = '<div class="pvw-hint">尚未選擇天氣地區</div>';
    } else {
      const info = getWeather(cell); // null = 抓取中，抓到後會自動重畫
      const kind = weatherKind(info?.code);
      if (dyn) {
        const glow = (kind === 'Sunny' || kind === 'Partly')
          ? 'radial-gradient(circle at 88% 5%, rgba(255,237,176,.55), transparent 42%),' : '';
        el.style.background = `${glow}linear-gradient(${SKY[kind][0]}, ${SKY[kind][1]})`;
      }
      // 動態天空時字色依天空決定：霧/雪黑字，其他白字（同 App weatherTextColor）
      const wfg = dyn ? (kind === 'Fog' || kind === 'Snow' ? '#111111' : '#ffffff') : fg;
      w.style.color = wfg;
      if (!info) {
        w.innerHTML = '<div class="pvw-hint">取得天氣資料中…</div>';
      } else if (info.error) {
        w.innerHTML = '<div class="pvw-hint">天氣資料暫時無法取得</div>';
      } else {
        const infoBits = [`<span style="opacity:.72">${info.date}</span>`];
        if (info.high || info.low) infoBits.push(`<span>${info.high || '–'} / ${info.low || '–'}</span>`);
        if (info.rain) infoBits.push(`<span class="material-icons pvw-drop" style="opacity:.72">water_drop</span><span>${info.rain}</span>`);
        w.innerHTML =
          `<div class="pvw-left">` +
          `<div class="pvw-loc">${info.location}</div>` +
          `<div class="pvw-info">${infoBits.join('<span style="opacity:.72"> · </span>')}</div>` +
          `</div>` +
          `<div class="pvw-right"><span class="material-icons pvw-icon">${COND_ICON[kind]}</span>` +
          `<span class="pvw-temp">${info.temp}</span></div>`;
      }
    }
    el.appendChild(w);
  } else if (cell.content === 'Video') {
    const v = document.createElement('div');
    v.className = 'pv-icon'; v.style.color = fg;
    v.innerHTML = `<span class="material-icons">play_circle</span> ${cell.video ? '影片' : '尚未選影片'}`;
    el.appendChild(v);
  } else if (cell.content === 'Web') {
    const v = document.createElement('div');
    v.className = 'pv-icon'; v.style.color = fg;
    let host = '';
    try { host = new URL(cell.web).host; } catch { host = cell.web || '未設定網址'; }
    v.innerHTML = `<span class="material-icons">language</span> ${host}`;
    el.appendChild(v);
  }

  // 右上角標籤：類型 · 實際像素尺寸（與 App 管理預覽的 CellChip 角標相同）
  const typeLabel = cell.content !== 'None' ? (CONTENT_NAMES[cell.content] || cell.content)
    : cell.bg === 'Image' ? '圖片背景' : '純色背景';
  const badge = document.createElement('div');
  badge.className = 'pv-size-badge';
  badge.innerHTML = `<span>${typeLabel} · ${sizePx ? `${sizePx.w}×${sizePx.h}` : ''}</span>` +
    (cell.tap && cell.tap !== 'None' ? '<span class="material-icons">open_in_new</span>' : '');
  el.appendChild(badge);

  el.onclick = () => { selected = sel; renderCanvas(); renderPanel(); };
  return el;
}

/**
 * 拖曳把手的共用行為：拖曳期間只直接改兩側元素的 flex（畫布不重畫，指標不會
 * 「斷手」），放開時才重畫一次定案。
 */
function attachDrag(el, isVertical, onDrag, onEnd) {
  el.addEventListener('pointerdown', (down) => {
    down.preventDefault();
    el.setPointerCapture(down.pointerId);
    el.classList.add('dragging');
    document.body.style.cursor = isVertical ? 'col-resize' : 'row-resize';
    const startPos = isVertical ? down.clientX : down.clientY;
    const move = (m) => onDrag((isVertical ? m.clientX : m.clientY) - startPos);
    const up = () => {
      el.classList.remove('dragging');
      document.body.style.cursor = '';
      el.removeEventListener('pointermove', move);
      onEnd();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up, { once: true });
    el.addEventListener('pointercancel', up, { once: true });
  });
}

/** 拖曳過程中即時更新每格右上角的實際像素數字（與 App 預覽一致）。 */
function updateBadges() {
  $('canvas').querySelectorAll('.cell').forEach((el) => {
    const sel = { bi: Number(el.dataset.bi), sub: el.dataset.sub || null };
    const px = cellPixelSizeOf(sel);
    const span = el.querySelector('.pv-size-badge span');
    if (span) span.textContent = span.textContent.replace(/\d+×\d+/, `${px.w}×${px.h}`);
  });
  if (selected) {
    const h3 = $('cellPanel').querySelector('.panel-head h3');
    if (h3) {
      const px = cellPixelSizeOf(selected);
      h3.textContent = h3.textContent.replace(/\d+×\d+ px/, `${px.w}×${px.h} px`);
    }
  }
}

/** 大區塊之間的把手：上下拖曳調整兩個區塊的高度比（兩塊合計不變）。 */
function blockDivider(i) {
  const el = document.createElement('div');
  el.className = 'h-divider major';
  el.title = '拖曳調整高度';
  el.addEventListener('pointerdown', () => {
    el._blocks = page().blocks;
    el._total = el._blocks.reduce((s, b) => s + (b.w || 1), 0);
    el._pair = (el._blocks[i].w || 1) + (el._blocks[i + 1].w || 1);
    el._start = el._blocks[i].w || 1;
    el._h = $('canvas').getBoundingClientRect().height;
  });
  attachDrag(el, false, (delta) => {
    const min = el._total * 0.08;
    const w1 = Math.min(el._pair - min, Math.max(min, el._start + (delta / el._h) * el._total));
    el._blocks[i].w = Math.round(w1 * 1000) / 1000;
    el._blocks[i + 1].w = Math.round((el._pair - w1) * 1000) / 1000;
    el.previousElementSibling.style.flex = String(el._blocks[i].w / el._total);
    el.nextElementSibling.style.flex = String(el._blocks[i + 1].w / el._total);
    setDirty(true);
    updateBadges();
  }, () => renderCanvas());
  return el;
}

/** 分割格之間的把手：沿分割方向拖曳調整兩格比例。 */
function splitDivider(bi, node) {
  const el = document.createElement('div');
  const vertical = node.dir === 'Vertical';
  el.className = (vertical ? 'v-divider' : 'h-divider') + ' minor';
  el.title = '拖曳調整比例';
  el.addEventListener('pointerdown', () => {
    const r = el.parentElement.getBoundingClientRect();
    el._size = vertical ? r.width : r.height;
    el._start = node.ratio;
  });
  attachDrag(el, vertical, (delta) => {
    node.ratio = Math.min(0.9, Math.max(0.1, el._start + delta / el._size));
    el.previousElementSibling.style.flex = String(node.ratio);
    el.nextElementSibling.style.flex = String(1 - node.ratio);
    setDirty(true);
    updateBadges();
  }, () => renderCanvas());
  return el;
}

// ---------- 右側單格設定面板 ----------
function renderPanel() {
  const panel = $('cellPanel');
  panel.innerHTML = '';
  const sel = selected;
  const cell = sel && getCell(sel);
  if (!cell) {
    panel.innerHTML = '<p class="hint" style="padding:20px">← 點左邊版面上的格子開始編輯</p>';
    return;
  }

  const cellPx = cellPixelSizeOf(sel);
  const head = document.createElement('div');
  head.className = 'panel-head';
  const h3 = document.createElement('h3');
  h3.textContent = `${cellLabel(sel)}｜${cellPx.w}×${cellPx.h} px`;
  head.appendChild(h3);
  const close = document.createElement('button');
  close.className = 'b-btn b-btn-sm'; close.textContent = '完成';
  close.onclick = () => { selected = null; renderCanvas(); renderPanel(); };
  head.appendChild(close);
  panel.appendChild(head);

  const body = document.createElement('div');
  body.className = 'body';
  panel.appendChild(body);

  const refresh = () => { renderCanvas(); renderPanel(); };
  const touch = () => { setDirty(true); renderCanvas(); };

  // ---- 版面（分割 / 合併 / 區塊操作）----
  body.appendChild(group('版面', (g) => {
    const row = document.createElement('div');
    row.className = 'row';
    const blocks = page().blocks;
    if (!sel.sub) {
      row.appendChild(btn('上下分割', () => {
        blocks[sel.bi].node = { t: 'split', dir: 'Horizontal', ratio: 0.5, a: cell, b: DEFAULT_CELL() };
        selected = { bi: sel.bi, sub: 'a' }; setDirty(true); refresh();
      }));
      row.appendChild(btn('左右分割', () => {
        blocks[sel.bi].node = { t: 'split', dir: 'Vertical', ratio: 0.5, a: cell, b: DEFAULT_CELL() };
        selected = { bi: sel.bi, sub: 'a' }; setDirty(true); refresh();
      }));
    } else {
      row.appendChild(btn('移除此格（合併）', () => {
        const other = sel.sub === 'a' ? 'b' : 'a';
        blocks[sel.bi].node = blocks[sel.bi].node[other];
        selected = { bi: sel.bi, sub: null }; setDirty(true); refresh();
      }));
    }
    if (blocks.length > 1) {
      const del = btn('刪除整個區塊', async () => {
        const ok = await BDialog.confirm({
          title: '刪除這個大區塊？', desc: '區塊內的設定會一併刪除。', variant: 'danger', confirmText: '刪除',
        });
        if (!ok) return;
        blocks.splice(sel.bi, 1);
        selected = null; setDirty(true); refresh();
      });
      del.classList.add('b-btn-danger-soft');
      row.appendChild(del);
    }
    g.appendChild(row);
    if (!sel.sub) g.appendChild(hint('子格不可再分割（每個大塊只能分割一次）。'));
  }));

  // ---- 背景（天氣格多一個「天氣背景」＝動畫天空）----
  body.appendChild(group('背景', (g) => {
    const isWeather = cell.content === 'Weather';
    const segs = [
      ['純色', !cell.wDynBg && cell.bg !== 'Image', () => { cell.bg = 'Solid'; cell.wDynBg = false; setDirty(true); refresh(); }],
      ['圖片', !cell.wDynBg && cell.bg === 'Image', () => { cell.bg = 'Image'; cell.wDynBg = false; setDirty(true); refresh(); }],
    ];
    if (isWeather) segs.push(['天氣背景', !!cell.wDynBg, () => { cell.wDynBg = true; setDirty(true); refresh(); }]);
    g.appendChild(segRow(segs));
    if (isWeather && cell.wDynBg) {
      g.appendChild(hint('依即時天氣顯示動畫天空（陽光、雲、雨絲…）；字色自動配置，深色天空白字、霧/雪黑字。'));
    } else if (cell.bg === 'Image') {
      g.appendChild(thumbList(cell, cellPx));
      const row = document.createElement('div');
      row.className = 'row';
      row.appendChild(lbl('每張秒數'));
      row.appendChild(numInput(cell.dur ?? 8, 3, 30, (v) => { cell.dur = v; touch(); }));
      row.appendChild(lbl('顯示方式'));
      row.appendChild(selInput([['Crop', '填滿裁切'], ['Fit', '完整顯示']], cell.scale || 'Crop', (v) => { cell.scale = v; touch(); }));
      g.appendChild(row);
    } else {
      g.appendChild(swatchRow(BG_SWATCHES, cell.bgColor, false, (v) => { cell.bgColor = v; touch(); renderPanel(); }));
    }
  }));

  // ---- 內容 ----
  body.appendChild(group('內容', (g) => {
    g.appendChild(selInput(
      Object.entries(CONTENT_NAMES), cell.content || 'None',
      (v) => { cell.content = v; setDirty(true); refresh(); },
    ));
    if (cell.content === 'Marquee' || cell.content === 'Text') {
      const ta = document.createElement('textarea');
      ta.className = 'b-textarea';
      ta.value = cell.text || '';
      ta.placeholder = cell.content === 'Marquee' ? '跑馬燈文字' : '顯示文字';
      ta.addEventListener('input', () => { cell.text = ta.value; touch(); });
      g.appendChild(ta);
    }
    if (cell.content === 'Marquee') {
      const row = document.createElement('div');
      row.className = 'row';
      row.appendChild(lbl('速度'));
      const range = document.createElement('input');
      range.type = 'range'; range.min = 50; range.max = 300; range.step = 10;
      range.value = cell.mqSpeed ?? 100;
      const val = lbl(`${range.value}%`);
      range.addEventListener('input', () => { cell.mqSpeed = Number(range.value); val.textContent = `${range.value}%`; touch(); });
      row.append(range, val);
      g.appendChild(row);
    }
    if (cell.content === 'Weather') {
      g.appendChild(checkRow('自動偵測位置', cell.wAuto !== false, (v) => { cell.wAuto = v; setDirty(true); refresh(); }));
      if (cell.wAuto === false) {
        const row = document.createElement('div');
        row.className = 'row';
        row.appendChild(txtInput(cell.wCounty, '縣市（例：臺北市）', (v) => { cell.wCounty = v; touch(); }));
        row.appendChild(txtInput(cell.wDistrict, '區/鄉鎮（可留白）', (v) => { cell.wDistrict = v; touch(); }));
        g.appendChild(row);
      }
    }
    if (cell.content === 'Web') {
      g.appendChild(txtInput(cell.web, '網頁網址 https://…', (v) => { cell.web = v; touch(); }, 'url'));
    }
    if (cell.content === 'Video') {
      const row = document.createElement('div');
      row.className = 'row';
      const span = lbl(cell.video ? (isRemote(cell.video) ? '已上傳影片' : '機器本機影片') : '（尚未選擇）');
      row.appendChild(span);
      row.appendChild(btn('上傳新影片', () => pickAndUpload('video/*', (url) => {
        cell.video = url; span.textContent = '已上傳影片'; touch();
      })));
      g.appendChild(row);
    }
    if (['Marquee', 'Text', 'Weather'].includes(cell.content) && !(cell.content === 'Weather' && cell.wDynBg)) {
      g.appendChild(lbl('文字顏色'));
      g.appendChild(swatchRow(TXT_SWATCHES, cell.txtColor, true, (v) => {
        if (v === null) delete cell.txtColor; else cell.txtColor = v;
        touch(); renderPanel();
      }));
    }
  }));

  // ---- 點擊動作 ----
  body.appendChild(group('點擊動作', (g) => {
    g.appendChild(selInput(
      [['None', '無'], ['OpenWeb', '開啟網頁'], ['OpenAssistant', 'AI 智能客服']],
      cell.tap || 'None',
      (v) => { cell.tap = v; setDirty(true); refresh(); },
    ));
    if (cell.tap === 'OpenWeb') {
      g.appendChild(txtInput(cell.tapUrl, '點擊開啟的網址', (v) => { cell.tapUrl = v; touch(); }, 'url'));
    }
    if (cell.tap === 'OpenAssistant') {
      // 從清單選擇客服（與 App 的 AgentPickerField 相同）：用機器設定裡的 JustAI 帳號拉清單
      const cApi = chatApiConfigured();
      if (!cApi) {
        g.appendChild(hint('要從清單選擇客服，請先到左側「機器設定」填寫智能客服 API 帳號。'));
      } else {
        if (agentCache.key !== agentKeyOf(cApi)) fetchAgents(); // 帳號變過或還沒載入
        if (agentCache.loading) {
          g.appendChild(hint('載入客服清單中…'));
        } else if (agentCache.error) {
          const row = document.createElement('div');
          row.className = 'row';
          row.appendChild(hint('客服清單載入失敗：' + agentCache.error));
          row.appendChild(btn('重試', () => { fetchAgents(true); renderPanel(); }));
          g.appendChild(row);
        } else if (agentCache.list) {
          const opts = [['', '（從清單選擇…）']];
          for (const a of agentCache.list) opts.push([a.id, a.name || a.id]);
          // 目前設定的 id 不在清單裡（手貼的）也顯示出來，避免看起來像沒選
          if (cell.agentId && !agentCache.list.some((a) => a.id === cell.agentId)) {
            opts.push([cell.agentId, cell.agentName || cell.agentId]);
          }
          g.appendChild(lbl('客服'));
          g.appendChild(selInput(opts, cell.agentId || '', (v) => {
            const hit = agentCache.list.find((a) => a.id === v);
            cell.agentId = v;
            if (hit) cell.agentName = hit.name;
            else if (!v) cell.agentName = '';
            touch(); renderPanel();
          }));
        }
      }
      g.appendChild(txtInput(cell.agentId, '或直接貼上 Agent ID', (v) => {
        cell.agentId = v.trim(); cell.agentName = ''; touch();
      }));
      g.appendChild(hint('JustAI 後台網址 chat.justhings.ai/agents/〔這一段〕/edit 就是 ID。'));
      const row2 = document.createElement('div');
      row2.className = 'row';
      row2.appendChild(lbl('介面'));
      row2.appendChild(selInput(
        [['Kiosk', 'KIOSK展示模式'], ['Mobile', '手機操作模式']],
        cell.assistantLayout || 'Kiosk', (v) => { cell.assistantLayout = v; touch(); },
      ));
      g.appendChild(row2);
      g.appendChild(lbl('客服主題色'));
      g.appendChild(hint('此格開啟的聊天頁主色（頭像、按鈕、游標）。「自動」使用預設綠色。'));
      g.appendChild(swatchRow(ACCENT_SWATCHES, cell.agentAccent, true, (v) => {
        if (v === null) delete cell.agentAccent; else cell.agentAccent = v;
        touch(); renderPanel();
      }));
    }
  }));

  if (window.BDropdown) BDropdown.init(panel); // 動態產生的下拉套 kit 樣式
}

// ---------- 面板小元件 ----------
function group(title, build) {
  const g = document.createElement('div');
  g.className = 'group';
  const h = document.createElement('h4');
  h.textContent = title;
  g.appendChild(h);
  build(g);
  return g;
}
function btn(text, onClick) {
  const b = document.createElement('button');
  b.className = 'b-btn b-btn-sm';
  b.textContent = text; b.onclick = onClick;
  return b;
}
function lbl(text) {
  const l = document.createElement('label');
  l.className = 'field-label';
  l.textContent = text;
  return l;
}
function hint(text) {
  const p = document.createElement('p');
  p.className = 'hint'; p.textContent = text;
  return p;
}
function segRow(items) {
  const row = document.createElement('div');
  row.className = 'seg-row';
  for (const [text, active, onClick] of items) {
    const b = document.createElement('button');
    b.className = 'seg' + (active ? ' active' : '');
    b.textContent = text; b.onclick = onClick;
    row.appendChild(b);
  }
  return row;
}
function selInput(options, value, onChange) {
  const s = document.createElement('select');
  s.className = 'b-select';
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v; o.textContent = label; o.selected = v === value;
    s.appendChild(o);
  }
  s.onchange = () => onChange(s.value);
  return s;
}
function numInput(value, min, max, onChange) {
  const i = document.createElement('input');
  i.className = 'b-input';
  i.type = 'number'; i.min = min; i.max = max; i.value = value;
  i.addEventListener('change', () => {
    const v = Math.min(max, Math.max(min, Number(i.value) || min));
    i.value = v; onChange(v);
  });
  return i;
}
function txtInput(value, placeholder, onChange, type = 'text') {
  const i = document.createElement('input');
  i.className = 'b-input';
  i.type = type; i.value = value ?? ''; i.placeholder = placeholder;
  i.addEventListener('input', () => onChange(i.value));
  return i;
}
function checkRow(text, checked, onChange) {
  const row = document.createElement('label');
  row.className = 'row';
  const c = document.createElement('input');
  c.type = 'checkbox'; c.checked = checked;
  c.addEventListener('change', () => onChange(c.checked));
  row.append(c, document.createTextNode(text));
  return row;
}
function swatchRow(colors, current, withAuto, onPick) {
  const row = document.createElement('div');
  row.className = 'swatches';
  if (withAuto) {
    const a = document.createElement('button');
    a.className = 'swatch auto' + (current == null ? ' active' : '');
    a.textContent = '自動';
    a.onclick = () => onPick(null);
    row.appendChild(a);
  }
  for (const c of colors) {
    const b = document.createElement('button');
    b.className = 'swatch' + (Number(current) === c ? ' active' : '');
    b.style.background = colorCss(c);
    b.onclick = () => onPick(c);
    row.appendChild(b);
  }
  return row;
}
function thumbList(cell, cellPx) {
  const box = document.createElement('div');
  box.className = 'thumbs';
  const redraw = () => {
    box.innerHTML = '';
    (cell.bgImgs || []).forEach((uri, i) => {
      const t = document.createElement('div');
      t.className = 'thumb';
      if (isRemote(uri)) {
        const img = document.createElement('img');
        img.src = uri; img.loading = 'lazy';
        t.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'local'; ph.textContent = '機器本機圖片';
        t.appendChild(ph);
      }
      const del = document.createElement('button');
      del.textContent = '✕';
      del.onclick = () => { cell.bgImgs.splice(i, 1); setDirty(true); renderCanvas(); redraw(); };
      t.appendChild(del);
      box.appendChild(t);
    });
    if ((cell.bgImgs || []).length < MAX_IMAGES) {
      const add = document.createElement('button');
      add.className = 'add-thumb'; add.textContent = '＋'; add.title = '上傳圖片';
      add.onclick = () => pickAndUpload('image/*', (url) => {
        (cell.bgImgs = cell.bgImgs || []).push(url);
        setDirty(true); renderCanvas(); redraw();
      }, async (file) => {
        // 與 App 相同的尺寸警告：圖片像素與此格在機器上的實際尺寸不符時先確認
        const dims = await imagePixelSizeOf(file);
        if (!dims || !cellPx || (dims.w === cellPx.w && dims.h === cellPx.h)) return true;
        return BDialog.confirm({
          title: '圖片與區塊尺寸不符',
          desc: `本區塊尺寸為 ${cellPx.w}×${cellPx.h} px，所選圖片尺寸為 ${dims.w}×${dims.h} px。` +
            '仍要上傳這張圖片嗎？（顯示時會依「顯示方式」設定縮放）',
          confirmText: '仍要上傳',
        });
      });
      box.appendChild(add);
    }
  };
  redraw();
  return box;
}

/** 讀取本機圖片檔的像素尺寸（等同 App 的 imagePixelSize，瀏覽器自動處理 EXIF 方向）。 */
function imagePixelSizeOf(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

function pickAndUpload(accept, onDone, beforeUpload) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = accept;
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    if (beforeUpload && !(await beforeUpload(f))) return;
    try {
      setStatus(`上傳中：${f.name} …`);
      const form = new FormData();
      form.append('file', f);
      const r = await api('POST', '/api/upload', form, true);
      onDone(r.url);
      setStatus('上傳完成（記得按「儲存並發布」）');
    } catch (e) { setStatus('上傳失敗：' + e.message, true); }
  };
  input.click();
}

// ---------- 智能客服清單（伺服器 proxy 代打 JustAI；瀏覽器直呼會被 CORS 擋） ----------
let agentCache = { key: '', list: null, loading: false, error: '' };
const agentKeyOf = (c) => `${c.baseUrl}|${c.email}|${c.password}`;

/** 機器設定裡填妥的 JustAI 帳號；沒填齊回傳 null。 */
function chatApiConfigured() {
  const c = state && state.config && state.config.chatApi;
  return c && c.baseUrl && c.email && c.password ? c : null;
}

async function fetchAgents(force) {
  const c = chatApiConfigured();
  if (!c) return;
  const key = agentKeyOf(c);
  if (!force && agentCache.key === key) return; // 已載入 / 載入中 / 失敗過都不重打
  agentCache = { key, list: null, loading: true, error: '' };
  try {
    const list = await api('POST', '/api/justai/agents', { baseUrl: c.baseUrl, email: c.email, password: c.password });
    agentCache = { key, list, loading: false, error: '' };
  } catch (e) {
    agentCache = { key, list: null, loading: false, error: e.message };
  }
  renderPanel();
}

// ---------- 機器設定（客服帳號、休眠時段；存進 config、按「儲存並發布」同步到機器） ----------
const SLEEP_DAY_LABELS = [[1, '週一'], [2, '週二'], [3, '週三'], [4, '週四'], [5, '週五'], [6, '週六'], [7, '週日']];
const DEFAULT_SLEEP_PERIOD = () => ({ start: 22 * 60, end: 8 * 60 }); // App SleepPeriod 預設 22:00–08:00
const minToTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const timeToMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return ((h || 0) * 60 + (m || 0)) % 1440; };

/** 沒同步過機器設定的舊 config 才建立欄位（只在使用者實際修改時呼叫，避免覆寫機器現值）。 */
function ensureChatApi() {
  return state.config.chatApi || (state.config.chatApi = { baseUrl: DEFAULT_CHAT_BASE, email: '', password: '' });
}
function ensureSleep() {
  return state.config.sleep ||
    (state.config.sleep = { enabled: false, sameEveryDay: false, experimentalSystemSleep: false, periods: [] });
}

function renderSettingsView() {
  const has = !!(state && state.config);
  $('settingsEmpty').classList.toggle('hidden', has);
  $('settingsBody').classList.toggle('hidden', !has);
  const opt = $('deviceSelect').selectedOptions[0];
  $('settingsDeviceName').textContent = has ? (opt ? opt.textContent : deviceId) : '—';
  if (!has) return;
  const body = $('settingsBody');
  body.innerHTML = '';
  body.appendChild(chatApiCard());
  body.appendChild(sleepCard());
  if (window.BDropdown) BDropdown.init(body);
}

function settingsCard(title, subtitle, build) {
  const card = document.createElement('div');
  card.className = 'b-card settings-card';
  const bodyEl = document.createElement('div');
  bodyEl.className = 'b-card-body';
  const h = document.createElement('h3');
  h.className = 'settings-card-title';
  h.textContent = title;
  bodyEl.appendChild(h);
  const g = document.createElement('div');
  g.className = 'group'; // 沿用格子面板的欄位樣式規格
  if (subtitle) g.appendChild(hint(subtitle));
  build(g);
  bodyEl.appendChild(g);
  card.appendChild(bodyEl);
  return card;
}

function chatApiCard() {
  return settingsCard('智能客服 API', '與機器上「設定 → 智能客服 API」相同；儲存發布後會同步到機器。', (g) => {
    const c = state.config.chatApi;
    g.appendChild(lbl('伺服器位址'));
    g.appendChild(txtInput(c ? c.baseUrl : DEFAULT_CHAT_BASE, DEFAULT_CHAT_BASE, (v) => {
      ensureChatApi().baseUrl = v.trim(); setDirty(true);
    }, 'url'));
    g.appendChild(lbl('Email'));
    g.appendChild(txtInput(c ? c.email : '', 'JustAI 帳號 Email', (v) => {
      ensureChatApi().email = v.trim(); setDirty(true);
    }));
    g.appendChild(lbl('密碼'));
    g.appendChild(txtInput(c ? c.password : '', 'JustAI 帳號密碼', (v) => {
      ensureChatApi().password = v; setDirty(true);
    }, 'password'));
    const row = document.createElement('div');
    row.className = 'row';
    row.appendChild(btn('測試連線並載入客服清單', testChatApi));
    g.appendChild(row);
  });
}

async function testChatApi() {
  const c = chatApiConfigured();
  if (!c) return setStatus('請先填妥伺服器位址、Email 與密碼', true);
  try {
    const list = await api('POST', '/api/justai/agents', { baseUrl: c.baseUrl, email: c.email, password: c.password });
    agentCache = { key: agentKeyOf(c), list, loading: false, error: '' };
    setStatus(`連線成功，載入 ${list.length} 個客服（可到版面上架的格子選用）`);
  } catch (e) { setStatus('連線失敗：' + e.message, true); }
}

function sleepCard() {
  return settingsCard('休眠時段', '休眠時停止播放並顯示黑畫面；儲存發布後同步到機器（機器按「開始展示」後套用）。', (g) => {
    const s = state.config.sleep || { enabled: false, sameEveryDay: false, periods: [] };
    g.appendChild(checkRow('啟用每週排程', !!s.enabled, (v) => {
      ensureSleep().enabled = v; setDirty(true); renderSettingsView();
    }));
    g.appendChild(segRow([
      ['每日相同', !!s.sameEveryDay, () => {
        const sl = ensureSleep();
        const first = (sl.periods || []).slice().sort((a, b) => a.day - b.day)[0];
        const p = first ? { start: first.start, end: first.end } : DEFAULT_SLEEP_PERIOD();
        sl.sameEveryDay = true;
        sl.periods = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ day: d, start: p.start, end: p.end }));
        setDirty(true); renderSettingsView();
      }],
      ['分星期設定', !s.sameEveryDay, () => { ensureSleep().sameEveryDay = false; setDirty(true); renderSettingsView(); }],
    ]));
    const days = s.sameEveryDay ? [[1, '每日']] : SLEEP_DAY_LABELS;
    for (const [day, label] of days) {
      const period = (s.periods || []).find((p) => p.day === day);
      const row = document.createElement('div');
      row.className = 'sleep-row';
      const name = lbl(label);
      name.classList.add('sleep-day');
      row.appendChild(name);
      if (!s.sameEveryDay) {
        const c = document.createElement('input');
        c.type = 'checkbox'; c.checked = !!period; c.title = '這一天要休眠';
        c.onchange = () => {
          const sl = ensureSleep();
          sl.periods = sl.periods || [];
          if (c.checked) sl.periods.push({ day, ...DEFAULT_SLEEP_PERIOD() });
          else sl.periods = sl.periods.filter((p) => p.day !== day);
          setDirty(true); renderSettingsView();
        };
        row.appendChild(c);
      }
      if (period) {
        const mkTime = (isStart) => {
          const t = document.createElement('input');
          t.type = 'time'; t.className = 'b-input sleep-time';
          t.value = minToTime(isStart ? period.start : period.end);
          t.onchange = () => updateSleepTime(day, isStart, timeToMin(t.value), !!s.sameEveryDay);
          return t;
        };
        row.appendChild(mkTime(true));
        row.appendChild(document.createTextNode('～'));
        row.appendChild(mkTime(false));
      }
      g.appendChild(row);
      if (period && period.start >= period.end) g.appendChild(hint('跨午夜，結束時間為隔日。'));
    }
  });
}

function updateSleepTime(day, isStart, minutes, applyToAll) {
  const sl = ensureSleep();
  for (const p of sl.periods || []) {
    if (applyToAll || p.day === day) { if (isStart) p.start = minutes; else p.end = minutes; }
  }
  setDirty(true); renderSettingsView();
}

// ---------- 側邊欄：功能切換（navbar 只放全局操作） ----------
function switchView(view) {
  const cur = document.querySelector('.sidebar .nav-item.active');
  const changed = !cur || cur.dataset.view !== view;
  document.querySelectorAll('.sidebar .nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  $('editorView').classList.toggle('hidden', view !== 'editor');
  $('settingsView').classList.toggle('hidden', view !== 'settings');
  $('devicesView').classList.toggle('hidden', view !== 'devices');
  $('usersView').classList.toggle('hidden', view !== 'users');
  // SPA 換頁 crossfade（kit 規範：抽換主內容純淡入 .12s）；同頁重點不重播
  if (changed) {
    const mc = document.querySelector('.main-content');
    mc.classList.remove('is-spa-entered');
    void mc.offsetWidth;   // 強制 reflow，讓動畫重觸發
    mc.classList.add('is-spa-entered');
  }
  if (view === 'settings') renderSettingsView();
  if (view === 'devices') renderDevicesView();
  if (view === 'users') renderUsersView();
}
document.querySelectorAll('.sidebar .nav-item').forEach((b) => {
  b.addEventListener('click', () => switchView(b.dataset.view));
});

// ---------- 機器管理 ----------
async function renderDevicesView() {
  const devices = await api('GET', '/api/devices');
  const users = meIsAdmin ? await api('GET', '/api/users') : [];

  const tb = $('deviceTable').querySelector('tbody');
  tb.innerHTML = '';
  for (const d of devices) {
    const tr = document.createElement('tr');
    const updated = d.UpdatedAt ? new Date(d.UpdatedAt).toLocaleString('zh-TW', { hour12: false }) : '';
    tr.innerHTML =
      `<td class="b-th">${d.DeviceName || d.DeviceId}</td>` +
      `<td class="device-id-dim">${d.DeviceId}</td>` +
      `<td class="num">第 ${d.Version} 版</td><td class="num">${updated}</td>`;

    const ownerTd = document.createElement('td');
    if (meIsAdmin) {
      const sel = document.createElement('select');
      sel.innerHTML = '<option value="">（未分配）</option>';
      for (const u of users) {
        const o = document.createElement('option');
        o.value = u.UserId; o.textContent = u.DisplayName ? `${u.Username}（${u.DisplayName}）` : u.Username;
        if (u.UserId === d.OwnerUserId) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = async () => {
        try {
          await api('PUT', `/api/devices/${encodeURIComponent(d.DeviceId)}/owner`, { userId: sel.value || null });
          setStatus('已更新機器分配');
        } catch (e) { setStatus(e.message, true); }
      };
      ownerTd.appendChild(sel);
    } else {
      ownerTd.textContent = d.OwnerName || '';
    }
    tr.appendChild(ownerTd);

    const opTd = document.createElement('td');
    opTd.style.textAlign = 'right';
    if (meIsAdmin) {
      const del = document.createElement('button');
      del.className = 'b-btn b-btn-danger-soft'; del.textContent = '刪除';   // 標準 36px，與同列下拉等高
      del.onclick = async () => {
        const ok = await BDialog.confirm({
          title: `刪除機器「${d.DeviceName || d.DeviceId}」的雲端資料？`,
          desc: '機器本身不受影響，重新開啟雲端同步會再上傳。',
          variant: 'danger', confirmText: '刪除',
        });
        if (!ok) return;
        try {
          await api('DELETE', `/api/devices/${encodeURIComponent(d.DeviceId)}`);
          setStatus('已刪除');
          const rest = await refreshDeviceSelect();
          if (deviceId === d.DeviceId) {
            deviceId = rest[0]?.DeviceId || '';
            if (deviceId) loadConfig();
          }
          renderDevicesView();
        } catch (e) { setStatus(e.message, true); }
      };
      opTd.appendChild(del);
    }
    tr.appendChild(opTd);
    tb.appendChild(tr);
  }
  if (window.BDropdown) BDropdown.init(tb);
}

// ---------- 帳號管理 ----------
async function renderUsersView() {
  const users = await api('GET', '/api/users');

  const utb = $('userTable').querySelector('tbody');
  utb.innerHTML = '';
  for (const u of users) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="b-th">${u.Username}</td><td>${u.DisplayName || ''}</td>` +
      `<td>${u.IsAdmin ? '<span class="b-badge brand">管理員</span>' : '<span class="b-badge neutral">一般</span>'}</td>` +
      `<td class="num">${u.DeviceCount}</td>`;
    const td = document.createElement('td');
    if (!u.IsAdmin) {
      const del = document.createElement('button');
      del.className = 'b-btn b-btn-danger-soft'; del.textContent = '刪除';   // 標準 36px，與機器管理表一致
      del.onclick = async () => {
        const ok = await BDialog.confirm({
          title: `刪除帳號 ${u.Username}？`, desc: '該帳號的機器會變回未分配。',
          variant: 'danger', confirmText: '刪除',
        });
        if (!ok) return;
        try { await api('DELETE', `/api/users/${u.UserId}`); renderUsersView(); }
        catch (e) { setStatus(e.message, true); }
      };
      td.appendChild(del);
    }
    tr.appendChild(td);
    utb.appendChild(tr);
  }
}

$('addUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/users', {
      username: $('newUsername').value.trim(),
      password: $('newPassword').value,
      displayName: $('newDisplayName').value.trim(),
    });
    $('newUsername').value = ''; $('newPassword').value = ''; $('newDisplayName').value = '';
    setStatus('帳號已建立');
    renderUsersView();
  } catch (e2) { setStatus(e2.message, true); }
});

// ---------- 自動同步：機器（或其他人）發布新版時，網頁 5 秒內自動載入 ----------
setInterval(async () => {
  if (!token || !state || dirty || !deviceId) return;
  if ($('editor').classList.contains('hidden')) return;
  try {
    const r = await api('GET', `/api/config/${encodeURIComponent(deviceId)}/version`);
    if (r.version === state.version) return;
    const keepPage = pageIndex, keepSel = selected;
    state = await api('GET', `/api/config/${encodeURIComponent(deviceId)}`);
    pageIndex = Math.min(keepPage, state.config.pages.length - 1);
    selected = keepSel && getCell(keepSel) ? keepSel : null;
    render();
    setStatus(`機器上有新修改，已自動載入（第 ${state.version} 版）`);
  } catch { /* 網路暫時異常就等下一輪 */ }
}, 5000);

// ---------- 啟動 ----------
(token ? enterMain().catch(showLogin) : Promise.resolve(showLogin()));
