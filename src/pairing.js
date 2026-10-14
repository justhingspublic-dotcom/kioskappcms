'use strict';
/**
 * 配對碼（2026-10-13）：新機器不用再打位址／編號／金鑰。
 *
 *  1. 機器：自己產 6 位數，POST /api/pair/start 拿去每個場域登記（畫面上大字顯示），每個場域各回一個只有它知道的 pairId。
 *  2. 機器：GET /api/pair/:pairId/wait 長輪詢等結果（最多掛 25 秒，沒結果就再掛）。
 *  3. 後台：機器總覽「新增機器」→ 輸入配對碼（GET /api/pair/code/:code 先查是哪台）→ 取名 → POST /api/pair/claim。
 *     伺服器配好機器編號、發一把這台專屬的金鑰（src/device-keys.js），叫醒步驟 2 的機器。
 *  4. 機器收到 { deviceId, deviceName, deviceKey } 自己存好、開始同步（版本 0 → 把本機內容推上來）。
 *
 * 已經連在本場域的機器按「重新配對」（2026-10-13 user：同場域再輸入一次還是會過，應該要說它已經在了）：
 * 機器登記時帶目前的編號＋金鑰證明自己（只送給它目前連的那個場域），後台查碼時就回「已在清單中」、不再新增第二台，
 * 同時叫醒機器說「你已經在這裡了」。連在別的場域的機器只帶場域名稱，後台取名那一步提醒「新增後會從○○移除」。
 *
 * 配對碼 10 分鐘有效（2026-10-13 user 由 30 改 10，機器畫面上有倒數；到時間機器自己換一組；舊碼多留 1 分鐘，免得後台正在打的時候剛好換掉），配對成功就作廢。
 * 只放記憶體：伺服器重啟＝進行中的配對碼全部失效，機器長輪詢拿到 404 會自己換一組新的。
 * 只有登入後台的人能輸入配對碼，所以號碼被別人看到也沒用；開始配對不用登入（機器還沒有任何憑證），用數量上限擋濫用。
 */
const crypto = require('crypto');

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_GRACE_MS = 60 * 1000;
const DONE_KEEP_MS = 2 * 60 * 1000; // 配對完成後結果多留一下：機器那次長輪詢剛好斷線，重掛還拿得到
const WAIT_HOLD_MS = 25_000;
const MAX_ACTIVE = 200;
const MAX_ACTIVE_PER_IP = 10;

