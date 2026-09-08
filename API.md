# KioskAdmin API 規格 v1

第一階段（內網版）。伺服器位址以下以 `{BASE}` 代稱（例：`http://192.168.1.xx:3000`）。

> **互動式文件（Swagger UI）**：伺服器啟動後開 `{BASE}/docs`，可直接 Authorize 後 Try it out。規格檔在 `docs/openapi.yaml`，改 API 時請一併更新；伺服器啟動時會自動比對路由與規格檔，不一致會在 log 印 ⚠ 警告（只比路徑＋方法，欄位變動要自己記得改）。

**App 端與網頁端一律不得寫死位址**，都從設定值讀取，之後對外上線只要換位址。

## 身分驗證

| 呼叫者 | 方式 |
|---|---|
| 管理網頁 | `POST /api/login` 拿 token，之後帶 `Authorization: Bearer <token>`（12 小時失效） |
| kiosk 機器 | 每個請求帶 `X-Device-Key: <DEVICE_KEY>`（值在伺服器 `.env`，App 設定頁填相同值） |

## 端點

### POST /api/login
Body：`{ "username": "...", "password": "..." }` → `{ "token": "...", "user": { "username", "displayName", "isAdmin" } }`。帳密錯回 401。

### POST /api/restart（限管理員）
→ `{ "ok": true }`，0.5 秒後 Node 程序結束；正式站由 run.cmd 在 5 秒內重拉。部署後用 `node tools/restart-prod.js` 呼叫（讀 `.env` 的 ADMIN_USERNAME/ADMIN_PASSWORD 登入正式站）。

### GET /api/connection-info（限管理網頁，所有登入者）
→ `{ "serverUrl": "http://192.168.1.142:3000", "deviceKey": "..." }`
側欄底部「機器連線資訊」卡片用：`serverUrl`＝`.env` 的 `PUBLIC_URL`（要含子路徑，正式站＝`https://justdisplay.justhings.com.tw/joye`），未設定時以這次請求的 host 推算；`deviceKey`＝`.env` 的 `DEVICE_KEY`。兩者皆唯讀，更換金鑰仍在 `.env` 改並重啟（所有機器須重新輸入）。

### GET /api/devices（限管理網頁）
→ `[ { "DeviceId": "...", "DeviceName": "...", "Version": 3, "UpdatedAt": "...", "OwnerUserId": null, "OwnerName": null, "LastSeenAgoSec": 11 } ]`
**所有登入者都拿到全部機器**（2026-09-07 定案：權限只分「一般／管理員」，差別只有帳號管理）。`OwnerUserId` 欄位與 `PUT /api/devices/{id}/owner` 保留但目前不做過濾。
`LastSeenAgoSec`＝機器最後一次帶 Device Key 連線距今秒數（記憶體秒級；伺服器重啟後改用 DB 的 `LastSeenAt`，分鐘級）；null＝從沒露面。網頁以 <60 秒視為在線。
另有連線設定檢查欄位（2026-09-08）：`LastServerUrl`／`LastAppVersion`＝機器每次連線用 `X-Device-Server`／`X-App-Version` 標頭自報（App v1.13 起），`ServerMatch`＝機器填的位址是不是本站（null＝尚未回報），`KeyMismatch`＝最近一次金鑰錯誤比最近一次成功露面新（機器填錯金鑰），`LastKeyMismatchAt`。機器每台最多每分鐘寫一次 DB；存 DB 是因為測試站與正式站共用同一個 DB，正式站才看得出機器其實連在測試站。

### GET /api/me（限管理網頁）
→ `{ "username": "admin", "displayName": "系統管理員", "isAdmin": true }`（每次從 DB 讀；網頁右上角顯示 displayName，沒設就顯示 username）

### 帳號管理（限管理員）
- `GET /api/users` → `[ { "UserId", "Username", "DisplayName", "IsAdmin", "CreatedAt", "IsPrimary", "IsMe" } ]`；`IsPrimary`＝主管理員（`.env` ADMIN_USERNAME，預設 admin）、`IsMe`＝目前登入者。
- `POST /api/users` `{ username, password, displayName?, isAdmin? }`
- `PUT /api/users/{userId}` `{ displayName?, isAdmin? }`：帶哪個改哪個；主管理員與自己的 `isAdmin` 不能改（400）。
- `DELETE /api/users/{userId}`：主管理員、自己不能刪（400）。

