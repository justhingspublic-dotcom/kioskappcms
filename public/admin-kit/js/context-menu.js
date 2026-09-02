// 指標旁動作選單(context menu)共用元件。
// 點某元素 → 在點擊座標旁彈出一個手風琴展開的小選單,選了觸發 callback。前台、後台共用。
//
// 用法:
//   window.BContextMenu.open({
//     x, y,                                  // 彈出座標(通常 event.clientX / clientY)
//     items: [                               // 選項;disabled 的項目變灰不可點
//       { id: 'edit', icon: 'pencil', label: '編輯' },
//       { id: 'del',  icon: 'trash', label: '刪除', disabled: false },
//     ],
//     onSelect: function (id) { ... },       // 選了哪一項(id)
//     anchorEl: someEl,                      // 選填:選單開著時給它加 .is-active(維持 hover 外觀),關閉時移除
//   });
//   window.BContextMenu.close();
//   window.BContextMenu.isOpen();
//
// icon 走 Lucide(<i data-lucide>);開啟後自動呼叫 window.renderLucideIcons()。
// 單例:同時只有一個 context menu;開新的會先關舊的。點外面 / Esc / 捲動 / resize 自動關。
(function () {
  var EL_ID = 'b-context-menu';
  var ANIM_MS = 180;

  var el = null;          // 選單 DOM(單例,lazy 建立)
  var closeTimer = null;
  var state = null;       // { onSelect, anchorEl } 目前開啟的選單狀態

  function ensureEl() {
    if (el) return el;
    el = document.getElementById(EL_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = EL_ID;
      el.className = 'b-ctxmenu hidden';
      el.setAttribute('role', 'menu');
      document.body.appendChild(el);
    }
    // 點選項 → 觸發 onSelect(關閉後再呼叫,讓 UI 先收起)
    el.addEventListener('click', function (e) {
      var item = e.target.closest('.b-ctxmenu-item');
      if (!item || item.disabled || !state) return;
      var id = item.dataset.id;
      var cb = state.onSelect;
      close();
      if (cb) cb(id);
    });
    return el;
  }

  function setAnchorActive(anchorEl, on) {
    if (anchorEl) anchorEl.classList.toggle('is-active', !!on);
  }

  function isOpen() { return !!(el && !el.classList.contains('hidden')); }

  function close() {
    if (!el || el.classList.contains('hidden')) {
      if (state) { setAnchorActive(state.anchorEl, false); state = null; }
      return;
    }
    if (state) setAnchorActive(state.anchorEl, false);
    // 手風琴收合:先鎖當前高度,下一幀收到 0
    el.style.maxHeight = el.scrollHeight + 'px';
    el.classList.remove('is-open');
    requestAnimationFrame(function () { el.style.maxHeight = '0px'; });
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      el.classList.add('hidden');
      el.style.maxHeight = '';
    }, ANIM_MS);
    state = null;
  }

  function open(opts) {
    opts = opts || {};
    ensureEl();
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    // 清掉前一個 anchor 的 active(若直接換位置開)
    if (state) setAnchorActive(state.anchorEl, false);
    state = { onSelect: opts.onSelect, anchorEl: opts.anchorEl || null };
    setAnchorActive(state.anchorEl, true);

    var items = opts.items || [];
    el.innerHTML = items.map(function (it) {
      var ic = it.icon ? '<i data-lucide="' + it.icon + '" aria-hidden="true"></i>' : '';
      return '<button type="button" class="b-ctxmenu-item" role="menuitem" data-id="' + it.id + '"' +
        (it.disabled ? ' disabled' : '') + '>' + ic + '<span>' + (it.label || '') + '</span></button>';
    }).join('');

    // 先以最終高度顯示(暫解除 max-height)量測尺寸 + 定位,再套手風琴起點
    el.classList.remove('hidden');
    el.style.maxHeight = 'none';
    if (window.renderLucideIcons) window.renderLucideIcons();

    var mw = el.offsetWidth, mh = el.offsetHeight;
    var left = opts.x || 0, top = opts.y || 0;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (top + mh > window.innerHeight - 8) top = (opts.y || 0) - mh;   // 下方放不下 → 翻到點擊處上方
    if (top < 8) top = 8;
    if (left < 8) left = 8;
    el.style.left = left + 'px';
    el.style.top = top + 'px';

    // 手風琴展開:0 → scrollHeight
    el.style.maxHeight = '0px';
    el.classList.add('is-open');
    requestAnimationFrame(function () { el.style.maxHeight = el.scrollHeight + 'px'; });
    // 展開後解除固定高(避免縮放/內容變動被裁)
    setTimeout(function () {
      if (el.classList.contains('is-open')) el.style.maxHeight = 'none';
    }, ANIM_MS + 20);
  }

  // 全域:點選單外 / Esc / 捲動 / resize → 關
  document.addEventListener('click', function (e) {
    if (isOpen() && !e.target.closest('#' + EL_ID)) {
      // 若點在「開啟此選單的 anchor」上,交給呼叫端自己 toggle(不在這裡關),避免開了立刻被關
      if (state && state.anchorEl && e.target.closest && state.anchorEl.contains(e.target)) return;
      close();
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  window.addEventListener('scroll', function () { if (isOpen()) close(); }, true);
  window.addEventListener('resize', function () { if (isOpen()) close(); });

  window.BContextMenu = { open: open, close: close, isOpen: isOpen };
})();
