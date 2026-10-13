'use strict';
/**
 * 每台機器專屬的連線金鑰（2026-10-13）。
 *
 * 以前所有機器共用 .env 的 DEVICE_KEY（寫在 APK 裡、播放頁網址上），外流一次全部要換。現在：
 *  - 新機器用配對碼加入（src/pairing.js），一加入就拿到自己的金鑰（Confirmed＝1）。
 *  - 舊機器手上的共用金鑰照常有效；新版 App 每輪對帳看到 /version 回 keyKind: 'shared'，
 *    就用共用金鑰換一把專屬的（POST /api/devices/:id/key，Confirmed＝0）。
 *  - 機器第一次用專屬金鑰連上來才 Confirmed＝1；從此共用金鑰不能再代表這台（外流也改不到它）。
 *    換到一半斷線（伺服器發了、機器沒收到）沒關係：還沒 Confirmed，共用金鑰照樣能用、下一輪再換一把。
 *  - 共用金鑰本身永久保留當備援（user 2026-10-13 定案），還沒換的舊機器、網頁播放頁都繼續用它。
 *
 * DB 只存金鑰的 SHA-256（金鑰是 24 bytes 隨機值，不需要慢雜湊）；啟動時整批載進記憶體，
 * 驗證走記憶體（isDevice 是同步呼叫、每個機器請求都會打）。
 */
const crypto = require('crypto');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newKey = () => crypto.randomBytes(24).toString('base64url'); // 32 字元，可直接放 HTTP 標頭

function createDeviceKeys({ db, log, sharedKey }) {
  const byDevice = new Map(); // deviceId -> { hash, confirmed, source }
  const byHash = new Map(); // hash -> deviceId

  function setCache(deviceId, hash, confirmed, source) {
    const old = byDevice.get(deviceId);
    if (old) byHash.delete(old.hash);
    byDevice.set(deviceId, { hash, confirmed, source });
    byHash.set(hash, deviceId);
  }

  async function load() {
    const r = await db.getPool().request().query('SELECT DeviceId, KeyHash, Confirmed, Source FROM dbo.KioskDeviceKey');
    byDevice.clear();
    byHash.clear();
    for (const row of r.recordset) setCache(row.DeviceId, row.KeyHash, !!row.Confirmed, row.Source);
    log.info('device', `載入 ${r.recordset.length} 把機器專屬金鑰`);
  }

  /** 金鑰是誰的：{ kind: 'shared' }＝共用金鑰、{ kind: 'own', deviceId }＝某台的專屬金鑰、null＝都不是。 */
  function identify(key) {
    if (!key) return null;
    if (sharedKey && key === sharedKey) return { kind: 'shared' };
    const deviceId = byHash.get(sha256(key));
    return deviceId ? { kind: 'own', deviceId } : null;
  }

  /** 第一次用專屬金鑰連上：記下來，之後共用金鑰不能再代表這台。寫 DB 失敗就退回未確認，下個請求再寫。 */
  function confirm(deviceId) {
    const row = byDevice.get(deviceId);
    if (!row || row.confirmed) return;
    row.confirmed = true;
    db.getPool().request().input('id', db.sql.NVarChar(64), deviceId)
      .query('UPDATE dbo.KioskDeviceKey SET Confirmed = 1, ConfirmedAt = SYSUTCDATETIME() WHERE DeviceId = @id')
      .then(() => log.info('device', '機器開始使用專屬金鑰，共用金鑰不再能代表這台', { device: deviceId }))
      .catch((e) => { row.confirmed = false; log.warn('device', `專屬金鑰確認寫入失敗：${e.message}`, { device: deviceId }); });
  }

  /**
   * 機器金鑰驗證。deviceId＝路徑上的機器編號；沒有（上傳檔案、測站代理這類不分機器的 API）＝任何有效金鑰都可。
   * 專屬金鑰只能代表自己那台；共用金鑰可以代表還沒確認專屬金鑰的機器。
   */
  function check(key, deviceId) {
    const who = identify(key);
    if (!who) return false;
    if (who.kind === 'shared') return !deviceId || !byDevice.get(deviceId)?.confirmed;
    if (deviceId && who.deviceId !== deviceId) return false;
    confirm(who.deviceId);
    return true;
  }

  /** 機器總覽用：'own'＝已換好、'pending'＝已發出還沒用過、'shared'＝還在用共用金鑰。 */
  function kindOf(deviceId) {
    const row = byDevice.get(deviceId);
    return row ? (row.confirmed ? 'own' : 'pending') : 'shared';
  }

  /** 發一把新的專屬金鑰（蓋掉這台舊的那把），回傳明文——只有這一次拿得到。 */
  async function issue(deviceId, { confirmed, source }) {
    const key = newKey();
    const hash = sha256(key);
    await db.getPool().request()
      .input('id', db.sql.NVarChar(64), deviceId)
      .input('hash', db.sql.Char(64), hash)
      .input('confirmed', db.sql.Bit, confirmed ? 1 : 0)
      .input('source', db.sql.NVarChar(16), source)
      .query(`
        MERGE dbo.KioskDeviceKey AS t
        USING (SELECT @id AS DeviceId) AS s ON t.DeviceId = s.DeviceId
        WHEN MATCHED THEN UPDATE SET KeyHash = @hash, Confirmed = @confirmed, Source = @source, CreatedAt = SYSUTCDATETIME(),
          ConfirmedAt = CASE WHEN @confirmed = 1 THEN SYSUTCDATETIME() ELSE NULL END
        WHEN NOT MATCHED THEN INSERT (DeviceId, KeyHash, Confirmed, Source, ConfirmedAt)
          VALUES (@id, @hash, @confirmed, @source, CASE WHEN @confirmed = 1 THEN SYSUTCDATETIME() ELSE NULL END);`);
    setCache(deviceId, hash, !!confirmed, source);
    return key;
  }

  /** 作廢這台的專屬金鑰（後台「重設連線金鑰」）：這台改回共用金鑰狀態，App 會用留著的共用金鑰再換一把。 */
  async function revoke(deviceId) {
    await db.getPool().request().input('id', db.sql.NVarChar(64), deviceId)
      .query('DELETE FROM dbo.KioskDeviceKey WHERE DeviceId = @id');
    const old = byDevice.get(deviceId);
    if (old) byHash.delete(old.hash);
    byDevice.delete(deviceId);
  }

  const has = (deviceId) => byDevice.has(deviceId);
  /** 專屬金鑰怎麼來的：'pair'＝配對碼加入、'exchange'＝舊機器用共用金鑰換的、null＝沒有專屬金鑰。 */
  const sourceOf = (deviceId) => byDevice.get(deviceId)?.source || null;

  return { load, identify, check, kindOf, sourceOf, issue, revoke, has };
}

module.exports = { createDeviceKeys };
