const sql = require('mssql');

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
    IF OBJECT_ID('dbo.KioskSharedSettings') IS NULL
    CREATE TABLE dbo.KioskSharedSettings (
      UserId       NVARCHAR(64)  NOT NULL PRIMARY KEY,
      SettingsJson NVARCHAR(MAX) NOT NULL,
      UpdatedAt    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
  `);
  return pool;
}

function getPool() {
  if (!pool) throw new Error('DB not initialised');
  return pool;
}

module.exports = { sql, init, getPool };
