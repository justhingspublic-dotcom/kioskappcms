/* ==========================================================================
   圖示動態（2026-10-14 user：提升質感）
   1. 變形：同一顆鈕切換狀態時，圖示從舊形狀「長成」新形狀，不再硬換（window.morphIcon／morphFlash）
      - 手機版選單鈕 ☰ ↔ ✕（跟著 .sidebar.open）、密碼眼睛（app.js）
      - 登入成功 登入圖示 → 圓圈打勾、「在機器上展示此頁」成功 播放 → 打勾再變回來（app.js）
   2. 一筆畫出來（window.drawIcon）：右下角通知的 ✓／✕／⚠、空狀態大圖示、批量精靈步驟完成的 ✓（下面的 MutationObserver 自動接）；
      新增機器「正在新增」轉圈最後一圈閉合再畫出勾（window.closeSpinner，app.js）。批量／加到其他機器的勾選框在 style.css（純 CSS）
   3. 轉一圈：機器清單「重新整理」、工作區「重新載入」按下時；頂欄深淺色鈕換上來的圖示轉進來（太陽↔月亮變形不好看，見 spinModeButton）
   變形引擎＝morphicons 1.7.1（MIT，https://www.morphicons.com），放 vendor/morphicons-1.7.1/，只用它的 dom 驅動；
   圖示資料直接拿頁面已載入的 Lucide（lucide.icons），跟其他靜態圖示同一套、同粗細。
   模組還沒載好、Lucide 沒資料或瀏覽器不支援時一律不接手，維持原本的硬換；系統開了「減少動態效果」就直接換、不播動畫。
   動畫一律用 Web Animations（不用 CSS animation：toast 靠冒泡上來的 animationend 移除自己，CSS 動畫會害它提早消失）。
   ========================================================================== */
