/**
 * AI 智能客服（JustAI）代理，給網頁播放器用（2026-09-10）。
 * App 端是機器直接打 JustAI（data/chat/JustAiService.kt）；瀏覽器被 CORS 擋、也不該把客服帳密留在網頁裡，
 * 所以由後台代打：機器帶 X-Device-Key 來，伺服器用「這台機器 config 裡的 chatApi 帳號」登入 JustAI，
 * 再把客服資料／對話串／訊息（SSE 原樣轉送）／附件上傳轉過去。與 App 相同：所有 thread／message 請求都帶 agent_id。
 *
 * 掛載：server.js 裡 require('./assist')(app, { db, log, isDevice })，路由都在 /api/assist/…，只收機器金鑰。
 */
const multer = require('multer');

const DEFAULT_BASE_URL = 'https://chat-api.justhings.ai';
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // JustAI token 快取；401 會自動重登

module.exports = function mountAssist(app, { db, log, isDevice }) {
  const tokens = new Map(); // `${root}|${email}` -> { token, at }
  const previews = new Map(); // url -> { at, data }

  const requireDevice = (req, res, next) => (isDevice(req) ? next() : res.status(401).json({ error: '連線金鑰不正確。' }));

  /** 這台機器 config 裡的客服帳號（後台「機器設定 › 智能客服」或共用設定套用進去的）。 */
  async function chatApiOf(deviceId) {
    const r = await db.getPool().request().input('id', db.sql.NVarChar(64), deviceId)
      .query('SELECT ConfigJson FROM dbo.KioskConfig WHERE DeviceId = @id');
    const row = r.recordset[0];
    if (!row) return null;
    let cfg; try { cfg = JSON.parse(row.ConfigJson); } catch { return null; }
    const c = cfg.chatApi || {};
    const root = String(c.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
    const email = String(c.email || '').trim(), password = String(c.password || '');
    if (!email || !password) return null;
    return { root, email, password };
  }

  async function login(api) {
    const key = `${api.root}|${api.email}`;
    const hit = tokens.get(key);
    if (hit && hit.password === api.password && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token;
    const r = await fetch(api.root + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: api.email, password: api.password }), signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw Object.assign(new Error('無法登入智能客服平台。請檢查客服帳號和密碼。'), { status: 502 });
    const token = (await r.json()).token;
    tokens.set(key, { token, at: Date.now(), password: api.password });
    return token;
  }
  function forget(api) { tokens.delete(`${api.root}|${api.email}`); }

  /** 帶 token 打 JustAI；401 重登一次。回 Response（呼叫端自己讀 json 或串流）。 */
  async function upstream(api, method, path, { body, headers = {}, timeoutMs = 30_000, raw } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await login(api);
      const init = { method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...headers }, signal: raw?.signal || AbortSignal.timeout(timeoutMs) };
      if (body !== undefined) {
        if (body instanceof FormData) init.body = body;
        else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
      }
      const r = await fetch(api.root + path, init);
      if (r.status === 401 && attempt === 0) { forget(api); continue; }
      return r;
    }
    throw Object.assign(new Error('智能客服平台登入已失效。'), { status: 502 });
  }
  async function errorText(r) {
    const t = await r.text().catch(() => '');
    try { const j = JSON.parse(t); if (j.detail) return typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail); } catch { /* not json */ }
    return t.slice(0, 200) || `HTTP ${r.status}`;
  }
  const absolutize = (root, p) => (!p ? null : /^https?:\/\//i.test(p) ? p : root + (p.startsWith('/') ? p : '/' + p));

  async function withApi(req, res, fn) {
    try {
      const api = await chatApiOf(req.params.deviceId);
      if (!api) return res.status(409).json({ error: '這台機器還沒有設定智能客服帳號。', notConfigured: true });
      await fn(api);
    } catch (e) {
      const status = e.status || (e.name === 'TimeoutError' ? 504 : 502);
      log.warn('assist', `客服代理失敗：${e.message}`, { device: req.params.deviceId, rid: req.id });
      if (!res.headersSent) res.status(status).json({ error: e.status ? e.message : '無法連接智能客服平台。請稍後再試一次。' });
      else res.end();
    }
  }

  // ---- 客服資料（名稱、頭像、問候語、建議問題、主題色、附件旗標）----
  app.get('/api/assist/:deviceId/agent', requireDevice, (req, res) => withApi(req, res, async (api) => {
    const agentId = String(req.query.agentId || '').trim();
    if (!agentId) return res.status(400).json({ error: '沒有指定客服。' });
    const r = await upstream(api, 'GET', `/api/agents/${encodeURIComponent(agentId)}`);
    if (!r.ok) return res.status(502).json({ error: `無法取得客服資料：${await errorText(r)}` });
    const o = await r.json();
    res.json({
      id: o.id, name: o.name || '', description: o.description || '', greeting: o.greeting || '',
      suggestQuestions: (Array.isArray(o.suggestQuestions) ? o.suggestQuestions : []).map((q) => String(q || '').trim()).filter(Boolean),
      avatarUrl: absolutize(api.root, o.avatarUrl || ''), color: o.color || '#6366F1',
      enableImageUpload: !!o.enableImageUpload, enableFileUpload: !!o.enableFileUpload,
    });
  }));

  // ---- 開對話串 ----
  app.post('/api/assist/:deviceId/threads', requireDevice, (req, res) => withApi(req, res, async (api) => {
    const agentId = String(req.query.agentId || '').trim();
    if (!agentId) return res.status(400).json({ error: '沒有指定客服。' });
    const r = await upstream(api, 'POST', `/api/threads?agent_id=${encodeURIComponent(agentId)}`, { body: {} });
    if (!r.ok) return res.status(502).json({ error: `無法建立對話：${await errorText(r)}` });
    const o = await r.json();
    res.json({ id: o.id });
  }));

  // ---- 送訊息：JustAI 的 SSE 原樣轉給瀏覽器（data: {"content":"…","done":false}）----
  app.post('/api/assist/:deviceId/threads/:threadId/messages', requireDevice, (req, res) => withApi(req, res, async (api) => {
    const agentId = String(req.query.agentId || '').trim();
    if (!agentId) return res.status(400).json({ error: '沒有指定客服。' });
    const content = String(req.body?.content || '');
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments.slice(0, 10).map((a) => ({ attachmentId: String(a.attachmentId || a) })) : [];
    if (!content.trim() && !attachments.length) return res.status(400).json({ error: '訊息是空的。' });
    const payload = {};
    if (content.trim()) payload.content = content;
    if (attachments.length) payload.attachments = attachments;
    const ctrl = new AbortController();
    req.on('close', () => ctrl.abort()); // 訪客按停止／關閉：把上游也斷掉
    const r = await upstream(api, 'POST', `/api/threads/${encodeURIComponent(req.params.threadId)}/messages?agent_id=${encodeURIComponent(agentId)}`, {
      body: payload, headers: { Accept: 'text/event-stream' }, raw: { signal: ctrl.signal },
    });
    if (!r.ok) return res.status(502).json({ error: `客服沒有回應：${await errorText(r)}` });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // 反向代理（IIS ARR／nginx）別緩衝，逐字才會即時
    });
    res.flushHeaders?.();
    try {
      for await (const chunk of r.body) { res.write(chunk); }
    } catch (e) {
      if (!ctrl.signal.aborted) log.warn('assist', `串流中斷：${e.message}`, { device: req.params.deviceId, rid: req.id });
    }
    res.end();
  }));

  // ---- 附件上傳（圖片／文件，依客服旗標；≤20MB）----
  const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  app.post('/api/assist/:deviceId/attachments', requireDevice, memUpload.single('file'), (req, res) => withApi(req, res, async (api) => {
    const agentId = String(req.query.agentId || '').trim();
    if (!req.file) return res.status(400).json({ error: '沒有收到檔案。' });
    const form = new FormData();
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'application/octet-stream' }), req.file.originalname || 'file');
    const r = await upstream(api, 'POST', `/api/attachments/upload${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ''}`, { body: form, timeoutMs: 60_000 });
    if (!r.ok) return res.status(502).json({ error: `附件上傳失敗：${await errorText(r)}` });
    const o = await r.json();
    res.json({
      attachmentId: o.attachmentId, type: o.attachmentType || 'document', name: o.originalName || req.file.originalname,
      fileUrl: absolutize(api.root, o.fileUrl || ''), mimeType: o.mimeType || null,
    });
  }));

  // ---- 連結預覽（og:title／og:image），AI 回覆裡的獨立網址畫成卡片；同 App LinkPreviewService ----
  app.get('/api/assist/preview', requireDevice, async (req, res) => {
    const url = String(req.query.url || '').trim();
    if (!/^https?:\/\/\S+$/.test(url)) return res.status(400).json({ error: '網址格式不正確。' });
    const hit = previews.get(url);
    if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return res.json(hit.data);
    let host = ''; try { host = new URL(url).host; } catch { /* ignore */ }
    const data = { url, host, title: null, imageUrl: null };
    try {
      const r = await fetch(url, {
        redirect: 'follow', signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml' },
      });
      if (r.ok && /text\/html/i.test(r.headers.get('content-type') || '')) {
        const reader = r.body.getReader(); const dec = new TextDecoder(); let html = '';
        while (html.length < 160_000) { const { value, done } = await reader.read(); if (done) break; html += dec.decode(value, { stream: true }); if (/<\/head>/i.test(html)) break; }
        reader.cancel().catch(() => {});
        const meta = (k) => { const tag = html.match(new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i')); return tag ? (tag[0].match(/content\s*=\s*["']([^"']+)["']/i) || [])[1] || null : null; };
        const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
        data.title = decode(meta('og:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]) || null;
        const img = meta('og:image') || meta('twitter:image');
        data.imageUrl = !img ? null : /^https?:\/\//i.test(img) ? img : img.startsWith('//') ? 'https:' + img : img.startsWith('/') && host ? `https://${host}${img}` : img;
      }
    } catch { /* 拿不到就只有 host＋網址的卡片 */ }
    previews.set(url, { at: Date.now(), data });
    res.json(data);
  });

  log.info('assist', '智能客服代理已掛載（/api/assist/…）');
};
