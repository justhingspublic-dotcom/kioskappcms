/* 自訂對話框 + 右下角 toast,取代瀏覽器原生 alert / confirm / prompt。
   A 後台(/cms)與 B 後台(/cms/<code>)的 base 殼層各載一次;純呈現層,無資料邏輯。

   BDialog.confirm(opts) → Promise<boolean>        確認框(對齊各頁「要放棄這次編輯嗎?」.b-modal.is-alert)
   BDialog.alert(opts)   → Promise<void>           單鈕提示框(錯誤 / 警告訊息)
   BDialog.prompt(opts)  → Promise<string|null>    輸入框(取消回 null,對齊原生 prompt 語意)
   BToast.success/danger/warning(msg)              右下角 toast(同 flash 訊息的 .b-toast*,CSS 動畫自播自移除)

   opts(皆可只傳字串 = title):
     title        標題(必填)
     desc         次要說明(可含 \n,自動保留換行)
     variant      'danger' | 'warn'(預設 warn;圖示與確認鈕顏色)
     confirmText  確認鈕文字(confirm 預設「確定」、alert 預設「知道了」、prompt 預設「確定」)
     cancelText   取消鈕文字(預設「取消」)
     value / placeholder / inputType / inputMode   prompt 專用(預設 text)

   疊層防護:overlay 標 data-modal-vue + 自帶 z-index,兩個 base 的共用 modal JS 不接管;
   Esc / 遮罩點擊 = 取消,以 capture 階段攔截避免關到底下頁面自己的 modal。 */
