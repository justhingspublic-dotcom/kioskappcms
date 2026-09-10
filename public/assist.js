/* ==========================================================================
   AI 智能客服（網頁播放器版，2026-09-10）— App AssistantScreen／AssistantViewModel 的網頁翻版。
   用法：KioskAssist.open({ base, deviceId, deviceKey, agentId, accent, layout, configured, onClose })
   - 對話走後台代理 /api/assist/…（帶 X-Device-Key），後台用這台機器 config 裡的客服帳號登入 JustAI；
     訊息回覆是 SSE 逐字，這裡再用「緩衝逐字揭露」打字機效果（同 App REVEAL_INTERVAL_MS=26）。
   - 開場＝頭像＋問候語＋建議問題 chips；使用者泡泡靠右、AI 靠左無框；串流游標；typing 三點；回到底部鈕。
   - AI 回覆解析成文字／圖片／YouTube／連結卡片（同 App MessageBlocks）；圖片全螢幕、影片內嵌播放、連結內嵌瀏覽。
   - 語音輸入：Web Speech API（zh-TW，連續聆聽、5 秒沒聲音自動停）；附件依客服旗標。
   - 90 秒沒人碰自動關閉並清空對話（同 App IdleReturn）。固定淺色。
   ========================================================================== */
window.KioskAssist = (() => {
  'use strict';
  const IDLE_MS = 90_000;
  const REVEAL_MS = 26;
  const SILENCE_MS = 5_000;
  const FONT_OPTIONS = [[0.85, '小'], [1, '標準'], [1.2, '大'], [1.45, '特大']];

  let root = null;
  let S = null; // 目前這場對話的狀態

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const colorCss = (n) => (n == null ? null : typeof n === 'string' ? n : '#' + (Number(n) >>> 0).toString(16).padStart(8, '0').slice(2));

  // ---------- API ----------
  async function api(method, path, body, extra = {}) {
    const headers = { 'X-Device-Key': S.deviceKey, 'Cache-Control': 'no-cache', ...(extra.headers || {}) };
    let payload = body;
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(S.base + path, { method, headers, body: payload, signal: extra.signal, cache: 'no-store' });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, notConfigured: !!j.notConfigured });
    }
    return r;
  }
  const dev = () => encodeURIComponent(S.deviceId);
  const ag = () => encodeURIComponent(S.agentId);

  // ---------- 開關 ----------
  function open(opts) {
    close(true);
    S = {
      base: opts.base || '', deviceId: opts.deviceId, deviceKey: opts.deviceKey, agentId: String(opts.agentId || '').trim(),
      accent: colorCss(opts.accent) || null, layout: opts.layout === 'Mobile' ? 'Mobile' : 'Kiosk', configured: !!opts.configured && !!String(opts.agentId || '').trim(),
      onClose: opts.onClose || (() => {}),
      agent: null, agentError: null, messages: [], pending: [], threadId: null, streaming: false, abort: null,
      nextId: 1, fontScale: 1, msgEls: new Map(), idle: 0, atBottom: true,
      voice: null, layer: null,
    };
    root = h('div', 'as-root');
    root.style.setProperty('--as-scale', String(Math.min(1.5, Math.max(1, window.innerWidth / 820))));
    root.style.setProperty('--as-fs', S.layout === 'Kiosk' ? '1.45' : '1');
    applyAccent();
    root.innerHTML = `
      <header class="as-top">
        <button type="button" class="as-icon-btn" data-act="back" aria-label="返回展示"><span class="material-icons">arrow_back</span></button>
        <div class="as-top-title"><span class="as-avatar as-avatar-top"></span><span class="as-name">智能客服</span></div>
        <button type="button" class="as-icon-btn" data-act="font" aria-label="字體大小"><span class="material-icons">format_size</span></button>
        <button type="button" class="as-icon-btn" data-act="new" aria-label="新對話" disabled><span class="material-icons">add</span></button>
      </header>
      <div class="as-body"><div class="as-scroll"></div><button type="button" class="as-jump" data-act="jump" hidden aria-label="回到底部"><span class="material-icons">arrow_downward</span></button></div>
      <footer class="as-input" hidden></footer>`;
    document.body.appendChild(root);
    root.addEventListener('click', onRootClick);
    root.addEventListener('pointerdown', touch, { capture: true, passive: true });
    root.addEventListener('keydown', touch, { capture: true });
    root.querySelector('.as-scroll').addEventListener('scroll', onScroll, { passive: true });
    touch();
    renderTop();
    renderBody();
    renderInput();
    if (S.configured) loadAgent();
  }

  function close(silent) {
    if (!root) return;
    stopStream(true);
    stopVoice();
    clearTimeout(S.idle);
    if (S.reveal) clearInterval(S.reveal);
    root.remove(); root = null;
    const cb = S.onClose; S = null;
    if (!silent) cb();
  }
  function touch() { if (!S) return; clearTimeout(S.idle); S.idle = setTimeout(() => close(), IDLE_MS); }

  async function loadAgent() {
    try {
      const r = await api('GET', `/api/assist/${dev()}/agent?agentId=${ag()}`);
      S.agent = await r.json();
      applyAccent();
      renderTop(); renderBody(); renderInput();
    } catch (e) {
      S.agentError = e.notConfigured ? '__notconfigured__' : (e.message || '無法連線');
      renderBody(); renderInput();
    }
  }
  function applyAccent() { if (root) root.style.setProperty('--as-accent', S.accent || S.agent?.color || '#6366F1'); }
  const greeting = () => (S.agent?.greeting || '').trim() || (S.agent?.name ? `您好！我是${S.agent.name}，很高興為您服務。` : '您好！很高興為您服務，請問需要什麼協助？');

  // ---------- 畫面 ----------
  function avatarEl(size) {
    const a = h('span', 'as-avatar');
    a.style.width = `calc(${size}px * var(--as-scale))`; a.style.height = `calc(${size}px * var(--as-scale))`;
    const fallback = () => { a.innerHTML = '<span class="material-icons">smart_toy</span>'; a.querySelector('.material-icons').style.fontSize = `calc(${size * 0.55}px * var(--as-scale))`; };
    if (S.agent?.avatarUrl) {
      const img = new Image(); img.alt = ''; img.src = S.agent.avatarUrl;
      img.onerror = fallback; a.appendChild(img);
    } else fallback();
    return a;
  }
  function renderTop() {
    const top = root.querySelector('.as-avatar-top');
    top.replaceWith(Object.assign(avatarEl(36), { className: 'as-avatar as-avatar-top' }));
    root.querySelector('.as-name').textContent = S.agent?.name || '智能客服';
    root.querySelector('[data-act="new"]').disabled = !S.messages.length;
  }
  function renderBody() {
    const sc = root.querySelector('.as-scroll');
    sc.innerHTML = ''; S.msgEls.clear();
    if (!S.configured || S.agentError === '__notconfigured__') {
      sc.appendChild(h('div', 'as-notice', `<span class="material-icons">smart_toy</span><h3>智能客服尚未設定</h3><p>請在後台「機器設定」填寫智能客服帳號，並在這一格的點擊動作選擇客服。</p>`));
      return;
    }
    if (S.agentError) {
      sc.appendChild(h('div', 'as-notice', `<span class="material-icons">smart_toy</span><h3>無法連線到智能客服</h3><p>${esc(S.agentError)}</p>`));
      return;
    }
    if (!S.messages.length) {
      const empty = h('div', 'as-empty');
      empty.appendChild(avatarEl(72));
      empty.appendChild(h('div', 'as-greeting', esc(greeting())));
      const qs = (S.agent?.suggestQuestions || []).slice(0, 4);
      if (qs.length) {
        const chips = h('div', 'as-chips');
        qs.forEach((q) => { const b = h('button', 'as-chip', esc(q)); b.type = 'button'; b.addEventListener('click', () => send(q)); chips.appendChild(b); });
        empty.appendChild(chips);
      }
      sc.appendChild(empty);
      return;
    }
    const list = h('div', 'as-list');
    S.messages.forEach((m) => list.appendChild(messageEl(m)));
    sc.appendChild(list);
    scrollToBottom(false);
  }
  function messageEl(m) {
    const el = h('div', 'as-msg ' + (m.fromUser ? 'user' : 'bot'));
    el.dataset.id = m.id;
    S.msgEls.set(m.id, el);
    fillMessage(el, m);
    return el;
  }
  function fillMessage(el, m) {
    el.innerHTML = '';
    if (m.fromUser) {
      if (m.attachments.length) {
        const att = h('div', 'as-att');
        m.attachments.forEach((a) => {
          if (a.isImage) { const img = new Image(); img.src = a.previewUrl; img.alt = a.name; att.appendChild(img); }
          else att.appendChild(h('span', 'doc', `<span class="material-icons">insert_drive_file</span>${esc(a.name)}`));
        });
        el.appendChild(att);
      }
      if (m.text) el.appendChild(h('div', 'as-bubble', esc(m.text)));
      return;
    }
    el.appendChild(avatarEl(30));
    const body = h('div', 'as-bot-body');
    if (m.streaming && !m.text) body.appendChild(h('span', 'as-typing', '<i></i><i></i><i></i>'));
    else {
      const blocks = parseBlocks(m.text, m.streaming);
      blocks.forEach((b, i) => {
        if (b.type === 'text') body.appendChild(textEl(b.text, m.streaming && i === blocks.length - 1, m.isError));
        else if (b.type === 'image') body.appendChild(imageEl(b));
        else if (b.type === 'video') body.appendChild(videoEl(b.videoId));
        else if (b.type === 'link') body.appendChild(linkEl(b.url));
      });
    }
    el.appendChild(body);
  }
  function updateMessage(m) { const el = S.msgEls.get(m.id); if (el) { fillMessage(el, m); if (S.atBottom) scrollToBottom(false); } }
  function scrollToBottom(smooth) { const sc = root.querySelector('.as-scroll'); sc.scrollTo({ top: sc.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); }
  function onScroll() {
    const sc = root.querySelector('.as-scroll');
    S.atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 96;
    root.querySelector('.as-jump').hidden = S.atBottom || !S.messages.length;
  }

  // ---------- AI 回覆的區塊解析（同 App MessageBlocks.kt）----------
  const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);
  const IMAGE_HOSTS = ['encrypted-tbn', '.gstatic.com/images', 'googleusercontent.com', 'upload.wikimedia.org', 'images.unsplash.com', 'i.imgur.com'];
  function youTubeId(url) {
    const m = url.match(/(?:youtube(?:-nocookie)?\.com\/(?:embed\/|shorts\/|v\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{5,})/);
    if (m) return m[1];
    if (/youtube/i.test(url)) { const v = url.match(/[?&]v=([A-Za-z0-9_-]{5,})/); if (v) return v[1]; }
    return null;
  }
  function looksLikeImage(url) {
    const path = url.split('?')[0].split('#')[0];
    const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
    return IMAGE_EXT.has(ext) || IMAGE_HOSTS.some((x) => url.toLowerCase().includes(x));
  }
  function aloneOnLine(text, s, e) {
    const ls = text.lastIndexOf('\n', s) + 1;
    const le = text.indexOf('\n', e + 1); const end = le < 0 ? text.length : le;
    return !text.slice(ls, s).trim() && !text.slice(e + 1, end).trim();
  }
  function parseBlocks(text, streaming) {
    const cands = [];
    const overlaps = (s, e) => cands.some((c) => c.s <= e && s <= c.e);
    let m;
    const IFRAME = /<iframe\b[^>]*>(?:\s*<\/iframe>)?/gi;
    while ((m = IFRAME.exec(text))) {
      const src = (m[0].match(/src\s*=\s*["']([^"']+)["']/i) || [])[1];
      const block = !src ? null : youTubeId(src) ? { type: 'video', videoId: youTubeId(src) } : looksLikeImage(src) ? { type: 'image', url: src, alt: '' } : { type: 'text', text: src };
      cands.push({ s: m.index, e: m.index + m[0].length - 1, block });
    }
    const MD_IMAGE = /!\[([^\]\n]*)\]\(\s*([^)\s]+)\s*\)/g;
    while ((m = MD_IMAGE.exec(text))) {
      const s = m.index, e = s + m[0].length - 1; if (overlaps(s, e)) continue;
      const id = youTubeId(m[2]);
      cands.push({ s, e, block: id ? { type: 'video', videoId: id } : { type: 'image', url: m[2], alt: m[1] } });
    }
    const prot = [];
    const MD_LINK = /\[([^\]\n]+)\]\(\s*([^)\s]+)\s*\)/g;
    while ((m = MD_LINK.exec(text))) {
      const s = m.index, e = s + m[0].length - 1; if (overlaps(s, e)) continue;
      const label = m[1], url = m[2]; const id = youTubeId(url);
      const block = id ? { type: 'video', videoId: id } : looksLikeImage(url) ? { type: 'image', url, alt: label }
        : (label.trim().replace(/\/+$/, '') === url.trim().replace(/\/+$/, '') && aloneOnLine(text, s, e)) ? { type: 'link', url } : null;
      if (block) cands.push({ s, e, block }); else prot.push([s, e]);
    }
    const BARE = /https?:\/\/[^\s<>"'()]+/g;
    while ((m = BARE.exec(text))) {
      let url = m[0].replace(/[.,;!?。，、）】]+$/, '');
      const s = m.index, e = s + url.length - 1;
      if (overlaps(s, e) || prot.some(([ps, pe]) => ps <= e && s <= pe)) continue;
      const id = youTubeId(url);
      const block = id ? { type: 'video', videoId: id } : looksLikeImage(url) ? { type: 'image', url, alt: '' } : aloneOnLine(text, s, e) ? { type: 'link', url } : null;
      if (block) cands.push({ s, e, block });
    }
    const resolved = cands.filter((c) => !(streaming && c.e >= text.length - 1)).sort((a, b) => a.s - b.s);
    if (!resolved.length) return [{ type: 'text', text }];
    const out = []; let cur = 0;
    resolved.forEach((c) => {
      if (c.s > cur) { const seg = text.slice(cur, c.s).trim(); if (seg) out.push({ type: 'text', text: seg }); }
      if (c.block) out.push(c.block);
      cur = c.e + 1;
    });
    if (cur < text.length) { const tail = text.slice(cur).trim(); if (tail) out.push({ type: 'text', text: tail }); }
    return out;
  }

  /** 夠用的 markdown：**粗體**、- / * 清單、# 標題整行粗、[文字](網址) 與裸網址變連結（都在內嵌瀏覽器開）；串流中尾端加游標。 */
  function textEl(text, streaming, isError) {
    const el = h('div', 'as-text' + (isError ? ' error' : ''));
    const MD_LINK = /\[([^\]\n]+)\]\(\s*([^)\s]+)\s*\)/g, BARE = /https?:\/\/[^\s<>"'()]+/g;
    const bold = (s, heading) => s.split('**').map((seg, i) => (heading || i % 2 === 1 ? `<b>${esc(seg)}</b>` : esc(seg))).join('');
    const html = text.split('\n').map((raw) => {
      let line = raw; const trimmed = line.trimStart(); const heading = trimmed.startsWith('#');
      if (heading) line = trimmed.replace(/^#+/, '').trim();
      else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) line = line.slice(0, line.length - trimmed.length) + '• ' + trimmed.slice(2);
      const links = []; let m;
      while ((m = MD_LINK.exec(line))) links.push([m.index, m.index + m[0].length - 1, m[1], m[2]]);
      while ((m = BARE.exec(line))) { const s = m.index, e = s + m[0].length - 1; if (!links.some((l) => l[0] <= e && s <= l[1])) links.push([s, e, m[0], m[0]]); }
      links.sort((a, b) => a[0] - b[0]);
      let out = '', cur = 0;
      links.forEach(([s, e, label, url]) => { if (s > cur) out += bold(line.slice(cur, s), heading); out += `<a data-url="${esc(url)}">${esc(label)}</a>`; cur = e + 1; });
      if (cur < line.length) out += bold(line.slice(cur), heading);
      return out;
    }).join('\n');
    el.innerHTML = html + (streaming ? '<span class="as-cursor"></span>' : '');
    return el;
  }
  function imageEl(b) {
    const img = new Image(); img.className = 'as-img'; img.src = b.url; img.alt = b.alt || '圖片'; img.loading = 'lazy';
    img.addEventListener('click', () => openLayer(`<img class="full" src="${esc(b.url)}" alt="${esc(b.alt || '')}">`));
    img.addEventListener('error', () => { img.replaceWith(h('div', 'as-video dead', '圖片載入失敗')); });
    return img;
  }
  function videoEl(id) {
    const v = h('div', 'as-video', `<img src="https://img.youtube.com/vi/${esc(id)}/hqdefault.jpg" alt="影片縮圖"><span class="as-play"><span class="material-icons">play_arrow</span></span>`);
    v.querySelector('img').addEventListener('error', () => { v.className = 'as-video dead'; v.textContent = '找不到這部影片，可能已被移除'; });
    v.addEventListener('click', () => { if (!v.classList.contains('dead')) openLayer(`<iframe src="https://www.youtube.com/embed/${esc(id)}?autoplay=1&playsinline=1&rel=0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`); });
    return v;
  }
  function linkEl(url) {
    let host = ''; try { host = new URL(url).host; } catch { host = url; }
    const card = h('a', 'as-link', `<div class="as-link-row"><img class="fav" src="https://www.google.com/s2/favicons?domain=${esc(host)}&sz=64" alt=""><div style="min-width:0"><div class="host">${esc(host)}</div><div class="title">${esc(url)}</div></div></div>`);
    card.addEventListener('click', (e) => { e.preventDefault(); openBrowser(url); });
    api('GET', `/api/assist/preview?url=${encodeURIComponent(url)}`).then((r) => r.json()).then((p) => {
      if (p.title) card.querySelector('.title').textContent = p.title;
      if (p.imageUrl) { const og = new Image(); og.className = 'og'; og.src = p.imageUrl; og.alt = ''; og.onerror = () => og.remove(); card.prepend(og); }
    }).catch(() => {});
    return card;
  }
  function openLayer(inner) {
    closeLayer();
    const l = h('div', 'as-layer', inner + '<button type="button" class="as-close" aria-label="關閉"><span class="material-icons">close</span></button>');
    l.querySelector('.as-close').addEventListener('click', closeLayer);
    l.addEventListener('click', (e) => { if (e.target === l || e.target.classList.contains('full')) closeLayer(); });
    root.appendChild(l); S.layer = l;
  }
  function openBrowser(url) {
    closeLayer();
    const b = h('div', 'as-browser', `<div class="bar"><button type="button" class="as-icon-btn" data-act="layer-close" aria-label="關閉"><span class="material-icons">arrow_back</span></button><span class="url">${esc(url)}</span><button type="button" class="as-icon-btn" data-act="layer-close" aria-label="關閉網頁"><span class="material-icons">close</span></button></div><iframe src="${esc(url)}" allow="autoplay; fullscreen; geolocation" referrerpolicy="no-referrer-when-downgrade"></iframe>`);
    b.querySelectorAll('[data-act="layer-close"]').forEach((x) => x.addEventListener('click', closeLayer));
    root.appendChild(b); S.layer = b;
  }
  function closeLayer() { if (S?.layer) { S.layer.remove(); S.layer = null; } }

  // ---------- 輸入區 ----------
  function renderInput() {
    const f = root.querySelector('.as-input');
    const ok = S.configured && !S.agentError;
    f.hidden = !ok;
    if (!ok) return;
    const canAttach = !!(S.agent?.enableImageUpload || S.agent?.enableFileUpload);
    const voiceOk = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const listening = !!S.voice?.listening;
    const pendingHtml = S.pending.length ? `<div class="as-pending">${S.pending.map((p) => `<div class="as-pchip" data-pid="${p.localId}">${p.isImage ? `<img src="${esc(p.previewUrl)}" alt="">` : '<span class="material-icons">insert_drive_file</span>'}${p.uploading ? '<div class="busy"><i></i></div>' : ''}${p.failed ? '<div class="failed">失敗</div>' : ''}<button type="button" class="rm" data-act="rm" aria-label="移除"><span class="material-icons">close</span></button></div>`).join('')}</div>` : '';
    const uploading = S.pending.some((p) => p.uploading);
    const ready = S.pending.filter((p) => p.uploaded).length;
    const value = S.draft || '';
    const canSend = (value.trim() || ready) && !uploading;
    f.innerHTML = `${pendingHtml}${S.inputError ? `<div class="as-err">${esc(S.inputError)}</div>` : ''}
      <div class="as-pill">
        ${voiceOk ? `<div class="as-mic-row"><button type="button" class="as-circle mic${listening ? ' listening' : ''}" data-act="mic" aria-label="${listening ? '停止聆聽' : '開始說話'}"><span class="material-icons">mic</span></button></div>` : ''}
        <div class="as-text-row">
          ${canAttach ? `<button type="button" class="as-attach" data-act="attach" aria-label="附加檔案"><span class="material-icons">${S.agent.enableImageUpload ? 'add_photo_alternate' : 'insert_drive_file'}</span></button>` : ''}
          ${listening ? `<div class="as-transcript">${esc([value, S.voice.partial].filter(Boolean).join(' ')) || '聆聽中，請說話…'}</div>`
            : `<textarea class="as-field" rows="1" placeholder="${voiceOk ? '說點什麼，或直接打字…' : '輸入訊息…'}">${esc(value)}</textarea>`}
          ${S.streaming ? `<button type="button" class="as-circle send" data-act="stop" aria-label="停止回覆">停止</button>`
            : `<button type="button" class="as-circle send" data-act="send" aria-label="送出" ${canSend ? '' : 'disabled'}>送出</button>`}
        </div>
      </div>
      <input type="file" class="as-file" hidden accept="${[S.agent?.enableImageUpload ? 'image/jpeg,image/png,image/webp,image/gif' : '', S.agent?.enableFileUpload ? '.pdf,.docx,.txt,.md,.csv' : ''].filter(Boolean).join(',')}">`;
    const ta = f.querySelector('.as-field');
    if (ta) {
      const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
      grow();
      ta.addEventListener('input', () => { S.draft = ta.value; grow(); const b = f.querySelector('[data-act="send"]'); if (b) b.disabled = !((ta.value.trim() || ready) && !uploading); });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(ta.value); } });
      if (S.focusField) { ta.focus(); S.focusField = false; }
    }
    const file = f.querySelector('.as-file');
    if (file) file.addEventListener('change', () => { for (const fl of file.files) addAttachment(fl); file.value = ''; });
  }

  function onRootClick(e) {
    const a = e.target.closest('a[data-url]');
    if (a) { e.preventDefault(); openBrowser(a.dataset.url); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'back') close();
    else if (act === 'new') reset();
    else if (act === 'jump') scrollToBottom(true);
    else if (act === 'font') toggleFontMenu(btn);
    else if (act === 'mic') toggleVoice();
    else if (act === 'attach') root.querySelector('.as-file')?.click();
    else if (act === 'send') send(root.querySelector('.as-field')?.value || '');
    else if (act === 'stop') stopStream(false);
    else if (act === 'rm') { const id = Number(btn.closest('.as-pchip').dataset.pid); S.pending = S.pending.filter((p) => p.localId !== id); renderInput(); }
    else if (act === 'font-pick') { S.fontScale = Number(btn.dataset.v); root.style.setProperty('--as-fs', String((S.layout === 'Kiosk' ? 1.45 : 1) * S.fontScale)); root.querySelector('.as-menu')?.remove(); }
  }
  function toggleFontMenu(btn) {
    const old = root.querySelector('.as-menu');
    if (old) { old.remove(); return; }
    const m = h('div', 'as-menu', FONT_OPTIONS.map(([v, label]) => `<button type="button" data-act="font-pick" data-v="${v}">${label}${S.fontScale === v ? '<span class="material-icons">check</span>' : ''}</button>`).join(''));
    btn.appendChild(m);
    setTimeout(() => document.addEventListener('click', function off(ev) { if (!ev.target.closest('.as-menu')) { m.remove(); document.removeEventListener('click', off); } }), 0);
  }

  // ---------- 對話 ----------
  function reset() {
    stopStream(true);
    S.threadId = null; S.messages = []; S.pending = []; S.streaming = false; S.draft = '';
    renderTop(); renderBody(); renderInput();
  }
  async function send(text) {
    const trimmed = String(text || '').trim();
    if (S.streaming || !S.configured || S.agentError) return;
    const ready = S.pending.filter((p) => p.uploaded);
    if (!trimmed && !ready.length) return;
    if (S.pending.some((p) => p.uploading)) return;
    const attachments = ready.map((p) => ({ name: p.name, previewUrl: p.uploaded.fileUrl || p.previewUrl, isImage: p.isImage }));
    const attachmentIds = ready.map((p) => p.uploaded.attachmentId);
    S.pending = []; S.draft = ''; S.inputError = '';
    const first = !S.messages.length;
    S.messages.push({ id: S.nextId++, text: trimmed, fromUser: true, streaming: false, isError: false, attachments });
    const reply = { id: S.nextId++, text: '', fromUser: false, streaming: true, isError: false, attachments: [] };
    S.messages.push(reply);
    S.streaming = true;
    if (first) renderBody(); else { const list = root.querySelector('.as-list'); list.appendChild(messageEl(S.messages[S.messages.length - 2])); list.appendChild(messageEl(reply)); }
    S.atBottom = true; scrollToBottom(true);
    renderTop(); renderInput();

    // 打字機：SSE 增量進 target，每 26ms 揭露 1～4 字（積壓越多越快）
    let target = '', revealed = 0;
    S.target = () => target;
    S.reveal = setInterval(() => {
      if (revealed < target.length) {
        const step = Math.min(4, Math.max(1, Math.floor((target.length - revealed) / 16)));
        revealed = Math.min(target.length, revealed + step);
        reply.text = target.slice(0, revealed);
        updateMessage(reply);
      }
    }, REVEAL_MS);
    const ctrl = new AbortController(); S.abort = ctrl;
    try {
      if (!S.threadId) {
        const r = await api('POST', `/api/assist/${dev()}/threads?agentId=${ag()}`, {}, { signal: ctrl.signal });
        S.threadId = (await r.json()).id;
      }
      // 輪詢版（2026-09-10）：後台先收 JustAI 的串流，這裡每 0.3 秒取一次累積文字（正式站的 IIS 會把 SSE 整段緩衝）
      const r = await api('POST', `/api/assist/${dev()}/threads/${encodeURIComponent(S.threadId)}/jobs?agentId=${ag()}`,
        { content: trimmed, attachments: attachmentIds.map((id) => ({ attachmentId: id })) }, { signal: ctrl.signal });
      const { jobId } = await r.json();
      S.jobId = jobId;
      for (;;) {
        await new Promise((r2) => setTimeout(r2, 300));
        if (S.abort !== ctrl) return;
        const j = await (await api('GET', `/api/assist/${dev()}/jobs/${jobId}`, undefined, { signal: ctrl.signal })).json();
        if (j.text.length > target.length) target = j.text;
        if (j.error && !target) throw Object.assign(new Error(j.error), { status: 502 });
        if (j.done) break;
      }
      S.jobId = null;
      // 讓打字機把剩下的字揭露完
      while (revealed < target.length && S.abort === ctrl) await new Promise((r2) => setTimeout(r2, REVEAL_MS));
      if (S.abort !== ctrl) return;
      clearInterval(S.reveal); S.reveal = 0;
      reply.text = target; reply.streaming = false;
      if (!reply.text) { S.messages = S.messages.filter((m) => m !== reply); renderBody(); } else updateMessage(reply);
    } catch (e) {
      if (S.abort !== ctrl) return; // 被停止或關閉
      clearInterval(S.reveal); S.reveal = 0;
      reply.streaming = false;
      if (!target) { reply.text = e.notConfigured ? '這台機器還沒有設定智能客服帳號。' : '抱歉，目前無法連線，請稍後再試。'; reply.isError = true; }
      else reply.text = target;
      updateMessage(reply);
    } finally {
      if (S && S.abort === ctrl) { S.abort = null; S.streaming = false; renderTop(); renderInput(); }
    }
  }
  /** 停止：中斷串流，但已收到的字全部顯示。 */
  function stopStream(silent) {
    if (!S) return;
    const ctrl = S.abort; S.abort = null;
    if (S.reveal) { clearInterval(S.reveal); S.reveal = 0; }
    if (ctrl) ctrl.abort();
    if (S.jobId) { const id = S.jobId; S.jobId = null; fetch(`${S.base}/api/assist/${dev()}/jobs/${id}`, { method: 'DELETE', headers: { 'X-Device-Key': S.deviceKey } }).catch(() => {}); } // 叫後台把 JustAI 那邊也停掉
    const full = S.target ? S.target() : ''; S.target = null;
    S.messages = S.messages.map((m) => (m.streaming ? { ...m, streaming: false, text: m.fromUser ? m.text : (full || m.text) } : m)).filter((m) => m.fromUser || m.text);
    S.streaming = false;
    if (!silent) { renderBody(); renderTop(); renderInput(); }
  }

  // ---------- 附件 ----------
  async function addAttachment(file) {
    if (!S.configured) return;
    if (file.size > 20 * 1024 * 1024) { S.inputError = '檔案超過 20MB。'; renderInput(); return; }
    const isImage = file.type.startsWith('image/');
    const p = { localId: S.nextId++, previewUrl: isImage ? URL.createObjectURL(file) : '', name: file.name, isImage, uploading: true, failed: false, uploaded: null };
    S.pending.push(p); S.inputError = ''; renderInput();
    try {
      const form = new FormData(); form.append('file', file, file.name);
      const r = await api('POST', `/api/assist/${dev()}/attachments?agentId=${ag()}`, form);
      p.uploaded = await r.json();
    } catch (e) { p.failed = true; S.inputError = e.message || '附件上傳失敗。'; }
    p.uploading = false;
    if (S && S.pending.includes(p)) renderInput();
  }

  // ---------- 語音（Web Speech API，zh-TW；連續聆聽、5 秒沒聲音自動停）----------
  function toggleVoice() { if (S.voice?.listening) stopVoice(); else startVoice(); }
  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR(); rec.lang = 'zh-TW'; rec.continuous = true; rec.interimResults = true;
    const v = { rec, listening: true, partial: '', want: true, lastSpeech: Date.now(), timer: 0 };
    S.voice = v;
    const armSilence = () => { clearTimeout(v.timer); v.timer = setTimeout(() => { if (Date.now() - v.lastSpeech >= SILENCE_MS) stopVoice(); else armSilence(); }, SILENCE_MS); };
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) { S.draft = [S.draft || '', t.trim()].filter(Boolean).join(' '); }
        else interim += t;
      }
      v.partial = interim.trim();
      if (v.partial || ev.results[ev.results.length - 1]?.isFinal) v.lastSpeech = Date.now();
      renderInput();
    };
    rec.onend = () => { if (S?.voice === v && v.want && Date.now() - v.lastSpeech < SILENCE_MS) { try { rec.start(); } catch { stopVoice(); } } else if (S?.voice === v) stopVoice(); };
    rec.onerror = (ev) => { if (ev.error === 'no-speech' || ev.error === 'aborted') return; stopVoice(); if (ev.error === 'not-allowed') { S.inputError = '沒有麥克風權限，改用打字吧。'; renderInput(); } };
    try { rec.start(); } catch { S.voice = null; return; }
    armSilence();
    renderInput();
  }
  function stopVoice() {
    const v = S?.voice; if (!v) return;
    v.want = false; v.listening = false; clearTimeout(v.timer);
    try { v.rec.onend = null; v.rec.stop(); } catch { /* ignore */ }
    S.voice = null; S.focusField = true;
    if (root) renderInput();
  }

  return { open, close: () => close(false), isOpen: () => !!root };
})();
