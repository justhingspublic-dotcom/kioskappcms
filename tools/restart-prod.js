/* 重啟正式站後台（2026-09-08）。用法：node tools/restart-prod.js [後台網址]
   預設網址 https://justdisplay.justhings.com.tw/joye；帳密讀本機 .env 的 ADMIN_USERNAME / ADMIN_PASSWORD（與正式站同一個 DB）。
   流程：登入 → POST /api/restart → 等站台重新回應（最多 60 秒）→ 印出結果。 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const base = (process.argv[2] || 'https://justdisplay.justhings.com.tw/joye').replace(/\/+$/, '');
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const user = process.env.ADMIN_USERNAME || 'admin', pw = process.env.ADMIN_PASSWORD || '';
  if (!pw) throw new Error('.env 沒有 ADMIN_PASSWORD');
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ username: user, password: pw }) });
  if (!login.ok) throw new Error(`登入失敗 HTTP ${login.status}：${(await login.json().catch(() => ({}))).error || ''}`);
  const { token } = await login.json();
  const r = await fetch(`${base}/api/restart`, { method: 'POST', headers: { ...H, Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error(`重啟要求失敗 HTTP ${r.status}：${(await r.json().catch(() => ({}))).error || ''}`);
  console.log('已送出重啟，等站台回來…');
  const t0 = Date.now();
  await sleep(4000);
  for (;;) {
    try {
      const me = await fetch(`${base}/api/me`, { headers: H }); // 401＝Node 已回來（DB 連上後 API 才不回 503）
      if (me.status === 401) { console.log(`站台已回來（${Math.round((Date.now() - t0) / 1000)} 秒）。`); return; }
      if (me.status === 503) console.log('Node 已起，DB 連線中…');
    } catch { /* 還沒起來 */ }
    if (Date.now() - t0 > 60_000) throw new Error('60 秒內站台沒回來，請到伺服器看 D:\WebSite\JustDisplay\logs\server.log');
    await sleep(2000);
  }
})().catch((e) => { console.error('失敗：' + e.message); process.exit(1); });