module.exports = function mountPairing(app, { db, log, audit, deviceKeys, requireUser, onDevicesChanged = async () => {} }) {
  const pairs = new Map(); // pairId -> { code, suggestedId, model, existing, currentSite, ip, expiresAt, claiming, result, doneAt, waiters:Set }
  const codes = new Map(); // code -> pairId（只放還能輸入的）

  /** 這組配對碼有結果了（配對完成，或這台本來就在本場域）：號碼作廢、叫醒機器的長輪詢。結果多留一下，機器重掛還拿得到。 */
  function settle(p, result) {
    p.result = result;
    p.doneAt = Date.now();
    if (pairs.get(codes.get(p.code)) === p) codes.delete(p.code);
    for (const w of p.waiters) { clearTimeout(w.timer); try { w.res.json(result); } catch { /* gone */ } }
    p.waiters.clear();
  }

  /** 機器說它現在是本場域的 deviceId，而且金鑰對得上、後台清單裡也還有它：回它在清單上的名稱；不然 null。 */
  async function existingName(deviceId) {
    const r = await db.getPool().request().input('id', db.sql.NVarChar(64), deviceId)
      .query('SELECT DeviceName FROM dbo.KioskConfig WHERE DeviceId = @id');
    const row = r.recordset[0];
    return row ? (row.DeviceName || deviceId) : null;
  }

  function sweep() {
    const now = Date.now();
    for (const [id, p] of pairs) {
      const dead = p.result ? now - p.doneAt > DONE_KEEP_MS : now > p.expiresAt + CODE_GRACE_MS;
      if (!dead) continue;
      if (codes.get(p.code) === id) codes.delete(p.code);
      for (const w of p.waiters) { clearTimeout(w.timer); try { w.res.status(404).json({ error: '這組配對碼已過期。' }); } catch { /* gone */ } }
      pairs.delete(id);
    }
  }
  setInterval(sweep, 30_000).unref();

  /** 還能輸入的配對碼：沒過期（含寬限）、還沒被用掉。 */
  function activeByCode(code) {
    const id = codes.get(code);
    const p = id && pairs.get(id);
    if (!p || p.result || p.claiming || Date.now() > p.expiresAt + CODE_GRACE_MS) return null;
    return p;
  }

  function newCode() {
    for (let i = 0; i < 50; i++) {
      const c = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      if (!codes.has(c)) return c;
    }
    throw new Error('配對碼用完了');
  }

  /** 機器編號：機器建議的（機型-ANDROID_ID 後四碼，跟以前「一鍵填入」補的一樣）沒人用就用它，有人用了就加尾碼。
   *  後台刪掉的機器（KioskDeviceRemoved）不算佔用——同一台機器刪掉再配對，編號照舊。 */
  async function allocateId(suggested) {
    const base = String(suggested || '').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40) || 'kiosk';
    for (let i = 0; i < 20; i++) {
      const id = i === 0 ? base : `${base}-${crypto.randomBytes(2).toString('hex')}`;
      const r = await db.getPool().request().input('id', db.sql.NVarChar(64), id).query(`
        SELECT (SELECT COUNT(*) FROM dbo.KioskConfig WHERE DeviceId = @id) AS inConfig,
               (SELECT COUNT(*) FROM dbo.KioskDeviceRemoved WHERE DeviceId = @id) AS removed`);
      const { inConfig, removed } = r.recordset[0];
      if (inConfig) continue;
      if (deviceKeys.has(id) && !removed) continue;
      return id;
    }
    throw new Error('找不到可用的機器編號');
  }

  // ---- 1. 機器開始配對 ----
  // body.code（2026-10-13 改版）：機器自己產號碼、拿同一組去「每個場域」登記，現場不用選場域——
  // 在哪個場域的後台輸入，機器就連到那裡，其他場域的登記機器會自己取消。這組在本站已經有人用＝409，機器換一組重來。
  // 沒帶 code＝伺服器自己產（舊版 1.58 測試包相容）。
  app.post('/api/pair/start', async (req, res) => {
    // 機器目前就連在本場域（帶 current＋X-Device-Key）：先確認金鑰和後台清單（要查 DB，所以放在下面那些同步檢查之前）
    const current = String(req.body?.current || '').slice(0, 64);
    const existing = current && deviceKeys.check(req.get('X-Device-Key'), current) && (await existingName(current)) ? current : null;
    sweep();
    const live = [...pairs.values()].filter((p) => !p.result);
    if (live.length >= MAX_ACTIVE || live.filter((p) => p.ip === req.ip).length >= MAX_ACTIVE_PER_IP) {
      log.warn('pair', '配對碼申請太多次，暫時不再發', { ip: req.ip, rid: req.id });
      return res.status(429).json({ error: '目前無法產生配對碼。請稍後再試一次。' });
    }
    const proposed = req.body?.code == null ? '' : String(req.body.code);
    if (proposed && !/^\d{6}$/.test(proposed)) return res.status(400).json({ error: '配對碼格式不正確。' });
    if (proposed && activeByCode(proposed)) return res.status(409).json({ error: '這組配對碼已有人使用。' });
    const pairId = crypto.randomBytes(16).toString('hex');
    const code = proposed || newCode();
    const clean = (v, n) => String(v || '').replace(/[^\w .()-]/g, '').trim().slice(0, n);
    pairs.set(pairId, {
      code, ip: req.ip, expiresAt: Date.now() + CODE_TTL_MS, waiters: new Set(),
      suggestedId: clean(req.body?.suggestedId, 64), model: clean(req.body?.model, 64),
      existing,
      // 機器目前連在別的場域：那個場域的名稱（中文），只拿來在取名那一步提醒，畫面用 textContent 顯示
      currentSite: existing ? '' : String(req.body?.currentSite || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64),
    });
    codes.set(code, pairId);
    log.info('pair', '機器開始配對', { code, model: pairs.get(pairId).model, ip: req.ip, rid: req.id });
    res.json({ pairId, code, expiresInSec: CODE_TTL_MS / 1000 });
  });

  // ---- 2. 機器等結果（長輪詢）----
  app.get('/api/pair/:pairId/wait', (req, res) => {
    const p = pairs.get(req.params.pairId);
    if (!p || (!p.result && Date.now() > p.expiresAt + CODE_GRACE_MS)) return res.status(404).json({ error: '這組配對碼已過期。' });
    if (p.result) return res.json(p.result);
    const w = { res };
    w.timer = setTimeout(() => { p.waiters.delete(w); try { res.json({ status: 'waiting' }); } catch { /* gone */ } }, WAIT_HOLD_MS);
    p.waiters.add(w);
    req.on('close', () => { clearTimeout(w.timer); p.waiters.delete(w); });
  });

  // 機器離開配對畫面：這組號碼立刻作廢
  app.delete('/api/pair/:pairId', (req, res) => {
    const p = pairs.get(req.params.pairId);
    if (p && !p.result && !p.claiming) {
      if (codes.get(p.code) === req.params.pairId) codes.delete(p.code);
      pairs.delete(req.params.pairId);
    }
    res.json({ ok: true });
  });

  // ---- 3a. 後台先查這組號碼是哪台（取名前讓人確認型號）----
  // 這台本來就在本場域（重新配對又輸入到同一個場域）：回 existing、不給新增，同時告訴機器「已經在這裡了」（號碼作廢、機器收起配對碼）。
  // 查的當下再確認一次它還在清單裡——中間被刪掉的話就當新機器照常新增。
  app.get('/api/pair/code/:code', requireUser, async (req, res) => {
    const code = String(req.params.code || '').replace(/\D/g, '');
    const p = activeByCode(code);
    if (!p) return res.status(404).json({ error: '找不到這組配對碼。請確認機器畫面上的號碼。' });
    const name = p.existing && (await existingName(p.existing));
    if (name && activeByCode(code) === p) {
      settle(p, { status: 'already' });
      log.info('pair', '這台機器已在本場域，不重複新增', { device: p.existing, user: req.user.username, rid: req.id });
      return res.json({ existing: { deviceId: p.existing, name } });
    }
    res.json({
      model: p.model, suggestedId: p.suggestedId, currentSite: p.currentSite || undefined,
      expiresInSec: Math.max(0, Math.round((p.expiresAt + CODE_GRACE_MS - Date.now()) / 1000)),
    });
  });

  // ---- 3b. 後台確認新增 ----
  app.post('/api/pair/claim', requireUser, async (req, res) => {
    const code = String(req.body?.code || '').replace(/\D/g, '');
    const name = String(req.body?.name || '').replace(/�/g, '').trim().slice(0, 128);
    if (!name) return res.status(400).json({ error: '請幫這台機器取個名字。' });
    const p = activeByCode(code);
    if (!p) return res.status(404).json({ error: '找不到這組配對碼。請確認機器畫面上的號碼。' });
    p.claiming = true; // 兩個人同時輸入同一組：後到的拿 404
    try {
      // 沒先查碼就直接新增（只有直接打 API 才會）：本來就在本場域的機器一樣不新增第二台
      const already = p.existing && (await existingName(p.existing));
      if (already) {
        p.claiming = false;
        settle(p, { status: 'already' });
        return res.status(409).json({ error: '這台機器已在機器清單中。', existing: { deviceId: p.existing, name: already } });
      }
      const deviceId = await allocateId(p.suggestedId);
      const deviceKey = await deviceKeys.issue(deviceId, { confirmed: true, source: 'pair' });
      // 先建好這台的設定列（版本 0、只有名稱）：後台對話框一關，機器總覽就看得到它（user 2026-10-13：關掉就該是新增成功，
      // 不要等機器連上才出現，中間那幾秒兩邊都沒反應像斷掉）。版本 0＝機器第一次對帳會把自己的內容推上來（不會拉這份空的）；
      // 推上來之前後台的讀寫設定都先擋（server.js GET/PUT /api/config 的 409）。
      // 同一台刪掉後重新配對：劃掉「已移除」紀錄（不然它一連上就收到 410）
      await db.getPool().request().input('id', db.sql.NVarChar(64), deviceId)
        .input('name', db.sql.NVarChar(128), name)
        .input('json', db.sql.NVarChar(db.sql.MAX), JSON.stringify({ deviceName: name }))
        .query(`IF NOT EXISTS (SELECT 1 FROM dbo.KioskConfig WHERE DeviceId = @id)
                  INSERT INTO dbo.KioskConfig (DeviceId, Version, ConfigJson, DeviceName) VALUES (@id, 0, @json, @name);
                DELETE FROM dbo.KioskDeviceRemoved WHERE DeviceId = @id;`);
      settle(p, { status: 'done', deviceId, deviceName: name, deviceKey });
      // 開著的機器總覽立刻出現這台，別的帳號那邊跳「已加入」通知（server.js /api/devices/wait）
      onDevicesChanged('joined', deviceId, name, { kind: 'user', username: req.user.username }).catch(() => {});
      audit.record(req, { action: 'device.pair', targetType: 'device', targetId: deviceId, targetName: name, summary: `用配對碼新增機器「${name}」（${deviceId}）` });
      log.info('pair', '配對完成', { device: deviceId, user: req.user.username, rid: req.id });
      res.json({ deviceId, deviceName: name });
    } catch (e) {
      p.claiming = false;
      throw e;
    }
  });
};