### GET /api/config/{deviceId}/version
→ `{ "version": 3 }`（該機器沒設定過則 `0`）
kiosk 每 30–60 秒輪詢這支；版本比本機記錄的大才抓整份設定。

### GET /api/config/{deviceId}
→ `{ "version": 3, "updatedAt": "...", "config": { ... } }`；沒資料回 404。

### PUT /api/config/{deviceId}
Body：`{ "config": { ... } }` → `{ "version": 4 }`（版本自動 +1；第一次寫入為 1）
網頁存檔用這支；kiosk 第一次連上、伺服器版本為 0 時，也用這支把本機設定上傳當初始值。
**部分更新語意（淺合併）**：沒帶的頂層欄位一律沿用舊值。所以「複製/套用版面」只帶
`pages`、「套用共用設定」只帶 `chatApi`+`sleep`、網頁存檔不帶 `activePage`（機器不跳頁）。

### GET / PUT /api/shared-settings（限管理網頁，**全站一份**）
共用範本（版面清單＋客服帳號＋休眠排程＋管理 PIN），2026-09-07 定案改為全站一份、不分帳號（資料列 `UserId='_global'`）。
GET → `{ "settings": {...}|null, "updatedAt" }`；
PUT Body：`{ "settings": { "layouts": [ { "id": 1, "name": "...", "pages": [...], "screen": {...},
"createdBy": "系統管理員", "createdAt": "...", "updatedAt": "..." } ], "chatApi": {...}, "sleep": {...}, "adminPin": "..." } }`（欄位皆可省略）。
- `createdBy`／`createdAt` 由伺服器在 PUT 時對「新出現的版面 id」蓋章（＝登入者顯示名稱），網頁不用帶。
- **權限**：管理員可改全部；一般帳號的 PUT 只會套用 `sleep`（休眠排程），其他欄位一律保留現值，沒帶 `sleep` 回 403。
  對應網頁：一般帳號的版面設定只有「加入機器」（無新增／編輯／更名／刪除），機器設定只能改休眠時段。
- **搬移**：伺服器啟動時若還沒有 `_global` 列，把舊制各帳號的列合併成一份（版面全收、重新編號、建立者＝原帳號名稱；客服／休眠／PIN 以主管理員那份為準），舊列保留不刪。
**一個版面＝一頁**（`pages` 長度 1；沿用陣列格式是為了與 config 的頁面格式一致）。
（舊格式單一版面存 `pages`/`layoutScreen`/`layoutUpdatedAt`；網頁載入時自動把每頁拆成一個版面搬進 `layouts`。）
「加入機器／套用」不經伺服器特別處理——網頁端逐台 `PUT /api/config/{id}` 帶部分欄位即可；
「把版面加入機器」＝抓該機現有 `pages`、把版面頁面重新編號後附加在後面再整包 PUT（不覆蓋原頁面，上限 8 頁）。

### POST /api/upload（限管理網頁；multipart，欄位名 `file`，上限 500MB）
→ `{ "id": "...", "url": "/files/<檔名>" }`
回傳為**相對路徑**；顯示或下載時組成 `{BASE}/files/<檔名>`。

### GET /files/{檔名}
下載檔案（公開；檔名為隨機 UUID）。kiosk 從這裡把圖片/影片抓回本機快取。

### POST /api/justai/agents（限管理網頁）
Body：`{ "baseUrl": "...", "email": "...", "password": "..." }`（即 config 裡的 `chatApi`）
→ `[ { "id": "...", "name": "...", "description": "..." } ]`
伺服器代打 JustAI（登入拿 token → `GET /api/agents`）；瀏覽器直呼會被 CORS 擋。
帳密錯或連不上回 502 附中文錯誤訊息。

## config JSON 格式

