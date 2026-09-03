/* ==========================================================================
   Admin Kit — 殼層互動（零依賴 vanilla；原後台以 Vue 實作，這裡等價改寫）
   缺元素自動略過。搭配 shell.css / components.css。

   掛勾總表：
   - .mobile-menu-btn / .sidebar / .sidebar-overlay   手機抽屜開合
   - .toggle-btn                                      側欄收合（localStorage: adminSidebarCollapsed）
   - .submenu-toggle + .submenu > .submenu-inner      手風琴（single-open；收合時改開 flyout 浮窗）
   - .header-user-btn + .header-user-menu             帳號下拉（enter/leave 動畫）
   - .header-fs-wrap + .header-fs-range               字級三段（html[data-fs]，localStorage: adminFontSize）
   - .header-mode-btn                                 深淺色（html[data-color-mode]，localStorage: adminColorMode）
   - .b-pop > [data-pop]                              頁首下拉面板/菜單開合
   - [data-modal-open="#id"] / [data-modal-close]     modal 兩段式開關（window.BModal）
   - .b-seg.is-pill                                   segment 滑塊（window.bSegThumb；發 segment:change）
   - .b-tabs [data-tab] + .b-panel[data-panel]        tabs 切換

   ⚠️ 深淺色/字級「首繪前」要先套用（否則載入閃色），把這段 inline 放 <head> 最前：
   <script>(function(){try{
     if(localStorage.getItem('adminColorMode')==='dark')document.documentElement.setAttribute('data-color-mode','dark');
     var fs=localStorage.getItem('adminFontSize');
     if(fs==='sm'||fs==='lg')document.documentElement.setAttribute('data-fs',fs);
   }catch(e){}})();</script>
   ========================================================================== */
