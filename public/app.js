/* Kiosk 管理後台前端 — 視覺化版面編輯器。
 * 操作邏輯與機器上的 App 一致：畫布顯示整個版面，拖分隔線調大小，
 * 點格子在右側面板逐格設定。JSON 格式與 App 端 LayoutTree.kt 完全相同。 */
'use strict';

const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('token') || '';
let deviceId = '';
let wsDevName = ''; // 進工作區時機器列表上的名稱（config 沒帶 deviceName 時的後備）
let state = null;         // { version, config: { pages:[...], activePage } }
let pageIndex = 0;
let selected = null;      // { bi, sub: null|'a'|'b' }
let dirty = false;
let activePageTouched = false; // 只有按過「在機器上展示此頁」才隨儲存送出 activePage
let meIsAdmin = false;
let wsMode = 'device';    // 工作區 modal 模式：'device'＝編輯某台機器；'shared'＝編輯共用版面
let sharedLayoutId = 0;   // wsMode='shared' 時正在編輯 shared.layouts 裡哪一個版面（id）

const MAX_BLOCKS = 3, MAX_PAGES = 8, MAX_IMAGES = 12;
const CONTENT_NAMES = { None: '無', Marquee: '跑馬燈', Weather: '天氣', Text: '文字', Web: '網頁', Video: '影片', ParkInfo: '園區資訊' };
const PARK_API = 'https://joye.justhings.com.tw/api/telemetry/current'; // 園區資訊留白時 App 也用這個
const BG_SWATCHES = ['FF263238','FF37474F','FF1B5E20','FF2E6A43','FF0D47A1','FF4A148C','FFB71C1C','FFF57F17','FF00838F','FF5D4037','FF000000','FFFFFFFF'].map(h => parseInt(h, 16));
const TXT_SWATCHES = ['FFFFFFFF','FF000000','FFFFEB3B','FFFF9800','FFFF5252','FF69F0AE','FF40C4FF','FFE040FB','FFFFC107','FF80CBC4'].map(h => parseInt(h, 16));
// App AccentSwatches 同一組（客服聊天頁主題色；null = 預設綠）
const ACCENT_SWATCHES = ['FF2E6A43','FF1565C0','FF00695C','FF6A1B9A','FFAD1457','FFC62828','FFEF6C00','FF37474F'].map(h => parseInt(h, 16));
const DEFAULT_CHAT_BASE = 'https://chat-api.justhings.ai'; // App ChatApiConfig.DEFAULT_BASE_URL

const DEFAULT_CELL = () => ({
  t: 'cell', bg: 'Solid', bgColor: 4280693304 /* 0xFF263238 */, bgImgs: [], scale: 'Crop', dur: 8, bgBlur: 0,
  content: 'None', mqSpeed: 100, txtSize: 100, glow: false, edgeFade: false, video: '', web: '', text: '',
  wAuto: true, wCounty: '', wDistrict: '', wDynBg: false,
  tap: 'None', tapUrl: '', parkFx: 'Sweep', parkLayout: 'Auto', agentId: '', agentName: '', assistantLayout: 'Kiosk',
});
// App ParkCtaStyle：「點我查看」按鈕的看板動態（None = 靜態）
const PARK_FX = [['None', '無'], ['Sweep', '光帶掃過'], ['Breathe', '呼吸縮放'], ['BorderRun', '邊框跑光'], ['ArrowNudge', '箭頭點動'], ['Pulse', '底色脈衝'], ['Shake', '週期抖動']];
// App ParkLayout：園區資訊標題與按鈕的排法（Auto = 寬不到高兩倍就直排）
const PARK_LAYOUT = [['Auto', '自動'], ['Horizontal', '橫排'], ['Vertical', '直排']];

// ---------- 子路徑（2026-09-08）----------
// 後台可掛在子路徑底下（正式站＝ https://justdisplay.justhings.com.tw/joye，根網址留給未來各後台的統一入口）。
// 伺服器端用 BASE_PATH 掛載；前端從目前網址推出前綴，所有根路徑（/api、/files）都要加上它。
const BASE = location.pathname.replace(/\/[^/]*$/, '');
/** 伺服器上的媒體路徑（/files/…）補上子路徑前綴；外部 http(s) 網址原樣。 */
const mediaSrc = (uri) => (typeof uri === 'string' && uri.startsWith('/files/') ? BASE + uri : uri);

// ---------- API ----------
// 錯誤文字口吻（2026-09-07 指示＝Apple 中性口吻）：句號結尾、不用驚嘆號、不責怪使用者、不出現技術字眼；
// api() 只丟「原因句」（請檢查…／請稍後再試…），toast 由呼叫端補主詞「無法○○。」再接原因。
const NET_ERROR = '目前無法連接伺服器。請檢查網路連線後再試一次。';
const GENERIC_ERROR = '請稍後再試一次。';
function reasonFor(status, serverMsg) {
  if (serverMsg) return serverMsg;
  switch (status) {
    case 403: return '你沒有權限進行這項操作。';
    case 404: return '找不到這個項目。';
    case 413: return '檔案太大，無法上傳。';
    default: return status >= 500 ? '伺服器暫時無法處理這項要求。請稍後再試一次。' : GENERIC_ERROR;
  }
}
async function api(method, url, body, isForm) {
  const headers = { Authorization: 'Bearer ' + token };
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(BASE + url, { method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  } catch { throw new Error(NET_ERROR); }
  if (res.status === 401) { logout(); throw new Error('登入已過期。請重新登入。'); }
  if (!res.ok) throw new Error(reasonFor(res.status, (await res.json().catch(() => ({}))).error));
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
  shared = null; sharedLayoutId = 0; setSharedDirty(false); clearTimeout(sharedSaveTimer);
  agentCache = { key: '', list: null, loading: false, error: '' };
  const m = $('wsModal');
  m.classList.remove('is-visible', 'is-closing', 'is-shared-mode');
  document.body.classList.remove('b-modal-lock');
  showLogin();
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  // 登入鈕填色動畫（tiri login.html 原版流程）：送出=is-loading 慢速填 55%、字改「登入中…」、
  // 至少爬 500ms（本機回應太快動畫才看得到）；成功=is-success 快速補滿、350ms 後進場並 toast「登入成功」；
  // 失敗=移除 is-loading 縮回、字還原、右下角 danger toast。填色中再按無效（tiri 同款防重送）。
  const btn = e.target.querySelector('.btn-login');
  const label = btn.querySelector('span');
  if (btn.classList.contains('is-loading')) return;
  btn.classList.add('is-loading');
  label.textContent = '登入中…';
  const started = Date.now();
  const minCrawl = () => new Promise((res) => setTimeout(res, Math.max(0, 500 - (Date.now() - started))));
  try {
    let r;
    try {
      r = await fetch(BASE + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('username').value, password: $('password').value }),
      });
    } catch { await minCrawl(); throw new Error('無法登入。目前無法連接伺服器，請檢查網路連線後再試一次。'); }
    if (!r.ok) { await minCrawl(); throw new Error((await r.json().catch(() => ({}))).error || '帳號或密碼不正確。'); }
    token = (await r.json()).token;
    sessionStorage.setItem('token', token);
    await minCrawl();
    btn.classList.add('is-success');                    // 疊在 is-loading 之上補滿（tiri 同款）
    await new Promise((res) => setTimeout(res, 350));   // 等填滿（.3s）再切主畫面
    await enterMain();
    btn.classList.remove('is-loading', 'is-success');   // 還原，登出再進來是乾淨狀態
    label.textContent = '登入';
    BToast.success('登入成功。');                         // tiri：登入後右下角 flash「登入成功」
  } catch (e) {
    btn.classList.remove('is-loading', 'is-success');   // 回基準 scaleX(0)，自帶縮回過渡
    label.textContent = '登入';
    BToast.danger(e.message || '帳號或密碼不正確。');   // tiri 同款右下角 toast，取代頁內紅字
  }
});

// 登入頁密碼眼睛（tiri login.html 同款：切 type、換 eye/eye-off、同步 aria）
$('loginPwEye').addEventListener('click', () => {
  const i = $('password'); const eye = $('loginPwEye');
  const show = i.type === 'password';
  i.type = show ? 'text' : 'password';
  eye.setAttribute('aria-pressed', show ? 'true' : 'false');
  eye.setAttribute('aria-label', show ? '隱藏密碼' : '顯示密碼');
  eye.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}" aria-hidden="true"></i>`;
  if (window.lucide) lucide.createIcons({ nodes: [eye] });
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
  await refreshMe();
  switchView(restoreView()); // 重新整理／重新登入回到原本那頁（網址 hash），沒有才回機器總覽
  loadConnInfo();
}
// 右上角顯示「名稱」（沒設就退回帳號）；下拉副標＝帳號・權限（2026-09-07 指示）
async function refreshMe() {
  const me = await api('GET', '/api/me');
  const shown = me.displayName || me.username;
  $('whoami').textContent = shown;
  $('whoamiMenu').textContent = shown;
  $('whoamiSub').textContent = `${me.username}・${me.isAdmin ? '管理員' : '一般帳號'}`;
  meIsAdmin = !!me.isAdmin;
  $('usersNav').classList.toggle('hidden', !meIsAdmin);
}

// ---------- 側欄底部「機器連線資訊」卡片 ----------
// 位址與金鑰都唯讀（金鑰是全機共用一把、只活在伺服器 .env；網頁上改會讓所有機器同時斷線，故不開放）。
let connInfo = null;
async function loadConnInfo() {
  const card = $('connCard');
  try {
    connInfo = await api('GET', '/api/connection-info');
  } catch { card.hidden = true; $('connMini').hidden = true; return; }   // 拿不到就整張不顯示，不擋登入流程
  $('connUrl').textContent = connInfo.serverUrl || '—';
  $('connUrl').title = connInfo.serverUrl || '';
  $('connKey').textContent = connInfo.deviceKey ? maskKey(connInfo.deviceKey) : '（伺服器尚未設定）';
  card.hidden = false;
  $('connMini').hidden = false;
}
/** 金鑰單行顯示、中間以 * 遮住（頭 6 尾 4）；複製仍是完整值。 */
function maskKey(k) {
  if (k.length <= 12) return k;
  return k.slice(0, 6) + '****' + k.slice(-4);
}
/** 內網多半走 http（非安全來源）沒有 navigator.clipboard，退回 execCommand。 */
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
// 側欄收合時：底部連線 icon → 右側 flyout（同 kit 子選單 flyout 的殼與進退場），底邊對齊按鈕
let connFlyout = null;
function closeConnFlyout() {
  if (!connFlyout) return;
  const f = connFlyout; connFlyout = null;
  $('connMiniBtn').classList.remove('is-open');
  $('connMiniBtn').setAttribute('aria-expanded', 'false');
  f.classList.add('flyout-leave-active', 'flyout-leave-to');
  setTimeout(() => f.remove(), 110);
}
/* 底邊對齊 icon 底邊、左緣離側欄 10px（同 kit flyout） */
function placeConnFlyout(f, btn) {
  const r = btn.getBoundingClientRect();
  f.style.left = (r.right + 10) + 'px';
  f.style.top = Math.max(8, r.bottom - f.offsetHeight) + 'px';
}
function openConnFlyout(btn) {
  if (connFlyout) { closeConnFlyout(); return; }
  if (!connInfo) return;
  const f = document.createElement('div');
  f.className = 'cms-flyout conn-flyout';
  const item = (label, value, key) =>
    '<div class="conn-item"><span class="conn-label">' + label + '</span><div class="conn-value-row">' +
    '<div class="conn-value">' + esc(value || '—') + '</div>' +
    '<button type="button" class="b-btn b-btn-text conn-copy" data-copy="' + key + '">複製</button></div></div>';
  f.innerHTML = '<div class="cms-flyout-title">機器連線資訊</div>' +
    item('伺服器位址', connInfo.serverUrl, 'url') +
    item('連線金鑰', connInfo.deviceKey ? maskKey(connInfo.deviceKey) : '（伺服器尚未設定）', 'key');
  f.classList.add('flyout-enter-active', 'flyout-enter-from');
  document.body.appendChild(f);
  placeConnFlyout(f, btn);
  requestAnimationFrame(() => f.classList.remove('flyout-enter-from'));
  btn.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true');
  connFlyout = f;
}
$('connMiniBtn').addEventListener('click', (e) => { e.stopPropagation(); openConnFlyout(e.currentTarget); });
document.addEventListener('click', (e) => {
  if (connFlyout && !e.target.closest('.conn-flyout') && !e.target.closest('.conn-mini-btn')) closeConnFlyout();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeConnFlyout(); });
window.addEventListener('resize', () => { if (connFlyout) placeConnFlyout(connFlyout, $('connMiniBtn')); });

document.addEventListener('click', async (e) => {
  const b = e.target.closest('.conn-copy');
  if (!b || !connInfo) return;
  const isUrl = b.dataset.copy === 'url';
  const text = isUrl ? connInfo.serverUrl : connInfo.deviceKey;
  if (!text) return BToast.danger('目前沒有可複製的內容。');
  const ok = await copyText(text);
  if (ok) BToast.success(isUrl ? '已複製伺服器位址。' : '已複製連線金鑰。');
  else BToast.danger('無法複製。請直接選取文字後手動複製。');
});

function openWsModal() {
  const m = $('wsModal');
  m.classList.toggle('is-shared-mode', wsMode === 'shared');
  m.classList.remove('is-closing');
  m.classList.add('is-visible');
  document.body.classList.add('b-modal-lock');
  $('saveBtn').textContent = wsMode === 'shared' ? '儲存版面' : '儲存並發布';
  // 儲存鈕兩種模式都在固定底部欄（2026-09-07 指示：device 模式也從 header 搬下來）
  $('wsFooter').appendChild($('saveBtn'));
  if (window.lucide) lucide.createIcons();
  showWsTab('layout', { instant: true }); // 剛開啟：指示塊直接就位不播滑動
}

/** 標題列〔版面｜機器設定〕的滑動指示塊定位（同 segRow 的 .seg-ind 作法）。 */
function moveWsTabInd(instant) {
  const row = document.querySelector('.ws-tabs');
  const ind = row && row.querySelector('.seg-ind');
  const a = row && row.querySelector('.seg.active');
  if (!ind || !a) return;
  const place = () => {
    ind.style.opacity = '1';
    ind.style.left = a.offsetLeft + 'px';
    ind.style.top = a.offsetTop + 'px';
    ind.style.width = a.offsetWidth + 'px';
    ind.style.height = a.offsetHeight + 'px';
  };
  if (!instant) return place();
  ind.style.transition = 'none';
  requestAnimationFrame(() => { place(); requestAnimationFrame(() => { ind.style.transition = ''; }); });
}
window.addEventListener('resize', () => { moveWsTabInd(true); const n = $('pageTabs'); if (n && n._updateArrows) n._updateArrows(); });

/** 從機器總覽點一列開啟該機器的工作區 modal（版面＋機器設定；tiri 開信件同款）。 */
let wsOpening = false;
async function enterWorkspace(d) {
  if (wsOpening) return; // 載入中重複點列不再發第二次請求
  wsOpening = true;
  wsMode = 'device';
  deviceId = d.DeviceId;
  wsDevName = d.DeviceName || d.DeviceId;
  try {
    // 先拉設定、成功才開 modal；連不上伺服器只留 toast，不開空的工作區（2026-09-07 指示）
    if (!(await fetchConfig())) return;
    $('wsDeviceName').textContent = wsDevName;
    $('wsDeviceSub').textContent = d.DeviceId;
    openWsModal();
    showEditor();
    startDeviceWatch();
  } finally { wsOpening = false; }
}

// ---------- 機器展示頁即時跟隨（2026-09-08 指示：展示鈕要自動判斷展示中）----------
// 工作區開著時掛在伺服器的 /wait 長輪詢（機器本身也是用這支等新版本），版本一變就抓回 activePage
// 更新展示鈕的實心／灰底狀態；只動 state.version 與 activePage，不碰畫布草稿（未發布的修改不會被蓋掉）。
// 離開工作區、換機器、登出都會讓迴圈停下（seq 不符或 state 清空）。
let watchSeq = 0;
function startDeviceWatch() {
  const seq = ++watchSeq;
  const id = deviceId;
  const pause = () => new Promise((r) => setTimeout(r, 5000));
  (async () => {
    while (seq === watchSeq && state && wsMode === 'device') {
      let version;
      try { version = (await api('GET', `/api/config/${encodeURIComponent(id)}/wait?version=${state.version}`)).version; }
      catch { await pause(); continue; }
      if (seq !== watchSeq || !state || version === state.version) continue;
      try {
        const cfg = await api('GET', `/api/config/${encodeURIComponent(id)}`);
        if (seq !== watchSeq || !state) return;
        state.version = cfg.version;
        const ap = cfg.config.activePage || 0;
        if (ap !== (state.config.activePage || 0)) { state.config.activePage = ap; updateShowPageBtn(); }
      } catch { await pause(); }
    }
  })();
}
function stopDeviceWatch() { watchSeq++; }

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
  stopDeviceWatch();
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
  if (!layout) return setStatus('無法儲存。這個版面已被刪除。', true);
  try {
    $('saveBtn').disabled = true;
    // deep copy：範本與編輯器不能共用同一份物件，否則存過一次後繼續編輯會「未存先改」汙染範本
    layout.pages = JSON.parse(JSON.stringify(state.config.pages));
    layout.screen = state.config.screen ? { ...state.config.screen } : null;
    layout.updatedAt = new Date().toISOString();
    await api('PUT', '/api/shared-settings', { settings: shared });
    setDirty(false);
    setStatus(`已儲存「${layout.name || '未命名版面'}」。若要發布到機器，請使用「加入機器」。`);
    exitWorkspace(); // 儲存即完成 → 關閉編輯器回清單（2026-09-03 指示）；dirty 已清不會跳確認
  } catch (e) { setDirty(true); setStatus('無法儲存版面。' + e.message, true); }
}

