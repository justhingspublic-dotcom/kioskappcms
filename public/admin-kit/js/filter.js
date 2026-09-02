// 篩選 AJAX 局部更新:攔截篩選面板的送出/重置,只換表格區,不整頁重整。
// 漸進增強:沒 JS 時 form 就是普通 GET、重置就是普通連結 → 行為不變(降級安全)。
//
// 約定(由 _components.html 的 filter_panel / table macro 標記):
//   - form[data-filter-form]        篩選表單(GET)
//   - [data-filter-target]          要被抽換的容器(通常是 .b-tbl-scroll 表格區)
//   - .b-pop / [data-pop] / .b-btn-filter   篩選下拉鈕(更新 is-active / 收起面板)
(function () {
  var TARGET = '[data-filter-target]';

  function closePop(form) {
    var pop = form.closest('.b-pop');
    if (pop) {
      pop.classList.remove('is-open');
      var trigger = pop.querySelector('[data-pop]');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
  }

  // 依目前 query 有無「有值」參數,更新篩選鈕的已套用態
  function syncTriggerState(pop, search) {
    if (!pop) return;
    var btn = pop.querySelector('.b-btn-filter');
    if (!btn) return;
    var params = new URLSearchParams(search);
    var hasValue = false;
    params.forEach(function (v) { if (v !== '') hasValue = true; });
    btn.classList.toggle('is-active', hasValue);
  }

  // 從回傳的整頁 HTML 抽出新的 target 內容,換掉現有的
  function swap(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var fresh = doc.querySelector(TARGET);
    var current = document.querySelector(TARGET);
    if (!fresh || !current) return false;
    current.replaceWith(fresh);
    // 換進來的 select 重新交給共用下拉增強
    if (window.BDropdown) window.BDropdown.init(fresh);
    return true;
  }

  function load(url, pop) {
    var current = document.querySelector(TARGET);
    if (current) current.classList.add('is-loading');
    fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        if (!swap(html)) { window.location.href = url; return; }  // 抽換失敗 → 退回整頁導航
        var u = new URL(url, window.location.origin);
        history.pushState({}, '', u.pathname + u.search);          // 網址同步(可重整/分享),不 reload
        syncTriggerState(pop, u.search);
      })
      .catch(function () { window.location.href = url; });          // 網路錯 → 降級
  }

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('form[data-filter-form]');
    if (!form) return;
    if (!document.querySelector(TARGET)) return;  // 該頁沒目標容器 → 不接管,走原生送出
    e.preventDefault();
    var pop = form.closest('.b-pop');
    var qs = new URLSearchParams(new FormData(form)).toString();
    var action = form.getAttribute('action') || window.location.pathname;
    closePop(form);
    load(action + (qs ? '?' + qs : ''), pop);
  });

  // 面板內「重置」是 <a href>(不帶 query 的同頁)→ 也攔截走 AJAX,清空回全部
  document.addEventListener('click', function (e) {
    var link = e.target.closest('.b-pop-foot a[href]');
    if (!link) return;
    if (!document.querySelector(TARGET)) return;
    e.preventDefault();
    var pop = link.closest('.b-pop');
    closePop(link.closest('form') || link);
    // 同步面板內欄位回預設(視覺一致),再載入
    var form = pop && pop.querySelector('form[data-filter-form]');
    if (form) form.reset();
    load(link.getAttribute('href'), pop);
  });

  // 瀏覽器上一頁/下一頁:用該網址重新載入表格區
  window.addEventListener('popstate', function () {
    if (!document.querySelector(TARGET)) return;
    load(window.location.pathname + window.location.search, document.querySelector('.b-pop'));
  });
})();
