require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('./db');

const PORT = Number(process.env.PORT || 3000);
const DEVICE_KEY = process.env.DEVICE_KEY;
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '10mb' }));

// DB 還沒連上（啟動中或公司 DB 斷線）：API 一律回 503＋中文訊息，網頁照常載入。
app.use('/api', (_req, res, next) => {
  if (!db.isReady()) return res.status(503).json({ error: '資料庫連線中（公司 DB 未回應），請稍候再試' });
  next();
});

// 簡易請求日誌（除錯用）：長輪詢 /wait 不印，避免洗版
app.use((req, res, next) => {
  if (!req.path.endsWith('/wait')) {
    res.on('finish', () => console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${req.path} → ${res.statusCode}`));
  }
  next();
});

// 機器「最後露面時間」：帶 Device Key 的 config 請求（含掛 /wait）都算，
// 供機器總覽顯示在線/離線。存記憶體即可——重啟後機器 25 秒內就會再露面。
const deviceLastSeen = new Map(); // deviceId -> epoch ms
app.use((req, _res, next) => {
  if (isDevice(req)) {
    const m = req.path.match(/^\/api\/config\/([^/]+)/);
    if (m) deviceLastSeen.set(decodeURIComponent(m[1]), Date.now());
  }
  next();
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
  res.status(401).json({ error: 'unauthorized' });
}
function requireAdmin(req, res, next) {
  req.user = currentUser(req);
  if (req.user?.isAdmin) return next();
  res.status(403).json({ error: 'admin only' });
}

/** 該登入者能否操作這台機器（管理員全可；一般帳號只能碰分配給自己的）。 */
async function canAccessDevice(user, deviceId) {
  if (user.isAdmin) return true;
  const r = await db.getPool().request()
    .input('id', db.sql.NVarChar(64), deviceId)
    .query('SELECT OwnerUserId FROM dbo.KioskConfig WHERE DeviceId = @id');
  return r.recordset[0]?.OwnerUserId === user.userId;
}

// ---- 首次啟動：沒有任何帳號時，自動建立管理員 ----
async function seedAdmin() {
  const r = await db.getPool().request().query('SELECT COUNT(*) AS n FROM dbo.KioskUser');
  if (r.recordset[0].n > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
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
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, {
    userId: row.UserId, username: row.Username, isAdmin: !!row.IsAdmin,
    expiry: Date.now() + TOKEN_TTL_MS,
  });
  res.json({ token, user: { username: row.Username, displayName: row.DisplayName, isAdmin: !!row.IsAdmin } });
});

app.get('/api/me', requireUser, (req, res) => {
  res.json({ username: req.user.username, isAdmin: req.user.isAdmin });
});

// ---- 帳號管理（限管理員）----
app.get('/api/users', requireAdmin, async (_req, res) => {
  const r = await db.getPool().request().query(`
    SELECT u.UserId, u.Username, u.DisplayName, u.IsAdmin, u.CreatedAt,
           (SELECT COUNT(*) FROM dbo.KioskConfig c WHERE c.OwnerUserId = u.UserId) AS DeviceCount
    FROM dbo.KioskUser u ORDER BY u.CreatedAt`);
  res.json(r.recordset);
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, displayName, isAdmin } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '帳號與密碼必填' });
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
    if (/UNIQUE|duplicate/i.test(e.message)) return res.status(409).json({ error: '帳號名稱已存在' });
    throw e;
  }
});

// 改帳號顯示名稱（2026-09-03：帳號管理「更名」）
app.put('/api/users/:userId', requireAdmin, async (req, res) => {
  const displayName = String(req.body?.displayName ?? '').trim();
  if (/�/.test(displayName)) {
    return res.status(400).json({ error: '名稱含無效字元（來源編碼問題），請改用網頁介面輸入' });
  }
  const r = await db.getPool().request()
    .input('id', db.sql.NVarChar(64), req.params.userId)
    .input('n', db.sql.NVarChar(128), displayName.slice(0, 128) || null)
    .query('UPDATE dbo.KioskUser SET DisplayName = @n WHERE UserId = @id');
  if (!r.rowsAffected[0]) return res.status(404).json({ error: '帳號不存在' });
  res.json({ ok: true });
});

app.delete('/api/users/:userId', requireAdmin, async (req, res) => {
  if (req.params.userId === req.user.userId) return res.status(400).json({ error: '不能刪除自己' });
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

// ---- 刪除機器（限管理員；移除測試機或報廢機的資料）----
app.delete('/api/devices/:deviceId', requireAdmin, async (req, res) => {
  await db.getPool().request()
    .input('id', db.sql.NVarChar(64), req.params.deviceId)
    .query('DELETE FROM dbo.KioskConfig WHERE DeviceId = @id');
  notifyWaiters(req.params.deviceId, 0);
  res.json({ ok: true });
});

// ---- 機器清單（管理員看全部；一般帳號只看自己的）----
app.get('/api/devices', requireUser, async (req, res) => {
  const q = db.getPool().request();
  let sqlText = `
    SELECT c.DeviceId, c.DeviceName, c.Version, c.UpdatedAt, c.OwnerUserId, u.Username AS OwnerName
    FROM dbo.KioskConfig c LEFT JOIN dbo.KioskUser u ON u.UserId = c.OwnerUserId`;
  if (!req.user.isAdmin) {
    q.input('me', db.sql.NVarChar(64), req.user.userId);
    sqlText += ' WHERE c.OwnerUserId = @me';
  }
  const r = await q.query(sqlText + ' ORDER BY c.DeviceId');
  res.json(r.recordset.map((row) => ({
    ...row,
    LastSeenAgoSec: deviceLastSeen.has(row.DeviceId)
      ? Math.round((Date.now() - deviceLastSeen.get(row.DeviceId)) / 1000)
      : null,
  })));
});

// ---- 版本號 ----
async function readVersion(deviceId) {
  const r = await db.getPool().request()
    .input('id', db.sql.NVarChar(64), deviceId)
    .query('SELECT Version FROM dbo.KioskConfig WHERE DeviceId = @id');
  return r.recordset[0]?.Version ?? 0;
}

app.get('/api/config/:deviceId/version', async (req, res) => {
  if (!isDevice(req) && !currentUser(req)) return res.status(401).json({ error: 'unauthorized' });
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
  if (!isDevice(req) && !currentUser(req)) return res.status(401).json({ error: 'unauthorized' });
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
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    if (!(await canAccessDevice(user, req.params.deviceId))) return res.status(403).json({ error: 'not your device' });
  }
  const r = await db.getPool().request()
    .input('id', db.sql.NVarChar(64), req.params.deviceId)
    .query('SELECT Version, ConfigJson, UpdatedAt FROM dbo.KioskConfig WHERE DeviceId = @id');
  const row = r.recordset[0];
  if (!row) return res.status(404).json({ error: 'no config for this device' });
  res.json({ version: row.Version, updatedAt: row.UpdatedAt, config: JSON.parse(row.ConfigJson) });
});

// ---- 存整份設定（網頁存檔，或 kiosk 第一次連線時上傳本機設定當初始值）----
app.put('/api/config/:deviceId', async (req, res) => {
  const user = currentUser(req);
  if (!isDevice(req)) {
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    if (!(await canAccessDevice(user, req.params.deviceId))) return res.status(403).json({ error: 'not your device' });
  }
  let config = req.body?.config;
  if (!config || typeof config !== 'object') {
    return res.status(400).json({ error: 'body must be { config: {...} }' });
  }
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

// ---- 共用機器設定（每個登入帳號一份：客服帳號＋休眠排程的共用範本）----
// 「套用到機器」由網頁端逐台 PUT config（沿用欄位保留機制），這裡只存範本本身。
app.get('/api/shared-settings', requireUser, async (req, res) => {
  const r = await db.getPool().request()
    .input('id', db.sql.NVarChar(64), req.user.userId)
    .query('SELECT SettingsJson, UpdatedAt FROM dbo.KioskSharedSettings WHERE UserId = @id');
  const row = r.recordset[0];
  res.json(row ? { settings: JSON.parse(row.SettingsJson), updatedAt: row.UpdatedAt } : { settings: null });
});

app.put('/api/shared-settings', requireUser, async (req, res) => {
  const settings = req.body?.settings;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'body must be { settings: {...} }' });
  }
  await db.getPool().request()
    .input('id', db.sql.NVarChar(64), req.user.userId)
    .input('json', db.sql.NVarChar(db.sql.MAX), JSON.stringify(settings))
    .query(`
      MERGE dbo.KioskSharedSettings AS t
      USING (SELECT @id AS UserId) AS s ON t.UserId = s.UserId
      WHEN MATCHED THEN UPDATE SET SettingsJson = @json, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (UserId, SettingsJson) VALUES (@id, @json);
    `);
  res.json({ ok: true });
});

// ---- 智能客服（JustAI）代理：用機器設定裡的帳號拉客服清單 ----
// 瀏覽器直呼 JustAI 會被 CORS 擋，且帳密已存在 config 裡，由伺服器代打最單純。
app.post('/api/justai/agents', requireUser, async (req, res) => {
  const { baseUrl, email, password } = req.body || {};
  if (!baseUrl || !email || !password) {
    return res.status(400).json({ error: '請先在「機器設定」填妥智能客服 API 帳號' });
  }
  const root = String(baseUrl).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(root)) return res.status(400).json({ error: '伺服器位址格式不正確' });
  try {
    const login = await fetch(root + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!login.ok) return res.status(502).json({ error: '智能客服登入失敗，請檢查帳號密碼' });
    const jt = (await login.json()).token;
    const r = await fetch(root + '/api/agents', { headers: { Authorization: 'Bearer ' + jt } });
    if (!r.ok) return res.status(502).json({ error: `取得客服清單失敗（HTTP ${r.status}）` });
    const arr = await r.json();
    res.json((Array.isArray(arr) ? arr : []).map((a) => ({
      id: a.id, name: a.name || '', description: a.description || '',
    })));
  } catch (e) {
    res.status(502).json({ error: '無法連線智能客服平台：' + e.message });
  }
});

// ---- 圖片/影片上傳（任何登入帳號皆可；檔名隨機 UUID）----
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
  res.status(401).json({ error: 'unauthorized' });
}

app.post('/api/upload', requireUserOrDevice, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
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

app.use('/files', express.static(UPLOAD_DIR, { maxAge: '365d', immutable: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: String(err.message || err) });
});

// async route 裡沒接住的錯（Express 4 不會轉給錯誤中介層）與零星背景錯誤：
// 記 log 撐住行程，別讓一次 DB 逾時弄死整個後台。
process.on('unhandledRejection', (e) => console.error('unhandledRejection：', e && e.message ? e.message : e));

// 先開站（DB 斷線時網頁仍載得進、看得到明確錯誤），DB 在背景重試連線，連上自動恢復。
app.listen(PORT, () => console.log(`KioskAdmin API 啟動：http://localhost:${PORT}`));

(async function initDbWithRetry() {
  for (;;) {
    try {
      await db.init();
      await seedAdmin();
      console.log('資料庫連線成功');
      return;
    } catch (e) {
      console.error('資料庫連線失敗，15 秒後重試：', e.message);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
})();