/** 工作區內的〔版面｜機器設定〕頁籤切換。 */
function showWsTab(tab, opts) {
  document.querySelectorAll('.ws-tabs .seg').forEach((b) => {
    b.classList.toggle('active', b.dataset.wstab === tab);
  });
  moveWsTabInd(!!(opts && opts.instant));
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

/** 只拉設定進 state，不碰畫面；失敗 toast 後回 false（開工作區前先呼叫，失敗就不開 modal）。 */
async function fetchConfig() {
  try {
    state = await api('GET', `/api/config/${encodeURIComponent(deviceId)}`);
    pageIndex = Math.min(state.config.activePage || 0, state.config.pages.length - 1);
    selected = null;
    activePageTouched = false;
    setDirty(false);
    return true;
  } catch (e) {
    setStatus(`無法載入「${curDevName()}」的設定。${e.message}`, true);
    return false;
  }
}

/** state 就緒後把編輯器亮出來並畫版面（要在 modal 已顯示後呼叫，頁籤指示塊才量得到尺寸）。 */
function showEditor() {
  $('emptyState').classList.add('hidden');
  $('editor').classList.remove('hidden');
  render();
}

/** 工作區內「重新載入」：modal 已開著，失敗就退回空狀態。 */
async function loadConfig() {
  if (await fetchConfig()) return showEditor();
  $('editor').classList.add('hidden');
  $('emptyState').classList.remove('hidden');
}

/** 機器模式的儲存並發布（共用版面模式另走 saveSharedLayout）。opts.doneMsg＝成功時改用這句 toast。 */
async function savePublish(opts = {}) {
  try {
    $('saveBtn').disabled = true;
    // 沒按過「展示此頁」就不送 activePage，機器維持目前顯示的頁面（伺服器沿用舊值）
    const payload = { ...state.config };
    if (!activePageTouched) delete payload.activePage;
    // 只送這個編輯器會改的欄位（2026-09-08）：機器名稱走「更名」、螢幕尺寸是機器自報的，
    // 都不能用載入時的舊值蓋回去——否則在別處改的名字每存一次就被這個分頁的舊資料覆蓋。
    delete payload.deviceName;
    delete payload.screen;
    const r = await api('PUT', `/api/config/${encodeURIComponent(deviceId)}`, { config: payload, reason: 'publish' }); // reason＝操作紀錄用
    state.version = r.version;
    activePageTouched = false;
    setDirty(false);
    setStatus(opts.doneMsg || `已發布。「${curDevName()}」會在一分鐘內更新。`); // 不寫版號（2026-09-03 指示）
  } catch (e) { setDirty(true); setStatus(`無法發布到「${curDevName()}」。${e.message}`, true); }
}
$('saveBtn').addEventListener('click', () => saveConfig());

function setDirty(v) { dirty = v; $('saveBtn').disabled = !v; }
function setStatus(msg, isErr) {
  if (window.BToast) (isErr ? BToast.danger : BToast.success)(msg);
}
/** 目前工作區機器的顯示名（toast 一律指名是哪一台，2026-09-07 指示）；機器設定頁改名後立即反映。 */
function curDevName() {
  const n = state && state.config && typeof state.config.deviceName === 'string' ? state.config.deviceName.trim() : '';
  return n || wsDevName || deviceId;
}
/** 多台機器的顯示名清單（「A、B」）。 */
function devNames(list) { return list.map((d) => d.DeviceName || d.DeviceId).join('、'); }

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
/** 把 sel 位置的葉格換成 cell（sub=null 時該區塊必定是未分割的單格）。 */
function setCell(sel, cell) {
  const block = page().blocks[sel.bi];
  if (!block) return;
  if (sel.sub) { if (block.node.t === 'split') block.node[sel.sub] = cell; }
  else block.node = cell;
}
/**
 * 對調兩格的設定（背景、內容、天氣…全部跟著走），格位大小不動。
 * 只換葉格所以永遠合法：不會把分割節點塞進子格。選取框跟著被拖的格子走。
 */
function swapCells(from, to) {
  const a = getCell(from), b = getCell(to);
  if (!a || !b || a === b) return false;
  setCell(from, b); setCell(to, a);
  if (selected && selected.bi === from.bi && selected.sub === from.sub) selected = { ...to };
  else if (selected && selected.bi === to.bi && selected.sub === to.sub) selected = { ...from };
  setDirty(true);
  return true;
}
/** 整個大區塊往上/往下搬一格（連同高度比與內部分割），選取框跟著走。 */
function moveBlock(bi, dir) {
  const blocks = page().blocks;
  const j = bi + dir;
  if (j < 0 || j >= blocks.length) return false;
  [blocks[bi], blocks[j]] = [blocks[j], blocks[bi]];
  if (selected && selected.bi === bi) selected = { ...selected, bi: j };
  else if (selected && selected.bi === j) selected = { ...selected, bi };
  setDirty(true);
  return true;
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
  renderTabs(); renderCanvas(); renderPanel(); updateShowPageBtn();
  if (!$('settingsTab').classList.contains('hidden')) renderSettingsView();
}

// ---------- 頁面分頁籤 ----------
function renderTabs() {
  const nav = $('pageTabs');
  nav.innerHTML = '';
  // 2026-09-07 改版：頁籤放在可左右捲動的軌道（不換行），「新增頁面」icon 鈕固定最右、左側細分隔線；
  // 「展示中」標籤拿掉（機器總覽列縮圖已反映展示頁）。
  const track = document.createElement('div');
  track.className = 'page-tabs-track';
  // 滑鼠使用者：垂直滾輪轉成橫向捲動（觸控板本來就能橫滑）；有捲動空間才吃掉事件
  // 只接手「純垂直」的滾輪（滑鼠）；觸控板橫滑有 deltaX，交給瀏覽器原生捲動（慣性/手感才對）
  track.addEventListener('wheel', (e) => {
    if (track.scrollWidth <= track.clientWidth) return;
    if (e.deltaX !== 0 || e.deltaY === 0) return;
    e.preventDefault();
    track.scrollLeft += e.deltaY;
  }, { passive: false });
  // 溢出時左右箭頭（只在有得捲的方向亮起）；捲動/視窗改變時更新
  const mkArrow = (dir) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'page-tabs-arrow is-' + dir; b.tabIndex = -1;
    b.title = dir === 'prev' ? '往左捲' : '往右捲';
    b.innerHTML = '<i data-lucide="chevron-' + (dir === 'prev' ? 'left' : 'right') + '"></i>';
    b.onclick = () => { track.scrollBy({ left: (dir === 'prev' ? -1 : 1) * Math.max(120, track.clientWidth * 0.6), behavior: 'smooth' }); };
    return b;
  };
  const prev = mkArrow('prev'), next = mkArrow('next');
  const updateArrows = () => {
    const over = track.scrollWidth > track.clientWidth + 1;
    nav.classList.toggle('is-overflow', over);
    prev.disabled = !over || track.scrollLeft <= 1;
    next.disabled = !over || track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
  };
  track.addEventListener('scroll', updateArrows, { passive: true });
  nav.appendChild(prev);
  nav.appendChild(track);
  nav.appendChild(next);
  nav._updateArrows = updateArrows;
  requestAnimationFrame(updateArrows);
  state.config.pages.forEach((p, i) => {
    const tab = document.createElement('div');
    tab.className = 'tab' + (i === pageIndex ? ' active' : '');
    const name = document.createElement('span');
    name.textContent = p.name || `頁面 ${i + 1}`;
    tab.appendChild(name);
    const ren = document.createElement('button');
    ren.innerHTML = '<i data-lucide="pencil"></i>'; ren.title = '重新命名'; ren.setAttribute('aria-label', '重新命名'); // icon 取代 ✎ 字元：跨瀏覽器一致
    ren.onclick = async (e) => {
      e.stopPropagation();
      const v = await BDialog.prompt({ title: '頁面名稱', value: p.name || '', placeholder: `頁面 ${i + 1}` });
      if (v !== null && v !== undefined) { p.name = String(v).trim(); setDirty(true); renderTabs(); }
    };
    tab.appendChild(ren);
    if (state.config.pages.length > 1) {
      const del = document.createElement('button');
      del.innerHTML = '<i data-lucide="x"></i>'; del.title = '刪除此頁'; del.setAttribute('aria-label', '刪除此頁');
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
    track.appendChild(tab);
  });
  // 目前頁籤若被捲出視野就捲到看得見（只捲軌道本身）
  const act = track.querySelector('.tab.active');
  if (act) requestAnimationFrame(() => act.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }));
  {
    const full = state.config.pages.length >= MAX_PAGES;
    const add = document.createElement('button');
    add.className = 'add-page'; add.setAttribute('aria-label', '新增頁面');
    add.title = full ? `已達 ${MAX_PAGES} 頁上限` : '新增頁面';
    add.disabled = full;
    add.innerHTML = '<i data-lucide="plus"></i>';
    add.onclick = () => {
      const nextId = Math.max(0, ...state.config.pages.map((p) => p.id || 0)) + 1;
      state.config.pages.push({ id: nextId, name: '', blocks: [{ id: 1, w: 1, node: DEFAULT_CELL() }] });
      pageIndex = state.config.pages.length - 1;
      selected = null; setDirty(true); render();
    };
    nav.appendChild(add);
  }
  if (window.lucide) lucide.createIcons({ nodes: [nav] });
  {
  }
}

// 「在機器上展示此頁」（2026-09-08 指示回歸，改成 icon 鈕放在畫布下方「本機複製頁面」右邊）：
// 一般「儲存並發布」仍不送 activePage（機器維持自己顯示的頁）；只有按這顆才把 activePage 送上去，
// 伺服器蓋章「網頁指定」並叫醒機器，機器（App v1.20 起）約一秒內切頁，切完回報一次把來源翻回機器，
// 之後網頁只發布版面不會再把畫面拉回這頁。有未發布的修改就一併發布（不然頁索引對不上機器那份）。
/** 展示鈕外觀（2026-09-08 指示）：正在編輯的頁＝機器展示中的頁 → 主題色底白 icon（實心）；其他頁 → 灰底邊框主題色 icon。 */
function updateShowPageBtn() {
  const btn = $('showPageBtn');
  if (!btn || !state) return;
  const showing = pageIndex === (state.config.activePage || 0);
  btn.classList.toggle('b-btn-primary', showing);
  btn.classList.toggle('is-idle', !showing);
  btn.title = showing ? '機器正在展示此頁' : '在機器上展示此頁';
  btn.setAttribute('aria-label', btn.title);
}
$('showPageBtn').addEventListener('click', async () => {
  if (!state || !page() || wsMode === 'shared') return;
  const btn = $('showPageBtn');
  const name = page().name || `頁面 ${pageIndex + 1}`;
  const doneMsg = `「${curDevName()}」正在切換到「${name}」。`;
  btn.disabled = true;
  try {
    if (dirty) {
      state.config.activePage = pageIndex;
      activePageTouched = true;
      await savePublish({ doneMsg }); // 失敗時它自己會 toast 並把 dirty 留著
    } else {
      await api('PUT', `/api/config/${encodeURIComponent(deviceId)}`, { config: { activePage: pageIndex }, reason: 'switchPage' });
      state.config.activePage = pageIndex;
      setStatus(doneMsg);
    }
  } catch (e) { setStatus(`無法切換「${curDevName()}」的展示頁。${e.message}`, true); }
  finally { btn.disabled = false; updateShowPageBtn(); }
});

$('addBlockBtn').addEventListener('click', () => {
  const blocks = page().blocks;
  if (blocks.length >= MAX_BLOCKS) return setStatus(`一頁最多可放 ${MAX_BLOCKS} 個大區塊。`, true);
  blocks.push({ id: Math.max(0, ...blocks.map((b) => b.id || 0)) + 1, w: 1, node: DEFAULT_CELL() });
  setDirty(true); render();
});

// ---------- 畫布 ----------
function renderCanvas() {
  const canvas = $('canvas');
  previewTimers.forEach(clearInterval);
  previewTimers = [];
  const blocks = page().blocks;
  const addFull = blocks.length >= MAX_BLOCKS;
  $('addBlockBtn').disabled = addFull;
  $('addBlockBtn').title = addFull ? `最多 ${MAX_BLOCKS} 個大區塊，已達上限` : '';
  buildCanvas(canvas, page(), state.config.screen, { timers: previewTimers });
  requestAnimationFrame(() => fitPreview(canvas));
}

/**
 * 把一頁畫進 canvas 元素（編輯畫布與縮圖預覽共用）。
 * opts.readonly＝唯讀預覽：不畫分隔把手/角標、格子不可點；opts.timers＝輪播計時器要收進哪個陣列。
 */
function buildCanvas(canvas, pg, screen, opts) {
  opts = opts || {};
  canvas.innerHTML = '';
  // 用機器上報的真實螢幕比例畫預覽（沒有就用 9:16 直式）
  const scr = screen;
  const SW = scr && scr.w > 0 ? scr.w : 1080;
  const SH = scr && scr.h > 0 ? scr.h : 1920;
  canvas.style.aspectRatio = `${SW} / ${SH}`;
  canvas.classList.toggle('is-landscape', SW > SH); // 橫式改以寬度定尺寸（CSS .is-landscape）
  canvas.classList.toggle('is-readonly', !!opts.readonly); // 唯讀預覽：格子不亮框、不變手指（CSS .is-readonly）
  const blocks = pg.blocks || [];
  const totalW = blocks.reduce((s, b) => s + (b.w || 1), 0) || 1;

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
      el.appendChild(cellDiv(node.a, { bi, sub: 'a' }, node.ratio, splitChildPx(blockPx, node, false), opts));
      if (!opts.readonly) el.appendChild(splitDivider(bi, node));
      el.appendChild(cellDiv(node.b, { bi, sub: 'b' }, 1 - node.ratio, splitChildPx(blockPx, node, true), opts));
    } else {
      el.appendChild(cellDiv(node, { bi, sub: null }, 1, blockPx, opts));
    }
    canvas.appendChild(el);
    if (!opts.readonly && bi < blocks.length - 1) canvas.appendChild(blockDivider(bi));
  });
}

/**
 * 依格子實際像素大小套用字級與動畫，規則與 App 相同：
 * 跑馬燈字高 = 格高 55%、等速滑動（≈90dp/s 換算）；天氣字級 = min(格高比, 格寬比)；
 * 文字內容字級相對整個畫面寬（App 用固定 headlineMedium）。
 */
