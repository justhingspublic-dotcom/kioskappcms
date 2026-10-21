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
let selected = null;      // { bi, path }：path＝從區塊根往下的 'a'/'b' 字串（''＝根）；編輯器裡一頁只有一個區塊，bi 一律 0
let subStack = [];        // 正在編輯的子頁：從主頁一路點進來的格子 path（每一層相對於上一層的樹）；[]＝在主頁
let dirty = false;
/** 小 icon（Lucide x／plus 同款路徑）：動態產生的按鈕直接塞 SVG，不必每次重跑 lucide.createIcons。 */
const SVG_ICON = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SVG_X = SVG_ICON('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
const SVG_PLUS = SVG_ICON('<path d="M5 12h14"/><path d="M12 5v14"/>');
let activePageTouched = false; // 只有按過「在機器上展示此頁」才隨儲存送出 activePage
let meIsAdmin = false;
let meUsername = '';
let wsMode = 'device';    // 工作區 modal 模式：'device'＝編輯某台機器；'shared'＝編輯共用版面
let sharedLayoutId = 0;   // wsMode='shared' 時正在編輯 shared.layouts 裡哪一個版面（id）

const MAX_PAGES = 8, MAX_IMAGES = 12;
// 排版更自由（2026-10-12）：每一格都能再切；一頁最多 12 格，切完（含同排平均）任一格窄於畫面寬 12%／矮於畫面高 6% 就不給切
const MAX_CELLS = 12, MIN_SPLIT_W = 0.12, MIN_SPLIT_H = 0.06;
const CONTENT_NAMES = { None: '無', Marquee: '跑馬燈', Weather: '天氣', Text: '文字', Web: '網頁', Video: '影片', ParkInfo: '園區資訊' };
// 這個場域的園區測站資料來源（2026-10-20 起＝後台「共用設定 › 園區測站」設定的 parkInfo.api，由 /api/connection-info 帶回、
// 存檔後就地更新）；空＝這個場域沒有測站。格子一律照它（格子裡的 wStUrl 只是抄給舊版 App 用的，這裡不再拿來備援）
let PARK_API = '';
/** 園區測站現在能不能用（2026-10-20 user）：沒設資料來源或連不上＝內容「園區資訊」、天氣來源「園區測站」、
 *  點擊動作「園區資訊」照樣列出但變灰不能選；已經選了的格子設定保留、那一塊變灰，下拉選單上掛狀態小標（不寫長說明）。
 *  { ok, short }；測站還在讀＝先當可用，免得一閃一閃。 */
function parkAvail() {
  if (!PARK_API) return { ok: false, short: '未設定' };
  const snap = getStations(PARK_API);
  if (!snap) return { ok: true };
  if (snap.error) return { ok: false, short: '連線失敗' };
  if (!snap.stations.length) return { ok: false, short: '沒有測站' };
  return { ok: true };
}
const parkAvailKey = () => { const a = parkAvail(); return a.ok ? 'ok' : a.short; };
/** 展示機上實際的可點提示：場域清掉了測站資料來源，「園區資訊」這一格不能點、也不顯示提示（play.js／App 同規則） */
const liveHintOf = (cell) => (cell.tap === 'OpenParkInfo' && !PARK_API ? 'None' : hintOf(cell));
const BG_SWATCHES = ['FF263238','FF37474F','FF1B5E20','FF2E6A43','FF0D47A1','FF4A148C','FFB71C1C','FFF57F17','FF00838F','FF5D4037','FF000000','FFFFFFFF'].map(h => parseInt(h, 16));
const TXT_SWATCHES = ['FFFFFFFF','FF000000','FFFFEB3B','FFFF9800','FFFF5252','FF69F0AE','FF40C4FF','FFE040FB','FFFFC107','FF80CBC4'].map(h => parseInt(h, 16));
// App AccentSwatches 同一組（客服聊天頁主題色；null = 預設綠）
const ACCENT_SWATCHES = ['FF2E6A43','FF1565C0','FF00695C','FF6A1B9A','FFAD1457','FFC62828','FFEF6C00','FF37474F'].map(h => parseInt(h, 16));
// 客服主題色的「JustAI」色票（2026-09-14）：JustAI CI 橘 #DB892E 底＋白色 J 標（chat.justhings.ai favicon.svg 的字形）；值＝哨兵 0
const JUSTAI_CHIP = { label: 'JustAI', value: 0, cls: 'justai', icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#fff" d="M6.33,25.43c-.97-1.18-.9-2.8.15-3.77.77-.71,1.81-.89,2.73-.41.75.39,1.22.89,2.07.71,1-.22,1.18-1.32,1.18-2.21V7.6c0-1.05.39-2.01,1.3-2.54,1.01-.59,2.22-.47,3.1.3.54.5.8,1.17.9,1.92,0,.01,0,.02,0,.04v13.24s0,.01,0,.02c-.11,1.93-.86,3.7-2.28,4.98-.66.59-1.35,1.04-2.18,1.37-1.59.63-3.36.61-4.94-.08-.78-.34-1.49-.78-2.03-1.44Z"/><path fill="#fff" d="M24.63,10.27c-.65.29-1.34.35-1.97.22-.59-.12-1.03-.39-1.44-.79-.7-.69-1.01-1.59-.85-2.6.16-1.01.88-1.92,1.84-2.29,1.48-.57,3.04.03,3.79,1.4.49.89.48,2.06-.11,2.92-.33.48-.73.9-1.26,1.14Z"/></svg>' };
const DEFAULT_CHAT_BASE = 'https://chat-api.justhings.ai'; // App ChatApiConfig.DEFAULT_BASE_URL

const DEFAULT_CELL = () => ({
  t: 'cell', bg: 'Solid', bgColor: 4280693304 /* 0xFF263238 */, bgImgs: [], scale: 'Crop', dur: 8, bgBlur: 0,
  content: 'None', mqSpeed: 100, txtSize: 100, glow: false, edgeFade: false, video: '', web: '', text: '',
  wAuto: true, wCounty: '', wDistrict: '', wDynBg: false,
  tap: 'None', tapUrl: '', parkHere: '', parkFx: 'Sweep', parkLayout: 'Auto', parkInfoLayout: 'Kiosk', agentId: '', agentName: '', assistantLayout: 'Kiosk', agentInputPos: 'Top', agentSpeak: true, agentSpeakRate: 1, agentUpload: true,
});
// App ParkCtaStyle：「點我查看」按鈕的看板動態（None = 靜態）
const PARK_FX = [['None', '無'], ['Sweep', '光帶掃過'], ['Breathe', '呼吸縮放'], ['BorderRun', '邊框跑光'], ['ArrowNudge', '箭頭點動'], ['Pulse', '底色脈衝'], ['Shake', '週期抖動']];
// App ParkLayout：園區資訊標題與按鈕的排法（Auto = 寬不到高兩倍就直排）
const PARK_LAYOUT = [['Auto', '自動'], ['Horizontal', '橫排'], ['Vertical', '直排']];
/** 園區地圖上的測站（後台「共用設定 › 園區測站」放上地圖的站，2026-10-20）：點擊動作「園區資訊」的「目前位置」從這裡挑。[[代號, 名稱]] */
function parkMapNodes() {
  const st = (shared && shared.parkInfo && shared.parkInfo.stations) || {};
  return Object.entries(st).filter(([, e]) => e && e.x != null && e.y != null)
    .map(([id, e]) => [id, e.name || ''])
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant', { numeric: true }));
}
// 可點提示樣式（user 2026-09-10 定案：靜的多、動的只有一個）：角落徽章＝右上角小小「輕觸」記號；按鈕＝格內一顆按鈕（動態一頁只留一格）
const TAP_HINT = [['None', '無'], ['Badge', '角落徽章'], ['Glow', '閃爍'], ['Button', '按鈕']];
// 沒點擊動作＝無；有設就照設的；沒設＝園區資訊走按鈕（沿用舊版面），其他一律無（user：預設無、自己選）（play.js／App effectiveTapHint 同一套）
function hintOf(cell) {
  if (!cell.tap || cell.tap === 'None') return 'None';
  if (TAP_HINT.some(([k]) => k === cell.tapHint)) return cell.tapHint;
  return cell.tap === 'OpenParkInfo' ? 'Button' : 'None';
}
const ctaLabelOf = (cell) => (cell.tapLabel || '').trim() || '點我查看';
// 這一頁所有格子（每個區塊往下切到底的葉格）
function pageCells(p) {
  const out = [];
  (p?.blocks || []).forEach((b) => leavesOf(b.node).forEach((l) => out.push(l.cell)));
  return out;
}
// 一頁只有一格會動：這格開了按鈕動態，同頁其他「按鈕」格的動態改成「無」，回傳改了幾格
function quietOtherFx(p, cell) {
  let n = 0;
  pageCells(p).forEach((c) => { if (c !== cell && hintOf(c) === 'Button' && (c.parkFx || 'Sweep') !== 'None') { c.parkFx = 'None'; n++; } });
  return n;
}

// ---------- 子路徑（2026-09-08；2026-09-10 網頁搬到 /admin/）----------
// 後台可掛在子路徑底下（正式站＝ https://justdisplay.justhings.com.tw/joye/admin/，根網址＝各後台的統一入口）。
// 伺服器端用 BASE_PATH 掛載；網頁本身在 /{site}/admin/，API 與圖片在 /{site}/api、/{site}/files，
// 所以前綴＝目前網址去掉檔名再去掉結尾的 /admin，所有根路徑（/api、/files）都要加上它。
const BASE = location.pathname.replace(/\/[^/]*$/, '').replace(/\/admin$/, '');
/** 伺服器上的媒體路徑（/files/…）補上子路徑前綴；外部 http(s) 網址原樣。 */
const mediaSrc = (uri) => (typeof uri === 'string' && uri.startsWith('/files/') ? BASE + uri : uri);

// ---------- API ----------
// 錯誤文字口吻（2026-09-07 指示＝Apple 中性口吻）：句號結尾、不用驚嘆號、不責怪使用者、不出現技術字眼；
// api() 只丟「原因句」（請檢查…／請稍後再試…），toast 由呼叫端補主詞「無法○○。」再接原因。
const NET_ERROR = '目前無法連接伺服器，請檢查網路連線後再試一次。';
const GENERIC_ERROR = '請稍後再試一次。';
// 請求逾時（2026-09-15）：以前 fetch 沒有時限，伺服器卡住時登入鈕會轉 2 分鐘等 IIS 放棄再顯示錯的文案。
// 一般 API 20 秒、上傳檔案 2 分鐘（大圖慢網路）。
const API_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const TIMEOUT_ERROR = '伺服器未在時限內回應，請稍後再試一次。';
const isTimeout = (e) => e && (e.name === 'TimeoutError' || e.name === 'AbortError');
function reasonFor(status, serverMsg) {
  if (serverMsg) return serverMsg;
  switch (status) {
    case 403: return '此帳號沒有權限執行這項操作。';
    case 404: return '找不到這個項目。';
    case 413: return '檔案太大，無法上傳。';
    default: return status >= 500 ? '伺服器暫時無法處理這項要求，請稍後再試一次。' : GENERIC_ERROR;
  }
}
async function api(method, url, body, isForm) {
  const headers = { Authorization: 'Bearer ' + token };
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(BASE + url, {
      method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(isForm ? UPLOAD_TIMEOUT_MS : API_TIMEOUT_MS),
    });
  } catch (e) { throw new Error(isTimeout(e) ? TIMEOUT_ERROR : NET_ERROR); }
  if (res.status === 401) { logout(); throw new Error('登入已過期，請重新登入。'); }
  if (!res.ok) throw new Error(reasonFor(res.status, (await res.json().catch(() => ({}))).error));
  return res.json();
}

// ---------- 登入 ----------
function showLogin() { $('loginView').classList.remove('hidden'); $('mainView').classList.add('hidden'); updateDocTitle(); }
function showMain() { $('loginView').classList.add('hidden'); $('mainView').classList.remove('hidden'); }
function logout() {
  // 伺服器端也把 token 作廢（2026-09-10 登入工作階段改存 DB）；失敗不影響本機登出
  if (token) fetch(BASE + '/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).catch(() => {});
  token = '';
  sessionStorage.removeItem('token');
  notifData = { items: [], readAt: null }; paintNotifBadge(); setNotifPanel(false);
  // SPA 狀態全清：換帳號登入不能看到上一個帳號的快取（共用設定、客服清單、編輯中資料）
  state = null; deviceId = ''; selected = null; subStack = []; setDirty(false);
  shared = null; sharedLayoutId = 0; setSharedDirty(false); clearTimeout(sharedSaveTimer);
  parkDraft = null; parkUploading = 0; parkPlacing = false; parkPlaceSnap = null; parkMapSwap = null; parkApiDraft = null; parkApiTest = null; parkStations = null;
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
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (e) { await minCrawl(); throw new Error(isTimeout(e) ? '無法登入。伺服器未在時限內回應，請稍後再試一次。' : '無法登入。目前無法連接伺服器，請檢查網路連線後再試一次。'); }
    // 5xx／代理逾時（IIS 502 回的是 HTML，沒有 .error）不能說成「帳號或密碼不正確」（2026-09-15）
    if (r.status >= 500) { await minCrawl(); throw new Error('無法登入。伺服器暫時無法處理，請稍後再試一次。'); }
    if (!r.ok) { await minCrawl(); throw new Error((await r.json().catch(() => ({}))).error || '帳號或密碼不正確。'); }
    token = (await r.json()).token;
    sessionStorage.setItem('token', token);
    await minCrawl();
    btn.classList.add('is-success');                    // 疊在 is-loading 之上補滿（tiri 同款）
    window.morphIcon?.(btn, 'circle-check');            // 登入圖示同時變成打勾（morph-icons.js）
    await new Promise((res) => setTimeout(res, 350));   // 等填滿（.3s）再切主畫面
    await enterMain();
    btn.classList.remove('is-loading', 'is-success');   // 還原，登出再進來是乾淨狀態
    window.morphIcon?.(btn, 'log-in');
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
  if (window.morphIcon?.(eye, show ? 'eye-off' : 'eye')) return; // 圖示變形（morph-icons.js）；還不能變形才硬換
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
// modal 內的問號面板改 fixed 懸浮（2026-09-14 user 回報：絕對定位的面板 hover 時放開 overflow 會把 modal 內容區
// 撐出捲動、畫面亂跳，最下面的 Danger Zone 尤其明顯）：位置在 hover／focus／點擊時由這裡算，脫離文件流所以
// 捲動區高度不受影響；右邊貼到視窗就往內縮、下面放不下就改開在上方（同 attachTip）。捲動時跟著重算。
function placeModalHelp(h) {
  const btn = h.querySelector('.page-help-btn'), panel = h.querySelector('.b-pop-panel');
  if (!btn || !panel) return;
  const r = btn.getBoundingClientRect(), w = panel.offsetWidth, ph = panel.offsetHeight;
  // .is-end＝按鈕在標題列右邊（資料來源的連線狀態）：面板右緣對齊按鈕，往左展開
  const x = Math.max(8, Math.min(window.innerWidth - w - 8, h.classList.contains('is-end') ? r.right - w : r.left));
  let y = r.bottom + 8, up = false;
  if (y + ph > window.innerHeight - 8) { y = r.top - ph - 8; up = true; }
  panel.style.left = x + 'px'; panel.style.top = y + 'px';
  h.classList.toggle('is-up', up);
}
const modalHelpOf = (e) => (e.target && e.target.closest ? e.target.closest('.b-modal .page-help') : null);
document.addEventListener('pointerover', (e) => { const h = modalHelpOf(e); if (h) placeModalHelp(h); });
document.addEventListener('focusin', (e) => { const h = modalHelpOf(e); if (h) placeModalHelp(h); });
document.addEventListener('scroll', () => {
  document.querySelectorAll('.b-modal .page-help:is(:hover, :focus-within, .is-open)').forEach(placeModalHelp);
}, true);

async function confirmDiscard() {
  if (!dirty) return true;
  return BDialog.confirm({
    title: '有尚未儲存的修改', desc: '捨棄這些修改嗎？', variant: 'danger', confirmText: '捨棄',
  });
}
window.addEventListener('beforeunload', (e) => { if (dirty || parkBusy() || parkApiChanged() || parkMapSwap) e.preventDefault(); });

// ---------- 載入 / 儲存 ----------
async function enterMain() {
  showMain();
  await refreshMe();
  switchView(restoreView()); // 重新整理／重新登入回到原本那頁（網址 hash），沒有才回機器總覽
  loadConnInfo();
  ensureSharedLoaded(); // 編輯格子時「目前位置」要列出園區地圖上的測站（共用設定 parkInfo）
}
// 右上角顯示「名稱」（沒設就退回帳號）；下拉副標＝帳號・權限（2026-09-07 指示）
async function refreshMe() {
  const me = await api('GET', '/api/me');
  const shown = me.displayName || me.username;
  $('whoami').textContent = shown;
  $('whoamiMenu').textContent = shown;
  $('whoamiSub').textContent = `${me.username}・${me.isAdmin ? '管理員' : '一般帳號'}`;
  meIsAdmin = !!me.isAdmin;
  meUsername = me.username; // 機器事件通知：自己做的事不跳 toast
  loadNotifs();
  $('usersNav').classList.toggle('hidden', !meIsAdmin);
  $('themeBtn').hidden = !meIsAdmin; // 主題色：管理員限定
}

// ---------- 側欄底部「網頁螢幕」卡片（原「機器連線資訊」）----------
// 只剩展示頁網址（2026-10-14 user：App 改用配對碼，伺服器位址與連線金鑰沒人要抄了；網址本身帶共用金鑰，金鑰只活在伺服器 .env）。
let connInfo = null;
let connInfoDone = false; // 連線資訊抓過了（成功或失敗）：園區測站頁要等它才知道這個站台有沒有測站
async function loadConnInfo() {
  const card = $('connCard');
  try {
    connInfo = await api('GET', '/api/connection-info');
  } catch {
    card.hidden = true; $('connMini').hidden = true;   // 拿不到就整張不顯示，不擋登入流程
    connInfoDone = true;
    if (!$('parkInfoView').classList.contains('hidden')) renderParkInfoView();
    return;
  }
  PARK_API = String(connInfo.parkApi || '').trim();
  connInfoDone = true;
  $('parkNav').classList.remove('hidden'); // 園區測站頁一律在（2026-10-20：新場域要從這裡設定資料來源與地圖）
  // 重新整理時停在園區測站頁：頁面比連線資訊先畫，回來後重畫（不然會一直顯示「沒有園區測站」）
  if (!$('parkInfoView').classList.contains('hidden')) renderParkInfoView();
  $('connPlay').textContent = playUrl(true);
  // 站台有預設螢幕（.env PLAY_DEFAULT_DEVICE）：開了就直接展示、不用填名字
  if (connInfo.playDefaultDevice) {
    $('connPlayNaming').textContent = '此場域已設定預設螢幕，開啟後所有螢幕會直接展示相同畫面；若要將這面螢幕設為獨立的一台，請在畫面左上角連續點按五下並輸入名稱。';
  }
  $('connPlay').title = playUrl(false);
  // 頂欄「開啟展示頁」：新分頁開播放頁，網址帶金鑰（user 2026-09-10 指示），第一次只要填名字（有預設機器名就直接展示）
  if (connInfo.serverUrl && connInfo.deviceKey) { $('playLink').href = playUrl(false); $('playLink').hidden = false; }
  card.hidden = false;
  $('connMini').hidden = false;
}
/** 網頁播放器網址（2026-09-10）：{伺服器位址}/play/?key=金鑰——所有機器同一個網址；機器名由站台預設（PLAY_DEFAULT_DEVICE）
 *  或第一次開啟時在螢幕上填。masked＝顯示用（金鑰遮住）。 */
function playUrl(masked) {
  if (!connInfo || !connInfo.serverUrl) return '—';
  const key = connInfo.deviceKey || '';
  return `${connInfo.serverUrl}/play/?key=${masked ? maskKey(key) : key}`;
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
  f.innerHTML = '<div class="cms-flyout-title">網頁螢幕</div>' + item('展示頁網址', playUrl(true), 'play');
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
  const text = connInfo.serverUrl && connInfo.deviceKey ? playUrl(false) : '';
  if (!text) return BToast.danger('目前沒有可複製的內容。');
  const ok = await copyText(text);
  if (ok) BToast.success('已複製展示頁網址。');
  else BToast.danger('無法複製。請直接選取文字後手動複製。');
});

function openWsModal() {
  const m = $('wsModal');
  m.classList.toggle('is-shared-mode', wsMode === 'shared');
  m.classList.remove('is-closing');
  m.classList.add('is-visible');
  document.body.classList.add('b-modal-lock');
  $('saveBtn').textContent = wsMode === 'shared' ? '儲存版面' : '儲存並發布';
  $('saveBtn').title = `${$('saveBtn').textContent}（${IS_MAC ? '⌘S' : 'Ctrl+S'}）`;
  setTimeout(updateDocTitle, 0); // 分頁標題換成機器名稱（標題列的名字由呼叫端填）
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
  subStack = [];
  activePageTouched = false;
  setDirty(false);
  $('emptyState').classList.add('hidden');
  $('editor').classList.remove('hidden');
  render();
}

async function exitWorkspace() {
  setTimeout(updateDocTitle, 300); // 關掉後分頁標題回到目前這一頁
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
    setStatus(`已儲存「${layout.name || '未命名版面'}」，若要發布到機器，請使用「加入機器」。`);
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
    subStack = [];
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
    setStatus(opts.doneMsg || `已發布，「${curDevName()}」會在一分鐘內更新。`); // 不寫版號（2026-09-03 指示）
  } catch (e) { setDirty(true); setStatus(`無法發布到「${curDevName()}」。${e.message}`, true); }
}
$('saveBtn').addEventListener('click', () => saveConfig());

/** 未發布提示（2026-10-14 精修）：工作區底部欄儲存鈕左邊「● 尚有修改未發布」。由 JS 建（index.html 是伺服器快取的範本，改它要重啟）。 */
function wsDirtyNote() {
  let n = $('wsDirtyNote');
  const foot = $('wsFooter');
  if (!n && foot) {
    n = document.createElement('span');
    n.id = 'wsDirtyNote'; n.className = 'ws-dirty-note'; n.setAttribute('aria-live', 'polite');
    foot.prepend(n);
  }
  return n;
}
/** 可復原的刪除（2026-10-14 精修）：不先跳「確定要刪除嗎？」，直接刪、跳 toast「已刪除…　復原」，6 秒內按復原＝這個版面回到刪之前。
 *  只在刪完之後還沒有其他修改時有效（之後又改了別的就不能復原，免得把後面的修改一起蓋掉）；存檔、關掉工作區也就失效。
 *  只用在還沒發布、救得回來的編輯動作（頁籤、格子、圖片）；刪機器、刪帳號這種真的刪掉的照舊先確認。 */
let undoSeq = 0;
function withUndo(label, doDelete) {
  const snap = {
    pages: JSON.parse(JSON.stringify(state.config.pages)), activePage: state.config.activePage,
    pageIndex, selected: selected ? { ...selected } : null, subStack: [...subStack], deviceId, wsMode, sharedLayoutId,
  };
  doDelete();
  const seq = undoSeq;
  BToast.show(label, 'info', {
    icon: 'trash-2', duration: 6000,
    action: {
      label: '復原',
      onClick: () => {
        const same = state && seq === undoSeq && deviceId === snap.deviceId && wsMode === snap.wsMode
          && sharedLayoutId === snap.sharedLayoutId && $('wsModal').classList.contains('is-visible');
        if (!same) { BToast.warning('已有其他修改，無法復原。'); return; }
        state.config.pages = snap.pages;
        state.config.activePage = snap.activePage;
        pageIndex = snap.pageIndex;
        subStack = snap.subStack;
        selected = snap.selected;
        setDirty(true); render();
      },
    },
  });
}
function setDirty(v) {
  undoSeq++;
  dirty = v; $('saveBtn').disabled = !v;
  const note = wsDirtyNote();
  if (note) { note.textContent = v ? (wsMode === 'shared' ? '尚有修改未儲存' : '尚有修改未發布') : ''; note.classList.toggle('is-on', !!v); }
}
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
const mainPage = () => state.config.pages[pageIndex];
// 子頁（樹狀展示，2026-10-20 user）：格子點擊動作「進入子頁」，子頁存在那一格裡 cell.sub＝{ name, node }（node 同頁面的版面樹）。
// 子頁跟著格子走：頁籤只放主頁，複製版面、展示到別台都會一起帶過去。主頁算第 1 層，最多 3 層。
// 編輯器進到子頁時 page() 回傳一個「看起來像一頁」的檢視（blocks[0].node 直接讀寫那一格的 sub.node），
// 分割、刪除、拖曳、面板這些以頁為單位的編輯不用改；頁層級的動作（頁籤、展示此頁、複製頁面）用 mainPage()。
const MAX_DEPTH = 3;
// 子頁的編輯體驗還在討論（user 2026-10-20）：先不讓新格子選「進入子頁」；已經設好的格子照常顯示、編輯，機器端照常播放
const SUBPAGES_OFFERED = false;
const subViews = new WeakMap();
/** subStack 走得到的每一層格子（中途對不上＝之後的都不算）。 */
function subTrail() {
  const out = [];
  let root = mainPage()?.blocks?.[0]?.node;
  for (const p of subStack) {
    const c = nodeAt(root, p);
    if (!c || isSplit(c) || c.tap !== 'OpenSubPage' || !c.sub) break;
    out.push(c);
    root = c.sub.node;
  }
  return out;
}
function page() {
  const pg = mainPage();
  if (!pg || !subStack.length) return pg;
  const trail = subTrail();
  if (trail.length < subStack.length) subStack = subStack.slice(0, trail.length);
  if (!trail.length) return pg;
  const sub = trail[trail.length - 1].sub;
  let v = subViews.get(sub);
  if (!v) {
    v = { id: pg.id, isSub: true, get name() { return sub.name || ''; }, get layout() { return sub.layout === 'Mobile' ? 'Mobile' : 'Kiosk'; }, blocks: [{ id: 1, w: 1, get node() { return sub.node; }, set node(n) { sub.node = n; } }] };
    subViews.set(sub, v);
  }
  return v;
}
const subLabel = (name) => (name || '').trim() || '子頁';
/** 子頁有沒有東西（切過、或那一格不是空白格）：改掉「進入子頁」時有東西才需要能復原。 */
const subHasContent = (sub) => !!sub && (isSplit(sub.node) || canonicalJson(sub.node) !== canonicalJson(DEFAULT_CELL()));
/** 進到 path 那一格的子頁（選取清掉）；回到第 level 層（0＝主頁）時，選取停在剛剛點進去的那一格。 */
function enterSub(path) { navAnimate('push', () => { subStack = [...subStack, path]; selected = null; render(); }); }
function leaveSubTo(level) {
  if (level >= subStack.length) return;
  const back = subStack[level];
  navAnimate('pop', () => { subStack = subStack.slice(0, level); selected = { bi: 0, path: back }; render(); });
}
/** 進出子頁的轉場（2026-10-20 user：不要直接切；同日再改成輪播式）：預覽畫布像輪播一樣兩頁一起移動——
 *  進去＝原本那頁整頁往左滑出去、新的一層緊跟著從右邊滑進來；返回＝反過來。不淡出、不疊在一起。
 *  apply() 改狀態並重畫，舊畫面先複製一份陪著滑走；標頭不跟著滑，名稱與路徑在 renderTrail 依 navDir 原地模糊溶接。
 *  系統開了「減少動態效果」或畫布沒顯示就直接換。 */
let navDir = null, navBusy = false;
const NAV_EASE = 'cubic-bezier(.32, .72, 0, 1)', NAV_MS = 380; // 時間與曲線維持最初那版（user：只改成輪播式，其他不動）
// 不卡的做法（2026-10-20 user 回報轉場卡）：重的工作都在動畫開始「之前」做完，滑動的那幾格主執行緒不排版、不重建——
// ① 畫布字級量測（fitPreview）當下先量好，不留到動畫第一格；② 右側面板（重建最重）滑動時淡出、滑完才重建；
// ③ 兩頁交給合成器（will-change），動畫從下一格乾淨地開始。
function navAnimate(dir, apply) {
  const canvas = $('canvas');
  const frame = canvas && canvas.parentElement;
  const panel = $('cellPanel');
  const still = !frame || !canvas.offsetWidth || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ghost = still ? null : canvas.cloneNode(true);
  navDir = still ? null : dir;
  navBusy = !still;
  try { apply(); } finally { navDir = null; navBusy = false; }
  if (!ghost) { if (panel._navPending) { panel._navPending = false; renderPanel(); } return; }
  if (canvas._fitRaf) { cancelAnimationFrame(canvas._fitRaf); canvas._fitRaf = 0; fitPreview(canvas); }
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.classList.add('cv-nav-ghost');
  frame.appendChild(ghost);
  // 位移量：讓進來的那頁一開始剛好在底框外（畫布置中，左右各留一點底框），兩頁之間留一小段間隔
  const step = (frame.clientWidth + canvas.offsetWidth) / 2 + 8;
  const sign = dir === 'push' ? 1 : -1;
  canvas.style.willChange = ghost.style.willChange = 'transform';
  canvas.style.transform = `translateX(${sign * step}px)`; // 先停在起點，下一格才開始動（這一格只把畫面交出去）
  panel.inert = true;
  panel.classList.add('is-nav');
  requestAnimationFrame(() => {
    canvas.style.transform = '';
    const opts = { duration: NAV_MS, easing: NAV_EASE };
    ghost.animate([{ transform: 'none' }, { transform: `translateX(${-sign * step}px)` }], { ...opts, fill: 'forwards' }).onfinish = () => ghost.remove();
    canvas.animate([{ transform: `translateX(${sign * step}px)` }, { transform: 'none' }], opts).onfinish = () => {
      canvas.style.willChange = '';
      panel.inert = false;
      panel.classList.remove('is-nav');
      if (panel._navPending) { panel._navPending = false; renderPanel(); }
    };
  });
}
// 子頁頂欄（2026-10-20 user 選 A：同園區資訊頂欄）的放大倍數與高度，同播放頁：KIOSK＝寬度係數（820 為準、最多 1080/820）× 1.6，手機模式＝1；
// 頂欄 64px × 倍數 × K（K＝螢幕寬÷1080，至少 1）
const subBarTb = (SW, layout) => (layout === 'Mobile' ? 1 : Math.min(1080 / 820, Math.max(1, SW / 820)) * 1.6);
const subBarPx = (SW, layout) => Math.round(64 * subBarTb(SW, layout) * Math.max(1, SW / 1080));
const colorCss = (n) => '#' + (Number(n ?? 4280693304) >>> 0).toString(16).padStart(8, '0').slice(2);
const isRemote = (uri) => /^https?:\/\//.test(uri) || uri.startsWith('/files/');

// ---------- 版面樹（2026-10-12 排版更自由：每一格都能再切）----------
// 一頁＝blocks[{ id, w, node }]；node＝格子 { t:'cell', … } 或分割 { t:'split', dir, ratio, a, b }。
// dir 'Horizontal'＝橫的分隔線、上下疊（a 在上）；'Vertical'＝左右並排（a 在左）；ratio＝a 佔的比例。
// 與 App LayoutRenderer 同一套語意（App 本來就會一路遞迴畫下去）；App 解析時 ratio 一律夾在 0.1–0.9、區塊權重至少 0.1，
// 這裡產生的值也都守在範圍內。編輯器打開一頁就把多個「大區塊」併成一個區塊（巢狀上下切），之後一律用 path 指格子。
const clampRatio = (r) => { const v = Number(r); return Math.min(0.9, Math.max(0.1, Number.isFinite(v) ? v : 0.5)); };
const roundRatio = (r) => Math.round(clampRatio(r) * 10000) / 10000;
const isSplit = (n) => !!n && n.t === 'split';
/** path 位置的節點（走不到＝null）。 */
function nodeAt(n, path) {
  for (const k of path || '') { if (!isSplit(n)) return null; n = n[k]; }
  return n || null;
}
/** 把 path 位置換成 v，回傳新的根（path＝'' 時換掉的就是根）。 */
function replaceAt(root, path, v) {
  if (!path) return v;
  const parent = nodeAt(root, path.slice(0, -1));
  if (isSplit(parent)) parent[path.slice(-1)] = v;
  return root;
}
/** 所有葉格，深度優先＝畫面上由左而右、由上而下的閱讀順序。 */
function leavesOf(n, path = '', out = []) {
  if (isSplit(n)) { leavesOf(n.a, path + 'a', out); leavesOf(n.b, path + 'b', out); }
  else if (n) out.push({ cell: n, path });
  return out;
}
/** 某個節點物件在樹裡的路徑（找不到＝null）：切割／平均會重建樹，選取用物件找回來。 */
function pathOf(n, target, path = '') {
  if (n === target) return path;
  if (!isSplit(n)) return null;
  const a = pathOf(n.a, target, path + 'a');
  return a !== null ? a : pathOf(n.b, target, path + 'b');
}
/** 每個節點在區塊裡的位置（0–1 比例）：Map(path → { x, y, w, h })。 */
function layoutRects(root) {
  const m = new Map();
  (function walk(n, p, x, y, w, h) {
    m.set(p, { x, y, w, h });
    if (!isSplit(n)) return;
    const r = clampRatio(n.ratio);
    if (n.dir === 'Vertical') { walk(n.a, p + 'a', x, y, w * r, h); walk(n.b, p + 'b', x + w * r, y, w * (1 - r), h); }
    else { walk(n.a, p + 'a', x, y, w, h * r); walk(n.b, p + 'b', x, y + h * r, w, h * (1 - r)); }
  })(root, '', 0, 0, 1, 1);
  return m;
}
/** 一串同方向的成員重建成平衡二元樹：每個節點 ratio＝左半權重÷全部（全部等重＝真正平均）。
 *  切點挑「左半最接近一半」的位置，比例才會落在 1/3–2/3 附近，碰不到 App 的 0.1–0.9 夾值。 */
function chainOf(items, dir) {
  if (items.length === 1) return items[0].n;
  const total = items.reduce((s, it) => s + it.w, 0);
  let k = 1, best = Infinity, acc = 0;
  for (let i = 1; i < items.length; i++) {
    acc += items[i - 1].w;
    const d = Math.abs(acc / total - 0.5);
    if (d < best - 1e-9) { best = d; k = i; }
  }
  const left = items.slice(0, k);
  const lw = left.reduce((s, it) => s + it.w, 0);
  return { t: 'split', dir, ratio: roundRatio(lw / total), a: chainOf(left, dir), b: chainOf(items.slice(k), dir) };
}
/** 舊版面的多個大區塊（直向堆疊、高度權重）→ 一棵等價的樹（巢狀上下切，比例照權重）。 */
function blocksToNode(blocks) {
  if (!blocks || !blocks.length) return DEFAULT_CELL();
  return chainOf(blocks.map((b) => ({ n: b.node || DEFAULT_CELL(), w: Math.max(0.1, Number(b.w) || 1) })), 'Horizontal');
}
/** 編輯器打開一頁：多個大區塊併成一個區塊（畫起來一模一樣）。不算修改——沒動內容就不必重新發布。
 *  舊格式的選取（{ bi, sub }）順便換成 path。 */
function normalizePage(pg) {
  if (!pg) return;
  const blocks = pg.blocks || [];
  const legacy = !!selected && selected.path == null;
  let keep = null;
  if (legacy) {
    const n = blocks[selected.bi] && blocks[selected.bi].node;
    keep = n && (selected.sub ? (isSplit(n) ? n[selected.sub] : null) : n);
  }
  if (blocks.length !== 1 || !blocks[0].node) pg.blocks = [{ id: (blocks[0] && blocks[0].id) || 1, w: 1, node: blocksToNode(blocks) }];
  if (legacy) {
    const p = keep ? pathOf(pg.blocks[0].node, keep) : null;
    selected = p === null ? null : { bi: 0, path: p };
  }
}
/** 一排＝從 path 的父分割往上、同方向分割連成的最大一串；回傳那一串最上面的 path 與方向（根格＝null）。 */
function runAt(root, path) {
  if (!path) return null;
  let top = path.slice(0, -1);
  const dir = nodeAt(root, top).dir;
  while (top && nodeAt(root, top.slice(0, -1)).dir === dir) top = top.slice(0, -1);
  return { top, dir };
}
/** 一排裡每個成員（沿這個方向排開的子樹）佔整排的比例。 */
function runShares(n, dir, share = 1, out = []) {
  if (isSplit(n) && n.dir === dir) {
    const r = clampRatio(n.ratio);
    runShares(n.a, dir, share * r, out); runShares(n.b, dir, share * (1 - r), out);
  } else out.push({ n, share });
  return out;
}
/** 拖分隔線（2026-10-12 user：拖一條線不該動到別的格子）：一排裡每個成員記下路徑與大小，拖動時只改這條線兩邊
 *  緊鄰的兩個成員（兩個加起來不變），其他成員大小不動；樹的形狀不變，只重算這一排每一刀的比例。
 *  （平均分配把三欄存成「（左、中）｜右」，以前直接改那一刀的比例，左邊那格會被一起縮放。） */
function pairRun(root, path) {
  const dir = nodeAt(root, path).dir;
  let top = path;
  while (top && nodeAt(root, top.slice(0, -1)).dir === dir) top = top.slice(0, -1);
  const ms = [];
  (function walk(n, p, share) {
    if (isSplit(n) && n.dir === dir) { const r = clampRatio(n.ratio); walk(n.a, p + 'a', share * r); walk(n.b, p + 'b', share * (1 - r)); }
    else ms.push({ path: p, share });
  })(nodeAt(root, top), top, 1);
  let k = -1;
  ms.forEach((m, j) => { if (m.path.startsWith(path + 'a')) k = j; }); // 線左／上那一格＝這一刀 a 半邊的最後一個成員
  return { top, dir, ms, k, f0: ms[k].share / (ms[k].share + ms[k + 1].share) };
}
/** 依「兩格裡左／上那格佔 f」算出這一排每一刀的新比例；有哪一刀會超出 0.1–0.9（App 讀檔會夾）就回 null。 */
function pairRatios(root, pr, f) {
  const sh = pr.ms.map((m) => m.share), pair = sh[pr.k] + sh[pr.k + 1];
  sh[pr.k] = pair * f; sh[pr.k + 1] = pair * (1 - f);
  const sum = (pre) => pr.ms.reduce((t, m, j) => t + (m.path.startsWith(pre) ? sh[j] : 0), 0);
  const out = [];
  (function walk(n, p) {
    if (!isSplit(n) || n.dir !== pr.dir) return;
    out.push({ n, r: sum(p + 'a') / sum(p) });
    walk(n.a, p + 'a'); walk(n.b, p + 'b');
  })(nodeAt(root, pr.top), pr.top);
  return out.every((x) => x.r >= 0.1 - 1e-9 && x.r <= 0.9 + 1e-9) ? out : null;
}
/** 一排是不是已經平均（每個成員與平均值差在整排的 1% 內）。 */
function runIsEqual(n, dir) {
  const s = runShares(n, dir);
  return s.every((m) => Math.abs(m.share - 1 / s.length) <= 0.01);
}
/** top 那一排重建成平衡樹、每個成員一樣大。 */
function equalizeRun(root, top, dir) {
  return replaceAt(root, top, chainOf(runShares(nodeAt(root, top), dir).map((m) => ({ n: m.n, w: 1 })), dir));
}
const SPLIT_SIDES = ['top', 'right', 'bottom', 'left'];
const SIDE_DIR = { top: 'Horizontal', bottom: 'Horizontal', left: 'Vertical', right: 'Vertical' };
const SIDE_LABEL = { top: '在上方新增一格', right: '在右邊新增一格', bottom: '在下方新增一格', left: '在左邊新增一格' };
/** 分割：新的空白格加在 side 那一邊。這一排（同方向）原本就平均（±1%）才全部重新平均（兩欄再加一格＝三等分）；
 *  原本大小不一（例如舊版面上面很窄的跑馬燈）就只把這一格對半切，別的格子不動（2026-10-12：不然在大圖下面加一格，
 *  跑馬燈會跟著被拉成一樣高）。要全部拉平用「平均分配」。回傳 { root, fresh }。 */
function splitTree(root, path, side) {
  const cell = nodeAt(root, path);
  const fresh = DEFAULT_CELL();
  const dir = SIDE_DIR[side];
  const first = side === 'left' || side === 'top';
  const run = path && nodeAt(root, path.slice(0, -1)).dir === dir ? runAt(root, path) : null;
  const wasEqual = !run || runIsEqual(nodeAt(root, run.top), dir);
  root = replaceAt(root, path, { t: 'split', dir, ratio: 0.5, a: first ? fresh : cell, b: first ? cell : fresh });
  if (!wasEqual) return { root, fresh };
  let top = path;
  while (top && nodeAt(root, top.slice(0, -1)).dir === dir) top = top.slice(0, -1);
  return { root: equalizeRun(root, top, dir), fresh };
}
/** 這一格四邊各能不能切：滿 12 格不行；切完（含同排平均）有格子窄於畫面寬 12%（左右）／矮於畫面高 6%（上下）
 *  而且比原本還小，也不行（原本就被拖得很窄的格子，不會害別的地方都不能切）。 */
function splitSides(root, path) {
  const ok = { top: false, right: false, bottom: false, left: false };
  const cell = nodeAt(root, path);
  if (!cell || isSplit(cell) || leavesOf(root).length >= MAX_CELLS) return ok;
  for (const side of SPLIT_SIDES) {
    const sim = JSON.parse(JSON.stringify(root));
    const rb = layoutRects(sim);
    const before = new Map(leavesOf(sim).map((l) => [l.cell, rb.get(l.path)]));
    const after = splitTree(sim, path, side).root;
    const ra = layoutRects(after);
    const horiz = SIDE_DIR[side] === 'Vertical';
    const min = horiz ? MIN_SPLIT_W : MIN_SPLIT_H;
    ok[side] = leavesOf(after).every((l) => {
      const r = ra.get(l.path), b = before.get(l.cell);
      const size = horiz ? r.w : r.h;
      return size >= min - 1e-6 || (!!b && size >= (horiz ? b.w : b.h) - 1e-6);
    });
  }
  return ok;
}
/** 刪掉 path 那一格：父分割換成另一半（另一半接手空出來的位置）；那一排原本平均（±1%）就重新平均。回傳 { root, sibling }。 */
function deleteFromTree(root, path) {
  if (!path) return { root, sibling: null };
  const parentPath = path.slice(0, -1);
  const parent = nodeAt(root, parentPath);
  const { top, dir } = runAt(root, path);
  const wasEqual = runIsEqual(nodeAt(root, top), dir);
  const sibling = parent[path.slice(-1) === 'a' ? 'b' : 'a'];
  root = replaceAt(root, parentPath, sibling);
  const t = nodeAt(root, top);
  if (wasEqual && isSplit(t) && t.dir === dir) root = equalizeRun(root, top, dir);
  return { root, sibling };
}

function getCell(sel) {
  const n = nodeAt(page().blocks[sel.bi]?.node, sel.path || '');
  return n && !isSplit(n) ? n : null;
}
/** 把 sel 位置的葉格換成 cell。 */
function setCell(sel, cell) {
  const block = page().blocks[sel.bi];
  if (block) block.node = replaceAt(block.node, sel.path || '', cell);
}
const sameSel = (a, b) => !!a && !!b && a.bi === b.bi && (a.path || '') === (b.path || '');
/**
 * 對調兩格的設定（背景、內容、天氣…全部跟著走），格位大小不動。
 * 只換葉格所以永遠合法：不會把分割節點塞進子格。選取框跟著被拖的格子走。
 */
function swapCells(from, to) {
  const a = getCell(from), b = getCell(to);
  if (!a || !b || a === b) return false;
  setCell(from, b); setCell(to, a);
  if (sameSel(selected, from)) selected = { ...to };
  else if (sameSel(selected, to)) selected = { ...from };
  setDirty(true);
  return true;
}

/** 分割的子格像素（App splitChildSize 同算法：每一層各自四捨五入）。 */
function splitChildPx(px, node, second) {
  const ratio = clampRatio(node.ratio);
  const frac = second ? 1 - ratio : ratio;
  return node.dir === 'Horizontal' ? { w: px.w, h: Math.round(px.h * frac) } : { w: Math.round(px.w * frac), h: px.h };
}
/** 與 App cellPixelSize 相同：這一格在機器實體螢幕上佔的像素（沿 path 一層層往下乘）。 */
function cellPixelSizeOf(sel) {
  const scr = state.config.screen;
  const SW = scr && scr.w > 0 ? scr.w : 1080;
  const SH0 = scr && scr.h > 0 ? scr.h : 1920;
  const SH = page().isSub ? SH0 - subBarPx(SW, page().layout) : SH0; // 子頁：上面有一條頂欄
  const blocks = page().blocks;
  const total = blocks.reduce((s, b) => s + (b.w || 1), 0);
  let px = { w: SW, h: Math.round((SH * (blocks[sel.bi]?.w || 1)) / total) };
  let n = blocks[sel.bi]?.node;
  for (const k of sel.path || '') { if (!isSplit(n)) break; px = splitChildPx(px, n, k === 'b'); n = n[k]; }
  return px;
}

/** 面板標題：格子照閱讀順序編號（由左而右、由上而下）。 */
function cellLabel(sel) {
  const i = leavesOf(page().blocks[sel.bi]?.node).findIndex((l) => l.path === (sel.path || ''));
  return `格子 ${i + 1}`;
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
    b.title = dir === 'prev' ? '向左捲動' : '向右捲動';
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
      if (v !== null && v !== undefined) { p.name = String(v).trim(); setDirty(true); renderTabs(); renderTrail(); }
    };
    tab.appendChild(ren);
    if (state.config.pages.length > 1) {
      const del = document.createElement('button');
      del.innerHTML = '<i data-lucide="x"></i>'; del.title = '刪除此頁'; del.setAttribute('aria-label', '刪除此頁');
      del.onclick = (e) => {
        e.stopPropagation();
        withUndo(`已刪除「${p.name || `頁面 ${i + 1}`}」。`, () => {
          state.config.pages.splice(i, 1);
          if ((state.config.activePage || 0) >= state.config.pages.length) state.config.activePage = state.config.pages.length - 1;
          pageIndex = Math.min(pageIndex, state.config.pages.length - 1);
          selected = null; subStack = []; setDirty(true); render();
        });
      };
      tab.appendChild(del);
    }
    tab.onclick = () => { pageIndex = i; selected = null; subStack = []; render(); }; // 子頁裡點主頁頁籤＝回到主頁
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
      selected = null; subStack = []; setDirty(true); render();
    };
    nav.appendChild(add);
  }
  if (window.lucide) lucide.createIcons({ nodes: [nav] });
  {
  }
}

