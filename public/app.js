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
let wsMode = 'device';    // 工作區 modal 模式：'device'＝編輯某台機器；'shared'＝編輯共用版面
let sharedLayoutId = 0;   // wsMode='shared' 時正在編輯 shared.layouts 裡哪一個版面（id）

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
function logout() {
  token = '';
  sessionStorage.removeItem('token');
  // SPA 狀態全清：換帳號登入不能看到上一個帳號的快取（共用設定、客服清單、編輯中資料）
  state = null; deviceId = ''; selected = null; setDirty(false);
  shared = null; sharedLayoutId = 0; setSharedDirty(false);
  agentCache = { key: '', list: null, loading: false, error: '' };
  const m = $('wsModal');
  m.classList.remove('is-visible', 'is-closing', 'is-shared-mode');
  document.body.classList.remove('b-modal-lock');
  showLogin();
}

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
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '帳號或密碼錯誤');
    token = (await r.json()).token;
    sessionStorage.setItem('token', token);
    btn.classList.remove('is-loading');
    btn.classList.add('is-success');
    await new Promise((res) => setTimeout(res, 320));   // 等填滿（.3s）再切主畫面
    await enterMain();
    btn.classList.remove('is-success');                 // 還原，登出再進來是乾淨狀態
  } catch (e) {
    btn.classList.remove('is-loading');
    BToast.danger(e.message || '帳號或密碼錯誤');   // tiri 同款右下角 toast，取代頁內紅字
  }
});

