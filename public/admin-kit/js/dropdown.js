// 自訂下拉:漸進增強原生 <select>。
// 視覺換成自訂 UI,但保留原生 select(隱藏於 DOM)→ 表單提交、required、onchange 全部不變。
// 自動套用到頁面所有 <select>;前台、後台共用。
(function () {
  var openDD = null;

  function optText(opt) { return (opt.textContent || '').trim(); }
  // <option data-badge="…">：選項最右邊多一個狀態小標（例：園區資訊「連線失敗」）；選單裡與選中時的觸發鈕上都顯示。
  // 小標只是說明，點它不算選這個選項（選單不會被關掉）
  function badgeEl(text) {
    var b = document.createElement('span');
    b.className = 'b-dd-badge';
    b.textContent = text;
    return b;
  }

  function buildMenu(dd, select) {
    var list = dd.querySelector('.b-dd-list');
    list.innerHTML = '';
    Array.prototype.forEach.call(select.options, function (opt, i) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'b-dd-item' + (opt.value === select.value ? ' active' : '');
      item.textContent = optText(opt);
      if (opt.dataset.badge) item.appendChild(badgeEl(opt.dataset.badge));
      item.dataset.value = opt.value;
      if (opt.disabled) item.disabled = true;
      item.style.setProperty('--i', Math.min(i, 8)); // 打開時一個接一個落下（太後面的不必再等）
      item.addEventListener('click', function (e) {
        if (opt.disabled || (e.target.closest && e.target.closest('.b-dd-badge'))) return;
        if (select.value !== opt.value) {
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncLabel(dd, select);
        closeDD();
      });
      list.appendChild(item);
    });
  }

  function syncLabel(dd, select) {
    var valEl = dd.querySelector('.b-dd-value');
    var opt = select.options[select.selectedIndex];
    valEl.textContent = opt ? optText(opt) : '';
    valEl.classList.toggle('placeholder', !opt || opt.value === '');
    var old = dd.querySelector('.b-dd-trigger .b-dd-badge');
    if (old) old.remove();
    if (opt && opt.dataset.badge) valEl.after(badgeEl(opt.dataset.badge));
    Array.prototype.forEach.call(dd.querySelectorAll('.b-dd-item'), function (it) {
      it.classList.toggle('active', it.dataset.value === select.value);
    });
  }

  // 清單下面還有沒捲到的：底部淡出（同子頁收納匣）
  function listMore(list) {
    list.classList.toggle('is-more', list.scrollTop + list.clientHeight < list.scrollHeight - 2);
  }

  // 觸發鈕就是選單的頂端（2026-10-29 user：同子頁收納匣，鈕跟清單連成一體）：選單從鈕的上緣開始畫、跟鈕一樣寬，
  // 上內距＝鈕的高度，鈕打開時變透明疊在上面。decide＝打開當下才決定開向（捲動途中只跟著鈕移動，不會突然翻面）：
  // 依「選單實際高度」決定（2026-09-08：原本用固定 260px 猜，選項一多就超出視窗底）：
  // 下方放得下→往下；否則上方放得下→往上（鈕變成選單的底部）；兩邊都不夠→選較大的一邊並把清單壓到可用高度（內部捲動）
  function positionMenu(dd, decide) {
    var trigger = dd.querySelector('.b-dd-trigger');
    var menu = dd.querySelector('.b-dd-menu');
    var list = menu.querySelector('.b-dd-list');
    var r = trigger.getBoundingClientRect();
    menu.style.width = r.width + 'px';
    // 祖先有 transform／filter 時，fixed 改以那個祖先為準而不是視窗（2026-10-29：換頁過場殘留 matrix，共用設定的下拉整個跑到畫面外）：
    // 先把選單放到 0,0 量出基準點，再換算成相對位置；沒有這種祖先時基準點就是視窗左上角
    menu.style.left = '0px'; menu.style.top = '0px'; menu.style.bottom = 'auto';
    var o = menu.getBoundingClientRect();
    menu.style.left = (r.left - o.left) + 'px';
    if (decide) {
      var EDGE = 8;
      list.style.maxHeight = '';
      var need = r.height + list.offsetHeight; // 此時 hidden 已解除、可量（框還沒長開也量得到清單本身的高度）
      var spaceBelow = window.innerHeight - r.top - EDGE;
      var spaceAbove = r.bottom - EDGE;
      var openUp = need > spaceBelow && spaceAbove > spaceBelow;
      var avail = openUp ? spaceAbove : spaceBelow;
      if (need > avail) list.style.maxHeight = Math.max(80, avail - r.height) + 'px';
      menu.classList.toggle('is-up', openUp);
      // 內距少 2＝上下兩條框：清單與鈕之間的細線剛好落在鈕的下緣（往上開＝上緣）
      menu.style.paddingTop = openUp ? '0' : (r.height - 2) + 'px';
      menu.style.paddingBottom = openUp ? (r.height - 2) + 'px' : '0';
    }
    if (menu.classList.contains('is-up')) {
      // 往上開用 bottom 定位（框往上長）：基準的下緣也要量
      menu.style.top = 'auto'; menu.style.bottom = '0px';
      menu.style.bottom = (menu.getBoundingClientRect().bottom - r.bottom) + 'px';
    } else {
      menu.style.top = (r.top - o.top) + 'px';
    }
  }

  function openDDFn(dd) {
    var select = dd.querySelector('select');
    // 原生 select 被 disabled → 尊重鎖定,不展開自訂選單。
    // (增強成 .b-dd 後,若不擋這裡,點自訂觸發器仍能改值 → 繞過 disabled,如「編輯時鎖住層級」被破解)
    if (select && select.disabled) return;
    closeDD();
    // 開啟時以「當下的 <option>」重建選單:Vue 等框架會在增強後才非同步塞入/改動選項,
    // 建死在 enhance 時的選單會過期 → 每次打開都重讀,靜態 select 行為不變。
    if (select) { buildMenu(dd, select); syncLabel(dd, select); }
    dd.classList.add('open');
    dd.querySelector('.b-dd-trigger').setAttribute('aria-expanded', 'true');
    var menu = dd.querySelector('.b-dd-menu');
    var list = menu.querySelector('.b-dd-list');
    // 若正在播放收起動畫（快速重開同一顆），取消收起、直接從目前的樣子再長開
    if (menu._bddCancelLeave) menu._bddCancelLeave();
    var wasHidden = menu.hidden;
    menu.hidden = false;
    positionMenu(dd, true);
    // 選中的那一項在捲動範圍外：捲到看得到（同原生下拉）
    var cur = list.querySelector('.b-dd-item.active');
    list.scrollTop = cur && list.scrollHeight > list.clientHeight ? cur.offsetTop - (list.clientHeight - cur.offsetHeight) / 2 : 0;
    listMore(list);
    // 框往下長開、裡面一個接一個落下（只在剛打開的那一下）
    if (wasHidden) void menu.offsetWidth;
    clearTimeout(menu._bddEnterTimer);
    menu.classList.add('is-entering', 'is-shown');
    menu._bddEnterTimer = setTimeout(function () { menu.classList.remove('is-entering'); }, 800);
    openDD = dd;
  }
  function closeDD() {
    if (!openDD) return;
    var dd = openDD;
    openDD = null;
    dd.classList.remove('open');
    dd.querySelector('.b-dd-trigger').setAttribute('aria-expanded', 'false');
    var m = dd.querySelector('.b-dd-menu');
    if (!m || m.hidden) return;
    // 收起＝框收回鈕裡、淡出（鈕的外框同時淡回來），播完才真正 hidden
    clearTimeout(m._bddEnterTimer);
    m.classList.remove('is-shown', 'is-entering');
    var timer = setTimeout(function () { m.hidden = true; m._bddCancelLeave = null; }, 240);
    m._bddCancelLeave = function () {
      clearTimeout(timer);
      m._bddCancelLeave = null;
    };
  }

  function enhance(select) {
    if (!select || select.multiple || select.size > 1 || select.dataset.bdd) return;
    select.dataset.bdd = '1';

    var wrap = document.createElement('div');
    // 保留版面/寬度 class,移除外觀 class(避免雙重邊框)
    // b-select/b-input/b-textarea 也是「畫邊框/底/padding」的外觀 class → 必須濾掉,
    // 否則殘留在 .b-dd 外殼上,與內層 .b-dd-trigger 疊成兩層框(typeui 後台 select 常見)。
    var layout = (select.className || '').split(/\s+/).filter(function (c) {
      return c && !/^(border|rounded|shadow|bg-|text-|px-|py-|p-|pl-|pr-|outline|focus|hover|h-|b-select|b-input|b-textarea)$/.test(c)
               && !/^(border|rounded|shadow|bg-|text-|px-|py-|p-|pl-|pr-|outline|focus|hover|h-)/.test(c);
    }).join(' ');
    wrap.className = 'b-dd ' + layout;
    if (/text-xs|py-1(\.5)?|py-0\.5/.test(select.className || '')) wrap.classList.add('b-dd-sm');

    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('b-dd-native');

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'b-dd-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    // 下拉箭頭:內嵌 SVG chevron(自包含,不依賴 Font Awesome / Lucide — 此元素是 JS 動態注入,不經 Lucide createIcons)。
    // 保留 .b-dd-caret class → 沿用既有顏色 token 與 .b-dd.open 翻轉動畫。
    trigger.innerHTML = '<span class="b-dd-value"></span>'
        + '<svg class="b-dd-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    // 選單：框（長開用 grid 0fr→1fr）＞內層（切掉還沒長出來的部分、頂端一條細線）＞清單（捲動）
    var menu = document.createElement('div');
    menu.className = 'b-dd-menu';
    menu.hidden = true;
    menu.innerHTML = '<div class="b-dd-body"><div class="b-dd-inner"><div class="b-dd-list" role="listbox"></div></div></div>';
    var list = menu.querySelector('.b-dd-list');
    list.addEventListener('scroll', function () { listMore(list); }, { passive: true });

    wrap.appendChild(trigger);
    wrap.appendChild(menu);

    buildMenu(wrap, select);
    syncLabel(wrap, select);

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      if (wrap.classList.contains('open')) closeDD();
      else openDDFn(wrap);
    });
    // 外部程式改了 select.value 時同步 UI
    select.addEventListener('change', function () { syncLabel(wrap, select); });
  }

  function init(root) {
    (root || document).querySelectorAll('select:not([data-bdd])').forEach(enhance);
  }

  // 外部動態改了 <option>(新增/刪除)後,重建對應自訂下拉的選單 + 標籤。
  // 若該 select 尚未增強,退化為 enhance。
  function refresh(select) {
    if (!select) return;
    if (!select.dataset.bdd) { enhance(select); return; }
    var wrap = select.closest('.b-dd');
    if (!wrap) return;
    buildMenu(wrap, select);
    syncLabel(wrap, select);
  }

  document.addEventListener('click', function (e) {
    if (openDD && !e.target.closest('.b-dd')) closeDD();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDD(); });
  window.addEventListener('resize', closeDD);
  window.addEventListener('scroll', function () { if (openDD) positionMenu(openDD); }, true);

  // 範圍內全部已增強 select 重建選單 + 標籤(框架程式化改值不會發 change → 開 modal 時呼叫同步)
  function syncAll(root) {
    (root || document).querySelectorAll('select[data-bdd]').forEach(refresh);
  }

  window.BDropdown = { init: init, enhance: enhance, refresh: refresh, syncAll: syncAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
  else init();
})();
