/* 重啟正式站後台（2026-09-08）。用法：node tools/restart-prod.js [後台網址] [--supervisor]
   預設網址 https://justdisplay.justhings.com.tw/joye；帳密讀本機 .env 的 ADMIN_USERNAME / ADMIN_PASSWORD（與正式站同一個 DB）。
   流程：登入 → POST /api/restart → 等站台重新回應（最多 60 秒）→ 印出結果。
   --supervisor（2026-09-15）：連保母程序一起重啟，部署改了 src/supervisor.js 或 src/win-priority.js 時要用。
   伺服器上跑的後台若還沒有這個功能，會只重啟後台並提示再跑一次。 */
// ENV_FILE（2026-09-10）：重啟別的站台要用它的主管理員：ENV_FILE=.env.sunrise node tools/restart-prod.js https://justdisplay.justhings.com.tw/sunrise
require('dotenv').config({ path: process.env.ENV_FILE ? require('path').resolve(process.env.ENV_FILE) : require('path').join(__dirname, '..', '.env') });
const args = process.argv.slice(2);
const withSupervisor = args.includes('--supervisor');
const base = (args.find((a) => !a.startsWith('--')) || 'https://justdisplay.justhings.com.tw/joye').replace(/\/+$/, '');
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const user = process.env.ADMIN_USERNAME || 'admin', pw = process.env.ADMIN_PASSWORD || '';
  if (!pw) throw new Error('.env 沒有 ADMIN_PASSWORD');
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ username: user, password: pw }) });
  if (!login.ok) throw new Error(`登入失敗 HTTP ${login.status}：${(await login.json().catch(() => ({}))).error || ''}`);
  const { token } = await login.json();
  const r = await fetch(`${base}/api/restart`, { method: 'POST', headers: { ...H, Authorization: 'Bearer ' + token }, body: JSON.stringify(withSupervisor ? { supervisor: true } : {}) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`重啟要求失敗 HTTP ${r.status}：${body.error || ''}`);
  if (withSupervisor && !body.supervisor) console.log('伺服器上的後台還沒有「連保母一起重啟」的功能，這次只重啟後台；站台回來後請再跑一次 --supervisor。');
  console.log(body.supervisor ? '已送出重啟（連保母一起），等站台回來…' : '已送出重啟，等站台回來…');
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
