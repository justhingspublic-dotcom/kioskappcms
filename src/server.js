// ENV_FILE（2026-09-10）：本機要同時跑第二個站台（例：sunrise 用 .env.sunrise）時指定別的設定檔；沒設＝.env
require('dotenv').config({ path: process.env.ENV_FILE || undefined });
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const swaggerUiDist = require('swagger-ui-dist');
const db = require('./db');
const log = require('./log');
const audit = require('./audit');
const events = require('./events');

const PORT = Number(process.env.PORT || 3000);
// 子路徑（2026-09-08）：正式站掛在 /joye（https://justdisplay.justhings.com.tw/joye），
// 根網址留給未來各後台的統一入口。留空＝掛在根（開發機）。所有路由照舊寫根路徑，由下方 root 掛載。
const BASE_PATH = String(process.env.BASE_PATH || '').trim().replace(/\/+$/, '').replace(/^(?=[^/])/, '/').replace(/^\/$/, '');
const DEVICE_KEY = process.env.DEVICE_KEY;
// 站台品牌（2026-09-10，第二個場域 sunrise 起同一份程式碼跑多個站台）：
// SITE_NAME＝客戶名稱（後台標題、登入頁、根入口卡片）；SITE_LOGO＝登入頁橫式 logo（public/ 底下的相對路徑，
// 留空＝沒有客戶 logo，登入頁改顯示公司 J 標＋客戶名稱）。沒設＝卓也小屋（正式站 .env 不用改）。
const SITE_NAME = (process.env.SITE_NAME || '卓也小屋').trim();
const SITE_LOGO = process.env.SITE_LOGO === undefined ? 'img/joye-logo.png' : process.env.SITE_LOGO.trim();
// SITE_LOGO_SHAPE（2026-09-10）：wide＝橫式（卓也 250×89）、square＝方形（揚昇 300×300）；決定登入頁 logo 框的形狀
const SITE_LOGO_SHAPE = process.env.SITE_LOGO_SHAPE === 'square' ? 'square' : 'wide';
// PARK_API_URL（2026-09-10 user 指示：揚昇不要預填卓也的 API）：這個站台的園區測站 API，後台切到「園區測站」／
// 點擊動作「園區資訊」時預填、播放頁園區資訊頁留白時使用；沒設＝不預填、園區資訊頁只當導覽圖。joye 的 .env 設卓也那支。
const PARK_API = (process.env.PARK_API_URL || '').trim();
// SITE_THEME（2026-09-10）：站台主題色檔 public/themes/<名稱>.css，接在 style.css 之後只換 brand 家族
// （sunrise＝綠 #2E6F40）。沒設＝style.css 預設的藍（joye）。名稱只准小寫英數與 -，檔案不存在就當沒設並警告。
const SITE_THEME = (process.env.SITE_THEME || '').trim();
// 播放頁預設機器名（2026-09-10）：網址沒帶 ?device= 時用這個名字登錄。所有沒有 App 的螢幕開同一個網址＝同一台機器、
// 同一畫面（user 2026-09-10：網頁版不需要每面螢幕不同網址）；要讓某面螢幕不同，第一次開時帶 ?device=名字即可。
const PLAY_DEFAULT_DEVICE = (process.env.PLAY_DEFAULT_DEVICE || '').trim().slice(0, 64);
if (SITE_THEME && !(/^[a-z0-9-]+$/.test(SITE_THEME) && fs.existsSync(path.join(__dirname, '..', 'public', 'themes', SITE_THEME + '.css')))) {
  log.warn('sys', `SITE_THEME=${SITE_THEME} 找不到 public/themes/${SITE_THEME}.css，改用預設主題`);
}
const SITE_THEME_LINK = SITE_THEME && fs.existsSync(path.join(__dirname, '..', 'public', 'themes', SITE_THEME + '.css'))
  ? `<link rel="stylesheet" href="themes/${SITE_THEME}.css">` : '';
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 上傳檔資料夾（2026-09-08）：可用 .env 的 UPLOAD_DIR 指到別處。開發機把它指到正式站的 uploads 網路共用，
// 因為開發機與正式站共用同一個資料庫、設定裡的 /files/ 路徑兩邊都看得到，圖片檔卻各存一份——
// 機器在測試站上傳的圖切回正式站就 404（user 回報）。共用同一個資料夾後檔案只有一份，兩邊都找得到。
// 沒設＝原本的 ../uploads（正式站）。
const UPLOAD_DIR = (process.env.UPLOAD_DIR || '').trim() || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
// 正式站前面是 IIS ARR 反向代理：信任本機代理帶的 X-Forwarded-For，log／操作紀錄才記得到真正的來源 IP
app.set('trust proxy', 'loopback');

// API 回應一律不准快取（2026-09-08）：正式站前面的 IIS ARR 反向代理會把沒有 Cache-Control 的 GET 回應
// 快取起來，機器問 /version 拿到舊版本號，網頁發布後要等快取過期才同步，還會讓 /wait 迴圈空轉。
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
// DB 還沒連上（啟動中或公司 DB 斷線）：API 一律回 503＋中文訊息，網頁照常載入。
app.use('/api', (_req, res, next) => {
  if (!db.isReady()) return res.status(503).json({ error: '正在連接資料庫。請稍候再試一次。' });
  next();
});

// 請求日誌（2026-09-10 改走 src/log.js）：每個請求配一個短 id（回在 X-Request-Id、500 回應的 detail 也帶），
// 使用者回報「畫面出錯」時拿 id 就能直接對到 log 那一行。只記 /api（靜態檔不記），長輪詢 /wait 正常回應不記，
// 4xx 記 warn、5xx 記 error；附耗時與是誰（登入帳號／機器編號）。
app.use((req, res, next) => {
  req.id = crypto.randomBytes(4).toString('hex');
  res.set('X-Request-Id', req.id);
  if (!req.path.startsWith('/api')) return next();
  const t0 = Date.now();
  const reqPath = req.path; // 進場時先記：從掛在 app.use('/api/xxx/:id') 的中介層直接回應時，結束當下的 req.path 只剩相對路徑
  res.on('finish', () => {
    const st = res.statusCode;
    if (reqPath.endsWith('/wait') && st < 400) return;
    // 401（沒登入就開頁面）與 404（機器還沒有設定）都是正常流程，不算警告
    const level = st >= 500 ? 'error' : st >= 400 && st !== 401 && st !== 404 ? 'warn' : 'info';
    log[level]('http', `${req.method} ${reqPath} ${st} ${Date.now() - t0}ms`, { ...actorOf(req, reqPath), rid: req.id });
  });
  next();
});
/** log 用：這個請求是誰發的（登入帳號或機器編號）。 */
function actorOf(req, path = req.path) {
  const u = req.user || currentUser(req);
  if (u) return { user: u.username };
  const m = path.match(/^\/api\/(?:config|devices)\/([^/]+)/);
  if (m && req.get('X-Device-Key')) return { device: decodeURIComponent(m[1]) };
  return {};
}
// JSON 解析放在請求日誌之後：壞 JSON 的請求才會有 id、也才記得到那一行
app.use(express.json({ limit: '10mb' }));

// 機器「最後露面時間」：帶 Device Key 的 config 請求（含掛 /wait）都算，
// 供機器總覽顯示在線/離線。記憶體秒級精準；另外每台最多每分鐘寫一次 DB
// （LastSeenAt／LastServerUrl／LastAppVersion，機器用 X-Device-Server／X-App-Version 標頭自報），
// 讓伺服器重啟後仍有最後露面時間，也讓共用同一個 DB 的正式站看得出機器其實連在哪一台伺服器。
// 金鑰錯的請求（帶了 X-Device-Key 但不對）同樣節流記 LastKeyMismatchAt，總覽才能提示「金鑰不符」。
const deviceLastSeen = new Map(); // deviceId -> epoch ms
const deviceDbWriteAt = new Map(); // 'ok:'|'bad:' + deviceId -> 上次寫 DB 的 epoch ms（節流）
const DEVICE_DB_WRITE_MS = 60_000;
function noteDevice(deviceId, req, keyOk) {
  const now = Date.now();
  if (keyOk) deviceLastSeen.set(deviceId, now);
  const k = (keyOk ? 'ok:' : 'bad:') + deviceId;
  if (now - (deviceDbWriteAt.get(k) || 0) < DEVICE_DB_WRITE_MS) return;
  deviceDbWriteAt.set(k, now);
  if (!keyOk) log.warn('device', '機器帶的金鑰不符', { device: deviceId, ip: req.ip });
  const q = db.getPool().request().input('id', db.sql.NVarChar(64), deviceId);
  const p = keyOk
    ? q.input('url', db.sql.NVarChar(256), String(req.get('X-Device-Server') || '').slice(0, 256) || null)
        .input('ver', db.sql.NVarChar(32), String(req.get('X-App-Version') || '').slice(0, 32) || null)
        .query(`UPDATE dbo.KioskConfig SET LastSeenAt = SYSUTCDATETIME(),
                LastServerUrl = COALESCE(@url, LastServerUrl), LastAppVersion = COALESCE(@ver, LastAppVersion)
                WHERE DeviceId = @id`)
    : q.query('UPDATE dbo.KioskConfig SET LastKeyMismatchAt = SYSUTCDATETIME() WHERE DeviceId = @id');
  p.catch((e) => log.warn('device', `機器露面紀錄寫入失敗：${e.message}`, { device: deviceId }));
}
app.use((req, _res, next) => {
  const m = req.path.match(/^\/api\/(?:config|devices)\/([^/]+)/); // 機器事件上傳（/api/devices/:id/events）也算露面
  if (m && req.get('X-Device-Key')) noteDevice(decodeURIComponent(m[1]), req, isDevice(req));
  next();
});

