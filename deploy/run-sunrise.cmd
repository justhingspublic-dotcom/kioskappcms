@echo off
rem KioskAdmin 第二個站台：揚昇高爾夫球場（sunrise），port 3001（2026-09-10）。
rem 放在 D:\WebSite\JustDisplay\run-sunrise.cmd，與 run.cmd 相同：無限迴圈重拉；開機自啟排程「KioskAdmin (Sunrise)」呼叫它。
pushd D:\WebSite\JustDisplay\KioskAdminSunrise
:loop
echo [%date% %time%] starting >> D:\WebSite\JustDisplay\logs\server-sunrise.log
"D:\WebSite\JustDisplay\node\node-v22.12.0-win-x64\node.exe" src\server.js >> D:\WebSite\JustDisplay\logs\server-sunrise.log 2>&1
echo [%date% %time%] exited %errorlevel%, restart in 5s >> D:\WebSite\JustDisplay\logs\server-sunrise.log
timeout /t 5 /nobreak >nul
goto loop