/** 一頁裡有幾個子頁（往下每一層都算）。 */
function countSubs(n) {
  return leavesOf(n).reduce((t, l) => t + (l.cell.tap === 'OpenSubPage' && l.cell.sub ? 1 + countSubs(l.cell.sub.node) : 0), 0);
}
/** 畫布標頭（2026-10-20 user 選「畫框標頭」，同 App 頂欄）：跟預覽畫框黏成一張卡、一直都在。
 *  左邊同一顆鈕：主頁＝⌂（不能按），進子頁就變形成 ←（回上一層，morph-icons.js）；
 *  主頁＝主頁名稱／「主頁」＋「N 個子頁」；子頁＝子頁名稱、底下一行路徑（前面幾段可點回那一層）＋「第 N 層子頁」。
 *  進出子頁時（navDir）標頭不動，名稱、路徑、小標籤原地模糊溶接。由 JS 建（index.html 是伺服器快取的範本）。 */
function renderTrail() {
  let head = $('pageHead');
  if (!head) {
    const frame = document.querySelector('#editor .canvas-frame');
    if (!frame) return;
    head = document.createElement('div');
    head.id = 'pageHead'; head.className = 'page-head';
    head.innerHTML = '<button type="button" class="ph-lead" data-icon="house"><i data-lucide="house"></i></button><div class="ph-stage"><div class="ph-body"></div></div>';
    head.querySelector('.ph-lead').onclick = () => { if (subStack.length) leaveSubTo(subStack.length - 1); };
    frame.before(head);
    if (window.lucide) lucide.createIcons({ nodes: [head] });
  }
  head.hidden = !state || !mainPage();
  if (head.hidden) return;
  page(); // 先把對不上的層數修掉
  const trail = subTrail();
  const mainName = mainPage().name || `頁面 ${pageIndex + 1}`;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // 左邊那顆：⌂ ↔ ←（變形；變不了就硬換）
  const lead = head.querySelector('.ph-lead');
  const want = trail.length ? 'arrow-left' : 'house';
  lead.disabled = !trail.length;
  lead.title = trail.length ? '返回上一層' : '';
  lead.setAttribute('aria-label', trail.length ? '返回上一層' : '主頁');
  if (lead.dataset.icon !== want) {
    if (!(window.morphIcon && window.morphIcon(lead, want))) { lead.innerHTML = `<i data-lucide="${want}"></i>`; if (window.lucide) lucide.createIcons({ nodes: [lead] }); }
    lead.dataset.icon = want;
  }

  // 名稱、路徑、右邊的小標籤
  const body = el('div', 'ph-body');
  const text = el('div', 'ph-text');
  const title = el('span', 'ph-title', trail.length ? subLabel(trail[trail.length - 1].sub.name) : mainName);
  const sub = el('nav', 'ph-sub');
  if (!trail.length) sub.textContent = '主頁';
  else {
    sub.setAttribute('aria-label', '子頁路徑');
    const names = [mainName, ...trail.map((c) => subLabel(c.sub.name))];
    names.forEach((name, i) => {
      if (i) sub.appendChild(el('span', 'ph-sep', '›'));
      if (i === names.length - 1) { const cur = el('span', '', name); cur.setAttribute('aria-current', 'page'); sub.appendChild(cur); return; }
      const b = el('button', 'ph-link', name); b.type = 'button'; b.onclick = () => leaveSubTo(i);
      sub.appendChild(b);
    });
  }
  text.append(title, sub);
  body.appendChild(text);
  const n = trail.length ? 0 : countSubs(mainPage().blocks?.[0]?.node);
  if (trail.length || n) {
    const chip = el('span', 'ph-chip');
    if (!trail.length) chip.innerHTML = '<span class="material-icons" aria-hidden="true">layers</span>';
    chip.append(trail.length ? `第 ${trail.length} 層子頁` : `${n} 個子頁`);
    body.appendChild(chip);
  }
  // 換字：進出子頁時標頭不移動（2026-10-20 user），舊字模糊淡掉、新字從模糊變清楚，兩層疊在同一格；平常重畫直接換
  const stage = head.querySelector('.ph-stage');
  const olds = [...stage.children];
  stage.appendChild(body);
  if (!navDir) { olds.forEach((o) => o.remove()); return; }
  olds.forEach((o) => {
    o.classList.add('is-leaving');
    o.animate([{ filter: 'blur(0)', opacity: 1 }, { filter: 'blur(4px)', opacity: 0 }], { duration: 140, easing: 'ease-out', fill: 'forwards' }).onfinish = () => o.remove();
  });
  // 時間收短（user 2026-10-20：要俐落）：舊字 140ms 淡掉、新字 40ms 後 200ms 清楚，總共約 0.24 秒
  body.animate([{ filter: 'blur(4px)', opacity: 0 }, { filter: 'blur(0)', opacity: 1 }], { duration: 200, delay: 40, easing: 'cubic-bezier(.2, 0, 0, 1)', fill: 'backwards' });
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
  if (!state || !mainPage() || wsMode === 'shared') return;
  const btn = $('showPageBtn');
  const name = mainPage().name || `頁面 ${pageIndex + 1}`;
  const doneMsg = `「${curDevName()}」正在切換到「${name}」。`;
  btn.disabled = true;
  let ok = false;
  try {
    if (dirty) {
      state.config.activePage = pageIndex;
      activePageTouched = true;
      await savePublish({ doneMsg }); // 失敗時它自己會 toast 並把 dirty 留著
      ok = !dirty;
    } else {
      await api('PUT', `/api/config/${encodeURIComponent(deviceId)}`, { config: { activePage: pageIndex }, reason: 'switchPage' });
      state.config.activePage = pageIndex;
      setStatus(doneMsg);
      ok = true;
    }
  } catch (e) { setStatus(`無法切換「${curDevName()}」的展示頁。${e.message}`, true); }
  finally { btn.disabled = false; updateShowPageBtn(); }
  if (ok) window.morphFlash?.(btn, 'monitor-check'); // 螢幕裡的播放鈕變成打勾，一會兒變回來（morph-icons.js）
});

// ---------- 畫布 ----------
function renderCanvas() {
  const canvas = $('canvas');
  previewTimers.forEach(clearInterval);
  previewTimers = [];
  normalizePage(page()); // 舊版面的多個大區塊先併成一個區塊（畫起來一樣），之後每一格都能再切
  renderTrail(); // 畫布標頭（名稱、路徑、子頁數）跟著畫布一起更新
  const pg = page();
  buildCanvas(canvas, pg, state.config.screen, { timers: previewTimers, subBar: pg && pg.isSub ? { name: subLabel(pg.name), layout: pg.layout } : null });
  cancelAnimationFrame(canvas._fitRaf); // 連續重畫只量最後一次；轉場會直接拿來先量（navAnimate）
  canvas._fitRaf = requestAnimationFrame(() => { canvas._fitRaf = 0; fitPreview(canvas); });
}

/** 選取格往 side 那一邊加一格（新格子＝空白格），同一排原本一樣大就自動平均；切完選新格子。 */
function splitSelectedCell(side) {
  const block = selected && page().blocks[selected.bi];
  if (!block) return;
  if (!splitSides(block.node, selected.path)[side]) {
    return setStatus(leavesOf(block.node).length >= MAX_CELLS ? `無法新增格子。一頁最多 ${MAX_CELLS} 格。` : '無法在這一側新增格子。這一格的空間不足。', true);
  }
  const { root, fresh } = splitTree(block.node, selected.path, side);
  block.node = root;
  selected = { bi: selected.bi, path: pathOf(root, fresh) };
  setDirty(true);
  renderCanvas(); renderPanel();
}

// 編輯畫布的格子位置：整棵樹算出每格的比例（0–1），絕對定位成百分比；內側邊各退半個縫，外圈貼齊。
// （巢狀 flex 每一層都會扣掉分隔線寬，切得越深比例越不準；照比例放才跟機器、播放頁一致。）唯讀預覽縫＝0，跟機器一樣無縫。
const CANVAS_GAP = 8;
const pctOf = (v) => `${(v * 100).toFixed(4)}%`;
function placeBox(el, r, gap) {
  const g = gap / 2, E = 1e-6;
  const l = r.x > E ? g : 0, t = r.y > E ? g : 0;
  const rr = r.x + r.w < 1 - E ? g : 0, b = r.y + r.h < 1 - E ? g : 0;
  el.style.left = `calc(${pctOf(r.x)} + ${l}px)`;
  el.style.top = `calc(${pctOf(r.y)} + ${t}px)`;
  el.style.width = `calc(${pctOf(r.w)} - ${l + rr}px)`;
  el.style.height = `calc(${pctOf(r.h)} - ${t + b}px)`;
}
/** 分隔線＝12px 寬的拖曳區，壓在兩格之間的縫上，長度＝這個分割的範圍。 */
function placeDivider(el, r, n, gap) {
  placeBox(el, r, gap);
  const at = clampRatio(n.ratio);
  if (n.dir === 'Vertical') { el.style.left = `calc(${pctOf(r.x + r.w * at)} - 6px)`; el.style.width = '12px'; }
  else { el.style.top = `calc(${pctOf(r.y + r.h * at)} - 6px)`; el.style.height = '12px'; }
}
/** 新格子預覽：新格子會出現在選取格的哪一半。 */
const halfRect = (r, side) => (side === 'left' ? { ...r, w: r.w / 2 } : side === 'right' ? { ...r, x: r.x + r.w / 2, w: r.w / 2 }
  : side === 'top' ? { ...r, h: r.h / 2 } : { ...r, y: r.y + r.h / 2, h: r.h / 2 });

/**
 * 把一頁畫進 canvas 元素（編輯畫布與縮圖預覽共用）。
 * opts.readonly＝唯讀預覽：不畫分隔把手/角標、格子不可點；opts.timers＝輪播計時器要收進哪個陣列。
 * 編輯畫布另外畫：每個分割的分隔線（任何深度）與新格子預覽框（右側十字滑上去時出現，canvas._preview）。
 * 拖分隔線時只重新定位（canvas._place），放開才整個重畫。
 */