function fitPreview(canvasEl) {
  const canvas = canvasEl || $('canvas');
  // 用 offsetWidth/Height（排版尺寸）而不是 getBoundingClientRect：縮圖預覽用 transform 縮放做開闔動畫，
  // 動畫中量到的 rect 是縮小後的值，字級會被算成超小（2026-09-07 user 回報）
  const cw = canvas.offsetWidth;
  if (!cw) return;
  canvas.querySelectorAll('.cell').forEach((el) => {
    const h = el.offsetHeight, w = el.offsetWidth;

    const text = el.querySelector('.pv-text');
    if (text) {
      // 字級 = 畫面寬 7% × 字級%，但只是上限：格子放不下（例：300% 塞進矮格）就等比縮到剛好放得下，
      // 否則字會被格子裁掉只剩中間一條（user 2026-09-08 回報「文字不見了」）。App 端用 autoSize 做同樣的事。
      // 內距跟著字級走（預設 4/7），縮字時內距一起縮，矮格才有空間放字。
      let fs = cw * 0.07 * (Number(text.dataset.size || 100) / 100);
      const apply = () => { text.style.fontSize = `${fs}px`; text.style.padding = `${fs * 4 / 7}px`; };
      apply();
      for (let i = 0; i < 16 && fs > 4 && (text.scrollHeight > h || text.scrollWidth > w); i++) { fs *= 0.88; apply(); }
    }

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
  const r = await fetch(url.startsWith('/') ? BASE + url : url);
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
      .then((info) => { weatherCache.set(key, { ts: Date.now(), info, loading: false, lastTry: Date.now() }); onWeatherUpdated(); })
      .catch(() => {
        weatherCache.set(key, { ...(hit || {}), info: hit?.info || null, loading: false, error: true, lastTry: Date.now() });
        onWeatherUpdated();
      });
  }
  if (hit?.info) return hit.info; // 過期但先顯示舊資料，背景更新
  if (hit?.error && !hit?.loading) return { error: true };
  return null;
}

// ---------- 園區測站（與 App 的 StationService 同一套：客戶感測器 API，經伺服器代抓，30 秒快取） ----------
const stationCache = new Map(); // url -> { ts, snap, loading, error, lastTry }

/** 解析測站 API（卓也小屋 joyeCloud 格式，欄位盡量寬鬆，與 App StationService.parse 一致）。 */
function parseStations(root) {
  const arr = Array.isArray(root?.stations) ? root.stations : null;
  if (!arr) throw new Error('no stations');
  return arr.map((o) => {
    const id = String(o.station_id || o.id || '');
    if (!id) return null;
    const values = {};
    for (const [k, v] of Object.entries(o.values || {})) if (Number.isFinite(Number(v))) values[k] = Number(v);
    return {
      id, name: o.name || id,
      online: 'online' in o ? !!o.online : o.status === 'online',
      values, receivedAt: o.received_at_local || o.received_at || '',
    };
  }).filter(Boolean);
}

/** 取快取的測站快照；沒有就在背景抓，抓到後重畫畫布並補滿編輯面板的測站下拉。回傳 null = 抓取中，{error} = 失敗。 */
function getStations(url) {
  url = String(url || '').trim();
  if (!url) return null;
  if (!/^https?:\/\/[^\s/]+\.[^\s/]+/.test(url)) return { error: true }; // 網址還沒打完整，別去打代理
  const hit = stationCache.get(url);
  if (hit && hit.snap && Date.now() - hit.ts < 30 * 1000) return hit.snap;
  const mayRetry = !hit || (!hit.loading && Date.now() - (hit.lastTry || 0) > 15 * 1000);
  if (mayRetry) {
    stationCache.set(url, { ...(hit || {}), loading: true, lastTry: Date.now() });
    api('GET', `/api/station/current?url=${encodeURIComponent(url)}`)
      .then((root) => {
        stationCache.set(url, { ts: Date.now(), snap: { stations: parseStations(root) }, loading: false, lastTry: Date.now() });
        onWeatherUpdated();
        document.querySelectorAll('select[data-station-url]').forEach(fillStationSelect);
      })
      .catch(() => {
        stationCache.set(url, { ...(hit || {}), snap: hit?.snap || null, loading: false, error: true, lastTry: Date.now() });
        onWeatherUpdated();
      });
  }
  if (hit?.snap) return hit.snap; // 過期但先用舊資料，背景更新
  if (hit?.error && !hit?.loading) return { error: true };
  return null;
}

/** 測站下拉：API 有什麼站就列什麼站（清單還沒到時只有「輪播全部測站」＋目前選的站）。 */
function fillStationSelect(sel) {
  const url = sel.dataset.stationUrl;
  const want = sel.dataset.stationId || '';
  const snap = getStations(url);
  const list = snap && !snap.error ? snap.stations : [];
  const opts = [['', '輪播全部測站'], ...list.map((s) => [s.id, `${s.id} ${s.name}`])];
  if (want && !list.some((s) => s.id === want)) opts.push([want, want]);
  sel.innerHTML = '';
  for (const [v, label] of opts) {
    const o = document.createElement('option');
    o.value = v; o.textContent = label; o.selected = v === want;
    sel.appendChild(o);
  }
}

/** 一個測站的讀數整理成天氣列用的欄位（溫度一位小數、日雨量 mm、濕度、PM2.5），同 App 的 toWeatherInfo。 */
function stationInfo(s) {
  const fix = (k, d) => (k in s.values ? s.values[k].toFixed(d) : '');
  return {
    location: s.name,
    date: '', // 測站列不放日期：感測數字才是重點，6:1 的長條塞不下
    temp: fix('temperature', 1) === '' ? '' : `${fix('temperature', 1)}°`,
    humidity: fix('humidity', 0) === '' ? '' : `${fix('humidity', 0)}%`,
    pm25: fix('pm25', 0),
    rain: fix('daily_rainfall', 1) === '' ? '' : `${fix('daily_rainfall', 1)} mm`,
  };
}

/** 天氣資料更新後重畫所有在畫的畫布：編輯器（有 state 時）＋縮圖預覽（開著時）。 */
function onWeatherUpdated() {
  if (state && $('wsModal').classList.contains('is-visible')) renderCanvas();
  if (thumbPreview) thumbPreview.rerender();
  // 列表縮圖（真實縮小版）也要跟著重畫
  clearListThumbs();
  document.querySelectorAll('.layout-thumb').forEach((t) => t._rerender && t._rerender());
}

/** 依背景亮度自動選黑/白字（與 App 的 auto contrast 行為一致）。 */
function autoTextColor(bg) {
  const n = Number(bg ?? 4280693304) >>> 0;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111111' : '#ffffff';
}

let previewTimers = [];

function cellDiv(cell, sel, flex, sizePx, opts) {
  opts = opts || {};
  const timers = opts.timers || previewTimers;
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.bi = sel.bi;
  el.dataset.sub = sel.sub || '';
  if (!opts.readonly && selected && selected.bi === sel.bi && selected.sub === sel.sub) el.classList.add('selected');
  el.style.flex = String(flex);
  el.style.background = colorCss(cell.bgColor);
  if (cell.bg === 'Image') {
    // 跟 App 的 ImageContent 一樣：多張輪播、每張停留 dur 秒、600ms 淡入淡出
    const imgs = (cell.bgImgs || []).filter(isRemote);
    if (imgs.length) {
      const size = cell.scale === 'Fit' ? 'contain' : 'cover';
      // 模糊（App：100% = 24dp；預覽依格子寬度換算）＋越模糊越暗的黑幕（最多 20%）
      const blur = Math.min(100, Math.max(0, Number(cell.bgBlur) || 0)) / 100;
      const pxPerDp = el.clientWidth ? el.clientWidth / 1080 : 0.25;
      const blurPx = blur * 24 * pxPerDp;
      const fit = cell.scale === 'Fit';
      // 完整顯示的留白（user 2026-09-09）：不露底色，鋪同一張圖的 100% 模糊＋20% 黑（＝模糊拉到底的樣子）；
      // 圖層變成容器：底層 .pv-img-back（鋪滿、全模糊）＋前層 .pv-img-front（完整顯示、使用者的模糊值）。App ImageContent 同一規則
      // 邊緣融合（user 2026-09-09）：讀到圖的原始尺寸後，把前層縮成圖實際佔的矩形，只在有留白的方向
      // 用 mask 把兩側邊緣漸淡（另一方向貼齊格子邊不淡）。漸淡寬度＝短邊 15%，App EDGE_FADE_FRACTION 同值
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
          // 漸淡寬度＝短邊 25%，曲線用 smoothstep（頭尾斜率零）：線性漸層在變成 100% 不透明那條線
          // 會被看成一道淡框（馬赫帶；user 2026-09-09 回報「還是有邊框感」）。App fadeStops 同一組 9 點
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
        const url = `url(${mediaSrc(src)})`;
        if (fit) {
          l.querySelectorAll('.pv-img-back, .pv-img-front').forEach((c) => { c.style.backgroundImage = url; });
          const front = l.querySelector('.pv-img-front');
          if (front && cell.edgeFade) fitFront(front, src);
        } else l.style.backgroundImage = url;
      };
      const mkLayer = (src) => {
        const l = document.createElement('div');
        l.className = 'pv-img-layer' + (fit ? ' fit' : '');
        // 模糊會讓圖的邊緣淡出成透明、露出底色變成一圈白邊／色邊：把圖層往外撐兩倍模糊半徑，淡出的部分被格子裁掉（user 2026-09-08 回報白邊）
        // 圖層要蓋過格子的 2px 透明邊框（absolute 只到 padding box，那圈會露出格子底色＝白邊）；模糊時再往外撐兩倍模糊半徑，濾鏡淡出的邊被裁掉
        if (fit) {
          const fullPx = 24 * pxPerDp;
          const back = document.createElement('div');
          back.className = 'pv-img-back';
          back.style.filter = `blur(${fullPx.toFixed(2)}px)`; back.style.inset = `-${(fullPx * 2).toFixed(1)}px`;
          const scrim = document.createElement('div');
          scrim.className = 'pv-img-back-scrim';
          const front = document.createElement('div');
          front.className = 'pv-img-front';
          if (blur > 0) front.style.filter = `blur(${blurPx.toFixed(2)}px)`;
          l.append(back, scrim, front);
        } else {
          l.style.backgroundSize = size;
          if (blur > 0) { l.style.filter = `blur(${blurPx.toFixed(2)}px)`; l.style.inset = `-${(2 + blurPx * 2).toFixed(1)}px`; }
        }
        setSrc(l, src);
        return l;
      };
      const a = mkLayer(imgs[0]);
      el.appendChild(a);
      if (imgs.length > 1) {
        const b = mkLayer(imgs[1]);
        b.style.opacity = '0';
        el.appendChild(b);
        let idx = 0, front = a;
        timers.push(setInterval(() => {
          idx = (idx + 1) % imgs.length;
          const back = front === a ? b : a;
          setSrc(back, imgs[idx]);
          back.style.opacity = '1';
          front.style.opacity = '0';
          front = back;
        }, Math.max(3, cell.dur || 8) * 1000));
      }
      if (blur > 0) {
        const scrim = document.createElement('div');
        scrim.className = 'pv-img-scrim';
        scrim.style.opacity = String(0.2 * blur);
        el.appendChild(scrim);
      }
    } else if ((cell.bgImgs || []).length) el.style.background = '#333';
  }

  // 內容的真實預覽（字級規則與 App 相同：跑馬燈 = 格高 55%，天氣依格子長寬混算）
  const autoFg = cell.bg === 'Image' ? '#ffffff' : autoTextColor(cell.bgColor);
  const fg = cell.txtColor != null ? colorCss(cell.txtColor) : autoFg;
  // 文字發光：三層 text-shadow（em 單位，跟字級一起縮放），顏色預設跟文字色；App 端疊兩層 Shadow
  const glowCss = () => {
    if (!cell.glow) return '';
    const c = cell.glowColor != null ? colorCss(cell.glowColor) : fg;
    return `0 0 0.12em ${c}, 0 0 0.35em ${c}, 0 0 0.8em ${c}`;
  };
  if (cell.content === 'Text' && cell.text) {
    const t = document.createElement('div');
    t.className = 'pv-text'; t.textContent = cell.text; t.style.color = fg;
    t.style.textShadow = glowCss();
    t.dataset.size = cell.txtSize || 100; // 字級 %（fitPreview 依畫面寬換算）
    el.appendChild(t);
  } else if (cell.content === 'Marquee' && cell.text) {
    const wrap = document.createElement('div');
    wrap.className = 'pv-marquee';
    const span = document.createElement('span');
    span.textContent = cell.text; span.style.color = fg;
    span.style.textShadow = glowCss();
    span.dataset.speed = cell.mqSpeed || 100;
    wrap.appendChild(span);
    el.appendChild(wrap);
  } else if (cell.content === 'Weather') {
    const w = document.createElement('div');
    w.className = 'pv-weather2';
    const dyn = !!cell.wDynBg;
    const stationMode = cell.wSrc === 'Station';
    const locationSet = !(cell.wAuto === false && !cell.wCounty);
    // 一般天氣：預報就是資料；園區測站：預報只拿來決定圖示與天空（感測器只有數字）
    const forecast = locationSet ? getWeather(cell) : null; // null = 抓取中，抓到後會自動重畫
    const kind = weatherKind(forecast?.code);
    if (dyn) {
      const glow = (kind === 'Sunny' || kind === 'Partly')
        ? 'radial-gradient(circle at 88% 5%, rgba(255,237,176,.55), transparent 42%),' : '';
      el.style.background = `${glow}linear-gradient(${SKY[kind][0]}, ${SKY[kind][1]})`;
    }
    // 動態天空時字色依天空決定：霧/雪黑字，其他白字（同 App weatherTextColor）
    w.style.color = dyn ? (kind === 'Fog' || kind === 'Snow' ? '#111111' : '#ffffff') : fg;

    const renderBar = (info) => {
      const infoBits = info.date ? [`<span style="opacity:.72">${info.date}</span>`] : [];
      if (info.high || info.low) infoBits.push(`<span>${info.high || '–'} / ${info.low || '–'}</span>`);
      if (info.humidity) infoBits.push(`<span style="opacity:.72">濕度 </span><span>${info.humidity}</span>`);
      if (info.pm25) infoBits.push(`<span style="opacity:.72">PM2.5 </span><span>${info.pm25}</span>`);
      if (info.rain) infoBits.push(`<span class="material-icons pvw-drop" style="opacity:.72">water_drop</span><span>${info.rain}</span>`);
      w.innerHTML =
        `<div class="pvw-left">` +
        `<div class="pvw-loc">${esc(info.location)}</div>` +
        `<div class="pvw-info">${infoBits.join('<span style="opacity:.72"> · </span>')}</div>` +
        `</div>` +
        `<div class="pvw-right"><span class="material-icons pvw-icon">${COND_ICON[kind]}</span>` +
        `<span class="pvw-temp">${info.temp}</span></div>`;
    };
    const renderHint = (text) => { w.innerHTML = `<div class="pvw-hint">${esc(text)}</div>`; };

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
        // 預覽不輪播：沒指定站就固定顯示第一站（機器上每 10 秒換一站）
        const s = cell.wStation ? snap.stations.find((x) => x.id === cell.wStation) : snap.stations[0];
        if (!s) renderHint(`找不到測站 ${cell.wStation}`);
        else if (!s.online) renderHint(`${s.name} 測站離線`);
        else renderBar(stationInfo(s));
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
  // 園區資訊：標題＋「點我查看」按鈕，版面規則與 App ParkCellOverlay 相同（直橫自動、字級以 28/40sp 為上限縮放）
  if (cell.content === 'ParkInfo' || cell.tap === 'OpenParkInfo') renderParkOverlay(el, cell, sizePx, fg);

  if (opts.readonly) return el; // 唯讀預覽：沒有角標、不可點

  // 右上角標籤：類型 · 實際像素尺寸（與 App 管理預覽的 CellChip 角標相同）
  const typeLabel = cell.content !== 'None' ? (CONTENT_NAMES[cell.content] || cell.content)
    : cell.bg === 'Image' ? '圖片背景' : '純色背景';
  const badge = document.createElement('div');
  badge.className = 'pv-size-badge';
  badge.innerHTML = `<span>${typeLabel} · ${sizePx ? `${sizePx.w}×${sizePx.h}` : ''}</span>` +
    (cell.tap && cell.tap !== 'None' ? '<span class="material-icons">open_in_new</span>' : '');
  el.appendChild(badge);

  el.onclick = () => { if (el._dragged) { el._dragged = false; return; } selected = sel; renderCanvas(); renderPanel(); };
  attachCellDrag(el, sel);
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

/**
 * 格子拖曳交換：按住格子拖到另一格放開，兩格設定對調（格位大小不變）。
 * 用 pointer 事件（非 HTML5 DnD）：跟分隔線同一套模式、觸控也能用、幽靈外觀可控。
 * 位移不到門檻就放開＝一般點選（交給 onclick）；有拖過則擋掉緊接著的 click。
 */
function attachCellDrag(el, sel) {
  const THRESHOLD = 6;
  el.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    const canvas = $('canvas');
    const startX = down.clientX, startY = down.clientY;
    let ghost = null, target = null;
    const rect = el.getBoundingClientRect();
    const offX = startX - rect.left, offY = startY - rect.top;

    const setTarget = (t) => {
      if (t === target) return;
      if (target) target.classList.remove('drop-target');
      target = t;
      if (target) target.classList.add('drop-target');
    };
    const begin = () => {
      el.setPointerCapture(down.pointerId);
      el._dragged = true;
      el.classList.add('drag-source');
      document.body.style.cursor = 'grabbing';
      ghost = el.cloneNode(true);
      ghost.classList.remove('selected', 'drag-source');
      ghost.classList.add('drag-ghost');
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.style.transformOrigin = `${offX}px ${offY}px`; // 縮小時抓點不動
      document.body.appendChild(ghost);
    };
    const move = (m) => {
      if (!ghost) {
        if (Math.hypot(m.clientX - startX, m.clientY - startY) < THRESHOLD) return;
        begin();
      }
      ghost.style.transform = `translate(${m.clientX - offX}px, ${m.clientY - offY}px) scale(.85)`;
      const hit = document.elementFromPoint(m.clientX, m.clientY);
      const cell = hit && hit.closest('.cell');
      setTarget(cell && cell !== el && canvas.contains(cell) ? cell : null);
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      if (!ghost) return; // 沒拖過：當一般點選
      ghost.remove();
      el.classList.remove('drag-source');
      document.body.style.cursor = '';
      const to = target && { bi: Number(target.dataset.bi), sub: target.dataset.sub || null };
      setTarget(null);
      if (to && swapCells(sel, to)) { renderCanvas(); renderPanel(); }
      // 拖了但沒放到格子上：什麼都不改，_dragged 留著讓緊接的 click 不要換選取
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
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
    const size = $('cellPanel').querySelector('.panel-size');
    if (size) {
      const px = cellPixelSizeOf(selected);
      size.textContent = `${px.w}×${px.h} px`;
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
  // 重繪前先記住捲動位置：innerHTML 清空的瞬間內容高度歸零，面板（和 modal 內的 body）的 scrollTop
  // 被夾回 0，每改一個設定就跳回頂部（user 2026-09-09 回報 UX 很差）。重建完再把位置放回去。
  const scrollers = [panel, panel.closest('.b-modal-body')].filter(Boolean);
  const savedScroll = scrollers.map((el) => [el, el.scrollTop]);
  const sel = selected;
  const cell = sel && getCell(sel);
  // 只有「同一格重繪」才放回去；點到別的格子仍從頂部開始看
  const panelKey = cell ? `${sel.bi}/${sel.sub || ''}` : '';
  const sameCell = panel.dataset.renderedKey === panelKey;
  panel.dataset.renderedKey = panelKey;
  const restoreScroll = () => { if (sameCell) savedScroll.forEach(([el, top]) => { if (el.scrollTop !== top) el.scrollTop = top; }); };
  panel.querySelectorAll('.seg-row').forEach((row) => row._dispose?.());
  panel.innerHTML = '';
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
  h3.textContent = cellLabel(sel);
  const size = document.createElement('span');
  size.className = 'panel-size';
  size.textContent = `${cellPx.w}×${cellPx.h} px`;
  head.append(h3, size);
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
    sec('版面');
    const actions = rowFull();
    actions.classList.add('ins-actions');
    const actionGroup = (label, ...buttons) => {
      const group = document.createElement('div');
      group.className = 'ins-action-group';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', label);
      group.append(...buttons);
      actions.appendChild(group);
    };
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
      actionGroup('分割區塊', b1, b2);
    } else {
      actionGroup('合併區塊', btn('移除此格（合併）', () => {
        const other = sel.sub === 'a' ? 'b' : 'a';
        blocks[sel.bi].node = blocks[sel.bi].node[other];
        selected = { bi: sel.bi, sub: null }; setDirty(true); refresh();
      }));
    }
    if (blocks.length > 1) {
      const up = btn('區塊上移', () => { if (moveBlock(sel.bi, -1)) refresh(); });
      const down = btn('區塊下移', () => { if (moveBlock(sel.bi, 1)) refresh(); });
      up.disabled = sel.bi === 0;
      down.disabled = sel.bi === blocks.length - 1;
      up.title = down.title = '整個大區塊連同分割與高度一起搬動；要交換兩格的設定，直接在畫布上把格子拖到另一格放開';
      actionGroup('調整區塊順序', up, down);
      const del = btn('刪除區塊', async () => {
        const ok = await BDialog.confirm({
          title: '刪除這個大區塊？', desc: '區塊內的設定會一併刪除。', variant: 'danger', confirmText: '刪除',
        });
        if (!ok) return;
        blocks.splice(sel.bi, 1);
        selected = null; setDirty(true); refresh();
      });
      del.classList.add('b-btn-text', 'b-btn-text-danger', 'ins-action-delete');
      del.title = '刪除整個區塊';
      del.setAttribute('aria-label', '刪除整個區塊');
      actions.appendChild(del);
    }
  }

  // ---- 背景（天氣格多一個「天氣背景」＝動畫天空）----
  {
    const isWeather = cell.content === 'Weather';
    const segs = [
      ['純色', !cell.wDynBg && cell.bg !== 'Image', () => { cell.bg = 'Solid'; cell.wDynBg = false; setDirty(true); refresh(); }],
      ['圖片', !cell.wDynBg && cell.bg === 'Image', () => { cell.bg = 'Image'; cell.wDynBg = false; setDirty(true); refresh(); }],
    ];
    if (isWeather) segs.push(['天氣背景', !!cell.wDynBg, () => { cell.wDynBg = true; setDirty(true); refresh(); }]);
    sec('背景');
    insRow('類型', segRow(segs));
    if (isWeather && cell.wDynBg) {
      subRow('', hint('依即時天氣顯示動畫天空（陽光、雲、雨絲…）；字色自動配置，深色天空白字、霧/雪黑字。'));
    } else if (cell.bg === 'Image') {
      subRow('圖片', thumbList(cell, cellPx));
    } else {
      subRow('顏色', swatchRow(BG_SWATCHES, cell.bgColor, false, (v) => { cell.bgColor = v; touch(); renderPanel(); }));
    }
    if (!cell.wDynBg && cell.bg === 'Image') {
      const duration = numInput(cell.dur ?? 8, 3, 30, (v) => { cell.dur = v; touch(); });
      duration.classList.add('ins-input-short');
      duration.setAttribute('aria-label', '每張時間（秒）');
      const unit = document.createElement('span');
      unit.className = 'field-label';
      unit.textContent = '秒';
      subRow('每張時間', duration, unit);
      subRow('顯示方式', selInput([['Crop', '填滿裁切'], ['Fit', '完整顯示']], cell.scale || 'Crop', (v) => { cell.scale = v; setDirty(true); refresh(); }));
      if (cell.scale === 'Fit') {
        // 完整顯示的留白鋪同一張圖的模糊底；邊緣融合讓圖靠留白那側的邊漸淡進去，看起來才像一張完整的圖（user 2026-09-09）
        subRow('邊緣融合', segRow([
          ['否', !cell.edgeFade, () => { cell.edgeFade = false; setDirty(true); refresh(); }],
          ['是', !!cell.edgeFade, () => { cell.edgeFade = true; setDirty(true); refresh(); }],
        ]));
        subRow('', hint('圖片靠留白那側的邊緣漸淡，融進模糊背景。'));
      }
      {
        // 模糊滑桿：與 App 同規則（0 = 不模糊；越模糊越暗，最暗 20% 黑）
        const range = document.createElement('input');
        range.type = 'range'; range.min = 0; range.max = 100; range.step = 5;
        range.value = cell.bgBlur ?? 0;
        range.setAttribute('aria-label', '背景模糊');
        range.setAttribute('aria-describedby', 'cell-bg-blur-hint');
        const val = document.createElement('span');
        val.className = 'field-label';
        val.textContent = range.value === '0' ? '不模糊' : `${range.value}%`;
        range.setAttribute('aria-valuetext', val.textContent);
        range.addEventListener('input', () => {
          cell.bgBlur = Number(range.value);
          val.textContent = range.value === '0' ? '不模糊' : `${range.value}%`;
          range.setAttribute('aria-valuetext', val.textContent);
          touch();
        });
        const slider = document.createElement('div');
        slider.className = 'ins-range';
        slider.append(range, val);
        const help = hint('提高模糊程度時，背景也會稍微變暗（最多 20%），讓文字更好讀。');
        help.id = 'cell-bg-blur-hint';
        subRow('模糊', slider, help);
      }
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
    if (cell.content === 'Text' || cell.content === 'ParkInfo') {
      // 字級滑塊（與 App 的 TextSizeField 同範圍 50–300%，步進 10；user 2026-09-08）
      // 園區資訊格也用同一顆調標題大小（user 2026-09-09）
      const range = document.createElement('input');
      range.type = 'range'; range.min = 50; range.max = 300; range.step = 10;
      range.value = cell.txtSize ?? 100;
      const val = lbl(`${range.value}%`);
      range.addEventListener('input', () => { cell.txtSize = Number(range.value); val.textContent = `${range.value}%`; touch(); });
      subRow('字級', range, val);
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
      // 資料來源：一般天氣（Open-Meteo 預報）或園區測站（客戶自己的感測器 API，例如卓也小屋）
      const stationMode = cell.wSrc === 'Station';
      subRow('來源', segRow([
        ['一般天氣', !stationMode, () => { cell.wSrc = 'Standard'; setDirty(true); refresh(); }],
        // 切到園區測站就先帶入預設的測站 API（卓也小屋），要接別的園區再改（user 2026-09-08）
        ['園區測站', stationMode, () => { cell.wSrc = 'Station'; if (!cell.wStUrl) cell.wStUrl = PARK_API; setDirty(true); refresh(); }],
      ]));
      if (stationMode) {
        // 舊設定或機器端建的格子可能沒填測站 API：一樣補上預設值，不讓畫面停在「尚未填寫」
        if (!cell.wStUrl) { cell.wStUrl = PARK_API; setDirty(true); }
        // 網址打到一半先等 0.6 秒再抓清單；抓到後 fillStationSelect 會補滿下拉
        let urlTimer = null;
        const sel = selInput([], cell.wStation || '', (v) => { cell.wStation = v; sel.dataset.stationId = v; touch(); });
        sel.dataset.stationUrl = cell.wStUrl || '';
        sel.dataset.stationId = cell.wStation || '';
        fillStationSelect(sel);
        subRow('測站 API', txtInput(cell.wStUrl, 'https://…/api/telemetry/current', (v) => {
          // 不走 touch()：每敲一鍵就重畫畫布會拿半截網址去打代理，等停手 0.6 秒再抓清單＋重畫
          cell.wStUrl = v; sel.dataset.stationUrl = v.trim(); setDirty(true);
          clearTimeout(urlTimer);
          urlTimer = setTimeout(() => { fillStationSelect(sel); renderCanvas(); }, 600);
        }, 'url'));
        subRow('測站', sel);
        subRow('', hint('測站數值每 30 秒更新；輪播時機器每 10 秒換一站。測站只提供數字，晴雨圖示與動態天空仍依下方位置判斷。'));
      }
      subRow(stationMode ? '圖示位置' : '位置', checkRow('自動偵測位置', cell.wAuto !== false, (v) => { cell.wAuto = v; setDirty(true); refresh(); }));
      if (cell.wAuto === false) {
        // 縣市／區改成下拉（與 App 的 WeatherLocationFields 同一份清單；user 2026-09-08 要求跟手機一樣）。
        // 舊資料若是手打的（例：臺北市）先把「臺」對成清單裡的「台」；對不到的值仍列出來，不會被吃掉。
        const counties = window.TW_COUNTIES || [];
        const norm = (v) => String(v || '').trim().replace(/臺/g, '台');
        if (cell.wCounty && norm(cell.wCounty) !== cell.wCounty && counties.some((c) => c.name === norm(cell.wCounty))) cell.wCounty = norm(cell.wCounty);
        const county = counties.find((c) => c.name === cell.wCounty);
        const countyOpts = [['', '請選擇縣市'], ...counties.map((c) => [c.name, c.name])];
        if (cell.wCounty && !county) countyOpts.push([cell.wCounty, cell.wCounty]);
        const countySel = selInput(countyOpts, cell.wCounty || '', (v) => { cell.wCounty = v; cell.wDistrict = ''; touch(); renderPanel(); });
        if (!county) {
          subRow('地點', countySel);
        } else {
          const distOpts = [['', `全${county.name}`], ...county.districts.map((d) => [d, d])];
          if (cell.wDistrict && !county.districts.includes(cell.wDistrict)) distOpts.push([cell.wDistrict, cell.wDistrict]);
          subRow('地點', countySel, selInput(distOpts, cell.wDistrict || '', (v) => { cell.wDistrict = v; touch(); }));
        }
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
    if (cell.content === 'ParkInfo') {
      subRow('', hint('此格只顯示「園區資訊」標題；搭配點擊動作「園區資訊」讓遊客點進園區地圖看各測站即時數值。'));
    }
    if (['Marquee', 'Text', 'Weather', 'ParkInfo'].includes(cell.content) && !(cell.content === 'Weather' && cell.wDynBg)) {
      subRow('文字顏色', swatchRow(TXT_SWATCHES, cell.txtColor, true, (v) => {
        if (v === null) delete cell.txtColor; else cell.txtColor = v;
        touch(); renderPanel();
      }));
    }
    if (cell.content === 'Marquee' || cell.content === 'Text') {
      // 文字發光（user 2026-09-09）：字周圍一圈光暈；顏色預設跟文字色，也可另選或用調色盤
      subRow('發光', segRow([
        ['否', !cell.glow, () => { cell.glow = false; setDirty(true); refresh(); }],
        ['是', !!cell.glow, () => { cell.glow = true; setDirty(true); refresh(); }],
      ]));
      if (cell.glow) {
        subRow('發光顏色', swatchRow(TXT_SWATCHES, cell.glowColor, true, (v) => {
          if (v === null) delete cell.glowColor; else cell.glowColor = v;
          touch(); renderPanel();
        }, '跟文字色'));
      }
    }
  }

  // ---- 點擊動作 ----
  {
    sec('點擊動作');
    rowFull(selInput(
      [['None', '無'], ['OpenWeb', '開啟網頁'], ['OpenAssistant', 'AI 智能客服'], ['OpenParkInfo', '園區資訊']],
      cell.tap || 'None',
      (v) => { cell.tap = v; if (v === 'OpenParkInfo' && !cell.wStUrl) cell.wStUrl = PARK_API; setDirty(true); refresh(); },
    ));
    if (cell.tap === 'OpenWeb') {
      subRow('網址', txtInput(cell.tapUrl, '點擊開啟的網址', (v) => { cell.tapUrl = v; touch(); }, 'url'));
    }
    if (cell.tap === 'OpenParkInfo') {
      subRow('排版', selInput(PARK_LAYOUT, cell.parkLayout || 'Auto', (v) => { cell.parkLayout = v; touch(); }));
      subRow('', hint('自動＝寬度不到高度兩倍的格子走直排（標題在上、按鈕貼底），其餘橫排（標題左、按鈕右）。'));
      subRow('按鈕動態', selInput(PARK_FX, cell.parkFx || 'Sweep', (v) => { cell.parkFx = v; touch(); }));
      // 內容是園區測站天氣時，測站 API 已在上面填過，不重複問
      const asked = cell.content === 'Weather' && cell.wSrc === 'Station';
      if (asked) {
        subRow('', hint('點擊後開啟內建的卓也小屋園區地圖，測站狀態使用上方「內容」填的測站 API。'));
      } else {
        subRow('測站 API', txtInput(cell.wStUrl, 'https://…/api/telemetry/current', (v) => { cell.wStUrl = v; touch(); }, 'url'));
        subRow('', hint('點擊後開啟內建的卓也小屋園區地圖；測站 API 已預設帶入，留白時也會使用預設網址顯示各站在線狀態與即時數值。'));
      }
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
          subRow('客服', hint('無法載入客服清單。' + agentCache.error), btn('重試', () => { fetchAgents(true); renderPanel(); }));
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
  // 同一格重繪＝內容高度一樣，位置放得回去；淡入動畫重排後再補一次
  restoreScroll();
  requestAnimationFrame(restoreScroll);
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
  // 面板變窄或字級改變時，segment 可能換行；底色跟著新位置走。
  // renderPanel 重建前釋放 observer，避免保留已移除的控件。
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(moveInd);
    observer.observe(row);
    row.querySelectorAll('.seg').forEach((seg) => observer.observe(seg));
    row._dispose = () => observer.disconnect();
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
/** iOS 式開關列（外觀走 CSS .b-switch，行為同 checkbox）。 */
function switchRow(text, checked, onChange) {
  const row = document.createElement('label');
  row.className = 'row switch-row';
  const c = document.createElement('input');
  c.type = 'checkbox'; c.className = 'b-switch'; c.checked = checked;
  c.addEventListener('change', () => onChange(c.checked));
  row.append(c, document.createTextNode(text));
  return row;
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
// ARGB 整數 ↔ <input type=color> 的 #rrggbb（調色盤只有 RGB，存回時一律不透明）
const hexOfArgb = (argb) => '#' + (Number(argb) & 0xFFFFFF).toString(16).padStart(6, '0');
const argbOfHex = (hex) => parseInt('FF' + hex.replace('#', ''), 16);
function swatchRow(colors, current, withAuto, onPick, autoLabel) {
  const row = document.createElement('div');
  row.className = 'swatches';
  if (withAuto) {
    const a = document.createElement('button');
    a.className = 'swatch auto' + (current == null ? ' active' : '');
    a.textContent = autoLabel || '自動';
    a.onclick = () => onPick(null);
    row.appendChild(a);
  }
  const cur = current == null ? null : Number(current);
  for (const c of colors) {
    const b = document.createElement('button');
    b.className = 'swatch' + (cur === c ? ' active' : '');
    b.style.background = colorCss(c);
    b.onclick = () => onPick(c);
    row.appendChild(b);
  }
  // 調色盤（user 2026-09-09）：不限預設色。原生 <input type=color> 藏在旁邊，按調色盤鈕才叫出來；
  // 用 change 而不是 input：onPick 會重繪面板、DOM 重建會把還開著的調色盤關掉。
  const picker = document.createElement('input');
  picker.type = 'color'; picker.className = 'swatch-picker'; picker.tabIndex = -1;
  picker.value = hexOfArgb(cur != null ? cur : colors[0]);
  picker.addEventListener('change', () => onPick(argbOfHex(picker.value)));
  if (cur != null && !colors.includes(cur)) {
    // 目前是自訂色：多顯示一格，選取狀態才看得到；再點一次可繼續調
    const b = document.createElement('button');
    b.className = 'swatch active'; b.title = '自訂顏色';
    b.style.background = colorCss(cur);
    b.onclick = () => picker.click();
    row.appendChild(b);
  }
  const custom = document.createElement('button');
  custom.className = 'swatch custom'; custom.title = '自訂顏色'; custom.setAttribute('aria-label', '自訂顏色');
  custom.innerHTML = '<span class="material-icons">palette</span>';
  custom.onclick = () => picker.click();
  row.append(custom, picker);
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
        img.src = mediaSrc(uri); img.loading = 'lazy';
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
      setStatus(`正在上傳「${f.name}」…`);
      const form = new FormData();
      form.append('file', f);
      const r = await api('POST', '/api/upload', form, true);
      onDone(r.url);
      setStatus('已上傳。儲存並發布後，機器上才會顯示。');
    } catch (e) { setStatus(`無法上傳「${f.name}」。${e.message}`, true); }
  };
  input.click();
}

// ---------- 複製版面到其他機器 ----------
// 語意＝一次性複製（蓋過目標機器的版面）；目標機器自己的客服帳號、休眠、
// 展示頁與機器名都不動（伺服器 PUT 沒帶的欄位沿用舊值）。
// 「加到其他機器」（2026-09-07 改版）：原本是整包覆蓋對方的頁面（user 實測被嚇到），
// 改成與版面設定的「加入機器」同一套語意＝接在對方現有頁面後面，對方原有頁面/設定/展示頁都不動。
// 2026-09-08 再改：只送「目前正在編輯的這一頁」，不是整台的所有頁面（鈕在畫布下方，語意就是這一頁）。
$('copyLayoutBtn').addEventListener('click', async () => {
  if (!state || !page()) return;
  await appendPagesToDevices({
    pages: [page()], screen: state.config.screen, fallbackName: page().name || `頁面 ${pageIndex + 1}`,
    excludeDeviceId: deviceId,
    title: '把這一頁加到其他機器',
    desc: '會把目前正在編輯的這一頁（含未發布的修改）接在所選機器現有頁面的最後面並立即發布；對方原有的頁面、設定與展示頁都不會被改動。',
    noTargetsTitle: '沒有其他機器', noTargetsDesc: '目前帳號下只有這一台機器，沒有可加入的對象。',
    verb: '加到',
  });
});

// 「本機複製頁面」（2026-09-08）：把目前這一頁複製一份接在這台機器的最後面，名稱＝原名＋「2」；
// 只改網頁上的草稿（標記未儲存），按「儲存並發布」才會送到機器。
$('dupPageBtn').addEventListener('click', () => {
  if (!state || !page()) return;
  if (state.config.pages.length >= MAX_PAGES) return setStatus(`已達 ${MAX_PAGES} 頁上限，無法再複製頁面。`, true);
  const src = page();
  const nextId = Math.max(0, ...state.config.pages.map((p) => p.id || 0)) + 1;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = nextId;
  copy.name = (src.name || `頁面 ${pageIndex + 1}`) + '2';
  state.config.pages.push(copy);
  pageIndex = state.config.pages.length - 1;
  selected = null; setDirty(true); render();
  setStatus(`已複製為「${copy.name}」。儲存並發布後，機器上才會顯示。`);
});

/** 批次發布結果 toast：指名每一台（成功清單＋失敗清單）。 */
function reportBatch(done, failed, verb) {
  // 例：「已套用到「大廳、櫃台」並發布。」／「已加到「大廳」並發布。無法發布到「櫃台」。」／「無法發布到「大廳、櫃台」。」
  const okPart = done.length ? `已${verb}「${devNames(done)}」並發布。` : '';
  if (!failed.length) return setStatus(okPart);
  const failPart = `無法發布到「${failed.join('、')}」。`;
  setStatus(okPart ? `${okPart}${failPart}` : `${failPart}請稍後再試一次。`, true);
}

/** 逐台 PUT 部分 config（伺服器淺合併，其他欄位不動）並回報結果。 */
async function publishToDevices(targets, partialConfig, verb) {
  const done = [];
  const failed = [];
  for (const d of targets) {
    try {
      await api('PUT', `/api/config/${encodeURIComponent(d.DeviceId)}`, { config: partialConfig, reason: 'applySettings' });
      done.push(d);
    } catch { failed.push(d.DeviceName || d.DeviceId); }
  }
  reportBatch(done, failed, verb);
}

/** 勾選目標機器的小對話框（BDialog 沒有多選，沿用 kit modal 樣式自建）。
 *  opts = { title, desc, confirmText, single, items: [{ d, warn }] } → resolve 選中的機器陣列或 null。 */
/** 清單對話框的一列：勾選框/單選＋名稱（＋右側 warn）。 */
function pickListItem({ input, label: text, warn }) {
  const label = document.createElement('label');
  label.className = 'copy-item';
  const name = document.createElement('span');
  name.textContent = text;
  label.append(input, name);
  if (warn) {
    const w = document.createElement('span');
    w.className = 'copy-warn';
    w.textContent = warn;
    label.appendChild(w);
  }
  return label;
}

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
      const c = document.createElement('input');
      c.type = opts.single ? 'radio' : 'checkbox';
      if (opts.single) c.name = 'pick-device';
      checks.push([c, d]);
      list.appendChild(pickListItem({ input: c, label: d.DeviceName || d.DeviceId, warn }));
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
  const pin = body.appendChild(pinCard(ctx));
  pin.classList.add('settings-card-full');
  if (!meIsAdmin) lockSettingsCard(pin); // 單機的管理 PIN 也限管理員（2026-09-07 定案）；伺服器端同步剝掉 adminPin
  if (wsMode !== 'shared' && meIsAdmin) body.appendChild(dangerZoneCard()); // 刪除機器＝限管理員、只在單機工作區
  if (window.BDropdown) BDropdown.init(body);
  if (window.lucide) lucide.createIcons(); // 密碼欄眼睛鈕
}

/* 機器設定卡（2026-09-03 改版＝tiri 郵件設定同款解剖）：
 * b-card-head 標題列（說明文字收進標題旁小問號 hover 展開）＋ .settings-fields 雙欄欄位區
 * ＋ .settings-foot 動作列（沒內容就不佔位）。 */
function settingsCard(title, helpLines, build) {
  const card = document.createElement('div');
  card.className = 'b-card settings-card';
  const head = document.createElement('div');
  head.className = 'b-card-head';
  const wrap = document.createElement('div');
  wrap.className = 'card-title-wrap';
  const h = document.createElement('h3');
  h.className = 'b-card-title';
  h.textContent = title;
  wrap.appendChild(h);
  if (helpLines && helpLines.length) {
    const pop = document.createElement('div');
    pop.className = 'b-pop page-help';
    pop.innerHTML =
      '<button type="button" class="page-help-btn" data-pop aria-label="說明"><i data-lucide="circle-help"></i></button>' +
      '<div class="b-pop-panel page-help-panel"><p class="b-pop-panel-title">說明</p>' +
      helpLines.map((t) => `<p>${esc(t)}</p>`).join('') +
      '</div>';
    wrap.appendChild(pop);
  }
  head.appendChild(wrap);
  card.appendChild(head);
  const g = document.createElement('div');
  g.className = 'settings-fields';
  card.appendChild(g);
  const foot = document.createElement('div');
  foot.className = 'settings-foot';
  card.appendChild(foot);
  build(g, foot);
  if (!foot.childNodes.length) foot.remove();
  return card;
}

/** 一個欄位＝標題＋控件＋（可選）底下的說明字；full＝跨滿兩欄。 */
function field(title, control, hintText, full) {
  const f = document.createElement('div');
  f.className = 'field' + (full ? ' full' : '');
  const l = document.createElement('label');
  l.className = 'field-title';
  l.textContent = title;
  f.append(l, control);
  if (hintText) f.appendChild(hint(hintText));
  return f;
}

/** 密碼欄＋顯示/隱藏切換（tiri SMTP 密碼欄同款眼睛鈕）。 */
function pwInput(value, placeholder, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'pw-wrap';
  const i = txtInput(value, placeholder, onChange, 'password');
  const eye = document.createElement('button');
  eye.type = 'button'; eye.className = 'pw-eye'; eye.title = '顯示/隱藏密碼';
  eye.innerHTML = '<i data-lucide="eye"></i>';
  eye.onclick = () => {
    const show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    eye.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}"></i>`;
    if (window.lucide) lucide.createIcons();
  };
  wrap.append(i, eye);
  return wrap;
}

function chatApiCard(ctx) {
  return settingsCard('智能客服 API', ['與機器上「設定 → 智能客服 API」相同；儲存發布後同步到機器。'], (g, foot) => {
    const c = ctx.cfg.chatApi;
    g.appendChild(field('伺服器位址',
      txtInput(c ? c.baseUrl : DEFAULT_CHAT_BASE, DEFAULT_CHAT_BASE, (v) => {
        ensureChatApi(ctx.cfg).baseUrl = v.trim(); ctx.markDirty();
      }, 'url'),
      `預設為 ${DEFAULT_CHAT_BASE}`, true));
    g.appendChild(field('Email',
      txtInput(c ? c.email : '', 'JustAI 帳號 Email', (v) => {
        ensureChatApi(ctx.cfg).email = v.trim(); ctx.markDirty();
      })));
    g.appendChild(field('密碼',
      pwInput(c ? c.password : '', 'JustAI 帳號密碼', (v) => {
        ensureChatApi(ctx.cfg).password = v; ctx.markDirty();
      }),
      c && c.password ? '已設定，重打即覆蓋' : ''));
    // 左下＝申請帳號連結（另開分頁）；右下＝tiri 文字鈕（同對話框「建立」樣式）
    const apply = document.createElement('a');
    apply.className = 'foot-link';
    apply.href = 'https://chat.justhings.ai/login'; // 登入頁才有「立即註冊」
    apply.target = '_blank';
    apply.rel = 'noopener';
    apply.innerHTML = '申請 JustAI 帳號<i data-lucide="external-link"></i>'; // 另開分頁 icon 放右側
    foot.appendChild(apply);
    const test = btn('測試連線並載入客服清單', () => testChatApi(ctx.cfg));
    test.className = 'b-btn b-btn-text';
    foot.appendChild(test);
  });
}

/* 管理 PIN 卡（2026-09-07）：整條跨兩欄放在客服 API 與休眠卡之下，共用設定與單機設定都有。
 * 規則同 App PinSheet：只收數字、最長 8 碼；空白＝機器端用預設 PIN 0000。 */
function pinCard(ctx) {
  return settingsCard('管理 PIN', [
    '在機器畫面上長按或點角落進入管理畫面時要輸入的 PIN，與機器上「設定 → 管理 PIN」相同。',
    '只能輸入數字，最長 8 碼；留空＝使用預設 PIN 0000。',
  ], (g) => {
    const cur = typeof ctx.cfg.adminPin === 'string' ? ctx.cfg.adminPin : '';
    const wrap = pwInput(cur, '4～8 位數字', (v) => {
      const clean = String(v).replace(/\D/g, '').slice(0, 8);
      ctx.cfg.adminPin = clean; ctx.markDirty();
    });
    const inp = wrap.querySelector('input');
    inp.inputMode = 'numeric'; inp.autocomplete = 'off'; inp.maxLength = 8;
    inp.addEventListener('input', () => { const c = inp.value.replace(/\D/g, '').slice(0, 8); if (c !== inp.value) inp.value = c; });
    // 一排就好（2026-09-07 user 指示）：標題在左、輸入框在右，沒有欄位區也沒有說明字
    const card = g.parentElement;
    card.querySelector('.b-card-head').appendChild(wrap);
    g.remove();
  });
}

async function testChatApi(holder) {
  const c = holder.chatApi;
  if (!c || !c.baseUrl || !c.email || !c.password) return setStatus('請填寫伺服器位址、Email 和密碼後再測試連線。', true);
  try {
    const list = await api('POST', '/api/justai/agents', { baseUrl: c.baseUrl, email: c.email, password: c.password });
    agentCache = { key: agentKeyOf(c), list, loading: false, error: '' };
    setStatus(`連線成功。已載入 ${list.length} 個客服，可在版面的格子中選用。`);
  } catch (e) { setStatus('連線測試未成功。' + e.message, true); }
}

/* 休眠卡（2026-09-03 再改版＝共用版面同邏輯）：卡片只放固定 7 列清單（高度不再跳動），
 * 逐日的實際設定在「編輯」跳出的 modal 裡做；「每日相同」由 modal 的「套用到每天」取代。 */
function sleepCard(ctx) {
  return settingsCard('休眠時段', [
    '休眠時停止播放並顯示黑畫面；儲存發布後同步到機器（機器按「開始展示」後套用）。',
    '時段的開始時間晚於結束時間＝跨午夜，結束時間為隔日。',
  ], (g) => {
    const s = ctx.cfg.sleep || { enabled: false, sameEveryDay: false, periods: [] };
    const top = document.createElement('div');
    top.className = 'field full';
    top.appendChild(switchRow('啟用排程', !!s.enabled, (v) => {
      ensureSleep(ctx.cfg).enabled = v; ctx.markDirty();
      setTimeout(ctx.rerender, 220); // 先讓開關滑完動畫再重繪（重繪會重建 DOM、瞬間跳到終點）
    }));
    g.appendChild(top);
    const list = document.createElement('div');
    list.className = 'field full sleep-list' + (s.enabled ? '' : ' is-off');
    for (const [day, label] of SLEEP_DAY_LABELS) {
      const period = (s.periods || []).find((p) => p.day === day);
      const row = document.createElement('div');
      row.className = 'sleep-item';
      const name = document.createElement('span');
      name.className = 'sleep-day';
      name.textContent = label;
      const sum = document.createElement('span');
      sum.className = 'sleep-sum' + (period ? '' : ' is-none');
      sum.textContent = period
        ? `${minToTime(period.start)}～${minToTime(period.end)}${period.start >= period.end ? '（跨午夜）' : ''}`
        : '不休眠';
      const edit = document.createElement('button');
      edit.className = 'b-btn b-btn-xs';
      edit.textContent = '編輯';
      edit.onclick = () => editSleepDay(ctx, day, label);
      row.append(name, sum, edit);
      list.appendChild(row);
    }
    g.appendChild(list);
  });
}

/** 逐日編輯入口：跳 modal 設定 → 存回這一天（或套用到每天）。 */
async function editSleepDay(ctx, day, label) {
  const cur = ((ctx.cfg.sleep && ctx.cfg.sleep.periods) || []).find((p) => p.day === day);
  const r = await sleepDayDialog(label, cur ? { start: cur.start, end: cur.end } : null);
  if (!r) return;
  const s = ensureSleep(ctx.cfg);
  s.periods = s.periods || [];
  if (r.applyAll) {
    s.sameEveryDay = true;
    s.periods = r.period ? [1, 2, 3, 4, 5, 6, 7].map((d) => ({ day: d, ...r.period })) : [];
  } else {
    s.sameEveryDay = false;
    s.periods = s.periods.filter((p) => p.day !== day);
    if (r.period) s.periods.push({ day, ...r.period });
  }
  ctx.markDirty(); ctx.rerender();
}

/** 單日休眠設定 modal（殼照 pickDevicesDialog）。
 *  resolve null＝取消；{ applyAll, period }，period=null＝這天不休眠。 */
function sleepDayDialog(label, period) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'b-modal-overlay';
    overlay.setAttribute('data-modal-vue', '');
    overlay.setAttribute('data-modal-anim', 'vue');
    overlay.style.zIndex = '1600';

    const modal = document.createElement('div');
    modal.className = 'b-modal is-alert sleep-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const body = document.createElement('div');
    body.className = 'b-alert-body';
    const h = document.createElement('h2');
    h.className = 'b-alert-title';
    h.textContent = `${label}的休眠時段`;
    body.appendChild(h);

    let p = period ? { ...period } : null;

    const chkRow = document.createElement('label');
    chkRow.className = 'sleep-edit-check';
    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.className = 'b-switch'; chk.checked = !!p;
    chkRow.append(chk, document.createTextNode('這一天要休眠'));
    body.appendChild(chkRow);

    const timeRow = document.createElement('div');
    timeRow.className = 'sleep-edit-times';
    const mkTime = (isStart) => {
      const t = document.createElement('input');
      t.type = 'time'; t.className = 'b-input sleep-time';
      t.value = minToTime(p ? (isStart ? p.start : p.end) : (isStart ? DEFAULT_SLEEP_PERIOD().start : DEFAULT_SLEEP_PERIOD().end));
      t.onchange = () => { if (!p) return; if (isStart) p.start = timeToMin(t.value); else p.end = timeToMin(t.value); sync(); };
      return t;
    };
    const t1 = mkTime(true), t2 = mkTime(false);
    timeRow.append(t1, document.createTextNode('～'), t2);
    body.appendChild(timeRow);

    const cross = hint('跨午夜：結束時間為隔日。');
    cross.classList.add('sleep-edit-cross');
    body.appendChild(cross);

    const sync = () => {
      t1.disabled = t2.disabled = !p;
      timeRow.classList.toggle('is-off', !p);
      cross.style.visibility = p && p.start >= p.end ? 'visible' : 'hidden';
    };
    chk.onchange = () => {
      p = chk.checked ? { start: timeToMin(t1.value), end: timeToMin(t2.value) } : null;
      sync();
    };
    sync();

    const foot = document.createElement('div');
    foot.className = 'b-alert-foot';
    const mk = (cls, text) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = cls; b.textContent = text;
      foot.appendChild(b);
      return b;
    };
    const cancel = mk('b-btn b-btn-quiet', '取消');
    const applyAll = mk('b-btn b-btn-text', '套用到每天');
    const ok = mk('b-btn b-btn-text', '儲存');

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
    function onEsc(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close(null);
    }
    document.addEventListener('keydown', onEsc, true);
    cancel.onclick = () => close(null);
    ok.onclick = () => close({ applyAll: false, period: p });
    applyAll.onclick = () => close({ applyAll: true, period: p });
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === overlay) close(null);
    });

    document.body.appendChild(overlay);
    document.body.classList.add('b-modal-lock');
    overlay.classList.add('is-visible');
    void overlay.offsetWidth;
    overlay.classList.add('is-open');
  });
}

