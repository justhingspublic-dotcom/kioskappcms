require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const swaggerUiDist = require('swagger-ui-dist');
const db = require('./db');

const PORT = Number(process.env.PORT || 3000);
// 子路徑（2026-09-08）：正式站掛在 /joye（https://justdisplay.justhings.com.tw/joye），
// 根網址留給未來各後台的統一入口。留空＝掛在根（開發機）。所有路由照舊寫根路徑，由下方 root 掛載。
const BASE_PATH = String(process.env.BASE_PATH || '').trim().replace(/\/+$/, '').replace(/^(?=[^/])/, '/').replace(/^\/$/, '');
const DEVICE_KEY = process.env.DEVICE_KEY;
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '10mb' }));

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

// 簡易請求日誌（除錯用）：長輪詢 /wait 不印，避免洗版
app.use((req, res, next) => {
  if (!req.path.endsWith('/wait') && !req.path.startsWith('/docs')) {
    res.on('finish', () => console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${req.path} → ${res.statusCode}`));
  }
  next();
});

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
  const q = db.getPool().request().input('id', db.sql.NVarChar(64), deviceId);
  const p = keyOk
    ? q.input('url', db.sql.NVarChar(256), String(req.get('X-Device-Server') || '').slice(0, 256) || null)
        .input('ver', db.sql.NVarChar(32), String(req.get('X-App-Version') || '').slice(0, 32) || null)
        .query(`UPDATE dbo.KioskConfig SET LastSeenAt = SYSUTCDATETIME(),
                LastServerUrl = COALESCE(@url, LastServerUrl), LastAppVersion = COALESCE(@ver, LastAppVersion)
                WHERE DeviceId = @id`)
    : q.query('UPDATE dbo.KioskConfig SET LastKeyMismatchAt = SYSUTCDATETIME() WHERE DeviceId = @id');
  p.catch((e) => console.warn(`機器露面紀錄寫入失敗（${deviceId}）：${e.message}`));
}
app.use((req, _res, next) => {
  const m = req.path.match(/^\/api\/config\/([^/]+)/);
  if (m && req.get('X-Device-Key')) noteDevice(decodeURIComponent(m[1]), req, isDevice(req));
  next();
});

/** 這個後台自己的對外位址：.env 的 PUBLIC_URL，沒設就用這次請求的 host 推算。 */
function thisServerUrl(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}
/** 位址比對用：去頭尾空白與結尾斜線、協定與主機名不分大小寫。 */
function normalizeServerUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '').replace(/^(https?:\/\/[^/]+)/i, (m) => m.toLowerCase());
}

// 後台已刪除的機器（KioskDeviceRemoved）：機器帶 key 再連上一律回 410，機器收到會自己清空連線設定並關閉同步。
// 機器重新輸入位址/編號/金鑰後第一次連線會帶 X-Device-Fresh: 1，這時才劃掉紀錄放行（等同全新機器加入）。
app.use('/api/config/:deviceId', async (req, res, next) => {
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
  console.log(`已建立初始管理員帳號：${username}`);
}

// ---- 登入 ----
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const r = await db.getPool().request()
    .input('u', db.sql.NVarChar(64), String(username || ''))
    .query('SELECT UserId, Username, PasswordHash, DisplayName, IsAdmin FROM dbo.KioskUser WHERE Username = @u');
  const row = r.recordset[0];
  if (!row || !verifyPassword(String(password || ''), row.PasswordHash)) {
    return res.status(401).json({ error: '帳號或密碼不正確。' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, {
    userId: row.UserId, username: row.Username, isAdmin: !!row.IsAdmin,
    expiry: Date.now() + TOKEN_TTL_MS,
  });
  res.json({ token, user: { username: row.Username, displayName: row.DisplayName, isAdmin: !!row.IsAdmin } });
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
  res.json({ serverUrl: thisServerUrl(req), deviceKey: DEVICE_KEY || '' });
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
    const t = await db.getPool().request().input('id', db.sql.NVarChar(64), req.params.userId)
      .query('SELECT Username FROM dbo.KioskUser WHERE UserId = @id');
    if (t.recordset[0]?.Username === SEED_ADMIN_USERNAME) return res.status(400).json({ error: '無法變更主管理員的權限。' });
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
            DELETE FROM dbo.KioskUser WHERE UserId = @id;`);
  res.json({ ok: true });
});

// 把機器分配給某個帳號（userId 傳 null = 收回為未分配）
app.put('/api/devices/:deviceId/owner', requireAdmin, async (req, res) => {
  await db.getPool().request()
    .input('id', db.sql.NVarChar(64), req.params.deviceId)
    .input('owner', db.sql.NVarChar(64), req.body?.userId || null)
    .query('UPDATE dbo.KioskConfig SET OwnerUserId = @owner WHERE DeviceId = @id');
  res.json({ ok: true });
});

// ---- 刪除機器（限管理員）----
// 刪掉設定列並記進 KioskDeviceRemoved；叫醒掛在 /wait 的機器，它下一個請求就會收到 410 而自己清空連線設定。
app.delete('/api/devices/:deviceId', requireAdmin, async (req, res) => {
  await db.getPool().request()
    .input('id', db.sql.NVarChar(64), req.params.deviceId)
    .query(`DELETE FROM dbo.KioskConfig WHERE DeviceId = @id;
            IF NOT EXISTS (SELECT 1 FROM dbo.KioskDeviceRemoved WHERE DeviceId = @id)
              INSERT INTO dbo.KioskDeviceRemoved (DeviceId) VALUES (@id);`);
  deviceLastSeen.delete(req.params.deviceId);
  notifyWaiters(req.params.deviceId, 0);
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

// ---- 存整份設定（網頁存檔，或 kiosk 第一次連線時上傳本機設定當初始值）----
app.put('/api/config/:deviceId', async (req, res) => {
  const user = currentUser(req);
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
  // 部分更新語意：沒帶的頂層欄位一律沿用舊值（淺合併）。所以——
  // 網頁「儲存並發布」不帶 activePage → 機器不跳頁；舊版存檔不帶 deviceName/chatApi/sleep
  // → 不會洗掉；「複製版面」只帶 pages、「套用共用設定」只帶 chatApi+sleep → 其他都不動。
  {
    const prev = await db.getPool().request()
      .input('id', db.sql.NVarChar(64), req.params.deviceId)
      .query('SELECT ConfigJson FROM dbo.KioskConfig WHERE DeviceId = @id');
    const prevParsed = prev.recordset[0] ? JSON.parse(prev.recordset[0].ConfigJson) : null;
    config = Object.assign({}, prevParsed || {}, config);
    if (config.activePage === undefined) config.activePage = 0;
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
  console.log(`共用設定已合併為全站一份（來源 ${rows.length} 個帳號、${merged.layouts.length} 個版面）`);
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
    console.error('JustAI proxy：', e.message);
    res.status(502).json({ error: '無法連接智能客服平台。請檢查伺服器位址和網路連線。' });
  }
});

// ---- 圖片/影片上傳（任何登入帳號皆可；檔名隨機 UUID）----
// ---- 園區測站 API 代理（天氣格「園區測站」來源）----
// 後台預覽與測站清單要讀客戶的感測器 API（例：卓也小屋 joyeCloud /api/telemetry/current），
// 對方沒開 CORS，瀏覽器不能直接打；由伺服器代抓並快取 10 秒，多人同時開預覽也只打一次。
const stationCache = new Map(); // url -> { ts, body }
app.get('/api/station/current', requireUser, async (req, res) => {
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
    console.error('測站代理：', e.message);
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

// 網頁登入者或 kiosk 機器（帶 Device Key）都可上傳：機器會把現場選的圖自動傳上來
function requireUserOrDevice(req, res, next) {
  req.user = currentUser(req);
  if (req.user || isDevice(req)) return next();
  res.status(401).json({ error: '登入已過期。請重新登入。' });
}

app.post('/api/upload', requireUserOrDevice, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '沒有選擇檔案。' });
  const id = path.parse(req.file.filename).name;
  await db.getPool().request()
    .input('id', db.sql.NVarChar(64), id)
    .input('name', db.sql.NVarChar(256), req.file.originalname || null)
    .input('path', db.sql.NVarChar(512), req.file.filename)
    .input('mime', db.sql.NVarChar(128), req.file.mimetype || null)
    .input('size', db.sql.BigInt, req.file.size)
    .query(`INSERT INTO dbo.KioskFile (FileId, OriginalName, StoredPath, MimeType, SizeBytes)
            VALUES (@id, @name, @path, @mime, @size)`);
  res.json({ id, url: `/files/${req.file.filename}` });
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

app.use('/files', express.static(UPLOAD_DIR, { maxAge: '365d', immutable: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, _req, res, _next) => {
  console.error(err);
  // 原始錯誤只留在伺服器 log，畫面上一律給中性說法（detail 供開發者用 DevTools 查）
  res.status(500).json({ error: '伺服器暫時無法處理這項要求。請稍後再試一次。', detail: String(err.message || err) });
});

// async route 裡沒接住的錯（Express 4 不會轉給錯誤中介層）與零星背景錯誤：
// 記 log 撐住行程，別讓一次 DB 逾時弄死整個後台。
process.on('unhandledRejection', (e) => console.error('unhandledRejection：', e && e.message ? e.message : e));

/** 啟動時比對「程式碼實際註冊的路由」與 docs/openapi.yaml：任一邊多了或少了就印警告，
 *  避免改了 API 忘了更新文件。只比路徑＋方法，欄位／回應格式的差異抓不到。
 *  /docs 與 /files（靜態）不列入比對。 */
function checkApiDocs() {
  const yaml = require('js-yaml');
  let spec;
  try {
    spec = yaml.load(fs.readFileSync(path.join(DOCS_DIR, 'openapi.yaml'), 'utf8'));
  } catch (e) {
    console.warn(`⚠ API 文件檢查：docs/openapi.yaml 解析失敗（${e.message.split('\n')[0]}）`);
    return;
  }
  const skip = (p) => p.startsWith('/docs') || p.startsWith('/files');
  const inCode = new Set();
  for (const layer of app._router.stack) {
    if (!layer.route) continue;
    const p = layer.route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    if (skip(p)) continue;
    for (const m of Object.keys(layer.route.methods)) inCode.add(`${m.toUpperCase()} ${p}`);
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
    console.log(`API 文件檢查：${inCode.size} 條路由與 docs/openapi.yaml 一致`);
    return;
  }
  for (const k of missingInSpec) console.warn(`⚠ API 文件檢查：程式碼有 ${k}，但 docs/openapi.yaml 沒有 → 請補上文件`);
  for (const k of missingInCode) console.warn(`⚠ API 文件檢查：docs/openapi.yaml 有 ${k}，但程式碼沒有這條路由 → 請移除或修正文件`);
}
checkApiDocs();

// 掛載：有 BASE_PATH 就整個後台掛在子路徑底下（/joye/api/…、/joye/files/…、/joye/ 網頁），
// 沒結尾斜線的 /joye 轉到 /joye/（網頁用相對路徑載資源）；根 / 先暫時轉到後台，未來換成各後台的統一入口。
const root = express();
if (BASE_PATH) {
  // Express 的 get('/joye') 連 '/joye/' 也會進來，只對「沒結尾斜線」的那個轉址，否則會無限轉址
  root.get(BASE_PATH, (req, res, next) => (req.path === BASE_PATH ? res.redirect(301, BASE_PATH + '/') : next()));
  // 根網址＝各後台的入口清單（2026-09-08 user 指示：不要直接跳進 /joye）。目前只有卓也小屋一個，之後有新客戶就加一張卡。
  // 入口前面有一層登入（.env 的 PORTAL_USERNAME／PORTAL_PASSWORD；沒設就不擋）：登入成功發 12 小時的 HMAC cookie，
  // 與 /joye 後台自己的帳號（Bearer token、sessionStorage）互不相干。
  const rootIndex = fs.readFileSync(path.join(__dirname, 'root-index.html'), 'utf8').replace(/\{\{BASE\}\}/g, BASE_PATH);
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
  const sendLogin = (res, error = '') => res.status(200).type('html')
    .send(rootLogin.replace('{{ERROR}}', error).replace('{{ERROR_HIDDEN}}', error ? '' : ' hidden'));
  const secure = (req) => (req.get('X-Forwarded-Proto') || req.protocol) === 'https' ? '; Secure' : '';
  // 入口頁與登入頁都不准快取（IIS ARR 會快取沒帶 Cache-Control 的 GET，登入後會一直看到快取的登入頁）
  root.use(['/', '/portal-login', '/portal-logout'], (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // 登入失敗＝轉回首頁帶 ?e=1 顯示錯誤，網址不會停在 /portal-login（重新整理也不會跳「重新提交表單」）
  root.get('/', (req, res) => (portalOk(req) ? res.type('html').send(rootIndex) : sendLogin(res, req.query.e ? '帳號或密碼不正確。' : '')));
  root.post('/portal-login', express.urlencoded({ extended: false }), (req, res) => {
    const u = String(req.body?.username || ''), p = String(req.body?.password || '');
    const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    if (!PORTAL_USER || !same(u, PORTAL_USER) || !same(p, PORTAL_PASS)) return res.redirect(303, '/?e=1');
    const exp = Date.now() + PORTAL_TTL_MS;
    res.set('Set-Cookie', `portal=${exp}.${portalSign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PORTAL_TTL_MS / 1000}${secure(req)}`);
    res.redirect(303, '/');
  });
  root.post('/portal-logout', (_req, res) => { res.set('Set-Cookie', 'portal=; Path=/; HttpOnly; Max-Age=0'); res.redirect(303, '/'); });
  root.get('/img/:file', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'img', path.basename(req.params.file))));
  root.use(BASE_PATH, app);
} else {
  root.use(app);
}

// 先開站（DB 斷線時網頁仍載得進、看得到明確錯誤），DB 在背景重試連線，連上自動恢復。
root.listen(PORT, () => console.log(`KioskAdmin API 啟動：http://localhost:${PORT}${BASE_PATH}/`));

(async function initDbWithRetry() {
  for (;;) {
    try {
      await db.init();
      await seedAdmin();
      await migrateSharedToGlobal();
      console.log('資料庫連線成功');
      return;
    } catch (e) {
      console.error('資料庫連線失敗，15 秒後重試：', e.message);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
})();
