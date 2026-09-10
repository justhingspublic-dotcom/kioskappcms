const sql = require('mssql');
const log = require('./log');

const baseConfig = {
  server: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    // 內網舊版 SQL Server 常無有效憑證；先信任自簽憑證讓連線成立。
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

const DB_NAME = process.env.DB_NAME || 'KioskAdmin';

let pool = null;

/** 啟動時呼叫：確保資料庫與資料表存在，回傳連到 KioskAdmin 的連線池。 */
async function init() {
  // 先連 master 建立資料庫（已存在則跳過）
  const master = await new sql.ConnectionPool({ ...baseConfig, database: 'master' }).connect();
  await master.request().query(
    `IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = '${DB_NAME}') CREATE DATABASE [${DB_NAME}]`,
  );
  await master.close();

  pool = await new sql.ConnectionPool({ ...baseConfig, database: DB_NAME }).connect();
  // 連線池斷線（DB 重啟/網路抖動）不能炸掉整個伺服器：記 log，之後的查詢會自動重連
  pool.on('error', (e) => log.error('db', `DB 連線池錯誤（將自動重連）：${e.message}`));
  await pool.request().query(`
    IF OBJECT_ID('dbo.KioskConfig') IS NULL
    CREATE TABLE dbo.KioskConfig (
      DeviceId   NVARCHAR(64)  NOT NULL PRIMARY KEY,
      Version    INT           NOT NULL DEFAULT 0,
      ConfigJson NVARCHAR(MAX) NOT NULL,
      UpdatedAt  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
    IF OBJECT_ID('dbo.KioskFile') IS NULL
    CREATE TABLE dbo.KioskFile (
      FileId       NVARCHAR(64)  NOT NULL PRIMARY KEY,
      OriginalName NVARCHAR(256) NULL,
      StoredPath   NVARCHAR(512) NOT NULL,
      MimeType     NVARCHAR(128) NULL,
      SizeBytes    BIGINT        NULL,
      UploadedAt   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
    IF OBJECT_ID('dbo.KioskUser') IS NULL
    CREATE TABLE dbo.KioskUser (
      UserId       NVARCHAR(64)  NOT NULL PRIMARY KEY,
      Username     NVARCHAR(64)  NOT NULL UNIQUE,
      PasswordHash NVARCHAR(256) NOT NULL,
      DisplayName  NVARCHAR(128) NULL,
      IsAdmin      BIT           NOT NULL DEFAULT 0,
      CreatedAt    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
    IF COL_LENGTH('dbo.KioskConfig', 'OwnerUserId') IS NULL
      ALTER TABLE dbo.KioskConfig ADD OwnerUserId NVARCHAR(64) NULL;
    IF COL_LENGTH('dbo.KioskConfig', 'DeviceName') IS NULL
      ALTER TABLE dbo.KioskConfig ADD DeviceName NVARCHAR(128) NULL;
    -- 機器自報的連線資訊（2026-09-08）：每次帶 Device Key 連線就記（每台最多每分鐘寫一次）。
    -- 存 DB 而非只放記憶體，是因為測試站與正式站共用同一個 DB：正式站要能看出某台機器其實還連在測試站。
    IF COL_LENGTH('dbo.KioskConfig', 'LastSeenAt') IS NULL
      ALTER TABLE dbo.KioskConfig ADD LastSeenAt DATETIME2 NULL;
    IF COL_LENGTH('dbo.KioskConfig', 'LastServerUrl') IS NULL
      ALTER TABLE dbo.KioskConfig ADD LastServerUrl NVARCHAR(256) NULL;
    IF COL_LENGTH('dbo.KioskConfig', 'LastAppVersion') IS NULL
      ALTER TABLE dbo.KioskConfig ADD LastAppVersion NVARCHAR(32) NULL;
    IF COL_LENGTH('dbo.KioskConfig', 'LastKeyMismatchAt') IS NULL
      ALTER TABLE dbo.KioskConfig ADD LastKeyMismatchAt DATETIME2 NULL;
    IF OBJECT_ID('dbo.KioskSharedSettings') IS NULL
    CREATE TABLE dbo.KioskSharedSettings (
      UserId       NVARCHAR(64)  NOT NULL PRIMARY KEY,
      SettingsJson NVARCHAR(MAX) NOT NULL,
      UpdatedAt    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
    -- 後台「刪除機器」的紀錄：機器全共用一把 DEVICE_KEY、編號自己報，只刪 KioskConfig 那列
    -- 機器下一輪就會把本機設定推回來；所以刪除時同時記在這裡，機器再連上就回 410 讓它自己清空連線設定。
    -- 機器重新輸入連線資料（請求帶 X-Device-Fresh）時才劃掉這筆。
    IF OBJECT_ID('dbo.KioskDeviceRemoved') IS NULL
    CREATE TABLE dbo.KioskDeviceRemoved (
      DeviceId  NVARCHAR(64) NOT NULL PRIMARY KEY,
      RemovedAt DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME()
    );
    -- 操作紀錄（2026-09-10）：誰、何時、對哪台機器／哪個帳號做了什麼，給後台「操作紀錄」頁查；寫入與查詢在 src/audit.js。
    -- 索引另外建（不用 CREATE TABLE 內嵌 INDEX 語法，舊版 SQL Server 不支援）。
    IF OBJECT_ID('dbo.KioskAuditLog') IS NULL
    CREATE TABLE dbo.KioskAuditLog (
      Id         BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      At         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
      ActorType  NVARCHAR(16)  NOT NULL,
      ActorId    NVARCHAR(64)  NULL,
      ActorName  NVARCHAR(128) NULL,
      Action     NVARCHAR(64)  NOT NULL,
      TargetType NVARCHAR(32)  NULL,
      TargetId   NVARCHAR(64)  NULL,
      TargetName NVARCHAR(128) NULL,
      Summary    NVARCHAR(512) NOT NULL,
      DetailJson NVARCHAR(MAX) NULL,
      Ip         NVARCHAR(64)  NULL,
      RequestId  NVARCHAR(16)  NULL
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KioskAuditLog_At')
      CREATE INDEX IX_KioskAuditLog_At ON dbo.KioskAuditLog (At);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KioskAuditLog_Target')
      CREATE INDEX IX_KioskAuditLog_Target ON dbo.KioskAuditLog (TargetType, TargetId, Id);
    -- 機器事件（2026-09-10）：App 在機器上記的啟動／閃退／同步失敗／切頁／休眠等事件，定期 POST 上來存這裡（src/events.js）。
    -- At＝機器上發生的時間、ReceivedAt＝收到的時間（機器離線時會堆著之後補送）。後台不做頁面，只存。
    IF OBJECT_ID('dbo.KioskDeviceEvent') IS NULL
    CREATE TABLE dbo.KioskDeviceEvent (
      Id         BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      DeviceId   NVARCHAR(64)  NOT NULL,
      At         DATETIME2     NOT NULL,
      ReceivedAt DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
      Level      NVARCHAR(8)   NOT NULL,
      Kind       NVARCHAR(32)  NOT NULL,
      Message    NVARCHAR(512) NOT NULL,
      Detail     NVARCHAR(MAX) NULL,
      AppVersion NVARCHAR(32)  NULL
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KioskDeviceEvent_Device')
      CREATE INDEX IX_KioskDeviceEvent_Device ON dbo.KioskDeviceEvent (DeviceId, Id);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KioskDeviceEvent_ReceivedAt')
      CREATE INDEX IX_KioskDeviceEvent_ReceivedAt ON dbo.KioskDeviceEvent (ReceivedAt);
  `);
  return pool;
}

function getPool() {
  if (!pool) throw new Error('DB not initialised');
  return pool;
}

/** DB 連上了沒（伺服器現在是「先開站、背景連 DB」，API 靠這個判斷要不要回 503）。 */
function isReady() {
  return !!pool;
}

module.exports = { sql, init, getPool, isReady };