同步「版面內容」＋「機器設定」（客服帳號 `chatApi`、休眠排程 `sleep`）。
**PIN 與雲端同步連線設定仍留在機器本機**。網頁「機器總覽 › 更名」只 PUT `{ "config": { "deviceName": "..." } }`，其餘欄位沿用；機器拉回後會把名稱寫進本機雲端同步設定（App v1.12 起）。PUT 時沒帶 `activePage`／`deviceName`／
`chatApi`／`sleep` 的欄位，伺服器沿用舊值（避免舊版存檔把欄位洗掉）：

```json
{
  "activePage": 0,
  "deviceName": "一樓大廳",
  "screen": { "w": 1080, "h": 1920 },
  "chatApi": { "baseUrl": "https://chat-api.justhings.ai", "email": "...", "password": "..." },
  "sleep": {
    "enabled": true, "sameEveryDay": false, "experimentalSystemSleep": false,
    "periods": [ { "day": 1, "start": 1320, "end": 480 } ]
  },
  "pages": [
    {
      "id": 1, "name": "",
      "blocks": [
        { "id": 1, "w": 1.0, "node": { "t": "cell", ...cell 欄位 } },
        { "id": 2, "w": 2.0, "node": {
            "t": "split", "dir": "Vertical", "ratio": 0.6,
            "a": { "t": "cell", ... }, "b": { "t": "cell", ... }
        }}
      ]
    }
  ]
}
```

cell 欄位（與 App 的 `LayoutTree.kt` 序列化一致）：
`bg`(Solid/Image)、`bgColor`(ARGB 十進位)、`bgImgs`(字串陣列)、`scale`(Crop/Fit)、`dur`(秒)、
`content`(None/Marquee/Weather/Text/Web/Video)、`txtColor`、`mqSpeed`、`video`、`web`、`text`、
`wAuto`/`wCounty`/`wDistrict`/`wDynBg`(天氣)、`wSrc`(Standard/Station，天氣資料來源)、
`wStUrl`(園區測站 API 網址)/`wStation`(測站代號，空＝輪播全部)、`tap`(None/OpenWeb/OpenAssistant)、`tapUrl`、
`agentId`/`agentName`/`agentAccent`(ARGB 十進位，省略=自動)/`assistantLayout`(AI 客服)。

`sleep` 欄位（與 App DataStore 的 `sleep_schedule_json` 同格式）：`periods[].day` 用
java.time 慣例（1=週一 … 7=週日）、`start`/`end` 為凌晨起算的分鐘數（0–1439）；
`start >= end` 代表跨午夜（隔日結束）。`sameEveryDay=true` 時 App 會把 7 天設成同一時段。

**媒體欄位規則**：`bgImgs` 與 `video` 的值可能是
- `content://…` 或 `file://…`：機器本機檔案（現場用 SAF 選的），網頁端顯示為「機器本機圖片」，無法預覽
- `/files/…` 或 `http(s)://…`：伺服器上的檔案，kiosk 看到後要下載到本機快取，播放一律用本機快取檔

## kiosk 同步流程

1. App 設定頁新增：伺服器位址、Device ID（預設可用裝置序號）、Device Key、同步開關
2. 開啟同步時：問 `GET version`；伺服器為 0 → `PUT` 上傳本機設定；否則走 3
3. 每 30–60 秒輪詢 `GET version`，比本機版號大 → `GET config` → 下載所有遠端媒體到快取 → 全部下載完才套用新設定（避免畫面破圖）
4. 網路斷線／下載失敗 → 繼續用目前設定，下次輪詢再試
5. 機器上管理介面若在雲端同步開啟時本機改了設定 → `PUT` 上傳（版本 +1），避免兩邊分岔

## 資料表（資料庫 `KioskAdmin`，啟動時自動建立）

```
KioskConfig: DeviceId(PK), Version, ConfigJson(nvarchar max), UpdatedAt
KioskFile:   FileId(PK), OriginalName, StoredPath, MimeType, SizeBytes, UploadedAt
```
檔案本體存伺服器 `uploads/` 資料夾，資料庫存路徑（沿用公司慣例）。
