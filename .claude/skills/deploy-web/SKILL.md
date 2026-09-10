---
name: deploy-web
description: 把 KioskAdmin（JustDisplay 後台，c:\Code\KioskAdmin）部署到正式站 JTWEB2（192.168.1.82，後台網頁 https://justdisplay.justhings.com.tw/joye/admin/，API 在 /joye/api）。user 說「部署」「上正式站」「更新後台」「重啟正式站」「打包」時用。含 SMB 蓋檔、.env 改法、重啟、驗證、打包 zip 與所有踩過的坑。
---

# 部署 KioskAdmin 到正式站

## 環境事實（別重查）
- 正式站主機 **JTWEB2 = 192.168.1.82**（LAN，NAT 到公網 61.220.68.35），Windows Server 2016，IIS 反向代理 → Node :3000。
- IIS 站台 JustDisplay 實體路徑（＝部署目標）：**`D:\WebSite\JustDisplay\KioskAdmin\`**。web.config 在這層最外層。
- Node 22 免安裝版：`D:\WebSite\JustDisplay\node\node-v22.12.0-win-x64\node.exe`（系統 Node 是 16，別動）。
- 啟動：`D:\WebSite\JustDisplay\run.cmd`（無限迴圈重拉；它寫的 `D:\WebSite\JustDisplay\logs\server.log` 從 2026-09-10 起只剩起停與沒接住的 crash）；排程「KioskAdmin (JustDisplay)」開機自啟。
- **系統 log（2026-09-10 起）：`D:\WebSite\JustDisplay\KioskAdmin\logs\app-YYYY-MM-DD.log`**，一天一檔留 30 天（.env 的 LOG_LEVEL／LOG_DIR／LOG_KEEP_DAYS，沒設＝info／專案 logs/／30）。操作紀錄在 DB 表 KioskAuditLog、機器事件在 KioskDeviceEvent（客戶後台**不放**頁面，user 2026-09-10 裁決）；要看用管理員 token 打 `GET /joye/api/audit`／`GET /joye/api/devices/{id}/events`。
- `.env`（正式）：PORT=3000、BASE_PATH=/joye、PUBLIC_URL=https://justdisplay.justhings.com.tw/joye、PORTAL_USERNAME/PASSWORD＝根網址入口登入、ADMIN_USERNAME＝joye 主管理員。**永遠不要用本機 .env 蓋掉它。**
- 遠端存取：**SMB 管理共用 `\192.168.1.82\D$`** 讀寫檔；診斷可用 DCOM（`New-CimSession -Protocol Dcom` + `Win32_Process.Create`，指令要包成 `cmd.exe /c script > out.txt`）。WinRM 不能用（本機 shell 非提權）。帳密向 user 要（administrator），不要存進任何檔案。
- 安全檢查會擋：遠端砍程序、註冊 SYSTEM 排程、一次做太多事的腳本、把密碼寫檔。遇到就拆小步或請 user 自己做。

## 第二個站台：揚昇高爾夫球場 sunrise（2026-09-10 起，同一份程式碼、另一個 Node 實例）
- 資料夾 **`D:\WebSite\JustDisplay\KioskAdminSunrise\`**（與 KioskAdmin 並列、不在 IIS 站台底下）；port **3001**；自己的 `.env`（DB_NAME=KioskAdminSunrise、BASE_PATH=/sunrise、PUBLIC_URL=https://justdisplay.justhings.com.tw/sunrise、SITE_NAME=揚昇高爾夫球場、SITE_LOGO= 空、ADMIN_USERNAME=sunriseadmin、另一組 DEVICE_KEY；**ADMIN_PASSWORD 有 # 必須加引號**，dotenv 會把 # 後面當註解）；uploads 在自己資料夾底下、不與 joye 共用。
- 啟動：`D:\WebSite\JustDisplay\run-sunrise.cmd`（同 run.cmd 迴圈重拉，log 在 `logs\server-sunrise.log`；原檔在 repo `deploy/run-sunrise.cmd`）；開機自啟排程「KioskAdmin (Sunrise)」由 user 在伺服器上註冊。
- IIS：站台根 web.config 多一條規則 `^sunrise(/.*)?$` → `http://localhost:3001/{R:0}`，放在通用規則前面（deploy/web.config 已含）。
- 根網址入口清單的卡片由 **joye** 那個實例的 .env `PORTAL_SITES=/joye=卓也小屋;/sunrise=揚昇高爾夫球場` 決定（sunrise 實例收不到根路徑）。
- 蓋檔範圍與 joye 相同，但目標換成 `KioskAdminSunrise\`（**兩個資料夾都要蓋**，程式碼同一份）。
- 重啟：`ENV_FILE=.env.sunrise node tools/restart-prod.js https://justdisplay.justhings.com.tw/sunrise`（本機 .env.sunrise 的 sunriseadmin 密碼＝正式站）。改帳號用 `ENV_FILE=.env.sunrise node tools/set-admin.js …`（本機 .env.sunrise 指向 KioskAdminSunriseDev，要改正式站 DB 得暫時把 DB_NAME 換成 KioskAdminSunrise）。
- 驗證：`/sunrise/admin/` → 200、`/sunrise/` → 301、`/sunrise/api/me` → 401。
- 本機測試站：`ENV_FILE=.env.sunrise node src/server.js` → http://localhost:3178/sunrise/admin/（DB KioskAdminSunriseDev、uploads-sunrise/）。

