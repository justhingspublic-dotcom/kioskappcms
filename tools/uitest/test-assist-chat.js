/* 智能客服網頁版（assist.js）：一鍵清空、自動捲到底（圖片晚到也要貼底；跟隨是 rAF 一格一格滑過去，不是一下跳到底）、多張圖左右滑相簿＋全螢幕檢視（2026-10-12）。
   播放頁的設定與 /api/assist/* 全部用 request interception 假造（不碰真的 JustAI、不碰 DB），圖片也是假網址＋故意延遲回應。
   用法：node test-assist-chat.js            （BASE 預設 http://localhost:3177）
        BASELINE=1 node test-assist-chat.js  （改送 git HEAD 版的 assist.js／css，確認這支測試抓得到舊行為的問題） */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { execSync } = require('child_process');

const BASE = (process.env.BASE || 'http://localhost:3177').replace(/\/+$/, '');
const BASELINE = process.env.BASELINE === '1';
const OUT = path.join(__dirname, 'shots', 'assist-chat' + (BASELINE ? '-baseline' : ''));
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
  'g1.png': [640, 480, [230, 120, 60], 800], 'g2.png': [640, 480, [60, 150, 230], 1100], 'g3.png': [480, 640, [80, 180, 90], 1400],
  'single1.png': [480, 720, [200, 80, 160], 1200], 'single2.png': [480, 720, [120, 120, 200], 1500],
  'q2g1.png': [640, 480, [240, 200, 60], 900], 'q2g2.png': [640, 480, [60, 200, 200], 1200], 'q2g3.png': [640, 480, [200, 60, 60], 1500],
  'q2single.png': [480, 720, [90, 90, 90], 1500], 'og.png': [600, 314, [40, 110, 70], 1300], 'avatar.png': [128, 128, [99, 102, 241], 0],
};
const imgCache = new Map();
const imgBytes = (name) => { if (!imgCache.has(name)) { const [w, h, c] = IMG[name]; imgCache.set(name, png(w, h, c)); } return imgCache.get(name); };

// ---------- 假的 AI 回覆 ----------
const para = (label, n) => Array.from({ length: n }, (_, i) => `- ${label}第 ${i + 1} 點：這是測試用的說明文字，讓畫面可以往下捲動。`).join('\n');
function q1Parts(R) {
  const u = (f) => `https://img.test/${R}/${f}`;
  return [
    `您好！以下是園區的介紹。\n\n${para('介紹', 6)}\n\n![](${u('g1.png')})\n![](${u('g2.png')})\n![](${u('g3.png')})\n\n以上是園區三個景點的照片。\n`,
    `\n${para('第二段', 6)}\n\n![單張圖](${u('single1.png')})\n\n單張圖片的說明。\n`,
    `\n${para('第三段', 12)}\n\n![](${u('single2.png')})\n\n最後一句話。`,
  ];
}
const q2Text = (R) => {
  const u = (f) => `https://img.test/${R}/${f}`;
  return `這是第二個問題的回答。\n\n${para('補充', 3)}\n\n![](${u('q2g1.png')})\n![](${u('q2g2.png')})\n![](${u('q2g3.png')})\n\n相簿下方的文字。\n\nhttps://example.test/park/info\n\n![](${u('q2single.png')})\n\n謝謝。`;
};

const BASE_FILES = BASELINE ? {
  '/admin/assist.js': execSync('git show HEAD:public/assist.js', { cwd: path.join(__dirname, '..', '..') }).toString(),
  '/admin/assist.css': execSync('git show HEAD:public/assist.css', { cwd: path.join(__dirname, '..', '..') }).toString(),
} : null;