// ---------- 共用設定（側欄子選單兩頁：版面設定／機器設定；「套用」＝逐台發布部分 config） ----------
let shared = null;        // /api/shared-settings 的 settings 物件（全站一份；一般帳號只能改 sleep，其餘伺服器會保留現值）
let sharedDirty = false;

function setSharedDirty(v) { sharedDirty = v; }

/** 機器設定＝自動儲存（2026-09-03 指示拿掉儲存鈕）：改動後防抖 800ms 寫回；成功安靜、失敗跳錯。 */
let sharedSaveTimer = 0;
function scheduleSharedSave() {
  sharedDirty = true;
  clearTimeout(sharedSaveTimer);
  sharedSaveTimer = setTimeout(() => saveShared(true), 800);
}

async function saveShared(quiet) {
  clearTimeout(sharedSaveTimer);
  try {
    await api('PUT', '/api/shared-settings', { settings: shared || {} });
    setSharedDirty(false);
    if (!quiet) setStatus('已儲存。');
    return true;
  } catch (e) { setStatus('無法儲存共用設定。' + e.message, true); return false; }
}
$('addSharedLayoutBtn').addEventListener('click', () => addSharedLayout());
$('applySharedSettingsBtn').addEventListener('click', () => applySharedSettings());

// 側欄「共用設定」群組開闔由 kit.js 的 submenu 手風琴接管（這裡不能再綁，會互相抵銷）

