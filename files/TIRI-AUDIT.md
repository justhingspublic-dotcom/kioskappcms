# TIRI 對齊稽核 — 待處理清單

> 2026-09-03 多代理稽核（10 個領域）產出。broken 級與多數 visual-major 已修；
> 本檔是留給「逐頁調 UI」時的比對清單。來源：tiri repo（scratchpad clone）。

## 大項（visual-major，僅剩這條未做）

### Segment 滑塊（.b-seg.is-pill）
Segmented controls don't follow the tiri segment treatment. tiri's ruling (base.html shell styles, used by inbox tabs) is `.b-seg.is-pill`: white container, 1px border, radius 10, 5px padding; items radius 6 with 7px 18px padding; active shown by a SLIDING thumb (kit.js bSegThumb, .28s cubic-bezier) that in light mode is `--brand-softer` with `--fg-brand` text (solid brand + white text only for the `.is-thumb-solid` main item; dark mode = solid + white). Ours: `.seg-row` (ws-tabs 版面/機器設定, cell-panel 背景/內容 pickers, sleep 每日相同/分星期) uses the kit's plain non-pill style — grey `--neutral-secondary-soft` container, 3px padding, radius-sm items with 6px 14px padding, and light-mode active is instant solid orange + white with no thumb and no slide animation (app.js segRow rebuilds the row on click, so nothing can animate). The result looks and feels clearly different from tiri: hard color jump instead of the signature gliding soft pill. (.page-tabs partially adopted the container geometry — white bg/5px/6px — but also lacks the thumb and uses solid active in light mode.)

**修法**：Port the tiri seg block from admin-kit/css/themes/tiri.css:54-62 (+ dark rules 81-83) into style.css and switch .seg-row/.ws-tabs to `b-seg is-pill` markup with a `.b-seg-thumb` span (kit.js already auto-inits and ships window.bSegThumb). For rows re-rendered by app.js, toggle the .active class in place (or call bSegThumb after rerender) instead of rebuilding the row, so the thumb can slide. Light-mode active = brand-softer thumb + fg-brand text; keep solid+white for dark mode (already correct at style.css:77).

## visual-minor（26 條）

### M1
Loading/success state sequencing diverges from tiri, so the signature fill animation is barely visible in practice. (a) Tiri enforces a minimum 500ms crawl (Math.max(0, 500 - elapsed)) before resolving so the 55% crawl is seen even on fast responses; ours resolves immediately, so on a LAN-fast /api/login the fill jumps 0→55%→100% in one blink. (b) Tiri keeps is-loading while adding is-success (button stays pointer-events:none with bg locked until redirect); ours removes is-loading before adding is-success, re-enabling hover/click on the button during the 320ms fill-and-switch window.