(function () {
  'use strict';

  /* ── Lucide 輔助：有載 lucide 就渲染 <i data-lucide>，沒有則安靜略過。
        轉換完立刻拔掉 svg 殘留的 data-lucide，避免之後每次呼叫整頁重畫 icon。 ── */
  window.renderLucideIcons = window.renderLucideIcons || function () {
    if (!window.lucide || !window.lucide.createIcons) return;
    if (document.querySelector('i[data-lucide]')) {
      window.lucide.createIcons({ attrs: { 'stroke-width': 2.2, 'aria-hidden': 'true' } });
    }
    document.querySelectorAll('svg[data-lucide]').forEach(function (s) { s.removeAttribute('data-lucide'); });
  };

  /* ── 柔和過場：暫掛 .b-mode-anim 開全域 transition，500ms 後移除；尊重 reduced-motion ── */
  var modeAnimT = 0;
  function softApply(fn) {
    var root = document.documentElement;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { fn(); return; }
    root.classList.add('b-mode-anim');
    clearTimeout(modeAnimT);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        fn();
        modeAnimT = setTimeout(function () { root.classList.remove('b-mode-anim'); }, 500);
      });
    });
  }
  window.softApply = softApply;

  /* ════════ 側欄 ════════ */
  var sidebar = document.querySelector('.sidebar');
  var overlay = document.querySelector('.sidebar-overlay');
  var mobileBtn = document.querySelector('.mobile-menu-btn');
  var collapseBtn = document.querySelector('.sidebar-toggle .toggle-btn');

  if (sidebar) {
    /* 收合狀態還原 */
    if (localStorage.getItem('adminSidebarCollapsed') === 'true') sidebar.classList.add('collapsed');

    if (mobileBtn) {
      mobileBtn.addEventListener('click', function () { sidebar.classList.toggle('open'); syncOverlay(); });
    }
    if (overlay) overlay.addEventListener('click', function () { sidebar.classList.remove('open'); syncOverlay(); });
    function syncOverlay() { if (overlay) overlay.classList.toggle('show', sidebar.classList.contains('open')); }

    if (collapseBtn) {
      collapseBtn.addEventListener('click', function () {
        sidebar.classList.toggle('collapsed');
        closeFlyout();
        localStorage.setItem('adminSidebarCollapsed', String(sidebar.classList.contains('collapsed')));
      });
    }

    /* 手風琴（single-open）：展開含當前頁的群組 */
    var toggles = sidebar.querySelectorAll('.submenu-toggle');
    toggles.forEach(function (btn) {
      var sub = btn.nextElementSibling;
      if (!sub || !sub.classList.contains('submenu')) return;
      if (sub.querySelector('.menu-item.active')) { btn.classList.add('open'); sub.classList.add('show'); }
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        /* 收合側欄：改開 flyout 浮窗 */
        if (sidebar.classList.contains('collapsed') && window.innerWidth > 1024) { openFlyout(btn, sub); return; }
        var willOpen = !sub.classList.contains('show');
        toggles.forEach(function (other) {
          other.classList.remove('open');
          var os = other.nextElementSibling;
          if (os && os.classList.contains('submenu')) os.classList.remove('show');
        });
        if (willOpen) { btn.classList.add('open'); sub.classList.add('show'); }
      });
    });

    /* 收合時群組浮窗：內容取自對應 .submenu 的連結 */
    var flyout = null;
    function closeFlyout() {
      if (!flyout) return;
      var f = flyout; flyout = null;
      f.classList.add('flyout-leave-active', 'flyout-leave-to');
      setTimeout(function () { f.remove(); }, 110);
    }
    function openFlyout(btn, sub) {
      if (flyout && flyout.__src === btn) { closeFlyout(); return; }
      closeFlyout();
      var f = document.createElement('div');
      f.className = 'cms-flyout';
      f.__src = btn;
      var titleEl = btn.querySelector('.menu-text');
      f.innerHTML = '<div class="cms-flyout-title"></div>';
      f.querySelector('.cms-flyout-title').textContent = titleEl ? titleEl.textContent : '';
      /* 原版只支援 <a>（tiri 連結導頁）；SPA 用 <button> 子項時把點擊委派回原按鈕 */
      sub.querySelectorAll('a.menu-item, button.menu-item').forEach(function (src) {
        var item = document.createElement('a');
        item.className = 'cms-flyout-item' + (src.classList.contains('active') ? ' active' : '');
        item.href = src.getAttribute('href') || '#';
        item.innerHTML = '<span></span>';
        item.querySelector('span').textContent = (src.textContent || '').trim();
        item.addEventListener('click', function (ev) {
          if (!src.getAttribute('href')) { ev.preventDefault(); src.click(); closeFlyout(); }
        });
        f.appendChild(item);
      });
      var r = btn.getBoundingClientRect();
      f.style.top = Math.min(r.top, window.innerHeight - 200) + 'px';
      f.style.left = (r.right + 10) + 'px';
      /* 進場：淡入＋輕微上移（transition class 對齊 shell.css） */
      f.classList.add('flyout-enter-active', 'flyout-enter-from');
      document.body.appendChild(f);
      requestAnimationFrame(function () { f.classList.remove('flyout-enter-from'); });
      flyout = f;
    }
    document.addEventListener('click', function (e) {
      if (flyout && !e.target.closest('.cms-flyout') && !e.target.closest('.submenu-toggle')) closeFlyout();
    });
  }

  /* ════════ Header：帳號下拉（enter/leave 動畫）＋字級面板 ════════ */
  function bindHeaderMenu(btnSel, menuBuilder) {
    var btn = document.querySelector(btnSel);
    if (!btn) return null;
    return btn;
  }

  var userBtn = document.querySelector('.header-user-btn');
  var userMenu = document.querySelector('.header-user-menu');
  if (userBtn && userMenu) {
    userMenu.hidden = true;
    var caret = userBtn.querySelector('.header-user-caret');
    function setUser(open) {
      if (open === !userMenu.hidden) return;
      if (open) {
        userMenu.hidden = false;
        userMenu.classList.remove('hdr-user-leave-active');
        userMenu.classList.add('hdr-user-enter-active');
        window.renderLucideIcons();
      } else {
        userMenu.classList.remove('hdr-user-enter-active');
        userMenu.classList.add('hdr-user-leave-active');
        setTimeout(function () { userMenu.hidden = true; userMenu.classList.remove('hdr-user-leave-active'); }, 140);
      }
      userBtn.setAttribute('aria-expanded', String(open));
      if (caret) caret.classList.toggle('open', open);
    }
    userBtn.addEventListener('click', function (e) { e.stopPropagation(); setUser(userMenu.hidden); });
    userMenu.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { setUser(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setUser(false); });
  }

  /* 字級三段面板 */
  var fsWrap = document.querySelector('.header-fs-wrap');
  if (fsWrap) {
    var fsBtn = fsWrap.querySelector('.header-icon-btn');
    var fsPanel = fsWrap.querySelector('.header-fs-panel');
    var fsRange = fsWrap.querySelector('.header-fs-range');
    var fsMarks = fsWrap.querySelectorAll('.header-fs-marks span');
    if (fsPanel) fsPanel.hidden = true;
    var levelMap = { sm: 0, lg: 2 };
    var level = levelMap[document.documentElement.getAttribute('data-fs')] != null
      ? levelMap[document.documentElement.getAttribute('data-fs')] : 1;
    function paintFs() {
      if (fsRange) fsRange.value = String(level);
      fsMarks.forEach(function (m, i) { m.classList.toggle('on', i === level); });
    }
    paintFs();
    if (fsBtn && fsPanel) {
      // 開收動畫與帳號下拉同款（hdrUserIn 進場／反向退場）——規範：所有浮層開收都要有動畫
      var fsLeaveTimer = null;
      var setFsPanel = function (open) {
        if (open === !fsPanel.hidden) return;
        clearTimeout(fsLeaveTimer);
        if (open) {
          fsPanel.hidden = false;
          fsPanel.classList.remove('hdr-user-leave-active');
          fsPanel.classList.add('hdr-user-enter-active');
        } else {
          fsPanel.classList.remove('hdr-user-enter-active');
          fsPanel.classList.add('hdr-user-leave-active');
          fsLeaveTimer = setTimeout(function () { fsPanel.hidden = true; fsPanel.classList.remove('hdr-user-leave-active'); }, 140);
        }
        fsBtn.setAttribute('aria-expanded', String(open));
      };
      fsBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setFsPanel(fsPanel.hidden);
      });
      fsPanel.addEventListener('click', function (e) { e.stopPropagation(); });
      document.addEventListener('click', function () { setFsPanel(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setFsPanel(false); });
    }
    if (fsRange) {
      fsRange.addEventListener('input', function () {
        level = Number(fsRange.value);
        var val = ({ 0: 'sm', 2: 'lg' })[level];
        softApply(function () {
          if (val) {
            document.documentElement.setAttribute('data-fs', val);
            localStorage.setItem('adminFontSize', val);
          } else {
            document.documentElement.removeAttribute('data-fs');
            localStorage.removeItem('adminFontSize');
          }
        });
        paintFs();
      });
    }
  }

  /* 深淺色切換 */
  var modeBtn = document.querySelector('.header-mode-btn');
  if (modeBtn) {
    modeBtn.classList.toggle('is-dark', document.documentElement.getAttribute('data-color-mode') === 'dark');
    modeBtn.addEventListener('click', function () {
      softApply(function () {
        var dark = document.documentElement.getAttribute('data-color-mode') !== 'dark';
        if (dark) document.documentElement.setAttribute('data-color-mode', 'dark');
        else document.documentElement.removeAttribute('data-color-mode');
        localStorage.setItem('adminColorMode', dark ? 'dark' : 'light');
        modeBtn.classList.toggle('is-dark', dark);
      });
    });
  }

  /* ════════ .b-pop 下拉（頁首篩選面板／動作菜單） ════════ */
  document.querySelectorAll('.b-pop > [data-pop]').forEach(function (trigger) {
    var pop = trigger.closest('.b-pop');
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !pop.classList.contains('is-open');
      /* 同層其他 pop 先收 */
      document.querySelectorAll('.b-pop.is-open').forEach(function (p) {
        if (p !== pop) { p.classList.remove('is-open'); var t = p.querySelector('[data-pop]'); if (t) t.setAttribute('aria-expanded', 'false'); }
      });
      pop.classList.toggle('is-open', open);
      trigger.setAttribute('aria-expanded', String(open));
    });
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest('.b-pop')) return;
    document.querySelectorAll('.b-pop.is-open').forEach(function (p) {
      p.classList.remove('is-open');
      var t = p.querySelector('[data-pop]'); if (t) t.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.b-pop.is-open').forEach(function (p) {
      p.classList.remove('is-open');
      var t = p.querySelector('[data-pop]'); if (t) { t.setAttribute('aria-expanded', 'false'); t.focus(); }
    });
  });

  /* ════════ Modal（兩段式：is-visible → reflow → is-open）════════ */
  function anyModalShown() {
    var list = document.querySelectorAll('.b-modal-overlay');
    for (var i = 0; i < list.length; i++) {
      if (list[i].offsetParent !== null || list[i].getClientRects().length > 0) return true;
    }
    return false;
  }
  var BModal = {
    open: function (el) {
      el = typeof el === 'string' ? document.querySelector(el) : el;
      if (!el) return;
      el.classList.add('is-visible');
      void el.offsetWidth;                       /* 強制 reflow，淡入才會播 */
      el.classList.add('is-open');
      document.body.classList.add('b-modal-lock');
      window.renderLucideIcons();
    },
    close: function (el) {
      el = typeof el === 'string' ? document.querySelector(el) : el;
      if (!el || !el.classList.contains('is-visible')) return;
      el.classList.remove('is-open');
      var done = false;
      function fin(e) {
        if (done || (e && e.target !== el)) return;
        done = true;
        el.classList.remove('is-visible');
        if (!anyModalShown()) document.body.classList.remove('b-modal-lock');
      }
      el.addEventListener('transitionend', fin, { once: true });
      setTimeout(fin, 200);                      /* 防呆：動畫被停用仍要收 */
    }
  };
  window.BModal = BModal;

  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-modal-open]');
    if (opener) { e.preventDefault(); BModal.open(opener.getAttribute('data-modal-open')); return; }
    var closer = e.target.closest('[data-modal-close]');
    if (closer) { BModal.close(closer.closest('.b-modal-overlay')); return; }
    /* 點遮罩關閉（BDialog 的 data-modal-vue 自己管，不接管） */
    var ov = e.target.classList && e.target.classList.contains('b-modal-overlay') ? e.target : null;
    if (ov && !ov.hasAttribute('data-modal-vue')) BModal.close(ov);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var opens = document.querySelectorAll('.b-modal-overlay.is-open:not([data-modal-vue])');
    if (opens.length) BModal.close(opens[opens.length - 1]);
  });

  /* ════════ Segment 滑塊（.b-seg.is-pill） ════════ */
  window.bSegThumb = function (seg, animate) {
    if (!seg) return;
    var thumb = seg.querySelector('.b-seg-thumb');
    var activeEl = seg.querySelector('.active');
    if (!thumb || !activeEl) return;
    if (!animate) seg.classList.add('no-anim');
    /* thumb 自帶 left 基準，位移只補「選項 offsetLeft 與基準的差」 */
    var baseLeft = parseFloat(getComputedStyle(thumb).left) || 0;
    seg.style.setProperty('--thumb-w', activeEl.offsetWidth + 'px');
    seg.style.setProperty('--thumb-x', (activeEl.offsetLeft - baseLeft) + 'px');
    /* 主項（data-thumb-solid）＝實色滑塊白字，其餘淡色滑塊 accent 字（見主題檔） */
    seg.classList.toggle('is-thumb-solid', activeEl.hasAttribute('data-thumb-solid'));
    if (!animate) {
      void thumb.offsetWidth;                    /* 強制 reflow，首次定位不滑動 */
      requestAnimationFrame(function () { seg.classList.remove('no-anim'); });
    }
  };
  document.querySelectorAll('.b-seg.is-pill').forEach(function (seg) {
    if (!seg.querySelector('.b-seg-thumb')) {
      var t = document.createElement('span');
      t.className = 'b-seg-thumb';
      t.setAttribute('aria-hidden', 'true');
      seg.insertBefore(t, seg.firstChild);
    }
    window.bSegThumb(seg, false);
    seg.addEventListener('click', function (e) {
      var btn = e.target.closest('a, button');
      if (!btn || !seg.contains(btn) || btn.classList.contains('active')) return;
      if (btn.tagName === 'BUTTON') e.preventDefault();
      seg.querySelectorAll('.active').forEach(function (o) { o.classList.remove('active'); });
      btn.classList.add('active');
      window.bSegThumb(seg, true);
      seg.dispatchEvent(new CustomEvent('segment:change', { detail: { value: btn.getAttribute('data-value') || btn.textContent.trim() }, bubbles: true }));
    });
  });
  window.addEventListener('resize', function () {
    document.querySelectorAll('.b-seg.is-pill').forEach(function (seg) { window.bSegThumb(seg, false); });
  });

  /* ════════ Tabs（underline）：[data-tab] ↔ .b-panel[data-panel] ════════ */
  document.querySelectorAll('.b-tabs').forEach(function (tabs) {
    var scope = tabs.parentElement;
    tabs.addEventListener('click', function (e) {
      var tab = e.target.closest('.b-tab[data-tab]');
      if (!tab) return;
      tabs.querySelectorAll('.b-tab').forEach(function (t) {
        t.classList.toggle('b-tab-active', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      });
      scope.querySelectorAll('.b-panel[data-panel]').forEach(function (p) {
        p.hidden = p.getAttribute('data-panel') !== tab.getAttribute('data-tab');
      });
    });
  });

  /* 首繪 icon */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { window.renderLucideIcons(); });
  else window.renderLucideIcons();
})();