async function ensureSharedLoaded() {
  if (shared !== null) return true;
  try {
    shared = (await api('GET', '/api/shared-settings')).settings || {};
    migrateSharedLayouts();
    return true;
  } catch (e) { setStatus('無法載入共用設定。' + e.message, true); return false; }
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

/** 共用設定 › 版面設定頁：具名版面清單。管理員：編輯／加入機器／更名／刪除；一般帳號：只有加入機器（2026-09-07 定案）。 */
async function renderSharedLayoutView() {
  if (!(await ensureSharedLoaded())) return;
  $('addSharedLayoutBtn').classList.toggle('hidden', !meIsAdmin);
  const tb = $('sharedLayoutTable').querySelector('tbody');
  clearListThumbs(); // 舊縮圖的輪播計時器
  tb.innerHTML = '';
  if (!shared.layouts.length) {
    tb.innerHTML =
      '<tr><td colspan="5"><div class="b-empty">' +
      '<span class="b-empty-icon"><i data-lucide="layout-template"></i></span>' +
      '<p class="b-empty-title">還沒有任何版面</p>' +
      '<p class="b-empty-sub">' + (meIsAdmin ? '點右上角「新增版面」開始設計，之後可以把版面加到任何機器。' : '請管理員先在這裡新增版面，之後就能把版面加入機器。') + '</p>' +
      '</div></td></tr>';
    if (window.lucide) lucide.createIcons();
    return;
  }
  for (const layout of shared.layouts) {
    const tr = document.createElement('tr');
    tr.className = 'device-row';
    const updated = layout.updatedAt ? new Date(layout.updatedAt).toLocaleString('zh-TW', { hour12: false }) : '';
    // 縮圖獨立欄（無標題、欄內置中）＋名稱獨立欄：與機器總覽同款（2026-09-07 指示）
    const thumbTd = document.createElement('td');
    thumbTd.className = 'device-thumb-col';
    const thumb = sharedLayoutThumb(layout);
    makeThumbZoomable(thumb, () => ({ page: layout.pages && layout.pages[0], screen: layout.screen }));
    thumbTd.appendChild(thumb);
    tr.appendChild(thumbTd);
    const nameTd = document.createElement('td');
    nameTd.className = 'b-th';
    nameTd.textContent = layout.name || '未命名版面';
    tr.appendChild(nameTd);
    tr.insertAdjacentHTML('beforeend', `<td>${esc(layout.createdBy || '—')}</td><td class="num">${updated}</td>`);

    const opTd = document.createElement('td');
    opTd.className = 'device-ops';
    const mkBtn = (cls, html, onclick) => {
      const b = document.createElement('button');
      b.className = cls; b.innerHTML = html; b.onclick = onclick;
      opTd.appendChild(b);
      return b;
    };
    if (meIsAdmin) mkBtn('b-btn', '編輯', () => enterSharedLayoutEditor(layout));
    mkBtn('b-btn b-btn-primary', '加入機器', () => applySharedLayout(layout));
    if (meIsAdmin) {
      mkBtn('b-btn', '更名', () => renameSharedLayout(layout));
      mkBtn('b-btn b-btn-text b-btn-text-danger', '刪除', () => deleteSharedLayout(layout));
    }
    tr.appendChild(opTd);
    // 列＝純資訊（同機器總覽 2026-09-03 指示）：不可點，入口只有操作鈕
    tb.appendChild(tr);
  }
  if (window.lucide) lucide.createIcons();
}

/** 版面小縮圖：照第一頁的區塊結構縮排（純色底色／第一張遠端底圖；比例照 screen，
 *  預設直式 9:16）。只畫結構不畫內容——夠認得出是哪個版面就好。 */
// ---------- 縮圖預覽（2026-09-07）：點縮圖→從縮圖位置放大成真實動態預覽；關閉→縮回縮圖 ----------
let thumbPreview = null; // { rerender, close }

/** 讓縮圖可點開預覽：hover 微放大（CSS .is-zoomable），點擊開 overlay。 */
function makeThumbZoomable(thumbEl, getData) {
  thumbEl.classList.add('is-zoomable');
  thumbEl.title = '點擊放大預覽';
  thumbEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (thumbPreview) return;
    const d = getData();
    if (!d || !d.page) return;
    openThumbPreview(thumbEl, d.page, d.screen);
  });
}

function openThumbPreview(thumbEl, pg, screen) {
  const ov = document.createElement('div');
  ov.className = 'thumb-preview';
  const canvas = document.createElement('div');
  canvas.className = 'canvas tp-canvas';
  ov.appendChild(canvas);
  document.body.appendChild(ov);
  let timers = [];
  const rerender = () => {
    timers.forEach(clearInterval); timers = [];
    buildCanvas(canvas, pg, screen, { readonly: true, timers });
    fitPreview(canvas);
  };
  rerender();

  // FLIP：先量好終點（置中的大畫布），把它 transform 到縮圖的位置/大小，下一幀放開 → 看起來從縮圖長出來
  const layoutRect = () => ({ width: canvas.offsetWidth, height: canvas.offsetHeight, cx: window.innerWidth / 2, cy: window.innerHeight / 2 });
  const from = thumbEl.getBoundingClientRect();
  const to = layoutRect();
  const sx = from.width / to.width, sy = from.height / to.height;
  const dx = from.left + from.width / 2 - to.cx;
  const dy = from.top + from.height / 2 - to.cy;
  const shrunk = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  canvas.style.transition = 'none';
  canvas.style.transform = shrunk;
  thumbEl.classList.add('is-previewing'); // 原縮圖先隱形：畫面「飛出去」了
  requestAnimationFrame(() => requestAnimationFrame(() => {
    canvas.style.transition = '';
    canvas.style.transform = 'none';
    ov.classList.add('is-open');
    fitPreview(canvas); // 跑馬燈用實際尺寸重算
  }));

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    // 縮圖可能已被重畫（列表重新 render）：找不到就直接淡出
    const f = thumbEl.isConnected ? thumbEl.getBoundingClientRect() : null;
    const t = layoutRect();
    if (f) {
      const sx2 = f.width / t.width, sy2 = f.height / t.height;
      const dx2 = f.left + f.width / 2 - t.cx;
      const dy2 = f.top + f.height / 2 - t.cy;
      canvas.style.transform = `translate(${dx2}px, ${dy2}px) scale(${sx2}, ${sy2})`;
    } else canvas.style.opacity = '0';
    ov.classList.remove('is-open');
    ov.classList.add('is-closing');
    const done = () => {
      timers.forEach(clearInterval);
      ov.remove();
      thumbEl.classList.remove('is-previewing');
      document.removeEventListener('keydown', onKey, true);
      thumbPreview = null;
    };
    setTimeout(done, 260);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('click', close);
  thumbPreview = { rerender, close };
}

/** 列表縮圖（機器總覽／版面清單共用）＝該頁真實畫面的縮小版：
 *  同預覽用 buildCanvas 唯讀版畫在 480px 高的畫布上，再 transform 縮到 56px 高（2026-09-08 改；
 *  原本只照結構鋪底色，看不出機器實際顯示的文字/天氣/圖片，user 回報「縮圖沒有跟機器一樣，點開才有」）。
 *  輪播計時器收進 listThumbTimers，列表重畫時一起清；天氣更新時透過 el._rerender 重畫。 */
