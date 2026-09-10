@echo off
rem KioskAdmin second site: Sunrise Golf (sunrise), port 3001. Same loop as run.cmd.
rem Lives at D:\WebSite\JustDisplay\run-sunrise.cmd; scheduled task "KioskAdmin (Sunrise)" runs it at boot.
rem ASCII only + CRLF: cmd.exe reads batch files in the OEM code page, non-ASCII bytes can swallow line breaks.
:loop
cd /d D:\WebSite\JustDisplay\KioskAdminSunrise
echo [%date% %time%] starting >> D:\WebSite\JustDisplay\logs\server-sunrise.log
"D:\WebSite\JustDisplay\node\node-v22.12.0-win-x64\node.exe" src\server.js >> D:\WebSite\JustDisplay\logs\server-sunrise.log 2>&1
echo [%date% %time%] exited %errorlevel%, restart in 5s >> D:\WebSite\JustDisplay\logs\server-sunrise.log
timeout /t 5 /nobreak >nul
goto loop
