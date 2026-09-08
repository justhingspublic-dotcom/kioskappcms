/* 改主管理員帳號／密碼（2026-09-08）。用法：node tools/set-admin.js <目前帳號> <新帳號> <新密碼>
   例：node tools/set-admin.js admin joyeadmin "joye#2026"
   改完記得把 .env 的 ADMIN_USERNAME 改成新帳號（伺服器靠它認「主管理員」），ADMIN_PASSWORD 只在首次建庫時用到。
   密碼雜湊格式與 src/server.js 的 hashPassword 相同（scrypt，"salt:hash"）。 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const db = require('../src/db');
const [cur, next, pw] = process.argv.slice(2);
if (!cur || !next || !pw) { console.error('用法：node tools/set-admin.js <目前帳號> <新帳號> <新密碼>'); process.exit(1); }
const salt = crypto.randomBytes(16).toString('hex');
const hash = salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
(async () => {
  await db.init();
  const r = await db.getPool().request()
    .input('cur', db.sql.NVarChar(64), cur).input('next', db.sql.NVarChar(64), next).input('h', db.sql.NVarChar(256), hash)
    .query('UPDATE dbo.KioskUser SET Username = @next, PasswordHash = @h WHERE Username = @cur');
  console.log(r.rowsAffected[0] === 1 ? `已把 ${cur} 改成 ${next} 並更新密碼。` : `找不到帳號 ${cur}，沒有改任何東西。`);
  process.exit(r.rowsAffected[0] === 1 ? 0 : 2);
})().catch((e) => { console.error(e.message); process.exit(1); });
