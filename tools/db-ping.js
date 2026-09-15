// 診斷用：從這台機器用同一份 .env 的設定，開一條「全新的」DB 連線並跑 SELECT 1，印出每一步花多久。
// 用法（在站台資料夾內）：node tools\db-ping.js        或   ENV_FILE=.env.sunrise node tools/db-ping.js
// 連續試 3 次；正常應該每次 < 200ms。用來分辨「這台機器連不到 DB」還是「只有正在跑的那個程序連不到」。
require('dotenv').config({ path: process.env.ENV_FILE || '.env' });
const sql = require('mssql');
const cfg = {
  server: process.env.DB_HOST, port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'KioskAdmin',
  options: { encrypt: false, trustServerCertificate: true }, connectionTimeout: 15000, requestTimeout: 15000, pool: { max: 1, min: 0 },
};
(async () => {
  console.log(`target ${cfg.server}:${cfg.port} db=${cfg.database} node=${process.version} pid=${process.pid}`);
  for (let i = 1; i <= 3; i++) {
    const t0 = Date.now();
    try {
      const pool = await new sql.ConnectionPool(cfg).connect();
      const t1 = Date.now();
      const r = await pool.request().query('SELECT 1 AS x, @@SPID AS spid, SYSDATETIME() AS now');
      const t2 = Date.now();
      console.log(`#${i} OK  connect=${t1 - t0}ms query=${t2 - t1}ms spid=${r.recordset[0].spid}`);
      await pool.close();
    } catch (e) {
      console.log(`#${i} FAIL after ${Date.now() - t0}ms: ${e.message}`);
    }
  }
})().then(() => process.exit(0));
