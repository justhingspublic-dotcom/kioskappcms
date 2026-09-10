---
name: deploy-web
description: 把 KioskAdmin（JustDisplay 後台，c:\Code\KioskAdmin）部署到正式站 JTWEB2（192.168.1.82，https://justdisplay.justhings.com.tw/joye）。user 說「部署」「上正式站」「更新後台」「重啟正式站」「打包」時用。含 SMB 蓋檔、.env 改法、重啟、驗證、打包 zip 與所有踩過的坑。
---

# 部署 KioskAdmin 到正式站

## 環境事實（別重查）
- 正式站主機 **JTWEB2 = 192.168.1.82**（LAN，NAT 到公網 61.220.68.35），Windows Server 2016，IIS 反向代理 → Node :3000。
- IIS 站台 JustDisplay 實體路徑（＝部署目標）：**`D:\WebSite\JustDisplay\KioskAdmin\`**。web.config 在這層最外層。
- Node 22 免安裝版：`D:\WebSite\JustDisplay\node\node-v22.12.0-win-x64\node.exe`（系統 Node 是 16，別動）。
- 啟動：`D:\WebSite\JustDisplay\run.cmd`（無限迴圈重拉；它寫的 `D:\WebSite\JustDisplay\logs\server.log` 從 2026-09-10 起只剩起停與沒接住的 crash）；排程「KioskAdmin (JustDisplay)」開機自啟。
- **系統 log（2026-09-10 起）：`D:\WebSite\JustDisplay\KioskAdmin\logs\app-YYYY-MM-DD.log`**，一天一檔留 30 天（.env 的 LOG_LEVEL／LOG_DIR／LOG_KEEP_DAYS，沒設＝info／專案 logs/／30）。操作紀錄在 DB 表 KioskAuditLog（客戶後台**不放**頁面，user 2026-09-10 裁決）；要看用管理員 token 打 `GET /joye/api/audit?limit=50`（可加 action=config.／q=關鍵字）。
- `.env`（正式）：PORT=3000、BASE_PATH=/joye、PUBLIC_URL=https://justdisplay.justhings.com.tw/joye、PORTAL_USERNAME/PASSWORD＝根網址入口登入、ADMIN_USERNAME＝joye 主管理員。**永遠不要用本機 .env 蓋掉它。**
- 遠端存取：**SMB 管理共用 `\192.168.1.82\D$`** 讀寫檔；診斷可用 DCOM（`New-CimSession -Protocol Dcom` + `Win32_Process.Create`，指令要包成 `cmd.exe /c script > out.txt`）。WinRM 不能用（本機 shell 非提權）。帳密向 user 要（administrator），不要存進任何檔案。
- 安全檢查會擋：遠端砍程序、註冊 SYSTEM 排程、一次做太多事的腳本、把密碼寫檔。遇到就拆小步或請 user 自己做。

## 標準流程
1. **本機檢查**：`node --check src/server.js`、`node --check public/app.js`；有改 openapi.yaml 就 `node -e "require('js-yaml').load(...)"`。要實測子路徑：`MSYS_NO_PATHCONV=1 PORT=3199 BASE_PATH=/joye node src/server.js`，curl `localhost:3199/joye/`。
2. **蓋檔（SMB）**：用 PowerShell `Copy-Item` 把改過的檔案複製到 `\192.168.1.82\D$\WebSite\JustDisplay\KioskAdmin\<相對路徑>`。範圍：`src\`、`public\`、`docs\`、`API.md`、`DEPLOY.md`、`.env.example`、`tools\`、`package.json`；`deploy\web.config` → 站台根的 `web.config`。**不碰 `.env`、`uploads\`**。package-lock.json 有變才連 `node_modules\` 一起蓋（很大，用 robocopy）。
3. **.env 要改時**：用 `[IO.File]::ReadAllText` / `WriteAllText(..., UTF8Encoding($false))` 做 regex 取代，別用 Get-Content/Set-Content（PS 5.1 會用 CP950 讀壞中文）。改完把非密碼的 key 印出來核對。
4. **重啟**：只改 `public\`（靜態檔）不用重啟，瀏覽器重新整理即可。改了 `src\` 或 `.env` 就要重啟：跑 **`node tools/restart-prod.js`**（用本機 .env 的 ADMIN_USERNAME/ADMIN_PASSWORD 登入正式站 → `POST /api/restart` → Node 自己結束 → run.cmd 5 秒內重拉 → 腳本會等到站台回來並印出結果）。**不要**嘗試遠端砍程序（DCOM Terminate 會被安全檢查擋）；只有在 restart API 本身壞掉時才請 user 到伺服器跑 `taskkill /F /IM node.exe`。
5. **驗證**（重啟後等 10 秒）：
   - `curl -s -o /dev/null -w "%{http_code}" https://justdisplay.justhings.com.tw/joye/` → 200；`/joye/api/me` → 401；`/` → 200（入口登入頁）。
   - 看 log：`tail -20 "//192.168.1.82/D\$/WebSite/JustDisplay/KioskAdmin/logs/app-$(date +%F).log"`，要有「資料庫連線成功」（舊的 logs/server.log 只剩起停）。
   - **請求沒出現在 log ＝ 被 IIS ARR 快取吃掉**（/api 已加 no-store，正常不該再發生）。
   - 要驗中文資料一律用 `node -e` + `fetch`，**別用 Git Bash 的 curl 送中文 JSON**（會送成 Big5，存成亂碼）。
6. **打包備份**：`node tools/pack-deploy.js --full` → 桌面 `KioskAdmin.zip`（含 node_modules 要 90 秒以上，跑背景或 timeout 開大；不要用 `timeout 90` 包它）。
7. **不要主動 commit／push**，user 說了才做。

## 坑
- Git Bash 會把 `/joye` 這類參數轉成 Windows 路徑：環境變數傳路徑時加 `MSYS_NO_PATHCONV=1`。
- 這台機器沒有可用的 `python`，腳本用 node。
- Express 的 `get('/joye')` 連 `/joye/` 也會進，轉址要先判斷 `req.path`，否則無限轉址。
- 改 `ADMIN_USERNAME` 前要先用 `node tools/set-admin.js <舊帳號> <新帳號> <新密碼>` 改 DB（DB 與本機測試站共用），再改兩邊 .env。
- 機器 App 舊版（<1.14）沒帶 `Cache-Control: no-cache`，全靠伺服器端 no-store。
