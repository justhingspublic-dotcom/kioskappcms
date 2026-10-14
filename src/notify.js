/* 通知中心（2026-10-14，頂欄鈴鐺）：給人看的白話通知，存 DB（dbo.KioskNotification），保留 30 天。
 * 跟操作紀錄（src/audit.js）的分工：操作紀錄是「全部都記、給我們查」；這裡只挑有意義的事、寫成一句白話，
 * 不提供搜尋／篩選（user 2026-09-10「客戶後台不放紀錄頁」→ 2026-10-14 同意以「通知」而非「紀錄」的定位做鈴鐺）。
 *
 * 兩種來源：
 *  1. 人或機器的操作：audit.record 寫完後呼叫 fromAudit()，白名單內的動作轉成通知（機器加入／中斷連線／刪除、
 *     發布、切換、批量展示、共用版面與共用設定的變更）。
 *  2. 機器狀態：server.js 的 watchDeviceStatus 判斷「離線超過 10 分鐘（休眠時段不算）」「恢復連線」
 *     「金鑰不符」「連到別的伺服器」後呼叫 add()。
 *
 * Kind：device＝機器類（所有帳號都看，自己做的也看）／content＝內容類（網頁只顯示別人做的，見 public/app.js）。
 * 同一個人對同一個目標做同一件事，10 分鐘內只留一筆（更新時間往後推），共用版面自動存檔才不會洗版。
 */
const db = require('./db');
const log = require('./log');

const KEEP_DAYS = 30;
const MERGE_MS = 10 * 60 * 1000;
let onAdded = () => {};

/** 帳號 → 顯示名稱（session 裡只有帳號）；快取 60 秒。 */
let nameCache = { at: 0, map: new Map() };
async function displayNameOf(username) {
  if (!username) return '';
  // 60 秒重讀一次；快取裡沒有這個帳號（剛新增的）也重讀，但 5 秒內不重複讀
  const age = Date.now() - nameCache.at;
  if (age > 60_000 || (!nameCache.map.has(username) && age > 5_000)) {
    try {
      const r = await db.getPool().request().query('SELECT Username, DisplayName FROM dbo.KioskUser');
      nameCache = { at: Date.now(), map: new Map(r.recordset.map((u) => [u.Username, u.DisplayName || ''])) };
    } catch { /* 查不到就只顯示帳號 */ }
  }
  return nameCache.map.get(username) || username;
}

/**
 * 新增一筆。n：{ kind, type, text, deviceId?, actorUsername?, actorName?, mergeKey? }
 *  - text：完整的一句話（不含句號以外的技術字），例：「藍染長廊」已離線超過 10 分鐘
 *  - mergeKey：同一個 key 在 10 分鐘內再來就更新那一筆，不新增
 */
async function add(n) {
  if (!db.isReady()) return;
  try {
    const pool = db.getPool();
    if (n.mergeKey) {
      const r = await pool.request()
        .input('k', db.sql.NVarChar(200), n.mergeKey.slice(0, 200))
        .input('since', db.sql.DateTime2, new Date(Date.now() - MERGE_MS))
        .input('text', db.sql.NVarChar(400), n.text.slice(0, 400))
        .query(`UPDATE dbo.KioskNotification SET At = SYSUTCDATETIME(), Text = @text
                WHERE Id = (SELECT MAX(Id) FROM dbo.KioskNotification WHERE MergeKey = @k AND At >= @since)`);
      if (r.rowsAffected[0]) { onAdded(); return; }
    }
    await pool.request()
      .input('kind', db.sql.NVarChar(16), n.kind)
      .input('type', db.sql.NVarChar(48), n.type)
      .input('dev', db.sql.NVarChar(64), n.deviceId || null)
      .input('text', db.sql.NVarChar(400), String(n.text).slice(0, 400))
      .input('au', db.sql.NVarChar(64), n.actorUsername || null)
      .input('an', db.sql.NVarChar(128), n.actorName || null)
      .input('k', db.sql.NVarChar(200), n.mergeKey ? n.mergeKey.slice(0, 200) : null)
      .input('g', db.sql.NVarChar(200), n.groupKey ? n.groupKey.slice(0, 200) : null)
      .query(`INSERT INTO dbo.KioskNotification (Kind, Type, DeviceId, Text, ActorUsername, ActorName, MergeKey, GroupKey)
              VALUES (@kind, @type, @dev, @text, @au, @an, @k, @g)`);
    onAdded();
  } catch (e) {
    log.warn('notify', `通知寫入失敗：${e.message}`, { type: n.type });
  }
}

/** 某台機器最近一筆「狀態」通知的類型（offline／online／…），伺服器重啟後判斷要不要補發「恢復連線」。 */
async function lastStatusByDevice() {
  const r = await db.getPool().request().query(`
    SELECT n.DeviceId, n.Type FROM dbo.KioskNotification n
    JOIN (SELECT DeviceId, MAX(Id) AS Id FROM dbo.KioskNotification WHERE Type IN ('offline', 'online') GROUP BY DeviceId) m
      ON m.Id = n.Id`);
  return new Map(r.recordset.map((x) => [x.DeviceId, x.Type]));
}

/** 同一台、同一種狀態問題，24 小時內有通知過就不再發（金鑰不符、連到別的伺服器）。 */
async function recentlyNotified(type, deviceId, hours = 24) {
  const r = await db.getPool().request()
    .input('t', db.sql.NVarChar(48), type).input('d', db.sql.NVarChar(64), deviceId)
    .input('since', db.sql.DateTime2, new Date(Date.now() - hours * 3600_000))
    .query('SELECT TOP 1 1 AS x FROM dbo.KioskNotification WHERE Type = @t AND DeviceId = @d AND At >= @since');
  return r.recordset.length > 0;
}