// 預覽畫布現在對應的螢幕寬（裝置 px）：cqw 相對整個畫布，格子內以裝置 px 設計的尺寸要除以它換算，不是除以格子寬
// （之前分割成兩半的格子，徽章／園區按鈕會放大兩倍——user 2026-09-10 回報）
let canvasScreenW = 1080;
function buildCanvas(canvas, pg, screen, opts) {
  opts = opts || {};
  canvas.innerHTML = '';
  // 用機器上報的真實螢幕比例畫預覽（沒有就用 9:16 直式）
  const scr = screen;
  const SW = scr && scr.w > 0 ? scr.w : 1080;
  const SH = scr && scr.h > 0 ? scr.h : 1920;
  canvasScreenW = SW;
  canvas.style.aspectRatio = `${SW} / ${SH}`;
  canvas.style.setProperty('--sr', (SW / SH).toFixed(5)); // 底框內 contain 縮放用（CSS .canvas-frame > .canvas）
  canvas.classList.toggle('is-landscape', SW > SH); // 橫式（縮圖放大預覽 .tp-canvas 以寬度定尺寸）
  canvas.classList.toggle('is-readonly', !!opts.readonly); // 唯讀預覽：格子不亮框、不變手指（CSS .is-readonly）
  const editable = !opts.readonly;
  const blocks = pg.blocks || [];
  // 舊版面（多個大區塊）在縮圖裡不改資料：照同一套換算成一棵樹來畫
  const tree = blocks.length === 1 && blocks[0].node ? blocks[0].node : blocksToNode(blocks);
  // 子頁：最上面是機器自動加的頂欄（返回／名稱／首頁），版面畫在它下面（opts.subBar＝子頁名稱）
  let cellsH = SH;
  if (opts.subBar != null) {
    const barPx = subBarPx(SW, opts.subBar.layout);
    cellsH = SH - barPx;
    const bar = document.createElement('div');
    bar.className = 'cv-subbar';
    bar.style.height = pctOf(barPx / SH);
    bar.dataset.tb = subBarTb(SW, opts.subBar.layout); // fitPreview 依畫布寬換算字級
    bar.style.setProperty('--kfs', opts.subBar.layout === 'Mobile' ? '1' : '1.45'); // KIOSK 標題另外放大 1.45 倍（同 App）
    bar.title = '子頁頂欄，機器上會自動顯示';
    bar.innerHTML = '<span class="cvb-btn"><span class="material-icons" aria-hidden="true">arrow_back</span></span><span class="cv-subbar-title"></span><span class="cvb-btn"><span class="material-icons" aria-hidden="true">home</span></span>';
    bar.querySelector('.cv-subbar-title').textContent = opts.subBar.name;
    canvas.appendChild(bar);
  }
  const root = document.createElement('div');
  root.className = 'cv-root';
  canvas.appendChild(root);
  const gap = editable ? CANVAS_GAP : 0;

  // 格子（右上角標籤＝與 App cellPixelSize 相同的「實際機器像素」）＋每個分割一條分隔線
  const cells = [], dividers = [];
  (function walk(n, path, px) {
    if (isSplit(n)) {
      walk(n.a, path + 'a', splitChildPx(px, n, false));
      walk(n.b, path + 'b', splitChildPx(px, n, true));
      if (editable) dividers.push({ el: splitDivider(canvas, tree, n, path), n, path });
      return;
    }
    cells.push({ el: cellDiv(n || DEFAULT_CELL(), { bi: 0, path }, px, opts), path });
  })(tree, '', { w: SW, h: cellsH });
  cells.forEach((c) => root.appendChild(c.el));
  dividers.forEach((d) => root.appendChild(d.el));

  // 新格子預覽（2026-10-12 user：畫布上的＋拿掉，面板的十字就夠）：滑到／聚焦右側十字的方向鈕時，
  // 用虛線框標出新格子會出現在選取格的哪一半；canvas._preview(side)，side＝null 收起
  canvas._preview = null;
  canvas._previewEven = null;
  const selPath = editable && selected && selected.bi === 0 ? selected.path : null;
  const selNode = selPath != null ? nodeAt(tree, selPath) : null;
  if (selNode && !isSplit(selNode)) {
    const ghost = document.createElement('div');
    ghost.className = 'cv-ghost';
    ghost.textContent = '新格子';
    ghost.hidden = true;
    root.appendChild(ghost);
    canvas._preview = (side) => {
      if (!side) { ghost.hidden = true; return; }
      placeBox(ghost, halfRect(layoutRects(tree).get(selPath), side), gap);
      ghost.hidden = false;
    };
    // 「平均分配」預覽：這一格所在的那一排，按下去之後每一個成員的位置（整排的範圍平均切開）
    const run = runAt(tree, selPath);
    if (run) {
      const n = runShares(nodeAt(tree, run.top), run.dir).length;
      const evens = [];
      canvas._previewEven = (on) => {
        evens.forEach((e) => e.remove());
        evens.length = 0;
        if (!on) return;
        const R = layoutRects(tree).get(run.top), v = run.dir === 'Vertical';
        for (let i = 0; i < n; i++) {
          const box = document.createElement('div');
          box.className = 'cv-ghost is-even';
          box.innerHTML = `<span>${v ? '等寬' : '等高'}</span>`; // 標籤放框的上緣，不跟格子原本的字疊在一起
          root.appendChild(box);
          placeBox(box, v ? { x: R.x + (R.w * i) / n, y: R.y, w: R.w / n, h: R.h } : { x: R.x, y: R.y + (R.h * i) / n, w: R.w, h: R.h / n }, gap);
          evens.push(box);
        }
      };
    }
  }

  const place = () => {
    const rects = layoutRects(tree);
    canvas._rects = rects;
    cells.forEach((c) => placeBox(c.el, rects.get(c.path), gap));
    dividers.forEach((d) => placeDivider(d.el, rects.get(d.path), d.n, gap));
  };
  canvas._place = place;
  place();
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
  // 子頁頂欄：標題 30px × 頂欄倍數（以 1080 寬為準）照畫布寬換算，太小看不清就至少 9px；圓鈕、間距用 em 跟著縮放
  const subBar = canvas.querySelector('.cv-subbar');
  if (subBar) subBar.style.fontSize = `${Math.max(9, (cw * 30 * Number(subBar.dataset.tb || 1)) / 1080)}px`;
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
  // 測站讀完（或連不上）：格子面板的「園區測站／園區資訊」可不可用變了才重畫
  const cp = $('cellPanel');
  if (cp && cp._parkKey != null && cp.offsetParent !== null && cp._parkKey !== parkAvailKey()) renderPanel();
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
let lastCellClick = { key: '', t: 0 }; // 畫布上「點兩下進子頁」用

function cellDiv(cell, sel, sizePx, opts) {
  opts = opts || {};
  const timers = opts.timers || previewTimers;
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.bi = sel.bi;
  el.dataset.path = sel.path; // 位置由 buildCanvas 照比例放（placeBox）
  if (!opts.readonly && sameSel(selected, sel)) el.classList.add('selected');
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
    if (cell.txtPos && cell.txtPos !== 'Center') t.dataset.pos = cell.txtPos;
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
    const stationMode = cell.wSrc === 'Station' && !!PARK_API; // 場域沒有測站資料來源＝展示機改顯示一般天氣，預覽照做
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
      else if (!forecast) renderHint('正在取得天氣資料…');
      else if (forecast.error) renderHint('暫時無法取得天氣資料');
      else renderBar(forecast);
    } else {
      const snap = getStations(PARK_API);
      if (!snap) renderHint('正在取得測站資料…');
      else if (snap.error) renderHint('暫時無法取得測站資料');
      else if (!snap.stations.length) renderHint('測站資料來源中沒有任何測站');
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
    v.innerHTML = `<span class="material-icons">play_circle</span> ${cell.video ? '影片' : '尚未選擇影片'}`;
    el.appendChild(v);
  } else if (cell.content === 'Web') {
    const v = document.createElement('div');
    v.className = 'pv-icon'; v.style.color = fg;
    let host = '';
    try { host = new URL(cell.web).host; } catch { host = cell.web || '未設定網址'; }
    v.innerHTML = `<span class="material-icons">language</span> ${host}`;
    el.appendChild(v);
  }
  // 園區資訊標題／按鈕式提示，版面規則與 App ParkCellOverlay 相同（直橫自動、字級以 28/40sp 為上限縮放）；角落徽章式提示
  if (cell.content === 'ParkInfo' || liveHintOf(cell) === 'Button') renderParkOverlay(el, cell, sizePx, fg);
  if (liveHintOf(cell) === 'Badge') renderHintBadge(el, cell, sizePx);
  if (liveHintOf(cell) === 'Glow') { el.classList.add('hint-glow'); el.style.setProperty('--hint-color', colorCss(cell.tapHintColor ?? 0xFFFFFFFF)); }

  if (opts.readonly) return el; // 唯讀預覽：沒有角標、不可點

  // 右上角標籤：類型 · 實際像素尺寸（與 App 管理預覽的 CellChip 角標相同）
  const typeLabel = cell.content !== 'None' ? (CONTENT_NAMES[cell.content] || cell.content)
    : cell.bg === 'Image' ? '圖片背景' : '純色背景';
  const badge = document.createElement('div');
  badge.className = 'pv-size-badge';
  badge.innerHTML = `<span>${typeLabel} · ${sizePx ? `${sizePx.w}×${sizePx.h}` : ''}</span>` +
    (cell.tap && cell.tap !== 'None' ? '<span class="material-icons">open_in_new</span>' : '');
  el.appendChild(badge);
  // 有子頁的格子：左上角小圖示；點兩下直接進子頁
  if (cell.tap === 'OpenSubPage' && cell.sub) {
    const chip = document.createElement('div');
    chip.className = 'pv-sub-chip';
    chip.title = `這一格有子頁「${subLabel(cell.sub.name)}」，按兩下即可編輯`;
    chip.innerHTML = '<span class="material-icons" aria-hidden="true">layers</span>';
    el.appendChild(chip);
  }

  el.onclick = () => {
    if (el._dragged) { el._dragged = false; return; }
    // 點兩下有子頁的格子＝進子頁（第一下會重畫畫布，第二下落在新的格子元素上，瀏覽器的 dblclick 不會觸發，自己算）
    const key = `${subStack.join('/')}|${sel.path}`, now = Date.now();
    if (cell.tap === 'OpenSubPage' && cell.sub && lastCellClick.key === key && now - lastCellClick.t < 450) {
      lastCellClick = { key: '', t: 0 };
      enterSub(sel.path);
      return;
    }
    lastCellClick = { key, t: now };
    selected = sel; renderCanvas(); renderPanel();
  };
  attachCellDrag(el, sel);
  return el;
}

/**
 * 拖曳把手的共用行為：拖曳期間只重新定位（畫布不重畫，指標不會「斷手」），放開時才重畫一次定案。
 * onDrag(位移, 事件)：事件給指標位置（分隔線的比例小標籤跟著指標走）。
 */