$('logoutBtn').addEventListener('click', logout);
$('reloadBtn').addEventListener('click', async () => {
  if (!(await confirmDiscard())) return;
  if (wsMode === 'shared') resetSharedEditorState(); else loadConfig();
});
$('wsCloseBtn').addEventListener('click', exitWorkspace);
$('wsModal').addEventListener('click', (e) => { if (e.target === $('wsModal')) exitWorkspace(); });
// Esc 分層（上層先收，工作區最後）：下拉開著→dropdown.js 自己收；
// 對話框開著（BDialog capture 攔截、選機器對話框自己攔）→不動工作區；都沒有才關工作區。
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.b-dd.open')) return;
  if (document.querySelector('.b-modal-overlay[data-modal-vue].is-visible:not(#wsModal)')) return;
  if ($('wsModal').classList.contains('is-visible')) exitWorkspace();
});
document.querySelectorAll('.ws-tabs .seg').forEach((b) => {
  b.addEventListener('click', () => showWsTab(b.dataset.wstab));
});
// 標題旁小問號說明：hover/focus 展開走 CSS；這裡只補 Esc 暫時關閉（WAI tooltip 慣例：
// Esc 關但焦點留原地），重新 hover 或焦點離開就復原
document.querySelectorAll('.page-help').forEach((h) => {
  h.addEventListener('keydown', (e) => { if (e.key === 'Escape') h.classList.add('is-dismissed'); });
  h.addEventListener('pointerenter', () => h.classList.remove('is-dismissed'));
  h.addEventListener('focusout', () => h.classList.remove('is-dismissed'));
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
  switchView('devices'); // 首頁＝機器總覽列表，點一列進工作區
}

function openWsModal() {
  const m = $('wsModal');
  m.classList.toggle('is-shared-mode', wsMode === 'shared');
  m.classList.remove('is-closing');
  m.classList.add('is-visible');
  document.body.classList.add('b-modal-lock');
  $('saveBtn').textContent = wsMode === 'shared' ? '儲存版面' : '儲存並發布';
  // 儲存鈕位置依模式搬家：shared＝固定底部欄；device＝header（✕ 前面）
  if (wsMode === 'shared') $('wsFooter').appendChild($('saveBtn'));
  else m.querySelector('.ws-head-actions').insertBefore($('saveBtn'), $('wsCloseBtn'));
  if (window.lucide) lucide.createIcons();
  showWsTab('layout');
}

/** 從機器總覽點一列開啟該機器的工作區 modal（版面＋機器設定；tiri 開信件同款）。 */
async function enterWorkspace(d) {
  wsMode = 'device';
  deviceId = d.DeviceId;
  $('wsDeviceName').textContent = d.DeviceName || d.DeviceId;
  $('wsDeviceSub').textContent = d.DeviceId;
  openWsModal();
  await loadConfig();
}

/** 從版面設定清單點「編輯」開啟某個版面：同一套畫布編輯器，掛在虛擬 state 上。 */
function enterSharedLayoutEditor(layout) {
  wsMode = 'shared';
  sharedLayoutId = layout.id;
  deviceId = '';
  $('wsDeviceName').textContent = layout.name || '未命名版面';
  $('wsDeviceSub').textContent = '';
  openWsModal();
  resetSharedEditorState();
}

/** 目前在編輯器裡的那個版面（可能已被刪除 → null）。 */
function currentSharedLayout() {
  return (shared && shared.layouts || []).find((l) => l.id === sharedLayoutId) || null;
}

/** 版面 → 編輯器 state（deep copy，取消不汙染範本）；還沒設計過就給一頁空版面。 */
function resetSharedEditorState() {
  const layout = currentSharedLayout();
  state = {
    version: 0,
    config: {
      pages: layout && layout.pages
        ? JSON.parse(JSON.stringify(layout.pages))
        : [{ id: 1, name: '', blocks: [{ id: 1, w: 1, node: DEFAULT_CELL() }] }],
      activePage: 0,
      screen: (layout && layout.screen) || { w: 1080, h: 1920 },
    },
  };
  pageIndex = 0;
  selected = null;
  activePageTouched = false;
  setDirty(false);
  $('emptyState').classList.add('hidden');
  $('editor').classList.remove('hidden');
  render();
}

async function exitWorkspace() {
  if (!(await confirmDiscard())) return;
  setDirty(false);
  state = null;
  selected = null;
  const m = $('wsModal');
  m.classList.add('is-closing'); // 退場動畫（獨立 out keyframes；播完才真正隱藏）
  let closed = false;
  const fin = () => {
    if (closed) return;
    closed = true;
    m.classList.remove('is-visible', 'is-closing');
    document.body.classList.remove('b-modal-lock');
    if (wsMode === 'shared') renderSharedLayoutView(); // 範本狀態行要更新
    else renderDevicesView(); // 版本/狀態可能變了，回列表重整
  };
  m.addEventListener('animationend', function h(e) {
    if (e.target !== m) return;
    m.removeEventListener('animationend', h);
    fin();
  });
  setTimeout(fin, 250); // 後備：動畫被停用時仍會關閉
}

async function saveConfig() {
  if (wsMode === 'shared') return saveSharedLayout();
  return savePublish();
}

/** 共用版面：存回清單裡對應的版面（不發布到任何機器）。 */
async function saveSharedLayout() {
  const layout = currentSharedLayout();
  if (!layout) return setStatus('這個版面已被刪除，無法儲存', true);
  try {
    $('saveBtn').disabled = true;
    // deep copy：範本與編輯器不能共用同一份物件，否則存過一次後繼續編輯會「未存先改」汙染範本
    layout.pages = JSON.parse(JSON.stringify(state.config.pages));
    layout.screen = state.config.screen ? { ...state.config.screen } : null;
    layout.updatedAt = new Date().toISOString();
    await api('PUT', '/api/shared-settings', { settings: shared });
    setDirty(false);
    setStatus(`已儲存版面「${layout.name || '未命名版面'}」（到版面設定按「加入機器」才會發布）`);
    exitWorkspace(); // 儲存即完成 → 關閉編輯器回清單（2026-09-03 指示）；dirty 已清不會跳確認
  } catch (e) { setDirty(true); setStatus('儲存失敗：' + e.message, true); }
}

/** 工作區內的〔版面｜機器設定〕頁籤切換。 */
function showWsTab(tab) {
  document.querySelectorAll('.ws-tabs .seg').forEach((b) => {
    b.classList.toggle('active', b.dataset.wstab === tab);
  });
  $('layoutTab').classList.toggle('hidden', tab !== 'layout');
  $('settingsTab').classList.toggle('hidden', tab !== 'settings');
  if (tab === 'settings') renderSettingsView();
}

/** SPA 換頁 crossfade（kit 規範：抽換主內容純淡入 .12s）。 */
function spaFade() {
  const mc = document.querySelector('.main-content');
  mc.classList.remove('is-spa-entered');
  void mc.offsetWidth;
  mc.classList.add('is-spa-entered');
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

/** 機器模式的儲存並發布（共用版面模式另走 saveSharedLayout）。 */
async function savePublish() {
  try {
    $('saveBtn').disabled = true;
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
$('saveBtn').addEventListener('click', () => saveConfig());

function setDirty(v) { dirty = v; $('saveBtn').disabled = !v; }
function setStatus(msg, isErr) {
  if (window.BToast) (isErr ? BToast.danger : BToast.success)(msg);
}

// ---------- 共用 ----------
/** 進 innerHTML 的伺服器資料一律先跳脫（機器名/帳號名是自由輸入文字）。 */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
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
  if (!$('settingsTab').classList.contains('hidden')) renderSettingsView();
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

// 「在機器上展示此頁」鈕先拿掉（2026-09-03 指示）：activePageTouched 機制保留，
// 沒人設 true → 儲存永不送 activePage，機器維持自己目前顯示的頁；「展示中」badge 仍照雲端值顯示

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
  canvas.classList.toggle('is-landscape', SW > SH); // 橫式改以寬度定尺寸（CSS .is-landscape）
  const blocks = page().blocks;
  const totalW = blocks.reduce((s, b) => s + (b.w || 1), 0);
  const addFull = blocks.length >= MAX_BLOCKS;
  $('addBlockBtn').disabled = addFull;
  $('addBlockBtn').title = addFull ? `最多 ${MAX_BLOCKS} 個大區塊，已達上限` : '';

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
  panel.classList.remove('hidden');
  panel.classList.toggle('is-empty', !cell);
  // 內容顯示/切換淡入（kit SPA crossfade 的縮小版：重排 class 讓動畫每次重播）
  panel.classList.remove('is-faded');
  void panel.offsetWidth;
  panel.classList.add('is-faded');
  // 沒選格子＝滿高空狀態容器（2026-09-03：右欄不能空一大塊）
  if (!cell) {
    panel.innerHTML =
      '<div class="b-empty">' +
      '<span class="b-empty-icon"><i data-lucide="mouse-pointer-click"></i></span>' +
      '<p class="b-empty-title">尚未選擇格子</p>' +
      '<p class="b-empty-sub">點左邊預覽畫面上的任一格子，設定會顯示在這裡。</p>' +
      '</div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  const cellPx = cellPixelSizeOf(sel);
  // web 版不放「完成」鈕（2026-09-03 指示）：面板跟著選取走，點其他格子即切換
  const head = document.createElement('div');
  head.className = 'panel-head';
  const h3 = document.createElement('h3');
  h3.textContent = `${cellLabel(sel)}｜${cellPx.w}×${cellPx.h} px`;
  head.appendChild(h3);
  panel.appendChild(head);

  const body = document.createElement('div');
  body.className = 'body inspector';
  panel.appendChild(body);

  const refresh = () => { renderCanvas(); renderPanel(); };
  const touch = () => { setDirty(true); renderCanvas(); };

  // inspector 兩欄列（2026-09-03 定版：桌面檢查器式，label 左、控件右）；
  // sub＝主欄位展開的附屬列（例：內容選跑馬燈才出現的文字/速度）
  const insRow = (label, ...ctrls) => {
    const r = document.createElement('div');
    r.className = 'ins-row';
    const l = document.createElement('span');
    l.className = 'ins-label';
    l.textContent = label;
    const c = document.createElement('div');
    c.className = 'ins-ctrl';
    for (const el of ctrls) c.appendChild(el);
    r.append(l, c);
    body.appendChild(r);
    return r;
  };
  const subRow = (label, ...ctrls) => { const r = insRow(label, ...ctrls); r.classList.add('sub'); return r; };
  // 區段標題（版面/背景/內容/點擊動作）＝小標＋hairline 分隔線（2026-09-03：user 嫌全部混在一起沒區隔）
  const sec = (title) => {
    const h = document.createElement('div');
    h.className = 'ins-sec';
    h.textContent = title;
    body.appendChild(h);
  };
  // 區段的主控件列：不帶 label、佔滿整行（區段標題已說明是什麼；label 欄留給附屬列）
  const rowFull = (...ctrls) => {
    const r = document.createElement('div');
    r.className = 'ins-full';
    for (const el of ctrls) r.appendChild(el);
    body.appendChild(r);
    return r;
  };

  // ---- 版面（分割 / 合併 / 區塊操作；分割限制改掛按鈕 tooltip，不佔版面）----
  {
    const blocks = page().blocks;
    const ctrls = [];
    if (!sel.sub) {
      const limitTip = '每個大塊只能分割一次，子格不可再分割';
      const b1 = btn('上下分割', () => {
        blocks[sel.bi].node = { t: 'split', dir: 'Horizontal', ratio: 0.5, a: cell, b: DEFAULT_CELL() };
        selected = { bi: sel.bi, sub: 'a' }; setDirty(true); refresh();
      });
      const b2 = btn('左右分割', () => {
        blocks[sel.bi].node = { t: 'split', dir: 'Vertical', ratio: 0.5, a: cell, b: DEFAULT_CELL() };
        selected = { bi: sel.bi, sub: 'a' }; setDirty(true); refresh();
      });
      b1.title = limitTip; b2.title = limitTip;
      ctrls.push(b1, b2);
    } else {
      ctrls.push(btn('移除此格（合併）', () => {
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
      ctrls.push(del);
    }
    sec('版面');
    rowFull(...ctrls);
  }

  // ---- 背景（天氣格多一個「天氣背景」＝動畫天空）----
  {
    const isWeather = cell.content === 'Weather';
    const segs = [
      ['純色', !cell.wDynBg && cell.bg !== 'Image', () => { cell.bg = 'Solid'; cell.wDynBg = false; setDirty(true); refresh(); }],
      ['圖片', !cell.wDynBg && cell.bg === 'Image', () => { cell.bg = 'Image'; cell.wDynBg = false; setDirty(true); refresh(); }],
    ];
    if (isWeather) segs.push(['天氣背景', !!cell.wDynBg, () => { cell.wDynBg = true; setDirty(true); refresh(); }]);
    const extra = [];
    if (isWeather && cell.wDynBg) {
      extra.push(hint('依即時天氣顯示動畫天空（陽光、雲、雨絲…）；字色自動配置，深色天空白字、霧/雪黑字。'));
    } else if (cell.bg === 'Image') {
      extra.push(thumbList(cell, cellPx));
    } else {
      extra.push(swatchRow(BG_SWATCHES, cell.bgColor, false, (v) => { cell.bgColor = v; touch(); renderPanel(); }));
    }
    sec('背景');
    rowFull(segRow(segs), ...extra);
    if (!cell.wDynBg && cell.bg === 'Image') {
      subRow('每張秒數', numInput(cell.dur ?? 8, 3, 30, (v) => { cell.dur = v; touch(); }));
      subRow('顯示方式', selInput([['Crop', '填滿裁切'], ['Fit', '完整顯示']], cell.scale || 'Crop', (v) => { cell.scale = v; touch(); }));
    }
  }

  // ---- 內容 ----
  {
    sec('內容');
    rowFull(selInput(
      Object.entries(CONTENT_NAMES), cell.content || 'None',
      (v) => { cell.content = v; setDirty(true); refresh(); },
    ));
    if (cell.content === 'Marquee' || cell.content === 'Text') {
      const ta = document.createElement('textarea');
      ta.className = 'b-textarea';
      ta.value = cell.text || '';
      ta.placeholder = cell.content === 'Marquee' ? '跑馬燈文字' : '顯示文字';
      ta.addEventListener('input', () => { cell.text = ta.value; touch(); });
      subRow('文字', ta);
    }
    if (cell.content === 'Marquee') {
      const range = document.createElement('input');
      range.type = 'range'; range.min = 50; range.max = 300; range.step = 10;
      range.value = cell.mqSpeed ?? 100;
      const val = lbl(`${range.value}%`);
      range.addEventListener('input', () => { cell.mqSpeed = Number(range.value); val.textContent = `${range.value}%`; touch(); });
      subRow('速度', range, val);
    }
    if (cell.content === 'Weather') {
      subRow('位置', checkRow('自動偵測位置', cell.wAuto !== false, (v) => { cell.wAuto = v; setDirty(true); refresh(); }));
      if (cell.wAuto === false) {
        subRow('地點',
          txtInput(cell.wCounty, '縣市（例：臺北市）', (v) => { cell.wCounty = v; touch(); }),
          txtInput(cell.wDistrict, '區/鄉鎮（可留白）', (v) => { cell.wDistrict = v; touch(); }));
      }
    }
    if (cell.content === 'Web') {
      subRow('網址', txtInput(cell.web, '網頁網址 https://…', (v) => { cell.web = v; touch(); }, 'url'));
    }
    if (cell.content === 'Video') {
      const span = lbl(cell.video ? (isRemote(cell.video) ? '已上傳影片' : '機器本機影片') : '（尚未選擇）');
      subRow('影片', span, btn('上傳新影片', () => pickAndUpload('video/*', (url) => {
        cell.video = url; span.textContent = '已上傳影片'; touch();
      })));
    }
    if (['Marquee', 'Text', 'Weather'].includes(cell.content) && !(cell.content === 'Weather' && cell.wDynBg)) {
      subRow('文字顏色', swatchRow(TXT_SWATCHES, cell.txtColor, true, (v) => {
        if (v === null) delete cell.txtColor; else cell.txtColor = v;
        touch(); renderPanel();
      }));
    }
  }

  // ---- 點擊動作 ----
  {
    sec('點擊動作');
    rowFull(selInput(
      [['None', '無'], ['OpenWeb', '開啟網頁'], ['OpenAssistant', 'AI 智能客服']],
      cell.tap || 'None',
      (v) => { cell.tap = v; setDirty(true); refresh(); },
    ));
    if (cell.tap === 'OpenWeb') {
      subRow('網址', txtInput(cell.tapUrl, '點擊開啟的網址', (v) => { cell.tapUrl = v; touch(); }, 'url'));
    }
    if (cell.tap === 'OpenAssistant') {
      // 從清單選擇客服（與 App 的 AgentPickerField 相同）：用機器設定裡的 JustAI 帳號拉清單
      const cApi = chatApiConfigured();
      if (!cApi) {
        subRow('客服', hint('要從清單選擇客服，請先到「機器設定」填寫智能客服 API 帳號。'));
      } else {
        if (agentCache.key !== agentKeyOf(cApi)) fetchAgents(); // 帳號變過或還沒載入
        if (agentCache.loading) {
          subRow('客服', hint('載入客服清單中…'));
        } else if (agentCache.error) {
          subRow('客服', hint('清單載入失敗：' + agentCache.error), btn('重試', () => { fetchAgents(true); renderPanel(); }));
        } else if (agentCache.list) {
          const opts = [['', '（從清單選擇…）']];
          for (const a of agentCache.list) opts.push([a.id, a.name || a.id]);
          // 目前設定的 id 不在清單裡（手貼的）也顯示出來，避免看起來像沒選
          if (cell.agentId && !agentCache.list.some((a) => a.id === cell.agentId)) {
            opts.push([cell.agentId, cell.agentName || cell.agentId]);
          }
          subRow('客服', selInput(opts, cell.agentId || '', (v) => {
            const hit = agentCache.list.find((a) => a.id === v);
            cell.agentId = v;
            if (hit) cell.agentName = hit.name;
            else if (!v) cell.agentName = '';
            touch(); renderPanel();
          }));
        }
      }
      const idInput = txtInput(cell.agentId, '或直接貼上 Agent ID', (v) => {
        cell.agentId = v.trim(); cell.agentName = ''; touch();
      });
      idInput.title = 'JustAI 後台網址 chat.justhings.ai/agents/〔這一段〕/edit 就是 ID';
      subRow('Agent ID', idInput);
      subRow('介面', selInput(
        [['Kiosk', 'KIOSK展示模式'], ['Mobile', '手機操作模式']],
        cell.assistantLayout || 'Kiosk', (v) => { cell.assistantLayout = v; touch(); },
      ));
      const accentRow = subRow('主題色', swatchRow(ACCENT_SWATCHES, cell.agentAccent, true, (v) => {
        if (v === null) delete cell.agentAccent; else cell.agentAccent = v;
        touch(); renderPanel();
      }));
      accentRow.querySelector('.ins-label').title = '此格開啟的聊天頁主色（頭像、按鈕、游標）；「自動」使用預設綠色';
    }
  }

  if (window.BDropdown) BDropdown.init(panel); // 動態產生的下拉套 kit 樣式
}

// ---------- 面板小元件 ----------
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
  row.className = 'seg-row has-ind'; // has-ind＝active 底色改由滑動指示塊畫（ws-tabs 靜態版不吃）
  const ind = document.createElement('span');
  ind.className = 'seg-ind';
  row.appendChild(ind);
  const moveInd = () => {
    const a = row.querySelector('.seg.active');
    if (!a) { ind.style.opacity = '0'; return; }
    ind.style.opacity = '1';
    ind.style.left = a.offsetLeft + 'px';
    ind.style.top = a.offsetTop + 'px';
    ind.style.width = a.offsetWidth + 'px';
    ind.style.height = a.offsetHeight + 'px';
  };
  for (const [text, active, onClick] of items) {
    const b = document.createElement('button');
    b.className = 'seg' + (active ? ' active' : '');
    b.textContent = text;
    b.onclick = () => {
      if (b.classList.contains('active')) return;
      // 先在本地滑動指示塊（onClick 會重繪整個面板、DOM 重建就看不到動畫），滑完才套用
      row.querySelectorAll('.seg').forEach((s) => s.classList.remove('active'));
      b.classList.add('active');
      moveInd();
      setTimeout(onClick, 170);
    };
    row.appendChild(b);
  }
  // 入 DOM 排版完成後定位；首次不播動畫（先關 transition，下一幀恢復）
  ind.style.transition = 'none';
  requestAnimationFrame(() => {
    moveInd();
    requestAnimationFrame(() => { ind.style.transition = ''; });
  });
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

// ---------- 複製版面到其他機器 ----------
// 語意＝一次性複製（蓋過目標機器的版面）；目標機器自己的客服帳號、休眠、
// 展示頁與機器名都不動（伺服器 PUT 沒帶的欄位沿用舊值）。
$('copyLayoutBtn').addEventListener('click', async () => {
  if (!state) return;
  let devices;
  try { devices = await api('GET', '/api/devices'); } catch (e) { return setStatus(e.message, true); }
  const targets = devices.filter((d) => d.DeviceId !== deviceId);
  if (!targets.length) {
    return BDialog.alert({ title: '沒有其他機器', desc: '目前帳號下只有這一台機器，沒有可複製的對象。' });
  }
  // 抓每台的螢幕方向：直橫互套會整個變形，要標警告
  const src = state.config.screen;
  const srcPortrait = !src || src.h >= src.w;
  const infos = await Promise.all(targets.map(async (d) => {
    try {
      const cfg = await api('GET', `/api/config/${encodeURIComponent(d.DeviceId)}`);
      const scr = cfg.config.screen;
      return { d, portrait: !scr || scr.h >= scr.w };
    } catch { return { d, portrait: srcPortrait }; }
  }));
  const picked = await pickDevicesDialog({
    title: '複製版面到其他機器',
    desc: '會以目前畫面上的版面（含未發布的修改）覆蓋所選機器並立即發布；各機器自己的客服帳號、休眠時段與展示頁不受影響。',
    confirmText: '複製並發布',
    items: infos.map(({ d, portrait }) => ({ d, warn: portrait !== srcPortrait ? '⚠ 螢幕方向不同' : '' })),
  });
  if (!picked || !picked.length) return;
  await publishToDevices(picked, { pages: state.config.pages }, '複製');
});

/** 逐台 PUT 部分 config（伺服器淺合併，其他欄位不動）並回報結果。 */
async function publishToDevices(targets, partialConfig, verb) {
  let ok = 0;
  const failed = [];
  for (const d of targets) {
    try {
      await api('PUT', `/api/config/${encodeURIComponent(d.DeviceId)}`, { config: partialConfig });
      ok++;
    } catch { failed.push(d.DeviceName || d.DeviceId); }
  }
  if (failed.length) setStatus(`已${verb}到 ${ok} 台；失敗：${failed.join('、')}`, true);
  else setStatus(`已${verb}並發布到 ${ok} 台機器`);
}

/** 勾選目標機器的小對話框（BDialog 沒有多選，沿用 kit modal 樣式自建）。
 *  opts = { title, desc, confirmText, single, items: [{ d, warn }] } → resolve 選中的機器陣列或 null。 */
function pickDevicesDialog(opts) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'b-modal-overlay';
    overlay.setAttribute('data-modal-vue', '');   // 同 dialogs.js：別讓殼層 modal JS 接管
    overlay.setAttribute('data-modal-anim', 'vue');
    overlay.style.zIndex = '1600';

    const modal = document.createElement('div');
    modal.className = 'b-modal is-alert copy-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const body = document.createElement('div');
    body.className = 'b-alert-body';
    const h = document.createElement('h2');
    h.className = 'b-alert-title';
    h.textContent = opts.title;
    body.appendChild(h);
    if (opts.desc) {
      const p = document.createElement('p');
      p.className = 'b-alert-desc';
      p.textContent = opts.desc;
      body.appendChild(p);
    }

    const list = document.createElement('div');
    list.className = 'copy-list';
    const checks = [];
    for (const { d, warn } of opts.items) {
      const label = document.createElement('label');
      label.className = 'copy-item';
      const c = document.createElement('input');
      c.type = opts.single ? 'radio' : 'checkbox';
      if (opts.single) c.name = 'pick-device';
      checks.push([c, d]);
      const name = document.createElement('span');
      name.textContent = d.DeviceName || d.DeviceId;
      label.append(c, name);
      if (warn) {
        const w = document.createElement('span');
        w.className = 'copy-warn';
        w.textContent = warn;
        label.appendChild(w);
      }
      list.appendChild(label);
    }
    body.appendChild(list);

    const foot = document.createElement('div');
    foot.className = 'b-alert-foot';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'b-btn b-btn-quiet';
    cancel.textContent = '取消';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'b-btn b-btn-text';
    okBtn.textContent = opts.confirmText || '確定';
    foot.append(cancel, okBtn);

    modal.append(body, foot);
    overlay.appendChild(modal);

    let settled = false;
    function close(value) {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onEsc, true);
      overlay.classList.remove('is-open');
      let removed = false;
      const fin = (e) => {
        if (removed || (e && e.target !== overlay)) return;
        removed = true;
        overlay.remove();
        document.body.classList.remove('b-modal-lock');
      };
      overlay.addEventListener('transitionend', fin);
      setTimeout(fin, 200);
      resolve(value);
    }
    // Esc＝取消「最上層」（capture 攔截，同 dialogs.js 的慣例；別讓底下的工作區跟著關）
    function onEsc(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close(null);
    }
    document.addEventListener('keydown', onEsc, true);
    cancel.onclick = () => close(null);
    okBtn.onclick = () => close(checks.filter(([c]) => c.checked).map(([, d]) => d));
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === overlay) close(null);
    });

    document.body.appendChild(overlay);
    document.body.classList.add('b-modal-lock');
    // 兩段式淡入（同 dialogs.js）
    overlay.classList.add('is-visible');
    void overlay.offsetWidth;
    overlay.classList.add('is-open');
  });
}