**修法**：Record const started = Date.now() before the fetch; after it resolves, await new Promise(r => setTimeout(r, Math.max(0, 500 - (Date.now() - started)))) before branching. On success add is-success WITHOUT removing is-loading; remove both classes only after enterMain() has swapped the view (matching tiri's keep-locked-until-navigate behavior).

**參考**：tiri templates/login.html lines 161-199 (started/wait logic, is-success added on top of is-loading); static/css/cms/login.css .btn-login.is-loading lines 440-453｜ours c:/Code/KioskAdmin/public/app.js lines 51-65

### M2
Submit button content differs from tiri: tiri renders a log-in lucide icon + <span>登入</span> and swaps the label to 「登入中…」 while is-loading (restoring 「登入」 on failure); ours is a bare text-only <button>登入</button> whose label never changes, so during the crawl there is no textual processing cue.

**修法**：Change markup to <button type="submit" class="btn-login"><i data-lucide="log-in"></i><span>登入</span></button>; in the handler set the span text to 登入中… when adding is-loading and back to 登入 in the catch branch.

**參考**：tiri templates/login.html lines 86-89 (button markup) and 166-198 (label.textContent swap)｜ours c:/Code/KioskAdmin/public/index.html line 44; c:/Code/KioskAdmin/public/app.js lines 50-68

### M3
Password field lacks tiri's show/hide visibility toggle: tiri wraps the input in .password-wrapper with a 32px .login-password-toggle eye/eye-off button (input padding-right 44px, hover bg neutral-secondary-medium, aria-pressed swap); our password input is bare.

**修法**：Wrap the #password input in <div class="password-wrapper"> with the toggle button (data-password-toggle), port the .password-wrapper/.login-password-toggle rules from tiri login.css into style.css, add padding-right:44px to that input, and port the eye/eye-off click handler.

**參考**：tiri templates/login.html lines 67-83 and 201-212 (toggle JS); static/css/cms/login.css .password-wrapper/.login-password-toggle lines 231-234, 284-307｜ours c:/Code/KioskAdmin/public/index.html lines 41-43; c:/Code/KioskAdmin/public/style.css (no toggle styles in login section, lines 79-148)

### M4
Form field labels lack tiri's leading icons: tiri .form-label is a flex row (gap 7px) with a 15px subtle-colored lucide icon (mail / lock-keyhole) before the text; our .b-label is plain text (帳號 / 密碼) with no icon, so the fields read flatter than tiri's.

**修法**：Add <i data-lucide="user-round"></i> / <i data-lucide="lock-keyhole"></i> inside the labels and add a login-scoped rule mirroring tiri: label as inline-flex, gap 7px, with :where(i,svg){width:15px;color:var(--text-body-subtle)}.

**參考**：tiri templates/login.html lines 49-52, 63-66; static/css/cms/login.css .form-label lines 215-229｜ours c:/Code/KioskAdmin/public/index.html lines 38-43

### M5
Card title is oversized versus tiri's rendered login: our .login-title is 1.55rem — copied from tiri's .login-panel-head h2, a style the actual login page never renders — while tiri's brand lockup title (.login-brand-title, the element ours structurally mirrors: mark + h1 + sub) is 1.35rem with the sub at .92rem / margin-top 5px. Ours also uses 14px sub with margin-top 8px.

**修法**：Set .login-title { font-size: 1.35rem; margin: 3px 0 0; } and .login-sub { font-size: .92rem; margin: 5px 0 0; } to match the login-card-brand lockup ours mirrors.

**參考**：tiri static/css/cms/login.css .login-brand-title lines 142-150, .login-brand-sub lines 152-157 (vs .login-panel-head h2 lines 190-196); templates/login.html lines 38-44｜ours c:/Code/KioskAdmin/public/style.css lines 118-119

### M6
Our .login-wrap is position:fixed with overflow:hidden, so on short viewports (e.g. landscape phone ~375px tall; the card is ~445px) the centered card is clipped top AND bottom with no way to scroll — the submit button becomes unreachable by touch. Tiri's login page scrolls normally (min-height:100vh flex, only overflow-x hidden) and additionally steps padding down responsively (page 16px / panel 28px at ≤860px; page 12px / panel 22px at ≤520px), which ours lacks entirely.

**修法**：Change .login-wrap to overflow-x:hidden; overflow-y:auto and add the two breakpoints: @media (max-width:860px){.login-wrap{padding:16px}.login-card{padding:28px}} and @media (max-width:520px){.login-wrap{padding:12px}.login-card{padding:22px}.login-mark{width:52px;height:52px}}.

**參考**：tiri static/css/cms/login.css .login-page lines 21-30 (overflow-x only), media queries lines 494-550｜ours c:/Code/KioskAdmin/public/style.css lines 81-86, 103-109 (no login media queries; only @media max-width:1100px for the editor at line 441)

### M7
Dropdown menu and item geometry is inflated vs tiri: menu padding 6px vs tiri 4px, menu max-height 320px vs tiri 280px, item padding 10px 12px vs tiri 8px 10px (tiri's cms/b_admin.css has no admin-side override of these, so 4px/280px/8px-10px is the effective tiri admin look). Each option row is ~4px taller and the open menu reads chunkier than tiri's. Side effect: the JS flip-above threshold is still `spaceBelow < 260` (copied from tiri), so with max-height 320 a long menu placed below can run up to ~60px past the viewport bottom (tiri's worst case was 20px). Also trivial: trigger right padding is 12px vs tiri's effective 10px (tiri's .main-content override only replaces top/bottom/left padding, keeping the base 10px right).

**修法**：In components.css set .b-dd-menu { padding: 4px; max-height: 280px; } and .b-dd-item { padding: 8px 10px; }; change trigger padding to `padding: 0 10px 0 var(--field-pad-x)` to match tiri's asymmetric caret inset. If the larger 320px menu is kept instead, raise the flip threshold in dropdown.js positionMenu from 260 to ~300 so the menu can't overflow the viewport bottom.

**參考**：tiri static/css/b/dropdown.css:41-67 (.b-dd-menu padding:4px, max-height:280px; .b-dd-item padding:8px 10px; .b-dd-trigger padding:8px 10px 8px 12px) + cms/b_admin.css:999-1003 (.main-content .b-dd-trigger overrides height/left-pad only)｜ours c:/Code/KioskAdmin/public/admin-kit/css/components.css:155-176 (menu padding:6px, max-height:320px; item padding:10px 12px; trigger padding:0 var(--field-pad-x)=12px both sides)

### M8
Open menu is anchored 8px from the trigger instead of tiri's 4px, so every dropdown menu floats 4px lower (or 4px higher when flipped above) than the reference. Our code comment justifies 8px as matching the header account menu, but tiri itself uses 8px for the account menu and deliberately 4px for select dropdowns.

**修法**：Change both offsets in positionMenu back to 4 (`r.bottom + 4` and `window.innerHeight - r.top + 4`) and drop the alignment comment.

**參考**：tiri static/js/b/dropdown.js:51,54 (positionMenu: r.bottom + 4 / window.innerHeight - r.top + 4)｜ours c:/Code/KioskAdmin/public/admin-kit/js/dropdown.js:52,55 (+ 8 in both branches)

### M9
style.css re-adds `backdrop-filter: blur(1px)` to every .b-modal-overlay (comment claims this aligns with tiri), but tiri's final theme layer explicitly removes it: brand.css sets `.b-modal-overlay { backdrop-filter: none !important; }` because backdrop-filter cannot fade with the overlay's opacity transition — the blur snaps in the instant the overlay displays, which reads as a whole-page flicker every time a BDialog confirm/alert/prompt (or any modal) opens. That is the exact defect tiri fixed; our comment was written against the raw kit value in b_admin.css (line 1155), not the final brand.css decision. In tiri the rendered overlay has NO blur.

**修法**：Delete the backdrop-filter rule at style.css:403 so overlays keep only the rgba(0,0,0,.5) dim, matching tiri's final look and removing the open-flicker on every dialog.

**參考**：tiri static/css/brand.css lines 47-51 (`.b-modal-overlay { backdrop-filter: none !important; }` with the flicker rationale); the blur being killed comes from static/css/cms/b_admin.css line 1155｜ours c:/Code/KioskAdmin/public/style.css line 403 (`.b-modal-overlay { backdrop-filter: blur(1px); -webkit-backdrop-filter: blur(1px); }`)

### M10
pickDevicesDialog's close() unconditionally removes `body.b-modal-lock`, but the dialog is always opened on top of the workspace modal, which added that lock (openWsModal, app.js:112). After cancelling/confirming the picker, the background page scroll unlocks while the workspace modal is still open — the page behind the modal becomes scrollable, unlike tiri where dialogs.js only unlocks after checking no other .b-modal-overlay is visible (anyModalShown()).

**修法**：Guard the unlock the same way dialogs.js does: only remove `b-modal-lock` when no visible `.b-modal-overlay` remains (e.g. copy the anyModalShown() check — iterate document.querySelectorAll('.b-modal-overlay') and skip the unlock if any has offsetParent/getClientRects).

**參考**：tiri static/js/cms/dialogs.js lines 107-114 (anyModalShown) and line 213 (`if (!openDialogs.length && !anyModalShown()) document.body.classList.remove('b-modal-lock')`)｜ours c:/Code/KioskAdmin/public/app.js line 1295 (`document.body.classList.remove('b-modal-lock')` inside pickDevicesDialog's fin())

### M11
Font-size panel clips off the right edge of the viewport on narrow screens. The panel is 200px wide and anchored left:0 to the Aa button (tiri's deliberate 'open rightward' choice). In tiri the Aa button has four more controls to its right (mode, separator, external-link, help, user), so there is always ~300px of room. Our header only has mode + user to the right of Aa, so at <=480px (user name hidden, 16px header padding, 14px gaps) the space from the Aa button's left edge to the viewport edge is ~180px and the last ~20px of the panel — including the '特大' mark — is cut off (the fixed header does not scroll, so it is clipped, not scrollable).

**修法**：Add a narrow-screen override in style.css: @media (max-width: 560px) { .header-fs-panel { left: auto; right: 0; transform-origin: top right; } } (or give the panel max-width: calc(100vw - 32px)).

**參考**：tiri b_admin.css:1762-1766 (.header-fs-panel left:0, width:200px — safe in tiri's wider header, base.html:141-175 button row)｜ours admin-kit/css/shell.css:180-185 (.header-fs-panel) + index.html:56-70 (header-right has only 3 controls)

### M12
Scroll-lock leak: pickDevicesDialog's close() removes body.b-modal-lock unconditionally, but the dialog is opened on top of the still-open workspace modal (複製版面到其他機器). After the pick dialog closes, background page scrolling is unlocked for the rest of the workspace session — the page behind can scroll via scroll chaining and the body scrollbar reappears, shifting the whole backdrop/modal by the scrollbar width. The kit convention keeps the lock while any other modal is still shown (dialogs.js anyModalShown() guard; kit.js same).

**修法**：Copy the guard from dialogs.js: in pickDevicesDialog's fin(), only remove b-modal-lock when no other .b-modal-overlay is currently shown (offsetParent !== null || getClientRects().length > 0 check across all overlays).

**參考**：tiri admin-kit/js/dialogs.js:207-216 (fin only unlocks 'if (!openDialogs.length && !anyModalShown())'), kit.js:296-301; b_admin.css:1180 (body.b-modal-lock)｜ours public/app.js:1290-1296 (fin unconditionally removes b-modal-lock at line 1295)

### M13
Backdrop blur is anti-parity: style.css re-adds backdrop-filter: blur(1px) to every .b-modal-overlay with a comment claiming it aligns with tiri, but tiri's final theme layer explicitly removes the kit's blur (backdrop-filter: none !important) precisely because backdrop-filter cannot fade — the whole page blurs in one frame at modal open, reading as a flicker/jolt ('開 alert 畫面閃爍'). Tiri's rendered modals have a plain rgba(0,0,0,.5) dim only; ours reintroduces the removed blur and its open-flicker on the workspace modal, every BDialog, and the pick-devices dialog.

**修法**：Delete the .b-modal-overlay backdrop-filter rule at style.css:402-403 (admin-kit/css/components.css already ships the correct blur-free overlay matching tiri's final state).

**參考**：tiri static/css/brand.css:47-51 (.b-modal-overlay { backdrop-filter: none !important; } with rationale); b_admin.css:1155 (the kit default it overrides)｜ours public/style.css:402-403

### M14
pickDevicesDialog does no focus management, unlike the kit dialogs it imitates: no initial focus (dialogs.js focuses the OK button/input), no Tab trap (dialogs.js:278-286 keeps Tab inside the dialog), no focus restore on close (dialogs.js:217-219), and no aria-labelledby wiring. Concretely: after clicking 複製版面到其他機器, focus stays on that button beneath the dialog — pressing Enter re-fires the handler and stacks a second pick-devices dialog on top of the first, and Tab wanders through the obscured workspace modal.

**修法**：Mirror dialogs.js: give the h2 an id and set aria-labelledby on the modal; after appending the overlay, setTimeout(() => okBtn.focus(), 0); record document.activeElement before opening and restore it in close(); add the same Tab focus-loop keydown on the dialog root (or reuse the capture keydown added for Esc).

**參考**：tiri admin-kit/js/dialogs.js:137, 217-219, 264-265, 278-286 (tiri kit dialog conventions: aria-labelledby, focus target on open, Tab loop, restore prevFocus)｜ours public/app.js:1221-1315 (no focus/aria code); stacking repro via app.js:1177-1200

### M15
Settings cards (共用設定 › 機器設定 and the workspace 機器設定 tab) title an h3.settings-card-title at 15px / font-weight 700 / color --text-body placed inside .b-card-body. tiri's card-title convention is a .b-card-head (16px/20px padding, 1px bottom border) containing .b-card-title at 16px, --text-heading, effective weight 500 via the calm-weight scale (--b-font-section) — nothing in tiri's main content ever renders at 700; the kit's own charter says 強調靠層級不靠粗細. The bold-but-small, dimmer title reads clearly off-system next to every other card.

**修法**：In settingsCard(), emit tiri's structure: card.appendChild(<div class="b-card-head"><h3 class="b-card-title">title</h3></div>) followed by the .b-card-body with the .group; delete the .settings-card-title rule (or restyle it to 16px / 500 / var(--text-heading) if the head-divider structure is not wanted).

**參考**：tiri static/css/cms/b_admin.css:826-827 (.b-card-head/.b-card-title), b_admin.css:1447-1461 (--b-font-section clamp), templates/settings.html:120 (b-card-head > b-card-title usage)｜ours c:/Code/KioskAdmin/public/style.css:379 (.settings-card-title), c:/Code/KioskAdmin/public/app.js:1370-1386 (settingsCard builds h3.settings-card-title inside .b-card-body)

### M16
The workspace modal (#wsModal, explicitly modeled on tiri's mail-open modal) is mounted as a sibling of <main> instead of inside it. tiri's #inbox-modal lives inside {% block content %} within .main-content, so it inherits the main-content typography clamp and the [data-fs] font-size boosts. Ours therefore renders the modal title at 600 instead of tiri's 500, and — more feel-able — the header font-size preference (中/大/特大) resizes every page but has zero effect on the entire workspace editor/settings inside the modal (b-btn, b-label, b-modal-body content stay fixed px), since every boost rule is scoped [data-fs] .main-content ….

**修法**：Move the #wsModal markup inside <main id="main-content"> (last child), matching inbox.html — the overlay is position:fixed so layout is unaffected; or, if it must stay at body level, add style.css rules mirroring the scoped ones for .b-modal.is-ws (title font-weight 500 and [data-fs] .b-modal.is-ws .b-btn/.b-label/.b-modal-body { font-size: calc(…px + var(--b-fs-boost)) }).

**參考**：tiri templates/inbox.html:312/411 (#inbox-modal inside block content → inside .main-content), static/css/cms/b_admin.css:1707-1715 ([data-fs] .main-content boosts), b_admin.css:1449-1450 (.main-content .b-modal-title → 500)｜ours c:/Code/KioskAdmin/public/index.html:196-251 (#wsModal sibling of <main id="main-content">), c:/Code/KioskAdmin/public/admin-kit/css/components.css:620/627-636 (main-content-scoped clamps and boosts)

### M17
Accordion state is never synced on navigation, unlike tiri. tiri's spa.js syncNav recomputes open groups on every page change: navigating to a top-level page closes any open group, and landing on a group page auto-opens that group (single-open), also closing the flyout. In ours, clicking 機器總覽 leaves 共用設定 expanded, and reaching a shared page without using the toggle (e.g., via the collapsed-rail flyout once fixed) leaves the group closed after re-expanding the sidebar where tiri would show it open.

**修法**：At the end of switchView, mirror syncNav: for each .submenu-toggle, const sub = toggle.nextElementSibling; const on = !!(sub && sub.querySelector('.nav-item.active')); toggle.classList.toggle('open', on); sub && sub.classList.toggle('show', on); and close any open flyout (expose a kit.js helper such as window.kitCloseFlyout, since the flyout variable is private to kit.js).

**參考**：tiri static/js/cms/spa.js lines 93-99 (openMenus recomputed per nav; flyout.open=false) and templates/base.html created() lines 508-514｜ours c:/Code/KioskAdmin/public/app.js switchView lines 1577-1590 (only toggles .active on .nav-item; never touches .open/.show)

### M18
Dark mode: the parent-highlight-when-closed pill keeps the light-mode style. In tiri dark, a closed/collapsed group containing the active page renders as solid --brand with white text (the toggle carries both .menu-item and .active, so the dark override hits it). Ours' toggle never receives .active — the highlight comes only from the shell.css :has rule, which style.css's dark override does not cover — so the closed-group pill stays brand-softer bg + fg-brand text while every other active item in the same sidebar shows solid brand + white.

**修法**：Extend the style.css dark block: [data-color-mode="dark"] .sidebar .submenu-toggle:has(+ .submenu:not(.show) .submenu-item.active), [data-color-mode="dark"] .sidebar.collapsed .submenu-toggle:has(+ .submenu .submenu-item.active) { background: var(--brand); color: var(--b-on-primary); } plus the icon-color companion rule.

**參考**：tiri templates/base.html lines 106-110 ([data-color-mode=dark] .sidebar .menu-item.active { background: var(--brand); color: var(--b-on-primary); }) combined with line 207 (.active applied to the toggle)｜ours c:/Code/KioskAdmin/public/style.css lines 72-74 (dark override targets only .menu-item.active) vs admin-kit/css/shell.css lines 268-269 (:has-based parent highlight, light tokens only)

### M19
First-column name cells (<td class="b-th">: device name, username) render at font-weight 500, but tiri's calm-typography weight scale explicitly includes '.main-content .b-tbl th[scope="row"], .main-content .b-tbl td.b-th' in the --b-font-emphasis (=400) list, overriding the base 500 rule. The kit extraction ported the weight-scale block (components.css section 14) but dropped those two table selectors, so every row's primary column looks bolder than tiri.

**修法**：Add '.main-content .b-tbl th[scope="row"], .main-content .b-tbl td.b-th' to the emphasis selector list at components.css line 614 so name cells drop to font-weight 400 like tiri.

**參考**：tiri static/css/cms/b_admin.css lines 1429-1445 (emphasis list, specifically lines 1433-1434) with --b-font-emphasis: 400 at line 1413; base 500 rule at line 1024｜ours public/admin-kit/css/components.css lines 613-618 (emphasis list missing the two table selectors) vs line 199 (.b-tbl td.b-th { font-weight: 500 })

### M20
The online-status dot (.dev-dot, border-radius: var(--radius-full)) in the device table's status cell is not excluded from the global squircle corner-shape rule (shell.css applies corner-shape: squircle to *), so in current Chromium the dot renders as a squared-off circle instead of a true circle. tiri's own comment warns 'squircle 疊上全圓角會被壓成方圓形' and explicitly puts its equivalent status dot .gm-dot (and .b-badge .dot) in the corner-shape: round exclusion list; the kit comment even says to add new radius-full elements to the list, which was not done for .dev-dot.

**修法**：Add '.dev-dot { corner-shape: round; }' inside an @supports (corner-shape: squircle) block in style.css (or append .dev-dot to the shell.css exclusion list). While there, audit the other project radius-full elements (.page-tabs .tab .badge, .page-tabs .tab button) which have the same problem.

**參考**：tiri static/css/brand.css lines 72-81 (@supports corner-shape block: .gm-dot, .b-badge .dot ... { corner-shape: round })｜ours public/style.css line 392 (.dev-dot radius-full) + public/admin-kit/css/shell.css lines 26-34 (exclusion list lacks .dev-dot)

### M21
When the device list or user list is empty (fresh install, or admin deletes everything), the table renders as a bare card frame containing only the header row. tiri never shows a header-only table: dashboard.html conditionally swaps the table for a .b-empty block (icon + title + subtitle) when there are no rows, and our own layout tab already uses this pattern (#emptyState), so the tables are inconsistent with both tiri and the rest of the app.

**修法**：When the fetched array is empty, hide the .b-tbl-scroll and show a .b-empty block (e.g. icon 'monitor-off' / 'users', title '還沒有機器連上來' with a sub explaining cloud-sync), mirroring the existing #emptyState markup.

**參考**：tiri templates/dashboard.html lines 38 and 64-70 ({% if recent %} table {% else %} .b-empty)｜ours public/app.js renderDevicesView (lines 1629-1695) and renderUsersView (lines 1704-1728) render nothing for empty arrays; public/index.html lines 135-140 and 175-180

### M22
Checkboxes are native OS checkboxes tinted with `accent-color: var(--accent)`, while tiri draws its own square `.b-check` control everywhere a checkbox appears (settings 測試模式, inbox select-all/row checks): appearance:none, 16px, 1px border-default, 4px radius, white (neutral-primary-soft) background, brand fill + white clip-path checkmark when checked, `.15s` background/border transition, and a `0 0 0 4px var(--brand-medium)` focus-visible ring. Ours therefore looks platform-dependent, has no soft focus ring, and no check-in transition; label text is also 13.5px/400 vs tiri's 14px/500. Additionally `accent-color: var(--accent)` bypasses the dark-mode brand family — in dark mode ours stays raw #E07800 instead of the adjusted dark brand (tiri checked fill uses --brand, which swaps per mode).

**修法**：Copy the .b-check CSS block from tiri settings.html:68-81 into style.css (tokens only — brand family resolves to orange automatically), then have checkRow(), the sleep-day checkbox, and .copy-item wrap their inputs in a `label.b-check` (or add the input rules under .group/.copy-item selectors). Use var(--brand), not var(--accent), for the checked fill so dark mode gets the adjusted hue.

**參考**：tiri templates/settings.html:68-81 and templates/inbox.html:177-190 (.b-check component)｜ours c:/Code/KioskAdmin/public/style.css:315 (.group input[type=checkbox]) and :436 (.copy-item input[type=checkbox]); app.js:1069-1077 (checkRow), 1446-1455 (sleep day checks), 1250-1259 (copy-device list)

### M23
Stacked field labels in the settings cards (智能客服 API: 伺服器位址/Email/密碼) use the project's `.field-label` (13px, --text-body-subtle grey) above each input, whereas the equivalent tiri settings forms put a `.b-label` above every input (14px, --text-heading dark; kit-managed weight). Our label-over-input hierarchy reads noticeably weaker/smaller than tiri's settings page, and it also scales with html[data-fs] in tiri ([data-fs] .main-content .b-label boost) while our 13px labels don't.

**修法**：In settings cards (and anywhere a label sits on its own line above a full-width input), emit `class="b-label"` instead of `.field-label` — e.g. give lbl() an optional block/label variant. Keep .field-label for inline row captions (每張秒數, 速度, 顯示方式) which have no tiri counterpart.

**參考**：tiri templates/settings.html:66,122-147 (set-field: b-label + b-input + hint) and b_admin.css:985 (.b-label 14px/500 text-heading)｜ours c:/Code/KioskAdmin/public/app.js:1019-1024 (lbl() → .field-label) used at 1391-1401 (chatApiCard); style.css:316 (.field-label 13px text-body-subtle)

### M24
The header account menu is left open across logout/login: clicking 登出 happens inside .header-user-menu, whose kit.js click handler calls stopPropagation, so kit's document-level close (setUser(false)) never runs. logout() hides #mainView but userMenu.hidden stays false, aria-expanded stays "true" and the caret stays rotated — after re-login the account dropdown is already hanging open under the header.

**修法**：In logout() close the menu explicitly: const menu = document.querySelector('.header-user-menu'); if (menu) { menu.hidden = true; menu.classList.remove('hdr-user-enter-active','hdr-user-leave-active'); } document.querySelector('.header-user-btn')?.setAttribute('aria-expanded','false'); document.querySelector('.header-user-caret')?.classList.remove('open');

**參考**：tiri —｜ours c:/Code/KioskAdmin/public/app.js:45,72 (logoutBtn → logout) + admin-kit/js/kit.js:163-165 (menu click stopPropagation prevents auto-close)

### M25
openWsModal (save-button relabel) and renderDevicesView (管理 buttons) call lucide.createIcons() directly instead of window.renderLucideIcons(). Kit renders all shell icons with stroke-width 2.2; the direct calls use lucide's default stroke-width 2 and omit aria-hidden, so the cloud-upload/save icon and every device-row 管理 icon render visibly thinner than neighboring icons (they self-heal only when a later toast/kit render happens to re-run createIcons). Also skips kit's data-lucide cleanup optimization.

**修法**：Replace both `if (window.lucide) lucide.createIcons();` calls with `window.renderLucideIcons();` (app.js:116 and app.js:1697).

**參考**：tiri admin-kit/js/kit.js:29-35 (renderLucideIcons wrapper: stroke-width 2.2 + aria-hidden + data-lucide strip — the kit-sanctioned entry point)｜ours c:/Code/KioskAdmin/public/app.js:116, :1697

### M26
The cell-panel empty message changes style after first use: the initial static markup uses <p class="panel-placeholder"> (13.5px, subtle color, 24px/20px padding), but when the user deselects a cell (完成), renderPanel writes <p class="hint" style="padding:20px"> — and `.hint` is only styled under `.group` (style.css:317), so this paragraph renders at default body size/color. The same message visibly jumps in size, color and padding between the two states.

**修法**：In renderPanel's empty branch (app.js:794) use the same class as the static markup: panel.innerHTML = '<p class="panel-placeholder">← 點左邊版面上的格子開始編輯</p>';

**參考**：tiri —｜ours c:/Code/KioskAdmin/public/app.js:794 vs index.html:239 + style.css:277, :317

## nice-to-have（17 條）

### N1
No re-submit guard while loading: tiri early-returns if the button already has is-loading; ours relies only on pointer-events:none, which does not block keyboard submits — pressing Enter in a field during the crawl fires additional parallel /api/login fetches (and on success could run enterMain() twice).

**修法**：At the top of the submit handler add: if (btn.classList.contains('is-loading') || btn.classList.contains('is-success')) return;

### N2
Missing the copyright footer line tiri renders beneath the card (.login-copyright, centered .78rem subtle text pinned near the page bottom).

**修法**：Add <p class="login-copyright">© 2026 …</p> as the last child of #loginView and port the .login-copyright rule (absolute, left/right 24px, bottom 16px, .78rem, text-body-subtle, centered).

### N3
Close behavior deviates from tiri: tiri hides the menu instantly on close, while ours plays a 140ms bddOut fade/slide (.leaving class, animationend + 180ms timeout fallback, cancel-on-reopen logic). Ours also adds a prefers-reduced-motion rule that disables the open animation, which tiri's dropdown does not have. Both are arguably enhancements (smoother close, better a11y) but are visible interaction-feel differences vs the reference; strict parity would remove them. No functional defect found in the added logic (detached-node, rapid-reopen, and reduced-motion paths all resolve correctly).

**修法**：For exact parity, revert closeDD to tiri's instant-hide version and delete the bddOut keyframes/.leaving/reduced-motion rules from components.css; otherwise record the close animation as an approved kit deviation in admin-kit/GUIDELINES.md so future parity audits don't reflag it.

### N4
pickDevicesDialog has none of the focus behaviors the kit dialogs have: nothing is focused on open (keyboard focus stays on the button behind the overlay), Tab is not trapped so tabbing walks into the workspace controls behind the dialog, focus is not restored on close, and its role="dialog" has no aria-labelledby (BDialog sets aria-labelledby to the generated title id).

**修法**：On open: save document.activeElement, give the title an id and set aria-labelledby, and setTimeout-focus the first checkbox/radio (or OK button). Add a Tab loop over the overlay's `button, input` like dialogs.js's keydown handler, and restore the saved focus in close().

### N5
Dark-mode toggle tooltip/aria-label is static. tiri binds title/aria-label to the current state ('切換深色模式' in light mode, '切換淺色模式' in dark), so hover and screen readers announce the action's target. Ours is hard-coded '切換深淺色' and kit.js never updates it on toggle.

**修法**：In kit.js's mode-toggle handler (and once at init), set modeBtn.title and aria-label to dark ? '切換淺色模式' : '切換深色模式'.

### N6
Clicking the user button (or Aa button) during the 140ms close animation is swallowed instead of reopening. tiri's Vue v-if recreates the element, so a click while the menu is animating out immediately reopens it; kit.js derives open-state from the hidden attribute, which is still false while the leave animation plays, so setUser(userMenu.hidden) resolves to another close and the click does nothing. Same pattern in setFsPanel. A fast double-click on the trigger leaves the menu closed where tiri would show it again.

**修法**：Track an explicit isOpen boolean per widget instead of reading .hidden, clearTimeout the pending hide on reopen, and remove the leave class before replaying the enter animation.

### N7
Font-size slider is custom-drawn (4px grey track, 14px brand dot, no filled progress segment) whereas tiri uses the native range input with accent-color: var(--brand), which renders with a brand-filled progress track and larger native thumb on Mac/most platforms. The kit comment documents this as a deliberate fix for Windows Chromium mis-painting the native track colour in light mode, so it is arguably an improvement, but on other platforms the panel visibly differs from tiri's.

**修法**：Either accept as an intentional kit improvement (recommended, given this project targets Windows admins), or restore parity by deleting the custom track/thumb rules and using accent-color: var(--brand); a middle ground is painting the left-of-thumb progress with a linear-gradient on the track to mimic the native filled look.

### N8
Workspace modal lacks tiri's open/close focus handoff: tiri's inbox modal focuses the close button on open and returns focus to the triggering list row on close; our openWsModal/exitWorkspace never move focus, so keyboard focus stays on the (now-obscured) device row after opening, and lands nowhere in particular after closing.

**修法**：In enterWorkspace/enterSharedLayoutEditor record the triggering element, focus $('wsCloseBtn') at the end of openWsModal, and in exitWorkspace's fin() restore focus to the recorded trigger if still connected.

### N9
SPA loading dim is never used: switchView() plays the .12s is-spa-entered crossfade immediately, then the async render functions fetch and repopulate the tables afterwards, so on a slow network rows silently pop into an already-faded-in view. tiri dims the main content (.is-spa-loading, opacity .55, only when the fetch exceeds ~180ms) before swapping, so slow loads read as an intentional transition instead of a content pop. The kit ships the class (shell.css .main-content.is-spa-loading) unused.

**修法**：In switchView, before awaiting a view's async render start a ~180ms timer that adds is-spa-loading to .main-content; on render completion clear the timer, remove is-spa-loading, then call spaFade() so the fade plays on the new content.

### N10
Mobile (≤1024px) accordion animates in ours but is instant in tiri. tiri's mobile rule forces .submenu.show to display:block !important (base.css loads before b_admin.css, so the !important wins over the plain display:grid), which defeats the grid-template-rows animation — drawer submenus snap open/closed. Ours keeps display:grid !important on mobile, so they animate open and closed.

**修法**：For exact parity, change the mobile rule to .sidebar .submenu.show { display: block !important; }. Ours is arguably smoother, so alternatively record it as a deliberate deviation.

### N11
Table row hover shade deviates from the reference and leaves dead rules behind. tiri .b-tbl row hover is --neutral-secondary-soft (#F9FAFB light / #141414 dark) and its clickable Gmail rows use --neutral-secondary-medium (#F9FAFB / #232323); ours overrides to --neutral-tertiary via '.b-tbl tbody tr:hover td' (light #F3F4F6 is close, but dark #262626 is a clearly lighter highlight than tiri's #141414). Because that override paints the td layer, the kit's '.b-tbl tbody tr { transition: background .12s }' (components.css:197) and the '.device-row:hover { background: var(--neutral-secondary-soft) }' rule (style.css:388) are both no-ops. Note: the override is documented as a deliberate contrast tweak and also exists in the unloaded admin-kit/css/themes/tiri.css:49, so confirm intent before changing.

**修法**：If exact tiri parity is wanted, delete the td-level override at style.css:52 (kit's tr-level secondary-soft hover then applies) or change its token to --neutral-secondary-medium to match tiri's clickable-row hover; in either case remove the dead .device-row:hover rule at style.css:388.

### N12
Clickable device rows are mouse-only: <tr class="device-row"> has cursor:pointer and a click handler but no tabindex, no key handling, and no focus style. tiri's equivalent clickable list rows (.gm-row) are real <button> elements with a :focus-visible inset ring (inset 0 0 0 2px var(--brand-medium)), so keyboard users can open items; here the only keyboard path is the 管理 button inside the row.

**修法**：Set tr.tabIndex = 0, add a keydown handler for Enter/Space calling enterWorkspace(d), and add '.device-row:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--brand-medium); }' to style.css.

### N13
The cell-panel range slider (跑馬燈速度) loses all keyboard focus indication in Firefox: `.group input[type=range]:focus-visible { outline: none; }` removes the outline but the ring is only restored on `::-webkit-slider-thumb`; the `::-moz-range-thumb` twin is missing. The kit's own header slider pattern that this rule copies includes both (shell.css:207-209).

**修法**：Add `.group input[type=range]:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 4px var(--brand-medium); }` next to the webkit rule.

### N14
Weather fetch resolution calls renderCanvas() unconditionally: open a workspace containing an auto-location weather cell, close it before the ipapi/open-meteo round-trip finishes, and the .then/.catch callbacks run renderCanvas() with state = null → TypeError ('reading config of null') as an unhandled rejection. No visible harm (modal is closed) but it errors on every late weather response.

**修法**：Guard the repaint: in getWeather's then/catch (app.js:562-566) call renderCanvas only when the canvas is live, e.g. replace renderCanvas() with (state && renderCanvas()); or add `if (!state) return;` at the top of renderCanvas.

### N15
applySharedSettingsBtn is enabled in static HTML and bound at script load, but `shared` is only fetched when the 機器設定 view renders. Clicking 套用到機器 in the instant before ensureSharedLoaded resolves (or after it failed on a network error, leaving the view blank) throws TypeError on `shared.chatApi` (shared is null) — silent no-op with an unhandled rejection.

**修法**：Start the button disabled in index.html (like applySharedLayoutBtn) and enable it at the end of renderSharedSettingsView, or add `if (!shared) return;` at the top of applySharedSettings (app.js:1557).

### N16
renderDevicesView and renderUsersView are async with no error handling and are invoked fire-and-forget from switchView/exitWorkspace: if /api/devices or /api/users fails (non-401 network error), the promise rejects unhandled and the user sees an empty or stale table with no toast, unlike every other API path which surfaces setStatus errors.

**修法**：Wrap the awaits in try/catch and call setStatus(e.message, true) (matching loadConfig's pattern), e.g. at app.js:1626-1627 and :1702.

### N17
Login submit failure path conflates errors: btn gets .is-success and then `await enterMain()` — if enterMain rejects (e.g. /api/me network hiccup right after a successful /api/login), the catch shows 「帳號或密碼錯誤」 even though credentials were accepted and the token is stored, and .is-success is never removed, leaving the login button stuck fully filled.

**修法**：In the catch (app.js:66-69) also remove is-success (btn.classList.remove('is-loading','is-success')), and distinguish the two failures — only show loginError when /api/login itself returned !ok; surface enterMain errors via setStatus/toast instead.

