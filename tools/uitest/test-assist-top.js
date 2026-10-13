/* 智能客服「輸入區位置＝上方」（2026-10-12，設計 D 延伸頂欄）：頂欄＋輸入框合成一塊頂區；對話照一般順序（舊的在上）。
   捲動跟下方一樣「貼底跟著長」（S.follow／onScroll／ResizeObserver），加上 CSS 讓最後一組至少一個畫面高：
   - 回答短：送出後滑到底＝新問題停在頂區正下方（清單上內距）；
   - 回答長過畫面、或圖片晚到：一直跟著往下（問題捲到頂區後面），而且是 rAF 一格一格滑過去（chase），不是一下跳到底；
   - 訪客往上拉就放手、底部出現「回到最新」，點了滑回底部並接著跟；往下捲回離底 96px 內也會接回；
   - 按停止保留已收到的字、不重建；載入歷史直接在最底下。
   播放頁設定與 /api/assist/* 全部用 request interception 假造（不碰真的 JustAI、不碰 DB），圖片是假網址＋故意延遲回應。
   後半段登入後台（joyeadmin），確認格子檢查器有「輸入區位置」列（在「介面」下面），沒設定的格子顯示「上方」（預設），切換會改 cell.agentInputPos（不存檔）。
   用法：node test-assist-top.js            （BASE 預設 http://localhost:3177） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/+$/, '');
const OUT = path.join(__dirname, 'shots', 'assist-top');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let tag = '';
const check = (name, ok, extra) => { results.push({ name: `[${tag}] ${name}`, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${tag}] ${name}${extra ? '  -- ' + extra : ''}`); };

// ---------- 假圖片：純 node 產生的棋盤格 PNG ----------
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, [r, g, b]) {
  const row = w * 3 + 1, raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * row + 1 + x * 3, k = ((x >> 5) + (y >> 5)) & 1 ? 0.8 : 1;
    raw[o] = r * k; raw[o + 1] = g * k; raw[o + 2] = b * k;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const IMG = { // 檔名 → [寬, 高, 顏色, 延遲毫秒]
  'g1.png': [640, 480, [230, 120, 60], 700], 'g2.png': [640, 480, [60, 150, 230], 900], 'g3.png': [480, 640, [80, 180, 90], 1100],
  'q2single.png': [480, 720, [200, 80, 160], 1500],
  'q2g1.png': [640, 480, [240, 200, 60], 900], 'q2g2.png': [640, 480, [60, 200, 200], 1200], 'q2g3.png': [640, 480, [200, 60, 60], 1500],
  'q2late.png': [480, 720, [120, 90, 200], 2500], // Q2 最後面的大圖：回覆結束後才載入，用來看跟隨是不是「滑」下去
  'avatar.png': [128, 128, [99, 102, 241], 0],
};
const imgCache = new Map();
const imgBytes = (name) => { if (!imgCache.has(name)) { const [w, h, c] = IMG[name]; imgCache.set(name, png(w, h, c)); } return imgCache.get(name); };

// ---------- 假的 AI 回覆 ----------
const para = (label, n) => Array.from({ length: n }, (_, i) => `- ${label}第 ${i + 1} 點：這是測試用的說明文字，讓畫面可以往下捲動。`).join('\n');
const q1Text = (R) => { const u = (f) => `https://img.test/${R}/${f}`; return `Q1 的回答開頭。\n\n${para('介紹', 8)}\n\n![](${u('g1.png')})\n![](${u('g2.png')})\n![](${u('g3.png')})\n\n${para('介紹續', 4)}\n\nQ1 結束。`; };
function q2Parts(R) {
  const u = (f) => `https://img.test/${R}/${f}`;
  return [
    // 單張圖是 lazy 載入：放在第一行正下方，窄螢幕也在畫面內才會真的載入（晚到 1.5 秒、載入後變高）
    `Q2 第一行回答。\n\n![單張圖](${u('q2single.png')})\n\n單張圖下面的字。\n\n${para('補充', 4)}\n`,
    `\n${para('第二段', 5)}\n\n![](${u('q2g1.png')})\n![](${u('q2g2.png')})\n![](${u('q2g3.png')})\n\n相簿下面的字。\n`,
    `\n${para('第三段', 3)}\n\n![最後的大圖](${u('q2late.png')})\n\nQ2 結束。`,
  ];
}
const Q3_TEXT = 'Q3 簡短的回答。'; // 短回答（一行）：最後一組至少一個畫面高，捲到底＝問題停在頂區正下方
const q4Text = (polls) => `Q4 的回答開頭。\n\n${para('Q4', Math.min(90, polls))}`; // 每次輪詢多一點，一直長到按停止
const pad = (n) => String(n).padStart(2, '0');
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000000`;
const HISTORY_ROWS = [ // 第一則是 AI（訪客問之前）＝自己一組，排在最上面
  { content: '歡迎光臨（訪客提問前的 AI 訊息）', fromUser: false, isGreeting: false, attachments: [] },
  { content: 'HA 舊問題', fromUser: true, isGreeting: false, attachments: [] },
  { content: `HA 的回答。\n${para('HA', 8)}`, fromUser: false, isGreeting: false, attachments: [] },
  { content: 'HB 新問題', fromUser: true, isGreeting: false, attachments: [] },
  { content: 'HB 的回答：很短。\n第二行。', fromUser: false, isGreeting: false, attachments: [] }, // 最後一組回答短：載入後在最底下＝HB 問題在頂區正下方
];

// ---------- 分析每一格的捲動紀錄（__recStart／__recStop） ----------
/** 跟隨有沒有掉隊：離底超過 lag×比例 的狀態最長連續多久（串流中字一直長，chase 會落後一兩行，但不能一直被丟在後面）。 */
function followStats(sm, lag = 120) {
  let longest = 0, start = null;
  for (const x of sm) { if (x.dist > lag * x.k) { if (start == null) start = x.t; longest = Math.max(longest, x.t - start); } else start = null; }
  return { n: sm.length, maxDist: Math.round(Math.max(...sm.map((x) => x.dist))), longestBehindMs: Math.round(longest), jumpSeen: sm.some((x) => x.jump), endDist: sm[sm.length - 1].dist, grew: sm[sm.length - 1].h - sm[0].h };
}
/** 晚到的大圖載好那一格（內容一下變高 dh）之後，捲動是「滑」過去的：要好幾格才把落差收到 10% 以內，scrollTop 一路只往下、經過好幾個中間值。 */
function glideStats(sm) {
  const i0 = sm.findIndex((x) => x.late);
  if (i0 < 1) return { found: false };
  let F = i0, dh = 0;
  for (let i = i0; i < Math.min(sm.length, i0 + 4); i++) { const d = sm[i].h - sm[i - 1].h; if (d > dh) { dh = d; F = i; } }
  const gap = sm[F].dist;
  let j = F; while (j < sm.length && sm[j].dist > Math.max(2, gap * 0.1)) j++;
  const sts = sm.slice(F, Math.min(j + 1, sm.length)).map((x) => x.st);
  return {
    found: true, dh: Math.round(dh), gap: Math.round(gap), frames: j - F, ms: j < sm.length ? Math.round(sm[j].t - sm[F].t) : null, closed: j < sm.length,
    mono: sts.every((v, i) => i === 0 || v >= sts[i - 1] - 0.5), distinct: new Set(sts.map((v) => Math.round(v))).size,
    path: sts.slice(0, 8).map((v) => Math.round(v)).join('→'),
  };
}
const glideOk = (g) => g.found && g.dh >= 150 && g.gap >= g.dh * 0.8 && g.closed && g.frames >= 4 && g.ms <= 1200 && g.mono && g.distinct >= 4;