(() => {
  'use strict';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let createMorph = null;
  const ready = import('./vendor/morphicons-1.7.1/dom.js')
    .then((m) => { createMorph = m.createMorph; })
    .catch(() => { /* 載不到就維持硬換 */ });

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** 要做動畫的 svg 先拔掉 data-lucide：app.js 到處呼叫 lucide.createIcons()，它會把頁面上所有還帶 data-lucide 的 svg
      重新畫成新的靜態圖示，正在播的動畫就被換掉（轉圈收勾變回轉圈、空狀態只畫一次的原因，2026-10-14） */
  const keep = (svg) => { svg.removeAttribute('data-lucide'); return svg; };
  const pascal = (name) => name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
  const iconData = (name) => (window.lucide && lucide.icons && lucide.icons[pascal(name)]) || null;
  /** Lucide 畫出來的 svg 帶 class「lucide-圖示名」，用它認出目前顯示的是哪一個 */
  const shownName = (svg) => {
    const c = [...svg.classList].find((k) => k.startsWith('lucide-') && k !== 'lucide-morph');
    return c ? c.slice(7) : null;
  };

  /** 把 host 裡的靜態 Lucide 圖示換成可變形的一條 path（沿用原 svg 的 class、尺寸、筆畫粗細）。換不了回 null。 */
  function attach(host, ref, name) {
    const data = name && iconData(name);
    if (!createMorph || !ref || !data) return null;
    const svg = ref.cloneNode(false);
    [...svg.classList].forEach((k) => { if (k.startsWith('lucide-') || k === 'b-spin') svg.classList.remove(k); }); // 轉圈變打勾時不能跟著繼續轉
    svg.classList.add('lucide-morph');
    svg.removeAttribute('data-lucide');
    const path = document.createElementNS(SVG_NS, 'path');
    svg.appendChild(path);
    host._morph = { path, svg, name, m: createMorph(path, data, { reducedMotion: 'user' }) };
    return host._morph;
  }

  /** host 裡的圖示變形成 name。成功（或已經是它）回 true；還不能接手回 false，呼叫端照舊硬換。 */
  window.morphIcon = (host, name) => {
    const data = iconData(name);
    if (!host || !data || !createMorph) return false;
    let st = host._morph;
    if (!st || !host.contains(st.path)) {
      const svg = host.querySelector('svg');
      st = svg && attach(host, svg, shownName(svg));
      if (!st) return false;
      svg.replaceWith(st.svg);
    }
    if (st.name !== name) { st.m.morphTo(data, 'snappy'); st.name = name; }
    return true;
  };

  /** 暫時變成 name（例如成功打勾），ms 後變回原本的圖示；連按時一律回到最早那個圖示 */
  window.morphFlash = (host, name, ms = 1600) => {
    const st = host && host._morph;
    const svg = host && host.querySelector('svg');
    const home = host && (host._morphHome || (st && host.contains(st.path) ? st.name : svg && shownName(svg)));
    if (!home || !window.morphIcon(host, name)) return;
    host._morphHome = home;
    clearTimeout(host._morphBack);
    host._morphBack = setTimeout(() => { delete host._morphHome; window.morphIcon(host, home); }, ms);
  };

  /** 一段線描出來。一律從「左上那一端」起筆：Lucide 的勾（m16 9-5.5 5.5L8 12）是從右上往左下定義的，
      照原方向畫像倒著寫（user 2026-10-14）。反過來畫＝dashoffset 從 -長度走到 0；頭尾同點（圓、三角框）照原方向。 */
  function drawStroke(el, delay, duration) {
    const len = (el.getTotalLength ? el.getTotalLength() : 0) + 1;
    if (len <= 1) return;
    const a = el.getPointAtLength(0), b = el.getPointAtLength(len - 1);
    const from = b.x + b.y < a.x + a.y - 1 ? -len : len;
    el.style.strokeDasharray = `${len} ${len}`;
    const clear = () => { el.style.strokeDasharray = ''; };
    el.animate([{ strokeDashoffset: from }, { strokeDashoffset: 0 }],
      { duration, delay, easing: 'cubic-bezier(.33, 1, .68, 1)', fill: 'backwards' }).finished.then(clear, clear);
  }

  /** 一筆畫出來：svg 裡每段線依序描出來（前後稍微重疊）。同一個 svg 只畫一次（again＝空狀態再次出現時重畫）。 */
  const drawn = new WeakSet();
  window.drawIcon = (svg, { duration = 500, delay = 0, again = false } = {}) => {
    if (!svg || !svg.animate || (drawn.has(svg) && !again) || reduced()) return;
    drawn.add(keep(svg));
    const parts = [...svg.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse')];
    const each = duration * 0.6;
    const gap = parts.length > 1 ? (duration - each) / (parts.length - 1) : 0;
    parts.forEach((el, k) => drawStroke(el, delay + k * gap, each));
  };

  /** 「正在新增」→「已新增」（user 2026-10-14：同一個畫面，轉圈最後一圈閉合再打勾）：不換圖，把轉圈換成同角度、同大小的
      一段圓弧（Lucide loader-circle＝r 9、從三點鐘順時針 288°），再轉最後一圈（起速接上轉圈的每秒一圈、慢慢停）、
      同時缺口補滿、半徑長到 r 10，停下前從左畫出勾，顏色從轉圈色漸變成完成色＝靜態的 circle-check。
      要在換 class（顏色）之前呼叫：先記下現在的角度與顏色；動畫在 microtask 才開始，那時讀得到換好 class 的完成色。 */
  window.closeSpinner = (host) => {
    const old = host && host.querySelector('svg');
    const data = iconData('circle-check');
    if (!old || !old.animate || !data) return false;
    const mt = getComputedStyle(old).transform;
    const [ma, mb] = mt && mt.startsWith('matrix(') ? mt.slice(7, -1).split(',').map(Number) : [1, 0];
    const angle = Math.atan2(mb, ma) * 180 / Math.PI;
    const fromColor = getComputedStyle(host).color;
    const svg = keep(old.cloneNode(false));
    [...svg.classList].forEach((k) => { if (k.startsWith('lucide-') || k === 'b-spin') svg.classList.remove(k); });
    svg.classList.add('lucide-circle-check');
    svg.style.animation = 'none'; // 不疊 pair-pop
    const [ring, tick] = data.map(([tag, attrs]) => {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      return svg.appendChild(el);
    });
    old.replaceWith(svg);
    if (reduced()) return true;
    const C = 2 * Math.PI * 10;
    const sw = parseFloat(getComputedStyle(ring).strokeWidth) || 2;
    const start = { transform: `rotate(${angle}deg) scale(.9)`, strokeDasharray: `${C * 0.8} ${C}`, strokeWidth: `${sw / 0.9}px` };
    Object.assign(ring.style, { transformOrigin: '12px 12px', ...start });
    svg.style.color = fromColor;
    queueMicrotask(() => {
      const toColor = getComputedStyle(host).color;
      const T = 800;
      ring.animate([start, { transform: `rotate(${angle + 360}deg) scale(1)`, strokeDasharray: `${C} ${C}`, strokeWidth: `${sw}px` }],
        { duration: T, easing: 'cubic-bezier(.35, .28, .25, 1)' }).finished
        .then(() => { for (const k of ['transform', 'transformOrigin', 'strokeDasharray', 'strokeWidth']) ring.style[k] = ''; });
      svg.animate([{ color: fromColor }, { color: toColor }], { duration: T, easing: 'ease' }).finished.then(() => { svg.style.color = ''; });
      drawStroke(tick, T - 260, 380);
    });
    return true;
  };

  /** 按下去轉一圈（所有重新整理／重新載入鈕都用這個，user 2026-10-14：對齊內容管理的那顆） */
  const spinOnce = (svg) => {
    if (svg && svg.animate && !reduced()) keep(svg).animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 650, easing: 'cubic-bezier(.4, 0, .2, 1)' });
  };

  /** 自動接手會重畫的地方（不必改各處程式）：通知、空狀態、精靈步驟。toast／空狀態／步驟都是插入後同步轉成 svg，
      所以這裡（microtask）看到的已經是 svg。步驟每格只畫一次。
      空狀態（user 2026-10-14：只畫一次、沒重播）：每次「出現在眼前」就畫——插入時看得到就馬上畫；藏著的（別的頁面、
      工作區切到別的分頁）等 IntersectionObserver 回報看得到再畫。同一個空狀態 1.5 秒內不重畫（同一動作連續重繪、IO 第一次回報）。 */
  const emptyLast = new Map();
  function drawEmpty(svg) {
    const key = svg.closest('.b-empty')?.querySelector('.b-empty-title')?.textContent || '';
    if (Date.now() - (emptyLast.get(key) || 0) < 1500) return;
    emptyLast.set(key, Date.now());
    if (svg.classList.contains('lucide-unplug') && unplugApart(svg)) return;
    window.drawIcon(svg, { duration: 900, again: true });
  }
  /** 插頭拔開（2026-10-20 user：園區測站資料來源連不上的空狀態）：Lucide unplug 的插頭（左下）跟插座（右上）先插在一起，
      晃一下、被拉開時多拉過頭一點再回到原位（＝靜態的 unplug 圖示）；顏色從灰轉成空狀態設定的紅。
      兩半各沿對角線移 3 單位剛好面貼面。認不出兩半（圖示改版）就照舊一筆畫。 */
  function unplugApart(svg) {
    if (!svg.animate) return false;
    const NS = 'http://www.w3.org/2000/svg';
    let plug = svg.querySelector('g.unplug-plug'), socket = svg.querySelector('g.unplug-socket');
    if (!plug || !socket) {
      const paths = [...svg.querySelectorAll('path')];
      const sock = paths.filter((p) => /^m19 5|^m12 6/.test(p.getAttribute('d') || ''));
      const rest = paths.filter((p) => !sock.includes(p));
      if (sock.length !== 2 || rest.length !== 4) return false;
      plug = document.createElementNS(NS, 'g'); plug.setAttribute('class', 'unplug-plug');
      socket = document.createElementNS(NS, 'g'); socket.setAttribute('class', 'unplug-socket');
      svg.append(socket, plug);
      socket.append(...sock); plug.append(...rest);
    }
    keep(svg);
    if (reduced()) return true;
    svg.style.overflow = 'visible';
    const timing = { duration: 950, delay: 120, easing: 'linear', fill: 'backwards' };
    const frames = (dx) => [
      { transform: `translate(${dx}px, ${-dx}px)`, easing: 'ease-in-out' }, // 插著
      { transform: `translate(${dx * 0.82}px, ${-dx * 0.82}px)`, offset: 0.18, easing: 'ease-in-out' }, // 被扯一下
      { transform: `translate(${dx}px, ${-dx}px)`, offset: 0.32, easing: 'cubic-bezier(.2, .9, .3, 1)' },
      { transform: `translate(${-dx * 0.3}px, ${dx * 0.3}px)`, offset: 0.72, easing: 'ease-out' }, // 拔開、拉過頭
      { transform: 'translate(0, 0)' },
    ];
    plug.animate(frames(3), timing); // 插頭往右上靠過去＝插著
    socket.animate(frames(-3), timing); // 插座往左下靠過去
    const grey = getComputedStyle(document.documentElement).getPropertyValue('--text-body-subtle').trim() || '#6B7280';
    const red = getComputedStyle(svg).color;
    svg.animate([{ color: grey }, { color: grey, offset: 0.34 }, { color: red, offset: 0.6 }, { color: red }], timing);
    return true;
  }
  const emptyIO = window.IntersectionObserver && new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.target.isConnected) emptyIO.unobserve(e.target);
      else if (e.isIntersecting) drawEmpty(e.target);
    }
  });
  const stepsDone = new WeakSet();
  /** 垃圾桶「掀蓋」（2026-10-14 user：一筆畫出來的垃圾桶怪怪的，要開垃圾桶蓋的感覺）：
      蓋子（Lucide trash-2 的 M3 6h18 那條＋上面的提把）包成一組，以左端 (3,6) 當鉸鏈往上掀開、停一下、
      落下時多壓過頭一點再彈回；蓋上那一瞬間整個桶子往下沉 1px，像東西丟進去。找不到蓋子（圖示改版）就照舊一筆畫。 */
  function lidOpen(svg) {
    const parts = [...svg.querySelectorAll('path')].filter((p) => /^M3 6h18|^M8 6V4/.test(p.getAttribute('d') || ''));
    if (parts.length !== 2) return false;
    keep(svg);
    if (reduced()) return true;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    parts[0].before(g);
    g.append(...parts);
    g.style.transformBox = 'view-box';
    g.style.transformOrigin = '3px 6px';
    svg.style.overflow = 'visible'; // 掀開時蓋子尖端會超出 24×24 的框，不能被切掉
    // 角度 16°（user 2026-10-14：30° 看起來像開到 90 度太超過——蓋子跟桶子一樣寬，翹起來的那端很明顯）
    const timing = { duration: 820, delay: 260, easing: 'linear' };
    g.animate([
      { transform: 'rotate(0)', easing: 'cubic-bezier(.2, .8, .3, 1)' },
      { transform: 'rotate(-16deg)', offset: 0.3 },
      { transform: 'rotate(-16deg)', offset: 0.5, easing: 'cubic-bezier(.6, 0, .9, .6)' },
      { transform: 'rotate(3deg)', offset: 0.72, easing: 'ease-out' },
      { transform: 'rotate(0)' },
    ], timing);
    svg.animate([
      { transform: 'none' },
      { transform: 'none', offset: 0.7 },
      { transform: 'translateY(1px)', offset: 0.76 },
      { transform: 'none' },
    ], timing);
    return true;
  }
  function drawNew(svg) {
    if (drawn.has(svg)) return;
    if (svg.closest('.b-toast-icon')) {
      if (svg.classList.contains('lucide-trash-2') && lidOpen(svg)) return;
      window.drawIcon(svg, { delay: 180, duration: 500 });
      return;
    }
    if (svg.closest('.b-empty-icon') && svg.closest('.b-empty')) {
      keep(svg);
      if (svg.getClientRects().length) drawEmpty(svg);
      if (emptyIO) emptyIO.observe(svg);
      return;
    }
    const step = svg.closest('.wiz-n') && svg.closest('.wiz-step');
    if (step && !stepsDone.has(step)) { stepsDone.add(step); window.drawIcon(svg, { duration: 380, delay: 60 }); }
  }
  function watchInserts() {
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'svg') drawNew(n);
          else n.querySelectorAll('.b-toast-icon svg, .b-empty-icon svg, .wiz-n svg').forEach(drawNew);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  /** 深淺色鈕不用變形：太陽→月亮變形到一半會縮成一顆黑球（2026-10-14 逐格實測），改成換上來的圖示轉進來
      （旋轉＋放大＋淡入、尾端微彈），跟 kit 的整頁淡入淡出（.35s）一起播。三顆 .mode-ic 照舊由 shell.css 依按鈕 class 輪流顯示。 */
  function spinModeButton(btn) {
    let last = btn.className;
    new MutationObserver(() => {
      if (btn.className === last) return; // 跟隨裝置時 OS 換深淺只重寫 title，圖示沒換
      last = btn.className;
      if (reduced()) return;
      const shown = [...btn.querySelectorAll('.mode-ic')].find((s) => getComputedStyle(s).display !== 'none');
      shown?.animate([{ transform: 'rotate(-120deg) scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 450, easing: 'cubic-bezier(.34, 1.56, .64, 1)' });
    }).observe(btn, { attributes: true, attributeFilter: ['class'] });
  }

  function setup() {
    const modeBtn = document.querySelector('.header-mode-btn');
    if (modeBtn) spinModeButton(modeBtn);
    for (const id of ['reloadBtn', 'devicesReloadBtn']) document.getElementById(id)?.addEventListener('click', (e) => spinOnce(e.currentTarget.querySelector('svg')));
    watchInserts();

    if (!createMorph || !window.lucide || !lucide.icons) return;
    if (document.querySelector('i[data-lucide]') && window.renderLucideIcons) window.renderLucideIcons();

    // 手機版選單鈕：抽屜開著＝✕（側欄在頂欄下面打開，這顆鈕一直看得到）
    const menuBtn = document.querySelector('.mobile-menu-btn');
    const sidebar = document.querySelector('.sidebar');
    if (menuBtn && sidebar && window.morphIcon(menuBtn, 'menu')) {
      const sync = () => {
        const open = sidebar.classList.contains('open');
        window.morphIcon(menuBtn, open ? 'x' : 'menu');
        menuBtn.title = open ? '關閉選單' : '開啟選單';
      };
      sync();
      new MutationObserver(sync).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
    }
  }

  const domReady = document.readyState === 'loading'
    ? new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }))
    : Promise.resolve();
  Promise.all([ready, domReady]).then(setup);
})();