function attachDrag(el, isVertical, onDrag, onEnd) {
  el.addEventListener('pointerdown', (down) => {
    down.preventDefault();
    el.setPointerCapture(down.pointerId);
    el.classList.add('dragging');
    document.body.style.cursor = isVertical ? 'col-resize' : 'row-resize';
    const startPos = isVertical ? down.clientX : down.clientY;
    const move = (m) => onDrag((isVertical ? m.clientX : m.clientY) - startPos, m);
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
      ghost.style.left = ghost.style.top = '0px'; // 格子本身是畫布裡的百分比位置，幽靈改跟著指標（transform）
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
      const to = target && { bi: Number(target.dataset.bi), path: target.dataset.path || '' };
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
    const sel = { bi: Number(el.dataset.bi), path: el.dataset.path || '' };
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

/** 分隔線拖到這些比例附近（±2.5%）會吸附。 */
const SNAP_AT = [1 / 2, 1 / 3, 2 / 3, 1 / 4, 3 / 4];
/** 分割之間的把手（任何深度都有）：沿分割方向拖曳調整兩邊比例，夾在 0.1–0.9（App 同範圍）；
 *  靠近 1/2、1/3、2/3、1/4、3/4 會吸附，指標旁的小標籤顯示目前比例（吸附時換主題色）。 */
function splitDivider(canvas, tree, node, path) {
  const el = document.createElement('div');
  const vertical = node.dir === 'Vertical';
  el.className = 'cv-divider ' + (vertical ? 'is-v' : 'is-h');
  el.dataset.path = path;
  el.title = '拖曳調整比例';
  let tip = null, pr = null;
  el.addEventListener('pointerdown', () => {
    canvas.classList.add('is-resizing'); // 拖的時候先收起預覽框，畫面乾淨
    const box = el.parentElement.getBoundingClientRect();
    // 只動線兩邊緊鄰的兩格：拖動距離換算成「這兩格」裡的比例
    pr = pairRun(tree, path);
    const r1 = canvas._rects.get(pr.ms[pr.k].path), r2 = canvas._rects.get(pr.ms[pr.k + 1].path);
    el._size = (vertical ? box.width * (r1.w + r2.w) : box.height * (r1.h + r2.h)) || 1;
    el._start = pr.f0;
  });
  attachDrag(el, vertical, (delta, m) => {
    let v = Math.min(0.9, Math.max(0.1, el._start + delta / el._size));
    const snap = SNAP_AT.find((s) => Math.abs(v - s) <= 0.025);
    if (snap !== undefined) v = snap;
    let rs = pairRatios(tree, pr, v);
    if (!rs) { // 拖太遠會讓某一刀超出 0.1–0.9：停在拖得到的最遠處
      let lo = el._start, hi = v;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (pairRatios(tree, pr, mid)) lo = mid; else hi = mid; }
      v = lo; rs = pairRatios(tree, pr, v);
    }
    if (rs) rs.forEach((x) => { x.n.ratio = Math.round(x.r * 10000) / 10000; });
    if (!tip) { tip = document.createElement('div'); tip.className = 'cv-drag-tip'; document.body.appendChild(tip); }
    const a = Math.round(v * 100);
    tip.textContent = `${a}% ｜ ${100 - a}%`;
    tip.classList.toggle('is-snap', snap !== undefined);
    tip.style.left = `${m.clientX + 14}px`;
    tip.style.top = `${m.clientY + 18}px`;
    canvas._place();
    setDirty(true);
    updateBadges();
  }, () => {
    if (tip) { tip.remove(); tip = null; }
    canvas.classList.remove('is-resizing');
    renderCanvas();
    $('cellPanel')._syncLayoutTools?.(); // 比例變了：十字能不能按、平均分配亮不亮跟著更新
  });
  return el;
}

// ---------- 右側單格設定面板 ----------
function renderPanel() {
  const panel = $('cellPanel');
  if (navBusy) { panel._navPending = true; return; }
  panel._parkKey = parkAvailKey(); // 轉場中不重建（很重），滑完再建（navAnimate）
  // 重繪前先記住捲動位置：innerHTML 清空的瞬間內容高度歸零，面板（和 modal 內的 body）的 scrollTop
  // 被夾回 0，每改一個設定就跳回頂部（user 2026-09-09 回報 UX 很差）。重建完再把位置放回去。
  const scrollers = [panel, panel.closest('.b-modal-body')].filter(Boolean);
  const savedScroll = scrollers.map((el) => [el, el.scrollTop]);
  if (state && page()) normalizePage(page()); // 舊格式的選取／多個大區塊（renderCanvas 通常已先做過）
  const sel = selected;
  const cell = sel && getCell(sel);
  // 只有「同一格重繪」才放回去；點到別的格子仍從頂部開始看（用格子物件比：切割／平均之後同一格的 path 會變）
  const sameCell = !!cell && panel._renderedCell === cell;
  panel._renderedCell = cell || null;
  const restoreScroll = () => { if (sameCell) savedScroll.forEach(([el, top]) => { if (el.scrollTop !== top) el.scrollTop = top; }); };
  panel.querySelectorAll('.seg-row').forEach((row) => row._dispose?.());
  panel._syncLayoutTools = null; // 版面區段（十字／平均分配）的狀態重算，下面建好才掛上
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
      '<p class="b-empty-sub">在左側預覽畫面中選擇任一格子，設定會顯示在這裡。</p>' +
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
  // 園區測站不能用（parkAvail）時：第 from 列之後整塊變灰、控件鎖住；設定照樣保留，原因＝下拉選單上的狀態小標（2026-10-20 user）
  const greyFrom = (from) => {
    [...body.children].slice(from).forEach((r) => { r.classList.add('is-unavail'); r.querySelectorAll('input, select, textarea, button').forEach((x) => { x.disabled = true; }); });
  };
  const pa = parkAvail();
  // 不能用時選項照列：沒選的變灰不能選、選著的照常顯示，兩種都掛狀態小標（「連線失敗」等）
  const parkOpt = (k, n, cur) => (pa.ok ? [k, n] : [k, n, !cur, pa.short]);
  const parkBadge = () => Object.assign(document.createElement('span'), { className: 'b-dd-badge park-src-badge', textContent: pa.short }); // 同下拉選單的小標，靠最右邊
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

  // ---- 版面（2026-10-12 排版更自由）：十字按哪一邊新格子就加在哪一邊（同畫布上格子邊的「＋」），
  //      同一排原本一樣大就自動平均（大小不一只切這一格）；「平均分配」把這一格所在的那一排調成一樣大；「刪除這格」把位置交給旁邊那一格 ----
  {
    const block = page().blocks[sel.bi];
    const tree = block.node;
    const total = leavesOf(tree).length;
    sec('版面');
    const wrap = rowFull();
    wrap.classList.add('split-tools');
    const cross = document.createElement('div');
    cross.className = 'split-cross';
    cross.setAttribute('role', 'group');
    cross.setAttribute('aria-label', '分割這一格');
    const ARROW = { top: 'arrow-up', left: 'arrow-left', right: 'arrow-right', bottom: 'arrow-down' };
    const NAME = { top: '上方', left: '左邊', right: '右邊', bottom: '下方' };
    const dirBtns = {};
    const dirBtn = (side) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'split-dir';
      b.dataset.side = side;
      b.innerHTML = `<i data-lucide="${ARROW[side]}" aria-hidden="true"></i><span>${NAME[side]}</span>`;
      b.setAttribute('aria-label', SIDE_LABEL[side]);
      b.onclick = () => splitSelectedCell(side);
      // 滑上去／鍵盤聚焦：畫布先用虛線框標出新格子的位置
      const show = () => { if (!b.disabled) document.getElementById('canvas')._preview?.(side); };
      const hide = () => document.getElementById('canvas')._preview?.(null);
      b.addEventListener('mouseenter', show); b.addEventListener('focus', show);
      b.addEventListener('mouseleave', hide); b.addEventListener('blur', hide);
      dirBtns[side] = b;
      return b;
    };
    const self = document.createElement('div');
    self.className = 'split-self';
    self.textContent = '這一格';
    const blank = () => document.createElement('span');
    cross.append(blank(), dirBtn('top'), blank(), dirBtn('left'), self, dirBtn('right'), blank(), dirBtn('bottom'), blank());
    const side = document.createElement('div');
    side.className = 'split-side';
    const count = hint(`目前 ${total} 格（最多 ${MAX_CELLS} 格，過小的格子無法再分割）`);
    count.classList.add('split-count');
    const acts = document.createElement('div');
    acts.className = 'split-acts';
    const even = btn('平均分配', () => {
      const r = runAt(block.node, sel.path);
      if (!r) return;
      block.node = equalizeRun(block.node, r.top, r.dir);
      const p = pathOf(block.node, cell);
      selected = p === null ? null : { bi: sel.bi, path: p };
      setDirty(true); refresh();
    });
    // 滑上去／鍵盤聚焦：畫布先框出按下去之後同一排每一格的位置
    const evenShow = () => { if (!even.disabled) document.getElementById('canvas')._previewEven?.(true); };
    const evenHide = () => document.getElementById('canvas')._previewEven?.(false);
    even.addEventListener('mouseenter', evenShow); even.addEventListener('focus', evenShow);
    even.addEventListener('mouseleave', evenHide); even.addEventListener('blur', evenHide);
    const del = btn('刪除這格', () => {
      // 有設定的格子：直接刪＋「復原」toast（原本先跳確認）；空白格直接刪、不跳
      const used = (cell.content && cell.content !== 'None') || (cell.bg === 'Image' && (cell.bgImgs || []).length) || (cell.tap && cell.tap !== 'None');
      const doDelete = () => {
        const { root, sibling } = deleteFromTree(block.node, sel.path);
        block.node = root;
        const p = sibling && !isSplit(sibling) ? pathOf(root, sibling) : null; // 接手的那一格是單格就選它
        selected = p === null ? null : { bi: sel.bi, path: p };
        setDirty(true); refresh();
      };
      if (used) withUndo('已刪除這一格。', doDelete); else doDelete();
    });
    del.classList.add('b-btn-text', 'b-btn-text-danger');
    del.disabled = !sel.path;
    del.title = sel.path ? '刪除後，空出的位置會併入相鄰的格子' : '這一頁只剩一格，無法刪除';
    acts.append(even, del);
    side.append(hint('新格子會加在所選的一側（指標移到按鈕上可先預覽），同一排原本等大時會自動平均分配。'), count, acts);
    wrap.append(cross, side);
    if (window.lucide) lucide.createIcons({ nodes: [cross] });
    // 能不能往哪邊切、要不要平均都跟著格子大小變：拖完分隔線只重算這幾顆鈕（整個面板重畫會閃一下）
    const syncTools = () => {
      const t = block.node, ok = splitSides(t, sel.path), run = runAt(t, sel.path);
      const full = leavesOf(t).length >= MAX_CELLS;
      for (const s of SPLIT_SIDES) {
        dirBtns[s].disabled = !ok[s];
        dirBtns[s].title = ok[s] ? SIDE_LABEL[s] : full ? `一頁最多 ${MAX_CELLS} 格` : '格子過小，無法再往這一側分割';
      }
      const evenNow = !run || runIsEqual(nodeAt(t, run.top), run.dir);
      even.disabled = evenNow;
      even.title = !run ? '這一頁只有一格' : evenNow ? '同一排的格子已經等大'
        : `將這一格所在的那一排（${run.dir === 'Vertical' ? '左右並排' : '上下相疊'}）調整為等大`;
    };
    syncTools();
    panel._syncLayoutTools = syncTools;
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
      subRow('', hint('依即時天氣顯示動態天空（陽光、雲、雨絲…），文字顏色會自動調整，深色天空使用白字，霧、雪天使用黑字。'));
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
        subRow('', hint('圖片在留白側的邊緣會逐漸淡出，與模糊背景融合。'));
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
        const help = hint('提高模糊程度時，背景也會稍微變暗（最多 20%），讓文字更易閱讀。');
        help.id = 'cell-bg-blur-hint';
        subRow('模糊', slider, help);
      }
    }
  }

  // ---- 內容 ----
  {
    sec('內容');
    rowFull(selInput(
      Object.entries(CONTENT_NAMES).map(([k, n]) => (k === 'ParkInfo' ? parkOpt(k, n, cell.content === 'ParkInfo') : [k, n])), cell.content || 'None',
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
    if (cell.content === 'Text') {
      // 文字位置九宮格（2026-10-20 user：先做固定九宮格，不做自由拖拉）；沒設＝置中
      subRow('位置', posGrid(cell.txtPos || 'Center', (v) => { cell.txtPos = v; touch(); }));
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
      const srcRow = subRow('來源', segRow([
        ['一般天氣', !stationMode, () => { cell.wSrc = 'Standard'; setDirty(true); refresh(); }],
        // 測站資料來源在「共用設定 › 園區測站」設一次（2026-10-20），格子只選要顯示哪一站
        // 舊版 App（≤1.59）只認格子自己的網址：選的時候順手把場域的資料來源抄進格子（畫面上不顯示）
        ['園區測站', stationMode, () => { cell.wSrc = 'Station'; if (PARK_API) cell.wStUrl = PARK_API; setDirty(true); refresh(); }, !pa.ok && !stationMode],
      ]));
      if (!pa.ok) srcRow.querySelector('.ins-ctrl').appendChild(parkBadge());
      if (stationMode) {
        const from = body.children.length;
        const sel = selInput([], cell.wStation || '', (v) => { cell.wStation = v; sel.dataset.stationId = v; touch(); });
        sel.dataset.stationUrl = PARK_API;
        sel.dataset.stationId = cell.wStation || '';
        fillStationSelect(sel);
        subRow('測站', sel);
        subRow('', hint('測站數值每 30 秒更新，輪播時每 10 秒切換一站，晴雨圖示與動態天空則依下方位置判斷。'));
        if (!pa.ok) greyFrom(from);
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
      subRow('', hint('此格只顯示「園區資訊」標題，搭配點擊動作「園區資訊」，訪客即可開啟園區地圖查看各測站的即時數值。'));
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
        }, '同文字色'));
      }
    }
  }

  // ---- 點擊動作 ----
  {
    sec('點擊動作');
    const level = subStack.length + 1; // 這一頁是第幾層（主頁＝1）
    rowFull(selInput(
      [['None', '無'], ['OpenWeb', '開啟網頁'], ['OpenAssistant', 'AI 智能客服'], ['OpenParkInfo', '園區資訊'], ['OpenSubPage', '進入子頁']]
        .map(([k, n]) => (k === 'OpenParkInfo' ? parkOpt(k, n, cell.tap === 'OpenParkInfo') : [k, n]))
        .filter(([k]) => k !== 'OpenSubPage' || (SUBPAGES_OFFERED && level < MAX_DEPTH) || cell.tap === 'OpenSubPage'),
      cell.tap || 'None',
      (v) => {
        const apply = () => {
          // 子頁跟著「進入子頁」：選了才建（一格空白），改成別的動作就拿掉
          if (v === 'OpenSubPage') { if (!cell.sub) cell.sub = { name: '', node: DEFAULT_CELL(), layout: 'Kiosk' }; } else delete cell.sub;
          cell.tap = v; if (v === 'OpenParkInfo' && PARK_API) cell.wStUrl = PARK_API; setDirty(true); refresh(); // 舊版 App（≤1.59）只認格子自己的網址
        };
        // 子頁裡已經有東西：直接拿掉、toast 可以復原（同刪格子）
        if (cell.tap === 'OpenSubPage' && v !== 'OpenSubPage' && subHasContent(cell.sub)) withUndo(`已刪除子頁「${subLabel(cell.sub.name)}」。`, apply);
        else apply();
      },
    ));
    const tapFrom = body.children.length;
    if (cell.tap === 'OpenSubPage' && cell.sub) {
      const subNameInput = txtInput(cell.sub.name, '子頁', (v) => { cell.sub.name = v; setDirty(true); renderTrail(); });
      subNameInput.maxLength = 20; // 同 App（子頁頂欄的標題）
      subRow('子頁名稱', subNameInput);
      // 子頁版面（2026-10-20 user）：跟客服、園區資訊同一組選項，小螢幕用手機模式，頂欄與字不放大
      subRow('子頁版面', selInput([['Kiosk', 'KIOSK展示模式'], ['Mobile', '手機操作模式']], cell.sub.layout === 'Mobile' ? 'Mobile' : 'Kiosk', (v) => { cell.sub.layout = v; touch(); }));
      subRow('', hint('預設為 KIOSK展示模式（頂欄與文字放大，適合大螢幕），小螢幕請選擇手機操作模式，維持一般大小。'));
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'b-btn b-btn-sm sub-enter-btn';
      go.innerHTML = '<span>編輯子頁</span><span class="material-icons" aria-hidden="true">chevron_right</span>';
      go.onclick = () => enterSub(sel.path);
      subRow('', go);
      // 主頁下面最多兩層子頁（2026-10-20 user）；文字不講「第幾層」免得跟主頁算在一起搞混
      subRow('', hint(level === 1 ? '子頁是完整的版面，可像首頁一樣分格並放置圖片與文字，子頁中還能再加入一層子頁。'
        : '這是第 1 層子頁，其中還能再加入一層子頁（最多兩層）。'));
    }
    if (cell.tap === 'OpenWeb') {
      subRow('網址', txtInput(cell.tapUrl, '點擊開啟的網址', (v) => { cell.tapUrl = v; touch(); }, 'url'));
    }
    if (cell.tap && cell.tap !== 'None') {
      // 可點提示（2026-09-10）：畫面上靜的多、動的只有一個
      const h = hintOf(cell);
      subRow('提示樣式', segRow(TAP_HINT.map(([k, n]) => [n, h === k, () => {
        cell.tapHint = k;
        if (k === 'Button' && (cell.parkFx || 'Sweep') !== 'None') { const q = quietOtherFx(page(), cell); if (q) BToast.warning(`每頁只有一格能使用動態效果，同頁另外 ${q} 格的按鈕動態已改為「無」。`); }
        setDirty(true); refresh();
      }])));
      subRow('', hint(h === 'Badge' ? '在右上角顯示小型的「輕觸」標記，靜態且不太遮擋內容，適合較大的格子。'
        : h === 'Glow' ? '格子內側邊框每 3 秒閃爍一次，不會遮擋內容，同頁多個格子會以相同節奏閃爍。'
        : h === 'Button' ? '在格子中顯示一個按鈕，可自訂按鈕文字，每頁只有一格能使用動態效果。'
        : '這一格不顯示可點提示。'));
      if (h === 'Glow') {
        subRow('閃爍顏色', swatchRow(TXT_SWATCHES, cell.tapHintColor, true, (v) => {
          if (v === null) delete cell.tapHintColor; else cell.tapHintColor = v;
          touch(); renderPanel();
        }, '白色'));
      }
      if (h === 'Button') {
        subRow('排版', selInput(PARK_LAYOUT, cell.parkLayout || 'Auto', (v) => { cell.parkLayout = v; touch(); }));
        subRow('', hint('選擇「自動」時，寬度不到高度兩倍的格子採直排（標題在上、按鈕在下），其餘採橫排（標題在左、按鈕在右）。'));
        subRow('按鈕文字', txtInput(cell.tapLabel, '點我查看', (v) => { cell.tapLabel = v; touch(); }));
        subRow('按鈕動態', selInput(PARK_FX, cell.parkFx || 'Sweep', (v) => {
          cell.parkFx = v;
          if (v !== 'None') { const q = quietOtherFx(page(), cell); if (q) BToast.warning(`每頁只有一格能使用動態效果，同頁另外 ${q} 格的按鈕動態已改為「無」。`); }
          touch(); renderPanel();
        }));
      }
    }
    if (cell.tap === 'OpenParkInfo') {
      // 園區地圖、測站與資料來源都在「共用設定 › 園區測站」設定（2026-10-20），這裡只選這台機器的位置與版面
      if (!parkMapNodes().length) subRow('', hint('點擊後會開啟園區地圖，地圖與測站請在「共用設定 › 園區測站」設定。'));
      // 目前位置（2026-09-22）：這台機器站在哪個測站點；地圖上那一站會多一個「目前位置」標記
      subRow('目前位置', selInput([['', '無'], ...parkMapNodes().map(([id, name]) => [id, `${id} ${name}`.trim()])], cell.parkHere || '', (v) => { cell.parkHere = v; touch(); }));
      subRow('', hint('地圖會在這一站標示「目前位置」，訪客開啟時也會先顯示這一站的數值，選擇「無」則不標示。'));
      // 版面（2026-09-23 user）：跟客服同一組選項，小螢幕用手機模式，頂欄與字不放大
      subRow('園區資訊版面', selInput([['Kiosk', 'KIOSK展示模式'], ['Mobile', '手機操作模式']], cell.parkInfoLayout || 'Kiosk', (v) => { cell.parkInfoLayout = v; touch(); }));
      subRow('', hint('預設為 KIOSK展示模式（頂欄與文字放大，適合大螢幕），小螢幕請選擇手機操作模式，維持一般大小。'));
      if (!pa.ok) greyFrom(tapFrom);
    }
    if (cell.tap === 'OpenAssistant') {
      // 從清單選擇客服（與 App 的 AgentPickerField 相同）：用機器設定裡的 JustAI 帳號拉清單
      const cApi = chatApiConfigured();
      if (!cApi) {
        subRow('客服', hint('若要從清單選擇客服，請先在「機器設定」填寫智能客服 API 帳號。'));
      } else {
        if (agentCache.key !== agentKeyOf(cApi)) fetchAgents(); // 帳號變過或還沒載入
        if (agentCache.loading) {
          subRow('客服', hint('正在載入客服清單…'));
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
      idInput.title = 'JustAI 後台網址 chat.justhings.ai/agents/〔此段〕/edit 中的〔此段〕即為 ID';
      subRow('Agent ID', idInput);
      subRow('介面', selInput(
        [['Kiosk', 'KIOSK展示模式'], ['Mobile', '手機操作模式']],
        cell.assistantLayout || 'Kiosk', (v) => { cell.assistantLayout = v; touch(); },
      ));
      // 輸入區位置（2026-10-12 user）：下方＝原本的樣子；上方＝輸入框併進頂欄、最新的問答排最上面（螢幕鍵盤在下面，不會擋到輸入框）。跟介面各自獨立，App 同一個欄位
      const posRow = subRow('輸入區位置', selInput([['Bottom', '下方'], ['Top', '上方']], cell.agentInputPos === 'Bottom' ? 'Bottom' : 'Top', (v) => { cell.agentInputPos = v; touch(); }));
      posRow.querySelector('.ins-label').title = '下方：輸入列位於畫面底部，對話由上往下排列；上方：輸入框位於頂欄正下方，最新的問答顯示在最上方';
      // 客服主題色（2026-09-14 定案）：「自動」＝站台主題色（後台 nav 設的那個）；「JustAI」＝客服後台設定的顏色（哨兵值 0）；其餘＝指定色。App／播放頁同規則
      const accentRow = subRow('主題色', swatchRow(ACCENT_SWATCHES, cell.agentAccent, true, (v) => {
        if (v === null) delete cell.agentAccent; else cell.agentAccent = v;
        touch(); renderPanel();
      }, '自動', [JUSTAI_CHIP]));
      accentRow.querySelector('.ins-label').title = '此格開啟的聊天頁主色（頭像、按鈕、游標），「自動」會沿用站台主題色，「JustAI」會使用客服後台設定的顏色';
      // 語音朗讀（2026-09-21）：開關只決定進這一格的客服時朗讀「預設」是開還是關，訪客在客服頂欄隨時能切換；
      // 語速不跟開關掛勾（user 2026-09-21）：預設關的話訪客自己打開也是用這個語速，所以一律顯示
      const speakRow = subRow('進入時預設朗讀', switchRow('', cell.agentSpeak !== false, (v) => {
        cell.agentSpeak = v; touch(); renderPanel();
      }));
      speakRow.querySelector('.ins-label').title = '進入此格客服時是否預設開啟朗讀，訪客可隨時使用客服畫面上方的喇叭按鈕切換';
      const rateRow = subRow('語速', speakRateControl(Number(cell.agentSpeakRate) > 0 ? Number(cell.agentSpeakRate) : 1, (v) => {
        cell.agentSpeakRate = v; touch();
      }));
      rateRow.querySelector('.ins-label').title = '朗讀回覆的速度，無論預設是否開啟，訪客開啟朗讀時都會使用此速度';
      // 上傳（2026-09-23 user）：客服輸入列的上傳鈕要不要出現，後台自己決定，不再只看客服後台的設定
      const uploadRow = subRow('允許上傳圖片', switchRow('', cell.agentUpload !== false, (v) => {
        cell.agentUpload = v; touch();
      }));
      uploadRow.querySelector('.ins-label').title = '關閉後，客服輸入列不會顯示上傳按鈕，訪客只能以文字或語音提問；若客服後台未開放上傳，即使在此開啟也不會顯示';
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
// 文字位置九宮格：值＝App TextPosition 名稱（play.js／style.css 用 data-pos 排位置）
const TEXT_POS = [
  ['TopStart', '左上'], ['TopCenter', '上'], ['TopEnd', '右上'],
  ['CenterStart', '左'], ['Center', '置中'], ['CenterEnd', '右'],
  ['BottomStart', '左下'], ['BottomCenter', '下'], ['BottomEnd', '右下'],
];
function posGrid(value, onPick) {
  const grid = document.createElement('div');
  grid.className = 'pos-grid';
  grid.setAttribute('role', 'radiogroup');
  for (const [k, name] of TEXT_POS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pos-cell' + (k === value ? ' active' : '');
    b.title = name;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', name);
    b.setAttribute('aria-checked', k === value ? 'true' : 'false');
    b.onclick = () => {
      grid.querySelectorAll('.pos-cell').forEach((c) => { c.classList.remove('active'); c.setAttribute('aria-checked', 'false'); });
      b.classList.add('active'); b.setAttribute('aria-checked', 'true');
      onPick(k);
    };
    grid.appendChild(b);
  }
  return grid;
}
function segRow(items, opts = {}) {
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
  for (const [text, active, onClick, off] of items) {
    const b = document.createElement('button');
    b.className = 'seg' + (active ? ' active' : '');
    b.textContent = text;
    if (off) b.disabled = true; // 第 4 項＝停用（例：園區測站目前不能用）
    b.onclick = () => {
      if (b.classList.contains('active')) return;
      // 先在本地滑動指示塊（onClick 會重繪整個面板、DOM 重建就看不到動畫），滑完才套用
      row.querySelectorAll('.seg').forEach((s) => s.classList.remove('active'));
      b.classList.add('active');
      moveInd();
      setTimeout(onClick, opts.immediate ? 0 : 170); // immediate：不重畫面板的切換（例：園區測站地圖／預覽）跟指示塊同時開始
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
  for (const [v, label, off, badge] of options) {
    const o = document.createElement('option');
    o.value = v; o.textContent = label; o.selected = v === value;
    if (off) o.disabled = true; // 第 3 項＝停用（灰色、不能選）
    if (badge) o.dataset.badge = badge; // 第 4 項＝狀態小標（BDropdown 畫在選項旁）
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
/** 色票是否偏亮（相對亮度 > 0.5）：選取的勾要用深色（同 App SwatchCircle 的 luminance 規則） */
function isLightArgb(argb) {
  const n = Number(argb) >>> 0, lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) > 0.5;
}
/* 選取放大／縮回的過場（user 2026-09-14）：呼叫端點完通常整段重建 DOM（renderPanel／主題色 modal render），新元素一出現就是
   最終狀態、沒有動畫可跑。所以點下去先記住「哪一列、從哪個值到哪個值」，同一列重建時讓新的選取格先以未選取狀態出現、
   舊的選取格先以放大狀態出現，下一幀再各自切到最終 class，transition 就跑得起來。 */
let swatchAnim = null;
function swatchRow(colors, current, withAuto, onPick, autoLabel, extra) {
  const row = document.createElement('div');
  row.className = 'swatches';
  const cur = current == null ? null : Number(current);
  const pick = (value) => { swatchAnim = { colors, from: String(cur), to: String(value) }; onPick(value); };
  if (withAuto) {
    const a = document.createElement('button');
    a.className = 'swatch auto' + (current == null ? ' active' : '');
    a.dataset.val = 'null';
    a.textContent = autoLabel || '自動';
    a.onclick = () => pick(null);
    row.appendChild(a);
  }
  // 額外選項（例：客服主題色的「JustAI」＝哨兵值 0，不是顏色）：有 icon 就畫成同形色塊（底色＋圖），否則文字 chip
  const extraVals = (extra || []).map((x) => x.value);
  for (const x of extra || []) {
    const b = document.createElement('button');
    b.className = 'swatch ' + (x.icon ? x.cls || 'icon' : 'auto') + (cur === x.value ? ' active' : '');
    if (x.icon) { b.innerHTML = x.icon; b.title = x.label; b.setAttribute('aria-label', x.label); } else b.textContent = x.label;
    b.dataset.val = String(x.value);
    b.onclick = () => pick(x.value);
    row.appendChild(b);
  }
  for (const c of colors) {
    const b = document.createElement('button');
    b.className = 'swatch' + (cur === c ? ' active' : '') + (isLightArgb(c) ? ' light' : '');
    b.style.background = colorCss(c);
    b.dataset.val = String(c);
    b.onclick = () => pick(c);
    row.appendChild(b);
  }
  // 調色盤（user 2026-09-09）：不限預設色。原生 <input type=color> 藏在旁邊，按調色盤鈕才叫出來；
  // 用 change 而不是 input：onPick 會重繪面板、DOM 重建會把還開著的調色盤關掉。
  const picker = document.createElement('input');
  picker.type = 'color'; picker.className = 'swatch-picker'; picker.tabIndex = -1;
  picker.value = hexOfArgb(cur != null ? cur : colors[0]);
  picker.addEventListener('change', () => pick(argbOfHex(picker.value)));
  // 目前是自訂色（user 2026-09-14）：不另外長一格，調色盤鈕本身就顯示成那個顏色並標選取；再點可繼續調
  const isCustom = cur != null && !colors.includes(cur) && !extraVals.includes(cur);
  const custom = document.createElement('button');
  custom.className = 'swatch custom' + (isCustom ? ' active' : ''); custom.title = '自訂顏色'; custom.setAttribute('aria-label', '自訂顏色');
  if (isCustom) { custom.style.background = colorCss(cur); custom.dataset.val = String(cur); if (isLightArgb(cur)) custom.classList.add('light'); }
  custom.innerHTML = '<span class="material-icons">palette</span>';
  custom.onclick = () => picker.click();
  row.append(custom, picker);
  // 同一列剛被點過而重建：讓新選取格從未選取長大、舊選取格從放大縮回（見 swatchAnim 註解）
  if (swatchAnim && swatchAnim.colors === colors && String(cur) === swatchAnim.to) {
    const { from, to } = swatchAnim; swatchAnim = null;
    const toEl = row.querySelector('[data-val="' + to + '"]'), fromEl = from !== to ? row.querySelector('[data-val="' + from + '"]') : null;
    if (toEl) toEl.classList.remove('active');
    if (fromEl) fromEl.classList.add('leaving');
    requestAnimationFrame(() => requestAnimationFrame(() => { if (toEl) toEl.classList.add('active'); if (fromEl) fromEl.classList.remove('leaving'); }));
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
        img.src = mediaSrc(uri); img.loading = 'lazy';
        t.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'local'; ph.textContent = '機器本機圖片';
        t.appendChild(ph);
      }
      const del = document.createElement('button');
      del.innerHTML = SVG_X; del.title = '移除這張'; del.setAttribute('aria-label', '移除這張圖片'); // 線條 icon 取代 ✕ 字元（2026-10-14 精修）
      del.onclick = () => withUndo('已移除這張圖片。', () => { cell.bgImgs.splice(i, 1); setDirty(true); renderCanvas(); redraw(); });
      t.appendChild(del);
      box.appendChild(t);
    });
    if ((cell.bgImgs || []).length < MAX_IMAGES) {
      const add = document.createElement('button');
      add.className = 'add-thumb'; add.innerHTML = SVG_PLUS; add.title = '上傳圖片'; add.setAttribute('aria-label', '上傳圖片');
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
            '\n顯示時會依「顯示方式」設定縮放，仍要上傳這張圖片嗎？',
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
    await uploadWithToast([f], {
      noun: /^video/.test(f.type) ? '影片' : '圖片', unit: '個',
      onEach: (r) => onDone(r.url),
    });
  };
  input.click();
}

/** 上傳一個檔案（XHR：fetch 拿不到上傳進度）。錯誤句同 api()；onProgress(已送出的 bytes)。 */
function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + '/api/upload');
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => { if (onProgress) onProgress(e.loaded); };
    xhr.onload = () => {
      if (xhr.status === 401) { logout(); reject(new Error('登入已過期，請重新登入。')); return; }
      const body = xhr.response || {};
      if (xhr.status < 200 || xhr.status >= 300) { reject(new Error(reasonFor(xhr.status, body.error))); return; }
      resolve(body);
    };
    xhr.onerror = () => reject(new Error(NET_ERROR));
    xhr.ontimeout = () => reject(new Error(TIMEOUT_ERROR));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

/** 一批檔案依序上傳，全程只有一則 toast（2026-10-20 user）：底色照總進度填綠、圖示從上傳變形成勾；
 *  傳完的檔案等進度條填滿、變成功之後才交給 onEach（user：進度條跑完圖片才出現）。
 *  失敗就停、整條轉紅、變形成叉；前面傳好的照常算數（失敗時馬上交給 onEach）。回傳成功的個數。 */
async function uploadWithToast(files, { noun = '檔案', unit = '個', onEach } = {}) {
  const n = files.length;
  if (!n) return 0;
  const what = n > 1 ? ` ${n} ${unit}${noun}` : noun;
  const total = files.reduce((s, f) => s + (f.size || 0), 0) || 1;
  const t = window.BToast && BToast.progress ? BToast.progress(`正在上傳${what}…`) : null;
  const results = [];
  const hand = () => { if (onEach) results.forEach(([r, f]) => onEach(r, f)); };
  let sent = 0;
  for (const f of files) {
    try {
      const r = await uploadFile(f, (loaded) => {
        const p = Math.min(1, (sent + Math.min(loaded, f.size || 0)) / total);
        if (t) t.progress(p); // 百分比由 toast 自己畫在第一排右邊
      });
      sent += f.size || 0;
      results.push([r, f]);
    } catch (e) {
      hand();
      const desc = e.message + (results.length ? `前 ${results.length} ${unit}已上傳。` : '');
      if (t) t.fail(`無法上傳「${f.name}」。`, desc); else setStatus(`無法上傳「${f.name}」。${desc}`, true);
      return results.length;
    }
  }
  if (t) await t.success(`已上傳${what}。`); else setStatus(`已上傳${what}。`); // 成功只有一行（user：不要冒出第二行）
  hand();
  return results.length;
}

// ---------- 複製版面到其他機器 ----------
// 語意＝一次性複製（蓋過目標機器的版面）；目標機器自己的客服帳號、休眠、
// 展示頁與機器名都不動（伺服器 PUT 沒帶的欄位沿用舊值）。
// 「加到其他機器」（2026-09-07 改版）：原本是整包覆蓋對方的頁面（user 實測被嚇到），
// 改成與版面設定的「加入機器」同一套語意＝接在對方現有頁面後面，對方原有頁面/設定/展示頁都不動。
// 2026-09-08 再改：只送「目前正在編輯的這一頁」，不是整台的所有頁面（鈕在畫布下方，語意就是這一頁）。
$('copyLayoutBtn').addEventListener('click', async () => {
  if (!state || !mainPage()) return;
  await appendPagesToDevices({
    pages: [mainPage()], screen: state.config.screen, fallbackName: mainPage().name || `頁面 ${pageIndex + 1}`,
    excludeDeviceId: deviceId,
    title: '將這一頁加入其他機器',
    desc: '目前編輯中的這一頁（含未發布的修改）會加在所選機器現有頁面之後並立即發布，機器原有的頁面、設定與展示頁都不受影響。',
    noTargetsTitle: '沒有其他機器', noTargetsDesc: '此帳號只有這一台機器，沒有其他可加入的機器。',
    verb: '加入',
  });
});

// 「本機複製頁面」（2026-09-08）：把目前這一頁複製一份接在這台機器的最後面，名稱＝原名＋「2」；
// 只改網頁上的草稿（標記未儲存），按「儲存並發布」才會送到機器。
$('dupPageBtn').addEventListener('click', () => {
  if (!state || !mainPage()) return;
  if (state.config.pages.length >= MAX_PAGES) return setStatus(`已達 ${MAX_PAGES} 頁上限，無法再複製頁面。`, true);
  const src = mainPage();
  const nextId = Math.max(0, ...state.config.pages.map((p) => p.id || 0)) + 1;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = nextId;
  copy.name = (src.name || `頁面 ${pageIndex + 1}`) + '2';
  state.config.pages.push(copy);
  pageIndex = state.config.pages.length - 1;
  selected = null; subStack = []; setDirty(true); render();
  setStatus(`已複製為「${copy.name}」，儲存並發布後才會顯示在機器上。`);
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
  // 上排＝客服 API｜休眠時段，下排＝管理 PIN｜閒置回展示頁並排各佔半欄（2026-09-14 user 裁決：
  // 內容多了、modal 捲動沒關係，只把兩張一排式小卡並排省一列）；Danger Zone 跨欄放最下面
  body.appendChild(chatApiCard(ctx));
  body.appendChild(sleepCard(ctx));
  const pin = body.appendChild(pinCard(ctx));
  pin.classList.add('settings-card-full');
  if (!meIsAdmin) lockSettingsCard(pin); // 單機的管理 PIN 也限管理員（2026-09-07 定案）；伺服器端同步剝掉 adminPin
  const idle = body.appendChild(idleCard(ctx));
  idle.classList.add('settings-card-full');
  if (!meIsAdmin) lockSettingsCard(idle); // 閒置秒數同 PIN 限管理員（伺服器端同步剝掉 idleReturnSec）
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
  eye.type = 'button'; eye.className = 'pw-eye'; eye.title = '顯示或隱藏密碼';
  eye.innerHTML = '<i data-lucide="eye"></i>';
  eye.onclick = () => {
    const show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    if (window.morphIcon?.(eye, show ? 'eye-off' : 'eye')) return;
    eye.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}"></i>`;
    if (window.lucide) lucide.createIcons();
  };
  wrap.append(i, eye);
  return wrap;
}

function chatApiCard(ctx) {
  return settingsCard('智能客服 API', ['與機器上的「設定 → 智能客服 API」相同，儲存並發布後會同步到機器。'], (g, foot) => {
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
      c && c.password ? '已設定，重新輸入即可覆蓋。' : ''));
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

/** 語速滑塊（2026-09-21）：0.5～2 倍、0.25 一格，1＝語音引擎原本的語速。 */
function speakRateControl(cur, onChange) {
  const label = (v) => (v === 1 ? '正常' : v + '×');
  const wrap = document.createElement('label');
  wrap.className = 'speak-rate';
  const input = document.createElement('input');
  input.type = 'range'; input.min = '0.5'; input.max = '2'; input.step = '0.25'; input.value = String(cur);
  input.setAttribute('aria-label', '語速');
  const out = document.createElement('b');
  out.textContent = label(cur);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = label(v);
    onChange(v);
  });
  wrap.append(input, out);
  return wrap;
}

/* 管理 PIN 卡（2026-09-07）：一排式小卡，2026-09-14 起與「閒置回展示頁」並排放在客服 API 與休眠卡之下（共用設定與單機設定都有）。
 * 規則同 App PinSheet：只收數字、最長 8 碼；空白＝機器端用預設 PIN 0000。 */
function pinCard(ctx) {
  return settingsCard('管理 PIN', [
    '在機器畫面上長按或點按角落進入管理畫面時需輸入的 PIN，與機器上的「設定 → 管理 PIN」相同。',
    '僅限數字，最多 8 碼，留空則使用預設 PIN 0000。',
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

/* 閒置返回卡（2026-09-14 user 指示）：訪客在客服／園區資訊／網頁頁多久沒碰就回展示畫面，App 與網頁播放頁都照這個值。
 * 同 PIN 卡一排式：標題在左、右邊一個下拉選單（2026-09-14 16:10 定案：開關放哪都怪，改成 iOS「自動鎖定」式的下拉，
 * 「永不」是選項之一＝存 -1 不自動返回；App 設定頁同一份選項）。0／省略＝預設 90 秒，顯示成「90 秒」；
 * 舊資料若是清單外的秒數，動態多一個「N 秒」選項讓它顯示得出來。 */
const IDLE_RETURN_DEFAULT_SEC = 90;
const IDLE_RETURN_NEVER = -1;
// 與 App KioskSettings.IDLE_RETURN_OPTIONS 一致（秒數 → 顯示文字）
const IDLE_RETURN_OPTIONS = [
  [30, '30 秒'], [60, '1 分鐘'], [90, '90 秒'], [120, '2 分鐘'], [180, '3 分鐘'], [300, '5 分鐘'],
  [600, '10 分鐘'], [1800, '30 分鐘'], [3600, '1 小時'], [IDLE_RETURN_NEVER, '永不'],
];
function idleReturnLabel(sec) {
  const hit = IDLE_RETURN_OPTIONS.find(([v]) => v === sec);
  return hit ? hit[1] : `${sec} 秒`;
}
function idleCard(ctx) {
  return settingsCard('閒置返回', [
    '訪客在智能客服、園區資訊或網頁畫面閒置超過這段時間，就會自動回到展示畫面，App 與網頁播放頁皆適用。',
    `預設為 ${IDLE_RETURN_DEFAULT_SEC} 秒，選擇「永不」時會停留在訪客畫面，直到有人手動回到展示畫面。`,
  ], (g) => {
    const raw = Number(ctx.cfg.idleReturnSec);
    const cur = raw === IDLE_RETURN_NEVER || raw >= 10 ? raw : IDLE_RETURN_DEFAULT_SEC;
    const opts = IDLE_RETURN_OPTIONS.map(([v, l]) => [String(v), l]);
    if (!IDLE_RETURN_OPTIONS.some(([v]) => v === cur)) opts.splice(opts.length - 1, 0, [String(cur), idleReturnLabel(cur)]); // 舊的自訂秒數
    const sel = selInput(opts, String(cur), (v) => { ctx.cfg.idleReturnSec = Number(v); ctx.markDirty(); });
    sel.setAttribute('aria-label', '閒置返回');
    const wrap = document.createElement('div');
    wrap.className = 'idle-wrap';
    wrap.appendChild(sel);
    const card = g.parentElement;
    card.querySelector('.b-card-head').appendChild(wrap);
    g.remove();
  });
}

async function testChatApi(holder) {
  const c = holder.chatApi;
  if (!c || !c.baseUrl || !c.email || !c.password) return setStatus('請先填寫伺服器位址、Email 和密碼，再測試連線。', true);
  try {
    const list = await api('POST', '/api/justai/agents', { baseUrl: c.baseUrl, email: c.email, password: c.password });
    agentCache = { key: agentKeyOf(c), list, loading: false, error: '' };
    setStatus(`連線成功，已載入 ${list.length} 個客服，可在版面的格子中選用。`);
  } catch (e) { setStatus('無法連線到智能客服。' + e.message, true); }
}

/* 休眠卡（2026-09-03 再改版＝共用版面同邏輯）：卡片只放固定 7 列清單（高度不再跳動），
 * 逐日的實際設定在「編輯」跳出的 modal 裡做；「每日相同」由 modal 的「套用到每天」取代。 */
function sleepCard(ctx) {
  return settingsCard('休眠時段', [
    '休眠時會停止播放並顯示黑畫面，儲存並發布後會同步到機器，並於機器按下「開始展示」後套用。',
    '開始時間晚於結束時間時視為跨午夜，結束時間為隔日。',
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
      edit.className = 'b-btn b-btn-text b-btn-xs'; // 文字鈕（2026-10-14 精修：原灰底小框鈕是全站唯一，7 顆一排很重）
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
    chkRow.append(chk, document.createTextNode('這一天啟用休眠'));
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
      '<p class="b-empty-title">尚未建立版面</p>' +
      '<p class="b-empty-sub">' + (meIsAdmin ? '按一下右上角的「新增版面」開始設計，之後即可將版面加入任何機器。' : '管理員新增版面後，即可將版面加入機器。') + '</p>' +
      '</div></td></tr>';
    if (window.lucide) lucide.createIcons();
    return;
  }
  for (const layout of shared.layouts) {
    const tr = document.createElement('tr');
    tr.className = 'device-row';
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
    tr.insertAdjacentHTML('beforeend', `<td class="device-id-dim">${esc(layout.createdBy || '—')}</td>`);
    tr.appendChild(timeTd(layout.updatedAt));

    const opTd = document.createElement('td');
    opTd.className = 'device-ops';
    const mkBtn = (cls, html, onclick) => {
      const b = document.createElement('button');
      b.className = cls; b.innerHTML = html; b.onclick = onclick;
      opTd.appendChild(b);
      return b;
    };
    // 全站表格操作＝文字鈕（2026-10-14 精修：原本外框鈕＋每列一顆實心「加入機器」，三列就三顆實心並排，跟機器總覽／帳號管理不一致）
    if (meIsAdmin) mkBtn('b-btn b-btn-text', '編輯', () => enterSharedLayoutEditor(layout));
    mkBtn('b-btn b-btn-text', '加入機器', () => applySharedLayout(layout));
    if (meIsAdmin) {
      mkBtn('b-btn b-btn-text', '更名', () => renameSharedLayout(layout));
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
  thumbEl.title = '按一下以放大預覽';
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
    title: '新增版面', desc: '請輸入這個版面的名稱。',
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
    desc: '只會刪除此處的範本，已加入機器的頁面不受影響。',
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
    title: `將「${name}」加入機器`,
    desc: '這個版面會加入為所選機器的新頁面（位於現有頁面之後）並立即發布，機器原有的頁面與設定都不受影響。',
    noTargetsTitle: '沒有機器', noTargetsDesc: '此帳號目前沒有任何機器。',
    verb: `將「${name}」加入`,
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
  const chat = body.appendChild(chatApiCard(ctx)); // 同單機工作區：上排客服｜休眠、下排 PIN｜閒置並排
  body.appendChild(sleepCard(ctx));
  const pin = body.appendChild(pinCard(ctx));
  pin.classList.add('settings-card-full');
  const idle = body.appendChild(idleCard(ctx));
  idle.classList.add('settings-card-full');
  if (window.BDropdown) BDropdown.init(body);
  if (!meIsAdmin) { lockSettingsCard(chat); lockSettingsCard(pin); lockSettingsCard(idle); } // 一般帳號只能改休眠排程（2026-09-07 定案）
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

// ---------- 共用設定 › 園區測站（2026-10-20 user：一套系統多場域用，什麼都不寫死）----------
// 一張卡（2026-10-20 晚 user 重排）：上排＝測站頁籤（tiri 收件匣那種、切換有滑動指示塊），左＝這一站的照片／說明／看更多，
// 右＝園區地圖（這一站的點亮起；按「編輯位置」才能動，而且只能動這一站的點；也在這裡上傳／更換地圖圖片）。
// 頁首只有「資料來源」按鈕（測站 API，在 modal 裡設）。全部存共用設定 shared.parkInfo＝{ api, map: { src, w, h }, stations: { 代號: { name, photos, desc, link, x, y } } }，
// 伺服器整理過後隨 /version、/wait、/config 發給機器與播放頁——整個場域共用、改了機器約一分鐘內更新，不用套用到機器。
// 卡片右下角的「儲存」＝存這一站（照片、說明、連結、地圖位置，換過地圖圖片也一起）；有沒存的修改時換站、離開這頁都會先問。限管理員修改（伺服器也擋）。
const PARK_MAX_PHOTOS = 6, PARK_DESC_MAX = 400;
let parkSel = '';          // 目前這一站（頁籤）
let parkStations = null;   // 測站 API 讀到的站（{ id, name, online }）；null＝還沒抓、[]＝抓不到
let parkStationsLoading = false;
let parkStationsErr = '';  // 讀已儲存的資料來源失敗的原因（空狀態判斷、連線狀態面板用）
let parkDraft = null;      // 正在改的那一站：{ id, e: { photos, desc, link }, pos: [x, y] | null, map: { src, w, h } | null }
let parkUploading = 0;     // 上傳中的批次數：傳到一半也算「還沒存」
let parkSaving = false;
let parkRedrawPhotos = null;
let parkUploadSeq = 0;     // 捨棄時加一：還在傳的那批回來也不會再塞進草稿
let parkPlacing = false;   // 地圖「編輯位置」開著：這一站的點可以拖、點地圖＝把它移過去
let parkPlaceSnap = null;  // 按「編輯位置」（或更換地圖）那時候的位置與地圖：地圖下方的「取消」退回這裡
let parkBarFx = '';        // 'enter'＝下一次畫地圖按鈕列時播「編輯位置 → 完成」進場動畫（只播一次，之後重畫不再播）
let parkBarBusy = false;   // 退場動畫播放中（約 0.24 秒）：不接受第二下
// 更換地圖中（user 2026-10-21：原本在地圖上的站全部放好才套用到機器）：{ map, from, need, pos }
//   map＝新地圖、from＝目前已儲存的地圖（沒有＝第一次上傳）、need＝原本在地圖上的站、
//   pos＝新地圖上的位置（沒有這個 key＝還沒處理，null＝不放在新地圖上）。只在後台，換站不會不見，按「套用新地圖」才存
let parkMapSwap = null;
const parkNoMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let parkApiDraft = null;   // 資料來源 modal 的輸入框（跟已儲存的不同才算修改）；null＝沒動
let parkApiTest = null;    // 測試連線結果：{ url, list } 或 { url, error }

const parkSavedInfo = () => {
  const p = (shared && shared.parkInfo) || {};
  return { api: p.api || '', map: p.map || null, stations: p.stations || {}, home: p.home || null };
};
const parkSavedOf = (id) => {
  const e = parkSavedInfo().stations[id];
  return e ? { photos: [...(e.photos || [])], desc: e.desc || '', descRich: e.descRich || '', link: e.link || '' } : { photos: [], desc: '', descRich: '', link: '' };
};
const parkSavedPos = (id) => { const e = parkSavedInfo().stations[id]; return e && e.x != null && e.y != null ? [e.x, e.y] : null; };
/** 這一站已儲存的樣子（介紹、位置，連同場域的地圖） */
const parkBase = (id) => ({ e: parkSavedOf(id), pos: parkSavedPos(id), map: parkSavedInfo().map });
/** 這一站目前的樣子（正在改的就是草稿） */
const parkCur = (id) => (parkDraft && parkDraft.id === id ? parkDraft : parkBase(id));
const parkEntry = (id) => parkCur(id).e;
// 介紹：有簡易格式就比格式，沒有就比純文字（舊資料只有 desc，打開編輯器沒改就不算修改）
const parkDescKey = (e) => e.descRich || e.desc || '';
const parkSame = (a, b) => JSON.stringify([a.e.photos, parkDescKey(a.e), String(a.e.link || '').trim(), a.pos, a.map])
  === JSON.stringify([b.e.photos, parkDescKey(b.e), String(b.e.link || '').trim(), b.pos, b.map]);
const parkChanged = () => !!parkDraft && !parkSame(parkDraft, parkBase(parkDraft.id));
const parkApiChanged = () => parkApiDraft !== null && parkApiDraft.trim() !== parkSavedInfo().api;
const parkBusy = () => parkChanged() || parkUploading > 0;
/** 地圖區要畫的地圖與這一站的位置：更換地圖中＝新地圖與新位置，平常＝這一站目前的樣子（草稿或已儲存） */
const parkMapOf = (id) => (parkMapSwap ? { map: parkMapSwap.map, pos: parkMapSwap.pos[id] || null } : { map: parkCur(id).map, pos: parkCur(id).pos });
/** 更換地圖：還沒處理的站（原本在地圖上，新地圖還沒放、也沒按「從地圖移除」） */
const parkSwapTodo = () => (parkMapSwap ? parkMapSwap.need.filter((id) => !(id in parkMapSwap.pos)) : []);
/** 卡片右下角「● 尚有修改未儲存」＋儲存鈕（同工作區底部欄）。 */
function setParkDirty() {
  parkSyncFoot($('parkDirtyNote'), $('parkCancelBtn'), $('parkSaveBtn'));
}
/** 動作列三個元件照目前狀態設定（建立時也先套好：以前先建成「可以按」再變灰，中間量地圖寬度時套到顏色，儲存鈕會閃一下） */
function parkSyncFoot(note, cancel, save) {
  const v = parkChanged();
  if (save) save.disabled = !v || parkSaving || parkUploading > 0;
  const swapNote = !v && !!parkMapSwap; // 新地圖還沒套用（地圖上方的「套用新地圖」才會存）
  if (note) { note.textContent = v ? '尚有修改未儲存' : swapNote ? '新地圖尚未套用' : ''; note.classList.toggle('is-on', v || swapNote); note.classList.remove('is-plain'); }
  if (cancel) cancel.hidden = !v && !parkUploading;
}
/** 改這一站（fn 拿到介紹 e 與整份草稿 d：d.pos 位置、d.map 地圖） */
function parkEdit(id, fn) {
  if (!parkDraft || parkDraft.id !== id) parkDraft = { id, ...JSON.parse(JSON.stringify(parkBase(id))) };
  fn(parkDraft.e, parkDraft);
  setParkDirty();
  if (parkPaneTab === 'preview') parkRefreshPreview(); // 資訊卡預覽跟著即時更新
}
const parkLinkOk = (v) => !String(v || '').trim() || /^https?:\/\/\S+$/.test(String(v).trim());
/** 打字途中還沒打完的 http(s):// 不算錯（例如才打到「htt」），真的不對才提示 */
const parkLinkMaybe = (v) => { const t = String(v || '').trim().toLowerCase(); return parkLinkOk(t) || 'https://'.startsWith(t) || 'http://'.startsWith(t); };
/** 測站清單＝測站 API 讀到的站＋已經存過資料的站，照代號排；名稱以 API 的為準，讀不到就用存下來的。 */
function parkList() {
  const out = new Map();
  for (const s of parkStations || []) out.set(s.id, { id: s.id, name: s.name && s.name !== s.id ? s.name : '', online: s.online });
  for (const [id, e] of Object.entries(parkSavedInfo().stations)) {
    const o = out.get(id);
    if (o) { if (!o.name) o.name = e.name || ''; } else out.set(id, { id, name: e.name || '', online: null });
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id, 'zh-Hant', { numeric: true }));
}
const parkLabel = (s) => (s.name ? `${s.id}　${s.name}` : s.id);
function loadParkStations() {
  if (parkStationsLoading) return;
  if (!PARK_API) { parkStations = []; parkStationsErr = ''; return; }
  parkStationsLoading = true;
  api('GET', `/api/station/current?url=${encodeURIComponent(PARK_API)}`)
    .then((root) => { parkStations = parseStations(root); parkStationsErr = ''; })
    .catch((e) => { parkStations = []; parkStationsErr = e.message === 'no stations' ? '此網址未提供測站資料，請確認網址是否正確。' : e.message; })
    .finally(() => { parkStationsLoading = false; if (!$('parkInfoView').classList.contains('hidden')) renderParkInfoView(); parkConnRefresh(); });
}

/** 存 parkInfo：以已儲存的為底套上 mutate，順手把測站 API 讀到的名稱抄進去（機器端 API 連不上也有名字）。成功回 true。 */
async function parkPut(mutate, failMsg) {
  const cur = parkSavedInfo();
  const next = { api: cur.api, map: cur.map, stations: JSON.parse(JSON.stringify(cur.stations)), ...(cur.home ? { home: cur.home } : {}) };
  mutate(next);
  for (const s of parkStations || []) if (next.stations[s.id] && s.name && s.name !== s.id) next.stations[s.id].name = s.name;
  for (const [id, e] of Object.entries(next.stations)) { // 沒內容又不在地圖上的站不留（跟伺服器 normParkInfo 同規則）
    if (!(e.photos || []).length && !(e.desc || '').trim() && !(e.link || '').trim() && e.x == null) delete next.stations[id];
  }
  parkSaving = true;
  setParkDirty();
  try {
    await api('PUT', '/api/shared-settings', { settings: { ...shared, parkInfo: next } });
    shared.parkInfo = next;
    return true;
  } catch (e) {
    BToast.danger(failMsg + e.message);
    return false;
  } finally {
    parkSaving = false;
    setParkDirty();
  }
}
/** 存這一站：照片、說明、連結、地圖位置；連結不對就不存；別站一律照已儲存的送（換地圖另外按「套用新地圖」，parkApplySwap） */
async function saveParkStation() {
  if (!parkChanged() || parkSaving || parkUploading || !meIsAdmin) return;
  const d = parkDraft, id = d.id, e = d.e;
  if (!parkLinkOk(e.link)) {
    const err = $('parkBody').querySelector('.park-err');
    if (err) err.hidden = false;
    BToast.show('無法儲存這一站。', 'danger', { desc: '「看更多連結」必須以 http:// 或 https:// 開頭。' });
    return;
  }
  if (String(e.desc || '').length > PARK_DESC_MAX) {
    BToast.show('無法儲存這一站。', 'danger', { desc: `介紹超過 ${PARK_DESC_MAX} 字，請精簡後再儲存。` });
    return;
  }
  const name = parkList().find((s) => s.id === id)?.name || '';
  const ok = await parkPut((next) => {
    const st = { ...(next.stations[id] || {}), photos: e.photos.slice(0, PARK_MAX_PHOTOS), desc: String(e.desc || '').slice(0, PARK_DESC_MAX), link: String(e.link || '').trim() };
    if (String(e.descRich || '').trim()) st.descRich = String(e.descRich).slice(0, 1500); else delete st.descRich; // 簡易格式；desc 是同一段的純文字版（舊版 App 用）
    if (d.pos) { st.x = d.pos[0]; st.y = d.pos[1]; } else { delete st.x; delete st.y; }
    next.stations[id] = st;
  }, `無法儲存 ${id}。`);
  if (!ok) return;
  parkDraft = null; parkPlacing = false; parkPlaceSnap = null;
  BToast.show(name ? `已儲存 ${id} ${name}。` : `已儲存 ${id}。`, 'success', { desc: '機器會在一分鐘內更新。' });
  renderParkInfoView();
}
/** 資料來源（modal 的儲存）：存測站 API（清空＝這個場域沒有測站），存好關掉 modal */
async function saveParkApi() {
  if (!parkApiChanged() || parkSaving || !meIsAdmin) return;
  const v = parkApiDraft.trim();
  if (v && !/^https?:\/\/\S+$/.test(v)) {
    BToast.show('無法儲存資料來源。', 'danger', { desc: '網址必須以 http:// 或 https:// 開頭。' });
    return;
  }
  if (v) {
    // 存之前先確認讀得到測站（2026-10-20：曾經把後台網址誤貼成資料來源，存了才發現連線失敗）
    let list = parkApiTest && parkApiTest.url === v ? parkApiTest.list || null : null;
    let why = parkApiTest && parkApiTest.url === v ? parkApiTest.error || '' : '';
    if (!list && !why) {
      parkSaving = true; syncParkSrcSave();
      try { list = parseStations(await api('GET', `/api/station/current?url=${encodeURIComponent(v)}`)); parkApiTest = { url: v, list }; }
      catch (e) { why = e.message === 'no stations' ? '此網址未提供測站資料。' : e.message; parkApiTest = { url: v, error: why }; }
      finally { parkSaving = false; syncParkSrcSave(); parkConnRefresh(); }
    }
    if (!list || !list.length) {
      const go = await BDialog.confirm({ title: '無法從這個網址讀取測站資料', desc: `${why || '可以連線，但沒有讀取到任何測站。'}\n請確認貼上的是測站平台的網址，仍要儲存嗎？`, confirmText: '仍要儲存' });
      if (!go) return;
    }
  }
  const ok = await parkPut((next) => { next.api = v; }, '無法儲存資料來源。');
  syncParkSrcSave();
  if (!ok) return;
  PARK_API = v;
  if (connInfo) connInfo.parkApi = v;
  const tested = parkApiTest && parkApiTest.url === v && parkApiTest.list ? parkApiTest.list : null; // 剛測過就不用再抓一次
  parkApiDraft = null; parkApiTest = null;
  parkStations = v ? tested : []; parkStationsErr = '';
  BModal.close('#parkSourceModal');
  BToast.show(v ? '已儲存測站資料來源。' : '已清除測站資料來源。', 'success', { desc: v ? '機器會在一分鐘內更新。' : '版面中的「園區資訊」與「園區測站」格子會顯示為灰色，設定仍會保留。' });
  renderParkInfoView();
}
/** 換站或離開這頁之前：有沒存的修改（或照片還在上傳）先問，捨棄＝草稿全部丟掉。回 true＝可以走。
 *  page＝離開這一頁：新地圖還沒套用也要問（換站不用，新地圖跟著留著） */
async function confirmParkLeave(page) {
  if (parkBusy()) {
    const what = parkUploading ? '照片仍在上傳，修改也尚未儲存' : `${parkDraft.id} 的修改尚未儲存`;
    const ok = await BDialog.confirm({ title: '有尚未儲存的修改', desc: `${what}，要捨棄嗎？`, variant: 'danger', confirmText: '捨棄' });
    if (!ok) return false;
    parkUploading = 0; parkUploadSeq++;
  }
  if (page && parkMapSwap) {
    const ok = await BDialog.confirm({ title: '新地圖尚未套用', desc: `離開這一頁會捨棄新地圖。\n${parkMapSwap.from ? '機器會繼續顯示目前的地圖。' : '這個場域仍不會有園區地圖。'}`, variant: 'danger', confirmText: '捨棄' });
    if (!ok) return false;
    parkMapSwap = null;
  }
  parkDraft = null; parkPlacing = false; parkPlaceSnap = null;
  return true;
}

/** 頁首右邊：〔更換地圖〕〔資料來源〕（高度與內距同機器總覽頁首按鈕；資料來源＝主題色底白字、開 modal）。
 *  更換地圖（2026-10-20 user：放資料來源左邊）只在畫面上有測站可以編輯、這個場域已經有地圖時出現（還沒地圖＝地圖區的「上傳地圖」） */
function renderParkHeader(canChangeMap) {
  const head = $('parkInfoView').querySelector('.page-header');
  let acts = head.querySelector('.page-actions');
  if (!acts) { acts = document.createElement('div'); acts.className = 'page-actions'; head.appendChild(acts); }
  acts.innerHTML = '';
  if (canChangeMap) {
    const m = parkEl('button', 'b-btn', '更換地圖');
    m.type = 'button'; m.id = 'parkMapBtn';
    m.onclick = parkPickMap;
    acts.append(m);
  }
  const src = parkEl('button', 'b-btn b-btn-primary', '資料來源');
  src.type = 'button'; src.id = 'parkSourceBtn';
  src.onclick = openParkSource;
  acts.append(src);
}

async function renderParkInfoView() {
  const body = $('parkBody');
  if (!(await ensureSharedLoaded())) return;
  PARK_API = parkSavedInfo().api;
  if (PARK_API && parkStations === null) loadParkStations();
  const hasMap = renderParkPage(body);
  renderParkHeader(hasMap && meIsAdmin);
  setParkDirty();
  if (window.BDropdown) BDropdown.init(body);
  if (window.lucide) lucide.createIcons({ nodes: [body] });
}

const parkEl = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
/** 空狀態卡（撐滿寬高、內容置中，同其他頁的空表格）；action＝[文字, onClick]；danger＝紅色圖示與紅色動作（連線失敗） */
function parkEmpty(icon, title, action, danger) {
  const card = parkEl('div', 'b-card park-empty' + (danger ? ' is-danger' : ''));
  const em = parkEl('div', 'b-empty');
  em.innerHTML = `<span class="b-empty-icon"><i data-lucide="${icon}"></i></span><p class="b-empty-title"></p>`;
  em.querySelector('.b-empty-title').textContent = title;
  if (action) { const b = parkEl('button', 'b-btn b-btn-text' + (danger ? ' b-btn-text-danger' : ''), action[0]); b.type = 'button'; b.onclick = action[1]; em.appendChild(b); }
  card.appendChild(em);
  return card;
}
const parkNoSource = () => parkEmpty('radio-tower', '尚未設定測站資料來源', meIsAdmin ? ['設定資料來源', openParkSource] : null);
/** 資料來源讀完了但連不上／沒有測站（2026-10-20 user：照目前的連線狀態，連線失敗就是空狀態，不列存過的站）。
 *  紅色＋插頭拔開的動畫（morph-icons.js unplugApart），說明字不放（原因在「資料來源」的連線狀態裡看得到） */
const parkSourceBroken = () => !!PARK_API && parkStations !== null && !parkStationsLoading && (!!parkStationsErr || !parkStations.length);
const parkConnFail = () => parkEmpty('unplug', parkStationsErr ? '無法連線到測站資料來源' : '測站資料來源中沒有任何測站',
  meIsAdmin ? ['設定資料來源', openParkSource] : null, true);

/** 畫整張卡；回 true＝畫出了測站、而且這一站看得到地圖（頁首才放「更換地圖」） */
function renderParkPage(body) {
  if (parkMapRO) { parkMapRO.disconnect(); parkMapRO = null; }
  parkTipHide();
  body.innerHTML = '';
  if (!PARK_API) { body.append(parkNoSource()); return false; }
  if (parkSourceBroken()) { body.append(parkConnFail()); return false; }
  const list = parkList();
  if (!list.length) { body.append(parkEmpty('radio-tower', '正在讀取測站資料…')); return false; }
  if (!list.some((s) => s.id === parkSel)) parkSel = list[0].id;
  const id = parkSel;
  const s = list.find((x) => x.id === id);
  const locked = !meIsAdmin;
  const card = parkEl('div', 'b-card settings-card park-card');

  // 上排：一站一個頁籤（tiri 收件匣的頂部標籤）＋ segment 的滑動指示塊；換站前有沒存的修改先問，取消就跳回原本那一站
  const todo = parkSwapTodo();
  const tabs = segRow(list.map((x) => ['', x.id === id, async () => {
    if (!(await confirmParkLeave())) { renderParkInfoView(); return; }
    parkSel = x.id;
    renderParkInfoView();
  }]));
  tabs.classList.add('park-st-tabs');
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '測站');
  tabs.querySelectorAll('.seg').forEach((b, i) => {
    const x = list[i];
    b.type = 'button'; b.dataset.id = x.id;
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(x.id === id));
    b.append(parkEl('b', null, x.id));
    if (x.name) b.append(parkEl('span', null, x.name));
    if (todo.includes(x.id)) { b.classList.add('is-todo'); b.title = '尚未放到新地圖上'; } // 更換地圖中：還沒處理的站
  });
  const goto = (sid) => tabs.querySelector(`.seg[data-id="${CSS.escape(sid)}"]`)?.click(); // 點地圖上別站的點＝換到那一站（同點頁籤）
  card.appendChild(tabs);

  const main = parkEl('div', 'park-card-body');
  const g = parkEl('div', 'settings-fields park-form');
  const pane = parkEl('div', 'park-map-pane');
  main.append(g, pane);
  card.appendChild(main);

  // 左：分區（照片／介紹／看更多連結），每區一個小標題、區與區之間一條細線（user 2026-10-21：原本太陽春）
  const sec = (title, meta) => {
    const d = parkEl('section', 'park-sec');
    const h = parkEl('div', 'park-sec-head');
    h.appendChild(parkEl('h4', 'park-sec-title', title));
    if (meta) h.appendChild(meta);
    d.appendChild(h);
    g.appendChild(d);
    return d;
  };
  const photoMeta = parkEl('span', 'park-sec-meta');
  const photos = parkEl('div', 'park-photos');
  const drawPhotos = () => {
    photos.innerHTML = '';
    const list2 = parkEntry(id).photos;
    photoMeta.textContent = `${list2.length} / ${PARK_MAX_PHOTOS}`;
    list2.forEach((uri, i) => {
      const t = parkEl('div', 'park-photo');
      const img = document.createElement('img'); img.src = mediaSrc(uri); img.alt = `照片 ${i + 1}`; img.loading = 'lazy';
      t.appendChild(img);
      if (i === 0) t.appendChild(parkEl('span', 'park-photo-first', '第一張'));
      if (!locked) {
        const del = parkEl('button'); del.type = 'button'; del.innerHTML = SVG_X; del.title = '移除這張'; del.setAttribute('aria-label', `移除照片 ${i + 1}`);
        del.onclick = () => { parkEdit(id, (e) => { e.photos.splice(i, 1); }); drawPhotos(); };
        t.appendChild(del);
      }
      photos.appendChild(t);
    });
    if (!locked && list2.length < PARK_MAX_PHOTOS) {
      const add = parkEl('button', 'park-photo-add'); add.type = 'button';
      add.innerHTML = `${SVG_PLUS}<span>上傳照片</span>`;
      add.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
        input.onchange = async () => {
          const files = [...input.files].slice(0, PARK_MAX_PHOTOS - parkEntry(id).photos.length);
          if (!files.length) return;
          const seq = parkUploadSeq;
          parkUploading++; setParkDirty();
          try {
            await uploadWithToast(files, {
              noun: '照片', unit: '張',
              onEach: (r) => {
                if (seq !== parkUploadSeq) return; // 已經捨棄這一站的修改
                parkEdit(id, (e) => { e.photos.push(r.url); });
                if (parkRedrawPhotos) parkRedrawPhotos(id);
              },
            });
          } finally {
            if (seq === parkUploadSeq) { parkUploading = Math.max(0, parkUploading - 1); setParkDirty(); }
          }
        };
        input.click();
      };
      photos.appendChild(add);
    }
  };
  parkRedrawPhotos = (sid) => { if (sid === id && photos.isConnected) drawPhotos(); };
  drawPhotos();
  sec('照片', photoMeta).append(photos, hint(`最多 ${PARK_MAX_PHOTOS} 張，展示機依序輪播，建議使用橫式（16:9）照片。`));

  // 介紹：簡易格式編輯器（粗體、小標題、條列、連結），固定高度、內容多了在框裡捲（user：不要讓使用者拉伸）
  const count = parkEl('span', 'park-sec-meta park-count');
  const secDesc = sec('介紹', count);
  secDesc.appendChild(parkRichEditor(id, locked, (n) => { count.textContent = `${n} / ${PARK_DESC_MAX}`; count.classList.toggle('is-over', n > PARK_DESC_MAX); }));
  secDesc.appendChild(hint('可使用粗體、小標題、條列與連結，展示機會以統一的字型與大小顯示。'));

  const linkErr = parkEl('p', 'hint park-err', '網址必須以 http:// 或 https:// 開頭。');
  const link = txtInput(parkEntry(id).link, 'https://…（選填）', (v) => {
    linkErr.hidden = parkLinkMaybe(v);
    parkEdit(id, (e) => { e.link = v; });
  }, 'url');
  link.id = 'parkLink';
  link.disabled = locked;
  link.addEventListener('blur', () => { linkErr.hidden = parkLinkOk(link.value); });
  linkErr.hidden = parkLinkOk(link.value);
  sec('看更多連結').append(link, linkErr, hint('填寫後會顯示「看更多」，訪客點選即可在園區資訊頁中開啟這個網頁。'));

  // 右：園區地圖（寬度跟著地圖圖片的比例，四周留白一樣寬）
  const ar = parkMapPane(pane, list, s, locked, goto);

  // 右下角（上面一條分隔線）：「● 尚有修改未儲存」＋取消（有修改才出現，捨棄這一站全部沒存的修改）＋儲存；一般帳號只看得到「限管理員」
  const foot = parkEl('div', 'settings-foot');
  if (locked) foot.appendChild(Object.assign(parkEl('span', 'b-badge neutral settings-lock-badge'), { textContent: '限管理員' }));
  else parkFootSave(foot);
  card.appendChild(foot);
  body.append(card);
  parkFitMap(main, pane, ar);
  if (parkShowPreviewSoon) { parkShowPreviewSoon = false; parkShowPreview(false); }
  requestAnimationFrame(() => tabs.querySelector('.seg.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })); // 站多到要橫捲時，目前這一站捲進來
  return !!ar;
}
/** 右半邊要看哪一個（2026-10-21 user）：'map'＝園區地圖、'preview'＝資訊卡預覽（這一站在展示機上滑下來的樣子，邊改邊看） */
let parkPaneTab = 'map';
/** 資訊卡預覽：照網頁播放頁 fillParkSheet 的版型（照片輪播的第一張＋點點、名稱、介紹、看更多），用 --ps 等比縮小；
 *  介紹有簡易格式就照格式畫（ParkRich.toHtml），沒有就是純文字 */
function parkPreviewFill(sheet, id, name) {
  const e = parkEntry(id);
  sheet.replaceChildren();
  // 內容在 .park-pv-body 裡捲，「查看更多」固定在底部（.park-pv-foot，同展示機）
  const box = parkEl('div', 'park-pv-body');
  sheet.appendChild(box);
  const photos = (e.photos || []).filter(Boolean);
  if (photos.length) {
    // 照片滿寬，比例跟第一張照片（4:3～21:9，同展示機）
    const ph = parkEl('div', 'park-pv-photo');
    const img = document.createElement('img'); img.src = mediaSrc(photos[0]); img.alt = ''; img.draggable = false;
    const fit = () => { if (img.naturalWidth && img.naturalHeight) ph.style.aspectRatio = String(Math.min(21 / 9, Math.max(4 / 3, img.naturalWidth / img.naturalHeight))); };
    if (img.complete) fit(); else img.addEventListener('load', fit, { once: true });
    ph.appendChild(img);
    if (photos.length > 1) {
      const dots = parkEl('div', 'park-pv-dots');
      photos.forEach((_, i) => dots.appendChild(parkEl('span', i ? '' : 'on')));
      ph.appendChild(dots);
    }
    box.appendChild(ph);
  }
  // 站名在展示機的頂欄、✕ 也是頂欄的返回鈕（user 2026-10-21），卡裡不再重複
  const md = e.descRich || '';
  if (md.trim()) { const d = parkEl('div', 'park-pv-desc park-rich-view'); d.innerHTML = ParkRich.toHtml(md); box.appendChild(d); }
  else if (String(e.desc || '').trim()) box.appendChild(parkEl('div', 'park-pv-desc is-plain', e.desc));
  const hasLink = !!String(e.link || '').trim();
  if (!photos.length && !md.trim() && !String(e.desc || '').trim()) box.appendChild(parkEl('p', 'park-pv-empty', '這一站尚未填寫介紹，展示機上不會出現資訊卡。'));
  if (hasLink) {
    const foot = parkEl('div', 'park-pv-foot');
    foot.appendChild(Object.assign(parkEl('div', 'park-pv-more'), { innerHTML: '查看更多<i data-lucide="chevron-right"></i>' }));
    sheet.appendChild(foot);
  }
  sheet.classList.toggle('has-foot', hasLink);
  if (window.lucide) lucide.createIcons({ nodes: [sheet] });
}
function parkPreview(s) {
  // 後面放這張園區地圖＋半透明遮罩，資訊卡從上方蓋下來（同展示機），大小跟地圖那一面一樣（user 2026-10-21：原本上重下輕）
  const cur = parkCur(s.id);
  const wrap = parkEl('div', 'park-pv');
  const screen = parkEl('div', 'park-pv-screen');
  screen.style.setProperty('--ar', cur.map ? `${cur.map.w} / ${cur.map.h}` : '9 / 16');
  if (cur.map) { const img = document.createElement('img'); img.src = mediaSrc(cur.map.src); img.alt = ''; img.draggable = false; screen.appendChild(img); }
  screen.appendChild(parkEl('div', 'park-pv-scrim'));
  const sheet = parkEl('div', 'park-pv-sheet');
  sheet.dataset.id = s.id; sheet.dataset.name = s.name || s.id;
  parkPreviewFill(sheet, s.id, s.name || s.id);
  screen.appendChild(sheet);
  wrap.appendChild(screen);
  return wrap;
}
/** 資訊卡預覽（user 2026-10-21：同一張地圖，切到預覽＝資訊卡像 App 一樣從上方掉下來、後面蓋半透明遮罩；切回地圖＝往上收回去）。
 *  蓋在地圖圖片上的一層；只能用上方的〔地圖｜資訊卡預覽〕收起，點遮罩、點地圖都沒有作用（user 2026-10-21）。還沒有地圖就用灰底的直式畫面代替（parkPreview） */
function parkShowPreview(animate) {
  const pane = document.querySelector('#parkBody .park-map-pane');
  if (!pane || !parkPaneCtx) return;
  pane.querySelectorAll('.park-pv-layer').forEach((x) => x.remove());
  const host = pane.querySelector('.park-pane-stage .park-map-edit');
  const { s } = parkPaneCtx;
  if (!host) { const stage = pane.querySelector('.park-pane-stage'); stage.replaceChildren(parkPreview(s)); if (pane._fit) pane._fit(); return; }
  const layer = parkEl('div', 'park-pv-layer');
  const scrim = parkEl('div', 'park-pv-scrim');
  const sheet = parkEl('div', 'park-pv-sheet');
  sheet.dataset.id = s.id; sheet.dataset.name = s.name || s.id;
  parkPreviewFill(sheet, s.id, s.name || s.id);
  layer.append(scrim, sheet);
  host.appendChild(layer);
  if (pane._fit) pane._fit();
  if (animate) { layer.classList.add('is-entering'); setTimeout(() => layer.classList.remove('is-entering'), 340); }
}
function parkHidePreview(animate) {
  const pane = document.querySelector('#parkBody .park-map-pane');
  const layer = pane && pane.querySelector('.park-pv-layer:not(.is-leaving)');
  if (!layer) { if (pane && pane.querySelector('.park-pane-stage > .park-pv')) renderParkInfoView(); return; } // 沒地圖時的灰底預覽：重畫回地圖區
  if (!animate) { layer.remove(); return; }
  layer.classList.remove('is-entering');
  layer.classList.add('is-leaving');
  setTimeout(() => layer.remove(), 240);
}
/** 編輯時即時更新預覽（只換預覽裡的內容，不重畫整頁，游標不會跑掉） */
function parkRefreshPreview() {
  const sheet = document.querySelector('#parkBody .park-pv-sheet');
  if (sheet) parkPreviewFill(sheet, sheet.dataset.id, sheet.dataset.name);
}

/** 介紹的簡易格式編輯器（user 2026-10-21 選：不做完整 HTML，只有粗體、小標題、條列、連結；展示機的字型、顏色、大小統一由系統控制）。
 *  直接在框裡看到效果（contenteditable），存成 ParkRich 的簡易格式（descRich）＋純文字（desc）。固定高度、內容多了在框裡捲。 */
function parkRichEditor(id, locked, onCount) {
  const wrap = parkEl('div', 'park-rich');
  const bar = parkEl('div', 'park-rich-bar');
  const ed = parkEl('div', 'park-rich-ed');
  ed.id = 'parkDesc';
  ed.contentEditable = locked ? 'false' : 'true';
  ed.setAttribute('role', 'textbox'); ed.setAttribute('aria-multiline', 'true'); ed.setAttribute('aria-label', '介紹');
  ed.dataset.placeholder = '這一站附近的介紹，例如花期、步道、設施…';
  const e0 = parkEntry(id);
  ed.innerHTML = ParkRich.toEditorHtml(e0.descRich || e0.desc || '');
  const plainOf = (md) => ParkRich.toPlain(md);
  const sync = () => {
    const md = ParkRich.fromEditor(ed);
    ed.classList.toggle('is-empty', !ed.textContent.trim() && !ed.querySelector('li'));
    parkEdit(id, (e) => { e.descRich = md; e.desc = plainOf(md); });
    onCount(plainOf(md).length);
    parkSyncRichBar();
  };
  ed.classList.toggle('is-empty', !ed.textContent.trim() && !ed.querySelector('li'));
  onCount(plainOf(ParkRich.fromEditor(ed)).length);
  ed.addEventListener('focus', () => { try { document.execCommand('defaultParagraphSeparator', false, 'div'); document.execCommand('styleWithCSS', false, false); } catch { /* 舊瀏覽器 */ } });
  // 400 字硬上限（user 2026-10-21：不要等按儲存才說超過）：注音等輸入法選字時瀏覽器擋不住，打完（input／compositionend）超過的字就刪掉
  const countOf = () => plainOf(ParkRich.fromEditor(ed)).length;
  const trimOver = () => {
    let over = countOf() - PARK_DESC_MAX;
    if (over <= 0) return;
    const sel = getSelection();
    if (sel && sel.rangeCount && ed.contains(sel.anchorNode) && sel.modify) { // 先刪游標前面剛打的字
      sel.collapseToEnd();
      for (let i = 0; i < over; i++) sel.modify('extend', 'backward', 'character');
      if (!sel.isCollapsed) document.execCommand('delete');
    }
    // 還超過（例如游標在最前面）：從最後面往回刪
    for (let guard = 0; (over = countOf() - PARK_DESC_MAX) > 0 && guard < 20; guard++) {
      const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
      if (!nodes.length) break;
      for (let i = nodes.length - 1; i >= 0 && over > 0; i--) { const t = nodes[i]; const cut = Math.min(over, t.data.length); t.data = t.data.slice(0, t.data.length - cut); over -= cut; }
    }
  };
  let composing = false; // 選字中：不擋（擋了選好的字會送不出去、注音留在框裡），選完再一次刪掉超出的字
  ed.addEventListener('compositionstart', () => { composing = true; });
  ed.addEventListener('compositionend', () => { composing = false; trimOver(); sync(); });
  ed.addEventListener('input', (ev) => { if (!ev.isComposing && !composing) trimOver(); sync(); });
  // 超過字數就不再收新字（換行、刪除照常）
  ed.addEventListener('beforeinput', (ev) => {
    if (composing || ev.isComposing) return;
    if (!/^insert(Text|FromPaste|FromDrop|ReplacementText)$/.test(ev.inputType)) return;
    if (plainOf(ParkRich.fromEditor(ed)).length >= PARK_DESC_MAX) ev.preventDefault();
  });
  // 貼上一律只收純文字（從 Word／網頁貼過來的字型、顏色不帶進來），超過字數的部分截掉
  ed.addEventListener('paste', (ev) => {
    ev.preventDefault();
    const room = PARK_DESC_MAX - plainOf(ParkRich.fromEditor(ed)).length;
    const text = (ev.clipboardData ? ev.clipboardData.getData('text/plain') : '').replace(/\r/g, '').slice(0, Math.max(0, room));
    if (text) document.execCommand('insertText', false, text);
  });
  const run = (fn) => { if (locked) return; ed.focus(); fn(); sync(); };
  const blockOf = () => { const sel = getSelection(); let n = sel && sel.anchorNode; while (n && n !== ed) { if (n.nodeType === 1 && /^(H3|DIV|LI|P)$/.test(n.tagName)) return n; n = n.parentNode; } return null; };
  const anchorOf = () => { const sel = getSelection(); let n = sel && sel.anchorNode; while (n && n !== ed) { if (n.nodeType === 1 && n.tagName === 'A') return n; n = n.parentNode; } return null; };
  const tools = [
    ['bold', '粗體', () => run(() => document.execCommand('bold'))],
    ['heading', '小標題', () => run(() => { const b = blockOf(); document.execCommand('formatBlock', false, b && b.tagName === 'H3' ? '<div>' : '<h3>'); })],
    ['list', '條列', () => run(() => {
      document.execCommand('insertUnorderedList');
      // 條列每一項的「・」也算字數：套用後超過就退回去
      if (countOf() > PARK_DESC_MAX) { document.execCommand('undo'); BToast.show('無法套用條列。', 'danger', { desc: `套用後會超過 ${PARK_DESC_MAX} 字。` }); }
    })],
    ['link', '連結', async () => {
      if (locked) return;
      const a = anchorOf();
      if (a) { run(() => { const r = document.createRange(); r.selectNodeContents(a); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('unlink'); }); return; }
      const sel = getSelection();
      const range = sel && sel.rangeCount && ed.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
      const url = await BDialog.prompt({ title: '加入連結', desc: '請輸入以 http:// 或 https:// 開頭的網址。', placeholder: 'https://', inputType: 'url', confirmText: '加入' });
      if (url == null) return;
      const u = url.trim();
      if (!/^https?:\/\/\S+$/.test(u)) { BToast.show('無法加入連結。', 'danger', { desc: '網址必須以 http:// 或 https:// 開頭。' }); return; }
      // 沒選字時網址會當成文字插進去，也算字數
      if ((!range || range.collapsed) && countOf() + u.length > PARK_DESC_MAX) { BToast.show('無法加入連結。', 'danger', { desc: `加入後會超過 ${PARK_DESC_MAX} 字，請先選取要加上連結的文字。` }); return; }
      run(() => {
        const s2 = getSelection();
        s2.removeAllRanges();
        if (range) s2.addRange(range); else { const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); s2.addRange(r); }
        if (s2.isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(u)}">${esc(u)}</a>`);
        else document.execCommand('createLink', false, u);
      });
    }],
  ];
  for (const [icon, label, fn] of tools) {
    const b = parkIconBtn(icon, label, fn);
    b.dataset.cmd = icon;
    b.addEventListener('mousedown', (ev) => ev.preventDefault()); // 按工具列時編輯框的選取範圍不要跑掉
    b.disabled = locked;
    bar.appendChild(b);
  }
  wrap.append(bar, ed);
  return wrap;
}
/** 工具列按鈕亮起＝游標所在位置已經套用那個格式（粗體／小標題／條列／連結） */
function parkSyncRichBar() {
  const ed = $('parkDesc');
  if (!ed || !ed.classList.contains('park-rich-ed')) return;
  const sel = getSelection();
  const inside = !!sel && !!sel.anchorNode && ed.contains(sel.anchorNode);
  const up = (tag) => { let n = inside ? sel.anchorNode : null; while (n && n !== ed) { if (n.nodeType === 1 && n.tagName === tag) return true; n = n.parentNode; } return false; };
  const state = { bold: inside && document.queryCommandState('bold'), heading: up('H3'), list: up('LI'), link: up('A') };
  ed.parentElement.querySelectorAll('.park-rich-bar [data-cmd]').forEach((b) => b.classList.toggle('is-on', !!state[b.dataset.cmd]));
}
document.addEventListener('selectionchange', () => { if (document.querySelector('#parkBody .park-rich-ed')) parkSyncRichBar(); });

/** 動作列右邊：「● 尚有修改未儲存」＋取消＋儲存（跟「測試連線」同一種文字鈕） */
function parkFootSave(foot) {
  const note = parkEl('span', 'ws-dirty-note park-dirty-note');
  note.id = 'parkDirtyNote'; note.setAttribute('aria-live', 'polite');
  const cancel = parkEl('button', 'b-btn b-btn-quiet', '取消');
  cancel.type = 'button'; cancel.id = 'parkCancelBtn'; cancel.hidden = true;
  cancel.onclick = parkDiscard;
  const save = parkEl('button', 'b-btn b-btn-text', '儲存');
  save.type = 'button'; save.id = 'parkSaveBtn';
  save.onclick = () => saveParkStation();
  parkSyncFoot(note, cancel, save);
  foot.append(note, cancel, save);
}
/** 取消：這一站全部沒存的修改丟掉（照片、說明、連結、位置、換過的地圖），還在傳的照片回來也不收 */
function parkDiscard() {
  if (parkUploading) { parkUploading = 0; parkUploadSeq++; }
  parkDraft = null; parkPlacing = false; parkPlaceSnap = null;
  renderParkInfoView();
}
/** 「編輯位置」開始前的樣子（位置＋地圖）：地圖下方的「取消」只退回這次編輯位置做的改動 */
const parkSnapOf = (id) => JSON.parse(JSON.stringify({ pos: parkCur(id).pos, map: parkCur(id).map }));
/** 這一站在這張地圖上的預設位置（「回到預設位置」；卓也＝原本內建的 D1–D5，只對那張地圖有效，新場域沒有） */
const parkHomeOf = (id, map) => { const h = parkSavedInfo().home; return h && map && h.map === map.src && h.pos && h.pos[id] ? h.pos[id] : null; };

/** 這個場域已經設定了多少：幾站放在地圖上、幾站填了介紹（照片／說明／看更多）；目前這一站以草稿為準 */
function parkSetupCount() {
  let placed = 0, filled = 0;
  for (const x of parkList()) {
    const c = parkCur(x.id);
    if (c.pos) placed++;
    if (c.e.photos.length || String(c.e.desc || '').trim() || String(c.e.link || '').trim()) filled++;
  }
  return { placed, filled };
}
/** 頁首「更換地圖」（還沒地圖時＝地圖區的「上傳地圖」）：新地圖先只在後台（parkMapSwap，user 2026-10-21），機器照舊顯示目前的地圖；
 *  所有測站都要在新地圖上重放（不保留舊位置），換站不會不見；原本在地圖上的站都放好（或按「從地圖移除」）才能按「套用新地圖」。
 *  已經有地圖、而且有任何一站放上地圖或填了介紹＝先跳警示框，確定了才選圖片；更換地圖中再換一張＝新地圖上放過的要重放，也先問 */
async function parkPickMap() {
  const id = parkSel;
  if (!id || !meIsAdmin || parkBarBusy) return;
  const saved = parkSavedInfo().map;
  if (parkMapSwap) {
    const placedNew = Object.values(parkMapSwap.pos).filter(Boolean).length;
    if (placedNew) {
      const ok = await BDialog.confirm({ title: '要改用另一張地圖嗎？', desc: `新地圖上已放置 ${placedNew} 個測站。\n改用另一張地圖後，需重新放置。`, confirmText: '選擇地圖' });
      if (!ok) return;
    }
  } else {
    const { placed, filled } = parkSetupCount();
    if (saved && (placed || filled)) {
      const has = [placed && `${placed} 個測站已放在地圖上`, filled && `${filled} 個測站已填寫介紹`].filter(Boolean).join('，');
      const ok = await BDialog.confirm({
        title: '要更換園區地圖嗎？',
        desc: `${has}。\n${placed ? '原本在地圖上的測站都放到新地圖上後，按「套用新地圖」才會更新到機器。\n' : ''}照片與說明不會變更。`, // Apple 中性口吻、一行一句（user 2026-10-21）
        confirmText: '選擇新地圖',
      });
      if (!ok) return;
    }
  }
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    const seq = parkUploadSeq;
    parkUploading++; setParkDirty();
    try {
      await uploadWithToast([f], {
        noun: '地圖', unit: '張',
        onEach: async (r) => {
          if (seq !== parkUploadSeq) return;
          let sz = await imagePixelSizeOf(f);
          if (!sz) sz = await new Promise((res) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = mediaSrc(r.url); });
          if (!sz || !sz.w || !sz.h) { BToast.danger('無法讀取地圖圖片的尺寸。請改用其他圖片。'); return; }
          // 按鈕列已經是編輯中那一行（編輯位置或更換地圖中）就不再播進場動畫；編輯位置做到一半的改動退回去（舊地圖的位置用不到了）
          const wasEditing = parkPlacing || !!parkMapSwap;
          if (parkPlacing && parkPlaceSnap && parkDraft && parkDraft.id === parkSel) { parkDraft.pos = parkPlaceSnap.pos; parkDraft.map = parkPlaceSnap.map; }
          parkPlacing = false; parkPlaceSnap = null;
          parkMapSwap = { map: { src: r.url, w: sz.w, h: sz.h }, from: saved, need: parkList().filter((x) => parkSavedPos(x.id)).map((x) => x.id), pos: {} };
          parkBarFx = wasEditing || parkNoMotion() ? '' : 'enter';
          parkPaneTab = 'map';
          renderParkInfoView();
        },
      });
    } finally {
      if (seq === parkUploadSeq) { parkUploading = Math.max(0, parkUploading - 1); setParkDirty(); }
    }
  };
  input.click();
}

/** 右半邊的園區地圖：所有放上地圖的站都畫出來，目前這一站亮起（其他站的點點了＝換到那一站）。
 *  平常鎖住；按「編輯位置」後只能動這一站的點（拖曳，或點地圖上的位置把它移過去／放上去）。回地圖比例（沒地圖＝0）。 */
function parkMapPane(pane, list, s, locked, goto) {
  const id = s.id;
  const swap = !!parkMapSwap && !locked; // 更換地圖中：一直是編輯中那一行，按鈕＝取消／套用新地圖
  const cur = parkMapOf(id);
  const placing = (parkPlacing || swap) && !locked;
  if (placing) parkPaneTab = 'map';
  const ar = cur.map ? cur.map.w / cur.map.h : 0;
  parkPaneCtx = { list, s, locked, goto };
  // 上方按鈕列：左邊〔地圖｜資訊卡預覽〕（編輯位置時收起來），右邊地圖的按鈕；下方內容區（.park-pane-stage）切換時左右滑動
  const bar = parkEl('div', 'park-map-bar');
  const row = parkEl('div', 'park-bar-row');
  bar.appendChild(row);
  const stage = parkEl('div', 'park-pane-stage');
  pane.append(bar, stage);
  if (!placing) {
    const act = parkEl('div', 'park-bar-act');
    row.append(parkPaneTabs(), act);
    stage.appendChild(parkPaneView(act));
    act.hidden = parkPaneTab === 'preview'; // 預覽開著時不放「編輯位置」
    if (parkPaneTab === 'preview') parkShowPreviewSoon = true; // 掛上畫面、算好寬度後再蓋上去（renderParkPage 收尾時）
    return ar;
  }

  // 編輯位置中：左邊圖示鈕（回到預設位置＝有預設的站才有、從地圖移除＝紅），右邊「取消」（退回這次編輯前）「完成」。
  // 動畫（user 2026-10-21：整行式的捲動）：進入編輯＝「地圖｜資訊卡預覽＋編輯位置」那一行往上捲走、新的一行從下面捲上來；
  // 離開（完成／取消）＝反過來往下捲，播完（parkExitPlacing）才重畫。地圖外框跟著淡入淡出
  const { view, map, place } = parkMapView(true);
  stage.appendChild(view);
  if (parkBarFx === 'enter') {
    parkBarFx = '';
    bar.classList.add('is-rolling', 'roll-up'); if (map) map.classList.add('fx-in');
    bar.appendChild(parkGhostRow());
    setTimeout(() => { bar.querySelector('.park-bar-ghost')?.remove(); bar.classList.remove('is-rolling', 'roll-up'); }, 320);
  }
  const textBtn = (text, fn, cls) => { const b = parkEl('button', 'b-btn ' + (cls || 'b-btn-text'), text); b.type = 'button'; b.onclick = fn; return b; };
  const tools = parkEl('div', 'park-bar-tools');
  const home = parkHomeOf(id, cur.map);
  if (home) {
    const h = parkIconBtn('rotate-ccw', '回到預設位置', () => place([...home]));
    h.id = 'parkHomeBtn';
    h.disabled = !!cur.pos && cur.pos[0] === home[0] && cur.pos[1] === home[1];
    tools.appendChild(h);
  }
  if (swap) {
    // 更換地圖中：還沒處理或已放上去的站都能按「從地圖移除」＝這一站不放在新地圖上（也算處理完）
    if (parkMapSwap.pos[id] !== null) tools.appendChild(parkIconBtn('map-pin-x', '從地圖移除', () => { parkMapSwap.pos[id] = null; renderParkInfoView(); }, 'is-danger'));
  } else if (cur.pos) tools.appendChild(parkIconBtn('map-pin-x', '從地圖移除', () => { parkEdit(id, (e, d) => { d.pos = null; }); renderParkInfoView(); }, 'is-danger'));
  if (tools.childNodes.length) row.appendChild(tools);
  if (swap) {
    const cancelSwap = textBtn('取消', () => parkCancelSwap(bar), 'b-btn-quiet park-place-cancel');
    cancelSwap.id = 'parkSwapCancelBtn';
    const apply = textBtn(parkMapSwap.from ? '套用新地圖' : '套用地圖', () => parkApplySwap(bar), 'b-btn-text park-place-btn');
    apply.id = 'parkSwapApplyBtn';
    apply.disabled = parkSwapTodo().length > 0 || parkSaving; // 原本在地圖上的站都處理完才能套用（還差幾站寫在地圖左下角）
    row.append(cancelSwap, apply);
    return ar;
  }
  const cancel = textBtn('取消', () => parkExitPlacing(bar, id, () => {
    const snap = parkPlaceSnap;
    if (snap) parkEdit(id, (e, d) => { d.pos = snap.pos; d.map = snap.map; });
  }), 'b-btn-quiet park-place-cancel');
  const done = textBtn('完成', () => parkExitPlacing(bar, id, () => {}), 'b-btn-text park-place-btn');
  done.id = 'parkPlaceBtn';
  row.append(cancel, done);
  return ar;
}
let parkPaneCtx = null; // 這一站畫地圖區要用的東西（換〔地圖｜資訊卡預覽〕時不重畫整頁，直接拿來用）
let parkShowPreviewSoon = false;
/** 右半邊的園區地圖（act＝按鈕列右邊放「編輯位置」的位置）；資訊卡預覽是蓋在地圖上的一層（parkShowPreview） */
function parkPaneView(act) {
  const { s, locked } = parkPaneCtx;
  if (act) act.replaceChildren();
  const { view } = parkMapView(false);
  if (act && !locked && parkCur(s.id).map) {
    const edit = parkEl('button', 'b-btn b-btn-text park-place-btn', '編輯位置');
    edit.type = 'button'; edit.id = 'parkPlaceBtn';
    edit.onclick = () => {
      if (parkBarBusy) return;
      parkPlaceSnap = parkSnapOf(s.id); parkPlacing = true;
      parkBarFx = parkNoMotion() ? '' : 'enter';
      renderParkInfoView();
    };
    act.appendChild(edit);
  }
  return view;
}
/** 園區地圖那一面：所有放上地圖的站都畫出來，目前這一站亮起（其他站的點點了＝換到那一站）。
 *  placing＝編輯位置中：只有這一站的點能拖，點地圖空白處＝把這一站放到（或移到）那裡。回 { view, map, place } */
function parkMapView(placing) {
  const { list, s, locked, goto } = parkPaneCtx;
  const id = s.id;
  const cur = parkMapOf(id);
  const swap = !!parkMapSwap;
  // 放這一站：更換地圖中放進新地圖（不算這一站的修改），平常改這一站的草稿
  const place = (pos) => { if (swap) parkMapSwap.pos[id] = pos; else parkEdit(id, (e, d) => { d.pos = pos; }); renderParkInfoView(); };
  if (!cur.map) {
    const em = parkEl('div', 'b-empty park-map-empty');
    em.innerHTML = '<span class="b-empty-icon"><i data-lucide="map"></i></span><p class="b-empty-title">尚未上傳園區地圖</p>';
    if (!locked) { const b = parkEl('button', 'b-btn b-btn-text', '上傳地圖'); b.type = 'button'; b.onclick = parkPickMap; em.appendChild(b); }
    return { view: em, map: null, place };
  }
  const wrap = parkEl('div', 'park-map-wrap');
  const map = parkEl('div', 'park-map-edit' + (placing ? ' is-editing' : ''));
  map.style.setProperty('--ar', `${cur.map.w} / ${cur.map.h}`);
  const img = document.createElement('img'); img.src = mediaSrc(cur.map.src); img.alt = '園區地圖'; img.draggable = false;
  map.appendChild(img);
  let mine = null;
  for (const x of list) {
    const p = x.id === id ? cur.pos : (swap ? parkMapSwap.pos[x.id] || null : parkSavedPos(x.id)); // 更換地圖中：只畫已放到新地圖上的站
    if (!p) continue;
    const pin = parkEl('span', 'park-pin' + (x.id === id ? ' is-sel' : ''), x.id);
    pin.dataset.id = x.id;
    pin.title = parkLabel(x);
    pin.style.left = `${p[0]}%`; pin.style.top = `${p[1]}%`;
    if (x.id === id) mine = pin;
    else pin.onclick = (ev) => { ev.stopPropagation(); goto(x.id); };
    map.appendChild(pin);
  }
  // 地圖左上角一句狀態（不另外佔一列）
  const skipped = swap && parkMapSwap.pos[id] === null;
  const tipText = placing ? (cur.pos ? `拖曳或按一下地圖以移動 ${id}` : skipped ? `${id} 不放在新地圖上，按一下地圖即可放置` : `按一下地圖以放置 ${id}`) : (cur.pos ? '' : `${id} 尚未放到地圖上`);
  if (tipText) map.appendChild(parkEl('span', 'park-map-tip', tipText));
  // 更換地圖中：左下角寫還差幾站（原本在地圖上的站）
  if (swap && placing && parkMapSwap.need.length) {
    const n = parkSwapTodo().length;
    map.appendChild(parkEl('span', 'park-map-tip is-count' + (n ? '' : ' is-done'), n ? `還有 ${n} 個測站尚未放置` : '所有測站都已處理'));
  }
  if (placing) {
    const posFrom = (ev) => {
      const r = map.getBoundingClientRect();
      const k = (v) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
      return [k(((ev.clientX - r.left) / r.width) * 100), k(((ev.clientY - r.top) / r.height) * 100)];
    };
    if (mine) {
      mine.addEventListener('pointerdown', (down) => {
        if (down.button > 0) return;
        down.preventDefault();
        mine.setPointerCapture(down.pointerId);
        mine.classList.add('is-drag');
        const move = (m) => { const [x, y] = posFrom(m); mine.style.left = `${x}%`; mine.style.top = `${y}%`; };
        const up = (u) => {
          mine.removeEventListener('pointermove', move); mine.removeEventListener('pointerup', up); mine.removeEventListener('pointercancel', up);
          mine.classList.remove('is-drag');
          place(posFrom(u));
        };
        mine.addEventListener('pointermove', move); mine.addEventListener('pointerup', up); mine.addEventListener('pointercancel', up);
      });
    }
    map.addEventListener('click', (ev) => { if (!ev.target.closest('.park-pin')) place(posFrom(ev)); });
  }
  wrap.appendChild(map);
  return { view: wrap, map, place };
}
/** 換〔地圖｜資訊卡預覽〕：同一張地圖不動，資訊卡從上方掉下來／往上收回去（user 2026-10-21：像 App 那樣），跟指示塊同時開始 */
function parkSwitchPane(to) {
  if (parkPaneTab === to) return;
  parkPaneTab = to;
  const pane = document.querySelector('#parkBody .park-map-pane');
  if (!pane || !parkPaneCtx) { renderParkInfoView(); return; }
  parkTipHide();
  const act = pane.querySelector('.park-bar-act');
  if (act) act.hidden = to === 'preview';
  if (to === 'preview') parkShowPreview(!parkNoMotion());
  else parkHidePreview(!parkNoMotion());
}
/** 右半邊的〔地圖｜資訊卡預覽〕切換（點了馬上換，跟指示塊同時動） */
function parkPaneTabs() {
  const t = segRow([
    ['地圖', parkPaneTab === 'map', () => parkSwitchPane('map')],
    ['資訊卡預覽', parkPaneTab === 'preview', () => parkSwitchPane('preview')],
  ], { immediate: true });
  t.classList.add('park-pane-tabs');
  t.querySelectorAll('.seg').forEach((b) => { b.type = 'button'; });
  return t;
}
/** 捲動動畫用的「編輯位置」那一行（只是畫面，不能按）：進入時它往上捲走、離開時它從上面捲回來 */
function parkGhostRow() {
  const g = parkEl('div', 'park-bar-row park-bar-ghost');
  g.setAttribute('aria-hidden', 'true');
  const b = parkEl('button', 'b-btn b-btn-text park-place-btn', '編輯位置');
  b.type = 'button'; b.tabIndex = -1;
  g.append(parkPaneTabs(), b);
  g.querySelectorAll('button').forEach((x) => { x.tabIndex = -1; });
  return g;
}
/** 離開「編輯位置」（完成／取消）：先在畫面上往下捲（這一行捲走、「編輯位置」那一行從上面捲回來、地圖外框淡掉），
 *  播完才套用（apply）並重畫；這段時間換了站就不套用。不要動畫＝馬上套用。 */
function parkExitPlacing(bar, id, apply) {
  parkRollDown(bar, () => { if (parkSel === id) { apply(); parkPlacing = false; parkPlaceSnap = null; } });
}
/** 編輯中那一行往下捲走（「編輯位置」那一行從上面捲回來、地圖外框淡掉），播完才 apply 並重畫；不要動畫＝馬上 */
function parkRollDown(bar, apply) {
  if (parkBarBusy) return;
  const finish = () => {
    parkBarBusy = false;
    apply();
    renderParkInfoView();
  };
  if (parkNoMotion() || !bar || !bar.isConnected) { finish(); return; }
  parkBarBusy = true;
  parkTipHide();
  bar.querySelector('.park-bar-ghost')?.remove();
  bar.classList.remove('roll-up');
  bar.classList.add('is-rolling', 'roll-down');
  bar.appendChild(parkGhostRow());
  const map = bar.closest('.park-map-pane')?.querySelector('.park-map-edit');
  if (map) { map.classList.remove('fx-in'); map.classList.add('fx-out'); }
  setTimeout(finish, 260);
}
/** 更換地圖中按「取消」：新地圖上放過站就先問，捨棄後回到目前的地圖（機器本來就沒換） */
async function parkCancelSwap(bar) {
  if (!parkMapSwap || parkBarBusy) return;
  const placed = Object.values(parkMapSwap.pos).filter(Boolean).length;
  if (placed) {
    const ok = await BDialog.confirm({
      title: '要捨棄新地圖嗎？',
      desc: `新地圖上已放置 ${placed} 個測站。\n${parkMapSwap.from ? '捨棄後，機器會繼續顯示目前的地圖。' : '捨棄後，這個場域仍不會有園區地圖。'}`,
      variant: 'danger', confirmText: '捨棄',
    });
    if (!ok) return;
  }
  parkRollDown(bar, () => { parkMapSwap = null; });
}
/** 「套用新地圖」：新地圖＋所有站在新地圖上的位置一次存進去（不放的站拿掉位置），機器一分鐘內一起換 */
async function parkApplySwap(bar) {
  const sw = parkMapSwap;
  if (!sw || parkSwapTodo().length || parkSaving || parkBarBusy || !meIsAdmin) return;
  const ok = await parkPut((next) => {
    next.map = sw.map;
    for (const [sid, st] of Object.entries(next.stations)) {
      const p = sw.pos[sid];
      if (p) { st.x = p[0]; st.y = p[1]; } else { delete st.x; delete st.y; }
    }
    for (const [sid, p] of Object.entries(sw.pos)) if (p && !next.stations[sid]) next.stations[sid] = { name: '', photos: [], desc: '', link: '', x: p[0], y: p[1] };
  }, sw.from ? '無法套用新地圖。' : '無法套用地圖。');
  if (!ok) return;
  // 正在改的那一站：草稿裡的地圖與位置換成剛存的，不算這一站的修改
  if (parkDraft) { parkDraft.map = parkSavedInfo().map; parkDraft.pos = parkSavedPos(parkDraft.id); }
  BToast.show(sw.from ? '已套用新地圖。' : '已套用園區地圖。', 'success', { desc: '機器會在一分鐘內更新。' });
  parkRollDown(bar, () => { parkMapSwap = null; parkPlacing = false; parkPlaceSnap = null; });
}
/** 地圖下方的圖示鈕：滑過去在按鈕上方出一個小標籤寫名稱（全站不用瀏覽器原生 title 提示框）；按了就收掉標籤 */
let parkTipEl = null;
const parkTipHide = () => { if (parkTipEl) { parkTipEl.remove(); parkTipEl = null; } };
function parkIconBtn(icon, label, fn, cls) {
  const b = parkEl('button', 'icon-btn park-icon-btn' + (cls ? ' ' + cls : ''));
  b.type = 'button'; b.setAttribute('aria-label', label);
  b.innerHTML = `<i data-lucide="${icon}"></i>`;
  b.onclick = () => { parkTipHide(); fn(); };
  b.addEventListener('mouseenter', () => {
    parkTipHide();
    const t = parkEl('div', 'b-tip is-mini', label);
    document.body.appendChild(t);
    const r = b.getBoundingClientRect();
    const x = Math.max(8, Math.min(window.innerWidth - t.offsetWidth - 8, r.left + r.width / 2 - t.offsetWidth / 2));
    let y = r.top - t.offsetHeight - 6;
    if (y < 8) y = r.bottom + 6;
    t.style.left = `${x}px`; t.style.top = `${y}px`;
    parkTipEl = t;
    requestAnimationFrame(() => { if (t.isConnected) t.classList.add('is-on'); });
  });
  b.addEventListener('mouseleave', parkTipHide);
  return b;
}
/** 地圖區寬度跟著圖片比例（user 2026-10-20：左右留白要跟上下一樣）：寬＝可用高度×比例＋左右內距，
 *  至少放得下下方的按鈕、最多卡片寬的 60%；窄螢幕（上下排）不用。卡片大小變了就重算。 */
let parkMapRO = null;
function parkFitMap(main, pane, ar) {
  const fit = () => {
    if (!pane.isConnected) return;
    if (!ar || !matchMedia('(min-width: 901px)').matches) { pane.style.width = ''; return; }
    const cs = getComputedStyle(pane);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const gap = parseFloat(cs.rowGap) || 0;
    const bar = pane.querySelector('.park-map-bar');
    const row = bar && bar.querySelector('.park-bar-row:not(.park-bar-ghost)');
    const btns = row ? [...row.children] : []; // 左邊圖示群組＋右邊文字鈕：加起來的自然寬度
    const barW = btns.reduce((w, b) => w + b.offsetWidth, 0) + Math.max(0, btns.length - 1) * (parseFloat(row && getComputedStyle(row).columnGap) || 0);
    const barH = bar ? bar.offsetHeight + gap : 0;
    const mapW = Math.max(0, main.clientHeight - padY - barH) * ar;
    const w = Math.min(Math.max(mapW, barW, 240) + padX, main.clientWidth * 0.6);
    pane.style.width = `${Math.round(w)}px`;
    // 資訊卡預覽：1080 寬展示機在 KIOSK 版面（預設）的等比縮小（同播放頁 parkSheetScale：0.45 × 1080/820 × 1.6，文字再 × 1.45）
    const pv = pane.querySelector('.park-pv-sheet');
    if (pv) {
      const ps = (pv.clientWidth / 1080) * 0.45 * (1080 / 820) * 1.6;
      pv.style.setProperty('--ps', ps.toFixed(3));
      pv.style.setProperty('--pt', (ps * 1.45).toFixed(3));
    }
  };
  fit();
  pane._fit = fit;
  if (window.ResizeObserver) { parkMapRO = new ResizeObserver(() => requestAnimationFrame(fit)); parkMapRO.observe(main); }
}

// ---- 資料來源（modal；2026-10-20 user：從頁籤拿出來，頁首單獨一顆按鈕開；測試連線結果用 toast；
//      各站連線狀態收進右上角按鈕，hover 展開垂直清單，按鈕上的小圓點看得出大概狀況） ----
const parkSrcOpen = () => $('parkSourceModal').classList.contains('is-visible');
/** 輸入框目前的網址（沒動過＝已儲存的） */
const parkApiInputVal = () => (parkApiDraft !== null ? parkApiDraft : parkSavedInfo().api).trim();
function syncParkSrcSave() {
  $('parkApiSaveBtn').disabled = !parkApiChanged() || parkSaving;
}
/** 右上角連線狀態：面板裡一站一行（代號、名稱、在線／離線）；圖示顏色＝全部在線綠、有站離線琥珀、連不上紅、還沒測灰 */
function parkConnRefresh() {
  if (!parkSrcOpen()) return;
  const box = $('parkConnBody');
  box.innerHTML = '';
  const url = parkApiInputVal();
  let list = null, err = '', loading = false;
  if (parkApiTest && parkApiTest.url === url) { list = parkApiTest.list || null; err = parkApiTest.error || ''; loading = !!parkApiTest.loading; }
  else if (url && url === parkSavedInfo().api) { list = parkStations; err = parkStationsErr; loading = parkStations === null || parkStationsLoading; }
  const note = (t) => box.appendChild(parkEl('p', 'park-conn-note', t));
  let tone = '';
  if (!url) note('尚未填寫測站 API 網址。');
  else if (loading) note('正在讀取測站資料…');
  else if (err) { note(err); tone = 'err'; }
  else if (!list) note('網址已變更，請按一下「測試連線」確認能否讀取測站。');
  else if (!list.length) { note('可以連線，但沒有讀取到任何測站。'); tone = 'err'; }
  else {
    const on = list.filter((x) => x.online).length;
    note(`${list.length} 個測站，${on} 站在線。`);
    const ul = parkEl('ul', 'park-conn-list');
    for (const st of list) {
      const li = parkEl('li');
      li.appendChild(parkEl('b', null, st.id));
      li.appendChild(parkEl('span', null, st.name && st.name !== st.id ? st.name : ''));
      const chip = parkEl('span', 'park-online', st.online ? '在線' : '離線'); chip.dataset.on = String(!!st.online);
      li.appendChild(chip);
      ul.appendChild(li);
    }
    box.appendChild(ul);
    tone = on === list.length ? 'ok' : 'warn';
  }
  $('parkConnPop').dataset.tone = tone;
}
function openParkSource() {
  parkApiDraft = null; parkApiTest = null;
  const input = $('parkApiInput');
  input.value = parkSavedInfo().api;
  input.disabled = !meIsAdmin;
  $('parkApiSaveBtn').hidden = !meIsAdmin;
  syncParkSrcSave();
  BModal.open('#parkSourceModal');
  if (PARK_API && parkStations === null) loadParkStations();
  parkConnRefresh();
  if (meIsAdmin) input.focus();
}
/** ✕／點遮罩／Esc：改了沒存先問 */
async function closeParkSource() {
  if (parkApiChanged()) {
    const ok = await BDialog.confirm({ title: '有尚未儲存的修改', desc: '資料來源的修改尚未儲存，要捨棄嗎？', variant: 'danger', confirmText: '捨棄' });
    if (!ok) return;
  }
  parkApiDraft = null; parkApiTest = null;
  BModal.close('#parkSourceModal');
}
/** 測試連線：結果一律 toast（同其他地方），連線狀態面板跟著更新 */
async function testParkApi() {
  const url = parkApiInputVal();
  if (!url) { BToast.show('無法測試連線。', 'danger', { desc: '請先填寫測站 API 網址。' }); return; }
  if (!/^https?:\/\/\S+$/.test(url)) { BToast.show('無法測試連線。', 'danger', { desc: '網址必須以 http:// 或 https:// 開頭。' }); return; }
  const b = $('parkApiTestBtn');
  b.disabled = true;
  parkApiTest = { url, loading: true }; parkConnRefresh();
  try {
    const list = parseStations(await api('GET', `/api/station/current?url=${encodeURIComponent(url)}`));
    parkApiTest = { url, list };
    if (!list.length) BToast.show('沒有讀取到任何測站。', 'danger', { desc: '可以連線到這個網址，但提供的不是測站資料，請確認網址。' });
    else BToast.show('連線成功。', 'success', { desc: `讀取到 ${list.length} 個測站，其中 ${list.filter((x) => x.online).length} 站在線。` });
  } catch (e) {
    const why = e.message === 'no stations' ? '此網址未提供測站資料，請確認網址是否正確。' : e.message;
    parkApiTest = { url, error: why };
    BToast.show('無法連線到測站資料來源。', 'danger', { desc: why });
  } finally {
    b.disabled = false;
    parkConnRefresh();
  }
}
$('parkApiInput').addEventListener('input', (e) => { parkApiDraft = e.target.value; syncParkSrcSave(); parkConnRefresh(); });
$('parkApiTestBtn').addEventListener('click', testParkApi);
$('parkApiSaveBtn').addEventListener('click', () => saveParkApi());
$('parkSourceClose').addEventListener('click', closeParkSource);
$('parkSourceModal').addEventListener('click', (e) => { if (e.target === $('parkSourceModal')) closeParkSource(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !parkSrcOpen()) return;
  if (document.querySelector('.b-modal-overlay[data-modal-vue].is-visible:not(#parkSourceModal)')) return; // BDialog 開著時它自己先攔
  if ($('parkConnPop').matches(':focus-within, .is-open')) return; // 先收連線狀態面板（page-help 的 Esc 處理）
  closeParkSource();
});

async function applySharedSettings() {
  if (!shared.chatApi && !shared.sleep && !shared.adminPin && !shared.idleReturnSec) return setStatus('請先設定客服帳號、休眠時段、管理 PIN 或閒置返回時間，再套用到機器。', true);
  if (sharedDirty && !(await saveShared(true))) return; // 自動存檔還沒跑完就先 flush，套用的內容＝存下來的內容
  let devices;
  try { devices = await api('GET', '/api/devices'); } catch (e) { return setStatus('無法取得機器清單。' + e.message, true); }
  if (!devices.length) return BDialog.alert({ title: '沒有機器', desc: '此帳號目前沒有任何機器。' });
  const picked = await pickDevicesDialog({
    title: '套用共用設定到機器',
    desc: '所選機器的客服帳號、休眠時段、管理 PIN 與閒置返回時間會改用共用設定並立即發布，版面不受影響。',
    confirmText: '套用並發布',
    items: devices.map((d) => ({ d })),
  });
  if (!picked || !picked.length) return;
  const partial = {};
  if (shared.chatApi) partial.chatApi = shared.chatApi;
  if (shared.sleep) partial.sleep = shared.sleep;
  if (shared.adminPin) partial.adminPin = shared.adminPin; // 共用 PIN 留空＝不覆蓋機器的 PIN
  if (shared.idleReturnSec) partial.idleReturnSec = shared.idleReturnSec; // 共用閒置秒數留空（0）＝不覆蓋；-1（關閉自動返回）也照覆蓋
  await publishToDevices(picked, partial, '套用到');
}

// ---------- 側邊欄：功能切換（navbar 只放全局操作） ----------
// 目前頁記在網址 hash（#devices／#sharedLayout／#sharedSettings／#users），重新整理不會被打回機器總覽。
// 用 replaceState 不留歷史紀錄：上一頁仍是離開後台，不是在四個頁籤間倒退。
const VIEWS = ['devices', 'sharedLayout', 'sharedSettings', 'parkInfo', 'users'];
function restoreView() {
  const want = location.hash.slice(1);
  if (!VIEWS.includes(want)) return 'devices';
  if (want === 'users' && !meIsAdmin) return 'devices'; // 非管理員沒有帳號管理
  return want;
}
function switchView(view) {
  // 園區測站這一站有沒存的修改（2026-10-20 一定要按儲存）：離開前先問，捨棄才換頁
  if (titleView === 'parkInfo' && view !== 'parkInfo' && (parkBusy() || parkMapSwap)) { confirmParkLeave(true).then((ok) => { if (ok) switchView(view); }); return; }
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
  $('parkInfoView').classList.toggle('hidden', view !== 'parkInfo');
  $('usersView').classList.toggle('hidden', view !== 'users');
  titleView = view; updateDocTitle();
  spaFade();
  if (view === 'devices') renderDevicesView().catch((e) => setStatus('無法取得機器清單。' + e.message, true)); // 以前失敗＝默默空表
  if (view === 'sharedLayout') renderSharedLayoutView();
  if (view === 'sharedSettings') renderSharedSettingsView();
  if (view === 'parkInfo') renderParkInfoView();
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

// ---------- 主題色 modal（2026-09-14）----------
// nav 調色盤鈕（管理員限定）。顏色存共用設定 shared.themeColor（全站一份），後台深淺色與展示機 App 都跟它走。
// 選色只在 modal 的樣本列預覽（#themePreview 作用域 CSS；user：要按儲存才能變）；儲存才 PUT 並把 #siteTheme 換成新色。變數推導在 theme-color.js（與伺服器同一支）。
// 色票＝最前面 JusThings 公司橘 #E07800（預設色，user 2026-09-14 指定），接著以 joye 藍 #0051A8 的色調（oklch L.448 c.156）為準、色相每 45° 一格共 8 色、不重複（綠那格改用揚昇綠 #2E6F40，user 指定）；
// 算法同 theme-color.js 的 fromLch（超出色域收彩度）。目前站台色不在清單裡時 swatchRow 會多顯示一格自訂色。
const THEME_SWATCHES = ['FFE07800', 'FF0051A8', 'FF00606D', 'FF2E6F40', 'FF4C5D00', 'FF724C00', 'FF982312', 'FF8C2366', 'FF65389B'].map((h) => parseInt(h, 16));
(function () {
  const overlay = $('themeModal');
  const T = window.KioskThemeColor;
  const styleEl = () => $('siteTheme');
  let draft = '', lastFocus = null;
  const saved = () => T.normalize(shared && shared.themeColor) || T.DEFAULT;
  const preview = (hex) => { $('themePreview').textContent = T.scopedCss(hex, '#themeModal .theme-sample'); };
  function render() {
    const box = $('themeSwatches');
    box.innerHTML = '';
    box.appendChild(swatchRow(THEME_SWATCHES, argbOfHex(draft), false, (c) => { draft = T.normalize(hexOfArgb(c)); render(); }));
    $('themeHex').textContent = draft;
    preview(draft);
    $('th-save').disabled = draft === saved();
  }
  async function open() {
    if (!(await ensureSharedLoaded())) return;
    lastFocus = document.activeElement;
    draft = saved();
    render();
    overlay.classList.remove('is-closing');
    overlay.classList.add('is-visible');
    document.body.classList.add('b-modal-lock');
    if (window.lucide) lucide.createIcons({ nodes: [overlay] });
    $('th-close').focus();
  }
  function close() {
    if (!overlay.classList.contains('is-visible') || overlay.classList.contains('is-closing')) return;
    overlay.classList.add('is-closing');
    overlay.addEventListener('animationend', function h(e) {
      if (e.target !== overlay) return;
      overlay.removeEventListener('animationend', h);
      overlay.classList.remove('is-visible', 'is-closing');
      if (!$('wsModal').classList.contains('is-visible')) document.body.classList.remove('b-modal-lock');
    });
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  async function save() {
    const prev = shared.themeColor;
    shared.themeColor = draft;
    if (await saveShared(true)) {
      const el = styleEl(); if (el) el.textContent = T.css(draft); // 儲存成功才套到整站
      setStatus('主題色已更新，展示機會在幾秒內套用。');
      close();
    } else shared.themeColor = prev;
  }
  $('themeBtn').addEventListener('click', open);
  $('th-close').addEventListener('click', close);
  $('th-save').addEventListener('click', save);
  // 只認點在 overlay 本身：色票點下去會重建色票列，冒泡到這裡時 target 已不在 modal 裡，不能用 modal.contains 判斷
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('is-visible')) close(); }, true);
})();

// ---------- 機器總覽（首頁列表） ----------
/** 上線狀態文字：機器每 ~25 秒會回來掛長輪詢，60 秒內有露面就當在線。 */
function statusCell(d) {
  // tiri 收件列表同款：狀態＝b-badge 帶小圓點（在線綠 / 離線灰），離線附「多久沒回報」
  // 離線／尚未回報加 is-off（2026-10-14 精修）：灰點灰字，不要跟綠色「在線」一樣搶眼（原本黑點黑字）
  const td = document.createElement('td');
  const badge = document.createElement('span');
  const dot = document.createElement('span');
  dot.className = 'dot';
  badge.appendChild(dot);
  if (d.LastSeenAgoSec == null) {
    badge.className = 'b-badge neutral is-off';
    badge.append('尚未回報');
    badge.title = '伺服器啟動後，這台機器尚未連線';
  } else if (d.LastSeenAgoSec < 60) {
    badge.className = 'b-badge ok';
    badge.append('在線');
  } else {
    badge.className = 'b-badge neutral is-off';
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
    body = '這台機器最近使用錯誤的連線金鑰連線。\n請在機器的「雲端同步」重新連線到本站。';
  } else if (d.ServerMatch === false) {
    cls = 'warning'; icon = 'unplug'; title = `連線到其他伺服器（${shortServer(d.LastServerUrl)}）`;
    body = `機器設定的伺服器位址為 ${d.LastServerUrl}，並非本站，在此所做的變更不會傳送到機器。\n請在機器的「雲端同步」重新連線到本站。`;
  } else if (d.ServerMatch === true) {
    // 綠勾只在「在線」時顯示（2026-09-09）：這筆是機器最後一次連上本站時自報的，離線後它若改連別台伺服器，
    // 本站不會再收到任何回報、無從得知，掛著綠勾會誤導（user 實測：手機切去正式站，這裡仍顯示設定正確）。
    // 黃／紅警告照舊離線也顯示——那是最後一次接觸時就看到的問題，值得留著。
    if (!(d.LastSeenAgoSec < 60)) return null;
    cls = 'ok'; icon = 'circle-check'; title = '連線設定正確';
    body = `伺服器位址與連線金鑰皆屬於本站。\n${keyKindText(d)}${d.LastAppVersion ? `\nApp v${d.LastAppVersion}` : ''}`;
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
/** 連線金鑰說明（2026-10-13）：每台專屬金鑰換好了沒。網頁播放頁一直用共用金鑰（網址上那把），不會換。 */
function keyKindText(d) {
  if (d.KeyKind === 'own') return '這台機器使用專屬的連線金鑰。';
  if (d.KeyKind === 'pending') return '正在更換為這台機器專屬的連線金鑰。';
  if (/^web/i.test(d.LastAppVersion || '')) return '網頁播放頁使用共用的連線金鑰。';
  return '這台機器仍在使用共用的連線金鑰，更新至新版 App 後會自動更換為專屬金鑰。';
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
/** 「尺寸」「解析度」欄（2026-09-14）：與編號同款灰色等寬字。吋數＝App v1.45 起自報（網頁播放頁拿不到實體尺寸＝不支援），
 *  整數不留小數（43 吋）、否則一位小數（42.5 吋）；沒有＝—。解析度沒回報過也＝—。 */
function screenInchText(d) {
  const scr = d.Screen;
  // 網頁播放頁（版本 web x.x／編號 web-…）：瀏覽器拿不到實體尺寸，標「不支援」（user 2026-09-14 指示），與舊版 App 的「—」區分
  if (!(scr && scr.inch > 0) && (/^web/i.test(d.LastAppVersion || '') || /^web-/i.test(d.DeviceId || ''))) return '不支援';
  if (!scr || !(scr.inch > 0)) return '—';
  return (Number.isInteger(scr.inch) ? String(scr.inch) : scr.inch.toFixed(1)) + ' 吋';
}
function screenResText(scr) {
  return scr && scr.w > 0 && scr.h > 0 ? `${scr.w} × ${scr.h}` : '—';
}
/** 列表的時間欄（2026-10-14 精修）：近的寫「12 分鐘前／今天 13:41／昨天 13:41」，今年寫「10/5 13:41」，更早才寫年份；
 *  完整時間放 title（滑上去看）。 */
function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso), now = new Date(), sec = (now - t) / 1000;
  const hm = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
  const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day0(now) - day0(t)) / 864e5);
  if (sec >= 0 && sec < 60) return '剛剛';
  if (sec >= 0 && sec < 3600) return `${Math.floor(sec / 60)} 分鐘前`;
  if (days === 0) return `今天 ${hm}`;
  if (days === 1) return `昨天 ${hm}`;
  if (t.getFullYear() === now.getFullYear()) return `${t.getMonth() + 1}/${t.getDate()} ${hm}`;
  return `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()}`;
}
/** 時間欄 td：顯示 relTime、完整時間放 title；class 預設＝等寬數字＋次要灰字。 */
function timeTd(iso, cls = 'num device-id-dim') {
  const td = document.createElement('td');
  td.className = cls;
  td.textContent = relTime(iso);
  if (iso) td.title = new Date(iso).toLocaleString('zh-TW', { hour12: false });
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

$('devicesReloadBtn').addEventListener('click', async () => {
  const b = $('devicesReloadBtn');
  if (b.classList.contains('is-busy')) return;
  b.classList.add('is-busy');
  try { await renderDevicesView(); } finally { setTimeout(() => b.classList.remove('is-busy'), 400); }
});

// ---------- 機器清單自動更新（2026-10-14 user 選定）：每 30 秒抓一次，標題旁「更新於 剛剛 ⟳」----------
// 只在機器總覽看得到、分頁在前景、沒有開著對話框或縮圖預覽時抓；畫面上要顯示的東西沒變就不重畫（縮圖輪播不會被打斷）。
// 抓失敗不跳錯，「更新於」的時間會停住變成「3 分鐘前」，看得出來斷線了。
let devicesFetchedAt = 0;
let devicesSig = '';
function devicesStampText() {
  if (!devicesFetchedAt) return '';
  const sec = (Date.now() - devicesFetchedAt) / 1000;
  return sec < 60 ? '剛剛' : `${agoText(sec)}前`;
}
function updateDevicesStamp() {
  const el = $('devicesUpdatedAt');
  if (el) el.textContent = devicesStampText();
}
function devicesAutoRefreshOk() {
  if (!token || document.hidden || $('devicesView').classList.contains('hidden')) return false;
  if (thumbPreview || document.querySelector('.b-modal-overlay.is-visible')) return false;
  return true;
}
let devicesStale = false; // 伺服器說清單變了、但當下開著對話框沒抓：等能抓時（5 秒一輪）補抓
function refreshDevicesIfDue() {
  if (!devicesAutoRefreshOk()) return;
  if (!devicesStale && Date.now() - devicesFetchedAt < 30000) return;
  devicesStale = false;
  renderDevicesView({ quiet: true }).catch(() => { devicesStale = true; });
}
setInterval(() => { updateDevicesStamp(); refreshDevicesIfDue(); }, 5000);
// 從別的分頁切回來：超過 30 秒沒更新、或期間清單有變就馬上抓一次
document.addEventListener('visibilitychange', refreshDevicesIfDue);

// 即時更新（2026-10-14）：掛在伺服器 /api/devices/wait，機器新增、移除（含手機取消配對）、發布、上線／離線時立刻回，
// 收到就重抓清單。30 秒定時更新照留當備援；連不上（斷線、伺服器重啟）就 5 秒後再掛。
let devicesRev = 0;

/** 機器事件 toast（2026-10-14）：別人做的「機器加入／中斷連線／被刪除」跳 toast，點了回機器總覽；自己做的不跳（自己的操作本來就有提示）。
 *  同一種事件一次來 3 筆以上（多半是切到別的分頁回來）合併成一則。之後的鈴鐺通知中心沿用同一份事件格式（server.js devicesEvents）。 */
const DEVICE_EVENT_TEXT = {
  left: {
    icon: 'unplug', type: 'info',
    one: (e) => [`「${e.name}」已中斷連線。`, '已在現場解除與本站的連線，並從清單中移除。'],
    many: (n, names) => [`有 ${n} 台機器中斷連線。`, `${names}已從清單移除。`],
  },
  deleted: {
    icon: 'trash-2', type: 'info',
    one: (e) => [`「${e.name}」已被刪除。`, `${whoText(e)}已從後台刪除這台機器。`],
    many: (n, names) => [`有 ${n} 台機器被刪除。`, `${names}已從清單移除。`],
  },
  joined: {
    icon: 'monitor-check', type: 'success',
    one: (e) => [`「${e.name}」已加入。`, `${whoText(e)}已使用配對碼新增這台機器。`],
    many: (n, names) => [`有 ${n} 台機器加入。`, `${names}已出現在清單中。`],
  },
};
const whoText = (e) => (e.by && (e.by.displayName || e.by.username)) || '其他帳號';
function showDeviceEvents(events) {
  const mine = (e) => e.by && e.by.kind === 'user' && e.by.username === meUsername;
  const byType = {};
  for (const e of events) if (DEVICE_EVENT_TEXT[e.type] && !mine(e)) (byType[e.type] = byType[e.type] || []).push(e);
  const goDevices = () => switchView('devices');
  for (const [type, list] of Object.entries(byType)) {
    const t = DEVICE_EVENT_TEXT[type];
    const opts = { icon: t.icon, duration: 7000, onClick: goDevices };
    if (list.length >= 3) {
      const names = list.slice(0, 3).map((e) => `「${e.name}」`).join('') + (list.length > 3 ? '等' : '');
      const [title, desc] = t.many(list.length, names);
      BToast.show(title, t.type, { ...opts, desc });
    } else {
      for (const e of list) { const [title, desc] = t.one(e); BToast.show(title, t.type, { ...opts, desc }); }
    }
  }
}

(async function watchDevices() {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  for (;;) {
    if (!token || document.hidden) { await pause(5000); continue; }
    try {
      const res = await fetch(BASE + `/api/devices/wait?rev=${devicesRev}`, {
        headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(40000),
      });
      if (!res.ok) { await pause(5000); continue; }
      const { rev, events, notifRev } = await res.json();
      if (notifRev && notifRev !== notifRevSeen) { notifRevSeen = notifRev; loadNotifs(); }
      if (rev !== devicesRev) {
        const first = devicesRev === 0; // 第一次只是拿目前版次，不必重抓
        devicesRev = rev;
        if (!first) { devicesStale = true; refreshDevicesIfDue(); showDeviceEvents(events || []); }
      }
    } catch { await pause(5000); }
  }
})();

// ---------- 通知鈴鐺（2026-10-14）：頂欄「下載 App」右邊；資料＝GET /api/notifications（src/notify.js）----------
// 機器類（加入、中斷連線、刪除、離線超過 10 分鐘、恢復連線、金鑰不符）大家都看；內容類（發布、切換、共用版面／設定）只看別人做的。
// 打開鈴鐺＝全部已讀（每個帳號各自記）；面板開著時，打開前就未讀的那幾則照樣標小圓點，看得出哪些是新的。
// 同一批動作（批量展示、加到多台、套用設定到多台）合成一則。點一則：有那台機器就跳到機器總覽並讓那一列閃一下；
// 機器已不在清單就只關掉面板；共用版面／共用設定跳到那一頁。
let notifData = { items: [], readAt: null };
let notifRevSeen = 0;
let notifShownReadAt = null;
let knownDeviceIds = new Set();
const NOTIF_STYLE = {
  joined: ['monitor-check', 'ok'], online: ['wifi', 'ok'],
  left: ['unplug', ''], deleted: ['trash-2', ''],
  offline: ['wifi-off', 'warn'], keyMismatch: ['key-round', 'warn'],
  renamed: ['pencil-line', 'brand'], published: ['monitor-up', 'brand'], switchPage: ['presentation', 'brand'],
  appendLayout: ['copy-plus', 'brand'], showLayout: ['layers', 'brand'], applySettings: ['sliders-horizontal', 'brand'],
  sharedLayout: ['layout-template', 'brand'], sharedSettings: ['settings-2', 'brand'],
};
const notifMine = (n) => n.Kind === 'content' && n.ActorUsername === meUsername;
/** 同一個 GroupKey、時間相鄰（3 分鐘內）的合成一則；回傳 [{ at, type, text, deviceId, count }]（新到舊）。 */
function groupNotifs(items) {
  const out = [];
  for (const n of items || []) {
    if (notifMine(n)) continue;
    const last = out[out.length - 1];
    if (last && n.GroupKey && last.groupKey === n.GroupKey && new Date(last.oldest) - new Date(n.At) < 3 * 60_000) {
      last.count++; last.oldest = n.At; last.deviceId = null;
      continue;
    }
    out.push({ at: n.At, oldest: n.At, type: n.Type, text: n.Text, deviceId: n.DeviceId, groupKey: n.GroupKey, actor: n.ActorName, count: 1 });
  }
  for (const g of out) {
    if (g.count < 2) continue;
    const layout = (g.groupKey.match(/^[a-z]+:[^:]*:(.*)$/) || [])[1] || '';
    if (g.type === 'showLayout') g.text = `${g.actor}讓 ${g.count} 台機器展示版面「${layout}」`;
    else if (g.type === 'appendLayout') g.text = `${g.actor}將版面「${layout}」加入 ${g.count} 台機器`;
    else if (g.type === 'applySettings') g.text = `${g.actor}將共用機器設定套用到 ${g.count} 台機器`;
  }
  return out;
}
const notifTime = (iso) => new Date(iso).getTime();
function unreadNotifCount() {
  const r = notifData.readAt ? notifTime(notifData.readAt) : 0;
  return groupNotifs(notifData.items).filter((g) => notifTime(g.at) > r).length;
}
/** 未讀數（2026-10-14 user：顯示數字，變多時數字要滾動更新）：
 *  0→有＝紅點彈出；數字變了＝舊數字往上滑走、新數字從下面滑上來（變少反過來），像里程表；歸零（打開鈴鐺）＝縮小消失。
 *  超過 9 顯示 9+（9+ 之間不滾）。動畫用 Web Animations；系統設定減少動態時直接換。 */
let notifBadgeShown = 0;
const NB_EASE = 'cubic-bezier(.22, 1, .36, 1)';
function paintNotifBadge() {
  const n = unreadNotifCount();
  const b = $('notifBadge');
  const label = (x) => (x > 9 ? '9+' : String(x));
  const prev = notifBadgeShown;
  notifBadgeShown = n;
  $('notifBtn').setAttribute('aria-label', n ? `通知（${n} 則未讀）` : '通知');
  updateDocTitle();
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!n) {
    if (b.hidden) return;
    if (calm) { b.hidden = true; return; }
    b.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.3)', opacity: 0 }], { duration: 160, easing: 'ease-in' })
      .finished.then(() => { if (!notifBadgeShown) b.hidden = true; }).catch(() => {});
    return;
  }
  if (b.hidden || !prev) {
    b.hidden = false;
    b.innerHTML = `<span class="nb-num">${label(n)}</span>`;
    b.getAnimations().forEach((a) => a.cancel());
    if (!calm) {
      b.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.18)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: 320, easing: NB_EASE });
    }
    return;
  }
  if (label(prev) === label(n)) return;
  // 連續變動：只留最後一個數字當「舊的」，其他正在滑走的直接拿掉
  const nums = [...b.querySelectorAll('.nb-num')];
  nums.slice(0, -1).forEach((x) => x.remove());
  const old = nums[nums.length - 1];
  const nu = document.createElement('span');
  nu.className = 'nb-num';
  nu.textContent = label(n);
  b.appendChild(nu);
  if (calm || !old) { old?.remove(); return; }
  const dir = n > prev ? 1 : -1; // 變多：往上滾；變少：往下滾
  old.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${-110 * dir}%)`, opacity: 0 }],
    { duration: 280, easing: NB_EASE, fill: 'forwards' }).finished.then(() => old.remove()).catch(() => {});
  nu.animate([{ transform: `translateY(${110 * dir}%)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
    { duration: 280, easing: NB_EASE });
  // 變多時紅點本身也輕輕跳一下
  if (dir > 0) b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
}
async function loadNotifs() {
  if (!token) return;
  try { notifData = await api('GET', '/api/notifications'); } catch { return; }
  paintNotifBadge();
  if (!$('notifPanel').hidden) renderNotifPanel();
}
function renderNotifPanel() {
  const list = $('notifList');
  const groups = groupNotifs(notifData.items);
  list.innerHTML = '';
  if (!groups.length) {
    list.innerHTML = '<div class="notif-empty"><span class="notif-empty-ic"><i data-lucide="bell-off"></i></span>' +
      '<p class="notif-empty-title">目前沒有通知</p><p class="notif-empty-sub">機器加入、中斷連線或內容更新時，通知會顯示在這裡。</p></div>';
    if (window.lucide) lucide.createIcons({ nodes: [list] });
    return;
  }
  const readAt = notifShownReadAt ? notifTime(notifShownReadAt) : 0;
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  let section = '';
  for (const g of groups) {
    const sec = notifTime(g.at) >= today0.getTime() ? '今天' : '更早';
    if (sec !== section) {
      section = sec;
      const h = document.createElement('div');
      h.className = 'notif-section';
      h.textContent = sec;
      list.appendChild(h);
    }
    const [icon, tone] = NOTIF_STYLE[g.type] || ['bell', ''];
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'notif-item' + (notifTime(g.at) > readAt ? ' is-unread' : '');
    item.innerHTML = `<span class="notif-ic${tone ? ' is-' + tone : ''}"><i data-lucide="${icon}"></i></span>` +
      '<span class="notif-body"><span class="notif-text"></span><span class="notif-time"></span></span><span class="notif-dot" aria-hidden="true"></span>';
    item.querySelector('.notif-text').textContent = g.text + '。';
    const time = item.querySelector('.notif-time');
    time.textContent = relTime(g.at);
    time.dataset.at = g.at;
    time.title = new Date(g.at).toLocaleString('zh-TW', { hour12: false });
    item.onclick = () => openNotifTarget(g);
    list.appendChild(item);
  }
  const foot = document.createElement('p');
  foot.className = 'notif-foot';
  foot.textContent = '僅保留最近 30 天的通知。';
  list.appendChild(foot);
  if (window.lucide) lucide.createIcons({ nodes: [list] });
}
function openNotifTarget(g) {
  setNotifPanel(false);
  if (g.type === 'sharedLayout') return switchView('sharedLayout');
  if (g.type === 'sharedSettings') return switchView('sharedSettings');
  if (!g.deviceId || !knownDeviceIds.has(g.deviceId)) {
    if (g.count > 1) switchView('devices'); // 一批機器：回清單就好
    return;
  }
  switchView('devices');
  // 清單是非同步畫的：等那一列出現再閃（最多 3 秒）
  const t0 = Date.now();
  (function flash() {
    const tr = [...document.querySelectorAll('#deviceTable tbody tr')].find((r) => r.dataset.deviceId === g.deviceId);
    if (!tr) { if (Date.now() - t0 < 3000) setTimeout(flash, 100); return; }
    tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    tr.classList.remove('is-flash'); void tr.offsetWidth; tr.classList.add('is-flash');
  })();
}
let notifLeaveTimer = null;
function setNotifPanel(open) {
  const panel = $('notifPanel');
  if (open === !panel.hidden) return;
  clearTimeout(notifLeaveTimer);
  if (open) {
    notifShownReadAt = notifData.readAt;
    renderNotifPanel();
    panel.hidden = false;
    panel.classList.remove('hdr-user-leave-active');
    panel.classList.add('hdr-user-enter-active');
    // 打開＝全部已讀：紅點馬上消失，伺服器那邊記時間
    if (unreadNotifCount()) {
      notifData.readAt = new Date().toISOString();
      paintNotifBadge();
      api('POST', '/api/notifications/read').then((r) => { if (r && r.readAt) notifData.readAt = r.readAt; }).catch(() => {});
    }
  } else {
    panel.classList.remove('hdr-user-enter-active');
    panel.classList.add('hdr-user-leave-active');
    notifLeaveTimer = setTimeout(() => { panel.hidden = true; panel.classList.remove('hdr-user-leave-active'); }, 140);
  }
  $('notifBtn').setAttribute('aria-expanded', String(open));
}
$('notifBtn').addEventListener('click', () => setNotifPanel($('notifPanel').hidden));