let listThumbTimers = [];
function clearListThumbs() { listThumbTimers.forEach(clearInterval); listThumbTimers = []; }
function sharedLayoutThumb(layout) {
  const box = document.createElement('div');
  box.className = 'layout-thumb';
  const scr = layout.screen && layout.screen.w > 0 && layout.screen.h > 0 ? layout.screen : { w: 1080, h: 1920 };
  const ratio = scr.w / scr.h;
  const thumbH = 56, thumbW = Math.max(20, Math.min(100, Math.round(thumbH * ratio)));
  box.style.width = thumbW + 'px';
  const pg = layout.pages && layout.pages[0];
  if (!pg) { box.classList.add('is-blank'); return box; }
  const canvas = document.createElement('div');
  canvas.className = 'canvas lt-canvas';
  const VH = 480, VW = Math.round(VH * ratio);
  const scale = Math.min(thumbH / VH, thumbW / VW);
  canvas.style.width = VW + 'px';
  canvas.style.height = VH + 'px';
  canvas.style.transform = `translate(${(thumbW - VW * scale) / 2}px, ${(thumbH - VH * scale) / 2}px) scale(${scale})`;
  box.appendChild(canvas);
  const rerender = () => {
    buildCanvas(canvas, pg, scr, { readonly: true, timers: listThumbTimers });
    canvas.style.aspectRatio = ''; // 尺寸已明確給定，不要讓 aspect-ratio 介入
    fitPreview(canvas);
  };
  box._rerender = rerender;
  // 先掛進 DOM 再量字級：buildCanvas 立刻畫，fitPreview 要等排版（offsetWidth）
  requestAnimationFrame(rerender);
  return box;
}

/** 新增版面：取名 → 存進清單 → 直接開編輯器設計。 */
async function addSharedLayout() {
  if (!(await ensureSharedLoaded())) return;
  const name = await BDialog.prompt({
    title: '新增版面', desc: '為這個版面取個名字。',
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
  catch (e) { shared.layouts.pop(); return setStatus('無法建立版面。' + e.message, true); }
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
  catch (e) { layout.name = prev; return setStatus('無法更名。' + e.message, true); }
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
  catch (e) { shared.layouts.splice(idx, 0, layout); return setStatus('無法刪除版面。' + e.message, true); }
  renderSharedLayoutView();
}

/** 把一個版面「加入」勾選的機器：頁面附加在該機現有頁面後面（不覆蓋），逐台發布。 */
async function applySharedLayout(layout) {
  if (!layout.pages || !layout.pages.length) return;
  const name = layout.name || '未命名版面';
  await appendPagesToDevices({
    pages: layout.pages, screen: layout.screen, fallbackName: layout.name || '', layoutId: layout.id,
    title: `把「${name}」加入機器`,
    desc: '會把這個版面加成所選機器的新頁面（接在現有頁面後面）並立即發布；機器原有的頁面與設定都不會被改動。',
    noTargetsTitle: '沒有機器', noTargetsDesc: '目前帳號下沒有任何機器。',
    verb: `把「${name}」加入`,
  });
}

/** 把一組頁面「接在」所選機器現有頁面後面並發布（版面設定「加入機器」與工作區「加到其他機器」共用）。
 *  opts = { pages, screen, fallbackName, layoutId?, excludeDeviceId?, title, desc, noTargetsTitle, noTargetsDesc, verb }
 *  layoutId＝來源版面 id（版面設定「加入機器」才有）：打在每一頁上，機器總覽「展示版面」靠它認出這台機器裡哪一頁是那個版面；
 *  工作區「加到其他機器」不傳（頁上原本有記號會跟著深拷貝過去）。 */
async function appendPagesToDevices(opts) {
  const srcPages = opts.pages || [];
  if (!srcPages.length) return;
  let devices;
  try { devices = await api('GET', '/api/devices'); } catch (e) { return setStatus('無法取得機器清單。' + e.message, true); }
  if (opts.excludeDeviceId) devices = devices.filter((d) => d.DeviceId !== opts.excludeDeviceId);
  if (!devices.length) return BDialog.alert({ title: opts.noTargetsTitle, desc: opts.noTargetsDesc });
  const srcPortrait = !opts.screen || opts.screen.h >= opts.screen.w;
  const infos = await Promise.all(devices.map(async (d) => {
    try {
      const cfg = await api('GET', `/api/config/${encodeURIComponent(d.DeviceId)}`);
      const scr = cfg.config.screen;
      const pages = cfg.config.pages || [];
      const warns = [];
      if ((!scr || scr.h >= scr.w) !== srcPortrait) warns.push('⚠ 螢幕方向不同');
      if (pages.length + srcPages.length > MAX_PAGES) warns.push(`⚠ 加入後超過 ${MAX_PAGES} 頁上限`);
      return { d, warn: warns.join('　'), pages };
    } catch { return { d, warn: '', pages: [] }; }
  }));
  const picked = await pickDevicesDialog({ title: opts.title, desc: opts.desc, confirmText: '加入並發布', items: infos });
  if (!picked || !picked.length) return;

  const done = [];
  const failed = [];
  for (const d of picked) {
    const info = infos.find((i) => i.d === d);
    const existing = info ? info.pages : [];
    if (existing.length + srcPages.length > MAX_PAGES) {
      failed.push(`${d.DeviceName || d.DeviceId}（超過 ${MAX_PAGES} 頁上限）`);
      continue;
    }
    // 頁面 id 在同一台機器的 config 裡要唯一 → 附加時重新編號；
    // 頁面沒取名就帶版面名，機器的頁籤/admin-pager 上才認得出來
    const appended = stampAppendedPages(srcPages, existing, opts.fallbackName, opts.layoutId);
    try {
      await api('PUT', `/api/config/${encodeURIComponent(d.DeviceId)}`, { config: { pages: [...existing, ...appended] }, reason: { type: 'appendLayout', layoutName: opts.fallbackName || '' } });
      done.push(d);
    } catch { failed.push(d.DeviceName || d.DeviceId); }
  }
  reportBatch(done, failed, opts.verb);
}

/** 準備要接在某台機器後面的頁面：深拷貝、重新編 id（同一台機器裡頁 id 要唯一）、沒取名就帶版面名
 *  （機器的頁籤/admin-pager 上才認得出來）、有來源版面就打上 layoutId。「加入機器」與「展示版面」共用。 */
function stampAppendedPages(srcPages, existing, fallbackName, layoutId) {
  let nextId = Math.max(0, ...existing.map((p) => p.id || 0));
  return JSON.parse(JSON.stringify(srcPages)).map((p) => ({
    ...p, id: ++nextId, name: p.name || fallbackName || '',
    ...(layoutId ? { layoutId } : {}),
  }));
}

/** 共用設定 › 機器設定頁：共用的客服帳號＋休眠卡片。 */
async function renderSharedSettingsView() {
  if (!(await ensureSharedLoaded())) return;
  const body = $('sharedBody');
  body.innerHTML = '';
  const ctx = { cfg: shared, markDirty: scheduleSharedSave, rerender: renderSharedSettingsView };
  const chat = body.appendChild(chatApiCard(ctx));
  body.appendChild(sleepCard(ctx));
  const pin = body.appendChild(pinCard(ctx));
  pin.classList.add('settings-card-full');
  if (window.BDropdown) BDropdown.init(body);
  if (!meIsAdmin) { lockSettingsCard(chat); lockSettingsCard(pin); } // 一般帳號只能改休眠排程（2026-09-07 定案）
  if (window.lucide) lucide.createIcons(); // 密碼欄眼睛鈕
}

/** 把設定卡鎖成唯讀（限管理員）：欄位全部 disabled、淡化、標題旁掛「限管理員」徽章。伺服器端也擋，這裡只是誠實呈現。 */
function lockSettingsCard(card) {
  card.classList.add('is-locked');
  card.querySelectorAll('input, select, textarea, button').forEach((el) => { if (!el.closest('.page-help')) el.disabled = true; });
  const badge = document.createElement('span');
  badge.className = 'b-badge neutral settings-lock-badge';
  badge.textContent = '限管理員';
  card.querySelector('.card-title-wrap').appendChild(badge);
}

async function applySharedSettings() {
  if (!shared.chatApi && !shared.sleep && !shared.adminPin) return setStatus('請先設定客服帳號、休眠時段或管理 PIN，再套用到機器。', true);
  if (sharedDirty && !(await saveShared(true))) return; // 自動存檔還沒跑完就先 flush，套用的內容＝存下來的內容
  let devices;
  try { devices = await api('GET', '/api/devices'); } catch (e) { return setStatus('無法取得機器清單。' + e.message, true); }
  if (!devices.length) return BDialog.alert({ title: '沒有機器', desc: '目前帳號下沒有任何機器。' });
  const picked = await pickDevicesDialog({
    title: '套用共用設定到機器',
    desc: '會以共用的客服帳號、休眠時段與管理 PIN 覆蓋所選機器並立即發布；版面不受影響。',
    confirmText: '套用並發布',
    items: devices.map((d) => ({ d })),
  });
  if (!picked || !picked.length) return;
  const partial = {};
  if (shared.chatApi) partial.chatApi = shared.chatApi;
  if (shared.sleep) partial.sleep = shared.sleep;
  if (shared.adminPin) partial.adminPin = shared.adminPin; // 共用 PIN 留空＝不覆蓋機器的 PIN
  await publishToDevices(picked, partial, '套用到');
}

// ---------- 側邊欄：功能切換（navbar 只放全局操作） ----------
// 目前頁記在網址 hash（#devices／#sharedLayout／#sharedSettings／#users），重新整理不會被打回機器總覽。
// 用 replaceState 不留歷史紀錄：上一頁仍是離開後台，不是在四個頁籤間倒退。
const VIEWS = ['devices', 'sharedLayout', 'sharedSettings', 'users'];
function restoreView() {
  const want = location.hash.slice(1);
  if (!VIEWS.includes(want)) return 'devices';
  if (want === 'users' && !meIsAdmin) return 'devices'; // 非管理員沒有帳號管理
  return want;
}
function switchView(view) {
  history.replaceState(null, '', '#' + view);
  document.querySelectorAll('.sidebar .nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  // 所屬群組（共用設定）跟著展開：kit 的手風琴只在載入時看 .active 一次，之後由這裡補
  const activeSub = document.querySelector('.sidebar .submenu .nav-item.active');
  if (activeSub) {
    const sub = activeSub.closest('.submenu');
    sub.classList.add('show');
    if (sub.previousElementSibling?.classList.contains('submenu-toggle')) sub.previousElementSibling.classList.add('open');
  }
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
// ---------- 使用說明 modal（照抄 tiri base.html：開闔＋章節導覽 scroll-spy；shell 層級，任何頁都能開） ----------
(function () {
  const overlay = $('guideModal');
  const modal = overlay.querySelector('.b-modal');
  const content = $('gd-scroll');
  const closeBtn = $('gd-close');
  const navBtns = Array.from(overlay.querySelectorAll('.gd-nav button'));
  const secs = navBtns.map((b) => $('gd-sec-' + b.dataset.gdSec));
  let lastFocus = null;
  let spyLockUntil = 0; // 點章節的平滑捲動播放中，scroll-spy 先不搶 active

  const setActive = (key) => navBtns.forEach((b) => b.classList.toggle('active', b.dataset.gdSec === key));

  content.addEventListener('scroll', () => {
    if (Date.now() < spyLockUntil) return;
    // 捲到底時直接亮最後一章（末章太短時 offsetTop 永遠到不了判定線）
    if (content.scrollTop + content.clientHeight >= content.scrollHeight - 4) { setActive(navBtns[navBtns.length - 1].dataset.gdSec); return; }
    const line = content.scrollTop + 32;
    let cur = secs[0];
    secs.forEach((s) => { if (s && s.offsetTop <= line) cur = s; });
    setActive(cur.id.replace('gd-sec-', ''));
  }, { passive: true });

  navBtns.forEach((b) => b.addEventListener('click', () => {
    const sec = $('gd-sec-' + b.dataset.gdSec);
    if (!sec) return;
    setActive(b.dataset.gdSec);
    spyLockUntil = Date.now() + 650;
    content.scrollTo({ top: Math.max(0, sec.offsetTop - 16) }); // CSS scroll-behavior:smooth 補間
  }));

  window.openGuideModal = function (sectionKey) {
    lastFocus = document.activeElement;
    overlay.classList.remove('is-closing');
    overlay.classList.add('is-visible');
    document.body.classList.add('b-modal-lock');
    if (window.lucide) lucide.createIcons({ nodes: [overlay] });
    // 起始章節：定位不播平滑捲動（開場就在該章，不是「捲過去」）
    const target = sectionKey ? $('gd-sec-' + sectionKey) : null;
    spyLockUntil = Date.now() + 250;
    content.style.scrollBehavior = 'auto';
    content.scrollTop = target ? Math.max(0, target.offsetTop - 16) : 0;
    content.style.scrollBehavior = '';
    setActive(sectionKey || navBtns[0].dataset.gdSec);
    closeBtn.focus();
  };
  function closeGuide() {
    if (!overlay.classList.contains('is-visible') || overlay.classList.contains('is-closing')) return;
    overlay.classList.add('is-closing');
    overlay.addEventListener('animationend', function h(e) {
      if (e.target !== overlay) return;
      overlay.removeEventListener('animationend', h);
      overlay.classList.remove('is-visible', 'is-closing');
      if (!$('wsModal').classList.contains('is-visible')) document.body.classList.remove('b-modal-lock'); // 工作區開著時鎖要留著
    });
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  closeBtn.addEventListener('click', closeGuide);
  overlay.addEventListener('click', (e) => { if (!modal.contains(e.target)) closeGuide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('is-visible')) closeGuide(); }, true);
  $('manualLink').addEventListener('click', () => window.openGuideModal());
})();

// ---------- 機器總覽（首頁列表） ----------
/** 上線狀態文字：機器每 ~25 秒會回來掛長輪詢，60 秒內有露面就當在線。 */
function statusCell(d) {
  // tiri 收件列表同款：狀態＝b-badge 帶小圓點（在線綠 / 離線灰），離線附「多久沒回報」
  const td = document.createElement('td');
  const badge = document.createElement('span');
  const dot = document.createElement('span');
  dot.className = 'dot';
  badge.appendChild(dot);
  if (d.LastSeenAgoSec == null) {
    badge.className = 'b-badge neutral';
    badge.append('尚未回報');
    badge.title = '伺服器啟動後這台機器還沒連線過';
  } else if (d.LastSeenAgoSec < 60) {
    badge.className = 'b-badge ok';
    badge.append('在線');
  } else {
    badge.className = 'b-badge neutral';
    badge.append(`離線 ${agoText(d.LastSeenAgoSec)}`);
  }
  td.appendChild(badge);
  const conn = connIcon(d);
  if (conn) td.appendChild(conn);
  return td;
}
/** 連線設定檢查（2026-09-08 指示）：機器每次連線自報「自己填的伺服器位址」，後台比對是不是本站；
 *  金鑰填錯的連線也會留下紀錄。顯示成狀態 badge 旁的一顆 icon（2026-09-08 改：原本第二顆 badge 太吵）：
 *  設定正確＝綠勾／連到別的伺服器＝黃 unplug／金鑰不符＝紅鑰匙；hover 顯示完整說明。
 *  舊版 App（<1.13）不會自報位址，沒東西可比就不顯示。 */
function connIcon(d) {
  let cls, icon, title, body;
  if (d.KeyMismatch) {
    cls = 'danger'; icon = 'key-round'; title = '金鑰不符';
    body = '這台機器最近用錯誤的連線金鑰連上來。請到機器的「雲端同步」重新填入本站的連線金鑰。';
  } else if (d.ServerMatch === false) {
    cls = 'warning'; icon = 'unplug'; title = `連到別的伺服器（${shortServer(d.LastServerUrl)}）`;
    body = `機器填的伺服器位址是 ${d.LastServerUrl}，不是本站，在這裡做的變更不會送到機器。請到機器的「雲端同步」按「一鍵填入正式伺服器」。`;
  } else if (d.ServerMatch === true) {
    // 綠勾只在「在線」時顯示（2026-09-09）：這筆是機器最後一次連上本站時自報的，離線後它若改連別台伺服器，
    // 本站不會再收到任何回報、無從得知，掛著綠勾會誤導（user 實測：手機切去正式站，這裡仍顯示設定正確）。
    // 黃／紅警告照舊離線也顯示——那是最後一次接觸時就看到的問題，值得留著。
    if (!(d.LastSeenAgoSec < 60)) return null;
    cls = 'ok'; icon = 'circle-check'; title = '連線設定正確';
    body = `伺服器位址與連線金鑰都是本站的。${d.LastAppVersion ? `\nApp v${d.LastAppVersion}` : ''}`;
  } else {
    return null;
  }
  const el = document.createElement('span');
  el.className = `conn-icon ${cls}`;
  el.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
  el.setAttribute('aria-label', `${title}。${body}`);
  attachTip(el, title, body, cls);
  return el;
}
/** hover 說明面板（page-help 同款外觀；掛在 body、fixed 定位，不會被表格捲動容器裁掉）：
 *  錨在元素下方 8px、左緣對齊元素；右邊貼到視窗就往內縮，下面放不下就改開在上方。 */
function attachTip(el, title, body, cls) {
  let tip = null;
  const hide = () => { if (tip) { tip.remove(); tip = null; } };
  el.addEventListener('mouseenter', () => {
    hide();
    tip = document.createElement('div');
    tip.className = 'b-tip' + (cls ? ' ' + cls : '');
    tip.innerHTML = `<p class="b-pop-panel-title">${esc(title)}</p>` + body.split('\n').map((t) => `<p>${esc(t)}</p>`).join('');
    document.body.appendChild(tip);
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
    let y = r.bottom + 8;
    if (y + h > window.innerHeight - 8) { y = r.top - h - 8; tip.style.transformOrigin = 'bottom left'; }
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
    requestAnimationFrame(() => tip && tip.classList.add('is-on'));
  });
  el.addEventListener('mouseleave', hide);
}
/** 位址縮短顯示：只留 host[:port]，例 http://192.168.1.142:3177 → 192.168.1.142:3177 */
function shortServer(u) {
  try { const x = new URL(u); return x.host; } catch { return String(u || '').replace(/^https?:\/\//i, ''); }
}
function agoText(sec) {
  if (sec < 90) return `${Math.round(sec)} 秒`;
  const m = sec / 60;
  if (m < 90) return `${Math.round(m)} 分鐘`;
  const h = m / 60;
  if (h < 36) return `${Math.round(h)} 小時`;
  return `${Math.round(h / 24)} 天`;
}

$('devicesReloadBtn').addEventListener('click', async () => {
  const b = $('devicesReloadBtn');
  if (b.classList.contains('is-busy')) return;
  b.classList.add('is-busy');
  try { await renderDevicesView(); } finally { setTimeout(() => b.classList.remove('is-busy'), 400); }
});

async function renderDevicesView() {
  const devices = await api('GET', '/api/devices');

  const tb = $('deviceTable').querySelector('tbody');
  clearListThumbs(); // 舊縮圖的輪播計時器
  tb.innerHTML = '';
  $('deviceTable').classList.toggle('is-empty', !devices.length); // 空狀態不留光禿表頭
  if (!devices.length) {
    // tiri 規範：空清單不留光禿表頭，換 b-empty 空狀態
    tb.innerHTML =
      '<tr><td colspan="6"><div class="b-empty">' +
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
    // 縮圖欄（無標題、欄內置中）＝該機「目前展示頁」結構縮圖（沿用版面清單的 sharedLayoutThumb）；
    // 名稱獨立一欄（2026-09-07 指示：不同螢幕比例的縮圖寬度不一，同格會把名稱推歪）
    const thumbTd = document.createElement('td');
    thumbTd.className = 'device-thumb-col';
    const thumb = sharedLayoutThumb({ screen: d.Screen, pages: d.ActivePage ? [d.ActivePage] : [] });
    makeThumbZoomable(thumb, () => ({ page: d.ActivePage, screen: d.Screen }));
    thumbTd.appendChild(thumb);
    tr.appendChild(thumbTd);
    const nameTd = document.createElement('td');
    nameTd.className = 'b-th';
    nameTd.textContent = d.DeviceName || d.DeviceId;
    tr.appendChild(nameTd);
    tr.insertAdjacentHTML('beforeend',
      `<td class="device-id-dim device-mono">${esc(d.DeviceId)}</td>` +
      `<td class="num device-id-dim">${updated}</td>`);
    tr.appendChild(statusCell(d));
    // 「版本」「屬於（帳號分配）」欄先不放（2026-09-03 指示）；
    // 分配 API（PUT /api/devices/:id/owner）與後端過濾邏輯保留，之後要加回來只補 UI

    const opTd = document.createElement('td');
    opTd.className = 'device-ops';
    const manage = document.createElement('button');
    manage.className = 'b-btn b-btn-text'; manage.textContent = '內容管理'; // 主要動作＝主題色文字鈕（同帳號管理「更名」）
    manage.onclick = () => enterWorkspace(d);
    opTd.appendChild(manage);
    // 更名（2026-09-07 指示）：網頁上直接改機器名稱，走 PUT config 的部分更新（只帶 deviceName），
    // 伺服器同步更新 DeviceName 欄並叫醒機器，機器拉回後把名稱寫進自己的雲端同步設定（v1.12 起）
    const rename = document.createElement("button");
    rename.className = "b-btn b-btn-text"; rename.textContent = "更名";
    rename.onclick = () => renameDevice(d);
    opTd.appendChild(rename);
    // 刪除不放列表（2026-09-07 指示）：在該機器工作區「機器設定」頁籤最下面的危險區域（dangerZoneCard）
    tr.appendChild(opTd);
    // 整列點擊已移除（2026-09-03 指示）：列是純資訊，入口只有「內容管理」鈕
    tb.appendChild(tr);
  }
  // BDropdown.init 移除：表格裡已無 select（原本是「屬於」的分配下拉）
  if (window.lucide) lucide.createIcons();
}

// ---------- 機器總覽 › 展示版面（2026-09-09 批量展示，精靈式 modal） ----------
// 按鈕 → 第 1 步勾機器 → 下一步 → 第 2 步單選共用版面（每個版面標出這幾台的狀況）→ 完成：
// 每台各自切到「自己清單裡的那一頁」並進入展示模式（走單機「在機器上展示此頁」同一條路：PUT 帶 activePage，
// 伺服器蓋章 web，App v1.20+ 收到就切頁）。還沒有那個版面的機器先把版面接在最後面再切過去（同一次 PUT 同時帶
// pages 與 activePage）。認頁靠加入時打的 layoutId，頁名＝版面名當備援（findLayoutPage）。
$('showLayoutBtn').addEventListener('click', () => showLayoutWizard());

/** 步驟進度條：「① 選擇機器 ─── ② 選擇版面」；set(n) 把第 n 步點亮、前面的打勾、連接線填色。 */
function wizardSteps(labels) {
  const el = document.createElement('div');
  el.className = 'wiz-steps';
  const nodes = labels.map((t, i) => {
    const s = document.createElement('div');
    s.className = 'wiz-step';
    s.innerHTML = `<span class="wiz-n">${i + 1}</span><span class="wiz-t">${esc(t)}</span>`;
    return s;
  });
  nodes.forEach((s, i) => {
    if (i) { const bar = document.createElement('span'); bar.className = 'wiz-bar'; el.appendChild(bar); }
    el.appendChild(s);
  });
  return {
    el,
    set(n) {
      nodes.forEach((s, i) => {
        s.classList.toggle('is-active', i + 1 === n);
        s.classList.toggle('is-done', i + 1 < n);
        s.querySelector('.wiz-n').innerHTML = i + 1 < n ? '<i data-lucide="check" aria-hidden="true"></i>' : String(i + 1);
      });
      el.querySelectorAll('.wiz-bar').forEach((b, i) => b.classList.toggle('is-done', i + 2 <= n));
      if (window.lucide) lucide.createIcons();
    },
  };
}

/** 精靈裡的可勾選表格列：點列任何地方＝切換該列的勾選/單選（點到 input 本身交給瀏覽器）；
 *  onPick(input) 在勾選狀態改變後呼叫。disabled 的列淡化不可點。 */
function pickTableRow(input, cells, disabled, onPick) {
  const tr = document.createElement('tr');
  tr.className = 'pick-row' + (disabled ? ' is-disabled' : '');
  const td = document.createElement('td');
  td.className = 'pick-col';
  input.disabled = !!disabled;
  td.appendChild(input);
  tr.appendChild(td);
  for (const c of cells) tr.appendChild(c);
  const sync = () => tr.classList.toggle('is-selected', input.checked);
  input.addEventListener('change', () => { sync(); onPick(input); });
  tr.addEventListener('click', (e) => {
    if (disabled || e.target === input || e.target.closest('input, button, a')) return;
    if (input.type === 'radio' && input.checked) return;
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  sync();
  return tr;
}
function tdText(text, cls) {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  td.textContent = text;
  return td;
}

/** 批量調整展示畫面精靈（2026-09-09 改版：整張表格、固定尺寸、表頭全選）：
 *  第 1 步＝機器表（勾選／名稱／編號／最後更新／狀態，同機器總覽但無縮圖與操作區）、
 *  第 2 步＝版面表（單選／縮圖／名稱／建立者／更新時間／這幾台的狀況，同版面設定但無操作區）。
 *  回傳 { layout, plan }（plan＝每台機器的計畫，見 planLayoutShow）或 null（取消）。 */
function showLayoutWizardDialog(devices, layouts) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'b-modal-overlay';
    overlay.setAttribute('data-modal-vue', '');   // 同 pickDevicesDialog：別讓殼層 modal JS 接管
    overlay.setAttribute('data-modal-anim', 'vue');
    overlay.style.zIndex = '1600';
    const modal = document.createElement('div');
    modal.className = 'b-modal is-batch';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    // 標題列：左＝標題＋副標（目前步驟說明），右＝步驟進度條
    const head = document.createElement('div');
    head.className = 'b-modal-head';
    const info = document.createElement('div');
    info.className = 'batch-head-info';
    const h = document.createElement('h3');
    h.className = 'b-modal-title';
    h.textContent = '批量調整展示畫面';
    // 標題旁 ?＝使用說明（同各頁標題旁的 page-help：hover 展開、點擊釘住）；副標只留一句步驟提示
    const help = document.createElement('div');
    help.className = 'b-pop page-help';
    help.innerHTML =
      '<button type="button" class="page-help-btn" data-pop aria-label="使用說明" aria-haspopup="true"><i data-lucide="circle-help"></i></button>' +
      '<div class="b-pop-panel page-help-panel">' +
      '<p class="b-pop-panel-title">使用說明</p>' +
      '<p>勾選機器後按「下一步」挑一個共用版面，按「完成」這幾台就會一起切換到那個版面並進入展示模式。</p>' +
      '<p>機器裡已經有這個版面時直接切到那一頁；還沒有的會先把版面接在現有頁面後面再切換，頁數滿了就無法加入。</p>' +
      '<p>版面在後台改過的話，機器上那一頁會一併更新成目前的版面內容（機器上對那一頁做過的修改會被蓋掉），狀況欄會先標出哪幾台會更新。</p>' +
      '<p>「上一步」會保留勾選；中途關閉不會改動任何機器。</p>' +
      '</div>';
    const helpBtn = help.querySelector('[data-pop]');
    helpBtn.addEventListener('click', (e) => { // kit 的 .b-pop 只在載入時綁，動態建的自己接同一套開合
      e.stopPropagation();
      const open = !help.classList.contains('is-open');
      help.classList.toggle('is-open', open);
      helpBtn.setAttribute('aria-expanded', String(open));
    });
    const titleWrap = document.createElement('div');
    titleWrap.className = 'batch-title-wrap';
    titleWrap.append(h, help);
    const sub = document.createElement('p');
    sub.className = 'b-modal-sub';
    info.append(titleWrap, sub);
    const steps = wizardSteps(['選擇機器', '選擇版面']);
    head.append(info, steps.el);

    // 內容：固定高度的表格區，換步驟只換表格內容，modal 尺寸不變
    const body = document.createElement('div');
    body.className = 'b-modal-body';
    const scroll = document.createElement('div');
    scroll.className = 'b-tbl-scroll';
    const table = document.createElement('table');
    table.className = 'b-tbl';
    scroll.appendChild(table);
    body.appendChild(scroll);

    const foot = document.createElement('div');
    foot.className = 'b-modal-foot';
    const back = document.createElement('button');
    back.type = 'button'; back.className = 'b-btn b-btn-quiet';
    const next = document.createElement('button');
    next.type = 'button'; next.className = 'b-btn b-btn-text';
    foot.append(back, next);
    modal.append(head, body, foot);
    overlay.appendChild(modal);

    const selected = new Set(); // 第 1 步勾選的機器（回上一步保留）
    let infos = null;           // 第 2 步：所選機器的整份設定
    let plans = null;           // Map(layout → plan)
    let pickedLayout = null;
    let step = 0;
    const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-TW', { hour12: false }) : '');

    function renderStep1() {
      step = 1; steps.set(1);
      sub.textContent = '第 1 步：勾選要一起切換畫面的機器。';
      clearListThumbs();
      table.innerHTML = '';
      const thead = document.createElement('thead');
      const hr = document.createElement('tr');
      const all = document.createElement('input');
      all.type = 'checkbox'; all.setAttribute('aria-label', '全選機器');
      const allTh = document.createElement('th');
      allTh.className = 'pick-col';
      allTh.appendChild(all);
      hr.appendChild(allTh);
      hr.insertAdjacentHTML('beforeend', '<th>名稱</th><th>編號</th><th>最後更新</th><th>狀態</th>');
      thead.appendChild(hr);
      const tbody = document.createElement('tbody');
      const boxes = [];
      const syncAll = () => {
        const n = boxes.filter((b) => b.checked).length;
        all.checked = !!boxes.length && n === boxes.length;
        all.indeterminate = n > 0 && n < boxes.length;
        next.disabled = !n;
      };
      for (const d of devices) {
        const c = document.createElement('input');
        c.type = 'checkbox'; c.checked = selected.has(d);
        c.setAttribute('aria-label', `選取「${d.DeviceName || d.DeviceId}」`);
        boxes.push(c);
        tbody.appendChild(pickTableRow(c, [
          tdText(d.DeviceName || d.DeviceId, 'b-th'),
          tdText(d.DeviceId, 'device-id-dim device-mono'),
          tdText(fmtTime(d.UpdatedAt), 'num device-id-dim'),
          statusCell(d),
        ], false, () => { if (c.checked) selected.add(d); else selected.delete(d); syncAll(); }));
      }
      all.addEventListener('change', () => {
        const on = all.checked; // 先抓目標值：每列的 change 會跑 syncAll 改寫 all.checked，不能在迴圈裡直接讀
        for (const b of boxes) { if (b.checked !== on) { b.checked = on; b.dispatchEvent(new Event('change', { bubbles: true })); } }
        syncAll();
      });
      table.append(thead, tbody);
      if (window.lucide) lucide.createIcons();
      back.textContent = '取消'; next.textContent = '下一步';
      syncAll();
    }
    function renderStep2() {
      step = 2; steps.set(2);
      sub.textContent = `第 2 步：選擇要在這 ${selected.size} 台機器上展示的共用版面。`;
      clearListThumbs();
      table.innerHTML = '';
      table.insertAdjacentHTML('beforeend',
        '<thead><tr><th class="pick-col"></th><th class="device-thumb-col"></th><th>名稱</th><th>建立者</th><th>更新時間</th><th>狀況</th></tr></thead>');
      const tbody = document.createElement('tbody');
      for (const layout of layouts) {
        const { note, noteWarn, disabled } = describePlan(plans.get(layout));
        const r = document.createElement('input');
        r.type = 'radio'; r.name = 'pick-layout'; r.checked = pickedLayout === layout;
        r.setAttribute('aria-label', `選擇「${layout.name || '未命名版面'}」`);
        const thumbTd = document.createElement('td');
        thumbTd.className = 'device-thumb-col';
        thumbTd.appendChild(sharedLayoutThumb(layout));
        const noteTd = document.createElement('td');
        noteTd.className = 'layout-pick-note';
        if (note) noteTd.append(note);
        if (noteWarn) {
          if (note) noteTd.append('　');
          const w = document.createElement('span');
          w.className = 'warn';
          w.textContent = noteWarn;
          noteTd.appendChild(w);
        }
        tbody.appendChild(pickTableRow(r, [
          thumbTd,
          tdText(layout.name || '未命名版面', 'b-th layout-pick-name'),
          tdText(layout.createdBy || '—'),
          tdText(fmtTime(layout.updatedAt), 'num'),
          noteTd,
        ], disabled, () => { if (r.checked) { pickedLayout = layout; next.disabled = false; } }));
      }
      table.appendChild(tbody);
      back.textContent = '上一步'; next.textContent = '完成';
      next.disabled = !pickedLayout || describePlan(plans.get(pickedLayout)).disabled;
    }

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
    // 關閉前確認（user 2026-09-09 指示）：只要動過（勾了機器、進到第 2 步、選了版面）就先問；
    // 確認框開著時 Esc 交給它自己關，這裡不再攔。
    let confirming = false;
    async function requestClose() {
      if (settled || confirming) return;
      const touched = selected.size > 0 || step === 2 || !!pickedLayout;
      if (!touched) return close(null);
      confirming = true;
      let ok = false;
      try {
        ok = await BDialog.confirm({
          title: '要放棄這次批量調整嗎？', desc: '勾選的機器與版面不會保留；機器的展示畫面都還沒有改動。',
          variant: 'danger', confirmText: '放棄',
        });
      } finally { confirming = false; }
      if (ok) close(null);
    }
    function onEsc(e) {
      if (e.key !== 'Escape' || confirming) return;
      e.preventDefault();
      e.stopPropagation();
      requestClose();
    }
    document.addEventListener('keydown', onEsc, true);
    back.onclick = () => { if (step === 1) requestClose(); else renderStep1(); };
    next.onclick = async () => {
      if (step === 2) return close(pickedLayout ? { layout: pickedLayout, plan: plans.get(pickedLayout) } : null);
      // 第 1 步 → 讀所選機器的整份設定（比對版面要看全部頁面、判斷「展示中」要 activePage、「會先加入」要接在現有頁面後面）
      next.disabled = true; back.disabled = true;
      const picked = devices.filter((d) => selected.has(d));
      infos = await Promise.all(picked.map(async (d) => {
        try { return { d, cfg: (await api('GET', `/api/config/${encodeURIComponent(d.DeviceId)}`)).config }; }
        catch { return { d, cfg: null }; }
      }));
      back.disabled = false;
      if (settled) return;
      if (infos.every((i) => !i.cfg)) { next.disabled = false; return setStatus('無法取得機器設定。請稍後再試一次。', true); }
      plans = new Map(layouts.map((l) => [l, planLayoutShow(l, infos)]));
      renderStep2();
    };
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === overlay) requestClose();
    });

    renderStep1();
    if (window.lucide) lucide.createIcons(); // 標題旁 ? icon
    document.body.appendChild(overlay);
    document.body.classList.add('b-modal-lock');
    overlay.classList.add('is-visible');
    void overlay.offsetWidth;
    overlay.classList.add('is-open');
  });
}

/** 在一台機器的頁面清單裡找出「就是這個版面」的那一頁：先比加入時打的 layoutId，再比頁名＝版面名
 *  （舊頁面、或舊版 App 上報時把記號洗掉的備援）；同時有多頁取最後一頁（最新加入的）。回傳索引，找不到 -1。 */
function findLayoutPage(pages, layout) {
  const lastIdx = (pred) => { for (let i = pages.length - 1; i >= 0; i--) if (pred(pages[i])) return i; return -1; };
  if (layout.id) { const i = lastIdx((p) => p.layoutId === layout.id); if (i >= 0) return i; }
  const nm = (layout.name || '').trim();
  if (nm) { const i = lastIdx((p) => (p.name || '').trim() === nm); if (i >= 0) return i; }
  return -1;
}

/** 鍵排序後的 JSON：比對「機器上那一頁的內容」跟「版面目前的內容」是不是同一份（欄位順序不算差異）。 */
function canonicalJson(v) {
  return JSON.stringify(v, (_k, val) =>
    (val && typeof val === 'object' && !Array.isArray(val)) ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]])) : val);
}