(function () {
    'use strict';

    /* ───────────────────────── toast ───────────────────────── */

    var TOAST_ICON = { success: 'circle-check', danger: 'circle-x', warning: 'triangle-alert' };

    function paintIcons() {
        if (window.renderLucideIcons) window.renderLucideIcons();
        else if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    }

    function ensureToastWrap() {
        var wrap = document.getElementById('bm-toast-live');
        if (!wrap || !wrap.isConnected) {
            wrap = document.createElement('div');
            wrap.id = 'bm-toast-live';
            wrap.className = 'b-toast-wrap';
            wrap.setAttribute('role', 'status');
            wrap.setAttribute('aria-live', 'polite');
            wrap.style.zIndex = '2100';   /* 蓋過 modal(1300/1400/1600);flash toast 為 2000 */
            document.body.appendChild(wrap);
        }
        return wrap;
    }

    function showToast(message, type) {
        if (!TOAST_ICON[type]) type = 'success';
        var wrap = ensureToastWrap();
        var t = document.createElement('div');
        t.className = 'b-toast b-toast-' + type;

        var ic = document.createElement('span');
        ic.className = 'b-toast-icon';
        ic.setAttribute('aria-hidden', 'true');
        ic.innerHTML = '<i data-lucide="' + TOAST_ICON[type] + '"></i>';

        var msg = document.createElement('span');
        msg.className = 'b-toast-msg';
        msg.textContent = message == null ? '' : String(message);

        t.appendChild(ic);
        t.appendChild(msg);
        wrap.appendChild(t);
        paintIcons();

        function dispose() {
            if (!t.isConnected) return;
            t.remove();
            if (!wrap.children.length) wrap.remove();
        }
        t.addEventListener('animationend', dispose);
        setTimeout(dispose, 6000);   /* 後備:動畫被停用時仍會移除 */
    }

    window.BToast = {
        show: showToast,
        success: function (m) { showToast(m, 'success'); },
        danger: function (m) { showToast(m, 'danger'); },
        warning: function (m) { showToast(m, 'warning'); }
    };

    /* ──────────────────────── dialog ───────────────────────── */

    var VARIANTS = {
        danger: { iconCls: 'b-alert-icon-danger', icon: 'triangle-alert', btnCls: 'b-btn b-btn-text b-btn-text-danger' },
        warn: { iconCls: 'b-alert-icon-warn', icon: 'triangle-alert', btnCls: 'b-btn b-btn-text' }
    };
    var openDialogs = [];   /* 疊層:Esc / Enter 只作用最上層 */
    var uid = 0;

    function normalizeOpts(opts, kind) {
        if (typeof opts === 'string') opts = { title: opts };
        opts = opts || {};
        var v = (opts.variant === 'danger') ? 'danger' : 'warn';
        return {
            title: opts.title || '',
            desc: opts.desc || '',
            variant: v,
            confirmText: opts.confirmText || (kind === 'alert' ? '知道了' : '確定'),
            cancelText: opts.cancelText || '取消',
            value: opts.value == null ? '' : String(opts.value),
            placeholder: opts.placeholder || '',
            inputType: opts.inputType || 'text',
            inputMode: opts.inputMode || ''
        };
    }

    function anyModalShown() {
        var list = document.querySelectorAll('.b-modal-overlay');
        for (var i = 0; i < list.length; i++) {
            var ov = list[i];
            if (ov.offsetParent !== null || ov.getClientRects().length > 0) return true;
        }
        return false;
    }

    /* kind: 'confirm' | 'alert' | 'prompt';resolve 值見檔頭 */
    function openDialog(kind, rawOpts) {
        var o = normalizeOpts(rawOpts, kind);
        var vr = VARIANTS[o.variant];
        var titleId = 'b-dlg-title-' + (++uid);

        return new Promise(function (resolve) {
            var prevFocus = document.activeElement;

            var overlay = document.createElement('div');
            overlay.className = 'b-modal-overlay';
            /* 標成 Vue 管理:A base 的 classic modal JS 對 data-modal-vue 一律不接管、
               觀察器(data-modal-anim=vue)不重播動畫;本檔動態節點也不在其 observe 名單 */
            overlay.setAttribute('data-modal-vue', '');
            overlay.setAttribute('data-modal-anim', 'vue');
            overlay.style.zIndex = '1600';   /* 蓋過頁面 modal(1300)與疊層 modal(1400) */

            var modal = document.createElement('div');
            modal.className = 'b-modal is-alert';
            modal.setAttribute('role', 'alertdialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-labelledby', titleId);

            var body = document.createElement('div');
            body.className = 'b-alert-body';

            var icon = document.createElement('div');
            icon.className = 'b-alert-icon ' + vr.iconCls;
            icon.setAttribute('aria-hidden', 'true');
            icon.innerHTML = '<i data-lucide="' + vr.icon + '"></i>';
            body.appendChild(icon);

            var h = document.createElement('h2');
            h.className = 'b-alert-title';
            h.id = titleId;
            h.textContent = o.title;
            body.appendChild(h);

            if (o.desc) {
                var p = document.createElement('p');
                p.className = 'b-alert-desc';
                p.style.whiteSpace = 'pre-line';   /* 原生 alert 常帶 \n,保留換行 */
                p.textContent = o.desc;
                body.appendChild(p);
            }

            var input = null;
            if (kind === 'prompt') {
                input = document.createElement('input');
                input.className = 'b-input';
                input.type = o.inputType;
                input.value = o.value;
                if (o.placeholder) input.placeholder = o.placeholder;
                if (o.inputMode) input.setAttribute('inputmode', o.inputMode);
                input.style.marginTop = '12px';
                input.style.width = '100%';
                input.style.textAlign = 'center';
                input.setAttribute('aria-label', o.title);
                body.appendChild(input);
            }

            var foot = document.createElement('div');
            foot.className = 'b-alert-foot';

            var btnCancel = null;
            if (kind !== 'alert') {
                btnCancel = document.createElement('button');
                btnCancel.type = 'button';
                btnCancel.className = 'b-btn b-btn-quiet';
                btnCancel.textContent = o.cancelText;
                foot.appendChild(btnCancel);
            }

            var btnOk = document.createElement('button');
            btnOk.type = 'button';
            btnOk.className = vr.btnCls;
            btnOk.textContent = o.confirmText;
            foot.appendChild(btnOk);

            modal.appendChild(body);
            modal.appendChild(foot);
            overlay.appendChild(modal);

            var settled = false;
            function settle(value) {
                if (settled) return;
                settled = true;
                var idx = openDialogs.indexOf(handle);
                if (idx !== -1) openDialogs.splice(idx, 1);
                /* 淡出(對齊 .b-modal-overlay 的 opacity 過渡),結束才移除節點 */
                overlay.classList.remove('is-open');
                var removed = false;
                function fin(e) {
                    if (removed || (e && e.target !== overlay)) return;
                    removed = true;
                    overlay.remove();
                    /* 還有其他 modal(頁面 Vue modal / classic / 其他 BDialog)開著就不解鎖捲動 */
                    if (!openDialogs.length && !anyModalShown()) document.body.classList.remove('b-modal-lock');
                }
                overlay.addEventListener('transitionend', fin);
                setTimeout(fin, 200);
                if (prevFocus && typeof prevFocus.focus === 'function' && prevFocus.isConnected) {
                    try { prevFocus.focus(); } catch (e) { }
                }
                resolve(value);
            }

            function confirmValue() {
                if (kind === 'confirm') return true;
                if (kind === 'prompt') return input.value;
                return undefined;
            }
            function cancelValue() {
                if (kind === 'confirm') return false;
                if (kind === 'prompt') return null;
                return undefined;
            }

            var handle = {
                cancel: function () { settle(cancelValue()); },
                confirm: function () { settle(confirmValue()); },
                root: overlay
            };

            btnOk.addEventListener('click', handle.confirm);
            if (btnCancel) btnCancel.addEventListener('click', handle.cancel);
            if (input) {
                input.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') { e.preventDefault(); handle.confirm(); }
                });
            }
            /* 點遮罩 = 取消;整個 overlay 的 click 一律不冒泡到 document,
               避免兩個 base 的全域 click(classic modal 關閉 / .b-pop 收合)接管 */
            overlay.addEventListener('click', function (e) {
                e.stopPropagation();
                if (e.target === overlay) handle.cancel();
            });

            openDialogs.push(handle);
            document.body.appendChild(overlay);
            document.body.classList.add('b-modal-lock');
            paintIcons();

            /* 兩段式淡入:先 display(is-visible)→ reflow → is-open(opacity 0→1),同既有 modal */
            overlay.classList.add('is-visible');
            void overlay.offsetWidth;
            overlay.classList.add('is-open');

            var focusTarget = input || btnOk;
            setTimeout(function () { try { focusTarget.focus(); } catch (e) { } }, 0);
        });
    }

    /* Esc = 取消最上層(capture 攔截:別讓 base 的全域 Esc 關到底下頁面自己的 modal);
       Tab = 簡易焦點圈(維持在對話框內) */
    document.addEventListener('keydown', function (e) {
        if (!openDialogs.length) return;
        var top = openDialogs[openDialogs.length - 1];
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            top.cancel();
        } else if (e.key === 'Tab') {
            var focusables = top.root.querySelectorAll('button, input');
            if (!focusables.length) return;
            var first = focusables[0];
            var last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            else if (!top.root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        }
    }, true);

    window.BDialog = {
        confirm: function (opts) { return openDialog('confirm', opts); },
        alert: function (opts) { return openDialog('alert', opts); },
        prompt: function (opts) { return openDialog('prompt', opts); }
    };
})();
