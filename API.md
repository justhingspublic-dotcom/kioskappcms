# KioskAdmin API 規格 v1

第一階段（內網版）。伺服器位址以下以 `{BASE}` 代稱（例：`http://192.168.1.xx:3000`）。
**App 端與網頁端一律不得寫死位址**，都從設定值讀取，之後對外上線只要換位址。

## 身分驗證

| 呼叫者 | 方式 |
|---|---|
| 管理網頁 | `POST /api/login` 拿 token，之後帶 `Authorization: Bearer <token>`（12 小時失效） |
| kiosk 機器 | 每個請求帶 `X-Device-Key: <DEVICE_KEY>`（值在伺服器 `.env`，App 設定頁填相同值） |

## 端點

### POST /api/login
Body：`{ "password": "..." }` → `{ "token": "..." }`。密碼錯回 401。

### GET /api/devices（限管理網頁）
→ `[ { "DeviceId": "...", "Version": 3, "UpdatedAt": "..." } ]`

### GET /api/config/{deviceId}/version
→ `{ "version": 3 }`（該機器沒設定過則 `0`）
kiosk 每 30–60 秒輪詢這支；版本比本機記錄的大才抓整份設定。

### GET /api/config/{deviceId}
→ `{ "version": 3, "updatedAt": "...", "config": { ... } }`；沒資料回 404。

### PUT /api/config/{deviceId}
Body：`{ "config": { ... } }` → `{ "version": 4 }`（版本自動 +1；第一次寫入為 1）
網頁存檔用這支；kiosk 第一次連上、伺服器版本為 0 時，也用這支把本機設定上傳當初始值。

### POST /api/upload（限管理網頁；multipart，欄位名 `file`，上限 500MB）
→ `{ "id": "...", "url": "/files/<檔名>" }`
回傳為**相對路徑**；顯示或下載時組成 `{BASE}/files/<檔名>`。

### GET /files/{檔名}
下載檔案（公開；檔名為隨機 UUID）。kiosk 從這裡把圖片/影片抓回本機快取。

## config JSON 格式

只同步「版面內容」，不含 PIN、chat 帳密、睡眠排程（那些留在機器本機）：

```json
{
  "activePage": 0,
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
`wAuto`/`wCounty`/`wDistrict`/`wDynBg`(天氣)、`tap`(None/OpenWeb/OpenAssistant)、`tapUrl`、
`agentId`/`agentName`/`agentAccent`/`assistantLayout`(AI 客服)。

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