// ---------- 智能客服清單（伺服器 proxy 代打 JustAI；瀏覽器直呼會被 CORS 擋） ----------
let agentCache = { key: '', list: null, loading: false, error: '' };
const agentKeyOf = (c) => `${c.baseUrl}|${c.email}|${c.password}`;

/** 填妥的 JustAI 帳號（機器模式＝該機的設定；共用版面模式＝共用設定）；沒填齊回傳 null。 */
function chatApiConfigured() {
  const c = wsMode === 'shared'
    ? (shared && shared.chatApi)
    : (state && state.config && state.config.chatApi);
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

/** 沒有欄位的物件才建立（只在使用者實際修改時呼叫，避免覆寫機器現值）。 */
function ensureChatApi(cfg) {
  return cfg.chatApi || (cfg.chatApi = { baseUrl: DEFAULT_CHAT_BASE, email: '', password: '' });
}
function ensureSleep(cfg) {
  return cfg.sleep ||
    (cfg.sleep = { enabled: false, sameEveryDay: false, experimentalSystemSleep: false, periods: [] });
}

/** 工作區「機器設定」頁籤：卡片繫到這台機器的 config。 */
function renderSettingsView() {
  const body = $('settingsBody');
  body.innerHTML = '';
  if (!state || !state.config) return; // 機器還沒上傳過設定：版面頁籤已顯示空狀態
  const ctx = { cfg: state.config, markDirty: () => setDirty(true), rerender: renderSettingsView };
  body.appendChild(chatApiCard(ctx));
  body.appendChild(sleepCard(ctx));
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

function chatApiCard(ctx) {
  return settingsCard('智能客服 API', '與機器上「設定 → 智能客服 API」相同；儲存發布後會同步到機器。', (g) => {
    const c = ctx.cfg.chatApi;
    g.appendChild(lbl('伺服器位址'));
    g.appendChild(txtInput(c ? c.baseUrl : DEFAULT_CHAT_BASE, DEFAULT_CHAT_BASE, (v) => {
      ensureChatApi(ctx.cfg).baseUrl = v.trim(); ctx.markDirty();
    }, 'url'));
    g.appendChild(lbl('Email'));
    g.appendChild(txtInput(c ? c.email : '', 'JustAI 帳號 Email', (v) => {
      ensureChatApi(ctx.cfg).email = v.trim(); ctx.markDirty();
    }));
    g.appendChild(lbl('密碼'));
    g.appendChild(txtInput(c ? c.password : '', 'JustAI 帳號密碼', (v) => {
      ensureChatApi(ctx.cfg).password = v; ctx.markDirty();
    }, 'password'));
    const row = document.createElement('div');
    row.className = 'row';
    row.appendChild(btn('測試連線並載入客服清單', () => testChatApi(ctx.cfg)));
    g.appendChild(row);
  });
}

async function testChatApi(holder) {
  const c = holder.chatApi;
  if (!c || !c.baseUrl || !c.email || !c.password) return setStatus('請先填妥伺服器位址、Email 與密碼', true);
  try {
    const list = await api('POST', '/api/justai/agents', { baseUrl: c.baseUrl, email: c.email, password: c.password });
    agentCache = { key: agentKeyOf(c), list, loading: false, error: '' };
    setStatus(`連線成功，載入 ${list.length} 個客服（可到機器版面的格子選用）`);
  } catch (e) { setStatus('連線失敗：' + e.message, true); }
}

function sleepCard(ctx) {
  return settingsCard('休眠時段', '休眠時停止播放並顯示黑畫面；儲存發布後同步到機器（機器按「開始展示」後套用）。', (g) => {
    const s = ctx.cfg.sleep || { enabled: false, sameEveryDay: false, periods: [] };
    g.appendChild(checkRow('啟用每週排程', !!s.enabled, (v) => {
      ensureSleep(ctx.cfg).enabled = v; ctx.markDirty(); ctx.rerender();
    }));
    g.appendChild(segRow([
      ['每日相同', !!s.sameEveryDay, () => {
        const sl = ensureSleep(ctx.cfg);
        const first = (sl.periods || []).slice().sort((a, b) => a.day - b.day)[0];
        const p = first ? { start: first.start, end: first.end } : DEFAULT_SLEEP_PERIOD();
        sl.sameEveryDay = true;
        sl.periods = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ day: d, start: p.start, end: p.end }));
        ctx.markDirty(); ctx.rerender();
      }],
      ['分星期設定', !s.sameEveryDay, () => { ensureSleep(ctx.cfg).sameEveryDay = false; ctx.markDirty(); ctx.rerender(); }],
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
          const sl = ensureSleep(ctx.cfg);
          sl.periods = sl.periods || [];
          if (c.checked) sl.periods.push({ day, ...DEFAULT_SLEEP_PERIOD() });
          else sl.periods = sl.periods.filter((p) => p.day !== day);
          ctx.markDirty(); ctx.rerender();
        };
        row.appendChild(c);
      }
      if (period) {
        const mkTime = (isStart) => {
          const t = document.createElement('input');
          t.type = 'time'; t.className = 'b-input sleep-time';
          t.value = minToTime(isStart ? period.start : period.end);
          t.onchange = () => updateSleepTime(ctx, day, isStart, timeToMin(t.value), !!s.sameEveryDay);
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

function updateSleepTime(ctx, day, isStart, minutes, applyToAll) {
  const sl = ensureSleep(ctx.cfg);
  for (const p of sl.periods || []) {
    if (applyToAll || p.day === day) { if (isStart) p.start = minutes; else p.end = minutes; }
  }
  ctx.markDirty(); ctx.rerender();
}

// ---------- 共用設定（側欄子選單兩頁：版面設定／機器設定；「套用」＝逐台發布部分 config） ----------
let shared = null;        // /api/shared-settings 的 settings 物件（登入帳號各一份）
let sharedDirty = false;

function setSharedDirty(v) { sharedDirty = v; $('sharedSaveBtn').disabled = !v; }

async function saveShared() {
  try {
    await api('PUT', '/api/shared-settings', { settings: shared || {} });
    setSharedDirty(false);
    setStatus('已儲存共用設定');
    return true;
  } catch (e) { setStatus('儲存失敗：' + e.message, true); return false; }
}
$('sharedSaveBtn').addEventListener('click', saveShared);
$('addSharedLayoutBtn').addEventListener('click', () => addSharedLayout());
$('applySharedSettingsBtn').addEventListener('click', () => applySharedSettings());

// 側欄「共用設定」群組開闔由 kit.js 的 submenu 手風琴接管（這裡不能再綁，會互相抵銷）

async function ensureSharedLoaded() {
  if (shared !== null) return true;
  try {
    shared = (await api('GET', '/api/shared-settings')).settings || {};
    migrateSharedLayouts();
    return true;
  } catch (e) { setStatus(String(e.message), true); return false; }
}

/** 舊格式（單一共用版面存在 shared.pages）→ 新格式（shared.layouts 清單）。
 *  新制一個版面＝一頁，舊範本的每一頁各拆成一個版面。
 *  只改記憶體，下一次任何儲存動作會一併寫回伺服器。 */
/** 版面的預設起始頁（跟編輯器的空版面相同：單一深色格）。 */
const DEFAULT_LAYOUT_PAGE = () => ({ id: 1, name: '', blocks: [{ id: 1, w: 1, node: DEFAULT_CELL() }] });

function migrateSharedLayouts() {
  if (!Array.isArray(shared.layouts)) shared.layouts = [];
  if (shared.pages) {
    shared.pages.forEach((p, i) => {
      shared.layouts.push({
        id: nextSharedLayoutId(),
        name: p.name || (i ? `共用版面 ${i + 1}` : '共用版面'),
        pages: [p],
        screen: shared.layoutScreen || null,
        updatedAt: shared.layoutUpdatedAt || null,
      });
    });
    delete shared.pages;
    delete shared.layoutScreen;
    delete shared.layoutUpdatedAt;
  }
  // 版面一律要有內容（新增當下就帶預設頁）：舊資料/中斷建立留下的空版面在這裡補上
  for (const l of shared.layouts) {
    if (!l.pages || !l.pages.length) {
      l.pages = [DEFAULT_LAYOUT_PAGE()];
      l.screen = l.screen || { w: 1080, h: 1920 };
      l.updatedAt = l.updatedAt || new Date().toISOString();
    }
  }
}

function nextSharedLayoutId() {
  return Math.max(0, ...(shared.layouts || []).map((l) => l.id || 0)) + 1;
}

/** 共用設定 › 版面設定頁：具名版面清單，逐列 編輯／加入機器／更名／刪除。 */
async function renderSharedLayoutView() {
  if (!(await ensureSharedLoaded())) return;
  const tb = $('sharedLayoutTable').querySelector('tbody');
  tb.innerHTML = '';
  if (!shared.layouts.length) {
    tb.innerHTML =
      '<tr><td colspan="3"><div class="b-empty">' +
      '<span class="b-empty-icon"><i data-lucide="layout-template"></i></span>' +
      '<p class="b-empty-title">還沒有任何版面</p>' +
      '<p class="b-empty-sub">點右上角「新增版面」開始設計，之後可以把版面加到任何機器。</p>' +
      '</div></td></tr>';
    if (window.lucide) lucide.createIcons();
    return;
  }
  for (const layout of shared.layouts) {
    const tr = document.createElement('tr');
    tr.className = 'device-row';
    const updated = layout.updatedAt ? new Date(layout.updatedAt).toLocaleString('zh-TW', { hour12: false }) : '';
    const nameTd = document.createElement('td');
    nameTd.className = 'b-th';
    const nameWrap = document.createElement('div');
    nameWrap.className = 'layout-name-wrap';
    nameWrap.appendChild(sharedLayoutThumb(layout));
    const nm = document.createElement('span');
    nm.textContent = layout.name || '未命名版面';
    nameWrap.appendChild(nm);
    nameTd.appendChild(nameWrap);
    tr.appendChild(nameTd);
    tr.insertAdjacentHTML('beforeend', `<td class="num">${updated}</td>`);

    const opTd = document.createElement('td');
    opTd.className = 'device-ops';
    const mkBtn = (cls, html, onclick) => {
      const b = document.createElement('button');
      b.className = cls; b.innerHTML = html; b.onclick = onclick;
      opTd.appendChild(b);
      return b;
    };
    mkBtn('b-btn', '編輯', () => enterSharedLayoutEditor(layout));
    mkBtn('b-btn b-btn-primary', '加入機器', () => applySharedLayout(layout));
    mkBtn('b-btn', '更名', () => renameSharedLayout(layout));
    mkBtn('b-btn b-btn-danger-soft', '刪除', () => deleteSharedLayout(layout));
    tr.appendChild(opTd);
    // 列＝純資訊（同機器總覽 2026-09-03 指示）：不可點，入口只有操作鈕
    tb.appendChild(tr);
  }
  if (window.lucide) lucide.createIcons();
}

/** 版面小縮圖：照第一頁的區塊結構縮排（純色底色／第一張遠端底圖；比例照 screen，
 *  預設直式 9:16）。只畫結構不畫內容——夠認得出是哪個版面就好。 */
function sharedLayoutThumb(layout) {
  const box = document.createElement('div');
  box.className = 'layout-thumb';
  const scr = layout.screen && layout.screen.w > 0 && layout.screen.h > 0 ? layout.screen : { w: 1080, h: 1920 };
  box.style.width = Math.max(20, Math.min(100, Math.round(56 * (scr.w / scr.h)))) + 'px';
  const pg = layout.pages && layout.pages[0];
  if (!pg) { box.classList.add('is-blank'); return box; }
  const nodeEl = (node, flex) => {
    const el = document.createElement('div');
    el.style.flex = String(flex);
    if (node.t === 'split') {
      // dir=Horizontal＝水平分隔線（上下疊）→ column；Vertical＝左右並排 → row
      el.className = 'lt-split' + (node.dir === 'Horizontal' ? '' : ' lt-vert');
      const r = Math.min(0.9, Math.max(0.1, node.ratio || 0.5));
      el.appendChild(nodeEl(node.a, r));
      el.appendChild(nodeEl(node.b, 1 - r));
    } else {
      el.className = 'lt-cell';
      el.style.background = colorCss(node.bgColor);
      const img = node.bg === 'Image' && (node.bgImgs || []).find(isRemote);
      if (img) {
        el.style.backgroundImage = `url(${img})`;
        el.style.backgroundSize = node.scale === 'Fit' ? 'contain' : 'cover';
      }
    }
    return el;
  };
  for (const b of pg.blocks || []) box.appendChild(nodeEl(b.node, b.w || 1));
  return box;
}

/** 新增版面：取名 → 存進清單 → 直接開編輯器設計。 */
async function addSharedLayout() {
  if (!(await ensureSharedLoaded())) return;
  const name = await BDialog.prompt({
    title: '新增版面', desc: '為這個版面取個名字，方便之後挑選要加到哪些機器。',
    placeholder: '例如：週年慶活動', confirmText: '建立',
  });
  if (name === null) return;
  // 一建立就帶預設頁（單一深色格）＝編輯器打開看到的起始樣子，清單立即有縮圖與更新時間
  const layout = {
    id: nextSharedLayoutId(), name: name.trim() || `版面 ${nextSharedLayoutId()}`,
    pages: [DEFAULT_LAYOUT_PAGE()], screen: { w: 1080, h: 1920 },
    updatedAt: new Date().toISOString(),
  };
  shared.layouts.push(layout);
  try { await api('PUT', '/api/shared-settings', { settings: shared }); }
  catch (e) { shared.layouts.pop(); return setStatus('建立失敗：' + e.message, true); }
  renderSharedLayoutView();
  enterSharedLayoutEditor(layout);
}

async function renameSharedLayout(layout) {
  const name = await BDialog.prompt({
    title: '版面更名', value: layout.name || '', placeholder: '版面名稱', confirmText: '儲存',
  });
  if (name === null || !name.trim() || name.trim() === layout.name) return;
  const prev = layout.name;
  layout.name = name.trim();
  try { await api('PUT', '/api/shared-settings', { settings: shared }); }
  catch (e) { layout.name = prev; return setStatus('更名失敗：' + e.message, true); }
  renderSharedLayoutView();
}

async function deleteSharedLayout(layout) {
  const ok = await BDialog.confirm({
    title: `刪除版面「${layout.name || '未命名版面'}」？`,
    desc: '只刪除這裡的範本；已加到機器上的頁面不受影響。',
    variant: 'danger', confirmText: '刪除',
  });
  if (!ok) return;
  const idx = shared.layouts.indexOf(layout);
  if (idx < 0) return;
  shared.layouts.splice(idx, 1);
  try { await api('PUT', '/api/shared-settings', { settings: shared }); }
  catch (e) { shared.layouts.splice(idx, 0, layout); return setStatus('刪除失敗：' + e.message, true); }
  renderSharedLayoutView();
}

/** 把一個版面「加入」勾選的機器：頁面附加在該機現有頁面後面（不覆蓋），逐台發布。 */
async function applySharedLayout(layout) {
  if (!layout.pages || !layout.pages.length) return;
  let devices;
  try { devices = await api('GET', '/api/devices'); } catch (e) { return setStatus(e.message, true); }
  if (!devices.length) return BDialog.alert({ title: '沒有機器', desc: '目前帳號下沒有任何機器。' });
  const srcPortrait = !layout.screen || layout.screen.h >= layout.screen.w;
  const infos = await Promise.all(devices.map(async (d) => {
    try {
      const cfg = await api('GET', `/api/config/${encodeURIComponent(d.DeviceId)}`);
      const scr = cfg.config.screen;
      const pages = cfg.config.pages || [];
      const warns = [];
      if ((!scr || scr.h >= scr.w) !== srcPortrait) warns.push('⚠ 螢幕方向不同');
      if (pages.length + layout.pages.length > MAX_PAGES) warns.push(`⚠ 加入後超過 ${MAX_PAGES} 頁上限`);
      return { d, warn: warns.join('　'), pages };
    } catch { return { d, warn: '', pages: [] }; }
  }));
  const picked = await pickDevicesDialog({
    title: `把「${layout.name || '未命名版面'}」加入機器`,
    desc: '會把這個版面加成所選機器的新頁面（接在現有頁面後面）並立即發布；機器原有的頁面與設定都不會被改動。',
    confirmText: '加入並發布',
    items: infos,
  });
  if (!picked || !picked.length) return;

  let ok = 0;
  const failed = [];
  for (const d of picked) {
    const info = infos.find((i) => i.d === d);
    const existing = info ? info.pages : [];
    if (existing.length + layout.pages.length > MAX_PAGES) {
      failed.push(`${d.DeviceName || d.DeviceId}（超過 ${MAX_PAGES} 頁上限）`);
      continue;
    }
    // 頁面 id 在同一台機器的 config 裡要唯一 → 附加時重新編號；
    // 頁面沒取名就帶版面名，機器的頁籤/admin-pager 上才認得出來
    let nextId = Math.max(0, ...existing.map((p) => p.id || 0));
    const appended = JSON.parse(JSON.stringify(layout.pages))
      .map((p) => ({ ...p, id: ++nextId, name: p.name || layout.name || '' }));
    try {
      await api('PUT', `/api/config/${encodeURIComponent(d.DeviceId)}`, { config: { pages: [...existing, ...appended] } });
      ok++;
    } catch { failed.push(d.DeviceName || d.DeviceId); }
  }
  if (failed.length) setStatus(`已加入 ${ok} 台；失敗：${failed.join('、')}`, true);
  else setStatus(`已把「${layout.name || '未命名版面'}」加入 ${ok} 台機器並發布`);
}

/** 共用設定 › 機器設定頁：共用的客服帳號＋休眠卡片。 */
async function renderSharedSettingsView() {
  if (!(await ensureSharedLoaded())) return;
  const body = $('sharedBody');
  body.innerHTML = '';
  const ctx = { cfg: shared, markDirty: () => setSharedDirty(true), rerender: renderSharedSettingsView };
  body.appendChild(chatApiCard(ctx));
  body.appendChild(sleepCard(ctx));
  if (window.BDropdown) BDropdown.init(body);
}

async function applySharedSettings() {
  if (!shared.chatApi && !shared.sleep) return setStatus('請先填寫共用的客服帳號或休眠時段', true);
  if (sharedDirty && !(await saveShared())) return; // 先存檔，套用的內容＝存下來的內容
  let devices;
  try { devices = await api('GET', '/api/devices'); } catch (e) { return setStatus(e.message, true); }
  if (!devices.length) return BDialog.alert({ title: '沒有機器', desc: '目前帳號下沒有任何機器。' });
  const picked = await pickDevicesDialog({
    title: '套用共用設定到機器',
    desc: '會以共用的客服帳號與休眠時段覆蓋所選機器並立即發布；版面不受影響。',
    confirmText: '套用並發布',
    items: devices.map((d) => ({ d })),
  });
  if (!picked || !picked.length) return;
  const partial = {};
  if (shared.chatApi) partial.chatApi = shared.chatApi;
  if (shared.sleep) partial.sleep = shared.sleep;
  await publishToDevices(picked, partial, '套用');
}

// ---------- 側邊欄：功能切換（navbar 只放全局操作） ----------
function switchView(view) {
  document.querySelectorAll('.sidebar .nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  $('devicesView').classList.toggle('hidden', view !== 'devices');
  $('sharedLayoutView').classList.toggle('hidden', view !== 'sharedLayout');
  $('sharedSettingsView').classList.toggle('hidden', view !== 'sharedSettings');
  $('usersView').classList.toggle('hidden', view !== 'users');
  spaFade();
  if (view === 'devices') renderDevicesView();
  if (view === 'sharedLayout') renderSharedLayoutView();
  if (view === 'sharedSettings') renderSharedSettingsView();
  if (view === 'users') renderUsersView();
}
document.querySelectorAll('.sidebar .nav-item').forEach((b) => {
  b.addEventListener('click', () => switchView(b.dataset.view)); // 工作區是 modal，開著時側欄被遮罩擋住
});

// ---------- 機器總覽（首頁列表） ----------
/** 上線狀態文字：機器每 ~25 秒會回來掛長輪詢，60 秒內有露面就當在線。 */
function statusCell(d) {
  const td = document.createElement('td');
  const dot = document.createElement('span');
  const txt = document.createElement('span');
  if (d.LastSeenAgoSec == null) {
    dot.className = 'dev-dot off';
    txt.className = 'device-id-dim';
    txt.textContent = '—';
  } else if (d.LastSeenAgoSec < 60) {
    dot.className = 'dev-dot on';
    txt.textContent = '在線';
  } else {
    dot.className = 'dev-dot off';
    txt.className = 'device-id-dim';
    txt.textContent = `離線 ${agoText(d.LastSeenAgoSec)}`;
  }
  td.append(dot, txt);
  return td;
}
function agoText(sec) {
  if (sec < 90) return `${Math.round(sec)} 秒`;
  const m = sec / 60;
  if (m < 90) return `${Math.round(m)} 分鐘`;
  const h = m / 60;
  if (h < 36) return `${Math.round(h)} 小時`;
  return `${Math.round(h / 24)} 天`;
}

async function renderDevicesView() {
  const devices = await api('GET', '/api/devices');

  const tb = $('deviceTable').querySelector('tbody');
  tb.innerHTML = '';
  if (!devices.length) {
    // tiri 規範：空清單不留光禿表頭，換 b-empty 空狀態
    tb.innerHTML =
      '<tr><td colspan="5"><div class="b-empty">' +
      '<span class="b-empty-icon"><i data-lucide="monitor-off"></i></span>' +
      '<p class="b-empty-title">還沒有機器連上來</p>' +
      '<p class="b-empty-sub">在 kiosk 機器的 App 裡開啟「雲端同步」，機器會自動出現在這裡。</p>' +
      '</div></td></tr>';
    if (window.lucide) lucide.createIcons();
    return;
  }
  for (const d of devices) {
    const tr = document.createElement('tr');
    tr.className = 'device-row';
    const updated = d.UpdatedAt ? new Date(d.UpdatedAt).toLocaleString('zh-TW', { hour12: false }) : '';
    tr.innerHTML =
      `<td class="b-th">${esc(d.DeviceName || d.DeviceId)}</td>` +
      `<td class="device-id-dim">${esc(d.DeviceId)}</td>` +
      `<td class="num">${updated}</td>`;
    tr.appendChild(statusCell(d));
    // 「版本」「屬於（帳號分配）」欄先不放（2026-09-03 指示）；
    // 分配 API（PUT /api/devices/:id/owner）與後端過濾邏輯保留，之後要加回來只補 UI

    const opTd = document.createElement('td');
    opTd.className = 'device-ops';
    const manage = document.createElement('button');
    manage.className = 'b-btn'; manage.textContent = '內容管理';
    manage.onclick = () => enterWorkspace(d);
    opTd.appendChild(manage);
    // 刪除鈕先拿掉（2026-09-03 指示）；DELETE /api/devices API 仍在，之後要加回來直接補鈕
    tr.appendChild(opTd);
    // 整列點擊已移除（2026-09-03 指示）：列是純資訊，入口只有「內容管理」鈕
    tb.appendChild(tr);
  }
  // BDropdown.init 移除：表格裡已無 select（原本是「屬於」的分配下拉）
  if (window.lucide) lucide.createIcons();
}

// ---------- 帳號管理 ----------
async function renderUsersView() {
  const users = await api('GET', '/api/users');

  const utb = $('userTable').querySelector('tbody');
  utb.innerHTML = '';
  for (const u of users) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="b-th">${esc(u.Username)}</td><td>${esc(u.DisplayName || '')}</td>` +
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

// 新增帳號 modal：入口在頁首右上；必填（帳號＋密碼）沒填齊前送出鈕 disabled
function refreshAddUserSubmit() {
  $('addUserSubmit').disabled = !($('newUsername').value.trim() && $('newPassword').value);
}
$('addUserBtn').onclick = () => {
  $('addUserForm').reset();
  refreshAddUserSubmit();
  BModal.open('#addUserModal');
  $('newUsername').focus();
};
$('addUserForm').addEventListener('input', refreshAddUserSubmit);
// 關閉前確認：只要任一欄有輸入就先問過（✕/點遮罩/Esc 三個入口都走這裡）
async function closeAddUserModal() {
  const typed = $('newUsername').value || $('newPassword').value || $('newDisplayName').value;
  if (typed) {
    const ok = await BDialog.confirm({
      title: '有尚未送出的內容', desc: '捨棄剛剛輸入的內容嗎？', variant: 'danger', confirmText: '捨棄',
    });
    if (!ok) return;
  }
  BModal.close('#addUserModal');
}
$('addUserCloseBtn').addEventListener('click', closeAddUserModal);
$('addUserModal').addEventListener('click', (e) => { if (e.target === $('addUserModal')) closeAddUserModal(); });
// Esc：BDialog 開著時它自己在 capture 階段攔掉，不會走到這；防禦性再排除其他 vue modal
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('addUserModal').classList.contains('is-visible')) return;
  if (document.querySelector('.b-modal-overlay[data-modal-vue].is-visible:not(#addUserModal)')) return;
  closeAddUserModal();
});
$('addUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/users', {
      username: $('newUsername').value.trim(),
      password: $('newPassword').value,
      displayName: $('newDisplayName').value.trim(),
    });
    BModal.close('#addUserModal');
    BToast.success('已新增帳號。');
    renderUsersView();
  } catch (e2) { BToast.danger(e2.message); }   // 留在 modal 裡讓使用者改完重送
});

// ---------- 自動同步：機器（或其他人）發布新版時，網頁 5 秒內自動載入 ----------
setInterval(async () => {
  if (!token || !state || dirty || !deviceId) return;
  if (!$('wsModal').classList.contains('is-visible')) return;
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
