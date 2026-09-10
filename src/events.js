/* 機器事件（device events，2026-09-10）：App 在機器上記的事件（啟動、閃退、同步失敗／恢復、拉到新版面、切頁、
 * 進出休眠、喚醒結果…）定期 POST 到 /api/devices/:id/events，這裡存進 dbo.KioskDeviceEvent。
 * user 定案：後台不做頁面，只存資料庫；要查用 GET /api/devices/:id/events（限管理員）或直接下 SQL。
 * 保留 DEVICE_EVENT_KEEP_DAYS（預設 90）天。
 */
const db = require('./db');
const log = require('./log');

const KEEP_DAYS = Math.max(1, Number(process.env.DEVICE_EVENT_KEEP_DAYS) || 90);
const MAX_BATCH = 500;

/** 收一批。events：[{ at(epoch ms), level, kind, message, detail, appVersion }]；壞的那筆跳過，回收下幾筆。 */
async function insertBatch(deviceId, events) {
  if (!Array.isArray(events) || !events.length) return 0;
  const rows = events.slice(0, MAX_BATCH).map((e) => ({
    at: Number.isFinite(Number(e.at)) && Number(e.at) > 0 ? new Date(Number(e.at)) : new Date(),
    level: String(e.level || 'info').slice(0, 8),
    kind: String(e.kind || '').slice(0, 32),
    message: String(e.message || '').slice(0, 512),
    detail: e.detail === null || e.detail === undefined ? null : String(e.detail).slice(0, 4000),
    appVersion: e.appVersion ? String(e.appVersion).slice(0, 32) : null,
  })).filter((r) => r.kind && r.message);
  if (!rows.length) return 0;
  const tx = new db.sql.Transaction(db.getPool());
  await tx.begin();
  try {
    for (const r of rows) {
      await new db.sql.Request(tx)
        .input('id', db.sql.NVarChar(64), deviceId)
        .input('at', db.sql.DateTime2, r.at)
        .input('level', db.sql.NVarChar(8), r.level)
        .input('kind', db.sql.NVarChar(32), r.kind)
        .input('msg', db.sql.NVarChar(512), r.message)
        .input('detail', db.sql.NVarChar(db.sql.MAX), r.detail)
        .input('ver', db.sql.NVarChar(32), r.appVersion)
        .query(`INSERT INTO dbo.KioskDeviceEvent (DeviceId, At, Level, Kind, Message, Detail, AppVersion)
                VALUES (@id, @at, @level, @kind, @msg, @detail, @ver)`);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
  return rows.length;
}

/** 查詢：limit（1–200）、before（Id 游標）、kind（前綴以「.」結尾或完整）、level、from／to。 */
async function list(deviceId, opts = {}) {
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const r = db.getPool().request().input('limit', db.sql.Int, limit + 1).input('id', db.sql.NVarChar(64), deviceId);
  const where = ['DeviceId = @id'];
  if (opts.before) { r.input('before', db.sql.BigInt, Number(opts.before)); where.push('Id < @before'); }
  if (opts.kind) {
    const k = String(opts.kind);
    r.input('kind', db.sql.NVarChar(32), k.endsWith('.') ? k + '%' : k);
    where.push(k.endsWith('.') ? "Kind LIKE @kind ESCAPE '\\'" : 'Kind = @kind');
  }
  if (opts.level) { r.input('level', db.sql.NVarChar(8), String(opts.level)); where.push('Level = @level'); }
  if (opts.from && !Number.isNaN(Date.parse(opts.from))) { r.input('from', db.sql.DateTime2, new Date(opts.from)); where.push('At >= @from'); }
  if (opts.to && !Number.isNaN(Date.parse(opts.to))) { r.input('to', db.sql.DateTime2, new Date(opts.to)); where.push('At < @to'); }
  const res = await r.query(`
    SELECT TOP (@limit) Id, At, ReceivedAt, Level, Kind, Message, Detail, AppVersion
    FROM dbo.KioskDeviceEvent WHERE ${where.join(' AND ')} ORDER BY Id DESC`);
  const rows = res.recordset;
  const more = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => ({ ...row, Id: String(row.Id) }));
  return { items, nextBefore: more ? items[items.length - 1].Id : null };
}

async function prune() {
  try {
    const r = await db.getPool().request().input('days', db.sql.Int, KEEP_DAYS)
      .query('DELETE FROM dbo.KioskDeviceEvent WHERE ReceivedAt < DATEADD(day, -@days, SYSUTCDATETIME())');
    const n = r.rowsAffected[0] || 0;
    if (n) log.info('events', `已清除 ${n} 筆超過 ${KEEP_DAYS} 天的機器事件`);
  } catch (e) {
    log.warn('events', `清除舊機器事件失敗：${e.message}`);
  }
}

module.exports = { insertBatch, list, prune, KEEP_DAYS, MAX_BATCH };