// ---------- 瀏覽器分頁標題與小圖示（2026-10-14 精修）----------
// 標題＝「(未讀數) 目前這一頁｜站名 展示機管理系統」，開著工作區時是機器名稱；有未讀時分頁小圖示右上角加紅點。
// 切到別的分頁也看得到有新通知、在哪一頁。
const BASE_TITLE = document.title;
const VIEW_TITLE = { devices: '機器總覽', sharedLayout: '版面設定', sharedSettings: '共用機器設定', parkInfo: '園區測站', users: '帳號管理' };
let titleView = '';
function updateDocTitle() {
  const n = token ? unreadNotifCount() : 0;
  let page = '';
  if (token && !$('mainView').classList.contains('hidden')) {
    page = $('wsModal').classList.contains('is-visible') ? ($('wsDeviceName').textContent || '').trim() : (VIEW_TITLE[titleView] || '');
  }
  document.title = (n ? `(${n > 9 ? '9+' : n}) ` : '') + (page && page !== '—' ? `${page}｜` : '') + BASE_TITLE;
  setFaviconDot(n > 0);
}
let favBase = null, favDot = false;
function setFaviconDot(on) {
  const link = document.querySelector('link[rel~="icon"]');
  if (!link || on === favDot) return;
  favDot = on;
  if (!favBase) favBase = { href: link.href, type: link.getAttribute('type') };
  if (!on) { link.href = favBase.href; if (favBase.type) link.type = favBase.type; return; }
  const img = new Image();
  img.onload = () => {
    if (!favDot) return;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 64, 64);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(50, 14, 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#DC2626'; g.beginPath(); g.arc(50, 14, 11, 0, Math.PI * 2); g.fill();
    link.type = 'image/png';
    link.href = c.toDataURL('image/png');
  };
  img.src = favBase.href;
}

