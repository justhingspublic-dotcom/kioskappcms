# Admin Kit — 後台設計規範

整理自 TIRI 收件後台的實作（typeui「Dashboard Design System」＋多輪實測裁決），已去品牌化。做任何新後台前先讀這份；⚠️ 標示＝實測踩過的坑或被退件過的做法。

## 0. Token 紀律（最重要的一條）

- **元件碼一律 `var(--token)`，絕不手動寫死 hex。**每個顏色 token 都有 light＋dark 兩值，寫死一個色＝深色模式壞一處。
- 深色由 `<html data-color-mode="dark">` **明確啟用**（存 localStorage、⚠️ 首繪前 inline script 套用避免閃色），不走 `prefers-color-scheme` 自動跟隨——半套 token 化的頁面被 OS 翻黑會慘不忍睹。
- **無預設品牌色**：唯一色源是 `--accent`（＋`--on-accent`）。brand 家族（`--brand`/`--brand-strong`/`--brand-soft(er)`/`--fg-brand`/`--border-brand`…）由 `--accent` 用 color-mix 自動衍生。新專案只覆寫 `--accent`；`themes/tiri.css` 是完整範例。
- 語意色固定四組：brand（主動作/選中）、success、danger、warning，各有 soft/medium/strong＋fg＋border 階。

## 1. 造型

- 圓角：`--radius-sm: 4px`／`--radius-md: 10px`／`--radius-full`。欄位與控件走 `--field-radius: 10px`。
- **squircle**（iOS 連續曲率圓角）：`corner-shape: squircle` 全域漸進增強。⚠️ 圓形與膠囊元素必須排除（squircle 疊全圓角會壓成方圓形）——新增 radius-full 元素記得補進 shell.css 的排除清單。
- 陰影：預設 typeui elevation（xs 卡片、lg 浮層）。**扁平化風格**（TIRI 裁決）＝把 shadow token 全設 none，只留 `--float-shadow` 給「浮在內容上」的層（面板/下拉/菜單）；卡片、按鈕全平，深度靠 1px 邊框。
- **欄位統一參數**：所有輸入/下拉/date/select 吃同一組 `--field-height/pad-x/radius/font-size`——杜絕「某欄 41、某欄 36」對不齊。單行欄位鎖 `height`＋`line-height` 置中，不靠 padding 撐。

## 2. 文字

- 字型：Noto Sans TC webfont（各平台一致；⚠️ 別引用沒入庫的字型檔，404 三發後 Windows 默默退微軟正黑跑版）。
- **字重要冷靜**：內文/強調 400（CJK 在 500 會顯粗）、區塊標題 500、頁標題 500、數據值 600。強調靠層級與顏色，不靠加粗。
- 基準 14px；表頭 13px；KPI 值 30px。數字一律 `font-variant-numeric: tabular-nums`。
- **字級三段**（無障礙）：`html[data-fs="sm|lg"]` 根字級 15/16/18px＋`--b-fs-boost` 讓寫死 px 的元件同步縮放；由 navbar 滑桿控制、localStorage 記憶、首繪前套用。

## 3. 版面（殼層）

- 固定頂欄 64px（白底、1px 底線、無陰影）＋固定側欄 256px（白底、1px 右線）；側欄可收合成 64px icon rail（localStorage 記憶），收合時群組點開 flyout 浮窗。≤1024px 側欄變抽屜＋遮罩。
- 內容區 padding 上/左 24、右/下 8。
- **固定高模型**（opt-in `is-fixed-h`）：整頁不捲、捲動只在內部容器（`.b-tbl-scroll`）發生，thead sticky 釘住。只給「上方固定＋下方單表內滾」的頁；內容型長頁維持整頁捲。內滾容器用 `flex: 0 1 auto + min-height: 0`——資料少貼合內容高、多才封頂內滾。
- 「框內卡片堆疊」模式：外框（邊框/圓角/淡灰底）永遠完整、捲動在內層；框內 `.b-card` 去左右圓角與邊框、卡間 8–12px 細縫透出框底灰。
- 儀表板：不對稱雙欄 `2fr 1fr`（左主清單、右窄輔助）。

