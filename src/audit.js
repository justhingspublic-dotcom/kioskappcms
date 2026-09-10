/* 操作紀錄（audit log，2026-09-10）：「誰、什麼時候、對哪台機器／哪個帳號做了什麼」，給管理者在後台「操作紀錄」頁查。
 * 與 src/log.js 的系統 log 分工：系統 log 是工程師除錯用的文字檔；這裡是給人看的中文一句話，存 DB（dbo.KioskAuditLog），
 * 測試站與正式站各自一套 DB 所以不會混。只記網頁端／人為的動作，機器每分鐘的自報同步不記（會洗版）。
 * 寫入 fire-and-forget：失敗只進系統 log，不影響原本的回應。保留 AUDIT_KEEP_DAYS（預設 180）天。
 */
const db = require('./db');
const log = require('./log');

const KEEP_DAYS = Math.max(1, Number(process.env.AUDIT_KEEP_DAYS) || 180);

/** 這個請求的操作者：登入帳號／機器／匿名（登入失敗時只知道對方打的帳號）。 */
function actorFrom(req) {
  if (req.user) return { type: 'user', id: req.user.userId, name: req.user.username };
  const m = (req.path || '').match(/^\/api\/(?:config|devices)\/([^/]+)/);
  if (m && req.get('X-Device-Key')) {
    const id = decodeURIComponent(m[1]);
    return { type: 'device', id, name: id };
  }
  return { type: 'anonymous', id: null, name: null };
}

/**
 * 記一筆。ev：{ action, targetType, targetId, targetName, summary, detail, actor }
 *  - action：機器可讀代碼，用「.」分群（login.ok / user.delete / device.delete / config.publish / shared.layout.create / file.upload / sys.restart）
 *  - summary：給人看的中文一句話（必填）
 *  - detail：附加資料物件（選填，JSON 存），別放密碼
 *  - actor：不從 req 推（例如登入失敗要記對方打的帳號）
 * 回傳 promise（已接住錯誤），要等寫完的地方（重啟前）可以 await。
 */
function record(req, ev) {
  if (!db.isReady()) return Promise.resolve();
  const a = ev.actor || actorFrom(req);
  // IIS ARR 轉來的 X-Forwarded-For 會帶來源埠（192.168.1.253:6261），只留位址
  const ip = String(req.ip || '').replace(/^::ffff:/, '').replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1').slice(0, 64) || null;
  const p = db.getPool().request()
    .input('atype', db.sql.NVarChar(16), a.type)
    .input('aid', db.sql.NVarChar(64), a.id ? String(a.id).slice(0, 64) : null)
    .input('aname', db.sql.NVarChar(128), a.name ? String(a.name).slice(0, 128) : null)
    .input('action', db.sql.NVarChar(64), String(ev.action || '').slice(0, 64))
    .input('ttype', db.sql.NVarChar(32), ev.targetType ? String(ev.targetType).slice(0, 32) : null)
    .input('tid', db.sql.NVarChar(64), ev.targetId ? String(ev.targetId).slice(0, 64) : null)
    .input('tname', db.sql.NVarChar(128), ev.targetName ? String(ev.targetName).slice(0, 128) : null)
    .input('summary', db.sql.NVarChar(512), String(ev.summary || '').slice(0, 512))
    .input('detail', db.sql.NVarChar(db.sql.MAX), ev.detail ? JSON.stringify(ev.detail) : null)
    .input('ip', db.sql.NVarChar(64), ip)
    .input('rid', db.sql.NVarChar(16), req.id || null)
    .query(`INSERT INTO dbo.KioskAuditLog (ActorType, ActorId, ActorName, Action, TargetType, TargetId, TargetName, Summary, DetailJson, Ip, RequestId)
            VALUES (@atype, @aid, @aname, @action, @ttype, @tid, @tname, @summary, @detail, @ip, @rid)`)
    .then(() => { log.debug('audit', ev.summary, { action: ev.action, actor: a.name || a.type, rid: req.id }); })
    .catch((e) => { log.warn('audit', `操作紀錄寫入失敗：${e.message}`, { action: ev.action, rid: req.id }); });
  return p;
}