// ---------- ⌘S／Ctrl+S＝儲存並發布（2026-10-14 精修）：只在工作區開著時接手，瀏覽器的「另存網頁」不會跳出來 ----------
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
document.addEventListener('keydown', (e) => {
  if (!(e.key === 's' || e.key === 'S') || !(IS_MAC ? e.metaKey : e.ctrlKey) || e.altKey) return;
  if (!$('wsModal').classList.contains('is-visible')) {
    // 園區測站頁（2026-10-20）：同一顆快捷鍵＝儲存這一站；沒有修改就在儲存鈕左邊閃一句；資料來源 modal 開著＝存資料來源
    if ($('parkInfoView').classList.contains('hidden') || !meIsAdmin) return;
    e.preventDefault();
    if (parkSrcOpen()) { saveParkApi(); return; }
    if (parkChanged()) { saveParkStation(); return; }
    const pn = $('parkDirtyNote');
    if (!pn) return;
    pn.textContent = '目前沒有新的修改'; pn.classList.add('is-on', 'is-plain');
    clearTimeout(pn._t);
    pn._t = setTimeout(() => setParkDirty(), 1600);
    return;
  }
  e.preventDefault();
  if (!$('saveBtn').disabled) { $('saveBtn').click(); return; }
  // 沒有修改：底部欄閃一句「目前沒有新的修改」，讓人知道有按到
  const note = wsDirtyNote();
  if (!note || dirty) return;
  note.textContent = '目前沒有新的修改'; note.classList.add('is-on', 'is-plain');
  clearTimeout(note._t);
  note._t = setTimeout(() => { note.classList.remove('is-plain'); setDirty(dirty); }, 1600);
}, true);
document.addEventListener('click', (e) => { if (!e.target.closest('.header-notif-wrap')) setNotifPanel(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setNotifPanel(false); });
// 時間文字（12 分鐘前）跟著走
setInterval(() => { if (!$('notifPanel').hidden) $('notifList').querySelectorAll('.notif-time').forEach((t) => { t.textContent = relTime(t.dataset.at); }); }, 60_000);

/** opts.quiet＝自動更新：內容沒變就只更新「更新於」。 */
async function renderDevicesView(opts = {}) {
  const devices = await api('GET', '/api/devices');
  knownDeviceIds = new Set(devices.map((d) => d.DeviceId));
  devicesFetchedAt = Date.now();
  updateDevicesStamp();
  // 簽章＝畫面上實際顯示的內容（露面秒數換成狀態文字、更新時間換成相對時間），每 30 秒都會變的秒數不算
  const sig = JSON.stringify(devices.map((d) => ({
    ...d,
    LastSeenAgoSec: d.LastSeenAgoSec == null ? null : d.LastSeenAgoSec < 60 ? 'on' : agoText(d.LastSeenAgoSec),
    UpdatedAt: relTime(d.UpdatedAt),
  })));
  if (opts.quiet && sig === devicesSig) return;
  devicesSig = sig;

  const tb = $('deviceTable').querySelector('tbody');
  clearListThumbs(); // 舊縮圖的輪播計時器
  tb.innerHTML = '';
  $('deviceTable').classList.toggle('is-empty', !devices.length); // 空狀態不留光禿表頭
  if (!devices.length) {
    // tiri 規範：空清單不留光禿表頭，換 b-empty 空狀態
    tb.innerHTML =
      '<tr><td colspan="8"><div class="b-empty">' +
      '<span class="b-empty-icon"><i data-lucide="monitor-off"></i></span>' +
      '<p class="b-empty-title">尚未加入任何機器</p>' +
      '<p class="b-empty-sub">按一下右上角的「新增機器」並輸入機器畫面上的配對碼，機器就會顯示在這裡。</p>' +
      '</div></td></tr>';
    if (window.lucide) lucide.createIcons();
    return;
  }
  for (const d of devices) {
    const tr = document.createElement('tr');
    tr.className = 'device-row';
    tr.dataset.deviceId = d.DeviceId; // 鈴鐺點通知時找這一列來閃
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
    // 只有編號用等寬字（2026-10-14 精修）：吋數、解析度是「數字＋中文」，等寬字配中文會鬆散，改一般字＋等寬數字
    tr.insertAdjacentHTML('beforeend',
      `<td class="device-id-dim device-mono">${esc(d.DeviceId)}</td>` +
      `<td class="num device-id-dim">${screenInchText(d)}</td>` +
      `<td class="num device-id-dim">${screenResText(d.Screen)}</td>`);
    tr.appendChild(timeTd(d.UpdatedAt));
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

// ---------- 機器總覽 › 新增機器（2026-10-13 配對碼） ----------
// 機器 App「雲端同步」顯示 6 位數配對碼（同一組登記在每個場域）。這裡一個對話框走完：輸入配對碼（6 格，像驗證碼）→「下一步」才查
// → 確認機型並取名 → 正在新增（轉圈，等機器真的連上）→ 已新增（打勾）→ 自己關、清單已經有這台而且在線。步驟之間有過場：
// 舊內容往左淡出、新內容從右淡入、對話框高度跟著平順伸縮（user 2026-10-13：關掉就該是新增成功；處理中要有過場；
// 配對碼要像驗證碼那樣一格一格；打滿不要自動查，按下一步才判斷；換步驟不要直接跳）。
// 輸入的是已經在本場域的機器（它按了重新配對）：不給新增，停在這一步說「已在清單中」——跟打錯號碼同一個位置，但用橘色、
// 格子橘光呼吸兩下不搖晃（user 2026-10-14：不用另外跳一個畫面）；連在別的場域的機器，取名時提醒會從那邊移除。
$('addDeviceBtn').addEventListener('click', async () => {
  if (await pairDialog()) renderDevicesView();
});

/** 新增機器對話框。外觀同 BDialog（.b-modal.is-alert）；處理中不能關（Esc、點遮罩都不理），免得以為取消了其實已經新增。
 *  機器 20 秒內沒連上：照樣算新增成功（後台已建好這台），改成說明＋「知道了」。回傳 true＝已新增、false＝取消。 */
function pairDialog() {
  return new Promise((resolve) => {
    const hint = '名稱會顯示在機器總覽，之後仍可更名。';
    const codeHint = '請輸入機器畫面上顯示的 6 位數配對碼。';
    // 機器目前連在別的場域（user 2026-10-13：要讓人知道這台已經在某個場域）：取名這一步先講清楚新增後會怎樣
    const nameDesc = (i) => (i.model ? `機型：${i.model}\n` : '') +
      (i.currentSite ? `此機器目前連線到「${i.currentSite}」，新增後將從該場域移除。\n` : '') + hint;
    const existsDesc = (name) => `此機器已在清單中，名稱為「${name}」。`;
    const overlay = document.createElement('div');
    overlay.className = 'b-modal-overlay';
    overlay.setAttribute('data-modal-vue', ''); // 同 BDialog：別讓殼層 modal JS 接管
    overlay.setAttribute('data-modal-anim', 'vue');
    overlay.style.zIndex = '1600';
    overlay.innerHTML =
      '<div class="b-modal is-alert pair-dlg" role="dialog" aria-modal="true" aria-labelledby="pairDlgTitle">' +
        '<div class="b-alert-body">' +
          '<div class="b-alert-icon pair-dlg-icon" aria-hidden="true" hidden></div>' +
          '<h2 class="b-alert-title" id="pairDlgTitle"></h2>' +
          '<p class="b-alert-desc" aria-live="polite" style="white-space:pre-line"></p>' +
          '<div class="otp" role="group" aria-label="配對碼"></div>' +
          '<input class="b-input pair-name" type="text" aria-label="機器名稱" placeholder="例：一樓大廳" style="margin-top:12px;width:100%;text-align:center">' +
        '</div>' +
        '<div class="b-alert-foot">' +
          '<button type="button" class="b-btn b-btn-quiet">取消</button>' +
          '<button type="button" class="b-btn b-btn-text">下一步</button>' +
        '</div>' +
      '</div>';
    const q = (sel) => overlay.querySelector(sel);
    const icon = q('.pair-dlg-icon'), title = q('.b-alert-title'), descEl = q('.b-alert-desc');
    const otp = q('.otp'), nameInput = q('.pair-name'), foot = q('.b-alert-foot');
    const [cancelBtn, okBtn] = foot.querySelectorAll('button');
    let phase = 'code', code = '', info = null, added = false, closed = false, checking = false;
    // 查到「已在清單中」的那組號碼：伺服器那邊這組已經作廢（機器也收起來了），沒改號碼再按下一步就直接再說一次，不再去查（不然變成「找不到」）
    let knownExisting = null; // { code, message }

    // ---- 6 格配對碼：打一個跳下一格、退格回上一格、可整組貼上（「482 913」中間有空格也收）、打滿自動查 ----
    const boxes = [];
    for (let i = 0; i < 6; i++) {
      if (i === 3) { const gap = document.createElement('span'); gap.className = 'otp-gap'; otp.appendChild(gap); }
      const b = document.createElement('input');
      b.className = 'otp-box';
      b.type = 'text';
      b.inputMode = 'numeric';
      b.maxLength = 1;
      b.autocomplete = i === 0 ? 'one-time-code' : 'off';
      b.setAttribute('aria-label', `第 ${i + 1} 碼`);
      otp.appendChild(b);
      boxes.push(b);
    }
    const otpValue = () => boxes.map((b) => b.value).join('');
    /** 一開始改號碼就把「找不到這組配對碼」的紅框、「已在清單中」的橘框與說明收回 */
    function clearError() {
      otp.classList.remove('is-error', 'is-exists');
      if (descEl.classList.contains('is-error') || descEl.classList.contains('is-exists')) {
        descEl.textContent = codeHint;
        descEl.classList.remove('is-error', 'is-exists');
      }
    }
    /** 號碼這一步的提示，停在原地：error＝紅字紅框搖晃（找不到）；exists＝橘字橘框、格子橘光呼吸兩下（這台已在清單中） */
    function flagCode(kind, message) {
      okBtn.textContent = '下一步';
      okBtn.disabled = false;
      descEl.textContent = message;
      descEl.classList.remove('is-error', 'is-exists');
      descEl.classList.add('is-' + kind);
      otp.classList.remove('is-error', 'is-exists'); void otp.offsetWidth; otp.classList.add('is-' + kind); // 重播動畫
      boxes.forEach((b) => { b.disabled = false; });
      boxes[5].focus();
    }
    function fill(from, digits) {
      let i = from;
      for (const d of digits) { if (i > 5) break; boxes[i++].value = d; }
      boxes[Math.min(i, 5)].focus();
      clearError();
      okBtn.disabled = otpValue().length !== 6;
    }
    boxes.forEach((b, i) => {
      b.addEventListener('input', () => {
        const digits = b.value.replace(/\D/g, '');
        b.value = '';
        if (digits) fill(i, digits);
        else { okBtn.disabled = true; clearError(); }
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !b.value && i > 0) { e.preventDefault(); boxes[i - 1].value = ''; boxes[i - 1].focus(); okBtn.disabled = true; clearError(); }
        else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); boxes[i - 1].focus(); }
        else if (e.key === 'ArrowRight' && i < 5) { e.preventDefault(); boxes[i + 1].focus(); }
        else if (e.key === 'Enter') e.preventDefault();
      });
      b.addEventListener('focus', () => b.select());
      b.addEventListener('paste', (e) => {
        e.preventDefault();
        const digits = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        if (digits) fill(digits.length >= 6 ? 0 : i, digits.slice(0, 6));
      });
    });

    /** 換步驟的過場：舊內容往左淡出 → 換內容 → 新內容從右淡入，期間對話框高度從舊的平順變成新的。
     *  系統設定「減少動態效果」時只淡出淡入、不位移不伸縮（照樣看得出換了一步）。 */
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const body = q('.b-alert-body'), modal = q('.pair-dlg');
    async function transition(update) {
      if (!modal.animate) { update(); return; }
      const dx = reduceMotion ? 0 : 14;
      const ease = 'cubic-bezier(.22, 1, .36, 1)';
      const parts = [body, foot]; // 按鈕列一起淡出淡入（新增中／已新增沒有按鈕列）
      const h0 = modal.offsetHeight;
      const outs = parts.map((el) => el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dx}px)` }],
        { duration: 140, easing: 'ease-in', fill: 'forwards' }));
      await Promise.all(outs.map((x) => x.finished.catch(() => {})));
      update();
      const h1 = modal.offsetHeight;
      outs.forEach((x) => x.cancel());
      modal.style.overflow = 'hidden';
      if (!reduceMotion) modal.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 240, easing: ease });
      await Promise.all(parts.map((el) => el.animate([{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'none' }],
        { duration: 240, easing: ease }).finished.catch(() => {})));
      modal.style.overflow = '';
    }
    /** 正在新增 → 已新增（user 2026-10-14：同一個畫面，不換頁）：圖示由 show 接著轉圈收成打勾，這裡只讓換掉的字（與「知道了」鈕）淡入 */
    function settle(update) {
      update();
      if (!modal.animate) return;
      [title, descEl, foot].forEach((el) => { if (!el.hidden) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' }); });
    }
    function show(next, t, d) {
      const prev = phase;
      phase = next;
      title.textContent = t;
      descEl.textContent = d;
      descEl.classList.toggle('is-error', next === 'error');
      descEl.classList.remove('is-exists');
      const ic = { busy: 'loader-circle', done: 'circle-check', slow: 'circle-check' }[next];
      icon.hidden = !ic;
      // 正在新增 → 已新增：轉圈最後一圈閉合再畫出勾（morph-icons.js；要在換 class 之前叫，才記得到轉圈的角度與顏色）；其他照舊換圖
      const closing = prev === 'busy' && ic === 'circle-check' && window.closeSpinner?.(icon);
      icon.className = 'b-alert-icon pair-dlg-icon is-' + next;
      if (!closing) icon.innerHTML = ic ? `<i data-lucide="${ic}"${next === 'busy' ? ' class="b-spin"' : ''}></i>` : '';
      otp.hidden = next !== 'code';
      nameInput.hidden = !(next === 'name' || next === 'error');
      foot.hidden = next === 'busy' || next === 'done';
      okBtn.textContent = next === 'code' ? '下一步' : next === 'slow' ? '好' : '新增';
      cancelBtn.hidden = next === 'slow';
      okBtn.disabled = next === 'code' && otpValue().length !== 6;
      if (window.lucide) lucide.createIcons();
    }
    async function lookup() {
      if (checking || phase !== 'code') return;
      code = otpValue();
      if (code.length !== 6) return;
      if (knownExisting && knownExisting.code === code) { flagCode('exists', knownExisting.message); return; }
      checking = true;
      boxes.forEach((b) => { b.disabled = true; });
      okBtn.disabled = true;
      okBtn.textContent = '確認中…';
      try {
        info = await api('GET', `/api/pair/code/${code}`);
        // 這台本來就在本場域（機器按了重新配對、又輸入到同一個場域）：不新增第二台，停在這一步說明（機器那邊也已經收起配對碼）
        if (info.existing) {
          knownExisting = { code, message: existsDesc(info.existing.name) };
          flagCode('exists', knownExisting.message);
          return;
        }
        await transition(() => show('name', '為這台機器命名', nameDesc(info)));
        nameInput.focus();
      } catch (e) {
        flagCode('error', e.message);
      } finally {
        checking = false;
      }
    }
    function close(val) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.classList.remove('is-open');
      setTimeout(() => {
        overlay.remove();
        if (!document.querySelector('.b-modal-overlay.is-open')) document.body.classList.remove('b-modal-lock');
      }, 200);
      resolve(val);
    }
    async function submit() {
      if (phase === 'code') return lookup();
      if (phase === 'slow') return close(true);
      const name = nameInput.value.trim();
      if (!name) { show('name', '為這台機器命名', '請輸入機器名稱。\n' + hint); nameInput.focus(); return; }
      await transition(() => show('busy', '正在新增', '正在連線到機器，請稍候…'));
      let res;
      try { res = await api('POST', '/api/pair/claim', { code, name }); }
      catch (e) { await transition(() => show('error', '無法新增機器', e.message)); nameInput.focus(); return; }
      added = true;
      const t0 = Date.now();
      let online = false;
      while (!online && Date.now() - t0 < 20000) {
        await new Promise((r) => setTimeout(r, 700));
        const list = await api('GET', '/api/devices').catch(() => null);
        const d = list && list.find((x) => x.DeviceId === res.deviceId);
        online = !!(d && d.LastSeenAgoSec != null && d.LastSeenAgoSec < 30);
      }
      if (online) {
        settle(() => show('done', `已新增「${res.deviceName}」`, '機器已連線，現在可以開始管理內容。'));
        setTimeout(() => close(true), 1900); // 轉圈收成打勾約 1 秒，畫完再看一下才關
      } else {
        settle(() => show('slow', `已新增「${res.deviceName}」`, '機器尚未連線，請確認機器已開機並連上網路，連線後清單會顯示「在線」。'));
      }
    }
    const canDismiss = () => phase === 'code' || phase === 'name' || phase === 'error';
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (canDismiss()) close(false);
        else if (phase === 'slow') close(true);
      } else if (e.key === 'Enter' && e.target === nameInput) {
        e.preventDefault(); // 同 BDialog：Enter 不送出，一律按鈕
      }
    }
    okBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', () => close(added));
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target !== overlay) return;
      if (canDismiss()) close(false);
      else if (phase === 'slow') close(true);
    });
    document.addEventListener('keydown', onKey, true);

    show('code', '新增機器', codeHint);
    document.body.appendChild(overlay);
    document.body.classList.add('b-modal-lock');
    overlay.classList.add('is-visible');
    void overlay.offsetWidth;
    // 從開框到關掉，對話框高度都不變（user 2026-10-13：換到取名、新增中都不要改高度）：開框當下（還沒畫出來）
    // 把每一步輪流擺上去量，取最高的當對話框最小高度；內容區撐滿並垂直置中（style.css .pair-dlg），
    // 沒有按鈕列的步驟（新增中／已新增）內容一樣在中間。量完回到第一步
    {
      let h = 0;
      const measure = () => { h = Math.max(h, modal.offsetHeight); };
      show('name', '為這台機器命名', nameDesc({ model: '—', currentSite: '揚昇高爾夫球場' })); measure();
      show('code', '新增機器', existsDesc('一樓大廳展示機')); measure(); // 號碼這一步說明變兩行（已在清單中）也不長高
      show('busy', '正在新增', '正在連線到機器，請稍候…'); measure();
      show('slow', '已新增「一樓大廳」', '機器尚未連線，請確認機器已開機並連上網路，連線後清單會顯示「在線」。'); measure();
      show('code', '新增機器', codeHint); measure();
      modal.style.minHeight = h + 'px';
    }
    overlay.classList.add('is-open');
    setTimeout(() => boxes[0].focus(), 0);
  });
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
      '<p>勾選機器後按一下「下一步」選擇共用版面，再按一下「完成」，這些機器就會一起切換到該版面並進入展示模式。</p>' +
      '<p>機器中已有這個版面時會直接切換到該頁，沒有時會先將版面加在現有頁面之後再切換，頁數已滿則無法加入。</p>' +
      '<p>若版面已在後台修改，機器上的該頁會一併更新為目前的版面內容（機器上對該頁所做的修改會被覆蓋），狀況欄會先標示哪些機器將更新。</p>' +
      '<p>按一下「上一步」會保留勾選，中途關閉則不會變更任何機器。</p>' +
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
          timeTd(d.UpdatedAt),
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
          tdText(layout.createdBy || '—', 'device-id-dim'),
          timeTd(layout.updatedAt),
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
          title: '要放棄這次批量調整嗎？', desc: '勾選的機器與版面不會保留，所有機器的展示畫面都不會變更。',
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
/** 一頁畫出來的內容（比對用）：多個大區塊的舊頁面跟編輯器併成一個區塊的新頁面畫起來一樣，不算不同。 */
const pageTreeJson = (blocks) => canonicalJson(blocks && blocks.length === 1 ? blocks[0].node : blocksToNode(blocks || []));

/** 一個版面對這批機器的計畫：每台 action = showing（已在展示）／switch（有這頁，切過去）／add（先加入再切）／
 *  full（頁數滿了加不進去）／unreadable（讀不到設定）；showing/switch 另帶 stale＝機器上那一頁的內容跟版面目前的不同
 *  （版面在後台改過、或機器上那一頁被改過），完成時可選擇更新成版面內容。 */
function planLayoutShow(layout, infos) {
  const srcPages = layout.pages || [];
  const srcPortrait = !layout.screen || layout.screen.h >= layout.screen.w;
  const srcBlocks = pageTreeJson((srcPages[0] || {}).blocks);
  return infos.map((info) => {
    if (!info.cfg) return { ...info, action: 'unreadable' };
    const pages = info.cfg.pages || [];
    const scr = info.cfg.screen;
    const portraitMismatch = (!scr || scr.h >= scr.w) !== srcPortrait;
    const idx = findLayoutPage(pages, layout);
    if (idx >= 0) {
      const stale = pageTreeJson(pages[idx].blocks) !== srcBlocks;
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
    if (!devices.length) return BDialog.alert({ title: '沒有機器', desc: '此帳號目前沒有任何機器。' });
    if (!(await ensureSharedLoaded())) return;
  } finally { btn.disabled = false; }
  const layouts = (shared.layouts || []).filter((l) => l.pages && l.pages.length);
  if (!layouts.length) return BDialog.alert({ title: '沒有版面', desc: '請先在「共用設定 › 版面設定」新增版面，再進行展示。' });

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
  // 紅框卡（#C30F16）、列＝左粗體標題＋標題旁 ? 說明（2026-09-14 user 指示：灰字說明收進問號）／右淺底外框紅字鈕
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
    text.className = 'dz-text card-title-wrap'; // 同設定卡：標題＋問號 hover 展開說明
    text.innerHTML = '<span class="dz-title">刪除這台機器</span>' +
      '<div class="b-pop page-help"><button type="button" class="page-help-btn" data-pop aria-label="說明"><i data-lucide="circle-help"></i></button>' +
      '<div class="b-pop-panel page-help-panel"><p class="b-pop-panel-title">說明</p>' +
      `<p>從後台移除「${esc(curDevName())}」並停止同步。</p>` +
      '<p>機器端的連線資料會一併清除，需在機器上重新配對才能再次連線。</p></div></div>';
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
          desc: '機器會從後台移除並停止同步，畫面仍會照常播放。\n' +
            '機器端的連線資料會一併清除，之後需在機器上重新配對才能再次連線。\n' +
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
    : '一般帳號可管理所有機器，但無法使用帳號管理。';
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
      title: '有尚未送出的內容', desc: '要捨棄已輸入的內容嗎？', variant: 'danger', confirmText: '捨棄',
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
let versionPollBusy = false; // 上一輪還沒回來就不再發（伺服器慢時不能堆一排 /version 請求；2026-09-15）
setInterval(async () => {
  if (!token || !state || dirty || !deviceId || versionPollBusy) return;
  if (!$('wsModal').classList.contains('is-visible')) return;
  versionPollBusy = true;
  try {
    const r = await api('GET', `/api/config/${encodeURIComponent(deviceId)}/version`);
    if (r.version === state.version) return;
    const keepPage = pageIndex, keepSel = selected;
    state = await api('GET', `/api/config/${encodeURIComponent(deviceId)}`);
    pageIndex = Math.min(keepPage, state.config.pages.length - 1);
    // 選取用 path 指格子：新版本那一頁還是多個大區塊（render 時才併）就不留選取，免得指到別格
    selected = keepSel && page() && (page().blocks || []).length === 1 && getCell(keepSel) ? keepSel : null;
    render();
    setStatus(`「${curDevName()}」有新的變更，已自動更新。`);
  } catch { /* 網路暫時異常就等下一輪 */ } finally { versionPollBusy = false; }
}, 5000);

// ---------- 啟動 ----------
(token ? enterMain().catch(showLogin) : Promise.resolve(showLogin()));

/**
 * 園區資訊格的標題＋「點我查看」按鈕預覽，與 App `ParkCellOverlay` 同一套規則：
 * 橫條（寬/高 ≥ 1.2）＝標題靠左、按鈕靠右；直的格子＝標題（40sp 上限）置中在上、按鈕貼底填滿寬度留邊。
 * 字級上限 28sp，格子太窄或太矮時等比縮小（橫：min(w/600, h/90)，直：min(w/300, h/220)）。
 * 機器上 1px ≈ 1dp，所以用實際格子像素算，再換成預覽的 cqw。
 */
/** 角落徽章預覽：右上角「輕觸」小記號，尺寸依格子真實像素縮放（play.js renderHintBadge 同一套），用 cqw 換算 */
function renderHintBadge(el, cell, sizePx) {
  const w = sizePx && sizePx.w ? sizePx.w : 1080;
  const h = sizePx && sizePx.h ? sizePx.h : 200;
  const s = Math.max(0.55, Math.min(w / 520, h / 180, 1));
  const u = (px) => `${(px * s * 100 / canvasScreenW).toFixed(3)}cqw`;
  const b = document.createElement('div');
  b.className = 'pv-hint-badge';
  b.style.cssText = `font-size:${u(20)};padding:${u(8)} ${u(14)} ${u(8)} ${u(10)};margin:${u(12)}`;
  b.innerHTML = `<span class="material-icons" style="font-size:${u(24)}">touch_app</span>輕觸`;
  el.appendChild(b);
}
function renderParkOverlay(el, cell, sizePx, fg) {
  const w = sizePx && sizePx.w ? sizePx.w : 1080;
  const h = sizePx && sizePx.h ? sizePx.h : 200;
  // 提示樣式＝按鈕的格子才有按鈕（園區資訊預設按鈕、其他預設角落徽章）
  const ctaLabel = liveHintOf(cell) === 'Button' ? ctaLabelOf(cell) : null;
  const cta = !!ctaLabel;
  const vertical = cta && (cell.parkLayout === 'Vertical' || (cell.parkLayout !== 'Horizontal' && w / h < 2.0));
  const s = vertical
    ? Math.max(0.5, Math.min(w / 300, h / 220, 1))
    : Math.max(0.4, Math.min(w / 600, h / 90, 1));
  const u = (px) => `${(px * s * 100 / canvasScreenW).toFixed(3)}cqw`;
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