const q = (s) => `「${s || ''}」`;

/** 操作紀錄 → 通知（白名單）。a＝操作者 { type, id, name }，ev＝audit.record 的參數。 */
async function fromAudit(a, ev) {
  const act = ev.action;
  const who = a.type === 'user' ? await displayNameOf(a.name) : '';
  const user = a.type === 'user' ? a.name : null;
  const dev = ev.targetType === 'device' ? ev.targetId : null;
  const name = ev.targetName || ev.targetId || '';
  const d = ev.detail || {};
  const base = { actorUsername: user, actorName: who, deviceId: dev };
  const summaryAfter = (prefix) => (ev.summary.startsWith(prefix) ? ev.summary.slice(prefix.length) : ev.summary);
  switch (act) {
    case 'device.pair':
      return add({ ...base, kind: 'device', type: 'joined', text: `${who}用配對碼新增了${q(name)}` });
    case 'device.disconnect':
      return add({ ...base, kind: 'device', type: 'left', text: `${q(name)}在現場中斷連線，已從清單移除` });
    case 'device.delete':
      return add({ ...base, kind: 'device', type: 'deleted', text: `${who}刪除了${q(name)}` });
    case 'device.rename':
      return add({ ...base, kind: 'content', type: 'renamed', text: `${who}${summaryAfter('把機器').replace(/^/, '把')}` });
    case 'config.publish':
    case 'config.update':
      if (!(d.changed || []).length) return;   // 內容沒變的存檔不通知
      return add({ ...base, kind: 'content', type: 'published', text: `${who}更新了${q(name)}的畫面`, mergeKey: `pub:${user}:${dev}` });
    case 'config.switchPage':
      return add({ ...base, kind: 'content', type: 'switchPage', text: `${who}${ev.summary}`, mergeKey: `sw:${user}:${dev}` });
    case 'config.appendLayout':
      return add({ ...base, kind: 'content', type: 'appendLayout', text: `${who}${ev.summary}`, groupKey: `append:${user}:${d.layoutName || ''}` });
    case 'config.showLayout':
      return add({ ...base, kind: 'content', type: 'showLayout', text: `${who}讓${q(name)}展示版面${q(d.layoutName)}`, groupKey: `show:${user}:${d.layoutName || ''}` });
    case 'config.applySettings':
      if (!(d.changed || []).length) return;
      return add({ ...base, kind: 'content', type: 'applySettings', text: `${who}把共用機器設定套用到${q(name)}`, groupKey: `apply:${user}` });
    case 'shared.layout.create':
    case 'shared.layout.rename':
    case 'shared.layout.delete':
      return add({ ...base, deviceId: null, kind: 'content', type: 'sharedLayout', text: `${who}${ev.summary}` });
    case 'shared.layout.update':
      return add({ ...base, deviceId: null, kind: 'content', type: 'sharedLayout', text: `${who}修改了共用版面${q(ev.targetName)}`, mergeKey: `sl:${user}:${ev.targetId}` });
    case 'shared.settings.update':
      return add({ ...base, deviceId: null, kind: 'content', type: 'sharedSettings', text: `${who}${ev.summary.replace(/^修改共用機器設定：/, '修改了共用機器設定（')}${ev.summary.includes('：') ? '）' : ''}`, mergeKey: `ss:${user}` });
    default:
  }
}

/** 給 GET /api/notifications：最近 30 天、最新 100 筆，加上這個帳號讀到哪裡。 */
async function list(username) {
  const pool = db.getPool();
  const [items, read] = await Promise.all([
    pool.request().input('days', db.sql.Int, KEEP_DAYS).query(`
      SELECT TOP 100 Id, At, Kind, Type, DeviceId, Text, ActorUsername, ActorName, GroupKey
      FROM dbo.KioskNotification WHERE At >= DATEADD(day, -@days, SYSUTCDATETIME()) ORDER BY At DESC, Id DESC`),
    pool.request().input('u', db.sql.NVarChar(64), username).query('SELECT ReadAt FROM dbo.KioskNotifyRead WHERE Username = @u'),
  ]);
  return {
    items: items.recordset.map((r) => ({ ...r, Id: String(r.Id) })),
    readAt: read.recordset[0]?.ReadAt || null,
  };
}

/** 打開鈴鐺＝全部已讀（每個帳號各自記）。 */
async function markRead(username) {
  const r = await db.getPool().request().input('u', db.sql.NVarChar(64), username).query(`
    UPDATE dbo.KioskNotifyRead SET ReadAt = SYSUTCDATETIME() WHERE Username = @u;
    IF @@ROWCOUNT = 0 INSERT INTO dbo.KioskNotifyRead (Username, ReadAt) VALUES (@u, SYSUTCDATETIME());
    SELECT ReadAt FROM dbo.KioskNotifyRead WHERE Username = @u;`);
  return r.recordset[0]?.ReadAt || null;
}

async function prune() {
  try {
    const r = await db.getPool().request().input('days', db.sql.Int, KEEP_DAYS)
      .query('DELETE FROM dbo.KioskNotification WHERE At < DATEADD(day, -@days, SYSUTCDATETIME())');
    const n = r.rowsAffected[0] || 0;
    if (n) log.info('notify', `已清除 ${n} 筆超過 ${KEEP_DAYS} 天的通知`);
  } catch (e) {
    log.warn('notify', `清除舊通知失敗：${e.message}`);
  }
}

module.exports = {
  add, fromAudit, list, markRead, prune, lastStatusByDevice, recentlyNotified,
  setOnAdded(fn) { onAdded = fn; },
};