## 4. 動畫規範（全表）

原則：**快、只動必要屬性、可停用**。hover 過渡 .12–.15s；浮層進場 .14–.16s；佈局動畫 .28–.3s 用 `cubic-bezier(.22,1,.36,1)`（ease-out 微彈）；全部尊重 `prefers-reduced-motion`。

| 元件/情境 | 規格 |
|---|---|
| 按鈕/列/菜單項 hover | `background/color .12–.15s`，換底色或亮字，不位移不縮放 |
| 浮層（pop 面板/動作菜單/帳號下拉） | 淡入＋`translateY(-6px) scale(.98)`→定位，.16s ease；收起 .14s 反向播放 |
| 共用下拉選單（b-dd-menu） | `.14s ease-out` 淡入＋上移 4px；caret 翻轉 .18s |
| context menu | **手風琴** max-height 0→scrollHeight `.18s ease`＋opacity .16s；收合先鎖當前高再收 0 |
| flyout 浮窗 | 淡入＋上移 4px `.15s`；離場 .1s（不橫移不縮放，避免歪斜感） |
| modal（頁面級） | 兩段式：`is-visible`(display) → reflow → `is-open`(opacity .12s)。只動 opacity |
| 對話框（BDialog） | overlay .15s 淡入＋本體 .15s 淡入+`scale(.98→1)`。⚠️ .96 縮放幅度大會讓文字重柵格化「糊→利」跳一下，被退過 |
| toast | 純 CSS keyframes 一條龍：右側滑入(~.35s)→停留→滑出，總長 4.4s；多筆 stagger 0.12s；JS 只在 animationend 移除節點 |
| SPA 換頁 | 抽換主內容純 crossfade：進場 .12s 淡入；載入態（opacity .55）**只在 fetch >180ms 才出現**——多數情況直接淡入，俐落無停頓 |
| 整頁導航 | body `.18s` 淡入（⚠️ 跨文件 @view-transition 在 Chrome 觸發條件太挑，已棄用改純 CSS） |
| 側欄收合 | width `.3s cubic-bezier(.22,1,.36,1)`；menu-text opacity .18s |
| 側欄 active 切換 | 背景/文字 `.18s` 淡入淡出（SPA 下 DOM 不重建→舊 pill 淡出新 pill 淡入）；⚠️ icon 與文字**同秒數**，過快會「字先變、icon 後變」割裂 |
| 子選單手風琴 | `grid-template-rows 0fr↔1fr .28s`（標準做法：高度貼合內容、開收對稱；⚠️ max-height 寫死值會讓收起前段空轉）。markup 需包一層 `.submenu-inner` |
| segment 滑塊 | transform＋width `.28s cubic-bezier(.4,0,.2,1)`，顏色跟著補間；⚠️ 首次定位加 `.no-anim`＋強制 reflow，不要滑進來 |
| tabs underline | color/border `.15s` |
| 深淺色/字級切換 | softApply：`.b-mode-anim` 暫掛 html 500ms，全元素色彩屬性開 `.35s` transition |
| 進度長條（b-occ-fill） | width `.4s cubic-bezier(.22,1,.36,1)` |
| 表格 AJAX 篩選 | 目標容器 opacity → .5 `.15s`＋pointer-events none，換完復原 |
| 捲動邊緣 | `.is-scroll-faded` mask 漸層淡出；JS 依到頂/到底切 `at-top/at-bottom` 收掉該側（避免假截斷） |

### 動畫的坑（⚠️ 全部實測踩過）

