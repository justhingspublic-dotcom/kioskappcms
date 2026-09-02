# Admin Kit — 後台模組

自 TIRI 收件後台抽出的**通用後台設計系統**（typeui「Dashboard Design System」＋歷次實測裁決），已去品牌化：**無預設品牌色**，覆寫一個 `--accent` 即完成換皮。給未來任何網站的後台直接鋪殼用。

## 內容

```
admin-kit/
├── css/
│   ├── tokens.css       # 設計 token（light＋dark 雙值、accent 家族 color-mix 衍生、
│   │                    #   radius/shadow/glint、--field-* 欄位統一參數、字級三段）
│   ├── shell.css        # 後台外殼：頂欄/側欄(收合/手風琴/浮窗)/主內容/固定高模型/
│   │                    #   SPA crossfade/深淺切換過場/RWD/無障礙
│   ├── components.css   # 元件：按鈕家族/欄位/自訂下拉/表格(sticky thead)/badge/
│   │                    #   segment 滑塊/tabs/卡片/KPI/空狀態/alert/分頁/modal(soft·alert)/
│   │                    #   toast/pop 面板/動作菜單/context menu/進度條/捲動淡出/字重階
│   └── themes/
│       └── tiri.css     # 範例主題：TIRI 茄紫＋扁平化＋深色降彩。新後台複製一份改值
├── js/
│   ├── kit.js           # 殼層互動（零依賴）：側欄/帳號下拉/深淺色/字級/b-pop/BModal/
│   │                    #   segment 滑塊/tabs；掛勾見檔頭總表
│   ├── dropdown.js      # BDropdown：漸進增強原生 <select>（提交/required/onchange 不變）
│   ├── dialogs.js       # BDialog.confirm/alert/prompt（Promise）＋ BToast（右下角）
│   ├── context-menu.js  # BContextMenu：指標旁手風琴選單
│   ├── filter.js        # 篩選 AJAX 局部更新（form[data-filter-form] → [data-filter-target]）
│   └── scroll-fade.js   # ScrollFade：.is-scroll-faded 捲動邊緣漸層
├── GUIDELINES.md        # 設計規範全文（token 紀律、動畫規格表、⚠️ 坑清單）
├── demo.html            # 完整後台殼展示頁（瀏覽器直接開；右上可切深淺色/字級/TIRI 主題）
└── README.md
```

## 快速開始

```html
<head>
  <!-- ①（必要）深淺色＋字級偏好首繪前套用，避免閃色 -->
  <script>(function(){try{
    if(localStorage.getItem('adminColorMode')==='dark')document.documentElement.setAttribute('data-color-mode','dark');
    var fs=localStorage.getItem('adminFontSize');
    if(fs==='sm'||fs==='lg')document.documentElement.setAttribute('data-fs',fs);
  }catch(e){}})();</script>

  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/tokens.css">
  <link rel="stylesheet" href="css/shell.css">
  <link rel="stylesheet" href="css/components.css">
  <!-- ②（可選）主題：或自己在後載樣式覆寫 --accent -->
  <link rel="stylesheet" href="css/themes/tiri.css">
</head>
<body>
  <!-- 殼層 markup 直接照 demo.html 抄：top-header ＋ sidebar ＋ sidebar-overlay ＋ main.main-content -->
  ...
  <script src="https://unpkg.com/lucide@latest"></script>  <!-- 可選：icon -->
  <script src="js/kit.js"></script>
  <script src="js/dropdown.js"></script>
  <script src="js/dialogs.js"></script>
  <!-- 需要才載：context-menu.js / filter.js / scroll-fade.js -->
</body>
```

## 換品牌（唯一必做的事）

```css
:root { --accent: #0f6b4f; --on-accent: #fff; }
```

brand 家族（softer/soft/medium/strong/fg/border）自動由 color-mix 衍生。**深色模式注意**：預設用 oklch 拉亮衍生，只適合低彩度色；高彩度品牌色要另外寫死「降彩度」的深色家族（做法照 `themes/tiri.css`，⚠️ Safari 對 oklch relative color 支援不全，值要預算成 hex）。

## JS API 速查

| API | 用途 |
|---|---|
| `BModal.open(sel) / close(sel)` | 兩段式 modal；`[data-modal-open="#id"]`／`[data-modal-close]` 免寫 JS |
| `BDialog.confirm/alert/prompt(opts) → Promise` | 取代原生對話框（variant: 'danger'\|'warn'） |
| `BToast.success/danger/warning(msg)` | 右下角 toast，CSS 動畫自播自移除 |
| `BDropdown.init(root) / refresh(select) / syncAll(root)` | 動態注入的 select 增強/重建 |
| `BContextMenu.open({x, y, items, onSelect, anchorEl})` | 指標旁動作選單 |
| `bSegThumb(seg, animate)` | segment 滑塊重定位；選項換分類發 `segment:change` |
| `softApply(fn)` | 換色/換字級時的 500ms 柔和過場 |
| `ScrollFade.scan(root)` | 動態內容後重掃 `.is-scroll-faded` |
| `renderLucideIcons()` | 動態注入 `<i data-lucide>` 後重渲染 |

## 沒收進來的東西（要用回 TIRI 後台抄）

- SPA 殼層（`server/static/js/cms/spa.js`：攔連結只抽換 `#main-content`）——依賴 Jinja 模板標記註解，通用化成本高；CSS 端的 crossfade（`.is-spa-loading`/`.is-spa-entered`）已在 shell.css，接上任何 SPA 邏輯即可用。
- 頁面級固定高版型（checkin 雙欄、theme 預覽、manual 目錄 scrollspy、slots 格子表）——模式已寫進 GUIDELINES §3（框內卡片堆疊/內滾容器），markup 參考 `server/static/css/cms/b_admin.css` 對應段落。
- 使用說明 modal（guide.css）與 Tailwind CDN 整合設定（`server/templates/base.html`）。

## 注意

- 改元件前先讀 `GUIDELINES.md`——特別是 §4 動畫規格表與 ⚠️ 坑清單（浮層 transform 要清 none、動態節點首開動畫用 keyframes、遮罩不可帶 blur、Safari sticky thead…）。
- 這包是**抽出的副本**：TIRI 收件後台仍以 `server/static/` 為準，兩邊不自動同步。