/** 一個版面對這批機器的計畫：每台 action = showing（已在展示）／switch（有這頁，切過去）／add（先加入再切）／
 *  full（頁數滿了加不進去）／unreadable（讀不到設定）；showing/switch 另帶 stale＝機器上那一頁的內容跟版面目前的不同
 *  （版面在後台改過、或機器上那一頁被改過），完成時可選擇更新成版面內容。 */
function planLayoutShow(layout, infos) {
  const srcPages = layout.pages || [];
  const srcPortrait = !layout.screen || layout.screen.h >= layout.screen.w;
  const srcBlocks = canonicalJson((srcPages[0] || {}).blocks || []);
  return infos.map((info) => {
    if (!info.cfg) return { ...info, action: 'unreadable' };
    const pages = info.cfg.pages || [];
    const scr = info.cfg.screen;
    const portraitMismatch = (!scr || scr.h >= scr.w) !== srcPortrait;
    const idx = findLayoutPage(pages, layout);
    if (idx >= 0) {
      const stale = canonicalJson(pages[idx].blocks || []) !== srcBlocks;
      return { ...info, idx, portraitMismatch, stale, action: idx === (info.cfg.activePage || 0) ? 'showing' : 'switch' };
    }
    if (pages.length + srcPages.length > MAX_PAGES) return { ...info, action: 'full' };
    return { ...info, portraitMismatch, action: 'add' };
  });
}

/** 計畫 → 對話框那一列的說明文字（中性資訊）與警告（⚠）；有機器加不進去就整個版面不可選。
 *  stale（機器那頁內容跟版面不同）的機器標「會更新成目前版面內容」（完成時一律更新，沒有開關）。 */
