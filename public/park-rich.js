/* 園區測站介紹的「簡易格式」（2026-10-21 user 選：不要完整 HTML，只給粗體、小標題、條列、連結）。
 * 後台編輯器、後台資訊卡預覽、網頁播放頁共用這一份；App（ParkInfoScreen）照同一套規則自己畫。
 * 存的是極小的 Markdown 子集（parkInfo.stations[id].descRich），一行一個區塊：
 *   「### 文字」＝小標題；「- 文字」＝條列（連續幾行＝同一串）；空行＝段落間隔；其他＝內文（相鄰幾行同一段、換行保留）
 *   行內：**粗體**、[文字](https://網址)（只收 http／https）
 * 一律先跳脫 HTML 再套格式，所以不會有人塞進 <script> 之類的東西。desc 另存純文字版（舊版 App、字數計算用）。 */
(function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const BOLD = /\*\*([^*\n]+)\*\*/g;
  /** 行內格式 → HTML（先跳脫）；editor＝給編輯器用（連結不另開分頁） */
  function inline(text, editor) {
    return esc(text)
      .replace(LINK, (_, label, url) => `<a href="${url}"${editor ? '' : ' data-rich-link'}>${label}</a>`)
      .replace(BOLD, (_, t) => `<b>${t}</b>`);
  }
  /** 拆成區塊：[{ t: 'h'|'li'|'p'|'gap', text }] */
  function blocks(md) {
    const out = [];
    for (const raw of String(md || '').replace(/\r/g, '').split('\n')) {
      const line = raw.replace(/\s+$/, '');
      if (/^###\s+/.test(line)) out.push({ t: 'h', text: line.replace(/^###\s+/, '') });
      else if (/^-\s+/.test(line)) out.push({ t: 'li', text: line.replace(/^-\s+/, '') });
      else if (!line.trim()) out.push({ t: 'gap' });
      else out.push({ t: 'p', text: line });
    }
    return out;
  }
  /** 展示用 HTML（播放頁、後台預覽）：小標題 <h4>、條列 <ul>、內文 <p>（相鄰行用 <br> 接） */
  function toHtml(md) {
    const bs = blocks(md);
    let html = '', i = 0;
    while (i < bs.length) {
      const b = bs[i];
      if (b.t === 'h') { html += `<h4>${inline(b.text)}</h4>`; i++; }
      else if (b.t === 'li') {
        html += '<ul>';
        while (i < bs.length && bs[i].t === 'li') html += `<li>${inline(bs[i++].text)}</li>`;
        html += '</ul>';
      } else if (b.t === 'p') {
        const lines = [];
        while (i < bs.length && bs[i].t === 'p') lines.push(inline(bs[i++].text));
        html += `<p>${lines.join('<br>')}</p>`;
      } else i++;
    }
    return html;
  }
  /** 純文字版（desc 欄位、字數）：拿掉格式記號，條列前面加「・」 */
  function toPlain(md) {
    return blocks(md).map((b) => {
      if (b.t === 'gap') return '';
      const t = b.text.replace(LINK, '$1').replace(BOLD, '$1');
      return b.t === 'li' ? `・${t}` : t;
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  /** 編輯器用 HTML：一行一個 <div>，小標題 <h3>，條列 <ul><li>，空行 <div><br></div> */
  function toEditorHtml(md) {
    const bs = blocks(md);
    let html = '', i = 0;
    while (i < bs.length) {
      const b = bs[i];
      if (b.t === 'li') {
        html += '<ul>';
        while (i < bs.length && bs[i].t === 'li') html += `<li>${inline(bs[i++].text, true) || '<br>'}</li>`;
        html += '</ul>';
        continue;
      }
      html += b.t === 'h' ? `<h3>${inline(b.text, true)}</h3>` : b.t === 'gap' ? '<div><br></div>' : `<div>${inline(b.text, true)}</div>`;
      i++;
    }
    return html;
  }
  /** 編輯器 DOM → Markdown 子集（瀏覽器 contenteditable 產生的 <div>、<br>、<b>/<strong>、<h3>、<ul><li>、<a> 都認得，其他標籤只取文字） */
  function fromEditor(root) {
    const lines = [];
    let cur = '';
    const flush = (prefix) => { lines.push((prefix || '') + cur.replace(/ /g, ' ').replace(/[ \t]+$/, '')); cur = ''; };
    const inlineOf = (node) => {
      let s = '';
      for (const n of node.childNodes) {
        if (n.nodeType === 3) s += n.nodeValue.replace(/\n/g, ' ');
        else if (n.nodeType !== 1) continue;
        else if (n.tagName === 'BR') s += '\n';
        else if (n.tagName === 'B' || n.tagName === 'STRONG' || (n.style && /^(bold|[6-9]00)$/.test(n.style.fontWeight))) {
          const t = inlineOf(n);
          s += t.trim() ? `**${t}**` : t;
        } else if (n.tagName === 'A') {
          const href = n.getAttribute('href') || '', t = inlineOf(n).replace(/[[\]\n]/g, '');
          s += /^https?:\/\/\S+$/.test(href) && t.trim() ? `[${t}](${href})` : t;
        } else s += inlineOf(n);
      }
      return s;
    };
    const BLOCK = /^(DIV|P|H1|H2|H3|H4|H5|H6|UL|OL|LI|BLOCKQUOTE|PRE)$/;
    const walk = (node, prefix) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 1 && BLOCK.test(n.tagName)) {
          if (cur) flush(prefix);
          if (n.tagName === 'UL' || n.tagName === 'OL') { for (const li of n.children) { cur = inlineOf(li).replace(/\n+$/, '').replace(/\n/g, ' '); flush('- '); } continue; }
          if (/^H[1-6]$/.test(n.tagName)) { cur = inlineOf(n).replace(/\n/g, ' '); flush('### '); continue; }
          if ([...n.childNodes].some((c) => c.nodeType === 1 && BLOCK.test(c.tagName))) { walk(n, prefix); continue; }
          const t = inlineOf(n).replace(/\n$/, '');
          for (const part of t.split('\n')) { cur = part; flush(prefix); }
        } else if (n.nodeType === 1 && n.tagName === 'BR') flush(prefix);
        else cur += n.nodeType === 3 ? n.nodeValue.replace(/\n/g, ' ') : n.nodeType === 1 ? inlineOf(n) : '';
      }
      if (cur) flush(prefix);
    };
    walk(root, '');
    return lines.join('\n').replace(/\*\*\*\*/g, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  }
  window.ParkRich = { toHtml, toPlain, toEditorHtml, fromEditor };
})();