/**
 * 查詢（給 GET /api/audit）。opts：
 *  limit（1–200，預設 50）、before（Id 游標：只拿比它舊的）、action（前綴，如 'config.' 或完整代碼）、
 *  targetType＋targetId（某台機器／某個帳號）、actor（操作者名稱，等於）、q（摘要關鍵字）、from／to（ISO 日期時間）
 * 回 { items, nextBefore }：nextBefore 有值＝還有更舊的。
 */
async function list(opts = {}) {
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const r = db.getPool().request().input('limit', db.sql.Int, limit + 1);
  const where = [];
  if (opts.before) { r.input('before', db.sql.BigInt, Number(opts.before)); where.push('Id < @before'); }
  if (opts.action) {
    const a = String(opts.action);
    r.input('action', db.sql.NVarChar(64), a.endsWith('.') ? a + '%' : a);
    where.push(a.endsWith('.') ? "Action LIKE @action ESCAPE '\\'" : 'Action = @action');
  }
  if (opts.targetType) { r.input('ttype', db.sql.NVarChar(32), String(opts.targetType)); where.push('TargetType = @ttype'); }
  if (opts.targetId) { r.input('tid', db.sql.NVarChar(64), String(opts.targetId)); where.push('TargetId = @tid'); }
  if (opts.actor) { r.input('actor', db.sql.NVarChar(128), String(opts.actor)); where.push('ActorName = @actor'); }
  if (opts.q) {
    const esc = String(opts.q).replace(/[\\%_\[]/g, (c) => '\\' + c).slice(0, 100);
    r.input('q', db.sql.NVarChar(128), `%${esc}%`);
    where.push("(Summary LIKE @q ESCAPE '\\' OR ActorName LIKE @q ESCAPE '\\' OR TargetName LIKE @q ESCAPE '\\')");
  }
  if (opts.from && !Number.isNaN(Date.parse(opts.from))) { r.input('from', db.sql.DateTime2, new Date(opts.from)); where.push('At >= @from'); }
  if (opts.to && !Number.isNaN(Date.parse(opts.to))) { r.input('to', db.sql.DateTime2, new Date(opts.to)); where.push('At < @to'); }
  const res = await r.query(`
    SELECT TOP (@limit) Id, At, ActorType, ActorId, ActorName, Action, TargetType, TargetId, TargetName, Summary, DetailJson, Ip
    FROM dbo.KioskAuditLog ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY Id DESC`);
  const rows = res.recordset;
  const more = rows.length > limit;
  const items = rows.slice(0, limit).map(({ DetailJson, ...row }) => {
    let Detail = null;
    if (DetailJson) { try { Detail = JSON.parse(DetailJson); } catch { Detail = null; } }
    return { ...row, Id: String(row.Id), Detail };
  });
  return { items, nextBefore: more ? items[items.length - 1].Id : null };
}

/** 刪掉超過保留天數的紀錄；啟動時與每天各跑一次。 */
async function prune() {
  try {
    const r = await db.getPool().request().input('days', db.sql.Int, KEEP_DAYS)
      .query('DELETE FROM dbo.KioskAuditLog WHERE At < DATEADD(day, -@days, SYSUTCDATETIME())');
    const n = r.rowsAffected[0] || 0;
    if (n) log.info('audit', `已清除 ${n} 筆超過 ${KEEP_DAYS} 天的操作紀錄`);
  } catch (e) {
    log.warn('audit', `清除舊操作紀錄失敗：${e.message}`);
  }
}

/** 檔案大小給人看。 */
function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

module.exports = { record, list, prune, fmtSize, KEEP_DAYS };