## 標準流程
1. **本機檢查**：`node --check src/server.js`、`node --check public/app.js`；有改 openapi.yaml 就 `node -e "require('js-yaml').load(...)"`。要實測子路徑：`MSYS_NO_PATHCONV=1 PORT=3199 BASE_PATH=/joye node src/server.js`，curl `localhost:3199/joye/admin/`（`/joye/` 應 301 到 /joye/admin/）。
2. **蓋檔（SMB）**：用 PowerShell `Copy-Item` 把改過的檔案複製到 `\192.168.1.82\D$\WebSite\JustDisplay\KioskAdmin\<相對路徑>`。範圍：`src\`、`public\`、`docs\`、`API.md`、`DEPLOY.md`、`.env.example`、`tools\`、`package.json`；`deploy\web.config` → 站台根的 `web.config`。**不碰 `.env`、`uploads\`**。package-lock.json 有變才連 `node_modules\` 一起蓋（很大，用 robocopy）。
3. **.env 要改時**：用 `[IO.File]::ReadAllText` / `WriteAllText(..., UTF8Encoding($false))` 做 regex 取代，別用 Get-Content/Set-Content（PS 5.1 會用 CP950 讀壞中文）。改完把非密碼的 key 印出來核對。
4. **重啟**：只改 `public\`（靜態檔）不用重啟，瀏覽器重新整理即可。改了 `src\` 或 `.env` 就要重啟：跑 **`node tools/restart-prod.js`**（用本機 .env 的 ADMIN_USERNAME/ADMIN_PASSWORD 登入正式站——2026-09-08 起本機 DB 是 KioskAdminDev、正式站是 KioskAdmin，兩邊 joyeadmin 密碼目前一樣，改了任一邊要同步 → `POST /api/restart` → Node 自己結束 → run.cmd 5 秒內重拉 → 腳本會等到站台回來並印出結果）。**不要**嘗試遠端砍程序（DCOM Terminate 會被安全檢查擋）；只有在 restart API 本身壞掉時才請 user 到伺服器跑 `taskkill /F /IM node.exe`。
5. **驗證**（重啟後等 10 秒）：
   - `curl -s -o /dev/null -w "%{http_code}" https://justdisplay.justhings.com.tw/joye/admin/` → 200；`/joye/` → 301（轉到 /joye/admin/，2026-09-10 起）；`/joye/api/me` → 401；`/` → 200（入口登入頁）。
   - 看 log：`tail -20 "//192.168.1.82/D\$/WebSite/JustDisplay/KioskAdmin/logs/app-$(date +%F).log"`，要有「資料庫連線成功」（舊的 logs/server.log 只剩起停）。
   - **請求沒出現在 log ＝ 被 IIS ARR 快取吃掉**（/api 已加 no-store，正常不該再發生）。
   - 要驗中文資料一律用 `node -e` + `fetch`，**別用 Git Bash 的 curl 送中文 JSON**（會送成 Big5，存成亂碼）。
6. **打包備份**：`node tools/pack-deploy.js --full` → 桌面 `KioskAdmin.zip`（含 node_modules 要 90 秒以上，跑背景或 timeout 開大；不要用 `timeout 90` 包它）。
7. **不要主動 commit／push**，user 說了才做。

## 坑
- **正式站 Node 若還是 abdafc4 之前起的程序，沒有 `/api/restart` 路由**（2026-09-08 部署時 POST 回 404，log 顯示 `POST /joye/api/restart → 404`＝子 app 沒接到）：只能請 user 到伺服器跑 `taskkill /F /IM node.exe`，run.cmd 會自動重拉；之後才能用 restart-prod.js。
- **伺服器上的 .cmd 批次檔只能純 ASCII＋CRLF**（2026-09-10 run-sunrise.cmd 實際踩到）：cmd.exe 用 CP950 讀批次檔，UTF-8 中文的尾位元組會把換行吃掉，`rem 中文…` 那行會把下一行 `pushd` 一起吞掉，Node 就在 system32 底下找不到 src\server.js。註解用英文；寫檔用 Write 工具再用 node 轉 CRLF 複製（bash 雙引號裡的反斜線會被吃掉，別用 printf／node -e 內嵌字串）。
- 也因此 run-sunrise.cmd 把 `cd /d` 放在 `:loop` 裡面：改了批次檔不用重啟排程，下一輪就自己修好。
- Git Bash 會把 `/joye` 這類參數轉成 Windows 路徑：環境變數傳路徑時加 `MSYS_NO_PATHCONV=1`。
- 這台機器沒有可用的 `python`，腳本用 node。
- Express 的 `get('/joye')` 連 `/joye/` 也會進，轉址要先判斷 `req.path`，否則無限轉址。
- 改 `ADMIN_USERNAME` 前要先用 `node tools/set-admin.js <舊帳號> <新帳號> <新密碼>` 改 DB——**2026-09-08 起本機 .env 指向 KioskAdminDev、正式站是 KioskAdmin，DB 已分開**：要改正式站帳號得暫時把本機 DB_NAME 換成 KioskAdmin 跑，或在伺服器上跑；改完再改兩邊 .env。上傳檔資料夾仍共用（本機 .env UPLOAD_DIR 指到 82 的 uploads，正式站不設）。
- 機器 App 舊版（<1.14）沒帶 `Cache-Control: no-cache`，全靠伺服器端 no-store。
