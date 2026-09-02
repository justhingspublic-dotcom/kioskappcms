// 自訂下拉:漸進增強原生 <select>。
// 視覺換成自訂 UI,但保留原生 select(隱藏於 DOM)→ 表單提交、required、onchange 全部不變。
// 自動套用到頁面所有 <select>;前台、後台共用。
(function () {
  var openDD = null;

  function optText(opt) { return (opt.textContent || '').trim(); }

  function buildMenu(dd, select) {
    var menu = dd.querySelector('.b-dd-menu');
    menu.innerHTML = '';
    Array.prototype.forEach.call(select.options, function (opt) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'b-dd-item' + (opt.value === select.value ? ' active' : '');
      item.textContent = optText(opt);
      item.dataset.value = opt.value;
      if (opt.disabled) item.disabled = true;
      item.addEventListener('click', function () {
        if (opt.disabled) return;
        if (select.value !== opt.value) {
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncLabel(dd, select);
        closeDD();
      });
      menu.appendChild(item);
    });
  }

  function syncLabel(dd, select) {
    var valEl = dd.querySelector('.b-dd-value');
    var opt = select.options[select.selectedIndex];
    valEl.textContent = opt ? optText(opt) : '';
    valEl.classList.toggle('placeholder', !opt || opt.value === '');
    Array.prototype.forEach.call(dd.querySelectorAll('.b-dd-item'), function (it) {
      it.classList.toggle('active', it.dataset.value === select.value);
    });
  }

  function positionMenu(dd) {
    var trigger = dd.querySelector('.b-dd-trigger');
    var menu = dd.querySelector('.b-dd-menu');
    var r = trigger.getBoundingClientRect();
    menu.style.minWidth = r.width + 'px';
    menu.style.left = r.left + 'px';
    var spaceBelow = window.innerHeight - r.bottom;
    if (spaceBelow < 260 && r.top > spaceBelow) {
      menu.style.top = 'auto';
      menu.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    } else {
      menu.style.bottom = 'auto';
      menu.style.top = (r.bottom + 4) + 'px';
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
    var menu = dd.querySelector('.b-dd-menu');
    menu.hidden = false;
    positionMenu(dd);
    openDD = dd;
  }
  function closeDD() {
    if (!openDD) return;
    openDD.classList.remove('open');
    var m = openDD.querySelector('.b-dd-menu');
    if (m) m.hidden = true;
    openDD = null;
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
    // 下拉箭頭:內嵌 SVG chevron(自包含,不依賴 Font Awesome / Lucide — 此元素是 JS 動態注入,不經 Lucide createIcons)。
    // 保留 .b-dd-caret class → 沿用既有顏色 token 與 .b-dd.open 翻轉動畫。
    trigger.innerHTML = '<span class="b-dd-value"></span>'
        + '<svg class="b-dd-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    var menu = document.createElement('div');
    menu.className = 'b-dd-menu';
    menu.hidden = true;

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
