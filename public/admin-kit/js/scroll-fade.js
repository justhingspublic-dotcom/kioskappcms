/* 捲動漸層淡出:為任何 .is-scroll-faded 容器,依捲動位置切換 at-top / at-bottom,
   讓 CSS mask 漸層在已到頂/到底時收掉該側淡出(避免假截斷)。隱藏 scrollbar 由 CSS 負責。
   自動掃描既有元素 + 監看後續動態加入的元素;內容/尺寸變化也會重算。 */
(function () {
    'use strict';

    // 依 scrollTop / scrollHeight 更新單一元素的 at-top / at-bottom class
    function update(el) {
        var scrollTop = el.scrollTop;
        var maxScroll = el.scrollHeight - el.clientHeight;
        // 1px 容差,避免小數點誤差造成邊緣抖動
        var atTop = scrollTop <= 1;
        var atBottom = scrollTop >= maxScroll - 1;
        el.classList.toggle('at-top', atTop);
        el.classList.toggle('at-bottom', atBottom);
    }

    var resizeObserver = ('ResizeObserver' in window)
        ? new ResizeObserver(function (entries) {
            entries.forEach(function (entry) { update(entry.target); });
        })
        : null;

    // 綁定單一元素(只綁一次)
    function bind(el) {
        if (el.__scrollFadeBound) return;
        el.__scrollFadeBound = true;
        el.addEventListener('scroll', function () { update(el); }, { passive: true });
        if (resizeObserver) resizeObserver.observe(el);
        // 初始狀態(下一個 frame 等版面穩定後再算一次)
        update(el);
        requestAnimationFrame(function () { update(el); });
    }

    function scan(root) {
        var scope = root && root.querySelectorAll ? root : document;
        scope.querySelectorAll('.is-scroll-faded').forEach(bind);
    }

    function init() {
        scan(document);
        // modal 內容通常由 Vue 動態產生 / 顯示;監看 DOM 變化,新出現的容器也綁上
        if ('MutationObserver' in window) {
            var mo = new MutationObserver(function (mutations) {
                mutations.forEach(function (m) {
                    m.addedNodes.forEach(function (node) {
                        if (node.nodeType !== 1) return;
                        if (node.classList && node.classList.contains('is-scroll-faded')) bind(node);
                        if (node.querySelectorAll) scan(node);
                    });
                    // 屬性/class 變動(例如 v-show 切換顯示)也重算一次目標元素
                    if (m.type === 'attributes' && m.target.classList
                        && m.target.classList.contains('is-scroll-faded')) {
                        update(m.target);
                    }
                });
            });
            mo.observe(document.body, {
                childList: true, subtree: true,
                attributes: true, attributeFilter: ['style', 'class']
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 對外:動態注入後可手動重掃(對齊 BDropdown.init 的用法)
    window.ScrollFade = { scan: scan, update: update };
})();