async function run(browser, vp, runNo, opts = {}) {
  tag = `${vp.width}x${vp.height}${opts.micDenied ? '-mobile-micdenied' : ''}`;
  const R = `t${runNo}`;
  const page = await browser.newPage();
  await page.setViewport({ ...vp, deviceScaleFactor: 1, hasTouch: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  // 假的語音辨識（無頭 Chrome 沒麥克風）：測試自己丟結果進去；麥克風權限依情境當作允許／封鎖
  await page.evaluateOnNewDocument((denied) => {
    class FakeSR { constructor() { window.__sr = this; } start() { this.on = true; } stop() { this.on = false; setTimeout(() => this.onend && this.onend(), 0); } abort() { this.stop(); } }
    window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
    window.__srEmit = (list, resultIndex) => {
      const results = list.map(([t, fin]) => { const r = [{ transcript: t, confidence: 0.9 }]; r.isFinal = fin; return r; });
      window.__sr.onresult({ resultIndex, results });
    };
    const q = navigator.permissions?.query?.bind(navigator.permissions);
    if (q) navigator.permissions.query = (d) => (d && d.name === 'microphone' ? Promise.resolve({ state: denied ? 'denied' : 'granted' }) : q(d));
  }, !!opts.micDenied);

  // ---------- 攔截 ----------
  const ctl = { q2Stage: 1, polls: {}, jobs: {}, unknown: [] };
  const deviceId = 'web-uitest-assist-top';
  const config = {
    themeColor: '#2E6F40',
    config: {
      activePage: 0, deviceName: 'uitest-assist-top', screen: { w: vp.width, h: vp.height }, idleReturnSec: -1,
      chatApi: { email: 'test@example.test', password: 'x' },
      pages: [{ id: 1, name: '', blocks: [{ id: 1, w: 1, node: { t: 'cell', bg: 'Solid', bgColor: 4280693304, content: 'Text', text: '智能客服', tap: 'OpenAssistant', agentId: 'agent-1', agentName: '測試客服', agentSpeak: false, assistantLayout: opts.micDenied ? 'Mobile' : 'Kiosk', agentInputPos: 'Top' } }] }],
    },
  };
  const agent = { id: 'agent-1', name: '測試客服', description: '', greeting: '您好！我是測試客服。', suggestQuestions: ['園區有哪些景點？', '營業時間？'], avatarUrl: 'https://img.test/avatar.png', color: '#6366F1', enableImageUpload: true, enableFileUpload: false };
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    const json = (o, delay = 0) => setTimeout(() => req.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(o) }).catch(() => {}), delay);
    if (url.host === 'img.test') {
      const name = url.pathname.split('/').pop();
      if (!IMG[name]) return req.respond({ status: 404, body: '' });
      return setTimeout(() => req.respond({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=3600' }, body: imgBytes(name) }).catch(() => {}), IMG[name][3]);
    }
    if (url.host === 'www.google.com' && url.pathname.startsWith('/s2/favicons')) return req.respond({ status: 200, contentType: 'image/png', body: imgBytes('avatar.png') });
    if (url.origin !== BASE) return req.continue(); // Google 字型等
    const p = url.pathname, m = req.method();
    if (!p.startsWith('/api/')) return req.continue();
    // 播放頁同步
    if (p === `/api/config/${deviceId}/version`) return json({ version: 5 });
    if (p === `/api/config/${deviceId}/wait`) return json({ version: 5 }, 20000); // 長輪詢：20 秒才回（一直不回的話 play.js 40 秒逾時會跳「連線中斷」膠囊，蓋住右上角的＋）
    if (p === `/api/config/${deviceId}` && m === 'GET') return json(config);
    if (p === `/api/config/${deviceId}` && m === 'PUT') return json({ version: 5 });
    if (p === `/api/devices/${deviceId}/events`) return json({ ok: true });
    // 客服（全部假造，不碰真的 JustAI）
    if (p === `/api/assist/${deviceId}/agent`) return json(agent, 150);
    if (p === `/api/assist/${deviceId}/threads` && m === 'POST') return json({ id: 'th-1' }, 100);
    if (p === `/api/assist/${deviceId}/threads` && m === 'GET') return json([{ id: 'th-old', title: '舊的對話', createdAt: localIso(new Date(Date.now() - 3600_000)) }], 100);
    let mm;
    if ((mm = p.match(/^\/api\/assist\/[^/]+\/threads\/([^/]+)\/messages$/))) return json(HISTORY_ROWS, 150);
    if ((mm = p.match(/^\/api\/assist\/[^/]+\/threads\/[^/]+\/jobs$/)) && m === 'POST') {
      const content = JSON.parse(req.postData() || '{}').content || '';
      const jobId = 'job-' + (Object.keys(ctl.jobs).length + 1);
      ctl.jobs[jobId] = content.includes('Q4') ? 'q4' : content.includes('Q3') ? 'q3' : content.includes('Q2') ? 'q2' : 'q1';
      return json({ jobId }, 100);
    }
    if ((mm = p.match(/^\/api\/assist\/[^/]+\/jobs\/([^/]+)$/))) {
      if (m === 'DELETE') return json({ ok: true });
      const id = mm[1], kind = ctl.jobs[id];
      ctl.polls[id] = (ctl.polls[id] || 0) + 1;
      if (kind === 'q1') return json({ text: q1Text(R), done: ctl.polls[id] >= 2, error: null });
      if (kind === 'q2') { const parts = q2Parts(R); return json({ text: parts.slice(0, ctl.q2Stage).join(''), done: ctl.q2Stage >= parts.length, error: null }); }
      if (kind === 'q3') return json({ text: Q3_TEXT, done: true, error: null });
      return json({ text: q4Text(ctl.polls[id]), done: false, error: null });
    }
    if (p === '/api/assist/preview') return json({ url: url.searchParams.get('url'), host: 'example.test', title: '', imageUrl: '' });
    ctl.unknown.push(`${m} ${p}`);
    return json({});
  });

  // ---------- 小工具 ----------
  const until = async (fn, timeout = 10000, ...args) => { try { await page.waitForFunction(fn, { timeout, polling: 50 }, ...args); return true; } catch { return false; } };
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) });
  const safe = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, 'exception: ' + e.message.split('\n')[0]); } };
  const scale = () => page.evaluate(() => parseFloat(document.querySelector('.as-root').style.getPropertyValue('--as-scale')) || 1);
  // 頁面裡的量測工具：q(label)＝問題那組相對捲動框上緣的位置（.as-ex 不做進場動畫，量它最準）；pad＝清單上內距
  await page.evaluateOnNewDocument(() => {
    window.__z = () => parseFloat(document.querySelector('.as-root')?.style.zoom) || 1; // 寬舞台整層 zoom：畫面 px ÷ __z ＝ CSS px
    window.__accent = () => { const x = document.createElement('i'); x.style.color = 'var(--as-accent)'; document.querySelector('.as-root').appendChild(x); const c = getComputedStyle(x).color; x.remove(); return c; }; // 客服主題色（--as-accent）
    window.__m = (label) => {
      const sc = document.querySelector('.as-scroll'), list = document.querySelector('.as-list'), j = document.querySelector('.as-jump');
      const u = label && [...document.querySelectorAll('.as-msg.user')].find((m) => m.textContent.includes(label));
      const ex = u && u.closest('.as-ex');
      return {
        st: Math.round(sc.scrollTop), stx: Math.round(sc.scrollTop * 10) / 10, max: Math.round(sc.scrollHeight - sc.clientHeight), h: sc.scrollHeight, ch: sc.clientHeight,
        dist: Math.round((sc.scrollHeight - sc.clientHeight - sc.scrollTop) * 10) / 10, // 離底多遠（≤ 2＝貼底）
        pad: list ? parseFloat(getComputedStyle(list).paddingTop) : null,
        hb: Math.round((document.querySelector('.as-head').getBoundingClientRect().bottom - sc.getBoundingClientRect().top) / window.__z() * 10) / 10,
        k: parseFloat(document.querySelector('.as-root').style.getPropertyValue('--as-scale')) || 1,
        q: ex ? Math.round((ex.getBoundingClientRect().top - sc.getBoundingClientRect().top) / window.__z() * 10) / 10 : null,
        jump: !!j && !j.hidden, last: !!ex && ex === list.lastElementChild,
      };
    };
    // 每一格（rAF）記一次捲動狀態：看跟隨是滑的還是跳的、有沒有被丟在後面；lateKey＝那張晚到的大圖（記它載好了沒）
    window.__recStart = (label, lateKey) => {
      const r = window.__r = { samples: [], stop: false, img: null };
      const tick = () => {
        if (r.stop) return;
        const s = window.__m(label), ex = document.querySelector('.as-list > .as-ex:last-child');
        const single = ex && ex.querySelector('img.as-img[src*="q2single"]'); if (single && !r.img) r.img = single;
        const late = lateKey && document.querySelector('img[src*="' + lateKey + '"]');
        r.samples.push({ t: performance.now(), st: s.stx, dist: s.dist, h: s.h, jump: s.jump, q: s.q, hb: s.hb, k: s.k, late: !!late && late.complete && late.naturalWidth > 0 });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    window.__recStop = () => { window.__r.stop = true; return window.__r.samples; };
  });
  const m = (label) => page.evaluate((l) => window.__m(l), label);
  // 問題停在頂區正下方：貼齊清單上內距（頂區高＋24px×比例），也就是頂區下緣再 24px×比例（±4px×比例）
  const atTop = (s, tol = 4) => s.q != null && Math.abs(s.q - s.pad) <= tol * s.k && Math.abs(s.q - s.hb - 24 * s.k) <= tol * s.k;
  const atBottom = (label, timeout = 2000) => until((l) => window.__m(l).dist <= 2, timeout, label); // 跟隨是滑過去的：等它滑到底（約 1 秒內）
  // 人工長高：在最後一則 AI 回覆裡塞一塊空白（id＝__grow），可再調高或拿掉
  const grow = (px) => page.evaluate((px) => { let d = document.getElementById('__grow'); if (!d) { d = document.createElement('div'); d.id = '__grow'; [...document.querySelectorAll('.as-msg.bot')].pop().querySelector('.as-bot-body').appendChild(d); } d.style.height = px + 'px'; }, px);
  const ungrow = () => page.evaluate(() => document.getElementById('__grow')?.remove());
  /** 對話區由上往下：每組裡每則的前幾個字（看順序） */
  const order = () => page.evaluate(() => [...document.querySelector('.as-list').children].map((c) => (c.classList.contains('as-ex') ? [...c.querySelectorAll('.as-msg')].map((m) => (m.classList.contains('user') ? 'U:' : 'B:') + m.textContent.trim().slice(0, 6)).join('|') : 'OTHER:' + c.className)));
  const wheel = async (dy) => {
    const box = await page.evaluate(() => { const r = document.querySelector('.as-scroll').getBoundingClientRect(), hb = document.querySelector('.as-head').getBoundingClientRect().bottom; return { x: r.x + r.width / 2, y: (Math.max(r.top, hb) + r.bottom) / 2 }; }); // 頂區下面露出來的那段
    await page.mouse.move(box.x, box.y);
    await page.mouse.wheel({ deltaY: dy });
    await sleep(700);
  };
  const ask = async (text) => {
    if (await page.$('.as-circle.mic.listening')) { await page.click('[data-act="mic"]'); await until(() => !!document.querySelector('.as-field'), 3000); }
    await page.evaluate(() => { const ta = document.querySelector('.as-field'); ta.value = ''; ta.dispatchEvent(new Event('input')); });
    await page.click('.as-field'); await page.type('.as-field', text);
    await page.click('[data-act="send"]');
  };
  // 整段過程：不能再出現「較早的問答」分隔線、往上箭頭、上緣的跳鈕；跳鈕只能有一顆、出現時在內容區下半部（每 40ms 檢查一次）
  const armWatch = () => page.evaluate(() => {
    window.__bad = [];
    window.__jw = setInterval(() => {
      const root = document.querySelector('.as-root'); if (!root) return;
      if (root.querySelector('.as-sep')) window.__bad.push('有分隔線元素');
      if (root.textContent.includes('較早的問答')) window.__bad.push('出現「較早的問答」');
      const js = root.querySelectorAll('.as-jump');
      if (js.length !== 1) window.__bad.push('跳鈕數量 ' + js.length);
      js.forEach((j) => {
        if (j.classList.contains('up') || j.textContent.includes('arrow_upward')) window.__bad.push('上緣／往上箭頭的跳鈕');
        if (!j.hidden) { const r = j.getBoundingClientRect(), b = document.querySelector('.as-body').getBoundingClientRect(); if (r.top < b.top + b.height / 2) window.__bad.push('回到最新跑到上半部'); }
      });
    }, 40);
  });

  await page.goto(`${BASE}/play/?device=uitest-assist-top&key=uitest-key`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('.tappable', { timeout: 10000 });
  await sleep(300);
  await page.click('.tappable');
  await page.waitForSelector('.as-root .as-field', { timeout: 8000 });
  await until(() => document.querySelector('.as-name')?.textContent === '測試客服', 5000);
  await sleep(600); // 進場轉場

  /** 頂區＝頂欄＋白色圓角框（輸入列在上、68px 大麥克風在下） */
  const headLayout = () => page.evaluate(() => {
    const root = document.querySelector('.as-root'), head = document.querySelector('.as-head'), pill = document.querySelector('.as-pill');
    const row = document.querySelector('.as-text-row'), micRow = document.querySelector('.as-mic-row'), mic = document.querySelector('.as-circle.mic');
    const z = window.__z(), R = (e) => { const b = e.getBoundingClientRect(); return { left: b.left / z, right: b.right / z, top: b.top / z, bottom: b.bottom / z, width: b.width / z, height: b.height / z }; };
    const hr = R(head), pr = R(pill), rr = R(row), mr = R(mic), cs = getComputedStyle(mic);
    return {
      posTop: root.classList.contains('pos-top'), headTop: Math.round(hr.top - R(root).top), inputInHead: head.contains(document.querySelector('.as-input')), topInHead: head.contains(document.querySelector('.as-top')),
      pillInHead: pr.top >= hr.top - 0.5 && pr.bottom <= hr.bottom + 0.5, pillBg: getComputedStyle(pill).backgroundColor,
      pillKids: [...pill.children].map((x) => x.className).join(' > '), micUnderRow: mr.top >= rr.bottom - 0.5 && !!micRow.contains(mic),
      micW: parseFloat(cs.width), micH: parseFloat(cs.height), micBg: cs.backgroundColor, micColor: cs.color, micIcon: mic.textContent.trim(), micCls: mic.className,
      smallMic: document.querySelectorAll('.as-mic-ic').length, zoom: getComputedStyle(document.querySelector('.as-input')).zoom,
      gapL: +(pr.left - hr.left).toFixed(2), gapR: +(hr.right - pr.right).toFixed(2), gapB: +(hr.bottom - pr.bottom).toFixed(2),
      headR: parseFloat(getComputedStyle(head).borderBottomLeftRadius), headRR: parseFloat(getComputedStyle(head).borderBottomRightRadius),
      boxR: +(parseFloat(getComputedStyle(pill).borderBottomLeftRadius) * (parseFloat(getComputedStyle(document.querySelector('.as-input')).zoom) || 1)).toFixed(2),
      scale: parseFloat(root.style.getPropertyValue('--as-scale')) || 1, accent: window.__accent(),
    };
  });

  // ===== 手機操作模式＋麥克風被封鎖（只跑一個小情境）=====
  if (opts.micDenied) {
    await safe('麥克風封鎖', async () => {
      const auto = await until(() => !!document.querySelector('.as-dialog'), 3000);
      await page.evaluate(() => document.querySelector('.as-dialog [data-act="vh-close"]')?.click());
      await sleep(150);
      const g = await headLayout();
      console.log('  版面量測：', JSON.stringify(g));
      check('頂區在最上面（top＝0）、頂欄與白色圓角框都在頂區裡、手機模式不放大', g.posTop && g.headTop === 0 && g.topInHead && g.inputInHead && g.pillInHead && g.pillBg === 'rgb(255, 255, 255)' && g.zoom === '1', JSON.stringify(g));
      check('白框跟頂區下緣同心：左＝右＝下間距（8px×比例×zoom）、頂區圓角－白框圓角＝間距（±1px）', Math.abs(g.gapL - g.gapR) <= 1 && Math.abs(g.gapL - g.gapB) <= 1 && Math.abs(g.headR - g.boxR - g.gapL) <= 1 && g.headR === g.headRR && Math.abs(g.gapL - 8 * g.scale * parseFloat(g.zoom)) <= 1, JSON.stringify({ gapL: g.gapL, gapR: g.gapR, gapB: g.gapB, headR: g.headR, boxR: g.boxR, zoom: g.zoom }));
      check('框裡先輸入列、下面才是 56px 大麥克風（沒有小麥克風）', g.pillKids === 'as-text-row > as-mic-row' && g.micUnderRow && Math.abs(g.micW - 56 * g.scale) < 0.6 && Math.abs(g.micH - 56 * g.scale) < 0.6 && g.smallMic === 0, JSON.stringify({ kids: g.pillKids, w: g.micW, under: g.micUnderRow }));
      check('封鎖：自動跳說明；大麥克風＝淡橘底 #FFDBBB＋深橘劃掉的麥克風', auto && g.micCls.includes('blocked') && g.micIcon === 'mic_off' && g.micBg === 'rgb(255, 219, 187)' && g.micColor === 'rgb(168, 84, 0)', JSON.stringify({ auto, cls: g.micCls, icon: g.micIcon, bg: g.micBg, c: g.micColor }));
      await page.click('[data-act="mic"]');
      const again = await until(() => !!document.querySelector('.as-dialog .as-dialog-title'), 2000);
      check('封鎖：點麥克風跳出說明視窗', again);
      await sleep(250);
      await shot('mic-denied-help');
      await page.evaluate(() => document.querySelector('.as-dialog [data-act="vh-close"]')?.click());
      await sleep(250);
      await shot('mic-denied');
      const fw = await page.evaluate(() => Math.round(document.querySelector('.as-field').getBoundingClientRect().width));
      check('手機操作模式：輸入框夠寬', fw > 150, String(fw));
    });
    check('沒有頁面錯誤／console 錯誤', errs.length === 0, errs.join(' | ').slice(0, 400));
    await page.close();
    return;
  }
  await page.evaluate(() => document.querySelector('.as-dialog [data-act="vh-close"]')?.click()); // 萬一跳了麥克風說明
  await armWatch();
  const sc0 = await scale();

  // ===== 版面：頂區＝頂欄＋白色圓角框（上下顛倒）；空白開場 =====
  await safe('版面', async () => {
    const g = await headLayout();
    const x = await page.evaluate(() => {
      const head = document.querySelector('.as-head'), hr = head.getBoundingClientRect(), rr = document.querySelector('.as-root').getBoundingClientRect(), sr = document.querySelector('.as-scroll').getBoundingClientRect(), er = document.querySelector('.as-empty .as-avatar')?.getBoundingClientRect();
      const hit = document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2);
      const hs = getComputedStyle(document.querySelector('.as-head')), ts = getComputedStyle(document.querySelector('.as-top'));
      return {
        scrollTop0: Math.round(sr.top - rr.top), headPos: getComputedStyle(head).position, headOnTop: head.contains(hit), emptyBelow: !!er && er.top >= hr.bottom + 8, chips: document.querySelectorAll('.as-empty .as-chip').length,
        headBg: hs.backgroundColor, radiusBL: hs.borderBottomLeftRadius, radiusTL: hs.borderTopLeftRadius, shadow: hs.boxShadow, topBg: ts.backgroundColor, topBorder: ts.borderBottomWidth,
        rowOrder: [...document.querySelector('.as-text-row').children].map((c) => c.className.split(' ')[0] + (c.dataset.act ? ':' + c.dataset.act : '')).join(' > '),
        jumpMarkup: [...document.querySelectorAll('.as-jump')].map((j) => j.className + ':' + j.textContent.trim() + ':' + j.getAttribute('aria-label') + ':' + (j.hidden ? 'hidden' : 'shown')).join(','),
      };
    });
    console.log('  版面量測：', JSON.stringify({ ...g, ...x }));
    check('頂區在最上面（top＝0）、頂欄與輸入框都包在頂區裡', g.posTop && g.headTop === 0 && g.topInHead && g.inputInHead && g.pillInHead, JSON.stringify({ headTop: g.headTop }));
    check('頂區浮在內容上面：絕對定位、在捲動區上層，捲動區從最上面開始（延伸到頂區底下）', x.headPos === 'absolute' && x.headOnTop && x.scrollTop0 === 0, JSON.stringify({ pos: x.headPos, onTop: x.headOnTop, scrollTop: x.scrollTop0 }));
    check('頂區＝不透明淡主題色底、下緣圓角、淡淡往下的陰影（0 4px 16px 5% 黑）；頂欄透明無分隔線', (/^rgb\(/.test(x.headBg) ||/^color\(srgb [\d.]+ [\d.]+ [\d.]+\)$/.test(x.headBg)) && x.headBg !== 'rgb(255, 255, 255)' && parseFloat(x.radiusBL) >= 27 && parseFloat(x.radiusTL) === 0 && x.shadow === 'rgba(0, 0, 0, 0.05) 0px 4px 16px 0px' && x.topBg === 'rgba(0, 0, 0, 0)' && x.topBorder === '0px', JSON.stringify({ bg: x.headBg, r: x.radiusBL, sh: x.shadow }));
    check('白框跟頂區下緣同心：左＝右＝下間距（8px×比例×1.6）、頂區圓角－白框圓角＝間距（±1px）', Math.abs(g.gapL - g.gapR) <= 1 && Math.abs(g.gapL - g.gapB) <= 1 && Math.abs(g.headR - g.boxR - g.gapL) <= 1 && g.headR === g.headRR && Math.abs(g.gapL - 8 * g.scale * parseFloat(g.zoom)) <= 1, JSON.stringify({ gapL: g.gapL, gapR: g.gapR, gapB: g.gapB, headR: g.headR, boxR: g.boxR, zoom: g.zoom }));
    check('白色圓角框、KIOSK 上方模式輸入區跟頂欄一樣放大 1.6 倍', g.pillBg === 'rgb(255, 255, 255)' && g.zoom === '1.6', JSON.stringify({ bg: g.pillBg, zoom: g.zoom }));
    check('框裡先輸入列（附件 > 輸入框 > ✕ > 送出）、下面才是 56px 大麥克風（主題色）、沒有小麥克風', g.pillKids === 'as-text-row > as-mic-row' && g.micUnderRow && x.rowOrder === 'as-attach:attach > as-field > as-clear:clear > as-circle:send' && Math.abs(g.micW - 56 * sc0) < 0.6 && g.micIcon === 'mic' && g.micBg === g.accent && g.smallMic === 0, JSON.stringify({ kids: g.pillKids, row: x.rowOrder, w: g.micW, bg: g.micBg, accent: g.accent }));
    check('空白開場（頭像、問候語、建議問題）排在頂區下面，沒被蓋住', x.emptyBelow && x.chips === 2);
    check('跳鈕只有一顆：底部的「回到最新」（往下箭頭）、一開始藏著', x.jumpMarkup === 'as-jump:arrow_downward:回到最新:hidden', x.jumpMarkup);
    await shot('01-empty');
  });

  // ===== 送出鈕不能按＝半透明灰（不是主題色）=====
  await safe('送出鈕', async () => {
    const s = await page.evaluate(() => { const b = document.querySelector('[data-act="send"]'), cs = getComputedStyle(b); return { disabled: b.disabled, bg: cs.backgroundColor, color: cs.color, opacity: cs.opacity }; });
    check('沒字時「送出」＝半透明灰底＋灰字、不淡化（不是主題色）', s.disabled && s.bg === 'rgba(27, 28, 30, 0.1)' && s.color === 'rgba(27, 28, 30, 0.38)' && s.opacity === '1', JSON.stringify(s));
  });

  // ===== 一鍵清空 =====
  await safe('清除鈕', async () => {
    const init = await page.evaluate(() => { const c = document.querySelector('.as-clear'); return { exists: !!c, hidden: c ? c.hidden : null }; });
    check('空白時沒有清除鈕', init.exists && init.hidden, JSON.stringify(init));
    await page.click('.as-field');
    await page.evaluate(() => { window.__ta = document.querySelector('.as-field'); window.__blurs = 0; window.__ta.addEventListener('blur', () => window.__blurs++); });
    await page.type('.as-field', '想問的問題');
    await sleep(300); // 送出鈕底色有 .15s 轉場
    const typed = await page.evaluate(() => { const c = document.querySelector('.as-clear'), b = document.querySelector('[data-act="send"]'); const r = c.getBoundingClientRect(), hr = document.querySelector('.as-head').getBoundingClientRect(); return { visible: !c.hidden && r.width > 0, inHead: r.top >= hr.top && r.bottom <= hr.bottom, focused: document.activeElement === window.__ta, sendOn: !b.disabled, sendBg: getComputedStyle(b).backgroundColor, accent: window.__accent() }; });
    check('打字時清除鈕出現（在頂區框裡）、送出可按（主題色）、輸入框仍在焦點', typed.visible && typed.inHead && typed.focused && typed.sendOn && typed.sendBg === typed.accent, JSON.stringify(typed));
    await page.click('.as-clear');
    await sleep(150);
    const after = await page.evaluate(() => ({ value: window.__ta.value, focused: document.activeElement === window.__ta, same: document.querySelector('.as-field') === window.__ta, blurs: window.__blurs, clearHidden: document.querySelector('.as-clear').hidden, sendDisabled: document.querySelector('[data-act="send"]').disabled }));
    check('點清除：清空、焦點留著沒失焦過、送出變灰、清除鈕藏起', after.value === '' && after.focused && after.same && after.blurs === 0 && after.clearHidden && after.sendDisabled, JSON.stringify(after));
  });

  // ===== 聆聽中（大麥克風變紅）＋清除 =====
  await safe('聆聽', async () => {
    await page.click('[data-act="mic"]');
    await until(() => !!document.querySelector('.as-transcript'), 3000);
    await page.evaluate(() => window.__srEmit([['你好', false]], 0));
    const l = await page.evaluate(() => { const b = document.querySelector('.as-circle.mic'); return { listening: b.classList.contains('listening'), bg: getComputedStyle(b).backgroundColor, t: document.querySelector('.as-transcript')?.textContent, inRow: !!document.querySelector('.as-pill .as-text-row .as-transcript'), clear: !document.querySelector('.as-clear').hidden }; });
    check('聆聽中：大麥克風紅色、輸入列顯示聽到的字、清除鈕出現', l.listening && l.bg === 'rgb(186, 26, 26)' && l.t === '你好' && l.inRow && l.clear, JSON.stringify(l));
    await page.click('.as-clear');
    await sleep(100);
    const t2 = await page.evaluate(() => ({ t: document.querySelector('.as-transcript')?.textContent, listening: !!document.querySelector('.as-circle.mic.listening') }));
    check('聆聽中按清除：清掉聽到的字、繼續聽', t2.t === '聆聽中，請說話…' && t2.listening, JSON.stringify(t2));
    await page.click('[data-act="mic"]');
    await until(() => !!document.querySelector('.as-field'), 3000);
  });

  // ===== Q1：長回答＋相簿 → 答完、圖載完都在最底下 =====
  await safe('Q1', async () => {
    await ask('Q1 園區介紹');
    const done = await until(() => !!document.querySelector('[data-act="send"]') && (document.querySelector('.as-list')?.textContent || '').includes('Q1 結束。'), 20000);
    const imgs = await until(() => { const l = [...document.querySelectorAll('.as-list .as-strip img')]; return l.length >= 3 && l.every((i) => i.complete && i.naturalWidth > 0); }, 8000);
    const settled = await atBottom('Q1');
    const s = await m('Q1');
    const o = await order();
    check('Q1（長回答＋相簿）答完、圖都載完 → 只有一組、滑到最底下、沒有「回到最新」', done && imgs && settled && o.length === 1 && o[0].startsWith('U:Q1') && o[0].includes('|B:Q1') && s.dist <= 2 && !s.jump, JSON.stringify({ s, o }));
  });

  // ===== Q2：接在最後面；回答還短時問題在頂區正下方；之後串流、晚到的圖都一直跟著往下（滑的） =====
  await safe('Q2', async () => {
    const before = await m('Q1');
    // 從按下送出就盯著：自動捲動途中「回到最新」不能閃出來
    await page.evaluate(() => { window.__seekJump = []; window.__sj = setInterval(() => { const j = document.querySelector('.as-jump'); window.__seekJump.push(!j.hidden); }, 25); });
    await ask('Q2 補充說明');
    await page.evaluate(() => window.__recStart('Q2', 'q2late'));
    const t0 = Date.now();
    // 回答還沒長過一個畫面：「到底」＝Q2 問題在頂區正下方（等它滑到）
    const settled = await until(() => { const s = window.__m('Q2'); const ok = s.q != null && Math.abs(s.q - s.pad) <= 4 * s.k && s.dist <= 2; if (ok) window.__settle = s; return ok; }, 4000);
    const settleMs = Date.now() - t0;
    const s0 = await page.evaluate(() => window.__settle || window.__m('Q2'));
    await sleep(500);
    const flash = await page.evaluate(() => { clearInterval(window.__sj); return window.__seekJump.filter(Boolean).length; });
    const o = await order();
    check('送出 Q2：新的一組接在 Q1 後面（舊的在上），是最後一組', o.length === 2 && o[0].startsWith('U:Q1') && o[1].startsWith('U:Q2') && s0.last, JSON.stringify(o));
    check('送出後滑到底：回答還短時 Q2 問題就停在頂區正下方（清單上內距 ±4px×比例）、已到底', settled && atTop(s0) && s0.dist <= 2 && s0.st > before.st + 100, JSON.stringify({ settleMs, s0, before: before.st }));
    check('自動捲動途中「回到最新」沒有閃出來', flash === 0, `出現 ${flash} 次`);
    const behind = await page.evaluate(() => {
      const head = document.querySelector('.as-head'), hr = head.getBoundingClientRect(), r = parseFloat(getComputedStyle(head).borderBottomLeftRadius);
      const under = [...document.querySelectorAll('.as-scroll .as-msg, .as-scroll .as-text, .as-scroll .as-card')].filter((e) => { const b = e.getBoundingClientRect(); return b.height > 0 && b.top < hr.bottom && b.bottom > hr.top; }).length;
      // 左右下角圓角外面那一點：疊在下面的是捲動區（頂區的透明輸入區會接到點擊，所以看整疊，不只最上面那層）
      const corner = [[hr.left + 2, hr.bottom - 2], [hr.right - 2, hr.bottom - 2]].map(([x, y]) => document.elementsFromPoint(x, y).some((e) => e.closest('.as-scroll')));
      return { under, corner, r };
    });
    check('內容捲到頂區後面：有訊息跟頂區重疊，左右下角圓角外面底下是對話捲動區', behind.under > 0 && behind.corner.every(Boolean), JSON.stringify(behind));
    // 第一段：文字＋單張圖（1.5 秒才回來）
    const s1 = await until(() => (document.querySelector('.as-list > .as-ex:last-child')?.textContent || '').includes('單張圖下面的字'), 15000);
    await sleep(300);
    await shot('02-streaming');
    ctl.q2Stage = 2; // 第二段：相簿（圖都晚到）
    const s2 = await until(() => (document.querySelector('.as-list > .as-ex:last-child')?.textContent || '').includes('相簿下面的字'), 15000);
    const imgsOk = await until(() => { const l = [...document.querySelectorAll('.as-list > .as-ex:last-child .as-bot-body img')]; return l.length >= 4 && l.every((i) => i.complete && i.naturalWidth > 0); }, 12000);
    ctl.q2Stage = 3; // 第三段：最後面一張大圖（回覆結束後 2.5 秒才載好）
    const done = await until(() => !!document.querySelector('[data-act="send"]') && (document.querySelector('.as-list > .as-ex:last-child')?.textContent || '').includes('Q2 結束。'), 20000);
    const lateOk = await until(() => { const i = document.querySelector('img[src*="q2late"]'); return !!i && i.complete && i.naturalWidth > 0; }, 8000);
    const end = await atBottom('Q2');
    await sleep(200);
    const sm = await page.evaluate(() => window.__recStop());
    const f = followStats(sm), g = glideStats(sm);
    const last = await m('Q2');
    const imgSame = await page.evaluate(() => { const img = document.querySelector('.as-list > .as-ex:last-child img.as-img[src*="q2single"]'); return !!img && img === window.__r.img && img.complete && img.naturalWidth > 0; });
    check('Q2 串流全程（文字＋晚到的單張圖、相簿、最後的大圖）一直跟著往下：沒被丟在後面（離底 >120px×比例 不超過 1 秒）、最後停在最底下、沒出現「回到最新」', s1 && s2 && imgsOk && done && lateOk && end && f.n > 60 && f.longestBehindMs <= 1000 && last.dist <= 2 && !f.jumpSeen, JSON.stringify(f));
    check('回答長過畫面（內容變高 300px 以上）→ Q2 問題跟著往上捲到頂區後面', f.grew > 300 && last.q < last.hb, JSON.stringify({ grew: f.grew, q: last.q, hb: last.hb }));
    check('晚到的大圖載好後是「滑」到底：好幾格（≥4 格、1.2 秒內）才收到 10% 以內，scrollTop 一路往下經過好幾個中間值', glideOk(g), JSON.stringify(g));
    check('串流重畫沿用同一個圖片元素（訊息快取照常）', imgSame);
    const o2 = await order();
    const txt = await page.evaluate(() => document.querySelector('.as-root').textContent.includes('較早的問答'));
    check('兩組照一般順序：Q1 在 Q2 前面、組內問題在前回答在後；沒有「較早的問答」', o2.length === 2 && o2[0].startsWith('U:Q1') && o2[0].includes('|B:Q1') && o2[1].startsWith('U:Q2') && o2[1].includes('|B:Q2') && !txt, JSON.stringify(o2));
    await shot('03-two-exchanges');
  });

  // ===== 往上捲 → 放手、底部「回到最新」；放手時長高不拉回；點它 → 滑到底並接著跟 =====
  await safe('回到最新', async () => {
    await wheel(-600);
    const up = await m('Q2');
    const pos = await page.evaluate(() => { const j = document.querySelector('.as-jump'), b = document.querySelector('.as-body').getBoundingClientRect(), r = j.getBoundingClientRect(), cs = getComputedStyle(j); return { gapBottom: Math.round((b.bottom - r.bottom) / window.__z()), center: Math.round(r.left + r.width / 2 - (b.left + b.width / 2)), shadow: cs.boxShadow, bg: cs.backgroundColor, border: cs.borderTopColor, icon: j.textContent.trim(), label: j.getAttribute('aria-label') }; });
    check('滾輪往上捲 → 放手：離底超過 96px、出現「回到最新」', up.dist > 96 && up.jump, JSON.stringify(up));
    check('「回到最新」在內容區底部正中間、白底細灰框、沒有陰影、往下箭頭', Math.abs(pos.gapBottom - 16 * sc0) <= 2 && Math.abs(pos.center) <= 1 && pos.shadow === 'none' && pos.bg === 'rgb(255, 255, 255)' && pos.border === 'rgb(223, 227, 232)' && pos.icon === 'arrow_downward' && pos.label === '回到最新', JSON.stringify(pos));
    await shot('04-scrolled-up');
    await grow(300);
    await sleep(500);
    const g1 = await m('Q2');
    check('放手後內容再變高（+300px）→ 不會被拉回底部（捲動位置不動）、「回到最新」還在', g1.h >= up.h + 290 && Math.abs(g1.stx - up.stx) <= 2 && g1.dist > up.dist + 250 && g1.jump, JSON.stringify({ up, g1 }));
    await page.click('.as-jump');
    const hid = await page.evaluate(() => document.querySelector('.as-jump').hidden);
    const backOk = await atBottom('Q2');
    const back = await m('Q2');
    await grow(700);
    const regrowOk = await until((h0) => { const s = window.__m('Q2'); return s.h > h0 + 300 && s.dist <= 2; }, 2000, back.h);
    const regrow = await m('Q2');
    check('點「回到最新」→ 鈕馬上藏起、滑到底；之後再變高會繼續跟（滑到底）', hid && backOk && !back.jump && back.stx > g1.stx + 200 && regrowOk && regrow.dist <= 2 && !regrow.jump, JSON.stringify({ back, regrow }));
    await ungrow();
    await sleep(400);
    const shrunk = await m('Q2');
    check('內容變短被夾回底部不算往上拉：還在底部、沒有鈕', shrunk.h < regrow.h - 500 && shrunk.dist <= 2 && !shrunk.jump, JSON.stringify(shrunk));
  });

  // ===== onScroll 規則（跟下方共用）：往上拉＝放手（連 40px 也算）；往下捲回離底 96px 內＝接回 =====
  await safe('離底 96px', async () => {
    await wheel(-40);
    const sl = await m('Q2');
    check('往上捲一點點（離底約 40px）→ 也算訪客往上拉：放手、出現「回到最新」', sl.dist > 2 && sl.dist <= 96 && sl.jump, JSON.stringify(sl));
    await wheel(-600);
    const far = await m('Q2');
    await wheel(300);
    const mid = await m('Q2');
    check('往下捲但離底還超過 96px → 還是放手、鈕還在', mid.stx > far.stx + 200 && mid.dist > 96 && mid.jump, JSON.stringify({ far, mid }));
    await wheel(Math.round(mid.dist - 50));
    const near = await m('Q2');
    check('往下捲到離底 96px 內（還沒到底）→ 接回跟隨、鈕消失', near.dist > 2 && near.dist <= 96 && !near.jump, JSON.stringify(near));
    await grow(300);
    const ok = await until((h0) => { const s = window.__m('Q2'); return s.h > h0 + 250 && s.dist <= 2; }, 2000, near.h);
    const ng = await m('Q2');
    check('接回之後內容再變高 → 滑到底', ok && ng.dist <= 2 && !ng.jump, JSON.stringify(ng));
    await ungrow();
    await sleep(300);
  });

  // ===== Q3 短回答（一行）：答完在最底下＝問題停在頂區正下方、下面留白 =====
  await safe('Q3 短回答', async () => {
    await ask('Q3 短問題');
    const ok = await until(() => !!document.querySelector('[data-act="send"]') && (document.querySelector('.as-list > .as-ex:last-child')?.textContent || '').includes('Q3 簡短的回答。'), 10000);
    const settled = await until(() => { const s = window.__m('Q3'); return s.dist <= 2 && s.q != null && Math.abs(s.q - s.pad) <= 4 * s.k; }, 2000);
    await sleep(300);
    const s = await m('Q3');
    const mh = await page.evaluate(() => {
      const sc = document.querySelector('.as-scroll'), list = document.querySelector('.as-list'), exs = [...list.children], last = exs[exs.length - 1], prev = exs[exs.length - 2];
      const cs = getComputedStyle(list), want = sc.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const bot = last.querySelector('.as-msg.bot').getBoundingClientRect();
      return { min: parseFloat(getComputedStyle(last).minHeight), want: Math.round(want * 10) / 10, lastH: Math.round(last.getBoundingClientRect().height / window.__z()), prevMin: getComputedStyle(prev).minHeight, blankBelow: Math.round(sc.getBoundingClientRect().bottom - bot.bottom) };
    });
    check('Q3（一行的短回答）答完 → 在最底下＝問題停在頂區正下方（清單上內距 ±4px×比例）、沒有「回到最新」', ok && settled && atTop(s) && s.dist <= 2 && s.st === s.max && !s.jump, JSON.stringify(s));
    check('最後一組最小高度＝捲動框高－清單上下內距；前一組沒有最小高度；短回答下面留白', Math.abs(mh.min - mh.want) <= 1.5 && mh.lastH >= mh.want - 1 && (mh.prevMin === 'auto' || mh.prevMin === '0px') && mh.blankBelow > 100, JSON.stringify(mh));
    await wheel(400); // 已經到底，再往下也不動
    const s2 = await m('Q3');
    check('短回答時往下捲不會再動（問題留在頂區正下方）', atTop(s2) && s2.dist <= 2 && !s2.jump, JSON.stringify(s2));
  });

  // ===== Q4 長回答串流中：一直跟著往下；往上看舊的就放手；回到最新 → 接著跟；停止 =====
  await safe('Q4 串流', async () => {
    await ask('Q4 第四個問題');
    await page.evaluate(() => window.__recStart('Q4'));
    // 等回答長過一個畫面再量（1080 寬一點只佔一行，點數要多）
    const reached = await until(() => { const ex = document.querySelector('.as-list > .as-ex:last-child'), sc = document.querySelector('.as-scroll'); return (ex?.textContent || '').includes('Q4第 3 點') && ex.getBoundingClientRect().height / window.__z() > sc.clientHeight + 150; }, 40000);
    await sleep(1000); // 再多看一秒的串流
    const f = followStats(await page.evaluate(() => window.__recStop()));
    const a = await m('Q4');
    check('Q4 長回答串流中一直跟著往下（落後超過 120px×比例 不超過 1 秒、目前離底 ≤80px×比例）、問題捲到頂區後面、沒有「回到最新」', reached && f.longestBehindMs <= 1000 && !f.jumpSeen && a.dist <= 80 * a.k && a.q < a.hb && !a.jump, JSON.stringify({ f, a }));
    await wheel(-500);
    const ref0 = await page.evaluate(() => { const u = [...document.querySelectorAll('.as-msg.user')].find((x) => x.textContent.includes('Q3')); window.__ref = u; return { y: u.getBoundingClientRect().top, h: document.querySelector('.as-scroll').scrollHeight }; });
    await sleep(1500);
    const ref1 = await page.evaluate(() => ({ y: window.__ref.getBoundingClientRect().top, h: document.querySelector('.as-scroll').scrollHeight, streaming: !!document.querySelector('[data-act="stop"]') }));
    const reading = await m('Q4');
    check('串流中往上看舊的：放手，回答繼續往下長，正在看的內容沒被推走、「回到最新」在', ref1.streaming && ref1.h > ref0.h + 50 && Math.abs(ref1.y - ref0.y) <= 2 && reading.jump, JSON.stringify({ ref0, ref1, reading }));
    await page.click('.as-jump');
    const backOk = await until(() => { const s = window.__m('Q4'); return s.dist <= 80 * s.k && !s.jump; }, 2000);
    const back = await m('Q4');
    await sleep(800);
    const still = await m('Q4');
    check('回答還在長的時候點「回到最新」→ 滑回最底下、鈕消失，之後一直跟著往下', backOk && !back.jump && still.h > back.h && still.dist <= 80 * still.k && !still.jump && still.stx > back.stx, JSON.stringify({ back, still }));
    await page.evaluate(() => { const last = document.querySelector('.as-list > .as-ex:last-child'); window.__u4 = last.querySelector('.as-msg.user'); window.__b4 = last.querySelector('.as-msg.bot'); window.__t4 = window.__b4.querySelector('.as-bot-body'); });
    await page.click('[data-act="stop"]');
    const stopOk = await atBottom('Q4', 1500);
    await sleep(200);
    const stopped = await page.evaluate(() => { const last = document.querySelector('.as-list > .as-ex:last-child'); return { s: window.__m('Q4'), same: last.contains(window.__u4) && last.contains(window.__b4) && window.__b4.querySelector('.as-bot-body') === window.__t4, text: last.textContent.includes('Q4 的回答開頭') && last.textContent.includes('Q4第 3 點'), cursor: !!document.querySelector('.as-cursor'), send: !!document.querySelector('[data-act="send"]') }; });
    check('按停止：保留已收到的字、沒重建（同一組、同一則、同一個內容框）、停在最底下、沒有「回到最新」', stopped.same && stopped.text && !stopped.cursor && stopped.send && stopOk && stopped.s.dist <= 2 && !stopped.s.jump, JSON.stringify(stopped));
  });

  // ===== 歷史對話：照一般順序、直接（不滑）在最底下；最後一組回答短＝最後一個問題在頂區正下方 =====
  await safe('歷史', async () => {
    await wheel(-700); // 先往上捲（放手）再開歷史：載入後要重新貼底
    await page.click('[data-act="history"]');
    await page.waitForSelector('.as-history-card', { timeout: 5000 });
    await sleep(300);
    await page.click('.as-history-card');
    const ok = await until(() => (document.querySelector('.as-list')?.textContent || '').includes('HB 的回答'), 8000);
    const now = await m('HB'); // 一載入就量：不是滑過去的
    await sleep(800);
    const s = await m('HB');
    const o = await order();
    check('載入歷史 → 照一般順序：提問前的 AI 訊息自成一組在最上面、HA、HB 最後', ok && o.length === 3 && o[0].startsWith('B:歡迎光臨') && !o[0].includes('U:') && o[1].startsWith('U:HA') && o[1].includes('|B:HA') && o[2].startsWith('U:HB') && o[2].includes('|B:HB'), JSON.stringify(o));
    check('載入歷史 → 直接在最底下（沒有滑動）：HB 回答短＝HB 問題在頂區正下方、沒有「回到最新」', now.dist <= 2 && s.dist <= 2 && Math.abs(now.stx - s.stx) <= 1 && now.st > 0 && atTop(now) && atTop(s) && !now.jump && !s.jump, JSON.stringify({ now, s }));
    const hitNew = await page.evaluate(() => { const b = document.querySelector('[data-act="new"]'), r = b.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { disabled: b.disabled, hit: !!e && b.contains(e), at: e ? e.className || e.tagName : null, r: [Math.round(r.left), Math.round(r.top), Math.round(r.width)] }; });
    await page.click('[data-act="new"]');
    await sleep(600);
    const e = await page.evaluate(() => ({ empty: !!document.querySelector('.as-empty'), st: document.querySelector('.as-scroll').scrollTop, jump: !document.querySelector('.as-jump').hidden }));
    check('新對話 → 回到空白開場、最上面、沒有跳鈕', e.empty && e.st === 0 && !e.jump, JSON.stringify({ ...e, hitNew }));
  });

  const bad = await page.evaluate(() => { clearInterval(window.__jw); return [...new Set(window.__bad || [])]; });
  check('全程沒有「較早的問答」、往上箭頭或上緣的跳鈕，「回到最新」只在下半部', bad.length === 0, bad.join(','));
  check('沒有頁面錯誤／console 錯誤', errs.length === 0, errs.join(' | ').slice(0, 400));
  if (ctl.unknown.length) console.log('  （未知 API：' + [...new Set(ctl.unknown)].join(', ') + '）');
  await page.close();
}

// ---------- 後台：格子檢查器的「輸入區位置」 ----------
async function admin(browser) {
  tag = 'admin';
  const page = await browser.newPage();
  await page.setViewport({ width: 1512, height: 828 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('#username', { visible: true });
  await page.type('#username', 'joyeadmin'); await page.type('#password', 'joye#2026');
  await page.click('.btn-login');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '內容管理'), { timeout: 10000 });
  await sleep(500);
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '內容管理').click(); });
  await page.waitForFunction(() => document.getElementById('wsModal').classList.contains('is-visible'), { timeout: 8000 });
  await sleep(800);
  await page.evaluate(() => document.querySelector('.ws-tabs [data-wstab="layout"]')?.click());
  await sleep(500);
  await page.evaluate(() => document.querySelector('#canvas .cell').click());
  await sleep(600);
  const picked = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('#cellPanel select')].find((el) => [...el.options].some((o) => o.value === 'OpenAssistant'));
    if (!sel) return false;
    if (sel.value !== 'OpenAssistant') { sel.value = 'OpenAssistant'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    return true;
  });
  check('格子的點擊動作可設成 AI 智能客服', picked);
  await sleep(600);
  const rowOf = (label) => [...document.querySelectorAll('#cellPanel .ins-row')].find((r) => r.querySelector('.ins-label')?.textContent.trim() === label);
  const info = await page.evaluate((src) => {
    const rowOf = eval(src);
    const row = rowOf('輸入區位置'), prev = row?.previousElementSibling, sel = row?.querySelector('select');
    const cell = getCell(selected); // eslint-disable-line no-undef
    return { exists: !!row, prevLabel: prev?.querySelector('.ins-label')?.textContent.trim(), opts: sel ? [...sel.options].map((o) => `${o.value}=${o.textContent}`).join(',') : '', value: sel?.value, layoutKind: rowOf('介面')?.querySelector('select')?.className, kind: sel?.className, cellVal: cell.agentInputPos ?? null };
  }, rowOf.toString());
  check('「輸入區位置」列存在、緊接在「介面」下面、同樣是下拉選單', info.exists && info.prevLabel === '介面' && info.kind === info.layoutKind, JSON.stringify(info));
  check('選項＝下方／上方，沒設定時顯示上方（2026-10-12 預設改上方）', info.opts === 'Bottom=下方,Top=上方' && info.value === 'Top' && (info.cellVal === null || info.cellVal === 'Top'), JSON.stringify(info));
  const setTo = (v) => page.evaluate((src, v) => { const sel = eval(src)('輸入區位置').querySelector('select'); sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); return getCell(selected).agentInputPos; }, rowOf.toString(), v); // eslint-disable-line no-undef
  const b = await setTo('Bottom');
  await sleep(300);
  const t = await setTo('Top');
  await sleep(300);
  await page.evaluate((src) => eval(src)('輸入區位置').scrollIntoView({ block: 'center' }), rowOf.toString());
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'admin-inspector.png') });
  check('切成下方 → cell.agentInputPos＝Bottom；切回上方 → Top（沒有存檔）', b === 'Bottom' && t === 'Top', JSON.stringify({ b, t }));
  check('沒有 console 錯誤', errs.length === 0, errs.join(' | ').slice(0, 300));
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--autoplay-policy=no-user-gesture-required'],
  });
  try {
    let n = 0;
    for (const vp of [{ width: 540, height: 960 }, { width: 1080, height: 1920 }]) await run(browser, vp, ++n);
    await run(browser, { width: 540, height: 960 }, ++n, { micDenied: true });
    await admin(browser);
  } finally { await browser.close(); }
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} 通過　${ok === results.length ? 'PASS' : 'FAIL'}　截圖：${OUT}`);
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