/** 這個後台自己的對外位址：.env 的 PUBLIC_URL，沒設就用這次請求的 host 推算。 */
function thisServerUrl(req) {
  // 沒設 PUBLIC_URL 時要把子路徑接上（本機測試站掛 /sunrise 時，機器要填的是 …:3178/sunrise）
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}${BASE_PATH}`).replace(/\/+$/, '');
}
/** 位址比對用：去頭尾空白與結尾斜線、協定與主機名不分大小寫。 */
function normalizeServerUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '').replace(/^(https?:\/\/[^/]+)/i, (m) => m.toLowerCase());
}

// 後台已刪除的機器（KioskDeviceRemoved）：機器帶 key 再連上一律回 410，機器收到會自己清空連線設定並關閉同步。
// 機器重新輸入位址/編號/金鑰後第一次連線會帶 X-Device-Fresh: 1，這時才劃掉紀錄放行（等同全新機器加入）。
app.use(['/api/config/:deviceId', '/api/devices/:deviceId'], async (req, res, next) => {
  if (!isDevice(req)) return next();
  try {
    const q = () => db.getPool().request().input('id', db.sql.NVarChar(64), req.params.deviceId);
    const r = await q().query('SELECT 1 AS x FROM dbo.KioskDeviceRemoved WHERE DeviceId = @id');
    if (!r.recordset.length) return next();
    if (req.get('X-Device-Fresh') === '1') {
      await q().query('DELETE FROM dbo.KioskDeviceRemoved WHERE DeviceId = @id');
      return next();
    }
    res.status(410).json({ error: '這台機器已從後台移除。', removed: true });
  } catch (e) { next(e); }
});

// ---- 密碼雜湊（scrypt + 隨機 salt，格式 "salt:hash"）----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(pw, salt, 32);
  const want = Buffer.from(hash, 'hex');
  return calc.length === want.length && crypto.timingSafeEqual(calc, want);
}

// ---- 登入權杖（記憶體保存，重啟後需重新登入）----
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const tokens = new Map(); // token -> { userId, username, isAdmin, expiry }
// 登入工作階段存 DB（2026-09-10）：以前只在記憶體，每次部署重啟全部作廢、所有人被登出（user 反映）。
// 現在登入時寫 KioskSession，啟動連上 DB 後整批載回；登出／刪帳號／過期時刪。Map 仍是查詢用的快取（currentUser 同步）。
function saveSession(token, userId, expiry) {
  return db.getPool().request()
    .input('t', db.sql.NVarChar(64), token).input('u', db.sql.NVarChar(64), userId).input('e', db.sql.DateTime2, new Date(expiry))
    .query('INSERT INTO dbo.KioskSession (Token, UserId, ExpiresAt) VALUES (@t, @u, @e)')
    .catch((e) => log.warn('auth', `登入工作階段寫入失敗（重啟後要重新登入）：${e.message}`));
}
function dropSession(token) {
  tokens.delete(token);
  return db.getPool().request().input('t', db.sql.NVarChar(64), token)
    .query('DELETE FROM dbo.KioskSession WHERE Token = @t')
    .catch((e) => log.warn('auth', `登入工作階段刪除失敗：${e.message}`));
}
async function loadSessions() {
  await db.getPool().request().query('DELETE FROM dbo.KioskSession WHERE ExpiresAt < SYSUTCDATETIME()');
  const r = await db.getPool().request().query(
    'SELECT s.Token, s.UserId, s.ExpiresAt, u.Username, u.IsAdmin FROM dbo.KioskSession s JOIN dbo.KioskUser u ON u.UserId = s.UserId');
  for (const row of r.recordset) {
    tokens.set(row.Token, { userId: row.UserId, username: row.Username, isAdmin: !!row.IsAdmin, expiry: new Date(row.ExpiresAt).getTime() });
  }
  log.info('auth', `載回 ${r.recordset.length} 個登入工作階段（重啟不需要重新登入）`);
}
function pruneSessions() {
  db.getPool().request().query('DELETE FROM dbo.KioskSession WHERE ExpiresAt < SYSUTCDATETIME()')
    .catch((e) => log.warn('auth', `過期登入工作階段清理失敗：${e.message}`));
}

function currentUser(req) {
  const auth = req.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const s = tokens.get(token);
  if (!s) return null;
  if (Date.now() > s.expiry) { tokens.delete(token); return null; }
  return s;
}
function isDevice(req) {
  return DEVICE_KEY && req.get('X-Device-Key') === DEVICE_KEY;
}
function requireUser(req, res, next) {
  req.user = currentUser(req);
  if (req.user) return next();
  res.status(401).json({ error: '登入已過期。請重新登入。' });
}
function requireAdmin(req, res, next) {
  req.user = currentUser(req);
  if (req.user?.isAdmin) return next();
  res.status(403).json({ error: '這項操作需要管理員權限。' });
}

/** 該登入者能否操作這台機器。權限模型（2026-09-07 user 定案）只分兩級：
 *  管理員＝多「帳號管理」；一般＝看得到、改得動全部機器。
 *  OwnerUserId 欄位與分配 API 保留（未來要做「只看自己的」再啟用），目前不做過濾。 */
async function canAccessDevice(user, _deviceId) {
  return !!user;
}

// 主管理員帳號：首次啟動自動建立；不能刪、不能降級（避免鎖死後台），帳號管理只能改它的名稱。
const SEED_ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

// ---- 首次啟動：沒有任何帳號時，自動建立管理員 ----
async function seedAdmin() {
  const r = await db.getPool().request().query('SELECT COUNT(*) AS n FROM dbo.KioskUser');
  if (r.recordset[0].n > 0) return;
  const username = SEED_ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error('.env 缺 ADMIN_PASSWORD，無法建立初始管理員');
  await db.getPool().request()
    .input('id', db.sql.NVarChar(64), crypto.randomUUID().replace(/-/g, ''))
    .input('u', db.sql.NVarChar(64), username)
    .input('h', db.sql.NVarChar(256), hashPassword(password))
    .input('n', db.sql.NVarChar(128), '系統管理員')
    .query(`INSERT INTO dbo.KioskUser (UserId, Username, PasswordHash, DisplayName, IsAdmin)
            VALUES (@id, @u, @h, @n, 1)`);
  log.info('sys', `已建立初始管理員帳號：${username}`);
}

// ---- 登入 ----
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const r = await db.getPool().request()
    .input('u', db.sql.NVarChar(64), String(username || ''))
    .query('SELECT UserId, Username, PasswordHash, DisplayName, IsAdmin FROM dbo.KioskUser WHERE Username = @u');
  const row = r.recordset[0];
  if (!row || !verifyPassword(String(password || ''), row.PasswordHash)) {
    const tried = String(username || '').slice(0, 64);
    log.warn('auth', '登入失敗', { user: tried, ip: req.ip, rid: req.id });
    audit.record(req, { actor: { type: 'anonymous', id: null, name: tried }, action: 'login.fail', targetType: 'user', targetName: tried, summary: `用帳號「${tried}」登入失敗` });
    return res.status(401).json({ error: '帳號或密碼不正確。' });
  }
  log.info('auth', '登入成功', { user: row.Username, ip: req.ip, rid: req.id });
  audit.record(req, { actor: { type: 'user', id: row.UserId, name: row.Username }, action: 'login.ok', targetType: 'user', targetId: row.UserId, targetName: row.Username, summary: '登入後台' });
  const token = crypto.randomBytes(24).toString('hex');
  const expiry = Date.now() + TOKEN_TTL_MS;
  tokens.set(token, { userId: row.UserId, username: row.Username, isAdmin: !!row.IsAdmin, expiry });
  await saveSession(token, row.UserId, expiry);
  res.json({ token, user: { username: row.Username, displayName: row.DisplayName, isAdmin: !!row.IsAdmin } });
});

// ---- 登出（2026-09-10）：把 token 從記憶體與 DB 拿掉；網頁登出鈕呼叫，沒呼叫到也只是留到 12 小時過期 ----
app.post('/api/logout', requireUser, async (req, res) => {
  const auth = req.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) await dropSession(token);
  res.json({ ok: true });
});

// ---- 重啟後台（限管理員；2026-09-08）----
// 正式站由 run.cmd 迴圈拉起 Node，程序一結束 5 秒內就重拉。部署蓋完檔案後呼叫這支即可，不必登入伺服器砍程序。
app.post('/api/restart', requireAdmin, async (req, res) => {
  log.info('sys', '收到重啟要求，0.5 秒後結束程序，由 run.cmd 重拉', { user: req.user.username });
  await audit.record(req, { action: 'sys.restart', targetType: 'server', summary: '重啟後台' }); // 等寫完再結束程序
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 500);
});

// 每次都從 DB 讀：名稱／權限被別的管理員改了，重整就看到（token 只當登入憑證）
app.get('/api/me', requireUser, async (req, res) => {
  const r = await db.getPool().request()
    .input('id', db.sql.NVarChar(64), req.user.userId)
    .query('SELECT Username, DisplayName, IsAdmin FROM dbo.KioskUser WHERE UserId = @id');
  const row = r.recordset[0];
  if (!row) return res.status(401).json({ error: '登入已過期。請重新登入。' });
  req.user.isAdmin = !!row.IsAdmin;
  res.json({ username: row.Username, displayName: row.DisplayName || '', isAdmin: !!row.IsAdmin });
});

/** 機器連線資訊（側欄底部卡片）：所有登入者都可看，方便在機器上抄填。
 *  位址優先用 .env 的 PUBLIC_URL（對外上線時填），否則以這次請求的 host 推算。金鑰唯讀，更換仍走 .env。 */
app.get('/api/connection-info', requireUser, (req, res) => {
  res.json({ serverUrl: thisServerUrl(req), deviceKey: DEVICE_KEY || '', playDefaultDevice: PLAY_DEFAULT_DEVICE, parkApi: PARK_API });
});

// ---- 帳號管理（限管理員）----
app.get('/api/users', requireAdmin, async (req, res) => {
  const r = await db.getPool().request().query(`
    SELECT u.UserId, u.Username, u.DisplayName, u.IsAdmin, u.CreatedAt
    FROM dbo.KioskUser u ORDER BY u.CreatedAt`);
  // IsPrimary＝主管理員（不能刪、不能改權限）；IsMe＝目前登入者（不能刪自己、不能改自己權限）
  res.json(r.recordset.map((u) => ({
    ...u, IsPrimary: u.Username === SEED_ADMIN_USERNAME, IsMe: u.UserId === req.user.userId,
  })));
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, displayName, isAdmin } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '請填寫帳號和密碼。' });
  // U+FFFD＝上游編碼壞掉的替換字元（如用非 UTF-8 terminal 打 API），擋下避免存進壞資料
  if (/�/.test(String(username) + String(displayName || ''))) {
    return res.status(400).json({ error: '名稱含無效字元（來源編碼問題），請改用網頁介面輸入' });
  }
  try {
    const id = crypto.randomUUID().replace(/-/g, '');
    await db.getPool().request()
      .input('id', db.sql.NVarChar(64), id)
      .input('u', db.sql.NVarChar(64), String(username))
      .input('h', db.sql.NVarChar(256), hashPassword(String(password)))
      .input('n', db.sql.NVarChar(128), displayName || null)
      .input('a', db.sql.Bit, isAdmin ? 1 : 0)
      .query(`INSERT INTO dbo.KioskUser (UserId, Username, PasswordHash, DisplayName, IsAdmin)
              VALUES (@id, @u, @h, @n, @a)`);
    audit.record(req, { action: 'user.create', targetType: 'user', targetId: id, targetName: String(username), summary: `新增帳號「${username}」${isAdmin ? '（管理員）' : ''}` });
    res.json({ userId: id });
  } catch (e) {
    if (/UNIQUE|duplicate/i.test(e.message)) return res.status(409).json({ error: '這個帳號名稱已被使用。' });
    throw e;
  }
});

// 編輯帳號（2026-09-07：帳號管理「編輯」＝名稱＋權限一次改）。
// body 帶哪個欄位就改哪個；主管理員與自己的權限不能改。
app.put('/api/users/:userId', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const sets = [];
  const q = db.getPool().request().input('id', db.sql.NVarChar(64), req.params.userId);
  const target = (await db.getPool().request().input('id', db.sql.NVarChar(64), req.params.userId)
    .query('SELECT Username, DisplayName, IsAdmin FROM dbo.KioskUser WHERE UserId = @id')).recordset[0];
  if (!target) return res.status(404).json({ error: '這個帳號已不存在。' });
  if (body.displayName !== undefined) {
    const displayName = String(body.displayName ?? '').trim();
    if (/\uFFFD/.test(displayName)) {
      return res.status(400).json({ error: '名稱含無效字元（來源編碼問題），請改用網頁介面輸入' });
    }
    q.input('n', db.sql.NVarChar(128), displayName.slice(0, 128) || null);
    sets.push('DisplayName = @n');
  }
  if (body.isAdmin !== undefined) {
    if (req.params.userId === req.user.userId) return res.status(400).json({ error: '無法變更目前登入帳號的權限。' });
    if (target.Username === SEED_ADMIN_USERNAME) return res.status(400).json({ error: '無法變更主管理員的權限。' });
    q.input('a', db.sql.Bit, body.isAdmin ? 1 : 0);
    sets.push('IsAdmin = @a');
  }
  if (!sets.length) return res.status(400).json({ error: '要求的格式不正確。' });
  const r = await q.query(`UPDATE dbo.KioskUser SET ${sets.join(', ')} WHERE UserId = @id`);
  if (!r.rowsAffected[0]) return res.status(404).json({ error: '這個帳號已不存在。' });
  // 該帳號若已登入，讓它的 token 立刻反映新權限
  if (body.isAdmin !== undefined) {
    for (const s of tokens.values()) if (s.userId === req.params.userId) s.isAdmin = !!body.isAdmin;
  }
  const changes = [];
  if (body.displayName !== undefined) {
    const nn = String(body.displayName ?? '').trim().slice(0, 128);
    if (nn !== (target.DisplayName || '')) changes.push(`名稱「${target.DisplayName || ''}」改為「${nn}」`);
  }
  if (body.isAdmin !== undefined && !!body.isAdmin !== !!target.IsAdmin) changes.push(body.isAdmin ? '設為管理員' : '改為一般帳號');
  if (changes.length) {
    audit.record(req, { action: 'user.update', targetType: 'user', targetId: req.params.userId, targetName: target.Username, summary: `修改帳號「${target.Username}」：${changes.join('、')}` });
  }
  res.json({ ok: true });
});

app.delete('/api/users/:userId', requireAdmin, async (req, res) => {
  if (req.params.userId === req.user.userId) return res.status(400).json({ error: '這是目前登入的帳號。' });
  const t = await db.getPool().request().input('id', db.sql.NVarChar(64), req.params.userId)
    .query('SELECT Username FROM dbo.KioskUser WHERE UserId = @id');
  if (t.recordset[0]?.Username === SEED_ADMIN_USERNAME) return res.status(400).json({ error: '主管理員無法刪除。' });
  await db.getPool().request()
    .input('id', db.sql.NVarChar(64), req.params.userId)
    .query(`UPDATE dbo.KioskConfig SET OwnerUserId = NULL WHERE OwnerUserId = @id;
            DELETE FROM dbo.KioskSession WHERE UserId = @id;
            DELETE FROM dbo.KioskUser WHERE UserId = @id;`);
  // 被刪的帳號若還登入著，token 立刻失效（以前只靠 12 小時過期）
  for (const [t, s] of tokens) if (s.userId === req.params.userId) tokens.delete(t);
  const deletedName = t.recordset[0]?.Username || req.params.userId;
  audit.record(req, { action: 'user.delete', targetType: 'user', targetId: req.params.userId, targetName: deletedName, summary: `刪除帳號「${deletedName}」` });
  res.json({ ok: true });
});

// 把機器分配給某個帳號（userId 傳 null = 收回為未分配）
app.put('/api/devices/:deviceId/owner', requireAdmin, async (req, res) => {
  await db.getPool().request()
    .input('id', db.sql.NVarChar(64), req.params.deviceId)
    .input('owner', db.sql.NVarChar(64), req.body?.userId || null)
    .query('UPDATE dbo.KioskConfig SET OwnerUserId = @owner WHERE DeviceId = @id');
  audit.record(req, { action: 'device.owner', targetType: 'device', targetId: req.params.deviceId, summary: `把機器「${req.params.deviceId}」${req.body?.userId ? '分配給帳號 ' + req.body.userId : '收回為未分配'}` });
  res.json({ ok: true });
});

// ---- 刪除機器（限管理員）----
// 刪掉設定列並記進 KioskDeviceRemoved；叫醒掛在 /wait 的機器，它下一個請求就會收到 410 而自己清空連線設定。
app.delete('/api/devices/:deviceId', requireAdmin, async (req, res) => {
  const named = (await db.getPool().request().input('id', db.sql.NVarChar(64), req.params.deviceId)
    .query('SELECT DeviceName FROM dbo.KioskConfig WHERE DeviceId = @id')).recordset[0];
  await db.getPool().request()
    .input('id', db.sql.NVarChar(64), req.params.deviceId)
    .query(`DELETE FROM dbo.KioskConfig WHERE DeviceId = @id;
            IF NOT EXISTS (SELECT 1 FROM dbo.KioskDeviceRemoved WHERE DeviceId = @id)
              INSERT INTO dbo.KioskDeviceRemoved (DeviceId) VALUES (@id);`);
  deviceLastSeen.delete(req.params.deviceId);
  notifyWaiters(req.params.deviceId, 0);
  const delName = named?.DeviceName || req.params.deviceId;
  audit.record(req, { action: 'device.delete', targetType: 'device', targetId: req.params.deviceId, targetName: delName, summary: `刪除機器「${delName}」${named?.DeviceName ? `（${req.params.deviceId}）` : ''}` });
  res.json({ ok: true });
});

// ---- 機器清單（管理員看全部；一般帳號只看自己的）----
/** 機器列表用的精簡摘要：screen 與 activePage 那一頁（只留 blocks），供列縮圖；壞 JSON 回空。 */
function summarizeForList(configJson) {
  try {
    const cfg = JSON.parse(configJson || '{}');
    const pages = Array.isArray(cfg.pages) ? cfg.pages : [];
    const idx = Number.isInteger(cfg.activePage) && cfg.activePage >= 0 && cfg.activePage < pages.length ? cfg.activePage : 0;
    const pg = pages[idx];
    return {
      Screen: cfg.screen && cfg.screen.w > 0 && cfg.screen.h > 0 ? { w: cfg.screen.w, h: cfg.screen.h } : null,
      PageCount: pages.length,
      ActivePage: pg ? { name: pg.name || '', blocks: pg.blocks || [] } : null,
    };
  } catch { return { Screen: null, PageCount: 0, ActivePage: null }; }
}

// 所有登入者都看得到全部機器（一般／管理員只差「帳號管理」，見 canAccessDevice 註解）
app.get('/api/devices', requireUser, async (req, res) => {
  const r = await db.getPool().request().query(`
    SELECT c.DeviceId, c.DeviceName, c.Version, c.UpdatedAt, c.OwnerUserId, u.Username AS OwnerName, c.ConfigJson,
           c.LastSeenAt, c.LastServerUrl, c.LastAppVersion, c.LastKeyMismatchAt
    FROM dbo.KioskConfig c LEFT JOIN dbo.KioskUser u ON u.UserId = c.OwnerUserId
    ORDER BY c.DeviceId`);
  const mine = normalizeServerUrl(thisServerUrl(req));
  res.json(r.recordset.map(({ ConfigJson, LastSeenAt, LastServerUrl, LastAppVersion, LastKeyMismatchAt, ...row }) => {
    // 露面時間：記憶體有就用（秒級）；伺服器重啟後改用 DB 的 LastSeenAt（分鐘級，機器連在別台伺服器時也只有這個）
    const memAt = deviceLastSeen.get(row.DeviceId);
    const dbAt = LastSeenAt ? new Date(LastSeenAt).getTime() : null;
    const seenAt = memAt || dbAt;
    // 金鑰不符：最近一次金鑰錯誤比最近一次成功露面還新，才算「現在填的金鑰是錯的」
    const badAt = LastKeyMismatchAt ? new Date(LastKeyMismatchAt).getTime() : null;
    const keyMismatch = !!badAt && (!seenAt || badAt > seenAt);
    return {
      ...row,
      // 機器總覽列縮圖用：只帶「目前展示頁」的結構＋螢幕比例（整份 config 不外送，列表輕量）
      ...summarizeForList(ConfigJson),
      LastSeenAgoSec: seenAt ? Math.round((Date.now() - seenAt) / 1000) : null,
      // 機器自報的連線資訊（v1.13 起的 App 才會帶；舊版 App 兩者皆 null）
      LastServerUrl: LastServerUrl || null,
      LastAppVersion: LastAppVersion || null,
      // 機器填的伺服器位址是不是這個後台：true／false；null＝機器還沒回報過位址
      ServerMatch: LastServerUrl ? normalizeServerUrl(LastServerUrl) === mine : null,
      KeyMismatch: keyMismatch,
      LastKeyMismatchAt: LastKeyMismatchAt || null,
    };
  }));
});

// ---- 版本號 ----
async function readVersion(deviceId) {
  const r = await db.getPool().request()
    .input('id', db.sql.NVarChar(64), deviceId)
    .query('SELECT Version FROM dbo.KioskConfig WHERE DeviceId = @id');
  return r.recordset[0]?.Version ?? 0;
}

app.get('/api/config/:deviceId/version', async (req, res) => {
  if (!isDevice(req) && !currentUser(req)) return res.status(401).json({ error: '登入已過期。請重新登入。' });
  res.json({ version: await readVersion(req.params.deviceId) });
});

// ---- 長輪詢：kiosk 掛在這支等新版本，網頁一發布立刻回應（最多掛 25 秒）----
const WAIT_HOLD_MS = 25_000;
const waiters = new Map(); // deviceId -> Set<{res, timer}>

function notifyWaiters(deviceId, version) {
  const set = waiters.get(deviceId);
  if (!set) return;
  waiters.delete(deviceId);
  for (const w of set) {
    clearTimeout(w.timer);
    try { w.res.json({ version }); } catch { /* client gone */ }
  }
}

app.get('/api/config/:deviceId/wait', async (req, res) => {
  if (!isDevice(req) && !currentUser(req)) return res.status(401).json({ error: '登入已過期。請重新登入。' });
  const deviceId = req.params.deviceId;
  const since = Number(req.query.version || 0);
  const current = await readVersion(deviceId);
  if (current !== since) return res.json({ version: current });

  const entry = { res };
  const set = waiters.get(deviceId) || new Set();
  set.add(entry);
  waiters.set(deviceId, set);
  const drop = () => { set.delete(entry); if (!set.size) waiters.delete(deviceId); };
  entry.timer = setTimeout(() => { drop(); try { res.json({ version: current }); } catch { /* gone */ } }, WAIT_HOLD_MS);
  req.on('close', () => { clearTimeout(entry.timer); drop(); });
});

// ---- 讀整份設定 ----
app.get('/api/config/:deviceId', async (req, res) => {
  const user = currentUser(req);
  if (!isDevice(req)) {
    if (!user) return res.status(401).json({ error: '登入已過期。請重新登入。' });
    if (!(await canAccessDevice(user, req.params.deviceId))) return res.status(403).json({ error: '你沒有權限管理這台機器。' });
  }
  const r = await db.getPool().request()
    .input('id', db.sql.NVarChar(64), req.params.deviceId)
    .query('SELECT Version, ConfigJson, UpdatedAt FROM dbo.KioskConfig WHERE DeviceId = @id');
  const row = r.recordset[0];
  if (!row) return res.status(404).json({ error: '這台機器還沒有任何設定。' });
  res.json({ version: row.Version, updatedAt: row.UpdatedAt, config: JSON.parse(row.ConfigJson) });
});

// ---- 操作紀錄：PUT config 的中文摘要（2026-09-10）----
// 網頁端的批量動作（加到其他機器、套用設定、展示版面）在伺服器看來都只是 PUT config，
// 所以網頁 body 多帶 reason（字串或 { type, layoutName, mode }）說明這次是什麼動作，這裡照 reason 寫成一句話。
// 機器自報的 PUT 不記（每台每分鐘都有，會洗版）。
const CONFIG_FIELD_NAMES = { pages: '版面', chatApi: '智能客服', sleep: '休眠排程', adminPin: '管理 PIN', activePage: '展示頁', deviceName: '機器名稱', screen: '螢幕尺寸' };
function auditConfigPut(req, { incoming, prevParsed, config, deviceName, version }) {
  const prev = prevParsed || {};
  const name = deviceName || prev.deviceName || req.params.deviceId;
  const raw = req.body?.reason;
  const reason = typeof raw === 'string' ? { type: raw } : (raw && typeof raw === 'object' ? raw : {});
  const changed = Object.keys(incoming).filter((k) => JSON.stringify(config[k]) !== JSON.stringify(prev[k]));
  const names = changed.map((k) => CONFIG_FIELD_NAMES[k] || k);
  const q = (x) => `「${x}」`;
  const pageLabel = (i) => {
    const pg = Array.isArray(config.pages) ? config.pages[i] : null;
    return `第 ${(Number(i) || 0) + 1} 頁${pg && pg.name ? q(pg.name) : ''}`;
  };
  const layoutName = typeof reason.layoutName === 'string' ? reason.layoutName.slice(0, 128) : '';
  let action, summary;
  switch (reason.type) {
    case 'rename': action = 'device.rename'; summary = `把機器${q(prev.deviceName || req.params.deviceId)}更名為${q(name)}`; break;
    case 'switchPage': action = 'config.switchPage'; summary = `把${q(name)}切到${pageLabel(config.activePage)}展示`; break;
    case 'appendLayout': action = 'config.appendLayout'; summary = `把版面${q(layoutName)}加到${q(name)}`; break;
    case 'applySettings': {
      action = 'config.applySettings';
      const which = names.filter((n) => n !== '展示頁');
      summary = `套用共用機器設定到${q(name)}${which.length ? `（${which.join('、')}）` : '（內容相同，沒有變更）'}`; break;
    }
    case 'showLayout': {
      action = 'config.showLayout';
      const how = reason.mode === 'append' ? '新增一頁並切換' : reason.mode === 'update' ? '更新內容並切換' : '切換';
      summary = `讓${q(name)}展示版面${q(layoutName)}（${how}到${pageLabel(config.activePage)}）`; break;
    }
    case 'publish': action = 'config.publish'; summary = `發布${q(name)}的畫面與設定（版本 ${version}）${names.length ? `，更動：${names.join('、')}` : '，內容沒有變更'}`; break;
    default: action = 'config.update'; summary = `更新${q(name)}的設定（版本 ${version}）${names.length ? `，更動：${names.join('、')}` : ''}`;
  }
  audit.record(req, {
    action, summary, targetType: 'device', targetId: req.params.deviceId, targetName: name,
    detail: { version, changed, reason: reason.type || null, layoutName: layoutName || undefined, activePage: changed.includes('activePage') ? config.activePage : undefined },
  });
}

// ---- 存整份設定（網頁存檔，或 kiosk 第一次連線時上傳本機設定當初始值）----
app.put('/api/config/:deviceId', async (req, res) => {
  const user = currentUser(req);
  if (user) req.user = user; // 這條路由沒掛 requireUser，log／操作紀錄要靠 req.user 知道是誰
  if (!isDevice(req)) {
    if (!user) return res.status(401).json({ error: '登入已過期。請重新登入。' });
    if (!(await canAccessDevice(user, req.params.deviceId))) return res.status(403).json({ error: '你沒有權限管理這台機器。' });
  }
  let config = req.body?.config;
  if (!config || typeof config !== 'object') {
    return res.status(400).json({ error: '要求的格式不正確。' });
  }
  // 管理 PIN 限管理員（2026-09-07 定案）：一般帳號送來的 adminPin 直接剝掉，下面的淺合併會沿用舊值
  if (!isDevice(req) && !user.isAdmin) delete config.adminPin;
  // 展示頁來源（2026-09-08 遠端切換展示頁）：這次請求有帶 activePage 才蓋章，記下是網頁指定還是機器自報。
  // 機器拉回設定時只有 'web' 才會照雲端的值切頁（'device' 只是它自己以前上報的舊值，機器以本機為準，避免跳頁）；
  // 機器切完會再上報一次（帶 activePage）把來源翻回 'device'，之後網頁只發布版面不會再把它拉回去。
  const activePageGiven = Number.isInteger(config.activePage);
  const incoming = config; // 這次請求真正帶的欄位（操作紀錄要知道改了哪些）
  let prevParsed = null;
  // 部分更新語意：沒帶的頂層欄位一律沿用舊值（淺合併）。所以——
  // 網頁「儲存並發布」不帶 activePage → 機器不跳頁；舊版存檔不帶 deviceName/chatApi/sleep
  // → 不會洗掉；「複製版面」只帶 pages、「套用共用設定」只帶 chatApi+sleep → 其他都不動。
  {
    const prev = await db.getPool().request()
      .input('id', db.sql.NVarChar(64), req.params.deviceId)
      .query('SELECT ConfigJson FROM dbo.KioskConfig WHERE DeviceId = @id');
    prevParsed = prev.recordset[0] ? JSON.parse(prev.recordset[0].ConfigJson) : null;
    config = Object.assign({}, prevParsed || {}, config);
    if (config.activePage === undefined) config.activePage = 0;
    if (activePageGiven) config.activePageSource = isDevice(req) ? 'device' : 'web';
  }
  // 機器名同步不宜整筆退件 → 靜默剝掉編碼壞字（U+FFFD），剝完全空視同沒名稱
  const rawName =
    typeof config.deviceName === 'string' ? config.deviceName.replace(/�/g, '').trim() : '';
  const deviceName = rawName ? rawName.slice(0, 128) : null;
  // 設定 JSON 裡的名稱也要用清過的（2026-09-08）：之前只清了 DeviceName 欄，JSON 仍存壞字，
  // 機器拉回設定就一路顯示亂碼，網頁再存一次又送回來，怎麼改都改不掉。
  if (typeof config.deviceName === 'string') config.deviceName = deviceName || '';
  const json = JSON.stringify(config);
  const r = await db.getPool().request()
    .input('id', db.sql.NVarChar(64), req.params.deviceId)
    .input('json', db.sql.NVarChar(db.sql.MAX), json)
    .input('name', db.sql.NVarChar(128), deviceName)
    .query(`
      MERGE dbo.KioskConfig AS t
      USING (SELECT @id AS DeviceId) AS s ON t.DeviceId = s.DeviceId
      WHEN MATCHED THEN UPDATE SET Version = t.Version + 1, ConfigJson = @json, DeviceName = @name, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (DeviceId, Version, ConfigJson, DeviceName) VALUES (@id, 1, @json, @name)
      OUTPUT inserted.Version AS Version;
    `);
  const version = r.recordset[0].Version;
  notifyWaiters(req.params.deviceId, version); // 立刻叫醒掛在 /wait 的機器
  if (isDevice(req)) log.debug('device', `機器上傳設定（版本 ${version}）`, { device: req.params.deviceId, keys: Object.keys(incoming).join(','), rid: req.id });
  else auditConfigPut(req, { incoming, prevParsed, config, deviceName, version });
  res.json({ version });
});

// ---- 共用設定（全站一份，2026-09-07 定案：機器是全公司共用，共用版面／機器設定範本也不分帳號）----
// 內容＝版面清單（layouts）＋客服帳號、休眠排程、管理 PIN 的共用範本。
// 「套用／加入機器」由網頁端逐台 PUT config（沿用欄位保留機制），這裡只存範本本身。
// 權限：管理員全可；一般帳號只能改休眠排程（sleep），其餘欄位由伺服器保留現值（版面只能「加入機器」）。
const SHARED_KEY = '_global';

async function readShared() {
  const r = await db.getPool().request()
    .input('id', db.sql.NVarChar(64), SHARED_KEY)
    .query('SELECT SettingsJson, UpdatedAt FROM dbo.KioskSharedSettings WHERE UserId = @id');
  const row = r.recordset[0];
  return row ? { settings: JSON.parse(row.SettingsJson), updatedAt: row.UpdatedAt } : { settings: null, updatedAt: null };
}
async function writeShared(settings) {
  await db.getPool().request()
    .input('id', db.sql.NVarChar(64), SHARED_KEY)
    .input('json', db.sql.NVarChar(db.sql.MAX), JSON.stringify(settings))
    .query(`
      MERGE dbo.KioskSharedSettings AS t
      USING (SELECT @id AS UserId) AS s ON t.UserId = s.UserId
      WHEN MATCHED THEN UPDATE SET SettingsJson = @json, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (UserId, SettingsJson) VALUES (@id, @json);
    `);
}

/** 一次性搬移：舊制每個帳號各一份 → 全站一份。沒有 _global 列時，把所有帳號的版面合併（重新編號、
 *  記下建立者＝原帳號名稱），客服帳號／休眠／PIN 以主管理員那份為準（沒有就取第一份）。舊列保留不刪。 */
async function migrateSharedToGlobal() {
  const pool = db.getPool();
  const exists = await pool.request().input('id', db.sql.NVarChar(64), SHARED_KEY)
    .query('SELECT 1 AS x FROM dbo.KioskSharedSettings WHERE UserId = @id');
  if (exists.recordset.length) return;
  const rows = (await pool.request().query(`
    SELECT s.UserId, s.SettingsJson, s.UpdatedAt, u.Username, u.DisplayName, u.IsAdmin
    FROM dbo.KioskSharedSettings s LEFT JOIN dbo.KioskUser u ON u.UserId = s.UserId
    ORDER BY CASE WHEN u.Username = '${SEED_ADMIN_USERNAME}' THEN 0 WHEN u.IsAdmin = 1 THEN 1 ELSE 2 END, s.UpdatedAt`)).recordset;
  if (!rows.length) return;
  const merged = { layouts: [] };
  let nextId = 1;
  for (const row of rows) {
    let j; try { j = JSON.parse(row.SettingsJson || '{}'); } catch { continue; }
    const who = row.DisplayName || row.Username || '';
    for (const l of j.layouts || []) {
      merged.layouts.push({ ...l, id: nextId++, createdBy: l.createdBy || who, createdAt: l.createdAt || row.UpdatedAt || null });
    }
    for (const k of ['chatApi', 'sleep', 'adminPin']) if (merged[k] === undefined && j[k] !== undefined) merged[k] = j[k];
  }
  await writeShared(merged);
  log.info('db', `共用設定已合併為全站一份（來源 ${rows.length} 個帳號、${merged.layouts.length} 個版面）`);
}

/** 操作紀錄：共用設定 PUT 前後比對（版面新增／更名／修改／刪除、客服／休眠／PIN 範本修改），一件事一筆。 */
function auditSharedPut(req, current, next) {
  const cur = current || {}, nx = next || {};
  const curL = new Map((cur.layouts || []).map((l) => [l.id, l]));
  const nxL = new Map((nx.layouts || []).map((l) => [l.id, l]));
  const q = (x) => `「${x || '未命名版面'}」`;
  for (const [id, l] of nxL) {
    const old = curL.get(id);
    const base = { targetType: 'layout', targetId: String(id), targetName: l.name || '' };
    if (!old) audit.record(req, { action: 'shared.layout.create', summary: `新增共用版面${q(l.name)}`, ...base });
    else if ((old.name || '') !== (l.name || '')) audit.record(req, { action: 'shared.layout.rename', summary: `把共用版面${q(old.name)}更名為${q(l.name)}`, ...base });
    else if (JSON.stringify(old.pages) !== JSON.stringify(l.pages) || JSON.stringify(old.screen) !== JSON.stringify(l.screen)) {
      audit.record(req, { action: 'shared.layout.update', summary: `修改共用版面${q(l.name)}的內容`, ...base });
    }
  }
  for (const [id, l] of curL) {
    if (!nxL.has(id)) audit.record(req, { action: 'shared.layout.delete', summary: `刪除共用版面${q(l.name)}`, targetType: 'layout', targetId: String(id), targetName: l.name || '' });
  }
  const changed = ['chatApi', 'sleep', 'adminPin'].filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(nx[k]));
  if (changed.length) {
    audit.record(req, { action: 'shared.settings.update', targetType: 'shared', targetId: 'settings', summary: `修改共用機器設定：${changed.map((k) => CONFIG_FIELD_NAMES[k]).join('、')}`, detail: { changed } });
  }
}

app.get('/api/shared-settings', requireUser, async (_req, res) => {
  res.json(await readShared());
});

app.put('/api/shared-settings', requireUser, async (req, res) => {
  const incoming = req.body?.settings;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: '要求的格式不正確。' });
  }
  const current = (await readShared()).settings || {};
  let next;
  if (req.user.isAdmin) {
    next = incoming;
    // 建立者由伺服器蓋章（新出現的版面 id，或舊資料沒記的）：用登入者的顯示名稱
    const known = new Map((current.layouts || []).map((l) => [l.id, l]));
    const me = await db.getPool().request().input('id', db.sql.NVarChar(64), req.user.userId)
      .query('SELECT Username, DisplayName FROM dbo.KioskUser WHERE UserId = @id');
    const who = me.recordset[0]?.DisplayName || me.recordset[0]?.Username || req.user.username;
    for (const l of next.layouts || []) {
      const old = known.get(l.id);
      l.createdBy = old?.createdBy || l.createdBy || who;
      l.createdAt = old?.createdAt || l.createdAt || new Date().toISOString();
    }
  } else {
    // 一般帳號：只收休眠排程，其他一律保留現值
    if (!('sleep' in incoming)) return res.status(403).json({ error: '這項操作需要管理員權限。' });
    next = { ...current, sleep: incoming.sleep };
  }
  await writeShared(next);
  auditSharedPut(req, current, next);
  res.json({ ok: true });
});

// ---- 智能客服（JustAI）代理：用機器設定裡的帳號拉客服清單 ----
// 瀏覽器直呼 JustAI 會被 CORS 擋，且帳密已存在 config 裡，由伺服器代打最單純。
app.post('/api/justai/agents', requireUser, async (req, res) => {
  const { baseUrl, email, password } = req.body || {};
  if (!baseUrl || !email || !password) {
    return res.status(400).json({ error: '請填寫智能客服的伺服器位址、Email 和密碼。' });
  }
  const root = String(baseUrl).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(root)) return res.status(400).json({ error: '伺服器位址格式不正確。請以 http:// 或 https:// 開頭。' });
  try {
    const login = await fetch(root + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!login.ok) return res.status(502).json({ error: '無法登入智能客服平台。請檢查帳號和密碼。' });
    const jt = (await login.json()).token;
    const r = await fetch(root + '/api/agents', { headers: { Authorization: 'Bearer ' + jt } });
    if (!r.ok) return res.status(502).json({ error: '智能客服平台目前無法提供客服清單。請稍後再試一次。' });
    const arr = await r.json();
    res.json((Array.isArray(arr) ? arr : []).map((a) => ({
      id: a.id, name: a.name || '', description: a.description || '',
    })));
  } catch (e) {
    log.error('justai', `拉客服清單失敗：${e.message}`, { rid: req.id });
    res.status(502).json({ error: '無法連接智能客服平台。請檢查伺服器位址和網路連線。' });
  }
});

// ---- 圖片/影片上傳（任何登入帳號皆可；檔名隨機 UUID）----
// ---- 園區測站 API 代理（天氣格「園區測站」來源）----
// 後台預覽與測站清單要讀客戶的感測器 API（例：卓也小屋 joyeCloud /api/telemetry/current），
// 對方沒開 CORS，瀏覽器不能直接打；由伺服器代抓並快取 10 秒，多人同時開預覽也只打一次。
const stationCache = new Map(); // url -> { ts, body }
app.get('/api/station/current', requireUserOrDevice, async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!/^https?:\/\/\S+$/.test(url)) {
    return res.status(400).json({ error: '測站 API 網址格式不正確。請以 http:// 或 https:// 開頭。' });
  }
  const hit = stationCache.get(url);
  if (hit && Date.now() - hit.ts < 10_000) return res.type('application/json').send(hit.body);
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(502).json({ error: '測站 API 目前無法回應。請稍後再試一次。' });
    const body = await r.text();
    JSON.parse(body); // 不是 JSON 就當連錯網址
    stationCache.set(url, { ts: Date.now(), body });
    res.type('application/json').send(body);
  } catch (e) {
    log.error('station', `測站代理失敗：${e.message}`, { rid: req.id });
    res.status(502).json({ error: '無法連接測站 API。請檢查網址和網路連線。' });
  }
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 10);
      cb(null, crypto.randomUUID().replace(/-/g, '') + ext);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// 機器（Android 12／13 的 BitmapFactory）解得開的圖片格式。其他圖片（AVIF、HEIC、BMP、TIFF、SVG…）
// 上傳時轉成 JPG（有透明就 PNG）再存：Chrome 看得到 AVIF，後台預覽正常，機器那格卻整塊空白
// （user 2026-09-09 回報「AI 智慧導覽格明明設了圖片背景，機器上沒有」，那張是從 Google 圖片存下來的 .avif）。
const NATIVE_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const CONVERT_IMAGE_EXT = new Set(['.avif', '.heic', '.heif', '.bmp', '.tif', '.tiff', '.svg', '.jxl']);

async function normalizeImage(file) {
  const ext = path.extname(file.filename).toLowerCase();
  const isImage = (file.mimetype || '').startsWith('image/') || CONVERT_IMAGE_EXT.has(ext);
  if (!isImage || NATIVE_IMAGE_EXT.has(ext)) return;
  const src = path.join(UPLOAD_DIR, file.filename);
  const img = sharp(src);
  const meta = await img.metadata();
  const toPng = !!meta.hasAlpha;
  const outName = path.parse(file.filename).name + (toPng ? '.png' : '.jpg');
  const info = await (toPng ? img.png() : img.jpeg({ quality: 92, mozjpeg: true })).toFile(path.join(UPLOAD_DIR, outName));
  try { fs.unlinkSync(src); } catch { /* 原檔留著也無妨 */ }
  file.filename = outName;
  file.mimetype = toPng ? 'image/png' : 'image/jpeg';
  file.size = info.size;
  log.info('upload', `上傳圖片已轉檔：${ext} → ${outName}（${meta.width}×${meta.height}）`);
}

// 網頁登入者或 kiosk 機器（帶 Device Key）都可上傳：機器會把現場選的圖自動傳上來
function requireUserOrDevice(req, res, next) {
  req.user = currentUser(req);
  if (req.user || isDevice(req)) return next();
  res.status(401).json({ error: '登入已過期。請重新登入。' });
}

app.post('/api/upload', requireUserOrDevice, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '沒有選擇檔案。' });
  try {
    await normalizeImage(req.file);
  } catch (e) {
    log.warn('upload', `上傳圖片轉檔失敗：${e.message}`, { ...actorOf(req), rid: req.id });
    try { fs.unlinkSync(path.join(UPLOAD_DIR, req.file.filename)); } catch { /* ignore */ }
    return res.status(400).json({ error: '無法使用這張圖片。機器不支援這種圖片格式，請改成 JPG 或 PNG 再上傳。' });
  }
  const id = path.parse(req.file.filename).name;
  await db.getPool().request()
    .input('id', db.sql.NVarChar(64), id)
    .input('name', db.sql.NVarChar(256), req.file.originalname || null)
    .input('path', db.sql.NVarChar(512), req.file.filename)
    .input('mime', db.sql.NVarChar(128), req.file.mimetype || null)
    .input('size', db.sql.BigInt, req.file.size)
    .query(`INSERT INTO dbo.KioskFile (FileId, OriginalName, StoredPath, MimeType, SizeBytes)
            VALUES (@id, @name, @path, @mime, @size)`);
  audit.record(req, { action: 'file.upload', targetType: 'file', targetId: id, targetName: req.file.originalname || req.file.filename, summary: `上傳檔案「${req.file.originalname || req.file.filename}」（${audit.fmtSize(req.file.size)}）` });
  res.json({ id, url: `/files/${req.file.filename}` });
});

// ---- 機器事件（2026-09-10）：App 定期把本機記的事件批次送上來；後台不做頁面，只存 DB（查詢限管理員）----
app.post('/api/devices/:deviceId/events', async (req, res) => {
  if (!isDevice(req)) return res.status(401).json({ error: '金鑰不正確。' });
  const list = Array.isArray(req.body?.events) ? req.body.events : null;
  if (!list) return res.status(400).json({ error: '要求的格式不正確。' });
  const accepted = await events.insertBatch(req.params.deviceId, list);
  log.debug('events', `收到機器事件 ${accepted} 筆`, { device: req.params.deviceId, rid: req.id });
  res.json({ ok: true, accepted });
});
app.get('/api/devices/:deviceId/events', requireAdmin, async (req, res) => {
  const { limit, before, kind, level, from, to } = req.query;
  res.json(await events.list(req.params.deviceId, { limit, before, kind, level, from, to }));
});

// ---- 操作紀錄查詢（限管理員，2026-09-10）：後台「操作紀錄」頁用；游標分頁（before＝上一頁最後一筆的 Id）----
app.get('/api/audit', requireAdmin, async (req, res) => {
  const { limit, before, action, targetType, targetId, actor, q, from, to } = req.query;
  res.json(await audit.list({ limit, before, action, targetType, targetId, actor, q, from, to }));
});

// ---- API 文件（Swagger UI）：/docs；規格檔在 docs/openapi.yaml，改 API 時一併更新 ----
const DOCS_DIR = path.join(__dirname, '..', 'docs');
app.get('/docs', (req, res) => {
  // 頁面用相對路徑載資源，需有結尾斜線（Express 預設 /docs 與 /docs/ 同一條路由）；掛在子路徑時前綴要帶上
  if (!req.originalUrl.startsWith(req.baseUrl + '/docs/')) return res.redirect(301, req.baseUrl + '/docs/');
  res.sendFile(path.join(DOCS_DIR, 'index.html'));
});
app.get('/docs/openapi.yaml', (_req, res) => res.type('text/yaml').sendFile(path.join(DOCS_DIR, 'openapi.yaml')));
app.use('/docs', express.static(swaggerUiDist.getAbsoluteFSPath(), { index: false }));

app.use('/files', express.static(UPLOAD_DIR, {
  maxAge: '365d', immutable: true,
  // express 4 的 mime 表沒有 AVIF，舊上傳的 .avif 會回 application/octet-stream
  setHeaders: (res, filePath) => { if (filePath.toLowerCase().endsWith('.avif')) res.type('image/avif'); },
}));
// ---- 後台網頁（2026-09-10 起掛在 /admin/）：/{site}/admin/＝後台、/{site}/play/＝之後的純顯示前台、
//      /{site}/api、/{site}/files 兩邊共用且不搬（現場機器存的伺服器位址是 /{site}，API 不動就不用重設）。
//      舊網址 /{site}/ 轉到 /{site}/admin/（書籤不會壞；瀏覽器會把 #hash 帶過去）。----
app.get('/', (req, res) => res.redirect(301, req.baseUrl + '/admin/'));
app.get('/admin', (req, res, next) => (req.path === '/admin' ? res.redirect(301, req.baseUrl + '/admin/') : next()));
// 後台首頁不是純靜態檔：代入站名與 logo（{{SITE_NAME}}／{{LOGIN_HEAD}}），每次讀檔（改 index.html 不用重啟）
const ADMIN_INDEX = path.join(__dirname, '..', 'public', 'index.html');
function renderAdminIndex() {
  const head = SITE_LOGO
    ? `<div class="login-mark ${SITE_LOGO_SHAPE}"><img src="${escHtml(SITE_LOGO)}" alt="${escHtml(SITE_NAME)}"></div>
        <h2 class="login-title">展示機管理系統</h2>`
    : `<div class="login-mark"><img src="img/favicon.svg" alt="${escHtml(SITE_NAME)}"></div>
        <h2 class="login-title">${escHtml(SITE_NAME)}</h2>
        <p class="login-sub">展示機管理系統</p>`;
  return fs.readFileSync(ADMIN_INDEX, 'utf8').replace(/\{\{SITE_NAME\}\}/g, escHtml(SITE_NAME)).replace('{{LOGIN_HEAD}}', head)
    .replace('{{SITE_THEME_LINK}}', SITE_THEME_LINK);
}
app.get(['/admin/', '/admin/index.html'], (_req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(renderAdminIndex()); });
// 純顯示播放頁（2026-09-10）：/{site}/play/?device=機器名&key=金鑰。Windows 機器用瀏覽器 kiosk 模式開這一頁，
// 讀的是和 App 同一份 config／同一組機器 API；資源走 ../admin/（play.js、play.css 都在 public/ 底下）。
const PLAY_INDEX = path.join(__dirname, '..', 'public', 'play.html');
app.get('/play', (req, res, next) => (req.path === '/play' ? res.redirect(301, req.baseUrl + '/play/' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')) : next()));
app.get('/play/', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(fs.readFileSync(PLAY_INDEX, 'utf8').replace(/\{\{SITE_NAME\}\}/g, escHtml(SITE_NAME))
    .replace('{{PLAY_DEFAULT_DEVICE}}', escHtml(PLAY_DEFAULT_DEVICE)).replace('{{PARK_API}}', escHtml(PARK_API)));
});
app.use('/admin', express.static(path.join(__dirname, '..', 'public')));

// AI 智能客服代理（2026-09-10，網頁播放器用）：路由在 src/assist.js，只收機器金鑰
require('./assist')(app, { db, log, isDevice });

app.use((err, req, res, _next) => {
  // body-parser 的 JSON 壞掉等「要求本身有問題」的錯（帶 statusCode 4xx）：回 400，記 warn 就好
  if (err && err.statusCode >= 400 && err.statusCode < 500) {
    log.warn('http', `要求無效：${err.message}`, { method: req.method, path: req.originalUrl, ...actorOf(req), rid: req.id });
    return res.status(err.statusCode).json({ error: '要求的格式不正確。', requestId: req.id });
  }
  // 原始錯誤（含 stack、哪支 API、誰、送了什麼）只留在伺服器 log；畫面上一律給中性說法，
  // detail 帶 requestId 供回報時對照（DevTools 看得到）。
  log.error('http', err, { method: req.method, path: req.originalUrl, ...actorOf(req), body: log.redactBody(req.body), rid: req.id });
  res.status(500).json({ error: '伺服器暫時無法處理這項要求。請稍後再試一次。', detail: String(err.message || err), requestId: req.id });
});

// async route 裡沒接住的錯（Express 4 不會轉給錯誤中介層）與零星背景錯誤：
// 記 log 撐住行程，別讓一次 DB 逾時弄死整個後台。
process.on('unhandledRejection', (e) => log.error('sys', e instanceof Error ? e : `unhandledRejection：${e && e.message ? e.message : e}`));
// 真的沒救的例外：先把原因寫進 log 檔再結束，run.cmd 5 秒內重拉。以前只噴在 stderr，事後在 server.log 裡難找。
process.on('uncaughtException', (e) => {
  log.error('sys', e instanceof Error ? e : `uncaughtException：${e}`);
  log.flush(() => process.exit(1));
  setTimeout(() => process.exit(1), 1000).unref();
});

/** 啟動時比對「程式碼實際註冊的路由」與 docs/openapi.yaml：任一邊多了或少了就印警告，
 *  避免改了 API 忘了更新文件。只比路徑＋方法，欄位／回應格式的差異抓不到。
 *  /docs 與 /files（靜態）、以及 / 與 /admin（後台網頁的轉址，不是 API）不列入比對。 */
function checkApiDocs() {
  const yaml = require('js-yaml');
  let spec;
  try {
    spec = yaml.load(fs.readFileSync(path.join(DOCS_DIR, 'openapi.yaml'), 'utf8'));
  } catch (e) {
    log.warn('docs', `API 文件檢查：docs/openapi.yaml 解析失敗（${e.message.split('\n')[0]}）`);
    return;
  }
  const skip = (p) => p.startsWith('/docs') || p.startsWith('/files') || p === '/' || p.startsWith('/admin') || p.startsWith('/play');
  const inCode = new Set();
  for (const layer of app._router.stack) {
    if (!layer.route) continue;
    for (const raw of [].concat(layer.route.path)) { // 路由可用陣列註冊多個路徑（如 /admin/ 與 /admin/index.html）
      const p = raw.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      if (skip(p)) continue;
      for (const m of Object.keys(layer.route.methods)) inCode.add(`${m.toUpperCase()} ${p}`);
    }
  }
  const inSpec = new Set();
  for (const [p, item] of Object.entries(spec.paths || {})) {
    if (skip(p)) continue;
    for (const m of Object.keys(item)) {
      if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(m)) inSpec.add(`${m.toUpperCase()} ${p}`);
    }
  }
  const missingInSpec = [...inCode].filter((k) => !inSpec.has(k));
  const missingInCode = [...inSpec].filter((k) => !inCode.has(k));
  if (!missingInSpec.length && !missingInCode.length) {
    log.info('docs', `API 文件檢查：${inCode.size} 條路由與 docs/openapi.yaml 一致`);
    return;
  }
  for (const k of missingInSpec) log.warn('docs', `API 文件檢查：程式碼有 ${k}，但 docs/openapi.yaml 沒有 → 請補上文件`);
  for (const k of missingInCode) log.warn('docs', `API 文件檢查：docs/openapi.yaml 有 ${k}，但程式碼沒有這條路由 → 請移除或修正文件`);
}
checkApiDocs();

// 掛載：有 BASE_PATH 就整個後台掛在子路徑底下（/joye/api/…、/joye/files/…、/joye/admin/ 網頁），
// 沒結尾斜線的 /joye 轉到 /joye/（再由 app 轉到 /joye/admin/）；根 / ＝各後台的統一入口清單。
const root = express();
if (BASE_PATH) {
  // Express 的 get('/joye') 連 '/joye/' 也會進來，只對「沒結尾斜線」的那個轉址，否則會無限轉址
  root.get(BASE_PATH, (req, res, next) => (req.path === BASE_PATH ? res.redirect(301, BASE_PATH + '/') : next()));
  // 根網址＝各後台的入口清單（2026-09-08 user 指示：不要直接跳進 /joye）。目前只有卓也小屋一個，之後有新客戶就加一張卡。
  // 入口前面有一層登入（.env 的 PORTAL_USERNAME／PORTAL_PASSWORD；沒設就不擋）：登入成功發 12 小時的 HMAC cookie，
  // 與 /joye 後台自己的帳號（Bearer token、sessionStorage）互不相干。
  // 入口清單的卡片：.env PORTAL_SITES＝「路徑=名稱;路徑=名稱」（例 /joye=卓也小屋;/sunrise=揚昇高爾夫球場），
  // 沒設＝只有這個站台自己。清單頁由根網址那個 Node 實例（正式站＝joye，port 3000）送出，其他站台的實例收不到根路徑。
  const portalSites = String(process.env.PORTAL_SITES || `${BASE_PATH}=${SITE_NAME}`).split(';').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const i = s.indexOf('='); return i < 0 ? { path: s, name: s } : { path: s.slice(0, i).trim(), name: s.slice(i + 1).trim() }; });
  const portalCards = portalSites.map((s) =>
    `        <a class="site-card" href="${escHtml(s.path)}/admin/"><span class="site-name">${escHtml(s.name)}</span><span class="site-path">${escHtml(s.path)}/admin/</span><i data-lucide="arrow-right" aria-hidden="true"></i></a>`).join('\n');
  const rootIndex = fs.readFileSync(path.join(__dirname, 'root-index.html'), 'utf8').replace(/\{\{BASE\}\}/g, BASE_PATH).replace('{{CARDS}}', portalCards);
  const rootLogin = fs.readFileSync(path.join(__dirname, 'root-login.html'), 'utf8').replace(/\{\{BASE\}\}/g, BASE_PATH);
  const PORTAL_USER = process.env.PORTAL_USERNAME || '';
  const PORTAL_PASS = process.env.PORTAL_PASSWORD || '';
  const PORTAL_TTL_MS = 12 * 60 * 60 * 1000;
  const portalSecret = crypto.randomBytes(32); // 每次啟動換一把：重啟後入口要重新登入
  const portalSign = (exp) => crypto.createHmac('sha256', portalSecret).update(String(exp)).digest('hex');
  const portalCookie = (req) => (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith('portal='))?.slice(7) || '';
  const portalOk = (req) => {
    if (!PORTAL_USER) return true;
    const [exp, sig] = portalCookie(req).split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const want = Buffer.from(portalSign(exp)), got = Buffer.from(sig);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  };
  const sendLogin = (res, error = '') => res.status(200).type('html').send(rootLogin.replace('{{ERROR}}', error));
  const secure = (req) => (req.get('X-Forwarded-Proto') || req.protocol) === 'https' ? '; Secure' : '';
  // 入口頁與登入頁都不准快取（IIS ARR 會快取沒帶 Cache-Control 的 GET，登入後會一直看到快取的登入頁）
  root.use(['/', '/portal-login', '/portal-logout'], (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // 登入失敗＝轉回首頁帶 ?e=1 顯示錯誤，網址不會停在 /portal-login（重新整理也不會跳「重新提交表單」）
  root.get('/', (req, res) => (portalOk(req) ? res.type('html').send(rootIndex) : sendLogin(res, req.query.e ? '帳號或密碼不正確。' : '')));
  // 登入：新版登入頁用 fetch 送 JSON（回 200 {ok} 或 401 {error}，頁面自己做動畫與 toast）；
  // 沒有 JS 時仍是傳統表單 POST（失敗轉回 /?e=1）。
  root.post('/portal-login', express.urlencoded({ extended: false }), express.json(), (req, res) => {
    const wantsJson = !!req.is('application/json');
    const u = String(req.body?.username || ''), p = String(req.body?.password || '');
    const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    if (!PORTAL_USER || !same(u, PORTAL_USER) || !same(p, PORTAL_PASS)) {
      return wantsJson ? res.status(401).json({ error: '帳號或密碼不正確。' }) : res.redirect(303, '/?e=1');
    }
    const exp = Date.now() + PORTAL_TTL_MS;
    res.set('Set-Cookie', `portal=${exp}.${portalSign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PORTAL_TTL_MS / 1000}${secure(req)}`);
    return wantsJson ? res.json({ ok: true }) : res.redirect(303, '/');
  });
  root.post('/portal-logout', (_req, res) => { res.set('Set-Cookie', 'portal=; Path=/; HttpOnly; Max-Age=0'); res.redirect(303, '/'); });
  root.get('/img/:file', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'img', path.basename(req.params.file))));
  root.use(BASE_PATH, app);
} else {
  root.use(app);
}

// 先開站（DB 斷線時網頁仍載得進、看得到明確錯誤），DB 在背景重試連線，連上自動恢復。
root.listen(PORT, () => log.info('sys', `KioskAdmin API 啟動：http://localhost:${PORT}${BASE_PATH}/admin/`, { logDir: log.LOG_DIR, level: log.level }));

(async function initDbWithRetry() {
  for (;;) {
    try {
      await db.init();
      await seedAdmin();
      await migrateSharedToGlobal();
      await loadSessions();
      log.info('db', '資料庫連線成功');
      await audit.prune();
      await events.prune();
      setInterval(() => { audit.prune(); events.prune(); pruneSessions(); }, 24 * 60 * 60 * 1000).unref();
      return;
    } catch (e) {
      log.error('db', `資料庫連線失敗，15 秒後重試：${e.message}`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
})();