async function run(browser, vp, runNo) {
  tag = `${vp.width}x${vp.height}`;
  const R = `r${runNo}`;
  const page = await browser.newPage();
  await page.setViewport({ ...vp, deviceScaleFactor: 1, hasTouch: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  // 假的語音辨識（無頭 Chrome 沒麥克風）：測試自己丟結果進去；麥克風權限一律當作允許
  await page.evaluateOnNewDocument(() => {
    class FakeSR { constructor() { window.__sr = this; } start() { this.on = true; } stop() { this.on = false; setTimeout(() => this.onend && this.onend(), 0); } abort() { this.stop(); } }
    window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
    window.__srEmit = (list, resultIndex) => {
      const results = list.map(([t, fin]) => { const r = [{ transcript: t, confidence: 0.9 }]; r.isFinal = fin; return r; });
      window.__sr.onresult({ resultIndex, results });
    };
    const q = navigator.permissions?.query?.bind(navigator.permissions);
    if (q) navigator.permissions.query = (d) => (d && d.name === 'microphone' ? Promise.resolve({ state: 'granted' }) : q(d));
    // 每一格（rAF）記一次捲動狀態，看跟隨是滑的還是跳的；lateKey＝那張晚到的大圖（記它載好了沒）
    window.__recStart = (lateKey) => {
      const r = window.__r = { samples: [], stop: false };
      const tick = () => {
        if (r.stop) return;
        const sc = document.querySelector('.as-scroll'), j = document.querySelector('.as-jump'), late = document.querySelector('img[src*="' + lateKey + '"]');
        r.samples.push({ t: performance.now(), st: sc.scrollTop, dist: sc.scrollHeight - sc.clientHeight - sc.scrollTop, h: sc.scrollHeight, jump: !!j && !j.hidden, late: !!late && late.complete && late.naturalWidth > 0 });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    window.__recStop = () => { window.__r.stop = true; return window.__r.samples; };
  });

  // ---------- 攔截 ----------
  const ctl = { q1Stage: 1, polls: {}, previewCalls: 0, jobs: {}, unknown: [] };
  const deviceId = 'web-uitest-assist';
  const config = {
    themeColor: '#2E6F40',
    config: {
      activePage: 0, deviceName: 'uitest-assist', screen: { w: vp.width, h: vp.height }, idleReturnSec: -1,
      chatApi: { email: 'test@example.test', password: 'x' },
      pages: [{ id: 1, name: '', blocks: [{ id: 1, w: 1, node: { t: 'cell', bg: 'Solid', bgColor: 4280693304, content: 'Text', text: '智能客服', tap: 'OpenAssistant', agentId: 'agent-1', agentName: '測試客服', agentSpeak: false, assistantLayout: 'Kiosk', agentInputPos: 'Bottom' } }] }], // 輸入區預設改上方（2026-10-12），這支測下方
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
    if (BASE_FILES && BASE_FILES[url.pathname]) return req.respond({ status: 200, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css', body: BASE_FILES[url.pathname] });
    const p = url.pathname, m = req.method();
    if (!p.startsWith('/api/')) return req.continue();
    // 播放頁同步
    if (p === `/api/config/${deviceId}/version`) return json({ version: 5 });
    if (p === `/api/config/${deviceId}/wait`) return; // 長輪詢：一直掛著
    if (p === `/api/config/${deviceId}` && m === 'GET') return json(config);
    if (p === `/api/config/${deviceId}` && m === 'PUT') return json({ version: 5 });
    if (p === `/api/devices/${deviceId}/events`) return json({ ok: true });
    // 客服
    if (p === `/api/assist/${deviceId}/agent`) return json(agent, 150);
    if (p === `/api/assist/${deviceId}/threads` && m === 'POST') return json({ id: 'th-1' }, 100);
    if (p === `/api/assist/${deviceId}/threads` && m === 'GET') return json([]);
    let mm;
    if ((mm = p.match(/^\/api\/assist\/[^/]+\/threads\/[^/]+\/jobs$/)) && m === 'POST') {
      const content = JSON.parse(req.postData() || '{}').content || '';
      const jobId = 'job-' + (Object.keys(ctl.jobs).length + 1);
      ctl.jobs[jobId] = content.includes('Q2') ? 'q2' : 'q1';
      return json({ jobId }, 100);
    }
    if ((mm = p.match(/^\/api\/assist\/[^/]+\/jobs\/([^/]+)$/))) {
      if (m === 'DELETE') return json({ ok: true });
      const id = mm[1], kind = ctl.jobs[id];
      ctl.polls[id] = (ctl.polls[id] || 0) + 1;
      if (kind === 'q1') { const parts = q1Parts(R); return json({ text: parts.slice(0, ctl.q1Stage).join(''), done: ctl.q1Stage >= parts.length, error: null }); }
      return json({ text: q2Text(R), done: ctl.polls[id] >= 2, error: null });
    }
    if (p === '/api/assist/preview') { ctl.previewCalls++; return json({ url: url.searchParams.get('url'), host: 'example.test', title: '園區官方網站', imageUrl: `https://img.test/${R}/og.png` }, 700); }
    ctl.unknown.push(`${m} ${p}`);
    return json({});
  });

  // ---------- 小工具 ----------
  const until = async (fn, timeout = 10000, ...args) => { try { await page.waitForFunction(fn, { timeout, polling: 50 }, ...args); return true; } catch { return false; } };
  const st = () => page.evaluate(() => { const sc = document.querySelector('.as-scroll'); const j = document.querySelector('.as-jump'); return { top: Math.round(sc.scrollTop), dist: Math.round(sc.scrollHeight - sc.clientHeight - sc.scrollTop), h: sc.scrollHeight, jump: !!j && !j.hidden }; });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) });
  const lastBotText = () => page.evaluate(() => [...document.querySelectorAll('.as-msg.bot')].pop()?.textContent || '');
  const safe = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, 'exception: ' + e.message.split('\n')[0]); } };
  const imgsLoaded = (sel) => until((s) => { const list = [...document.querySelectorAll(s)]; return list.length > 0 && list.every((i) => i.complete && i.naturalWidth > 0); }, 12000, sel);
  // 跟隨是 rAF 一格一格滑過去的（2026-10-12）：不再是一下貼底，等它滑到底（約 1 秒內）
  const settle = (timeout = 2000) => until(() => { const sc = document.querySelector('.as-scroll'); return sc.scrollHeight - sc.clientHeight - sc.scrollTop <= 2; }, timeout);
  const ask = async (text) => {
    if (await page.$('.as-circle.mic.listening')) { await page.click('[data-act="mic"]'); await until(() => !!document.querySelector('.as-field'), 3000); }
    await page.evaluate(() => { const ta = document.querySelector('.as-field'); ta.value = ''; ta.dispatchEvent(new Event('input')); });
    await page.click('.as-field'); await page.type('.as-field', text);
    await page.click('[data-act="send"]');
  };

  await page.goto(`${BASE}/play/?device=uitest-assist&key=uitest-key`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('.tappable', { timeout: 10000 });
  await sleep(300);
  await page.click('.tappable');
  await page.waitForSelector('.as-root .as-field', { timeout: 8000 });
  await until(() => document.querySelector('.as-name')?.textContent === '測試客服', 5000);
  await sleep(600); // 進場轉場
  await page.evaluate(() => document.querySelector('.as-dialog [data-act="vh-close"]')?.click()); // 萬一跳了麥克風說明

  // ===== (e) 一鍵清空 =====
  await safe('(e) 清除鈕', async () => {
    const init = await page.evaluate(() => { const c = document.querySelector('.as-clear'); return { exists: !!c, hidden: c ? c.hidden : null }; });
    check('(e) 空白時沒有清除鈕', init.exists && init.hidden, JSON.stringify(init));
    await page.click('.as-field');
    await page.evaluate(() => { window.__ta = document.querySelector('.as-field'); window.__blurs = 0; window.__ta.addEventListener('blur', () => window.__blurs++); });
    const rowH0 = await page.evaluate(() => Math.round(document.querySelector('.as-text-row').getBoundingClientRect().height));
    await page.type('.as-field', '想問的問題');
    const typed = await page.evaluate(() => { const c = document.querySelector('.as-clear'), sd = document.querySelector('[data-act="send"]'); const r = c.getBoundingClientRect(), rs = sd.getBoundingClientRect(), cs = getComputedStyle(c); return { visible: !c.hidden && r.width > 0, same: document.querySelector('.as-field') === window.__ta, focused: document.activeElement === window.__ta, h: Math.round(r.height), sendH: Math.round(rs.height), bg: cs.backgroundColor, text: c.textContent.trim(), label: c.getAttribute('aria-label'), rowH: Math.round(document.querySelector('.as-text-row').getBoundingClientRect().height), order: [...c.parentElement.children].map((x) => x.className.split(' ')[0] + (x.dataset.act ? ':' + x.dataset.act : '')).join(' > ') }; });
    check('(e) 打字時清除鈕即時出現（輸入框沒重建、仍在焦點）', typed.visible && typed.same && typed.focused, JSON.stringify(typed));
    check('(e) 清除鈕＝淡淡的 ✕、沒有底色、不比送出高、aria-label 清除文字', typed.text === 'close' && typed.bg === 'rgba(0, 0, 0, 0)' && typed.h <= typed.sendH && typed.label === '清除文字', JSON.stringify(typed));
    // 窄舞台時提示字本來就會折行（輸入列改版再處理），寬螢幕才比高度
    if (vp.width >= 1000) check('(e) 清除鈕出現時輸入列高度不變', typed.rowH === rowH0, `rowH0=${rowH0} rowH=${typed.rowH}`);
    await shot('01-clear-visible');
    await page.click('.as-clear'); // 滑鼠
    await sleep(150);
    const after = await page.evaluate(() => ({ value: window.__ta.value, focused: document.activeElement === window.__ta, same: document.querySelector('.as-field') === window.__ta, blurs: window.__blurs, clearHidden: document.querySelector('.as-clear').hidden, sendDisabled: document.querySelector('[data-act="send"]').disabled, h: window.__ta.style.height }));
    check('(e) 滑鼠點清除：清空、焦點留在輸入框、沒失焦過、送出變灰、清除鈕藏起', after.value === '' && after.focused && after.same && after.blurs === 0 && after.clearHidden && after.sendDisabled, JSON.stringify(after));
    // 觸控點一次
    await page.type('.as-field', '第二行'); // Shift+Enter 換行，不送出
    await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
    await page.type('.as-field', '換行後的字');
    const grownH = await page.evaluate(() => window.__ta.getBoundingClientRect().height);
    const box = await page.evaluate(() => { const r = document.querySelector('.as-clear').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.touchscreen.tap(box.x, box.y);
    await sleep(200);
    const afterTouch = await page.evaluate(() => ({ value: window.__ta.value, focused: document.activeElement === window.__ta, blurs: window.__blurs, clearHidden: document.querySelector('.as-clear').hidden, h: window.__ta.getBoundingClientRect().height }));
    check('(e) 觸控點清除：清空、焦點留著、輸入框高度縮回一行', afterTouch.value === '' && afterTouch.focused && afterTouch.blurs === 0 && afterTouch.clearHidden && afterTouch.h < grownH, `${JSON.stringify(afterTouch)} grownH=${Math.round(grownH)}`);
    // 打字再刪光：鈕也要即時藏起
    await page.type('.as-field', 'ab');
    await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
    check('(e) 刪光文字清除鈕即時藏起', await page.evaluate(() => document.querySelector('.as-clear').hidden));
  });

  // ===== (e2) 聆聽中清除 =====
  await safe('(e2) 聆聽中清除', async () => {
    await page.click('[data-act="mic"]');
    await until(() => !!document.querySelector('.as-transcript'), 3000);
    await page.evaluate(() => window.__srEmit([['你好', false]], 0));
    const t1 = await page.evaluate(() => ({ t: document.querySelector('.as-transcript')?.textContent, clear: !document.querySelector('.as-clear').hidden }));
    await page.click('.as-clear');
    await sleep(100);
    const t2 = await page.evaluate(() => ({ t: document.querySelector('.as-transcript')?.textContent, listening: !!document.querySelector('.as-circle.mic.listening'), clearHidden: document.querySelector('.as-clear').hidden }));
    await page.evaluate(() => window.__srEmit([['你好嗎', true]], 0)); // 清除前那句講完了：不要再跑回來
    const t3 = await page.evaluate(() => document.querySelector('.as-transcript')?.textContent);
    await page.evaluate(() => window.__srEmit([['你好嗎', true], ['再見', true]], 1));
    const t4 = await page.evaluate(() => document.querySelector('.as-transcript')?.textContent);
    check('(e2) 聆聽中：清除鈕出現、清掉聽到的字、繼續聽、清除前那句不回來、之後的字照常', t1.t === '你好' && t1.clear && t2.t === '聆聽中，請說話…' && t2.listening && t2.clearHidden && t3 === '聆聽中，請說話…' && t4 === '再見', JSON.stringify({ t1, t2, t3, t4 }));
    await page.click('[data-act="mic"]'); // 停止聆聽
    await until(() => !!document.querySelector('.as-field'), 3000);
    const v = await page.evaluate(() => ({ value: document.querySelector('.as-field').value, clear: !document.querySelector('.as-clear').hidden }));
    check('(e2) 停止聆聽後草稿＝清除後說的話、清除鈕顯示', v.value === '再見' && v.clear, JSON.stringify(v));
    await page.click('.as-clear');
    await sleep(100);
  });

  // ===== Q1：相簿＋串流中途 =====
  let q1ok = false;
  await safe('Q1', async () => {
    await ask('Q1 園區介紹');
    q1ok = await until(() => ([...document.querySelectorAll('.as-msg.bot')].pop()?.textContent || '').includes('以上是園區三個景點的照片'), 15000);
    check('Q1 第一段串流完成', q1ok);
    if (!q1ok) { console.log('  最後一則：', (await lastBotText()).slice(0, 200), JSON.stringify({ jobs: ctl.jobs, polls: ctl.polls, unknown: ctl.unknown })); await shot('99-q1-stuck'); }
    const galLoaded = await imgsLoaded('.as-strip .as-card img');
    await settle();
    const s1 = await st();
    check('(a) 串流中多張圖晚到後仍貼底', galLoaded && s1.dist <= 2, JSON.stringify(s1));
    const g = await page.evaluate(() => { const g = document.querySelector('.as-strip'); if (!g) return null; const cards = [...g.querySelectorAll('.as-card')]; const r = cards[0].getBoundingClientRect(), gr = g.getBoundingClientRect(); return { cards: cards.length, ratio: +(r.width / r.height).toFixed(2), cardW: Math.round(r.width), stripW: Math.round(gr.width), peek: Math.round(cards[1].getBoundingClientRect().left - gr.left), scrollable: g.scrollWidth > g.clientWidth + 10, extras: g.querySelectorAll('button, .as-count, .as-dots').length, singles: document.querySelectorAll('.as-list .as-img').length }; });
    check('(c) 三張連續圖＝一列三張獨立卡片（4:3），沒有箭頭／張數／圓點', g && g.cards === 3 && Math.abs(g.ratio - 1.33) < 0.03 && g.extras === 0 && g.singles === 0, JSON.stringify(g));
    check('(c) 下一張露出一角（卡片比一列窄、可以橫向滑）', g && g.cardW < g.stripW && g.peek < g.stripW && g.scrollable, JSON.stringify(g));
    const bl = await page.evaluate(() => { const g = document.querySelector('.as-strip'), body = g.closest('.as-bot-body'), list = document.querySelector('.as-list'), sc = document.querySelector('.as-scroll'); const gr = g.getBoundingClientRect(), br = body.getBoundingClientRect(), lr = list.getBoundingClientRect(), sr = sc.getBoundingClientRect(), c0 = g.querySelector('.as-card').getBoundingClientRect(); return { stripL: Math.round(gr.left), stripR: Math.round(gr.right), edgeL: Math.round(Math.max(lr.left, sr.left)), edgeR: Math.round(Math.min(lr.right, sr.right)), textL: Math.round(br.left), card0L: Math.round(c0.left) }; });
    check('(c) 卡片列延伸到對話區兩邊、第一張仍對齊文字', Math.abs(bl.stripL - bl.edgeL) <= 1 && Math.abs(bl.stripR - bl.edgeR) <= 1 && Math.abs(bl.card0L - bl.textL) <= 1, JSON.stringify(bl));
    await page.evaluate(() => document.querySelector('.as-strip').scrollIntoView({ block: 'center' }));
    await sleep(200);
    await shot('02-strip-first');
    // 模擬左滑到第二張
    await page.evaluate(() => { const g = document.querySelector('.as-strip'); const c = g.querySelectorAll('.as-card')[1]; g.scrollTo({ left: g.scrollLeft + c.getBoundingClientRect().left - g.getBoundingClientRect().left - parseFloat(getComputedStyle(g).paddingLeft) }); });
    await sleep(500);
    const g2 = await page.evaluate(() => { const g = document.querySelector('.as-strip'); window.__gal = g; window.__img2 = g.querySelectorAll('.as-card img')[1]; window.__left = g.scrollLeft; const c = g.querySelectorAll('.as-card')[1]; return { left: Math.round(g.scrollLeft), cardLeft: Math.round(c.getBoundingClientRect().left - g.getBoundingClientRect().left), pad: Math.round(parseFloat(getComputedStyle(g).paddingLeft)) }; });
    check('(c) 左滑後第二張卡片對齊文字開頭（左邊延伸區露出上一張，不是硬切）', g2.left > 0 && Math.abs(g2.cardLeft - g2.pad) <= 2, JSON.stringify(g2));

    // 繼續串流：卡片列要停在第 2 張、圖片元素不重建
    await page.evaluate(() => { window.__muts = 0; window.__mo = new MutationObserver((l) => { window.__muts += l.length; }); window.__mo.observe([...document.querySelectorAll('.as-msg.bot')].pop().querySelector('.as-bot-body'), { childList: true }); });
    ctl.q1Stage = 2;
    const s2ok = await until(() => ([...document.querySelectorAll('.as-msg.bot')].pop()?.textContent || '').includes('單張圖片的說明'), 15000);
    const g3 = await page.evaluate(() => { const g = document.querySelector('.as-strip'); window.__mo.disconnect(); return { same: g === window.__gal, connected: window.__gal.isConnected, img2Same: g.querySelectorAll('.as-card img')[1] === window.__img2, img2Loaded: window.__img2.complete && window.__img2.naturalWidth > 0, left: Math.round(g.scrollLeft), was: Math.round(window.__left), mutations: window.__muts }; });
    check('(c) 之後的串流（多次重畫）同一列卡片、還停在第二張、圖片沒重建', s2ok && g3.same && g3.connected && g3.img2Same && g3.img2Loaded && Math.abs(g3.left - g3.was) <= 1 && g3.mutations > 10, JSON.stringify(g3));
    await page.evaluate(() => document.querySelector('.as-strip').scrollIntoView({ block: 'center' }));
    await sleep(150);
    await shot('03-strip-second-after-stream');
    await page.evaluate(() => { const sc = document.querySelector('.as-scroll'); sc.scrollTop = sc.scrollHeight; }); // 回到底部（模擬訪客自己滑回去）
    await sleep(300);
    const singleLoaded = await imgsLoaded('.as-list .as-img');
    await settle();
    const s3 = await st();
    check('(a) 串流中單張圖晚到後仍貼底', singleLoaded && s3.dist <= 2 && !s3.jump, JSON.stringify(s3));

    // ===== (b) 訪客往上滑 → 之後內容變多不拉回去 =====
    const box = await page.evaluate(() => { const r = document.querySelector('.as-scroll').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(box.x, box.y);
    await page.mouse.wheel({ deltaY: -500 });
    await sleep(700);
    const up = await st();
    check('(b) 往上滑之後出現「回到底部」', up.dist > 100 && up.jump, JSON.stringify(up));
    ctl.q1Stage = 3;
    const done = await until(() => !!document.querySelector('[data-act="send"]'), 20000);
    await sleep(1800); // 最後那張單張圖（1.5 秒延遲）有機會載入
    const later = await st();
    check('(b) 之後內容變多（串流＋晚到圖片）沒被拉回底部、跳鈕還在', done && later.h > up.h && Math.abs(later.top - up.top) <= 20 && later.dist > 100 && later.jump, JSON.stringify({ up, later }));
    await shot('04-scrolled-up-jump');
    await page.click('.as-jump');
    await settle();
    const jumped = await st();
    await page.evaluate(() => { const d = document.createElement('div'); d.id = '__grow'; d.style.height = '300px'; [...document.querySelectorAll('.as-msg.bot')].pop().querySelector('.as-bot-body').appendChild(d); });
    await until((h0) => document.querySelector('.as-scroll').scrollHeight > h0 + 250, 2000, jumped.h);
    await settle();
    const regrow = await st();
    await page.evaluate(() => document.getElementById('__grow')?.remove());
    check('(b) 點「回到底部」→ 滑到底、跳鈕消失，之後再長高會繼續跟（滑到底）', jumped.dist <= 2 && !jumped.jump && regrow.h > jumped.h + 250 && regrow.dist <= 2 && !regrow.jump, JSON.stringify({ jumped, regrow }));
  });

  // ===== (d) 全螢幕檢視 =====
  await safe('(d) 全螢幕', async () => {
    await page.evaluate(() => document.querySelector('.as-strip').scrollIntoView({ block: 'center' }));
    await sleep(300);
    const c2 = await page.evaluate(() => { const r = document.querySelectorAll('.as-strip .as-card')[1].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(c2.x, c2.y);
    await until(() => !!document.querySelector('.as-layer .as-slider.full'), 3000);
    await sleep(200);
    const v1 = await page.evaluate(() => { const l = document.querySelector('.as-layer'); const tr = l.querySelector('.as-slides'); return { left: Math.round(tr.scrollLeft), w: tr.clientWidth, dots: [...l.querySelectorAll('.as-dots i')].map((d) => (d.classList.contains('on') ? 1 : 0)).join(''), extras: l.querySelectorAll('.as-nav, .as-count').length }; });
    check('(d) 點第二張卡片 → 全螢幕從第二張開始、下方圓點 010、沒有箭頭／張數', Math.abs(v1.left - v1.w) <= 1 && v1.dots === '010' && v1.extras === 0, JSON.stringify(v1));
    await shot('05-viewer-second');
    await page.evaluate(() => { const tr = document.querySelector('.as-layer .as-slides'); tr.scrollTo({ left: tr.clientWidth * 2 }); });
    await sleep(500);
    const v2 = await page.evaluate(() => [...document.querySelectorAll('.as-layer .as-dots i')].map((d) => (d.classList.contains('on') ? 1 : 0)).join(''));
    check('(d) 全螢幕左右滑換張、圓點跟著動', v2 === '001', v2);
    await page.click('.as-layer .as-dots');
    await sleep(150);
    check('(d) 點圓點不會關掉全螢幕', await page.evaluate(() => !!document.querySelector('.as-layer')));
    // 點圖以外的暗處 → 關閉（最下方一定是空白：圖是橫的）
    await page.mouse.click(vp.width / 2, vp.height - 12);
    await sleep(200);
    const closed = await page.evaluate(() => !document.querySelector('.as-layer'));
    check('(d) 點暗處關閉', closed);
    // 單張圖的全螢幕照舊
    await page.click('.as-list .as-img');
    const single = await until(() => !!document.querySelector('.as-layer img.full'), 3000);
    await page.click('.as-layer img.full');
    await sleep(150);
    check('(d) 單張圖全螢幕照舊（點圖關閉）', single && await page.evaluate(() => !document.querySelector('.as-layer')));
  });

  // ===== (a) Q2：回覆結束後圖片／連結卡片才載入 → 仍在底部 =====
  await safe('(a) Q2', async () => {
    await ask('Q2 補充說明');
    await page.evaluate(() => window.__recStart('q2single'));
    const done = await until(() => !!document.querySelector('[data-act="send"]') && ([...document.querySelectorAll('.as-msg.bot')].pop()?.textContent || '').includes('謝謝。'), 20000);
    const atDone = await st();
    const pending = await page.evaluate(() => { const m = [...document.querySelectorAll('.as-msg.bot')].pop(); return [...m.querySelectorAll('.as-bot-body img')].filter((i) => !(i.complete && i.naturalWidth > 0)).length + (m.querySelector('.as-link img.og') ? 0 : 1); });
    const loaded = await until(() => { const m = [...document.querySelectorAll('.as-msg.bot')].pop(); const imgs = [...m.querySelectorAll('.as-bot-body img')]; return !!m.querySelector('.as-link img.og') && imgs.every((i) => i.complete && i.naturalWidth > 0); }, 12000);
    await settle();
    await sleep(200);
    const end = await st();
    const sm = await page.evaluate(() => window.__recStop());
    check('(a) 回覆結束時圖片／連結卡片還沒載完（測試有意義）', done && pending > 0, `還沒載完 ${pending} 個`);
    check('(a) 回覆結束、晚到的圖片與連結卡片載完後，滑到最底部', loaded && end.h > atDone.h && end.dist <= 2 && !end.jump, JSON.stringify({ atDone, end }));
    // 晚到的大圖（q2single）載好那一格內容一下變高：跟隨要好幾格才滑到底，不是一格就跳到底
    const g = (() => {
      const i0 = sm.findIndex((x) => x.late);
      if (i0 < 1) return { found: false };
      let F = i0, dh = 0;
      for (let i = i0; i < Math.min(sm.length, i0 + 4); i++) { const d = sm[i].h - sm[i - 1].h; if (d > dh) { dh = d; F = i; } }
      const gap = sm[F].dist;
      let j = F; while (j < sm.length && sm[j].dist > Math.max(2, gap * 0.1)) j++;
      const sts = sm.slice(F, Math.min(j + 1, sm.length)).map((x) => x.st);
      return { found: true, dh: Math.round(dh), gap: Math.round(gap), frames: j - F, ms: j < sm.length ? Math.round(sm[j].t - sm[F].t) : null, closed: j < sm.length, mono: sts.every((v, i) => i === 0 || v >= sts[i - 1] - 0.5), distinct: new Set(sts.map((v) => Math.round(v))).size, path: sts.slice(0, 8).map((v) => Math.round(v)).join('→') };
    })();
    check('(a) 晚到的大圖載好後是「滑」到底：好幾格（≥4 格、1.2 秒內）才收到 10% 以內，scrollTop 一路往下經過好幾個中間值', g.found && g.dh >= 150 && g.gap >= g.dh * 0.8 && g.closed && g.frames >= 4 && g.ms <= 1200 && g.mono && g.distinct >= 4, JSON.stringify(g));
    check('連結預覽只抓一次（串流重畫不重抓）', ctl.previewCalls === 1, `preview 呼叫 ${ctl.previewCalls} 次`);
    await shot('06-q2-bottom');
  });

  check('沒有頁面錯誤／console 錯誤', errs.length === 0, errs.join(' | ').slice(0, 400));
  if (ctl.unknown.length) console.log('  （未知 API：' + [...new Set(ctl.unknown)].join(', ') + '）');
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
  } finally { await browser.close(); }
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} 通過${BASELINE ? '（BASELINE：舊版 assist.js）' : ''}　截圖：${OUT}`);
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