function describePlan(plan) {
  const grp = (a, stale) => plan.filter((p) => p.action === a && (stale === undefined || !!p.stale === stale));
  const names = (list) => devNames(list.map((p) => p.d));
  const parts = [];
  if (grp('showing', false).length) parts.push(`${names(grp('showing', false))} 展示中`);
  if (grp('showing', true).length) parts.push(`${names(grp('showing', true))} 展示中，會更新成目前版面內容`);
  if (grp('switch', false).length) parts.push(`${names(grp('switch', false))} 會切換`);
  if (grp('switch', true).length) parts.push(`${names(grp('switch', true))} 會切換並更新成目前版面內容`);
  if (grp('add').length) parts.push(`${names(grp('add'))} 會先加入`);
  const warns = [];
  const mis = plan.filter((p) => p.portraitMismatch && p.action === 'add');
  if (mis.length) warns.push(`⚠ ${names(mis)} 螢幕方向不同`);
  if (grp('full').length) warns.push(`⚠ ${names(grp('full'))} 已達 ${MAX_PAGES} 頁上限，無法加入`);
  if (grp('unreadable').length) warns.push(`⚠ ${names(grp('unreadable'))} 無法取得設定`);
  return { note: parts.join('　'), noteWarn: warns.join('　'), disabled: !!(grp('full').length || grp('unreadable').length) };
}

async function showLayoutWizard() {
  const btn = $('showLayoutBtn');
  btn.disabled = true;
  let devices;
  try {
    try { devices = await api('GET', '/api/devices'); } catch (e) { return setStatus('無法取得機器清單。' + e.message, true); }
    if (!devices.length) return BDialog.alert({ title: '沒有機器', desc: '目前帳號下沒有任何機器。' });
    if (!(await ensureSharedLoaded())) return;
  } finally { btn.disabled = false; }
  const layouts = (shared.layouts || []).filter((l) => l.pages && l.pages.length);
  if (!layouts.length) return BDialog.alert({ title: '沒有版面', desc: '請先到「共用設定 › 版面設定」新增版面，再回來展示。' });

  const result = await showLayoutWizardDialog(devices, layouts);
  if (!result) return; // 對話框縮圖的輪播計時器留給下次 renderDevicesView 的 clearListThumbs 收
  const { layout, plan } = result;
  const layoutName = layout.name || '未命名版面';

  const done = [];
  const failed = [];
  for (const p of plan) {
    let config;
    if (p.action === 'add') {
      const existing = p.cfg.pages || [];
      const appended = stampAppendedPages(layout.pages, existing, layout.name || '', layout.id);
      config = { pages: [...existing, ...appended], activePage: existing.length };
    } else if (p.action === 'showing' || p.action === 'switch') {
      if (p.stale) {
        // 內容跟版面不同就一律更新（user 2026-09-09 定案，不做開關）：那一頁換成版面目前的內容
        // （頁 id／位置／頁名不動，記號補上），同一次 PUT 一起切頁
        const pages = (p.cfg.pages || []).map((pg, i) => (i === p.idx
          ? { ...pg, blocks: JSON.parse(JSON.stringify((layout.pages[0] || {}).blocks || [])), layoutId: layout.id }
          : pg));
        config = { pages, activePage: p.idx };
      } else config = { activePage: p.idx }; // 展示中的也送：把停在管理頁的機器帶進展示模式
    } else { failed.push(p.d.DeviceName || p.d.DeviceId); continue; }
    try {
      const mode = p.action === 'showing' || p.action === 'switch' ? (p.stale ? 'update' : 'switch') : 'append';
      await api('PUT', `/api/config/${encodeURIComponent(p.d.DeviceId)}`, { config, reason: { type: 'showLayout', layoutName: layout.name || '', mode } });
      done.push(p.d);
    } catch { failed.push(p.d.DeviceName || p.d.DeviceId); }
  }
  // 例：「大廳、櫃台」正在切換到「大廳版面」。／…無法切換「倉庫」。
  const okPart = done.length ? `「${devNames(done)}」正在切換到「${layoutName}」。` : '';
  if (!failed.length) setStatus(okPart);
  else setStatus(okPart ? `${okPart}無法切換「${failed.join('、')}」。` : `無法切換「${failed.join('、')}」。請稍後再試一次。`, true);
  renderDevicesView(); // 列縮圖改成新的展示頁（activePage 已寫進伺服器）
}

/** 機器更名：同版面更名的 prompt 對話框；留空＝清掉名稱，列表改顯示編號。 */
async function renameDevice(d) {
  const cur = d.DeviceName || "";
  const name = await BDialog.prompt({
    title: "機器更名", value: cur, placeholder: d.DeviceId, confirmText: "儲存",
  });
  if (name === null || name.trim() === cur) return;
  try { await api("PUT", `/api/config/${encodeURIComponent(d.DeviceId)}`, { config: { deviceName: name.trim() }, reason: "rename" }); }
  catch (e) { return setStatus("無法更名。" + e.message, true); }
  renderDevicesView();
}

/* ---------- 危險區域：刪除機器（2026-09-07 指示） ----------
 * 放在該機器工作區「機器設定」頁籤最下面、整條跨欄的紅框卡，不放在機器總覽列表。
 * 互動照 tiri 收件 modal 的單筆刪除＝按鈕原地二段確認（dialog 疊 modal 太重）：
 * 第一下「刪除機器」原地變形成「確認刪除？」翻實色紅底白字、左側分裂滑出「取消」；再按一下才真的刪。
 * 伺服器刪掉設定並記為「已移除」，機器下次連上收到 410 會自己清空連線資料並停止同步；
 * 要再接回來得在機器上重新輸入位址/編號/金鑰（跟第一次設定一樣）。 */
function dangerZoneCard() {
  // 版型照 GitHub repo settings 的 Danger Zone（2026-09-07 user 指示）：卡片外上方「Danger Zone」標題、
  // 紅框卡（#C30F16）、列＝左粗體標題＋灰字說明／右淺底外框紅字鈕；不放 ?、盡量不讓頁籤捲動
    const sec = document.createElement('section');
    sec.className = 'danger-zone-sec';
    const heading = document.createElement('h3');
    heading.className = 'dz-heading'; heading.textContent = 'Danger Zone';
    const card = document.createElement('div');
    card.className = 'b-card settings-card settings-card-full danger-zone';
    const row = document.createElement('div');
    row.className = 'dz-row';
    const text = document.createElement('div');
    text.className = 'dz-text';
    text.innerHTML = '<span class="dz-title">刪除這台機器</span>' +
      `<p class="dz-desc">從後台移除「${esc(curDevName())}」並停止同步；機器端需重新輸入連線資料才能再接回來。</p>`;
    const actions = document.createElement('div');
    actions.className = 'danger-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'b-btn b-btn-sm dz-cancelbtn'; cancel.textContent = '取消'; cancel.hidden = true;
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'b-btn b-btn-sm dz-delbtn'; del.id = 'dzDelete';
    del.innerHTML = '<span class="lbl">刪除機器</span>';
    actions.append(cancel, del);
    row.append(text, actions);
    card.appendChild(row);
    sec.append(heading, card);

    del.onclick = async () => {
      if (del.classList.contains('is-armed')) {
        // 第二下再彈警告框、確認鈕倒數 3 秒才可按（2026-09-07 user 指示）；取消就把鈕退回未確認態
        const ok = await BDialog.confirm({
          title: `要刪除「${curDevName()}」嗎？`,
          desc: '機器會從後台移除並停止同步，畫面照常播放。\n' +
            '機器端的連線資料會一併清除，之後需在機器上重新輸入伺服器位址、機器編號與金鑰才能再接回來。\n' +
            '此動作無法復原。',
          variant: 'danger', confirmText: '刪除', countdown: 3,
        });
        if (!ok) { cancel.click(); return; }
        del.disabled = true; cancel.disabled = true;
        await deleteCurrentDevice();
        return;
      }
      morphDelBtn(del, '確認刪除？', true);
      cancel.hidden = false; // keyframes 進場：左側分裂滑出
    };
    cancel.onclick = () => {
      cancel.classList.add('is-leaving');
      setTimeout(() => { cancel.classList.remove('is-leaving'); cancel.hidden = true; }, 150);
      morphDelBtn(del, '刪除機器', false);
    };
  return sec;
}

/** tiri morphIm 同款：寬度由量尺補間、舊字上移淡出／新字下方淡入交叉進行、armed 翻實色——三者同步不跳字。 */
function morphDelBtn(b, text, armed) {
  const lbl = b.querySelector('.lbl');
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:inherit;';
  probe.textContent = text;
  b.appendChild(probe);
  const w0 = b.offsetWidth;
  const w1 = probe.offsetWidth + (w0 - lbl.offsetWidth);
  probe.remove();
  b.classList.toggle('is-armed', armed);
  b.style.width = w0 + 'px';
  void b.offsetWidth;            // 強制 reflow，讓補間從 w0 起跑
  b.style.width = w1 + 'px';     // 寬度與底色同幀開跑
  lbl.classList.add('is-swap');
  setTimeout(() => {
    lbl.textContent = text;
    lbl.classList.remove('is-swap');
    lbl.classList.add('is-enter');
    void lbl.offsetWidth;
    lbl.classList.remove('is-enter');
  }, 100);
  setTimeout(() => { b.style.width = ''; }, 340);
}

async function deleteCurrentDevice() {
  const name = curDevName();
  try { await api('DELETE', `/api/devices/${encodeURIComponent(deviceId)}`); }
  catch (e) { setStatus(`無法刪除「${name}」。` + e.message, true); renderSettingsView(); return; }
  setDirty(false);        // 未發布的修改隨機器一起作廢，關窗不再問要不要放棄
  await exitWorkspace();  // 退場動畫後回機器總覽重整
  setStatus(`已刪除「${name}」。`);
}

// ---------- 帳號管理 ----------
async function renderUsersView() {
  const users = await api('GET', '/api/users');

  const utb = $('userTable').querySelector('tbody');
  utb.innerHTML = '';
  for (const u of users) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="b-th">${esc(u.Username)}</td><td>${esc(u.DisplayName || '')}</td>` +
      `<td>${u.IsAdmin ? '<span class="b-badge brand">管理員</span>' : '<span class="b-badge neutral">一般</span>'}</td>`;
    const td = document.createElement('td');
    td.className = 'user-ops'; // 靠最右（2026-09-03 指示）；兩個鈕位子固定、不能刪的列用 is-ghost 佔位（對齊）
    const edit = document.createElement('button');
    edit.className = 'b-btn b-btn-text';
    edit.textContent = '編輯'; // 2026-09-07：取代「更名」，點開改名稱＋權限
    edit.onclick = () => openEditUser(u);
    td.appendChild(edit);
    // 刪除：主管理員、自己不可刪 → ghost 佔位，讓每列「編輯」對齊
    const canDelete = !u.IsPrimary && !u.IsMe;
    const del = document.createElement('button');
    // 危險動作標準式：紅字文字鈕、hover 透明紅底（全站刪除統一）
    del.className = 'b-btn b-btn-text b-btn-text-danger' + (canDelete ? '' : ' is-ghost'); del.textContent = '刪除';
    del.onclick = async () => {
      const ok = await BDialog.confirm({
        title: `刪除帳號 ${u.Username}？`, desc: '這個帳號將無法再登入。',
        variant: 'danger', confirmText: '刪除',
      });
      if (!ok) return;
      try { await api('DELETE', `/api/users/${u.UserId}`); renderUsersView(); }
      catch (e) { setStatus('無法刪除帳號。' + e.message, true); }
    };
    td.appendChild(del);
    tr.appendChild(td);
    utb.appendChild(tr);
  }
}

// 權限 segment（新增／編輯共用）：兩級 radio，膠囊＋滑動指示塊（同 segRow / ws-tabs 作法）
function moveSegInd(row, instant) {
  const ind = row.querySelector('.seg-ind');
  const a = row.querySelector('.seg.active');
  if (!ind || !a) return;
  const place = () => {
    ind.style.opacity = '1';
    ind.style.left = a.offsetLeft + 'px';
    ind.style.top = a.offsetTop + 'px';
    ind.style.width = a.offsetWidth + 'px';
    ind.style.height = a.offsetHeight + 'px';
  };
  if (!instant) return place();
  ind.style.transition = 'none';
  requestAnimationFrame(() => { place(); requestAnimationFrame(() => { ind.style.transition = ''; }); });
}
function setRoleSeg(id, role, instant) {
  for (const b of $(id).querySelectorAll('.seg')) {
    const on = b.dataset.role === role;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  moveSegInd($(id), instant);
}
window.addEventListener('resize', () => { for (const id of ['newUserRole', 'editUserRole']) moveSegInd($(id), true); });
function roleSegIsAdmin(id) { return !!$(id).querySelector('.seg.active[data-role="admin"]'); }
for (const id of ['newUserRole', 'editUserRole']) {
  for (const b of $(id).querySelectorAll('.seg')) b.onclick = () => setRoleSeg(id, b.dataset.role);
}

// 編輯帳號 modal（2026-09-07）：名稱＋權限；主管理員／自己的權限鎖住（後端也擋）
let editingUser = null;
function openEditUser(u) {
  editingUser = u;
  $('editUsername').value = u.Username;
  $('editDisplayName').value = u.DisplayName || '';
  const locked = !!(u.IsPrimary || u.IsMe);
  $('editUserRole').classList.toggle('is-locked', locked);
  $('editUserRoleHint').textContent = u.IsPrimary ? '主管理員的權限無法變更。'
    : u.IsMe ? '無法變更目前登入帳號的權限。'
    : '一般帳號可管理所有機器，但看不到帳號管理。';
  BModal.open('#editUserModal');
  setRoleSeg('editUserRole', u.IsAdmin ? 'admin' : 'user', true); // 開窗後才量得到寬度；instant 不播滑入
  $('editDisplayName').focus();
}
function editUserDirty() {
  if (!editingUser) return false;
  return $('editDisplayName').value.trim() !== (editingUser.DisplayName || '')
    || roleSegIsAdmin('editUserRole') !== !!editingUser.IsAdmin;
}
async function closeEditUserModal() {
  if (editUserDirty()) {
    const ok = await BDialog.confirm({
      title: '有尚未儲存的修改', desc: '捨棄這些修改嗎？', variant: 'danger', confirmText: '捨棄',
    });
    if (!ok) return;
  }
  BModal.close('#editUserModal');
}
$('editUserCloseBtn').addEventListener('click', closeEditUserModal);
$('editUserModal').addEventListener('click', (e) => { if (e.target === $('editUserModal')) closeEditUserModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('editUserModal').classList.contains('is-visible')) return;
  if (document.querySelector('.b-modal-overlay[data-modal-vue].is-visible:not(#editUserModal)')) return;
  closeEditUserModal();
});
$('editUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editingUser) return;
  if (!editUserDirty()) { BModal.close('#editUserModal'); return; }
  const body = { displayName: $('editDisplayName').value.trim() };
  const locked = !!(editingUser.IsPrimary || editingUser.IsMe);
  if (!locked && roleSegIsAdmin('editUserRole') !== !!editingUser.IsAdmin) body.isAdmin = roleSegIsAdmin('editUserRole');
  try {
    await api('PUT', `/api/users/${editingUser.UserId}`, body);
    BModal.close('#editUserModal');
    BToast.success('已更新帳號。');
    renderUsersView();
    if (editingUser.IsMe) refreshMe(); // 改了自己的名稱 → 右上角同步
  } catch (e2) { BToast.danger('無法更新帳號。' + e2.message); }
});

// 新增帳號 modal：入口在頁首右上；必填（帳號＋密碼）沒填齊前送出鈕 disabled
function refreshAddUserSubmit() {
  $('addUserSubmit').disabled = !($('newUsername').value.trim() && $('newPassword').value);
}
$('addUserBtn').onclick = () => {
  $('addUserForm').reset();
  refreshAddUserSubmit();
  BModal.open('#addUserModal');
  setRoleSeg('newUserRole', 'user', true); // 預設一般；開窗後才量得到寬度、instant 不播滑入
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
      isAdmin: roleSegIsAdmin('newUserRole'),
    });
    BModal.close('#addUserModal');
    BToast.success('已新增帳號。');
    renderUsersView();
  } catch (e2) { BToast.danger('無法新增帳號。' + e2.message); }   // 留在 modal 裡讓使用者改完重送
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
    setStatus(`「${curDevName()}」有新的變更，已自動更新。`);
  } catch { /* 網路暫時異常就等下一輪 */ }
}, 5000);

// ---------- 啟動 ----------
(token ? enterMain().catch(showLogin) : Promise.resolve(showLogin()));

/**
 * 園區資訊格的標題＋「點我查看」按鈕預覽，與 App `ParkCellOverlay` 同一套規則：
 * 橫條（寬/高 ≥ 1.2）＝標題靠左、按鈕靠右；直的格子＝標題（40sp 上限）置中在上、按鈕貼底填滿寬度留邊。
 * 字級上限 28sp，格子太窄或太矮時等比縮小（橫：min(w/600, h/90)，直：min(w/300, h/220)）。
 * 機器上 1px ≈ 1dp，所以用實際格子像素算，再換成預覽的 cqw。
 */
function renderParkOverlay(el, cell, sizePx, fg) {
  const w = sizePx && sizePx.w ? sizePx.w : 1080;
  const h = sizePx && sizePx.h ? sizePx.h : 200;
  // 只有園區資訊有按鈕（開啟網頁、AI 客服都不放）
  const ctaLabel = cell.tap === 'OpenParkInfo' ? '點我查看' : null;
  const cta = !!ctaLabel;
  const vertical = cta && (cell.parkLayout === 'Vertical' || (cell.parkLayout !== 'Horizontal' && w / h < 2.0));
  const s = vertical
    ? Math.max(0.5, Math.min(w / 300, h / 220, 1))
    : Math.max(0.4, Math.min(w / 600, h / 90, 1));
  const u = (px) => `${(px * s * 100 / w).toFixed(3)}cqw`;
  const wrap = document.createElement('div');
  wrap.className = 'pv-park ' + (vertical ? 'v' : 'h');
  // 標題字級 = 版面上限（直 40／橫 28）× 字級滑桿%；App 端放不下會自動縮到剛好放得下，
  // 預覽用近似的上限：寬＝「園區資訊」四字＋圖示＋內距，高＝可用高度的 1.3 倍行高
  const pct = Math.max(50, Math.min(300, Number(cell.txtSize) || 100)) / 100;
  const availH = vertical ? Math.max(40, h - (cta ? (28 + 32 + 16) * s : 0)) : h;
  const fitCap = Math.min((w / s - 58) / 5.3, (availH / s) / 1.3);
  const titleSize = Math.max(8, Math.min((vertical ? 40 : 28) * pct, fitCap));
  let html = '';
  if (cell.content === 'ParkInfo') {
    html += `<div class="pv-park-title" style="color:${fg};font-size:${u(titleSize)};padding:0 ${u(24)}">` +
      `<span class="material-icons" style="font-size:${u(titleSize * 1.2)}">map</span>園區資訊</div>`;
  } else {
    html += `<div class="pv-park-fill"></div>`;
  }
  if (cta) {
    const margin = vertical ? `0 ${u(16)} ${u(16)}` : `0 ${u(16)} 0 0`;
    html += `<div class="pv-park-btn fx-${cell.parkFx || 'Sweep'}" style="font-size:${u(28)};padding:${u(16)} ${u(20)} ${u(16)} ${u(28)};margin:${margin}">` +
      `${ctaLabel}<span class="material-icons" style="font-size:${u(34)}">chevron_right</span></div>`;
  }
  wrap.innerHTML = html;
  el.appendChild(wrap);
}
