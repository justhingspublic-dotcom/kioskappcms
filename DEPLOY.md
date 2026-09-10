# KioskAdmin 部署說明（Windows Server + IIS 反向代理）

解壓後的內容直接放在 IIS 站台根目錄（例如 `D:\WebSite\JustDisplay`），不要再多一層。

## 內容
- `src/` `public/` `docs/`：程式、管理網頁、Swagger 文件（/docs）
- `node_modules/`：已附，伺服器不用 npm install（需 Node.js 18 以上，本機打包用 22）
- `web.config`：IIS 反向代理設定，要在站台根目錄最外層
- `start.cmd`：手動啟動測試用
- `.env.example`：環境變數範本（真正的 `.env` 伺服器自己建，更新時不會被覆蓋）
- `uploads/`：只有第一次部署的包才附；之後更新的包不含，伺服器上的不會被動到

## 第一次部署
1. 解壓到站台根目錄。
2. 複製 `.env.example` 為 `.env`，填入：
   - `DB_HOST` `DB_USER` `DB_PASSWORD`（公司 MSSQL，確認這台伺服器連得到）
   - `ADMIN_PASSWORD`：後台 admin 密碼（首次啟動建帳號用）
   - `DEVICE_KEY`：機器連線金鑰（機器端要填一樣的；沿用原本的值，不然已連線的機器要全部重填）
   - `BASE_PATH`：後台掛的子路徑，正式站填 `/joye`（根網址＝各後台的入口清單頁；留空＝掛在根）。
     2026-09-10 起後台網頁在 `{BASE_PATH}/admin/`，API 與圖片仍在 `{BASE_PATH}/api`、`{BASE_PATH}/files`（機器填的位址不變）；`{BASE_PATH}/` 會轉到 `/admin/`
     純顯示播放頁在 `{BASE_PATH}/play/?device=機器名&key=金鑰`（沒有 App 的機器用瀏覽器 kiosk 模式開；後台側欄「機器連線資訊」可複製）；
     .env 設 `PLAY_DEFAULT_DEVICE=展示機` 後網址可不帶機器名（所有螢幕同一網址＝同一台機器），金鑰帶過一次瀏覽器會記住
   - 登入工作階段存在資料表 KioskSession（2026-09-10）：部署重啟不會把登入者踢出
   - `PORTAL_USERNAME` / `PORTAL_PASSWORD`：根網址入口清單頁前面那層登入的帳密（留空＝不擋）
   - `PUBLIC_URL`：對外網址，要含子路徑，正式站＝`https://justdisplay.justhings.com.tw/joye`（顯示在後台側欄「機器連線資訊」，機器就填這個）
   - `SITE_NAME` / `SITE_LOGO`：客戶名稱與登入頁 logo（沒設＝卓也小屋／img/joye-logo.png；第二個站台如 sunrise 設 `SITE_NAME=揚昇高爾夫球場`、`SITE_LOGO=` 留空）
   - `SITE_LOGO_SHAPE`：登入頁 logo 框 wide／square（揚昇＝square）；`PARK_API_URL`：站台的園區測站 API（joye 設卓也那支；揚昇不設＝不預填）
   - `SITE_THEME`：站台主題色檔 `public/themes/<名稱>.css`（sunrise 設 `SITE_THEME=sunrise` ＝綠 #2E6F40；沒設＝藍）
   - `PORTAL_SITES`：根網址入口清單的卡片「路徑=名稱;…」，只在送出根網址的實例（joye，port 3000）設
   - `PORT=3000`（第二個站台用別的埠，IIS web.config 依子路徑轉給對應的埠）
   - `LOG_LEVEL=info`（系統 log 等級；檔案寫在 `logs/app-YYYY-MM-DD.log`，一天一檔、預設留 30 天，可用 `LOG_DIR`／`LOG_KEEP_DAYS` 調整）
3. 先手動測：執行 `start.cmd`，看到「資料庫連線成功」，瀏覽器開 http://localhost:3000/admin/ 能登入。
4. 做成常駐服務（擇一）：
   - NSSM：`nssm install KioskAdmin "C:\Program Files\nodejs\node.exe" "D:\WebSite\JustDisplay\src\server.js"`，
     Startup directory 設 `D:\WebSite\JustDisplay`，然後 `nssm start KioskAdmin`。
   - pm2：`npm i -g pm2 pm2-windows-startup`、`pm2 start src/server.js --name KioskAdmin`、`pm2 save`、`pm2-startup install`。
5. IIS：站台實體路徑指到這個資料夾，主機名稱填網域，443 繫結選憑證。
   URL Rewrite 與 ARR 要裝好、ARR 的 Enable proxy 要勾，不然開網域會是 403/404。
6. 網域 DNS 指向這台後，瀏覽器開網域看到登入頁即完成；機器端「設定 → 雲端同步」填 PUBLIC_URL 與 DEVICE_KEY。

## 之後更新
1. 停掉服務（`nssm stop KioskAdmin` 或 `pm2 stop KioskAdmin`）。
2. 把新的 zip 解壓覆蓋到同一個資料夾（`.env`、`uploads/` 不在包裡，不會被動到）。
3. 重新啟動服務。

## 注意
- 防火牆只需開 80/443，3000 不用對外。
- `uploads/` 之後會持續長大，備份時記得含它。
- `logs/`：系統 log，一天一檔自動清舊檔；出問題先看今天那檔（`run.cmd` 的 `server.log` 只剩起停與沒接住的 crash）。
- 操作紀錄（誰在後台做了什麼）存 DB 表 `KioskAuditLog`、機器事件（App 啟動／閃退／同步／休眠）存 `KioskDeviceEvent`；後台沒有頁面，用管理員 token 打 `GET /api/audit`、`GET /api/devices/{id}/events` 或直接下 SQL 查。保留天數 `AUDIT_KEEP_DAYS`（180）／`DEVICE_EVENT_KEEP_DAYS`（90）。