1. **兩段式 transition 對「剛 append 的節點」無效**：display 與 opacity 同幀 → 直接跳終態。動態節點的首開動畫要改「綁 display 的 @keyframes」自動播放，不填 fill，關閉仍走 transition。
2. **開著的浮層 `transform` 要清成 `none`**：留 `scale(1)` 會建立 containing block，面板內 `position:fixed` 的下拉會相對面板定位 → 選單錯位。
3. **backdrop-filter 顯隱不可漸變**：遮罩帶 blur(1px) 時，顯示瞬間整頁像素同幀被模糊會「閃一下」。遮罩只用 rgba 壓暗。
4. **Safari sticky thead**：`border-collapse: collapse` 下會失效 → 內滾表格改 `separate` ＋ `border-spacing: 0`（視覺不變）；sticky 表頭的分隔線用 inset box-shadow 畫（border 會被裁）。
5. **oklch 相對色 Safari 支援不全**：`oklch(from … calc(c*n) h)` 無效時整段跌回原值。正式專案把算出的深色值寫死 hex。
6. **icon 動態注入要重渲染**（lucide）：下拉/菜單開啟後補呼叫 `renderLucideIcons()`；轉換完立刻拔掉殘留 `data-lucide`，否則之後每次呼叫整頁重畫。
7. **Tailwind CDN（若用）首次見到新 class 會整份重編譯**＝畫面閃一下。動態元件（對話框/toast）的 class 要在首繪 markup 裡預熱亮相。
8. **深淺色鈕的兩個 icon 都先渲染**、用 class 切換顯示，不要動態換節點。

## 5. 互動模式

- **選中（active）語言**：accent 淡底 pill（`--brand-softer`）＋accent 字。hover 語言：中性——換淺灰底或只亮字，**hover 不用 accent 底**。
- 按鈕階層：`b-btn-primary`（實色 accent）→ `b-btn`（白底框線）→ `b-btn-ghost/quiet`（透明，hover 才現形）→ `b-btn-text`（純文字，modal 主動作）。危險動作：`b-btn-danger`（實色）與 `b-btn-danger-soft`／`b-btn-text-danger`（不搶眼版）。
- 篩選鈕（`b-btn-filter`）：平時透明；已套用（is-active）只亮字不上底——「狀態」與「hover」分開表達。
- 下拉一律**漸進增強**原生 `<select>`（BDropdown）：原生保留在 DOM，表單提交/required/onchange 不變；⚠️ 尚未增強前先 `visibility: hidden` 防 FOUC；⚠️ disabled 的 select 增強後也要擋開啟。選單 `position: fixed` 逃離 overflow 裁切、空間不足自動翻上方。
- 取代原生 alert/confirm/prompt：`BDialog.confirm/alert/prompt`（Promise 介面）＋`BToast`。Esc=取消、點遮罩=取消、Tab 焦點圈、關閉還焦點。
- AJAX 局部更新（filter.js）：攔截表單只換表格區、pushState 同步網址；⚠️ 沒 JS 或抽換失敗要能降級成整頁導航。

## 6. 深色模式

- 中性色走**純灰黑**（#0F0F0F–#4D4D4D），不偏藍。
- 深色底上的 accent 家族：低彩度色可用 oklch 拉亮衍生；**高彩度品牌色（如茄紫）要反向「降彩度」**——彩度壓到原色 22%–50%、越淡的元素越灰，否則螢光刺眼（使用者原話：「深色模式下的顏色本來就應該要有一點灰度」）。
- 深色下 modal 要補一圈 `rgba(255,255,255,.12)` 外框（深卡與遮罩融在一起）。
- wordmark/logo 深色下 `brightness(0) invert(1)` 反白。

## 7. 無障礙

- skip-link、`sr-only`、`:focus-visible` 3px 高對比外框（amber）。
- 可及性狀態屬性跟著走：`aria-expanded`（下拉/收合）、`aria-selected`（tabs/segment）、`aria-haspopup`、`role="menu/alertdialog"`、toast 容器 `role="status" aria-live="polite"`。
- Esc 關閉一切浮層並還焦點；modal 開啟鎖 body 捲動；BDialog 有簡易焦點圈。
- 字級三段調整是殼層標配；全部動畫尊重 `prefers-reduced-motion`。
