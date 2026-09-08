@echo off
rem 手動啟動（測試用）。正式常駐請用 NSSM 或 pm2，見 DEPLOY.md
cd /d "%~dp0"
node src\server.js
